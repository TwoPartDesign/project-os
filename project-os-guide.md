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

### Phase 1: Idea Capture (`/workflows:idea`)

**File**: `.claude/commands/workflows/idea.md`

```markdown
---
description: "Capture a raw idea and transform it into a structured brief through guided discovery"
---

# Idea Capture Workflow

You are entering IDEA CAPTURE mode. Your job is to extract a clear, actionable brief from a fuzzy concept — not to design or build anything yet.

## Step 1: Understand the intent (3-5 questions max)

Ask focused questions to extract:
- **Problem**: What specific problem does this solve? Who has this problem?
- **Success**: What does "done" look like? How will you know it works?
- **Constraints**: Time budget, tech constraints, things it must NOT do
- **Scope**: What's the smallest version that's still useful (the POC)?
- **Inspiration**: Any existing tools/apps that do something similar?

Do NOT ask all questions at once. Ask 1-2, listen, then follow up. Stop when you have enough signal to write the brief.

## Step 2: Research feasibility

Spawn up to 2 sub-agents to investigate in parallel:
- **Agent 1**: Search the codebase for existing patterns, utilities, or prior work that's relevant. Check `docs/knowledge/` for past decisions on similar topics.
- **Agent 2**: If the idea involves a library or API, check `docs/research/` for prior research. If nothing exists, note what research is needed.

If no relevant prior research exists, note what research is needed and flag it for the user.

## Step 3: Write the brief

Create the directory `docs/specs/$ARGUMENTS/` and write `brief.md`:

```
# Brief: [Feature Name]

## Problem Statement
[One paragraph. What problem, for whom, why now.]

## Success Criteria
- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]
- [ ] [Measurable outcome 3]

## Scope — What's IN
- [Capability 1]
- [Capability 2]

## Scope — What's OUT (Non-goals)
- [Explicitly excluded thing 1]
- [Explicitly excluded thing 2]

## Constraints
- [Technical constraint]
- [Time/resource constraint]

## Open Questions
- [Anything unresolved that needs research or a decision]

## Prior Art / Inspiration
- [Reference 1]
- [Reference 2]

## Research Needed
- [ ] [Topic that needs investigation before design]
```

## Step 4: Checkpoint

Present the brief to the user. Ask:
> "Does this capture your intent? Anything missing, wrong, or over-scoped?"

Iterate until the user confirms. Then:
1. Add to ROADMAP.md under `### Ideas`: `[ ] P2 — [Feature Name] — brief at docs/specs/$ARGUMENTS/brief.md`
2. Tell the user: "Brief locked. Run `/workflows:design $ARGUMENTS` when ready to design."
```

---

### Phase 2: Design Specification (`/workflows:design`)

**File**: `.claude/commands/workflows/design.md`

```markdown
---
description: "Transform a brief into a grounded technical design through first-principles analysis"
---

# Design Workflow

You are entering DESIGN mode. Your job is to produce a technical design document so specific that an implementation agent never needs to ask a clarifying question.

## Prerequisites — GATE CHECK

Read `docs/specs/$ARGUMENTS/brief.md`. If it doesn't exist, STOP:
> "No brief found for '$ARGUMENTS'. Run `/workflows:idea $ARGUMENTS` first."

## Step 1: Load context (minimal)

Read ONLY:
- `docs/specs/$ARGUMENTS/brief.md` (the brief)
- `docs/knowledge/architecture.md` (existing patterns)
- `docs/knowledge/decisions.md` (prior ADRs)
- `CLAUDE.md` (project conventions)

Do NOT read the full codebase. Do NOT load other specs.

## Step 2: First-principles analysis

For each requirement in the brief:

1. **Decompose**: What are the atomic capabilities needed?
2. **Constraints audit**: For each constraint, classify:
   - HARD (non-negotiable — physics, security, data integrity)
   - SOFT (preference, convention, nice-to-have)
   - Flag any soft constraints being treated as hard — these hide complexity.
3. **Pattern match**: Does the codebase already have a pattern for this? Check `docs/knowledge/patterns.md`. Prefer reuse over invention.
4. **Dependency check**: What does this depend on? What depends on it?

## Step 3: Design the solution

Address in the design document:
- **Approach**: The chosen technical approach and WHY (not just what)
- **Data model**: Schema changes, new types, state shape
- **API surface**: Endpoints, function signatures, CLI commands
- **File structure**: Exactly which files will be created/modified, with paths
- **Error handling**: What can go wrong and how each failure mode is handled
- **Testing strategy**: Types of tests, what they validate, edge cases

## Step 4: Self-critique (internal adversarial review)

Before presenting the design, challenge it:
- **What's the simplest version that satisfies all HARD constraints?** If your design is more complex, justify why.
- **What would break this?** Top 3 failure modes.
- **What am I assuming?** List assumptions. Flag unverified ones.
- **Is there a simpler alternative I'm ignoring?** Describe it and explain why you rejected it.

## Step 5: Write the design document

Create `docs/specs/$ARGUMENTS/design.md`:

```
# Design: [Feature Name]

**Brief**: docs/specs/$ARGUMENTS/brief.md
**Status**: Draft | Reviewed | Approved
**Date**: [TODAY]

## Approach

[2-3 paragraphs: chosen approach and reasoning.]

## Constraint Classification

| Constraint | Type | Implication |
|---|---|---|
| [constraint] | HARD/SOFT | [design impact] |

## Data Model

[Schema, types, state shapes — actual code/pseudocode.]

## API Surface

[Function signatures, endpoints, CLI interface — be exact.]

## File Plan

| File | Action | Purpose |
|---|---|---|
| `src/path/file.ts` | CREATE | [what it does] |
| `src/path/existing.ts` | MODIFY | [what changes] |

## Error Handling

| Failure Mode | Detection | Response |
|---|---|---|
| [what goes wrong] | [how we know] | [what we do] |

## Testing Strategy

| Test Type | What It Validates | Key Cases |
|---|---|---|
| Unit | [scope] | [specific cases] |
| Integration | [scope] | [specific cases] |

## Dependencies

- Depends on: [list]
- Depended on by: [list]
- New external deps: [list with rationale, or "None"]

## Appendix: Design Challenges

### Assumptions
- [Assumption 1 — verified/unverified]

### Rejected Alternatives
- [Alternative] — Rejected because: [reason]

### Risk Assessment
- [Risk 1]: Likelihood / Impact / Mitigation
```

## Step 6: Human checkpoint

Present the design summary (approach + file plan + risks) and ask:
> "Design ready for review. Any concerns? Specifically:
> 1. Does the approach match your mental model?
> 2. Are the constraints classified correctly?
> 3. Anything over-engineered for a personal project?"

Iterate until approved. Update status to "Approved". Tell the user:
> "Design approved. Run `/workflows:plan $ARGUMENTS` to decompose into tasks."
```

---

### Phase 3: Task Decomposition (`/workflows:plan`)

**File**: `.claude/commands/workflows/plan.md`

```markdown
---
description: "Decompose an approved design into atomic, independently-implementable tasks"
---

