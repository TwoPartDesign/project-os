---
description: "Restore context from the last session — start where you left off"
---

# Session Catchup

## Step 1: Find the latest handoff

Read the most recent file in `.claude/sessions/` (sorted by filename/date).
If no handoff files exist:
> "No session handoff found. Starting fresh. What are we working on?"

## Step 2: Load context

From the handoff file, read:
1. The `objective` and `phase`
2. The `in_progress` files (only the focus ranges, not entire files)
3. The `next_steps`
4. The `compact_instruction`

Additionally:
- `git log --oneline -5` for recent changes
- `git diff --stat` for uncommitted work
- `ROADMAP.md` for overall status

Do NOT load full specs or designs unless the phase requires it.

## Step 3: Synthesize

Present to the user:
> **Resuming session from [date]**
> - **Objective**: [summary]
> - **Phase**: [phase]
> - **Last completed**: [completed items]
> - **In flight**: [what's partially done]
> - **Blockers**: [any blockers]
> - **Next up**: [priority 1 action]
>
> Ready to continue. Pick up where we left off, or redirect?
