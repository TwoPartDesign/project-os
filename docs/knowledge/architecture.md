---
type: knowledge
tags: [architecture, system-design]
description: Living system architecture documentation
links: "[[decisions]], [[patterns]]"
date: "2026-07-16"
---

# System Architecture

## High-Level Structure

Project OS is a solo-developer governance layer for AI-driven development, built on bash + markdown.
It preserves human authority through three mechanisms:
- **Phase checkpoints** — explicit human approval required at idea→design, plan→build (pm:approve), and build→ship
- **Quality gates** — adversarial review (3 isolated reviewers) before any feature reaches main
- **Audit trail** — ROADMAP.md state machine + JSONL activity log capture every decision

```
User ──→ Workflow Commands ──→ Orchestrator ──→ Sub-agents (isolated worktrees)
              │                     │                    │
              ▼                     ▼                    ▼
         ROADMAP.md           Adapter Layer         Task Output
        (authority)         (codex, external only) (completion reports)
              │                     │
              ▼                     ▼
         Native Tasks          Activity Logs
        (runtime state)      (.claude/logs/)
```

## Module Map

| Module | Path | Purpose |
|--------|------|---------|
| Workflow commands | `.claude/commands/workflows/` | Spec-driven dev lifecycle (idea→design→plan→build→review→ship, mvp, compete, rebuild) |
| Tool commands | `.claude/commands/tools/` | Utility tools (dashboard, commit, handoff, catchup, research, metrics, kv, init, set-models, update, new-project) |
| PM commands | `.claude/commands/pm/` | Governance (prd, epic, approve, status) |
| Agent adapters | `.claude/agents/adapters/` | External-agent dispatch only — `codex.sh` (+ `INTERFACE.md`, `_prompt-template.sh`); default path is native Task-tool dispatch |
| Hooks | `.claude/hooks/` | Event-driven automation (11 files, see below) |
| Scripts | `scripts/` | Standalone utilities (see below) |
| Knowledge base | `docs/knowledge/` | Patterns, decisions, bugs, architecture, metrics, design-principles, roadmap-format, windows-bash-scanner, kv |
| Specs | `docs/specs/<feature>/` | Per-feature lifecycle docs (design, tasks, review) |

### Hooks (`.claude/hooks/`)

| Hook | Purpose |
|------|---------|
| `_common.sh` | Shared utilities: path resolution, validation, JSON extraction |
| `compact-suggest.sh` | PostToolUse — when the transcript's newest `usage` record, plus a byte-proxy estimate of the tool result that just landed, puts context past `NUDGE_PCT` of the window (default 60%), inject `additionalContext` telling Claude to run `/tools:handoff` with a `compact_instruction`; one nudge per compaction cycle. Records are read structurally, not textually: each is reduced to a brace/bracket skeleton, so `type:assistant` counts only at the record's own depth and only a `message.usage` object is measured — a `usage` buried in a tool payload cannot be mistaken for the session's context. Deferred entirely when the payload's `agent_id` differs from its `session_id` (a sub-agent firing), because `additionalContext` lands in the *calling* agent's context and a sub-agent can neither write a handoff nor be compacted; a payload with no `agent_id` at all falls back to deferring on a sidechain transcript tail. **Also registered on PreToolUse** for `Write\|Edit\|MultiEdit\|NotebookEdit`, where it records handoff authorship and stops — never emitting, since PreToolUse is the one event where a hook can deny the tool call. A write to `.claude/sessions/handoff-*.yaml` is appended to `.compact-handoff-<session_id>` (one path per line, so a session that writes several in a cycle claims all of them) so `pre-compact.sh` can tell this session's handoffs from a concurrent session's; claiming before the write means the claim can never trail the artifact it describes, and the PostToolUse pass repeats the claim as a backstop, collapsing against the last line |
| `log-activity.sh` | Append structured JSONL events to the activity log |
| `notify-phase-change.sh` | Terminal/desktop notification on phase transitions |
| `output-index.sh` | PostToolUse advisory — index large tool outputs, hint via additionalContext |
| `post-mcp-validate.sh` | PostToolUse — validate Context7 MCP output (exit 2 / additionalContext contract) |
| `post-tool-use.sh` | Auto-format files after Write/Edit |
| `post-write-session.sh` | Scrub secrets from `.claude/sessions/` files after write |
| `pre-compact.sh` | PreCompact (`*` — auto and manual) — print the `compact_instruction` of the newest handoff written since the last compaction on stdout, which the runtime forwards to the compaction summarizer; also writes a filesystem-derived checkpoint YAML (10-min debounce), opens the next compaction cycle and re-arms the nudge. Advisory: never blocks |
| `session-start-setup.sh` | SessionStart — idempotent activation fallback: runs `setup.sh --check` so a cloned project installs its git hooks on first session |
| `session-start-maintain.sh` | SessionStart — auto-runs the maintenance loop once per `auto_run_hours` (policy, default 24h); drafts-only, debounced on ledger age, skips worktrees |
| `session-end-cleanup.sh` | SessionEnd — remove per-session counters and the session-private compaction markers (`.compact-base-*`, `.compact-nudged-*`, `.compact-cycle-*`); deliberately **keeps** `.compact-handoff-*`, the one marker concurrent sessions read, and lets the 7-day prune collect it; rotate append-only logs |
| `tool-failure-log.sh` | Log tool failures (timestamp + tool name only) |

### Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `audit-context.sh` | Estimate token cost of always-loaded context |
| `codex-review.sh` | Run a Codex code review via stdin piping |
| `context-filter.sh` | Intent-based filtering/indexing for large content |
| `create-pr.sh` | Generate a PR with AI-assisted description (gh CLI) |
| `dashboard.sh` / `dashboard-server.ts` | Cross-project status table / live SSE dashboard (port 3400) |
| `detect-stack.ts` | Deterministic stack detection (language/package manager/framework/test runner/formatter/database) from manifest + lockfile signals; JSON out, read-only, no repo code executed |
| `dream-accept.sh` | Accept a staged `/tools:dream` proposal: backup → swap → rebuild index → cleanup |
| `generate-manifest.sh` | Create `.claude/manifest.json` with sha256 hashes for update tracking |
| `install-global-commands.sh` | Install `/tools:new-project` globally |
| `install-hooks.sh` | Install git pre-commit/pre-push security-scanner hooks |
| `knowledge-index.ts` | FTS5 knowledge indexing and search (`node:sqlite`) |
| `lib/json.sh` / `lib/scan-rules.js` | Shared JSON helpers / scanner rule database (233 rules) |
| `lib/policy.ts` | Shared reader for `.claude/maintenance-policy.yaml` — flat `key: value` parsing kept in lockstep with `maintain.sh`'s `policy_raw_value` and `system-map.ts`'s `loadBloatThreshold` (no YAML library, linear-parse mandate) |
| `lib/skill-apply-lib.ts` | Pure proposal parser + anchored-op core for the skill-optimization loop — parses `## Run:`/`### Proposal N:` sections out of a skill-edit proposal doc and applies an anchored add/delete/replace to target-file content; no fs/git access |
| `lib/system-map-lib.ts` | Extractors + graph builder + readiness scoring for the system map |
| `maintain-draft.ts` | File a fingerprinted `[?]` draft into ROADMAP.md's maintenance-inbox section |
| `maintain.sh` | Deterministic maintenance loop — checks, drafts, ledger; never mutates canonical state |
| `memory-search.sh` | Full-text search across knowledge files |
| `setup.sh` | Idempotent project activation — installs git hooks + generates the initial map; run by new-project.sh, the SessionStart hook, and once per clone; `--adopt` runs hook install in quarantine mode (`--no-chain`) for in-place adoption targets |
| `lib/project-root.ts` | Shared project-root resolution (imported by knowledge-index/system-map/maintain-draft) |
| `new-project.sh` | Bootstrap a new Project OS project, or adopt Project OS in place into a pre-existing repo via `--adopt <target-dir>` (two-class collision policy, orphan quarantine, `--dry-run` plan preview) |
| `observation-parser.ts` | Extract 5 typed observations from tool output (sensitive-key denylist) |
| `scrub-secrets.sh` | Scrub secret patterns from a file (delegates to scanner) |
| `security-scanner.ts` | Zero-dep secrets/PII scanner (8 subcommands) |
| `skill-apply.ts` | Anchored apply engine for skill-edit proposals — standard tier via `/pm:approve`, plus a narrow `--auto` tier gated by six deterministic conditions (policy flag, delete/replace only, `.claude/commands/`/`.claude/skills/` containment, non-increasing size, live `system-map.ts` dangling-ref evidence, edit-content correspondence) |
| `skill-ledger.ts` | Sole sanitizing writer for `docs/knowledge/skill-edit-rejections.md` — one entry per rejected skill-edit proposal (fingerprint, summary, reason), fixed-string dedup, atomic write |
| `sync-hooks.sh` | Sync hooks from the template to a target project |
| `system-map.ts` | Generate/check/report the framework wiring map (`docs/maps/`) |
| `update-project.sh` | Check for and apply Project OS updates from upstream; `--local-upstream <dir>` sources the template from a local directory instead of a `gh` release, for offline updates and offline testing of the classification loop |
| `validate-freshness.sh` | Wrapper for knowledge-index freshness validation |
| `validate-roadmap.sh` | Validate ROADMAP.md format, deps, cycles, consistency |

