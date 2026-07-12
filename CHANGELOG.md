# Changelog

## Unreleased (v2.3-dev) — audit remediation

Remediation of the 2026-07-11 repo staleness audit (`docs/audits/2026-07-11-staleness-audit.md`), tasks T17–T32 on branch `claude/repo-staleness-audit-zbnon0`.

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
