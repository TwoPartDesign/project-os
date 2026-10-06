#!/bin/bash
# PostToolUseFailure hook: log tool failures to .claude/logs/tool-failures.log
# Logs ONLY: timestamp, tool name. Never logs tool output or content.
# This log enables post-session failure analysis.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

# Registered on the native PostToolUseFailure event (#T213), so being invoked IS
# the failure signal. This hook used to ride PostToolUse and grep the payload for
# `is_error`, which matched a tool's own output text as readily as the real flag
# and logged false positives. The failure payload carries tool_name, tool_input,
# `error` (the message — never read here) and is_interrupt; it has no
# tool_response, so there is nothing to scan beyond the one name.
#
# tool_name is a top-level key serialized ahead of tool_input, so the first match
# is the right one, and the grep still streams stdin to the end rather than
# stopping early: tool_input can carry a written file's whole contents, and a
# hook that exited without draining it would hand the writer an EPIPE.
TOOL_NAME_RAW=$(grep -aoE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null | sed -n '1p' || true)

if [ -n "$TOOL_NAME_RAW" ]; then
    # Extract tool name only — never log content/output
    TOOL_NAME=$(printf '%s\n' "$TOOL_NAME_RAW" | sed 's/.*"tool_name"[^"]*"//;s/".*//' || true)
    # Sanitize: allow only alphanumeric, underscore, hyphen to prevent log injection
    TOOL_NAME=$(echo "${TOOL_NAME:-unknown}" | tr -cd '[:alnum:]_-')

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    LOG_DIR="$PROJECT_ROOT/.claude/logs"

    source "$SCRIPT_DIR/_common.sh"
    mkdir -p "$LOG_DIR"
    LOG_FILE="$LOG_DIR/tool-failures.log"
    rotate_log "$LOG_FILE"
    ENTRY="$(date -u +%Y-%m-%dT%H:%M:%SZ) FAIL tool=${TOOL_NAME:-unknown}"
    # Atomic append with flock to prevent interleaved writes (drop event on lock failure)
    if command -v flock >/dev/null 2>&1; then
        (
            flock -w 2 200 || { echo "tool-failure-log: flock timeout, dropping event" >&2; exit 0; }
            echo "$ENTRY" >> "$LOG_FILE"
        ) 200>"${LOG_FILE}.lock"
    else
        echo "$ENTRY" >> "$LOG_FILE"
    fi
fi

exit 0
