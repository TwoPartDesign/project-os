---
wave: 1
completed_tasks: [T189]
failed_tasks: []
files_changed:
  - scripts/compaction-metrics.ts
  - tests/compaction-metrics.test.ts
  - docs/knowledge/compaction-metrics.md
  - .claude/commands/tools/metrics.md
  - .claude/settings.json
  - scripts/generate-manifest.sh
  - scripts/new-project.sh
  - .claude/manifest.json
goal_satisfied: true
---

## Gotchas

- Session transcripts repeat `usage` on every content-block record of one
  response; any per-turn metric must collapse records by response id first.
- The metrics script reads the live transcript path from the session; the
  knowledge doc records the measured session's numbers, so rerun via
  `node scripts/compaction-metrics.ts` to refresh them.

## Follow-ups for later waves

- None. The feature is a single task; run `/workflows:review compaction-gate`
  to promote T189 from `[~]` to `[x]`.
