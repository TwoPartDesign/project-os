# Design: Compaction Handoff Chain
Created: 2026-07-29
Revised: 2026-07-30 (round 4 — rewritten from a blocking gate to a two-channel chain)
Status: IMPLEMENTED
Brief: ./brief.md

> **Naming.** The directory is `compaction-gate/` for historical reasons: rounds
> 1–3 designed a blocking `PreCompact` gate. Round 3's CLI verification killed
> that design (see CLI Verification finding 1). Nothing in the shipped system
> gates anything; the directory name is kept so existing links and `#T117`
> resolve.

## Architecture Decision

**Split the requirement across the two channels that verifiably reach a reader,
and never block compaction.**

The requirement has three parts — *require* a handoff, *update* the system map,
*draft* a compact message — and the governing constraint is that hooks are shell
commands with no model access. A hook can therefore never author a handoff; it
can only cause one to be authored. Rounds 1–3 assumed the mechanism for that was
`PreCompact` exit 2: the hook refuses, the refusal lands in front of the one
participant who still has full context.

Reading the shipped CLI disproved the premise. A blocking `PreCompact` hook's
output goes to `blockedBy`, and on the auto path `blockedBy` reaches exactly
three places: a debug log, a fixed-string user notification that omits the
reason (and is suppressed outright when `isAutoCompact`), and a thrown error.
It never enters Claude's context. A blocking gate on the auto path defers
compaction without telling anyone why — pure friction, and on the *reactive*
arm it defers straight toward the hard context limit. See CLI Verification.

So the design inverts. Two channels were verified to carry text to a reader, and
each takes the half of the requirement it can actually serve:

**1. `PostToolUse` → `additionalContext` carries the requirement.** This is the
only hook output that lands in Claude's context. `compact-suggest.sh` watches
transcript growth since the last compaction and, once per cycle, injects a
message telling Claude to run `/tools:handoff` *now*, while the context needed
to write one still exists. It is a nudge with no enforcement behind it, which is
the honest description of what any mechanism here can be: nothing can compel a
model turn, and the alternative — blocking — could not even inform it.

**2. `PreCompact` stdout → `newCustomInstructions` carries the drafted message.**
The runtime joins every successful non-blocked `PreCompact` hook's stdout and
merges it into the compaction's custom instructions, after the user's own. That
is a first-class native channel for the drafted compact message, not the
`additionalContext` workaround round 1 assumed. `pre-compact.sh` reads the
freshest handoff's `compact_instruction` and prints it. The field already
existed in the `/tools:handoff` schema and was read by nothing; this design
gives it its consumer and makes it mandatory.

**3. Blocking buys nothing without headroom — but the headroom is still needed.**
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "75"` is inert unless Claude Code takes its
*proactive* compaction path, and setting `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is
one of the conditions that enables it. `200000` — equal to the standard model
window — turns the existing 75% into a real trigger while keeping the status
line's percentage aligned with it. Blocking is gone, but the reason the
threshold mattered survives it: the nudge is worthless if it arrives with no
room left to act on it.

**4. The system map is observed, never healed.** An earlier revision had the
hook run `system-map.ts check --heal`. That was wrong for three independent
reasons, any one sufficient. `cmdCheck` builds from `workingTreeSource` and
calls `writeArtifacts` (`:577`, `:593-595`), while `cmdPrecommit` builds from
`gitIndexSource` under the explicit docstring *"reads every input from the git
INDEX (never the working tree)"* (`:686-687`) — the map's authority is committed
reality, so healing from the working tree canonicalizes wiring that may never
land and is overwritten at the next commit. Compaction also lands
disproportionately *during* long build phases, where drift is the expected state
rather than a defect. And writing three tracked files under `docs/maps/` would
dirty the tree the hook then inspects. So the hook runs `check` read-only — input
hashing against `.maps.lock`, no `build()`, no writes — and forwards the verdict
as a caveat. A post-compaction session told *"the map is drifted; it reflects
committed state, re-read wiring from source"* is better oriented than one handed
a freshly generated map of work in flight.

