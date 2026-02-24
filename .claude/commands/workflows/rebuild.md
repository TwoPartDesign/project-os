---
description: "Unblock failed review tasks and re-implement fixes with guided feedback"
---

# Phase 4b: Rebuild After Failed Review

You are the rebuild coordinator. After `/workflows:review` fails and marks tasks `[!]`, this workflow unblocks them, surfaces the reviewer feedback, and re-runs the build phase.

## Input

Read `docs/specs/$ARGUMENTS/revision-request.md` — the reviewer findings that caused the block.
Read `ROADMAP.md` to identify all `[!]` (blocked) tasks for this feature.
Read `docs/specs/$ARGUMENTS/tasks.md` for original task specifications.

## Rebuild Strategy

You can rebuild in two modes based on severity of review findings:

### Mode 1: Re-implement (default)
Use when reviewers flagged code-level issues (bugs, security, quality) in completed tasks.
- Mark `[!]` tasks as `[ ]` (unblocked, ready for re-implementation)
- Re-run build phase with ONLY the unblocked tasks
- Fixes iterate on existing code

### Mode 2: Re-plan (destructive)
Use when reviewers flagged design-level failures (wrong approach, missing requirements) or multiple critical tasks were blocked.
- Mark `[!]` tasks as `[?]` (revert to draft for re-planning)
- Do NOT re-run build — tell the user to run `/workflows:design` and `/workflows:plan` to rethink the approach
- This is a design-phase reset

**Recommended:** Start with Mode 1 (re-implement). If re-implementation also fails, escalate to Mode 2.

## Pre-flight

Before unblocking:

1. Read and display `docs/specs/$ARGUMENTS/revision-request.md` to the user
2. Identify all `[!]` tasks in ROADMAP.md under this feature
3. For each blocked task, display:
   - Task ID and description
   - Specific findings from revision-request.md that blocked this task
4. Ask the user: "Mode 1 (re-implement) or Mode 2 (re-plan)?"

## Mode 1: Re-implement

If user chooses re-implement:

1. **Unblock tasks**
   Update ROADMAP.md: mark all `[!]` tasks for this feature as `[ ]` (todo, ready for work).

2. **Report findings**
   Create `docs/specs/$ARGUMENTS/rebuild-context.md` containing:
   - The full text of `revision-request.md` (for agent context)
   - A summary: "The following tasks were blocked for these reasons: [list per-task findings]"
   - Instructions: "Fix these issues in re-implementation. Reference the task IDs cited in the findings."

3. **Re-run build phase**
   Run `/workflows:build $ARGUMENTS`

   The build phase will automatically pick up the unblocked tasks and dispatch them.

   **Important:** Agents will have access to `rebuild-context.md` so they understand what the previous reviewers flagged. This guides their fixes.

4. **After rebuild completes**
   Mark unblocked tasks `[~]` (review-ready) — this happens automatically in the build phase.
   Tell the user: "Re-implementation complete. Run `/workflows:review $ARGUMENTS` to re-review fixes."

## Mode 2: Re-plan

If user chooses re-plan:

1. **Revert tasks to draft**
   Update ROADMAP.md: mark all `[!]` tasks for this feature as `[?]` (draft).

2. **Preserve revision findings**
   Leave `docs/specs/$ARGUMENTS/revision-request.md` in place for reference during re-planning.

3. **Tell the user**
   "Tasks reverted to draft. Run `/workflows:design $ARGUMENTS` to address reviewer findings at the design level, then `/workflows:plan` to re-decompose tasks."

## Next Steps (User-facing)

At the end of either mode, tell the user:

**Mode 1:** "Rebuild unblocked. Run `/workflows:review $ARGUMENTS` to re-review the fixes, or `/workflows:rebuild $ARGUMENTS --replan` to switch to Mode 2 if issues persist."

**Mode 2:** "Tasks reverted to draft. Edit `docs/specs/$ARGUMENTS/design.md` to address reviewer findings, then run `/workflows:plan $ARGUMENTS` to re-decompose."

## Replan Flag

Include a `--replan` flag for quick re-planning mid-rebuild:
```bash
/workflows:rebuild $ARGUMENTS --replan
```
This skips the mode choice and goes directly to Mode 2 (revert to draft).

## Error Handling

If no `[!]` tasks exist for the feature:
- Apologize and check ROADMAP.md — this shouldn't be called with no blocked tasks
- Suggest the user run `/pm:status` to verify the current state

If `revision-request.md` is missing:
- STOP and tell the user — the rebuild context is required
- Suggest running the full review workflow first: `/workflows:review $ARGUMENTS`

## Learning

After rebuild succeeds:
- Add any new patterns discovered to `docs/knowledge/patterns.md`
- Add any anti-patterns discovered to `docs/knowledge/bugs.md`
- Save a memory entry: which tasks were blocked, what the fixes were, and whether Mode 1 or Mode 2 was needed