# Phase 3: Task Decomposition

You are acting as a technical project manager. Your job is to transform the approved design into tasks so specific that the implementing agent never asks clarifying questions.

## Input
Read the design at `docs/specs/$ARGUMENTS/design.md`. Verify status is APPROVED.
If not approved, STOP and tell the user to run `/workflows:design $ARGUMENTS` first.

## Step 1: Decompose

Break the design into atomic tasks. Each task must satisfy ALL of these:
- **Single responsibility**: One task, one concern
- **No file conflicts**: Tasks that can run in parallel must not touch the same files
- **Complete specification**: Exact file paths, function signatures, patterns to follow
- **Acceptance criteria**: Testable conditions that define "done"
- **Estimated size**: Small (< 50 lines changed), Medium (50-150), Large (150+)
  - If Large, decompose further

## Step 2: Dependency graph

Order tasks by dependencies. Independent tasks can be parallelized.
Use this notation:
- `T1 → T2` means T2 depends on T1
- `T1 | T2` means T1 and T2 are independent (parallelizable)

## Step 3: Create task document

Write `docs/specs/$ARGUMENTS/tasks.md`:

```markdown
# Tasks: [Feature Name]
Created: [date]
Design: ./design.md
Total tasks: [N]
Parallelizable groups: [N]

## Dependency Graph
T1 → T3 → T5
T2 → T3
T4 (independent)

## Group 1 (parallel)
### T1: [Title]
- **Files**: `src/path/file.ts` (create), `src/path/other.ts` (modify lines 45-60)
- **Pattern**: Follow the pattern in `src/existing/similar.ts`
- **Implementation**:
  - Create [specific thing] with [specific interface]
  - Handle [specific edge case] by [specific approach]
- **Tests**:
  - `tests/path/file.test.ts`:
    - Test: [name] — Setup: [what], Assert: [what], Expected: [what]
    - Test: [name] — Setup: [what], Assert: [what], Expected: [what]
- **Acceptance Criteria**:
  - [ ] [Specific, testable criterion]
  - [ ] [Specific, testable criterion]
- **Size**: Small
- **Status**: [ ]

## Group 2 (after Group 1)
### T3: [Title]
- **Depends on**: T1, T2
[Same structure]
```

## Step 4: Update tracking

Update ROADMAP.md with the v2 format. Each task becomes a `[?]` (draft) entry under the feature heading, with `#TN` IDs and inline dependency declarations:

```
## Feature: $ARGUMENTS
### Draft
- [?] Task title (depends: #T1, #T2) #T3
- [?] Independent task #T4
### Todo
### In Progress
### Review
### Done
```

Rules:
- All new tasks start as `[?]` (draft) — they require `/pm:approve` before work can begin
- Every task MUST have a unique `#TN` ID — scan the existing ROADMAP.md for the highest `#TN` and start from `N+1`
- Dependencies use inline syntax: `(depends: #T1, #T2)`
- Run `bash scripts/validate-roadmap.sh` after updating to verify no cycles, dangling refs, or duplicate IDs

Notify the user: "Draft tasks require approval. Run `/pm:approve $ARGUMENTS` to promote to todo."

## Step 5: Validate

Run a self-check:
- Are any tasks missing acceptance criteria? → Add them
- Do any parallel tasks share files? → Resequence them
- Are there tasks larger than 150 lines? → Decompose further
- Does every test case have setup + assertion + expected result? → Complete them

Tell the user: "Plan created with [N] tasks in [M] groups. Run `/pm:approve $ARGUMENTS` to approve, then `/workflows:build $ARGUMENTS` to implement."
```

---

### Phase 4: Implementation (`/workflows:build`)

**File**: `.claude/commands/workflows/build.md`

```markdown
---
description: "Execute implementation from task plan using wave-based parallel sub-agents with isolated context"
---

# Phase 4: Wave-Based Parallel Implementation

You are the build orchestrator. You coordinate sub-agents but NEVER write implementation code yourself. Your job is to delegate, monitor, and unblock.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md`. Verify all tasks have status markers.
Read `CLAUDE.md` for project conventions (this is the ONLY shared context for agents).
Read `.claude/settings.json` for `project_os.parallel` config (max_concurrent_agents, backoff).

## Pre-flight

Before dispatching any agents:
1. Verify no tasks for this feature are `[?]` (draft). If any drafts remain, STOP and tell the user to run `/pm:approve $ARGUMENTS` first.
2. Create task-specific working directories: `docs/specs/$ARGUMENTS/tasks/T1/`, etc.
3. For each task directory, create a `context.md` file containing ONLY that task's spec.
4. Run `bash scripts/validate-roadmap.sh` to verify dependency integrity.
5. Run `bash scripts/unblocked-tasks.sh` to get the initial set of unblocked tasks (filter to this feature only).

## Wave Computation

Organize tasks into **waves** based on the dependency DAG:

- **Wave 1**: All `[ ]` tasks with no dependencies (or all deps already `[x]`)
- **Wave 2**: `[ ]` tasks whose deps are all in Wave 1 or already `[x]`
- **Wave N**: `[ ]` tasks whose deps are all in Waves 1..N-1 or already `[x]`
- **Skip**: Tasks marked `[!]` (blocked) are excluded entirely

Display the wave plan before executing:
```
Wave 1 (parallel): #T1, #T4, #T5
Wave 2 (parallel): #T2, #T3 (depends: #T1)
Wave 3 (sequential): #T6 (depends: #T2, #T3)
```

## Adapter Resolution

Before dispatching, resolve which adapter to use for each task:
1. Check task annotation: `(agent: <name>)` in ROADMAP.md
2. Check settings: `project_os.adapters.default`
3. Fallback: `claude-code`

Validate adapter name (alphanumeric + hyphen only — no path traversal) and run health check. Fall back to `claude-code` if health check fails.

**v2 note:** All adapters except `claude-code` are stubs. The annotation is preserved for v2.1+ multi-agent support.

## Execution Protocol

### For each wave:

**1. Mark tasks in-progress**
Update ROADMAP.md: change `[ ]` to `[-]` for all tasks in this wave.
Log each: `bash .claude/hooks/log-activity.sh task-spawned "feature=$ARGUMENTS" task_id=TN agent=implementer`

**2. Prepare agent context packets**
For each task, assemble ONLY:
- The specific task description from tasks.md (NOT the full task list)
- The relevant section from the design doc (NOT the full design)
- Project conventions from CLAUDE.md
- The specific files the task mentions

**3. Dispatch sub-agents (parallel within wave)**
Dispatch up to `max_concurrent_agents` (default: 4) simultaneously.
Each agent uses `isolation: worktree` for file-level isolation.

Each agent's prompt:
```
You are an implementation agent. Your ONLY job is to complete this task:

[TASK DESCRIPTION]

