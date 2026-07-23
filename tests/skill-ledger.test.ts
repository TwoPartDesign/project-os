// tests/skill-ledger.test.ts
// Unit tests for scripts/skill-ledger.ts (rejection-ledger writer CLI).
// Pattern follows tests/maintain-draft.test.ts: node:test + node:assert.
// Every test spawns the CLI as a real child process (execFileSync) against
// its own temp-dir fixture — no shared state, no shared beforeEach.

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/** Walks up from this test file to find the nearest ancestor with `.claude` — the project root. */
function findProjectRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, ".claude"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error("project root (dir containing .claude) not found from test file location");
}

const PROJECT_ROOT = findProjectRoot();
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/skill-ledger.ts");

/** Creates a fresh, isolated temp directory for one test. Caller must rmSync it in a finally. */
function freshTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "skill-ledger-test-"));
}

/** Runs the CLI and returns trimmed stdout. Throws if the CLI exits non-zero. */
function runCli(argv: string[]): string {
  return execFileSync(process.execPath, [CLI_PATH, ...argv], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  }).trim();
}

/** Runs the CLI expecting a non-zero exit; returns its status/stdout/stderr instead of throwing. */
function runCliExpectFailure(argv: string[]): { status: number; stdout: string; stderr: string } {
  try {
    execFileSync(process.execPath, [CLI_PATH, ...argv], { cwd: PROJECT_ROOT, encoding: "utf-8" });
  } catch (e: unknown) {
    const err = e as { status: number; stdout?: string; stderr?: string };
    return { status: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
  throw new Error("expected CLI invocation to exit non-zero, but it succeeded");
}

// ==========================================================================
// Ledger creation
// ==========================================================================

describe("skill-ledger append (absent ledger)", () => {
  it("append_absentLedger_createsFileWithFrontmatterAndEntry", () => {
    const dir = freshTempDir();
    try {
      const ledgerPath = resolve(dir, "skill-edit-rejections.md");

      const stdout = runCli([
        "append",
        "--fingerprint",
        "skill-edit:.claude/rules/bash.md:heredoc-ban",
        "--summary",
        "Allow heredocs for this one script",
        "--reason",
        "Heredocs are already banned repo-wide; no new exception needed",
        "--date",
        "2026-07-22",
        "--ledger",
        ledgerPath,
      ]);

      strictEqual(stdout, "appended: skill-edit:.claude/rules/bash.md:heredoc-ban");
      ok(existsSync(ledgerPath), "ledger file must be created");

      const content = readFileSync(ledgerPath, "utf-8");
      ok(content.startsWith("---"), "ledger must start with YAML frontmatter delimiter");
      ok(
        content.includes("## 2026-07-22 — skill-edit:.claude/rules/bash.md:heredoc-ban"),
        `expected exact entry heading, got: ${content}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Sanitation
// ==========================================================================

describe("skill-ledger append (sanitation)", () => {
  it("append_reasonWithHeadingInjection_neutralized", () => {
    const dir = freshTempDir();
    try {
      const ledgerPath = resolve(dir, "skill-edit-rejections.md");
      const forgedReason = "bad\n## 2026-01-01 — skill-edit:forged:fp\ntext";

      const stdout = runCli([
        "append",
        "--fingerprint",
        "fp-injection-1",
        "--summary",
        "s",
        "--reason",
        forgedReason,
        "--date",
        "2026-07-22",
        "--ledger",
        ledgerPath,
      ]);

      strictEqual(stdout, "appended: fp-injection-1");

      const content = readFileSync(ledgerPath, "utf-8");
      const headingLines = content.split("\n").filter((l) => l.startsWith("## "));
      strictEqual(headingLines.length, 1, `expected exactly 1 heading line, got: ${headingLines.join(" | ")}`);
      strictEqual(
        headingLines[0].trimEnd(),
        "## 2026-07-22 — fp-injection-1",
        "the only heading must be the legitimate entry, not the forged one",
      );
      const rejectedLine = content
        .split("\n")
        .find((l) => l.includes("**Rejected because**"));
      ok(rejectedLine !== undefined, "Rejected-because line must exist");
      ok(!rejectedLine!.includes("#"), `# characters must be stripped from reason, got: ${rejectedLine}`);
      ok(
        rejectedLine!.includes("skill-edit:forged:fp"),
        "forged heading text must survive only as flattened, harmless inline data on the Rejected-because line",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Dedup
// ==========================================================================

describe("skill-ledger append (dedup)", () => {
  it("append_duplicateFingerprint_exit2NothingWritten", () => {
    const dir = freshTempDir();
    try {
      const ledgerPath = resolve(dir, "skill-edit-rejections.md");
      const argv = [
        "append",
        "--fingerprint",
        "fp-dup-1",
        "--summary",
        "first attempt",
        "--reason",
        "not aligned with design principles",
        "--date",
        "2026-07-22",
        "--ledger",
        ledgerPath,
      ];

      runCli(argv);
      const before = readFileSync(ledgerPath, "utf-8");

      const result = runCliExpectFailure(argv);
      strictEqual(result.status, 2);
      ok(result.stdout.includes("duplicate: fp-dup-1"), `stdout was: ${result.stdout}`);

      const after = readFileSync(ledgerPath, "utf-8");
      strictEqual(after, before, "file must be byte-identical when dedup short-circuits");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Required-flag validation
// ==========================================================================

describe("skill-ledger append (validation)", () => {
  it("append_missingDate_exit1", () => {
    const dir = freshTempDir();
    try {
      const ledgerPath = resolve(dir, "skill-edit-rejections.md");

      const result = runCliExpectFailure([
        "append",
        "--fingerprint",
        "fp-nodate-1",
        "--summary",
        "s",
        "--reason",
        "r",
        "--ledger",
        ledgerPath,
      ]);

      strictEqual(result.status, 1);
      ok(result.stderr.includes("error: missing --date"), `stderr was: ${result.stderr}`);
      ok(!existsSync(ledgerPath), "ledger must not be created when --date is missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Atomic write
// ==========================================================================

describe("skill-ledger append (atomic write)", () => {
  it("append_atomicWrite_noTmpResidue", () => {
    const dir = freshTempDir();
    try {
      const ledgerPath = resolve(dir, "skill-edit-rejections.md");

      runCli([
        "append",
        "--fingerprint",
        "fp-atomic-1",
        "--summary",
        "s",
        "--reason",
        "r",
        "--date",
        "2026-07-22",
        "--ledger",
        ledgerPath,
      ]);

      const entries = readdirSync(dir);
      ok(
        !entries.some((f) => f.endsWith(".tmp")),
        `expected no .tmp residue in dir, found: ${entries.join(", ")}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// EOL preservation
// ==========================================================================

describe("skill-ledger append (EOL preservation)", () => {
  it("append_crlfLedger_preservesEol", () => {
    const dir = freshTempDir();
    try {
      const ledgerPath = resolve(dir, "skill-edit-rejections.md");
      const existing = [
        "---",
        "type: knowledge",
        "tags: [skill-edits, rejections]",
        "description: pre-existing fixture ledger",
        'date: "2026-07-01"',
        "---",
        "",
        "# Skill-Edit Rejection Ledger",
        "",
        "## 2026-07-01 — fp-existing-1",
        "- **Proposed**: old proposal",
        "- **Rejected because**: old reason",
        "",
      ].join("\r\n");
      writeFileSync(ledgerPath, existing, "utf-8");

      const stdout = runCli([
        "append",
        "--fingerprint",
        "fp-crlf-1",
        "--summary",
        "s",
        "--reason",
        "r",
        "--date",
        "2026-07-22",
        "--ledger",
        ledgerPath,
      ]);

      strictEqual(stdout, "appended: fp-crlf-1");

      const content = readFileSync(ledgerPath, "utf-8");
      ok(
        content.includes("\r\n## 2026-07-22 — fp-crlf-1"),
        "new entry heading must be preceded by a CRLF, not a bare LF",
      );
      ok(!/(?<!\r)\n/.test(content), "no bare LF line ending should exist in a CRLF ledger");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
