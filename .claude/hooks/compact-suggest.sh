#!/bin/bash
# PostToolUse hook: warn when tool invocation count suggests context is filling.
# Auto-compact fires at 50% context (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50).
# Tool count is an imperfect proxy — warn early so user can /tools:handoff first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.claude/logs"

mkdir -p "$LOG_DIR"

# Extract session_id for per-session counting
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -oE '"session_id"\s*:\s*"[^"]*"' | sed 's/.*"session_id"[^"]*"//;s/".*//' | head -1)
# Sanitize: strip path traversal chars, allow only alphanumeric/hyphen/underscore
SESSION_ID=$(echo "$SESSION_ID" | tr -cd '[:alnum:]_-')
SESSION_ID="${SESSION_ID:-default}"

COUNTER_FILE="$LOG_DIR/.tool-count-$SESSION_ID"
LOCK_FILE="${COUNTER_FILE}.lock"
# Atomic read-modify-write with flock to prevent race conditions
exec 200>"$LOCK_FILE"
flock -w 2 200 || true
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
exec 200>&-

# Warn at thresholds — before the 50% auto-compact fires
if [ "$COUNT" -eq 20 ]; then
    echo "Context advisory: 20 tool calls in this session. Consider /tools:handoff to save state before auto-compact." >&2
elif [ "$COUNT" -eq 35 ]; then
    echo "Context advisory: 35 tool calls. Auto-compact may fire soon — run /tools:handoff now if you want to preserve full context." >&2
fi

exit 0
