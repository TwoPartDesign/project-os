# Brief: Compaction Gate
Created: 2026-07-29
Status: DRAFT

## Problem

When auto-compaction fires, the session's working context is replaced by a
summary. Everything not written to disk before that moment is gone — and the
things most worth keeping are exactly the things a shell script cannot
reconstruct: *why* a decision was made, which alternatives were rejected, where
precisely a half-finished edit stopped, which gotcha cost forty minutes.

Project OS already has a `PreCompact` hook (`.claude/hooks/pre-compact.sh`), but
it is a passive checkpointer. Because hooks are shell commands with no model
access, everything it writes is derived from the filesystem:

- `phase` — from the presence of `[-]` / `[~]` markers in ROADMAP.md (`:39-48`)
- `feature` — first ROADMAP section containing such a marker (`:56-61`)
- `in_progress` — the `[-]` task lines, verbatim (`:74-82`)
- `modified_files` — `git diff --name-only`, every entry annotated with the
  literal string `"uncommitted change"` (`:86`, `:124-127`)

The fields that carry the irreplaceable context are hardcoded empty:
`completed: []`, `decisions: []`, `blockers: []`, and a `context_notes` block
whose entire content is a sentence about the hook itself (`:167`). The
`compact_instruction` — the one field designed to steer the summarizer — is a
single interpolated line, `"Working on <feature>. In-progress tasks: <list>."`
(`:170`), and nothing ever feeds it to the compactor. The hook's
`additionalContext` output (`:175`) advertises the checkpoint's *path*, not its
contents.

The result: a checkpoint that reliably records what any later `git status` would
have told you, and reliably loses everything else.

Four secondary defects compound it:

1. **The 75% threshold is probably inert.** `settings.json:81` sets
   `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75"`, but per the env-vars documentation
   that override "only causes earlier compaction when Claude Code compacts
   proactively" — otherwise compaction fires at the model's hard context limit
   and the percentage has no effect. `#T20` already asked someone to
   "verify/remove" this variable; it was never resolved, and the
   2026-07-11 staleness audit (`docs/audits/2026-07-11-staleness-audit.md:52`)
   flags it again.

2. **No headroom by construction.** A gate that demands real work be done
   *before* compacting only functions if there is context left to do that work
   in. Firing at the hard limit leaves none.

3. **Map staleness is invisible across the compaction boundary.** `docs/maps/`
   is healed at commit time, from the git index. Mid-build that map is
   *expected* to be behind the working tree — drift is normal there, not a
   defect, and healing it from a hook would be wrong (the index is the map's
   source of authority, `system-map.ts:686-687`). The actual problem is that
   nothing tells the post-compaction session which state it is in. `CLAUDE.md`
   instructs consulting the system map before changing wiring, and a summarized
   session will follow that instruction with no way to know the map predates the
   work it is about to modify.

4. **The early-warning signal is a bad proxy and its documentation is stale.**
   `compact-suggest.sh` counts *tool invocations*, warning at 20 and 35, and its
   comment still refers to "the 50% auto-compact" (`:44`) — a threshold that has
   not been configured since the value became 75.

## Proposed Solution

Promote `PreCompact` from checkpointer to **gate**.

