# Project Status

## Last Updated
2026-03-16 - Session wrapup

## Project Overview
Project OS is a personal governance layer for solo development. Markdown + Bash stack providing spec-driven workflow, hook-based automation, context filtering, and agent orchestration. Currently at v2.2.

## Current State
- v2.2 tagged and released
- All hooks hardened across projects (canonical pattern from `347ed04`)
- **New: Self-update system built** — projects can check upstream for updates and apply them safely
- ROADMAP.template.md created as clean skeleton for new projects (no project-specific tasks)

## Recent Session Summary
- **Simplified `codex-review.sh`**: 175 lines → 53 lines. Dropped PowerShell fallback, cygpath conversion, .ps1 temp script generation. Codex is in Git Bash PATH — direct stdin pipe works.
- **Rewrote Code Reviews section in global `~/.claude/CLAUDE.md`**: Clear invocation rules — always use wrapper script, write prompts with Write tool to project root (not `/tmp/`), never invoke `codex exec` directly.
- **Fixed `/tmp/` path mismatch**: Write tool and Git Bash resolve `/tmp/` to different Windows paths. Prompt files now go to `./codex-prompt.txt` (project-relative).
- **Copied simplified `codex-review.sh` to NightOwl** project.
- **Set global default model**: Opus with medium effort in `~/.claude/settings.json`.
- **Uninstalled PowerShell 2.0**: `Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root` (no restart needed).
- **Ran Codex review** on Project OS using the new simplified flow — worked cleanly (single bash command, no permission prompts, no temp dirs).
- **Researched agent-teams-spike (#T13)**: Spike report already exists, recommends deferring. Decision: not needed now — current adapter model is shipping and proven.

## Next Steps
- Commit all pending changes (codex-review.sh simplification, update system files, hook fixes, .gitignore, bash.md)
- Test `new-project.sh` end-to-end with manifest generation integrated
- Copy simplified `codex-review.sh` to remaining downstream projects (Service-Drive-Advisor-Prep, Dry_Run_MVP)
- Bootstrap update system into downstream projects (copy `generate-manifest.sh` + `update-project.sh` + run manifest generation)
- Hook fixes from prior session still uncommitted in downstream projects
- PM-Workflow `_common.sh` likely has `get_project_root()` CWD bug (not checked)
- Codex review found: `update-project.sh` regenerates manifest after conflicts (hashes local files, not upstream) — fix before shipping
- Codex review found: `generate-manifest.sh` needs `sha256sum` dependency check for clean errors on missing tool

## Key Decisions & Context
- **Codex review flow**: Write prompt to `./codex-prompt.txt` (project root), run `bash scripts/codex-review.sh --prompt-file ./codex-prompt.txt`, clean up after. Never use `/tmp/` (Write tool and Git Bash resolve it differently on Windows).
- **Agent Teams (#T13)**: Deferred indefinitely. Current adapter model is shipping. Agent Teams still experimental. Not needed.
- **Global model**: Opus medium effort set as default in `~/.claude/settings.json`.
- **Update strategy**: Hybrid manifest + archive diff. Manifest tracks what was installed; archive provides what's upstream. Files classified as safe (auto-update), conflict (.upstream for review), new (auto-add), unchanged (skip).
- **ROADMAP.md is project-specific**: Never updated by the update system. `ROADMAP.template.md` is the clean skeleton for new projects.
- **Project-specific exclusions**: CLAUDE.md, ROADMAP.md, docs/specs/, docs/memory/, src/ are never touched by updates.
- **Backups**: `.claude/backups/pre-update-YYYYMMDD-HHMMSS/` created before any apply operation.
- **Hook pattern**: All advisory hooks must have `set -euo pipefail` + `trap 'exit 0' ERR`.
- **flock unavailable**: This machine lacks flock — all hooks must guard with `command -v flock`.

## Known Issues / Blockers
- Hook fixes in NightOwl, Service-Drive-Advisor-Prep, Dry_Run_MVP are unstaged file edits (from prior session)
- PM-Workflow `_common.sh` likely has the same `get_project_root()` CWD bug
- Downstream projects need manual bootstrap of update scripts before they can self-update

## File Map
```
scripts/
  generate-manifest.sh  — Creates .claude/manifest.json with sha256 hashes of template files
  update-project.sh     — Fetches upstream releases, classifies changes, applies updates
  knowledge-index.ts    — FTS5 SQLite index for context-filtered search (Node 22.16+)
  dashboard-server.ts   — Live dashboard server (Node 22.6+, port 3400)
  codex-review.sh       — Wrapper for Codex reviews via stdin pipe
  new-project.sh        — Bootstrap new projects (now with manifest + ROADMAP template)

.claude/
  manifest.json         — Template file hashes for update tracking (84 files, v2.2)
  commands/tools/update.md — /tools:update skill command
  hooks/                — PostToolUse automation (output-index, compact-suggest, etc.)

ROADMAP.template.md     — Clean skeleton roadmap for new projects
ROADMAP.md              — This project's task tracker (authoritative)
docs/knowledge/         — Architecture, patterns, design decisions
docs/specs/             — Per-feature lifecycle docs
```
