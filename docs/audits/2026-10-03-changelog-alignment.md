# Changelog Alignment Audit — 2026-10-03

Review of Claude Code **2.1.270 → 2.1.289** (the month since the previous pass,
which covered 2.1.221 → 2.1.269; see ROADMAP `Feature: changelog-alignment-2026-09`)
against this repo, plus a deprecation sweep of every custom mechanism against the
**full** changelog for native replacements.

Method: three isolated `researcher` agents (Opus) — two changelog slices
(lines 1–752, 753–1531 of the upstream `CHANGELOG.md`) and one native-replacement
sweep. The lead spot-checked every finding below that drives a task against the
changelog line and the repo file. Line refs are `version:line` in the upstream
`CHANGELOG.md` as fetched 2026-10-03.

Tasks are filed as `[?]` drafts #T205–#T219 under ROADMAP
`Feature: changelog-alignment-2026-10` for `/pm:approve`.

## Headline findings

1. **Path-scoped rules are not scoped.** `.claude/rules/tests.md` and `api.md` use
   `globs:` frontmatter; Claude Code only documents `paths:` (2.1.84:5654,
   2.1.69:6200). Both files load into every session unconditionally — confirmed:
   both appear in the lead's context with no test or API file touched.
   `project-os-guide.md` teaches the same wrong key downstream. 2.1.288:87 now also
   loads scoped rules on Write/Edit, so the fix pays off immediately. → #T205
2. **Sub-agents *do* inherit CLAUDE.md and every `.claude/rules/*.md`.** All three
   researchers received CLAUDE.md plus all 7 rule files (~35 KB), including the
   lead-only `lead.md` ("You do not implement…"), which contradicts the worker role.
   `bash.md:74` and `tools/research.md:25` assert the opposite, and every brief pastes
   Agent Rules on that premise. 2.1.271:1435 adds `omitClaudeMd` agent frontmatter;
   whether it also drops `.claude/rules/` is undocumented. → probe #T207, fix #T208
3. **Review triage can silently find nothing.** 2.1.277:1122 delivers sub-agent
   results indented under a header. `scripts/review-triage.ts:75`
   (`/^(CRITICAL|HIGH|MEDIUM|LOW) \/ /`) is column-0 anchored, and `review.md:191`
   writes reports "verbatim" — an indented report yields zero findings with no
   error. Confirmed: this session's hand-backs arrived indented. → #T206
4. **Sessions now default to auto mode** (2.1.284:527) when no
   `permissions.defaultMode` is set — this repo sets none. That changes what
   `bash.md` rules 2–6 and the never-installed `pre-tool-approve-hook.md` proposal
   are guarding against. Approver decision needed. → #T210

## Adopt

| Change | Surface | Task |
|---|---|---|
| `verify` skill auto-runs before commits (2.1.286:274) | none exists; `tests/run-all.sh --fast` is the single runner | #T211 |
| `/doctor prompt-audit` — stale paths, contradicting instruction files (2.1.283:573, 624) | CLAUDE.md, agents, commands; `/tools:maintain` | #T212 |
| `PostToolUseFailure` event (by 2.1.119:4931) | `tool-failure-log.sh` greps `is_error` anywhere in the payload, tool output included (its own comment, lines 19–21) | #T213 |
| `InstructionsLoaded` hook reports `agent_id` (2.1.288:95) | the instrument for probe #T207 | #T207 |
| Sonnet 5.5 / Opus 5.5 are the new defaults, both 1M (2.1.284:466, 2.1.280:935) | bare aliases pick them up; prose in `lead.md`, `set-models.md`, `init.md` names "Sonnet 5"/"Opus 5". 350k compact cap stays below every window in the chain | #T209 |
| Debug log names settings `env` vars ignored because the launch env set them (2.1.281:874) | #T194 fallback troubleshooting | #T214 |

## Deprecate / thin

