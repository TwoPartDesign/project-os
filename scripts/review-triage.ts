#!/usr/bin/env node
// scripts/review-triage.ts — offline (heuristic) adversarial-review triage,
// with an online Jev calibration path.
//
// T184 reads the three raw adversarial-reviewer reports for a feature,
// parses their one-line findings, and flags likely duplicates and
// out-of-scope findings with simple deterministic rules ("the heuristic
// backend"). T186 adds the Jev path on top: `buildQuestions` turns findings
// into `decide()` questions chunked to stay under the request-size limit,
// `applyAnswers` applies Jev's answers above configured thresholds on top of
// the heuristic rows, `liftSummary` measures how much Jev changed versus the
// heuristic, and the local `review-triage.json` output is scrubbed through
// the same egress guard `decide()` uses before it ever touches disk.
// `--calibrate` prints Jev's raw (un-thresholded) answers next to the
// heuristic's for manual threshold tuning, without writing the advisory
// output.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, posix } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decide,
  readJevConfig,
  defaultLogger,
  type JevConfig,
  type QuestionMap,
  type Question,
  type NoulQuestion,
  type ChoiceQuestion,
  type ScoreQuestion,
  type Answer,
  type NoulAnswer,
  type DecisionResult,
} from "./lib/decide.ts";
import { guardEgressFields } from "./lib/egress-guard.ts";
import { getProjectRoot } from "./lib/project-root.ts";

/** The four severities a finding line may carry. */
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** One parsed finding line from a reviewer's raw report. */
export type Finding = {
  id: string;
  reviewer: string;
  severity: Severity;
  file: string;
  lines: string;
  issue: string;
  fix: string;
};

/** Heuristic duplicate-candidate pairs and per-finding in-scope guesses. */
export type Candidates = {
  pairs: [string, string][];
  scope: Record<string, "in_diff" | "adjacent" | "unrelated">;
};

/** A `Finding` with the heuristic (or, in a later task, Jev) triage answers applied. */
export type TriagedFinding = Finding & {
  duplicate_of: string | null;
  duplicate_p: number;
  in_scope: "in_diff" | "adjacent" | "unrelated";
  in_scope_p: number;
  calibrated_severity: Severity;
  severity_confidence: number;
};

/** Reviewer report basenames, read in this fixed order, in `<specDir>/review-raw/`. */
const REVIEWERS = ["architecture", "security", "tests"] as const;

/** The literal separator a finding line's fields are split on. */
const SEP = " / ";

/** Matches a finding line's leading `SEVERITY / ` prefix. */
const SEVERITY_RE = /^(CRITICAL|HIGH|MEDIUM|LOW) \/ /;

/**
 * Splits a `file` or `file:lines` token into its `file` and `lines` parts.
 * Splits at the LAST `:`; if there is no `:`, or the part after it is not a
 * bare `N` or a range `N-M`, the whole token is `file` and `lines` is `""`.
 */
function splitFileLines(token: string): { file: string; lines: string } {
  const idx = token.lastIndexOf(":");
  if (idx === -1) return { file: token, lines: "" };
  const maybeLines = token.slice(idx + 1);
  if (/^\d+(-\d+)?$/.test(maybeLines)) {
    return { file: token.slice(0, idx), lines: maybeLines };
  }
  return { file: token, lines: "" };
}

/**
 * Parses `text` (one reviewer's raw report) into `Finding`s. A line counts
 * as a finding only when it starts with `CRITICAL`, `HIGH`, `MEDIUM`, or
 * `LOW` followed by ` / `. Fields one (severity) and two (`file:lines`) are
 * taken at the first two ` / ` separators; the remainder is split at its
 * LAST ` / ` into ISSUE and FIX, so a ` / ` inside ISSUE is preserved and a
 * ` / ` inside FIX is mis-split (the accepted ambiguity of the format). A
 * severity-prefixed line that does not yield four parts is skipped and
 * reported to `warn`. `id` is `<reviewer>-<1-based index among this
 * reviewer's parsed findings>`.
 */
export function parseFindings(
  text: string,
  reviewer: string,
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r\n|\n/);

  for (const line of lines) {
    if (!SEVERITY_RE.test(line)) continue;

    const firstSepIdx = line.indexOf(SEP);
    const afterFirst = line.slice(firstSepIdx + SEP.length);
    const secondSepIdx = afterFirst.indexOf(SEP);
    if (secondSepIdx === -1) {
      warn(`review-triage: unparseable finding line: ${line}\n`);
      continue;
    }

    const fileLinesToken = afterFirst.slice(0, secondSepIdx);
    const remainder = afterFirst.slice(secondSepIdx + SEP.length);
    const lastSepIdx = remainder.lastIndexOf(SEP);
    if (lastSepIdx === -1) {
      warn(`review-triage: unparseable finding line: ${line}\n`);
      continue;
    }

    const issue = remainder.slice(0, lastSepIdx);
    const fix = remainder.slice(lastSepIdx + SEP.length);
    const { file, lines: lineRange } = splitFileLines(fileLinesToken);
    const severity = line.slice(0, firstSepIdx) as Severity;

    findings.push({
      id: `${reviewer}-${findings.length + 1}`,
      reviewer,
      severity,
      file,
      lines: lineRange,
      issue,
      fix,
    });
  }

  return findings;
}

