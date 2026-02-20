#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter
# Receives JSON payload via stdin from Claude Code PostToolUse hook

INPUT=$(cat)
FILE=$(echo "$INPUT" | grep -oE '"file_path"\s*:\s*"[^"]*"' | sed 's/.*"file_path"[^"]*"//;s/".*//')

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx)
    npx prettier --write "$FILE" 2>/dev/null
    ;;
  *.py)
    python -m black "$FILE" 2>/dev/null
    ;;
  *.json)
    npx prettier --write "$FILE" 2>/dev/null
    ;;
esac
