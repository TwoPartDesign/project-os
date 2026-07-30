# Design: Compaction Handoff Chain
Created: 2026-07-29
Revised: 2026-07-30 (round 6 — handoff discovery correlated with the authoring session)
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
only hook output that lands in Claude's context. `compact-suggest.sh` reads the
current context size out of the transcript's `usage` records and, once per
cycle, injects a message telling Claude to run `/tools:handoff` *now*, while the
context needed to write one still exists. It is a nudge with no enforcement behind it, which is
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
| ~~Transcript bytes since last compaction track context growth~~ | **DISPROVED (round 5)** | They do not. The transcript retains every discarded turn, so it grows monotonically across compactions while the context it stands for halves at each one. Measured on a live session: 2,897,308 bytes against 106,432 context tokens — 27 bytes/token where ~4 is typical, and the nudge fired at roughly 53% of the window instead of 60% |
| The transcript carries the real context size | VERIFIED (round 5) | Every assistant record's `message.usage` holds `input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`; their sum is the context fed to that turn, in the same unit as `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Probed directly against this session's transcript |
| Sub-agent turns write `usage` records into the same transcript | VERIFIED (round 5) | They carry `isSidechain: true` and much smaller totals. Skipped, or a sub-agent's context would be read as the main thread's |
| `.claude/sessions/` may not exist | VERIFIED | `find`ed before `mkdir -p`, tolerated via `2>/dev/null` |

## Technical Approach

### The three stages

```
1. PostToolUse — compact-suggest.sh          (every tool call, matcher ".*")
   newest non-sidechain usage record in the transcript tail:
     tokens = input + cache_read + cache_creation
   tokens × 100 / WINDOW ≥ NUDGE_PCT  (default 75 − 15 = 60),
   and this cycle has not nudged yet
     → touch .compact-nudged-<sid>
     → additionalContext: "context is at N%; run /tools:handoff now,
                           with a compact_instruction"
   independently of all of the above, on every call:
   tool_input.file_path matches */.claude/sessions/handoff-*.yaml
     → append it to .compact-handoff-<sid>   (who wrote which handoffs;
                                              one path per line, deduped
                                              against the last line)

2. The model writes .claude/sessions/handoff-<ts>.yaml
   (the one step no hook can perform)

3. PreCompact — pre-compact.sh               (matcher "*", auto and manual)
     → last line of .compact-handoff-<sid> naming a file newer than the
       cycle marker, else newest handoff-*.yaml no OTHER session's record
       claims on ANY line, -newer .compact-cycle-<sid>,
       -type f, resolve_project_path         (BEFORE the marker is reset)
     → touch .compact-cycle-<sid>            (open the next cycle)
     → reset .compact-base-<sid> to the current transcript size
     → rm .compact-nudged-<sid>              (re-arm stage 1 for the next cycle)
     → awk out the compact_instruction block scalar; reject the placeholder
     → system-map.ts check (read-only) → MAP_DRIFTED
     → write auto-checkpoint-<ts>.yaml unless one is <10 min old
     → print instruction + handoff path + drift caveat on stdout
```

Stage 3 always runs stage 1's re-arm and always prints, regardless of the
checkpoint debounce. The debounce governs one thing: whether a checkpoint *file*
is written.

### The pressure signal

Rounds 1–4 used transcript bytes since the last compaction as a stand-in for
context size, on the stated premise that hooks receive no token count. That
premise was wrong. Every assistant record in the transcript JSONL carries a
`message.usage` object, and

```
input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

is the context that was actually fed to the model on that turn — the same unit
as `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, so no conversion and no calibration.

Bytes were not merely uncalibrated, they measured the wrong quantity. The
transcript is append-only and retains every discarded turn, so it keeps growing
after a compaction while the context it stands for has just halved. The
divergence widens with every cycle. Measured on the session that built this
feature: 2,897,308 bytes of transcript against 106,432 tokens of context — 27
bytes per token where ~4 is typical, and the nudge fired at roughly 53% of the
window rather than the intended 60%.

Seven details in the implementation:

- **Only the tail is read, and the window escalates 60 → 600 → 4000 lines.**
  This runs on every tool call, so the first read has to be cheap: `tail -n 60`
  seeks from the end instead of walking a multi-megabyte file. A fixed 60 was
  not enough, because it assumed a usage-bearing assistant record was always
  near the end; a long run of tool-result records carries no `usage` object at
  all and pushes it out of reach, and the byte proxy the hook then fell through
  to is wrong in both directions. The wider reads happen only when the cheap one
  comes up empty, so the normal case pays what it paid before. Past 4000 lines
  the byte fallback still applies; that ceiling is pinned by a test rather than
  left implicit.
- **`isSidechain` records never contribute a number.** Sub-agent turns write
  their own, much smaller, `usage` objects into the same transcript. Taking the
  newest record blindly would read a sub-agent's context as the main thread's —
  and because sub-agent totals are small, the failure is silent
  under-reporting.
