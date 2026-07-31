#!/bin/bash
# PostToolUse hook: when context pressure builds, tell Claude to write a
# handoff while it still has the context to write one.
#
# Also registered on PreToolUse for the write tools, where it does one thing and
# stops: record that this session is about to write a handoff, so the ownership
# claim cannot lag behind the file it describes. See the claim block below.
#
# WHY THIS HOOK CARRIES THE REQUIREMENT
# PreCompact can block compaction, but on the auto path a block reaches only a
# debug log — never Claude — so it defers compaction without telling anyone
# why. PostToolUse can inject `hookSpecificOutput.additionalContext` straight
# into Claude's context, which makes it the only place a "write the handoff
# now" instruction can actually land. pre-compact.sh then forwards whatever
# instruction that handoff drafted to the compaction summarizer.
#
# THE SIGNAL IS A REAL TOKEN COUNT, NOT A PROXY.
# Every assistant record in the transcript JSONL carries a `usage` object, and
#   input_tokens + cache_read_input_tokens + cache_creation_input_tokens
# is the context that was actually fed to the model on that turn. The newest
# such record is therefore the current context size, in the same unit as the
# window it is measured against — no calibration required.
#
# An earlier version used transcript bytes as a stand-in. That was not merely
# uncalibrated, it measured the wrong quantity: the transcript accumulates
# discarded history forever, so after one compaction it kept growing while the
# real context had dropped by half. Observed on a live session: 2.9 MB of
# transcript against 106k tokens of context — 27 bytes/token where ~4 is
# normal. Bytes survive only as a fallback for when no usage record parses.
#
# Per-session marker files are cleaned up by session-end-cleanup.sh.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

# ── Kill switch ─────────────────────────────────────────────────────────────
# This hook runs on every tool call, on two separate events. If it ever
# misbehaves — a pathological transcript, a nudge firing in a loop — the only
# other way to stop it is editing settings.json, which is a poor thing to have
# to do from inside the session that is already going wrong. An env var can be
# set for a single run without touching tracked configuration.
#
# Written as an `if` rather than `[ … ] && exit 0`. Both are correct here —
# bash exempts a command in a non-final position of an && list from `set -e`
# and from the ERR trap, so the unset case falls through either way (verified,
# not assumed). The `if` is used because the exemption is a subtlety a reader
# has to recall to be sure, and a guard whose safety depends on remembering a
# `set -e` corner case is one edit away from not having it.
if [ -n "${PROJECT_OS_COMPACT_DISABLE:-}" ]; then
    exit 0
fi

# Every measurement and every parse in this hook is byte-oriented, and two of
# them are silently locale-dependent without this pin.
#
# `${#INPUT}` is the sharper one. Bash counts CHARACTERS under a multibyte
# locale and BYTES under C, so the pending-payload estimate below — whose
# divisor is calibrated in bytes — undercounts by the UTF-8 encoding width the
# moment the hook inherits a UTF-8 locale: a CJK-heavy tool result measures at a
# third of its size. The hook must not depend on what the caller's environment
# happens to set. (This container inherits no locale at all, so `${#INPUT}`
# already returns bytes here and the bug is latent rather than live — but
# `C.utf8` is present and would trigger it, and LANG=C.UTF-8 is the default in
# most Debian-derived images.)
#
# The transcript scan is the other: its awk reduces records to a skeleton by
# stripping escapes and string bodies, which is defined on bytes. Under a UTF-8
# locale that work is re-interpreted as characters, and an invalid sequence
# anywhere in a multi-megabyte transcript becomes the parser's problem.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

PROJECT_ROOT="$(get_project_root)"
LOG_DIR="$PROJECT_ROOT/.claude/logs"
mkdir -p "$LOG_DIR"

