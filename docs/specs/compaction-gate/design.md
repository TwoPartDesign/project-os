# Design: Compaction Gate
Created: 2026-07-29
Status: DRAFT
Brief: ./brief.md

## Architecture Decision

**Promote `PreCompact` from advisory checkpointer to a blocking gate that fails
closed once, then fails open.**

The governing constraint is that hooks are shell commands with no model access,
so no hook can *author* a detailed handoff. But `PreCompact` is one of the few
hook events that can block (exit 2 → "Blocks compaction"). Blocking is therefore
the only mechanism by which the platform can *require* work it cannot itself
perform: the hook refuses, and the refusal lands in front of the one participant
who still has full context and can act on it.

The design rests on three decisions that each close off a failure mode:

**1. Blocking is one-shot per session.** A gate that can block indefinitely can
wedge a session at its context ceiling — compaction denied, context exhausted,
no path forward. The gate writes a per-session state file when it blocks; on the
next attempt, if the handoff still is not there, it proceeds anyway with a
`systemMessage` warning. The gate's job is to make skipping the handoff
*deliberate*, not impossible.

**2. Blocking buys nothing without headroom.** Refusing to compact at the hard
context limit leaves no room to write the handoff that the refusal demands.
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75"` is already set but is inert unless
Claude Code takes its *proactive* compaction path — and per the env-vars
documentation, merely setting `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is one of the
conditions that enables that path. Setting it to `200000` — equal to the
standard model window — turns the existing 75% into a real trigger point while
leaving the status line's percentage aligned with it. The threshold config is
not a nice-to-have alongside the gate; it is what makes the gate survivable.

**3. Anything the hook can fix, it fixes; it only blocks on what it cannot.**
System-map drift is deterministic and repairable without a model
(`system-map.ts check --heal`). Blocking on a condition the hook could resolve
itself is ceremony that costs a round-trip and adds a second way to fail. So the
gate *heals* the map and *blocks* only on the missing handoff — one blocking
condition, one reason string, one thing to fix.

The drafted compact message needs no new document type. `/tools:handoff` already
specifies a `compact_instruction` field (`handoff.md:74-78`); it is simply never
read by anything. The gate reads it from the freshest handoff and emits it as
`hookSpecificOutput.additionalContext`, which is the only channel available —
`custom_instructions` arrives as hook *input* and cannot be rewritten.

## Alternatives Considered

| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|
| **Status quo + richer bash extraction** — keep the hook advisory, teach it to scrape more from git and ROADMAP | No new failure modes; nothing can wedge | Cannot produce decisions, rationale, or "where I left off" at any level of effort — those exist only in the model's context | Fails the actual requirement. The missing information is categorically unavailable to a shell script |
| **`Stop` hook demands a handoff** | Non-blocking event, no wedge risk | Fires at turn end, unrelated to context pressure; would demand a handoff on every trivial turn | Wrong trigger. Compaction pressure is the event we care about |
| **`PostCompact` writes the record** | Simple, cannot block anything | Runs *after* the context is gone — nothing left to write down | Structurally too late |
| **Block unconditionally until a handoff exists** | Strongest guarantee | A non-compliant or crashed turn wedges the session permanently at its context limit | Unacceptable. Availability beats completeness for a governance layer |
| **Gate blocks on map drift too** | Enforces map freshness through the same channel | Adds a second block reason for something the hook can repair itself in-process | Needless round-trip; heal instead |
| **Separate second `PreCompact` hook for the gate** | Separation of concerns | Two hooks on one event with independent exit codes; ordering and combined-exit semantics get subtle | One hook, one exit decision |

## Constraint Analysis

| Constraint | Type | Verified | Notes |
|------------|------|----------|-------|
| Hooks cannot invoke the model | HARD | ✅ | Hook config is `{"type":"command"}` shell invocation (`settings.json:176-181`) |
| `PreCompact` can block via exit 2 | HARD | ✅ | Hooks reference exit-code table: `PreCompact \| Yes \| Blocks compaction` |
| `custom_instructions` is input-only | HARD | ✅ | Listed as a `PreCompact` *input* field; no documented output field overrides it |
| Gate must never permanently block | HARD | ✅ | Design constraint; enforced by the one-shot state file |
| No pipes / `$()` / bare `cd` in hook-instructed commands | HARD | ✅ | `.claude/rules/bash.md`; existing hooks comply (`pre-compact.sh:56-61` uses awk-reads-file, not a pipe) |
| Auto-checkpoint must not regress | HARD | ✅ | `pre-compact.sh:137-171` is the current behavior; retained on all paths |
| Hooks run on Git Bash (Windows) | HARD | ⚠️ | `find -mmin`, `find -newer`, `awk`, `tr` are all already used by shipped hooks, so the dependency set does not grow. Not tested on Windows in this repo |
| `system-map.ts check --heal` needs Node ≥ 22.18 | HARD | ✅ | `_common.sh:57-87` `node_available()` exists precisely for this; heal degrades loudly |
| Reuse `/tools:handoff` YAML schema | SOFT | ✅ | `handoff.md:28-79` already defines it, `compact_instruction` included |
| 10-minute checkpoint debounce | SOFT | ✅ | `pre-compact.sh:22-25`. Must not apply to the gate decision — see Risks |
| Hooks are "advisory, never surface errors" | SOFT | ✅ | Every hook opens `trap 'exit 0' ERR`. The gate deliberately breaks this; recorded as an ADR |

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Exit 2 from `PreCompact` blocks compaction and shows stderr to Claude | VERIFIED | Hooks reference exit-code-2 table |
| `{"decision":"block","reason":...}` also blocks, showing the reason to the *user* | UNVERIFIED | Appears in narrative docs but not in the exit-code table. **Not load-bearing** — design uses exit 2, because the actor who must respond is Claude, not the user |
| Setting `CLAUDE_CODE_AUTO_COMPACT_WINDOW` enables the proactive-compaction path | VERIFIED | env-vars: the override "only causes earlier compaction when Claude Code compacts proactively: when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set, in cloud sessions, and on Sonnet 4.6 and Opus 4.6..." |
| Window value is capped at the model's real context window | VERIFIED | env-vars: "The value is capped at the model's actual context window" |
| A blocked auto-compaction is retried later rather than abandoned for the session | UNVERIFIED | **Load-bearing.** If a block permanently disables auto-compaction for the session, the escape hatch never runs and the session drifts to its hard limit. Mitigation is in Risks; must be confirmed empirically in build |
| `system-map.ts check` exits 3 on drift, `--heal` regenerates | VERIFIED | `scripts/system-map.ts:12`, `:575-596` |
| `session_id` is present in `PreCompact` stdin JSON | VERIFIED | Documented common input field; `pre-compact.sh:3` already documents receiving it |
| `.claude/sessions/` may not exist | VERIFIED | Absent in this checkout; `pre-compact.sh:22` `find`s it before `mkdir -p` at `:34`, tolerated via `2>/dev/null` |

## Technical Approach

### Gate state machine

One state file per session: `.claude/logs/.compact-gate-<session_id>`, single
line, `<state> <epoch>` where state ∈ `blocked` | `passed`. It reuses the
sentinel convention `compact-suggest.sh:17-23` and `session-end-cleanup.sh:19-25`
already establish — `session_id` from stdin JSON, sanitized `tr -cd '[:alnum:]_-'`,
defaulting to `default`.

```
PreCompact fires
  │
  ├─ trigger == "manual"? ──────────────► checkpoint only, exit 0   (never gate an explicit /compact)
  │
  ├─ heal system map (node ≥22.18, else warn) 
  │
  ├─ nothing to hand off?  ─────────────► checkpoint only, exit 0
  │     (no `git diff --name-only` output AND no [-]/[~] in ROADMAP)
  │
  ├─ fresh handoff present? ────────────► write `passed`, checkpoint,
  │     (see freshness rule)               emit compact_instruction, exit 0
  │
  ├─ state == "blocked"?  ──────────────► ESCAPE HATCH: write `passed`,
  │                                        checkpoint, systemMessage warning, exit 0
  │
  └─ otherwise ─────────────────────────► write `blocked`, checkpoint,
                                           reason to stderr, exit 2
