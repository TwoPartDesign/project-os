// scripts/lib/decide.ts — typed decision interface for the Jev integration.
//
// Ships the core (T179): types, config reading, a deterministic heuristic
// backend, and `decide()`'s decline scaffolding. The Jev network path (T185)
// guards every outbound text field through `guardEgressFields`, builds the
// request body from the guarded fields only, POSTs it over `fetchImpl`,
// validates every answer, and falls back per-question to the heuristic
// backend on any validation failure.
//
// Heuristic backend (deterministic, pure, no I/O):
//   - noul:   always 0.5.
//   - choice: the first criteria key, uniform probabilities across all keys
//             (1 / n each), confidence 0.
//   - score:  level index Math.floor((n - 1) / 2) into the criteria array
//             (the middle level, rounded down), probabilities keyed by level
//             index as strings, all 1 / n, confidence 0.
//
// `process.env` is read only inside `decide()` — every other function takes
// its inputs as explicit parameters so it stays testable without touching
// real process/environment/filesystem state.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { getProjectRoot } from "./project-root.ts";
import { guardEgressFields } from "./egress-guard.ts";

/** A yes/no-shaped question, answered with a "noul" (a 0..1 continuous truth value). */
export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
/** A single-select question over a fixed set of named criteria. */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
/** An ordinal question over an ordered list of level labels. */
export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};
/** The union of all question shapes `decide()` accepts. */
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
/** A named set of questions to answer in one `decide()` call. */
export type QuestionMap = Record<string, Question>;

/** The answer to a `NoulQuestion`: a continuous truth value in [0, 1]. */
export type NoulAnswer = { type: "noul"; noul: number };
/** The answer to a `ChoiceQuestion`: the chosen key plus a probability distribution over all keys. */
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
/** The answer to a `ScoreQuestion`: the chosen level index plus a probability distribution over all indices. */
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
};
/** The union of all answer shapes `decide()` returns. */
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Why `decide()` fell back to the heuristic backend instead of calling Jev. */
export type DeclineReason =
  | "disabled"
  | "no-key"
  | "egress-dir-unsafe"
  | "scrub-failed"
  | "too-large"
  | "timeout"
  | "network"
  | "redirect"
  | `http-${number}`
  | "malformed-response";

/** The full result of one `decide()` call. */
export type DecisionResult = {
  answers: Record<string, Answer>;
  backend: "heuristic" | "jev";
  declined?: DeclineReason;
  /**
   * Question names whose Jev answer failed validation and were replaced by
   * the heuristic stub. Consumers must not treat those entries in `answers`
   * as Jev-derived. Empty on the heuristic backend.
   */
  rejected: string[];
  redactions: number;
  usage?: { input_tokens: number; output_tokens: number };
  duration_ms: number;
};

/** Jev backend configuration, read from `.claude/settings.json`'s `project_os.jev` block. */
export type JevConfig = {
  enabled: boolean; // default false
  model: string; // default "jev-latest"
  timeout_ms: number; // default 5000
  max_body_tokens: number; // default 60000
  thresholds: {
    duplicate_p: number;
    out_of_scope_p: number;
    severity_confidence: number;
  }; // 0.85, 0.80, 0.80
};

/** Dependencies `decide()` accepts for testing and (in a later task) for wiring in the real Jev backend. */
export type DecideDeps = {
  config?: JevConfig;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  scrubCmd?: (file: string) => { status: number };
  scanCmd?: (file: string) => { status: number };
  egressDir?: string;
  /** Project root the outbound egress guard operates under. Defaults to `getProjectRoot()`. */
  projectRoot?: string;
  log?: (event: string, kv: Record<string, string>) => void;
  now?: () => number;
  consumer?: string;
};

/** The Jev backend's fixed endpoint. Never configurable — not read from settings or env. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** Default `JevConfig`, used whenever settings are missing, unparseable, or partial. */
export const DEFAULT_JEV_CONFIG: JevConfig = {
  enabled: false,
  model: "jev-latest",
  timeout_ms: 5000,
  max_body_tokens: 60000,
  thresholds: {
    duplicate_p: 0.85,
    out_of_scope_p: 0.8,
    severity_confidence: 0.8,
  },
};

