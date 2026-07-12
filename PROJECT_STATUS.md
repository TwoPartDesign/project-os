# Project Status

## Last Updated
2026-07-12 - Staleness-audit remediation in review

## Project Overview
Project OS is a personal governance layer for solo development. Markdown + Bash stack providing spec-driven workflow, hook-based automation, context filtering, and agent orchestration. Currently at v2.2, with v2.3-dev (audit remediation) in review.

## Current State
- v2.2 released (security-scanner + adaptive-memory; web-fetch MCP server built then extracted to a standalone repo in `d2f7cec`)
- **Audit-remediation work (T17–T32) implemented and in review** on branch `claude/repo-staleness-audit-zbnon0`, driven by `docs/audits/2026-07-11-staleness-audit.md`:
  - Model routing on the Claude 5 lineup (Opus 4.8 / Fable 5 orchestration, Sonnet 5 sub-agents, Haiku 4.5 mechanical) — settings, tier tables, escalation ladder, docs all agree now
  - Build/ship migrated to native worktrees + native Task scheduling; adapter layer collapsed to `codex.sh` only (native Task dispatch is the default)
  - MCP output validation fixed (alerts actually reach the model); Bash permission allows scoped to specific subcommands
  - package.json engines pin + node guard for TS hooks; log rotation + SessionEnd cleanup hook
  - bash.md slimmed — Windows scanner catalog moved to `docs/knowledge/windows-bash-scanner.md`; auto-approval hook proposed in `docs/proposals/pre-tool-approve-hook.md`
  - Status docs reconciled (this file, CHANGELOG v2.1/v2.2/v2.3-dev entries, vault frontmatter dates, guide) — T31

## Next Steps
- Land the audit-remediation review and merge `claude/repo-staleness-audit-zbnon0`
- **T9 (adaptive-memory tests + docs) remains open** — `tests/observation-parser.test.ts` still does not exist; being re-statused in ROADMAP by the orchestrator
- Fix `scan-rules.js` invalid regex (#T33 draft — see Known Issues)
- Owner decision on installing the auto-approval hook proposal (`docs/proposals/pre-tool-approve-hook.md`)
- Copy simplified `codex-review.sh` to remaining downstream projects (Service-Drive-Advisor-Prep, Dry_Run_MVP)
- Bootstrap update system into downstream projects; hook fixes there still uncommitted
- Fix `update-project.sh` manifest regeneration after conflicts (hashes local, not upstream)
- Fix `generate-manifest.sh` missing `sha256sum` dependency check
- Test `new-project.sh` end-to-end with manifest generation

## Key Decisions & Context
- **Audit-remediation ADR (2026-07-12)** in decisions.md: native-primitives migration, Claude 5 model routing policy, restrictive-allow permissions posture, bash.md slimming
- **Zero-dep scanner over gitleaks binary**: ADR in decisions.md. 219 gitleaks rules + 14 custom PII/privacy ported to JS; 24 PCRE patterns couldn't convert (SKIP)
- **Defense-in-depth hook chain**: pre-commit (scan-staged) → pre-push (scan-diff) → ship workflow step 1.5 (scan-diff against base)
- **scan-rules.js self-allowlisted**: rules file contains secret-like test data; path-allowlisted in allowlist.json — intentional, documented in bugs.md
- **Model routing**: primary session model for orchestration/design (settings.json `"model"`), `claude-sonnet-5` sub-agents, `claude-haiku-4-5-20251001` for mechanical tasks
- **Codex review flow**: write prompt to `./codex-prompt.txt` (project root), run `bash scripts/codex-review.sh --prompt-file ./codex-prompt.txt`, clean up after

## Known Issues / Blockers
- **scan-rules.js invalid regex on Node 22**: the atlassian rule's `(?-i:)` inline-modifier group is unsupported by Node 22 V8 — `security-scanner.ts test-rules` errors (found during #T29; #T33 draft covers the fix + auditing other rules)
- **Auto-approval hook proposal awaiting owner installation** (`docs/proposals/pre-tool-approve-hook.md`) — proposal only, not wired into settings
- T9 (adaptive-memory tests + docs) still open — `tests/observation-parser.test.ts` missing
- `cmdIndex` rejects temp files from hooks (path traversal guard) — pre-existing, affects all output-index.sh indexing of mktemp paths (only `index-vault` works)
- `eval` in output-index.sh:48 is a pre-existing security concern (works but brittle)
- Hook fixes in Service-Drive-Advisor-Prep, Dry_Run_MVP still unstaged; PM-Workflow `_common.sh` likely has `get_project_root()` CWD bug

## File Map
```
scripts/
  security-scanner.ts   — Zero-dep secret scanner (8 subcommands, 233 rules, entropy detection)
  lib/scan-rules.js     — Rule database (219 gitleaks + 14 custom PII/privacy)
  install-hooks.sh      — Git hook installer (pre-commit + pre-push)
  scrub-secrets.sh      — Delegates to scanner, bash fallback
  knowledge-index.ts    — FTS5 index + recency scoring + observation_meta (Node 22, guarded)
  observation-parser.ts — 5-type regex observation extractor with sensitive key denylist
  dashboard-server.ts   — Live dashboard server (port 3400)
  codex-review.sh       — Wrapper for Codex reviews via stdin pipe
  new-project.sh        — Bootstrap new projects
  generate-manifest.sh  — Creates .claude/manifest.json for update tracking
  update-project.sh     — Fetches upstream, classifies changes, applies updates
  sync-hooks.sh         — Hook syncing for existing projects

package.json            — NEW: engines pin + node --test script

.claude/
  agents/adapters/      — CHANGED: codex.sh only (claude-code/gemini/aider/amp deleted; native dispatch default)
  hooks/session-end-cleanup.sh — NEW: log rotation + per-session file cleanup
  hooks/pre-compact.sh  — PreCompact auto-checkpoint hook (10-min debounce)
  hooks/post-mcp-validate.sh — FIXED: validation output actually reaches the model
  security/allowlist.json — Scanner path ignores, rule disables, stopwords
  settings.json         — CHANGED: Claude 5 routing, scoped Bash allows, updated matchers

docs/
  audits/2026-07-11-staleness-audit.md — The audit driving v2.3-dev
  proposals/pre-tool-approve-hook.md   — NEW: auto-approval hook (proposal, not installed)
  knowledge/windows-bash-scanner.md    — NEW: Windows scanner-workaround catalog (moved out of bash.md)
  knowledge/*.md        — Vault refreshed 2026-07-12 (frontmatter dates now truthful)

ROADMAP.md              — audit-remediation T17-T32 (T31/T33 pending), owned by orchestrator
```
