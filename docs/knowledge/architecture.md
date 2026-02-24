---
type: knowledge
tags: [architecture, system-design]
description: Living system architecture documentation
links: "[[decisions]], [[patterns]]"
---

# System Architecture

## High-Level Structure

Project OS is a governance and quality layer for AI-driven development, built on bash + markdown.

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

---

<!-- This file is read by /workflows:design to ensure new features align -->