Conventions to follow: [RELEVANT CLAUDE.md EXCERPT]
Design context: [RELEVANT DESIGN SECTION ONLY]
Current file state: [RELEVANT FILES IF MODIFYING]

Instructions:
1. Write the implementation code
2. Write the tests specified in the task
3. Run the tests — they must pass
4. Do NOT modify any files not listed in this task
5. If you encounter an ambiguity, make the simplest choice and document it in a code comment
6. When done, report: files created/modified, tests passed/failed, any assumptions made
```

**4. On agent completion**
- Write `docs/specs/$ARGUMENTS/tasks/TN/completion-report.md`
- Tests pass → mark task `[~]` in ROADMAP.md (ready for review). Log: `bash .claude/hooks/log-activity.sh task-completed feature=$ARGUMENTS task_id=TN`
- Tests fail → give ONE retry with error output
- Retry fails → mark `[!]`. Log: `bash .claude/hooks/log-activity.sh task-failed feature=$ARGUMENTS task_id=TN`
- Notify newly unblocked tasks: `bash .claude/hooks/notify-phase-change.sh task-unblocked <next-task-id>`

**5. Wave gate**
After all tasks in a wave complete:
- Run the FULL test suite (not just new tests)
- If integration tests fail, fix forward or revert — do not leave the suite red
- Only proceed to next wave when gate passes

### After all waves complete:

1. Run final full test suite
2. Preserve sessions: `bash .claude/hooks/preserve-sessions.sh`
3. Create atomic commits (one per task): `feat($ARGUMENTS): <task title> (TN)`
4. All completed tasks are `[~]` (ready for review) — NOT `[x]`. The `[x]` transition happens only after `/workflows:review` passes.
5. Notify: `bash .claude/hooks/notify-phase-change.sh review-requested $ARGUMENTS`

## Completion

Tell the user:
"Build complete. [N/M] tasks finished in [W] waves, [P] blocked.
Run `/workflows:review $ARGUMENTS` for quality gate before shipping."
```

---

### Phase 4b: Competitive Implementation (`/workflows:compete`)

**File**: `.claude/commands/workflows/compete.md`

```markdown
---
description: "Spawn multiple competing implementations for a task and select the best"
---

# Competitive Implementation

You spawn N parallel implementations of the same task with different strategic prompts. The human (Orchestrator) selects the winner.

## Input
Read `docs/specs/$ARGUMENTS/tasks.md` and identify the target task.
Usage: `/workflows:compete <feature> <task_id>` (e.g., `/workflows:compete auth T3`).
Read `.claude/settings.json` for `project_os.compete` config.

## Step 1: Validate

1. Verify the task exists and is `[ ]` (approved) in ROADMAP.md
2. Verify the task is NOT already `[>]` (competing) — if it is, warn and ask to restart or resume
3. Mark task as `[>]` (competing) in ROADMAP.md

## Step 2: Define approaches

Default strategies (from settings `project_os.compete.strategies`):

- **Literal**: "Implement exactly as specified. Follow the spec to the letter."
- **Minimal**: "Implement with the minimum code possible. Favor simplicity over abstraction."
- **Extensible**: "Implement with future extensibility in mind. Use clear abstractions and well-named interfaces."

User can supply custom strategy prompts.

## Step 3: Spawn competing agents

For each approach:
1. Create a worktree-isolated sub-agent with `isolation: worktree`
2. Provide the same task context packet (identical to `/workflows:build`)
3. Prepend the strategy instruction to the prompt
4. All agents run in parallel (respecting `max_concurrent_agents`)

## Step 4: Collect results

Save output to `docs/specs/$ARGUMENTS/tasks/TN/compete-<strategy>.md`:
- Files changed, tests passed/failed, lines of code added, assumptions, self-assessed complexity
- Disqualify approaches where tests fail

## Step 5: Generate comparison

Create `docs/specs/$ARGUMENTS/tasks/TN/compete-comparison.md`:

```markdown
# Competitive Comparison: TN — [Task Title]

## Summary Table
| Metric | Literal | Minimal | Extensible |
|--------|---------|---------|------------|
| Lines added | N | N | N |
| Files touched | N | N | N |
| Tests passed | Y/N | Y/N | Y/N |
| Complexity | low/med/high | ... | ... |

