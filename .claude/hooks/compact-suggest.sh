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

[ -n "$TRANSCRIPT" ] || exit 0
[ -f "$TRANSCRIPT" ] || exit 0

NUDGED_FILE="$LOG_DIR/.compact-nudged-$SESSION_ID"
# One nudge per compaction cycle. pre-compact.sh removes this marker, so the
# next cycle can nudge again.
[ -f "$NUDGED_FILE" ] && exit 0

# ── Current context size, in tokens ─────────────────────────────────────────
# Only the tail is read: this runs on every tool call, and `tail -n` seeks from
# the end rather than walking a multi-megabyte file.
#
# Two precautions in the awk below:
#   - Sub-agent turns write their own (much smaller) usage records into the
#     same transcript. `isSidechain` records are skipped so a subagent's
#     context is never mistaken for the main thread's.
#   - The field names recur inside the `iterations` array, and could also
#     appear in assistant prose. Matching starts at the `"usage"` key and takes
#     the first occurrence of each field, which is the top-level one.
CONTEXT_TOKENS=$(tail -n 60 "$TRANSCRIPT" 2>/dev/null | awk '
    function firstnum(s, key,   m) {
        if (match(s, "\"" key "\":[ ]*[0-9]+")) {
            m = substr(s, RSTART, RLENGTH)
            sub(/^[^0-9]*/, "", m)
            return m + 0
        }
        return 0
    }
    /"isSidechain"[ ]*:[ ]*true/ { next }
    {
        p = index($0, "\"usage\"")
        if (p == 0) next
        u = substr($0, p)
        t = firstnum(u, "input_tokens") \
          + firstnum(u, "cache_read_input_tokens") \
          + firstnum(u, "cache_creation_input_tokens")
        if (t > 0) last = t
    }
    END { if (last > 0) printf "%d\n", last }
' 2>/dev/null || true)
CONTEXT_TOKENS=$(printf '%s' "$CONTEXT_TOKENS" | tr -cd '0-9')

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
