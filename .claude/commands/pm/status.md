---
description: "Synthesize current project status from all sources"
---

# Status Report

## Gather

1. `ROADMAP.md` — task counts by status
2. `.claude/sessions/` — latest handoff
3. `git log --oneline --since="1 week ago"` — recent activity
4. `docs/specs/` — active specs and status

## Present

> **Project Status: [PROJECT_NAME]**
>
> **Activity** (7 days): [N] commits
>
> **Tasks**: [active] active / [queued] queued / [done] done / [blocked] blocked
>
> **Active Features**:
> - [Feature]: [phase] — [status]
>
> **Last Session**: [date] — [summary]
> **Next Up**: [priority 1]
