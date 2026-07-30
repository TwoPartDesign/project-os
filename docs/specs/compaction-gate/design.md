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

**3. The gate observes the system map; it does not touch it.** An earlier
revision had the gate run `system-map.ts check --heal`, on the reasoning that
drift is deterministically repairable without a model. That was wrong, and the
source says so: `cmdCheck` builds from `workingTreeSource` and calls
`writeArtifacts` (`:577`, `:593-595`), while `cmdPrecommit` builds from
`gitIndexSource` under the explicit docstring *"reads every input from the git
INDEX (never the working tree)"* (`:686-687`). The divergence is deliberate —
the map is meant to describe committed reality. Healing from the working tree
mid-build canonicalizes wiring that may never land, and the next commit
overwrites it from the index regardless.

Compaction also lands disproportionately *during* long build phases, which is
exactly when drift is the expected state rather than a defect. So the gate runs
`check` read-only — input hashing against `.maps.lock`, no `build()`, no writes
— and forwards the verdict as a caveat. A post-compaction session told "the map
is drifted; it reflects committed state, re-read wiring from source" is better
oriented than one handed a freshly generated map of work in flight. The gate
therefore has exactly one blocking condition, the missing handoff, and mutates
nothing outside `.claude/`.

The drafted compact message needs no new document type. `/tools:handoff` already
specifies a `compact_instruction` field (`handoff.md:74-78`); it is simply never
read by anything. The gate reads it from the freshest handoff and emits it on
stdout, which the runtime turns into `newCustomInstructions` and merges into the
compaction's own custom instructions — a first-class native channel, not the
`additionalContext` workaround an earlier draft assumed. See CLI Verification.

## Alternatives Considered

| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|
| **Status quo + richer bash extraction** — keep the hook advisory, teach it to scrape more from git and ROADMAP | No new failure modes; nothing can wedge | Cannot produce decisions, rationale, or "where I left off" at any level of effort — those exist only in the model's context | Fails the actual requirement. The missing information is categorically unavailable to a shell script |
| **`Stop` hook demands a handoff** | Non-blocking event, no wedge risk | Fires at turn end, unrelated to context pressure; would demand a handoff on every trivial turn | Wrong trigger. Compaction pressure is the event we care about |
| **`PostCompact` writes the record** | Simple, cannot block anything | Runs *after* the context is gone — nothing left to write down | Structurally too late |
| **Block unconditionally until a handoff exists** | Strongest guarantee | A non-compliant or crashed turn wedges the session permanently at its context limit | Unacceptable. Availability beats completeness for a governance layer |
| **Gate blocks on map drift too** | Enforces map freshness through the same channel | Mid-build drift is expected, not a defect; blocking on it would stall every build-phase compaction | Report it, don't enforce it |
| **Gate heals the map (`check --heal`)** | Post-compaction session gets a current map for free | Heals from the working tree, but the map's source of authority is the git index (`:686-687`); canonicalizes wiring that may never land, is overwritten at the next commit, and dirties three tracked files — which would also defeat the gate's own clean-tree skip | Rejected. Read-only `check`, verdict forwarded as a caveat |
| **Separate second `PreCompact` hook for the gate** | Separation of concerns | Two hooks on one event with independent exit codes; ordering and combined-exit semantics get subtle | One hook, one exit decision |

## Constraint Analysis