# The window auto-compaction measures against, and the percentage of it at
# which compaction fires. Both are read from the same env vars the runtime
# uses, so the nudge tracks the trigger instead of guessing at it.
# Reject, do not scrub. `tr -cd '0-9'` deletes the characters that make a value
# wrong and keeps the digits that surround them, which turns malformed input
# into a plausible-looking number instead of a rejected one:
#   0.9  -> 09   — a leading zero, which `$((…))` reads as OCTAL. `09` is not a
#                  valid octal literal, so the arithmetic below ABORTS the hook.
#   1e6  -> 16   — a 16-token window. Every nudge fires, every turn.
#   -5   -> 5    — the sign is deleted and the negation is silently inverted.
# None of these is a number the caller asked for, and each fails somewhere far
# from the assignment. A value that is not a plain non-negative integer is not
# repairable; the only safe reading of it is "unset", so it falls back to the
# default the same way an absent variable does.
#
# `10#` on every arithmetic use of these below, so a caller who legitimately
# writes `075` gets 75 rather than 61.
posint_or_default() {
    case "$1" in
        ''|*[!0-9]*) printf '%s' "$2"; return ;;
    esac
    if [ "$((10#$1))" -gt 0 ] 2>/dev/null; then
        printf '%s' "$((10#$1))"
    else
        printf '%s' "$2"
    fi
}

WINDOW=$(posint_or_default "${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-}" 200000)
COMPACT_PCT=$(posint_or_default "${CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:-}" 75)
# A percentage at or above 100 never triggers, which would make the derived
# nudge threshold meaningless rather than merely generous.
[ "$COMPACT_PCT" -lt 100 ] || COMPACT_PCT=75

# Nudge with 15 points of headroom below the compaction threshold — at a 200k
# window that is ~30k tokens, ample for a handoff turn. Derived from the
# trigger rather than asserted, so raising the threshold moves the nudge with
# it. Overridable for sessions that want more or less runway.
#
# The override goes through the same validation as the runtime's own vars — it
# was previously taken verbatim, so `PROJECT_OS_COMPACT_NUDGE_PCT=abc` reached
# the `-ge` comparison as a non-numeric and, under `set -e`, killed the hook on
# every tool call for the rest of the session. A value at or above COMPACT_PCT
# is not a nudge at all (the compaction it is warning about has already fired),
# so it is rejected rather than clamped: clamping would silently deliver
# behaviour the caller did not ask for.
DERIVED_NUDGE_PCT=$((COMPACT_PCT - 15))
[ "$DERIVED_NUDGE_PCT" -ge 20 ] || DERIVED_NUDGE_PCT=20
NUDGE_PCT=$(posint_or_default "${PROJECT_OS_COMPACT_NUDGE_PCT:-}" "$DERIVED_NUDGE_PCT")
[ "$NUDGE_PCT" -lt "$COMPACT_PCT" ] || NUDGE_PCT="$DERIVED_NUDGE_PCT"

# Fallback only: transcript-byte growth since the last compaction, used when
# no usage record can be read (e.g. a transcript format change).
NUDGE_BYTES=$(posint_or_default "${PROJECT_OS_COMPACT_NUDGE_BYTES:-}" 1200000)

INPUT=$(cat 2>/dev/null || true)

# Every top-level key this hook reads — `session_id`, `transcript_path`,
# `hook_event_name`, `tool_name`, `agent_id` — is serialized ahead of
# `tool_input`. Extracting from the truncated prefix rather than the whole
# payload makes that a structural fact instead of an assumption; see the long
# note at the `agent_id` read for the failure it prevents. `%%` is a bash string
# operation on a variable already in memory, so this costs no re-read.
PAYLOAD_PREFIX="${INPUT%%\"tool_input\"*}"

SESSION_ID=$(session_id_from_json "$PAYLOAD_PREFIX")
TRANSCRIPT=$(json_string_field "$PAYLOAD_PREFIX" transcript_path)

