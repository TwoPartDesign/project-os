# The Bleeding-Edge Claude Code Personal Project OS
## Architecture & Implementation Guide — Native-First Edition

**Version**: 2.0 — Wave Orchestration + Governance
**Purpose**: A complete reference for a single-developer orchestration system built entirely on Claude Code's native primitives, with zero required external dependencies.
**Usage**: Feed this document to Claude Code as a build spec, or use it as a reference while running the live system. It documents every file, every command, and the full directory structure.

---

## Design Philosophy

This system is built on five principles distilled from thousands of hours of community iteration:

1. **Context is noise.** Bigger token windows are a trap. Give agents only the narrow, curated signal they need for their specific phase. Less context = higher IQ.
2. **Code is a liability; judgement is an asset.** The pipeline goes: idea → crystallized brief → grounded first-principles design → adversarial review → atomic planning → parallel build → validation. Every transition is a quality gate.
3. **Audit the auditor.** The agent that builds the code cannot validate it. Separate contexts for execution and validation.
4. **Deterministic execution.** If the builder has to guess, the planner failed. Test cases defined at plan time, not after build.
5. **Agency over automation.** Every phase has a human checkpoint. The system preserves your intent and decision-making authority.

### Why native-only?

External dependencies are attack surface, maintenance burden, and single points of failure. Claude Code's native primitives — slash commands, sub-agents, agent teams, skills, hooks, rules, model tiering, auto-compaction, and git — are sufficient to build the entire orchestration layer. The only genuinely hard-to-replicate external capability is live library documentation (Context7), for which we provide an optional security-wrapped integration pattern.

---

## Dependency Analysis

### Fully native (zero dependencies)

| Capability | Native Implementation |
|---|---|
| Workflow engine | `.claude/commands/` slash commands |
| Memory hierarchy | Tiered markdown files + git versioning |
| Session continuity | YAML handoff files + `/compact` instructions |
| Task tracking | `ROADMAP.md` with 7-state markers, `#TN` IDs, dependency syntax |
| Parallel execution | Wave-based sub-agents via `Task` tool + `isolation: worktree` |
| DAG scheduling | `scripts/unblocked-tasks.sh` (JSON output), `scripts/validate-roadmap.sh` (cycle detection) |
| Governance gate | `/pm:approve` promotes `[?]` drafts → `[ ]` approved |
| Competitive implementation | `/workflows:compete` — N parallel strategies, human picks winner |
| Adversarial review | Parallel sub-agents with isolated prompts |
| Drift detection | Sub-agent comparing `git diff` against spec |
| Knowledge compounding | Structured `docs/knowledge/` directory |
| Context optimization | Skill trigger tables + aggressive compaction |
| Model tiering | `settings.json` model config |
| Quality gates | Gate checks at the top of each workflow command |
| Code conventions | `.claude/rules/` glob-matched contextual rules |
| Auto-formatting | `.claude/hooks/` lifecycle hooks |
| Activity logging | JSONL event log via `log-activity.sh`, queried via `/tools:metrics` |
| Cross-project visibility | `scripts/dashboard.sh` + `/tools:dashboard` |
| Agent routing | `(agent: <name>)` annotations + adapter interface (`.claude/agents/adapters/`) |
| Cross-agent memory | Shared `.claude/` directory readable by any agent (Claude Code, Codex, etc.) |

### Optional external (with security wrapper)

| Capability | External Tool | Security Pattern |
|---|---|---|
| Live library docs | Context7 MCP | Sandboxed MCP with network allowlist + output validation |
| Task management | Task Master AI | Optional; native ROADMAP.md is sufficient for personal projects |

---

## Memory Architecture

Five layers, each with a distinct purpose and lifespan. No external services required — everything is markdown files versioned in git.

### Layer 1 — Global Identity (`~/.claude/CLAUDE.md`)

Loaded every session, every project. Personal preferences, interaction style, model routing. Keep under 50 lines.

```markdown
# Global Configuration — All Projects

## Identity
- I am a solo developer working on personal projects
- I value: clarity over cleverness, working software over perfect architecture, shipping over planning
- My tools: Claude Code (primary), Codex (async tasks)

## Interaction Style
- Be direct. Skip preamble.
- When uncertain, ask ONE focused question rather than guessing
- Present tradeoffs as a table when there are >2 options
- Never say "Great question!" or "Absolutely!" — just answer

## Coding Preferences
- Prefer functional patterns over OOP where sensible
- Prefer composition over inheritance
- Use early returns to reduce nesting
- Error handling: fail fast, fail loud, structured errors
- No `any` types in TypeScript. No bare `except` in Python.

## Model Routing
- Sonnet: Default for all interactive work
- Haiku: Sub-agents for implementation tasks
- Opus: Final adversarial review only (when explicitly invoked)

## Global Rules
- ALWAYS check `docs/knowledge/` before proposing a pattern — it may already be documented
- ALWAYS update ROADMAP.md when completing tasks
- NEVER commit without running tests
- NEVER add dependencies without documenting rationale in decisions.md
```

### Layer 2 — Project Constitution (`./CLAUDE.md`)

The guardrail document for the current project. Tells Claude what to do, not everything about the project. Keep under 150 lines. Uses skill trigger tables for on-demand context loading.

```markdown
# Project Constitution

## Identity
- Project: [PROJECT_NAME]
- Type: Personal project
- Owner: [YOUR_NAME]
- Created: [DATE]

## Tech Stack
- Language: [e.g., TypeScript, Python]
- Framework: [e.g., Next.js, FastAPI]
- Database: [e.g., SQLite, Postgres]
- Runtime: [e.g., Node 22, Python 3.12]

## Architecture Principles
- Prefer simplicity over abstraction
- No premature optimization
- Every decision gets documented in `docs/knowledge/decisions.md`
- Code is a liability; clarity is an asset

## Conventions
- Use descriptive variable names over comments
- One concern per file
- Tests live next to the code they test (`*.test.ts` / `test_*.py`)
- Commit messages: `<type>: <what changed>` (feat/fix/refactor/docs/test)

## Workflow Protocol
- NEVER write code without a spec in `docs/specs/`
- NEVER skip the review phase for anything touching auth, data, or money
- Update ROADMAP.md after every task completion
- Run `/tools:handoff` before ending any session with WIP

## Memory Protocol
- Save architectural decisions to `docs/knowledge/decisions.md`
- Save discovered patterns to `docs/knowledge/patterns.md`
- Save bug root causes to `docs/knowledge/bugs.md`
- Run `/tools:handoff` at ~70% context usage

## Skill Triggers
| Pattern | Skill | Action |
|---|---|---|
| implement, build, add feature | spec-driven-dev | Load SDD protocol from `.claude/skills/spec-driven-dev/SKILL.md` |
| test, tdd, verify, coverage | tdd-workflow | Load TDD protocol from `.claude/skills/tdd-workflow/SKILL.md` |
| handoff, done, end session, switching | session-management | Auto-save state via `.claude/skills/session-management/SKILL.md` |

## Context Rules
- Load ONLY what's needed for the current phase. Do not preload specs, designs, or history unless explicitly required.
- Sub-agents receive ONLY: their task description, acceptance criteria, and the relevant design section.
- When context exceeds 50%, run `/compact` with a targeted summary instruction.

## Project-Specific Notes
<!-- Add project-specific conventions, API patterns, naming schemes here -->
```

