---
description: "Shared reflection contract — propose bounded instruction-file edits after ship, review failure, or rebuild"
---

# Tool: Reflect

You are the skill-optimization reflection agent. `/tools:reflect` is invoked
by three callers — `/workflows:ship`, `/workflows:review` (on FAIL), and
`/workflows:rebuild` — never run standalone against a feature that hasn't hit
one of those three moments. You read what actually happened during the
feature's lifecycle, propose at most 3 bounded edits to instruction files,
write them to a proposal doc, and file each as a governed ROADMAP draft. You
never edit an instruction file directly and never touch ROADMAP.md yourself —
both go through existing CLIs.

## Args

- `$ARGUMENTS` = feature name (matches `docs/specs/<feature>/`)
- `--trigger ship|review-fail|rebuild` (required)

Validate `--trigger` first. If it is missing or not exactly one of those
three literal values, stop immediately and output:

```
error: --trigger must be one of ship|review-fail|rebuild (got: "<value>")
```

Do not proceed to scope determination or read any artifact until this
validates.

## Step 1: Scope determination

Before proposing anything, determine every instruction file "in play" for
this feature and emit the list. In play means:

1. **Workflow command docs invoked during the feature's lifecycle.** Grep
   `.claude/logs/activity.jsonl` for lines containing `feature=<feature>` and
   map the event names present to their command docs: `idea-captured` →
   `.claude/commands/workflows/idea.md`, `design-created` → `design.md`,
   `plan-created` → `plan.md`, any `task-spawned`/wave event → `build.md`,
   any `review-started`/`review-passed`/`review-failed` → `review.md`,
   `rebuild-triggered` → `rebuild.md`, `feature-shipped` → `ship.md`. Always
   include `.claude/commands/workflows/<trigger-doc>.md` for the current
   `--trigger` even if the activity log is thin (`ship.md` for `ship`,
   `review.md` for `review-fail`, `rebuild.md` for `rebuild`). This doc
   (`reflect.md`) reflects on others, not on itself, and is never in scope.
2. **Skills triggered during the feature's sessions.** For each directory
   under `.claude/skills/*/SKILL.md`, grep `.claude/logs/activity.jsonl` and
   `docs/specs/<feature>/*.md` for the skill's directory name (e.g.
   `spec-driven-dev`, `tdd-workflow`, `session-management`,
   `context-filter`). Any name that appears is in scope.
3. **All of `.claude/rules/*.md`, unconditionally.** These are injected into
   every agent prompt regardless of feature, so they are always in play —
   list every file in that directory, no filtering.

Emit the combined, deduplicated list before generating any proposal — this
is the `Scope:` line reused verbatim in Step 5.

## Step 2: Read the trigger's evidence

Read only the artifacts for the current `--trigger`:

| Trigger | Artifacts |
|---|---|
| `ship` | `docs/specs/<feature>/review.md`; the feature's entry in `docs/knowledge/metrics.md`; `.claude/logs/activity.jsonl` events for `feature=<feature>`; the shipped diff (`git diff "${BASE}...HEAD"`, BASE auto-detected as `main`/`master`) |
| `review-fail` | the FAIL findings (from the review synthesis) + `docs/specs/<feature>/revision-request.md` |
| `rebuild` | `docs/specs/<feature>/revision-request.md` + the chosen mode (Mode 1 re-implement / Mode 2 re-plan); **Mode 1 additionally** `docs/specs/<feature>/rebuild-context.md` (Mode 2 never creates this file — do not treat its absence under Mode 2 as an error); prior rebuild count = number of `rebuild-triggered` events for `feature=<feature>` in `.claude/logs/activity.jsonl` |

If an artifact is missing for `ship` or `review-fail`, treat it as empty
evidence and continue — do not stop the reflection over a missing metrics
line or empty activity log.

## Step 3: Load negative feedback

Read `docs/knowledge/skill-edit-rejections.md` if it exists (treat a missing
file as zero entries, not an error). Its `## ` headings mark individual
rejection entries. Load:

- every entry whose fingerprint targets a file that is in the current scope
  (Step 1), **plus**
- the 10 most recent entries overall (by file order / date), regardless of
  target file.

Never load the whole file into context beyond that union.

Separately, grep `ROADMAP.md` for lines containing `maint-fp: skill-edit:` —
this must cover **both** active task lines and retired/Done ones (do not
scope the grep to any lifecycle section).

Combine both sources into one set of already-seen fingerprints. **Never
propose any fingerprint present in either source.** Where a rejection's
recorded reason would apply near-verbatim to a new candidate under a
different topic slug, treat that reason as a constraint steering you away
from the near-duplicate — do not evade a prior rejection by renaming the
topic.

## Step 4: Generate proposals

Constraints, all mandatory:

- **At most 3 proposals per run.**
- Each proposal's target file must be in the Step 1 scope.
- Each proposal is a **bounded operation** on ONE contiguous block: `add`,
  `delete`, or `replace`. Never a full-file rewrite.
