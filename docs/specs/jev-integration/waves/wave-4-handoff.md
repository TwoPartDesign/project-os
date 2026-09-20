---
wave: 4
completed_tasks: [T187, T188]
failed_tasks: []
files_changed:
  - .claude/commands/workflows/review.md
  - .claude/commands/tools/metrics.md
  - .claude/hooks/log-activity.sh
  - .claude/settings.json
  - .claude/manifest.json
  - docs/knowledge/architecture.md
  - docs/knowledge/decisions.md
  - scripts/new-project.sh
  - scripts/generate-manifest.sh
goal_satisfied: true
---
## Gotchas
- `scripts/generate-manifest.sh` keeps its own hardcoded `TEMPLATE_SCRIPTS` list, separate from the copy list in `scripts/new-project.sh`. A script shipped to new projects must be added in both places or it never appears in `.claude/manifest.json`.
- The `### Calibration record` table in decisions.md holds a placeholder row. Filling it requires `TYPESAFE_API_KEY`, `project_os.jev.enabled: true`, and a `--calibrate` run over at least twenty past findings; the flag stays off until then.
- `/workflows:review` Synthesis step 0 now runs `review-triage.ts` over `review-raw/`; the triage table is advisory and decides nothing.

## Follow-ups for later waves
- Build is complete (11/11). Next phase: `/workflows:review jev-integration`.
- Draft #T189 (compaction-gate, measure the 350k/80% compaction constraint) awaits `/pm:approve`.
