# Agent Adapter Interface

## Purpose
Adapters provide a uniform interface for dispatching tasks to **external (non-Claude) AI coding agents**. They are not involved in default dispatch: Claude sub-agents are dispatched natively via the Task tool with per-task `model:` selection and `isolation: "worktree"`. An adapter is consulted only when a task carries an `(agent: <name>)` annotation in ROADMAP.md. The Codex adapter is the one functional implementation (requires the `codex` CLI).

## Contract

Every adapter is a bash script that implements:

```bash
adapter.sh <command> [args...]
```

### Commands

| Command | Description | Exit Code |
|---------|------------|-----------|
| `info` | Print adapter metadata as JSON | 0 |
| `execute <context_dir> <output_dir>` | Run a task given context | 0=success, 1=failure |
| `health` | Check if the agent is available | 0=available, 1=unavailable |

### `info` Output

```json
{
  "name": "codex",
  "display_name": "OpenAI Codex",
  "version": "1.0",
  "supports_isolation": false,
  "supports_streaming": false,
  "supports_model_routing": false,
  "model_default": "cli-default"
}
```

### `execute` Protocol

**Input:** The adapter receives a `context_dir` containing:
- `task.md` — The task description and acceptance criteria
- `conventions.md` — Project conventions (from CLAUDE.md)
- `design.md` — Relevant design section
- `files/` — Current state of files the task will modify (read-only reference copies)

**Output:** The adapter writes to `output_dir`:
- `completion-report.md` — What was done, files changed, assumptions
- `result` — Exit status: `pass` or `fail`
- `test-output.txt` — Test run output (if applicable)
- `files/` — Modified/created files to apply back

**Environment Variables:**
- `ADAPTER_TASK_ID` — The task ID (e.g., `T1`)
- `ADAPTER_FEATURE` — The feature name
- `ADAPTER_MAX_TURNS` — Maximum agent turns (optional, default: 50)
- `ADAPTER_MODEL` — Optional model override passed through to the external agent's CLI. Unset by default — the external tool uses its own configured default model.

### `health` Check

Returns 0 if the agent CLI is installed and accessible. Returns 1 with a message on stderr explaining what's missing.

## Dispatch Resolution

The orchestrator resolves dispatch per task:

0. **Model annotation**: `(model: <model>)` in ROADMAP.md → **native dispatch** (Task tool, `isolation: "worktree"`) with that model
1. **Agent annotation**: `(agent: <name>)` in ROADMAP.md → external adapter `.claude/agents/adapters/<name>.sh` (health-checked; falls back to native dispatch on failure)
2. **Default**: native dispatch with the sub-agent default model (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`)

Adapter scripts live in `.claude/agents/adapters/<name>.sh`.

## Adding a New Adapter

1. Create `.claude/agents/adapters/<name>.sh` implementing all 3 commands
2. Make it executable: `chmod +x`
3. Test with: `bash .claude/agents/adapters/<name>.sh health`
4. Set as default in settings or annotate tasks with `(agent: <name>)`

## Status

- Native Task-tool dispatch handles all Claude sub-agent work; adapters cover external agents only
- Codex adapter is functional for users with `codex` CLI installed
- The former claude-code no-op adapter and the gemini/aider/amp stubs were removed — to add a new external agent, implement the 3-command contract below
- Trust boundary: Codex adapter uses `-s danger-full-access` — see Security section below

## Security

The Codex adapter uses `codex exec -s danger-full-access` which grants unrestricted filesystem access.

**No isolation**: Codex runs directly in the main working tree. It does NOT get worktree isolation — `supports_isolation` is `false` and adapter dispatch bypasses the Task tool, so `isolation: "worktree"` never applies to it. Dispatch Codex tasks only when the working tree is clean and committed, so `validate_file_scope()` can revert out-of-scope changes reliably.

Mitigations that do apply:

1. **Opt-in only**: Codex adapter is never used unless explicitly annotated with `(agent: codex)` in ROADMAP.md
2. **File scope validation**: The adapter's `validate_file_scope()` function compares pre/post git snapshots and reverts changes to files not listed in the task specification
3. **No ambient authority**: The adapter does not inherit shell environment beyond the explicitly exported `ADAPTER_*` variables

These mitigations reduce but do not eliminate risk. The Codex process itself is not sandboxed — it can read/write anywhere the user can, and file-scope validation runs after the fact (it cannot prevent reads or out-of-tree writes). Use only in trusted contexts.
