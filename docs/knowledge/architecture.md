---
type: knowledge
tags: [architecture, system-design]
description: Living system architecture documentation
links: "[[decisions]], [[patterns]]"
date: "2026-03-03"
---

# System Architecture

## High-Level Structure

Project OS is a solo-developer governance layer for AI-driven development, built on bash + markdown.
It preserves human authority through three mechanisms:
- **Phase checkpoints** — explicit human approval required at idea→design, plan→build (pm:approve), and build→ship
- **Quality gates** — adversarial review (3 isolated reviewers) before any feature reaches main
- **Audit trail** — ROADMAP.md state machine + JSONL activity log capture every decision

```
User ──→ Workflow Commands ──→ Orchestrator ──→ Sub-agents (isolated worktrees)
              │                     │                    │
              ▼                     ▼                    ▼
         ROADMAP.md           Adapter Layer         Task Output
        (authority)         (claude-code, codex)   (completion reports)
              │                     │
              ▼                     ▼
         Native Tasks          Activity Logs
        (runtime state)      (.claude/logs/)
```

## Module Map

| Module | Path | Purpose |
|--------|------|---------|
| Workflow commands | `.claude/commands/workflows/` | Spec-driven dev lifecycle (idea→design→plan→build→review→ship) |
| Tool commands | `.claude/commands/tools/` | Utility tools (dashboard, commit, handoff, research) |
| Agent adapters | `.claude/agents/adapters/` | Uniform interface for dispatching to AI agents |
| Hooks | `.claude/hooks/` | Event-driven automation (post-tool-use, activity logging, session preservation) |
| Scripts | `scripts/` | Standalone utilities (validate-roadmap, dashboard, scrub-secrets) |
| Knowledge base | `docs/knowledge/` | Patterns, decisions, bugs, architecture, metrics |
| Specs | `docs/specs/<feature>/` | Per-feature lifecycle docs (design, tasks, review) |

## Data Flow

### Build Phase
```
ROADMAP.md ──parse──→ Wave Computation ──dispatch──→ Sub-agents (worktree isolation)
     │                      │                              │
     ▼                      ▼                              ▼
Native Tasks          Adapter Resolution           Completion Reports
(convenience)     (model→agent→settings→fallback)    (per-task output)
     │                                                     │
     └──────── Wave Boundary Consistency Check ◄───────────┘
```

### Adapter Resolution (4-step)
0. `(model: opus)` annotation → claude-code adapter with ADAPTER_MODEL override
1. `(agent: codex)` annotation → codex adapter (if healthy)
2. Settings default → `project_os.adapters.default`
3. Fallback → claude-code adapter with ADAPTER_MODEL=haiku

### Dashboard (optional)
```
ROADMAP.md ──fs.watch──→ dashboard-server.ts ──SSE──→ Browser
activity.jsonl ─────────────┘         │
                                      ├── /api/status (HTML)
                                      ├── /api/dag (Mermaid)
                                      ├── /api/activity (HTML)
                                      └── /api/status.json (JSON)
```

## Context Filtering &amp; Knowledge Index

Project OS includes an FTS5-based knowledge index for efficient context management:

- **Index engine**: `scripts/knowledge-index.ts` — uses `node:sqlite` FTS5 (Node 22.16+, zero deps)
- **Subcommands**: `index`, `index-vault`, `search`, `rebuild`, `stats`, `stale`, `config`
- **Filter script**: `scripts/context-filter.sh` — routes large outputs through intent-based filtering
- **Advisory hook**: `.claude/hooks/output-index.sh` — indexes large tool outputs automatically
- **SKILL**: `.claude/skills/context-filter/SKILL.md` — teaches proactive routing for large content

### Freshness System

Content freshness is tracked with three confidence levels:
- **high**: Has `date:` field in YAML frontmatter
- **medium**: Dated via git history
- **low**: Dated via file modification time only

Content older than 90 days without validation is marked `[STALE]` in search results.
Use `node scripts/knowledge-index.ts validate &lt;source&gt;` to reset the stale clock.

---

<!-- This file is read by /workflows:design to ensure new features align -->
