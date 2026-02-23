# Project Constitution

## Identity
- Project: Project OS
- Type: Personal project
- Owner: [YOUR_NAME]
- Stack: Markdown + Bash (scaffold template)

## Principles
- Ship working software over perfect software
- Specs before code — never implement without a design doc
- Context is noise — load only what the current phase needs
- Token economics: output costs 5× input — keep agent responses concise, prefer `CLI --json | jq .field` over full MCP output
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
3. `/workflows:plan` — Atomic task decomposition (outputs `[?]` drafts with `#TN` IDs)
4. `/pm:approve` — Governance gate (promotes `[?]` → `[ ]`)
5. `/workflows:build` — Wave-based parallel implementation with worktree isolation
6. `/workflows:review` — Adversarial quality gate (3 isolated reviewers)
7. `/workflows:ship` — Final validation, PR generation, metrics snapshot

Optional competitive path:
- `/workflows:compete` — N parallel implementations of a single task
- `/workflows:compete-review` — Side-by-side scoring to pick the winner

Never skip from idea to build. The design phase catches 80% of mistakes.

## Model Routing
- **Orchestration & design**: Primary model (Sonnet/Opus depending on settings)
- **Sub-agent implementation**: Haiku (set via CLAUDE_CODE_SUBAGENT_MODEL)
- **Adversarial review**: Primary model with isolated context
- **Agent adapters**: Tasks can route to non-Claude agents via `(agent: <name>)` — see `.claude/agents/adapters/INTERFACE.md`

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
| deploy, ship, release, external | security-gate | Security checklist |

## ROADMAP.md Format

### Task Markers
| Marker | Meaning | Transition |
|--------|---------|------------|
| `[?]` | Draft — pending `/pm:approve` | → `[ ]` on approval |
| `[ ]` | Todo — approved, ready for work | → `[-]` when started |
| `[-]` | In Progress — agent working | → `[~]` when complete |
| `[~]` | Review — awaiting review pass | → `[x]` on pass, `[!]` on fail |
| `[>]` | Competing — multiple implementations | → `[x]` when winner selected |
| `[x]` | Done | Terminal |
| `[!]` | Blocked | → `[-]` when unblocked |

### Task ID & Dependency Syntax
- Every task has an ID: `#TN` (e.g., `#T1`, `#T12`)
- Dependencies declared inline: `(depends: #T1, #T2)`
- A task is **unblocked** when all dependencies are `[x]` and task is `[ ]`
- Optional agent annotation: `(agent: <adapter-name>)`

### Agent Annotation
- Optional per-task: `(agent: <adapter-name>)` — routes task to a specific adapter
- Available adapters: `claude-code` (default), `codex`, `gemini`, `aider`, `amp`
- Adapter scripts: `.claude/agents/adapters/<name>.sh`
- Interface spec: `.claude/agents/adapters/INTERFACE.md`
- v2: Only `claude-code` is functional; others are stubs

### Feature Grouping
```
## Feature: <name>
### Draft
- [?] Task description #T1
- [?] Task description (depends: #T1) (agent: codex) #T2
### Todo
- [ ] Task description #T3
### In Progress
### Review
### Done
```

## Rules
- Never commit with TODO, FIXME, or HACK without a linked task in ROADMAP.md
- Never hardcode secrets, tokens, or credentials
- All public functions need docstrings
- Test files mirror source structure: `src/foo.ts` → `tests/foo.test.ts`
- Commits are conventional: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