- **Delivery is gated on `agent_id`, not on the transcript tail.** This is a
  delivery question, not a measurement one, and the two were conflated at first.
  The hook fires on the sub-agent's tool calls too, and `additionalContext` lands
  in the context of whichever agent made the call — so a nudge raised
  mid-sub-agent-run reaches an agent that can neither write a handoff nor be
  compacted, *and* spends the once-per-cycle marker the main thread's own nudge
  needed. The turn that had to be told never hears anything.

  The payload answers "who is speaking" directly. Every hook payload is built
  from a common prefix carrying both `session_id` and `agent_id`; the main
  thread's tool-use context is `{agentType:"main", agentId:<session id>}`, while
  a sub-agent gets a distinct id. So `agent_id == session_id` *is* the
  main-thread test, and both values arrive in the same payload, which makes the
  comparison self-contained. It is preferred over `agent_type == "main"` because
  that default is a *configurable* value in the CLI, so the literal string is not
  guaranteed; an id comparison does not depend on a name.

  This also settles a question round 9 left open. It read the transcript tail as
  a proxy for identity and recorded that whether sub-agent hook firings share the
  main session's id was unconfirmed, because the transcript it was built against
  contained no sidechain records. Reading the shipped CLI's hook-payload
  assembly answers it: `session_id` is resolved from the session, independently
  of the agent, so **sub-agent firings do share the main session's id** — the
  marker spend was the serious half of the bug, as round 9 guessed.

  The tail heuristic survives only as a fallback for a payload carrying no
  `agent_id` key at all — an older CLI. Absence must not be read as "main
  thread", or the guard would silently retire itself on a version that needs it.

  Round 9 also stated a bound and accepted it: right after a sub-agent returns,
  its last record is still the newest, so the main thread's own `PostToolUse` for
  the completed `Task` deferred too, waiting "one further turn". That acceptance
  was wrong. If the resumed turn ends without another tool call, or
  auto-compaction fires first, no later `PostToolUse` delivers the nudge and the
  cycle is simply lost — nothing recovers it, because the marker logic has no
  notion of a nudge that was owed and never sent. Gating on the payload closes
  that path: the `Task`-completion firing is a main-thread firing and is now
  recognized as one. For the same reason the scan loop no longer stops early on a
  sidechain tail once identity is known — that tail is exactly the case needing
  the *wider* window, since the main thread's number sits behind a whole
  sub-agent run's worth of records.
- **Matching starts at the `"usage"` key.** The same field names recur inside
  the `iterations` array and could appear in assistant prose, so the scan takes
  the first occurrence of each field *after* `"usage"`, which is the top-level
  one.
- **The scan walks to the *last* `"usage"` key, not the first.** A record
  serializes `message.content` before `message.usage` — confirmed on this
  session's transcript, where the first `tool_use` sits at offset 200 and
  `"usage":` at 457 — so a tool payload carrying its own `usage` object would be
  found first by a leftmost search, and the hook would measure the payload
  instead of the context. Since a tool payload's numbers are small, the nudge
  would simply not fire.
- **Only `type:assistant` records are measured.** A user record's
  `toolUseResult` is arbitrary JSON from outside the session — an MCP response,
  a file read of another transcript — and could supply a number from nowhere.
  All 635 records carrying a `usage` object in the motivating transcript are
  tagged `type:assistant`, so the filter costs nothing.

  Both guards are structural: no record in that transcript actually carried two
  `usage` keys, and first-based and last-based extraction agreed on 125936. They
  were added because the failure is silent when it does occur, suppressing
  exactly the nudge that had to fire. Raised in review on this PR; the ordering
  premise was confirmed by probe before the change, and the absence of a live
  reproduction is recorded in the hook comment rather than papered over.

