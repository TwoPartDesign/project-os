# Project Status

## Last Updated
2026-03-17 - Session wrapup

## Project Overview
Project OS is a personal governance layer for solo development. Markdown + Bash stack providing spec-driven workflow, hook-based automation, context filtering, and agent orchestration. Currently at v2.2.

## Current State
- v2.2 tagged and released
- All hooks hardened across projects (canonical pattern from `347ed04`)
- **New: Self-update system built** — projects can check upstream for updates and apply them safely
- ROADMAP.template.md created as clean skeleton for new projects (no project-specific tasks)

## Recent Session Summary
- **Evaluated "Auto-Generated Agent Preamble System"** accidentally built in NightOwl — decided Project OS inline approach is better; NightOwl migrated to match.
- **Added bash rules injection to `idea.md` and `design.md`** (Project OS): both workflows now read `.claude/rules/bash.md` → extract `## Agent Rules` section → store as `BASH_AGENT_RULES` before spawning sub-agents. `build.md` and `review.md` already did this.
- **Migrated NightOwl** from `_preamble.md` compiled artifact to inline read of `.claude/rules/agent-bash-rules.md`. Updated `build.md`, `review.md`, `idea.md`, `design.md`. Deleted `_preamble.md`.
- **Cleaned ROADMAP.md for public repo**: replaced personal dev history (#T1–T27) with skeleton. Working copy retains T13 spike. `ROADMAP.template.md` + `new-project.sh` cp is the mechanism for giving cloners a clean copy.
- **Committed and pushed** to `https://github.com/TwoPartDesign/project-os.git`.

## Next Steps
- Copy simplified `codex-review.sh` to remaining downstream projects (Service-Drive-Advisor-Prep, Dry_Run_MVP)
- Bootstrap update system into downstream projects (copy `generate-manifest.sh` + `update-project.sh` + run manifest generation)
- Hook fixes from prior sessions still uncommitted in downstream projects (NightOwl changes committed this session; others TBD)
- PM-Workflow `_common.sh` likely has `get_project_root()` CWD bug (not checked)
- Codex review found: `update-project.sh` regenerates manifest after conflicts (hashes local files, not upstream) — fix before shipping
- Codex review found: `generate-manifest.sh` needs `sha256sum` dependency check for clean errors on missing tool
- Test `new-project.sh` end-to-end with manifest generation integrated

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