/**
 * Reads `JevConfig` from `<projectRoot>/.claude/settings.json`'s
 * `project_os.jev` block (override the path via `settingsPath`), following
 * the same read pattern as `scripts/knowledge-index.ts`'s `loadConfig`
 * (`JSON.parse` + per-field `??` defaults). A missing file, unparseable
 * JSON, or missing `project_os.jev` block returns `DEFAULT_JEV_CONFIG`
 * unchanged. `enabled` falls back unless it is strictly boolean `true`.
 * Numeric fields (`timeout_ms`, `max_body_tokens`, each threshold) fall back
 * per field when not a finite, non-negative number; thresholds additionally
 * fall back when outside `[0, 1]`. `model` falls back unless it is a
 * non-empty string.
 */
export function readJevConfig(settingsPath?: string): JevConfig {
  const path =
    settingsPath ?? resolve(getProjectRoot(), ".claude/settings.json");
  if (!existsSync(path)) return DEFAULT_JEV_CONFIG;

  try {
    const settings = JSON.parse(readFileSync(path, "utf-8"));
    const jev = settings.project_os?.jev;
    if (!jev) return DEFAULT_JEV_CONFIG;

    return {
      enabled: jev.enabled === true,
      model:
        typeof jev.model === "string" && MODEL_ID_RE.test(jev.model)
          ? jev.model
          : DEFAULT_JEV_CONFIG.model,
      timeout_ms: isFiniteNonNegative(jev.timeout_ms)
        ? jev.timeout_ms
        : DEFAULT_JEV_CONFIG.timeout_ms,
      max_body_tokens: isFiniteNonNegative(jev.max_body_tokens)
        ? jev.max_body_tokens
        : DEFAULT_JEV_CONFIG.max_body_tokens,
      thresholds: {
        duplicate_p: isUnitInterval(jev.thresholds?.duplicate_p)
          ? jev.thresholds.duplicate_p
          : DEFAULT_JEV_CONFIG.thresholds.duplicate_p,
        out_of_scope_p: isUnitInterval(jev.thresholds?.out_of_scope_p)
          ? jev.thresholds.out_of_scope_p
          : DEFAULT_JEV_CONFIG.thresholds.out_of_scope_p,
        severity_confidence: isUnitInterval(jev.thresholds?.severity_confidence)
          ? jev.thresholds.severity_confidence
          : DEFAULT_JEV_CONFIG.thresholds.severity_confidence,
      },
    };
  } catch {
    return DEFAULT_JEV_CONFIG;
  }
}

/**
 * Shape a settings-supplied `model` must match to be serialized into the
 * request body — it is the one config string that reaches the wire without
 * passing the egress guard.
 */
const MODEL_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** True if `n` is a finite number that is >= 0. */
function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** True if `n` is a finite number within [0, 1]. */
function isUnitInterval(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * Deterministic, pure, I/O-free fallback backend. Answers every question in
 * `questions` per the module-header rules: `noul` returns 0.5; `choice`
 * returns the first criteria key with uniform probabilities and confidence
 * 0; `score` returns level index `Math.floor((n - 1) / 2)` with per-index
 * probabilities of `1 / n`, confidence 0. `state` is accepted for interface
 * symmetry with the eventual Jev backend but does not affect the answer.
 */
export function heuristicBackend(
  state: string,
  questions: QuestionMap,
): Record<string, Answer> {
  const answers: Record<string, Answer> = {};

  for (const [key, question] of Object.entries(questions)) {
    if (question.type === "noul") {
      answers[key] = { type: "noul", noul: 0.5 };
    } else if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      const uniform = 1 / keys.length;
      const probabilities: Record<string, number> = {};
      for (const k of keys) probabilities[k] = uniform;
      answers[key] = {
        type: "choice",
        choice: keys[0],
        probabilities,
        confidence: 0,
      };
    } else {
      const n = question.criteria.length;
      const uniform = 1 / n;
      const probabilities: Record<string, number> = {};
      for (let i = 0; i < n; i++) probabilities[String(i)] = uniform;
      answers[key] = {
        type: "score",
        score: Math.floor((n - 1) / 2),
        probabilities,
        confidence: 0,
      };
    }
  }

  return answers;
}

