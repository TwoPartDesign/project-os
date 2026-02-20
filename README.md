# Project OS

A spec-driven development scaffold for Claude Code. Gives you a full workflow pipeline, memory system, sub-agent orchestration, and quality gates — built entirely on Claude Code's native features with zero external dependencies.

---

## What it is

Project OS is a template you drop into Claude Code to turn it into a structured development environment. Instead of starting from scratch each session, you get:

- **A 6-phase workflow** that takes a raw idea through design, planning, implementation, review, and shipping
- **A memory system** that compounds knowledge across sessions — decisions, patterns, bugs, architecture all persist
- **Sub-agent orchestration** that routes expensive work to cheaper models automatically
- **Quality gates** at every phase transition so you never ship untested or unreviewed code
- **Session handoffs** so you can stop mid-task and resume with zero context loss

Everything is markdown files and bash scripts. No servers, no databases, no external services required.

---

## Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic/claude-code`
- A Claude account — either a [Claude.ai Pro/Max](https://claude.ai) subscription or an [Anthropic API key](https://console.anthropic.com)

**Optional (based on feature toggles during `/tools:init`):**
- [Obsidian](https://obsidian.md) — if you want graph view and backlinks for the knowledge vault

---

## Setup

### First-time (the Project OS template itself)

```bash
# Clone or unzip to a permanent location
git clone https://github.com/TwoPartDesign/project-os ~/claude-os
cd ~/claude-os
claude

# Inside Claude Code:
/tools:init
```

`/tools:init` will ask a few questions, configure your global `~/.claude/CLAUDE.md`, fill in all placeholders, and offer two optional feature toggles:

- **Obsidian** — enables wikilinks and YAML frontmatter in knowledge files so the vault works in both Claude and Obsidian
- **Context7** — creates `.mcp.json` with a live library docs MCP server, governed by the security wrapper at `.claude/security/mcp-allowlist.json`

### Creating a new project

```bash
# Mac/Linux
bash scripts/new-project.sh my-app ~/projects/my-app

# Windows (Git Bash or WSL)
bash scripts/new-project.sh my-app C:/Users/YourName/projects/my-app

# Open the new project
cd ~/projects/my-app
claude
/tools:init    # Run this first — fills in project variables
```

---

## The Workflow

Six phases. Always start at the top. Never skip from idea to build.

```
/workflows:idea my-feature     Capture idea, research feasibility, write brief
/workflows:design my-feature   Turn brief into a technical spec
/workflows:plan my-feature     Decompose spec into atomic tasks
/workflows:build my-feature    Implement with parallel sub-agents
/workflows:review my-feature   Adversarial quality gate (security, arch, tests)
/workflows:ship my-feature     Final checks and mark complete
```

Each phase reads the output of the previous and writes structured artifacts to `docs/specs/<feature>/`. The design phase catches most mistakes — don't skip it.

For small changes (< 20 lines, single file) you can skip the pipeline and describe the change directly.

---

## All Commands

### Workflow pipeline
| Command | What it does |
|---|---|
| `/workflows:idea [name]` | Capture rough idea, spawn research agents, output structured brief |
| `/workflows:design [name]` | Adversarial first-principles design with self-review |
| `/workflows:plan [name]` | Decompose design into atomic, independently-implementable tasks |
| `/workflows:build [name]` | Orchestrate parallel sub-agents to implement tasks |
| `/workflows:review [name]` | Three independent reviewers: drift, security, tests |
| `/workflows:ship [name]` | Pre-ship checklist, cleanup, mark done |

### Tools
| Command | What it does |
|---|---|
| `/tools:init` | First-run setup — scan for placeholders, ask questions, fill them in |
| `/tools:handoff` | Save session state to `.claude/sessions/` before closing |
| `/tools:catchup` | Restore context from last session handoff |
| `/tools:commit` | Quality-checked git commit with pre-flight scan |
| `/tools:research [topic]` | Spawn parallel research agents on a topic |
| `/tools:kv set/get/list` | Quick key-value notes that persist in `docs/knowledge/kv.md` |

### Project management
| Command | What it does |
|---|---|
| `/pm:prd [name]` | Guided product requirements doc via Socratic discovery |
| `/pm:epic [name]` | Break a PRD into tracked tasks in ROADMAP.md |
| `/pm:status` | Snapshot of current project state |

---

## Project Structure

```
project-os/
├── CLAUDE.md                    # Project constitution — rules, stack, conventions
├── CLAUDE.template.md           # Clean template used when bootstrapping new projects
├── ROADMAP.md                   # Task tracking (Todo / In Progress / Done / Blocked)
├── global-CLAUDE.md             # Template for ~/.claude/CLAUDE.md (used by /tools:init)
├── SETUP-README.txt             # Plain-text setup guide (readable before Claude is installed)
├── docs/
│   ├── product.md               # Product vision
│   └── tech.md                  # Tech stack decisions
├── .claude/
│   ├── commands/
│   │   ├── workflows/           # idea, design, plan, build, review, ship
│   │   ├── tools/               # init, handoff, catchup, commit, research, kv
│   │   └── pm/                  # prd, epic, status
│   ├── agents/                  # Sub-agent persona definitions
│   │   ├── implementer.md       # Writes code — no design authority
│   │   ├── researcher.md        # Research only — no writes
│   │   ├── reviewer-*.md        # Adversarial reviewers (arch, security, tests)
│   │   └── documenter.md        # Docs and comments
│   ├── skills/                  # On-demand protocol injections
│   │   ├── spec-driven-dev/     # SDD protocol (triggered by: implement, build, add)
│   │   ├── tdd-workflow/        # Red-Green-Refactor (triggered by: test, tdd)
│   │   └── session-management/  # Handoff protocol (triggered by: handoff, done)
│   ├── knowledge/               # Compounding project knowledge vault
│   │   ├── architecture.md      # Living system design doc
│   │   ├── decisions.md         # Architecture decision records
│   │   ├── patterns.md          # Established code conventions
│   │   ├── bugs.md              # Root causes and fixes
│   │   └── kv.md                # Key-value store
│   ├── rules/                   # Glob-matched contextual rules
│   │   ├── api.md               # Loaded when working on API files
│   │   ├── tests.md             # Loaded when working on test files
│   │   └── escalation.md        # 2-retry cap and model escalation protocol
│   ├── hooks/
│   │   ├── post-tool-use.sh     # Auto-formatter after file edits
│   │   ├── post-write-session.sh # Scrubs secrets from session handoff files
│   │   ├── tool-failure-log.sh  # Logs tool failures (timestamp + name only)
│   │   └── compact-suggest.sh   # Warns when context is filling up
│   ├── security/
│   │   ├── mcp-allowlist.json   # Approved external MCP servers
│   │   └── validate-mcp-output.sh
│   ├── specs/                   # Feature specs (created by workflow pipeline)
│   ├── sessions/                # Session handoff files (gitignored)
│   ├── logs/                    # Hook-generated logs (gitignored)
│   └── settings.json            # Model config, permissions, and hook definitions
└── scripts/
    ├── new-project.sh           # Bootstrap a new project from this template
    ├── memory-search.sh         # Search across all knowledge and session files
    ├── audit-context.sh         # Estimate token cost of loaded context
    └── scrub-secrets.sh         # Redact API keys and tokens from any file
```

---

## Memory System

Five layers, each with a distinct purpose and lifespan:

| Layer | Location | Lifespan | Purpose |
|---|---|---|---|
| Global identity | `~/.claude/CLAUDE.md` | Permanent | Personal preferences, model routing, hard rules |
| Project constitution | `CLAUDE.md` | Project lifetime | Stack, conventions, workflow, skill triggers |
| Knowledge vault | `docs/knowledge/` | Project lifetime | Decisions, patterns, bugs, architecture — compounds over time |
| Feature specs | `docs/specs/<name>/` | Per feature | Brief → design → tasks → review artifacts |
| Session handoffs | `.claude/sessions/` | Until resumed | YAML snapshots for resuming mid-task |

The knowledge vault is the most valuable long-term asset. Decisions get documented with rationale, bug root causes get recorded, patterns get named. Over time, Claude references these automatically and avoids repeating past mistakes.

---

## Model Routing

Project OS uses Claude Code's model tiering to keep costs low:

| Role | Model | Why |
|---|---|---|
| Orchestration & design | Sonnet (primary session) | Complex reasoning, architectural decisions |
| Sub-agent implementation | Haiku (auto-routed) | Focused coding tasks — cheap and fast |
| Adversarial review | Sonnet (isolated context) | Independent judgment, no anchoring bias |

Configured in `.claude/settings.json`:

```json
{
  "model": "sonnet",
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku"
  }
}
```

---

## Design Principles

1. **Context is noise.** Give agents only the narrow, curated signal they need for their specific phase. Less context = higher IQ.
2. **Code is a liability; judgement is an asset.** Every phase transition is a quality gate. The pipeline enforces it.
3. **Audit the auditor.** The agent that builds cannot validate. Separate contexts for execution and review.
4. **Deterministic execution.** If the builder has to guess, the planner failed. Tasks are specified to the function signature.
5. **Agency over automation.** Every phase has a human checkpoint. The system preserves your decision-making authority.

---

## Tips

- **Run `/tools:handoff` before ending any session** with work in progress. Saves a YAML snapshot so you can resume with zero context loss via `/tools:catchup`.
- **Use `/clear` between unrelated tasks.** A fresh context window is the single most impactful performance optimization.
- **The knowledge vault compounds.** The longer you use a project, the smarter Claude gets about it. Document decisions and root causes as you go.
- **Sub-agents run on Haiku by default.** Change `CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json` if you want more power for implementation tasks.
- **ROADMAP.md legend:** `[ ]` Todo · `[-]` In Progress · `[x]` Done · `[!]` Blocked

---

## Obsidian Integration

Project OS ships with an `.obsidian/` vault config. Open the project folder directly in Obsidian to get a second view into your knowledge base — graph view, backlinks, tag filtering, and full-text search across all your specs, decisions, and architecture docs.

**What you get:**
- **Graph view** — see how decisions, patterns, specs, and architecture files connect
- **Backlinks** — navigate from a decision to every spec that references it
- **Tag filtering** — filter knowledge files by `#decisions`, `#patterns`, `#bugs`, `#architecture`
- **Full-text search** — search across all your `docs/knowledge/` files and specs at once
- **Live preview** — read specs and handoff files without opening a terminal

**Setup:**
1. Open Obsidian → "Open folder as vault"
2. Select your project root (the folder containing `CLAUDE.md`)
3. That's it — backlinks and graph are live immediately

**How it works with Claude:**
The knowledge files (`docs/knowledge/*.md`) have YAML frontmatter with tags so Obsidian can index them. Claude ignores frontmatter, so this is transparent to the workflow. Wikilinks like `[[decisions]]` work in both tools.

**What's committed vs. ignored:**

| File | Status | Why |
|---|---|---|
| `.obsidian/app.json` | Committed | Vault settings — use wikilinks, new file location |
| `.obsidian/core-plugins.json` | Committed | Enables graph, backlinks, tag pane, search |
| `.obsidian/workspace.json` | Gitignored | User-specific open tabs and layout |
| `.obsidian/workspace-mobile.json` | Gitignored | Mobile layout state |
| `.obsidian/cache` | Gitignored | Search index |

Community plugins are not required and not configured — core plugins cover everything needed.

---

## License

MIT — see [LICENSE](LICENSE) for details.