# ── Record which session authored a handoff ─────────────────────────────────
# Handoff filenames carry a timestamp but no session identifier, so two Claude
# sessions sharing one checkout look identical to pre-compact.sh's discovery
# glob: the newest file wins even if the other session wrote it, and this
# session's compaction gets steered by instructions meant for the other one.
# This hook is the only place the two facts can be correlated — it sees the
# session id and the path being written in the same payload. pre-compact.sh
# prefers this record and falls back to the glob when it is absent (a handoff
# written by some other means still gets forwarded, as before).
#
# MUST precede the once-per-cycle exit below: the handoff is written *after*
# the nudge, so by then the nudged marker exists and everything past it is
# skipped.
#
# The record is append-only, one path per line, because a session can write
# more than one handoff in a cycle. Keeping only the newest would leave the
# earlier ones looking unclaimed to a concurrent session's glob fallback, which
# would then forward this session's older instruction to that session's
# summarizer — the same class of bug ownership tracking exists to prevent.
# Repeated edits to the same file are collapsed against the last line, so a
# handoff revised ten times costs one line, not ten. SessionEnd removes the
# record; the 7-day prune covers sessions that never fired one.
#
# Only WRITES claim. `Read` carries a `tool_input.file_path` too, so without
# this gate `/tools:catchup` — whose whole job is to read the previous
# session's handoff — made the reader claim the author's file. That is worse
# than not tracking ownership at all: the reader would forward a stale
# instruction written for someone else's task, and the claim would
# simultaneously hide that handoff from every other session's fallback glob.
# (At the time that was compounded by the ownership branch in pre-compact.sh
# skipping the age window whenever no cycle marker existed; both branches share
# one window now, but the claim gate is what keeps a reader out of the record in
# the first place.)
#
# THE CLAIM RUNS ON PreToolUse AS WELL AS PostToolUse, and that is the point.
# Recorded only after the write, the claim trails the artifact it describes: for
# the interval between the file appearing on disk and this hook appending its
# path, the handoff exists unclaimed, and a second session entering PreCompact
# in that window sees it as unattributed and forwards its compact_instruction to
# its own summarizer. A claim appended a millisecond later cannot un-compact
# anything. Claiming on PreToolUse inverts the order — the claim is on record
# before the file can be discovered — and the PostToolUse pass is kept as the
# backstop for a write this hook did not see the start of. Both passes collapse
# against the last line, so claiming twice costs nothing.
#
# BUT A PreToolUse CLAIM IS A RESERVATION, NOT A FACT, and nothing clears it.
# The tool it anticipates may be denied at the permission prompt or fail on its
# own terms (an `Edit` whose `old_string` does not match), and PostToolUse never
# fires to say so — there is no event this hook could roll the claim back from.
# For a file being CREATED that costs nothing: the path never comes into
# existence and both readers in pre-compact.sh skip a claimed path that is not
# there. For a file that ALREADY EXISTS it is a fresh instance of the leak this
# record exists to prevent — an attempted edit of another session's handoff
# claims that session's file permanently, and because the file does exist, the
# ownership branch accepts it and forwards a foreign compact_instruction to this
# session's summarizer. Reproduced end to end through both real hooks.
#
# So the reservation is taken only for a path that does not yet exist, which is
# exactly the set with the race in it. An existing file has no unclaimed window
# to close: it was either claimed when this session created it, or it belongs to
# someone else and an attempt on it is not authorship. A successful write to
# either still claims through the PostToolUse pass, unchanged.
#
# `tool_name` is a top-level key serialized ahead of `tool_input`, so the
# first-match extraction cannot be beaten by a file whose contents happen to
# contain the string `"tool_name"`. That is the same ordering argument the
# transcript scan below relies on, running in the opposite direction.
# `hook_event_name` is read here rather than at the exit below because the claim
# itself is conditioned on it. It is part of the payload prefix, ahead of
# `tool_input`, so first-match extraction of it cannot be beaten by file
# contents — the same ordering argument as `tool_name` and `agent_id`.
#
# ANCHORED, not merely argued. The ordering claim above is correct about where
# these keys sit, but first-match extraction over the WHOLE payload only wins
# the race when a genuine key exists to be found first. When one is ABSENT the
# argument collapses: nothing shadows a later occurrence, and the first match is
# then whatever the tool payload happens to contain. `tool_response` is
# serialized as a structured object whose nested JSON is not escaped, so a file
# whose contents include `"agent_id":"..."` is read as this firing's agent id on
# any CLI old enough not to send one — and since it will not equal the session
# id, the hook exits silently on every tool call for the rest of the session.
# Truncating at `"tool_input"` makes the prefix a fact rather than an
# expectation. If the key is absent from the prefix it is absent, full stop.
# PAYLOAD_PREFIX is computed once, just below the `cat`.
HOOK_EVENT=$(json_string_field "$PAYLOAD_PREFIX" hook_event_name)

