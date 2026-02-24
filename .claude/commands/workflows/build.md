---
description: "Execute implementation from task plan using wave-based parallel sub-agents with native Tasks tracking and worktree isolation"
---

# Phase 4: Wave-Based Parallel Implementation

You are the build orchestrator. You coordinate sub-agents but NEVER write implementation code yourself. Your job is to delegate, monitor, and unblock.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md`. Verify all tasks have status markers.
Read `CLAUDE.md` for project conventions (this is the ONLY shared context for agents).
Read `.claude/settings.json` for `project_os.parallel` config (max_concurrent_agents, backoff).

**Runtime state:** Native Tasks (TaskCreate/TaskUpdate/TaskList) are used as a structured convenience layer for runtime status tracking during build execution. ROADMAP.md remains the authoritative source of truth. See "Native Tasks Sync" section below.

## Pre-flight

Before dispatching any agents:
1. Verify no tasks for this feature are `[?]` (draft). If any drafts remain, STOP and tell the user to run `/pm:approve $ARGUMENTS` first. Tasks in other states (`[-]`, `[~]`, `[x]`, `[!]`) are allowed — this enables rebuilding after partial completion or unblocking.
2. Create task-specific working directories:
   ```
   docs/specs/$ARGUMENTS/tasks/
   docs/specs/$ARGUMENTS/tasks/T1/
   docs/specs/$ARGUMENTS/tasks/T2/
   ...
   ```
3. For each task directory, create a `context.md` file:
   - If per-task context files already exist (from a prior plan phase), use them as-is
   - If not, extract the relevant section from `docs/specs/$ARGUMENTS/tasks.md` and save it as `docs/specs/$ARGUMENTS/tasks/TN/context.md`
   - This fallback ensures build is resilient to both old-style (single tasks.md) and new-style (per-task dirs) plans
4. Run `bash scripts/validate-roadmap.sh` to verify dependency integrity.
5. Run `bash scripts/unblocked-tasks.sh` to get the initial set of unblocked tasks. **Important:** Filter the output to only tasks belonging to this feature (`$ARGUMENTS`). The script returns all unblocked tasks across all features — cross-reference each task ID against the task list in `docs/specs/$ARGUMENTS/tasks.md` and ignore tasks from other features.

## Native Tasks Sync (Optional)

After pre-flight, attempt to mirror ROADMAP tasks into native Tasks for structured runtime state tracking. This is a **convenience layer** — if it fails, the build continues with ROADMAP.md-only wave computation.

**At build start:**
For each unblocked task belonging to this feature:
```
TaskCreate(
  subject: "T{N}: {title}",
  description: "{context from tasks/TN/context.md}",
  activeForm: "Implementing T{N}"
)
TaskUpdate(taskId, addBlockedBy: [dependency task IDs])
```
If `TaskCreate` fails (API unavailable, context limit, etc.), log a warning and skip — wave computation proceeds from ROADMAP.md parsing alone.

**During build:**
When updating ROADMAP.md markers, also update the corresponding native Task:
- On dispatch: `TaskUpdate(taskId, status: "in_progress")`
- On success: `TaskUpdate(taskId, status: "completed")`
- On failure: leave native Task status as-is (ROADMAP.md `[!]` marker is authoritative)

**At wave boundary (consistency check):**
Re-read ROADMAP.md markers as ground truth. Cross-check against `TaskList` output. If mismatch: log a warning and trust ROADMAP.md markers. This ensures resilience against native Task state drift during long builds or compaction events.

**At build end:**
Sync final states back to ROADMAP.md markers:
- Native Task `completed` → ROADMAP `[~]` (ready for review)
- Native Task still `in_progress` after failure → ROADMAP `[!]` (blocked)

## Wave Computation

Organize tasks into **waves** based on the dependency DAG:

- **Wave 1**: All `[ ]` tasks with no dependencies (or all deps already `[x]`)
- **Wave 2**: `[ ]` tasks whose deps are all in Wave 1 or already `[x]`
- **Wave N**: `[ ]` tasks whose deps are all in Waves 1..N-1 or already `[x]`
- **Skip**: Tasks marked `[!]` (blocked) are excluded from waves entirely. If an unblocked task depends on a `[!]` task, it stays queued until the blocked task is resolved. Report all blocked dependencies to the user at wave plan display time.

Display the wave plan to the user before executing:
```
Wave 1 (parallel): #T1, #T4, #T5
Wave 2 (parallel): #T2, #T3 (depends: #T1)
Wave 3 (sequential): #T6 (depends: #T2, #T3)
```

## Adapter Resolution

Before dispatching, resolve which adapter and model to use for each task:

0. Check task annotation in ROADMAP.md: `(model: <name>)` → set `ADAPTER_MODEL=<name>`, use `claude-code` adapter
1. Check task annotation in ROADMAP.md: `(agent: <name>)` → use `.claude/agents/adapters/<name>.sh`
2. Check settings: `.claude/settings.json` → `project_os.adapters.default`
3. Fallback: `claude-code` adapter with `ADAPTER_MODEL=haiku`

**Examples:**
```markdown
- [ ] Critical security task #T1 (model: opus)       → claude-code adapter, ADAPTER_MODEL=opus
- [ ] Routine task #T2                                → claude-code adapter, ADAPTER_MODEL=haiku
- [ ] Codex-specific task #T3 (agent: codex)          → codex adapter (if healthy, else fallback)
```

For each task, verify the adapter is available:
```bash
# Validate adapter name: only allow alphanumeric, hyphen (no slashes, dots, or path traversal)
if [[ ! "$adapter" =~ ^[a-zA-Z0-9-]+$ ]]; then
    echo "WARNING: Invalid adapter name '${adapter}', falling back to claude-code" >&2
    adapter="claude-code"
