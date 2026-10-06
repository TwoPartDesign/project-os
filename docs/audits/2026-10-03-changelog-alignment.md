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
   researchers received CLAUDE.md plus all 6 rule files (~35 KB), including the
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

---

## ICM paper — round 2 (2026-10-05)

**Paper**: Van Clief & McDermott, *Interpretable Context Methodology: Folder Structure
as Agent Architecture*, arXiv 2603.16021v2 (March 2026). Reference repo now at
`RinDig/Interpretable-Context-Methodology` (internally "MWP"; the paper's URL 404s).

**Method**: three isolated Opus researchers (digest + mapping; two-way adversarial
critique; adjacent work + new approaches, including the AHE reference repo), then a
fresh `reviewer-architecture` pass over the merged proposal list. The lead verified
every task-driving repo claim. Tasks: #T220–#T226 (drafts); #T208 widened.

### What the paper claims

For sequential, human-reviewed workflows, numbered stage folders plus markdown
context files plus local scripts let **one orchestrating agent** replace a
multi-agent framework. Five context layers: L0 identity (~800 tokens), L1 routing,
L2 stage contract (Inputs / Process / Outputs, 200–500 tokens), L3 reference
material (treated as constraints), L4 working artifacts (treated as input).
"No agent reads everything" (p.6). §6 proposes incremental re-runs, provenance IDs,
cross-stage `Verify`, breakpoints, and "edit the source": recurring human edits are
debugging signal (pp.16–18), all unimplemented.

### How strong is it

Weak evidence, sound engineering lineage (Unix pipes, Make, multi-pass compilers).
No controlled comparison (§4.6, p.13); token figures are "representative" (Fig. 3);
the U-shaped editing result is self-reported by 33 of an invite-only 52 (Fig. 5); one
model family. Its own runs delegate in parallel via Claude Code agent teams (pp.10–11),
so "framework vs filesystem" is the wrong split — Project OS sits on the same native
primitives. Treat every benefit below as a hypothesis.

### Where it lands on Project OS

Project OS already has or exceeds 11 of ICM's 23 mechanisms (plain-text state,
review gates, seeds, local scripts, file-driven delegation, and parallelism and
error recovery that ICM lacks). The live gaps are the ones the paper is about:

- **Scoping is declared but not enforced.** `build.md:118-128` assembles "ONLY" the
  task's context, yet workers inherit CLAUDE.md + all 6 rule files (~35 KB, lead.md
  included), and `build.md:122-123` pastes CLAUDE.md conventions + Agent Rules on
  top — double delivery. ICM has the same flaw (its Inputs table is an instruction,
  not a mechanism). → #T205, #T207, #T208 (widened).
- **Design loads everything.** `design.md:16-19` reads architecture + patterns +
  decisions in full (119 KB ≈ 30k tokens) every run. → #T220 routes decisions.md only.
- **Always-loaded budget already exists but isn't enforced.** reflect.md sets 2,500
  tokens; CLAUDE.md (~2.5k) and lead.md (~3.3k) are at/over. → #T221.
- **Nothing after design checks the brief** (stage n vs n−2). → #T222.
- **Findings don't say which layer to fix** (edit-source principle). → #T223.
- **Self-edits aren't falsifiable** (AHE: every harness edit carries a predicted
  impact checked on the next run). → #T224.

### Adversarial verdicts

| Proposal | Outcome | Why |
|---|---|---|
| Inputs/Outputs contracts + index-routed knowledge | Narrowed → #T220 | FTS5 keyword search can miss an ADR worded differently, and no design reviewer checks decisions.md; index refreshes only in build preflight. Route decisions.md by heading grep; add an ADR-conflict check |
| Slim always-loaded layer via "Agent Rules only" + dedupe test | Replaced → #T221 | Would have stripped lead.md's own instructions (CRITICAL) and reversed decisions.md:426; the dedupe test would fail on intentional Agent Rules copies. Deterministic budget check instead |
| Stop double delivery in build packets | Merged into #T208 | Conditional on #T207(a) exactly like #T208; also dream.md:68 |
| Review against brief | Narrowed → #T222 | Two brief schemas exist (idea.md vs prd.md) |
| Upstream-hash staleness stamps | **Dropped** | §6.1 is speculative; design is human-approved after any brief change; LLM-written hashes are unreliable. If wanted: mtime warning in build preflight |
| Draft snapshots + `source` field | Narrowed → #T223 | /pm:approve never reads design/tasks; a fifth ` / ` field is misparsed by review-triage.ts:124 |
| Falsifiable reflect + auto revert drafts | Narrowed → #T224 | No applied-edit ledger yet; auto-revert deferred |
| Retire triage/Jev, skill-apply auto tier, compaction-metrics | Decision → #T225 | Each reverses a recorded decision; compaction-metrics is the named instrument for the 70% revisit (KEEP) |
| Phase boundary = session boundary | Idea → #T226 | Builds still need the chain (decisions.md:485) |

Considered and dropped: numbered stage folders (status gates already enforce
order), markdown breakpoints, tracking `docs/specs/` in git (Ship Seeds Not Live
Content).

### Cross-cutting caution

Don't stack context cuts: #T220 keeps patterns.md in design and review because
#T221 may move CLAUDE.md's convention one-liners out. Removing both would leave no
context that holds the patterns.

### Adjacent work

- **AHE**, *Agentic Harness Engineering* (2604.25850), verified from its repo:
  - harness components are git-tracked files;
  - every edit carries evidence, a root cause and a predicted impact;
  - an edit is rolled back or moved to a different component after repeated failure;
  - reported gain: 69.7% → 77.0% on Terminal-Bench 2.
- **Unverified, search snippets only:**
  - **Natural-Language Agent Harnesses** (2603.25723): file-backed state and acceptance discipline were the strongest modules.
  - **Stop Comparing LLM Agents Without Disclosing the Harness** (2605.23950): the harness explains more variance than the model.
  - **Harness as a Language** (2609.26891): a minimal-harness counterpoint.

Round-2 sub-agent spend: ~559k tokens (112k + 131k + 190k + 126k for the reviewer,
plus lead verification).