# The payload path is canonicalized before anything looks at it. It arrives in
# the OS's own spelling — on Windows `C:\Users\...`, still JSON-escaped to
# `C:\\Users\\...` — and every use below is a forward-slash comparison: the
# `case` glob, the `-e` test, and the record line that pre-compact.sh will later
# match against `find` output. Left raw, none of them match on Windows and the
# whole ownership feature is inert without ever reporting a failure.
TOOL_NAME=$(json_string_field "$PAYLOAD_PREFIX" tool_name)
WRITTEN_PATH=""
case "$TOOL_NAME" in
    Write|Edit|MultiEdit|NotebookEdit)
        WRITTEN_PATH=$(canonicalize_payload_path "$(json_string_field "$INPUT" file_path)")
        ;;
esac

# -e rather than -f: a path occupied by a directory or a symlink is not one this
# session is about to bring into existence either, and the point of the test is
# "is there already something here that a claim would be a claim ON".
if [ "$HOOK_EVENT" = "PreToolUse" ] && [ -e "$WRITTEN_PATH" ]; then
    WRITTEN_PATH=""
fi

# Anchored to THIS project root, not to a trailing `*/.claude/sessions/` glob.
# The record is consumed by pre-compact.sh as a path to read, and the unanchored
# pattern accepted any path anywhere on the filesystem that happened to end that
# way — so a write to another checkout, or to a directory a tool was pointed at,
# entered this session's record as a claim. Containment belongs at the point the
# claim is MADE: downstream the record is just a list of paths, and one bad line
# in it is enough to steer forwarding away from a real handoff.
# "$PROJECT_ROOT" is quoted so its own contents cannot act as a pattern; the
# trailing `*` is not, and still globs.
case "$WRITTEN_PATH" in
    "$PROJECT_ROOT"/.claude/sessions/handoff-*.yaml)
        OWN_RECORD="$LOG_DIR/.compact-handoff-$SESSION_ID"
        LAST_CLAIM=$(tail -n 1 "$OWN_RECORD" 2>/dev/null || true)
        if [ "$LAST_CLAIM" != "$WRITTEN_PATH" ]; then
            printf '%s\n' "$WRITTEN_PATH" >> "$OWN_RECORD" 2>/dev/null || true
        fi
        ;;
esac

# Everything below measures context and may emit a nudge, and neither is
# meaningful before the tool has run: there is no result to account for, and a
# PreToolUse payload has no `hookEventName` this hook could answer with. This
# pass exists only to get the claim above on record ahead of the write.
#
# Exiting 0 and printing nothing is load-bearing on this path — PreToolUse is
# the one event where a hook can deny the tool call, and an advisory hook must
# never do that.
if [ "$HOOK_EVENT" = "PreToolUse" ]; then
    exit 0
fi

# ── Who is this firing for? ─────────────────────────────────────────────────
# `additionalContext` lands in the context of whichever agent made the tool
# call, so the nudge is only useful on a main-thread firing: a sub-agent can
# neither run /tools:handoff nor be compacted, and the marker it would spend is
# the main thread's one nudge for the cycle.
#
# The payload answers this directly. Every hook payload is built from a common
# prefix (`Kf` in the shipped CLI) which carries both `session_id` and
# `agent_id`; the main thread's tool-use context is `{agentType:"main",
# agentId:<session id>}`, while a sub-agent gets a distinct id. So
# `agent_id == session_id` IS the main-thread test, and both values arrive in
# the same payload, which makes the comparison self-contained.
#
# Compared against `agent_type == "main"`, which looks more direct: that
# default is `mainThreadAgentType`, a *configurable* value, so the literal
# string is not guaranteed. The id comparison does not depend on a name.
#
# Both keys sit in the prefix, ahead of `tool_input`, so first-match extraction
# cannot be beaten by file contents — the same ordering argument as `tool_name`
# above. Sanitized the same way `session_id` is, so the two sides are
# comparable rather than merely similar.
AGENT_ID=$(json_string_field "$PAYLOAD_PREFIX" agent_id | tr -cd '[:alnum:]_-')

