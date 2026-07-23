#!/usr/bin/env node
// scripts/skill-ledger.ts — Rejection-ledger writer for skill-edit proposals.
//
// Sole writer of docs/knowledge/skill-edit-rejections.md. Appends one entry
// per rejected skill-edit proposal (fingerprint, summary, reason, optional
// feature/task). Mirrors scripts/maintain-draft.ts throughout: minimal
// `--flag value` argv parsing, aggressive field sanitation, fixed-string
// dedup, atomic write via a `.tmp` + rename, and existing-EOL preservation.
// This is a sole-writer artifact: every field is sanitized here, never
// trusted from the caller.
//
// Usage:
//   node scripts/skill-ledger.ts append --fingerprint "<fp>" --summary "<s>" \
//     --reason "<r>" [--feature <f>] [--task T81] --date YYYY-MM-DD \
//     [--ledger <path>]
//
// Exit codes:
//   0  appended successfully — prints "appended: <fp>"
//   1  unknown subcommand, or missing/empty --fingerprint, --reason, or a
//      missing/invalid --date
//   2  duplicate fingerprint — prints "duplicate: <fp>", nothing written

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { getProjectRoot } from "./lib/project-root.ts";

/** Em-dash separator used between the date and fingerprint in an entry heading. */
const EM_DASH = " — ";

/** Max characters kept from any sanitized field before truncation. */
const FIELD_MAX_CHARS = 200;

/** Strict `YYYY-MM-DD` date format — no other punctuation or whitespace tolerated. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Minimal `--flag value` CLI parser (mirrors maintain-draft.ts). No
 * `--flag=value` syntax, no boolean flags — every recognized flag consumes
 * the following argv element as its value (or "" if the next token is
 * missing or itself looks like a flag).
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
 * Sanitizes any free-text field (fingerprint, summary, reason, feature, task)
 * before it reaches the ledger file: strips CR/LF (a raw newline could break
 * out of a single markdown line and forge a new heading), strips ALL `#`
 * characters (a reason must never fabricate a `## ` heading), strips `<`/`>`
 * (markup injection), collapses internal whitespace runs to a single space,
 * trims, and caps length at 200 characters.
 */
