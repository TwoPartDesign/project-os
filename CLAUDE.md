# Project Constitution

## Identity
- Project: Project OS
- Type: Personal project
- Role: Solo-developer governance layer
- Owner: Jacob Nickel
- Stack: Markdown + Bash

## Principles

Core principles guide all architecture decisions. See `docs/knowledge/design-principles.md` for full details.

- Ship working software over perfect software
- Specs before code — never implement without a design doc
- Context is noise — load only what the current phase needs
- Code is a liability; judgement is an asset
- Audit the auditor — separate build and review contexts
- Token economics: output tokens cost several times more than input — keep agent responses concise

## Architecture
Project OS is a solo-developer governance layer (bash + markdown) enforcing
human authority via phase checkpoints, adversarial review, and an audit trail
(ROADMAP.md + JSONL activity log).

**Components**: commands in `.claude/commands/{workflows,tools,pm}/`
(lifecycle, utility, governance); named agent roster in `.claude/agents/*.md`
(frontmatter sets model/effort; dispatch by `subagent_type`, never
`general-purpose`); skills in `.claude/skills/*/SKILL.md`
(progressive-disclosure playbooks, e.g. context-filter); external adapters in
`.claude/agents/adapters/` (`codex.sh` only — native Task-tool dispatch is
the default path); 11 hooks in `.claude/hooks/` (compaction chain below,
plus format/scrub-on-write, SessionStart activation + maintenance, advisory
PostToolUse indexing); `scripts/` utilities (`knowledge-index.ts` FTS5
search, `system-map.ts` wiring graph, `maintain.sh`/`maintain-draft.ts`
drafts-only loop, `security-scanner.ts`, `setup.sh`, `dashboard-server.ts`);
`docs/knowledge/` (patterns, decisions, bugs, architecture) and
`docs/maps/system-map.md` (generated wiring map — never hand-edit).

**Data flow (build)**: ROADMAP.md markers are authoritative → parsed into
native Tasks (`addBlockedBy` from `(depends:)`) → dispatch resolution
(`(model:)` annotation → `(agent: codex)` adapter → roster agent frontmatter →
`CLAUDE_CODE_SUBAGENT_MODEL` for unnamed spawns) → sub-agents in isolated
worktrees → completion reports → batch-drain re-derives state from ROADMAP
markers.

**Compaction handoff chain** (3 stages, 2 hooks): (1) `compact-suggest.sh`
nudges Claude via PostToolUse `additionalContext` once context passes 60%
of the window, and claims handoff-file writes by session id on PreToolUse so
ownership is known before compaction; (2) Claude runs `/tools:handoff`, the
only stage that can author rationale; (3) `pre-compact.sh` (PreCompact) reads
only this session's claimed handoff and prints its `compact_instruction` on
stdout, forwarded by the runtime to the compaction summarizer — no discovery
fallback, no environment override.

See `docs/knowledge/architecture.md` for the full module map, hook/script
tables, security scanning, and self-maintenance details.

## Active Conventions
One line per established pattern (name — rule enforced); see the full file for
rationale, examples, and anti-patterns.

- **Ship Seeds, Not Live Content** — a template seeds new projects from a
  dedicated seed tier, never from its own live working files.
- **ROADMAP↔Tasks Dual-Track** — ROADMAP.md markers are the authoritative
  state; native Tasks are the runtime scheduler; re-derive from markers on
  every batch drain.
- **Schema Contract Across File Boundaries** — verify a producer's output
  schema matches its consumer's input expectations at integration time.
- **Security Scanning Gate** — defense-in-depth (pre-commit/pre-push/ship
  scan-diff); never bypass with `--no-verify` without the ship-workflow
  backstop.
- **Sole-Writer Self-Enforcement** — the sole sanctioned writer to a sensitive
  artifact sanitizes every field it writes, not just the obvious one.
- **Deterministic Artifact: Heal, Don't Block** — on drift, regenerate a
  generated artifact from the staged index and re-stage it; fail the commit
  only when the machine genuinely can't resolve it.
- **Denylist Before Emit** — normalize the key, then check a separator-free
  sensitive-name denylist, before emitting any config/key-value observation.
- **Mitigate Against the Platform's Real Surface, Not Its Defaults** —
  enumerate where the platform actually looks (all hook types, indirection
  like `core.hooksPath`) and mitigate there, not just the default location.
- **Invert Open-Ended Recognition Predicates to Closed Allowlists** — define
  the closed set of safe residue and refuse anything outside it, rather than
  enumerating unsafe shapes.
- **One Command Runs Every Check, On The Machine That Ships** — one entry
  point discovers and runs every suite by glob, and it must run on the
  platform that actually ships.
- **Verify the Channel Before Designing the Gate** — check a design's
  load-bearing observability assumption against the shipped runtime before
  building enforcement around it.
- **Test Behaviour in a Copied Project Root** — copy self-locating scripts
  into a throwaway root and assert what they *do*, not just their exit code.
- **Registered Roster, Not Pasted Prose** — an agent's identity, tier, and
  scope live once in `.claude/agents/<name>.md`; dispatch by name, never fall
  back to `general-purpose`.

See `docs/knowledge/patterns.md` for full rationale, examples, and
anti-patterns per pattern.

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
- System map: `docs/maps/system-map.md` — CONSULT IT before changing hook/command/skill/script wiring (it answers "what references this?"); run `node scripts/system-map.ts report` for current health findings. Healed by pre-commit; never hand-edit.

## Maintenance Invariants
- Files/git are the source of truth; the SQLite index is deletable and rebuildable at any time.
- The maintenance loop (`scripts/maintain.sh`) files `[?]` drafts only — it never mutates canonical state; promotion is `/pm:approve`.
- Dream archives (`docs/memory/.archive/`) are the permanent verbatim tier — consolidation annotates with provenance, never destroys originals.

## Skill Triggers
| Pattern | Skill | Loads |
|---|---|---|
| implement, build, add feature | spec-driven-dev | SDD protocol |
| test, tdd, verify, coverage | tdd-workflow | Red-Green-Refactor |
| handoff, done, end session | session-management | Auto-save protocol |
| deploy, ship, release, external | workflows:ship | Pre-ship checklist + PR generation |
| filter, compress, large output, stale, fresh | context-filter | Filter protocol |
| drift, unwired, orphan, health check, maintenance | tools:maintain | Draft-only health sweep + `system-map.ts report` |

## Rules
- Never commit with TODO, FIXME, or HACK without a linked task in ROADMAP.md
- Never hardcode secrets, tokens, or credentials — enforced by pre-commit hook (activated by `bash scripts/setup.sh`, auto-run on project creation and session start)
- All public functions need docstrings
- Test files mirror source structure: `src/foo.ts` -> `tests/foo.test.ts`
- Commits are conventional: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- ROADMAP.md format: see ROADMAP.md header for marker legend, `#TN` IDs, and dependency syntax
- Produced documents stay local: reports, specs, handoffs, and reviews go to the repo (`docs/specs/`, `.claude/sessions/`, `docs/knowledge/`), never to the Claude Artifacts feature