| Constraint | Type | Verified | Notes |
|------------|------|----------|-------|
| Hooks cannot invoke the model | HARD | ✅ | Hook config is `{"type":"command"}` shell invocation (`settings.json:176-181`) |
| `PreCompact` can block via exit 2 | HARD | ✅ | Hooks reference exit-code table: `PreCompact \| Yes \| Blocks compaction` |
| ~~`custom_instructions` is input-only~~ | — | ❌ | **Retracted.** A `PreCompact` hook's stdout becomes `newCustomInstructions` and is merged into the compaction's instructions. See CLI Verification |
| Manual `/compact` cannot be gated | HARD | ✅ | The `/compact` path never reads `blockedBy` — blocking is not merely undesirable there, it is impossible. See CLI Verification |
| Gate must never permanently block | HARD | ✅ | Design constraint; enforced by the one-shot state file |
| No pipes / `$()` / bare `cd` in hook-instructed commands | HARD | ✅ | `.claude/rules/bash.md`; existing hooks comply (`pre-compact.sh:56-61` uses awk-reads-file, not a pipe) |
| Auto-checkpoint must not regress | HARD | ✅ | `pre-compact.sh:137-171` is the current behavior; retained on all paths |
| Hooks run on Git Bash (Windows) | HARD | ⚠️ | `find -mmin`, `find -newer`, `awk`, `tr` are all already used by shipped hooks, so the dependency set does not grow. Not tested on Windows in this repo |
| `system-map.ts check` needs Node ≥ 22.18 | HARD | ✅ | `_common.sh:57-87` `node_available()` exists precisely for this. Read-only and non-blocking, so absent Node just drops the caveat |
| The map's source of authority is the git index, not the working tree | HARD | ✅ | `system-map.ts:686-687`, `:695`. Forbids healing from a hook |
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
| A blocked auto-compaction is retried later rather than abandoned for the session | **VERIFIED** | The reactive path returns `{result:null, hookBlocked:true}` and the runner logs `" compaction blocked by PreCompact hook; continuing uncompacted"`. Nothing latches the block off; the next trigger re-evaluates, so the escape hatch runs. See CLI Verification |
| The block reason reaches *Claude*, not just the user | UNVERIFIED | **Now the load-bearing one.** A blocked hook's stdout goes to `blockedBy`, which is logged and surfaced as a `compaction-blocked-by-hook` user warning. Whether it also enters Claude's context is not established, and the gate's whole mechanism depends on Claude reading it. See Risks |
| Hook stdout that is JSON is parsed rather than passed through verbatim | UNVERIFIED | The runtime validates hook JSON (`"Hook JSON output had unrecognized keys (ignored)"`), but whether a JSON-printing hook contributes its raw text to `newCustomInstructions` was not pinned down. Decides whether the gate prints JSON or bare text |
| `system-map.ts check` exits 3 on drift and writes nothing without `--heal` | VERIFIED | `scripts/system-map.ts:575-591` — `writeArtifacts` is reached only on the `--heal` branch |
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
  ├─ map drift check, READ-ONLY (node ≥22.18, else skip)
  │     `system-map.ts check` — exit 3 means drifted; recorded as a caveat,
  │     never a block reason, never healed
  │
  ├─ nothing to hand off?  ─────────────► checkpoint only, exit 0
  │     (empty `git status --porcelain` AND no [-]/[~] in ROADMAP)
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

This gate blocks once per compaction cycle — the retry proceeds regardless.
```

When `check` reported drift, one further line is appended, addressed to the
session that will read the summary rather than to the current turn:

```
The system map is drifted. It describes committed state, not the working
tree — re-read hook and command wiring from source before trusting it.
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
| `.claude/settings.json` | Add `CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000"`; change `PreCompact` matcher `"auto"` → `"*"` so manual compaction still checkpoints. Existing 30s `timeout` stays — the drift check only hashes inputs |
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

## CLI Verification

The retry question could not be settled from documentation — the hooks reference
states only that `PreCompact` blocks, and says nothing about what happens next.
It was settled by reading the shipped executable
(`/opt/claude-code/bin/claude`, 275 MB, bundle strings searchable in place).
Findings below are quoted from that binary and are version-specific; re-check
them after a CLI upgrade.

**The PreCompact handler.** Reduced from the bundle:

```js
async function MEe(e, t, r = Hm) {
  let n = { ...Kf(void 0), hook_event_name: "PreCompact",
            trigger: e.trigger, custom_instructions: e.customInstructions },
      o = await EM({ hookInput: n, matchQuery: e.trigger, signal: t, timeoutMs: r });
  if (o.length === 0) return {};
  let i = o.filter((l) => l.succeeded && !l.blocked && l.output.trim().length > 0)
           .map((l) => l.output.trim());
  // ... builds `s` = "PreCompact [cmd] completed successfully: ..." display lines
  let a = o.filter((l) => l.blocked);
  return {
    newCustomInstructions: i.length > 0 ? i.join("\n\n") : void 0,
    userDisplayMessage:    s.length > 0 ? s.join("\n")   : void 0,
    ...a.length > 0 && { blockedBy: a.map((l) => { let c = l.output.trim();
        return `[${l.command}]${c ? `: ${c}` : ""}` }).join("\n") }
  }
}
```

