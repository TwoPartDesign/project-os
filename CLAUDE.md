# Project Constitution

## Identity
- Project: Project OS
- Type: Personal project
- Role: Solo-developer governance layer
- Owner: [YOUR_NAME]
- Stack: Markdown + Bash

## Principles

Core principles guide all architecture decisions. See `docs/knowledge/design-principles.md` for full details.

- Ship working software over perfect software
- Specs before code — never implement without a design doc
- Context is noise — load only what the current phase needs
- Code is a liability; judgement is an asset
- Audit the auditor — separate build and review contexts
- Token economics: output costs 5x input — keep agent responses concise

## Architecture
@import docs/knowledge/architecture.md

## Active Conventions
@import docs/knowledge/patterns.md

## Workflow
This project uses spec-first, governance-gated development:
1. `/workflows:idea` — Capture and research
2. `/workflows:design` — Technical specification
3. `/workflows:plan` — Atomic task decomposition (outputs `[?]` drafts with `#TN` IDs)
4. `/pm:approve` — Governance gate (promotes `[?]` to `[ ]`)
5. `/workflows:build` — Wave-based parallel implementation with worktree isolation
6. `/workflows:review` — Adversarial quality gate (3 isolated reviewers)
7. `/workflows:ship` — Final validation, PR generation, metrics snapshot

Optional: `/workflows:compete` + `/workflows:compete-review` for competitive implementation.

Never skip from idea to build. The design phase catches 80% of mistakes.

## Model Routing
- **Orchestration & design**: Primary model (Sonnet/Opus)
- **Sub-agent implementation**: Haiku (via `CLAUDE_CODE_SUBAGENT_MODEL`)
- **Adversarial review**: Primary model with isolated context
- **Agent adapters**: Per-task routing via `(agent: <name>)` — see `.claude/agents/adapters/INTERFACE.md`

## Roles (Advisory)
- **Architect**: Design authority — reads all, writes specs/knowledge
- **Developer**: Implementation — reads specs, writes code/tests/docs
- **Reviewer**: Quality gates — reads all, writes review reports
- **Orchestrator**: Human — all permissions, all phases
See `.claude/agents/roles.md` for full definitions.

## Memory System
- Session state: `.claude/sessions/` (structured YAML handoffs)
- Project knowledge: `docs/knowledge/` (decisions, patterns, bugs, architecture)
- Persistent memory: `docs/memory/` (cross-session, searchable)
- Specs & designs: `docs/specs/<feature>/` (per-feature lifecycle docs)

## Skill Triggers
| Pattern | Skill | Loads |
|---|---|---|
| implement, build, add feature | spec-driven-dev | SDD protocol |
| test, tdd, verify, coverage | tdd-workflow | Red-Green-Refactor |
| handoff, done, end session | session-management | Auto-save protocol |
| deploy, ship, release, external | workflows:ship | Pre-ship checklist + PR generation |

## Rules
- Never commit with TODO, FIXME, or HACK without a linked task in ROADMAP.md
- Never hardcode secrets, tokens, or credentials
- All public functions need docstrings
- Test files mirror source structure: `src/foo.ts` -> `tests/foo.test.ts`
- Commits are conventional: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- ROADMAP.md format: see ROADMAP.md header for marker legend, `#TN` IDs, and dependency syntax
