// tests/review-triage.test.ts
// Unit tests for scripts/review-triage.ts (offline/heuristic review triage).
// Pure functions (parseFindings, heuristicCandidates, applyHeuristic,
// renderTable) are exercised by direct import; runTriage and the CLI are
// exercised against per-test temp-dir fixtures (mkdtempSync) — no shared
// state, no shared beforeEach.

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  parseFindings,
  heuristicCandidates,
  applyHeuristic,
  renderTable,
  runTriage,
  type Finding,
  type TriagedFinding,
} from "../scripts/review-triage.ts";

/** Walks up from this test file to find the nearest ancestor with `.claude` — the project root. */
function findProjectRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(current, ".claude"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    "project root (dir containing .claude) not found from test file location",
  );
}

const PROJECT_ROOT = findProjectRoot();
const CLI_PATH = resolve(PROJECT_ROOT, "scripts/review-triage.ts");
const FIXTURES_DIR = resolve(PROJECT_ROOT, "tests/fixtures/review-raw");

/** Creates a fresh, isolated temp directory for one test. Caller must rmSync it in a finally. */
function freshTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "review-triage-test-"));
}

/** A disabled `JevConfig` for tests that call `runTriage` directly, so it never reads real settings. */
const DISABLED_CONFIG = {
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

/** Recursively lists every file's absolute path under `dir`. */
function listAbsoluteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAbsoluteFiles(full));
    else out.push(full);
  }
  return out;
}

/** Recursively lists every file path under `root`, relative to `root`, sorted. */
function listFilesRecursive(root: string): string[] {
  return listAbsoluteFiles(root)
    .map((f) => relative(root, f))
    .sort();
}

/** Sets up `<tmp>/docs/specs/fx/review-raw/` from the shared fixtures plus a jev-disabled settings.json. */
function setupCliFixture(tmp: string): {
  specDir: string;
  changedFiles: string;
} {
  const specDir = resolve(tmp, "docs/specs/fx");
  mkdirSync(resolve(specDir, "review-raw"), { recursive: true });
  cpSync(FIXTURES_DIR, resolve(specDir, "review-raw"), { recursive: true });
  mkdirSync(resolve(tmp, ".claude"), { recursive: true });
  writeFileSync(
    resolve(tmp, ".claude/settings.json"),
    JSON.stringify({ project_os: { jev: { enabled: false } } }) + "\n",
    "utf-8",
  );
  return {
    specDir,
    changedFiles: resolve(specDir, "review-raw/changed-files.txt"),
  };
}

describe("parseFindings", () => {
  it("parseFindings_threeReviewerPrefixes_extractsFields", () => {
    const text = [
      "HIGH / a.ts:1-2 / DRIFT: things drifted / fix the drift",
      "MEDIUM / b.ts:3 / VULN: things are vulnerable / fix the vuln",
      "LOW / c.ts / ISSUE: things are wrong / fix the issue",
    ].join("\n");

    const findings = parseFindings(text, "rev");
    strictEqual(findings.length, 3);

    strictEqual(findings[0].severity, "HIGH");
    strictEqual(findings[0].file, "a.ts");
    strictEqual(findings[0].lines, "1-2");
    strictEqual(findings[0].issue, "DRIFT: things drifted");
    strictEqual(findings[0].fix, "fix the drift");
    strictEqual(findings[0].reviewer, "rev");
    strictEqual(findings[0].id, "rev-1");

    strictEqual(findings[1].severity, "MEDIUM");
    strictEqual(findings[1].file, "b.ts");
    strictEqual(findings[1].lines, "3");
    strictEqual(findings[1].issue, "VULN: things are vulnerable");
    strictEqual(findings[1].fix, "fix the vuln");
    strictEqual(findings[1].id, "rev-2");

    strictEqual(findings[2].severity, "LOW");
    strictEqual(findings[2].file, "c.ts");
    strictEqual(findings[2].lines, "");
    strictEqual(findings[2].issue, "ISSUE: things are wrong");
    strictEqual(findings[2].fix, "fix the issue");
    strictEqual(findings[2].id, "rev-3");
  });

  it("parseFindings_slashInsideIssue_splitsAtLastSeparator", () => {
    const findings = parseFindings(
      "LOW / a.ts:1 / ISSUE: x / y / fix z",
      "rev",
    );
    strictEqual(findings.length, 1);
    strictEqual(findings[0].issue, "ISSUE: x / y");
    strictEqual(findings[0].fix, "fix z");
  });

  it("parseFindings_fileWithoutLines_linesEmpty", () => {
    const findings = parseFindings("LOW / docs/x.md / DRIFT: a / b", "rev");
    strictEqual(findings.length, 1);
    strictEqual(findings[0].file, "docs/x.md");
    strictEqual(findings[0].lines, "");
  });

  it("parseFindings_nonFindingLines_ignored", () => {
    const text = [
      "PASS: all good",
      "CONCERN: something",
      "just some prose here",
    ].join("\n");
    const findings = parseFindings(text, "rev");
    strictEqual(findings.length, 0);
  });

  it("parseFindings_severityLineUnparseable_warnsWithLine", () => {
    const warnings: string[] = [];
    const findings = parseFindings("HIGH / only-two-parts", "rev", (s) =>
      warnings.push(s),
    );
    strictEqual(findings.length, 0);
    strictEqual(warnings.length, 1);
    ok(
      warnings[0].includes("unparseable finding line: HIGH / only-two-parts"),
      `expected warning to mention the unparseable line, got: ${warnings[0]}`,
    );
  });
});

