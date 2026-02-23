# Changelog

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
