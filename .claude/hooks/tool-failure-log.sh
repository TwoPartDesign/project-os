#!/bin/bash
# PostToolUse hook: log tool failures to .claude/logs/tool-failures.log
# Logs ONLY: timestamp, tool name. Never logs tool output or content.
# This log enables post-session failure analysis.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

# This hook cannot bound its read the way the others do. `is_error` lives in
# tool_response, which is serialized LAST, so a prefix window is exactly the
# wrong end of the payload — bounding it would stop logging failures in
# proportion to how much output the failing tool produced.
#
# So it never slurps. One grep streams stdin and keeps only the two facts this
# hook is allowed to know, which reduces a 20 MB payload from a 2.8s bash
# command substitution to a single linear scan whose result is a few dozen
# bytes. The extractions below then run over that, not over the payload.
#
# Semantics are unchanged on purpose: `is_error` still matches anywhere in the
# payload (it has always been able to match a tool's own output text — that is
# pre-existing and out of scope here), and tool_name still takes the first
# match, which is sound because it is a top-level key ahead of tool_input.
FACTS=$(grep -aoE '"(tool_name|is_error)"[[:space:]]*:[[:space:]]*("[^"]*"|true|false)' 2>/dev/null || true)

# Check for error indicators in the response (minimal string matching)
IS_ERROR=false
if printf '%s\n' "$FACTS" | grep -qE '"is_error"[[:space:]]*:[[:space:]]*true'; then
    IS_ERROR=true
fi

if [ "$IS_ERROR" = "true" ]; then
    # Extract tool name only — never log content/output
    TOOL_NAME=$(printf '%s\n' "$FACTS" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"tool_name"[^"]*"//;s/".*//' || true)
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
