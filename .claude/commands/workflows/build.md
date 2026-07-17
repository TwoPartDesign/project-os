---
description: "Execute implementation from task plan using dependency-scheduled parallel sub-agents with native Tasks and worktree isolation"
---

# Phase 4: Dependency-Scheduled Parallel Implementation

You are the build orchestrator. You coordinate sub-agents but NEVER write implementation code yourself. Your job is to delegate, monitor, and unblock.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md`. Verify all tasks have status markers.
Read `CLAUDE.md` for project conventions (this is the ONLY shared context for agents).
Read `.claude/settings.json` for `project_os.parallel` config (max_concurrent_agents, backoff).

**Runtime state:** Native Tasks (TaskCreate/TaskUpdate/TaskList) drive dependency scheduling during build execution. ROADMAP.md remains the authoritative source of truth. See "Task Scheduling (Native Tasks)" below.

## Pre-flight

Before dispatching any agents:
1. Verify no tasks for this feature are `[?]` (draft). If any drafts remain, STOP and tell the user to run `/pm:approve $ARGUMENTS` first. Tasks in other states (`[-]`, `[~]`, `[x]`, `[!]`) are allowed — this enables rebuilding after partial completion or unblocking.
2. Create task-specific working directories:
   ```
   docs/specs/$ARGUMENTS/tasks/
   docs/specs/$ARGUMENTS/tasks/T1/
   docs/specs/$ARGUMENTS/tasks/T2/
   ...
   docs/specs/$ARGUMENTS/waves/
   ```
3. For each task directory, create a `context/` subdirectory:
   - If per-task context dirs already exist (from a prior plan phase), use them as-is
   - If not, create `docs/specs/$ARGUMENTS/tasks/TN/context/` and write the relevant section from `docs/specs/$ARGUMENTS/tasks.md` into it as `task.md`
   - This fallback ensures build is resilient to both old-style (single tasks.md) and new-style (per-task dirs) plans
4. Run `bash scripts/validate-roadmap.sh` to verify dependency integrity.
5. Run `node scripts/knowledge-index.ts index-vault` to ensure the knowledge index is current before spawning sub-agents.
6. Run `node scripts/system-map.ts check` (heal with `--heal` if drifted) and skim `node scripts/system-map.ts report` — starting a build on top of unknown HIGH readiness findings (unwired hooks, dangling refs) compounds them. Findings that overlap this feature's task files should be flagged to the user before dispatch; unrelated findings are the maintenance loop's job, not this build's.

**Agent Rules note:** The `## Agent Rules` sections in `.claude/rules/*.md` are hand-maintained distillations, included verbatim in agent prompts (see Execution Protocol). When editing a rule file, update its `## Agent Rules` section in the same edit — there is no automated freshness check.

## Task Scheduling (Native Tasks)

Native Tasks are the scheduling engine: dependency resolution and unblocking are delegated to the Task system instead of computed by hand. ROADMAP.md remains the **authoritative, git-versioned governance record** — its markers are updated at every state change and win on any mismatch.

**At build start**, parse ROADMAP.md for this feature's tasks (markers + `(depends:)` clauses) and mirror them:
```
TaskCreate(
  subject: "T{N}: {title}",
  description: "{context from tasks/TN/context.md}",
  activeForm: "Implementing T{N}"
)
TaskUpdate(taskId, addBlockedBy: [dependency task IDs])
```
Tasks already `[x]` in ROADMAP.md are created as `completed` (or omitted from `addBlockedBy` lists). Tasks marked `[!]` are excluded from scheduling; anything depending on them stays blocked until resolved — report these to the user up front.

Display the resulting plan before executing (waves are now just the human-readable view of the dependency graph):
```
Ready now (parallel): #T1, #T4, #T5
Next (after #T1):     #T2, #T3
Then (after #T2,#T3): #T6
Blocked:              #T7 (depends on [!] #T4 — resolve first)
```

**During build:**
- On dispatch: ROADMAP `[ ]` → `[-]`, and `TaskUpdate(taskId, status: "in_progress")`
- On success: ROADMAP `[-]` → `[~]`, and `TaskUpdate(taskId, status: "completed")` — completing a task automatically unblocks its dependents; dispatch newly unblocked tasks as slots free up
- On failure: ROADMAP `[-]` → `[!]` (authoritative); leave the native Task `in_progress`

**Consistency check (each time a dispatch batch drains):** re-read ROADMAP.md markers as ground truth and cross-check against `TaskList`. On mismatch, log a warning and trust ROADMAP.md. If native Tasks are unavailable entirely (`TaskCreate` fails), fall back to scheduling directly from ROADMAP.md markers and `(depends:)` clauses — the build must not depend on the convenience layer.