The threshold is derived rather than asserted. `NUDGE_PCT` defaults to
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE − 15` (floored at 20), so at the shipped 75% it
nudges at 60% — about 30k tokens of runway at a 200k window, ample for a handoff
turn — and raising the compaction threshold moves the nudge with it.
`PROJECT_OS_COMPACT_NUDGE_PCT` overrides the derivation.

Byte growth survives as a fallback for the case where no `usage` record parses
(a transcript format change). Its message deliberately claims no percentage,
because on that path none was measured.

### Freshness rule

A handoff qualifies when it is a regular file matching
`.claude/sessions/handoff-*.yaml` written **during the current compaction
cycle** — `find -newer .compact-cycle-<sid>`, where that marker is touched at
each compaction and nowhere else.

This replaces round 4's wall-clock window, which asked a question nobody had
evidence for ("is 30 minutes the right age?"). The cycle boundary asks the
question that actually matters — *was this handoff written after the last
compaction?* — and needs no tuning: a slow session that took two hours between
handoff and compaction still qualifies, and a handoff from before the previous
compaction never does, however recent it is. It also makes each handoff
single-use, so an instruction cannot be replayed into every subsequent
compaction.

`HANDOFF_MAX_AGE_MIN` (default 30, override `PROJECT_OS_HANDOFF_MAX_AGE_MIN`)
remains as the bootstrap for a session's *first* compaction, when no cycle
marker exists yet.

**Ordering is load-bearing.** Discovery must run before the marker is touched.
The reset is in the same hook, and doing it first would make every handoff look
older than the current cycle — nothing would ever be forwarded, silently.
`tests/compaction-hooks.sh` asserts this against a pre-existing marker so the
reset is a real overwrite, not a first write.

The cycle marker is deliberately separate from `.compact-base-<sid>`.
`compact-suggest.sh` rewrites the byte baseline when it sees a transcript
smaller than the recorded one, and a shared file would let that reset move a
cycle boundary mid-cycle. Only `pre-compact.sh` writes `.compact-cycle-<sid>`.

Filenames are `handoff-YYYY-MM-DD-HHMM.yaml`, so lexical order is chronological
and `sort | tail -1` selects the newest — chosen over `find -printf`, which is
GNU-only and absent on the platforms this must survive.

Symlinks are excluded (`-type f`) and the winning path passes through
`resolve_project_path()` before being read, so a handoff symlinked outside the
project cannot pipe external file content into the compaction instructions.

### Which session wrote it (round 6)

Timestamps cannot tell two sessions apart. Handoff filenames carry no session
identifier, so two Claude sessions working in one checkout write into the same
directory and the freshness rule above accepts both: the newest file wins even
when the other session wrote it, and this session's compaction gets steered by
instructions meant for the other one. Raised in review on the PR; reproduced
against the round-5 hook, which forwarded the foreign instruction.

`compact-suggest.sh` is the only place the two facts meet — its PostToolUse
payload carries `session_id` and `tool_input.file_path` together. It records the
path of any handoff it observes being written to `.compact-handoff-<sid>`, and
`pre-compact.sh` consults that record before the glob.

Six details:

- **Only writes claim.** `Read` carries a `tool_input.file_path` exactly like
  `Write` does, so an ungated branch made *reading* a handoff a claim on it —
  and `/tools:catchup`, whose entire job is to read the previous session's
  handoff, is the documented way that happens. The consequence was worse than
  no ownership tracking at all: at the time, the ownership branch bypassed the
  age window (it compared against the cycle marker, and a session's first
  compaction has no cycle marker — closed in round 10, below), so the reader
  forwarded instructions written for someone
  else's task however stale, while the claim simultaneously hid that handoff
  from every other session's fallback glob. The gate is a tool-name allowlist —
  `Write`, `Edit`, `MultiEdit`, `NotebookEdit`. A write that failed still claims
  nothing that matters, because `pre-compact.sh` skips claimed paths that do not
  exist. `tool_name` is a top-level key serialized ahead of `tool_input`, so the
  first-match extraction cannot be beaten by file contents containing the string
  — the same ordering argument the transcript scan uses, running the other way.

- **Ownership presupposes distinct files.** Two claims on one path are
  indistinguishable from one claim, so the naming scheme has to guarantee
  distinctness before the record can mean anything. `/tools:handoff` generates
  `handoff-YYYY-MM-DD-HHMMSS-$RANDOM.yaml`; at the former `-HHMM` granularity two
  sessions writing in the same minute wrote the *same file*, the second body
  destroying the first. The token trails the full timestamp so byte order remains
  chronological, and the candidate `sort` is pinned to `LC_ALL=C` — a UTF-8
  locale weights punctuation weakly enough to rank a legacy `-1400.yaml` above a
  `-140030-42.yaml` written thirty seconds later.

- **The record is written before the once-per-cycle exit.** The handoff is
  written *in response to* a nudge, so by then `.compact-nudged-<sid>` exists.
  Recording after that early exit would miss every real handoff.
- **The record is append-only — one line per handoff, not one line per
  session.** A session can write several handoffs in a cycle. Keeping only the
  newest leaves the earlier ones looking unattributed, and the *other* session's
  glob fallback then picks the older one up and forwards it — the same leak, one
  handoff further back. Found in review on this PR after the first ownership fix
  shipped, and reproduced end to end through the real hooks before changing
  anything. Repeated writes to the same path are collapsed against the last
  line, so a handoff revised ten times costs one line rather than ten.
- **Ownership does not override freshness.** A handoff this session wrote before
  the last compaction has already been summarized away; a line is used only when
  it names a file newer than the cycle marker. Lines are read in order and the
  last qualifying one wins, so a since-deleted newest claim falls back to the
  surviving earlier one rather than blanking the record.

  Where there is no cycle marker — a session's first compaction — the branch
  applies the same `HANDOFF_MAX_AGE_MIN` window the glob fallback uses, rather
  than accepting the claim at any age. Until round 10 it did the latter, and the
  asymmetry was reachable two ways: a session that wrote a handoff and then
  worked for hours before its first compaction, and a session resuming after
  `SessionEnd`. The second path is a regression introduced by round 9 itself,
  which kept `.compact-handoff-<sid>` past `SessionEnd` while `.compact-cycle-
  <sid>` is still deleted — before that change a resumed session fell through to
  the age-windowed glob, and after it the claim survived into an unwindowed
  branch. Because the loop keeps the *last* qualifying line, an unfiltered stale
  entry did not merely add a candidate, it displaced a fresher one. Where a
  cycle marker does exist it remains the authority, and it is the stricter
  signal: "written since the last compaction" is what freshness actually means,
  so a long-running session's second compaction does not lose a handoff merely
  for being older than the window.
- **The glob fallback excludes handoffs other sessions claimed — on any line.**
  Every session in the checkout writes its record into the same log directory,
  so a foreign handoff is identifiable even when this session wrote none. Claims
  are matched as whole newline-framed lines, so a same-named file under a longer
  directory prefix cannot suppress the local one.

The glob is kept rather than replaced: a handoff nobody claimed — written before
this feature existed, or by a means the PostToolUse hook cannot observe — is
forwarded exactly as before. Removing it would make the whole chain depend on
`compact-suggest.sh` being registered, turning a missing hook registration into
silent total failure instead of a narrower one.

Residual: a handoff written by a tool call the hook cannot see (a `Bash`
heredoc, say) is unattributable and still reachable by the fallback. That is the
pre-existing behaviour, not a new exposure.
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
| `.claude/hooks/pre-compact.sh` | Rewritten: stdout contract, handoff discovery + extraction, read-only map check, cycle marker + nudge re-arm; checkpoint retained as the debounced tail. ROADMAP marker patterns fixed; feature derivation fixed (round 5); ownership record preferred over the glob, foreign claims excluded from it (round 6) |
| `.claude/hooks/compact-suggest.sh` | Rewritten: measured context-token threshold with byte growth as fallback, one nudge per compaction cycle, `additionalContext` payload; records handoff authorship ahead of the cycle exit (round 6) |
| `.claude/hooks/_common.sh` | Added `session_id_from_json()`, `json_string_field()` |
| `.claude/hooks/session-end-cleanup.sh` | Removes the session-private `.compact-base-*` / `.compact-nudged-*` / `.compact-cycle-*`; deliberately **keeps** `.compact-handoff-*`, which concurrent sessions read, and lets the 7-day prune collect it. 7-day prune of all four |
| `.claude/commands/tools/handoff.md` | `compact_instruction` mandatory; new "How `compact_instruction` is used" section; note that auto-checkpoints cannot record rationale |
| `tests/compaction-hooks.sh` | New — 118 assertions across sandboxed project roots |
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

`tests/compaction-hooks.sh` — 158 assertions, all passing. Per
`.claude/rules/tests.md` each case builds its own state and asserts specific
values, not truthiness.

**Wiring.** Almost every case invokes a hook directly, which means almost none
of them can tell whether the hook is registered for the event it was written
for. Round 11 added a hook-registration section that parses the real
`.claude/settings.json` and pins each event's matcher against the tool list read
out of the hook source. The gap it closes is not hypothetical: the ownership
claim reads `file_path` out of `tool_input` and runs correctly on a `PreToolUse`
payload whether or not it is registered for `PreToolUse`, so the entire
pre-claim could have been dead in production with the suite green.

**Sandboxing.** Each case runs `new_sandbox()`: a `mktemp -d` root with
`.claude/hooks`, `.claude/sessions`, `.claude/logs` and `scripts/`, the four
hooks copied in, a `scripts/system-map.ts` stub (`process.exit(0)`, rewritten to
`process.exit(3)` to simulate drift), and a synthetic `ROADMAP.md`. Because the
hooks resolve their project root as `$SCRIPT_DIR/../..`, copying them makes that
resolution land inside the sandbox — so tests exercise real filesystem
behaviour without touching the repo. This is what caught the ROADMAP-marker bug
below; a mock would have encoded the same wrong assumption.

Groups:

- **compact-suggest (byte fallback)** — fires above threshold, silent below;
  once per cycle; transcript smaller than baseline resets the baseline instead
  of reporting negative growth; missing transcript exits 0; a `session_id` of
  `../../etc/passwd` writes `.compact-nudged-etcpasswd` and nothing outside the
  log directory.
- **compact-suggest (context signal)** — nudges at the measured percentage and
  reports it; silent below; the two cache fields are counted (input alone would
  read 0%); raising `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves the nudge point with
  it; `PROJECT_OS_COMPACT_NUDGE_PCT` overrides the derivation; a larger window
  lowers the measured percentage; a sidechain record is not mistaken for the
  main thread **and** does not discard the main-thread record before it; 400 KB
  of transcript at 20% context stays silent even with the byte threshold set to
  fire; with no `usage` record the fallback fires and claims no percentage.
  These run under `env -u` with the window and threshold pinned, so they do not
  inherit the real session's `settings.json` values.
