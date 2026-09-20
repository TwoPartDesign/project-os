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
  buildQuestions,
  applyAnswers,
  jevAnswers,
  type Finding,
  type TriagedFinding,
  type Candidates,
} from "../scripts/review-triage.ts";
import { getProjectRoot } from "../scripts/lib/project-root.ts";
import type { DecisionResult } from "../scripts/lib/decide.ts";

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

/**
 * A fresh, real-repo-relative egress-scrub directory, mirroring
 * tests/decide.test.ts's own `freshEgressDir`: `decide()` always resolves
 * its outbound-guard's project root via `getProjectRoot()` internally (it
 * takes no `projectRoot` dep), so a Jev-enabled test must stage under the
 * real repo — never a temp root — and clean up after itself.
 */
function freshEgressDir(): string {
  return mkdtempSync(resolve(getProjectRoot(), ".claude/logs", "jev-test-"));
}

/**
 * Copies the real security scanner (`scripts/security-scanner.ts`,
 * `scripts/lib/scan-rules.js`, `.claude/security/allowlist.json`) into
 * `tmp` so `guardEgressFields`'s default (real) scrub/scan commands can run
 * against it, mirroring `tests/egress-guard.test.ts`'s
 * `withCopiedScannerRoot`.
 */
function copyScannerInto(tmp: string): void {
  mkdirSync(resolve(tmp, "scripts/lib"), { recursive: true });
  mkdirSync(resolve(tmp, ".claude/security"), { recursive: true });
  cpSync(
    resolve(PROJECT_ROOT, "scripts/security-scanner.ts"),
    resolve(tmp, "scripts/security-scanner.ts"),
  );
  cpSync(
    resolve(PROJECT_ROOT, "scripts/lib/scan-rules.js"),
    resolve(tmp, "scripts/lib/scan-rules.js"),
  );
  cpSync(
    resolve(PROJECT_ROOT, ".claude/security/allowlist.json"),
    resolve(tmp, ".claude/security/allowlist.json"),
  );
}