## Dispatch Resolution

Default dispatch is **native**: the Task tool with per-task model selection and `isolation: "worktree"`. External adapters (`.claude/agents/adapters/`) are consulted only for tasks explicitly annotated with `(agent: <name>)`.

Resolve per task:

0. `(model: <model>)` annotation in ROADMAP.md → native dispatch with that model
1. `(agent: <name>)` annotation in ROADMAP.md → external adapter `.claude/agents/adapters/<name>.sh`
2. No annotation → native dispatch with the sub-agent default model (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`)

**Examples:**
```markdown
- [ ] Critical security task #T1 (model: claude-opus-4-8)  → native, model claude-opus-4-8
- [ ] Routine task #T2                                     → native, sub-agent default model
- [ ] Codex-specific task #T3 (agent: codex)               → codex adapter (if healthy, else native)
```

For the external path, verify the adapter is available:
```bash
# Validate adapter name: only allow alphanumeric, hyphen (no slashes, dots, or path traversal)
if [[ ! "$adapter" =~ ^[a-zA-Z0-9-]+$ ]]; then
    echo "WARNING: Invalid adapter name '${adapter}', using native dispatch" >&2
    adapter=""
fi
bash ".claude/agents/adapters/${adapter}.sh" health
```
If the adapter health check fails, fall back to native dispatch and log a warning.

**Note:** External adapters run in the main working tree without worktree isolation (see `INTERFACE.md` Security). Only dispatch adapter tasks when the tree is clean.

## Execution Protocol

### For each dispatch batch (the currently unblocked tasks):

**1. Mark tasks in-progress**
Update ROADMAP.md: change `[ ]` to `[-]` for all tasks being dispatched.
**Important:** Task markers (`[ ]`, `[-]`, `[~]`, `[!]`, `[x]`) are the sole source of truth for task state. Section headings ("### In Progress", "### Done") are optional organizational grouping only. Always reference markers, not headings, when determining task status.
Log each: `bash .claude/hooks/log-activity.sh task-spawned "feature=$ARGUMENTS" task_id=TN agent=implementer`

**2. Prepare agent context packets**
Before assembling any packets, read `.claude/rules/bash.md` and extract the full content of its `## Agent Rules` section (everything after that heading). Store this as `BASH_AGENT_RULES` — it will be substituted into every agent prompt below.

If `docs/specs/$ARGUMENTS/waves/wave-{N-1}-handoff.md` exists (the prior wave's handoff, N = this batch's number), read it first — it's the primary context for what the prior wave changed, its gotchas, and follow-ups this batch should account for.

For each task in the batch, assemble ONLY:
- The specific task description from tasks.md (NOT the full task list)
- The relevant section from `docs/specs/$ARGUMENTS/design.md` (NOT the full design)
- If the task creates or modifies framework wiring (hook, command, or skill files, or anything under scripts/): the relevant node/edge lines from `docs/maps/system-map.md` for the touched files — so the agent sees what references what it's changing without grepping for it. Excerpt only; never the whole map.
- Project conventions from CLAUDE.md
- Agent rules: extract the `## Agent Rules` section from `.claude/rules/tests.md` and `.claude/rules/escalation.md` and include in the conventions block. Do NOT include the full rule files — only the `## Agent Rules` section from each. Bash rules go in the dedicated CRITICAL section below, not here.
- The specific files the task mentions (read them for current state)

DO NOT give agents: full spec history, other tasks, the brief, research findings, or review comments. Context isolation is critical.

**3. Dispatch sub-agents (parallel)**
Dispatch up to `max_concurrent_agents` (default: 4) sub-agents simultaneously.
Each agent is dispatched via the Task tool with `isolation: "worktree"`, which automatically creates an isolated git worktree in `.claude/worktrees/` and cleans it up after the agent completes (kept with a branch name if changes were made).

**Native path (default):** dispatch directly via the Task tool with the context packet from step 2:
```
Task(
  prompt: "<assembled agent prompt>",
  subagent_type: "general-purpose",
  model: "<model from (model: X) annotation — omit to use the sub-agent default>",
  isolation: "worktree"
)
```

**External adapter path** (only for `(agent: <name>)` tasks): prepare a context packet on disk and invoke the adapter:
```bash
# Create context packet for the adapter
context_dir="docs/specs/$ARGUMENTS/tasks/TN/context"
mkdir -p "$context_dir/files"
# Copy task.md, conventions.md, design.md, relevant source files into context_dir

# Validate + health-check the adapter (see Dispatch Resolution above);
# on any failure, fall back to the native path.

export ADAPTER_TASK_ID="TN"
export ADAPTER_FEATURE="$ARGUMENTS"
export ADAPTER_MAX_TURNS=50
bash ".claude/agents/adapters/${adapter}.sh" execute "$context_dir" "docs/specs/$ARGUMENTS/tasks/TN/output"
```
External adapters run in the main working tree — no worktree isolation. Dispatch them one at a time, never in parallel with other tasks touching the same files.

Each agent's prompt:

"You are an implementation agent. Your ONLY job is to complete this task:

[TASK DESCRIPTION]

CRITICAL — BASH COMMAND RULES:
[BASH_AGENT_RULES]

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

If more tasks exist than `max_concurrent_agents`, queue the overflow and dispatch as slots free up. Never dispatch a task whose dependencies are not yet `completed` — native Task `addBlockedBy` enforces this; the ROADMAP `(depends:)` clauses are the fallback check.

**4. On agent completion**
For each agent that finishes:
- Write `docs/specs/$ARGUMENTS/tasks/TN/completion-report.md` with: files changed, tests passed, assumptions
- If tests pass: mark task `[~]` in ROADMAP.md (ready for review). Log: `bash .claude/hooks/log-activity.sh task-completed feature=$ARGUMENTS task_id=TN`
- If tests fail: give the agent ONE retry with the error output
- If retry fails: mark task `[!]` in ROADMAP.md. Log: `bash .claude/hooks/log-activity.sh task-failed feature=$ARGUMENTS task_id=TN`
- Notify: `bash .claude/hooks/notify-phase-change.sh task-unblocked <next-task-id>` for any newly unblocked tasks

**5. Batch gate**
Each time the running set drains (all dispatched agents have completed) and before dispatching newly unblocked tasks:
- Run the FULL test suite (not just new tests)
- If integration tests fail:
  1. Identify which task's changes broke the tests (review each task's file changes against failures)
  2. Re-dispatch to the same agent (or escalate to a higher-tier model if the fix is non-trivial) to resolve
  3. If the agent cannot fix, stash that task's changes to preserve them: `git stash push -m "revert TN: [reason]" -- [task files]` and mark the task `[!]` in ROADMAP.md with a blocker note. Avoid `git checkout --` which permanently discards work.
  4. Never leave the test suite red between batches
