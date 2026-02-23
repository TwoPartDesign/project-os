#!/bin/bash
# PostToolUse hook: log tool failures to .claude/logs/tool-failures.log
# Logs ONLY: timestamp, tool name. Never logs tool output or content.
# This log enables post-session failure analysis.

INPUT=$(cat)

# Check for error indicators in the response (minimal string matching)
IS_ERROR=false
if echo "$INPUT" | grep -qE '"is_error"\s*:\s*true'; then
    IS_ERROR=true
fi

if [ "$IS_ERROR" = "true" ]; then
    # Extract tool name only — never log content/output
    TOOL_NAME=$(echo "$INPUT" | grep -oE '"tool_name"\s*:\s*"[^"]*"' | sed 's/.*"tool_name"[^"]*"//;s/".*//')
    # Sanitize: allow only alphanumeric, underscore, hyphen to prevent log injection
    TOOL_NAME=$(echo "${TOOL_NAME:-unknown}" | tr -cd '[:alnum:]_-')

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    LOG_DIR="$PROJECT_ROOT/.claude/logs"

    mkdir -p "$LOG_DIR"
    LOG_FILE="$LOG_DIR/tool-failures.log"
    ENTRY="$(date -u +%Y-%m-%dT%H:%M:%SZ) FAIL tool=${TOOL_NAME:-unknown}"
    # Atomic append with flock to prevent interleaved writes
    (
        flock -w 2 200 || { echo "$ENTRY" >> "$LOG_FILE"; exit 0; }
        echo "$ENTRY" >> "$LOG_FILE"
    ) 200>"${LOG_FILE}.lock"
fi

exit 0
