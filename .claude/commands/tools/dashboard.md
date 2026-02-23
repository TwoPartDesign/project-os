---
description: "Cross-project dashboard — see status of all Project OS projects"
---

# Project Dashboard

Show the status of all Project OS projects from a single view.

## Input
`$ARGUMENTS` can be:
- Empty: scan default projects root from settings
- A path: scan that directory for projects

## Configuration
Read `.claude/settings.json` → `project_os.dashboard.projects_root` for the scan directory.
Default: `~/projects`

## Execution

Run `bash scripts/dashboard.sh [projects_root]` to scan and display project statuses.

## Display

Show an ASCII table:

```
Project OS Dashboard
═══════════════════════════════════════════════════════════════
Project          Branch          Todo  WIP  Review  Done  Blocked
───────────────────────────────────────────────────────────────
my-app           feature/auth    3     2    1       8     0
api-service      master          0     0    0       15    0
cli-tool         feature/v2      5     1    0       3     2
───────────────────────────────────────────────────────────────
Totals                           8     3    1       26    2

Active worktrees: 3
Last activity: 2026-02-23 14:30 (my-app)
```

## Additional Details

If `$ARGUMENTS` is a specific project name, show expanded detail:
- Full ROADMAP task list with statuses
- Active worktrees and their tasks
- Recent activity log entries (last 10)
- Current feature in progress