```

Checkpoint is written on **every** path. It is the fallback record when the
escape hatch fires, and it costs one `awk` pass plus one `git diff`.

### Freshness rule

A handoff qualifies when it is a regular file matching
`.claude/sessions/handoff-*.yaml` and satisfies **both**:

- `find -mmin -30` — written within the last 30 minutes, so a handoff from an
  earlier phase of a long session does not satisfy a later gate; and
- `find -newer <state-file>` — written *after* this session's last gate event,
  which is what makes the block → handoff → retry loop terminate. Skipped when
  no state file exists yet (first compaction of the session).

The 30-minute bound is the same order as the existing checkpoint debounce and
is a tunable constant at the top of the script, not a magic number inline.

Symlinks are excluded (`-type f`) and the winning path is passed through
`resolve_project_path()` (`_common.sh:8-42`) before being read, so a handoff
symlinked outside the project cannot pipe external file content into
`additionalContext`.

### The block reason (stderr, seen by Claude)

Must name exact, bash-rules-compliant next actions and state its own escape
hatch, so a turn that genuinely cannot comply knows it will not be trapped:

```
Compaction gate: no handoff for this session written in the last 30 minutes.

Before compacting, run /tools:handoff and make sure it captures:
  - decisions made and alternatives rejected
  - where exactly each in-progress edit stopped
  - a compact_instruction tuned to the current task