/** Normalizes a file path for comparison: forward slashes, no leading `./`. */
function normalizeFile(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Parses a `lines` value (`""`, `"N"`, or `"N-M"`) into `[start, end]`, or `null` for "whole file". */
function parseLineRange(lines: string): [number, number] | null {
  if (!lines) return null;
  const m = /^(\d+)(?:-(\d+))?$/.exec(lines);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  return [start, end];
}

/** True if two line ranges overlap or touch (are adjacent by one line); `null` (whole file) overlaps everything. */
function overlapsOrTouches(
  a: [number, number] | null,
  b: [number, number] | null,
): boolean {
  if (a === null || b === null) return true;
  return a[0] <= b[1] + 1 && b[0] <= a[1] + 1;
}

/**
 * Tokenizes ISSUE text for Jaccard comparison: drops a leading
 * `DRIFT:`/`VULN:`/`ISSUE:` prefix, lowercases, splits on runs of
 * non-alphanumeric characters, and keeps tokens of length 3 or more.
 */
function tokenize(issue: string): Set<string> {
  const stripped = issue.replace(/^(DRIFT|VULN|ISSUE):\s*/, "");
  const tokens = stripped
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  return new Set(tokens);
}

/** Jaccard similarity of two token sets (intersection / union), 0 when both are empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Produces duplicate-candidate pairs and per-finding in-scope guesses.
 * A pair `[a.id, b.id]` (with `a.id < b.id` by string compare) is emitted
 * when either: the two findings' normalized files are equal and their line
 * ranges overlap or touch (an empty `lines` means "whole file", which
 * overlaps everything); or the token Jaccard similarity of their ISSUE
 * texts is at or above 0.6. Scope per finding is `in_diff` when its
 * normalized file is in `changedFiles`, else `adjacent` when any changed
 * file shares its directory, else `unrelated`.
 */
export function heuristicCandidates(
  findings: Finding[],
  changedFiles: string[],
): Candidates {
  const normChanged = changedFiles.map(normalizeFile);
  const changedSet = new Set(normChanged);
  const changedDirs = new Set(normChanged.map((f) => posix.dirname(f)));

  const tokensById = new Map<string, Set<string>>();
  for (const f of findings) tokensById.set(f.id, tokenize(f.issue));

  const pairs: [string, string][] = [];
  for (let i = 0; i < findings.length; i++) {
    for (let j = i + 1; j < findings.length; j++) {
      const a = findings[i];
      const b = findings[j];
      const sameFile = normalizeFile(a.file) === normalizeFile(b.file);
      const overlaps =
        sameFile &&
        overlapsOrTouches(parseLineRange(a.lines), parseLineRange(b.lines));
      const similar =
        jaccard(tokensById.get(a.id)!, tokensById.get(b.id)!) >= 0.6;
      if (overlaps || similar) {
        const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        pairs.push([lo, hi]);
      }
    }
  }

  const scope: Candidates["scope"] = {};
  for (const f of findings) {
    const nf = normalizeFile(f.file);
    if (changedSet.has(nf)) scope[f.id] = "in_diff";
    else if (changedDirs.has(posix.dirname(nf))) scope[f.id] = "adjacent";
    else scope[f.id] = "unrelated";
  }

  return { pairs, scope };
}

/**
 * Applies `Candidates` to `findings`, producing `TriagedFinding`s. For each
 * pair, the higher id's `duplicate_of` becomes the lowest partner id it was
 * paired with (a lower id in every pair it appears in keeps `null`);
 * `duplicate_p` is 1 when paired, else 0. `in_scope` comes from
 * `c.scope` (defaulting to `"unrelated"`), with `in_scope_p` always 1.
 * `calibrated_severity` passes through `severity` unchanged, with
 * `severity_confidence` always 0 — this is the heuristic backend; a later
 * task's Jev backend produces calibrated answers instead.
 */
export function applyHeuristic(
  findings: Finding[],
  c: Candidates,
): TriagedFinding[] {
  const duplicateOf = new Map<string, string>();
  for (const [lo, hi] of c.pairs) {
    const existing = duplicateOf.get(hi);
    if (existing === undefined || lo < existing) duplicateOf.set(hi, lo);
  }

  return findings.map((f) => ({
    ...f,
    duplicate_of: duplicateOf.get(f.id) ?? null,
    duplicate_p: duplicateOf.has(f.id) ? 1 : 0,
    in_scope: c.scope[f.id] ?? "unrelated",
    in_scope_p: 1,
    calibrated_severity: f.severity,
    severity_confidence: 0,
  }));
}

/**
 * Extracts the six triage-relevant fields from a `Finding`. This is the
 * only accessor {@link buildQuestions} uses on a finding, so an extra
 * property a `Finding` object happens to carry (e.g. internal metadata)
 * never reaches the outbound Jev text.
 */
function pick(
  f: Finding,
): Pick<Finding, "severity" | "reviewer" | "file" | "lines" | "issue" | "fix"> {
  return {
    severity: f.severity,
    reviewer: f.reviewer,
    file: f.file,
    lines: f.lines,
    issue: f.issue,
    fix: f.fix,
  };
}

/** Renders one `Finding <id>:` block for the Jev state text, from `pick()`'s six fields only. */
function findingBlock(f: Finding): string {
  const p = pick(f);
  return [
    `Finding ${f.id}:`,
    `severity: ${p.severity}`,
    `reviewer: ${p.reviewer}`,
    `file: ${p.file}`,
    `lines: ${p.lines}`,
    `issue: ${p.issue}`,
    `fix: ${p.fix}`,
  ].join("\n");
}

/** Renders the `Changed files:` header shared by every chunk's state. */
function changedFilesHeader(changedFiles: string[]): string {
  return ["Changed files:", ...changedFiles].join("\n");
}

/** The `scope_<id>` choice question asked about one finding's id. */
function scopeQuestion(id: string): ChoiceQuestion {
  return {
    type: "choice",
    instructions: `Classify finding ${id}'s file relative to the changed-files list above: in the diff, adjacent to it, or unrelated.`,
    criteria: {
      in_diff: "The finding's file appears in the changed-files list.",
      adjacent:
        "The finding's file is not itself changed, but a sibling file in the same directory is.",
      unrelated:
        "Neither the finding's file nor a sibling in its directory appears in the changed-files list.",
    },
  };
}

/** The `sev_<id>` score question asked about one finding's id. */
function severityQuestion(id: string): ScoreQuestion {
  return {
    type: "score",
    instructions: `Rate the true severity of finding ${id}, from LOW to CRITICAL.`,
    criteria: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  };
}

/** The `dup_<a>__<b>` noul question asked about a candidate duplicate pair. */
function dupQuestion(a: string, b: string): NoulQuestion {
  return {
    type: "noul",
    instructions: `Findings ${a} and ${b} report the same defect`,
    criteria: {
      true: "Same defect, same location or same root cause",
      false: "Different defects",
    },
  };
}

/** The serialized-size budget a single packed chunk is filled to, leaving headroom below `CHUNK_SIZE_LIMIT` for a duplicate pair's cross-chunk finding block. */
const CHUNK_PACK_LIMIT = 150000;

/** The hard limit a chunk's `JSON.stringify` length must never exceed. */
const CHUNK_SIZE_LIMIT = 160000;

/**
 * Builds one or more `{ state, questions }` chunks to pass to `decide()`,
 * one call per chunk. `state` is a `Changed files:` list followed by one
 * `Finding <id>:` block per finding included in that chunk (built via
 * {@link pick} only). Findings are visited once, in array order; each
 * visit adds that finding's own `scope_<id>`/`sev_<id>` questions, plus a
 * `dup_<id>__<hi>` question for every candidate pair where this finding is
 * the lower id, pulling `hi`'s block into the same chunk if it is not
 * there yet (a Jev question comparing two findings needs both in the
 * state) — the whole addition, block and questions together, is what is
 * checked against the size budget, so a pair entirely inside one chunk
 * cannot silently balloon it. The addition goes to the current chunk when
 * `JSON.stringify({ state, questions }).length` would stay at or under
 * {@link CHUNK_PACK_LIMIT} (a margin below the real {@link CHUNK_SIZE_LIMIT}
 * left for whatever the next finding's own pair pulls in); otherwise the
 * current chunk is closed and a new one started with this finding alone.
 */
export function buildQuestions(
  findings: Finding[],
  c: Candidates,
  changedFiles: string[],
): { state: string; questions: QuestionMap }[] {
  const header = changedFilesHeader(changedFiles);
  const byId = new Map(findings.map((f) => [f.id, f]));

  const pairsByLo = new Map<string, string[]>();
  for (const [lo, hi] of c.pairs) {
    const list = pairsByLo.get(lo);
    if (list) list.push(hi);
    else pairsByLo.set(lo, [hi]);
  }

  type Working = { ids: string[]; questions: QuestionMap };
  const chunks: Working[] = [];

  const renderState = (ids: string[]): string =>
    [header, ...ids.map((id) => findingBlock(byId.get(id)!))].join("\n\n");

  const serializedSize = (ids: string[], questions: QuestionMap): number =>
    JSON.stringify({ state: renderState(ids), questions }).length;

  for (const f of findings) {
    const hiPartners = (pairsByLo.get(f.id) ?? []).filter((hi) => byId.has(hi));
    const current = chunks[chunks.length - 1];

    if (current) {
      const newIds = [
        ...(current.ids.includes(f.id) ? [] : [f.id]),
        ...hiPartners.filter((hi) => hi !== f.id && !current.ids.includes(hi)),
      ];
      const candidateIds = [...current.ids, ...newIds];
      const candidateQuestions: QuestionMap = {
        ...current.questions,
        [`scope_${f.id}`]: scopeQuestion(f.id),
        [`sev_${f.id}`]: severityQuestion(f.id),
      };
      for (const hi of hiPartners) {
        candidateQuestions[`dup_${f.id}__${hi}`] = dupQuestion(f.id, hi);
      }
      if (
        serializedSize(candidateIds, candidateQuestions) <= CHUNK_PACK_LIMIT
      ) {
        current.ids = candidateIds;
        current.questions = candidateQuestions;
        continue;
      }
    }

    const ids = [f.id, ...hiPartners.filter((hi) => hi !== f.id)];
    const questions: QuestionMap = {
      [`scope_${f.id}`]: scopeQuestion(f.id),
      [`sev_${f.id}`]: severityQuestion(f.id),
    };
    for (const hi of hiPartners) {
      questions[`dup_${f.id}__${hi}`] = dupQuestion(f.id, hi);
    }
    chunks.push({ ids, questions });
  }

  return chunks.map((chunk) => ({
    state: renderState(chunk.ids),
    questions: chunk.questions,
  }));
}

/** The four calibrated-severity levels, in ascending order, indexed 0..3. */
const SEVERITY_LEVELS: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * Maps a raw Jev `score` (a float over the `sev_<id>` criteria indices) to
 * a level index in `[0, 3]`: `Math.round(score - 0.5 + Number.EPSILON)`,
 * clamped. Subtracting 0.5 before rounding makes an exact half (e.g. `1.5`)
 * round down to the lower level instead of up.
 */
function scoreToLevel(score: number): number {
  return Math.min(3, Math.max(0, Math.round(score - 0.5 + Number.EPSILON)));
}

/**
 * Applies one or more `decide()` results (one per {@link buildQuestions}
 * chunk, merged by question name) on top of {@link applyHeuristic}'s rows.
 * For each candidate pair, a `dup_<lo>__<hi>` noul answer at or above
 * `thresholds.duplicate_p` sets `hi.duplicate_of = lo`; below it, clears
 * any heuristic pairing (`duplicate_of = null`); `duplicate_p` is always
 * set to the noul value. A `scope_<id>` choice answer of `unrelated` is
 * only applied when `probabilities.unrelated >= thresholds.out_of_scope_p`
 * (otherwise the heuristic scope is kept); any other choice is always
 * applied; `in_scope_p` is always set to `probabilities[choice]`. A
 * `sev_<id>` score answer is mapped to a level via {@link scoreToLevel} and
 * only replaces `calibrated_severity` when `confidence >=
 * thresholds.severity_confidence`; `severity_confidence` is always set to
 * the answer's confidence. If every result's `backend` is `"heuristic"`,
 * the heuristic rows are returned unchanged (T184 already set them
 * correctly, and there is nothing Jev-derived to apply).
 */
export function applyAnswers(
  findings: Finding[],
  c: Candidates,
  results: DecisionResult[],
  thresholds: JevConfig["thresholds"],
): TriagedFinding[] {
  const rows = applyHeuristic(findings, c);
  if (results.length === 0 || results.every((r) => r.backend === "heuristic")) {
    return rows;
  }

  const answers: Record<string, Answer> = {};
  for (const r of results) Object.assign(answers, r.answers);

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const [lo, hi] of c.pairs) {
    const answer = answers[`dup_${lo}__${hi}`];
    if (!answer || answer.type !== "noul") continue;
    const hiRow = byId.get(hi);
    if (!hiRow) continue;
    hiRow.duplicate_of = answer.noul >= thresholds.duplicate_p ? lo : null;
    hiRow.duplicate_p = answer.noul;
  }

  for (const row of rows) {
    const answer = answers[`scope_${row.id}`];
    if (!answer || answer.type !== "choice") continue;
    const choice = answer.choice as "in_diff" | "adjacent" | "unrelated";
    if (choice !== "unrelated") {
      row.in_scope = choice;
    } else if (
      (answer.probabilities.unrelated ?? 0) >= thresholds.out_of_scope_p
    ) {
      row.in_scope = "unrelated";
    }
    row.in_scope_p = answer.probabilities[choice] ?? row.in_scope_p;
  }

  for (const row of rows) {
    const answer = answers[`sev_${row.id}`];
    if (!answer || answer.type !== "score") continue;
    if (answer.confidence >= thresholds.severity_confidence) {
      row.calibrated_severity = SEVERITY_LEVELS[scoreToLevel(answer.score)];
    }
    row.severity_confidence = answer.confidence;
  }

  return rows;
}

