# Review: jev-integration

Date: 2026-09-20
Reviewers: reviewer-architecture, reviewer-security, reviewer-tests (isolated contexts, `inherit` tier)
Base: `master` — `git diff --stat master...HEAD`: 59 files, +8,879 / −838
Raw reports: `review-raw/{architecture,security,tests}.md`; triage: `review-triage.json`
Revision count: 1 (round 1 FAILED on one verified HIGH; round 2 PASSED WITH NOTES)

## Triage (Synthesis step 0)

`node scripts/review-triage.ts docs/specs/jev-integration --changed-files docs/specs/jev-integration/review-raw/changed-files.txt`

Header of the written `review-triage.json`:

```
"backend": "heuristic", "declined": "disabled", "redactions": 2, "lift": null
```

Jev is off by default (`project_os.jev.enabled: false`, no `TYPESAFE_API_KEY`),
so the table came from the heuristic backend and there is no lift to quote.
The run is itself an end-to-end check of the feature under review: the
reviewer prose quoting the scanner's inline marker came back neutralized
(`scan-allow`) in both the table and the JSON, and two test names carrying a
high-entropy fixture were over-redacted to `[REDACTED:entropy]` — both by
design. 55 findings in, 2 heuristic duplicate pairs (tests-2↔architecture-1,
security-11↔architecture-8).

## Round 1 — GATE FAILED

### 🚫 MUST FIX (verified)

**tests-1 / HIGH / `scripts/review-triage.ts` applyAnswers, `scripts/lib/decide.ts` decide()**
`applyAnswers` merged every chunk's answers once any chunk reported
`backend: "jev"`. A chunk that declined (timeout, network) carries heuristic
stubs (`noul 0.5`, first choice with confidence 0), and a question rejected as
malformed is silently replaced by its stub with no record of which name was
replaced. Those stubs then cleared the consumer's own heuristic verdicts
(`0.5 < 0.85 → duplicate_of = null`) and flipped scope to `in_diff`
unconditionally. Verified by reading the code: `declined` was never
consulted and `Object.assign` merged all results.

Cited tasks: T185 (decide.ts Jev backend), T186 (review-triage.ts Jev path).

### Fix applied (commit 4c75006 — lead, direct edit)

- `DecisionResult.rejected: string[]` — names whose Jev answer failed
  validation and were replaced by the heuristic stub (empty on heuristic).
- `jevAnswers(results)` reads only `backend === "jev"` results and skips
  rejected names; used by both `applyAnswers` and the `--calibrate` path.
- `jev-queried` audit log now carries `declined` and `rejected` counts when
  any answer was rejected (closes architecture-3).
- Tests: `applyAnswers_declinedChunk_keepsHeuristicRows`,
  `applyAnswers_rejectedName_keepsHeuristicRow`,
  `jevAnswers_mixedResults_onlyAcceptedJevAnswers`; `decide` malformed and
  out-of-range tests assert `result.rejected`.
- Folded in from the notes below because the edit was already open:
  `--calibrate` double print (architecture-1 / tests-2), missing calibration
  review is a hard error (security-13 / tests-10), `main()` rejections exit
  1 with a message (tests-20), `config.model` allowlisted to
  `^[A-Za-z0-9._-]{1,64}$` (security-6), choice/score probabilities checked
  to [0,1] (security-7).

`node --test tests/decide.test.ts tests/review-triage.test.ts` → 55 pass, 0 fail.

### ⚠️ SHOULD FIX — security MEDIUMs, fixed in the same round (commit db38e74, implementer on opus)

- **security-1** denylist pair shapes: `KEY="value"`, `key = value`,
  `key: value` now redacted; separator preserved, quotes dropped; a
  `(?<!")` guard keeps JSON pairs single-pass.
- **security-2** hex entropy: all-hex tokens ≥32 chars redact at entropy
  ≥3.0 (`HEX_MIN_LEN`, `HEX_MIN_ENTROPY`), since 4.0 is unreachable for a
  16-symbol alphabet. `egress-allowlist.json` guard string updated.
- **security-3** inline scanner marker: `neutralizeScanMarkers` rewrites
  `scan:allow` → `scan-allow` before staging so no field can skip scrub and
  re-scan.
- Verified by lead read of the diff; `node --test tests/egress-guard.test.ts`
  → 33 pass, 0 fail. One existing test fixture changed prefix from a
  sensitive key to `sha:` so it still exercises the entropy pass.

Reflection: `/tools:reflect --trigger review-fail` was deferred to the ship
trigger — the fix landed in-session and the ship reflection sees the same
evidence.

## Round 2 — GATE PASSED WITH NOTES

No 🚫 items remain. Full suite (`bash scratchpad/gate.sh`, all 10 suites)
green before marking `[x]`; see the ship record for the final run.

### ⚠️ SHOULD FIX (left for the user)

- **architecture-2** `docs/maps/system-map.md`: the `review-triage.ts →
  decide.ts` and `decide.test.ts → decide.ts` edges are missing because
  `TS_IMPORT_RE` in `scripts/lib/system-map-lib.ts` is line-anchored and both
  files use multi-line imports. Pre-existing extractor gap, not this feature's
  code; a one-line regex change plus map heal. Worth a maintenance draft.
