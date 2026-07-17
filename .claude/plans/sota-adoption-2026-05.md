# Project OS — SOTA Adoption Plan (May 2026)

> ## ⟳ REVISED SCOPE — 2026-07-17 (supersedes the Tier tables below)
>
> The **self-maintenance** feature shipped 2026-07-16 (#T46–T54) absorbed the most
> valuable part of this plan — the internal-drift / staleness-review axis. This
> revision re-scopes #T34 to only the work that is still real, portable, and
> unshipped. Read this block as authoritative; the original Tier 1–3 detail below
> is kept for provenance and cross-reference.
>
> ### Already delivered by self-maintenance (drop from #T34)
> - **1.3 `/tools:audit-knowledge`** — SUBSUMED. `scripts/maintain.sh` already runs
>   the staleness / bloat / drift checks and files `[?]` drafts routed through
>   `/pm:approve`; `scripts/system-map.ts` covers readiness/drift. The bespoke
>   interactive keep/edit/archive command adds little over the draft→approve flow.
> - The plan's whole **"staleness review strategy"** (3 drift axes) — the *internal*
>   axis is done. Only the *upstream* and *external* axes remain (see below).
>
> ### #T34 revised deliverables — a small "workflow-ergonomics" feature (portable)
> | # | Item | Effort | Note |
> |---|------|--------|------|
> | 1.1 | `/goal` exit predicates on wave gates + MVP phase transitions | S | Markdown-protocol only, no code. **Verify `/goal` is still the current native primitive before building** (plan cites a specific Claude Code version). |
> | 1.2 | Structured wave-handoff artifact (`waves/wave-N-handoff.md`) | S | Better long-build context continuity; FTS5-indexed for free. |
> | 1.4 | `/tools:update --diff-upstream` | S | The *upstream*-drift axis: surfaces framework improvements not yet pulled. |
>
> Ship these three as one feature. None is load-bearing — this is polish, lower
> urgency than #T9 (which closes a real coverage gap).
>
> ### Deferred / re-decide (NOT in the revised #T34 core)
> - **1.5 `/tools:sota-scan`** — the *external*-drift axis, but it scans a
>   **machine-local** research-digest directory, so it is NOT framework-portable.
>   Keep as a personal, this-machine tool if wanted; do not bundle into the
>   template feature. Decide explicitly before including.
> - **Tier 2** (2.1 phased-compaction, 2.2 cache-bust warning, 2.3 diff-review
>   gate) — unchanged, still a separate later cycle.
> - **Tier 3** — still rejected (embeddings/vendor deps); re-confirmed by the
>   self-maintenance research pass (`docs/specs/self-maintenance/research.md`).
>
> ### Recommended path
> A short `/workflows:design` re-scoping pass (drop 1.3, decide 1.5, verify
> `/goal`), then build 1.1+1.2+1.4 via `/workflows:mvp`. Roughly one MVP run.

---

## Context

Mined 30 days of AI-agent-research digests (2026-04-26 → 2026-05-26) for ideas Project OS could adopt. The community is converging on three patterns Project OS is partially missing: (1) **semantic completion predicates** (Claude Code `/goal`, Codex CLI `/goal`); (2) **structured inter-agent handoff files** ("9-agent team," `agent-lanes`); (3) **retrieval-quality upgrades over markdown vaults** (memtrace RRF, agentic-RAG-on-Obsidian). Separately, the user wants an on-demand **staleness review** so old approaches in `docs/knowledge/` don't quietly outlive their usefulness.

This plan filters every candidate through the **"low to no dependency" mission**: markdown + bash + Node 22 stdlib + `node:sqlite` only. Anything that needs embeddings, vector DBs, npm packages, or vendor APIs is rejected or deferred.

Project OS already has most of the substrate (FTS5 index, `validate`/`last_validated` infra, `audit-context.sh` token cost, wave-based build, MVP fast-path). The work is mostly **wiring** existing pieces together, not new infrastructure.

---

## Tier 1 — HIGH IMPACT, ZERO DEPS, SHORT EFFORT

### 1.1 `/goal` exit predicates for wave gates and MVP transitions
**What:** Adopt the `/goal <condition>` pattern (shipped in Claude Code v2.1.139 and Codex CLI 0.128.0 within the same week). Both wave gates in `/workflows:build` and phase transitions in `/workflows:mvp` get a declarative exit predicate.

**Slot-in:**
- `.claude/commands/workflows/build.md` — wave gate (step 5 in Execution Protocol). Add a `goal:` field per wave: `goal: all #T in wave have [~], no failing tests, no [!] markers`. Gate loops until satisfied or retry-cap (2) hits.
- `.claude/commands/workflows/mvp.md` — Gate Policy Reference table (lines 113-119) gets a new `goal_predicate` column per phase.

**Why fit:** Pure markdown-protocol change. No new code. Reuses existing wave-gate logic and the 2-retry escalation rule from `.claude/rules/escalation.md`.

**Effort:** S — edits to two command files, no scripts. **Dep cost:** zero.

### 1.2 Structured wave-handoff artifact
**What:** Each wave writes `docs/specs/$FEATURE/waves/wave-N-handoff.md` at completion. Next wave reads it as first context. Replaces the current implicit "ROADMAP markers are the handoff" pattern flagged by the build.md explore.

**Schema (markdown, frontmatter):**
```yaml
---
wave: 2
completed_tasks: [T3, T4, T5]
failed_tasks: []
files_changed: [...]
gotchas: ["T4 had to fall back to..." ]
follow_ups: ["consider extracting..." ]
goal_satisfied: true
---
```

**Slot-in:**
- `.claude/commands/workflows/build.md` — wave gate writes handoff; next wave's orchestrator prompt opens with `Read docs/specs/$FEATURE/waves/wave-{N-1}-handoff.md before dispatching.`
- `output-index.sh` (PostToolUse hook) already auto-indexes — handoffs become FTS5-searchable for `/tools:catchup`.

**Why fit:** Reuses existing session-handoff YAML schema *concept* but at wave granularity. Zero new infra; FTS5 ingestion is free.

**Effort:** S. **Dep cost:** zero.

### 1.3 On-demand staleness review skill — `/tools:audit-knowledge`
**What:** New skill that joins `audit-context.sh` (token cost) + `knowledge-index.ts stale --threshold 90d` (freshness) to produce a prioritized review queue, then walks the user/agent through each file.

**Algorithm:**
1. Run `knowledge-index.ts stale --threshold 90d` → list of stale sources.
2. Run `audit-context.sh --json` (small enhancement — currently prints human format) → per-file token cost.
3. Score each: `priority = token_cost × age_days × is_always_loaded_via_CLAUDE_md`.
4. For each top-N file (default 5), present: file path, age, token cost, current `description:` from YAML, last-modified diff.
5. User picks: **Keep** (calls `node scripts/knowledge-index.ts validate <source>` + sets `reviewed_date: <today>` in YAML frontmatter), **Edit** (opens for revision), **Archive** (moves to `docs/knowledge/archive/` and removes from FTS5).

**Slot-in:**
- New file: `.claude/skills/tools/audit-knowledge/SKILL.md`
- New file: `scripts/audit-knowledge.sh` (orchestrator — calls existing scripts)
- Minor edit: `audit-context.sh` gets a `--json` flag
- New file: `.claude/commands/tools/audit-knowledge.md`

**Why fit:** Reuses 100% of existing freshness infra. `last_validated` in `freshness_meta` already exists and gets touched by `validate`. Adding `reviewed_date:` to YAML gives a git-tracked audit trail independent of the SQLite DB.

**Effort:** S-M (~200 lines of bash + one skill file). **Dep cost:** zero.

### 1.4 On-demand "what's new upstream" review — `/tools:update --diff-upstream`
**What:** Currently `/tools:update` shows file-classification but no semantic diff of what's changed in upstream Project OS itself. Add a mode that runs `git log` against the upstream ref and surfaces a human-readable changelog of skill/command/script changes — so the user knows what community-evolved patterns they haven't adopted yet.

**Slot-in:**
- `scripts/update-project.sh` — add `--diff-upstream` mode that runs `git -C "$UPSTREAM_CACHE" log --oneline --no-merges main..HEAD -- .claude/ scripts/` and groups by skill.
- `.claude/commands/tools/update.md` — document the new flag.

**Why fit:** Direct response to "so we aren't continuing to maintain old approaches" — this catches the *external* drift, while 1.3 catches *internal* drift.

**Effort:** S. **Dep cost:** zero.

### 1.5 On-demand SOTA-scan skill — `/tools:sota-scan`
**What:** Codify the exact workflow this very conversation just ran. Scan the last N days of `~/Desktop/Claude Projects/AI Agent Research/logs/digest_*_data.json` for adoption candidates, output a ranked markdown table to `docs/knowledge/sota-scan-YYYY-MM-DD.md`.

**Slot-in:**
- New: `.claude/skills/tools/sota-scan/SKILL.md`
- New: `.claude/commands/tools/sota-scan.md`
- Prompt template lives in the skill; no new scripts needed (uses Read/Glob on the digest directory).

**Why fit:** The user explicitly asked for this on-demand capability. Closes the loop on external staleness.

**Effort:** S (just a skill prompt). **Dep cost:** zero.

---

## Tier 2 — MEDIUM IMPACT, MEDIUM EFFORT

### 2.1 Phased-implement compaction pattern in long builds
**What:** When `/workflows:build` runs >3 waves, force a compaction summary written to `waves/wave-N-compact.md` between waves; subsequent wave orchestrator loads only that summary, not the full prior-wave context. Pattern from 2026-05-03 r/ClaudeCode post.

**Slot-in:** `.claude/commands/workflows/build.md` — extend the wave-handoff artifact (1.2) to also include a `compact_summary:` block.

**Why fit:** Builds on 1.2's handoff artifact — same file, additional section. Mostly a behavioral protocol.

**Effort:** S (if 1.2 already shipped) / M (if standalone). **Dep cost:** zero.

### 2.2 Cache-bust warning hook
**What:** Pre-tool-use hook that warns when the operator is about to do something likely to bust the 5-min prompt cache (model switch, new CLAUDE.md load, large mid-session file read). Pattern from 2026-05-24 cache-economics post.

**Slot-in:** New `.claude/hooks/pre-tool-cache-warn.sh`. Wired in `settings.json` PreToolUse.

**Why fit:** Pure observability. No behavior change, just a stderr nudge.

**Effort:** M (defining the heuristic is the work). **Dep cost:** zero.

### 2.3 Diff-review gate in `/workflows:review` (counter to rubber-stamping)
**What:** The 2026-05-11 critique ("Spec-driven coding is making us worse supervisors") argues humans rubber-stamp specs without reading diffs. Add a mandatory diff-summarization step to `/workflows:review` that forces one reviewer to produce a "what actually changed vs. what the spec said" diff narrative.

**Slot-in:** `.claude/commands/workflows/review.md` — add reviewer #4 or extend reviewer #1's checklist.

**Why fit:** Project OS already has 3 isolated reviewers — adding a diff-narrative requirement is incremental.

**Effort:** M (prompt engineering + tuning). **Dep cost:** zero.

---

## Tier 3 — REJECTED OR DEFERRED (mission fit issues)

| Candidate | Why rejected/deferred |
|---|---|
| memtrace RRF (BM25+vec+graph) | Requires embedding runtime (ONNX or API). Violates zero-dep mission. **Defer** unless Node ships native embeddings or we accept an API hop. The BM25 leg we already have is 80% of the value. |
| Stainless auto-MCP | Vendor-dependent, post-acquisition direction unclear. **Wait & see.** |
| Arc Gate instruction-authority proxy | Too heavy for solo-dev; useful only at team/multi-tenant scale. **Reject.** |
| Runtime (YC) sandboxed team agents | Commercial product, not an adaptable pattern. **Track only.** |
| designmd.sh registry | Adds external HTTP dependency for skill discovery. **Reject** in current form; the underlying pattern (DESIGN.md as portable artifact) is already baked into `/workflows:design`. |
| Obsidian agentic-RAG eval harness | The evals pattern is interesting (catch hallucinated citations), but building it properly needs an LLM-judge layer that materially adds complexity. **Defer to Tier 2 candidate for later.** |

---

## Staleness Review Strategy (consolidated)

The user wants a single conceptual answer to "how do we not keep maintaining old approaches?" The plan covers **three orthogonal drift axes**:

| Drift axis | What gets stale | Detector | Skill |
|---|---|---|---|
| **Internal knowledge** | `docs/knowledge/*.md` decisions, patterns, architecture | `knowledge-index.ts stale` + `audit-context.sh` | 1.3 `/tools:audit-knowledge` |
| **Upstream Project OS** | Community-evolved skills we haven't pulled | `git log` against upstream cache | 1.4 `/tools:update --diff-upstream` |
| **External SOTA** | Community patterns we haven't even seen | Scrape `AI Agent Research/logs/` digests | 1.5 `/tools:sota-scan` |

Run all three quarterly (or on-demand). Output of each is a markdown file in `docs/knowledge/` — itself indexed and auditable next round.

---

## Critical Files to Modify

**Tier 1 (commit as one feature: `sota-adoption-2026-05`):**
- `.claude/commands/workflows/build.md` — wave-gate `goal:` + handoff write
- `.claude/commands/workflows/mvp.md` — Gate Policy table `goal_predicate`
- `.claude/commands/tools/update.md` + `scripts/update-project.sh` — `--diff-upstream`
- New: `.claude/skills/tools/audit-knowledge/SKILL.md` + `.claude/commands/tools/audit-knowledge.md` + `scripts/audit-knowledge.sh`
- New: `.claude/skills/tools/sota-scan/SKILL.md` + `.claude/commands/tools/sota-scan.md`
- Minor: `scripts/audit-context.sh` — add `--json` flag

**Reused (no edits):**
- `scripts/knowledge-index.ts` — already has `validate`, `stale`, `report`, `last_validated`
- `scripts/validate-freshness.sh` — already wraps the above
- `.claude/hooks/output-index.sh` — auto-indexes new handoff files for free
- `.claude/rules/escalation.md` — 2-retry cap applies to goal predicates

**Tier 2 (separate feature later):**
- `.claude/hooks/pre-tool-cache-warn.sh` + `settings.json` wiring
- `.claude/commands/workflows/review.md` — diff-narrative reviewer

---

## Verification

**Per-item smoke tests:**

1. **`/goal` predicates (1.1):** Run `/workflows:build` on a small 2-wave feature. Force a failing test in wave 1; verify gate loops and retries before promoting. Verify it stops at retry-cap = 2 with the escalation message.
2. **Wave handoff (1.2):** After a build, confirm `docs/specs/$FEATURE/waves/wave-1-handoff.md` exists with correct YAML. Run `node scripts/knowledge-index.ts search "wave-1-handoff" --type wave` and confirm it's indexed.
3. **`/tools:audit-knowledge` (1.3):** With a `docs/knowledge/*.md` whose mtime is artificially aged (`touch -d '120 days ago'`), run the skill. Confirm it surfaces the file, accepts "Keep", writes `reviewed_date:` to YAML, and `last_validated` in FTS5 updates (`node scripts/knowledge-index.ts validate-vault`).
4. **`/tools:update --diff-upstream` (1.4):** Run against current upstream. Confirm output groups commits by skill and lists files touched. Run twice — second run should be empty.
5. **`/tools:sota-scan` (1.5):** Run with `--days 7`. Confirm output file lands in `docs/knowledge/sota-scan-2026-05-26.md` and the ranked table renders. Cross-check at least one entry against the source digest JSON.
6. **End-to-end:** Run all three staleness checks in sequence. Confirm `docs/knowledge/` has three fresh review artifacts and no script touched anything outside the project root.

**Regression checks:**
- `bash scripts/security-scanner.ts --diff main` clean.
- `bash scripts/validate-roadmap.sh` clean.
- All existing `/workflows:build` runs on prior features still pass (handoff artifact is purely additive).

---

## Sequencing Recommendation

Ship Tier 1 as **one approved feature** (`/workflows:idea` → `/workflows:design` → `/workflows:plan` → `/workflows:build`). The five Tier 1 items share a theme (closing drift gaps + adopting community-validated primitives) and most reuse the same substrate. Defer Tier 2 to a separate cycle once Tier 1 has proven the wave-handoff artifact pattern in practice. Re-evaluate Tier 3 (especially memtrace) when one of: (a) Node ships native embeddings; (b) the project accepts a single optional npm dep.