fi
bash ".claude/agents/adapters/${adapter}.sh" health
```
If the adapter health check fails, fall back to `claude-code` and log a warning.

**v2.1 note:** Model routing via `(model: X)` annotations is the primary dispatch mechanism. The Codex adapter is functional for users with `codex` CLI installed. Other adapter stubs (gemini, aider, amp) remain as contract templates for future implementations.

## Execution Protocol

### For each wave:

**1. Mark tasks in-progress**
Update ROADMAP.md: change `[ ]` to `[-]` for all tasks in this wave.
**Important:** Task markers (`[ ]`, `[-]`, `[~]`, `[!]`, `[x]`) are the sole source of truth for task state. Section headings ("### In Progress", "### Done") are optional organizational grouping only. Always reference markers, not headings, when determining task status.
Log each: `bash .claude/hooks/log-activity.sh task-spawned "feature=$ARGUMENTS" task_id=TN agent=implementer`

**2. Prepare agent context packets**
For each task in the wave, assemble ONLY:
- The specific task description from tasks.md (NOT the full task list)
- The relevant section from `docs/specs/$ARGUMENTS/design.md` (NOT the full design)
- Project conventions from CLAUDE.md
- The specific files the task mentions (read them for current state)

DO NOT give agents: full spec history, other tasks, the brief, research findings, or review comments. Context isolation is critical.

**3. Dispatch sub-agents (parallel within wave)**
Dispatch up to `max_concurrent_agents` (default: 4) sub-agents simultaneously.
Each agent is dispatched via the Task tool with `isolation: "worktree"`, which automatically creates an isolated git worktree in `.claude/worktrees/` and cleans it up after the agent completes (kept with a branch name if changes were made).

For each task, prepare adapter context and resolve the adapter:
```bash
# Create context packet for the adapter
context_dir="docs/specs/$ARGUMENTS/tasks/TN/context"
mkdir -p "$context_dir/files"
# Copy task.md, conventions.md, design.md, relevant source files into context_dir

# Resolve adapter and model (see Adapter Resolution section above)
adapter="claude-code"  # default
resolved_model="haiku"  # default
# Step 0: Check task annotation: (model: <name>) → set resolved_model, use claude-code
# Step 1: Check task annotation: (agent: <name>) → override adapter
# Step 2: Check settings: project_os.adapters.default → override if no annotation

# Validate adapter name (prevent path traversal)
if [[ ! "$adapter" =~ ^[a-zA-Z0-9-]+$ ]]; then
    echo "WARNING: Invalid adapter name '${adapter}', falling back to claude-code" >&2
    adapter="claude-code"
fi

# Verify adapter health
if ! bash ".claude/agents/adapters/${adapter}.sh" health 2>/dev/null; then
    echo "WARNING: ${adapter} adapter unavailable, falling back to claude-code"
    adapter="claude-code"