The hook therefore mutates nothing outside `.claude/`, and has no failure mode
that can stall a session.

## Alternatives Considered

| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|
| **Blocking `PreCompact` gate** (rounds 1–3) | Strongest-looking guarantee; makes skipping the handoff deliberate | The block reason never reaches Claude on the auto path — `blockedBy` goes to a debug log, a reason-less notification suppressed under `isAutoCompact`, and a throw | **Rejected on verification.** It defers compaction without informing the one actor who could respond, and on the reactive arm defers toward the hard limit |
| **`additionalContext` from `PreCompact`** | Would put the requirement in Claude's context at exactly the right moment | `PreCompact` output becomes `newCustomInstructions`; it has no `additionalContext` channel | Not available on that event. Hence the split across two hooks |
| **Status quo + richer bash extraction** — keep the hook advisory, scrape more from git and ROADMAP | No new failure modes | Cannot produce decisions, rationale, or "where I left off" at any effort — those exist only in the model's context | Fails the requirement. The checkpoint is a *fallback*, and says so in its own `context_notes` |
| **`Stop` hook demands a handoff** | Non-blocking, no wedge risk | Fires at turn end, unrelated to context pressure; would demand a handoff on every trivial turn | Wrong trigger |
| **`PostCompact` writes the record** | Cannot block anything | Runs after the context is gone | Structurally too late |
| **Hook heals the map (`check --heal`)** | Post-compaction session gets a current map free | Heals from the working tree while the map's authority is the git index (`:686-687`); canonicalizes uncommitted wiring; dirties three tracked files | Rejected. Read-only `check`, verdict forwarded as a caveat |
| **Count tool calls instead of transcript bytes as the pressure proxy** | Simpler, no filesystem read | Tool calls vary in output size by orders of magnitude; a session of large file reads and one of small edits look identical | Bytes are the closer proxy. Still uncalibrated — see Open Questions |
| **Distinguish proactive from reactive compaction and behave differently** | Would let the risky arm be treated more carefully | Both arms call the handler with `trigger: "auto"`; the hook cannot tell them apart | Not expressible. Moot once nothing blocks |

## Constraint Analysis

| Constraint | Type | Verified | Notes |
|------------|------|----------|-------|
| Hooks cannot invoke the model | HARD | ✅ | Hook config is `{"type":"command"}` shell invocation (`settings.json:174-186`) |
| `PreCompact` output does not reach Claude when blocking | HARD | ✅ | `blockedBy` → debug log, reason-less notification (suppressed when `isAutoCompact`), throw. See CLI Verification 1 |
| `PreCompact` stdout becomes the compaction's custom instructions | HARD | ✅ | `newCustomInstructions`, merged by `MLo` after the user's. See CLI Verification 4 |
| `PostToolUse` `additionalContext` reaches Claude | HARD | ✅ | The channel the whole requirement now rides on |
| ~~`custom_instructions` is input-only~~ | — | ❌ | **Retracted (round 3).** See CLI Verification 4 |
| ~~Manual `/compact` cannot be blocked~~ | — | ❌ | **Retracted (round 3).** Both `Il_` and `Pko` reach `PLo`, which inspects `blockedBy` and throws. The manual path *can* be blocked; it is the *auto* path that cannot be blocked usefully. Moot — nothing blocks now |
| Hooks must never stall a session | HARD | ✅ | Satisfied trivially: no exit-2 path exists |
| No pipes / `$()` / bare `cd` in hook-instructed commands | HARD | ✅ | `.claude/rules/bash.md`; `pre-compact.sh` uses awk-reads-file, not a pipe |
| Auto-checkpoint must not regress | HARD | ✅ | Retained on every path, and its ROADMAP extraction fixed (see Self-Review) |
| Hooks run on Git Bash (Windows) | HARD | ⚠️ | `find -mmin`, `awk`, `tr`, `wc` are already used by shipped hooks, so the dependency set does not grow. `find -printf` was deliberately avoided in favour of `sort \| tail -1`. Not tested on Windows in this repo |
| `system-map.ts check` needs Node ≥ 22.18 | HARD | ✅ | `_common.sh` `node_available()`. Read-only and non-blocking, so absent Node just drops the caveat |
| The map's source of authority is the git index, not the working tree | HARD | ✅ | `system-map.ts:686-687`, `:695`. Forbids healing from a hook |
| Reuse the `/tools:handoff` YAML schema | SOFT | ✅ | `compact_instruction` already existed; now mandatory and consumed |
| 10-minute checkpoint debounce | SOFT | ✅ | Applies to the checkpoint **file write** only. The stdout contribution is emitted on every compaction |
| Hooks are "advisory, never surface errors" | SOFT | ✅ | Preserved. `trap 'exit 0' ERR` is now correct rather than dangerous, because no exit code carries a verdict |

## Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| A blocked auto-compaction is retried rather than abandoned | VERIFIED | Reactive path returns `{result:null, hookBlocked:true}`; runner logs `" compaction blocked by PreCompact hook; continuing uncompacted"`. **No longer load-bearing** — nothing blocks |
| The block reason reaches *Claude* | **DISPROVED** | It does not. This is what killed the gate. See CLI Verification 1 |
| Setting `CLAUDE_CODE_AUTO_COMPACT_WINDOW` enables the proactive path | VERIFIED | env-vars: the override "only causes earlier compaction when Claude Code compacts proactively: when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set, in cloud sessions, and on Sonnet 4.6 and Opus 4.6…" |
| Window value is capped at the model's real context window | VERIFIED | env-vars: "The value is capped at the model's actual context window" |
| Hook stdout that is JSON is passed through verbatim on `PreCompact` | VERIFIED | `newCustomInstructions` takes `l.output.trim()` with no parse. Hence the stdout contract: **plain text only** |
| `system-map.ts check` exits nonzero on drift and writes nothing without `--heal` | VERIFIED | `scripts/system-map.ts:575-591` — `writeArtifacts` is reached only on the `--heal` branch |
| `session_id` and `transcript_path` are present in hook stdin JSON | VERIFIED | Documented common input fields; exercised by `tests/compaction-hooks.sh` |
| Transcript bytes since last compaction track context growth | **ASSUMED** | Hooks receive no token count. Monotonic within a cycle and roughly proportional, but the 1.2 MB default is uncalibrated — Open Question 7 in the brief |
| `.claude/sessions/` may not exist | VERIFIED | `find`ed before `mkdir -p`, tolerated via `2>/dev/null` |

## Technical Approach

### The three stages

```
1. PostToolUse — compact-suggest.sh          (every tool call, matcher ".*")
   transcript bytes − baseline ≥ NUDGE_BYTES,
   and this cycle has not nudged yet
     → touch .compact-nudged-<sid>
     → additionalContext: "run /tools:handoff now, with a compact_instruction"

2. The model writes .claude/sessions/handoff-<ts>.yaml
   (the one step no hook can perform)

3. PreCompact — pre-compact.sh               (matcher "*", auto and manual)
     → reset .compact-base-<sid> to the current transcript size
     → rm .compact-nudged-<sid>              (re-arm stage 1 for the next cycle)
     → newest handoff-*.yaml, -mmin -30, -type f, resolve_project_path
     → awk out the compact_instruction block scalar; reject the placeholder
     → system-map.ts check (read-only) → MAP_DRIFTED
     → write auto-checkpoint-<ts>.yaml unless one is <10 min old
     → print instruction + handoff path + drift caveat on stdout
```

Stage 3 always runs stage 1's re-arm and always prints, regardless of the
checkpoint debounce. The debounce governs one thing: whether a checkpoint *file*
is written.

### Freshness rule

A handoff qualifies when it is a regular file matching
`.claude/sessions/handoff-*.yaml` and written within `HANDOFF_MAX_AGE_MIN`
(default 30, override `PROJECT_OS_HANDOFF_MAX_AGE_MIN`), so a handoff from an
earlier phase of a long session does not get forwarded as if it described the
state being compacted away now.

Filenames are `handoff-YYYY-MM-DD-HHMM.yaml`, so lexical order is chronological
and `sort | tail -1` selects the newest — chosen over `find -printf`, which is
GNU-only and absent on the platforms this must survive.