### Layer 3 — Structured Knowledge Vault (`docs/knowledge/`)

Topic-specific markdown files that compound over time. Not loaded by default — referenced on demand by skills and commands.

**`docs/knowledge/decisions.md`**:
```markdown
# Architectural Decision Records

## Format
Each entry: Date, Decision, Context, Alternatives Considered, Rationale

---

<!-- Entries get appended here by workflows and handoff commands -->
```

**`docs/knowledge/patterns.md`**:
```markdown
# Established Patterns

## Format
Each entry: Pattern Name, When to Use, Example, Anti-pattern to Avoid

---

<!-- Entries get appended here as patterns are discovered during build and review -->
```

**`docs/knowledge/bugs.md`**:
```markdown
# Bug Root Causes

## Format
Each entry: Date, Symptom, Root Cause, Fix, Prevention Rule

---

<!-- Entries get appended here when bugs are found and fixed -->
```

**`docs/knowledge/architecture.md`**:
```markdown
# System Architecture

## High-Level Structure
<!-- Updated as the system evolves -->

## Module Map
<!-- Which modules exist, what they do, how they connect -->

## Data Flow
<!-- How data moves through the system -->

---

<!-- This file is read by /workflows:design to ensure new features align with existing architecture -->
```

### Layer 4 — Session State (`.claude/sessions/`)

Structured YAML handoff files that capture everything needed to resume in a fresh session with zero context loss. Created by `/tools:handoff`, consumed by `/tools:catchup`.

### Layer 5 — Cross-Agent Shared Memory

For Claude Code + Codex workflows, the `.claude/` directory itself IS the cross-agent memory. Both tools can read the same markdown files, the same knowledge vault, the same session handoffs. No external MCP needed — just a shared filesystem.

If you want to add semantic search over your memory vault later, a local SQLite FTS5 index (as EchoVault does) can be built as a project utility script with zero external services. The pattern is provided in the scripts section below.

---

## Complete Directory Structure

```
project-root/
├── CLAUDE.md                           # Layer 2: Project constitution
├── CLAUDE.template.md                  # Bootstrap template (copy → CLAUDE.md for new projects)
├── CLAUDE.local.md                     # Personal overrides (gitignored)
├── ROADMAP.md                          # Task DAG: 7-state markers, #TN IDs, dependencies
│
├── .claude/
│   ├── settings.json                   # Model config, permissions, env, v2 config blocks
│   ├── logs/
│   │   └── activity.jsonl              # JSONL event log (created on first build)
│   │
│   ├── commands/                       # Slash commands
│   │   ├── workflows/                  # Multi-phase orchestrations
│   │   │   ├── idea.md                 # /workflows:idea — capture + research
│   │   │   ├── design.md               # /workflows:design — spec generation
│   │   │   ├── plan.md                 # /workflows:plan — task decomp → [?] drafts
│   │   │   ├── build.md                # /workflows:build — wave-based parallel impl
│   │   │   ├── review.md               # /workflows:review — adversarial quality gate
│   │   │   ├── ship.md                 # /workflows:ship — final validation + PR
│   │   │   ├── compete.md              # /workflows:compete — N competing implementations
│   │   │   └── compete-review.md       # /workflows:compete-review — score + pick winner
│   │   ├── tools/                      # Single-purpose utilities
│   │   │   ├── handoff.md              # /tools:handoff — session state capture
│   │   │   ├── catchup.md              # /tools:catchup — reload WIP context
│   │   │   ├── init.md                 # /tools:init — first-run project setup
│   │   │   ├── research.md             # /tools:research — parallel research agents
│   │   │   ├── commit.md               # /tools:commit — quality-checked git commit
│   │   │   ├── kv.md                   # /tools:kv — quick key-value memory operations
│   │   │   ├── metrics.md              # /tools:metrics — query activity logs
│   │   │   └── dashboard.md            # /tools:dashboard — cross-project status view
│   │   └── pm/                         # Product management
│   │       ├── prd.md                  # /pm:prd — guided PRD creation
│   │       ├── epic.md                 # /pm:epic — PRD → task breakdown
│   │       ├── approve.md              # /pm:approve — governance gate [?] → [ ]
│   │       └── status.md               # /pm:status — project status synthesis
│   │
│   ├── agents/                         # Sub-agent persona definitions (with YAML frontmatter)
│   │   ├── researcher.md               # Architect role — research agent
│   │   ├── implementer.md              # Developer role — scoped implementation
│   │   ├── reviewer-security.md        # Reviewer role — security gate
│   │   ├── reviewer-architecture.md    # Reviewer role — architecture drift
│   │   ├── reviewer-tests.md           # Reviewer role — test coverage
│   │   ├── documenter.md               # Developer role — documentation agent
│   │   ├── roles.md                    # Role permission matrix
│   │   ├── handoffs.md                 # Phase handoff artifact contracts
│   │   └── adapters/                   # Agent adapter scripts
│   │       ├── INTERFACE.md            # Adapter 3-command contract spec
│   │       ├── claude-code.sh          # Default adapter (functional)
│   │       ├── codex.sh                # Stub (v2.1+)
│   │       ├── gemini.sh               # Stub (v2.1+)
│   │       ├── aider.sh                # Stub (v2.1+)
│   │       └── amp.sh                  # Stub (v2.1+)
│   │
│   ├── skills/                         # On-demand capability protocols
│   │   ├── spec-driven-dev/
│   │   │   └── SKILL.md
│   │   ├── tdd-workflow/
│   │   │   └── SKILL.md
│   │   └── session-management/
│   │       └── SKILL.md
│   │
│   ├── sessions/                       # Session handoff files (gitignored)
│   │   └── (handoff-YYYY-MM-DD-HHMM.yaml files)
│   │
│   ├── specs/                          # Feature specifications
│   │   └── (feature-name)/
│   │       ├── brief.md
│   │       ├── design.md
│   │       ├── tasks.md
│   │       ├── review.md
│   │       └── tasks/                  # Per-task work dirs (created by /workflows:build)
│   │           └── TN/
│   │               ├── context/        # Context packet fed to agent
│   │               ├── completion-report.md
│   │               └── compete-*.md    # If /workflows:compete was used
│   │
│   ├── rules/                          # Glob-matched contextual rules
│   │   ├── tests.md
│   │   └── api.md
│   │
│   ├── hooks/                          # Lifecycle hooks (8 total)
│   │   ├── post-tool-use.sh            # Auto-format on Write/Edit
│   │   ├── post-write-session.sh       # Session checkpoint on Write/Edit
│   │   ├── post-mcp-validate.sh        # Validate Context7 MCP output
│   │   ├── log-activity.sh             # JSONL event logging (13 event types)
│   │   ├── notify-phase-change.sh      # Desktop notifications on phase transitions
│   │   ├── preserve-sessions.sh        # Save worktree sessions before cleanup
│   │   ├── tool-failure-log.sh         # Log tool failures for diagnostics
│   │   └── compact-suggest.sh          # Suggest /compact when context is high
│   │
│   └── security/                       # Security wrappers for optional external tools
│       ├── mcp-allowlist.json
│       └── validate-mcp-output.sh
│
├── docs/
│   ├── product.md                      # Product vision
│   ├── tech.md                         # Tech decisions
│   ├── memory/                         # Cross-session searchable memory
│   ├── knowledge/                      # Compounding project knowledge
│   │   ├── decisions.md
│   │   ├── patterns.md
│   │   ├── bugs.md
│   │   ├── architecture.md
│   │   └── metrics.md                  # Per-feature metrics snapshots
│   └── research/                       # Research artifacts
│
├── scripts/                            # Utility scripts (8 total)
│   ├── new-project.sh                  # Bootstrap a new project
│   ├── memory-search.sh                # Full-text search over knowledge vault
│   ├── audit-context.sh                # Report context token estimates
│   ├── unblocked-tasks.sh              # Output unblocked [ ] tasks as JSON
│   ├── validate-roadmap.sh             # Detect cycles, dangling refs, duplicate IDs
│   ├── dashboard.sh                    # ASCII status table for all projects
│   ├── create-pr.sh                    # Generate PR descriptions from specs + history
│   └── scrub-secrets.sh                # Scan for accidental credential exposure
│
└── src/                                # Source code
```

