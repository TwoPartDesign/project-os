# Plan of action: Fable alignment + improvement-review fixes

Date: 2026-09-04. Inputs: `docs/specs/fable-orchestrator-alignment/brief.md`
(DRAFT), handoff `.claude/sessions/handoff-2026-09-04-083818-26127.yaml`,
`docs/memory/2026-09-04-improvement-review.md`.

## Done this session (no pipeline needed; config only)

- `.claude/settings.json`: `model: fable`, `fallbackModel: [opus, sonnet]`,
  `CLAUDE_CODE_SUBAGENT_MODEL: opus`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW: 350000`.
  `effortLevel: high` unchanged. `_FORCE` not set. This is the brief's row 1.
- `.claude/rules/lead.md` created: the orchestrator prompt, adapted so Project
  OS rules win, with the worker brief header as its `## Agent Rules` section.
  Loads automatically with the other rule files. This was the brief's
  "follow-up" item; pulled forward because the user asked for it.
- CLI is 2.1.260, above the 2.1.255 minimum the brief requires.

## Finding that changes the brief

The roster the prompt assumes does not exist as dispatchable agents. This
session's available agent types are `claude`, `claude-code-guide`, `Explore`,
`general-purpose`, `Plan`, `statusline-setup`. None of `implementer`,
`researcher`, `documenter`, `reviewer-*` is registered, because the files in
`.claude/agents/` carry `isolation/role/permissions` frontmatter and no
`name:`/`description:`. `build.md:130` confirms it: every worker is spawned as
`subagent_type: "general-purpose"` with the agent file pasted as prose.

Consequence: the brief's row 4 (add `model:`/`effort:` frontmatter to six
agent files) would be inert as written. The improvement review already flagged
this as "dead agent defs (6 of 9) contradicting live prompts" (Tier 3). The
design phase must widen row 4 to: give each roster file valid `name`,
`description`, `model`, `effort`, `tools` frontmatter so Claude Code registers
them, then switch the spawn points (`build.md`, `review.md`, `design.md` Step
3, `compete*.md`, `research.md`, `dream.md`) from `general-purpose` to the
named agent. That also fixes the `multi-agent-judging.md` R4 defect (model
annotations honoured only on the build path).

## Phase 1: fable-orchestrator-alignment through the pipeline

Run `/workflows:design` on the brief with these answers to its open questions:

1. Role split: rename the human to **Approver**, add **Lead** for the session.
   Cleaner, and the grep found only 11 occurrences in 9 files.
2. Reviewers: `model: inherit`, `effort: high`. Keeps "adversarial review on
   the primary model" true.
3. Fallback: `[opus, sonnet]`, already applied.

Design must add to the edit table (found by grep this session):
`docs/knowledge/decisions.md:141`, `design-principles.md:84`,
`CLAUDE.template.md:40`, `roadmap-format.md:61` (dated model ID),
`multi-agent-judging.md:93` (monoculture note now stale), `mvp.md`,
`compete.md`, `project-os-guide.md`, `architecture.md`, plus the roster
registration above. Also flag `build.md:185` ("ONE retry") against the
two-retry cap.

Then `/workflows:plan`, `/pm:approve`, `/workflows:build` (one Opus wave; the
edits are markdown and JSON), `/workflows:review`. Verify
`bash scripts/validate-roadmap.sh` and `node scripts/system-map.ts report`.

## Phase 2: Tier 1 "silently broken" fixes from the handoff

File six `[?]` drafts in ROADMAP.md (next free ID is #T154), approve, build as
one wave. Each is under an hour and turns a dead feature back on:

1. `CLAUDE.md:22,25` `@import` never expands. Fix with an inline ~40-line
   digest, not a bare `@path` (46KB per session otherwise).
2. `.claude/hooks/output-index.sh:43,47` reads `d.arguments`/`d.output`;
   payload is `tool_input`/`tool_response`. Refit `tests/hook-smoke.sh`
   fixtures (lines 158, 172, 183, 193) from a real transcript payload and add
   a schema hygiene test, or the fix passes the same tests the bug passed.
3. `scripts/security-scanner.ts:650-660` (no maxBuffer, bare catch),
   `:697-702` (scan-diff reads working tree), `:598-606` (exit 0 on dirs).
4. `.claude/hooks/post-write-session.sh:11-15` needs
   `canonicalize_payload_path`.
5. `tests/hook-smoke-negctl.sh` never exits non-zero (`set -uo`, no victim
   comparison).
6. `scripts/update-project.sh:425-449` missing `skill-apply.ts`,
   `skill-ledger.ts`; make the manifest check bidirectional.
7. Remove the pop-up windows on step success/failure (user request,
   2026-09-04). `.claude/hooks/notify-phase-change.sh:77` spawns a Windows
   Forms `MessageBox` for every event; callers are `build.md:187,222`,
   `compete.md:103`, `review.md:142`. Make the Windows branch terminal-only
   (stderr line, same as the fallback path); keep the `notify-send` branch.
   Update `docs/knowledge/architecture.md:51` wording.
8. Produced documents stay local (user request, 2026-09-04). When the project
   is maintained locally or the session was started locally, reports, specs,
   handoffs, and reviews are written to the repo (`docs/specs/`,
   `.claude/sessions/`, `docs/knowledge/`), never published through the
   Claude Artifacts feature. Add the rule to `.claude/rules/preferences.md`
   (Communication) and to `lead.md` "Working with the user"; mirror the line
   in `CLAUDE.md` Rules and `CLAUDE.template.md` so downstream projects get
   it. No script change.

Ordering: Phase 1 first. It is the smaller change, and it registers the
roster that Phase 2's build wave then dispatches to. Reverse only if Phase 1
stalls in design.

## Phase 3: housekeeping (Sonnet-tier, or lead does it inline)

- `git add docs/knowledge/multi-agent-judging.md` (untracked since 2026-08-01).
- ROADMAP.md has two uncommitted maintenance drafts, #T152 (Bash failures)
  and #T153 (dream due). Commit them with the Phase 1 work or approve now.
- Windows fixture noise: apply the skip guard at
  `tests/compaction-hooks.sh:1800-1812` to the symlink tests at `:1746/:1767`
  and the quote-filename fixture at `:2018`; add a per-suite timeout in
  `tests/run-all.sh:130`.
- `MEMORY.md` still says 24 null-regex rules; actual is 3.
- Add `.claude/worktrees/` to `.gitignore` (30+ stale command copies live
  there; currently hidden only by a local/global ignore). Design review r2
  M14.

## Flags for the user (outside the project, not changed)

- `~/.claude/settings.json` sets `modelSettings.claude-fable-5-1.effortLevel:
  medium` (from `/effort medium` this session). `lead.md` and the project
  settings say high. Run `/effort high` if you want the prompt's intended
  depth, or leave medium deliberately and accept shallower routing decisions.
- `~/.claude/settings.json` `CLAUDE_CODE_SUBAGENT_MODEL: claude-sonnet-4-6` is
  a dated ID and violates the bare-alias rule. The project value overrides it
  here, but other projects without a project-level setting inherit it.
