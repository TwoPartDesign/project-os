#!/bin/bash
# Auto-format files after Claude edits them
# Configure for your project's formatter
# Receives JSON payload via stdin from Claude Code PostToolUse hook
#
# Bash edits (#T202): also registered on the `Bash` matcher. When the payload's
# tool_name is Bash, the files come from tool_response.bashEditDiff.changedFiles
# (present by default in auto and bypassPermissions modes; in default mode only
# when user/flag/policy settings enable it). Each path gets exactly the
# Write|Edit treatment: same canonicalization, same containment, same
# extension set. Absent key or empty list: silent exit 0. When moreFiles > 0 the
# platform listed only part of the change; the listed files are formatted and
# the rest are not. Elements are parsed without eval, and one containing a
# quote, backslash or control character (any JSON escape) is rejected, never
# unescaped — which also means Windows-native backslash paths are skipped.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

read_hook_payload

LOG_DIR="$(get_project_root)/.claude/logs"

# format_file <resolved> — format one already-contained path by extension.
format_file() {
    local RESOLVED="$1"
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
}

# bash_edit_diff_paths <hook-name> — print each bashEditDiff.changedFiles
# element of $INPUT on its own line. Duplicated in post-write-session.sh (the
# two hooks share no parser in _common.sh); keep the copies identical.
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
        format_file "$RESOLVED"
    done < <(bash_edit_diff_paths post-tool-use)
    exit 0
fi
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

format_file "$RESOLVED"
