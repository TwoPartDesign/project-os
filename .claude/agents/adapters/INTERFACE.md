# Agent Adapter Interface

## Purpose
Adapters provide a uniform interface for dispatching tasks to different AI coding agents (Claude Code, Codex, Gemini CLI, Aider, Amp). The orchestrator calls the same interface regardless of which agent runs the task.

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
- `ADAPTER_MODEL` — Model override (optional)

### `health` Check

Returns 0 if the agent CLI is installed and accessible. Returns 1 with a message on stderr explaining what's missing.

## Adapter Resolution

The orchestrator resolves which adapter to use:

1. **Task annotation**: `(agent: codex)` in ROADMAP.md → use that adapter
2. **Settings default**: `.claude/settings.json` → `project_os.adapters.default`
3. **Fallback**: `claude-code` adapter

Adapter scripts live in `.claude/agents/adapters/<name>.sh`.

## Adding a New Adapter

1. Create `.claude/agents/adapters/<name>.sh` implementing all 3 commands
2. Make it executable: `chmod +x`
3. Test with: `bash .claude/agents/adapters/<name>.sh health`
4. Set as default in settings or annotate tasks with `(agent: <name>)`

## Limitations (v2)

- Adapters are advisory — the orchestrator logs which adapter was requested but Claude Code always runs the task in v2
- Non-Claude adapters are stubs that print a "not yet implemented" message
- Hard enforcement and actual multi-agent dispatch planned for v2.1+
