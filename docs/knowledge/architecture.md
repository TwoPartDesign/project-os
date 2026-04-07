---
type: knowledge
tags: [architecture, system-design]
description: Living system architecture documentation
links: "[[decisions]], [[patterns]]"
date: "2026-03-03"
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
        (authority)         (claude-code, codex)   (completion reports)
              │                     │
              ▼                     ▼
         Native Tasks          Activity Logs
        (runtime state)      (.claude/logs/)
```

## Module Map

| Module | Path | Purpose |
|--------|------|---------|
| Workflow commands | `.claude/commands/workflows/` | Spec-driven dev lifecycle (idea→design→plan→build→review→ship) |
| Tool commands | `.claude/commands/tools/` | Utility tools (dashboard, commit, handoff, research) |
| Agent adapters | `.claude/agents/adapters/` | Uniform interface for dispatching to AI agents |
| Hooks | `.claude/hooks/` | Event-driven automation (post-tool-use, activity logging, session preservation) |
| Scripts | `scripts/` | Standalone utilities (validate-roadmap, dashboard, security-scanner, install-hooks, scrub-secrets) |
| Knowledge base | `docs/knowledge/` | Patterns, decisions, bugs, architecture, metrics |
| Specs | `docs/specs/<feature>/` | Per-feature lifecycle docs (design, tasks, review) |

## Data Flow

### Build Phase
```
ROADMAP.md ──parse──→ Wave Computation ──dispatch──→ Sub-agents (worktree isolation)
     │                      │                              │
     ▼                      ▼                              ▼
Native Tasks          Adapter Resolution           Completion Reports
(convenience)     (model→agent→settings→fallback)    (per-task output)
     │                                                     │
     └──────── Wave Boundary Consistency Check ◄───────────┘
```

### Adapter Resolution (4-step)
0. `(model: opus)` annotation → claude-code adapter with ADAPTER_MODEL override
1. `(agent: codex)` annotation → codex adapter (if healthy)
2. Settings default → `project_os.adapters.default`
3. Fallback → claude-code adapter with ADAPTER_MODEL=haiku

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

## Web Fetch MCP Server

Self-contained MCP server for fetching and preprocessing web content before it enters the context window:

- **Location**: `tools/web-fetch/` — directory exception to single-script pattern (needs config, cache, multiple source files)
- **Transport**: Hand-rolled JSON-RPC 2.0 stdio handler (~150 lines, no MCP SDK)
- **Pipeline**: 9-stage fetch → SSRF validate → cache check → rate limit → retry → validate response → extract → truncate → cache write
- **Extraction**: Zero-dep custom HTML→Markdown via regex/heuristic text-density scoring. Quality cascade: `extractionConfidence: "high" | "low" | "raw-fallback"` with auto-fallback
- **Sanitizer**: 8-stage prompt injection stripping (hidden elements, ZWSP, base64, LLM delimiters, invisible Unicode, HTML comments, Markdown injection, whitespace)
- **Security**: Two-layer SSRF (hostname blocklist + DNS resolution), manual redirect following with per-hop validation, `node:sqlite` cache with SHA-256 integrity, PostToolUse validation hook
- **Cache**: `node:sqlite` metadata + filesystem content blobs, LRU eviction, conditional GET (ETag/Last-Modified), TTL tiers (docs 24h, news 1h, default 6h)
- **MCP tools**: `fetch_readable` (extract + sanitize → Markdown), `fetch_raw` (sanitize + strip tags), `cache_status` (stats/clear)
- **Registration**: `.mcp.json` at project root, hook wiring in `.claude/settings.json` (`mcp__web_fetch__.*`)
- **Zero npm deps**: All code is custom TypeScript using `node:*` built-ins only (Node 22+)
- **Known limitation**: DNS rebinding not mitigated at application layer (documented in pipeline.ts)

---

<!-- This file is read by /workflows:design to ensure new features align -->