The system map has been healed automatically; no action needed there.
This gate blocks once per session — the next compaction proceeds regardless.
```

### Key interfaces

New helpers in `.claude/hooks/_common.sh`, both reusable and both currently
duplicated or missing:

```bash
# Extract and sanitize session_id from hook stdin JSON.
# Replaces three near-identical copies (compact-suggest.sh:18-21,
# session-end-cleanup.sh:19-21, and a new one here).
# Usage: sid=$(session_id_from_json "$INPUT")
session_id_from_json() { ...; }   # -> [[:alnum:]_-]+ or "default"

# Escape a string for embedding in a JSON string literal.
# Handles \ " newline tab and C0 control chars via \uXXXX.
# Usage: safe=$(json_escape "$text")
json_escape() { ...; }            # awk-based; no node dependency
```

`json_escape` is not optional polish: an unescaped newline or quote in a
handoff's `compact_instruction` produces malformed stdout, and a malformed
hook payload fails *silently* — the drafted message would simply never reach the
compactor with no error anywhere.

Extraction of the `compact_instruction` block scalar from the handoff YAML uses
`awk` reading the file directly (the pattern already used at
`pre-compact.sh:56-61` and `:74-82`) — no pipes, no `$()`-wrapped programs, no
YAML dependency.

### File changes

| File | Change |
|---|---|
| `.claude/settings.json` | Add `CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000"`; change `PreCompact` matcher `"auto"` → `"*"` so manual compaction still checkpoints; raise hook `timeout` 30 → 60 to cover the map heal |
| `.claude/hooks/pre-compact.sh` | Rewrite as the gate above; keep all existing checkpoint logic as the always-run tail |
| `.claude/hooks/_common.sh` | Add `session_id_from_json()`, `json_escape()` |
| `.claude/hooks/compact-suggest.sh` | Adopt `session_id_from_json()`; fix the stale "50% auto-compact" comment (`:44`); reword advisories to reference the gate |
| `.claude/hooks/session-end-cleanup.sh` | Remove `.compact-gate-<sid>`; extend the 7-day prune to `.compact-gate-*` |
| `.claude/commands/tools/handoff.md` | Make `compact_instruction` mandatory with guidance on what a good one contains; document the gate and its one-shot escape hatch |
| `tests/hook-smoke.sh` | Gate cases (below) |
| `docs/knowledge/architecture.md` | Update the `pre-compact.sh` row (`:56`) and the auto-checkpoint note (`:136`) |
| `docs/knowledge/decisions.md` | ADR: hooks may block where the platform must require model-only work |
| `docs/knowledge/patterns.md` | Pattern: "Gate on what you cannot do; heal what you can" |
| `README.md` | Update `:171` — session state is *required*, not merely auto-saved |
| `ROADMAP.md` | Draft tasks `#T117`+ under `## Feature: compaction-gate` |

