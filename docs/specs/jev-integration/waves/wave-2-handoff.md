---
wave: 2
completed_tasks: [T183, T184]
failed_tasks: []
files_changed:
  - scripts/lib/egress-guard.ts
  - tests/egress-guard.test.ts
  - scripts/review-triage.ts
  - tests/review-triage.test.ts
goal_satisfied: true
---
## Gotchas
- `guardEgressFields(fields, { projectRoot, egressDir?, scrubCmd?, scanCmd? })` is synchronous and returns `{ fields, redactions }` or `{ refused: "egress-dir-unsafe" | "scrub-failed" }` (a tagged refusal, not the design's `null`).
- The review fixture yields two `unrelated` findings (`architecture-2` and `security-3`), not one; the scope algorithm is right and the plan prose was wrong.
- Cherry-picks conflict on `docs/maps/*`; resolve with `git checkout --ours -- docs/maps/...`, `git add`, `git -c core.editor=true cherry-pick --continue` and let pre-commit heal.

## Follow-ups for later waves
- Scope change recorded 2026-09-20 at the owner's request: Jev's performance increase must be both generated and recorded. T186 gains `liftSummary`, a `lift` header key in `review-triage.json`, a `review-triaged` activity event, and `review-triage-calibration.json` from `--calibrate`; T187 documents the event and the lift grep in `metrics.md`; T188's ADR ends with a `### Calibration record` table. See the updated `tasks/T186..T188/context.md`.
- `scripts/review-triage.ts` exports `runTriage(specDir, changedFilesPath, opts)`; T186 threads `deps` (`fetchImpl`, `log`, scrub/scan stubs) through it.
