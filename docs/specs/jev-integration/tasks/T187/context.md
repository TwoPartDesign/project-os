# Task T187 context

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

### T187: Wire the review workflow, document events
- **Depends on**: T186
- **Files**: `.claude/commands/workflows/review.md` (modify: Synthesis section at lines 184-199), `.claude/hooks/log-activity.sh` (modify: header comment lines 6-9), `.claude/commands/tools/metrics.md` (modify: after the activity-log example near line 63)
- **Pattern**: Existing numbered steps in the Synthesis section; existing event list style in the hook header.
- **Implementation**:
  - `review.md`: insert a step 0 before "1. Deduplicate": write each reviewer's raw report verbatim to `docs/specs/$ARGUMENTS/review-raw/architecture.md`, `security.md`, `tests.md`; write `git diff --name-only "${BASE}...HEAD"` to `docs/specs/$ARGUMENTS/review-raw/changed-files.txt`; run `node scripts/review-triage.ts "docs/specs/$ARGUMENTS" --changed-files "docs/specs/$ARGUMENTS/review-raw/changed-files.txt"`; state in one sentence that the printed table is advisory input to steps 1 to 3 and decides nothing. Renumber nothing else. Mention that `review-raw/` is under the gitignored spec directory.
  - `review.md` step 0 also says: when the table header shows `backend: jev`, quote its `lift` line (duplicates, scope, severity changed versus the heuristic) in the review report's summary so every review records what Jev changed.
  - `log-activity.sh`: add `jev-queried, jev-declined, review-triaged` to the `# Events:` comment.
  - `metrics.md`: add a short subsection "Jev decision events" listing the three events and their metadata keys — `jev-queried`/`jev-declined`: `consumer`, `questions`, `backend`, `redactions`, `input_tokens`, `output_tokens`, `duration_ms`, `reason`, `threshold_*`; `review-triaged`: `feature`, `backend`, `findings`, `dup_pairs`, `dup_changed`, `scope_changed`, `severity_changed`, `redactions` — with two grep examples: one counting queried vs declined, one summing `dup_changed`/`scope_changed`/`severity_changed` across `review-triaged` events (the running measure of Jev's lift over the heuristic). Point at `docs/specs/<feature>/review-triage-calibration.json` as the per-run calibration record and at the `Calibration record` table in `docs/knowledge/decisions.md` as where the measured lift is written down.
- **Tests**: none (prose). Run `bash tests/hook-smoke.sh` to confirm the hook comment edit changed nothing functional.
- **Acceptance Criteria**:
  - [ ] `review.md` Synthesis has a step 0 naming the exact command above and the word "advisory"
  - [ ] `grep -c 'jev-' .claude/hooks/log-activity.sh` is at least 1 and `grep -c 'review-triaged' .claude/commands/tools/metrics.md` is at least 1
  - [ ] `bash tests/hook-smoke.sh` passes
- **Size**: Small
- **Status**: [?]
