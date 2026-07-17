// tests/maintain-draft.test.ts
// Unit tests for scripts/maintain-draft.ts (governed ROADMAP draft-filing CLI).
// Pattern follows tests/dashboard-render.test.ts: node:test + node:assert.
// Every test spawns the CLI as a real child process (execFileSync) against
// its own temp-dir fixture — no shared state, no shared beforeEach.

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/maintain-draft.ts");

/** Normalizes a native path to forward slashes for embedding in CLI argv strings. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Creates a fresh, isolated temp directory for one test. Caller must rmSync it in a finally. */
function freshTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "maintain-draft-test-"));
}

/** Standard Legend header, shared verbatim by all fixtures (mirrors real ROADMAP.md's header). */
const HEADER = [
  "# Roadmap",
  "",
  "**Format spec**: See `docs/knowledge/roadmap-format.md`.",
  "",
  "## Legend (Quick Reference)",
  "- `[?]` Draft (pending approval)",
  "- `[ ]` Todo (approved, ready for work)",
  "- `[-]` In Progress",
  "- `[~]` Review (awaiting review)",
  "- `[>]` Competing (multiple implementations racing)",
  "- `[x]` Done",
  "- `[!]` Blocked",
  "",
].join("\n");

const FOOTER = [
  "## Backlog",
  "<!-- Ideas that have been captured but not yet designed -->",
  "",
  "## Completed",
  "<!-- Moved here after /workflows:ship -->",
  "",
].join("\n");

/** Builds a minimal-but-valid ROADMAP.md fixture: header + one feature section + Backlog/Completed. */
function buildFixture(featureSection: string): string {
  return HEADER + "\n" + featureSection + "\n" + FOOTER;
}

/** Converts a bare-LF string to CRLF line endings (real ROADMAP.md uses CRLF). */
function toCrlf(s: string): string {
  return s.replace(/\n/g, "\r\n");
}