---

## Settings Configuration

**`.claude/settings.json`**:
```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(cat *)",
      "Bash(ls *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(sort *)",
      "Bash(awk *)",
      "Bash(sed *)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(curl:* | bash)",
      "Bash(wget:* | bash)"
    ]
  },
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  },
  "project_os": {
    "parallel": {
      "max_concurrent_agents": 4,
      "worktree_base": ".claude/worktrees",
      "auto_cleanup": true,
      "session_handoff_location": ".claude/sessions",
      "backoff": {
        "initial_delay_ms": 1000,
        "max_delay_ms": 30000,
        "multiplier": 2
      }
    },
    "compete": {
      "default_approaches": 3,
      "strategies": ["literal", "minimal", "extensible"]
    },
    "adapters": {
      "default": "claude-code",
      "available": ["claude-code", "codex", "gemini", "aider", "amp"],
      "fallback_on_failure": true
    },
    "dashboard": {
      "projects_root": "~/projects"
    }
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__context7__.*",
        "hooks": [{ "type": "command", "command": "bash \".claude/hooks/post-mcp-validate.sh\"" }]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "bash \".claude/hooks/post-tool-use.sh\"" },
          { "type": "command", "command": "bash \".claude/hooks/post-write-session.sh\"" }
        ]
      },
      {
        "matcher": ".*",
        "hooks": [
          { "type": "command", "command": "bash \".claude/hooks/tool-failure-log.sh\"" },
          { "type": "command", "command": "bash \".claude/hooks/compact-suggest.sh\"" }
        ]
      }
    ]
  }
}
```

---

## ROADMAP.md Template

```markdown
# Roadmap

## Legend

| Marker | Meaning | Transition |
|--------|---------|------------|
| `[?]` | Draft — pending `/pm:approve` | → `[ ]` on approval |
| `[ ]` | Todo — approved, ready for work | → `[-]` when started |
| `[-]` | In Progress — agent working | → `[~]` when complete |
| `[~]` | Review — awaiting review pass | → `[x]` on pass, `[!]` on fail |
| `[>]` | Competing — multiple implementations | → `[x]` when winner selected |
| `[x]` | Done | Terminal |
| `[!]` | Blocked | → `[-]` when unblocked |

Every task has a unique `#TN` ID. Dependencies are declared inline: `(depends: #T1, #T2)`.
Optional agent annotation: `(agent: codex)`.

---

## Feature: [feature-name]

