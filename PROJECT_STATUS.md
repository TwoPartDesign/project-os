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
- **Shipped security-scanner feature (T10-T16)**: Completed build (Waves 3-4), ran adversarial review (3 isolated reviewers), gate passed with notes
- **Fixed 3 SHOULD FIX items** from review: `$BASE` inline detection in ship.md, line-by-line scrub replacement (was global regex), extracted `CODE_EXTENSIONS` constant from duplicated `pathScopeSkip` arrays
- **Doc/dependency sweep**: Updated 7 files — architecture.md (Security Scanning section + module map), decisions.md (ADR for zero-dep scanner), README.md (install-hooks setup + tip), CLAUDE.md (hook installer in rules), PROJECT_STATUS.md, bugs.md (2 cosmetic scanner bugs)
- **Created 6 atomic commits** and pushed to origin: 4 feat + 2 docs
- **Full project security scan**: Zero findings across all files and commits
- **Metrics snapshot**: Saved to docs/knowledge/metrics.md

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
- **Zero-dep scanner over gitleaks binary**: ADR recorded in decisions.md. Ported 219 rules from gitleaks@256f6479 to JS, added 14 custom PII/privacy rules. 24 PCRE patterns couldn't convert (handled as SKIP).
- **Defense-in-depth hook chain**: pre-commit (scan-staged) → pre-push (scan-diff) → ship workflow step 1.5 (scan-diff against base). Three layers, any one catches secrets.
- **scan-rules.js self-allowlisted**: Rules file contains test case data (SSNs, credit cards, API key patterns) that trigger the scanner. Path-allowlisted in allowlist.json — intentional, documented in bugs.md.
- **ES2024 regex modifiers**: `(?i:...)` inline flags valid in Node 22+ V8. Two reviewers flagged as crash risk — verified false.
- **Model routing**: opus primary, sonnet sub-agents. Overrides CLAUDE.md docs (which still say haiku).
- **Codex review flow**: Write prompt to `./codex-prompt.txt` (project root), run `bash scripts/codex-review.sh --prompt-file ./codex-prompt.txt`, clean up after.

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
  specs/security-scanner/ — Design spec, tasks, review report, completion reports
  knowledge/architecture.md — UPDATED: security scanning section, observation pipeline
  knowledge/decisions.md — UPDATED: ADR for zero-dep scanner
  knowledge/patterns.md — UPDATED: security scanning gate pattern
  knowledge/metrics.md  — UPDATED: security-scanner + adaptive-memory snapshots
  knowledge/bugs.md     — UPDATED: 2 cosmetic scanner bugs

ROADMAP.md              — security-scanner T10-T16 done, adaptive-memory T2-T8 done, T9 in-progress, T1 spike in backlog
```