describe("heuristicCandidates", () => {
  it("heuristicCandidates_sameFileOverlappingLines_pairsThem", () => {
    const findings: Finding[] = [
      {
        id: "architecture-1",
        reviewer: "architecture",
        severity: "HIGH",
        file: "a.ts",
        lines: "40-58",
        issue: "DRIFT: retry cap wrong",
        fix: "fix it",
      },
      {
        id: "security-1",
        reviewer: "security",
        severity: "HIGH",
        file: "a.ts",
        lines: "41-57",
        issue: "VULN: credentials resent",
        fix: "fix it",
      },
    ];
    const { pairs } = heuristicCandidates(findings, []);
    deepStrictEqual(pairs, [["architecture-1", "security-1"]]);
  });

  it("heuristicCandidates_jaccardBelowThreshold_noPair", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "one.ts",
        lines: "1",
        issue: "ISSUE: totally unrelated topic about widgets",
        fix: "f",
      },
      {
        id: "b-1",
        reviewer: "b",
        severity: "LOW",
        file: "two.ts",
        lines: "99",
        issue: "ISSUE: something else entirely about gadgets",
        fix: "f",
      },
    ];
    const { pairs } = heuristicCandidates(findings, []);
    strictEqual(pairs.length, 0);
  });

  it("heuristicCandidates_scope_inDiffAdjacentUnrelated", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "scripts/alpha.ts",
        lines: "1",
        issue: "x",
        fix: "f",
      },
      {
        id: "a-2",
        reviewer: "a",
        severity: "LOW",
        file: "scripts/beta.ts",
        lines: "1",
        issue: "y",
        fix: "f",
      },
      {
        id: "a-3",
        reviewer: "a",
        severity: "LOW",
        file: "docs/x.md",
        lines: "1",
        issue: "z",
        fix: "f",
      },
    ];
    const { scope } = heuristicCandidates(findings, ["scripts/alpha.ts"]);
    strictEqual(scope["a-1"], "in_diff");
    strictEqual(scope["a-2"], "adjacent");
    strictEqual(scope["a-3"], "unrelated");
  });
});

describe("renderTable", () => {
  it("renderTable_pipeInIssueText_escaped", () => {
    const rows: TriagedFinding[] = [
      {
        id: "rev-1",
        reviewer: "rev",
        severity: "LOW",
        file: "a.ts",
        lines: "1",
        issue: "a|b",
        fix: "f",
        duplicate_of: null,
        duplicate_p: 0,
        in_scope: "in_diff",
        in_scope_p: 1,
        calibrated_severity: "LOW",
        severity_confidence: 0,
      },
    ];
    const table = renderTable(rows);
    ok(
      table.includes("a\\|b"),
      `expected escaped pipe in table, got:\n${table}`,
    );

    const dataRow = table.split("\n")[2];
    const cells = dataRow.split(/(?<!\\)\|/).filter((c) => c.length > 0);
    strictEqual(
      cells.length,
      6,
      `expected 6 cells, got ${cells.length}: ${JSON.stringify(cells)}`,
    );
  });
});

