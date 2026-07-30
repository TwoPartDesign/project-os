# Brief: Compaction Gate
Created: 2026-07-29
Updated: 2026-07-30
Status: IMPLEMENTED

> **Naming note.** "Gate" is a historical name. The design started as a blocking
> gate and became a non-blocking handoff chain once CLI verification showed a
> block reason cannot reach Claude on the auto-compaction path. The directory
> name is kept so links and the ROADMAP entry stay stable; nothing in the
> shipped implementation blocks anything.

## Problem

When auto-compaction fires, the session's working context is replaced by a
summary. Everything not written to disk before that moment is gone — and the
things most worth keeping are exactly the things a shell script cannot
reconstruct: *why* a decision was made, which alternatives were rejected, where
precisely a half-finished edit stopped, which gotcha cost forty minutes.

Project OS already has a `PreCompact` hook (`.claude/hooks/pre-compact.sh`), but
it is a passive checkpointer. Because hooks are shell commands with no model
access, everything it writes is derived from the filesystem:

- `phase` — from the presence of `[-]` / `[~]` markers in ROADMAP.md
- `feature` — first ROADMAP section containing such a marker
- `in_progress` — the `[-]` task lines, verbatim
- `modified_files` — `git diff --name-only`, every entry annotated with the
  literal string `"uncommitted change"`

The fields that carry the irreplaceable context are hardcoded empty:
`completed: []`, `decisions: []`, `blockers: []`, and a `context_notes` block
whose entire content is a sentence about the hook itself. The
`compact_instruction` — the one field designed to steer the summarizer — is a
single interpolated line, `"Working on <feature>. In-progress tasks: <list>."`,
and nothing ever feeds it to the compactor. The hook's `additionalContext`
output advertises the checkpoint's *path*, not its contents.

The result: a checkpoint that reliably records what any later `git status` would
have told you, and reliably loses everything else.

Five secondary defects compound it:

1. **The 75% threshold is inert.** `settings.json` sets
   `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75"`, but that override is read only on
   the proactive compaction path, which is itself gated behind
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Without the second variable the first does
   nothing and compaction fires at the model's hard context limit. `#T20` already
   asked someone to "verify/remove" this variable; it was never resolved, and the
   2026-07-11 staleness audit (`docs/audits/2026-07-11-staleness-audit.md:52`)
   flags it again.

2. **No headroom by construction.** A requirement that real work be done
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
   comment still refers to "the 50% auto-compact" — a threshold that has not
   been configured since the value became 75. Tool count is uncorrelated with
   context size: one `Read` of a large file outweighs fifty `Bash` calls.

5. **The checkpoint's ROADMAP parsing never matched.** Found while building the
   behaviour tests: `pre-compact.sh` anchored its markers as `^\s*\[-\]`, but
   ROADMAP tasks are markdown list items (`- [-] Task #T1`), so the marker is
   never at line start. Every auto-checkpoint ever written recorded
   `phase: "ad-hoc"`, `feature: "none"`, and `in_progress: (none)` regardless of
   what was actually in flight — the one part of the checkpoint that was supposed
   to work, silently didn't.

## Proposed Solution

Do not gate compaction. **Steer it**, in three stages, using two channels
verified against the shipped CLI.

The original proposal — block `PreCompact` (exit 2) until a fresh handoff exists
— was dropped after verification. Blocking is possible, but on the auto path the
block reason reaches only a debug log and a fixed-string notification that omits
it (suppressed entirely when `isAutoCompact`); the reactive and precomputed
paths never consult it at all. A block would defer compaction without telling
anyone why. See design § CLI Verification.

What ships instead:

1. **Ask early, via PostToolUse.** `compact-suggest.sh` is rewritten. It reads
   the current context size out of the transcript's `usage` records
   (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`) and,
   when that passes a percentage of the declared window, injects
   `hookSpecificOutput.additionalContext` — the one channel that reaches Claude's
   context — instructing it to run `/tools:handoff` *now*, with a task-tuned
   `compact_instruction`. One nudge per compaction cycle, tracked by a
   per-session marker in `.claude/logs/`.

2. **Claude writes the handoff.** The only stage that can capture decisions and
   rationale, because only the model has them. `/tools:handoff` is updated to
   make `compact_instruction` mandatory and to explain that it is written *to the
   summarizer*, not to a human reader.

3. **Forward it, via PreCompact stdout.** `pre-compact.sh` reads the newest
   handoff written since the last compaction, extracts its `compact_instruction`
   block scalar, and prints it on stdout. The runtime collects PreCompact stdout
   into `newCustomInstructions` and merges it into the compaction's own custom
   instructions — so the text the model authored becomes guidance the summarizer
   actually receives. The hook also runs `system-map.ts check` read-only and
   appends a drift caveat, keeps writing its filesystem-derived checkpoint as a
   fallback, and resets the nudge baseline so stage 1 can fire again next cycle.

Headroom comes from setting both threshold variables:
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75"` alongside
`CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000"`, which activates the proactive path
that makes the percentage effective. 75% of a declared window leaves roughly a
quarter of the context to write the handoff in.

No escape hatch is needed, because nothing blocks. That is the design's main
advantage over the original: a session can never be wedged at its context
ceiling by its own governance layer, because the governance layer only ever
talks.

## Success Criteria

- [x] Auto-compaction triggers against a declared window rather than the model's
      hard context limit — both env vars set, not just the percentage
- [x] Rising context pressure injects an instruction into Claude's context to
      write a handoff, exactly once per compaction cycle
- [x] The `compact_instruction` authored in that handoff reaches the compaction
      summarizer — emitted on `pre-compact.sh` stdout, which the runtime forwards
      as `newCustomInstructions`
- [x] An unfilled template placeholder is treated as no instruction at all
- [x] A handoff written before the last compaction is ignored — it describes
      work that has already been summarized away, not the state being compacted
      away now
- [x] `pre-compact.sh` stdout is plain text on every path; it never emits a JSON
      envelope, which the runtime would forward verbatim as instruction text
- [x] When `node scripts/system-map.ts check` reports drift, the compaction
      instructions carry that caveat; the hook writes nothing under `docs/maps/`
      on any path
- [x] Compaction is never blocked or deferred by this feature — no wedge is
      possible by construction
- [x] The filesystem-derived checkpoint still gets written, and now records the
      real phase/feature/in-progress task instead of `ad-hoc`/`none`
- [x] Marker files are removed by `session-end-cleanup.sh` and pruned after 7
      days for sessions that crashed
- [x] `compact-suggest.sh` no longer claims a 50% threshold or counts tool calls
- [x] `tests/compaction-hooks.sh` covers nudge-once-per-cycle, baseline reset,
      instruction extraction and placeholder rejection, freshness, containment
      (both the escaping symlink and the in-scope-sibling symlink), `session_id`
      traversal sanitation, checkpoint debounce, and malformed stdin

## Constraints

**Hard**

- Hooks are shell commands. They cannot invoke the model, so no hook can
  author a detailed handoff itself. This is the constraint the whole design
  routes around, not one it can relax.
- ~~`PreCompact` receives `custom_instructions` as **input only**.~~
  **Retracted** — verified false against the shipped CLI. A `PreCompact` hook's
  stdout becomes `newCustomInstructions` and is appended to the user's own
  instructions for that compaction. The drafted message has a native channel;
  see design § CLI Verification.
- ~~The gate must never be able to permanently prevent compaction.~~
  **Moot** — nothing blocks. Retained as a note on why the blocking design was
  the riskier one even before verification killed it.
- A blocking `PreCompact` cannot explain itself on the auto path. Verified, and
  the reason the architecture inverted. Any future proposal to block must first
  disprove this.
- `pre-compact.sh` stdout is forwarded verbatim to the summarizer as
  instructions. Plain text only; print nothing when there is nothing to say.
- `.claude/rules/bash.md` — no pipes, no `$()` in commands, no bare `cd`,
  scripts in files. Applies to anything the hooks instruct Claude to run.
- Must not regress the existing auto-checkpoint: sessions that compact without
  a rich handoff still need the filesystem-derived YAML they get today.
- Portability: hooks run on Windows/Git Bash as well as Linux/macOS. No
  `find -printf`; handoff filenames sort chronologically, so `sort | tail -1`
  substitutes.

**Soft**

- Prefer extending `pre-compact.sh` over adding a second `PreCompact` hook —
  two hooks on one event with independent exit codes is harder to reason about.
- Prefer reusing `/tools:handoff`'s existing YAML schema over inventing a
  feature-specific document format.
- The existing 10-minute checkpoint debounce is a reasonable default. It now
  gates the *file write only* — instruction forwarding happens on every
  compaction, or a second compaction within ten minutes loses its guidance.

## Non-Goals

- Changing how the compaction summarizer works. We can only influence it
  through the instructions it receives.
- Replacing `/tools:handoff`. This feature *invokes* it; it does not
  reimplement it.
- Auto-running `/tools:dream`. `.claude/plans/cryptic-napping-sonnet.md:56`
  already decided that firing consolidation on PreCompact is "too expensive and
  too eager" — that decision stands.
- ~~Gating *manual* `/compact`.~~ **Superseded.** Since nothing blocks, the
  matcher is `*`: a manual `/compact` also gets its checkpoint and forwards its
  instruction. The original non-goal existed to avoid second-guessing an
  explicit user request — an advisory hook does not second-guess anything.
- Measuring real context-token usage inside the hook. The hook has no access to
  it; the threshold is the harness's job.

## Research Findings

**`PreCompact` can block — but not usefully on the auto path.** The hooks
reference's exit-code table lists `PreCompact | Yes | Blocks compaction`. Binary
inspection of the shipped CLI qualified this: manual `/compact` genuinely aborts,
but auto-compaction routes the block reason to a debug log and a reason-less
notification, and the reactive/precomputed paths never read it. A blocked
auto-compaction *is* retried later — verified — so the session is not wedged;
it simply keeps running uncompacted with no one told why.

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
usability cost, accepted and documented.

**Configuring any PreCompact hook disables precompute reuse** (`miss_hook`), so
the proactive path recomputes rather than reusing a cached summary. Accepted:
correctness of the handoff chain over a saved recomputation.

**Internal prior art.** `pre-compact.sh` already establishes the file layout,
the YAML schema, and the debounce pattern. `compact-suggest.sh` and
`session-end-cleanup.sh` already establish a per-session marker convention in
`.claude/logs/` — `session_id` extracted from stdin JSON, sanitized with
`tr -cd '[:alnum:]_-'`, cleaned on `SessionEnd`, pruned at 7 days. The
implementation reuses that convention and promotes the extraction into
`_common.sh` (`session_id_from_json`, `json_string_field`) rather than
triplicating it.

**The advisory convention survives.** Every hook in `.claude/hooks/` opens with
`set -euo pipefail; trap 'exit 0' ERR` and is documented as "advisory — never
surfaces errors to Claude Code". The blocking design would have broken that
pattern and needed a recorded decision; the shipped design does not break it.

**Unadopted events.** The staleness audit
(`docs/audits/2026-07-11-staleness-audit.md:73`) lists `PostCompact` among hook
events Project OS has not adopted. Still unadopted — it cannot enforce anything,
and the instruction channel made it unnecessary for verification.

## Open Questions

1. ~~What value for `CLAUDE_CODE_AUTO_COMPACT_WINDOW`?~~ **Resolved: 200000.**
   The status-line decoupling cost is accepted and noted in the README.
2. ~~What exactly counts as a "fresh" handoff?~~ **Resolved:** written within
   `PROJECT_OS_HANDOFF_MAX_AGE_MIN` (default 30) of the compaction. Wall-clock
   age is coarse but is the only signal available to a shell hook; the env var
   exists so it can be tuned without an edit.
3. ~~Does the gate block on system-map drift, or heal it itself?~~ **Resolved:
   neither.** Healing reads the working tree while the map's authority is the
   git index, and mid-build drift is expected rather than actionable. The hook
   runs `check` read-only and forwards the verdict as a caveat. See design
   Architecture Decision 3.
4. ~~Exit code 2 with stderr, or exit 0 with `{"decision":"block",...}`?~~
   **Moot** — nothing blocks.
5. ~~Should the gate ever block when there are no uncommitted changes and no
   in-progress tasks?~~ **Moot** for the same reason. The nudge does fire in a
   read-only research session; the cost is one ignorable instruction, and a
   research session's *findings* are exactly the kind of thing worth handing off.
6. ~~Where does the auto-checkpoint YAML fit once a rich handoff exists?~~
   **Resolved: still written.** It is cheap, it is the fallback when no handoff
   was written, and its `context_notes` now states explicitly which case applies.

7. ~~`PROJECT_OS_COMPACT_NUDGE_BYTES` (default 1,200,000) is an uncalibrated
   proxy.~~ **Resolved: the proxy was removed rather than calibrated.** The
   premise behind it — that hooks receive no token count — was wrong. Every
   assistant record in the transcript carries a `usage` object whose
   `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` is the
   real context size, in the same unit as the window. Bytes were also not a
   conservative approximation: the transcript keeps every discarded turn, so it
   diverges further from real context after each compaction. Measured live at
   2,897,308 bytes against 106,432 tokens. The nudge now fires at a percentage
   of the declared window, derived as `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE − 15`.
   Bytes remain only as a fallback for a transcript format change.

8. ~~Handoff discovery globbed `.claude/sessions/` project-wide with no reference
   to the session id, so two sessions sharing a checkout could steer each other's
   compaction.~~ **Resolved (round 6): authorship is recorded, not declared.**
   Raised in PR review and reproduced against the round-5 hook. The handoff
   document cannot carry its own session id — the model writing it has no
   reliable way to learn one — but `compact-suggest.sh`'s PostToolUse payload
   carries `session_id` and `tool_input.file_path` together, so it stamps
   `.compact-handoff-<session_id>`. `pre-compact.sh` prefers that record and
   falls back to the newest handoff *no other session has claimed*.

**Still open:**

Nothing. The nudge threshold is the last item that required real-session
observation, and it no longer does — it is measured, not estimated.
