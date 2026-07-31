#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter
# Receives JSON payload via stdin from Claude Code PostToolUse hook

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

read_hook_payload
# canonicalize_payload_path, not the raw value. The runtime delivers file_path
# as a native OS path, so on Windows it arrives as `C:\\Users\\…` — separators
# still JSON-escaped — and resolve_project_path's `[ -f "$file" ]` fails on it.
# The hook then exits 0 having formatted nothing, on every edit, with no error
# anywhere: the feature looks installed and does nothing. Same silent no-op the
# compaction hooks were fixed for, one layer down.
FILE=$(canonicalize_payload_path "$(extract_file_path "$INPUT")")

# A write big enough to push file_path past the payload bound is the one case
# where this hook can do nothing for a reason that is not visible in the file it
# was asked to format. Say so instead of exiting quietly — a formatter that
# skips exactly the largest files, silently, is the failure this file already
# carries one fix for.
if [ -z "$FILE" ] && [ "${HOOK_PAYLOAD_TRUNCATED:-0}" = "1" ]; then
    echo "post-tool-use: payload exceeded ${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144} bytes and carried no file_path in that window — not formatting" >&2
    exit 0
fi

# Validate file is under the project root to prevent formatting arbitrary files
# resolve_project_path handles: symlink escape, path traversal, and boundary checks
RESOLVED=$(resolve_project_path "$FILE") || exit 0

LOG_DIR="$(get_project_root)/.claude/logs"
mkdir -p "$LOG_DIR"
rotate_log "$LOG_DIR/format-errors.log"

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
