// scripts/lib/decide.ts — typed decision interface for the Jev integration.
//
// This task (T179) ships the core: types, config reading, a deterministic
// heuristic backend, and a `decide()` skeleton that always returns the
// heuristic answer with a `declined` reason. There is NO network code here —
// a later task (T185, marked inline below) replaces the final branch of
// `decide()` with an actual call to the Jev backend over `fetchImpl`.
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
        typeof jev.model === "string" && jev.model.length > 0
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
 * Answers `questions` against `state`. In this task, always resolves via the
 * heuristic backend: `decide()` calls the real Jev backend only once a later
 * task (T185) fills in the network branch below. Resolution order: if
 * `config.enabled` is not strictly `true`, declines `"disabled"`; else if
 * `env.TYPESAFE_API_KEY` is unset, declines `"no-key"`; else (this task)
 * declines `"network"` as a placeholder for the not-yet-implemented Jev
 * call. Every decline is logged via `log("jev-declined", ...)` with the
 * consumer, reason, and configured thresholds. `redactions` is always 0 and
 * `backend` is always `"heuristic"` in this task, since no network path
 * exists yet.
 */
export async function decide(
  state: string,
  questions: QuestionMap,
  deps: DecideDeps = {},
): Promise<DecisionResult> {
  const config = deps.config ?? readJevConfig();
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const consumer = deps.consumer ?? "unknown";
  const log = deps.log ?? defaultLogger;

  const start = now();

  const declineWith = (reason: DeclineReason): DecisionResult => {
    log("jev-declined", {
      consumer,
      reason,
      threshold_duplicate_p: String(config.thresholds.duplicate_p),
      threshold_out_of_scope_p: String(config.thresholds.out_of_scope_p),
      threshold_severity_confidence: String(
        config.thresholds.severity_confidence,
      ),
    });
    return {
      answers: heuristicBackend(state, questions),
      backend: "heuristic",
      declined: reason,
      redactions: 0,
      duration_ms: now() - start,
    };
  };

  if (config.enabled !== true) return declineWith("disabled");
  if (!env.TYPESAFE_API_KEY) return declineWith("no-key");

  // T185: Jev path
  return declineWith("network");
}