/**
 * Best-effort activity logger, used as `decide()`'s default `log` when the
 * caller does not supply one. Shells out to
 * `.claude/hooks/log-activity.sh <event> k=v ...` and swallows every error
 * (missing hook, non-zero exit, spawn failure) so logging can never fail a
 * caller of `decide()`. Never used when `deps.log` is given.
 */
export function defaultLogger(
  event: string,
  kv: Record<string, string>,
  cwd?: string,
): void {
  try {
    execFileSync(
      "bash",
      [
        ".claude/hooks/log-activity.sh",
        event,
        ...Object.entries(kv).map(([k, v]) => `${k}=${v}`),
      ],
      { cwd: cwd ?? getProjectRoot(), stdio: "ignore" },
    );
  } catch {
    // Logging is best-effort; never let it fail the caller.
  }
}

/**
 * Collects every outbound text field for `state`/`questions` in a fixed,
 * stable order: `state` first, then for each question name in
 * `Object.keys(questions)` order, its `instructions` followed by its
 * criteria strings (`Object.values(criteria)` for `noul`/`choice`, the array
 * itself for `score`). A `noul` question with no `criteria` contributes only
 * its `instructions`. This is the exact order `rebuildFromFields` consumes,
 * so the two stay inverses of each other.
 */
export function collectOutboundFields(
  state: string,
  questions: QuestionMap,
): string[] {
  const fields: string[] = [state];
  for (const name of Object.keys(questions)) {
    const question = questions[name];
    fields.push(question.instructions);
    if (question.type === "noul") {
      if (question.criteria) {
        fields.push(question.criteria.true, question.criteria.false);
      }
    } else if (question.type === "choice") {
      for (const key of Object.keys(question.criteria)) {
        fields.push(question.criteria[key]);
      }
    } else {
      for (const criterion of question.criteria) fields.push(criterion);
    }
  }
  return fields;
}

/**
 * Exact inverse of {@link collectOutboundFields}: consumes `fields` in the
 * same fixed order and returns a new `state`/`questions` pair whose
 * `instructions`/`criteria` strings are the (possibly guarded/redacted)
 * values from `fields`, with the same keys and shapes as `questions`. The
 * returned pair — never the original `questions` — is what the request body
 * is built from, so a redacted field can never be bypassed.
 */
export function rebuildFromFields(
  fields: string[],
  questions: QuestionMap,
): { state: string; questions: QuestionMap } {
  let i = 0;
  const state = fields[i++];
  const rebuilt: QuestionMap = {};
  for (const name of Object.keys(questions)) {
    const question = questions[name];
    const instructions = fields[i++];
    if (question.type === "noul") {
      if (question.criteria) {
        const trueVal = fields[i++];
        const falseVal = fields[i++];
        rebuilt[name] = {
          type: "noul",
          instructions,
          criteria: { true: trueVal, false: falseVal },
        };
      } else {
        rebuilt[name] = { type: "noul", instructions };
      }
    } else if (question.type === "choice") {
      const criteria: Record<string, string> = {};
      for (const key of Object.keys(question.criteria)) {
        criteria[key] = fields[i++];
      }
      rebuilt[name] = { type: "choice", instructions, criteria };
    } else {
      const criteria = question.criteria.map(() => fields[i++]);
      rebuilt[name] = { type: "score", instructions, criteria };
    }
  }
  return { state, questions: rebuilt };
}

