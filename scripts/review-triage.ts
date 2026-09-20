#!/usr/bin/env node
// scripts/review-triage.ts — offline (heuristic) adversarial-review triage.
//
// This task (T184) reads the three raw adversarial-reviewer reports for a
// feature, parses their one-line findings, flags likely duplicates and
// out-of-scope findings with simple deterministic rules, and writes an
// advisory JSON plus a markdown table. It calls `decide()` from
// `scripts/lib/decide.ts` only to learn which backend answered (always
// "heuristic" until a later task, T185, fills in the network branch of
// `decide()` itself) — nothing here does I/O beyond the three report files,
// the changed-files list, and the one JSON file it writes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, readJevConfig, type JevConfig } from "./lib/decide.ts";

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

/**
 * Runs the full offline triage for the feature at `specDir`: reads
 * `<specDir>/review-raw/{architecture,security,tests}.md` (a missing file
 * contributes zero findings and a stderr warning) and the changed-files
 * list at `changedFilesPath` (one path per line, blank lines ignored,
 * trimmed), computes heuristic candidates and applies them, calls
 * `decide()` only to learn `backend`/`declined` for the JSON header, writes
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

  let changedFiles: string[] = [];
  if (existsSync(changedFilesPath)) {
    changedFiles = readFileSync(changedFilesPath, "utf-8")
      .split(/\r\n|\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  const candidates = heuristicCandidates(allFindings, changedFiles);
  const triaged = applyHeuristic(allFindings, candidates);

  const decision = await decide(
    "",
    {},
    {
      consumer: "review-triage",
      config: opts.config ?? readJevConfig(),
      env: opts.env,
      log: opts.log,
    },
  );

  const json = {
    feature: basename(specDir),
    advisory: true,
    backend: decision.backend,
    declined: decision.declined,
    redactions: 0,
    findings: triaged,
  };

  writeFileSync(
    resolve(specDir, "review-triage.json"),
    JSON.stringify(json, null, 2) + "\n",
    "utf-8",
  );

  return { json, table: renderTable(triaged) };
}

/**
 * Minimal CLI arg parser for `<spec-dir> --changed-files <path>
 * [--json-only]`. `unknown` captures the first unrecognized `--flag` seen,
 * for the usage-and-exit path.
 */
function parseCliArgs(argv: string[]): {
  specDir?: string;
  changedFiles?: string;
  jsonOnly: boolean;
  unknown: string | null;
} {
  const positionals: string[] = [];
  let changedFiles: string | undefined;
  let jsonOnly = false;
  let unknown: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--changed-files") {
      changedFiles = argv[i + 1];
      i++;
    } else if (a === "--json-only") {
      jsonOnly = true;
    } else if (a.startsWith("--")) {
      unknown = unknown ?? a;
    } else {
      positionals.push(a);
    }
  }

  return { specDir: positionals[0], changedFiles, jsonOnly, unknown };
}

/** Prints the one-line usage message to stderr and exits with status 2. */
function usageAndExit(): never {
  process.stderr.write(
    "usage: node scripts/review-triage.ts <spec-dir> --changed-files <path> [--json-only]\n",
  );
  process.exit(2);
}

/**
 * CLI entry point. Prints the markdown table to stdout unless
 * `--json-only` is given. Exits 0 on success, 2 with a usage message for a
 * missing or unknown argument.
 */
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.unknown || !args.specDir || !args.changedFiles) usageAndExit();

  const { table } = await runTriage(
    resolve(args.specDir),
    resolve(args.changedFiles),
    { jsonOnly: args.jsonOnly },
  );

  if (!args.jsonOnly) process.stdout.write(table + "\n");
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  main();
}