### Dependencies

None. `find`, `awk`, `tr`, `git`, and optional `node` are all already required
by shipped hooks.

## Testing Strategy

Extends `tests/hook-smoke.sh`, which already drives hooks by feeding stdin JSON
and asserting exit codes (`:18-23`). Per `.claude/rules/tests.md`, each case
sets up its own state file and sessions directory and asserts specific values,
not truthiness. Names follow `[unit]_[scenario]_[expected]`:

- `precompact_no_handoff_first_attempt_blocks` — exit 2, stderr contains
  `/tools:handoff`, state file reads `blocked`
- `precompact_no_handoff_second_attempt_passes` — pre-seeded `blocked` state →
  exit 0, stdout contains a `systemMessage`, state file reads `passed`
- `precompact_fresh_handoff_passes` — handoff newer than state file and under 30
  min → exit 0, state `passed`
- `precompact_stale_handoff_blocks` — handoff with mtime 31 min old → exit 2
- `precompact_handoff_older_than_state_blocks` — the loop-termination case:
  handoff recent but predating the `blocked` marker
- `precompact_manual_trigger_never_blocks` — `"trigger":"manual"` with no
  handoff → exit 0
- `precompact_clean_tree_no_tasks_passes` — nothing to hand off → exit 0
- `precompact_compact_instruction_reaches_stdout` — handoff whose
  `compact_instruction` contains a double-quote, a backslash and a newline →
  stdout parses as JSON (`node -e` via a script file per bash rules) and the
  decoded `additionalContext` equals the original text
- `precompact_session_id_traversal_is_sanitized` — `session_id` of
  `../../etc/passwd` writes `.claude/logs/.compact-gate-etcpasswd`, and no file
  is created outside `.claude/logs/`
- `precompact_symlinked_handoff_is_ignored` — per `.claude/rules/tests.md`'s
  in-bounds-indirection requirement, both a symlink escaping the project *and* a
  symlink to an in-scope sibling are rejected by `-type f`
- `precompact_checkpoint_written_on_every_path` — asserted in the block, pass,
  and escape-hatch cases alike

Manual verification required in build (not automatable here): that a real
auto-compaction fires near 75% of the configured window, and — the load-bearing
unknown — that a blocked auto-compaction is retried rather than abandoned.

## Security Considerations

- **Path traversal via `session_id`.** The sentinel filename embeds a value from
  hook stdin. Sanitized to `[[:alnum:]_-]` by `session_id_from_json()`, matching
  the existing convention; covered by a test.
- **Symlink escape via handoff discovery.** `find -type f` plus
  `resolve_project_path()` containment; in-bounds-symlink and prefix-collision
  cases tested per `.claude/rules/tests.md`.
- **JSON injection into hook stdout.** `compact_instruction` content is
  user-authored free text emitted into a JSON payload. Escaped via
  `json_escape()`; a malformed payload fails silently, so this is a correctness
  risk as much as a security one.
- **Secret leakage into `additionalContext`.** A handoff could contain a
  credential pasted into `context_notes`. The gate forwards only
  `compact_instruction`, never the whole file — a deliberate narrowing.