function sanitizeField(raw: string): string {
  let s = raw.replace(/[\r\n]/g, "");
  s = s.replace(/[#<>]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > FIELD_MAX_CHARS) s = s.slice(0, FIELD_MAX_CHARS).trim();
  return s;
}

/** Detects whether `content` uses CRLF or LF line endings; defaults to LF. */
function detectEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Builds the `- **Proposed**: ...` line, appending a `(feature: ..., draft
 * #...)` parenthetical only for the parts actually supplied — either part
 * (or both, or neither) may be omitted gracefully.
 */
function buildProposedLine(summary: string, feature: string, task: string): string {
  const parts: string[] = [];
  if (feature) parts.push(`feature: ${feature}`);
  if (task) parts.push(`draft #${task}`);
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `- **Proposed**: ${summary}${suffix}`;
}

/**
 * Builds the full 3-line entry block for one rejection: the `## ` fingerprint
 * heading (a grep-anchor contract — do not reformat), the Proposed line, and
 * the Rejected-because line. All inputs must already be sanitized.
 */
function buildEntryLines(
  date: string,
  fingerprint: string,
  summary: string,
  reason: string,
  feature: string,
  task: string,
): string[] {
  return [
    `## ${date}${EM_DASH}${fingerprint}`,
    buildProposedLine(summary, feature, task),
    `- **Rejected because**: ${reason}`,
  ];
}

/**
 * Builds the header block (YAML frontmatter + title + format comment) used
 * when creating a brand-new ledger file. Returned string ends in `eol` so
 * entry lines can be appended directly after it.
 */
function buildNewLedgerHeader(date: string, eol: string): string {
  const lines = [
    "---",
    "type: knowledge",
    "tags: [skill-edits, rejections]",
    "description: Ledger of skill-edit proposals rejected during autonomous skill-optimization review.",
    `date: "${date}"`,
    "---",
    "",
    "# Skill-Edit Rejection Ledger",
    "",
    "<!-- Format: `## <date> — <fingerprint>` heading per entry, appended only by scripts/skill-ledger.ts. Do not hand-edit. -->",
    "",
  ];
  return lines.join(eol) + eol;
}

/**
 * Returns true if `content` already has a `## `-anchored line containing the
 * literal substring ` — <fingerprint>` (fixed-string scan, never a regex, so
 * fingerprints containing regex metacharacters cannot cause a false match).
 */
function hasDuplicateFingerprint(content: string, fingerprint: string): boolean {
  const needle = `${EM_DASH}${fingerprint}`;
  const lines = content.split(/\r\n|\n/);
  for (const line of lines) {
    if (line.startsWith("## ") && line.includes(needle)) return true;
  }
  return false;
}

/**
 * Entry point for the `append` subcommand. Sanitizes every field, validates
 * required flags, dedups on a literal `## ... — <fp>` heading match,
 * (re)builds the ledger content, and writes it atomically via a `.tmp` file
 * + rename — preserving the existing file's EOL style, or defaulting to LF
 * when creating a brand-new ledger.
 */
function runAppend(argv: string[]): void {
  const args = parseArgs(argv);

  const fingerprint = sanitizeField(args.fingerprint || "");
  if (!fingerprint) {
    console.error("error: missing --fingerprint");
    process.exit(1);
  }

  const reason = sanitizeField(args.reason || "");
  if (!reason) {
    console.error("error: missing --reason");
    process.exit(1);
  }

  // Deliberately never calls Date/Date.now() — determinism requirement.
  // Callers must supply the date; strict format match, no normalization.
  const rawDate = args.date || "";
  if (!DATE_RE.test(rawDate)) {
    console.error("error: missing --date");
    process.exit(1);
  }
  const date = rawDate;

  const summary = sanitizeField(args.summary || "");
  const feature = args.feature !== undefined ? sanitizeField(args.feature) : "";
  const task = args.task !== undefined ? sanitizeField(args.task) : "";

  const projectRoot = getProjectRoot();
  const ledgerPath = args.ledger
    ? resolve(args.ledger)
    : resolve(projectRoot, "docs/knowledge/skill-edit-rejections.md");

  let original: string | null = null;
  let eol = "\n";
  if (existsSync(ledgerPath)) {
    original = readFileSync(ledgerPath, "utf-8");
    eol = detectEol(original);
  }

  if (original !== null && hasDuplicateFingerprint(original, fingerprint)) {
    console.log(`duplicate: ${fingerprint}`);
    process.exit(2);
  }

  const entryLines = buildEntryLines(date, fingerprint, summary, reason, feature, task);

  let updated: string;
  if (original === null) {
    updated = buildNewLedgerHeader(date, eol) + entryLines.join(eol) + eol;
  } else {
    const trimmed = original.replace(/\s+$/, "");
    updated = trimmed + eol + eol + entryLines.join(eol) + eol;
  }

  const dir = dirname(ledgerPath);
  const tmpPath = resolve(dir, `${basename(ledgerPath)}.tmp`);
  writeFileSync(tmpPath, updated, "utf-8");
  renameSync(tmpPath, ledgerPath);

  console.log(`appended: ${fingerprint}`);
  process.exit(0);
}

/** Entry point. Dispatches on the argv[2] subcommand — only `append` exists in v1. */
function main(): void {
  const subcommand = process.argv[2];
  if (subcommand !== "append") {
    console.error(
      "usage: node scripts/skill-ledger.ts append --fingerprint <fp> --summary <s> --reason <r> " +
        "[--feature <f>] [--task <t>] --date YYYY-MM-DD [--ledger <path>]",
    );
    process.exit(1);
  }
  runAppend(process.argv.slice(3));
}

main();
