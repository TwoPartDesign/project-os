# T186 completion report

Status: complete, integrated as 9788784 (worker commit d083542, cherry-picked clean).

Files changed: `scripts/review-triage.ts` (modify: `pick`, `buildQuestions`, `applyAnswers`, `liftSummary`, output scrub, `--calibrate`, `review-triaged` log event, `runTriage` deps), `tests/review-triage.test.ts` (append 11 tests; one T184 test adjusted, see below), `docs/maps/*` (pre-commit heal).

Tests: `node --test tests/review-triage.test.ts` → 24 pass, 0 fail in the worker; re-run by the lead in the main repo after integration (see build log).

Lift record (owner requirement 2026-09-20): `review-triage.json` header carries `lift` (`null` on the heuristic path); every run logs `review-triaged` with `feature`, `backend`, `findings`, `dup_pairs`, `dup_changed`, `scope_changed`, `severity_changed`, `redactions`; `--calibrate` writes `review-triage-calibration.json` with per-family agreement rates. Fixture under the Jev stub: `dup_pairs 2, dup_changed 1, scope_changed 1, severity_changed 0`; calibration `agreement.dup = 1/2`.

Deviations from the brief, accepted by the lead:
- The T184 test `runTriage_fixture_directCall_matchesCliOutput` now passes `projectRoot: tmp` (the output scrub must never stage into this repo's `.claude/logs/`) and expects two logged events, since every run now logs `review-triaged` beside decide's event.
- Output-scrub `redactions` counts issue/fix fields that actually changed, because the scanner subprocess's in-place `[REDACTED:<rule>]` markers are invisible to the guard's own pure-pass count.

Worker tokens: ~261k (well over the 100k budget; the real-scanner scrub test and the pre-commit secret-literal rejection cost most of it).
