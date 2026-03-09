---
description: "Update model routing for orchestration and sub-agents — Max/Pro/Custom tier selection"
---

# Set Model Hierarchy

You are updating the **model routing configuration** for this project. This is callable at any time to change which models are used for orchestration and sub-agent tasks.

## Step 1: Show current config

Read `.claude/models.env` if it exists and show the current settings:

> **Current model routing:**
> - Orchestration: [current value or "not set"]
> - Sub-agents: [current value or "not set"]

Also check the `## Model Routing` section of `CLAUDE.md` and show it for reference.

## Step 2: Prompt for new tier

Ask:

> "Which model tier would you like to use?"
>
> 1. **Max** — Opus for orchestration, Sonnet for sub-agents
> 2. **Pro** — Sonnet for orchestration, Haiku for sub-agents
> 3. **Custom** — Specify model IDs manually

If **Custom**, ask:
- Orchestration model ID (e.g. `claude-opus-4-6`, `claude-sonnet-4-6`)
- Sub-agent model ID (e.g. `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`)

Standard tier mappings:
| Tier | Orchestration | Sub-agent |
|---|---|---|
| Max | `claude-opus-4-6` | `claude-sonnet-4-6` |
| Pro | `claude-sonnet-4-6` | `claude-haiku-4-5-20251001` |

## Step 3: Write `.claude/models.env`

Create or overwrite `.claude/models.env`:

```bash
# Model routing — managed by /tools:init and /tools:set-models
# Source this file in your shell profile: source /path/to/project/.claude/models.env
export CLAUDE_CODE_SUBAGENT_MODEL=[MODEL_SUBAGENT]
export CLAUDE_ORCHESTRATION_MODEL=[MODEL_ORCHESTRATION]
```

## Step 4: Update `CLAUDE.md`

Find the `## Model Routing` section in `CLAUDE.md` and replace it with:

```markdown
## Model Routing
- **Orchestration & design**: [MODEL_ORCHESTRATION]
- **Sub-agent implementation**: [MODEL_SUBAGENT] (via `CLAUDE_CODE_SUBAGENT_MODEL`)
```

If no `## Model Routing` section exists, append it to `CLAUDE.md`.

## Step 5: Update memory

Update `docs/memory/project-profiles.md` — find the entry for this project and update the model tier line. If the entry doesn't exist, note it but don't create it (that's `/tools:init`'s job).

## Step 6: Report

> **Model routing updated:**
> - Tier: [Max/Pro/Custom]
> - Orchestration: [MODEL_ORCHESTRATION]
> - Sub-agents: [MODEL_SUBAGENT]
> - Config written to: `.claude/models.env`
> - `CLAUDE.md` updated
>
> To activate sub-agent routing in your current shell:
> `source .claude/models.env`
>
> To activate permanently, add to `~/.bashrc`:
> `source /absolute/path/to/.claude/models.env`