describe("runTriage (fixture, via CLI)", () => {
  it("triage_fixture_heuristicBackend_marksTwoDuplicatesOneOutOfScope", () => {
    const tmp = freshTempDir();
    try {
      const { specDir, changedFiles } = setupCliFixture(tmp);
      execFileSync(
        process.execPath,
        [CLI_PATH, specDir, "--changed-files", changedFiles, "--json-only"],
        {
          cwd: tmp,
          encoding: "utf-8",
        },
      );

      const json = JSON.parse(
        readFileSync(resolve(specDir, "review-triage.json"), "utf-8"),
      );
      strictEqual(json.findings.length, 7);
      strictEqual(json.backend, "heuristic");
      strictEqual(json.advisory, true);
      strictEqual(json.declined, "disabled");

      const byId: Record<string, any> = {};
      for (const f of json.findings) byId[f.id] = f;

      strictEqual(byId["security-1"].duplicate_of, "architecture-1");
      strictEqual(byId["tests-2"].duplicate_of, "security-2");

      // Full, exact scope map: docs/knowledge/gamma.md (architecture-2) and
      // scripts/unrelated/delta.sh (security-3) both sit outside the
      // changed-files list and share no directory with anything in it, so
      // both come out "unrelated" under the in_diff/adjacent/unrelated rule
      // — not only the planted security-3 case.
      const expectedScope: Record<string, string> = {
        "architecture-1": "in_diff",
        "architecture-2": "unrelated",
        "security-1": "in_diff",
        "security-2": "in_diff",
        "security-3": "unrelated",
        "tests-1": "in_diff",
        "tests-2": "in_diff",
      };
      for (const [id, scope] of Object.entries(expectedScope)) {
        strictEqual(
          byId[id].in_scope,
          scope,
          `finding ${id} expected in_scope ${scope}, got ${byId[id].in_scope}`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("triage_writesOnlyInsideSpecDir", () => {
    const tmp = freshTempDir();
    try {
      const { specDir, changedFiles } = setupCliFixture(tmp);
      const before = listFilesRecursive(tmp);

      execFileSync(
        process.execPath,
        [CLI_PATH, specDir, "--changed-files", changedFiles, "--json-only"],
        {
          cwd: tmp,
          encoding: "utf-8",
        },
      );

      const after = listFilesRecursive(tmp);
      const added = after.filter((p) => !before.includes(p));
      deepStrictEqual(added, ["docs/specs/fx/review-triage.json"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cli_missingChangedFiles_exitsTwoWithUsage", () => {
    const tmp = freshTempDir();
    try {
      const { specDir } = setupCliFixture(tmp);
      let threw = false;
      try {
        execFileSync(process.execPath, [CLI_PATH, specDir], {
          cwd: tmp,
          encoding: "utf-8",
        });
      } catch (e: unknown) {
        threw = true;
        const err = e as { status: number; stderr?: string };
        strictEqual(err.status, 2);
        ok(
          String(err.stderr ?? "").includes("--changed-files"),
          `expected stderr to mention --changed-files, got: ${err.stderr}`,
        );
      }
      ok(
        threw,
        "expected CLI to exit non-zero when --changed-files is missing",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("runTriage (unit, direct import)", () => {
  it("runTriage_fixture_directCall_matchesCliOutput", async () => {
    const tmp = freshTempDir();
    try {
      const { specDir, changedFiles } = setupCliFixture(tmp);
      const logged: Array<{ event: string; kv: Record<string, string> }> = [];
      const { json } = await runTriage(specDir, changedFiles, {
        config: DISABLED_CONFIG,
        env: {},
        log: (event, kv) => logged.push({ event, kv }),
      });

      const parsed = json as {
        findings: TriagedFinding[];
        backend: string;
        declined?: string;
      };
      strictEqual(parsed.findings.length, 7);
      strictEqual(parsed.backend, "heuristic");
      strictEqual(parsed.declined, "disabled");
      strictEqual(logged.length, 1);
      strictEqual(logged[0].event, "jev-declined");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
