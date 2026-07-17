---
description: "Run the autonomous maintenance loop — deterministic health checks that file draft tasks, never edit ROADMAP directly"
---

# Maintenance Loop

Runs `scripts/maintain.sh`: a deterministic, LLM-free bash orchestrator that
checks project health and files fingerprinted `[?]` draft tasks for a human
to triage. It is the automated counterpart to `/pm:status` — where status
*reports*, maintain *proposes work*.

## Draft-only guarantee

`scripts/maintain.sh` writes through exactly two surfaces:

1. `scripts/maintain-draft.ts` — the loop's **only** ROADMAP writer. It
   appends a single `- [?] <title> #TN` line (plus a `<!-- maint-fp: ... -->`
   fingerprint comment) under a `## Feature: maintenance-inbox` section. It
   never edits an existing line, never promotes a marker, and snapshots +
   validates + restores ROADMAP.md on any failure.
2. `.claude/logs/maintenance-ledger.jsonl` — one append-only operational log
   line per run (rotated inline at 1 MiB).

The loop never touches `docs/memory/`, `docs/maps/`, session files, or
existing ROADMAP tasks. Promote a filed draft the same way as any other:
`/pm:approve`.

## What it checks

Each run executes up to five checks (narrowable via the policy file's
`checks` key), aggregating each into **at most one** draft per check per run:

| Check | Signal | Draft title |
|---|---|---|
| `map` | `node scripts/system-map.ts check` + `report --json` | system-map generator failing, or "readiness: N findings — ..." for HIGH-severity findings |
| `staleness` | `node scripts/knowledge-index.ts stale` | "Review stale knowledge: N files past Xd (...)" |
| `failures` | `.claude/logs/tool-failures.log` + `task-failed` events in `activity.jsonl`, since the last run | "Investigate recurring \<tool\> failures (N since ...)" |
| `consolidation` | `docs/memory/*.md` count or `.claude/sessions/*.yaml` count vs. thresholds | "Run /tools:dream — N memory files / M session files, consolidation due" |
| `search-miss` | zero-result entries in `.claude/logs/search-log.jsonl`, since the last run | "Search recall gaps: N zero-result queries (...)" |

Any check whose underlying script (`system-map.ts`, `knowledge-index.ts`) is
missing from this project's `scripts/` directory — for example a
template-cloned project that hasn't synced the newest scripts yet — degrades
gracefully: it records `{"check": "...", "skipped": "unavailable"}` in the
ledger and the run continues.

Drafts are deduplicated by a content-derived fingerprint (`grep -F` substring
match against `maint-fp:` comments) — an unchanged finding never re-files; a
changed one (different file set, different failing tool, different count)
does.

## Policy file

`.claude/maintenance-policy.yaml` — human-owned; the loop reads it but never
writes it.

| Key | Default | Meaning |
|---|---|---|
| `stale_threshold_days` | 90 | Knowledge-file age that trips the staleness check |
| `max_drafts_per_run` | 3 | Hard cap on drafts filed (or attempted) in one run |
| `failure_draft_threshold` | 5 | Tool failures since the last run before drafting |
| `consolidation_pressure_files` | 12 | `docs/memory/*.md` count that triggers a dream draft |
| `consolidation_pressure_sessions` | 40 | `.claude/sessions/*.yaml` count that triggers a dream draft |
| `search_miss_threshold` | 5 | Zero-result queries since the last run before drafting |
| `bloat_warn_tokens` | 2500 | Per-file token estimate threshold for the map check's bloat finding |
| `checks` | `map,staleness,failures,consolidation,search-miss` | Comma list — narrow to run a subset; the loop can never widen this itself |

A malformed numeric value falls back to its default and is recorded as a
`policy_warnings` entry in the ledger line — it never aborts the run.

## Running it

Manual:
```bash
bash scripts/maintain.sh            # runs checks, files drafts
bash scripts/maintain.sh --dry-run  # prints what would be filed, writes nothing
```

**Automatic (default)** — the SessionStart hook
`.claude/hooks/session-start-maintain.sh` auto-runs the loop at the start of
the first session after `auto_run_hours` (policy, default 24) have elapsed
since the last run. Manual runs reset the same clock (debounce reads the
ledger's age). Set `auto_run_hours: 0` in `.claude/maintenance-policy.yaml`
to disable auto-runs. When an auto-run files drafts, a one-line notice enters
the session context — autonomous filings are never silent. There is
deliberately no confirmation gate on running: the loop only files `[?]`
drafts, and the consequential step (promotion) is already gated by
`/pm:approve`. Linked worktrees and non-git copies skip silently.

Other invokers — all fine, the script is idempotent and lock-guarded
(`.claude/maintenance-lock`, atomic `mkdir`, 1h stale-reclaim so a crashed
run can't wedge future runs indefinitely):

- **OS scheduler** (cron / Task Scheduler): point it at
  `bash /path/to/project/scripts/maintain.sh`, on whatever cadence fits
  (daily is a reasonable default given the thresholds above).
- **Claude Code native `/loop`**: `/loop 1h /tools:maintain` — or invoke
  `bash scripts/maintain.sh` directly inside a loop prompt if you'd rather
  skip the command-doc layer.

A second concurrent invocation exits 0 immediately with a
`{"skipped": "lock-held"}` ledger note rather than racing the first.

## After a run

Filed drafts land under `## Feature: maintenance-inbox` in `ROADMAP.md` as
`[?]` tasks. Review and promote them like any other draft:

```
/pm:approve
```

Nothing else in the repo changes as a result of this command running.
