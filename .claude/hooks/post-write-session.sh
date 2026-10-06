#!/bin/bash
# PostToolUse hook: scrub secrets from session files after they are written.
# Receives JSON payload via stdin. Only acts on writes to .claude/sessions/.
#
# Bash edits (#T202): also registered on the `Bash` matcher. When tool_name is
# Bash, the files come from tool_response.bashEditDiff.changedFiles (present by
# default in auto and bypassPermissions modes; in default mode only when
# user/flag/policy settings enable it), and each gets the Write|Edit treatment:
# canonicalize, contain, scrub only under .claude/sessions/. Parsing, dedupe,
# rejection and the stderr notices for every file not processed (moreFiles > 0,
# caps, truncation) live in _common.sh's bash_edit_diff_paths; when it exits 3
# the list is incomplete and this hook sweeps recent files under sessions/.
#
# The read is bounded (read_hook_payload) because the Bash matcher puts every
# command's stdout through this hook; `INPUT=$(cat)` cost seconds per large
# output.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

read_hook_payload "" bash-edit-diff

PROJECT_ROOT=$(get_project_root)
SESSION_DIR="${PROJECT_ROOT}/.claude/sessions"

# scrub_if_session <resolved> — scrub one already-contained path if it is a
# session file.
scrub_if_session() {
    if [[ "$1" == "$SESSION_DIR"/* ]]; then
        if ! bash "$PROJECT_ROOT/scripts/scrub-secrets.sh" "$1"; then
            echo "WARNING: scrub-secrets failed for $1" >&2
        fi
    fi
}

if [ "$(json_string_field "$INPUT" tool_name)" = "Bash" ]; then
    # The parser's exit status says whether its list is complete. Capture it
    # (no process substitution, which would drop it) and, when it is not, sweep.
    BASH_EDIT_RC=0
    BASH_EDIT_LIST=$(bash_edit_diff_paths post-write-session) || BASH_EDIT_RC=$?
    while IFS= read -r BASH_EDITED; do
        [ -n "$BASH_EDITED" ] || continue
        RESOLVED=$(resolve_project_path "$(canonicalize_payload_path "$BASH_EDITED")") || continue
        scrub_if_session "$RESOLVED"
    done <<< "$BASH_EDIT_LIST"
    if [ "$BASH_EDIT_RC" -eq "$BASH_EDIT_FALLBACK_STATUS" ]; then
        # Fallback: some Bash-edited files were not listed to us, and a skipped
        # scrub leaves a secret in a handoff. Scrub every regular file directly
        # under .claude/sessions/ touched in the last 10 minutes. `-type f`
        # does not follow links, and each hit still goes through
        # resolve_project_path and scrub_if_session, so containment is unchanged.
        echo "post-write-session: bashEditDiff list incomplete — fallback scrub of .claude/sessions/ files modified in the last 10 minutes" >&2
        while IFS= read -r -d '' SWEPT; do
            RESOLVED=$(resolve_project_path "$SWEPT") || continue
            scrub_if_session "$RESOLVED"
        done < <(find "$SESSION_DIR" -maxdepth 1 -type f -mmin -10 -print0 2>/dev/null)
    fi
    exit 0
fi

# canonicalize_payload_path, not the raw value. The runtime delivers file_path
# as a native OS path, so on Windows it arrives as `C:\\Users\\…` (separators
# still JSON-escaped) or as a `./`-relative path, and resolve_project_path's
# `[ -f "$file" ]` / containment check can miss it unconverted. Unconverted,
# this hook silently skips scrubbing a session file that IS under
# .claude/sessions/ — the same silent no-op post-tool-use.sh was fixed for.
FILE_PATH=$(canonicalize_payload_path "$(extract_file_path "$INPUT")")

# A bounded read can cut file_path off; say so rather than skip a scrub silently.
if [ -z "$FILE_PATH" ] && [ "${HOOK_PAYLOAD_TRUNCATED:-0}" = "1" ]; then
    echo "post-write-session: payload exceeded ${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144} bytes and carried no file_path in that window — not scrubbing" >&2
    exit 0
fi

# Validate file is under the project root and resolve symlinks
# resolve_project_path handles: symlink escape, path traversal, and boundary checks
RESOLVED=$(resolve_project_path "$FILE_PATH") || exit 0

# Only act on session files
scrub_if_session "$RESOLVED"

exit 0