## Recommendation
[Which approach best fits this project's principles — cite CLAUDE.md]
```

## Step 6: Human selection

Present comparison. Ask user to select: a specific approach, a hybrid, or none (rethink).

## Step 7: Apply winner

1. Merge the winning worktree's changes into the feature branch (NOT main — review gate required)
2. Run full test suite after merge — if tests fail, report and do NOT proceed
3. Clean up losing worktrees
4. Mark task as `[~]` in ROADMAP.md
5. Notify: `bash .claude/hooks/notify-phase-change.sh compete-complete $ARGUMENTS TN`

Tell the user: "Competition complete for TN. Winner: [strategy]. Run `/workflows:review $ARGUMENTS` when ready."
```

---

### Phase 4c: Competitive Review (`/workflows:compete-review`)

**File**: `.claude/commands/workflows/compete-review.md`

```markdown
---
description: "Compare and review competing implementations side-by-side"
---

# Competitive Review

Review and score competing implementations generated by `/workflows:compete`.

## Input
Usage: `/workflows:compete-review <feature> <task_id>`
Read `docs/specs/<feature>/tasks/<task_id>/compete-*.md`

## Step 1: Load all approaches

For each `compete-<strategy>.md` file:
1. Read the implementation summary (primary source — persists after worktree cleanup)
2. If the worktree is still available, read the actual diff for detailed review
3. Note test results

## Step 2: Deep comparison

Spawn a reviewer sub-agent for each approach (parallel, isolated):

"Evaluate [STRATEGY] on these axes:
1. **Correctness**: Does it satisfy all acceptance criteria? (1-5)
2. **Simplicity**: Is it the simplest solution that works? (1-5)
3. **Robustness**: How does it handle edge cases and errors? (1-5)
4. **Readability**: Can another developer understand it quickly? (1-5)
5. **Testability**: Are tests thorough and maintainable? (1-5)
6. **Convention alignment**: Does it follow CLAUDE.md patterns? (1-5)

Score each axis 1-5. Provide specific code references."

## Step 3: Synthesize

Create a unified comparison matrix:

```
                  Literal   Minimal   Extensible
Correctness       [1-5]     [1-5]     [1-5]
Simplicity        [1-5]     [1-5]     [1-5]
Robustness        [1-5]     [1-5]     [1-5]
Readability       [1-5]     [1-5]     [1-5]
Testability       [1-5]     [1-5]     [1-5]
Convention fit    [1-5]     [1-5]     [1-5]
──────────────────────────────────────────────
TOTAL             [sum]     [sum]     [sum]
```

## Step 4: Recommendation

Recommend the approach with the best balance. Call out if any approach is clearly superior. Flag if all approaches share the same weakness (task spec issue).

Update `docs/specs/<feature>/tasks/<task_id>/compete-comparison.md` with detailed review scores.
```

---

### Phase 5: Adversarial Review (`/workflows:review`)

**File**: `.claude/commands/workflows/review.md`

```markdown
---
description: "Adversarial quality gate with parallel review agents — each with a different focus"
---

# Review Workflow

You are the **review coordinator**. You dispatch independent reviewers, deduplicate findings, and produce a structured verdict. You do NOT review code yourself.

## Prerequisites — GATE CHECK

Verify `docs/specs/$ARGUMENTS/design.md` exists.
Verify all tasks in `docs/specs/$ARGUMENTS/tasks.md` are marked `[x]`.

## Step 1: Identify scope

Run `git diff main --name-only` to get changed files.
Read `docs/specs/$ARGUMENTS/design.md` for intended behavior.

## Step 2: Spawn three independent reviewers

Each operates in ISOLATION — they cannot see each other's findings.

### Reviewer 1: Security & Safety

```
You are a SECURITY REVIEWER. Find vulnerabilities in the changed files.

Changed files: [list]

Check for:
- Input validation gaps (injection, XSS, path traversal)
- Auth/authz bypass
- Secrets or credentials in code
- Unsafe deserialization or eval
- Missing rate limiting
- Information leakage in errors
- Dependency vulnerabilities

For each finding:
- SEVERITY: critical / high / medium / low
- FILE: path and line range
- ISSUE: what's wrong
- FIX: specific remediation

If NOTHING found, say so. Do not invent findings.
```

### Reviewer 2: Architecture & Drift

```
You are an ARCHITECTURE REVIEWER. Verify implementation matches design.

Read:
1. docs/specs/$ARGUMENTS/design.md
2. docs/knowledge/patterns.md
3. docs/knowledge/decisions.md
4. Each changed file

Check for:
- Design drift: implementation vs. design deviations
- Pattern violations
- Decision contradictions
- Unnecessary complexity
- Missing error handling
- Naming inconsistency

For each finding:
- TYPE: drift / pattern-violation / complexity / naming / missing-handler
- FILE: path and line range
- ISSUE: what's wrong
- DESIGN REF: which part of design this violates
- RECOMMENDATION: what to change
```

### Reviewer 3: Test Coverage & Correctness

```
You are a TEST REVIEWER. Verify test quality and find correctness issues.

Read changed files and their test files. Run the test suite.

Check for:
- Missing coverage
- Happy-path-only tests
- Missing edge cases (null, empty, boundary, concurrent)
- Test order dependency
- Weak assertions
- Untested error paths
- Flaky risk (timing, random data without seeds)

For each finding:
- TYPE: missing-coverage / shallow / edge-case / flaky-risk
- FILE: test and source file
- ISSUE: what's not tested
- SUGGESTED TEST: concrete test description (setup → action → assertion)
```

## Step 3: Deduplicate and triage

1. **Deduplicate** overlapping findings
2. **Classify**:
   - 🔴 **MUST FIX** — Security critical, correctness bug, design violation
   - 🟡 **SHOULD FIX** — Real issue, not immediately harmful
   - 🟢 **CONSIDER** — Improvement suggestion, style preference
3. **Cost-benefit**: For each 🟡, assess if fixing is worth it for a personal project.

## Step 4: Write review report

Create `docs/specs/$ARGUMENTS/review.md`:

```
# Review Report: [Feature Name]

**Date**: [TODAY]
**Verdict**: PASS / PASS WITH NOTES / FAIL
**Files reviewed**: [count]
**Findings**: [🔴 count] / [🟡 count] / [🟢 count]

## 🔴 Must Fix
[Findings or "None"]

## 🟡 Should Fix
[Findings with cost-benefit notes]

## 🟢 Consider
[Findings — optional to address]

## What Went Well
[Positive observations]
```

## Step 5: Verdict

**PASS**: No 🔴 → "Run `/workflows:ship $ARGUMENTS`"
**PASS WITH NOTES**: No 🔴, some 🟡 → "Fix what matters, skip what doesn't"
**FAIL**: Any 🔴 → "Must fix before shipping. Spawn fix agents?"

If fixes needed, spawn targeted agents per 🔴 finding, then re-run only relevant reviewers.

## Step 6: Knowledge capture

Add new patterns to `docs/knowledge/patterns.md`.
Add security lessons to `docs/knowledge/bugs.md`.
```

---

### Phase 6: Ship (`/workflows:ship`)

**File**: `.claude/commands/workflows/ship.md`

```markdown
---
description: "Final validation, cleanup, and ship"
---

# Ship Workflow

## Prerequisites — GATE CHECK

Verify `docs/specs/$ARGUMENTS/review.md` exists with verdict PASS or PASS WITH NOTES. If not:
> "Cannot ship — review not passed. Run `/workflows:review $ARGUMENTS` first."

## Step 1: Pre-flight checks

Run sequentially, stop on first failure:

1. Clean working tree: `git diff --quiet && git diff --cached --quiet`
2. All tests pass: run project test command
3. Linter clean: run project lint command
4. No debug artifacts: `grep -rn "console\.log\|debugger\|breakpoint()\|TODO.*HACK\|FIXME.*ship" src/`
5. No hardcoded secrets: `grep -rn "sk-\|pk_\|AKIA\|password\s*=\s*['\"]" src/`
6. No large comment blocks (>3 lines): `awk '/^[[:space:]]*(\/\/|#)/{c++} !/^[[:space:]]*(\/\/|#)/{if(c>3)print FILENAME":"NR-c"-"NR-1" ("c" lines)";c=0}' src/**/* 2>/dev/null`

Report results. FAIL = stop. WARN = flag and ask user.

## Step 2: Clean commit history

Review: `git log --oneline main..HEAD`
If messy, suggest squash: `git rebase -i main`

## Step 3: Update project state

1. Mark all tasks `[x]` in tasks.md
2. Move in ROADMAP.md to `## Completed`: `[x] P[X] — [Feature Name] — completed [DATE] ✅`
3. Update `docs/knowledge/decisions.md` with decisions from this feature
4. Update `docs/knowledge/patterns.md` with new patterns

## Step 4: Archive

Mark design status as "Shipped". Spec directory remains as documentation.

## Step 5: Report

> **Shipped: [Feature Name]**
> - Tasks: [N]/[N]
> - Tests: [count] passing
> - Review: [verdict]
> - Commits: [count]
> - Files changed: [count]
> Spec archived at `docs/specs/$ARGUMENTS/`
```

---

## Tool Commands

### Session Handoff (`/tools:handoff`)

**File**: `.claude/commands/tools/handoff.md`

```markdown
---
description: "Capture session state for continuity across sessions or agents"
---

# Session Handoff

Capture everything needed to resume in a fresh session with zero context.

## Step 1: Gather state

- Current objective and phase
- Modified files: `git diff --stat` and `git diff --name-only`
- Recent commits: `git log --oneline -5`
- Decisions made this session
- Open questions or blockers
- Prioritized next steps

## Step 2: Write handoff file

Create `.claude/sessions/handoff-!{date +%Y-%m-%d-%H%M}.yaml`:

```yaml
session:
  date: [timestamp]
  context_usage: [low/medium/high]

objective:
  summary: [one sentence]
  phase: [idea|design|plan|build|review|ship|freeform]
  feature: [name or "general"]
  spec_path: [path or "none"]

progress:
  completed:
    - [done item]
  in_flight:
    - file: [path]
      state: [what's done vs remaining]
      lines: [focus range]

decisions:
  - decision: [what]
    rationale: [why]
    alternatives: [what else considered]

modified_files:
  - path: [file]
    action: [created|modified|deleted]
    focus_range: [lines]

blockers:
  - [description or "none"]

next_steps:
  - priority: 1
    action: [what]
    context_needed: [what to load]
  - priority: 2
    action: [what]

compact_instruction: |
  [Targeted /compact instruction for the next session, e.g.:
   "Focus on auth module. Key files: src/auth/handler.ts:42-89.
    Access token flow works. Refresh flow half-done at handler.ts:67."]
```

## Step 3: Update knowledge

Append decisions to `docs/knowledge/decisions.md`.
Append patterns to `docs/knowledge/patterns.md`.
Append bug causes to `docs/knowledge/bugs.md`.

## Step 4: Confirm

> "Session saved to `.claude/sessions/[filename]`. Run `/tools:catchup` to resume."
```

---

### Session Catchup (`/tools:catchup`)

**File**: `.claude/commands/tools/catchup.md`

```markdown
---
description: "Restore context from the last session — start where you left off"
---

# Session Catchup

## Step 1: Find the latest handoff

Read the most recent file in `.claude/sessions/` (sorted by filename/date).
If no handoff files exist:
> "No session handoff found. Starting fresh. What are we working on?"

## Step 2: Load context

From the handoff file, read:
1. The `objective` and `phase`
2. The `in_flight` files (only the focus ranges, not entire files)
3. The `next_steps`
4. The `compact_instruction`

Additionally:
- `git log --oneline -5` for recent changes
- `git diff --stat` for uncommitted work
- `ROADMAP.md` for overall status

Do NOT load full specs or designs unless the phase requires it.

## Step 3: Synthesize

Present to the user:
> **Resuming session from [date]**
> - **Objective**: [summary]
> - **Phase**: [phase]
> - **Last completed**: [completed items]
> - **In flight**: [what's partially done]
> - **Blockers**: [any blockers]
> - **Next up**: [priority 1 action]
>
> Ready to continue. Pick up where we left off, or redirect?
```

---

### Parallel Research (`/tools:research`)

**File**: `.claude/commands/tools/research.md`

```markdown
---
description: "Spawn parallel research agents to investigate a topic from multiple angles"
---

# Research Tool

## Usage
`/tools:research [topic]`

## Process

Break the research topic into 2-3 independent questions. Spawn a sub-agent for each:

### Research Agent Template

```
You are a RESEARCH AGENT investigating: [specific question]

Search the following sources in order:
1. `docs/knowledge/` — do we already know this?
2. `docs/research/` — has this been researched before?
3. Project codebase — is there existing implementation to learn from?
4. If the topic is about a library/API we use, check `node_modules/[lib]/README.md` or equivalent

Produce a structured finding:
- QUESTION: [the question you investigated]
- ANSWER: [your finding, with confidence: high/medium/low]
- SOURCES: [what you read to form this answer]
- CAVEATS: [limitations, uncertainties, things to verify]
- NEXT STEPS: [if confidence is low, what would raise it]
```

## Synthesis

After all agents return, synthesize findings into `docs/research/[topic].md`:

```
# Research: [Topic]
**Date**: [TODAY]
**Confidence**: [overall high/medium/low]

## Summary
[2-3 paragraph synthesis]

## Detailed Findings
[Agent findings organized by theme]

## Open Questions
[What's still unclear]

## Recommendation
[What to do based on this research]
```

Notify the user of key findings and confidence level.
```

---

### Quality-Checked Commit (`/tools:commit`)

**File**: `.claude/commands/tools/commit.md`

```markdown
---
description: "Quality-checked git commit with pre-commit validation"
---

# Commit Tool

## Pre-commit checks

Run before allowing the commit:

1. `git diff --cached --name-only` — list staged files
2. Scan staged files for:
   - `TODO` or `FIXME` without ticket references
   - `console.log` / `print()` debug statements
   - Commented-out code blocks (>3 lines)
   - Hardcoded secrets patterns: `sk-`, `pk_`, `AKIA`, `password =`
   - Files >500 lines (flag for review — may need splitting)
3. Run tests on staged files: `npm test -- --findRelatedTests [files]` or equivalent
4. Run linter on staged files

## Results

**If all clean**: Proceed with commit using conventional format:
```
<type>(<scope>): <description>

[body — what changed and why, if non-obvious]
```

Types: feat, fix, refactor, docs, test, chore

**If issues found**: Report findings and ask:
> "[N] issues found in staged files. Fix before committing, or commit anyway with a note?"
```

---

### Quick Key-Value Memory (`/tools:kv`)

**File**: `.claude/commands/tools/kv.md`

```markdown
---
description: "Quick key-value memory operations — save or recall facts without ceremony"
---

# KV Memory Tool

Fast memory operations for facts that don't need a full ADR or pattern entry.

## Usage

- `/tools:kv set [key] [value]` — Save a fact
- `/tools:kv get [key]` — Recall a fact
- `/tools:kv list` — Show all stored keys
- `/tools:kv search [query]` — Find relevant entries

## Implementation

Storage file: `docs/knowledge/kv.md`

Format:
```
## [key]
**Set**: [date]
**Value**: [value]
```

For `set`: Append to kv.md. If key exists, update the value and date.
For `get`: Search kv.md for the key header and return its value.
For `list`: Return all `## [key]` headers.
For `search`: Grep kv.md for the query term and return matching entries.
```

---

### First-Run Setup (`/tools:init`)

**File**: `.claude/commands/tools/init.md`

```markdown
---
description: "First-run project setup — find blank variables, ask questions, fill them in using memory for recommendations"
---

# Project Init

You are performing **first-run project initialization**. Discover every unfilled placeholder in this project, gather answers from the user, and write them in — leaving a fully configured project ready for work.

## Step 1: Load memory for recommendations

Check `docs/memory/project-profiles.md` for past project setups.
Extract prior language/stack/testing/formatter choices as recommendations.

## Step 2: Global CLAUDE.md merge

Check if `global-CLAUDE.md` exists in the project root. If so, compare it against `~/.claude/CLAUDE.md` and offer 4 options:
1. **Merge** — Add missing sections to existing file
2. **Replace** — Overwrite with template
3. **Review section-by-section** — Walk through differences
4. **Skip** — Leave as-is

If no `~/.claude/CLAUDE.md` exists, offer to copy the template.

## Step 3: Scan for placeholders

Search `CLAUDE.md`, `ROADMAP.md`, `docs/product.md`, `docs/tech.md`, `docs/knowledge/*.md` for `[ALL_CAPS_IN_BRACKETS]` patterns. Build a deduplicated list with all file locations.

## Step 4: Ask about the project (2-3 questions at a time)

- **Round 1 — Identity**: Project name, project type, one-sentence description
- **Round 2 — Stack**: Language/runtime, framework, database, formatter, test runner (offer memory-based recommendations)
- **Round 3 — Scope** (only if `docs/product.md` is empty): One-liner, v0.1 scope, out-of-scope items
- **Round 4 — Feature Toggles**:
  - **Obsidian**: Enable wikilinks + YAML frontmatter in knowledge vault? (Y/N)
  - **Context7**: Enable live library docs MCP? (Y/N — security wrapper already configured)

## Step 5: Fill all placeholders

Replace every `[BRACKET]` placeholder with collected answers across all scanned files.
Apply feature toggles: Obsidian → append conventions to CLAUDE.md; Context7 → create `.mcp.json` (Windows-aware: uses `cmd /c npx` on Windows, `npx` on Mac/Linux), append MCP section to CLAUDE.md.

## Step 6: Save project profile to memory

Append to `docs/memory/project-profiles.md`:
```markdown
## [PROJECT_NAME]
- **Date**: [TODAY]
- **Type**: [project type]
- **Stack**: [PRIMARY_STACK]
- **Formatter**: [formatter]
- **Test runner**: [test runner]
- **Features**: Obsidian=[yes/no], Context7=[yes/no]
```

## Step 7: Initialize git (if needed)

If `.git/` doesn't exist, offer to run `git init && git add . && git commit -m "chore: initialize project"`.

## Step 8: Report

> **Project initialized: [PROJECT_NAME]**
> - Placeholders filled: N across M files
> - Features: Obsidian=[enabled/disabled], Context7=[enabled/disabled]
> - Memory updated: `docs/memory/project-profiles.md`
> - Git: [initialized / already exists]
>
> Ready to build. Start with `/pm:prd [feature]` or `/workflows:idea [feature]`.
```

---

### Activity Metrics (`/tools:metrics`)

**File**: `.claude/commands/tools/metrics.md`

```markdown
---
description: "Query activity logs and feature metrics"
---

# Metrics Viewer

Query the activity log and feature metrics snapshots.

## Input
- Empty: summary of all features
- Feature name: detailed metrics for that feature
- `--slow`: slowest tasks across all features
- `--compare <feat1> <feat2>`: side-by-side comparison

## Data Sources
1. `.claude/logs/activity.jsonl` — event-level JSONL activity log (13 event types)
2. `docs/knowledge/metrics.md` — feature-level metrics snapshots

## Views

### Summary (no arguments)
```
Feature Metrics Summary
═══════════════════════════════════════════
Feature          Tasks  Waves  Duration  Review Rate
───────────────────────────────────────────
auth             12     3      4 days    83%
api-v2           8      2      2 days    100%
```

### Feature Detail (`/tools:metrics auth`)
```
Feature: auth
══════════════
Duration: 4 days (2026-02-15 → 2026-02-19)
Tasks: 12 total, 10 done, 2 blocked
Waves: 3 | Revisions: 1 | First-pass rate: 83%
Compete: 2 tasks | Lines: +450 / -120

Timeline:
  2026-02-15 10:00  plan-approved
  2026-02-15 10:05  task-spawned T1, T2, T3 (wave 1)
  ...
```

### Slow Tasks (`/tools:metrics --slow`)
Compute duration per task (spawned → completed), show top 10.

### Compare (`/tools:metrics --compare auth api-v2`)
Side-by-side comparison on all metric dimensions.

## Activity Log Format
```json
{"timestamp": "2026-02-15T10:00:00Z", "event": "task-spawned", "metadata": {"feature": "auth", "task_id": "T1"}}
```

If the activity log doesn't exist yet, fall back to `docs/knowledge/metrics.md` only.
```

---

### Cross-Project Dashboard (`/tools:dashboard`)

**File**: `.claude/commands/tools/dashboard.md`

```markdown
---
description: "Cross-project dashboard — see status of all Project OS projects"
---

# Project Dashboard

Show the status of all Project OS projects from a single view.

## Configuration
Read `.claude/settings.json` → `project_os.dashboard.projects_root`. Default: `~/projects`.

## Execution
Run `bash scripts/dashboard.sh [projects_root]` to scan and display.

## Display

```
Project OS Dashboard
═══════════════════════════════════════════════════════════════
Project          Branch          Todo  WIP  Review  Done  Blocked
───────────────────────────────────────────────────────────────
my-app           feature/auth    3     2    1       8     0
api-service      master          0     0    0       15    0
───────────────────────────────────────────────────────────────
Totals                           8     3    1       26    2
Active worktrees: 3
Last activity: 2026-02-23 14:30 (my-app)
```

If `$ARGUMENTS` is a specific project name, show expanded detail: full task list, active worktrees, recent activity log entries (last 10).
```

---

## Product Management Commands

### Governance Gate (`/pm:approve`)

**File**: `.claude/commands/pm/approve.md`

```markdown
---
description: "Governance gate: promote draft tasks [?] to approved todo [ ] status"
---

# Approval Gate

You are the governance gatekeeper. This command promotes draft tasks to approved status, ensuring no work begins without explicit human sign-off.

## Input
Read ROADMAP.md and find all `[?]` (draft) tasks for the feature `$ARGUMENTS`.
If no feature name given, show ALL draft tasks across all features.

## Step 1: Display draft tasks

Show the user a summary of pending drafts:

```
Feature: $ARGUMENTS

Draft Tasks Pending Approval:
  [?] Task description #T1
  [?] Task description (depends: #T1) #T2

Dependency Tree:
  #T1
  └── #T2

Total: N drafts
```

## Step 2: Ask for approval

Options:
1. **Approve all** — promote all `[?]` to `[ ]` for this feature
2. **Approve selected** — promote only specified task IDs
3. **Reject** — leave all as `[?]` (user should revisit the plan)

## Step 3: Promote approved tasks

For each approved task:
1. Verify dependency consistency: a task should not become `[ ]` if any dependency is still `[?]`
   - If so, block and tell the user: "Cannot approve #TN — depends on #TM which is still in draft. Approve #TM first."
   - Exception: when approving both task and dependency in the same batch, promote in dependency order
2. Validate that the task IDs exist in ROADMAP.md — reject unknown IDs with an error
3. Change `[?]` to `[ ]` in ROADMAP.md for each validated task

## Step 4: Validate

Run `bash scripts/validate-roadmap.sh` to confirm no inconsistencies.

## Step 5: Report

"Approved [N] task(s) for feature '$ARGUMENTS'.
[M] task(s) are now unblocked and ready for `/workflows:build $ARGUMENTS`.
[P] task(s) remain in draft."
```

---

### PRD Creation (`/pm:prd`)

**File**: `.claude/commands/pm/prd.md`

```markdown
---
description: "Guided product requirements document creation through Socratic discovery"
---

# PRD Creator

Guide the user through structured product thinking. This is NOT a technical design — it's about WHAT and WHY, not HOW.

## Discovery Questions (ask 2-3 at a time)

### Problem Space
- Who is this for? (Even if "just me" — define the use case specifically)
- What's the current workaround? What's painful about it?
- What triggers the need for this? (What event makes someone reach for this tool?)

### Success Definition
- If this works perfectly, what changes in your workflow?
- How would you demo this to someone? Walk me through the 30-second pitch.
- What's the ONE thing this must do well? Everything else is secondary.

### Scope Control
- What does v0.1 look like? (The smallest thing that's useful)
- What's explicitly NOT in v0.1? (Tempting features to defer)
- What would make you abandon this project? (Time budget, complexity ceiling)

## Write PRD

Create `docs/prd/[name].md`:

```
# PRD: [Product/Feature Name]

## One-Liner
[Single sentence: what is this and who is it for]

## Problem
[The pain point, in the user's language]

## Solution
[High-level approach — WHAT, not HOW]

## User Stories
- As [persona], I want to [action] so that [benefit]
- As [persona], I want to [action] so that [benefit]

## Success Metrics
- [Metric 1]: [How measured]
- [Metric 2]: [How measured]

## Scope

### v0.1 (MVP)
- [Must-have 1]
- [Must-have 2]

### v0.2 (If v0.1 works)
- [Nice-to-have 1]
- [Nice-to-have 2]

### Out of Scope
- [Explicitly excluded]

## Constraints
- Time: [budget]
- Tech: [limitations]
- Dependencies: [external factors]

## Open Questions
- [Unresolved item]
```

Link in ROADMAP.md under `### Ideas`.
```

---

### Epic Breakdown (`/pm:epic`)

**File**: `.claude/commands/pm/epic.md`

```markdown
---
description: "Transform a PRD into trackable tasks in ROADMAP.md"
---

# Epic Breakdown

## Input

Read the PRD at `docs/prd/$ARGUMENTS.md`. If missing:
> "No PRD found. Run `/pm:prd $ARGUMENTS` first."

## Process

For each item in the v0.1 scope:
1. Identify if it's a single task or needs decomposition
2. Estimate complexity: S (hours), M (half-day), L (full day), XL (multi-day — should be split)
3. Identify dependencies between tasks
4. Assign priority: P0-P3

## Output

Update ROADMAP.md. Add under `### Queued`:

```
## Epic: [Feature Name]
Source: docs/prd/$ARGUMENTS.md

[ ] P0 — [Task 1] (S) — no deps
[ ] P0 — [Task 2] (M) — no deps
[ ] P1 — [Task 3] (M) — depends on Task 1
[ ] P2 — [Task 4] (S) — depends on Task 2, 3
```

Tell the user:
> "Epic broken down into [N] tasks. Run `/workflows:idea [task-name]` to start the spec-driven pipeline on any task, or tackle small (S) tasks directly."
```

---

### Project Status (`/pm:status`)

**File**: `.claude/commands/pm/status.md`

```markdown
---
description: "Synthesize current project status from all sources"
---

# Status Report

## Gather data

Read:
1. `ROADMAP.md` — task counts by status
2. `.claude/sessions/` — latest handoff (if any)
3. `git log --oneline --since="1 week ago"` — recent activity
4. `docs/specs/` — active specs and their status

## Synthesize

Present:

> **Project Status: [PROJECT_NAME]**
>
> **Activity** (last 7 days): [N] commits
>
> **Tasks**:
> - Active: [count] [-]
> - Queued: [count] [ ]
> - Completed: [count] [x]
> - Blocked: [count] [!]
>
> **Active Features**:
> - [Feature 1]: [phase] — [brief status]
> - [Feature 2]: [phase] — [brief status]
>
> **Last Session**: [date] — [objective summary]
> **Next Up**: [priority 1 from latest handoff or ROADMAP]
```

---

## Sub-Agent Definitions

All agent `.md` files carry YAML frontmatter declaring their `isolation` mode, `role`, and `permissions`. Permissions are **advisory** in v2 — agents self-enforce based on frontmatter. Hard enforcement is planned for v2.1+.

### Implementer Agent

**File**: `.claude/agents/implementer.md`

```markdown
---
isolation: worktree
role: Developer
permissions:
  read: [specs, knowledge, task-description]
  write: [code, tests, docs, completion-report]
  phases: [Build]
---

# Implementer Agent

You are a focused implementation agent. You receive a single task and execute it precisely.

## Rules
1. Implement EXACTLY what the spec says — nothing more, nothing less
2. Write tests FIRST, then implementation, then cleanup
3. Run acceptance criteria and verify they pass before reporting done
4. If blocked, STOP and report the blocker — do not work around it
5. Do not modify files outside your task's file list
6. Do not refactor, optimize, or "improve" adjacent code
7. Commit with: `feat(<feature>): <task title> (T<N>)`

## Output
Report: DONE (with test results) or BLOCKED (with specific blocker description)
```

### Security Reviewer Agent

**File**: `.claude/agents/reviewer-security.md`

```markdown
---
isolation: worktree
role: Reviewer
permissions:
  read: [all]
  write: [review-reports]
  phases: [Review]
---

# Security Reviewer Agent

You review code for security vulnerabilities. Be thorough but honest — do not fabricate findings.

## Checklist
- Input validation (injection, XSS, path traversal)
- Auth/authz bypass vectors
- Secrets in code (API keys, tokens, passwords, connection strings)
- Unsafe eval/deserialization
- Rate limiting on public endpoints
- Error message information leakage
- Dependency audit (known vulnerabilities)
- File system access controls
- CORS configuration

## Output Format
For each finding: SEVERITY / FILE:LINES / ISSUE / FIX
If nothing found: "No security issues identified."
```

### Architecture Reviewer Agent

**File**: `.claude/agents/reviewer-architecture.md`

```markdown
---
isolation: worktree
role: Reviewer
permissions:
  read: [all]
  write: [review-reports]
  phases: [Review]
---

# Architecture Reviewer Agent

You verify implementation matches the design and follows project patterns.

## Inputs
- Design document (provided)
- Established patterns from `docs/knowledge/patterns.md`
- Prior decisions from `docs/knowledge/decisions.md`

## Checks
- Design drift: implementation vs. spec deviations
- Pattern violations: code contradicts established conventions
- Decision contradictions: changes conflict with prior ADRs
- Unnecessary complexity: over-engineering for stated requirements
- Missing error handling: unhandled failure modes from design
- Naming consistency with CLAUDE.md conventions

## Output Format
For each finding: TYPE / FILE:LINES / ISSUE / DESIGN REF / RECOMMENDATION
```

### Test Reviewer Agent

**File**: `.claude/agents/reviewer-tests.md`

```markdown
---
isolation: worktree
role: Reviewer
permissions:
  read: [all]
  write: [review-reports]
  phases: [Review]
---

# Test Reviewer Agent

You audit test quality and identify coverage gaps.

## Checks
- Untested functions/branches
- Happy-path-only tests (no error paths)
- Missing edge cases: null, empty, boundary, overflow, concurrent
- Test independence: shared state, execution order dependencies
- Assertion specificity: vague assertions like `assert result`
- Flaky indicators: timing-dependent, unseeded randomness

## Output Format
For each finding: TYPE / FILES / ISSUE / SUGGESTED TEST (setup → action → assertion)
```

---

## Roles

**File**: `.claude/agents/roles.md`

Roles define what each agent type can do. Permissions are **advisory** in v2 — agents self-enforce based on their frontmatter. Hard enforcement planned for v2.1+.

```
             Read                  Write              Phases
Architect    all                   specs/knowledge    Idea, Design
Developer    specs/knowledge/src   code/tests/docs    Build
Reviewer     all                   review-reports     Review
Orchestrator all                   all                all
```

| Role | Agents | Responsibility |
|------|--------|----------------|
| **Architect** | researcher | Investigate, design, document decisions. Never write implementation code. |
| **Developer** | implementer, documenter | Implement exactly what the spec says. Stay within task scope. |
| **Reviewer** | reviewer-architecture, reviewer-security, reviewer-tests | Evaluate quality, security, alignment. Never modify source code. |
| **Orchestrator** | human (via Claude Code CLI) | Coordinate workflow, approve drafts, resolve conflicts, make final decisions. |

---

## Agent Adapters

**Interface spec**: `.claude/agents/adapters/INTERFACE.md`

Adapters provide a uniform 3-command contract for dispatching tasks to different AI coding agents. The orchestrator calls the same interface regardless of which agent runs the task.

### Commands

| Command | Description | Exit Code |
|---------|-------------|-----------|
| `info` | Print adapter metadata as JSON | 0 |
| `health` | Check if the agent CLI is available | 0=available, 1=unavailable |
| `execute <context_dir> <output_dir>` | Run a task given context directory | 0=success, 1=failure |

### Execute Protocol

**Input** (`context_dir/`):
- `task.md` — task description and acceptance criteria
- `conventions.md` — project conventions (from CLAUDE.md)
- `design.md` — relevant design section
- `files/` — read-only reference copies of files the task will modify

**Output** (`output_dir/`):
- `completion-report.md` — what was done, files changed, assumptions
- `result` — exit status: `pass` or `fail`
- `test-output.txt` — test run output (if applicable)
- `files/` — modified/created files to apply back

**Environment variables**: `ADAPTER_TASK_ID`, `ADAPTER_FEATURE`, `ADAPTER_MAX_TURNS`, `ADAPTER_MODEL`

### Adapter Resolution Order

1. Task annotation: `(agent: codex)` in ROADMAP.md → use that adapter
2. Settings default: `.claude/settings.json` → `project_os.adapters.default`
3. Fallback: `claude-code` adapter

### Available Adapters (v2)

| Adapter | File | Status |
|---------|------|--------|
| `claude-code` | `.claude/agents/adapters/claude-code.sh` | Functional (default) |
| `codex` | `.claude/agents/adapters/codex.sh` | Stub (v2.1+) |
| `gemini` | `.claude/agents/adapters/gemini.sh` | Stub (v2.1+) |
| `aider` | `.claude/agents/adapters/aider.sh` | Stub (v2.1+) |
| `amp` | `.claude/agents/adapters/amp.sh` | Stub (v2.1+) |

> **v2 limitation**: Only `claude-code` is functional. Stub adapters exit 1 with "not yet implemented"; tasks fall back to `claude-code`. Hard multi-agent dispatch planned for v2.1+.

---

## Skills (On-Demand Protocols)

### Spec-Driven Development

**File**: `.claude/skills/spec-driven-dev/SKILL.md`

```markdown
# Spec-Driven Development Protocol

**Trigger**: User asks to implement, build, or add a feature.

## Protocol

Before writing ANY code, verify a spec exists:

1. Check `docs/specs/[feature-name]/` for brief.md, design.md, tasks.md
2. If ALL exist and design is "Approved": proceed with `/workflows:build`
3. If design exists but not approved: resume `/workflows:design`
4. If only brief exists: run `/workflows:design`
5. If NOTHING exists: run `/workflows:idea`

NEVER skip this check. If the user says "just build it", explain:
> "I work best with a spec — it takes 5 minutes and prevents hours of rework. Let me run `/workflows:idea` to capture what you need, then we'll build it right."

## Exception
For trivially small changes (< 20 lines, single file, no new patterns), skip the full pipeline. Instead: describe the change, get user confirmation, implement, test, commit.
```

### TDD Workflow

**File**: `.claude/skills/tdd-workflow/SKILL.md`

```markdown
# Test-Driven Development Protocol

**Trigger**: User asks to write tests, or implementation task requires tests.

## Red-Green-Refactor Cycle

### 1. RED — Write the failing test first
- Test describes the desired behavior, not the implementation
- Test should fail for the RIGHT reason (missing function, not syntax error)
- Run the test, confirm it fails, capture the error output

### 2. GREEN — Write the minimum code to pass
- Do not write more than what the test requires
- No optimization, no edge cases, no cleanup — just make it pass
- Run the test, confirm it passes

### 3. REFACTOR — Clean up without changing behavior
- Remove duplication
- Improve naming
- Extract functions if needed
- Run tests again — must still pass

## Edge Case Protocol
After the happy path passes, add tests for:
- Null/undefined/empty inputs
- Boundary values (0, -1, MAX_INT, empty string)
- Error conditions (network failure, malformed data)
- Concurrent access (if applicable)

## Test Naming Convention
`[unit]_[scenario]_[expected result]`
Example: `parseConfig_emptyInput_returnsDefault`
```

### Session Management

**File**: `.claude/skills/session-management/SKILL.md`

```markdown
# Session Management Protocol

**Trigger**: User says "handoff", "done", "end session", "switching", or context usage appears high.

## Auto-Handoff Triggers

Run `/tools:handoff` automatically when:
1. User explicitly says they're done or switching tasks
2. A major phase completes (design approved, build finished, review passed)
3. You notice the conversation is getting long (>30 exchanges)

## Context Conservation

- Use `/compact` proactively with targeted instructions when context feels heavy
- Between unrelated tasks, suggest `/clear` for a fresh window
- When loading specs, read ONLY the sections relevant to the current phase

## Memory Hygiene

At session end, verify:
- [ ] Any decisions made are in `docs/knowledge/decisions.md`
- [ ] Any new patterns are in `docs/knowledge/patterns.md`
- [ ] Any bugs found are in `docs/knowledge/bugs.md`
- [ ] ROADMAP.md reflects current task status
- [ ] Handoff file is written if there's WIP
```

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