- **pre-compact** — instruction body forwarded; multi-line body forwarded
  intact; handoff path named; **stdout is plain text, not JSON**; newest handoff
  wins; placeholder rejected; on a session's first compaction a handoff older
  than 30 min (`touch -d '2 hours ago'`) is ignored; silence when there is
  nothing to say; drift caveat alone; drift caveat appended to an instruction.
- **cycle-scoped freshness** — a handoff written during the current cycle is
  forwarded even when it is an hour old by the clock; a handoff written five
  minutes ago but *before* the cycle marker is ignored; discovery happens before
  the marker is reset (asserted against a pre-existing marker); an instruction
  forwarded by one compaction is not re-forwarded by the next.
- **session ownership** — a `Write` to a handoff path records the authoring
  session; a write to any other path records nothing; the record is written even
  when the nudge already fired this cycle (the case that matters, since the
  handoff always follows the nudge); a concurrent session's *newer* handoff loses
  to this session's own; a foreign handoff is not reachable through the glob
  fallback either, but an *unclaimed* one still is; exclusion skips to the next
  candidate rather than abandoning the search; a claim on a path that merely ends
  with the same filename does not suppress the local handoff; ownership does not
  exempt a handoff from the cycle boundary; a record pointing outside the project
  is rejected by the same containment guard as the glob result.
- **containment** — a handoff symlinked outside the project is rejected, *and* a
  symlink to an in-scope sibling is rejected too. The second case exists so a
  future switch to `-type f -o -type l` fails here.
- **cycle handshake** — pre-compact clears the nudged marker, opens the cycle
  marker, and resets the baseline to the current size; no re-nudge without
  growth; re-nudge after growth.
- **checkpoint** — file written; phase derived as `"build"`; feature derived
  from the `## Feature:` heading; in-progress description recorded; absence of a
  handoff recorded as "rationale not captured"; an in-progress task in an
  *earlier* feature section is still found when a later section has none; a
  ROADMAP with no in-progress task yields `"none"` rather than the first
  heading; `[~]` counts for both feature and phase; the 10-minute debounce
  suppresses a second file **but still forwards the instruction**.
- **malformed input** — empty stdin, non-JSON stdin, and a `session_id`
  containing a space all exit 0 on both hooks.
- **session-end-cleanup** — removes this session's markers including the cycle
  marker and the ownership record, leaves other sessions' intact.

`tests/hook-smoke.sh` still passes 15/15 — no regression.

