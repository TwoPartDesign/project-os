#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter
# Receives JSON payload via stdin from Claude Code PostToolUse hook

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

INPUT=$(cat)
FILE=$(extract_file_path "$INPUT")

# Validate file is under the project root to prevent formatting arbitrary files
# resolve_project_path handles: symlink escape, path traversal, and boundary checks
RESOLVED=$(resolve_project_path "$FILE") || exit 0

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