Round 3's second freshness condition, `find -newer <state-file>`, existed only to
terminate the block → handoff → retry loop. With no loop, it is gone.

Symlinks are excluded (`-type f`) and the winning path passes through
`resolve_project_path()` before being read, so a handoff symlinked outside the
project cannot pipe external file content into the compaction instructions.
`tests/compaction-hooks.sh` covers both an escaping symlink and an in-scope one,
per `.claude/rules/tests.md` — the in-scope case is there so that a future
relaxation to `-type f -o -type l` fails loudly.

### The stdout contract

Documented at the top of `pre-compact.sh` because it is the one thing a future
edit is most likely to break:

1. **Plain text only.** JSON would be forwarded to the summarizer verbatim as
   instructions, not parsed.
2. **Print nothing when there is nothing to say.** Empty output is filtered out
   by the runtime; noise is not.

What it prints, when a handoff supplied an instruction:

```
<the handoff's compact_instruction, verbatim>

Session state for this work is saved at <path> — read it with /tools:catchup before resuming.
The system map at docs/maps/ is drifted: it describes committed state, not the working
tree. Re-read hook and command wiring from source before trusting it.
```

The third line appears only when `check` reported drift, and appears alone when
there is drift but no instruction.

### Placeholder rejection

`handoff.md` ships `compact_instruction` with a bracketed example. An unfilled
placeholder forwarded to the summarizer is worse than silence — it is
instructions about a fictional auth refactor. `pre-compact.sh` matches the
placeholder's leading text and treats it as absent. This is deliberately a
substring match on the shipped template, not prose validation: the hook cannot
judge whether an instruction is *good*, only whether it was written at all.

### Key interfaces

Two helpers added to `.claude/hooks/_common.sh`:

```bash
# Extract and sanitize session_id from hook stdin JSON.
# Replaced three near-identical copies.
session_id_from_json() { ...; }   # -> [[:alnum:]_-]+ or "default"

# Extract a simple scalar string field from hook stdin JSON.
# Documented as safe only for simple scalars — it is grep+sed, not a parser.
json_string_field() { ...; }
```

Round 3's design also specified a `json_escape()` helper, on the reasoning that
`compact_instruction` free text would be embedded in a JSON payload. It was
never implemented and is not needed: `PreCompact` output is plain text, and
`compact-suggest.sh`'s message is a fixed single line with no quotes,
backslashes or newlines, emitted directly inside the string literal. Avoiding
the escaping problem entirely beat solving it — an awk-based JSON escaper is a
correctness hazard (a malformed payload fails *silently*) for zero gain here.
If a future message needs interpolation, write the escaper then, with tests.

Extraction of the `compact_instruction` block scalar uses `awk` reading the file
directly — no pipes, no `$()`-wrapped programs, no YAML dependency.

### File changes

| File | Change |
|---|---|
| `.claude/settings.json` | `CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000"` added; `PreCompact` matcher `"auto"` → `"*"` so manual `/compact` also checkpoints and forwards its instruction |
| `.claude/hooks/pre-compact.sh` | Rewritten: stdout contract, handoff discovery + extraction, read-only map check, nudge re-arm; checkpoint retained as the debounced tail. ROADMAP marker patterns fixed |
| `.claude/hooks/compact-suggest.sh` | Rewritten: transcript-growth threshold, one nudge per compaction cycle, `additionalContext` payload |
| `.claude/hooks/_common.sh` | Added `session_id_from_json()`, `json_string_field()` |
| `.claude/hooks/session-end-cleanup.sh` | Removes `.compact-base-*` / `.compact-nudged-*` for the session; 7-day prune of both |
| `.claude/commands/tools/handoff.md` | `compact_instruction` mandatory; new "How `compact_instruction` is used" section; note that auto-checkpoints cannot record rationale |
| `tests/compaction-hooks.sh` | New — 45 assertions across sandboxed project roots |
| `docs/knowledge/architecture.md` | Both hook rows updated; new "Compaction Handoff Chain" subsection |
| `docs/knowledge/decisions.md` | ADR: steer the summarizer, do not block compaction |
| `docs/knowledge/patterns.md` | "Verify the Channel Before Designing the Gate"; "Test Behaviour in a Copied Project Root" |
| `README.md` | New tip: compaction is steered, not just survived |
| `ROADMAP.md` | `#T117` under `## Feature: compaction-gate` |

