---
type: knowledge
tags: [architecture, system-design]
description: Living system architecture documentation
links: "[[decisions]], [[patterns]]"
date: "2026-07-12"
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
| `compact-suggest.sh` | PostToolUse — warn when tool-call count suggests context is filling |
| `log-activity.sh` | Append structured JSONL events to the activity log |
| `notify-phase-change.sh` | Terminal/desktop notification on phase transitions |
| `output-index.sh` | PostToolUse advisory — index large tool outputs, hint via additionalContext |
| `post-mcp-validate.sh` | PostToolUse — validate Context7 MCP output (exit 2 / additionalContext contract) |
| `post-tool-use.sh` | Auto-format files after Write/Edit |
| `post-write-session.sh` | Scrub secrets from `.claude/sessions/` files after write |
| `pre-compact.sh` | PreCompact — auto-generate session handoff YAML (10-min debounce) |
| `session-end-cleanup.sh` | SessionEnd — remove per-session counters, rotate append-only logs |
| `tool-failure-log.sh` | Log tool failures (timestamp + tool name only) |

### Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `audit-context.sh` | Estimate token cost of always-loaded context |
| `codex-review.sh` | Run a Codex code review via stdin piping |
| `context-filter.sh` | Intent-based filtering/indexing for large content |
| `create-pr.sh` | Generate a PR with AI-assisted description (gh CLI) |
| `dashboard.sh` / `dashboard-server.ts` | Cross-project status table / live SSE dashboard (port 3400) |
| `generate-manifest.sh` | Create `.claude/manifest.json` with sha256 hashes for update tracking |
| `install-global-commands.sh` | Install `/tools:new-project` globally |
| `install-hooks.sh` | Install git pre-commit/pre-push security-scanner hooks |
| `knowledge-index.ts` | FTS5 knowledge indexing and search (`node:sqlite`) |
| `lib/json.sh` / `lib/scan-rules.js` | Shared JSON helpers / scanner rule database (233 rules) |
| `memory-search.sh` | Full-text search across knowledge files |
| `new-project.sh` | Bootstrap a new Project OS project |
| `observation-parser.ts` | Extract 5 typed observations from tool output (sensitive-key denylist) |
| `scrub-secrets.sh` | Scrub secret patterns from a file (delegates to scanner) |
| `security-scanner.ts` | Zero-dep secrets/PII scanner (8 subcommands) |
| `sync-hooks.sh` | Sync hooks from the template to a target project |
| `update-project.sh` | Check for and apply Project OS updates from upstream |
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
                                      └── /api/status.json (JSON)
```

## Context Filtering &amp; Knowledge Index

Project OS includes an FTS5-based knowledge index for efficient context management:

- **Index engine**: `scripts/knowledge-index.ts` — uses `node:sqlite` FTS5 (Node 22.16+, zero deps)
- **Subcommands**: `index`, `index-vault`, `index-observations`, `search`, `rebuild`, `stats`, `stale`, `config`
- **Observation parser**: `scripts/observation-parser.ts` — extracts 5 typed facts (error-pattern, file-relationship, config-key, function-sig, dependency-chain) with sensitive key denylist
- **Filter script**: `scripts/context-filter.sh` — routes large outputs through intent-based filtering
- **Advisory hook**: `.claude/hooks/output-index.sh` — indexes large tool outputs and persists extracted observations to `observation_meta` table
- **Auto-checkpoint hook**: `.claude/hooks/pre-compact.sh` — PreCompact hook auto-saves session state before context compaction (10-min debounce)
- **SKILL**: `.claude/skills/context-filter/SKILL.md` — teaches proactive routing for large content

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

---

<!-- This file is read by /workflows:design to ensure new features align -->