/** A `JevConfig`-shaped object with jev enabled, for tests that stub the Jev HTTP call. */
const ENABLED_CONFIG = {
  enabled: true,
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
 * A `fetchImpl` stand-in for the Jev endpoint, built for the fixture in
 * `tests/fixtures/review-raw/`. Parses the request body's `questions` and
 * answers each per the T186 test brief: the architecture-1/security-1 dup
 * pair gets noul 0.9 (above the 0.85 threshold), every other dup pair gets
 * 0.5 (below); `scope_security-3` is `"unrelated"` at 0.95 confidence;
 * every other `scope_` is `"in_diff"` at 0.9 confidence; every `sev_`
 * answer echoes the finding's own severity index — parsed back out of the
 * request body's own `state` text — at 0.9 confidence.
 */
function jevFetchStub(): typeof fetch {
  const LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const state: string = body.state ?? "";
    const questions: Record<string, { type: string }> = body.questions ?? {};
    const answers: Record<string, unknown> = {};

    const severityIndexById = new Map<string, number>();
    for (const m of state.matchAll(/Finding ([^\n:]+):\nseverity: (\w+)/g)) {
      severityIndexById.set(m[1], LEVELS.indexOf(m[2]));
    }

    for (const name of Object.keys(questions)) {
      if (name.startsWith("dup_")) {
        answers[name] = {
          type: "noul",
          noul: name === "dup_architecture-1__security-1" ? 0.9 : 0.5,
        };
      } else if (name === "scope_security-3") {
        answers[name] = {
          type: "choice",
          choice: "unrelated",
          probabilities: { in_diff: 0.02, adjacent: 0.03, unrelated: 0.95 },
          confidence: 0.95,
        };
      } else if (name.startsWith("scope_")) {
        answers[name] = {
          type: "choice",
          choice: "in_diff",
          probabilities: { in_diff: 0.9, adjacent: 0.05, unrelated: 0.05 },
          confidence: 0.9,
        };
      } else if (name.startsWith("sev_")) {
        const id = name.slice("sev_".length);
        answers[name] = {
          type: "score",
          score: severityIndexById.get(id) ?? 0,
          probabilities: {},
          confidence: 0.9,
        };
      }
    }

    return new Response(
      JSON.stringify({
        answers,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
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
        // T186 adds a real output-scrub step that runs regardless of
        // backend; pin it to the temp root so it never touches this
        // repo's own .claude/logs/ (see tests/fixtures note in
        // docs/specs/jev-integration/tasks/T186/context.md).
        projectRoot: tmp,
      });

      const parsed = json as {
        findings: TriagedFinding[];
        backend: string;
        declined?: string;
      };
      strictEqual(parsed.findings.length, 7);
      strictEqual(parsed.backend, "heuristic");
      strictEqual(parsed.declined, "disabled");
      // T186: decide()'s own "jev-declined" event, then this run's new
      // "review-triaged" lift-record event (dup_pairs/dup_changed/etc. are
      // logged for every run, per the T186 spec).
      strictEqual(logged.length, 2);
      strictEqual(logged[0].event, "jev-declined");
      strictEqual(logged[1].event, "review-triaged");
      strictEqual(logged[1].kv.backend, "heuristic");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("buildQuestions", () => {
  it("buildQuestions_bodyContainsOnlyWhitelistedFields", () => {
    const findings = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "one.ts",
        lines: "1",
        issue: "issue text",
        fix: "fix text",
        internalNote: "SECRETNOTE",
      },
    ] as unknown as Finding[];
    const candidates: Candidates = { pairs: [], scope: { "a-1": "in_diff" } };

    const chunks = buildQuestions(findings, candidates, ["one.ts"]);
    const serialized = JSON.stringify(chunks);

    for (const field of [
      "severity",
      "reviewer",
      "file",
      "lines",
      "issue",
      "fix",
    ]) {
      ok(
        serialized.includes(field),
        `expected chunks to mention field name "${field}"`,
      );
    }
    ok(
      !serialized.includes("SECRETNOTE"),
      "chunks must not leak internalNote's value",
    );
    ok(
      !serialized.includes("internalNote"),
      "chunks must not leak the internalNote key",
    );
  });

  it("buildQuestions_questionNamesAndTypes_asSpecified", () => {
    const findings: Finding[] = [];
    for (const reviewer of ["architecture", "security", "tests"] as const) {
      const text = readFileSync(
        resolve(FIXTURES_DIR, `${reviewer}.md`),
        "utf-8",
      );
      findings.push(...parseFindings(text, reviewer));
    }
    const changedFiles = readFileSync(
      resolve(FIXTURES_DIR, "changed-files.txt"),
      "utf-8",
    )
      .split(/\r\n|\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const candidates = heuristicCandidates(findings, changedFiles);
    // The fixture's only two candidate pairs, confirmed by
    // triage_fixture_heuristicBackend_marksTwoDuplicatesOneOutOfScope above:
    // architecture-1/security-1 (same file, overlapping lines) and
    // security-2/tests-2 (same file, exact line match).
    deepStrictEqual(candidates.pairs, [
      ["architecture-1", "security-1"],
      ["security-2", "tests-2"],
    ]);

    const chunks = buildQuestions(findings, candidates, changedFiles);
    const allQuestions: Record<string, any> = {};
    for (const chunk of chunks) Object.assign(allQuestions, chunk.questions);

    const dup = allQuestions["dup_architecture-1__security-1"];
    ok(dup, "expected dup_architecture-1__security-1 question to exist");
    strictEqual(dup.type, "noul");
    ok("true" in dup.criteria, "expected noul criteria.true");
    ok("false" in dup.criteria, "expected noul criteria.false");

    const scope = allQuestions["scope_security-3"];
    ok(scope, "expected scope_security-3 question to exist");
    strictEqual(scope.type, "choice");
    deepStrictEqual(Object.keys(scope.criteria).sort(), [
      "adjacent",
      "in_diff",
      "unrelated",
    ]);

    const sev = allQuestions["sev_tests-1"];
    ok(sev, "expected sev_tests-1 question to exist");
    strictEqual(sev.type, "score");
    deepStrictEqual(sev.criteria, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("buildQuestions_manyFindings_chunksUnderLimit", () => {
    const findings: Finding[] = [];
    for (let i = 1; i <= 300; i++) {
      findings.push({
        id: `synthetic-${i}`,
        reviewer: "synthetic",
        severity: "LOW",
        file: `scripts/file${i}.ts`,
        lines: "1",
        issue: "x".repeat(200),
        fix: "fix it",
      });
    }
    const pairs: [string, string][] = [];
    for (let i = 1; i < 300; i++) {
      pairs.push([`synthetic-${i}`, `synthetic-${i + 1}`]);
    }
    const candidates: Candidates = { pairs, scope: {} };

    const chunks = buildQuestions(findings, candidates, []);

    for (const chunk of chunks) {
      const size = JSON.stringify(chunk).length;
      ok(size <= 160000, `expected chunk size <= 160000, got ${size}`);
    }

    for (const [lo, hi] of pairs) {
      const chunk = chunks.find((c) => `dup_${lo}__${hi}` in c.questions);
      ok(chunk, `expected a chunk holding dup_${lo}__${hi}`);
      ok(
        chunk!.state.includes(`Finding ${lo}:`),
        `expected chunk state to include Finding ${lo}: block`,
      );
      ok(
        chunk!.state.includes(`Finding ${hi}:`),
        `expected chunk state to include Finding ${hi}: block`,
      );
    }
  });
});

describe("applyAnswers", () => {
  it("applyAnswers_dupAboveThreshold_merged_belowCleared", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i1",
        fix: "f1",
      },
      {
        id: "b-1",
        reviewer: "b",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i2",
        fix: "f2",
      },
      {
        id: "c-1",
        reviewer: "c",
        severity: "LOW",
        file: "y.ts",
        lines: "1",
        issue: "i3",
        fix: "f3",
      },
      {
        id: "d-1",
        reviewer: "d",
        severity: "LOW",
        file: "y.ts",
        lines: "1",
        issue: "i4",
        fix: "f4",
      },
    ];
    const candidates: Candidates = {
      pairs: [
        ["a-1", "b-1"],
        ["c-1", "d-1"],
      ],
      scope: {
        "a-1": "in_diff",
        "b-1": "in_diff",
        "c-1": "in_diff",
        "d-1": "in_diff",
      },
    };
    const thresholds = {
      duplicate_p: 0.85,
      out_of_scope_p: 0.8,
      severity_confidence: 0.8,
    };
    const results: DecisionResult[] = [
      {
        answers: {
          "dup_a-1__b-1": { type: "noul", noul: 0.9 },
          "dup_c-1__d-1": { type: "noul", noul: 0.5 },
        },
        backend: "jev",
        redactions: 0,
        duration_ms: 1,
      },
    ];

    const rows = applyAnswers(findings, candidates, results, thresholds);
    const byId: Record<string, TriagedFinding> = {};
    for (const r of rows) byId[r.id] = r;

    strictEqual(byId["b-1"].duplicate_of, "a-1");
    strictEqual(byId["b-1"].duplicate_p, 0.9);
    strictEqual(byId["d-1"].duplicate_of, null);
    strictEqual(byId["d-1"].duplicate_p, 0.5);
  });

  it("applyAnswers_scoreHalf_roundsDown", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i",
        fix: "f",
      },
    ];
    const candidates: Candidates = { pairs: [], scope: { "a-1": "in_diff" } };
    const thresholds = {
      duplicate_p: 0.85,
      out_of_scope_p: 0.8,
      severity_confidence: 0.8,
    };
    const results: DecisionResult[] = [
      {
        answers: {
          "sev_a-1": {
            type: "score",
            score: 1.5,
            probabilities: {},
            confidence: 0.9,
          },
        },
        backend: "jev",
        redactions: 0,
        duration_ms: 1,
      },
    ];

    const rows = applyAnswers(findings, candidates, results, thresholds);
    strictEqual(rows[0].calibrated_severity, "MEDIUM");
  });

  it("applyAnswers_lowConfidence_keepsOriginalSeverity", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "HIGH",
        file: "x.ts",
        lines: "1",
        issue: "i",
        fix: "f",
      },
    ];
    const candidates: Candidates = { pairs: [], scope: { "a-1": "in_diff" } };
    const thresholds = {
      duplicate_p: 0.85,
      out_of_scope_p: 0.8,
      severity_confidence: 0.8,
    };
    const results: DecisionResult[] = [
      {
        answers: {
          "sev_a-1": {
            type: "score",
            score: 3,
            probabilities: {},
            confidence: 0.5,
          },
        },
        backend: "jev",
        redactions: 0,
        duration_ms: 1,
      },
    ];

    const rows = applyAnswers(findings, candidates, results, thresholds);
    strictEqual(rows[0].calibrated_severity, rows[0].severity);
    strictEqual(rows[0].severity_confidence, 0.5);
  });

  it("applyAnswers_declinedChunk_keepsHeuristicRows", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i1",
        fix: "f1",
      },
      {
        id: "b-1",
        reviewer: "b",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i2",
        fix: "f2",
      },
      {
        id: "c-1",
        reviewer: "c",
        severity: "HIGH",
        file: "y.ts",
        lines: "1",
        issue: "i3",
        fix: "f3",
      },
    ];
    const candidates: Candidates = {
      pairs: [["a-1", "b-1"]],
      scope: { "a-1": "in_diff", "b-1": "in_diff", "c-1": "adjacent" },
    };
    const thresholds = {
      duplicate_p: 0.85,
      out_of_scope_p: 0.8,
      severity_confidence: 0.8,
    };
    // Chunk 1 timed out: its answers are heuristic stubs (noul 0.5, first
    // choice with confidence 0) and must NOT override applyHeuristic's rows.
    const declined: DecisionResult = {
      answers: {
        "dup_a-1__b-1": { type: "noul", noul: 0.5 },
        "scope_b-1": {
          type: "choice",
          choice: "in_diff",
          probabilities: { in_diff: 0.34, adjacent: 0.33, unrelated: 0.33 },
          confidence: 0,
        },
      },
      backend: "heuristic",
      declined: "timeout",
      rejected: [],
      redactions: 0,
      duration_ms: 1,
    };
    // Chunk 2 answered: its sev answer is applied.
    const answered: DecisionResult = {
      answers: {
        "sev_c-1": {
          type: "score",
          score: 3,
          probabilities: {},
          confidence: 0.95,
        },
      },
      backend: "jev",
      rejected: [],
      redactions: 0,
      duration_ms: 1,
    };

    const rows = applyAnswers(
      findings,
      candidates,
      [declined, answered],
      thresholds,
    );
    const byId: Record<string, TriagedFinding> = {};
    for (const r of rows) byId[r.id] = r;

    strictEqual(byId["b-1"].duplicate_of, "a-1");
    strictEqual(byId["b-1"].duplicate_p, 1);
    strictEqual(byId["b-1"].in_scope, "in_diff");
    strictEqual(byId["b-1"].in_scope_p, 1);
    strictEqual(byId["c-1"].calibrated_severity, "CRITICAL");
    strictEqual(byId["c-1"].severity_confidence, 0.95);
  });

  it("applyAnswers_rejectedName_keepsHeuristicRow", () => {
    const findings: Finding[] = [
      {
        id: "a-1",
        reviewer: "a",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i1",
        fix: "f1",
      },
      {
        id: "b-1",
        reviewer: "b",
        severity: "LOW",
        file: "x.ts",
        lines: "1",
        issue: "i2",
        fix: "f2",
      },
    ];
    const candidates: Candidates = {
      pairs: [["a-1", "b-1"]],
      scope: { "a-1": "in_diff", "b-1": "in_diff" },
    };
    const thresholds = {
      duplicate_p: 0.85,
      out_of_scope_p: 0.8,
      severity_confidence: 0.8,
    };
    // Jev answered the chunk, but the dup question failed validation and
    // decide() substituted the heuristic stub (noul 0.5) and listed it in
    // `rejected`. The stub must not clear applyHeuristic's duplicate verdict.
    const results: DecisionResult[] = [
      {
        answers: {
          "dup_a-1__b-1": { type: "noul", noul: 0.5 },
          "sev_b-1": {
            type: "score",
            score: 0,
            probabilities: {},
            confidence: 0.9,
          },
        },
        backend: "jev",
        declined: "malformed-response",
        rejected: ["dup_a-1__b-1"],
        redactions: 0,
        duration_ms: 1,
      },
    ];

    const rows = applyAnswers(findings, candidates, results, thresholds);
    const byId: Record<string, TriagedFinding> = {};
    for (const r of rows) byId[r.id] = r;

    strictEqual(byId["b-1"].duplicate_of, "a-1");
    strictEqual(byId["b-1"].duplicate_p, 1);
    strictEqual(byId["b-1"].calibrated_severity, "LOW");
    strictEqual(byId["b-1"].severity_confidence, 0.9);
  });

  it("jevAnswers_mixedResults_onlyAcceptedJevAnswers", () => {
    const results: DecisionResult[] = [
      {
        answers: { q_h: { type: "noul", noul: 0.5 } },
        backend: "heuristic",
        declined: "disabled",
        rejected: [],
        redactions: 0,
        duration_ms: 0,
      },
      {
        answers: {
          q_ok: { type: "noul", noul: 0.9 },
          q_bad: { type: "noul", noul: 0.5 },
        },
        backend: "jev",
        declined: "malformed-response",
        rejected: ["q_bad"],
        redactions: 0,
        duration_ms: 1,
      },
    ];
    deepStrictEqual(Object.keys(jevAnswers(results)), ["q_ok"]);
  });
});

