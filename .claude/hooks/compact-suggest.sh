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
# THE SIGNAL IS A PROXY. Hooks receive no token count. Transcript bytes since
# the last compaction are the closest available stand-in: monotonic within a
# cycle, reset by pre-compact.sh, and roughly proportional to context growth.
# It is not a context percentage, and the threshold below needs calibrating
# against real sessions — see docs/specs/compaction-gate/design.md.
#
# Per-session marker files are cleaned up by session-end-cleanup.sh.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

LOG_DIR="$(get_project_root)/.claude/logs"
mkdir -p "$LOG_DIR"

# Transcript growth (bytes) since the last compaction that triggers the nudge.
# Deliberately conservative: firing early costs one handoff, firing late costs
# the session's context.
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

SIZE=$(wc -c < "$TRANSCRIPT" 2>/dev/null || echo 0)
SIZE=$(echo "$SIZE" | tr -cd '0-9')
SIZE="${SIZE:-0}"

BASE_FILE="$LOG_DIR/.compact-base-$SESSION_ID"
BASE=$(cat "$BASE_FILE" 2>/dev/null || echo 0)
BASE=$(echo "$BASE" | tr -cd '0-9')
BASE="${BASE:-0}"

# A transcript smaller than the recorded baseline means a new transcript file;
# treat the baseline as stale rather than reporting negative growth.
if [ "$SIZE" -lt "$BASE" ]; then
    echo "$SIZE" > "$BASE_FILE"
    exit 0
fi

DELTA=$((SIZE - BASE))
[ "$DELTA" -ge "$NUDGE_BYTES" ] || exit 0

touch "$NUDGED_FILE"

# Single-line, quote-free message: emitted inside a JSON string literal with no
# escaping step, so it must contain no double quotes, backslashes or newlines.
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Context pressure: this session is approaching its auto-compaction threshold. Run /tools:handoff now, while the full context is still available, and give it a compact_instruction tuned to the current task — the PreCompact hook forwards that instruction to the compaction summarizer. A handoff written after compaction cannot recover what compaction discarded."}}\n'

exit 0
