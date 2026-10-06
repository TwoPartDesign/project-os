#!/bin/bash
# PostToolUse hook: scrub secrets from session files after they are written.
# Receives JSON payload via stdin. Only acts on writes to .claude/sessions/.
#
# Bash edits (#T202): also registered on the `Bash` matcher. When tool_name is
# Bash, the files come from tool_response.bashEditDiff.changedFiles (present by
# default in auto and bypassPermissions modes; in default mode only when
# user/flag/policy settings enable it), and each gets the Write|Edit treatment:
# canonicalize, contain, scrub only under .claude/sessions/. Absent key or
# empty list: silent exit 0. moreFiles > 0: the listed files are scrubbed, the
# unlisted rest are not. An element carrying any JSON escape (quote, backslash,
# control character) is rejected, never unescaped.
#
# The read is bounded (read_hook_payload) because the Bash matcher puts every
# command's stdout through this hook; `INPUT=$(cat)` cost seconds per large
# output.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

read_hook_payload

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

# bash_edit_diff_paths <hook-name> — print each bashEditDiff.changedFiles
# element of $INPUT on its own line. Duplicated in post-tool-use.sh (the two
# hooks share no parser in _common.sh); keep the copies identical.
bash_edit_diff_paths() {
    local LC_ALL=C before rest elem n=0
    local key='"changedFiles"[[:space:]]*:[[:space:]]*\['
    local str='^"(([^"\\]|\\.)*)"'
    if ! [[ "$INPUT" =~ $key ]]; then
        if [ "${HOOK_PAYLOAD_TRUNCATED:-0}" = "1" ] && [[ "$INPUT" == *'"bashEditDiff"'* ]]; then
            echo "$1: payload exceeded ${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144} bytes before bashEditDiff.changedFiles — Bash-edited files skipped" >&2
        fi
        return 0
    fi
    # `%%lit*`, not `#*lit`: the latter is quadratic over a 256 KiB payload.
    before="${INPUT%%"${BASH_REMATCH[0]}"*}"
    rest="${INPUT:$((${#before} + ${#BASH_REMATCH[0]})):65536}"
    while [ "$n" -lt 256 ]; do
        rest="${rest#"${rest%%[![:space:]]*}"}"
        [[ "$rest" =~ $str ]] || return 0   # `]`, or malformed: stop
        elem="${BASH_REMATCH[1]}"
        rest="${rest:${#BASH_REMATCH[0]}}"
        n=$((n + 1))
        case "$elem" in
            '') ;;
            *\\*) echo "$1: rejected a bashEditDiff path containing a quote, backslash or control character" >&2 ;;
            *) printf '%s\n' "$elem" ;;
        esac
        rest="${rest#"${rest%%[![:space:]]*}"}"
        [ "${rest:0:1}" = "," ] || return 0
        rest="${rest:1}"
    done
}

if [ "$(json_string_field "$INPUT" tool_name)" = "Bash" ]; then
    while IFS= read -r BASH_EDITED; do
        RESOLVED=$(resolve_project_path "$(canonicalize_payload_path "$BASH_EDITED")") || continue
        scrub_if_session "$RESOLVED"
    done < <(bash_edit_diff_paths post-write-session)
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
