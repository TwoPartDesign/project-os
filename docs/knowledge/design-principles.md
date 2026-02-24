# Design Principles

This document consolidates the core principles that guide Project OS architecture and decision-making.

---

## Core Principles

### 1. Context is Noise

Bigger token windows are a trap. Give agents only the narrow, curated signal they need for their specific phase. Less context = higher IQ.

**Implication**: Load only what's needed for the current phase. Do not preload specs, designs, or history unless explicitly required. Each workflow phase gets isolated, minimal context.

### 2. Specs Before Code

Never implement without a design doc. Every feature goes through the full pipeline: idea → design → plan → build → review → ship.

**Implication**: The design phase catches 80% of mistakes. Never skip from idea to build. Tests and acceptance criteria are defined at plan time, not after build.

### 3. Code is a Liability; Judgement is an Asset

The pipeline exists to maximize human judgement and decision-making authority at every phase:
- **Idea**: User captures intent, Claude extracts signal
- **Design**: First-principles analysis with adversarial self-review
- **Plan**: Atomic task decomposition — explicit enough that no clarifying questions arise during build
- **Build**: Sub-agents implement to spec with isolation (worktrees)
- **Review**: Three isolated reviewers check for drift, security, and test coverage
- **Ship**: Final validation and PR generation

Every transition is a quality gate.

### 4. Audit the Auditor

The agent that builds code cannot validate it. Separate contexts for execution and validation. Reviewers receive isolated context focused only on validation, not implementation details.

**Implication**: `/workflows:review` spawns 3 independent reviewers with read-only context.

### 5. Deterministic Execution

If the builder has to guess, the planner failed. Every task must have:
- Exact file paths and line ranges
- Function signatures and patterns to follow
- Implementation details (edge cases, constraints)
- Test cases with setup, assertions, and expected results
- Testable acceptance criteria

**Implication**: Test cases are defined at plan time, not after build. Builders never ask clarifying questions.

### 6. Agency Over Automation

Every phase has a human checkpoint. The system preserves your intent and decision-making authority.

**Implication**: No silent retry loops. No auto-pushing to main. No hidden rollbacks. Every critical phase asks for explicit approval before proceeding.

### 7. Ship Working Software Over Perfect Software

Balance perfection against shipping velocity. Small iterations compound better than big rewrites.

**Implication**: Use `/workflows:compete` for critical decisions where competitive implementation adds value. For routine work, ship the first solid solution.

### 8. Documentation Compounds

Every decision, bug root cause, and pattern discovered gets recorded in `docs/knowledge/`. These records inform future work and prevent re-solving the same problems.

**Implication**: Pay the small cost of documentation now; it multiplies in value as the project grows.

---

## Model Routing Rationale

### Orchestration & Design: Sonnet/Opus

- Complex reasoning, architecture decisions
- Context: Full access to project state, decisions, patterns
- Frequency: Once per phase transition
- Cost/benefit: High reasoning quality justifies higher cost

### Sub-Agent Implementation: Haiku

- Focused coding within a narrow spec
- Context: Only task-specific context (10-15% of full project context)
- Frequency: Parallel implementation across multiple tasks
- Cost/benefit: Cheap and fast for isolated, well-scoped work. 4x cheaper than Sonnet with minimal quality loss when spec is tight.

### Adversarial Review: Primary Model (Isolated Context)

- Independent judgment over code, tests, architecture drift
- Context: Spec + code diff only; no implementation details
- Frequency: Once per feature, three reviewers in parallel
- Cost/benefit: Primary model needed for architectural judgment; isolation prevents reviewer bias.

---

## Memory System Overview

Five layers, each with distinct purpose and lifespan:

| Layer | Location | Lifespan | Loaded By | Purpose |
|---|---|---|---|---|
| **Global Identity** | `~/.claude/CLAUDE.md` | Per-project | Every session | Personal preferences, model routing, hard rules |
| **Project Constitution** | `./CLAUDE.md` | Project lifetime | Every session | Stack, conventions, workflow, skill triggers |
| **Knowledge Vault** | `docs/knowledge/` | Project lifetime | On-demand | Compounding decisions, patterns, bugs, architecture |
| **Feature Specs** | `docs/specs/<name>/` | Feature lifetime | On-demand | Brief, design, tasks, review artifacts |
| **Session Handoffs** | `.claude/sessions/` | 24-48 hours | On-demand | YAML snapshots for resuming mid-task |

**Cross-agent memory**: The `.claude/` directory is shared across all agents (Claude Code, Codex, etc.), so all tools can read the same knowledge vault and handoff files without external MCP.

---

## Token Economics Rules

Output costs ~5x input. Optimize for concise, high-signal communication.

### Guidelines

1. **Prefer structured output over narrative**: `CLI --json | jq .field` beats "let me fetch and explain the whole response"
2. **Load only what you need**: Don't preload 50KB of architecture docs for a 10-line bug fix
3. **Keep agent responses under 500 tokens**: If you're typing more than that, you're providing too much context
4. **Use skill triggers to load capabilities on-demand**: Don't load SDD protocol until the user types "implement"
5. **Archive completed sessions**: Handoff before context hits 70%, not at 95%

### Examples

**Bad**: Loading the full 2900-line project-os-guide.md to understand one workflow phase.

**Good**: Knowing that the spec is in `.claude/commands/workflows/build.md` and requesting only the relevant section.

**Bad**: A sub-agent writing a 200-line exploration of alternatives for a straightforward task.

**Good**: A sub-agent implementing the spec directly with a brief summary of decisions made.

---

## Why Native-Only?

External dependencies are attack surface, maintenance burden, and single points of failure. Claude Code's native primitives are sufficient:

- **Slash commands** → Workflow engine
- **Sub-agents** → Parallel execution
- **Skills** → On-demand capability loading
- **Hooks** → Auto-formatting, validation, logging
- **Rules** → Contextual code conventions
- **Task tool** → Parallel wave scheduling
- **Git** → Versioning and history

The only genuinely hard-to-replicate external capability is live library documentation (Context7 MCP), for which we provide an optional security-wrapped integration pattern.

---

## When to Use Each Workflow Phase

| Phase | When | Skip If |
|---|---|---|
| `/workflows:idea` | New feature, unclear requirements | Feature spec already exists |
| `/workflows:design` | High-risk feature, architectural decision | Routine change with clear acceptance criteria |
| `/workflows:plan` | Feature > 20 lines or 2+ files | Single-file < 20 line change |
| `/workflows:build` | Spec approved, tasks ready | Ad-hoc fix or POC |
| `/workflows:review` | Auth, data, money; multi-file change | Solo developer, low-risk change |
| `/workflows:ship` | Releasing to users or main branch | Internal experiment |

**Competitive implementation** (`/workflows:compete`) is optional and best used for:
- Critical architectural decisions where multiple approaches are viable
- Skill development — pit two implementations head-to-head
- Teaching — document why one approach won

---

## Related Documents

- **ROADMAP.md Format**: See `docs/knowledge/roadmap-format.md` for marker legend, `#TN` ID syntax, and dependency rules
- **Memory System Details**: See Memory Architecture section in `project-os-guide.md`
- **Workflow Specifications**: See individual command files in `.claude/commands/`