**1. A block does not end compaction for the session.** Two distinct auto paths
consume `blockedBy`, and neither latches anything off:

- *Precomputed* (proactive): `if (I.blockedBy) { w("Precomputed compact blocked
  by PreCompact hook: " + I.blockedBy), YAo(a, d, null); return }` — abandons
  that speculative arm only. The re-arm counter is not incremented on this path.
- *Reactive*: `if (_.blockedBy) return { result: null, hookBlocked: true }`, and
  the caller logs `" compaction blocked by PreCompact hook; continuing
  uncompacted"`.

"Continuing uncompacted" is the answer: the turn proceeds, and the next
compaction trigger re-evaluates the hook. **The escape hatch will run.** The
design's blocking mechanism is sound as written.

**2. There are two auto-compaction triggers, and the hook cannot tell them
apart.** Both call `MEe({trigger: "auto", ...})`, so `trigger` is `"auto"` for
the proactive arm and the reactive one alike. Blocking the proactive arm is
cheap; blocking the reactive one means continuing uncompacted toward the hard
limit, where the bundle's `"Conversation too long"` path lives. Since the hook
cannot distinguish them, the one-shot escape hatch is not merely prudent — it is
the only thing standing between a blocked reactive compaction and that error.

**3. Manual `/compact` cannot be blocked at all.** The `/compact` command path
(`Il_`) and the shared compaction routine (`Pko`) call `MEe` and read only
`newCustomInstructions`; neither inspects `blockedBy`. The design's choice not
to gate manual compaction is therefore forced, not merely preferred.

**4. Hook stdout becomes the compaction's custom instructions.** This retracts a
stated HARD constraint. Successful non-blocked hooks' stdout is joined into
`newCustomInstructions`, and every caller merges it with the user's own via

```js
function MLo(e, t) { if (!t) return e || void 0; if (!e) return t;
                     return `${e}\n\n${t}` }
```

so the user's instructions come first and the hook's are appended. The drafted
compact message therefore has a purpose-built native channel; `additionalContext`
is not needed for it.

**5. Blocking and instructing are mutually exclusive in one invocation.** The
`!l.blocked` filter excludes a blocking hook's output from
`newCustomInstructions` — it goes to `blockedBy` instead. This suits the
two-phase design exactly: the blocking pass carries the reason, the passing pass
carries the instruction. It also means the gate must never try to do both at
once.

**6. Configuring any `PreCompact` hook disables precompute reuse.** In `Rl_`:
`if (t) return { hit: !1, reuse: "miss_hook" }`, where `t` is the hook result.
Project OS already ships a `PreCompact` hook, so this cost is already being
paid — worth knowing, not a reason to change course.

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
| ~~A blocked auto-compaction is not retried~~ | — | — | **Closed by CLI Verification.** The runner continues uncompacted and re-evaluates on the next trigger; nothing latches the block off |
| The block reason never reaches Claude, so nothing acts on it and the gate is pure friction | Medium | High | Now the top open risk. A blocked hook's output lands in `blockedBy` → logged + user warning; its path into Claude's context is unconfirmed. Settle this in the same spike, before any implementation. If it does not reach Claude, the gate must deliver the instruction some other way — a `systemMessage` the user relays, or a non-blocking design |
| A blocked *reactive* compaction continues uncompacted into the hard context limit | Medium | High | The hook cannot distinguish reactive from proactive (`trigger` is `"auto"` for both). The one-shot escape hatch is the only mitigation, which raises its priority from prudent to required |
| Session wedged by repeated blocking | Low | Critical | One-shot state file; `passed` is written *before* exit on the escape-hatch path so a crash mid-hook cannot re-arm the block |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the status line from the real trigger | Medium | Low | Set it to `200000`, equal to the standard model window, so the two agree. Document that extended-context (1M) projects must raise it or accept the skew |
| Drift check exceeds the hook timeout | Low | Low | Read-only input hashing, no `build()`. Failure drops the caveat and is never a block reason |
| Post-compaction session over-trusts a map that was drifted at compaction time | Medium | Medium | That is what the forwarded caveat is for. `CLAUDE.md` already directs consulting the map before wiring changes, so the caveat has to be explicit that it describes committed state only |
| The 10-minute checkpoint debounce suppresses the gate | Medium | High | **The debounce must move.** Today it is the first thing the script does (`pre-compact.sh:22-25`) and it `exit 0`s — which would skip the gate entirely on any compaction within 10 minutes of a checkpoint. Debounce the *checkpoint write*, never the gate decision |
| Gate fires on trivial read-only sessions | Medium | Low | Skip when the tree is clean and no `[-]`/`[~]` tasks exist |
| Handoff written but `compact_instruction` left as the template placeholder | Medium | Medium | `handoff.md` makes the field mandatory with concrete guidance; gate emits whatever is there rather than validating prose |
| Breaking the "hooks are advisory" convention confuses future maintainers | Medium | Low | ADR in `decisions.md` stating the exception and its bounds: only `PreCompact`, only for missing model-authored artifacts, always one-shot |

