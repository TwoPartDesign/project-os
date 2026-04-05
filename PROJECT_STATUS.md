# Project Status

## Last Updated
2026-04-05 - Security scanner shipped

## Project Overview
Project OS is a personal governance layer for solo development. Markdown + Bash stack providing spec-driven workflow, hook-based automation, context filtering, and agent orchestration. Currently at v2.2.

## Current State
- v2.2 released, pushed to GitHub
- **security-scanner feature shipped** — 7/7 tasks complete (T10-T16), 4 waves, review passed with notes
  - 233 rules (219 gitleaks-ported + 14 custom PII/privacy), zero npm deps
  - Defense-in-depth: pre-commit → pre-push → ship workflow step 1.5
  - 3 SHOULD FIX items from review addressed post-gate
- **adaptive-memory feature shipped** — 7/8 tasks complete (T2-T8), T9 (tests+docs) still in-progress
- Settings updated: model=opus, subagents=sonnet, autocompact=75%

## Recent Session Summary
- **Researched Claudex** (github.com/grigorijejakisic/Claudex) — heavyweight local-first memory system. Extracted 3 high-ROI features adapted to Project OS's bash+markdown+FTS5 stack. Rejected vector search, RL training, background daemon (violate zero-dep principles).
- **Shipped adaptive-memory feature (T2-T8)**:
  - Auto-checkpoint PreCompact hook — auto-saves session state before context compaction with 10-min debounce
  - Recency-weighted search with composite scoring: `(fts5_rank * 0.7 + log(access_count+1) * 0.3) * recency_decay`
  - Observation parser — 5-type regex extraction (error-pattern, file-relationship, config-key, function-sig, dependency-chain) with sensitive key denylist
  - Hook integration persisting observations to `observation_meta` SQLite table
  - `--obs-type` search filter with conditional INNER JOIN
- **Fixed settings**: Project .claude/settings.json was overriding global (model, subagent model, autocompact threshold). Fixed to match user intent.
- **Ran full review pipeline**: 2 adversarial review rounds (3 reviewers each) + 1 Codex review. Fixed: ParseResult schema mismatch, FTS5 ORDER BY rank DESC bug (pre-existing), observation_meta PK collision, YAML quoting in pre-compact.sh, trap cleanup, sensitive key denylist.
- **Updated docs**: README (Node 22.16+ prereq, auto-checkpoint tip), architecture.md (observation pipeline, recency scoring), patterns.md (2 new patterns).

## Next Steps
- **T9: Tests + docs** — observation parser unit tests, update remaining docs (first priority next session)
- Copy simplified `codex-review.sh` to remaining downstream projects (Service-Drive-Advisor-Prep, Dry_Run_MVP)
- Bootstrap update system into downstream projects
- Hook fixes from prior sessions still uncommitted in downstream projects
- PM-Workflow `_common.sh` likely has `get_project_root()` CWD bug
- Fix `update-project.sh` manifest regeneration after conflicts (hashes local, not upstream)
- Fix `generate-manifest.sh` missing `sha256sum` dependency check
- Test `new-project.sh` end-to-end with manifest generation
- Pre-existing bug: `cmdIndex` path traversal guard rejects mktemp paths — output-index.sh `index` call has always silently failed for temp files (only `index-vault` works). Needs separate fix.

## Key Decisions & Context
- **Model routing changed**: User requested opus primary, sonnet sub-agents (was sonnet/haiku). This overrides the project CLAUDE.md docs which still say haiku for sub-agents.
- **Autocompact threshold**: Set to 75% (was 50%). PreCompact hook fires at this threshold.
- **Claudex analysis**: Rejected vector search (Qdrant), ACT-R decay, RL training, background daemon — all violate zero-dep or bash+markdown principles. Only extracted: auto-checkpoint, recency search, observation extraction.
- **FTS5 rank is negative**: `ORDER BY rank` (ASC default) gives best-first for FTS5. `DESC` was a pre-existing bug caught by Codex.
- **observation_meta PK**: Changed from `(source, heading, observation_type)` to `(source, observation_type, line_number)` with delete-before-insert to avoid collisions when all headings default to "ROOT".
- **Codex review flow**: Write prompt to `./codex-prompt.txt` (project root), run `bash scripts/codex-review.sh --prompt-file ./codex-prompt.txt`, clean up after.
- **Worktree agent persistence**: Agent worktrees may be cleaned up before changes persist — always copy files to main repo immediately after agent completion.

## Known Issues / Blockers
- T9 (tests + docs) still in-progress for adaptive-memory
- `cmdIndex` rejects temp files from hooks (path traversal guard) — pre-existing, affects all output-index.sh indexing
- Hook fixes in Service-Drive-Advisor-Prep, Dry_Run_MVP still unstaged
- PM-Workflow `_common.sh` likely has `get_project_root()` CWD bug
- `eval` in output-index.sh:48 is pre-existing security concern (works but brittle)

## File Map
```
scripts/
  security-scanner.ts   — NEW: Zero-dep secret scanner (8 subcommands, 233 rules, entropy detection)
  lib/scan-rules.js     — NEW: Rule database (219 gitleaks + 14 custom PII/privacy)
  install-hooks.sh      — NEW: Git hook installer (pre-commit + pre-push)
  scrub-secrets.sh      — MODIFIED: delegates to scanner, bash fallback
  knowledge-index.ts    — FTS5 index + recency scoring + observation_meta + index-observations (Node 22.16+)
  observation-parser.ts — 5-type regex observation extractor with sensitive key denylist
  dashboard-server.ts   — Live dashboard server (Node 22.6+, port 3400)
  codex-review.sh       — Wrapper for Codex reviews via stdin pipe
  new-project.sh        — Bootstrap new projects
  generate-manifest.sh  — Creates .claude/manifest.json for update tracking
  update-project.sh     — Fetches upstream, classifies changes, applies updates

.claude/
  security/allowlist.json — NEW: Scanner path ignores, rule disables, stopwords
  hooks/pre-compact.sh  — PreCompact auto-checkpoint hook (10-min debounce)
  hooks/output-index.sh — observation parser integration + persistence
  settings.json         — model=opus, subagent=sonnet, autocompact=75%, PreCompact hook
  commands/workflows/ship.md — MODIFIED: added step 1.5 security scan gate

docs/
  specs/adaptive-memory/ — Design spec, review report, revision request
  knowledge/architecture.md — UPDATED: observation pipeline, recency scoring docs
  knowledge/patterns.md — UPDATED: 2 new patterns (worktree recovery, schema contracts)
  knowledge/metrics.md  — UPDATED: adaptive-memory metrics snapshot

ROADMAP.md              — security-scanner T10-T16 done, adaptive-memory T2-T8 done, T9 in-progress, T1 spike in backlog
```
