# The Bleeding-Edge Claude Code Personal Project OS
## Architecture & Implementation Guide — Native-First Edition

**Version**: 2.0 — Native-Only  
**Purpose**: A complete, implementable specification for a single-developer orchestration system built entirely on Claude Code's native primitives, with zero required external dependencies.  
**Usage**: Feed this document to Claude Code as a build spec. It contains every file, every command, and the full directory structure needed to stand up the system.

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
| Task tracking | `ROADMAP.md` with checkbox progression |
| Parallel execution | Sub-agents via `Task` tool + Agent Teams |
| Adversarial review | Parallel sub-agents with isolated prompts |
| Drift detection | Sub-agent comparing `git diff` against spec |
| Knowledge compounding | Structured `docs/knowledge/` directory |
| Context optimization | Skill trigger tables + aggressive compaction |
| Model tiering | `settings.json` model config |
| Quality gates | Gate checks at the top of each workflow command |
| Code conventions | `.claude/rules/` glob-matched contextual rules |
| Auto-formatting | `.claude/hooks/` lifecycle hooks |
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
├── CLAUDE.local.md                     # Personal overrides (gitignored)
├── ROADMAP.md                          # Task tracking with checkbox progression
│
├── .claude/
│   ├── settings.json                   # Model config, permissions, env
│   │
│   ├── commands/                       # Slash commands
│   │   ├── workflows/                  # Multi-phase orchestrations
│   │   │   ├── idea.md                 # /workflows:idea — capture + research
│   │   │   ├── design.md              # /workflows:design — spec generation
│   │   │   ├── plan.md               # /workflows:plan — task decomposition
│   │   │   ├── build.md              # /workflows:build — parallel implementation
│   │   │   ├── review.md             # /workflows:review — adversarial quality gate
│   │   │   └── ship.md               # /workflows:ship — final validation + deploy
│   │   ├── tools/                     # Single-purpose utilities
│   │   │   ├── handoff.md            # /tools:handoff — session state capture
│   │   │   ├── catchup.md            # /tools:catchup — reload WIP context
│   │   │   ├── research.md           # /tools:research — parallel research agents
│   │   │   ├── commit.md             # /tools:commit — quality-checked git commit
│   │   │   └── kv.md                 # /tools:kv — quick key-value memory operations
│   │   └── pm/                        # Product management
│   │       ├── prd.md                # /pm:prd — guided PRD creation
│   │       ├── epic.md               # /pm:epic — PRD → task breakdown
│   │       └── status.md             # /pm:status — project status synthesis
│   │
│   ├── agents/                        # Sub-agent persona definitions
│   │   ├── researcher.md             # Parallel research agent
│   │   ├── implementer.md            # Scoped code implementation agent
│   │   ├── reviewer-security.md      # Security-focused reviewer
│   │   ├── reviewer-architecture.md  # Architecture drift reviewer
│   │   ├── reviewer-tests.md         # Test coverage reviewer
│   │   └── documenter.md             # Documentation agent
│   │
│   ├── skills/                        # On-demand capability protocols
│   │   ├── spec-driven-dev/
│   │   │   └── SKILL.md
│   │   ├── tdd-workflow/
│   │   │   └── SKILL.md
│   │   └── session-management/
│   │       └── SKILL.md
│   │
│   ├── knowledge/                     # Compounding project knowledge
│   │   ├── decisions.md
│   │   ├── patterns.md
│   │   ├── bugs.md
│   │   └── architecture.md
│   │
│   ├── sessions/                      # Session handoff files
│   │   └── (handoff-YYYY-MM-DD-HHMM.yaml files)
│   │
│   ├── specs/                         # Feature specifications
│   │   └── (feature-name)/
│   │       ├── brief.md
│   │       ├── design.md
│   │       ├── tasks.md
│   │       └── review.md
│   │
│   ├── rules/                         # Glob-matched contextual rules
│   │   ├── tests.md
│   │   └── api.md
│   │
│   ├── hooks/                         # Lifecycle hooks
│   │   └── post-tool-use.sh
│   │
│   └── security/                      # Security wrappers for optional external tools
│       ├── mcp-allowlist.json
│       └── validate-mcp-output.sh
│
├── docs/
│   ├── product.md                     # Product vision
│   ├── tech.md                        # Tech decisions
│   └── research/                      # Research artifacts
│
├── scripts/
│   ├── memory-search.sh              # Local FTS over knowledge vault
│   ├── new-project.sh                # Bootstrap a new project with this structure
│   └── audit-context.sh              # Report context token estimates
│
└── src/                               # Source code
```

---

## Settings Configuration

**`.claude/settings.json`**:
```json
{
  "model": "sonnet",
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(node:*)",
      "Bash(python*:*)",
      "Bash(pip:*)",
      "Bash(cat:*)",
      "Bash(ls:*)",
      "Bash(find:*)",
      "Bash(grep:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(wc:*)",
      "Bash(sort:*)",
      "Bash(date:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
      "Bash(mv:*)",
      "Bash(chmod:*)",
      "Bash(diff:*)",
      "Bash(sed:*)",
      "Bash(awk:*)",
      "Bash(jq:*)",
      "Bash(sha256sum:*)",
      "Bash(scripts/*)",
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "Task",
      "Agent"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(rm -rf ~)",
      "Bash(> /dev/sda*)",
      "Bash(eval *)",
      "Bash(sudo *)"
    ]
  },
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  }
}
```

---

## ROADMAP.md Template

```markdown
# Roadmap