## Self-Review Findings

Reviewed inline rather than by sub-agent. Findings marked OPEN are revisions to
apply before approval; RESOLVED ones were folded into the design above and are
kept for provenance.

**RESOLVED (review round 2) — the gate must not heal the system map.** Raised
against the first draft, which ran `system-map.ts check --heal`. Three
independent reasons, any one sufficient: the heal reads the working tree while
the map's authority is the git index (`:686-687`); mid-build drift is the
expected state, so there is nothing to act on; and writing three tracked files
under `docs/maps/` would dirty the tree the gate then inspects, so the
clean-tree skip could never be taken. Replaced with a read-only `check` whose
verdict is forwarded as a caveat. See Architecture Decision 3.

**RESOLVED (review round 2) — block-reason wording.** Now reads "once per
compaction cycle", matching the state machine's re-arming behavior.

**OPEN / CRITICAL — `trap 'exit 0' ERR` silently disables the gate.** Every hook in
this repo opens `set -euo pipefail` followed by `trap 'exit 0' ERR`
(`pre-compact.sh:7-8`). That pairing is correct for an advisory hook and
actively wrong for a gate: any incidental non-zero return — a `grep -c` that
matched nothing, a `find` on a missing directory — converts into `exit 0`, which
*is* the pass verdict. The gate would fail open permanently and no error would
appear anywhere. A gate cannot inherit the advisory boilerplate unexamined. It
needs an explicit trap that logs the internal failure and then chooses to fail
open deliberately, so "the gate passed" and "the gate broke" are distinguishable
in `.claude/logs/`.

**OPEN / HIGH — `git diff --name-only` is the wrong emptiness test.** It reports
neither staged nor untracked files. A session that staged all its work, or
created new files, reads as a clean tree — so the checkpoint records no modified
files precisely when there is most to lose. The gate's own skip test has been
changed to `git status --porcelain` above, but the checkpoint's `modified_files`
(`pre-compact.sh:86`) is still on the old call. Pre-existing bug, not introduced
here; fix it in the same change so the two agree.

**RESOLVED (review round 3) — "is a blocked auto-compaction retried?"** Verified
against the shipped CLI: yes, the runner continues uncompacted and re-evaluates
on the next trigger. The blocking design stands. The same pass retracted the
`custom_instructions`-is-input-only constraint and surfaced two auto-compaction
triggers the hook cannot distinguish. See CLI Verification.

**OPEN / HIGH — does the block reason reach Claude?** Inherits the "load-bearing
unknown" slot from the retry question. The gate depends on Claude reading the
reason and running `/tools:handoff`; what is established is only that the reason
reaches `blockedBy`, a log line, and a user-facing warning. Sequence this first;
its answer decides whether the gate can work as designed.

**OPEN / LOW — 30 minutes is asserted, not derived.** The freshness bound is borrowed
from the checkpoint debounce, which was chosen for a different purpose. It is a
named constant, so it is cheap to change once there is evidence about how long a
typical session runs between handoff and compaction.
