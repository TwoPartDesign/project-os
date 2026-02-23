---
description: "Query activity logs and feature metrics"
---

# Metrics Viewer

Query the activity log and feature metrics to understand project performance.

## Input
`$ARGUMENTS` can be:
- Empty: show summary of all features
- A feature name: show detailed metrics for that feature
- `--slow`: show slowest tasks across all features
- `--compare <feat1> <feat2>`: compare two features

## Data Sources
1. `.claude/logs/activity.jsonl` — event-level activity log
2. `docs/knowledge/metrics.md` — feature-level metrics snapshots

## Views

### Summary (no arguments)
Parse `docs/knowledge/metrics.md` and display:
```
Feature Metrics Summary
═══════════════════════════════════════════
Feature          Tasks  Waves  Duration  Review Rate
───────────────────────────────────────────
auth             12     3      4 days    83%
api-v2           8      2      2 days    100%
───────────────────────────────────────────
```

### Feature Detail (`/tools:metrics auth`)
Parse the activity log for this feature and show:
```
Feature: auth
══════════════
Duration: 4 days (2026-02-15 → 2026-02-19)
Tasks: 12 total, 10 done, 2 blocked
Waves: 3
Revisions: 1 (review cycle)
First-pass rate: 83%
Compete: 2 tasks
Lines: +450 / -120

Timeline:
  2026-02-15 10:00  plan-approved
  2026-02-15 10:05  task-spawned T1, T2, T3 (wave 1)
  2026-02-15 10:30  task-completed T1
  ...
```

### Slow Tasks (`/tools:metrics --slow`)
Parse activity log, compute duration per task (spawned → completed), show top 10 slowest.

### Compare (`/tools:metrics --compare auth api-v2`)
Side-by-side comparison of two features on all metric dimensions.

## Activity Log Parsing
The activity log at `.claude/logs/activity.jsonl` has one JSON object per line:
```json
{"timestamp": "2026-02-15T10:00:00Z", "event": "task-spawned", "metadata": {"feature": "auth", "task_id": "T1"}}
```

Parse with:
```bash
# Count events by type for a feature
grep '"feature": "auth"' .claude/logs/activity.jsonl | grep -o '"event": "[^"]*"' | sort | uniq -c

# Get task durations
# (compute from task-spawned to task-completed timestamps)
```

If the activity log doesn't exist yet, fall back to `docs/knowledge/metrics.md` only.
