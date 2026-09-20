# T189: Measure whether the 350k-window / 80% compaction constraint helps or hurts Fable sessions

Source: ROADMAP.md `## Feature: compaction-gate`, task #T189 (model: opus). No design.md exists for this feature; the ROADMAP entry is the approved spec.

- **Files**: `scripts/compaction-metrics.ts` (create), `tests/compaction-metrics.test.ts` (create), `docs/knowledge/compaction-metrics.md` (create), `.claude/commands/tools/metrics.md` (modify: add a `### Compaction metrics` note), `.claude/settings.json` (modify: permission `Bash(node scripts/compaction-metrics.ts*)`)
- **Pattern**: `scripts/review-triage.ts` (zero-dep TS script, exported pure functions + CLI, tests import pure functions directly and run the CLI against mkdtemp fixtures)
- **Implementation**:
  - Read transcript JSONL files from a directory or file path passed on the command line (never hardcoded; `~/.claude/projects/<slug>/*.jsonl` is the documented location).
  - Segment each session into compaction cycles at `type: "system", subtype: "compact_boundary"` records (`compactMetadata.preTokens`/`postTokens`); fallback: a >50% context drop between consecutive main-thread (`isSidechain` false) `type: "assistant"` records with `message.usage`, where context = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
  - Per cycle: turns, peak context, peak % of the configured window, cache-read / cache-creation / uncached input tokens, output tokens, turns above 200k, tool-error rate by context decile (a `tool_result` with `is_error: true` in the following user record, bucketed by the assistant turn's context / window).
  - Simulate thresholds 60 / 70 / 80% of 350k and 80% of 200k: project compaction count and cache-read spend from the same transcripts (replay the per-turn context growth, cutting a cycle when it crosses the threshold and restarting at the observed post-compaction size).
  - Pin observed compaction point (both `preTokens` and the last usage-based context before the drop) against the configured one (`CLAUDE_CODE_AUTO_COMPACT_WINDOW` × `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`).
  - Output: `docs/knowledge/compaction-metrics.md` (table + one-paragraph recommendation: keep, lower the percentage, or lower the window) and a `### Compaction metrics` note in `/tools:metrics`.
- **Baseline (measured by hand, session 696f7242, 2026-09-20)**: 3 cycles over 486 lead turns; compaction fired at 262k and 263k by the usage method (`compactMetadata.preTokens` reads 292984 / 265505 / 271197 = 84% / 76% / 77% of 350k) although `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is 80; mean context per turn 173k; 170 of 486 turns (35%) above 200k; 80.8M cache-read vs 3.2M cache-creation vs 12k uncached.
- **Hypothesis**: context length, not compaction count, is the dominant input-spend driver under Fable; a lower threshold trades a few more handoffs for a materially cheaper session; quality side is whether tool-error rate rises in the top deciles.
- **Acceptance Criteria**:
  - [ ] `node scripts/compaction-metrics.ts <transcript-dir-or-file> [--window N] [--pct N] [--json]` runs offline with no dependencies and prints the per-cycle table, threshold simulation, and pin.
  - [ ] `node --test tests/compaction-metrics.test.ts` passes with fixture transcripts built in mkdtemp dirs (boundary record, usage-drop fallback, decile bucketing, threshold simulation, pin).
  - [ ] `docs/knowledge/compaction-metrics.md` exists with the real-session table and a recommendation paragraph.
  - [ ] `.claude/commands/tools/metrics.md` has a `### Compaction metrics` section naming the script.
  - [ ] `node scripts/system-map.ts report` shows no new orphan-script finding for `compaction-metrics.ts`.
- **Size**: Medium
- **Status**: [ ]
