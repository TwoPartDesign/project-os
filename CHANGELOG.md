# Changelog

## v3.1 — 2026-10-06 — Lean Context follow-ups

Clears the v3.0 ship-gate drafts and applies the Approver's two rulings on context size.
Every hook and permission change was decided by a fresh headless-session probe first
(pattern: Verify the Channel Before Designing the Gate).

### Context size (Approver rulings)
- **Conventions leave CLAUDE.md** — the "Active Conventions" list is replaced by a pointer to
  `docs/knowledge/patterns.md`, which already held each pattern in full; `lead.md`, `build.md`
  and `review.md` now fold or read the matching patterns.md entries. CLAUDE.md drops from
  ~2.6k to ~2.0k tokens (#T241).
- **Always-loaded budget 2,500 → 4,000 tokens** (`system-map.ts report`, reflect.md "Size
  math"); the all-files `bloat_warn_tokens` stays 2,500 (#T242).
- **Compaction window 350k → 500k tokens** — compaction fires at ~400k (80%), the handoff
  nudge at ~325k. The whole model chain is 1M, so the cap rule still holds; decisions.md
  supersedes the 2026-09-21 keep-350k ruling (#T243).

### Hooks and permissions
- **Hook commands run from `"$CLAUDE_PROJECT_DIR"`** — the probe showed hooks run in the
  session's current directory, so a Bash `cd` broke every relative hook path or ran a
  subtree's own hook scripts (#T238).
- **`Bash((cd * && *))` and `Bash((cd * ; *))` removed** — the probe showed they approve
  nothing in default permission mode; bash.md rule 6 no longer calls the subshell form
  pre-approved (#T239).
- **Bash-edit formatter skips generated artifacts** (`docs/maps/*`, `.claude/manifest.json`,
  `review-triage.json`), which merges and generator scripts do report in `bashEditDiff`; a
  `skipped:true` diff (e.g. `git checkout <file>`) now counts as unknown and triggers the
  session-file fallback scrub (#T236).
- **Windows paths in `bashEditDiff`** are converted with `cygpath -u` instead of dropped;
  without cygpath they are still rejected (#T233).

### Build, metrics and maintenance
- build.md documents the generated-map merge-conflict resolution (#T234) and pre-flight
  step 9 restores the self-ground merge when `worktree.baseRef` is not `"head"` (#T237).
- compaction-metrics.ts gives every `compact_boundary` its own cycle, including trailing
  ones and ones before the first turn (#T235).
- maintain.sh failure drafts fingerprint `failures:<tool>:<ISO week>`: one draft per tool
  per week, no substring collisions (#T229).
- 22 `printf "$var" | grep -q` assertions under `pipefail` become `[[ ]]` or here-strings,
  removing a latent SIGPIPE race (#T240).

### Ship-gate fixes
The three-reviewer gate passed with fixes (no CRITICAL; one HIGH, pre-existing). All
fixed in this release:
- **Prompt-injection alert failed open on large MCP responses** (HIGH, pre-existing) —
  `post-mcp-validate.sh` piped the response into `grep -qi` under `pipefail`; on a 2.2 MB
  response with `<script>` on line 1 the alert missed 20 of 20 runs. Here-strings now, with a
  regression test.
- **update-project.sh traversal guard** had the same race (`tar tzf | grep -qE`): the listing is
  captured first, so the guard cannot be skipped.
- **Session scrub is fail-safe** — a rejected `bashEditDiff` path (including a Windows path
  without a usable `cygpath`) now triggers the fallback sweep; `skipped:true` is detected past
  nested objects; `cygpath` runs only from an absolute path. A fresh security re-verify then
  found that a truncated payload whose list closed before an unseen `skipped:true` still
  skipped the sweep (MEDIUM); that case, a malformed list tail and a quote in `cygpath`
  output now sweep too.
- **Ten dead allow rules removed** — hooks are not permission-gated (probe), so allow entries
  for scripts that only run as hooks did nothing; decisions.md amends the #T76 contract.
- `PROJECT_OS_WEEK` must be `YYYY-Www`; compaction-metrics reports each closing boundary's
  own `postTokens` everywhere; pinning tests for the 4,000 budget, the 500k window and the
  absolute hook paths; build.md, the adapter contract and reviewers name patterns.md;
  decisions.md records the probe facts behind the hook changes.

### Migration
- **settings.json** — hook commands become `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/<x>.sh"`;
  drop the two `(cd * …)` allow rules and the `Bash(bash .claude/hooks/<x>.sh*)` entries for
  hook-only scripts (keep `log-activity.sh` and `notify-phase-change.sh`);
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` → `"500000"`.
- **CLAUDE.md** — projects that copied the conventions list can replace it with the pointer.

### Known gaps
- Windows behaviour of the `"$CLAUDE_PROJECT_DIR"` hook form is unverified.
- A downstream project whose settings.json conflicted on update keeps relative hook paths with
  no warning (draft #T244).
- update-project.sh's traversal guard does not check symlink targets inside the archive
  (draft #T245).
- The failure-draft threshold of 5 is provisional until a week of real data.
- Six MEDIUM `orphan-script` findings in `system-map.ts report` predate this release.

---

## v3.0 — 2026-10-06 — Lean Context

Aligns Project OS with Claude Code 2.1.270–2.1.289 and the Opus 5.5 / Sonnet 5.5 lineup,
and cuts what every session and worker loads. Built as one release (feature
`changelog-alignment-2026-10`, #T205–#T228, #T231–#T232) and gated by the full
three-reviewer pass. Also ships the never-released v2.4-dev entries below.

### Lean context
- **Workers no longer load CLAUDE.md or lead rules** — every roster agent sets
  `omitClaudeMd: true`; briefs carry the conventions instead. A fresh-process probe
  confirmed the roster agent loads neither CLAUDE.md nor unscoped rules (#T207, #T208).
  The roster test now fails any agent without it.
- **Rule scoping works** — `tests.md` and `api.md` used `globs:`, which Claude Code
  ignores, so both loaded into every session. They now use `paths:` (#T205).
- **Always-loaded budget is checked** — `system-map.ts report` flags CLAUDE.md or any
  unscoped rule over the 2,500-token budget (`always-loaded-over-budget`);
  `audit-context.sh` no longer counts every knowledge file as always-loaded; the duplicated
  "produced documents stay local" line is down to one copy per file (#T221). CLAUDE.md and `lead.md` still exceed the budget; see Known gaps.
- **/workflows:design reads decisions.md by section** and its reviewer checks ADR
  conflicts; review.md passes the patterns.md path instead of pasting it (#T220).
- **context-filter** drops the manual >5KB route (native large-output spill covers it) and
  keeps freshness-scored search (#T218).

### Native-first
- **Build orchestration** — native `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` replaces
  `project_os.parallel`; `worktree.baseRef: "head"` replaces the self-ground merge step.
  Worker briefs pass absolute paths for gitignored inputs and send gitignored outputs to the
  session scratchpad (#T216).
- **tool-failure-log.sh** moves to the `PostToolUseFailure` event, ending the `is_error`
  text grep that logged false positives (#T213).
- **`verify` skill** runs `bash tests/run-all.sh --fast` before non-docs commits (#T211).
- **Bash-made edits reach the format and scrub hooks** through `bashEditDiff`; a truncated
  payload falls back to scrubbing recently modified session files (#T202).
- **Model switches are logged** via `PostModelSwitch` → `model-switched` events (#T203).
- **/tools:kv removed** in favour of native auto-memory (#T215); **/tools:set-models**
  thinned: stale tier presets and the CLAUDE.md rewrite step are gone, and the Fable cost
  confirmation stays (#T217).
- **Auto mode is the standing default** (`permissions.defaultMode` unset); bash.md rules 2–5
  are marked default-mode/Windows guidance (#T210).

### Model routing
- **Lead on `opus`**, `fallbackModel: ["sonnet"]`; `implementer`/`documenter` on `sonnet`
  at high effort; the ladder is `sonnet` (high) → `opus` (high) → `opus` (xhigh). `fable`
  leaves the ladder and stays an Approver-confirmed choice in `/tools:set-models` (#T209,
  #T228).

### Measurable loop
- Review findings carry a layer tag (`DRIFT[design]:` …) so `/workflows:rebuild` fixes the
  upstream artifact (#T223); Reviewer 1 checks the brief's success criteria (#T222).
- `/tools:reflect` proposals carry a grep-checkable "Predicted effect"; ship metrics record
  the harness fingerprint `git rev-parse HEAD:.claude` (#T224).
- Build pre-flight warns when the brief is newer than the design, or the design newer than
  the tasks (#T227).

### Security & correctness
- **Jev path retired** (Approver ruling, #T225) — `scripts/lib/decide.ts`,
  `scripts/lib/egress-guard.ts`, the Jev code in review-triage.ts, the settings `jev` block
  and the egress-allowlist entry. The local heuristic triage table stays.
- **review-triage.ts** parses indented reports (#T206), re-scans its scrubbed staging file
  and withholds every row on any finding, and redacts sensitive `key=value` pairs.
- **security-scanner `scrub`** writes through an exclusive random temp file (#T232),
  re-scans up to five passes, and exits 1 on any read/write/rename failure or leftover
  finding.
- **compaction-metrics.ts** keeps back-to-back compactions in the cycle table (#T231).
- **new-project-smoke** — three `git log | grep -q` assertions raced SIGPIPE under
  `pipefail`; they now use `git log --grep`.

### Migration
- **Deleted paths** — remove from downstream projects if present:
  `.claude/commands/tools/kv.md`, `docs/knowledge/kv.md`, `templates/knowledge/kv.md`,
  `scripts/context-filter.sh`, `scripts/lib/decide.ts`, `scripts/lib/egress-guard.ts`,
  `docs/proposals/pre-tool-approve-hook.md`.
- **settings.json** — drop `project_os.parallel` and `project_os.jev`; add
  `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `worktree.baseRef: "head"`. If the update
  conflicts and `baseRef` is not `"head"`, worker worktrees branch from the default branch
  instead of your HEAD (pre-flight detection is #T237).
- **Agent files** — custom agents added under `.claude/agents/` must set
  `omitClaudeMd: true` or `tests/agent-roster.test.ts` fails.
- Agent-definition changes take effect only in new sessions.

### Known gaps
- **SC6, model-switch logging** — the `PostModelSwitch` hook is wired and tested, but
  whether it fires on a `fallbackModel` fallback is unverified (#T203).
- **Always-loaded budget** — CLAUDE.md (~2.6k tokens) and `lead.md` (~3.3k) are over the
  2,500-token budget; the finding reports it.
- **Deferred to drafts** — #T229, #T233–#T240 (ship-gate follow-ups: `bashEditDiff` scope on
  merges, baseRef pre-flight, `$CLAUDE_PROJECT_DIR` hook paths, `(cd * && *)` allow rules,
  `grep -q` under `pipefail`).

---

## v2.3 — 2026-07-25 — template portability + scanner correctness

Nine defects found by running a real project through a full clone → `/tools:init` →
idea → design → plan cycle, plus two more surfaced while verifying the fixes.

### Template content leakage (the headline)
- **New `templates/` seed tier.** `new-project.sh` seeded projects by copying this
  repo's LIVE `docs/knowledge/*.md` and `.claude/rules/preferences.md`. Since
  `CLAUDE.md` does `@import docs/knowledge/architecture.md`, every clone loaded ~190
  lines about Project OS's own hook chain as *its* architecture. `/tools:init` was
  structurally blind to it — it discovers work by scanning for `[ALL_CAPS]` tokens and
  the leaked content is prose. Destination paths are unchanged, so the manifest and
  update path keep their hard-coded lists.
- **Retro-detection for existing clones** — write-once `seed_hashes` manifest block plus
  an `unlocalized-template-content` system-map readiness finding. `files` could not be
  the baseline: `update-project.sh` regenerates it from local content after every
  update, which would make the check silently vacuous.
- **Seeds leave the update set** — `docs/knowledge/*.md` and `preferences.md` are
  one-time content; updates no longer offer to overwrite a project's real knowledge.
- **Five referenced-but-never-copied docs now ship** (`roadmap-format.md`,
  `windows-bash-scanner.md`, `design-principles.md`, `pre-tool-approve-hook.md`,
  `product.md`/`tech.md`) — previously dangling references in every clone.

### Secret scanner (was substantially inert)
- **Rules module was a syntax error on Node 22** — inline regex modifiers `(?i:…)`/`(?s:.)`
  need Node ≥ 23 while `engines` declares ≥ 22.18. Hook install died, so affected projects
  had **no pre-commit scan and no system-map heal** while reporting only a WARN.
- **Entropy bar was unreachable for short tokens** — capped at log2(N), so any token ≤ 22
  chars could never clear 4.5 bits. `aws-access-token` (CRITICAL) had a 100% miss rate.
  Bar is now `min(configured, log2(len) × 0.9)`.
- **21 of 24 `regex: null` rules restored**, anchored on documented vendor prefixes.
- **22 unreachable entropy gates disabled** where the token alphabet provably cannot
  clear the bar (hex caps at 4.09 bits), including `databricks-api-token` (CRITICAL).
- **pre-push hook survives a first push** — guarded on `origin/$BRANCH` existing, with a
  full tracked-file scan as fallback. It previously failed on a git error and steered
  users to `--no-verify` exactly when a repo first became remote.

### Workflow & init
- **Feature slugs** — `/workflows:idea` derives and confirms a ≤40-char slug before
  creating paths; design/plan/approve inherit it. Fixes 150-char spec directories and
  `MAX_PATH` pressure on Windows.
- **Toolchain permissions** — init writes per-subcommand `permissions.allow` entries from
  the detected stack, so the first `npm install` in `/workflows:build` no longer silently
  hangs a sub-agent.
- **`docs/specs` tracking is now an explicit question** rather than a silent ignore rule.
- **init ends with a verification step** that asserts, instead of a summary that reports.
- **bash rules** — `/tmp/` dropped from guidance (Write tool and Git Bash resolve it
  differently on Windows); init no longer uses a `/tmp` heredoc.

### Tests
207 → 319 node tests. `tests/new-project-smoke.sh` went from 35 pre-existing failures to
0 (174 assertions) — the clone path had never been green on the declared minimum Node.

---

## v2.4-dev — audit remediation (never released separately; ships in v3.0)

Remediation of the 2026-07-11 repo staleness audit (`docs/audits/2026-07-11-staleness-audit.md`), tasks T17–T32 on branch `claude/repo-staleness-audit-zbnon0`.

### Claude Code changelog alignment (2026-09-12, CLI 2.1.221 → 2.1.269)
- **Native Task tools restored on Claude 5-era leads** — `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`
  in the shipped `settings.json` `env` and both settings scaffolds. Claude Code 2.1.233
  (2026-08-14) withheld `TaskCreate`/`TaskUpdate`/`TaskList` on Opus 4.8 / Sonnet 5 / Fable 5,
  so `/workflows:build` had been on its silent ROADMAP-marker fallback for a month. Pre-flight
  step 7 now announces the fallback when the tools are missing.
- **SessionEnd hook timeout** — explicit `timeout: 30`; before 2.1.268 a SessionEnd hook with no
  per-hook timeout was cancelled at 1.5s, which `session-end-cleanup.sh` (six `find`s + three
  log rotations) likely exceeded on Windows.
- **Doc corrections** — the 350k Fable compaction window has no source (docs: native 1M,
  plan-dependent; runtime caps the window at the model's real size); `effort:` frontmatter on
  Fable was inert until 2.1.267; worktree self-grounding pattern records its dependency on the
  2.1.222+ isolation model.
- **Compaction window policy decided (2026-09-16, #T198)** — `350000` stays, reframed as an
  early-compaction budget cap ("never above the smallest real window in the model chain").
  Evidence: a live Fable session at ~245k context, i.e. this plan runs the 1M window.
  `CLAUDE_CODE_DISABLE_1M_CONTEXT` rejected; the PostModelSwitch window hook (#T197) retired as
  unnecessary. `init.md` / `set-models.md` scaffolds reworded to the rule.
- **bash.md Core Rule 7** — change files with Write/Edit only; `sed -i`, heredocs and `>` bypass
  the format, secret-scrub and handoff-claim hooks silently (#T199; hook extension is #T202).
- **windows-bash-scanner.md cross-check table** — eight triggers mapped to the 2.1.221–2.1.269
  permission-checker changes with likely status; nothing deleted without default-mode
  re-verification (#T200).
- **Test** — `context_nudge_isValidJson` in `tests/compaction-hooks.sh` (#T201).

### Model Routing (Claude 5 lineup)
- **settings.json** — sub-agent model → `claude-sonnet-5`; hook matchers drop removed `MultiEdit` tool
- **Tier tables & escalation ladder** — `/tools:set-models`, `/tools:init`, and `escalation.md` updated to Haiku 4.5 → Sonnet 5 → Opus 4.8 → Fable 5; inert `CLAUDE_ORCHESTRATION_MODEL` / `models.env` mechanism removed
- **Docs sweep** — resolved the long-standing Haiku-vs-Sonnet sub-agent contradiction across CLAUDE.md, README, guide, design-principles

### Native Primitives Migration
- **Build/ship on native worktrees + Task scheduling** — native Task dependencies (`addBlockedBy`) replace manual wave computation; native worktree lifecycle replaces the copy-out recovery dance; ROADMAP.md remains the governance record
- **Adapter layer collapsed** — default dispatch is now the native Task tool; `claude-code.sh` (no-op), `aider.sh`, `amp.sh`, `gemini.sh` (dead stubs) deleted; `codex.sh` kept as the only external adapter, documented as running without worktree isolation
- **`scripts/unblocked-tasks.sh`, `preserve-sessions.sh`, `sync-agent-rules.sh` retired** — superseded by native Tasks, native worktrees, and skills frontmatter
- **Skills frontmatter** — all SKILL.md files gain YAML `name:`/`description:` frontmatter

### Security & Correctness
- **MCP output validation actually works** — exit-code 2 / `additionalContext` JSON so alerts reach the model; dead `set -e` branch fixed; absolute allowlist path; no in-place mutation of tool output
- **Permissions scoped** — blanket `Bash(git *)`-style allows replaced with specific subcommand grants (restrictive-allow posture)

### Runtime & Hygiene
- **package.json** — engines pin + `node --test` script; Node-version guard added to TS hooks
- **Log rotation + SessionEnd cleanup** — new `.claude/hooks/session-end-cleanup.sh`; per-session tool-count files and append-only logs no longer grow unbounded
- **bash.md slimmed** — Windows scanner-workaround catalog moved to `docs/knowledge/windows-bash-scanner.md`; auto-approval hook written up as `docs/proposals/pre-tool-approve-hook.md` (awaiting owner installation)
- **Status docs reconciled** — this changelog, PROJECT_STATUS, vault frontmatter dates, guide adapter/file-tree sections (T31)

---

## v2.2 — 2026-04-05

Work spanning 2026-03-03 → 2026-04-08 (released as v2.2 with the security-scanner ship; web-fetch landed immediately after).

### Context Filtering & Knowledge Index
- **FTS5 knowledge index** — `scripts/knowledge-index.ts` on `node:sqlite` (zero deps), freshness tracking with `[STALE]` marking
- **Context filter** — `scripts/context-filter.sh` + `context-filter` skill route large outputs through intent-based filtering

### Workflow & Tooling
- **`/workflows:mvp`** — fast-path orchestrator (idea → ship with aggressive auto-approval)
- **Codex review flow** — `scripts/codex-review.sh` wrapper for friction-free external reviews
- **Self-update system** — `scripts/update-project.sh` + `generate-manifest.sh` + `.claude/manifest.json`

### Adaptive Memory (2026-03-25/26)
- **Observation parser** — `scripts/observation-parser.ts`, 5 typed facts with sensitive-key denylist
- **Recency-weighted search** — composite FTS5 + access-pattern scoring with configurable half-life
- **Auto-checkpoint** — `.claude/hooks/pre-compact.sh` PreCompact hook (10-min debounce)
- T9 (tests + docs) left in progress at release

### Security Scanner (2026-04-03 → 04-05)
- **Zero-dep secret scanner** — `scripts/security-scanner.ts` + `scripts/lib/scan-rules.js` (233 rules: 219 gitleaks-ported, 14 custom PII/privacy; Shannon entropy detection)
- **Defense-in-depth hook chain** — pre-commit (scan-staged) → pre-push (scan-diff) → ship workflow step 1.5
- **Hook installer + allowlist** — `scripts/install-hooks.sh`, `.claude/security/allowlist.json`, inline `// scan:allow`

### Web-Fetch MCP Server (built, then extracted)
- **Hand-rolled JSON-RPC 2.0 stdio MCP server** — zero-dep HTML extractor + Markdown converter (95% avg token reduction), 8-stage prompt-injection sanitizer, SSRF-hardened fetch pipeline, SQLite+filesystem LRU cache (built 2026-04-06/07, commits `cb2ae5c`..`c9b4e1f`)
- **Extracted to standalone repo** — commit `d2f7cec` (2026-04-08); the server has no dependency on Project OS internals. Metrics retained in `docs/knowledge/metrics.md` for the record

---

## v2.1 — 2026-02-24

### Strategic Repositioning
- **"Governance layer" framing** — identity reframed from "spec-driven scaffold" to "solo-developer governance layer for AI-driven development" across README, CLAUDE.md, design-principles.md, architecture.md, and the guide (ADR in `docs/knowledge/decisions.md`, 2026-02-24)
- **`Role:` identity field** — added to CLAUDE.md Identity block (fallback path: `Type:` matched 9 files repo-wide, so a new field was added instead of replacing)

### Native Foundations & Dashboard
- **native-foundations** — 11 tasks hardening the system on Claude Code native primitives (see `docs/knowledge/metrics.md`)
- **Live dashboard** — `scripts/dashboard-server.ts` (SSE + htmx, port 3400) with `/api/status`, `/api/dag` (Mermaid), `/api/activity` endpoints

---

## v2.0 — 2026-02-23

### Parallel Execution
- **Wave-based build orchestrator** — tasks organized into dependency waves, dispatched via `isolation: worktree` sub-agents with `max_concurrent_agents` throttling
- **DAG dependency tracking** — `scripts/unblocked-tasks.sh` parses ROADMAP.md and outputs unblocked tasks as JSON; `scripts/validate-roadmap.sh` detects cycles, dangling refs, and state inconsistencies
- **New ROADMAP.md format** — 7 task markers (`[?]` Draft, `[ ]` Todo, `[-]` In Progress, `[~]` Review, `[>]` Competing, `[x]` Done, `[!]` Blocked), `#TN` task IDs, inline `(depends: #T1, #T2)` syntax

### Governance
- **`/pm:approve` command** — governance gate that promotes `[?]` draft tasks to `[ ]` approved
- **Role definitions** — Architect, Developer, Reviewer, Orchestrator with advisory permissions (`.claude/agents/roles.md`)
- **Phase handoff contracts** — explicit artifact requirements between workflow phases (`.claude/agents/handoffs.md`)
- **`/workflows:plan` updated** — outputs `[?]` drafts with `#TN` IDs and dependency syntax

### Competitive Implementation
- **`/workflows:compete`** — spawn N parallel implementations with different strategies (literal/minimal/extensible)
- **`/workflows:compete-review`** — side-by-side scoring across 6 quality axes, unified comparison matrix

### Observability & Shipping
- **Activity logging** — JSONL event log via `.claude/hooks/log-activity.sh` with 13 event types
- **`/tools:metrics`** — query activity logs with 4 views: summary, feature detail, slow tasks, compare
- **`/tools:dashboard`** — cross-project status dashboard scanning all Project OS projects
- **`scripts/create-pr.sh`** — auto-generated PR descriptions from specs, review status, and commit history
- **`/workflows:ship` updated** — PR generation, session preservation, metrics snapshot, activity logging
- **Desktop notifications** — `.claude/hooks/notify-phase-change.sh` for phase transitions (Linux/macOS/Windows)

### Agent Adapters
- **Adapter interface** — uniform 3-command contract (info/health/execute) for multi-agent dispatch (`.claude/agents/adapters/INTERFACE.md`)
- **Claude Code adapter** — default adapter (prepares prompts for orchestrator dispatch via Task tool)
- **Stub adapters** — Codex, Gemini, Aider, Amp (v2.1+ for actual dispatch)
- **`(agent: <name>)` annotation** — per-task agent routing in ROADMAP.md
- **`--agent` filter** — `scripts/unblocked-tasks.sh --agent codex` filters by agent

### Infrastructure
- **Agent frontmatter** — all 6 agents have `isolation`, `role`, and `permissions` YAML frontmatter
- **Session preservation** — `.claude/hooks/preserve-sessions.sh` saves worktree sessions before cleanup
- **Parallel config** — `.claude/settings.json` gains `project_os.parallel`, `compete`, `adapters`, `dashboard` config blocks
- **Workflow instrumentation** — build and review commands emit activity log events

### Quality & Security (pre-release hardening)
- **Script bug fixes** — `unblocked-tasks.sh`: `|| [ -n "$line" ]` EOF fix, duplicate-ID bypass closed via `seen_pass2` before marker filter; `validate-roadmap.sh`: same EOF fix, `continue` after duplicate to prevent state overwrite
- **Dashboard fix** — `dashboard.sh`: detached HEAD detection uses `${branch:-detached}` (git exits 0 with empty string, not non-zero)
- **Notify fix** — `notify-phase-change.sh`: review-failed message conditional on `$EXTRA` presence
- **Workflow quoting** — `review.md`, `ship.md`, `build.md`: `"$ARGUMENTS"` quoted in all shell examples
- **ROADMAP section name** — `ship.md`: "Completed" → "Done" to match format spec
- **Path traversal** — `new-project.sh`: reject `..` in PROJECT_PATH; all adapters: reject `..` in output_dir
- **TOCTOU fix** — `preserve-sessions.sh`: copy_sessions() receives `$resolved_path`, not raw `$1`

### Documentation
- **README.md** — updated command table, project structure, ROADMAP format section, new tips
- **CLAUDE.md** — added ROADMAP format spec, roles section, agent adapter syntax, updated workflow
- **CLAUDE.template.md** — updated for v2 bootstrapping
- **`docs/knowledge/metrics.md`** — per-feature metrics template

### Component Count
- 8 workflow commands (was 6)
- 8 tool commands (was 6)
- 4 PM commands (was 3)
- 6 agent definitions + 2 governance docs (`roles.md`, `handoffs.md`)
- 5 adapter scripts (new)
- 8 hooks (was 5)
- 8 utility scripts (was 4)
- **49 total components**

---

## v1.0

Initial release. Spec-driven development scaffold with 6-phase workflow, memory system, sub-agent orchestration, quality gates, and session handoffs.