`PreCompact` is one of the hook events that can block (exit code 2 → "Blocks
compaction"). That single capability is what makes the requirement expressible:
the hook cannot *write* a detailed handoff, but it can *refuse to compact until
one exists*, handing the work back to the only participant that can do it while
full context is still in the window.

The gate checks two preconditions — a handoff document fresher than this
session's gate marker, and a system map with no un-healed drift
(`system-map.ts check` exits 3 on drift). If either fails, it blocks with a
reason naming the exact commands to run. Claude runs them, writes a real
handoff including a task-tuned `compact_instruction`, and compaction retries.
Second time through, the gate passes, reads the drafted instruction out of the
handoff, and injects it via `hookSpecificOutput.additionalContext` so the
summarizer actually receives it.

Two properties keep this from becoming a trap:

- **Headroom.** Pair the existing `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75"` with
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, which forces the proactive-compaction path
  that makes the override effective. 75% of a declared window leaves roughly a
  quarter of the context to write the handoff in.
- **A one-shot escape hatch.** The gate blocks at most once per session,
  tracked by a per-session sentinel. If the handoff still is not there on the
  retry, compaction proceeds with a `systemMessage` warning. A session must
  never be wedged at its context ceiling by its own governance layer.

## Success Criteria

- [ ] Auto-compaction demonstrably triggers near 75% of the configured window,
      not at the model's hard context limit
- [ ] An auto-compaction with no fresh handoff present is blocked exactly once,
      and the block reason names the specific commands to run
- [ ] After the blocked turn writes a handoff, the next compaction attempt
      passes the gate without further intervention
- [ ] The `compact_instruction` authored in that handoff reaches the compactor
      via `additionalContext` — verifiable in the hook's stdout
- [ ] A session whose gate blocks and whose handoff is *never* written still
      compacts on the second attempt, with a visible warning (no wedge)
- [ ] When `node scripts/system-map.ts check` reports drift, the compaction
      summary carries that caveat; the gate writes nothing under `docs/maps/`
      on any path
- [ ] Sentinel files are removed by `session-end-cleanup.sh` and pruned after 7
      days for sessions that crashed
- [ ] `compact-suggest.sh` no longer claims a 50% threshold
- [ ] `tests/hook-smoke.sh` covers the gate's block path, its pass path, and its
      escape-hatch path

## Constraints

**Hard**

- Hooks are shell commands. They cannot invoke the model, so no hook can
  author a detailed handoff itself. This is the constraint the whole design
  routes around, not one it can relax.
- `PreCompact` receives `custom_instructions` as **input only**. A hook cannot
  rewrite what the user typed after `/compact`; the drafted message can only be
  *added* alongside it via `additionalContext`.
- The gate must never be able to permanently prevent compaction. A session
  pinned at its context limit with compaction blocked has no path forward.
- `.claude/rules/bash.md` — no pipes, no `$()` in commands, no bare `cd`,
  scripts in files. Applies to anything the block reason instructs Claude to run.
- Must not regress the existing auto-checkpoint: sessions that compact without
  a rich handoff still need the filesystem-derived YAML they get today.
- Portability: hooks run on Windows/Git Bash as well as Linux/macOS.

**Soft**

- Prefer extending `pre-compact.sh` over adding a second `PreCompact` hook —
  two hooks on one event with independent exit codes is harder to reason about.
- Prefer reusing `/tools:handoff`'s existing YAML schema over inventing a
  gate-specific document format.
- The existing 10-minute checkpoint debounce (`pre-compact.sh:22-25`) is a
  reasonable default but is not sacred; the gate may need different timing.

## Non-Goals

- Changing how the compaction summarizer works. We can only influence it
  through `additionalContext`.
- Replacing `/tools:handoff`. The gate *invokes* it; it does not reimplement it.
- Auto-running `/tools:dream`. `.claude/plans/cryptic-napping-sonnet.md:56`
  already decided that firing consolidation on PreCompact is "too expensive and
  too eager" — that decision stands.
- Gating *manual* `/compact`. An explicit user request to compact should not be
  second-guessed by a hook.
- Measuring real context-token usage inside the hook. The hook has no access to
  it; the threshold is the harness's job.

## Research Findings

**`PreCompact` can block.** The hooks reference's exit-code table lists
`PreCompact | Yes | Blocks compaction` — one of a minority of events that can.
`PostCompact` exists but is explicitly non-blocking ("Shows stderr to user
only"), as is `SessionStart`. So the gate has exactly one viable insertion
point.

**The threshold variables.** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` sets "the
percentage (1-100) of the auto-compaction window at which auto-compaction
triggers", and "can only lower the threshold, so values above the default have
no effect". Critically, it "only causes earlier compaction when Claude Code
compacts proactively: when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set, in cloud
sessions, and on Sonnet 4.6 and Opus 4.6 without extended context... In other
cases, such as a local session on Opus 4.8, auto-compaction triggers when the
conversation reaches the model's context limit."

`CLAUDE_CODE_AUTO_COMPACT_WINDOW` "set[s] the context capacity in tokens used
for auto-compaction calculations", defaulting to the model's window, and
"`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is applied as a percentage of this value."
Setting it "decouples the compaction threshold from the status line's
`used_percentage`, which always uses the model's full context window" — a real
usability cost to weigh in design.

**Internal prior art.** `pre-compact.sh` already establishes the file layout,
the YAML schema, the debounce pattern, and the `additionalContext` output shape.
`compact-suggest.sh` and `session-end-cleanup.sh` already establish a
per-session sentinel convention in `.claude/logs/` — `session_id` extracted from
stdin JSON, sanitized with `tr -cd '[:alnum:]_-'`, cleaned on `SessionEnd`,
pruned at 7 days. The gate should reuse that convention rather than invent one.

**A conflicting convention.** Every hook in `.claude/hooks/` opens with
`set -euo pipefail; trap 'exit 0' ERR` and is documented as "advisory — never
surfaces errors to Claude Code". A gate must deliberately exit non-zero. This is
a genuine break with an established project pattern and needs to be recorded as
a decision, not slipped in.

**Unadopted events.** The staleness audit
(`docs/audits/2026-07-11-staleness-audit.md:73`) lists `PostCompact` among hook
events Project OS has not adopted. It is a candidate for verifying the gate
worked, though it cannot enforce anything.

## Open Questions

1. What value for `CLAUDE_CODE_AUTO_COMPACT_WINDOW`? Setting it decouples the
   status line's percentage from the actual trigger point, so the user will see
   one number and get compaction at another. Is that cost acceptable, and does
   it need documenting in the README?
2. What exactly counts as a "fresh" handoff? Newer than the sentinel is the
   simplest rule, but a handoff written at the start of a long turn could be
   stale by the time compaction fires.
3. ~~Does the gate block on system-map drift, or heal it itself?~~ **Resolved:
   neither.** Healing reads the working tree while the map's authority is the
   git index, and mid-build drift is expected rather than actionable. The gate
   runs `check` read-only and forwards the verdict as a caveat. See design
   Architecture Decision 3.
4. Exit code 2 with stderr, or exit 0 with `{"decision":"block","reason":...}`?
   The exit-code table verifies the former. The JSON form appears in the
   narrative docs but is less firmly established, and the two differ in who sees
   the message (Claude vs. the user).
5. Should the gate ever block when there are no uncommitted changes and no
   in-progress tasks? A read-only research session has little to hand off, and
   blocking it is pure friction.
6. Where does the auto-checkpoint YAML fit once a rich handoff exists — is it
   still written, or skipped as redundant?
