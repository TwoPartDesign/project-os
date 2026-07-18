---
description: "Local memory consolidation pass — merge/dedupe docs/memory and sessions into a reviewable staging proposal"
---

# Dream Pass

Local analogue of Anthropic's Managed Agents "Dreams" contract: read the accumulated
memory + session history, produce a *new* reorganized memory set, and write it to a
staging area for human review. The current `docs/memory/*.md` and session files are
never modified by this command — only by `/tools:dream-accept` after you approve.

## Usage
`/tools:dream [N]`

`N` is the number of most-recent session files to include (handoffs + auto-checkpoints
combined, sorted by filename/date descending). Default `N=20` if omitted or not a
positive integer.

## Step 1: Gather inputs (READ-ONLY)

Do not write anything in this step.

1. Read all files matching `docs/memory/*.md`.
2. List `.claude/sessions/handoff-*.yaml` and `.claude/sessions/auto-checkpoint-*.yaml`,
   sort by filename (which is date-ordered), and read the most recent `N` combined.
3. Run `node scripts/knowledge-index.ts stale` and capture its output as consolidation
   hints (entries past the staleness threshold are good merge/prune candidates).
4. Optionally read `docs/knowledge/decisions.md`, `docs/knowledge/patterns.md`, and
   `docs/knowledge/bugs.md` for cross-reference — these help distinguish "this belongs
   in memory" from "this is already tracked elsewhere and can be dropped from memory."

## Step 2: Classify by volatility tier

Before consolidating, mentally (or in scratch notes) tag each memory entry/fact with a
volatility tier. This determines how aggressively it can be merged, reworded, or
dropped:

- **Stable** — architecture facts, hard/final decisions, established conventions.
  Never dropped without explicit contradiction evidence (a newer, cited source that
  directly conflicts).
- **Slow-changing** — project status, open work items, in-flight feature state.
  Conservative merge: consolidate near-duplicates, but keep anything that could still
  be relevant.
- **Ephemeral** — session-specific details (what file was open, what exact command
  failed once, one-off scratch notes). Aggressive merge/prune — these are the primary
  source of bloat and are safe to compress hard or drop once superseded.

Pass this tiering scheme to the sub-agent in Step 3 so it applies the same standard.

## Step 3: Spawn ONE consolidation sub-agent

Spawn exactly one sub-agent `(model: sonnet)` — deliberately not `haiku`. Contradiction
detection between sources requires judgment a cheaper model is more likely to get
wrong, and this command runs infrequently enough that the cost difference doesn't
matter.

Before spawning, read `.claude/rules/bash.md` and extract the full content of its
`## Agent Rules` section — sub-agents do not inherit CLAUDE.md, so append it verbatim
to the agent prompt.

Give the sub-agent everything gathered in Step 1 (file contents, not just paths — it
should not need to re-read them), the volatility tiering scheme from Step 2, and this
consolidation contract:

1. **Bounded output.** Each file written under `memory/` in the staging directory must
   be **≤ 150 lines**. If consolidated content would exceed that, split by topic rather
   than truncating facts.
2. **Provenance required.** Every merged fact must carry a citation in the form
   `(source: <file>, <date>)`. If a fact merges two sources, cite both.
3. **Never auto-resolve contradictions.** If two sources disagree (e.g. a status claim,
   a "decided X" vs. a later "actually Y"), do NOT pick a winner. Collect it into
   `contradictions.md` with both sources quoted and cited, for a human to resolve.
4. **Propose pattern promotions, don't apply them.** If the same approach/gotcha
   recurs across 2+ sources, propose it as a candidate for `docs/knowledge/patterns.md`
   in `promotions.md`. This is a proposal file only — the sub-agent must not edit
   `docs/knowledge/patterns.md` itself.
5. **Write ONLY inside the staging directory** (see Step 4 path). It must not modify
   `docs/memory/*.md`, any `.claude/sessions/*.yaml` file, or `docs/knowledge/*`.

Give the sub-agent write access scoped to the staging directory only; it should not
need to touch anything else.

## Step 4: Staging output

The sub-agent (or you, after it returns its proposed content) writes to:

`docs/memory/.dream-output/<YYYY-MM-DD-HHMM>/`

containing:
- `memory/*.md` — the proposed replacement set for `docs/memory/`
- `diff.md` — human-readable summary: counts and lists of added / merged / dropped
  entries, plus a contradictions count
- `manifest.yaml` — inputs used (memory file list, session file list with count),
  timestamp, model used, session count. The memory-file list MUST use this exact
  schema — `dream-accept.sh` parses it to remove the consumed sources (true swap;
  a missing/unparseable list degrades the accept to additive-only with a warning):

  ```yaml
  memory_files:
    - docs/memory/some-file.md
    - docs/memory/another-file.md
  ```

  List every `docs/memory/*.md` file whose content was consumed into the staged
  output (i.e. files the swap should remove). Do NOT list memory files that were
  left out of the consolidation — they survive the swap untouched.
- `contradictions.md` — per contract item 3 above (may be empty / "none found")
- `promotions.md` — per contract item 4 above (may be empty / "none proposed")

Use the timestamp format `YYYY-MM-DD-HHMM` for the directory name (matches the session
handoff filename convention).

## Step 5: Report and hand off review

Print:

> **Dream pass complete.** Staged at `docs/memory/.dream-output/<timestamp>/`.
> - Inputs: [N] memory files, [M] session files
> - Proposed: [X] merges, [Y] drops, [Z] contradictions flagged, [W] pattern promotions proposed
>
> Review `docs/memory/.dream-output/<timestamp>/diff.md` before accepting.
> - To accept: `/tools:dream-accept <timestamp>`
> - To reject: delete the staging directory — nothing in `docs/memory/` has changed.

Do not call `/tools:dream-accept` yourself. This command's job ends at staging.

## Notes

- Nothing outside `docs/memory/.dream-output/<timestamp>/` is written by this command.
- This command follows the project bash rules: no `&&`/`||`/`;` chaining, no pipes, no
  heredocs in any shell step it or its sub-agent performs. Use separate steps or write
  a script file if a step needs more than a single simple command.
- Opt-in only — this command does not run automatically (unlike the PreCompact
  auto-checkpoint hook). Run it manually when memory feels cluttered or stale.