fi

# Set adapter environment
export ADAPTER_TASK_ID="TN"
export ADAPTER_FEATURE="$ARGUMENTS"
export ADAPTER_MAX_TURNS=50
export ADAPTER_MODEL="${resolved_model:-haiku}"
```

The orchestrator then reads the adapter's prepared prompt and dispatches via the Task tool:
```
Task(
  prompt: "<agent prompt from adapter output>",
  subagent_type: "general-purpose",
  model: "$ADAPTER_MODEL",
  isolation: "worktree"
)
```
For non-Claude adapters (e.g., Codex), the adapter's `execute` command handles dispatch directly instead of going through the Task tool.

Each agent's prompt:

"You are an implementation agent. Your ONLY job is to complete this task:

[TASK DESCRIPTION]

Conventions to follow:
[RELEVANT CLAUDE.md EXCERPT]

Design context:
[RELEVANT DESIGN SECTION ONLY]

Current file state:
[RELEVANT FILES IF MODIFYING]

Instructions:
1. Write the implementation code
2. Write the tests specified in the task
3. Run the tests — they must pass
4. Do NOT modify any files not listed in this task
5. If you encounter an ambiguity, make the simplest choice and document it as a code comment
6. When done, report: files created/modified, tests passed/failed, any assumptions made"

If more tasks exist than `max_concurrent_agents`, queue the overflow and dispatch as slots free up (within the same wave only — never start a next-wave task early).

**4. On agent completion**
For each agent that finishes:
- Write `docs/specs/$ARGUMENTS/tasks/TN/completion-report.md` with: files changed, tests passed, assumptions
- If tests pass: mark task `[~]` in ROADMAP.md (ready for review). Log: `bash .claude/hooks/log-activity.sh task-completed feature=$ARGUMENTS task_id=TN`
- If tests fail: give the agent ONE retry with the error output
- If retry fails: mark task `[!]` in ROADMAP.md. Log: `bash .claude/hooks/log-activity.sh task-failed feature=$ARGUMENTS task_id=TN`
- Notify: `bash .claude/hooks/notify-phase-change.sh task-unblocked <next-task-id>` for any newly unblocked tasks

**5. Wave gate**
After all tasks in a wave complete:
- Run the FULL test suite (not just new tests)
- If integration tests fail:
  1. Identify which task's changes broke the tests (review each task's file changes against failures)
  2. Re-dispatch to the same agent (or escalate to a higher-tier model if the fix is non-trivial) to resolve
  3. If the agent cannot fix, stash that task's changes to preserve them: `git stash push -m "revert TN: [reason]" -- [task files]` and mark the task `[!]` in ROADMAP.md with a blocker note. Avoid `git checkout --` which permanently discards work.
  4. Never leave the test suite red between waves
- Only proceed to next wave when gate passes

### After all waves complete:

1. Run final full test suite
2. Session preservation is handled automatically by native worktree cleanup. `preserve-sessions.sh` remains available for manual use if needed.
3. Check for uncommitted changes: `git status`
4. Create atomic commits (one per task): `feat($ARGUMENTS): <task title> (TN)`
5. Update ROADMAP.md — verify all completed tasks are marked `[~]` (ready for review). Do NOT mark them `[x]` — that transition happens only after `/workflows:review` passes.
6. Notify: `bash .claude/hooks/notify-phase-change.sh review-requested $ARGUMENTS`

## Error Handling

If a sub-agent exceeds its scope (modifies files not in its task):
- Revert those changes: `git checkout -- [unauthorized files]`
- Re-run the agent with a stricter prompt

If a task is blocked:
- Document the blocker in the task's completion report
- Mark `[!]` in ROADMAP.md
- Continue with non-dependent tasks in the current wave
- Report blockers to the user at the end

If rate-limited or agent spawn fails:
- Apply backoff from `project_os.parallel.backoff` config
- Retry up to 2 times (per escalation protocol), then halt wave

## Completion

Tell the user:
"Build complete. [N/M] tasks finished in [W] waves, [P] blocked.
Run `/workflows:review $ARGUMENTS` for quality gate before shipping."

Save a memory entry documenting: what was built, wave count, any surprises, any blocked tasks.
