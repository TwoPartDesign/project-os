#!/bin/bash
# PostToolUse hook: scrub secrets from session files after they are written.
# Receives JSON payload via stdin. Only acts on writes to .claude/sessions/.

INPUT=$(cat)

# Extract file_path from tool_input — handle optional whitespace around colon
FILE_PATH=$(echo "$INPUT" | grep -oE '"file_path"\s*:\s*"[^"]*"' | sed 's/.*"file_path"[^"]*"//;s/".*//')

# Only act on session files
if echo "$FILE_PATH" | grep -q '\.claude/sessions/'; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

    if [ -f "$FILE_PATH" ]; then
        bash "$PROJECT_ROOT/scripts/scrub-secrets.sh" "$FILE_PATH"
    fi
fi

exit 0
