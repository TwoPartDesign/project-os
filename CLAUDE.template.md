# Project Constitution

## Identity
- Project: [PROJECT_NAME]
- Type: Personal project
- Owner: [YOUR_NAME]
- Stack: [PRIMARY_STACK]

## Principles
- Ship working software over perfect software
- Specs before code — never implement without a design doc
- Context is noise — load only what the current phase needs
- Every decision gets documented with rationale
- Tests define done, not "it looks right"

## Architecture
@import docs/knowledge/architecture.md

## Active Conventions
@import docs/knowledge/patterns.md

## Workflow
This project uses spec-driven development. The workflow is:
1. `/workflows:idea` — Capture and research
2. `/workflows:design` — Technical specification
3. `/workflows:plan` — Atomic task decomposition
4. `/workflows:build` — Implementation with sub-agents
5. `/workflows:review` — Adversarial quality gate
6. `/workflows:ship` — Final validation and deploy

Never skip from idea to build. The design phase catches 80% of mistakes.

## Model Routing
- **Orchestration & design**: Primary model (Sonnet/Opus depending on settings)
- **Sub-agent implementation**: Haiku (set via CLAUDE_CODE_SUBAGENT_MODEL)
- **Adversarial review**: Primary model with isolated context

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
| deploy, ship, release, external | security-gate | Security checklist |

## Rules
- Never commit with TODO, FIXME, or HACK without a linked task in ROADMAP.md
- Never hardcode secrets, tokens, or credentials
- All public functions need docstrings
- Test files mirror source structure: `src/foo.ts` → `tests/foo.test.ts`
- Commits are conventional: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