/**
 * Compares `rows` (typically {@link applyAnswers}'s output) against
 * `heuristic` (typically {@link applyHeuristic}'s output for the same
 * findings and candidates) and summarizes how much Jev changed. `dup_pairs`
 * counts the heuristic rows that were paired as a duplicate (`duplicate_of
 * !== null`) — the count of candidate pairs the heuristic actually merged.
 * `dup_changed`, `scope_changed`, and `severity_changed` count rows (by
 * matching `id`) whose `duplicate_of`, `in_scope`, or `calibrated_severity`
 * differ between `rows` and `heuristic`.
 */
export function liftSummary(
  rows: TriagedFinding[],
  heuristic: TriagedFinding[],
): {
  dup_pairs: number;
  dup_changed: number;
  scope_changed: number;
  severity_changed: number;
} {
  const heuristicById = new Map(heuristic.map((r) => [r.id, r]));

  let dup_pairs = 0;
  for (const h of heuristic) if (h.duplicate_of !== null) dup_pairs++;

  let dup_changed = 0;
  let scope_changed = 0;
  let severity_changed = 0;
  for (const row of rows) {
    const h = heuristicById.get(row.id);
    if (!h) continue;
    if (row.duplicate_of !== h.duplicate_of) dup_changed++;
    if (row.in_scope !== h.in_scope) scope_changed++;
    if (row.calibrated_severity !== h.calibrated_severity) severity_changed++;
  }

  return { dup_pairs, dup_changed, scope_changed, severity_changed };
}