/**
 * Validates one raw answer from the Jev response against `question`'s
 * shape, per the design's "Response validation" contract: the answer's
 * `type` must equal the question's; `noul` must be a finite number in
 * `[0, 1]`; `choice` must be one of the question's criteria keys with
 * `probabilities` keyed by exactly those keys (all finite) and `confidence`
 * finite in `[0, 1]`; `score` must be a finite number in
 * `[0, criteria.length - 1]` with a `probabilities` object (all finite
 * values) and `confidence` finite in `[0, 1]`. Returns the validated
 * `Answer` or `null` on any failure.
 */
function validateAnswer(question: Question, candidate: unknown): Answer | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const c = candidate as Record<string, unknown>;
  if (c.type !== question.type) return null;

  if (question.type === "noul") {
    if (!isUnitInterval(c.noul)) return null;
    return { type: "noul", noul: c.noul };
  }

  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    if (typeof c.choice !== "string" || !keys.includes(c.choice)) return null;
    if (typeof c.probabilities !== "object" || c.probabilities === null) {
      return null;
    }
    const rawProbs = c.probabilities as Record<string, unknown>;
    const probKeys = Object.keys(rawProbs);
    if (
      probKeys.length !== keys.length ||
      !keys.every((k) => probKeys.includes(k))
    ) {
      return null;
    }
    const probabilities: Record<string, number> = {};
    for (const k of keys) {
      if (!isUnitInterval(rawProbs[k])) return null;
      probabilities[k] = rawProbs[k];
    }
    if (!isUnitInterval(c.confidence)) return null;
    return {
      type: "choice",
      choice: c.choice,
      probabilities,
      confidence: c.confidence,
    };
  }

  // score
  const maxIndex = question.criteria.length - 1;
  if (
    typeof c.score !== "number" ||
    !Number.isFinite(c.score) ||
    c.score < 0 ||
    c.score > maxIndex
  ) {
    return null;
  }
  if (typeof c.probabilities !== "object" || c.probabilities === null) {
    return null;
  }
  const rawProbs = c.probabilities as Record<string, unknown>;
  const probabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawProbs)) {
    if (!isUnitInterval(v)) return null;
    probabilities[k] = v;
  }
  if (!isUnitInterval(c.confidence)) return null;
  return {
    type: "score",
    score: c.score,
    probabilities,
    confidence: c.confidence,
  };
}

/**
 * The fixed per-call context the decline and log helpers below need: the
 * call's `state`/`questions`, its resolved config, and the consumer, logger,
 * and clock `decide()` resolved from its deps.
 */
type DecideContext = {
  state: string;
  questions: QuestionMap;
  config: JevConfig;
  consumer: string;
  log: (event: string, kv: Record<string, string>) => void;
  start: number;
  now: () => number;
};

/** The three configured thresholds, rendered as the `threshold_*` fields every jev log event carries. */
function thresholdFields(config: JevConfig): Record<string, string> {
  return {
    threshold_duplicate_p: String(config.thresholds.duplicate_p),
    threshold_out_of_scope_p: String(config.thresholds.out_of_scope_p),
    threshold_severity_confidence: String(
      config.thresholds.severity_confidence,
    ),
  };
}

/** Logs `jev-declined` and returns the heuristic-backend `DecisionResult` for `reason`. */
function declineResult(
  ctx: DecideContext,
  reason: DeclineReason,
  redactions = 0,
): DecisionResult {
  const duration_ms = ctx.now() - ctx.start;
  ctx.log("jev-declined", {
    consumer: ctx.consumer,
    reason,
    questions: String(Object.keys(ctx.questions).length),
    backend: "heuristic",
    redactions: String(redactions),
    duration_ms: String(duration_ms),
    ...thresholdFields(ctx.config),
  });
  return {
    answers: heuristicBackend(ctx.state, ctx.questions),
    backend: "heuristic",
    declined: reason,
    rejected: [],
    redactions,
    duration_ms,
  };
}

/**
 * Guards every outbound text field through `guardEgressFields` and builds the
 * request body from the guarded fields only. Refuses with the guard's own
 * reason (redaction count 0, since nothing was guarded) or with `"too-large"`
 * when the built body would exceed `config.max_body_tokens`.
 */
