#!/bin/bash
# PostToolUse hook: when context pressure builds, tell Claude to write a
# handoff while it still has the context to write one.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

LOG_DIR="$(get_project_root)/.claude/logs"
mkdir -p "$LOG_DIR"

# The window auto-compaction measures against, and the percentage of it at
# which compaction fires. Both are read from the same env vars the runtime
# uses, so the nudge tracks the trigger instead of guessing at it.
WINDOW=$(printf '%s' "${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-200000}" | tr -cd '0-9')
[ -n "$WINDOW" ] && [ "$WINDOW" -gt 0 ] 2>/dev/null || WINDOW=200000

COMPACT_PCT=$(printf '%s' "${CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:-75}" | tr -cd '0-9')
[ -n "$COMPACT_PCT" ] && [ "$COMPACT_PCT" -gt 0 ] 2>/dev/null || COMPACT_PCT=75

# Nudge with 15 points of headroom below the compaction threshold — at a 200k
# window that is ~30k tokens, ample for a handoff turn. Derived from the
# trigger rather than asserted, so raising the threshold moves the nudge with
# it. Overridable for sessions that want more or less runway.
NUDGE_PCT="${PROJECT_OS_COMPACT_NUDGE_PCT:-}"
if [ -z "$NUDGE_PCT" ]; then
    NUDGE_PCT=$((COMPACT_PCT - 15))
    [ "$NUDGE_PCT" -ge 20 ] || NUDGE_PCT=20
fi

# Fallback only: transcript-byte growth since the last compaction, used when
# no usage record can be read (e.g. a transcript format change).
NUDGE_BYTES="${PROJECT_OS_COMPACT_NUDGE_BYTES:-1200000}"

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(session_id_from_json "$INPUT")
TRANSCRIPT=$(json_string_field "$INPUT" transcript_path)

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
# than not tracking ownership at all: the ownership branch in pre-compact.sh
# bypasses the age window entirely (it compares against the cycle marker, and
# on a session's first compaction there is no cycle marker), so the reader
# would forward a stale instruction written for someone else's task, and the
# claim would simultaneously hide that handoff from every other session's
# fallback glob. A write that failed still claims nothing that matters —
# pre-compact.sh skips claimed paths that do not exist.
#
# `tool_name` is a top-level key serialized ahead of `tool_input`, so the
# first-match extraction cannot be beaten by a file whose contents happen to
# contain the string `"tool_name"`. That is the same ordering argument the
# transcript scan below relies on, running in the opposite direction.
TOOL_NAME=$(json_string_field "$INPUT" tool_name)
WRITTEN_PATH=""
case "$TOOL_NAME" in
    Write|Edit|MultiEdit|NotebookEdit)
        WRITTEN_PATH=$(json_string_field "$INPUT" file_path)
        ;;
esac
case "$WRITTEN_PATH" in
    */.claude/sessions/handoff-*.yaml)
        OWN_RECORD="$LOG_DIR/.compact-handoff-$SESSION_ID"
        LAST_CLAIM=$(tail -n 1 "$OWN_RECORD" 2>/dev/null || true)
        if [ "$LAST_CLAIM" != "$WRITTEN_PATH" ]; then
            printf '%s\n' "$WRITTEN_PATH" >> "$OWN_RECORD" 2>/dev/null || true
        fi
        ;;
esac

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
AGENT_ID=$(json_string_field "$INPUT" agent_id | tr -cd '[:alnum:]_-')

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
#   - Which `"usage":` key matters. `message.content` is serialized before
#     `message.usage`, so a tool_use input carrying its own `usage` object would
#     be found first by a leftmost search, and the hook would measure a tool
#     payload instead of the context. The scan therefore walks to the LAST
#     `"usage":` in the record. Records are also required to be `type:assistant`,
#     which keeps a `toolUseResult` body on a user record — arbitrary JSON from
#     an MCP server or a file read — from supplying a number at all. Both are
#     structural guards: no record in the transcript that motivated them
#     actually carried two `usage` keys, but the failure is silent when it does
#     happen, suppressing the one nudge that had to fire.
USAGE_AWK='
    function firstnum(s, key,   m) {
        if (match(s, "\"" key "\":[ ]*[0-9]+")) {
            m = substr(s, RSTART, RLENGTH)
            sub(/^[^0-9]*/, "", m)
            return m + 0
        }
        return 0
    }
    !/"type"[ ]*:[ ]*"assistant"/ { next }
    {
        # Walk to the last "usage": key. base counts characters already
        # consumed, so p ends up as its absolute offset in the original line.
        s = $0
        base = 0
        p = 0
        while ((i = index(s, "\"usage\":")) > 0) {
            p = base + i
            base = base + i + 7
            s = substr(s, i + 8)
        }
        if (p == 0) next
        u = substr($0, p)
        t = firstnum(u, "input_tokens") \
          + firstnum(u, "cache_read_input_tokens") \
          + firstnum(u, "cache_creation_input_tokens")
        if (t <= 0) next
        # `side` tracks only the newest usage-bearing record, so it is set on
        # every sidechain turn and cleared by the next main-thread one.
        if ($0 ~ /"isSidechain"[ ]*:[ ]*true/) { side = 1; next }
        side = 0
        last = t
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

if [ -n "$CONTEXT_TOKENS" ] && [ "$CONTEXT_TOKENS" -gt 0 ]; then
    PCT=$((CONTEXT_TOKENS * 100 / WINDOW))
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

touch "$NUDGED_FILE"

# $SIGNAL is emitted inside a JSON string literal with no escaping step, so
# every branch above must build it from digits and plain words only — no double
# quotes, backslashes or newlines.
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Context pressure: %s Run /tools:handoff now, while the full context is still available, and give it a compact_instruction tuned to the current task — the PreCompact hook forwards that instruction to the compaction summarizer. A handoff written after compaction cannot recover what compaction discarded."}}\n' "$SIGNAL"

exit 0