/** Escapes `|` as `\|` so a value is safe inside a markdown table cell. */
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/**
 * Renders `rows` as a markdown table: `id | sev | file:lines | scope | dup
 * of | issue`. Every cell escapes `|`. `dup of` is empty when
 * `duplicate_of` is `null`. `sev` shows `calibrated_severity`, appending
 * ` (was <severity>)` when calibration changed it.
 */
export function renderTable(rows: TriagedFinding[]): string {
  const header = "| id | sev | file:lines | scope | dup of | issue |";
  const separator = "|---|---|---|---|---|---|";

  const body = rows.map((r) => {
    const fileLines = r.lines ? `${r.file}:${r.lines}` : r.file;
    const sev =
      r.calibrated_severity === r.severity
        ? r.calibrated_severity
        : `${r.calibrated_severity} (was ${r.severity})`;
    const dupOf = r.duplicate_of ?? "";
    return `| ${escapeCell(r.id)} | ${escapeCell(sev)} | ${escapeCell(fileLines)} | ${escapeCell(r.in_scope)} | ${escapeCell(dupOf)} | ${escapeCell(r.issue)} |`;
  });

  return [header, separator, ...body].join("\n");
}

/** One row of the `--calibrate` table: a finding's raw, un-thresholded Jev answers next to its heuristic ones. */
type CalibrationRow = {
  id: string;
  heuristic_dup: string | null;
  jev_dup_p: number | null;
  heuristic_scope: "in_diff" | "adjacent" | "unrelated";
  jev_scope: string | null;
  jev_scope_p: number | null;
  severity: Severity;
  jev_severity: Severity | null;
  jev_conf: number | null;
};

