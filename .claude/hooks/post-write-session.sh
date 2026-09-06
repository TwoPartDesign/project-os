#!/bin/bash
# PostToolUse hook: scrub secrets from session files after they are written.
# Receives JSON payload via stdin. Only acts on writes to .claude/sessions/.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

INPUT=$(cat)
# canonicalize_payload_path, not the raw value. The runtime delivers file_path
# as a native OS path, so on Windows it arrives as `C:\\Users\\…` (separators
# still JSON-escaped) or as a `./`-relative path, and resolve_project_path's
# `[ -f "$file" ]` / containment check can miss it unconverted. Unconverted,
# this hook silently skips scrubbing a session file that IS under
# .claude/sessions/ — the same silent no-op post-tool-use.sh was fixed for.
FILE_PATH=$(canonicalize_payload_path "$(extract_file_path "$INPUT")")

# Validate file is under the project root and resolve symlinks
# resolve_project_path handles: symlink escape, path traversal, and boundary checks
RESOLVED=$(resolve_project_path "$FILE_PATH") || exit 0

PROJECT_ROOT=$(get_project_root)
SESSION_DIR="${PROJECT_ROOT}/.claude/sessions"

# Only act on session files
if [[ "$RESOLVED" == "$SESSION_DIR"/* ]]; then
    if ! bash "$PROJECT_ROOT/scripts/scrub-secrets.sh" "$RESOLVED"; then
        echo "WARNING: scrub-secrets failed for $RESOLVED" >&2
    fi
fi

exit 0