### Draft
<!-- New tasks start here. Run /pm:approve to promote to Todo. -->
- [?] Task description #T1
- [?] Task description (depends: #T1) #T2

### Todo
<!-- Approved tasks ready for work -->

### In Progress

### Review

### Done

---

## Backlog

### Ideas
<!-- Raw ideas not yet spec'd. Run /workflows:idea to promote. -->

### Icebox
<!-- Parked ideas. Revisit quarterly. -->

---

*Last updated: [DATE]*
```

---

## Workflow Engine — All Six Phases

The full workflow is **idea → design → plan → build → review → ship**. Never skip phases — the design phase catches 80% of mistakes.

For complete specifications and step-by-step instructions, see `.claude/commands/workflows/` and `.claude/commands/tools/`.

### Phase 1: Idea Capture (`/workflows:idea`)

**Transforms** a fuzzy concept into a structured brief through Socratic discovery. Asks 3-5 focused questions to extract problem statement, success criteria, scope, and constraints. Spawns research sub-agents to check codebase patterns and prior decisions. Creates `docs/specs/$FEATURE/brief.md` with problem, success criteria, scope (IN/OUT), constraints, and research gaps.

**Outputs**: Brief document ready for design phase. Reference: `.claude/commands/workflows/idea.md`

---

### Phase 2: Design Specification (`/workflows:design`)

**Transforms** brief into first-principles technical design. Classifies constraints as HARD (non-negotiable) or SOFT (preference), pattern-matches against existing code, and produces a detailed design document covering approach, data model, API surface, file plan, error handling, and testing strategy. Includes self-critique (simplest version? failure modes? assumptions?) and human checkpoint before approval.

**Outputs**: Design document at `docs/specs/$FEATURE/design.md` with approach, constraints, file plan, error handling, and testing strategy. Reference: `.claude/commands/workflows/design.md`

---

### Phase 3: Task Decomposition (`/workflows:plan`)

**Transforms** design into atomic, independently-implementable tasks. Decomposes each requirement into single-responsibility tasks with exact file paths, function signatures, test cases, and acceptance criteria. Organizes tasks into dependency-aware waves (independent tasks can run in parallel). Creates `docs/specs/$FEATURE/tasks.md` with full task specifications and `docs/specs/$FEATURE/tasks/TN/context.md` per-task context packets. Updates ROADMAP.md with `[?]` drafts and `#TN` IDs (see `docs/knowledge/roadmap-format.md` for ID rules).

**Outputs**: Tasks document at `docs/specs/$FEATURE/tasks.md` with dependency graph and detailed per-task specs. Reference: `.claude/commands/workflows/plan.md`

---

### Phase 4: Implementation (`/workflows:build`)

**Executes** implementation from task plan using wave-based parallel sub-agents. Organizes tasks into dependency-aware waves (dependent tasks can't start until their prerequisites complete). Dispatches up to 4 sub-agents in parallel within each wave using worktree isolation (each agent gets its own git worktree so file changes don't conflict). Monitors completion, collects results, and updates ROADMAP.md markers (`[ ]` → `[-]` → `[~]`). Runs full test suite gate between waves to ensure integration stays clean.

**Outputs**: Task completion reports at `docs/specs/$FEATURE/tasks/TN/completion-report.md`. All completed tasks marked `[~]` (ready for review). Reference: `.claude/commands/workflows/build.md`

---

### Phase 4b: Competitive Implementation (`/workflows:compete`)

**Spawns** N parallel sub-agent implementations of the same task using different strategic prompts (Literal, Minimal, Extensible, or custom). Each runs in a separate worktree in parallel. Collects all implementations, compares code volume/clarity/test coverage, and presents summary for human selection of winner. The chosen implementation then continues to normal build phase.

**Used for**: Critical architectural decisions, skill development, or when uncertainty is high. Optional workflow. Reference: `.claude/commands/workflows/compete.md`

---

### Phase 4c: Competitive Review (`/workflows:compete-review`)

**Reviews** competing implementations side-by-side using independent reviewer sub-agents. Scores each approach on correctness, simplicity, robustness, readability, testability, and convention alignment. Creates a unified comparison matrix and recommends the best-balanced approach. Updates compete-comparison.md with detailed scoring.

**Pairs with**: `/workflows:compete`. Use when competitive implementations are ready for evaluation. Reference: `.claude/commands/workflows/compete-review.md`

---

### Phase 5: Adversarial Review (`/workflows:review`)

**Dispatches** three independent reviewer agents in isolation (Security & Safety, Architecture & Drift, Test Coverage) to audit the completed implementation. Each reviewer operates blind to others' findings. Collects all findings, deduplicates, classifies into MUST FIX (🔴), SHOULD FIX (🟡), and CONSIDER (🟢) buckets. Produces review report with verdict: PASS, PASS WITH NOTES, or FAIL. If FAIL, spawns fix agents for critical issues before re-review.

**Outputs**: Review report at `docs/specs/$FEATURE/review.md` with findings classified by severity. All `[-]` tasks transition to `[~]` (awaiting review). Reference: `.claude/commands/workflows/review.md`

---

### Phase 6: Ship (`/workflows:ship`)

**Executes** final validation checks (clean working tree, all tests passing, linter clean, no debug artifacts or secrets). Cleans commit history if needed, updates project state (marks all tasks done, moves feature to Completed in ROADMAP, updates knowledge documents), archives spec directory, and generates final shipping report with metrics.

**Outputs**: Spec archived at `docs/specs/$FEATURE/`. Feature moved to "Completed" section in ROADMAP.md. Reference: `.claude/commands/workflows/ship.md`

---

## Tool Commands

The following tools support the workflow. Each tool has detailed implementation specs in `.claude/commands/tools/`:

| Command | Purpose | Reference |
|---------|---------|-----------|
| `/tools:handoff` | Capture session state (objective, progress, decisions, blockers, next steps) for resuming in fresh sessions. Writes YAML handoff to `.claude/sessions/`. | `.claude/commands/tools/handoff.md` |
| `/tools:catchup` | Restore context from last session by reading `.claude/sessions/` and synthesizing objective, in-flight work, and prioritized next steps. | `.claude/commands/tools/catchup.md` |
| `/tools:research [topic]` | Spawn parallel research agents to investigate independent questions, then synthesize findings into `docs/research/[topic].md`. | `.claude/commands/tools/research.md` |
| `/tools:commit` | Quality-checked git commit with pre-commit validation: scans for TODOs without tickets, debug statements, commented code, hardcoded secrets, and large files. Uses conventional commit format. | `.claude/commands/tools/commit.md` |
| `/tools:kv` | Quick key-value memory for storing/recalling facts without full ADR ceremony. Operations: `set [key] [value]`, `get [key]`, `list`, `search [query]`. Storage: `docs/knowledge/kv.md`. | `.claude/commands/tools/kv.md` |
| `/tools:init` | First-run project setup: finds unfilled placeholders, asks configuration questions, fills in all variables across the project, saves project profile to memory, initializes git. | `.claude/commands/tools/init.md` |
| `/tools:metrics [feature]` | Query activity logs and feature metrics. Shows summary of all features or detailed metrics for a specific feature, slowest tasks, or feature comparisons. | `.claude/commands/tools/metrics.md` |
| `/tools:dashboard [project]` | Cross-project status dashboard from `.claude/settings.json` → `project_os.dashboard.projects_root`. Shows all Project OS projects with task counts, active worktrees, and recent activity. | `.claude/commands/tools/dashboard.md` |

---

## Product Management Commands

The following commands support project planning and approval workflows. Each command has detailed implementation specs in `.claude/commands/pm/`:

| Command | Purpose | Reference |
|---------|---------|-----------|
| `/pm:approve [feature]` | Governance gate for approving draft tasks `[?]` and promoting them to todo `[ ]` status. Validates dependencies, prevents dangling task approval, and confirms consistency with `validate-roadmap.sh`. | `.claude/commands/pm/approve.md` |
| `/pm:prd [name]` | Guided PRD creation through Socratic discovery. Asks structured questions about problem space, success definition, and scope control. Outputs `docs/prd/[name].md` with one-liner, problem, solution, user stories, metrics, and v0.1/v0.2/out-of-scope sections. | `.claude/commands/pm/prd.md` |
| `/pm:epic [prd-name]` | Transforms a PRD into trackable tasks in ROADMAP.md. Decomposes v0.1 scope items into S/M/L/XL complexity estimates with priority (P0-P3) and dependency annotations. | `.claude/commands/pm/epic.md` |
| `/pm:status [project]` | Synthesizes current project status by reading ROADMAP.md (task counts), latest session handoff, git activity (last 7 days), and active specs. Displays task distribution, active features, and next priority. | `.claude/commands/pm/status.md` |

---

## Agent Definitions

All agents have YAML frontmatter declaring `isolation` mode, `role`, and `permissions`. Permissions are **advisory** in v2 — agents self-enforce based on frontmatter. Hard enforcement planned for v2.1+.

### Roles

**File**: `.claude/agents/roles.md`

| Role | Agents | Responsibility | Phases |
|------|--------|----------------|--------|
| **Architect** | researcher | Investigate, design, document decisions. Never write implementation code. | Idea, Design |
| **Developer** | implementer, documenter | Implement exactly what the spec says. Stay within task scope. | Build |
| **Reviewer** | reviewer-architecture, reviewer-security, reviewer-tests | Evaluate quality, security, alignment. Never modify source code. | Review |
| **Orchestrator** | human (via Claude Code CLI) | Coordinate workflow, approve drafts, resolve conflicts, make final decisions. | All |

### Implementer Agent

**File**: `.claude/agents/implementer.md`

Focused implementation agent for build phase. Receives single task, implements exactly per spec (no more, no less), writes tests first, runs acceptance criteria, and reports completion or blocker. Self-enforces file list boundaries and does not refactor adjacent code.

### Security Reviewer Agent

**File**: `.claude/agents/reviewer-security.md`

Reviews code for security vulnerabilities. Checks input validation (injection, XSS, path traversal), auth/authz bypass vectors, hardcoded secrets, unsafe eval/deserialization, rate limiting, error information leakage, dependency vulnerabilities, file system access, and CORS configuration.

### Architecture Reviewer Agent

**File**: `.claude/agents/reviewer-architecture.md`

Verifies implementation matches design and follows project patterns. Checks for design drift (spec vs. implementation), pattern violations (code contradicts conventions), decision contradictions (conflicts with prior ADRs), unnecessary complexity, missing error handling, and naming consistency.

### Test Reviewer Agent

**File**: `.claude/agents/reviewer-tests.md`

Audits test quality and identifies coverage gaps. Checks for untested functions/branches, happy-path-only tests (missing error paths), missing edge cases (null, empty, boundary, overflow, concurrent), test independence issues, vague assertions, and flaky indicators (timing-dependent, unseeded randomness).

---

## Agent Adapters

**Interface spec**: `.claude/agents/adapters/INTERFACE.md`

Adapters provide uniform 3-command contract for dispatching tasks to different AI coding agents. The orchestrator calls the same interface regardless of which agent runs the task.

**Commands**: `info` (metadata as JSON), `health` (CLI availability check), `execute <context_dir> <output_dir>` (run task)

**Execute Protocol**:
- **Input** (`context_dir/`): `task.md`, `conventions.md`, `design.md`, `files/` (read-only references)
- **Output** (`output_dir/`): `completion-report.md`, `result` (pass/fail), `test-output.txt`, `files/` (modified/created)
- **Environment**: `ADAPTER_TASK_ID`, `ADAPTER_FEATURE`, `ADAPTER_MAX_TURNS`, `ADAPTER_MODEL`

**Adapter Resolution**: Task annotation `(agent: codex)` in ROADMAP.md → Settings default `.claude/settings.json` → Fallback `claude-code`

**Available Adapters (v2)**:
- `claude-code` (Functional, default) — `.claude/agents/adapters/claude-code.sh`
- `codex` (Stub, v2.1+) — `.claude/agents/adapters/codex.sh`
- `gemini` (Stub, v2.1+) — `.claude/agents/adapters/gemini.sh`
- `aider` (Stub, v2.1+) — `.claude/agents/adapters/aider.sh`
- `amp` (Stub, v2.1+) — `.claude/agents/adapters/amp.sh`

v2 limitation: Only `claude-code` functional. Stub adapters exit 1 with "not yet implemented"; tasks fall back to `claude-code`. Hard multi-agent dispatch planned for v2.1+.

---

## Skills (On-Demand Protocols)

Skills provide on-demand protocol loading for specific triggers. Each skill has a detailed implementation spec in `.claude/skills/`:

| Skill | Trigger | Purpose | Reference |
|-------|---------|---------|-----------|
| **Spec-Driven Development** | User asks to implement, build, or add a feature | Enforces spec-first protocol: verify `docs/specs/[feature]/` exists with brief.md, design.md, tasks.md approved before any code. Routes to `/workflows:idea` → `/workflows:design` → `/workflows:plan` → `/workflows:build` as needed. Exception: < 20 line single-file changes. | `.claude/skills/spec-driven-dev/SKILL.md` |
| **TDD Workflow** | User asks to write tests or test task is assigned | Red-Green-Refactor cycle: write failing test first, implement minimum to pass, refactor/clean up. Includes edge case protocol (null, empty, boundary, error, concurrent) and naming convention `[unit]_[scenario]_[expected]`. | `.claude/skills/tdd-workflow/SKILL.md` |
| **Session Management** | User says "handoff", "done", "end session", or context appears high | Auto-trigger `/tools:handoff` when: user signals completion, major phase completes, or conversation exceeds 30 exchanges. Enforces context conservation (load only current-phase sections) and memory hygiene (decisions → `docs/knowledge/decisions.md`, patterns → `patterns.md`, bugs → `bugs.md`). | `.claude/skills/session-management/SKILL.md` |

---

## Contextual Rules

### Test File Rules

**File**: `.claude/rules/tests.md`

```markdown
---
globs: ["**/*.test.*", "**/*.spec.*", "**/test_*", "**/tests/**"]
description: "Rules applied when working with test files"
---

- Every test file must be runnable in isolation
- No shared mutable state between test cases
- Use descriptive test names: `[unit]_[scenario]_[expected]`
- Prefer explicit setup in each test over shared beforeEach
- Mock external dependencies, not internal modules
- Assert specific values, not just truthiness
- Test error messages, not just error types
```

### API Code Rules

**File**: `.claude/rules/api.md`

```markdown
---
globs: ["**/api/**", "**/routes/**", "**/handlers/**"]
description: "Rules applied when working with API code"
---

- Every endpoint must validate its input before processing
- Return structured error responses: { error: string, code: string, details?: any }
- Log errors with context (request ID, user, action) but never log sensitive data
- Set appropriate HTTP status codes — don't return 200 for errors
- Include rate limiting considerations in design
- Document the endpoint in the design spec before implementing
```

---

## Hooks

Eight hooks provide automation, logging, and security across the workflow. All hooks live in `.claude/hooks/` and are wired via `settings.json`.

### `post-tool-use.sh`

**Trigger**: `PostToolUse` on `Write|Edit|MultiEdit`

Auto-formats files after edits and scrubs secrets. Resolves symlinks via `realpath`/`readlink -f` before operating to prevent path traversal. Delegates formatting to Prettier (TS/JS/JSON) or Black (Python) if installed; silently skips if formatter is absent. Calls `scrub-secrets.sh` after formatting.

### `post-write-session.sh`

**Trigger**: `PostToolUse` on `Write|Edit|MultiEdit`

Saves a lightweight session state file to `.claude/sessions/` after every write. Ensures session context is never lost on context compaction or crash. Uses the same symlink-resolved path as `post-tool-use.sh`.

### `post-mcp-validate.sh`

**Trigger**: `PostToolUse` on `mcp__context7__.*`

Validates Context7 MCP output before it enters the context window. Parses the JSON payload from stdin via `jq`. Checks: (1) response size ≤ 50KB — warns if exceeded, (2) hard-block on `<script>` / `javascript:` injection patterns, (3) advisory warning on code heuristics (`eval(`, `subprocess`, `__proto__`, `constructor[`). Requires `jq`; warns and exits 1 if missing.

### `log-activity.sh`

**Trigger**: Called directly by workflow commands (not wired in `settings.json`)

Appends JSONL events to `.claude/logs/activity.jsonl`. Supports 13 event types:

```
task-spawned   task-completed   task-failed   review-started    review-passed
review-failed  revision-started compete-spawned compete-selected  pr-created
feature-shipped plan-approved   session-preserved
```

Uses `flock` for concurrent-safe writes when available. Detects current worktree from git. All key/value metadata is JSON-escaped before writing.

```bash
# Usage
bash .claude/hooks/log-activity.sh task-spawned feature=auth task_id=T3 agent=implementer
```

### `notify-phase-change.sh`

**Trigger**: Called directly by workflow commands

Emits terminal output and OS-level desktop notifications on phase transitions. Supports 6 event types: `task-unblocked`, `review-requested`, `review-failed`, `approval-needed`, `compete-complete`, `feature-complete`. Cross-platform: `notify-send` (Linux), `osascript` via env var (macOS), `powershell.exe` via env var (Windows). Message is sanitized before OS dispatch to strip control chars and injection sequences.

```bash
# Usage
bash .claude/hooks/notify-phase-change.sh review-requested auth
bash .claude/hooks/notify-phase-change.sh review-failed auth T3
```

### `preserve-sessions.sh`

**Trigger**: Called before worktree cleanup (or manually)

Copies `.yml`/`.yaml`/`.md` session files from worktrees to the project root `.claude/sessions/` before cleanup. Prevents session loss on worktree removal (Claude Code worktree bug). Validates that all paths are under `.claude/worktrees/`; rejects symlinks and filenames containing `..`.

### `tool-failure-log.sh`

**Trigger**: `PostToolUse` on `.*` (all tools)

Logs tool failures to `.claude/logs/tool-failures.jsonl` for debugging. Only writes on non-zero exit codes. Useful for diagnosing flaky hook chains or permission errors.

### `compact-suggest.sh`

**Trigger**: `PostToolUse` on `.*` (all tools)

Monitors context window usage and emits a `/compact` suggestion to stderr when usage exceeds a configured threshold (default: 70%). Helps maintain lean context across long sessions without requiring manual monitoring.

---

## Security Wrapper for Optional External MCPs

If you choose to add Context7 or any other external MCP, wrap it with these security controls:

### MCP Allowlist

**File**: `.claude/security/mcp-allowlist.json`

```json
{
  "description": "Allowlist of approved external MCP servers with security constraints",
  "approved_mcps": {
    "context7": {
      "package": "@upstash/context7-mcp",
      "version_pin": "1.0.0",
      "allowed_tools": ["resolve-library-id", "get-library-docs"],
      "network_domains": ["api.context7.com", "registry.npmjs.org"],
      "risk_level": "low",
      "rationale": "Read-only library documentation. No write access. No auth tokens.",
      "audit_date": "2026-02-19",
      "integrity_hash": ""
    }
  },
  "blocked_capabilities": [
    "filesystem_write_outside_project",
    "network_access_to_unlisted_domains",
    "environment_variable_access",
    "subprocess_execution"
  ],
  "review_cadence": "monthly"
}
```

### MCP Output Validation

**File**: `.claude/security/validate-mcp-output.sh`

```bash
#!/bin/bash
# Validate MCP server output before it enters the context window
# Usage: validate-mcp-output.sh <mcp-name> <output-file>

MCP_NAME="$1"
OUTPUT_FILE="$2"
ALLOWLIST=".claude/security/mcp-allowlist.json"

# Check MCP is in allowlist
if ! jq -e ".approved_mcps[\"$MCP_NAME\"]" "$ALLOWLIST" > /dev/null 2>&1; then
  echo "BLOCKED: $MCP_NAME is not in the approved MCP allowlist"
  exit 1
fi

# Check output size (prevent context flooding)
MAX_SIZE=50000  # 50KB — roughly 12K tokens
FILE_SIZE=$(wc -c < "$OUTPUT_FILE")
if [ "$FILE_SIZE" -gt "$MAX_SIZE" ]; then
  echo "WARNING: MCP output exceeds $MAX_SIZE bytes ($FILE_SIZE). Truncating."
  head -c "$MAX_SIZE" "$OUTPUT_FILE" > "${OUTPUT_FILE}.truncated"
  mv "${OUTPUT_FILE}.truncated" "$OUTPUT_FILE"
fi

# Check for suspicious content patterns
SUSPICIOUS_PATTERNS=(
  "eval("
  "exec("
  "import os"
  "subprocess"
  "process.env"
  "__proto__"
  "constructor["
  "<script>"
  "javascript:"
)

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  if grep -qi "$pattern" "$OUTPUT_FILE"; then
    echo "BLOCKED: Suspicious pattern '$pattern' found in MCP output from $MCP_NAME"
    exit 1
  fi
done

echo "PASS: $MCP_NAME output validated ($FILE_SIZE bytes)"
exit 0
```

### Installing Context7 (Optional — With Security Wrapper)

If you want live library docs, install with version pinning:

```bash
# Mac / Linux — pin the version
claude mcp add --scope project context7 -- npx -y @upstash/context7-mcp@1.0.0

# Windows (Git Bash / WSL) — requires cmd /c wrapper
claude mcp add --scope project context7 -- cmd /c npx -y @upstash/context7-mcp@1.0.0

# Add to CLAUDE.md under a conditional section:
# ## Optional MCP: Context7
# When researching library APIs, you may use Context7 tools (resolve-library-id, get-library-docs).
# Validate output size and content before incorporating into context.
# Prefer local docs in node_modules/ or docs/research/ when available.
```

> **Windows note**: The `.mcp.json` entry must use `"command": "cmd"` with `"args": ["/c", "npx", ...]` — using `npx` as the command directly will fail with a warning. `/tools:init` handles this automatically when it detects Windows.

---

## Utility Scripts

### Local Memory Search

**File**: `scripts/memory-search.sh`

```bash
#!/bin/bash
# Search across all knowledge files with context
# Usage: ./scripts/memory-search.sh <query>

QUERY="$1"
KNOWLEDGE_DIR="docs/knowledge"
SESSIONS_DIR=".claude/sessions"

if [ -z "$QUERY" ]; then
  echo "Usage: memory-search.sh <query>"
  exit 1
fi

echo "=== Knowledge Vault ==="
grep -rn -i --color=always "$QUERY" "$KNOWLEDGE_DIR/" 2>/dev/null || echo "No matches in knowledge vault"

echo ""
echo "=== Session Handoffs ==="
grep -rn -i --color=always "$QUERY" "$SESSIONS_DIR/" 2>/dev/null || echo "No matches in sessions"

echo ""
echo "=== Research Docs ==="
grep -rn -i --color=always "$QUERY" "docs/research/" 2>/dev/null || echo "No matches in research"

echo ""
echo "=== Specs ==="
grep -rn -i --color=always "$QUERY" "docs/specs/" 2>/dev/null || echo "No matches in specs"
```

### New Project Bootstrap

**File**: `scripts/new-project.sh`

```bash
#!/usr/bin/env bash
# Bootstrap a new project with the Project OS structure
# Usage: ./scripts/new-project.sh <project-name> <project-path>

set -euo pipefail

PROJECT_NAME="${1:-}"
PROJECT_PATH="${2:-}"

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_PATH" ]; then
  echo "Usage: new-project.sh <project-name> <project-path>" >&2
  exit 1
fi

# Reject path traversal and leading-dash values
if [[ "$PROJECT_PATH" == -* ]]; then
    echo "ERROR: PROJECT_PATH must not start with '-'." >&2; exit 1
fi
if [[ "$PROJECT_PATH" =~ \.\. ]]; then
    echo "ERROR: PROJECT_PATH must not contain '..'." >&2; exit 1
fi
if [[ "$PROJECT_NAME" =~ \.\. ]] || [[ "$PROJECT_NAME" =~ [/\\] ]] || \
   [[ ! "$PROJECT_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "ERROR: Invalid project name '${PROJECT_NAME}'." >&2; exit 1
fi

echo "Creating project: $PROJECT_NAME at $PROJECT_PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$PROJECT_PATH"/{.claude/{commands/{workflows,tools,pm},agents,\
skills/{spec-driven-dev,tdd-workflow,session-management},sessions,rules,\
hooks,security},docs/{prd,research,knowledge,specs,memory},scripts,src}

cp -r "$TEMPLATE_DIR/.obsidian"             "$PROJECT_PATH/" 2>/dev/null || true
cp -r "$TEMPLATE_DIR/.claude/commands"      "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/agents"        "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/skills"        "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/rules"         "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/hooks"         "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/security"      "$PROJECT_PATH/.claude/"
cp    "$TEMPLATE_DIR/.claude/settings.json" "$PROJECT_PATH/.claude/"

sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" \
    "$TEMPLATE_DIR/CLAUDE.template.md" > "$PROJECT_PATH/CLAUDE.md"
cp "$TEMPLATE_DIR/ROADMAP.md"        "$PROJECT_PATH/"
cp "$TEMPLATE_DIR/global-CLAUDE.md"  "$PROJECT_PATH/"

for f in decisions.md patterns.md bugs.md architecture.md kv.md metrics.md; do
  cp "$TEMPLATE_DIR/docs/knowledge/$f" "$PROJECT_PATH/docs/knowledge/"
done

touch "$PROJECT_PATH/docs/specs/.gitkeep"
touch "$PROJECT_PATH/docs/memory/.gitkeep"

for script in memory-search.sh audit-context.sh scrub-secrets.sh \
              validate-roadmap.sh unblocked-tasks.sh create-pr.sh dashboard.sh; do
  cp "$TEMPLATE_DIR/scripts/$script" "$PROJECT_PATH/scripts/"
done
chmod +x "$PROJECT_PATH/scripts/"*.sh
chmod +x "$PROJECT_PATH/.claude/hooks/"*.sh 2>/dev/null
chmod +x "$PROJECT_PATH/.claude/security/"*.sh 2>/dev/null

cd "$PROJECT_PATH"
cat > .gitignore << 'GI'
CLAUDE.local.md
.claude/sessions/
.claude/logs/
.claude/settings.local.json
node_modules/
.env
.env.*
docs/research/
docs/specs/*
!docs/specs/.gitkeep
docs/memory/*
!docs/memory/.gitkeep
dist/
build/
GI

git init
git add .
git commit -m "chore: initialize project with Project OS scaffold"

echo ""
echo "Project '$PROJECT_NAME' initialized at $PROJECT_PATH"
echo ""
echo "Next steps:"
echo "  cd $PROJECT_PATH && claude"
echo "  /tools:init               # Fill in project variables (run this first)"
echo "  /pm:prd [feature-name]    # Start with product thinking"
echo "  /workflows:idea [name]    # Or jump into a feature spec"
```

### Context Audit

**File**: `scripts/audit-context.sh`

```bash
#!/bin/bash
# Estimate token cost of CLAUDE.md and loaded context
# Rough estimate: 1 token ≈ 4 characters

echo "=== Context Token Estimates ==="
echo ""

estimate_tokens() {
  local file="$1"
  local label="$2"
  if [ -f "$file" ]; then
    chars=$(wc -c < "$file")
    tokens=$((chars / 4))
    printf "%-45s %6d tokens  (%d bytes)\n" "$label" "$tokens" "$chars"
  fi
}

estimate_tokens "CLAUDE.md" "Project constitution (CLAUDE.md)"
estimate_tokens "ROADMAP.md" "Roadmap"

echo ""
echo "--- Knowledge vault ---"
for f in docs/knowledge/*.md; do
  [ -f "$f" ] && estimate_tokens "$f" "  $(basename $f)"
done

echo ""
echo "--- Active specs ---"
for d in docs/specs/*/; do
  [ -d "$d" ] || continue
  echo "  $(basename $d)/"
  for f in "$d"*.md; do
    [ -f "$f" ] && estimate_tokens "$f" "    $(basename $f)"
  done
done

echo ""
TOTAL_CHARS=0
for f in CLAUDE.md docs/knowledge/*.md; do
  [ -f "$f" ] && TOTAL_CHARS=$((TOTAL_CHARS + $(wc -c < "$f")))
done
TOTAL_TOKENS=$((TOTAL_CHARS / 4))
PCT=$(echo "scale=2; $TOTAL_TOKENS * 100 / 200000" | bc 2>/dev/null || echo "?")

echo "=== TOTAL always-loaded context: ~${TOTAL_TOKENS} tokens (${PCT}% of 200K window) ==="
```

### Unblocked Tasks

**File**: `scripts/unblocked-tasks.sh`

Parses `ROADMAP.md` and outputs a JSON array of all tasks that are ready to run: status `[ ]` (Todo) with all dependencies in `[x]` (Done).

```bash
# Usage
bash scripts/unblocked-tasks.sh                    # all unblocked tasks
bash scripts/unblocked-tasks.sh --agent codex      # filter by agent annotation
bash scripts/unblocked-tasks.sh path/to/ROADMAP.md # alternate roadmap path

# Output (JSON array)
[
  {"id": "T3", "title": "Add rate limiting", "agent": "claude-code",
   "deps": ["T1", "T2"]},
  ...
]
```

Used by `/workflows:build` to compute dependency waves. Tasks with no `(agent: ...)` annotation default to `claude-code`.

### Validate Roadmap

**File**: `scripts/validate-roadmap.sh`

Validates `ROADMAP.md` structure and catches consistency errors before they propagate into build waves.

**Checks performed:**
1. All task IDs are unique (no duplicates)
2. All `(depends: #TN)` references point to existing task IDs
3. No dependency cycles (DFS-based cycle detection)
4. State consistency (e.g., a `[ ]` task cannot depend on a `[!]` blocked task)
5. Orphan detection (tasks whose dependencies have all been removed)

```bash
# Usage
bash scripts/validate-roadmap.sh              # validates ROADMAP.md
bash scripts/validate-roadmap.sh path/to/ROADMAP.md

# Exit: 0 if valid, 1 if errors found (with details on stderr)
```

Run automatically by `/workflows:plan` (after task creation) and `/pm:approve` (before promotion).

### Dashboard

**File**: `scripts/dashboard.sh`

Scans all Project OS projects on the filesystem and prints a cross-project status table.

```bash
# Usage
bash scripts/dashboard.sh [root_dir]   # default: $HOME

# Output (ASCII table)
PROJECT          BRANCH   TODO  WIP  REVIEW  DONE  BLOCKED
auth-service     main       3    1      0      12      0
billing-api      feature    1    2      1       5      1
...
```

The `root_dir` is searched recursively for directories containing both `ROADMAP.md` and `.claude/`. Uses `git branch --show-current` with detached-HEAD detection (`${branch:-detached}`). Invoked by `/tools:dashboard`.

### Create PR

**File**: `scripts/create-pr.sh`

Generates a pull request with an AI-assisted description assembled from: the feature spec (`docs/specs/<feature>/design.md`), the latest review report, and the commit history (`git log --oneline`).

```bash
# Usage
bash scripts/create-pr.sh <feature_name> [base_branch]

# Requires: gh CLI authenticated
# Validates: feature_name (alphanumeric, dots, hyphens, underscores only)
# Auto-detects base branch (main → master → error)
```

Invoked by `/workflows:ship` as the final step before PR creation.

### Scrub Secrets

**File**: `scripts/scrub-secrets.sh`

Scrubs known secret patterns from a file in-place. Called by `post-tool-use.sh` after every write.

**Pattern families covered:**
- OpenAI: `sk-proj-*`, `sk-*`
- Anthropic: `sk-ant-*`
- GitHub: `ghp_*`, `gho_*`, `ghu_*`, `ghs_*`, `ghr_*`, `github_pat_*`
- AWS: `AKIA*` (long-term), `ASIA*` (STS temporary)
- Stripe: `sk_live_*`, `rk_live_*`
- Perplexity, HuggingFace, Replicate, generic bearer tokens

```bash
# Usage
bash scripts/scrub-secrets.sh <filepath>
# Prints count of secrets redacted to stderr
```

---

## Context Optimization Techniques

### 1. Skill trigger tables replace embedded protocols

Instead of embedding the full TDD protocol, adversarial review checklist, and session management rules in CLAUDE.md, the Skill Triggers table instructs Claude to load the full SKILL.md file ONLY when triggered. This achieves 50-80% reduction in cold-start context.

### 2. Sub-agents as context firewalls

Every sub-agent gets its own 200K token window. The main session stays lean while sub-agents load task-specific context. The Build workflow explicitly passes ONLY the task block plus conventions — never the full spec history.

### 3. Aggressive compaction at 50%

`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "50"` fires compaction earlier than default. When compacting manually, always provide targeted instructions: `/compact Focus on the auth module changes and the failing test in user-service.ts`.

### 4. The /clear discipline

Use `/clear` between unrelated tasks. Fresh 200K window. Simplest and most impactful optimization.

### 5. Handoff files replace conversation memory

Instead of relying on conversation context for session continuity, structured YAML handoff files capture only what matters — with file:line references instead of full contents.

---

## Claude Code + Codex Complementary Pattern

The `.claude/` directory IS the cross-agent shared memory. Both Claude Code and Codex can read and write to the same files.

**Claude Code handles**: architectural decisions, complex multi-file refactoring, spec writing, interactive debugging, review, orchestration. Its interactive model excels at reasoning-heavy work.

**Codex handles**: autonomous background tasks, quick fixes, test scaffolding, documentation generation, fire-and-forget implementations.

**Handoff pattern**: Claude writes the spec and decomposes tasks → individual tasks can be dispatched to Codex asynchronously. Both agents read `docs/knowledge/` for context and write session notes to `.claude/sessions/`.

---

## Implementation Order

Don't build everything at once. Highest-leverage sequence for bootstrapping a new project from the v2 template:

**Week 1 — Foundation**: Clone the template repo. Run `scripts/new-project.sh` to bootstrap the structure. Open the new project in Claude Code and run `/tools:init` to fill in placeholders and configure feature toggles (Obsidian, Context7, Windows). Start using `/tools:handoff` and `/tools:catchup` immediately. This alone eliminates the "starting from scratch" problem.

**Week 2 — Workflow Pipeline (Core)**: Use `/workflows:idea` → `/workflows:design` → `/workflows:plan` → `/pm:approve` → `/workflows:build` for your first real feature. Learn the rhythm. The pipeline catches 80% of mistakes before they become code.

**Week 3 — Quality Gates**: Enable `/workflows:review` (three adversarial reviewers: security, architecture, tests). Add contextual rules (`.claude/rules/`). Set up `post-tool-use.sh` formatting hook for your stack (Prettier, Black). Start running `scripts/audit-context.sh` to track context weight.

**Week 4 — PM & Governance**: Implement the product management layer: `/pm:prd`, `/pm:epic`, `/pm:status`. Start using `[?]` draft tasks and `/pm:approve` as your governance gate. Never let unapproved work enter the build queue.

**Week 5 — Parallel Builds**: Enable wave-based parallel builds in `settings.json` (`project_os.parallel.enabled: true`). Set `max_concurrent_agents` based on your machine's capacity. Run `scripts/validate-roadmap.sh` before every build to catch dependency errors early.

**Week 6 — Observability**: Enable activity logging (`log-activity.sh`). Use `/tools:metrics` to view feature velocity, slow tasks, and agent performance. Set up `notify-phase-change.sh` for desktop notifications. Run `/tools:dashboard` to see cross-project status.

**Week 7 — Competitive Flows**: Try `/workflows:compete` on a task where you're unsure of the right approach. Use `/workflows:compete-review` to score implementations on 6 axes. Reserve this for genuinely ambiguous architectural decisions — it's expensive.

**Week 8 — Ship & Bootstrap**: Use `/workflows:ship` for your first full PR with auto-generated description. Run `scripts/scrub-secrets.sh` as a final check. Bootstrap your second project with `scripts/new-project.sh` — the muscle memory from project 1 makes project 2 much faster.

---

## Key Repos and References

For further study, these are the community projects this system synthesizes from:

- **Pimzino/claude-code-spec-workflow** — The spec-driven pipeline pattern (Requirements → Design → Tasks → Implementation)
- **wshobson/commands** — Production-ready slash command structures
- **automazeio/ccpm** — Project management with GitHub Issues integration
- **zscole/adversarial-spec** — Multi-model debate for spec refinement
- **ChrisWiles/claude-code-showcase** — Comprehensive hooks, skills, and agents example
- **hesreallyhim/awesome-claude-code** — Canonical index of the ecosystem (23.5K+ stars)
- **mraza007/echovault** — Local-first memory architecture (if you later want the SQLite layer)
- **0xrdan/claude-router** — Model routing by complexity
- **dadbodgeoff/drift** — Convention drift detection

The tools exist. The patterns are proven. This document gives you the blueprint to assemble them into your personal workflow without external dependencies.