Not automatable here, and left to observation in real sessions: that
auto-compaction actually fires near 75% of the configured window. The nudge
point no longer needs observation — it is measured against that same window in
the same unit.

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
| The nudge threshold is miscalibrated and fires too early or too late | Low | Medium | Resolved in round 5. The threshold is a percentage of the same window auto-compaction measures against, computed from the transcript's own `usage` records — there is nothing left to calibrate. `PROJECT_OS_COMPACT_NUDGE_PCT` tunes the 15-point headroom if a session wants more or less runway |
| The transcript format changes and no `usage` record parses | Low | Medium | Degrades to the byte fallback, which nudges without claiming a percentage. Silent, but the failure mode is a coarser nudge rather than no nudge. Asserted by `context_noUsageRecord_fallsBackToByteGrowth` |
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

**RESOLVED (round 5) — the pressure proxy measured the wrong quantity.** Raised
in round 4 as "the proxy is uncalibrated", which understated it. Transcript
bytes were a stand-in for a token count the design asserted hooks never receive.
They do receive it: `message.usage` in every assistant record carries
`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, which is
the context size in the same unit as the window. And bytes were not a
conservative approximation of it — the transcript retains discarded history, so
it diverges further from real context with every compaction. Measured live:
2,897,308 bytes against 106,432 tokens, 27 bytes/token against a typical ~4, and
the nudge firing at ~53% of the window. Replaced with the measured count; bytes
kept only as a fallback. The round-4 finding is the same mistake the round-3
finding was — an assumption about what a channel carries, asserted rather than
checked. `patterns.md`'s *"Verify the Channel Before Designing the Gate"* covers
both.

**RESOLVED (round 5) — 30 minutes was asserted, not derived.** Raised in round 4
as OPEN/LOW: the freshness bound was borrowed from the checkpoint debounce,
which was chosen for a different purpose. Rather than find evidence for a
better number, the question was replaced: freshness is now "written during the
current compaction cycle" (`-newer .compact-cycle-<sid>`), which is what the
rule was trying to approximate and has no free parameter. The 30-minute window
survives only as the bootstrap for a session's first compaction.

**RESOLVED (round 5) — feature derivation lost matches across sections.** Found
by writing the round-5 tests, not by review. The `## Feature:` extraction
tracked a per-section `found_task` flag and printed it at the next heading, but
reset the flag on every `## Feature:` line — so an in-progress task in an early
section was discarded as soon as a later section without one was read, and the
checkpoint recorded `feature: "none"`. Latent since the round-4 marker fix,
which corrected the regex but left this. Rewritten to print at the first marker,
which removes the state that could be lost.

**RESOLVED (round 6) — handoff discovery was not correlated with the session.**
Raised by an automated reviewer on the PR, and the first finding in this feature
that came from outside. Every round had treated `.claude/sessions/` as belonging
to one session; the cycle marker was session-scoped, but the handoff filenames
it filtered are not, so two sessions in one checkout could cross their
instructions. Reproduced against the round-5 hook before fixing: with s1 and s2
each owning a handoff, the old hook forwarded s2's instruction to s1's
compaction; the new one forwards s1's. Fixed by recording authorship in
`compact-suggest.sh`, which is the only hook that sees the session id and the
written path in the same payload.

The near-miss worth recording: the obvious fix — stamp a `session_id` field into
the handoff YAML — cannot work, because the model writing the handoff has no
reliable way to learn its own session id. Only a hook does. Reaching for the
hook payload instead of the document is what made the fix possible at all.

**RESOLVED (round 6b) — the ownership record kept one path, not one per
handoff.** The same reviewer, reviewing the fix above, found it incomplete: the
record was written with `>`, so a session that wrote two handoffs in a cycle
claimed only the second. The other session's glob fallback excluded that one and
took the first — the identical leak, one handoff further back. Reproduced end to
end through the real hooks rather than a hand-built fixture, because the fixture
is exactly what the previous round got wrong: driving `compact-suggest.sh` with
two PostToolUse payloads showed `claims recorded: 1 | forwarded to s1: SESSION
TWO first instruction` at `HEAD` against `2 | <nothing>` in the working tree.

The lesson generalizes past this bug: an ownership record whose cardinality is
"one per owner" silently assumes owners produce one artifact. Both readers now
consume every line, and own-claim selection takes the *last* line that still
exists and is fresh — so a since-deleted newest claim degrades to the surviving
earlier one instead of blanking the record. Two rounds of this feature have now
been fixed by widening what a record can hold rather than by tuning how it is
read.

**RESOLVED (round 6c) — two sessions could write the same handoff path.** The
third finding in the same review, and the one that reaches past the record
entirely: `/tools:handoff` named files at minute granularity, so two sessions
running it in the same minute wrote one file. Both records then claimed that
path truthfully, and the surviving body — whichever session wrote last — was
forwarded to both summarizers. The reviewer's framing was right that no amount
of claim tracking fixes this: claims name paths, and here the paths are equal.
The other session's handoff is not merely mis-attributed, it is *gone*, which is
the worse half of the bug and is real whether or not compaction ever runs.

The fix is in the naming, not the hooks: seconds plus a `$RANDOM` token, placed
after the timestamp so the `sort`-based "newest" selection is undisturbed. Every
consumer of the name globs (`handoff-*.yaml`, or `handoff-2026-02-*.yaml` in
`archive-sessions.sh`), so a longer suffix is transparent to all of them; the
one real coupling was the ordering assumption, which is now pinned to `LC_ALL=C`
and covered by tests for variable-width tokens and for legacy names mixed with
suffixed ones.

A session-id suffix — the literal reading of "session-specific" — remains
unavailable for the reason recorded twice above: the model has no reliable way
to learn its own session id. Collision *resistance* was achievable where
collision *impossibility* was not, and it is enough here, because the failure it
prevents needs two writes in the same second with the same 15-bit token.