### Dependencies

None. `find`, `awk`, `tr`, `wc`, `git`, and optional `node` are all already
required by shipped hooks.

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

**1. A block reason never reaches Claude, which is what killed the gate.**
`blockedBy` has exactly three consumers: a debug log line, a user-facing
notification whose text is a fixed string that *omits* the reason (and which is
suppressed entirely when `isAutoCompact`), and a thrown error on the manual
path. No consumer puts it in Claude's context. A blocking `PreCompact` hook can
therefore defer compaction but cannot say why to the only participant able to
act — the mechanism rounds 1–3 were built on does not exist.

**2. A block does not end compaction for the session.** Two distinct auto paths
consume `blockedBy`, and neither latches anything off:

- *Precomputed* (proactive): `if (I.blockedBy) { w("Precomputed compact blocked
  by PreCompact hook: " + I.blockedBy), YAo(a, d, null); return }` — abandons
  that speculative arm only. The re-arm counter is not incremented on this path.
- *Reactive*: `if (_.blockedBy) return { result: null, hookBlocked: true }`, and
  the caller logs `" compaction blocked by PreCompact hook; continuing
  uncompacted"`.

"Continuing uncompacted" is the answer to round 2's load-bearing question. It is
retained for provenance; it stopped mattering when finding 1 removed the reason
to block at all.

**3. There are two auto-compaction triggers, and the hook cannot tell them
apart.** Both call `MEe({trigger: "auto", ...})`, so `trigger` is `"auto"` for
the proactive arm and the reactive one alike. Blocking the proactive arm is
cheap; blocking the reactive one means continuing uncompacted toward the hard
limit, where the bundle's `"Conversation too long"` path lives. A hook cannot
choose to block only the cheap one.

**4. Hook stdout becomes the compaction's custom instructions.** This retracts a
stated HARD constraint. Successful non-blocked hooks' stdout is joined into
`newCustomInstructions`, and every caller merges it with the user's own via

```js
function MLo(e, t) { if (!t) return e || void 0; if (!e) return t;
                     return `${e}\n\n${t}` }
```

so the user's instructions come first and the hook's are appended. The drafted
compact message has a purpose-built native channel. Note that `l.output.trim()`
is taken as-is with no parse — hence the plain-text stdout contract.

**5. Blocking and instructing are mutually exclusive in one invocation.** The
`!l.blocked` filter excludes a blocking hook's output from
`newCustomInstructions` — it goes to `blockedBy` instead. A hook cannot both
refuse and instruct.

**6. Manual `/compact` reaches a path that *does* inspect `blockedBy`.** This
corrects round 3, which claimed manual compaction could not be blocked at all.
`Il_` (the `/compact` command) and `Pko` (the shared routine) both reach `PLo`,
which inspects `blockedBy` and throws. So the manual path is the one that *can*
be blocked meaningfully; the auto path is the one that cannot. The shipped
design blocks neither, and sets the matcher to `"*"` so manual compaction gets
the same forwarded instruction and checkpoint.

**7. Configuring any `PreCompact` hook disables precompute reuse.** In `Rl_`:
`if (t) return { hit: !1, reuse: "miss_hook" }`, where `t` is the hook result.
Project OS already shipped a `PreCompact` hook before this change, so this cost
was already being paid — worth knowing, not a reason to change course.

## Testing Strategy

`tests/compaction-hooks.sh` — 45 assertions, all passing. Per
`.claude/rules/tests.md` each case builds its own state and asserts specific
values, not truthiness.