describe("runTriage — Jev path", () => {
  it("runTriage_fixture_jevStub_appliesThresholds", async () => {
    const tmp = freshTempDir();
    const egressDir = freshEgressDir();
    try {
      const specDir = resolve(tmp, "docs/specs/fx");
      mkdirSync(resolve(specDir, "review-raw"), { recursive: true });
      cpSync(FIXTURES_DIR, resolve(specDir, "review-raw"), {
        recursive: true,
      });
      const changedFiles = resolve(specDir, "review-raw/changed-files.txt");

      const { json } = await runTriage(specDir, changedFiles, {
        config: ENABLED_CONFIG,
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl: jevFetchStub(),
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: () => {},
      });

      const parsed = json as { findings: TriagedFinding[]; backend: string };
      const byId: Record<string, TriagedFinding> = {};
      for (const f of parsed.findings) byId[f.id] = f;

      strictEqual(byId["security-1"].duplicate_of, "architecture-1");
      strictEqual(byId["tests-2"].duplicate_of, null);
      strictEqual(byId["security-3"].in_scope, "unrelated");
      strictEqual(parsed.backend, "jev");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("runTriage_outputJson_isScrubbed_evenOnHeuristicPath", async () => {
    const tmp = freshTempDir();
    try {
      const { specDir, changedFiles } = setupCliFixture(tmp);
      copyScannerInto(tmp);

      const { json } = await runTriage(specDir, changedFiles, {
        config: DISABLED_CONFIG,
        env: {},
        projectRoot: tmp,
        log: () => {},
      });

      const raw = readFileSync(resolve(specDir, "review-triage.json"), "utf-8");
      ok(
        raw.includes("[REDACTED:"),
        `expected a redaction marker in the written JSON, got:\n${raw}`,
      );
      // Built by concatenation (never as a literal) so this planted
      // fixture secret itself never lands in the diff.
      const plantedSecret = "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789";
      ok(
        !raw.includes(plantedSecret),
        "the planted ghp_ token must not appear in the written JSON",
      );

      const parsed = json as { redactions: number };
      ok(
        parsed.redactions >= 1,
        `expected header redactions >= 1, got ${parsed.redactions}`,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runTriage_calibrate_printsProbabilitiesWithoutApplying", async () => {
    const tmp = freshTempDir();
    const egressDir = freshEgressDir();
    try {
      const specDir = resolve(tmp, "docs/specs/fx");
      mkdirSync(resolve(specDir, "review-raw"), { recursive: true });
      cpSync(FIXTURES_DIR, resolve(specDir, "review-raw"), {
        recursive: true,
      });
      const changedFiles = resolve(specDir, "review-raw/changed-files.txt");

      const { table } = await runTriage(specDir, changedFiles, {
        config: ENABLED_CONFIG,
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl: jevFetchStub(),
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        calibrate: true,
        log: () => {},
      });

      ok(
        table.includes("jev dup p"),
        `expected a "jev dup p" column, got:\n${table}`,
      );
      ok(
        table.includes("0.9"),
        `expected a 0.9 probability value in the table, got:\n${table}`,
      );
      ok(
        !existsSync(resolve(specDir, "review-triage.json")),
        "review-triage.json must not be written in --calibrate mode",
      );

      const calPath = resolve(specDir, "review-triage-calibration.json");
      ok(
        existsSync(calPath),
        "expected review-triage-calibration.json to be written",
      );
      const calibration = JSON.parse(readFileSync(calPath, "utf-8"));
      strictEqual(calibration.agreement.dup.total, 2);
      // The security-2/tests-2 pair's 0.5 noul (below the 0.85 threshold)
      // disagrees with the heuristic's pairing (which merged them, so its
      // heuristic answer was "duplicate"); the architecture-1/security-1
      // pair's 0.9 noul agrees with the heuristic's pairing. So exactly 1
      // of 2 pairs agrees.
      strictEqual(calibration.agreement.dup.agreed, 1);
      strictEqual(calibration.rows.length, 7);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("runTriage_jevStub_recordsLiftInHeaderAndLog", async () => {
    const tmp = freshTempDir();
    const egressDir = freshEgressDir();
    try {
      const specDir = resolve(tmp, "docs/specs/fx");
      mkdirSync(resolve(specDir, "review-raw"), { recursive: true });
      cpSync(FIXTURES_DIR, resolve(specDir, "review-raw"), {
        recursive: true,
      });
      const changedFiles = resolve(specDir, "review-raw/changed-files.txt");

      const logged: Array<{ event: string; kv: Record<string, string> }> = [];
      const { json } = await runTriage(specDir, changedFiles, {
        config: ENABLED_CONFIG,
        env: { TYPESAFE_API_KEY: "k" },
        fetchImpl: jevFetchStub(),
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        egressDir,
        log: (event, kv) => logged.push({ event, kv }),
      });

      const parsed = json as { lift: unknown };
      // architecture-2's scope flips heuristic "unrelated" -> Jev "in_diff"
      // (it gets the blanket "in_diff" answer every non-security-3 finding
      // gets in this stub), so scope_changed is 1; the security-2/tests-2
      // pair's 0.5 noul clears the heuristic's pairing, so dup_changed is 1;
      // every severity answer echoes its heuristic index, so
      // severity_changed is 0. See tests/fixtures/review-raw/ and
      // docs/specs/jev-integration/tasks/T186/context.md.
      deepStrictEqual(parsed.lift, {
        dup_pairs: 2,
        dup_changed: 1,
        scope_changed: 1,
        severity_changed: 0,
      });

      const triagedEvents = logged.filter((l) => l.event === "review-triaged");
      strictEqual(triagedEvents.length, 1);
      strictEqual(triagedEvents[0].kv.backend, "jev");
      strictEqual(triagedEvents[0].kv.severity_changed, "0");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(egressDir, { recursive: true, force: true });
    }
  });

  it("runTriage_heuristicPath_liftIsNull", async () => {
    const tmp = freshTempDir();
    try {
      const { specDir, changedFiles } = setupCliFixture(tmp);
      const logged: Array<{ event: string; kv: Record<string, string> }> = [];

      const { json } = await runTriage(specDir, changedFiles, {
        config: DISABLED_CONFIG,
        env: {},
        projectRoot: tmp,
        scrubCmd: () => ({ status: 0 }),
        scanCmd: () => ({ status: 0 }),
        log: (event, kv) => logged.push({ event, kv }),
      });

      const parsed = json as { lift: unknown };
      strictEqual(parsed.lift, null);

      const triagedEvents = logged.filter((l) => l.event === "review-triaged");
      strictEqual(triagedEvents.length, 1);
      strictEqual(triagedEvents[0].kv.backend, "heuristic");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