- **Goal predicate:** before advancing, confirm a declarative exit condition holds for this batch — e.g. `goal: all tasks in this batch are [~], full test suite green, no [!] markers`. This is a Project OS convention (markdown-protocol only, not a dependency on any native `/goal` primitive). If the predicate isn't satisfied, loop through the retry steps above, up to the 2-retry cap in `.claude/rules/escalation.md`; if still unmet after 2 retries, stop dispatching and surface the blocker using the escalation message format.
- Only dispatch the next batch when the goal predicate is satisfied
- Write `docs/specs/$ARGUMENTS/waves/wave-N-handoff.md` (N = this batch's number) capturing what the next wave needs:
  ```yaml
  ---
  wave: N
  completed_tasks: [T3, T4, T5]
  failed_tasks: []
  files_changed: [...]
  goal_satisfied: true
  ---
  ## Gotchas
  - ...
  ## Follow-ups for later waves
  - ...
  ```
  Auto-indexed by `output-index.sh` (FTS5) for free — no extra step needed.

### After all tasks complete:

1. Run final full test suite
2. Worktree lifecycle is native: agent worktrees are cleaned up automatically (kept as a branch when changes were made). No manual session-preservation step.
3. Check for uncommitted changes: `git status`
4. Create atomic commits (one per task): `feat($ARGUMENTS): <task title> (TN)`
5. Update ROADMAP.md — verify all completed tasks are marked `[~]` (ready for review). Do NOT mark them `[x]` — that transition happens only after `/workflows:review` passes.
6. Notify: `bash .claude/hooks/notify-phase-change.sh review-requested $ARGUMENTS`

## Error Handling

If a sub-agent exceeds its scope (modifies files not in its task):
- Hard-revert those unauthorized files: `git checkout HEAD -- [unauthorized files]` (untracked: `rm -f [file]`). Unlike the batch gate recovery above, unauthorized scope changes should not be preserved — they are outside the task contract.
- Re-run the agent with a stricter prompt

If a task is blocked:
- Document the blocker in the task's completion report
- Mark `[!]` in ROADMAP.md
- Continue with non-dependent tasks in the current batch
- Report blockers to the user at the end

If rate-limited or agent spawn fails:
- Apply backoff from `project_os.parallel.backoff` config
- Retry up to 2 times (per escalation protocol), then halt dispatching

## Completion

Tell the user:
"Build complete. [N/M] tasks finished in [B] dispatch batches, [P] blocked.
Run `/workflows:review $ARGUMENTS` for quality gate before shipping."

Save a memory entry documenting: what was built, batch count, any surprises, any blocked tasks.
