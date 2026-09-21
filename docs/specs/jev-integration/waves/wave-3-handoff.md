---
wave: 3
completed_tasks: [T185, T186]
failed_tasks: []
files_changed:
  - scripts/lib/decide.ts
  - tests/decide.test.ts
  - scripts/review-triage.ts
  - tests/review-triage.test.ts
goal_satisfied: true
---
## Gotchas
- `decide()` stores a fractional Jev `score` raw; `applyAnswers` in review-triage.ts rounds half-down to a level. A partially malformed response logs `jev-queried` with `declined: "malformed-response"`; only zero accepted answers logs `jev-declined`.
- Every `runTriage` run now logs two events: decide's `jev-queried`/`jev-declined` and the run's own `review-triaged`. Tests that count log events must expect both.
- The output scrub in review-triage.ts stages through `.claude/logs/jev` under `projectRoot`; tests pass `projectRoot: tmp` so nothing touches the real repo.
- `AbortSignal.timeout()`'s timer is unref'd under `node --test`; a stub that waits on the abort event needs a ref'd keep-alive.

## Follow-ups for later waves
- T187 documents three events (`jev-queried`, `jev-declined`, `review-triaged`) and the lift grep; the CLI usage line is now `node scripts/review-triage.ts <spec-dir> --changed-files <path> [--json-only] [--calibrate [<review-md> ...]]`.
- T188's ADR `### Calibration record` cites `review-triage-calibration.json` (written by `--calibrate` into the spec dir) and the `review-triaged` grep as the two records of measured lift.