## Data Flow

### Build Phase
```
ROADMAP.md ──parse──→ Native Tasks (addBlockedBy) ──dispatch──→ Sub-agents (worktree isolation)
     │                      │                                        │
     ▼                      ▼                                        ▼
Governance record     Dispatch Resolution                   Completion Reports
(markers win)      (model→agent→native default)              (per-task output)
     │                                                               │
     └──────────── Batch-Drain Consistency Check ◄───────────────────┘
```

### Dispatch Resolution (3-step)
0. `(model: <model>)` annotation → native Task-tool dispatch with that model
1. `(agent: codex)` annotation → external adapter (if healthy, else native)
2. Default → native Task-tool dispatch with sub-agent default model (settings.json)

### Dashboard (optional)
```
ROADMAP.md ──fs.watch──→ dashboard-server.ts ──SSE──→ Browser
activity.jsonl ─────────────┘         │
                                      ├── /api/status (HTML)
                                      ├── /api/dag (Mermaid)
                                      ├── /api/activity (HTML)
                                      ├── /api/kanban (HTML — Board tab, columns per lifecycle marker)
                                      └── /api/status.json (JSON)
```

## Context Filtering &amp; Knowledge Index

Project OS includes an FTS5-based knowledge index for efficient context management:

- **Index engine**: `scripts/knowledge-index.ts` — uses `node:sqlite` FTS5 (Node 22.16+, zero deps)
- **Subcommands**: `index`, `index-vault`, `index-observations`, `search`, `rebuild`, `stats`, `stale`, `config`
- **Observation parser**: `scripts/observation-parser.ts` — extracts 5 typed facts (error-pattern, file-relationship, config-key, function-sig, dependency-chain) with sensitive key denylist; unit-tested in `tests/observation-parser.test.ts` (31 tests), including a dedicated secret-denylist guard test
- **Filter script**: `scripts/context-filter.sh` — routes large outputs through intent-based filtering
- **Advisory hook**: `.claude/hooks/output-index.sh` — indexes large tool outputs and persists extracted observations to `observation_meta` table
- **Auto-checkpoint hook**: `.claude/hooks/pre-compact.sh` — PreCompact hook auto-saves session state before context compaction (10-min debounce)
- **SKILL**: `.claude/skills/context-filter/SKILL.md` — teaches proactive routing for large content

### Compaction Handoff Chain

Auto-compaction fires at 75% of the context window (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75`;
the threshold is inert unless `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is also set, which
activates the proactive trigger path). Compaction is not something a hook can usefully
stop, so the chain steers it instead — three stages, two of them hooks:

1. **`compact-suggest.sh` (PostToolUse)** — measures the current context size from
   the transcript's newest non-sidechain `usage` record
   (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`) and,
   once it passes `PROJECT_OS_COMPACT_NUDGE_PCT` of the window (default
   `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE − 15`, i.e. 60%), injects
   `hookSpecificOutput.additionalContext` into Claude's context: *write the handoff
   now, with a `compact_instruction`*. One nudge per cycle, tracked by
   `.claude/logs/.compact-nudged-<session_id>`. Transcript-byte growth
   (`PROJECT_OS_COMPACT_NUDGE_BYTES`) is a fallback for when no `usage` record
   parses — it is not the primary signal, because the transcript retains discarded
   history and so diverges from real context after every compaction. The scan reads
   the `message.usage` key of a `type:assistant` record, identified by nesting
   depth rather than by position or by a substring test. A record serializes
   `message.content` before `message.usage`, so taking the first `"usage":` key
   would measure a `tool_use` input that carried one; and because `toolUseResult`
   holds unescaped nested JSON, a whole-line search for the record type matches
   tool payloads too, which could supply a number from outside the session
   entirely. The scan therefore reduces each record to a brace/bracket skeleton
   and accepts the type key only at the record's own depth and the `usage` key
   only one level inside `message`. A record whose only `usage` object lives
   deeper is skipped rather than measured. Whatever the scan reports is then
   topped up by `${#INPUT} / 4` for the tool result that just landed: PostToolUse
   fires before the model's next request, so the newest `usage` record describes
   the request that *asked for* the tool and the result itself is unmeasured for
   one more turn — long enough for a single large read to cross the whole gap
   between the nudge line and the compaction line. That top-up is a proxy and
   runs short by design (4 bytes/token under-estimates JSON and code), so it
   narrows the gap without ever inflating it. The tail window escalates 60 → 600
   → 4000 lines, widening only when
   the cheap read comes up empty: a fixed 60 assumed a `usage`-bearing record was
   always near the end, which a long run of tool-result records — none of which
   carries a `usage` object at all — pushes out of reach, silently dropping the
   hook to the byte proxy. Delivery is gated separately from measurement:
   `additionalContext` reaches whichever agent made the tool call, so a nudge
   raised during a sub-agent's run lands on an agent that cannot write a handoff
   and will not be compacted, while still spending the one nudge the main thread
   was owed. The gate compares the payload's `agent_id` against its `session_id`
   — the main thread's tool-use context carries `agentId == <session id>`, a
   sub-agent a distinct one — and exits on a mismatch, before the byte fallback,
   without writing the marker. Preferred over `agent_type == "main"` because that
   default is configurable in the CLI, so the literal string is not guaranteed.
   A payload carrying no `agent_id` at all (an older CLI) falls back to the
   transcript tail: newest `usage`-bearing record is a sidechain one → defer.
   That inference is strictly weaker, since it cannot separate a sub-agent's own
   call from the main thread's `PostToolUse` for the *completed* `Task`, and
   dropping the latter can lose the cycle's nudge outright. Independently
   of the nudge — before the once-per-cycle exit, because the handoff is written
   *after* the nudge asks for it — every call checks `tool_input.file_path` on a
   **write** payload (`Write`, `Edit`, `MultiEdit`, `NotebookEdit` — `Read`
   carries the same field, so an ungated branch made `/tools:catchup` claim the
   handoff it was reading) against
   `*/.claude/sessions/handoff-*.yaml` and appends a match to
   `.claude/logs/.compact-handoff-<session_id>`. This hook's payload is the only
   place the session id and the written path appear together, so it is the only
   component that can attribute a handoff to its author. The record is append-only
   because a session can write several handoffs in one cycle; keeping only the
   newest would leave the earlier ones looking unattributed to a concurrent
   session. Repeated writes to the same path collapse against the last line.
   The same hook is registered on **PreToolUse** for those four tools as well,
   and on that path it records the claim and exits immediately — no measurement,
   no output. Claiming after the write leaves a window in which the file exists
   and belongs to nobody, and a concurrent session compacting inside it forwards
   a `compact_instruction` written for someone else's task; claiming first
   removes the window rather than narrowing it, and the PostToolUse pass remains
   as a backstop for a write this session did not see the start of. Printing
   nothing on the PreToolUse path is deliberate: it is the one event where a hook
   can deny a tool call, and an advisory hook must never be able to block a
   write.
2. **Claude runs `/tools:handoff`** — the only stage that can author decisions and
   rationale, because only the model has them. The hooks cannot.
3. **`pre-compact.sh` (PreCompact, matcher `*`)** — reads this session's handoff:
   the last line of `.compact-handoff-<session_id>` naming a file newer than the
   cycle marker, else the newest *unclaimed* `handoff-*.yaml` written since the
   last compaction (`-newer .claude/logs/.compact-cycle-<session_id>`; a 30-minute
   window bootstraps a session's first compaction — on **both** branches, since
   the claim now outlives `SessionEnd` while the cycle marker does not, and an
   unwindowed owned branch would let a resumed session forward a handoff of any
   age). "Unclaimed" means no *other*
   session's `.compact-handoff-*` record names it on any line — that keeps the glob fallback
   from handing one session's instruction to another session's summarizer, while
   still forwarding a handoff written by some means this hook chain cannot see.
   Ownership can only distinguish handoffs that are distinct files, so
   `/tools:handoff` names them `handoff-YYYY-MM-DD-HHMMSS-<token>.yaml`: at the
   former minute granularity two sessions writing in the same minute produced one
   path, which no amount of claim tracking can disentangle. The token follows the
   full timestamp so byte order stays chronological, and the candidate `sort` is
   pinned to `LC_ALL=C` because a UTF-8 locale's weak punctuation collation would
   invert a legacy `-HHMM.yaml` against a later suffixed name.
   It then extracts the `compact_instruction` block scalar,
   and prints it on **stdout**. The runtime collects PreCompact stdout into
   `newCustomInstructions` and merges it into the compaction's custom instructions,
   so this text steers what the summarizer keeps. It also runs `system-map.ts
   check` read-only and appends a drift caveat, writes a filesystem-derived
   checkpoint (10-min debounce; its `modified_files` come from `git status
   --porcelain -z --untracked-files=all`, because the default collapses a wholly
   untracked directory to one `?? dir/` entry and a session that just built a new
   feature is the one with the most to preserve, and because without `-z` git
   C-quotes non-ASCII paths — `"caf\303\251.txt"` — whose octal escapes are
   illegal in a double-quoted YAML scalar and made the entire checkpoint
   unparseable), and opens the next cycle — touching the cycle
   marker (after discovery, never before) and clearing the nudged marker so stage 1
   can fire again.

Why `pre-compact.sh` does not block: exit 2 defers compaction, but on the auto path
the block reason reaches only a debug log and a fixed-string notification that omits
it — never Claude — so the gate would stall the session without saying why. See
`docs/knowledge/decisions.md` and `docs/specs/compaction-gate/design.md`. Behaviour
is pinned by `tests/compaction-hooks.sh`.

### Recency-Weighted Search

Search results use composite scoring that blends FTS5 text relevance with access patterns:
```
composite_score = (fts5_rank * 0.7 + log(access_count + 1) * 0.3) * recency_decay
recency_decay = 0.5 ^ ((now - last_accessed) / recency_halflife_days)
```
- `access_count` and `last_accessed` are tracked per source in `index_meta`
- `recency_halflife_days` defaults to 14 (configurable in `settings.json`)
- Use `--obs-type TYPE` to filter search by observation type (e.g., `--obs-type error-pattern`)

### Freshness System

Content freshness is tracked with three confidence levels:
- **high**: Has `date:` field in YAML frontmatter
- **medium**: Dated via git history
- **low**: Dated via file modification time only

Content older than 90 days without validation is marked `[STALE]` in search results.
Use `node scripts/knowledge-index.ts validate <source>` to reset the stale clock.

## Security Scanning

Defense-in-depth secret detection with three enforcement layers:

- **Scanner engine**: `scripts/security-scanner.ts` — zero-dep Node.js scanner with 8 subcommands (scan-files, scan-staged, scan-diff, scrub, list-rules, test-rules, test-pattern, install-hooks)
- **Rule database**: `scripts/lib/scan-rules.js` — 233 rules (219 ported from gitleaks@256f6479, 14 custom PII/privacy). ESM module, keyword pre-filter, Shannon entropy detection (threshold 4.5)
- **Allowlist**: `.claude/security/allowlist.json` — path ignores, rule disables, inline `// scan:allow` suppression, stopwords
- **Hook chain**: pre-commit (scan-staged) → pre-push (scan-diff) → ship workflow step 1.5 (scan-diff against base)
- **Scrub mode**: `scrub-secrets.sh` delegates to scanner's `scrub` subcommand (atomic temp+rename), with inline bash fallback when Node unavailable
- **Hook installer**: `scripts/install-hooks.sh` — validates rules, writes pre-commit and pre-push hooks to `.git/hooks/`

Shell safety: all git operations use `execFileSync("git", [args])` (no string templates). Path traversal guard on all user-supplied paths.

## Self-Maintenance

Five zero-npm-dep components, strict authority split: deterministic code heals generated artifacts; only `/pm:approve` and `/tools:dream-accept` mutate canonical state.

- **System map** (`system-map.ts` + `lib/system-map-lib.ts`) — wiring graph (hooks/commands/skills/scripts/libs) → `docs/maps/`, with readiness findings (orphans, unwired hooks, dangling refs, manifest gaps, bloat).
- **Pre-commit auto-heal** — hook runs `system-map.ts precommit` after `scan-staged`; on drift, regenerates from the git index (not the working tree), stages `docs/maps/`, re-scans it. Fails only on generator/scan error.
- **Dream pass** (`/tools:dream`, `/tools:dream-accept`) — stages consolidation under `docs/memory/.dream-output/`; accept backs up to `docs/memory/.archive/`, swaps in, rebuilds the index.
- **Maintenance loop** (`maintain.sh` + `maintain-draft.ts`) — LLM-free; runs map / staleness / failures / consolidation / search-miss checks (the last driven by `knowledge-index.ts` search-log instrumentation at `.claude/logs/search-log.jsonl`), files fingerprinted `[?]` drafts + a ledger line. Reads `.claude/maintenance-policy.yaml`, never writes it.
- **Reflection loop** (`/tools:reflect` + `skill-apply.ts` + `skill-ledger.ts`) — three triggers fire it: `/workflows:ship`'s Post-Ship step 6, a `/workflows:review` gate-FAIL, and both `/workflows:rebuild` modes (logging a `rebuild-triggered` activity event). `/tools:reflect` scopes to the feature's in-play instruction files, reads trigger-specific evidence, loads negative feedback from `docs/knowledge/skill-edit-rejections.md` (in-scope entries + the 10 most recent, capped to bound injection) plus `maint-fp: skill-edit:` lines in ROADMAP.md, and emits at most 3 bounded, anchored, evidence-backed proposals to `docs/specs/<feature>/skill-edits.md` — "0 proposals" is a legitimate outcome, never padded to fill the budget. Every proposal files as a `[?]` draft through `maintain-draft.ts`, gated by `/pm:approve` (which displays the proposal text and, on approval, runs a staged apply via `skill-apply.ts`; on rejection, records the reason via `skill-ledger.ts` and retires the draft in place). The only autonomy exception is a narrow `--auto` tier in `skill-apply.ts`, restricted to the dead-reference-fix class and gated by the `skill_auto_apply` policy flag (default off): each of its six conditions is checked against live platform state, never the proposal's own claims, and a successful auto-apply still lands as a separate, individually revertible commit carrying the full proposal block in the commit body, plus a retroactive `[?]` acknowledgement draft through the normal `/pm:approve` gate. Everything outside that class stays draft-only.

Locations: `docs/maps/`, `.claude/maintenance-policy.yaml`, `.claude/logs/maintenance-ledger.jsonl` (rotated, gitignored), `docs/knowledge/skill-edit-rejections.md`.

---

<!-- This file is read by /workflows:design to ensure new features align -->
