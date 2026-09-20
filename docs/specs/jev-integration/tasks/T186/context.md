# Task T186 context

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

### T186: `review-triage.ts` Jev path: questions, chunking, thresholds, scrubbed output, calibrate
- **Depends on**: T184, T185
- **Files**: `scripts/review-triage.ts` (modify), `tests/review-triage.test.ts` (modify: append)
- **Pattern**: design.md "Key Interfaces" consumer paragraphs.
- **Implementation**:
  - `pick(f)` returns `{ severity, reviewer, file, lines, issue, fix }` and is the only accessor `buildQuestions` uses.
  - `buildQuestions(findings, c, changedFiles): { state: string; questions: QuestionMap }[]`: `state` is a plain-text block: a `Changed files:` list, then one `Finding <id>:` block per finding with the six picked fields as `key: value` lines. Questions: per pair `dup_<a>__<b>` `noul` "Findings <a> and <b> report the same defect" with `criteria: { true: "Same defect, same location or same root cause", false: "Different defects" }`; per finding `scope_<id>` `choice` with criteria `in_diff`/`adjacent`/`unrelated` described; per finding `sev_<id>` `score` with `["LOW","MEDIUM","HIGH","CRITICAL"]`. Chunk by finding so `JSON.stringify(chunk).length <= 160000`; pairs go in the chunk of their lower-id member, whose state must include both findings' blocks.
  - `applyAnswers(findings, c, results, thresholds)`: for each pair, if `noul >= duplicate_p` set `duplicate_of` on the higher id to the lower id and `duplicate_p = noul`; else clear the heuristic pairing and set `duplicate_p = noul`. Scope: use Jev's `choice` only if `probabilities[choice] >= out_of_scope_p` when it is `unrelated`, otherwise keep the heuristic scope; always record `in_scope_p`. Severity: map `score` to a level by `Math.round(score - 0.5 + Number.EPSILON)` clamped to `[0,3]` (half rounds down); replace `calibrated_severity` only if `confidence >= severity_confidence`; always record `severity_confidence`. Results from the heuristic backend leave everything as T184 set it.
  - Output scrubbing: before writing `review-triage.json`, run every `issue` and `fix` through `guardEgressFields` (same deps as decide; on refusal, write the string `[WITHHELD:scrub-failed]` for that field) so the local artifact never carries text the wire would not. Set `redactions` in the header to the guard's count.
  - `--calibrate`: skip thresholds; print a table with columns `id`, `heuristic dup`, `jev dup p`, `heuristic scope`, `jev scope`, `jev scope p`, `severity`, `jev severity`, `jev conf`; exit 0. Also accept repeated positional `<review-md>` paths after `--calibrate` and parse them with `parseFindings(text, "mixed")`.
  - CLI now calls `decide()` once per chunk with `consumer: "review-triage"` and the injected deps threaded from a small `deps` parameter on an exported `runTriage(specDir, changedFilesPath, deps)` so tests can inject `fetchImpl`.
- **Tests**:
  - `tests/review-triage.test.ts` (append):
    - Test: `buildQuestions_bodyContainsOnlyWhitelistedFields` — Setup: findings carry an extra `internalNote: "SECRETNOTE"` property. Assert: `JSON.stringify(chunks)` contains each of the six field names and does not contain `SECRETNOTE` or `internalNote`.
    - Test: `buildQuestions_questionNamesAndTypes_asSpecified` — Assert: for the fixture, keys `dup_architecture-1__security-1`, `scope_security-3`, `sev_tests-1` exist with the right `type` and criteria.
    - Test: `buildQuestions_manyFindings_chunksUnderLimit` — Setup: 300 synthetic findings with 200-char issues. Assert: every chunk's serialized length `<= 160000` and every pair's members share a chunk.
    - Test: `applyAnswers_dupAboveThreshold_merged_belowCleared` — Setup: two pairs with `noul` 0.9 and 0.5, threshold 0.85. Assert: first has `duplicate_of` set and `duplicate_p === 0.9`; second `duplicate_of === null`, `duplicate_p === 0.5`.
    - Test: `applyAnswers_scoreHalf_roundsDown` — Setup: `score: 1.5`, confidence 0.9. Assert: `calibrated_severity === "MEDIUM"`.
    - Test: `applyAnswers_lowConfidence_keepsOriginalSeverity` — Setup: `score: 3`, confidence 0.5. Assert: `calibrated_severity === severity`, `severity_confidence === 0.5`.
    - Test: `runTriage_fixture_jevStub_appliesThresholds` — Setup: copied root, settings `enabled:true`, `env.TYPESAFE_API_KEY="k"`, stub scrub/scan, `fetchImpl` returning answers built from the request (dup pairs 0.9 for A1/S1 and 0.5 for S2/Q2, scope `unrelated` at 0.95 for S3, everything else in_diff 0.9, all severities unchanged at confidence 0.9). Assert: `security-1.duplicate_of === "architecture-1"`, `tests-2.duplicate_of === null`, `security-3.in_scope === "unrelated"`, `backend === "jev"`.
    - Test: `runTriage_outputJson_isScrubbed_evenOnHeuristicPath` — Setup: `enabled:false`; real scrub via copied scanner. Assert: `review-triage.json` contains `[REDACTED:` and not the fixture's `ghp_` token; header `redactions >= 1`.
    - Test: `runTriage_calibrate_printsProbabilitiesWithoutApplying` — Setup: jev stub as above with `--calibrate`. Assert: stdout has a `jev dup p` column and `0.9`; no `review-triage.json` is written.
- **Acceptance Criteria**:
  - [ ] `buildQuestions` reads findings only through `pick()` (grep shows no other property access on `Finding` objects in that function)
  - [ ] `node --test tests/review-triage.test.ts` passes, including the T184 tests unchanged
- **Size**: Medium
- **Status**: [?]