| Area | Mechanism | Native | Verdict | Task |
|---|---|---|---|---|
| Memory | `/tools:kv` (`docs/knowledge/kv.md` holds 3 lines) | auto-memory (2.1.59:6293); `lead.md` already sends lessons there | DEPRECATE | #T215 |
| Permissions | `docs/proposals/pre-tool-approve-hook.md` (194 lines, never installed) | auto mode default (2.1.284:527), background-subagent prompts reach the lead (2.1.186:3715) | DEPRECATE, if #T210 picks auto | #T210 |
| Permissions | `bash.md` rules 2–6 | as above | THIN for auto mode; KEEP rules 1 and 7 (hook wiring) and the Windows doc | #T210 |
| Build | `project_os.parallel` config + backoff in `build.md`; self-ground `git merge master` | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (2.1.217:3048); `worktree.baseRef: "head"` (2.1.133:4671) | THIN — merge step only after probe proves base == lead HEAD | #T207, #T216 |
| Routing | `/tools:set-models` presets and its CLAUDE.md "Model Routing" rewrite | agent frontmatter `model:`/`effort:`, `fallbackModel` | THIN — keep Fable-cost confirmation and the window rule | #T217 |
| Output | `context-filter` manual ">5KB route" protocol | large-output spill-to-file, `bashOutputMaxChars` (2.1.261:1852), PostToolUse `updatedToolOutput` for all tools (2.1.121:4860) | THIN — keep freshness-scored search | #T218 |
| Review | per-wave single `reviewer-*` dispatch | `/code-review` levels (2.1.223:2890), `--max-findings` (2.1.288:39) | UNCLEAR — compare recall first | #T219 |

## Keep (gap is load-bearing)

- **Compaction handoff chain** (`compact-suggest.sh`, `pre-compact.sh`, `/tools:handoff`):
  no hook input carries context %, and PreCompact stdout is still the only way to
  steer auto-compaction. decisions.md 2026-07-30.
- **Maintenance loop** (`maintain.sh`): native `/loop`, cron and routines run the model
  every time; decisions.md 2026-07-16 rejected an LLM-driven loop.
- **Three-reviewer ship gate**, `codex-review.sh`: native review has no ROADMAP gate,
  no project rules, no cross-vendor model.
- **Activity log, `/tools:metrics`, dashboard**: project settings now *ignore* OTel
  export vars (2.1.282:725), so a template cannot ship native telemetry.
- **`/tools:dream`, `knowledge-index.ts`, compete, ROADMAP `(model:)` annotations**:
  no native equivalent.

These verdicts rest partly on changelog *silence* (no hook-visible context %, no
native consolidation, no project-scoped OTel). Re-check them on each pass.

## Watch (no task)

- `/autocompact` now saves a per-model window (2.1.288:113); `compact-suggest.sh:88`
  reads only `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Precedence is folded into probe #T207.
- `"attribution": false` (2.1.281:759): older CLIs skip any settings file containing
  it — never put it in a seeded settings file. Noted via #T214.
- PreToolUse hook match failure now blocks the call instead of skipping the hook
  (2.1.288:91) — the handoff claim can no longer be skipped; watch for unexpected
  blocked Writes. Noted via #T214.
- Project `effortLevel: "high"` is now honoured on the Fable 5 fallback (2.1.280:1014).
- Background commands time out (default 30 min) in unattended/cloud sessions
  (2.1.285:411) — pass an explicit `timeout` if a cloud lead backgrounds the full suite.
- Plugins as the distribution channel (replacing `sync-hooks.sh`,
  `install-global-commands.sh`, part of `update-project.sh`) and Claude Mods
  (2.1.287:127) as a home for the nudge: long-term; plugins still cannot seed
  ROADMAP/templates or set project env (decisions.md 2026-07-24).
- Dormant liability outside this scope: `review-triage.ts` (1251 lines) sits behind a
  Jev flag whose calibration has never run (decisions.md, Calibration record).

## Free fixes (no action)

Sub-agent reports lost after compaction and messages to finishing background agents
(2.1.280:973-974); sub-agents falsely marked failed (2.1.273:1373); partial-response
continuation after API timeout (2.1.288:42); CLAUDE.md attached twice after
compact/resume, "Prompt is too long" after compacting (2.1.287:145, 2.1.284:477);
worktree sub-agents loading CLAUDE.md twice (2.1.286:264); prompt-cache miss when a
SessionStart hook prints after `/clear` (2.1.277:1081). Re-baseline compaction metrics
on the next replay — post-compaction context should be smaller.

## Cost

Sub-agent spend: ~433k tokens (131k + 127k + 175k) across three researchers.
