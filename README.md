# Project OS

A spec-driven development scaffold for Claude Code. Full workflow pipeline, memory system, sub-agent orchestration, and quality gates — zero external dependencies.

## What It Is

Project OS is a template you drop into Claude Code to turn it into a structured development environment. You get:

- **A 7-phase workflow** — idea through design, planning, approval, implementation, review, and shipping
- **A memory system** that compounds knowledge across sessions
- **Sub-agent orchestration** that routes work to cheaper models automatically
- **Quality gates** at every phase transition
- **Session handoffs** for resuming mid-task with zero context loss

Everything is markdown files and bash scripts. No servers, no databases, no external services.

## Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic/claude-code`
- A Claude account — [Claude.ai Pro/Max](https://claude.ai) subscription or [Anthropic API key](https://console.anthropic.com)

If using an API key, set it in your environment:
```bash
# Mac/Linux — add to ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY=your-key-here

# Windows — System Environment Variables, or in PowerShell:
$env:ANTHROPIC_API_KEY="your-key-here"
```

**Optional:** `jq` (JSON parsing in dashboard/metrics), `gh` CLI (PR creation via `scripts/create-pr.sh`)

## Setup

### First-time (the template itself)

```bash
git clone https://github.com/TwoPartDesign/project-os ~/claude-os
cd ~/claude-os && claude
/tools:init
```

`/tools:init` configures your global `~/.claude/CLAUDE.md`, fills in placeholders, and offers optional feature toggles (Obsidian integration, Context7 MCP server).

### Creating a new project

```bash
# Mac/Linux
bash scripts/new-project.sh my-app ~/projects/my-app

# Windows (Git Bash or WSL)
bash scripts/new-project.sh my-app C:/Users/YourName/projects/my-app

cd ~/projects/my-app && claude
/tools:init
```

## The Workflow

Seven phases. Always start at the top — never skip from idea to build.

```
/workflows:idea my-feature       Capture idea, research feasibility, write brief
/workflows:design my-feature     Turn brief into a technical spec
/workflows:plan my-feature       Decompose spec into atomic tasks
/pm:approve my-feature           Promote draft tasks to approved
/workflows:build my-feature      Wave-based parallel sub-agents
/workflows:review my-feature     Adversarial quality gate (3 reviewers)
/workflows:ship my-feature       Final checks, PR generation, done
```

Optional competitive path for critical tasks:
```
/workflows:compete my-feature T1          Spawn N parallel implementations
/workflows:compete-review my-feature T1   Side-by-side scoring, pick winner
```

For small changes (< 20 lines, single file) skip the pipeline and describe the change directly.

## All Commands

### Workflow
| Command | What it does |
|---|---|
| `/workflows:idea [name]` | Capture idea, spawn research agents, output brief |
| `/workflows:design [name]` | First-principles design with adversarial self-review |
| `/workflows:plan [name]` | Decompose into atomic tasks with `[?]` drafts and `#TN` IDs |
| `/workflows:build [name]` | Wave-based parallel sub-agents with worktree isolation |
| `/workflows:review [name]` | Three isolated reviewers: drift, security, quality |
| `/workflows:ship [name]` | Pre-ship checklist, PR generation, metrics snapshot |
| `/workflows:compete [name] [task]` | N competing implementations, different strategies |
| `/workflows:compete-review [name] [task]` | Side-by-side scoring of competing implementations |

### Tools
| Command | What it does |
|---|---|
| `/tools:init` | First-run setup — scan for placeholders, configure globals |
| `/tools:handoff` | Save session state to `.claude/sessions/` |
| `/tools:catchup` | Restore context from last session handoff |
| `/tools:commit` | Quality-checked git commit with pre-flight scan |
| `/tools:research [topic]` | Spawn parallel research agents |
| `/tools:kv set/get/list` | Quick key-value notes in `docs/knowledge/kv.md` |
| `/tools:dashboard [path]` | Cross-project status dashboard (CLI + live web view) |
| `/tools:metrics [feature]` | Query activity logs and feature metrics |

### Project Management
| Command | What it does |
|---|---|
| `/pm:prd [name]` | Guided PRD via Socratic discovery |
| `/pm:epic [name]` | Break PRD into tracked tasks in ROADMAP.md |
| `/pm:status` | Snapshot of current project state |
| `/pm:approve [name]` | Governance gate — promote `[?]` drafts to `[ ]` approved |

## Memory System

Five layers with distinct lifespans:

| Layer | Location | Purpose |
|---|---|---|
| Global identity | `~/.claude/CLAUDE.md` | Personal preferences, model routing, hard rules |
| Project constitution | `CLAUDE.md` | Stack, conventions, workflow, skill triggers |
| Knowledge vault | `docs/knowledge/` | Decisions, patterns, bugs, architecture |
| Feature specs | `docs/specs/<name>/` | Brief, design, tasks, review artifacts |
| Session handoffs | `.claude/sessions/` | YAML snapshots for resuming mid-task |

## Model Routing

| Role | Model | Why |
|---|---|---|
| Orchestration & design | Sonnet/Opus | Complex reasoning, architecture |
| Sub-agent implementation | Haiku | Focused coding — cheap and fast |
| Adversarial review | Primary model (isolated) | Independent judgment |

Configured in `.claude/settings.json` via `CLAUDE_CODE_SUBAGENT_MODEL`.

## Tips

- **`/tools:handoff` before ending sessions** with work in progress. Resume with `/tools:catchup`.
- **`/clear` between unrelated tasks.** Fresh context = better performance.
- **The knowledge vault compounds.** Document decisions and root causes as you go.
- **`/pm:approve` after planning** to promote drafts before building.
- **For small changes** skip the pipeline entirely.

For the full architecture reference, implementation details, and build spec, see [project-os-guide.md](project-os-guide.md).

## License

MIT — see [LICENSE](LICENSE) for details.