/** Writes `content` to `<dir>/ROADMAP.md` and returns its path. */
function writeRoadmapFixture(dir: string, content: string): string {
  const path = resolve(dir, "ROADMAP.md");
  writeFileSync(path, content, "utf-8");
  return path;
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

/** argv for a real validate-roadmap.sh run scoped to `roadmapPath` (not the project's real ROADMAP.md). */
function realValidateCmd(roadmapPath: string): string[] {
  return ["--validate-cmd", `bash scripts/validate-roadmap.sh ${toPosix(roadmapPath)}`];
}

// ==========================================================================
// ID allocation
// ==========================================================================

describe("maintain-draft ID allocation", () => {
  it("[unit]_gappedExistingIds_allocatesMaxPlusOne", () => {
    const dir = freshTempDir();
    try {
      const roadmap = writeRoadmapFixture(
        dir,
        buildFixture(
          [
            "## Feature: sample",
            "",
            "### Draft",
            "",
            "### Todo",
            "- [ ] Sample task three #T3",
            "- [ ] Sample task seven #T7",
            "- [ ] Sample task fifty #T50",
            "",
            "### In Progress",
            "",
            "### Review",
            "",
            "### Done",
            "",
          ].join("\n"),
        ),
      );

      const stdout = runCli([
        "--title",
        "New maintenance task",
        "--fingerprint",
        "fp-alloc-1",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);

      strictEqual(stdout, "filed: #T51");

      const content = readFileSync(roadmap, "utf-8");
      ok(
        content.includes("- [?] New maintenance task #T51\n  <!-- maint-fp: fp-alloc-1 -->"),
        "expected exact appended task + fingerprint comment lines",
      );
      ok(
        content.indexOf("## Feature: maintenance-inbox") < content.indexOf("## Backlog"),
        "maintenance-inbox section must be inserted before ## Backlog",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Dedup
// ==========================================================================

describe("maintain-draft dedup", () => {
  it("[unit]_duplicateFingerprint_exitsTwoAndLeavesFileUnchanged", () => {
    const dir = freshTempDir();
    try {
      const existing = buildFixture(
        [
          "## Feature: maintenance-inbox",
          "<!-- Drafts filed autonomously by scripts/maintain.sh — promote via /pm:approve -->",
          "",
          "### Draft",
          "- [?] Existing draft task #T5",
          "  <!-- maint-fp: dup-fp-1 -->",
          "",
          "### Todo",
          "",
          "### In Progress",
          "",
          "### Review",
          "",
          "### Done",
          "",
        ].join("\n"),
      );
      const roadmap = writeRoadmapFixture(dir, existing);
      const before = readFileSync(roadmap, "utf-8");

      const result = runCliExpectFailure([
        "--title",
        "Should not be filed",
        "--fingerprint",
        "dup-fp-1",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);

      strictEqual(result.status, 2);
      ok(result.stdout.includes("duplicate: dup-fp-1"), `stdout was: ${result.stdout}`);

      const after = readFileSync(roadmap, "utf-8");
      strictEqual(after, before, "file must be byte-identical when dedup short-circuits");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[unit]_fingerprintRegexMetacharacter_doesNotFalseMatchFilesSuccessfully", () => {
    const dir = freshTempDir();
    try {
      const existing = buildFixture(
        [
          "## Feature: maintenance-inbox",
          "<!-- Drafts filed autonomously by scripts/maintain.sh — promote via /pm:approve -->",
          "",
          "### Draft",
          "- [?] Existing stale-file task #T6",
          "  <!-- maint-fp: stale:a.md,b.md -->",
          "",
          "### Todo",
          "",
          "### In Progress",
          "",
          "### Review",
          "",
          "### Done",
          "",
        ].join("\n"),
      );
      const roadmap = writeRoadmapFixture(dir, existing);

      // "stale:aXmd,b.md" would false-match "stale:a.md,b.md" under a regex
      // interpretation of the stored fingerprint (`.` as wildcard). It must
      // NOT dedup-match under fixed-string comparison.
      const stdout = runCli([
        "--title",
        "Different fingerprint, same-ish text",
        "--fingerprint",
        "stale:aXmd,b.md",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);

      ok(/^filed: #T\d+$/.test(stdout), `expected a successful "filed:" line, got: ${stdout}`);
      const content = readFileSync(roadmap, "utf-8");
      ok(content.includes("<!-- maint-fp: stale:aXmd,b.md -->"), "new fingerprint must be written");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Section creation / idempotence
// ==========================================================================

describe("maintain-draft section handling", () => {
  it("[unit]_missingSection_createdBeforeBacklogThenSecondFilingAppendsWithoutDuplicateHeading", () => {
    const dir = freshTempDir();
    try {
      const roadmap = writeRoadmapFixture(
        dir,
        buildFixture(["## Feature: sample", "", "### Draft", "", "### Todo", "", "### In Progress", "", "### Review", "", "### Done", ""].join("\n")),
      );

      const first = runCli([
        "--title",
        "First filing",
        "--fingerprint",
        "fp-section-1",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);
      ok(/^filed: #T\d+$/.test(first));

      const afterFirst = readFileSync(roadmap, "utf-8");
      const headingCountAfterFirst = afterFirst.split("## Feature: maintenance-inbox").length - 1;
      strictEqual(headingCountAfterFirst, 1, "section heading must be created exactly once");
      ok(
        afterFirst.indexOf("## Feature: maintenance-inbox") < afterFirst.indexOf("## Backlog"),
        "new section must be inserted before ## Backlog",
      );

      const second = runCli([
        "--title",
        "Second filing",
        "--fingerprint",
        "fp-section-2",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);
      ok(/^filed: #T\d+$/.test(second));

      const afterSecond = readFileSync(roadmap, "utf-8");
      const headingCountAfterSecond = afterSecond.split("## Feature: maintenance-inbox").length - 1;
      strictEqual(headingCountAfterSecond, 1, "no duplicate section heading on second filing");
      ok(afterSecond.includes("<!-- maint-fp: fp-section-1 -->"), "first draft must still be present");
      ok(afterSecond.includes("<!-- maint-fp: fp-section-2 -->"), "second draft must be appended");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Validation failure / restore
// ==========================================================================

describe("maintain-draft validation failure", () => {
  it("[unit]_validateCmdExitsNonzero_restoresOriginalContentAndExitsOne", () => {
    const dir = freshTempDir();
    try {
      const roadmap = writeRoadmapFixture(
        dir,
        buildFixture(["## Feature: sample", "", "### Draft", "", "### Todo", "", "### In Progress", "", "### Review", "", "### Done", ""].join("\n")),
      );
      const before = readFileSync(roadmap, "utf-8");

      const failScript = resolve(dir, "fail-validate.sh");
      writeFileSync(failScript, "#!/usr/bin/env bash\nexit 1\n", "utf-8");

      const result = runCliExpectFailure([
        "--title",
        "Should be rolled back",
        "--fingerprint",
        "fp-validate-fail-1",
        "--roadmap",
        roadmap,
        "--validate-cmd",
        `bash ${toPosix(failScript)}`,
      ]);

      strictEqual(result.status, 1);
      ok(
        result.stderr.includes("error: validation failed, ROADMAP restored"),
        `stderr was: ${result.stderr}`,
      );

      const after = readFileSync(roadmap, "utf-8");
      strictEqual(after, before, "file must be restored byte-identically after validation failure");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// Title sanitation
// ==========================================================================

describe("maintain-draft title sanitation", () => {
  it("[unit]_titleWithHashAngleBracketsNewline_sanitizedIdSuffixRemains", () => {
    const dir = freshTempDir();
    try {
      const roadmap = writeRoadmapFixture(
        dir,
        buildFixture(["## Feature: sample", "", "### Draft", "", "### Todo", "", "### In Progress", "", "### Review", "", "### Done", ""].join("\n")),
      );

      const stdout = runCli([
        "--title",
        "bad#title<with>\nnewline",
        "--fingerprint",
        "fp-sanitize-1",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);

      const idMatch = /^filed: (#T\d+)$/.exec(stdout);
      ok(idMatch, `expected "filed: #T<N>", got: ${stdout}`);
      const taskId = idMatch![1];

      const content = readFileSync(roadmap, "utf-8");
      const lines = content.split("\n");
      const fpLineIdx = lines.findIndex((l) => l.includes("<!-- maint-fp: fp-sanitize-1 -->"));
      ok(fpLineIdx > 0, "fingerprint comment line must be present");
      const taskLine = lines[fpLineIdx - 1];

      // Exact sanitation result: \r\n stripped (no space inserted), then
      // '#'/'<'/'>' stripped outright, whitespace collapsed/trimmed.
      strictEqual(taskLine, `- [?] badtitlewithnewline ${taskId}`);

      const titlePortion = taskLine.replace(new RegExp(` ${taskId}$`), "").replace("- [?] ", "");
      ok(!/[#<>]/.test(titlePortion), `sanitized title must not contain #/</>: "${titlePortion}"`);
      ok(!titlePortion.includes("\n") && !titlePortion.includes("\r"), "sanitized title must not contain newlines");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ==========================================================================
// CRLF line endings (real ROADMAP.md uses CRLF — regression coverage for a
// JS multiline-regex backtracking trap: `^X\s*$` can consume one stray `\r`
// from the *next* blank line's terminator, since JS treats CR and LF as
// independent LineTerminator characters rather than an atomic \r\n pair).
// ==========================================================================

describe("maintain-draft CRLF handling", () => {
  it("[unit]_crlfRoadmap_appendsTwiceWithoutCorruptingLineEndings", () => {
    const dir = freshTempDir();
    try {
      const fixture = toCrlf(
        buildFixture(
          ["## Feature: sample", "", "### Draft", "", "### Todo", "", "### In Progress", "", "### Review", "", "### Done", ""].join("\n"),
        ),
      );
      ok(fixture.includes("\r\n"), "fixture setup sanity check: must actually be CRLF");
      const roadmap = writeRoadmapFixture(dir, fixture);

      const first = runCli([
        "--title",
        "CRLF first filing",
        "--fingerprint",
        "fp-crlf-1",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);
      ok(/^filed: #T\d+$/.test(first), `expected success on first CRLF filing, got: ${first}`);

      const second = runCli([
        "--title",
        "CRLF second filing",
        "--fingerprint",
        "fp-crlf-2",
        "--roadmap",
        roadmap,
        ...realValidateCmd(roadmap),
      ]);
      ok(/^filed: #T\d+$/.test(second), `expected success on second CRLF filing, got: ${second}`);

      const content = readFileSync(roadmap, "utf-8");

      // No stray doubled CR (the exact corruption this regression guards against).
      ok(!content.includes("\r\r"), "must not contain a doubled CR anywhere");
      // No lone LF without a preceding CR anywhere in the file — the whole
      // file must remain uniformly CRLF after two writes.
      ok(!/(?<!\r)\n/.test(content), "must not contain a bare LF without a preceding CR");

      strictEqual(content.split("## Feature: maintenance-inbox").length - 1, 1);
      ok(content.includes("- [?] CRLF first filing #T1\r\n  <!-- maint-fp: fp-crlf-1 -->\r\n- [?] CRLF second filing #T2\r\n  <!-- maint-fp: fp-crlf-2 -->"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