function prepareRequest(
  state: string,
  questions: QuestionMap,
  config: JevConfig,
  deps: DecideDeps,
):
  | { body: string; redactions: number }
  | { refused: DeclineReason; redactions: number } {
  const guarded = guardEgressFields(collectOutboundFields(state, questions), {
    projectRoot: deps.projectRoot ?? getProjectRoot(),
    egressDir: deps.egressDir,
    scrubCmd: deps.scrubCmd,
    scanCmd: deps.scanCmd,
  });
  if ("refused" in guarded) return { refused: guarded.refused, redactions: 0 };

  const rebuilt = rebuildFromFields(guarded.fields, questions);
  const body = JSON.stringify({
    state: rebuilt.state,
    model: config.model,
    questions: rebuilt.questions,
  });

  if (Math.ceil(body.length / 4) > config.max_body_tokens) {
    return { refused: "too-large", redactions: guarded.redactions };
  }
  return { body, redactions: guarded.redactions };
}

/**
 * POSTs `body` to {@link JEV_ENDPOINT} with a manual-redirect policy and a
 * `config.timeout_ms` abort signal, mapping an abort to `"timeout"`, any other
 * throw to `"network"`, a 3xx to `"redirect"`, and any other non-2xx status to
 * `` `http-<status>` ``. The API key reaches only the `Authorization` header.
 */
async function postToJev(
  body: string,
  apiKey: string,
  config: JevConfig,
  fetchImpl?: typeof fetch,
): Promise<{ response: Response } | { refused: DeclineReason }> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeout_ms),
    });
  } catch (err) {
    const name = (err as { name?: string } | undefined)?.name;
    return {
      refused:
        name === "AbortError" || name === "TimeoutError"
          ? "timeout"
          : "network",
    };
  }

  if (response.status >= 300 && response.status < 400) {
    return { refused: "redirect" };
  }
  if (response.status < 200 || response.status >= 300) {
    return { refused: `http-${response.status}` as DeclineReason };
  }
  return { response };
}

/** Parses the response body, returning the document and its `answers` map, or `null` when the body is not JSON or carries no `answers` object. */
async function readAnswersDocument(response: Response): Promise<{
  doc: Record<string, unknown>;
  rawAnswers: Record<string, unknown>;
} | null> {
  let doc: unknown;
  try {
    doc = await response.json();
  } catch {
    return null;
  }

  if (
    typeof doc !== "object" ||
    doc === null ||
    typeof (doc as { answers?: unknown }).answers !== "object" ||
    (doc as { answers?: unknown }).answers === null
  ) {
    return null;
  }

  return {
    doc: doc as Record<string, unknown>,
    rawAnswers: (doc as { answers: Record<string, unknown> }).answers,
  };
}

/** Validates each question's raw answer, substituting the heuristic stub for any that fails and naming it in `rejected`. */
function gradeAnswers(
  state: string,
  questions: QuestionMap,
  rawAnswers: Record<string, unknown>,
): {
  answers: Record<string, Answer>;
  rejected: string[];
  anyAccepted: boolean;
} {
  const heuristic = heuristicBackend(state, questions);
  const answers: Record<string, Answer> = {};
  const rejected: string[] = [];
  let anyAccepted = false;

  for (const [name, question] of Object.entries(questions)) {
    const validated = validateAnswer(question, rawAnswers[name]);
    if (validated) {
      answers[name] = validated;
      anyAccepted = true;
    } else {
      answers[name] = heuristic[name];
      rejected.push(name);
    }
  }

  return { answers, rejected, anyAccepted };
}

/** Reads `usage` from the response document, ignoring it unless both token counts are finite numbers. */
function extractUsage(
  doc: Record<string, unknown>,
): { input_tokens: number; output_tokens: number } | undefined {
  const rawUsage = doc.usage;
  if (!rawUsage || typeof rawUsage !== "object") return undefined;
  const u = rawUsage as Record<string, unknown>;
  if (!Number.isFinite(u.input_tokens) || !Number.isFinite(u.output_tokens)) {
    return undefined;
  }
  return {
    input_tokens: u.input_tokens as number,
    output_tokens: u.output_tokens as number,
  };
}

