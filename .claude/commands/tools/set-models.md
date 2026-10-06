---
description: "Update model routing for orchestration and sub-agents"
---

# Set Model Hierarchy

You are updating the **model routing configuration** for this project. This is callable at any time to change which models are used for orchestration and sub-agent tasks.

## Step 1: Show current config

Read `.claude/settings.json` if it exists and show the current settings:

> **Current model routing:**
> - Orchestration (`"model"`): [current value or "not set"]
> - Sub-agents (`env.CLAUDE_CODE_SUBAGENT_MODEL`): [current value or "not set"]

Also check the `## Model Routing` section of `CLAUDE.md` and show it for reference.

## Step 2: Choose models

Ask:

> "Keep the defaults — orchestration `opus`, sub-agents `opus` (unnamed spawns), fallback `sonnet` — or name different models?"

If the user names different models:
- Orchestration model ID — prefer a bare alias (`opus`/`sonnet`/`fable`), which always resolves to the latest model in that family. Pin a dated ID only when you need a specific version.
- Sub-agent model ID — same: prefer a bare alias (`opus`/`sonnet`) over a dated ID.

Never set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`; it overrides agent-file frontmatter and collapses the mechanical tier. `set-models` changes the env-var tier only; per-agent tiers live in `.claude/agents/*.md` frontmatter.

**Fable confirmation.** Before writing `fable` as `"model"` when the current
primary (project `.claude/settings.json`, else `~/.claude/settings.json`) is
`opus`, `sonnet`, or unset, ask explicitly:

> "This makes Fable — the Mythos-class tier, several times the cost of Opus —
> the primary session model for this project. Fable earns that on
> architecture-defining work; a routine project is well served by Opus as
> lead. Switch the primary to Fable?"

If the user declines, keep the current primary and write only the sub-agent
tier. Never promote the primary to Fable silently, whether the source is a
default, a copied settings file, or a global default. Project settings win over
`~/.claude/settings.json` for `"model"`; this prompt is what stands between a
choice and that override.

## Step 3: Update `.claude/settings.json`

Create or update `.claude/settings.json`, preserving any existing keys:

```json
{
  "model": "[MODEL_ORCHESTRATION]",
  "fallbackModel": ["sonnet"],
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "[MODEL_SUBAGENT]",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "[COMPACT_WINDOW]",
    "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"
  }
}
```

- `"model"` sets the orchestration/session model (aliases like `"opus"` resolve to the current Opus)
- `"fallbackModel"` is the ordered list the session falls back through when the primary is unavailable; `effortLevel` is honoured on a Fable fallback (2.1.280), which matters only if a project opts into `fable`
- `env.CLAUDE_CODE_SUBAGENT_MODEL` routes sub-agent tasks
- `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` keeps the native Task tools available on the current Opus, Sonnet and Fable models (Claude Code ≥ 2.1.233 withholds them there); `/workflows:build` schedules on them, so leave it set on every tier
- `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` is an **early-compaction budget cap**
  the compaction chain (`compact-suggest.sh`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`)
  measures against; the runtime caps it at the model's real window. Rule: it
  must not exceed the smallest real window of any model the session can land
  on — the lead and every `fallbackModel` entry. `350000` when the whole chain
  runs at 1M (Opus, Sonnet and Fable on a plan with 1M context; verify with
  `/context`), `200000` when any chain model runs at 200k. The default chain
  (`opus` lead, `sonnet` fallback) is all 1M, so the 350k cap still sits below
  every window in it. A cap above a
  chain member's real window makes the handoff nudge fire past the end of that
  window, i.e. never (`docs/knowledge/decisions.md`, 2026-09-16 resolution).
- Per-task overrides remain available via `(model: <model-id>)` annotations in ROADMAP.md
- `claude --debug` names settings `env` variables Claude Code ignored because the launch environment already sets them (2.1.281); run it when a value written here does not take effect

`CLAUDE.md`'s `## Model Routing` section ships correct for the default lead (`opus`) and is not rewritten otherwise. When the lead model changed, edit the Lead line and the `CLAUDE_CODE_SUBAGENT_MODEL` mention in place to name the chosen models, as `/tools:init` does.

## Step 4: Update memory

Update `docs/memory/project-profiles.md` — find the entry for this project and update the model line. If the entry doesn't exist, note it but don't create it (that's `/tools:init`'s job).

## Step 5: Report

> **Model routing updated:**
> - Orchestration: [MODEL_ORCHESTRATION]
> - Sub-agents: [MODEL_SUBAGENT]
> - Config written to: `.claude/settings.json`
>
> Settings take effect on the next Claude Code session — restart to apply.