- **No new write surface.** The gate writes only under `.claude/logs/` and
  `.claude/sessions/`, both already written by shipped hooks. The map heal
  writes `docs/maps/`, which is the documented owner of that path.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A blocked auto-compaction is not retried, so the escape hatch never runs and the session drifts to its hard limit | Medium | High | Verify empirically before merge. If confirmed, downgrade the first gate failure to a non-blocking `systemMessage` + `additionalContext` nudge and keep exit 2 only where a retry is observed |
| Session wedged by repeated blocking | Low | Critical | One-shot state file; `passed` is written *before* exit on the escape-hatch path so a crash mid-hook cannot re-arm the block |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the status line from the real trigger | Medium | Low | Set it to `200000`, equal to the standard model window, so the two agree. Document that extended-context (1M) projects must raise it or accept the skew |
| Map heal exceeds the hook timeout | Low | Medium | Raise timeout to 60s; heal failure is non-fatal and reported in `additionalContext`, never a block reason |
| The 10-minute checkpoint debounce suppresses the gate | Medium | High | **The debounce must move.** Today it is the first thing the script does (`pre-compact.sh:22-25`) and it `exit 0`s — which would skip the gate entirely on any compaction within 10 minutes of a checkpoint. Debounce the *checkpoint write*, never the gate decision |
| Gate fires on trivial read-only sessions | Medium | Low | Skip when the tree is clean and no `[-]`/`[~]` tasks exist |
| Handoff written but `compact_instruction` left as the template placeholder | Medium | Medium | `handoff.md` makes the field mandatory with concrete guidance; gate emits whatever is there rather than validating prose |
| Breaking the "hooks are advisory" convention confuses future maintainers | Medium | Low | ADR in `decisions.md` stating the exception and its bounds: only `PreCompact`, only for missing model-authored artifacts, always one-shot |

## Self-Review Findings

Reviewed inline rather than by sub-agent. Findings are listed unresolved — they
are revisions to apply before this design is approved, not decisions already
taken.

**CRITICAL — `trap 'exit 0' ERR` silently disables the gate.** Every hook in
this repo opens `set -euo pipefail` followed by `trap 'exit 0' ERR`
(`pre-compact.sh:7-8`). That pairing is correct for an advisory hook and
actively wrong for a gate: any incidental non-zero return — a `grep -c` that
matched nothing, a `find` on a missing directory — converts into `exit 0`, which
*is* the pass verdict. The gate would fail open permanently and no error would
appear anywhere. A gate cannot inherit the advisory boilerplate unexamined. It
needs an explicit trap that logs the internal failure and then chooses to fail
open deliberately, so "the gate passed" and "the gate broke" are distinguishable
in `.claude/logs/`.

**HIGH — the state machine and the block reason disagree.** The reason string
promises "this gate blocks once per session". The state machine does not
implement that: after the escape hatch writes `passed`, a later compaction with
no fresh handoff falls through and blocks a second time. Re-arming per
compaction cycle is the better behavior — each compaction genuinely should
demand a current handoff — so fix the *message*, not the logic: "blocks once per
compaction cycle; the retry proceeds regardless."

**HIGH — `git diff --name-only` is the wrong emptiness test.** The
"nothing to hand off" skip and the checkpoint's `modified_files` (`:86`) both
use `git diff --name-only`, which reports neither staged nor untracked files. A
session that staged all its work, or created new files, reads as a clean tree —
so the gate skips and the checkpoint records no modified files, precisely when
there is most to lose. Use `git status --porcelain`. This is a pre-existing bug
in the current checkpoint, not one introduced here, and it should be fixed in
the same change.

**MEDIUM — the load-bearing unknown is not scheduled.** "A blocked
auto-compaction is retried" is marked UNVERIFIED and carries a High-impact risk,
but nothing in the plan verifies it before the gate ships. It should be its own
task, sequenced first, with the fallback design (non-blocking nudge) as its
declared exit if the answer is no.

**LOW — 30 minutes is asserted, not derived.** The freshness bound is borrowed
from the checkpoint debounce, which was chosen for a different purpose. It is a
named constant, so it is cheap to change once there is evidence about how long a
typical session runs between handoff and compaction.