## Legend
- `[ ]` — Todo
- `[-]` — In Progress 🏗️
- `[x]` — Completed ✅
- `[!]` — Blocked ⛔
- Priority: `P0` (critical) → `P3` (nice-to-have)

---

## Current Sprint

### Active
<!-- Tasks currently being worked on -->

### Queued
<!-- Tasks ready to start -->

---

## Backlog

### Ideas
<!-- Raw ideas not yet spec'd. Run /workflows:idea to promote. -->

### Icebox
<!-- Parked ideas. Revisit quarterly. -->

---

## Completed
<!-- Move finished tasks here with completion date -->

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
description: "Decompose an approved design into atomic, independently implementable tasks"
---

# Plan Workflow

You are entering PLANNING mode. Your job is to produce an execution plan so precise that implementation agents never ask clarifying questions and never conflict with each other.

## Prerequisites — GATE CHECK

Read `docs/specs/$ARGUMENTS/design.md`. Verify status is "Approved". If not:
> "Design for '$ARGUMENTS' not approved. Run `/workflows:design $ARGUMENTS` first."

## Step 1: Load context (minimal)

Read ONLY:
- `docs/specs/$ARGUMENTS/design.md`
- `docs/specs/$ARGUMENTS/brief.md` (success criteria for acceptance tests)
- `CLAUDE.md` (Conventions section only)

## Step 2: Decompose into atomic tasks

Rules:
1. **Each task modifies at most 3 files.** More than that → split it.
2. **Each task completable in one sub-agent session** (~15 minutes of work).
3. **No two tasks modify the same file** unless one explicitly depends on the other.
4. **Each task has a verification step** — a test or command that proves it works.
5. **Tasks ordered by dependency**, not importance. Foundation first.

For each task define:
- **ID**: Sequential (T1, T2, etc.)
- **Title**: Verb phrase describing what this task does
- **Depends on**: Task IDs or "None"
- **Files**: Exact paths to create/modify
- **Specification**: Exactly what to build — code patterns, signatures, types from the design
- **Acceptance criteria**: Specific, testable conditions with the verification command
- **Parallel group**: Tasks with no mutual dependencies share a group letter (A, B, C...)

## Step 3: Identify parallel execution groups

- **Group A**: Independent tasks with no shared file dependencies
- **Group B**: Tasks depending on Group A
- **Group C**: Integration tasks connecting everything

## Step 4: Write the task plan

Create `docs/specs/$ARGUMENTS/tasks.md`:

```
# Task Plan: [Feature Name]

**Design**: docs/specs/$ARGUMENTS/design.md
**Total tasks**: [N]
**Parallel groups**: [N]
**Estimated effort**: [low/medium/high]

## Execution Order

### Group A (parallel — no dependencies)

#### T1: [Title]
- **Depends on**: None
- **Files**: `src/path/file.ts` (CREATE)
- **Spec**:
  [Detailed specification with code patterns, signatures, examples
   pulled directly from the design document.]
- **Acceptance**:
  - [ ] File exists with correct exports
  - [ ] Tests pass: `[test command]`
  - [ ] No type errors

#### T2: [Title]
- **Depends on**: None
- **Files**: `src/path/other.ts` (CREATE)
- **Spec**: [...]
- **Acceptance**: [...]

### Group B (depends on Group A)

#### T3: [Title]
- **Depends on**: T1, T2
- **Files**: `src/path/integration.ts` (CREATE)
- **Spec**: [...]
- **Acceptance**: [...]

### Group C (integration)

#### T4: [Title — Integration & smoke test]
- **Depends on**: T1, T2, T3
- **Files**: `tests/integration/feature.test.ts` (CREATE)
- **Acceptance**:
  - [ ] All unit tests pass
  - [ ] Integration test passes
  - [ ] No regressions
```