**RESOLVED (round 7) — the usage scan could read a tool payload, or a foreign
JSON body.** Raised in review against the round-6c commit. `message.content` is
serialized before `message.usage`, so the leftmost `"usage"` in a record is not
necessarily the message's: a `tool_use` input carrying its own `usage` object
would be measured instead of the context, and because tool payloads carry small
numbers, the hook would go quiet at exactly the pressure it exists to report.
The adjacent hole is a user record's `toolUseResult` — arbitrary JSON from an
MCP server or a file read — supplying a number from outside the session.

Probed before changing anything, and the honest result is that neither occurs in
the transcript that motivated the finding: 0 of 1571 records carry more than one
`"usage"` key, and first-based and last-based extraction agree on 125936. The
*ordering premise* does hold — `content@181 tool_use@200 usage@457` — and
`type:assistant` is present on 635 of 635 records carrying a usage object, so
both guards are free. They shipped as structural hardening, with the absence of
a live reproduction recorded in the hook comment rather than implied away. The
two new tests fail against the pre-fix hook: the nested-payload case goes silent
at 75%, and the user-record case nudges at a fabricated 95%.

**RESOLVED (round 7) — `--untracked-files=all` for the checkpoint's file list.**
Second finding in the same review, and a genuine gap left by the round-4 fix
above. `git status --porcelain` collapses a wholly untracked directory to a
single `?? dir/` entry, so a session that built a new feature under a new
directory — the session with the most to preserve — handed the next one a
directory name instead of the files it had just written. Reproduced directly in
this repo before the change. Ignored paths stay excluded at either setting, so
this expands what was already reported rather than widening the set; a
`.gitignore` assertion pins that. The sandboxes the other checkpoint tests use
are bare `mktemp` directories where git reports nothing at all, so the new test
`git init`s its sandbox and is the only one that exercises `modified_files`.

**RESOLVED (round 8) — a `Read` of a handoff claimed ownership of it.** Raised
in review against the round-7 commit. The ownership branch keyed on
`tool_input.file_path` without checking `tool_name`, and `Read` carries that
field too. `/tools:catchup` — the documented way a session picks up its
predecessor's handoff — therefore made the reader claim the author's file. This
is worse than not tracking ownership at all: the ownership branch bypasses the
age window entirely, comparing only against the cycle marker, and a session's
first compaction has no cycle marker, so the reader's summarizer received
instructions written for a different task at any age. The claim also removed
that handoff from every other session's fallback glob. Fixed with a tool-name
allowlist (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). Two of the three new
assertions fail against the pre-fix hook — the record is written on a `Read`,
and the foreign instruction reaches the reader's summarizer end to end; the
third pins that `MultiEdit` still claims, which the allowlist could have broken.

**RESOLVED (round 8) — the checkpoint's path list could be invalid YAML.**
Second finding in the same review, and one the round-7 change made reachable.
Without `-z`, git C-quotes any path outside plain ASCII: under the default
`core.quotePath`, `café.txt` is reported as `"caf\303\251.txt"`. The hook
stripped the surrounding quotes and left the octal escapes in the value, and
`\3` is not a legal escape inside a double-quoted YAML scalar — so a single
accented filename made the *whole* checkpoint unparseable, costing the session
its objective, its in-progress tasks and its handoff pointer along with the file
list. Untracked paths are the likeliest to carry a human-typed name, so
expanding them in round 7 walked straight into it.

`core.quotePath=false` was not enough — it un-quotes non-ASCII only and leaves
`"`, `\`, newline and tab escaped. `-z` disables quoting entirely and emits raw
bytes; it cannot be captured with `$( )`, which drops NUL bytes, so the list is
read through process substitution. Under `-z` a rename is two NUL-terminated
records (`XY <new>\0<old>\0`) rather than one `old -> new` string, so the origin
is now read and discarded — left unread it would have become the next entry,
with status bytes taken from whatever its own filename began with. Escaping runs
backslash-first so the escapes it introduces are not themselves re-escaped.
Three of the five new assertions fail against the pre-fix hook; the two rename
assertions pin behaviour the `-z` rewrite could have broken, and the test forces
`core.quotePath=true` in its sandbox rather than inheriting it, so a machine
whose global config turns it off cannot make the test pass against the old code.

**RESOLVED (round 9) — the nudge could be delivered to a sub-agent, which spent
the cycle's only nudge on a reader that could not act on it.** Round 8 taught
the scan to find the main thread's number during a sub-agent run, and treated
that as the whole fix. It was half of one: knowing the right number does not
make it the right moment to speak. `additionalContext` goes to whichever agent
made the tool call, so a nudge raised mid-sub-agent-run reaches the sub-agent
and writes `.compact-nudged-<sid>` anyway — after which the main thread is
silently skipped for the rest of the cycle. Round 8 made this *more* reliable
rather than less, because the byte proxy it replaced fired only past 1.2 MB
while the token path fires whenever the threshold is genuinely crossed.

The scan now returns two values: the main thread's token total, and whether the
newest `usage`-bearing record is a sidechain one. The second is a delivery gate
— when set, the hook exits without emitting and without spending the marker.
The escalating window stays, but its justification narrows to what it actually
still covers: a run of tool-result records long enough to push the newest
assistant record out of a 60-line tail. Reversing an assertion written and
defended one round earlier is the honest cost here — round 8's
`context_sidechainRunLongerThanScanWindow_stillMeasuresMainThread` asserted a
nudge fires mid-sidechain, which is now precisely the thing that must not
happen. It is replaced by a fixture where the main thread takes a turn *after*
the sub-agent run, which still catches the original bug (a scan that measured
sidechains would read 500 tokens and stay silent) without asserting the wrong
destination. See the delivery-gate bullet above for the two bounds this leaves
standing.

A live incident during the change is pinned as its own assertion. The two-value
output was consumed with `tr -cd '0-9'` across the whole line for one edit,
which fused `98800 0` into `988000` — the hook reported context at 494% of the
window and nudged on a session sitting at 49%. Splitting the fields before
stripping non-digits is the fix; `context_twoFieldScanOutput_notFusedIntoOneNumber`
is the guard, and it pins the new code rather than failing against the old,
since a single-field output had no fusion hazard to begin with.

**RESOLVED (round 9) — ROADMAP text reached double-quoted YAML scalars with only
`"` escaped.** The same failure the path list had in round 8, from a source
round 8 did not touch and which the reader controls far more directly. A task
description or `## Feature:` heading containing a backslash — a Windows path, a
regex — ended its escape sequence at an illegal character and made the whole
checkpoint unparseable. Verified rather than argued: a ROADMAP reading
`## Feature: parse C:\shellout "paths"` produced a checkpoint that PyYAML
rejects with `found unknown escape character 's'` at line 3, aborting the
document and taking `objective`, `in_progress`, `next_steps` and
`compact_instruction` with it.