/**
 * Assembles the `"jev"`-backend `DecisionResult` for a call that had at least
 * one answer accepted, logging `jev-queried` with the consumer, question
 * count, backend, redactions, usage, duration, and configured thresholds.
 * `declined` is `"malformed-response"` when any single question was rejected.
 */
function acceptedResult(
  ctx: DecideContext,
  graded: { answers: Record<string, Answer>; rejected: string[] },
  doc: Record<string, unknown>,
  redactions: number,
): DecisionResult {
  const usage = extractUsage(doc);
  const duration_ms = ctx.now() - ctx.start;
  const declined: DeclineReason | undefined =
    graded.rejected.length > 0 ? "malformed-response" : undefined;

  ctx.log("jev-queried", {
    consumer: ctx.consumer,
    questions: String(Object.keys(ctx.questions).length),
    backend: "jev",
    ...(declined ? { declined, rejected: String(graded.rejected.length) } : {}),
    redactions: String(redactions),
    input_tokens: usage ? String(usage.input_tokens) : "",
    output_tokens: usage ? String(usage.output_tokens) : "",
    duration_ms: String(duration_ms),
    ...thresholdFields(ctx.config),
  });

  return {
    answers: graded.answers,
    backend: "jev",
    declined,
    rejected: graded.rejected,
    redactions,
    ...(usage ? { usage } : {}),
    duration_ms,
  };
}

/**
 * Answers `questions` against `state`. Resolution order: if
 * `config.enabled` is not strictly `true`, declines `"disabled"`; else if
 * `env.TYPESAFE_API_KEY` is unset, declines `"no-key"`; else every outbound
 * text field is guarded through `guardEgressFields` (a refusal declines
 * `"egress-dir-unsafe"` or `"scrub-failed"`); the request body is built only
 * from the guarded fields and declines `"too-large"` if it would exceed
 * `config.max_body_tokens`; the Jev backend is called over `fetchImpl`
 * (`"redirect"` for a 3xx, `` "http-<status>" `` for other non-2xx,
 * `"timeout"` for an abort, `"network"` for any other failure); the
 * response is parsed and validated per question, with `"malformed-response"`
 * for a question whose answer fails validation (or the whole response) and
 * that question keeping its heuristic answer. `backend` is `"jev"` once at
 * least one answer was accepted, else `"heuristic"`. `decide()` never
 * throws and never lets the API key or raw error text reach the result, the
 * log, or the request body. Every decline is logged via
 * `log("jev-declined", ...)`; a call with at least one accepted answer is
 * logged via `log("jev-queried", ...)` instead, both with the consumer,
 * question count, backend, redactions, duration, and configured thresholds.
 */
export async function decide(
  state: string,
  questions: QuestionMap,
  deps: DecideDeps = {},
): Promise<DecisionResult> {
  const config = deps.config ?? readJevConfig();
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const ctx: DecideContext = {
    state,
    questions,
    config,
    consumer: deps.consumer ?? "unknown",
    log: deps.log ?? defaultLogger,
    start: now(),
    now,
  };

  if (config.enabled !== true) return declineResult(ctx, "disabled");
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey) return declineResult(ctx, "no-key");

  const prepared = prepareRequest(state, questions, config, deps);
  if ("refused" in prepared) {
    return declineResult(ctx, prepared.refused, prepared.redactions);
  }
  const redactions = prepared.redactions;

  const posted = await postToJev(prepared.body, apiKey, config, deps.fetchImpl);
  if ("refused" in posted)
    return declineResult(ctx, posted.refused, redactions);

  const parsed = await readAnswersDocument(posted.response);
  if (parsed === null) {
    return declineResult(ctx, "malformed-response", redactions);
  }

  const graded = gradeAnswers(state, questions, parsed.rawAnswers);
  if (!graded.anyAccepted) {
    return declineResult(ctx, "malformed-response", redactions);
  }

  return acceptedResult(ctx, graded, parsed.doc, redactions);
}