**Sandboxing.** Each case runs `new_sandbox()`: a `mktemp -d` root with
`.claude/hooks`, `.claude/sessions`, `.claude/logs` and `scripts/`, the four
hooks copied in, a `scripts/system-map.ts` stub (`process.exit(0)`, rewritten to
`process.exit(3)` to simulate drift), and a synthetic `ROADMAP.md`. Because the
hooks resolve their project root as `$SCRIPT_DIR/../..`, copying them makes that
resolution land inside the sandbox — so tests exercise real filesystem
behaviour without touching the repo. This is what caught the ROADMAP-marker bug
below; a mock would have encoded the same wrong assumption.

Groups:

- **compact-suggest** — fires above threshold, silent below; once per cycle;
  transcript smaller than baseline resets the baseline instead of reporting
  negative growth; missing transcript exits 0; a `session_id` of
  `../../etc/passwd` writes `.compact-nudged-etcpasswd` and nothing outside the
  log directory.
- **pre-compact** — instruction body forwarded; multi-line body forwarded
  intact; handoff path named; **stdout is plain text, not JSON**; newest handoff
  wins; placeholder rejected; handoff older than 30 min (`touch -d '2 hours
  ago'`) ignored; silence when there is nothing to say; drift caveat alone;
  drift caveat appended to an instruction.
- **containment** — a handoff symlinked outside the project is rejected, *and* a
  symlink to an in-scope sibling is rejected too. The second case exists so a
  future switch to `-type f -o -type l` fails here.
- **cycle handshake** — pre-compact clears the nudged marker and resets the
  baseline to the current size; no re-nudge without growth; re-nudge after
  growth.
- **checkpoint** — file written; phase derived as `"build"`; feature derived
  from the `## Feature:` heading; in-progress description recorded; absence of a
  handoff recorded as "rationale not captured"; the 10-minute debounce
  suppresses a second file **but still forwards the instruction**.
- **malformed input** — empty stdin, non-JSON stdin, and a `session_id`
  containing a space all exit 0 on both hooks.
- **session-end-cleanup** — removes this session's markers, leaves other
  sessions' intact.

`tests/hook-smoke.sh` still passes 15/15 — no regression.

Not automatable here, and left to observation in real sessions: that
auto-compaction actually fires near 75% of the configured window, and whether
`PROJECT_OS_COMPACT_NUDGE_BYTES` is calibrated (Open Question 7).

## Security Considerations

- **Path traversal via `session_id`.** Marker filenames embed a value from hook
  stdin. Sanitized to `[[:alnum:]_-]` by `session_id_from_json()`; tested,
  including that nothing is written outside the log directory.
- **Symlink escape via handoff discovery.** `find -type f` plus
  `resolve_project_path()` containment; both the escaping and the in-bounds
  symlink case are tested.
- **Untrusted text into the compaction instructions.** `compact_instruction` is
  free text that becomes summarizer guidance. It is author-written in a repo
  file, the same trust level as `CLAUDE.md`, and only that one field is
  forwarded — never the whole handoff, which could contain a credential pasted
  into `context_notes`. A deliberate narrowing.
- **No JSON injection surface.** Neither hook interpolates variable text into a
  JSON payload — `PreCompact` emits plain text, `PostToolUse` emits a fixed
  string. This is why `json_escape()` was dropped rather than written.
- **No new write surface.** Writes are confined to `.claude/logs/` and
  `.claude/sessions/`, both already written by shipped hooks. Nothing under
  `docs/maps/` is touched.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| The nudge threshold is miscalibrated and fires too early or too late | **High** | Medium | `PROJECT_OS_COMPACT_NUDGE_BYTES` is a tunable env var, default 1,200,000. It fired immediately in the session that built the feature, which is evidence the default is low. Firing early costs one handoff; firing late costs the session's context — the default is deliberately biased toward early. Open Question 7 |