/**
 * Builds one {@link CalibrationRow} per finding from the merged `decide()`
 * `answers` (raw, not threshold-applied) next to {@link applyHeuristic}'s
 * rows. A pair's `dup_<lo>__<hi>` answer is attributed to the higher-id
 * finding (`hi`), matching where `applyAnswers` would apply it.
 */
function buildCalibrationRows(
  findings: Finding[],
  heuristicRows: TriagedFinding[],
  answers: Record<string, Answer>,
  pairs: [string, string][],
): CalibrationRow[] {
  const heuristicById = new Map(heuristicRows.map((r) => [r.id, r]));
  const dupAnswerForHi = new Map<string, NoulAnswer>();
  for (const [lo, hi] of pairs) {
    const a = answers[`dup_${lo}__${hi}`];
    if (a && a.type === "noul") dupAnswerForHi.set(hi, a);
  }

  return findings.map((f) => {
    const h = heuristicById.get(f.id)!;
    const dupAnswer = dupAnswerForHi.get(f.id);
    const scopeAnswer = answers[`scope_${f.id}`];
    const sevAnswer = answers[`sev_${f.id}`];

    let jevScope: string | null = null;
    let jevScopeP: number | null = null;
    if (scopeAnswer && scopeAnswer.type === "choice") {
      jevScope = scopeAnswer.choice;
      jevScopeP = scopeAnswer.probabilities[scopeAnswer.choice] ?? null;
    }

    let jevSeverity: Severity | null = null;
    let jevConf: number | null = null;
    if (sevAnswer && sevAnswer.type === "score") {
      jevSeverity = SEVERITY_LEVELS[scoreToLevel(sevAnswer.score)];
      jevConf = sevAnswer.confidence;
    }

    return {
      id: f.id,
      heuristic_dup: h.duplicate_of,
      jev_dup_p: dupAnswer ? dupAnswer.noul : null,
      heuristic_scope: h.in_scope,
      jev_scope: jevScope,
      jev_scope_p: jevScopeP,
      severity: f.severity,
      jev_severity: jevSeverity,
      jev_conf: jevConf,
    };
  });
}

