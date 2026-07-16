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

## Live Dashboard

For a live-updating web view with DAG visualization:

```bash
node scripts/dashboard-server.ts [--port 3400] [--projects-root ~/projects]
```

Opens at http://localhost:3400. Auto-refreshes via SSE when ROADMAP.md or activity.jsonl change.
Requires Node 22.6+ (native TypeScript) or Bun. Requires internet for CDN-loaded Mermaid.js, htmx, and Pico CSS.

### Board Tab

The live dashboard includes a Board tab: a server-rendered Kanban view of ROADMAP.md, one column per lifecycle marker.

- Columns: Draft `[?]`, Todo `[ ]`, WIP `[-]`, Racing `[>]` (shown only when occupied), Review `[~]`, Done `[x]`, Blocked `[!]`, plus a conditional Other column for any unrecognized marker
- Served by `GET /api/kanban` — returns the Kanban HTML fragment for the current ROADMAP.md state
- Auto-refreshes via the same SSE mechanism as the rest of the dashboard (ROADMAP.md or activity.jsonl changes push a refresh)

## Additional Details

If `$ARGUMENTS` is a specific project name, show expanded detail:
- Full ROADMAP task list with statuses
- Active worktrees and their tasks
- Recent activity log entries (last 10)
- Current feature in progress
