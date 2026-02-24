# Agent Adapter Interface

## Purpose
Adapters provide a uniform interface for dispatching tasks to different AI coding agents. Model routing via `(model: X)` annotations is the primary dispatch mechanism — it routes to the specified Claude model via the claude-code adapter. The Codex adapter is a fully functional alternative for users with `codex` CLI installed. Other adapter stubs (gemini, aider, amp) remain as contract templates for future implementations.

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
  "name": "claude-code",
  "display_name": "Claude Code",
  "version": "1.0",
  "supports_isolation": true,
  "supports_streaming": false,
  "supports_model_routing": true,
  "model_default": "haiku"
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
- `ADAPTER_MODEL` — Model override: `haiku`, `sonnet`, or `opus`. Set by orchestrator when task has `(model: X)` annotation. Default: `haiku`.

### `health` Check

Returns 0 if the agent CLI is installed and accessible. Returns 1 with a message on stderr explaining what's missing.

## Adapter Resolution

The orchestrator resolves which adapter and model to use:

0. **Model annotation**: `(model: opus)` in ROADMAP.md → set `ADAPTER_MODEL=opus`, use `claude-code` adapter
1. **Agent annotation**: `(agent: codex)` in ROADMAP.md → use that adapter
2. **Settings default**: `.claude/settings.json` → `project_os.adapters.default`
3. **Fallback**: `claude-code` adapter with `ADAPTER_MODEL=haiku`

Adapter scripts live in `.claude/agents/adapters/<name>.sh`.

## Adding a New Adapter

1. Create `.claude/agents/adapters/<name>.sh` implementing all 3 commands
2. Make it executable: `chmod +x`
3. Test with: `bash .claude/agents/adapters/<name>.sh health`
4. Set as default in settings or annotate tasks with `(agent: <name>)`

## Status (v2.1)

- Model routing via `(model: X)` annotations is the primary dispatch mechanism
- Codex adapter is fully functional for users with `codex` CLI installed
- Gemini, Aider, and Amp stubs remain as contract templates for future implementations
- Trust boundary: Codex adapter uses `-s danger-full-access` — see Security section below

## Security

The Codex adapter uses `codex exec -s danger-full-access` which grants unrestricted filesystem access. Mitigations:

1. **Opt-in only**: Codex adapter is never used unless explicitly annotated with `(agent: codex)` in ROADMAP.md
2. **Worktree isolation**: Each task runs in an isolated git worktree via `isolation: "worktree"`, limiting blast radius
3. **File scope validation**: The adapter's `validate_file_scope()` function compares pre/post git snapshots and reverts changes to files not listed in the task specification
4. **No ambient authority**: The adapter does not inherit shell environment beyond the explicitly exported `ADAPTER_*` variables

These mitigations reduce but do not eliminate risk. The Codex process itself is not sandboxed — it can read/write anywhere the user can. Use only in trusted contexts.
