---
feature: adaptive-memory
status: APPROVED
date: 2026-03-25
origin: Claudex analysis (github.com/grigorijejakisic/Claudex)
---

# PRD: Adaptive Memory — Claudex-Inspired Enhancements for Project OS

## Context

[Claudex](https://github.com/grigorijejakisic/Claudex) is a heavyweight local-first memory system for LLM coding agents — 21-table SQLite, Qdrant vector search, ACT-R cognitive decay, experience pattern mining, and a background "Angel" daemon. It achieves 90.8% LoCoMo accuracy and outperforms Mem0/Zep.

Project OS already has the **foundational 20%** of Claudex: FTS5 knowledge indexing, output capture hooks, session handoffs, and freshness tracking. This PRD identifies the highest-ROI features to extract from Claudex and adapt to our bash+markdown+FTS5 stack — without violating zero-dep principles.

## Feature Evaluation

| Feature | Principle Fit | Value | Complexity | Verdict |
|---------|--------------|-------|-----------|---------|
| Auto-Checkpoint | "Ship working software" (zero-friction) | High | Low | **Phase 1** |
| Recency-Weighted Search | "Context is noise" (better ranking) | Medium | Low | **Phase 1** |
| Structured Observation Extraction | "Context is noise" (typed facts) | Medium | Moderate | **Phase 1** |
| Experience Pattern Mining | "Documentation compounds" | Medium | Moderate | **Defer** |
| Adaptive Recall (phase-aware preload) | "Context is noise" | Medium | Moderate | **Defer** |
| Vector Search (Qdrant) | VIOLATES zero-dep | - | High | **Reject** |
| ACT-R / RL Training | Over-engineering | - | Very High | **Reject** |
| Background Daemon | VIOLATES bash+markdown | - | Very High | **Reject** |

## Phase 1: Foundation (3 features, ~8 tasks, 2-3 sessions)

### Feature 1: Auto-Checkpoint

**Problem**: `/tools:handoff` is manual. Users forget. Context lost on compaction or session end.

**Solution**: PreCompact hook auto-generates handoff YAML before context compaction fires.

**Behavior**:
- PreCompact hook fires -> captures git diff, ROADMAP.md task states, modified files, active phase
- Writes `.claude/sessions/auto-checkpoint-TIMESTAMP.yaml` (same schema as manual handoff)
- Returns `additionalContext` hint: "Auto-checkpoint saved. Resume with /tools:catchup"
- Debounce: skip if checkpoint exists within last 10 minutes
- `/tools:catchup` already reads latest session file -- no changes needed there

**Files**:
- `NEW: .claude/hooks/pre-compact.sh` -- generates auto-checkpoint YAML
- `EDIT: .claude/settings.json` -- register PreCompact hook
- `EDIT: .claude/commands/tools/handoff.md` -- note auto-checkpoint exists

**Risk**: PreCompact has limited time budget. Mitigation: fast-path only (git diff --stat, grep ROADMAP markers, no full file reads).

### Feature 2: Recency-Weighted Search

**Problem**: FTS5 search ranks by text relevance only. A fact discovered yesterday ranks the same as one from 3 months ago. The existing `--fresh` decay flag exists but doesn't track access patterns.

**Solution**: Add access tracking + composite scoring to knowledge-index.ts.

**Schema additions** (to `index_meta` table):
```sql
ALTER TABLE index_meta ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE index_meta ADD COLUMN last_accessed TEXT;
```

**Scoring formula**:
```
composite_score = (fts5_rank * 0.7 + log(access_count + 1) * 0.3) * recency_decay
recency_decay = 0.5 ^ ((now - last_accessed) / recency_halflife_days)
```
- Default `recency_halflife_days`: 14 (configurable via `project_os.context_filter.freshness`)
- Null `last_accessed` treated as "indexed_at" date (no penalty for new entries)

**Files**:
- `EDIT: scripts/knowledge-index.ts` -- add columns (migration), update search scoring, increment access on search hit
- `EDIT: .claude/settings.json` -- add `recency_halflife_days` to freshness config

### Feature 3: Structured Observation Extraction

**Problem**: `output-index.sh` indexes raw text blobs >5KB. No structure, no typing. Search returns wall-of-text chunks when you want specific facts.

**Solution**: Add observation parser that extracts typed facts before indexing.

**Observation types** (MVP -- 5 types):

| Type | Pattern | Example |
|------|---------|---------|
| `error-pattern` | `Error:`, `FAIL`, stack traces | "ENOENT: no such file '/path'" |
| `file-relationship` | `import`, `require`, `from` | "hooks/output-index.sh sources _common.sh" |
| `config-key` | `KEY=value`, env vars | "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50" |
| `function-sig` | `export function`, `const fn =` | "loadConfig(): Config" |
| `dependency-chain` | `depends:`, `requires`, package refs | "knowledge-index.ts requires node:sqlite" |

**Schema addition** (FTS5 `knowledge` table -- requires rebuild since FTS5 columns are immutable):
- Add `observation_type` column to FTS5 table
- Search supports `--type error-pattern` filtering

**Implementation**: New `scripts/observation-parser.ts` file. Regex-based extraction, called by `output-index.sh` before `knowledge-index.ts index`. Falls back to raw indexing if parser fails.

**Files**:
- `NEW: scripts/observation-parser.ts` -- regex fact extraction (5 types)
- `NEW: tests/observation-parser.test.ts` -- unit tests
- `EDIT: .claude/hooks/output-index.sh` -- call parser before indexing
- `EDIT: scripts/knowledge-index.ts` -- add observation_type to FTS5 schema, add --type filter, schema migration

## Phase 2: Analytics & Preload (defer ~1 month)

**Condition**: Ship Phase 1, gather data across 3+ features, then evaluate.

- **Experience Pattern Mining**: Parse activity logs + completion reports for recurring patterns. Auto-synthesize into `docs/knowledge/patterns.md`.
- **Adaptive Recall**: Phase-aware context pre-warming. Entering `/workflows:build` for auth -> auto-load auth-related bugs, patterns, decisions.

## Rejected Features

| Feature | Why Rejected |
|---------|-------------|
| Qdrant vector search | External dependency. FTS5 + recency scoring covers 80% of value at 1/10 complexity. |
| ACT-R cognitive decay | Premature optimization. Simple decay formula sufficient for our doc scale (~50K chunks). |
| RL policy training | Massive complexity for marginal gain. Solo dev doesn't generate enough reward signals. |
| Background daemon ("Angel") | Breaks bash+markdown core. No process supervisor. SQLite not multi-process safe. |
| MCP server approach | Hooks work. MCP adds architecture complexity for no gain. |

## Task Breakdown

**Waves**:
- Wave 1: #T2, #T4, #T6 (independent foundations -- parallel)
- Wave 2: #T3, #T5, #T7, #T8 (integration -- parallel, depends on Wave 1)
- Wave 3: #T9 (docs + tests -- depends on all)

## Verification

1. **Auto-checkpoint**: Trigger compaction (fill context to 75%), verify YAML appears in `.claude/sessions/auto-checkpoint-*.yaml`
2. **Recency search**: Run search twice, verify access_count increments and recently-accessed results rank higher
3. **Observation parser**: Pipe error output through parser, verify typed observations. Search with `--type error-pattern` to confirm filtering
4. **Integration**: Run `output-index.sh` with large output, verify observations indexed and searchable by type
5. **Tests**: `npx vitest run tests/observation-parser.test.ts`
