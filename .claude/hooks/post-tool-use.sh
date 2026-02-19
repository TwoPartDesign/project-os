#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter

FILE="$1"

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
