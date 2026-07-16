---
description: "Update model routing for orchestration and sub-agents — Max/Pro/Custom tier selection"
---

# Set Model Hierarchy

You are updating the **model routing configuration** for this project. This is callable at any time to change which models are used for orchestration and sub-agent tasks.

## Step 1: Show current config

Read `.claude/settings.json` if it exists and show the current settings:

> **Current model routing:**
> - Orchestration (`"model"`): [current value or "not set"]
> - Sub-agents (`env.CLAUDE_CODE_SUBAGENT_MODEL`): [current value or "not set"]

Also check the `## Model Routing` section of `CLAUDE.md` and show it for reference.

## Step 2: Prompt for new tier

Ask:

> "Which model tier would you like to use?"
>
> 1. **Max** — Opus for orchestration, Sonnet for sub-agents
> 2. **Pro** — Sonnet for orchestration, Haiku for sub-agents
> 3. **Custom** — Specify model IDs manually

If **Custom**, ask:
- Orchestration model ID — prefer a bare alias (`opus`/`sonnet`/`haiku`, or `fable` for the Fable/Mythos tier), which always resolves to the latest model in that family. Pin a dated ID (e.g. `claude-opus-4-8`) only when you need a specific version.
- Sub-agent model ID — same: prefer a bare alias (`sonnet`/`haiku`) over a dated ID.

Standard tier mappings (bare aliases so routing always tracks the latest release):
| Tier | Orchestration | Sub-agent |
|---|---|---|
| Max | `opus` (or `fable` for the hardest design work) | `sonnet` |
| Pro | `sonnet` | `haiku` |

## Step 3: Update `.claude/settings.json`

Create or update `.claude/settings.json`, preserving any existing keys:

```json
{
  "model": "[MODEL_ORCHESTRATION]",
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "[MODEL_SUBAGENT]"
  }
}
```

- `"model"` sets the orchestration/session model (aliases like `"opus"` resolve to the current Opus)
- `env.CLAUDE_CODE_SUBAGENT_MODEL` routes sub-agent tasks
- Per-task overrides remain available via `(model: <model-id>)` annotations in ROADMAP.md

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
> - Config written to: `.claude/settings.json`
> - `CLAUDE.md` updated
>
> Settings take effect on the next Claude Code session — restart to apply.