/**
 * Counts, per decision kind, how often the THRESHOLD-APPLIED Jev answer
 * agrees with the heuristic's own decision — the same comparison
 * `applyAnswers` would make, but computed here without mutating any rows.
 * `dup.total` is the pair count; `scope.total`/`severity.total` are the
 * finding count.
 */
function computeAgreement(
  rows: CalibrationRow[],
  pairs: [string, string][],
  thresholds: JevConfig["thresholds"],
): {
  dup: { agreed: number; total: number };
  scope: { agreed: number; total: number };
  severity: { agreed: number; total: number };
} {
  const byId = new Map(rows.map((r) => [r.id, r]));

  let dupAgreed = 0;
  for (const [, hi] of pairs) {
    const row = byId.get(hi);
    if (!row) continue;
    const wasDup = row.heuristic_dup !== null;
    const thresholdedDup =
      row.jev_dup_p !== null ? row.jev_dup_p >= thresholds.duplicate_p : wasDup;
    if (thresholdedDup === wasDup) dupAgreed++;
  }

  let scopeAgreed = 0;
  for (const row of rows) {
    let thresholded: string = row.heuristic_scope;
    if (row.jev_scope !== null) {
      if (row.jev_scope === "unrelated") {
        thresholded =
          (row.jev_scope_p ?? 0) >= thresholds.out_of_scope_p
            ? "unrelated"
            : row.heuristic_scope;
      } else {
        thresholded = row.jev_scope;
      }
    }
    if (thresholded === row.heuristic_scope) scopeAgreed++;
  }

  let severityAgreed = 0;
  for (const row of rows) {
    let thresholded: Severity = row.severity;
    if (
      row.jev_severity !== null &&
      (row.jev_conf ?? 0) >= thresholds.severity_confidence
    ) {
      thresholded = row.jev_severity;
    }
    if (thresholded === row.severity) severityAgreed++;
  }

  return {
    dup: { agreed: dupAgreed, total: pairs.length },
    scope: { agreed: scopeAgreed, total: rows.length },
    severity: { agreed: severityAgreed, total: rows.length },
  };
}

/** Renders the `--calibrate` table: `id`, `heuristic dup`, `jev dup p`, `heuristic scope`, `jev scope`, `jev scope p`, `severity`, `jev severity`, `jev conf`. */
function renderCalibrationTable(rows: CalibrationRow[]): string {
  const header =
    "| id | heuristic dup | jev dup p | heuristic scope | jev scope | jev scope p | severity | jev severity | jev conf |";
  const separator = "|---|---|---|---|---|---|---|---|---|";

  const body = rows.map((r) => {
    const dupOf = r.heuristic_dup ?? "";
    const dupP = r.jev_dup_p !== null ? r.jev_dup_p.toFixed(2) : "";
    const jevScope = r.jev_scope ?? "";
    const jevScopeP = r.jev_scope_p !== null ? r.jev_scope_p.toFixed(2) : "";
    const jevSev = r.jev_severity ?? "";
    const jevConf = r.jev_conf !== null ? r.jev_conf.toFixed(2) : "";
    return `| ${r.id} | ${dupOf} | ${dupP} | ${r.heuristic_scope} | ${jevScope} | ${jevScopeP} | ${r.severity} | ${jevSev} | ${jevConf} |`;
  });

  return [header, separator, ...body].join("\n");
}

/** Renders the `--calibrate` summary block: finding/pair counts and each agreement rate as `agreed/total`. */
function renderCalibrationSummary(
  findingsCount: number,
  pairsCount: number,
  agreement: ReturnType<typeof computeAgreement>,
): string {
  return [
    `findings: ${findingsCount}`,
    `pairs: ${pairsCount}`,
    `dup agreement: ${agreement.dup.agreed}/${agreement.dup.total}`,
    `scope agreement: ${agreement.scope.agreed}/${agreement.scope.total}`,
    `severity agreement: ${agreement.severity.agreed}/${agreement.severity.total}`,
  ].join("\n");
}