# An empty `agent_id` means the payload predates the field, NOT that this is
# the main thread — reading absence as "main" would silently retire the guard
# on an older CLI. Absence falls through to the transcript-tail heuristic
# below; presence makes that heuristic unnecessary.
TAIL_HEURISTIC=1
if [ -n "$AGENT_ID" ]; then
    TAIL_HEURISTIC=0
    [ "$AGENT_ID" = "$SESSION_ID" ] || exit 0
fi

[ -n "$TRANSCRIPT" ] || exit 0
[ -f "$TRANSCRIPT" ] || exit 0

NUDGED_FILE="$LOG_DIR/.compact-nudged-$SESSION_ID"
# One nudge per compaction cycle. pre-compact.sh removes this marker, so the
# next cycle can nudge again.
[ -f "$NUDGED_FILE" ] && exit 0

# ── Current context size, in tokens ─────────────────────────────────────────
# Only the tail is read: this runs on every tool call, and `tail -n` seeks from
# the end rather than walking a multi-megabyte file. The window grows only when
# the cheap one comes up empty — see the escalation below the awk program.
#
# Three precautions in the awk below:
#   - Sub-agent turns write their own (much smaller) usage records into the
#     same transcript. `isSidechain` records never contribute a number, so a
#     subagent's context is not mistaken for the main thread's — but whether
#     the *newest* usage-bearing record is one is reported separately, because
#     that answers a different question (see the delivery gate below).
#   - The field names recur inside the `iterations` array, and could also
#     appear in assistant prose. Matching starts at a `"usage":` key and takes
#     the first occurrence of each field within it.
#   - Which `"usage":` key matters, and which record it belongs to. Both
#     questions are answered STRUCTURALLY, by nesting depth, because a textual
#     match cannot answer either one. `message.content` is serialized before
#     `message.usage`, so a leftmost search finds a tool_use input's own `usage`
#     object first and measures a tool payload instead of the context. Worse,
#     an earlier version tested `type:assistant` by searching the whole line —
#     but `toolUseResult` is written as a structured object (687 of 2958
#     records in the transcript this was measured against, plus 65 arrays), and
#     the JSON nested there is NOT escaped, so a tool result carrying
#     `"type":"assistant"` alongside a `usage` object satisfied the guard that
#     existed to exclude it. Anchoring the check to the record's own `type`
#     field is not possible positionally either: `message` is serialized ahead
#     of the top-level `type` in all 1185 assistant records measured, putting it
#     at a mean offset of 2194 bytes and a maximum of 33108, so there is no
#     prefix worth trusting.
#
#     So the record is reduced to its brace/bracket skeleton and the depth of
#     each interesting key is read off directly: `type:"assistant"` counts only
#     at depth 1, and only a `usage` key at depth 2 is measured. All 1185
#     usage keys observed sit at depth 2 and none of the guards fires on real
#     data — as with the two guards before them, these are structural hardening
#     against a failure that is silent when it happens, suppressing the one
#     nudge that had to fire.
USAGE_AWK='
    function firstnum(s, key,   m) {
        if (match(s, "\"" key "\":[ ]*[0-9]+")) {
            m = substr(s, RSTART, RLENGTH)
            sub(/^[^0-9]*/, "", m)
            return m + 0
        }
        return 0
    }
    # Reduce a record to structure alone. The three keys this program reasons
    # about are replaced by sentinels FIRST, while their quotes are still
    # intact; each replaced pattern spans whole quoted tokens (an even number
    # of quote characters), so collapsing the remaining strings afterwards
    # still pairs quotes correctly. Escape sequences go before strings do, so
    # that a \" inside a value cannot be mistaken for a string terminator —
    # which is also why an escaped occurrence of any of these keys is invisible
    # here, exactly as it is to the index() walk below.
    function skeleton(line,   t) {
        t = line
        gsub(/"type"[ ]*:[ ]*"assistant"/, "\001", t)
        gsub(/"isSidechain"[ ]*:[ ]*true/, "\002", t)
        gsub(/"usage":/, "\003", t)
        gsub(/\\./, "", t)
        gsub(/"[^"]*"/, "", t)
        return t
    }
    # Records with no usage key at all are most of the file. Skipping them on a
    # single index() keeps the skeleton work off the common path.
    index($0, "\"usage\":") == 0 { next }
    {
        sk = skeleton($0)
        depth = 0; nusage = 0; want = 0; is_asst = 0; is_side = 0
        n = length(sk)
        for (i = 1; i <= n; i++) {
            c = substr(sk, i, 1)
            if (c == "{" || c == "[") { depth++ }
            else if (c == "}" || c == "]") { depth-- }
            else if (c == "\001") { if (depth == 1) is_asst = 1 }
            else if (c == "\002") { if (depth == 1) is_side = 1 }
            # FIRST depth-2 usage key, not the last. An assistant record can
            # carry more than one — `toolUseResult` is serialized as a
            # structured object whose own JSON is not escaped, so a tool result
            # that itself contains a `usage` object contributes a second depth-2
            # key later in the same line. Unconditional assignment kept whichever
            # came last, which is the tool payload rather than message.usage, and
            # the hook then measured the wrong number with no way to tell.
            # message.usage belongs to the record itself and is the earlier one.
            # (No apostrophes in this program — it is a single-quoted bash
            # string, and one would terminate it mid-awk.)
            else if (c == "\003") { nusage++; if (depth == 2 && want == 0) want = nusage }
        }
        # Not this record type, or every usage key in it is nested deeper than
        # message.usage. Either way there is nothing here worth measuring.
        if (!is_asst || want == 0) next
        # Walk the ORIGINAL to the want-th "usage": key. gsub replaced them
        # left to right, so the want-th sentinel and the want-th index() hit
        # are the same key — which is why the sentinel pattern is the exact
        # string index() searches for, with no whitespace tolerance to let the
        # two counts drift apart. base counts characters already consumed, so
        # p ends up as the keys absolute offset in the original line.
        s = $0
        base = 0
        p = 0
        k = 0
        while ((i = index(s, "\"usage\":")) > 0) {
            k++
            p = base + i
            base = base + i + 7
            s = substr(s, i + 8)
            if (k == want) break
        }
        if (p == 0) next
        u = substr($0, p)
        tot = firstnum(u, "input_tokens") \
            + firstnum(u, "cache_read_input_tokens") \
            + firstnum(u, "cache_creation_input_tokens")
        if (tot <= 0) next
        # `side` tracks only the newest usage-bearing record, so it is set on
        # every sidechain turn and cleared by the next main-thread one.
        if (is_side) { side = 1; next }
        side = 0
        last = tot
    }
    END { printf "%d %d\n", last + 0, side + 0 }
