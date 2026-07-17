#!/usr/bin/env node
// scripts/maintain-draft.ts — Governed ROADMAP draft-filing CLI.
//
// This is the ONLY writer through which an autonomous maintenance loop
// (scripts/maintain.sh) may touch ROADMAP.md. It appends a single `[?]`
// draft task to a dedicated "maintenance-inbox" feature section. It never
// promotes a task, never edits an existing line, and never calls git.
//
// Usage:
//   node scripts/maintain-draft.ts --title "<t>" --fingerprint "<fp>" \
//     [--body "<extra comment line>"] [--roadmap <path>] [--validate-cmd "<cmd>"]
//
// Exit codes:
//   0  filed successfully — prints "filed: #T<N>"
//   1  empty title after sanitation, or validation failed (ROADMAP restored)
//   2  duplicate fingerprint — prints "duplicate: <fp>", nothing written

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseRoadmap } from "./lib/dashboard-render.ts";

/** Heading that identifies the autonomous-drafts feature section. */
const MAINTENANCE_INBOX_HEADING = "## Feature: maintenance-inbox";

/** One-line comment placed directly under the section heading on creation. */
const MAINTENANCE_INBOX_COMMENT =
  "<!-- Drafts filed autonomously by scripts/maintain.sh — promote via /pm:approve -->";

/** Default validator invoked after every write, split on spaces at call time. */
const DEFAULT_VALIDATE_CMD = "bash scripts/validate-roadmap.sh";

/**
 * Walks up from the current working directory to find the nearest ancestor
 * containing a `.claude` directory — the project root. Mirrors
 * `getProjectRoot` in scripts/knowledge-index.ts. Falls back to cwd if no
 * `.claude` directory is found within 10 levels.
 */
function getProjectRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, ".claude"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

/**
 * Minimal `--flag value` CLI parser. No `--flag=value` syntax, no boolean
 * flags — every recognized flag consumes the following argv element as its
 * value (or "" if the next token is missing or itself looks like a flag).
 */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[key] = "";
    } else {
      out[key] = value;
      i++;
    }
  }
  return out;
}

/**
 * Sanitizes a task title before it is written to ROADMAP.md: strips CR/LF,
 * strips the markdown-structural characters `#`, `<`, `>` (which could
 * fabricate a heading, break the `#TN` id parse, or inject markup),
 * collapses internal whitespace runs to a single space, trims, and caps
 * length at 200 characters.
 */