## Step 5: Update ROADMAP.md

Move the feature from `### Ideas` to `### Queued`:
```
[ ] P[X] — [Feature Name] — [N] tasks — docs/specs/$ARGUMENTS/tasks.md
```

## Step 6: Human checkpoint

Present task count, group structure, and dependency graph. Ask:
> "Plan ready. [N] tasks in [M] parallel groups. Anything too coarse or too fine-grained?"

After approval:
> "Plan locked. Run `/workflows:build $ARGUMENTS` to start implementation."
```

---

### Phase 4: Implementation (`/workflows:build`)

**File**: `.claude/commands/workflows/build.md`

```markdown
---
description: "Execute task plan with parallel sub-agents. Orchestrator never writes code."
---

# Build Workflow

You are entering BUILD mode as the **orchestrator**. You coordinate and unblock. You NEVER write application code yourself. Sub-agents do all implementation.

## Prerequisites — GATE CHECK

Read `docs/specs/$ARGUMENTS/tasks.md`. If missing:
> "No task plan for '$ARGUMENTS'. Run `/workflows:plan $ARGUMENTS` first."

Verify design status is "Approved" in `docs/specs/$ARGUMENTS/design.md`.

## Step 1: Load orchestration context (MINIMAL)

Read ONLY:
- `docs/specs/$ARGUMENTS/tasks.md`
- `CLAUDE.md` (Conventions section only)

Do NOT load the full design. Sub-agents get their specs from tasks.md.

## Step 2: Update ROADMAP.md

Move feature to `### Active`:
```
[-] P[X] — [Feature Name] — 0/[N] tasks complete 🏗️
```

## Step 3: Execute by group

For each parallel group (A, B, C...):

### Parallel tasks (same group, no dependencies):

Spawn sub-agents using the Task tool. Each receives ONLY:

```
You are implementing a single task for the [PROJECT_NAME] project.

## Project Conventions
[Paste ONLY the Conventions section from CLAUDE.md]

## Your Task
[Paste the full task block from tasks.md — ID, title, files, spec, acceptance]

## Rules
1. Implement EXACTLY what the spec says. Do not add features, refactor adjacent code, or "improve" things outside scope.
2. Write tests FIRST (red), then implement (green), then clean up (refactor).
3. Run the acceptance criteria commands and verify they pass.
4. If you encounter a blocker, STOP and report it. Do not work around it silently.
5. Commit your work: "feat($ARGUMENTS): [task title] (T[N])"
```

### Dependent tasks (next group):

Wait for dependencies. Verify their acceptance criteria passed. Spawn next group.

## Step 4: Track progress

After each task:
1. Mark `[x]` in `docs/specs/$ARGUMENTS/tasks.md`
2. Update ROADMAP.md count: `[-] P[X] — [Feature Name] — [completed]/[N] tasks 🏗️`
3. If a task FAILS, mark `[!]` and report failure with error output.

## Step 5: Integration verification

After ALL tasks:
1. Run full test suite
2. Check for type/lint errors
3. Verify no unexpected untracked files: `git status`

If integration fails, spawn a targeted fix agent with ONLY the failing output and relevant task spec.

## Step 6: Drift check

Spawn a review sub-agent:

```
You are a DRIFT DETECTOR. Compare what was planned vs. what was built.

Read:
1. docs/specs/$ARGUMENTS/tasks.md (the plan)
2. `git diff main --stat` (what changed)

For each task verify:
- Were the specified files created/modified? (no extras, no missing)
- Do changes match the spec?
- Were any unplanned files modified?

Output:
- MATCH: [task] — implemented as planned
- DRIFT: [task] — [what differs and why]
- UNPLANNED: [file] — modified but not in any task spec
```

## Step 7: Report

Present: tasks completed, integration results, drift check, files changed.

If clean:
> "Build complete. Run `/workflows:review $ARGUMENTS` for adversarial review, or `/workflows:ship $ARGUMENTS` to ship."

If drifts found:
> "Build complete with [N] drifts. Review the drift report before proceeding."
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

## Product Management Commands

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

### Implementer Agent

**File**: `.claude/agents/implementer.md`

```markdown
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
# Security Reviewer Agent

You review code for security vulnerabilities. You are thorough but honest — do not fabricate findings to appear diligent.

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
# Architecture Reviewer Agent

You verify that implementation matches the design specification and follows established project patterns.

## Inputs
- Design document (provided)
- Established patterns from `docs/knowledge/patterns.md`
- Prior decisions from `docs/knowledge/decisions.md`

## Checks
- Design drift: implementation vs. spec deviations
- Pattern violations: code contradicts established conventions
- Decision contradictions: changes conflict with prior ADRs
- Unnecessary complexity: over-engineering for the stated requirements
- Missing error handling: unhandled failure modes from the design
- Naming consistency with CLAUDE.md conventions

## Output Format
For each finding: TYPE / FILE:LINES / ISSUE / DESIGN REF / RECOMMENDATION
```

