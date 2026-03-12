#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter
# Receives JSON payload via stdin from Claude Code PostToolUse hook

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

INPUT=$(cat)
FILE=$(extract_file_path "$INPUT")

# Validate file is under the project root to prevent formatting arbitrary files
# resolve_project_path handles: symlink escape, path traversal, and boundary checks
RESOLVED=$(resolve_project_path "$FILE") || exit 0

LOG_DIR="$(get_project_root)/.claude/logs"
mkdir -p "$LOG_DIR"

case "$RESOLVED" in
  *.ts|*.tsx|*.js|*.jsx)
    npx prettier --write "$RESOLVED" 2>>"$LOG_DIR/format-errors.log" || \
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) prettier failed: $RESOLVED" >>"$LOG_DIR/format-errors.log"
    ;;
  *.py)
    python -m black "$RESOLVED" 2>>"$LOG_DIR/format-errors.log" || \
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) black failed: $RESOLVED" >>"$LOG_DIR/format-errors.log"
    ;;
  *.json)
    npx prettier --write "$RESOLVED" 2>>"$LOG_DIR/format-errors.log" || \
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) prettier failed: $RESOLVED" >>"$LOG_DIR/format-errors.log"
    ;;
esac