/**
 * Runs the full triage for the feature at `specDir`: reads
 * `<specDir>/review-raw/{architecture,security,tests}.md` (a missing file
 * contributes zero findings and a stderr warning) plus any `extraReviews`
 * paths (parsed with `parseFindings(text, "mixed")`, for `--calibrate`) and
 * the changed-files list at `changedFilesPath` (one path per line, blank
 * lines ignored, trimmed); computes heuristic candidates; builds Jev
 * questions via {@link buildQuestions} and calls `decide()` once per chunk
 * with `consumer: "review-triage"`, threading `fetchImpl`/`scrubCmd`/
 * `scanCmd`/`egressDir`/`log`/`config`/`env` from `opts` into every call;
 * applies the merged answers via {@link applyAnswers}.
 *
 * With `opts.calibrate`, thresholds are still used only to compute the
 * agreement summary (never to change any row): prints the calibration
 * table and summary to stdout, writes
 * `<specDir>/review-triage-calibration.json`, does NOT write
 * `review-triage.json`, and returns `{ json: <calibration object>, table:
 * <the printed text> }`.
 *
 * Otherwise: scrubs every row's `issue` and `fix` through
 * `guardEgressFields` (one call across every row's fields) before they
 * ever reach disk — a refusal writes `"[WITHHELD:scrub-failed]"` for both
 * fields on every row instead; the header's `redactions` sums the guard's
 * count and every chunk's `decide()` redaction count. Computes
 * {@link liftSummary} against the heuristic rows and records it as the
 * header's `lift` (`null` when no chunk reached the Jev backend). Logs one
 * `review-triaged` event via `opts.log ?? defaultLogger`, writes
 * `<specDir>/review-triage.json`, and returns the JSON object and the
 * rendered markdown table.
 */