'

# A fixed 60-line tail assumed a usage-bearing assistant record was always near
# the end. It usually is, but a long run of tool-result records can push it out
# of reach, and the byte proxy the hook then fell through to is wrong in both
# directions — silent below 1.2 MB when context is critical, firing above it
# when context is fine. The window therefore escalates, and only when the cheap
# read comes up empty: a session with a record in the last 60 lines — the
# normal case, on every tool call — pays exactly what it paid before.
#
# Two numbers come back. The second is the delivery gate.
CONTEXT_TOKENS=""
SIDECHAIN_NEWEST=0
for SCAN_LINES in 60 600 4000; do
    SCAN=$(tail -n "$SCAN_LINES" "$TRANSCRIPT" 2>/dev/null | awk "$USAGE_AWK" 2>/dev/null || true)
    # Split the two fields BEFORE stripping non-digits. Running `tr -cd '0-9'`
    # over the whole line would fuse "98800 0" into "988000" and report a
    # tenfold context reading.
    CONTEXT_TOKENS=$(printf '%s' "${SCAN%% *}" | tr -cd '0-9')
    SIDECHAIN_NEWEST=$(printf '%s' "${SCAN##* }" | tr -cd '0-9')
    SIDECHAIN_NEWEST="${SIDECHAIN_NEWEST:-0}"
    # Stopping early on a sidechain tail is only right when that tail is what
    # decides delivery. With `agent_id` in hand this firing is already known to
    # be the main thread's, and a sidechain tail is exactly the case that needs
    # the WIDER window — the Task-completion firing sits behind a whole
    # sub-agent run's worth of records.
    if [ "$TAIL_HEURISTIC" = "1" ] && [ "$SIDECHAIN_NEWEST" = "1" ]; then break; fi
    if [ -n "$CONTEXT_TOKENS" ] && [ "$CONTEXT_TOKENS" != "0" ]; then break; fi