- **tests-3 / tests-4** `runTriage` (190 lines) and `decide()` (172 lines)
  exceed the 50-line guideline. Both are linear pipelines; splitting is
  cosmetic for a personal project but would help the next reviewer.
- **tests-5** `computeAgreement` re-implements `applyAnswers`' three
  threshold rules; derive one from the other so they cannot drift.
- **tests-6** `decide()` hardcodes `getProjectRoot()` for the guard, so
  Jev-path tests stage under the real repo's `.claude/logs/jev-test-*`.
  Add `projectRoot` to `DecideDeps`.
- **tests-7 / tests-8 / tests-11** boundary tests missing: noul exactly
  0.85, `unrelated` exactly 0.8, confidence exactly 0.8, `scoreToLevel` at
  0.5 / 2.5 / 3.0 and clamping, Jaccard `>= 0.6` branch.
- **tests-9** design-named cases missing in `decide.test.ts` (non-JSON body,
  `answers` absent, all answers rejected → heuristic backend, readJevConfig
  no-jev-block / unparseable). The named
  `decide_scrubSubprocessNonZero_declinesScrubFailed` case pins a real
  question: the guard ignores a non-zero scrub status and trusts only the
  positive re-scan. That is fail-closed (a leftover secret fails the
  re-scan), so the design line is the one to amend, not the guard.
- **security-8** `Bash(node scripts/review-triage.ts*)` auto-approves any
  argv; spec-dir and `--changed-files` paths are unconstrained. Acceptable
  for a solo repo; constrain to `docs/specs/` if this ever runs unattended.
- **security-4** `tests/fixtures/review-raw/security.md` carries a
  PAT-shaped literal, invisible only because `tests/fixtures/**` is
  path-ignored. Build it by concatenation as the other fixtures do.

### 💡 CONSIDER

- security-5 (`file`/`lines`/`id` written to the local JSON unscrubbed),
  security-9 (TOCTOU on the staging dir, same-user only), security-10
  (pre-existing wider-mode `jev/` never tightened), security-11 (scanner
  subprocess has no timeout), security-12 (`response.json()` unbounded;
  `timeout_ms` accepts any finite value).
- architecture-4 / tests-19 (`declined` header reports only `results[0]`),
  architecture-5 (`foo.ts:abc` keeps the whole token as `file`),
  architecture-6 (non-`unrelated` scope choice applied without threshold —
  defensible, documented here), architecture-7 (header `redactions` mixes
  wire and local counts), architecture-8/9 (`process.execPath`, third
  `cwd?` logger parameter — accepted deviations), architecture-10 (design
  line anchors into `scan-rules.js` stale after the prettier reformat).
- tests-12…31 hygiene: magic 0.6 / 3 literals, duplicated question-map
  construction in `buildQuestions`, unused `type Question` import, unread
  `opts.jsonOnly`, stale "later task" comments, `readJevConfig` returns the
  shared default by reference, hand-copied configs and fixture builders
  across the three test files, loose `>= 0` assertions, wall-clock timeout
  test, module-level `threeQuestions`/`happyDoc`, test-name form drift,
  `160000` literal, oversized single-finding chunk.

### ✅ PASSED

- Egress guard fails closed on every path (unsafe dir, write failure,
  subprocess throw, line-count mismatch, re-scan hit); staging is `wx` mode
  0o600 under a realpath-contained directory.
- `decide()` never throws; every decline reason is typed and logged; the
  heuristic backend always answers.
- Jev is off by default and requires both the settings flag and the API key.
- `bare-sk-token` scanner rule has positive and negative cases; pre-commit
  scan-diff ran clean on every integration commit.
- Review workflow wiring (`review.md` step 0) documents that triage is
  advisory and decides nothing.

### Disposition of the notes (2026-09-21, owner: close everything but the Jev calibration)

- architecture-2: fixed — `TS_IMPORT_RE` now captures multi-line imports; map healed (`fix(system-map): extract multi-line TypeScript imports`).
- tests-3 / tests-4 / tests-5 / tests-6 / tests-7 / tests-8 / tests-11 / tests-9 / security-4: fixed in `refactor(jev-integration): close review notes`; the design line for `decide_scrubSubprocessNonZero` amended to describe the fail-closed re-scan behaviour as shipped.
- security-8 (`Bash(node scripts/review-triage.ts*)` argv scope): closed, no change. The review itself judged it acceptable for a solo repo; the tool runs attended, under the lead, and reads only the spec directory it is pointed at. Revisit only if it ever runs unattended.
- 💡 CONSIDER (security-5/9/10/11/12, architecture-4..10, tests-12..31): considered and closed without change. They are hygiene and defence-in-depth items on a path that is off by default (`project_os.jev.enabled: false`, no key); none affects the heuristic path that runs today. Re-open the security ones together if the Jev flag is ever turned on for unattended use.
- Still open by owner decision: the Jev calibration run (`--calibrate` with a `TYPESAFE_API_KEY`), to be done locally.

### Observations for the ship-trigger reflection (not made here)

- The build-phase brief for a worktree worker should state that the
  worktree branches from the merge-base, so the brief's first command is a
  merge of the feature branch — every batch this session needed it.
- `.claude/rules/bash.md` was edited on this branch (ADR-backed) and #T189
  (compaction-gate) rode along; both are outside the jev-integration scope
  and should be called out in the PR.