function sanitizeTitle(raw: string): string {
  let t = raw.replace(/[\r\n]/g, "");
  t = t.replace(/[#<>]/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 200) t = t.slice(0, 200).trim();
  return t;
}

/**
 * Sanitizes a fingerprint before it is used for dedup matching or written
 * into the `maint-fp:` comment. Strips CR/LF (a raw newline would break out
 * of the single-line HTML comment and inject a forged ROADMAP line — this is
 * the ONLY writer the autonomous loop may use, so the guard lives here, not
 * at the call sites) and the comment-closing `>` / markdown `#<`, collapses
 * whitespace, trims, and caps at 200 chars. Applied once, before both the
 * dedup check and the write, so the two always agree.
 */
function sanitizeFingerprint(raw: string): string {
  let f = raw.replace(/[\r\n]/g, "");
  f = f.replace(/[#<>]/g, "");
  f = f.replace(/\s+/g, " ").trim();
  if (f.length > 200) f = f.slice(0, 200).trim();
  return f;
}

/** Detects whether `content` uses CRLF or LF line endings; defaults to LF. */
function detectEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Allocates the next `#TN` id by parsing the ROADMAP at `roadmapPath` (via
 * the shared `parseRoadmap`, which reads from disk) and taking the highest
 * existing numeric task id + 1. Returns 1 if no numeric task ids exist.
 */
function nextTaskId(roadmapPath: string): number {
  const { tasks } = parseRoadmap(roadmapPath);
  let max = 0;
  for (const id of tasks.keys()) {
    const m = /^T(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/**
 * Ensures a `## Feature: maintenance-inbox` section with the standard
 * lifecycle subsections (Draft/Todo/In Progress/Review/Done) exists in
 * `content`. If absent, inserts it directly before the first `## Backlog`
 * heading, or appends it at EOF if no `## Backlog` heading is present.
 * Returns `content` unchanged if the section already exists.
 */
function ensureMaintenanceInboxSection(content: string, eol: string): string {
  if (content.includes(MAINTENANCE_INBOX_HEADING)) return content;

  const section = [
    MAINTENANCE_INBOX_HEADING,
    MAINTENANCE_INBOX_COMMENT,
    "",
    "### Draft",
    "",
    "### Todo",
    "",
    "### In Progress",
    "",
    "### Review",
    "",
    "### Done",
    "",
  ].join(eol);

  const backlogMatch = /^## Backlog\s*$/m.exec(content);
  if (!backlogMatch) {
    const sep = content.endsWith(eol) ? eol : eol + eol;
    return content + sep + section;
  }
  return (
    content.slice(0, backlogMatch.index) + section + eol + content.slice(backlogMatch.index)
  );
}

/**
 * Appends a new `[?]` draft task line (plus a `maint-fp:` fingerprint
 * comment, and an optional extra body comment) to the end of the `### Draft`
 * subsection under `## Feature: maintenance-inbox`. Assumes the section
 * already exists — call `ensureMaintenanceInboxSection` first.
 */
function appendDraftTask(
  content: string,
  eol: string,
  taskId: number,
  title: string,
  fingerprint: string,
  body: string | undefined,
): string {
  const featureIdx = content.indexOf(MAINTENANCE_INBOX_HEADING);
  if (featureIdx < 0) {
    throw new Error("maintenance-inbox section not found");
  }
  const afterFeature = content.slice(featureIdx);
  // NOTE: `[ \t]*` (not `\s*`) is deliberate. On CRLF files, JS multiline
  // `^`/`$` treats CR and LF as independent LineTerminator characters (not
  // an atomic \r\n pair), so a trailing `\s*$` can backtrack PAST the
  // heading's own \r\n and match one extra `\r` from the *next* line's
  // blank-line terminator, corrupting the computed heading end position by
  // one byte. Restricting the quantifier to same-line whitespace (space/tab)
  // makes the match length CRLF-safe since it can never consume a
  // terminator character in the first place.
  const draftMatch = /^### Draft[ \t]*$/m.exec(afterFeature);
  if (!draftMatch) {
    throw new Error("maintenance-inbox section is missing a ### Draft heading");
  }
  const draftHeadingEnd = featureIdx + draftMatch.index + draftMatch[0].length;

  // Boundary of the Draft subsection: the next "## " or "### " heading, or
  // EOF if this is the last section in the file.
  const rest = content.slice(draftHeadingEnd);
  const nextHeadingMatch = /^#{2,3} /m.exec(rest);
  const boundary = nextHeadingMatch ? draftHeadingEnd + nextHeadingMatch.index : content.length;

  // Trim trailing blank lines within the subsection so the new task is
  // appended directly after the last existing line (matching the repo's
  // observed convention of no forced blank line before the next heading).
  const gap = content.slice(draftHeadingEnd, boundary);
  const insertAt = draftHeadingEnd + gap.replace(/\s+$/, "").length;

  const lines = [`- [?] ${title} #T${taskId}`, `  <!-- maint-fp: ${fingerprint} -->`];
  if (body) lines.push(`  <!-- ${body} -->`);
  const block = eol + lines.join(eol);

  return content.slice(0, insertAt) + block + content.slice(insertAt);
}

/**
 * Entry point. Reads ROADMAP.md, dedups on a literal `maint-fp: <fp>`
 * substring match, allocates the next `#TN` id, ensures the
 * maintenance-inbox section exists, appends the sanitized draft task, writes
 * the file, and runs the validator — restoring the original content on
 * validation failure.
 */
function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const fingerprint = sanitizeFingerprint(args.fingerprint || "");
  if (!fingerprint) {
    console.error("error: missing --fingerprint");
    process.exit(1);
  }

  const projectRoot = getProjectRoot();
  const roadmapPath = args.roadmap ? resolve(args.roadmap) : resolve(projectRoot, "ROADMAP.md");

  if (!existsSync(roadmapPath)) {
    console.error(`error: roadmap not found: ${roadmapPath}`);
    process.exit(1);
  }

  const validateCmdStr = args["validate-cmd"] || DEFAULT_VALIDATE_CMD;
  const validateArgv = validateCmdStr.split(" ");

  // Step 1: read + snapshot.
  const original = readFileSync(roadmapPath, "utf-8");
  const eol = detectEol(original);

  // Step 2: dedup — fixed-string substring match, never a regex, so
  // fingerprints containing `.`/`,` (or any other regex metacharacter)
  // cannot cause a false-positive dedup match.
  if (original.includes(`maint-fp: ${fingerprint}`)) {
    console.log(`duplicate: ${fingerprint}`);
    process.exit(2);
  }

  // Step 6 (title sanitation — validated ahead of ID allocation/writing).
  const title = sanitizeTitle(args.title || "");
  if (title.length === 0) {
    console.error("error: empty title");
    process.exit(1);
  }

  // Step 3: allocate next id (reads roadmapPath from disk — content is
  // still `original` at this point, nothing written yet).
  const taskId = nextTaskId(roadmapPath);

  // Steps 4-5: ensure section, append draft.
  let updated = ensureMaintenanceInboxSection(original, eol);
  updated = appendDraftTask(updated, eol, taskId, title, fingerprint, args.body || undefined);

  // Step 7: write, then validate.
  writeFileSync(roadmapPath, updated, "utf-8");
  try {
    execFileSync(validateArgv[0], validateArgv.slice(1), { stdio: "pipe" });
  } catch {
    writeFileSync(roadmapPath, original, "utf-8");
    console.error("error: validation failed, ROADMAP restored");
    process.exit(1);
  }

  // Step 8: success.
  console.log(`filed: #T${taskId}`);
  process.exit(0);
}

main();
