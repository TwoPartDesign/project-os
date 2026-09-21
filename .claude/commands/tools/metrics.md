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

### Jev decision events

Three events track Jev's involvement in review triage:
- `jev-queried` — `consumer`, `questions`, `backend`, `redactions`,
  `input_tokens`, `output_tokens`, `duration_ms`,
  `threshold_duplicate_p`, `threshold_out_of_scope_p`,
  `threshold_severity_confidence`
- `jev-declined` — the same keys as `jev-queried`, plus `reason`
- `review-triaged` — `feature`, `backend`, `findings`, `dup_pairs`,
  `dup_changed`, `scope_changed`, `severity_changed`, `redactions`

```bash
# Count queries vs declines
grep -o '"event": "jev-\(queried\|declined\)"' .claude/logs/activity.jsonl | sort | uniq -c

# Reasons for declines
grep '"event": "jev-declined"' .claude/logs/activity.jsonl | grep -o '"reason": "[^"]*"' | sort | uniq -c
```

```bash
# Running measure of Jev's lift over the heuristic: sum changed-verdict
# counts across every review-triaged event
grep '"event": "review-triaged"' .claude/logs/activity.jsonl | grep -o '"dup_changed": "[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print "dup_changed total:", s}'
grep '"event": "review-triaged"' .claude/logs/activity.jsonl | grep -o '"scope_changed": "[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print "scope_changed total:", s}'
grep '"event": "review-triaged"' .claude/logs/activity.jsonl | grep -o '"severity_changed": "[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print "severity_changed total:", s}'
```

### Compaction metrics

`scripts/compaction-metrics.ts` measures what auto-compaction costs a long
lead session: per-cycle turns, peak context and cache spend, tool-error rate
by context decile, a what-if simulation of other fire points, and the
configured fire point pinned against the ones the runtime actually used.

```bash
node scripts/compaction-metrics.ts ~/.claude/projects/<slug>/<session>.jsonl
node scripts/compaction-metrics.ts ~/.claude/projects/<slug>/ --window 350000 --pct 80 --json
```

`docs/knowledge/compaction-metrics.md` is the recorded result and the
keep-or-lower recommendation; re-run the script to refresh it.

`docs/specs/<feature>/review-triage-calibration.json` is the per-run
calibration record written by `--calibrate`. The measured lift is written
down in the "Calibration record" table in `docs/knowledge/decisions.md`.

If the activity log doesn't exist yet, fall back to `docs/knowledge/metrics.md` only.
