#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter
# Receives JSON payload via stdin from Claude Code PostToolUse hook

INPUT=$(cat)
FILE=$(echo "$INPUT" | grep -oE '"file_path"\s*:\s*"[^"]*"' | sed 's/.*"file_path"[^"]*"//;s/".*//')

# Validate file is under the project root to prevent formatting arbitrary files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -n "$FILE" ] && [ -f "$FILE" ]; then
    RESOLVED="$(cd "$(dirname "$FILE")" 2>/dev/null && pwd)/$(basename "$FILE")" || exit 0
    if [[ "$RESOLVED" != "$PROJECT_ROOT"/* ]]; then
        exit 0
    fi
else
    exit 0
fi

case "$RESOLVED" in
  *.ts|*.tsx|*.js|*.jsx)
    npx prettier --write "$RESOLVED" 2>/dev/null
    ;;
  *.py)
    python -m black "$RESOLVED" 2>/dev/null
    ;;
  *.json)
    npx prettier --write "$RESOLVED" 2>/dev/null
    ;;
esac
