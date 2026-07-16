# Plan: Local "Dream" pass for Project OS memory consolidation

## Context

Anthropic's new **Dreams** feature (Managed Agents API, beta `dreaming-2026-04-21`) takes a memory store + up to 100 session transcripts and produces a *new* reorganized memory store: duplicates merged, stale/contradicted entries replaced, insights surfaced. The input is never mutated, so the result is reviewable.

We can't use the Dreams API directly — Project OS is local-first (markdown + FTS5 SQLite) and Dreams requires Managed Agents memory stores in Anthropic's hosted runtime. But the *pattern* maps cleanly onto the gap we already documented:

- `docs/specs/adaptive-memory/design.md` (APPROVED, 2026-03-25) deferred **Phase 2: Experience Pattern Mining + Adaptive Recall**
- `docs/memory/` (8 prose summaries) is written manually during `/tools:handoff` — no dedup, contradiction resolution, or cross-session synthesis happens
- `.claude/sessions/*.yaml` (handoffs + auto-checkpoints) accumulate but are read one-at-a-time on `/tools:catchup`

The 45-day AI Agent Research scan reinforces this: Nexus "metabrain", Clawdex collective memory, Hermes multi-level memory, and the LoCoMo benchmark post (digest 2026-03-25) all converge on **periodic consolidation passes** as the missing primitive in agent memory. No external framework (Letta, Mem0, Zep) appeared in the window — community is hand-rolling MCP+knowledge-graph solutions.

This plan adds a **local Dream pass** as a new `/tools:dream` command, unlocking Phase 2 of the adaptive-memory spec without an API dependency.

## Recommended approach

Build `/tools:dream` as a non-destructive consolidation command, modeled on Anthropic's Dreams contract (input read-only, output written separately for review).

### 1. New slash command: `.claude/commands/tools/dream.md`

Mirror the structure of existing `.claude/commands/tools/handoff.md`. It instructs Claude to:

1. **Gather inputs** (read-only):
   - All `docs/memory/*.md`
   - Last N `.claude/sessions/handoff-*.yaml` and `auto-checkpoint-*.yaml` (default N=20, configurable via arg)
   - Optionally `docs/knowledge/{decisions,patterns,bugs}.md` for cross-reference
   - Run `scripts/knowledge-index.ts stale` to surface entries past the 90-day threshold
2. **Spawn a Haiku sub-agent** (matches existing `CLAUDE_CODE_SUBAGENT_MODEL` default) with a consolidation prompt:
   - Merge duplicates
   - Flag contradictions with source citations (which session said what, when)
   - Promote recurring patterns to `docs/knowledge/patterns.md` candidates
   - Drop entries superseded by newer sessions
3. **Write output to a staging dir**, never overwriting:
   - `docs/memory/.dream-output/<YYYY-MM-DD-HHMM>/memory/*.md` — proposed replacement set
   - `docs/memory/.dream-output/<YYYY-MM-DD-HHMM>/diff.md` — human-readable summary (added/merged/removed/contradictions)
   - `docs/memory/.dream-output/<YYYY-MM-DD-HHMM>/manifest.yaml` — input session IDs, timestamp, model, token usage
4. **Print review instructions** — user runs `/tools:dream-accept <timestamp>` (or rejects by deleting the staging dir).

### 2. Companion command: `.claude/commands/tools/dream-accept.md`

Tiny command. Takes a timestamp arg, runs a shell step that:
- Backs up current `docs/memory/` to `docs/memory/.archive/<timestamp>/`
- Copies staging output into `docs/memory/`
- Triggers `scripts/knowledge-index.ts rebuild`
- Deletes the staging dir

Keeping accept as a separate command preserves the Dreams "review before commit" property.

### 3. Reuse existing infrastructure (no new scripts needed)

- **`scripts/knowledge-index.ts`** — already supports `stale` (find old entries) and `rebuild`. Dream uses `stale` as a hint for what to consolidate.
- **`scripts/observation-parser.ts`** — already extracts 5 typed fact types from session text. Dream can call it on each session YAML to get structured candidates for `decisions.md` / `patterns.md` promotion.
- **`.claude/skills/session-management/SKILL.md`** — already documents the "memory hygiene checklist" (decisions → `decisions.md`, patterns → `patterns.md`, bugs → `bugs.md`). The dream prompt should `@`-reference this skill so Claude applies the same routing rules.
- **`.claude/hooks/pre-compact.sh`** — unchanged. Dream is opt-in, not auto-fired; running it on PreCompact would be too expensive and too eager.

### 4. Optional follow-ons (separate, not in scope of first ship)

These came out of the research scan and are worth tracking but should not bloat this PR:

- **Token-budget audit** (digest 2026-04-15: 30k tokens consumed before first prompt). Add `scripts/startup-cost.ts` that measures how much of the system prompt + skills + memory MD + manifests actually loads. Useful baseline before adding dream output.
- **Selvedge-style rationale capture** (digest 2026-05-08). Project OS already has `output-index.sh` indexing tool outputs; extending it to also capture *why* a write happened would feed richer dream inputs. Treat as a Phase-2.5 spec.
- **Scheduled dream** via `/schedule` (weekly cron). Anthropic Dreams is async/minutes-long; a local Haiku pass over 20 sessions should run in <2 min, so cron is plausible. Defer until manual usage validates the prompt.

## Critical files

**Will create:**
- `.claude/commands/tools/dream.md` — new command
- `.claude/commands/tools/dream-accept.md` — accept companion

**Will read/reference (not modify):**
- `docs/specs/adaptive-memory/design.md` — anchor doc; mark Phase 2 partially shipped
- `.claude/commands/tools/handoff.md` — template for command structure
- `.claude/skills/session-management/SKILL.md` — hygiene rules to inherit
- `scripts/knowledge-index.ts` — `stale` and `rebuild` subcommands
- `scripts/observation-parser.ts` — typed fact extraction

**Will touch (small edits):**
- `docs/specs/adaptive-memory/design.md` — append a "Phase 2 progress" note pointing at `/tools:dream`
- `ROADMAP.md` — add the new command under existing Phase 2 line
- `.gitignore` — add `docs/memory/.dream-output/` and `docs/memory/.archive/`

## Verification

1. **Dry-run** — invoke `/tools:dream` on the current 8 memory files + last 20 sessions. Inspect `docs/memory/.dream-output/<ts>/diff.md`. Expect: at least one merge candidate (some of the 8 files are date-named and likely overlap topically) and zero contradictions on a clean tree.
2. **Round-trip** — run `/tools:dream-accept <ts>`, then run `/tools:catchup`. The session restore should still work (no broken paths in YAMLs since we don't touch sessions).
3. **Index integrity** — after accept, `node scripts/knowledge-index.ts stats` should report a non-zero doc count and FTS5 search should still return hits for a known-stable query.
4. **Reject path** — second run, delete the staging dir manually, confirm `docs/memory/` unchanged.
5. **Compare to Anthropic Dreams contract** — input never modified ✓, output separate ✓, reviewable before adoption ✓, archivable/discardable ✓.