done

# ── Fallback delivery gate, for payloads with no `agent_id` ─────────────────
# The identity check above already exited on a sub-agent firing. This remains
# only for a payload that carried no `agent_id` at all, where "who is speaking"
# has to be inferred: sidechain turns are appended to the same transcript, so a
# sidechain record newest means a sub-agent is mid-run and this firing is
# probably its own. Defer — the marker stays unspent.
#
# Inference is strictly worse than the payload, and this is where it shows: it
# cannot tell a sub-agent's own tool call apart from the main thread's
# PostToolUse for the completed `Task`, because at that moment the sub-agent's
# last record is still the newest one in the file. So this branch discards a
# genuine main-thread firing. An earlier version treated that as a one-turn
# delay and accepted it, which was wrong — if the resumed turn ends without
# another tool call, or auto-compaction fires first, no later PostToolUse
# delivers the nudge and the cycle is simply lost. Nothing recovers it, because
# the marker logic has no notion of a nudge that was owed and never sent.
#
# It is kept regardless: on a CLI old enough to omit `agent_id`, an
# over-eager defer loses some nudges, while no gate at all mis-delivers them
# into sub-agent contexts and spends the marker doing it. The failure that
# stays is the quieter one.
if [ "$TAIL_HEURISTIC" = "1" ] && [ "$SIDECHAIN_NEWEST" = "1" ]; then
    exit 0
fi

