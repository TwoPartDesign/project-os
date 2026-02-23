#!/bin/bash
# PostToolUse hook: scrub secrets from session files after they are written.
# Receives JSON payload via stdin. Only acts on writes to .claude/sessions/.

INPUT=$(cat)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Extract file_path from tool_input — handle optional whitespace around colon
FILE_PATH=$(echo "$INPUT" | grep -oE '"file_path"\s*:\s*"[^"]*"' | sed 's/.*"file_path"[^"]*"//;s/".*//')

# Only act on session files — resolve to absolute path and verify it's under PROJECT_ROOT
if [ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ]; then
    # Use realpath/readlink -f to canonicalize symlinks and prevent symlink escape
    RESOLVED="$(realpath "$FILE_PATH" 2>/dev/null || readlink -f "$FILE_PATH" 2>/dev/null)" || exit 0
    [ -z "$RESOLVED" ] && exit 0
    SESSION_DIR="${PROJECT_ROOT}/.claude/sessions"
    if [[ "$RESOLVED" == "$SESSION_DIR"/* ]]; then
        bash "$PROJECT_ROOT/scripts/scrub-secrets.sh" "$RESOLVED"
    fi
fi

exit 0