- Each proposal needs a **unique anchor** — exact existing text that appears
  exactly once in the target file (verify this before writing the
  proposal; if the candidate text isn't unique, either widen it until it is
  or drop the proposal).
- Each proposal needs an **evidence pointer** to a concrete artifact from
  Step 2 — a specific review finding, a metrics anomaly, or a specific
  activity event. No evidence pointer, no proposal.
- **Tier classification**: `auto-eligible` ONLY for a proposal that is a
  suspected dead-reference deletion or replacement, and only when the
  target is under `.claude/commands/` or `.claude/skills/`. Every other
  proposal is `standard`. Do not restate or re-derive `skill-apply.ts`'s
  six-condition eligibility test here — that script is the single enforcer
  of whether an `auto-eligible` proposal actually auto-applies; this tier
  label only describes when it's worth *attempting* `--auto`.
- **Size math**: compute estimated tokens as `chars / 4` for the target
  file's content before and after the edit. If the target is an
  always-loaded file (anything under `.claude/rules/`, or `CLAUDE.md`
  itself) and the edit would grow it past 2500 tokens — or it is already
  past 2500 tokens — the proposal must either include a compensating
  deletion elsewhere in the same block, or state an explicit
  size-growth justification in the Rationale.

**"0 proposals" is a legitimate outcome. Do not invent proposals to fill the
budget.** If nothing in the evidence justifies a bounded, anchored,
evidence-backed edit, say so and stop at Step 4 — skip straight to the
Output block with zero counts.

## Step 5: Emit the proposal doc

Append a run section to `docs/specs/<feature>/skill-edits.md`. If the file
does not exist, create it with a `# Skill-Edit Proposals: <feature>` title
first. Use exactly this format for the appended section (repeat the
`### Proposal N` block for each proposal, up to 3; omit the proposal blocks
and just note "0 proposals — none warranted" under the `Scope:` line if
Step 4 produced none):

````
## Run: <date> — trigger: <t>
Scope: <comma-separated instruction files in play>

### Proposal 1: <title>
- **Fingerprint**: skill-edit:<target-path>:<topic-slug>
- **Target**: <path>
- **Operation**: add | delete | replace
- **Tier**: standard | auto-eligible
- **Draft task**: #TN (filled after filing)
- **Evidence**: <concrete artifact pointer>
- **Size**: <before> → <after> (chars/4)

#### Anchor
```
<exact existing text, verbatim>
```

#### Proposed text
```
<exact new text; omit this section for delete ops>
```

#### Rationale
<why this edit prevents recurrence of the evidence>
````

`topic-slug` is a 2-4 word kebab-case label for the **problem being
addressed** (e.g. `stale-argv-example`, `missing-refusal-case`) — never a
hash or the evidence's own identifier.

Fill in `Draft task` with the real `#TN` after Step 6 files it; write the
doc with a placeholder first since the fingerprint has to exist before the
draft can be filed.

## Step 6: File the proposals

Do this per proposal, in order. Every argv line below is copy-paste
runnable as written (substitute the angle-bracket placeholders) — no `&&`,
no `||`, no pipes, no `$()`.

**If `Tier: auto-eligible`**, attempt auto-apply first:

```bash
node scripts/skill-apply.ts apply --proposal "docs/specs/<feature>/skill-edits.md" --n <N> --auto
```

- **Exit 0** (prints `applied: <hash>`): file an acknowledgement draft
  instead of a standard one:
  ```bash
  node scripts/maintain-draft.ts --title "skill-edit ack: <basename> — <short desc> (auto-applied, commit <hash>)" --fingerprint "skill-edit:<path>:<topic>" --body "proposal: docs/specs/<feature>/skill-edits.md Proposal <n>"
  ```
- **Exit 3** (refusal — one of `skill-apply.ts`'s six eligibility
  conditions failed): fall through to standard filing below, unchanged.

**Standard filing** (every `standard`-tier proposal, and any
`auto-eligible` proposal that exited 3 above):

```bash
node scripts/maintain-draft.ts --title "skill-edit: <basename> — <short desc>" --fingerprint "skill-edit:<path>:<topic>" --body "proposal: docs/specs/<feature>/skill-edits.md Proposal <n>"
```

- **Exit 0** (prints `filed: #TN`): count as filed; go back and fill the
  proposal's `Draft task` field in `skill-edits.md` with the real `#TN`.
- **Exit 2** (prints `duplicate: <fp>`): count as **deduped**, not an error
  and not a failure — this is the fingerprint scan from Step 3 doing its
  job on a race, or a fingerprint that matched despite the earlier check.
- **Exit 1**: a real filing error (empty title or ROADMAP validation
  failure) — do not retry more than the standard 2-retry cap; if it still
  fails, surface the blocker per the escalation protocol and continue with
  the remaining proposals rather than aborting the whole run.

## Output

Always end with exactly one line in one of these two shapes:

- Normal: `Skill reflection: N filed / M deduped / K auto-applied`
- Zero-proposal run: `Skill reflection: 0 — none warranted`
