# Project Constitution

## Identity
- Project: [PROJECT_NAME]
- Type: Personal project
- Role: [YOUR_ROLE]
- Owner: [YOUR_NAME]
- Stack: [PRIMARY_STACK]

## Principles
- Ship working software over perfect software
- Specs before code — never implement without a design doc
- Context is noise — load only what the current phase needs
- Token economics: output tokens cost several times more than input — keep agent responses concise, prefer `CLI --json | jq .field` over full MCP output
- Every decision gets documented with rationale
- Tests define done, not "it looks right"

## Architecture
<!-- /tools:init: replace with a ~40-line digest of this project's component
     map (major modules/services), data flow, and any hand-off or integration
     chains worth every session knowing — then keep the pointer line below. -->
[PROJECT_NAME]'s architecture digest goes here.

See `docs/knowledge/architecture.md` for full details.

## Active Conventions
<!-- /tools:init: replace with one line per established pattern (name — rule
     enforced) as patterns.md accumulates entries — then keep the pointer
     line below. -->
This project has no recorded patterns yet.

See `docs/knowledge/patterns.md` for full rationale, examples, and
anti-patterns per pattern.

## Workflow
This project uses spec-driven development:
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
- **Lead**: `fable` (set via `"model"` in settings.json; `opus` on plans without Fable)
- **Default sub-agent**: `sonnet` at high effort via `implementer`/`documenter` frontmatter, for any task with a complete brief and checkable acceptance criteria
- **Judgment tier**: `opus` at high effort via `(model: opus)` annotations or `researcher`, for reconciling sources, test design, root-causing, cross-system refactors, and escalation after a Sonnet failure. `CLAUDE_CODE_SUBAGENT_MODEL` stays `opus` as the tier for any unnamed spawn
- **Reviewers**: `inherit`
- **Adversarial review**: Primary model with isolated context
- **Agent adapters**: Per-task routing via `(agent: <name>)` — see `.claude/agents/adapters/INTERFACE.md`

## Roles (Advisory)
- **Architect**: Design authority — reads all, writes specs/knowledge
- **Developer**: Implementation — reads specs, writes code/tests/docs
- **Reviewer**: Quality gates — reads all, writes review reports
- **Approver**: Human — all permissions; decides `/pm:approve`, design approval, scope changes, destructive actions
- **Lead**: Primary session — plans, briefs, dispatches, arbitrates, integrates, verifies; does not implement
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
| filter, compress, large output, stale, fresh | context-filter | Filter protocol |

## Rules
- Never commit with TODO, FIXME, or HACK without a linked task in ROADMAP.md
- Never hardcode secrets, tokens, or credentials
- All public functions need docstrings
- Test files mirror source structure: `src/foo.ts` -> `tests/foo.test.ts`
- Commits are conventional: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- ROADMAP.md format: see ROADMAP.md header for marker legend, `#TN` IDs, and dependency syntax
- Produced documents stay local: reports, specs, handoffs, and reviews go to the repo (`docs/specs/`, `.claude/sessions/`, `docs/knowledge/`), never to the Claude Artifacts feature