The fix is a single `yaml_escape()` used by every double-quoted scalar built
from data the hook did not author — the path list, the task descriptions and the
feature name — rather than a fourth copy of the four substitutions. The audit
that produced it also settled the values that must *not* be escaped:
`compact_instruction` and `context_notes` are literal block scalars, which take
their content verbatim, so escaping there would put literal backslashes into the
summarizer's instructions. That is now a comment in the hook, so the next reader
does not "fix" it. The remaining quoted scalars are hook-authored constants or
git's two status bytes. Both the escaped output and the pre-fix failure are
checked against a real YAML parser, not just asserted as substrings.

**RESOLVED (round 9) — `SessionEnd` deleted the handoff ownership record, which
is the one marker read across sessions.** `.compact-base-*`, `.compact-nudged-*`
and `.compact-cycle-*` are session-private and correctly die with the session.
`.compact-handoff-*` is not: it is what tells a *concurrent* session that a
handoff already on disk belongs to someone else. Deleting it at `SessionEnd`
un-claimed this session's handoffs the instant it exited, so the next session's
fallback glob picked up the newest file and forwarded a `compact_instruction`
written for a task that was not its own — the exact failure ownership tracking
was introduced to prevent, reintroduced at the moment the session ended. The
handoff file outlives the session; the record of who wrote it has to outlive it
too. The 7-day prune already covered `.compact-handoff-*` and is now the only
thing that collects it, which is the safe direction: a stale claim merely
excludes a handoff from the fallback glob, and a handoff that old fails the
freshness filter regardless.

**RESOLVED (round 10) — the delivery gate discarded the main thread's own
`Task`-completion nudge.** Round 9 inferred "who is speaking" from the
transcript tail, and inference cannot separate a sub-agent's own tool call from
the main thread's `PostToolUse` for the *completed* `Task`: at that instant the
sub-agent's last turn is still the newest `usage`-bearing record either way. So
the gate dropped a genuine main-thread firing. Round 9 named this in its own
design text and accepted it as "one further turn" of delay — the same pattern as
round 8 naming the mis-delivery and shipping a fix for something else. The
acceptance was wrong, because there is no guarantee of a further turn: if the
resumed turn ends without another tool call, or auto-compaction fires first, no
later `PostToolUse` delivers the nudge and the cycle is lost outright. Nothing
recovers it — the marker logic has no notion of a nudge that was owed and never
sent.

The gate now reads `agent_id` from the payload and compares it to `session_id`.
Reading the shipped CLI's payload assembly also closed round 9's stated open
question: `session_id` is resolved from the session independently of the agent,
so sub-agent firings *do* share the main session's id, and the marker spend was
the serious half of the bug rather than a possibility. The tail heuristic
remains only for a payload with no `agent_id` key at all, since treating an
absent key as "main thread" would retire the guard silently on an older CLI. One
consequence in the scan loop: it stopped early on a sidechain tail, which was
right only while that tail decided delivery — with identity known, a sidechain
tail is exactly the case needing the *wider* window, because the
`Task`-completion firing sits behind a whole sub-agent run's worth of records.
Five of the nine new assertions fail against the pre-fix hook; the rest pin
behaviour the change could have broken — the fallback path for `agent_id`-less
payloads, the byte proxy on the main thread, and the ownership claim, which is
deliberately recorded *above* the identity exit so a sub-agent's handoff write
still claims its file.

**RESOLVED (round 10) — an owned handoff bypassed the age window before the
first compaction.** The ownership branch accepted any claimed path when no cycle
marker existed, while the glob fallback applied `HANDOFF_MAX_AGE_MIN`. The
asymmetry had been described in this document twice as an accepted property; it
was a defect. Two reachable paths: a session that wrote a handoff and worked for
hours before its first compaction, and a session resuming after `SessionEnd` —
and the second is a regression from round 9, which kept `.compact-handoff-<sid>`
past `SessionEnd` while `.compact-cycle-<sid>` is still deleted, so a claim that
used to expire with the session now survives into an unwindowed branch. Because
the loop keeps the last qualifying line, a stale entry displaced a fresher one
rather than merely joining it. The branch now applies the same window when no
cycle marker exists, using `find -maxdepth 0 -mmin` on the single path so both
branches share one tool and one threshold; where a cycle marker does exist it
still governs, being the stricter and more meaningful signal. Three of the four
new assertions fail against the pre-fix hook; the fourth pins that the cycle
marker still wins when present.

