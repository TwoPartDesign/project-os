---
description: "Spawn multiple competing implementations for a task and select the best"
---

# Competitive Implementation

You spawn N parallel implementations of the same task with different strategic prompts. The human (Orchestrator) selects the winner.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md` and identify the target task.
The user specifies which task to compete on: `/workflows:compete <feature> <task_id>` (e.g., `/workflows:compete auth T3`).
Read `.claude/settings.json` for `project_os.compete` config.

## Step 1: Validate

1. Verify the task exists and is `[ ]` (approved) in ROADMAP.md
2. Verify the task is NOT already `[>]` (competing) — if it is, warn the user that a competition is already in progress and ask whether to restart or resume
3. Mark task as `[>]` (competing) in ROADMAP.md
4. Read the task spec from tasks.md

## Step 2: Define approaches

Use the configured strategies (default: `["literal", "minimal", "extensible"]`):

- **Literal**: "Implement this task exactly as specified. Follow the spec to the letter. Do not add anything not explicitly requested."
- **Minimal**: "Implement this task with the minimum code possible. Favor simplicity, fewer abstractions, less code. If the spec can be satisfied in fewer lines, do it."
- **Extensible**: "Implement this task with future extensibility in mind. Use clear abstractions, well-named interfaces, and patterns that would make adding similar features easy."

The user can also supply custom strategy prompts.

## Step 3: Spawn competing agents

For each approach (up to `default_approaches` count):
1. Create a worktree-isolated sub-agent with `isolation: worktree`
2. Provide the same task context packet (identical to `/workflows:build`)
3. Prepend the strategy instruction to the prompt
4. Each agent works independently — no awareness of competitors

All agents run in parallel (respecting `max_concurrent_agents`).

## Step 4: Collect results

As each agent completes:
1. Save output to `docs/specs/$ARGUMENTS/tasks/TN/compete-<strategy>.md`
   - Files changed
   - Tests passed/failed
   - Lines of code added
   - Assumptions made
   - Self-assessed complexity
2. If tests fail, disqualify that approach (note in report)

## Step 5: Generate comparison

Create `docs/specs/$ARGUMENTS/tasks/TN/compete-comparison.md`:

```markdown
# Competitive Comparison: TN — [Task Title]

## Summary Table
| Metric | Literal | Minimal | Extensible |
|--------|---------|---------|------------|
| Lines added | N | N | N |
| Files touched | N | N | N |
| Tests passed | Y/N | Y/N | Y/N |
| Complexity | low/med/high | low/med/high | low/med/high |

## Approach Details

### Literal
[Summary of implementation approach]
[Key trade-offs]

### Minimal
[Summary of implementation approach]
[Key trade-offs]

### Extensible
[Summary of implementation approach]
[Key trade-offs]

## Recommendation
[Which approach best fits this project's principles — cite CLAUDE.md]
```

## Step 6: Human selection

Present the comparison to the user. Ask them to select:
1. A specific approach (literal/minimal/extensible)
2. A hybrid (cherry-pick elements from multiple)
3. None (rethink the task)

## Step 7: Apply winner

1. Merge the winning worktree's changes into the **current feature branch** (NOT main/master — the review gate must pass first)
2. Run the full test suite after merge — if tests fail, report the failure and do NOT proceed
3. Clean up losing worktrees
4. Mark task as `[~]` (review) in ROADMAP.md
5. Write completion report to `docs/specs/$ARGUMENTS/tasks/TN/completion-report.md`
6. Notify: `bash .claude/hooks/notify-phase-change.sh compete-complete $ARGUMENTS TN`

Tell the user: "Competition complete for TN. Winner: [strategy]. Run `/workflows:review $ARGUMENTS` when ready."