export async function runTriage(
  specDir: string,
  changedFilesPath: string,
  opts: {
    jsonOnly?: boolean;
    config?: JevConfig;
    env?: Record<string, string | undefined>;
    log?: (e: string, kv: Record<string, string>) => void;
    fetchImpl?: typeof fetch;
    scrubCmd?: (file: string) => { status: number };
    scanCmd?: (file: string) => { status: number };
    egressDir?: string;
    projectRoot?: string;
    calibrate?: boolean;
    extraReviews?: string[];
  } = {},
): Promise<{ json: object; table: string }> {
  const allFindings: Finding[] = [];
  for (const reviewer of REVIEWERS) {
    const path = resolve(specDir, "review-raw", `${reviewer}.md`);
    if (!existsSync(path)) {
      process.stderr.write(`review-triage: missing ${path}\n`);
      continue;
    }
    const text = readFileSync(path, "utf-8");
    allFindings.push(...parseFindings(text, reviewer));
  }

  const extraReviews = opts.extraReviews ?? [];
  for (const reviewPath of extraReviews) {
    const text = readFileSync(reviewPath, "utf-8");
    allFindings.push(...parseFindings(text, "mixed"));
  }

  let changedFiles: string[] = [];
  if (existsSync(changedFilesPath)) {
    changedFiles = readFileSync(changedFilesPath, "utf-8")
      .split(/\r\n|\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  const candidates = heuristicCandidates(allFindings, changedFiles);
  const heuristicRows = applyHeuristic(allFindings, candidates);
  const config = opts.config ?? readJevConfig();
  const log = opts.log ?? defaultLogger;

  const chunks = buildQuestions(allFindings, candidates, changedFiles);
  const results: DecisionResult[] = [];
  for (const chunk of chunks) {
    results.push(
      await decide(chunk.state, chunk.questions, {
        consumer: "review-triage",
        config,
        env: opts.env,
        log: opts.log,
        fetchImpl: opts.fetchImpl,
        scrubCmd: opts.scrubCmd,
        scanCmd: opts.scanCmd,
        egressDir: opts.egressDir,
      }),
    );
  }

  const backend: "heuristic" | "jev" = results.some((r) => r.backend === "jev")
    ? "jev"
    : "heuristic";
  const declined = backend === "heuristic" ? results[0]?.declined : undefined;
  const decideRedactions = results.reduce((sum, r) => sum + r.redactions, 0);

  if (opts.calibrate) {
    const answers: Record<string, Answer> = {};
    for (const r of results) Object.assign(answers, r.answers);

    const calRows = buildCalibrationRows(
      allFindings,
      heuristicRows,
      answers,
      candidates.pairs,
    );
    const agreement = computeAgreement(
      calRows,
      candidates.pairs,
      config.thresholds,
    );
    const table = renderCalibrationTable(calRows);
    const summary = renderCalibrationSummary(
      allFindings.length,
      candidates.pairs.length,
      agreement,
    );
    const text = table + "\n\n" + summary;

    const calibrationJson = {
      generated_at: new Date().toISOString(),
      backend,
      sources: extraReviews.length > 0 ? extraReviews : ["review-raw"],
      findings: allFindings.length,
      pairs: candidates.pairs.length,
      agreement,
      thresholds: config.thresholds,
      rows: calRows,
    };

    writeFileSync(
      resolve(specDir, "review-triage-calibration.json"),
      JSON.stringify(calibrationJson, null, 2) + "\n",
      "utf-8",
    );

    process.stdout.write(text + "\n");
    return { json: calibrationJson, table: text };
  }

  const triaged =
    results.length > 0
      ? applyAnswers(allFindings, candidates, results, config.thresholds)
      : heuristicRows;
  const lift = backend === "jev" ? liftSummary(triaged, heuristicRows) : null;

  const projectRoot = opts.projectRoot ?? getProjectRoot();
  const outboundFields: string[] = [];
  for (const row of triaged) outboundFields.push(row.issue, row.fix);

  let outputRedactions = 0;
  let scrubbedRows = triaged;
  if (outboundFields.length > 0) {
    const guarded = guardEgressFields(outboundFields, {
      projectRoot,
      egressDir: opts.egressDir,
      scrubCmd: opts.scrubCmd,
      scanCmd: opts.scanCmd,
    });
    if ("refused" in guarded) {
      outputRedactions = outboundFields.length;
      scrubbedRows = triaged.map((row) => ({
        ...row,
        issue: "[WITHHELD:scrub-failed]",
        fix: "[WITHHELD:scrub-failed]",
      }));
    } else {
      // `guarded.redactions` only counts guardEgressFields's own final
      // pure-regex pass (redactSensitivePairs + redactHighEntropyTokens);
      // a secret the external scanner subprocess already scrubbed in
      // place (e.g. a `ghp_...` token, replaced with its own
      // `[REDACTED:<rule>]` marker before that pass ever runs) never
      // shows up in that count. Comparing before/after per field instead
      // counts every field genuinely changed, by either step.
      for (let i = 0; i < outboundFields.length; i++) {
        if (guarded.fields[i] !== outboundFields[i]) outputRedactions++;
      }
      scrubbedRows = triaged.map((row, i) => ({
        ...row,
        issue: guarded.fields[i * 2],
        fix: guarded.fields[i * 2 + 1],
      }));
    }
  }

  const totalRedactions = decideRedactions + outputRedactions;

  log("review-triaged", {
    feature: basename(specDir),
    backend,
    findings: String(allFindings.length),
    dup_pairs: String(candidates.pairs.length),
    dup_changed: String(lift?.dup_changed ?? 0),
    scope_changed: String(lift?.scope_changed ?? 0),
    severity_changed: String(lift?.severity_changed ?? 0),
    redactions: String(totalRedactions),
  });

  const json = {
    feature: basename(specDir),
    advisory: true,
    backend,
    declined,
    redactions: totalRedactions,
    lift,
    findings: scrubbedRows,
  };

  writeFileSync(
    resolve(specDir, "review-triage.json"),
    JSON.stringify(json, null, 2) + "\n",
    "utf-8",
  );

  return { json, table: renderTable(scrubbedRows) };
}

/**
 * Minimal CLI arg parser for `<spec-dir> --changed-files <path>
 * [--json-only] [--calibrate [<review-md>...]]`. `unknown` captures the
 * first unrecognized `--flag` seen, for the usage-and-exit path.
 * Positionals after the first (`specDir`) are collected as `reviewMdPaths`,
 * meaningful only with `--calibrate`.
 */
function parseCliArgs(argv: string[]): {
  specDir?: string;
  changedFiles?: string;
  jsonOnly: boolean;
  calibrate: boolean;
  reviewMdPaths: string[];
  unknown: string | null;
} {
  const positionals: string[] = [];
  let changedFiles: string | undefined;
  let jsonOnly = false;
  let calibrate = false;
  let unknown: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--changed-files") {
      changedFiles = argv[i + 1];
      i++;
    } else if (a === "--json-only") {
      jsonOnly = true;
    } else if (a === "--calibrate") {
      calibrate = true;
    } else if (a.startsWith("--")) {
      unknown = unknown ?? a;
    } else {
      positionals.push(a);
    }
  }

  return {
    specDir: positionals[0],
    changedFiles,
    jsonOnly,
    calibrate,
    reviewMdPaths: positionals.slice(1),
    unknown,
  };
}

/** Prints the one-line usage message to stderr and exits with status 2. */
function usageAndExit(): never {
  process.stderr.write(
    "usage: node scripts/review-triage.ts <spec-dir> --changed-files <path> [--json-only] [--calibrate [<review-md>...]]\n",
  );
  process.exit(2);
}

/**
 * CLI entry point. Prints the markdown table to stdout unless
 * `--json-only` is given (calibration output always prints). Exits 0 on
 * success, 2 with a usage message for a missing or unknown argument.
 */
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.unknown || !args.specDir || !args.changedFiles) usageAndExit();

  const { table } = await runTriage(
    resolve(args.specDir),
    resolve(args.changedFiles),
    {
      jsonOnly: args.jsonOnly,
      calibrate: args.calibrate,
      extraReviews: args.reviewMdPaths.map((p) => resolve(p)),
    },
  );

  if (args.calibrate || !args.jsonOnly) process.stdout.write(table + "\n");
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  main();
}
