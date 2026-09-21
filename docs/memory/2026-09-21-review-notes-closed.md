# 2026-09-21 — Review notes closed (jev-integration, compaction-gate)

Every open ⚠️/💡 note from both reviews is now either fixed or closed by
owner decision with the reason recorded in the feature's `review.md`. The
only item still open is the Jev calibration run (`--calibrate` with a
`TYPESAFE_API_KEY`), to be done locally.

## What landed

- `fix(system-map)`: `extractTsImports` follows multi-line imports with a
  bounded per-line lookahead; the `review-triage.ts → decide.ts` and
  `decide.test.ts → decide.ts` edges are in the map.
- `refactor(compaction-gate)`: `sumUsage`, per-file replay and pin in
  directory mode, render helpers, named constants, `responseId` sanitized,
  `isMainThread` on `isSidechain` only. CLI output byte-identical; 17 tests.
- `refactor(jev-integration)`: `runTriage` and `decide()` split into
  helpers (50 and 44 lines), `computeAgreement` shares `applyAnswers`'
  thresholds, `DecideDeps.projectRoot`, boundary tests, fixture PAT built by
  concatenation, design line for the scrub-status test amended. 70 tests.
- `CLAUDE.md`: the compact-suggest nudge is the fire point minus 15 points.

## Lessons

- `docs/specs/` is tracked in Project OS itself; the "gitignored spec dir"
  wording in build/review briefs is for downstream projects.
- Cherry-picking worker commits conflicts on `docs/maps/*`; resolve with
  `--ours`, let pre-commit heal, then `system-map.ts check`.
- Three parallel workers with tight scope fences closed 20+ notes in one
  wave for about 460k sub-agent tokens; the jev worker took half of that.

Gate: 10/10 suites (125 s), scan-diff clean, map fresh, ROADMAP valid.