# ── The result that just landed is not in that number yet ───────────────────
# PostToolUse fires after the tool produced its result but before the model's
# next request, so the newest assistant `usage` record describes the request
# that ASKED for this tool — the result itself has not been sent to the model
# and is not counted anywhere in the transcript yet.
#
# Normally that lag costs nothing: the next tool call measures a count that
# includes it. It matters when one result is large enough to cross the whole
# gap between the nudge line and the compaction line in a single step — 15
# points, ~30k tokens at a 200k window. Below the nudge line the hook stays
# silent, the model's next request tips the session past the compaction
# threshold, and auto-compaction runs before any further PostToolUse can fire.
# The cycle is lost outright, which is the same failure mode as a mis-delivered
# nudge and just as unrecoverable.
#
# The payload is the only place that result can be measured from, and only as
# bytes, so this is a proxy — the honest kind, in a known direction. Four bytes
# per token is the conventional figure for prose and an UNDER-estimate for the
# JSON and source code tool results usually carry, so the correction runs short
# rather than long: it narrows the gap, it does not close it. The whole payload
# is measured rather than just `tool_response` because the remaining fields are
# a few hundred bytes against a result large enough to matter, and extracting
# one JSON field in bash would cost more than that error.
#
# `${#INPUT}` is bytes here only because LC_ALL is pinned to C at the top of the
# file; under an inherited UTF-8 locale bash would count characters and the
# divisor — calibrated in bytes — would be applied to the wrong unit. See the
# pin for why that is not left to the environment.
PENDING_TOKENS=$(( ${#INPUT} / 4 ))

if [ -n "$CONTEXT_TOKENS" ] && [ "$CONTEXT_TOKENS" -gt 0 ]; then
    PCT=$(( (CONTEXT_TOKENS + PENDING_TOKENS) * 100 / WINDOW ))
    [ "$PCT" -ge "$NUDGE_PCT" ] || exit 0
    # Digits only — safe to interpolate into the JSON string literal below.
    SIGNAL="Context is at ${PCT}% of the ${WINDOW}-token window and auto-compaction fires at ${COMPACT_PCT}%."
else
    # No usage record parsed. Fall back to byte growth since the last
    # compaction, which pre-compact.sh records.
    SIZE=$(wc -c < "$TRANSCRIPT" 2>/dev/null || echo 0)
    SIZE=$(printf '%s' "$SIZE" | tr -cd '0-9')
    SIZE="${SIZE:-0}"

    BASE_FILE="$LOG_DIR/.compact-base-$SESSION_ID"
    BASE=$(cat "$BASE_FILE" 2>/dev/null || echo 0)
    BASE=$(printf '%s' "$BASE" | tr -cd '0-9')
    BASE="${BASE:-0}"

    # A transcript smaller than the recorded baseline means a new transcript
    # file; treat the baseline as stale rather than reporting negative growth.
    if [ "$SIZE" -lt "$BASE" ]; then
        echo "$SIZE" > "$BASE_FILE"
        exit 0
    fi

    DELTA=$((SIZE - BASE))
    [ "$DELTA" -ge "$NUDGE_BYTES" ] || exit 0
    SIGNAL="This session is approaching its auto-compaction threshold."
fi

# EMIT FIRST, SPEND THE MARKER AFTER. The marker is this session's single nudge
# for the compaction cycle, and nothing re-issues one that was owed and never
# sent — the logic has no notion of a debt. Touched first, any failure between
# the two lines (a closed stdout, a full disk, the ERR trap firing on something
# unrelated) consumes the nudge without delivering it, and the cycle is lost
# exactly as if the hook had never run. Ordered this way the worst case is a
# nudge delivered twice, which costs a few hundred tokens and nothing else.
#
# $SIGNAL is emitted inside a JSON string literal with no escaping step, so
# every branch above must build it from digits and plain words only — no double
# quotes, backslashes or newlines.
# …but "spend after" alone is not mutual exclusion. `[ -f "$NUDGED_FILE" ]` above
# is a read, `touch` below is the act, and the whole measurement path sits
# between them: parallel tool calls all fire this hook, all find no marker, and
# all emit. Three concurrent firings produced three nudges on every trial.
#
# `mkdir` is the arbitration — it is atomic and it FAILS for the loser, which
# `touch`, `>`, and `[ -f ]` do not. Taken here rather than at the check above
# so that everything B4 established still holds: no marker is spent by a firing
# that measured its way to an early `exit 0`, and the claim is one statement
# away from delivery instead of a whole measurement path away.
#
# The remaining sliver — a claim taken and the emit then failing (closed stdout,
# full disk) — is what B4 refused to accept, so it is released rather than left
# holding: `rmdir` puts the cycle's nudge back on offer for a later tool call.
# A firing killed outright between the two leaves the directory behind; that is
# the one unrecoverable case, and pre-compact.sh clears it with the marker at
# the end of the cycle.
NUDGE_CLAIM="$LOG_DIR/.compact-nudging-$SESSION_ID"
mkdir "$NUDGE_CLAIM" 2>/dev/null || exit 0

if printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Context pressure: %s Run /tools:handoff now, while the full context is still available, and give it a compact_instruction tuned to the current task — the PreCompact hook forwards that instruction to the compaction summarizer. A handoff written after compaction cannot recover what compaction discarded."}}\n' "$SIGNAL"; then
    touch "$NUDGED_FILE"
else
    rmdir "$NUDGE_CLAIM" 2>/dev/null || true
fi

exit 0