**RESOLVED (round 11) — the completed tool result was invisible to the
measurement that decides whether to nudge.** `PostToolUse` fires after the tool
produced its result but before the model's next request, so the newest assistant
`usage` record describes the request that *asked for* the tool. The result now
sitting in context is not counted until one more turn has gone by. The 15-point
gap between the nudge line and the compaction line normally absorbs that lag —
it exists precisely so a turn's worth of growth cannot skip the nudge. It does
not absorb a single result that crosses the whole gap: a large `Read` or a wide
`Grep` can add ~30k tokens in one step, taking the session from below the nudge
line to at or past the compaction line without ever being measured in between,
and the nudge is then never owed at a moment it could still be delivered. That
is the same "cycle lost outright" failure round 10 fixed by a different route.
`PENDING_TOKENS = ${#INPUT} / 4` is added to the measured count in the token
branch only; the byte-proxy branch already scales with payload size, so adding
it there would double-count.

This correction is a proxy, not a measurement, and the direction of its error is
the point. 4 bytes/token is the English-prose ratio; JSON and source code both
run denser, so the estimate comes in **under** the true cost of the payload. The
hook therefore still nudges later than an exact accounting would, but it never
nudges on a number larger than reality. Given the alternative — a hook that
inflates context pressure and burns the once-per-cycle nudge early — running
short is the correct failure. It narrows the gap; it does not close it.

**RESOLVED (round 11) — the record-type guard was a substring test on a line
containing nested JSON.** Round 6 required `"type":"assistant"` somewhere on the
line before measuring a record. A transcript record nests arbitrary structured
data, and `toolUseResult` is an object in 687 of 2958 records (plus 65 arrays),
with its contents *not* escaped — so a tool result carrying an assistant-shaped
object satisfied the guard, and the scan measured a tool payload as the
session's context. Escaped occurrences were never the exposure: `\"type\"` has a
backslash before the quote, so the regex never matched it.

The same probe ruled out the cheap fix and made the strict one free. `message`
is serialized ahead of the top-level `type` in all 1185 assistant records (mean
offset 2194 bytes, max 33108), so there is no prefix window a scan could trust;
and all 1185 `"usage":` keys sit at exactly depth 2, so requiring that depth
costs nothing against real data. The awk now reduces each record to a
brace/bracket skeleton — substituting sentinels for the three keys it reasons
about *while the quotes are still intact*, then stripping escapes and string
bodies — and walks it: `type:assistant` and `isSidechain` count only at depth 1,
and only a depth-2 `usage` key is measured. A record whose only `usage` object
lives deeper is skipped outright rather than measured on whatever payload
happens to be there. The skeleton work is prefiltered behind
`index($0, "\"usage\":")`, so the common path pays one substring test.

Recorded with the same honesty round 6 applied to its own guard: in the
transcript this was measured against, 0 of 1182 raw-regex hits had a
non-assistant top-level type and 0 unescaped occurrences sat outside depth 1.
This is structural hardening against a silent failure, not a fix for an observed
one — the failure mode it prevents is a wrong number reported confidently, which
is worse than no number.

**RESOLVED (round 11) — ownership was claimed after the artifact it
describes.** The claim ran on `PostToolUse`, so between the `Write` creating
`handoff-*.yaml` and the hook recording who wrote it, the file is discoverable
and unattributed. A concurrent session compacting inside that window takes the
fresh handoff off the fallback glob and forwards a `compact_instruction` written
for someone else's task — the round-5 leak reached by timing rather than by a
missing record. The window is narrow, it widens with hook latency, and it is the
failure this chain has now closed three times.

Fixed by inverting the order rather than by adding synchronization.
`compact-suggest.sh` is registered on `PreToolUse` for the write tools as well,
where it records the claim and exits, so the claim is on record before the
artifact can exist. The `PostToolUse` pass is kept as a backstop for a write
this session did not see the start of, and both passes collapse against the last
line, so claiming twice costs nothing. Exiting 0 and printing nothing on the
`PreToolUse` path is load-bearing: that is the one event where a hook can deny
the tool call, and an advisory hook must never be able to block a write.

Encoding ownership in the published artifact was considered and rejected for the
reason recorded twice before — the model authoring a handoff has no reliable way
to learn its own session id, which is why the claim lives in a hook payload in
the first place.

This round also added the suite's first **hook-registration** assertions, which
read the real `.claude/settings.json`. Every other assertion invokes a hook
directly, so none of them can see whether the hook is wired to the event it was
written for; and the claim block reads `file_path` out of `tool_input` and works
on a `PreToolUse` payload whether or not it is registered for that event. The
entire pre-claim could therefore have been dead in production with the suite
green. The assertions pin the `PreToolUse` matcher to the tool list the claim
block actually gates on — extracted from the hook source, so the two cannot
drift apart — and pin that the catch-all `PostToolUse` registration survives,
since the nudge and the backstop both still depend on it.

Seven of the eighteen new assertions fail against the pre-fix hooks and pre-fix
settings: three for the record-type parse, one for the pending result, three for
the pre-claim. The remaining eleven pin properties the fixes must not break —
escaped decoys stay immune, a small payload does not perturb the measurement, a
read of a handoff still claims nothing, and the `PreToolUse` pass neither emits
nor spends the once-per-cycle marker.