### Test Reviewer Agent

**File**: `.claude/agents/reviewer-tests.md`

```markdown
# Test Reviewer Agent

You audit test quality and identify gaps in test coverage.

## Checks
- Untested functions/branches
- Happy-path-only tests (no error paths)
- Missing edge cases: null, empty, boundary, overflow, concurrent access
- Test independence: shared state, execution order dependencies
- Assertion specificity: vague assertions like `assert result`
- Flaky indicators: timing-dependent, unseceded randomness

## Output Format
For each finding: TYPE / FILES / ISSUE / SUGGESTED TEST (setup → action → assertion)
```

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

### Post-Tool-Use Hook

**File**: `.claude/hooks/post-tool-use.sh`

```bash
#!/bin/bash
# Auto-format files after Claude edits them
# Configure this for your project's formatter

FILE="$1"

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx)
    npx prettier --write "$FILE" 2>/dev/null
    ;;
  *.py)
    python -m black "$FILE" 2>/dev/null
    ;;
  *.json)
    npx prettier --write "$FILE" 2>/dev/null
    ;;
esac
```

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
#!/bin/bash
# Bootstrap a new project with the full Project OS structure
# Usage: ./scripts/new-project.sh <project-name> <project-path>

PROJECT_NAME="$1"
PROJECT_PATH="$2"

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_PATH" ]; then
  echo "Usage: new-project.sh <project-name> <project-path>"
  exit 1
fi

echo "Creating project: $PROJECT_NAME at $PROJECT_PATH"

# Create directory structure
mkdir -p "$PROJECT_PATH"/{.claude/{commands/{workflows,tools,pm},agents,skills/{spec-driven-dev,tdd-workflow,session-management},knowledge,sessions,specs,rules,hooks,security},docs/research,scripts,src}

# Copy template files (assumes this script lives in an existing project-os repo)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

# Copy all .claude/ contents
cp -r "$TEMPLATE_DIR/.claude/commands" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/agents" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/skills" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/rules" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/hooks" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/security" "$PROJECT_PATH/.claude/"
cp "$TEMPLATE_DIR/.claude/settings.json" "$PROJECT_PATH/.claude/"

# Copy and customize CLAUDE.md
sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE_DIR/CLAUDE.md" > "$PROJECT_PATH/CLAUDE.md"
cp "$TEMPLATE_DIR/ROADMAP.md" "$PROJECT_PATH/"

# Initialize knowledge files
for f in decisions.md patterns.md bugs.md architecture.md; do
  cp "$TEMPLATE_DIR/docs/knowledge/$f" "$PROJECT_PATH/docs/knowledge/"
done

# Copy scripts
cp "$TEMPLATE_DIR/scripts/memory-search.sh" "$PROJECT_PATH/scripts/"
chmod +x "$PROJECT_PATH/scripts/"*.sh

# Initialize git
cd "$PROJECT_PATH"
git init
echo "CLAUDE.local.md" >> .gitignore
echo ".claude/sessions/" >> .gitignore
git add .
git commit -m "chore: initialize project with Project OS scaffold"

echo ""
echo "✅ Project '$PROJECT_NAME' initialized at $PROJECT_PATH"
echo ""
echo "Next steps:"
echo "  cd $PROJECT_PATH"
echo "  claude"
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

Don't build everything at once. Highest-leverage sequence:

**Week 1 — Foundation**: Create the directory structure, CLAUDE.md, settings.json, ROADMAP.md. Implement `/tools:handoff` and `/tools:catchup`. Start using session continuity immediately. This alone eliminates the "starting from scratch" problem.

**Week 2 — Workflow Pipeline**: Implement the six workflow commands (`/workflows:idea` through `/workflows:ship`). Start using the spec-driven approach for every new feature. The pipeline prevents the most expensive failure: building the wrong thing.

**Week 3 — Quality & PM**: Add the adversarial review agents, contextual rules, and hooks. Implement `/pm:prd`, `/pm:epic`, `/pm:status`. Set up the knowledge compounding habit.

**Week 4 — Optimize**: Run `scripts/audit-context.sh` and trim. Implement utility scripts. Add the security wrapper if using Context7. Start the new-project bootstrap for future projects.

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
