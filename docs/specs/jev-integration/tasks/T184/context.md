# Task T184 context

Feature: jev-integration
Source: ../../tasks.md
Design: ../../design.md

Common rules for every task:
- Tests use `node:test`, one fixture per test, no shared `beforeEach`,
  names `[unit]_[scenario]_[expected]`, specific-value assertions, error
  message content asserted. Any test needing a project root copies the
  needed files into a `mkdtempSync` directory and never touches this repo's
  `.claude/logs/` or `docs/specs/`.
- All `execFileSync` calls take argv arrays. No shell strings.
- Every exported function has a docstring.
- No runtime npm dependency. Node `>=22.18` only.
- Run only the suite covering the file you changed:
  `node --test tests/<name>.test.ts`.

### T184: `review-triage.ts` heuristic path: parse, candidates, table, JSON, CLI
- **Depends on**: T179, T182
- **Files**: `scripts/review-triage.ts` (create), `tests/review-triage.test.ts` (create)
- **Pattern**: CLI shape and `parseArgs` as in `scripts/maintain-draft.ts:37-58`; `isMain` guard as in `scripts/knowledge-index.ts:1165-1166` so the module can be imported by tests without running the CLI. Markdown table escaping: replace `|` with `\|`.
- **Implementation**:
  - Types: `Finding = { id: string; reviewer: "architecture"|"security"|"tests"; severity: Severity; file: string; lines: string; issue: string; fix: string }`, `Candidates = { pairs: [string, string][]; scope: Record<string, "in_diff"|"adjacent"|"unrelated"> }`, `TriagedFinding` = `Finding` plus `duplicate_of: string|null`, `duplicate_p: number`, `in_scope`, `in_scope_p`, `calibrated_severity`, `severity_confidence`.
  - `parseFindings(text, reviewer)`: a finding line matches `/^(CRITICAL|HIGH|MEDIUM|LOW) \/ /`. Split at the first two ` / ` for severity and `file:lines`; split the remainder at its **last** ` / ` into issue and fix. `file:lines` splits at the last `:`; if no `:` then `lines = ""`. `id = <reviewer>-<1-based index>`. A line that starts with a severity word but yields fewer than four parts is skipped and `process.stderr.write` receives `review-triage: unparseable finding line: <line>\n`.
  - `heuristicCandidates(findings, changedFiles)`: pairs `(a, b)` with `a.id < b.id` where normalized file paths are equal and line ranges overlap or touch (parse `N` or `N-M`; empty means whole file, overlaps everything), **or** token Jaccard of the ISSUE texts (lowercased, split on non-alphanumerics, tokens of length 3+, prefix `DRIFT:`/`VULN:`/`ISSUE:` removed) is at or above `0.6`. Scope: `in_diff` if file is in `changedFiles`; else `adjacent` if any changed file has the same `dirname`; else `unrelated`.
  - `applyHeuristic(findings, c)`: `duplicate_of` = the lowest-id partner, `duplicate_p = 1`, `in_scope_p = 1`, `calibrated_severity = severity`, `severity_confidence = 0`.
  - `renderTable(rows)`: header `| id | sev | file:lines | scope | dup of | issue |`, cells escaped.
  - CLI `node scripts/review-triage.ts <spec-dir> --changed-files <path> [--json-only]`: reads `<spec-dir>/review-raw/{architecture,security,tests}.md` (missing file = zero findings, warn on stderr), reads the changed-files list (one path per line, blank lines ignored), calls `decide(state="", questions={}, { consumer: "review-triage", config: readJevConfig() })` **only to obtain `backend`/`declined`** for the JSON header in this task, writes `<spec-dir>/review-triage.json` `{ feature: basename(specDir), advisory: true, backend, declined, redactions: 0, findings }`, prints the table unless `--json-only`. Exit `0`; exit `2` on bad arguments with the usage text.
- **Tests**:
  - `tests/review-triage.test.ts`:
    - Test: `parseFindings_threeReviewerPrefixes_extractsFields` — Setup: one `DRIFT:`, one `VULN:`, one `ISSUE:` line. Assert: for each, `severity`, `file`, `lines`, `issue` (starts with the prefix), `fix`, `reviewer`, `id` equal the expected literals.
    - Test: `parseFindings_slashInsideIssue_splitsAtLastSeparator` — Setup: `LOW / a.ts:1 / ISSUE: x / y / fix z`. Assert: `issue === "ISSUE: x / y"`, `fix === "fix z"`.
    - Test: `parseFindings_fileWithoutLines_linesEmpty` — Setup: `LOW / docs/x.md / DRIFT: a / b`. Assert: `file === "docs/x.md"`, `lines === ""`.
    - Test: `parseFindings_nonFindingLines_ignored` — Setup: `PASS:`, `CONCERN:`, prose. Assert: length `0`.
    - Test: `parseFindings_severityLineUnparseable_warnsWithLine` — Setup: `HIGH / only-two-parts`; capture stderr by injecting a `warn` function parameter (add optional `warn = (s) => process.stderr.write(s)`). Assert: warning contains `unparseable finding line: HIGH / only-two-parts`.
    - Test: `heuristicCandidates_sameFileOverlappingLines_pairsThem` — Setup: `a.ts:40-58` and `a.ts:41-57`. Assert: `pairs` deep-equals `[["architecture-1","security-1"]]`.
    - Test: `heuristicCandidates_jaccardBelowThreshold_noPair` — Setup: different files, unrelated text. Assert: `pairs.length === 0`.
    - Test: `heuristicCandidates_scope_inDiffAdjacentUnrelated` — Setup: changed `["scripts/alpha.ts"]`; findings at `scripts/alpha.ts`, `scripts/beta.ts`, `docs/x.md`. Assert: `in_diff`, `adjacent`, `unrelated`.
    - Test: `triage_fixture_heuristicBackend_marksTwoDuplicatesOneOutOfScope` — Setup: copy `tests/fixtures/review-raw/` into `<tmp>/docs/specs/fx/review-raw/`; run the CLI via `execFileSync("node", [...])` with `cwd` = tmp root and a settings file with `enabled:false`. Assert: JSON has `findings.length === 7`, `security-1.duplicate_of === "architecture-1"`, `tests-2.duplicate_of === "security-2"`, `security-3.in_scope === "unrelated"`, every other `in_scope !== "unrelated"`, `backend === "heuristic"`, `advisory === true`.
    - Test: `renderTable_pipeInIssueText_escaped` — Setup: issue `a|b`. Assert: the row contains `a\|b` and splits into exactly seven `|`-separated cells.
    - Test: `triage_writesOnlyInsideSpecDir` — Setup: as the fixture test; list every file under the tmp root before and after. Assert: the only new path is `docs/specs/fx/review-triage.json`.
- **Acceptance Criteria**:
  - [ ] Importing the module in a test does not execute the CLI
  - [ ] All fixture assertions above hold against `tests/fixtures/review-raw/`
  - [ ] `node --test tests/review-triage.test.ts` passes
- **Size**: Medium
- **Status**: [?]