| Claude ignores the nudge and compaction proceeds with no handoff | Medium | Medium | Accepted. Nothing can compel a model turn, and the rejected alternative could not even inform it. The auto-checkpoint is the fallback and says in its own `context_notes` that rationale was not captured |
| A handoff exists but `compact_instruction` is the unfilled placeholder | Medium | Medium | Placeholder rejected by substring match; `handoff.md` makes the field mandatory with concrete guidance and a worked example |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the status line from the real trigger | Medium | Low | Set to `200000`, equal to the standard model window, so the two agree. Extended-context (1M) projects must raise it or accept the skew |
| Drift check exceeds the 30s hook timeout | Low | Low | Read-only input hashing, no `build()`. Failure drops the caveat and is never anything more |
| Post-compaction session over-trusts a map that was drifted at compaction time | Medium | Medium | The forwarded caveat states explicitly that the map describes committed state only |
| CLI internals change and the stdout channel stops working | Medium | High | The findings above are version-specific and labelled as such. Failure is silent — the instruction simply stops arriving. Re-verify after a CLI upgrade; `tests/compaction-hooks.sh` asserts the hook's *output*, which is the half that can be tested locally |
| Configuring `PreCompact` disables precompute reuse | Certain | Low | Already the case before this change (CLI Verification 7) |

## Self-Review Findings

Findings marked RESOLVED were folded into the design or the implementation and
are kept for provenance.

**RESOLVED (round 2) — the hook must not heal the system map.** Three
independent reasons, any one sufficient: the heal reads the working tree while
the map's authority is the git index (`:686-687`); mid-build drift is the
expected state; and writing three tracked files under `docs/maps/` would dirty
the tree the hook then inspects. Replaced with read-only `check`. See
Architecture Decision 4.

**RESOLVED (round 3) — "is a blocked auto-compaction retried?"** Yes; the runner
continues uncompacted and re-evaluates. Superseded in round 4 by the finding
that made blocking moot.

**RESOLVED (round 4) — does the block reason reach Claude?** No. This was the
load-bearing unknown, and answering it inverted the design. See CLI
Verification 1. The pattern is recorded in `patterns.md` as *"Verify the Channel
Before Designing the Gate"* — round 3 confirmed the mechanism *existed* without
confirming anyone could *observe* it.

**RESOLVED (round 4) — `trap 'exit 0' ERR` silently disables the gate.** Raised
as CRITICAL against the blocking design, where any incidental non-zero return
would convert into `exit 0` — the pass verdict — and fail open permanently with
no error anywhere. Moot: no exit code carries a verdict now, so the advisory
boilerplate is correct again rather than dangerous. Had the gate shipped, this
alone would have required a custom trap.

**RESOLVED (round 4) — `git diff --name-only` is the wrong emptiness test.**
It reports neither staged nor untracked files, so a session that staged all its
work recorded an empty `modified_files` precisely when it had most to lose.
Pre-existing bug; fixed by switching the checkpoint to `git status --porcelain`,
with rename (`old -> new`) and git path-quoting handled and change types
classified.

**RESOLVED (round 4) — ROADMAP marker patterns never matched.** Found by the new
tests, not by review. `pre-compact.sh` anchored markers as `^\s*\[-\]`, but
ROADMAP tasks are markdown list items — `- [-] Task #T1` — so the marker is
never at line start. Every auto-checkpoint ever written recorded `phase:
"ad-hoc"`, `feature: "none"` and `in_progress: (none)` regardless of what was in
flight; the checkpoint's only content-bearing fields had been inert since
inception. Fixed to `^[[:space:]]*([-*][[:space:]]+)?\[-\]` in all three places,
which also drops the GNU-only `\s`. `scripts/validate-roadmap.sh` was checked
for the same mistake and does not have it.

**OPEN / MEDIUM — the pressure proxy is uncalibrated.** Transcript bytes since
the last compaction is a stand-in for a token count hooks never receive. The
1.2 MB default fired immediately in the session that built the feature, which
suggests it is low, but one observation is not calibration. Needs data from
several real sessions: transcript bytes at the moment auto-compaction fires,
compared against the nudge point. Tracked as Open Question 7 in the brief.

**OPEN / LOW — 30 minutes is asserted, not derived.** The handoff freshness
bound was borrowed from the checkpoint debounce, which was chosen for a
different purpose. It is a named constant with an env override, so it is cheap
to change once there is evidence about how long a typical session runs between
handoff and compaction.
