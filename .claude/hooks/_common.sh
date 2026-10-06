#!/bin/bash
# Shared utilities for Project OS hooks
# Common functions: path resolution, validation, JSON extraction

# Resolve a file path to its canonical form, preventing symlink escape and path traversal.
# Usage: resolved=$(resolve_project_path "$file") || exit 0
# Returns: canonical path on success, exits with error message on failure (returns 1)
resolve_project_path() {
    local file="$1"
    local project_root

    # Calculate project root relative to this script.
    #
    # `pwd -P`, not bare `pwd`. Bare `pwd` reports the *logical* path — the one
    # you walked in through, symlinks preserved — while the candidate below is
    # canonicalized with `realpath`, which is *physical*. For any checkout
    # reached through a symlink the two spellings name the same directory and
    # never compare equal, so the containment test at the bottom of this
    # function rejects every legitimate file and the feature disables itself
    # with no error on stdout or stderr. Reachable on macOS (`/tmp` and `/var`
    # are symlinks), symlinked home directories, and symlinked worktrees.
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
    project_root="$(cd "$script_dir/../.." && pwd -P)"

    # Exit early if file doesn't exist or is empty
    [ -z "$file" ] && return 1
    [ -f "$file" ] || return 1

    # Canonicalize: resolve symlinks and relative paths
    local resolved
    # `--`: a payload path like `-x.ts` or `--write` is a file, not an option.
    resolved="$(realpath -- "$file" 2>/dev/null || readlink -f -- "$file" 2>/dev/null)" || {
        echo "WARNING: cannot canonicalize '$file' (realpath/readlink unavailable)" >&2
        return 1
    }

    # If resolution produced empty string, fail
    [ -z "$resolved" ] && return 1

    # There is deliberately no `case "$resolved" in *..*) return 1` here. It
    # read as defence in depth and was neither: `$resolved` is the OUTPUT of
    # `realpath`, which has already collapsed every `..` component, so the
    # pattern cannot match a traversal attempt — the containment check below is
    # what actually stops one, and it stops it on the canonical path where the
    # question is decidable. What the pattern DID match is a literal `..` in a
    # legitimate name: a checkout at `~/src/my..project`, or any file whose
    # basename contains two dots in a row, was rejected outright, and the
    # callers read a rejection as "not ours" and silently skip it. A guard that
    # can only produce false negatives is worse than no guard, because it is
    # counted as coverage.

    # Verify resolved path is inside project root
    if [[ "$resolved" != "$project_root"/* ]]; then
        return 1
    fi

    echo "$resolved"
}

# Canonicalize a path taken from a hook payload into the spelling the shell
# itself produces, so it can be compared against `find` output, against
# `$(pwd)`-derived roots, and against forward-slash globs.
#
# TWO CONVERSIONS, AND BOTH ARE LOAD-BEARING ON WINDOWS.
#
# First, separators. The runtime delivers `file_path` as a native OS path, so on
# Windows it is `C:\Users\...`, and because json_string_field returns the raw
# JSON value each separator arrives still escaped — a literal `\\`. Every glob
# and every path comparison in these hooks is written with forward slashes, so
# an unconverted payload path matches nothing at all. That failure is silent:
# the guard does not error, it simply never fires, and the feature behind it
# looks implemented while doing nothing. Verified against a live transcript —
# 30 of 30 `file_path` values were backslash paths.
#
# Second, the drive letter. Converting separators alone still leaves
# `C:/Users/...`, while under MSYS/Git Bash `$(pwd)` yields `/c/Users/...`. The
# two spellings name the same file and never compare equal, so a claim recorded
# in one form is invisible to a reader that built its candidates in the other —
# which is the same silent-mismatch bug one layer down. The directory is
# therefore resolved through the shell and the basename re-appended. The
# basename is kept rather than resolving the whole path because a PreToolUse
# claim names a file that does not exist yet; its directory does.
#
# Usage: p=$(canonicalize_payload_path "$raw")
canonicalize_payload_path() {
    local p="$1" dir base
    [ -n "$p" ] || return 0

    p="${p//\\//}"     # separators: \ -> /
    p="${p//\/\///}"   # collapse the // a JSON-escaped \\ leaves behind

    # A bare filename has no directory to resolve through.
    case "$p" in
        */*) ;;
        *) printf '%s' "$p"; return 0 ;;
    esac

    dir="${p%/*}"
    base="${p##*/}"
    [ -n "$dir" ] || dir="/"

    # A directory that cannot be entered is left as-is rather than dropped:
    # separator conversion alone is still strictly better than the raw value,
    # and the callers all re-check containment for themselves.
    # `pwd -P` for the same reason resolve_project_path uses it: the result is
    # compared against roots and against `realpath`-canonicalized candidates,
    # all of which are physical. A logical answer here would reintroduce the
    # mismatch on a symlinked checkout.
    if dir=$(cd -- "$dir" 2>/dev/null && pwd -P); then
        case "$dir" in
            */) printf '%s%s' "$dir" "$base" ;;
            *)  printf '%s/%s' "$dir" "$base" ;;
        esac
    else
        printf '%s' "$p"
    fi
}

# Extract file_path from JSON input (via stdin or argument)
# Usage: file=$(extract_file_path "$json_input")
# Returns: file path string, or empty if not found
extract_file_path() {
    local input="$1"
    echo "$input" | grep -oE '"file_path"\s*:\s*"[^"]*"' | sed 's/.*"file_path"[^"]*"//;s/".*//' || true
}

# Check that node exists and is new enough to run .ts scripts directly
# (type stripping + node:sqlite require Node >= 22.18).
# Usage: node_available "knowledge indexing" || exit 0
# Returns: 0 if node >= 22.18 is on PATH; otherwise prints one warning
#          line to stderr and returns 1 (callers degrade loudly, not silently)
node_available() {
    local feature="${1:-TypeScript hook scripts}"
    local min_major=22
    local min_minor=18

    if ! command -v node >/dev/null 2>&1; then
        echo "WARN [hook]: node >=${min_major}.${min_minor} required for ${feature} — skipping (found: none)" >&2
        return 1
    fi

    local version
    version="$(node --version 2>/dev/null)"
    version="${version#v}"

    local major minor _patch
    IFS='.' read -r major minor _patch <<< "$version"

    # Guard against non-numeric parses (e.g. empty output)
    case "$major" in (*[!0-9]*|"") major=0 ;; esac
    case "$minor" in (*[!0-9]*|"") minor=0 ;; esac

    if [ "$major" -gt "$min_major" ]; then
        return 0
    fi
    if [ "$major" -eq "$min_major" ] && [ "$minor" -ge "$min_minor" ]; then
        return 0
    fi

    echo "WARN [hook]: node >=${min_major}.${min_minor} required for ${feature} — skipping (found: v${version:-unknown})" >&2
    return 1
}

# Rotate a log file when it exceeds max_bytes (default 1 MiB).
# Keeps one previous generation as <file>.old; older generations are dropped.
# Usage: rotate_log "$LOG_FILE" [max_bytes]
rotate_log() {
    local file="$1"
    local max_bytes="${2:-1048576}"
    [ -f "$file" ] || return 0
    local size
    size=$(wc -c < "$file" 2>/dev/null) || return 0
    case "$size" in (*[!0-9]*|"") return 0 ;; esac
    if [ "$size" -gt "$max_bytes" ]; then
        mv -f "$file" "${file}.old" 2>/dev/null || true
    fi
    return 0
}

# Extract and sanitize session_id from hook stdin JSON.
# The value lands in filenames under .claude/logs/, so it is restricted to
# [[:alnum:]_-]: a session_id of "../../etc/passwd" becomes "etcpasswd" rather
# than escaping the log directory.
# Usage: sid=$(session_id_from_json "$INPUT")
# Returns: sanitized id, or "default" when absent
session_id_from_json() {
    local input="$1"
    local sid
    sid=$(echo "$input" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"session_id"[^"]*"//;s/".*//' | head -1 || true)
    sid=$(echo "$sid" | tr -cd '[:alnum:]_-')
    echo "${sid:-default}"
}

# Extract a string field from hook stdin JSON without a JSON parser.
# Only safe for fields whose values contain no escaped quotes — the hook
# payload fields used here (transcript_path, trigger) are all simple scalars.
# Usage: val=$(json_string_field "$INPUT" transcript_path)
json_string_field() {
    local input="$1"
    local key="$2"
    echo "$input" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed "s/.*\"$key\"[^\"]*\"//;s/\".*//" | head -1 || true
}

# Read the hook payload from stdin, bounded.
#
# Sets INPUT to at most $1 bytes (default 256 KiB, overridable per-run with
# PROJECT_OS_HOOK_PAYLOAD_BYTES) and HOOK_PAYLOAD_TRUNCATED to 1 if anything
# followed. Assigns rather than echoes, because `INPUT=$(read_hook_payload)`
# would run the body in a subshell where the truncation flag dies with it.
#
# `INPUT=$(cat)` is the single most expensive thing these hooks do. Measured on
# this machine with a 20 MB PostToolUse payload: the slurp alone is 2.8s, while
# `cat >/dev/null` over the same bytes is 88ms — bash command substitution
# assembles the result byte-wise at roughly 7 MB/s. Every scan the hook then
# performs adds a few hundred ms on top of that, so the read, not the parsing,
# is what makes a large tool result cost seconds of hook time. Bounding it takes
# the same payload to ~110ms. compact-suggest.sh and tool-failure-log.sh both
# match `.*`, so this ran on every tool call.
#
# THE DRAIN IS NOT OPTIONAL. Stopping at $1 bytes leaves the rest of the payload
# in the pipe; exiting without consuming it hands the writer EPIPE on a hook the
# runtime had no reason to think failed. `wc -c` drains to EOF and reports what
# it swallowed, which is also how truncation is detected — one cheap pass doing
# both. Its output is discarded except for the count, so the bytes past the
# bound cost nothing to hold.
#
# The bound is safe for the top-level keys these hooks read — session_id,
# transcript_path, hook_event_name, tool_name are all serialized ahead of
# tool_input — but NOT unconditionally safe for tool_input.file_path, which sits
# inside the object that carries a written file's entire contents. A large
# enough write can push it past the window. That is why the flag exists rather
# than the bound being applied silently: a caller that needed a key and did not
# find one can check whether the payload was cut and say so.
#
# `read_hook_payload "" bash-edit-diff` (#T202): when the window's tool_name is
# Bash, the remainder is drained through `tr | cut | awk` instead, which also
# sets HOOK_PAYLOAD_TAIL_EDIT_DIFF=1 if the literal key "bashEditDiff" lies
# past the bound. A Bash stdout over the bound pushes bashEditDiff out of the
# window, and without this the edited files are skipped in silence. Memory
# stays bounded: `"` becomes a newline, so a key is a record of its own, and
# `cut -b1-13` caps every record. An escaped `\"bashEditDiff\"` inside a
# string leaves a trailing `\` and does not match, but a string whose content
# ENDS in `bashEditDiff` (stdout `…\"bashEditDiff`, closed by the real quote)
# does, so such output can raise a stray warning. That costs a spurious stderr
# line, never an action: only the key's presence is taken from the remainder —
# never a path.
read_hook_payload() {
    local max="${1:-${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144}}"
    case "$max" in ''|*[!0-9]*) max=262144 ;; esac
    [ "$max" -gt 0 ] || max=262144

    INPUT=$(head -c "$max" 2>/dev/null || true)

    local scanned=0 counts
    HOOK_PAYLOAD_TAIL_EDIT_DIFF=0
    if [ "${2:-}" = "bash-edit-diff" ] && [ "$(json_string_field "$INPUT" tool_name)" = "Bash" ]; then
        counts=$(LC_ALL=C tr '"' '\n' 2>/dev/null | LC_ALL=C cut -b1-13 2>/dev/null \
            | awk '{ n++ } $0 == "bashEditDiff" { k++ } END { print n + 0, k + 0 }' 2>/dev/null || true)
        case "$counts" in
            *[!0-9\ ]*|'') counts="0 0" ;;
        esac
        scanned="${counts%% *}"
        if [ "${counts##* }" -gt 0 ]; then
            HOOK_PAYLOAD_TAIL_EDIT_DIFF=1
        fi
    fi

    local rest
    rest=$(wc -c 2>/dev/null || echo 0)
    rest="${rest//[^0-9]/}"
    if [ "$(( ${rest:-0} + scanned ))" -gt 0 ]; then
        HOOK_PAYLOAD_TRUNCATED=1
    else
        HOOK_PAYLOAD_TRUNCATED=0
    fi
}

# Validate a caller-supplied positive integer, falling back to a default.
#
# Reject, do not scrub. `tr -cd '0-9'` deletes the characters that make a value
# wrong and keeps the digits that surround them, which turns malformed input
# into a plausible-looking number instead of a rejected one:
#   0.9  -> 09   — a leading zero, which `$((…))` reads as OCTAL. `09` is not a
#                  valid octal literal, so the arithmetic ABORTS the hook.
#   1e6  -> 16   — a 16-token window. Every nudge fires, every turn.
#   -5   -> 5    — the sign is deleted and the negation is silently inverted.
# None of these is a number the caller asked for, and each fails somewhere far
# from the assignment. A value that is not a plain non-negative integer is not
# repairable; the only safe reading of it is "unset", so it falls back to the
# default the same way an absent variable does.
#
# `10#` on every arithmetic use, so a caller who legitimately writes `075` gets
# 75 rather than 61.
#
# This lives in _common.sh rather than in the hook that first needed it because
# the one tunable that skipped it — PROJECT_OS_HANDOFF_MAX_AGE_MIN, interpolated
# straight into `find -mmin -$value` — failed in the worst available way. A
# non-numeric value made `find` error, its stderr was discarded, its output was
# empty, and pre-compact.sh read that empty result as "this handoff is too old",
# skipping EVERY owned handoff and then reporting the loss in the checkpoint as
# an unclaimed handoff — the wrong cause. A validator only one of two callers
# can reach is not a validator.
#
# Usage: n=$(posint_or_default "${SOME_ENV:-}" 30)
posint_or_default() {
    case "$1" in
        ''|*[!0-9]*) printf '%s' "$2"; return ;;
    esac
    if [ "$((10#$1))" -gt 0 ] 2>/dev/null; then
        printf '%s' "$((10#$1))"
    else
        printf '%s' "$2"
    fi
}

# Get project root (useful for referencing project-relative paths in hooks)
# Usage: root=$(get_project_root)
get_project_root() {
    # Physical, so this agrees with resolve_project_path's realpath'd candidates
    # and with canonicalize_payload_path. All three must produce one spelling.
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
    ( cd "$script_dir/../.." && pwd -P )
}

# Print each tool_response.bashEditDiff.changedFiles element of $INPUT on its
# own line, deduped, for post-tool-use.sh and post-write-session.sh (#T202).
# The caller canonicalizes and contains each path exactly as it would a
# Write|Edit file_path; nothing here is trusted as contained.
#
# - No eval, no JSON parser: one anchored ERE per element. An element carrying
#   any JSON escape (quote, backslash, control character, \uXXXX) is rejected
#   with a stderr line, never unescaped. The one exception is a Windows-native
#   path whose only escape is `\\` (#T233): it is converted with `cygpath -u`,
#   and rejected as above when cygpath is not on PATH (fail-closed).
# - Absent key or empty list: silent.
# - Every way of processing fewer files than the change touched says so on
#   stderr: moreFiles > 0, more than 256 entries, the array running past the
#   read window (payload bound or 64 KiB parse cap), and bashEditDiff lying
#   past the bound with changedFiles unreadable (set by
#   `read_hook_payload "" bash-edit-diff` via HOOK_PAYLOAD_TAIL_EDIT_DIFF).
#
# Exit status: 0, or 3 (BASH_EDIT_FALLBACK_STATUS) when any of those four
# skips fired, meaning the printed list is incomplete. A caller that must not
# miss a file (post-write-session.sh's session scrub) captures the output with
# `out=$(…) || rc=$?` and falls back to a directory sweep on 3; a caller that
# reads through `< <(…)` never sees the status and is unaffected.
#
# Usage: while IFS= read -r p; do …; done < <(bash_edit_diff_paths <hook-name>)
BASH_EDIT_FALLBACK_STATUS=3
bash_edit_diff_paths() {
    local LC_ALL=C hook="$1" before rest elem win conv tail13 i n=0 cut=0 edge=0 fb=0 seen=$'\n'
    local key='"changedFiles"[[:space:]]*:[[:space:]]*\['
    local str='^"(([^"\\]|\\.)*)"'
    local more='"moreFiles"[[:space:]]*:[[:space:]]*([0-9]+)'
    local lit='"bashEditDiff"'
    local skipped="the remaining files were not processed"

    if [[ "$INPUT" =~ $more ]]; then
        elem="${BASH_REMATCH[1]:0:12}"
        if [[ "$elem" =~ [1-9] ]]; then
            echo "$hook: bashEditDiff.moreFiles=$elem — the platform listed only part of the change; $skipped" >&2
            fb=$BASH_EDIT_FALLBACK_STATUS
        fi
    fi

    if ! [[ "$INPUT" =~ $key ]]; then
        [ "${HOOK_PAYLOAD_TRUNCATED:-0}" = "1" ] || return "$fb"
        # The key itself may straddle the bound: the window then ends in a
        # proper prefix of it (`"bash…`) and the tail scan sees only the rest.
        tail13="${INPUT: -13}"
        for ((i = 2; i <= 13; i++)); do
            if [[ "$tail13" == *"${lit:0:i}" ]]; then edge=1; fi
        done
        if [[ "$INPUT" == *"$lit"* ]] || [ "${HOOK_PAYLOAD_TAIL_EDIT_DIFF:-0}" = "1" ] || [ "$edge" = "1" ]; then
            echo "$hook: payload exceeded ${PROJECT_OS_HOOK_PAYLOAD_BYTES:-262144} bytes before bashEditDiff.changedFiles — Bash-edited files skipped" >&2
            fb=$BASH_EDIT_FALLBACK_STATUS
        fi
        return "$fb"
    fi

    # `%%lit*`, not `#*lit`: the latter is quadratic over a 256 KiB payload.
    before="${INPUT%%"${BASH_REMATCH[0]}"*}"
    rest="${INPUT:$((${#before} + ${#BASH_REMATCH[0]}))}"
    if [ "${#rest}" -gt 65536 ]; then
        rest="${rest:0:65536}"
        cut=1
    fi
    if [ "${HOOK_PAYLOAD_TRUNCATED:-0}" = "1" ]; then cut=1; fi

    while :; do
        rest="${rest#"${rest%%[![:space:]]*}"}"
        if ! [[ "$rest" =~ $str ]]; then
            # `]` ends the list; anything else is a cut-off or malformed tail.
            if [ "${rest:0:1}" != "]" ] && [ "$cut" = "1" ]; then
                echo "$hook: bashEditDiff.changedFiles runs past the read window — $skipped" >&2
                fb=$BASH_EDIT_FALLBACK_STATUS
            fi
            return "$fb"
        fi
        if [ "$n" -ge 256 ]; then
            echo "$hook: bashEditDiff.changedFiles has more than 256 entries — $skipped" >&2
            return "$BASH_EDIT_FALLBACK_STATUS"
        fi
        elem="${BASH_REMATCH[1]}"
        rest="${rest:${#BASH_REMATCH[0]}}"
        n=$((n + 1))
        # A Windows-native path arrives JSON-escaped (`C:\\Users\\x\\a.ts`). The
        # one escape accepted is `\\` -> `\`, and only when every backslash in
        # the element is part of such a pair (removing the pairs leaves none)
        # and the result looks like a Windows path: a drive letter, or no `/`
        # at all. `cygpath -u` then yields the POSIX spelling, which goes through
        # the same dedupe and the caller's containment as any other element.
        # Without cygpath the element stays rejected (fail closed).
        if [[ "$elem" == *\\* && "${elem//\\\\/}" != *\\* && "$elem" != *[[:cntrl:]]* ]]; then
            win="${elem//\\\\/\\}"
            if [[ "$win" =~ ^[A-Za-z]: || "$win" != */* ]] && command -v cygpath >/dev/null 2>&1; then
                if conv=$(cygpath -u -- "$win" 2>/dev/null) && [ -n "$conv" ] && [[ "$conv" != *[[:cntrl:]]* ]]; then
                    elem="$conv"
                fi
            fi
        fi
        case "$elem" in
            '') ;;
            # [[:cntrl:]]: a raw newline is invalid JSON, but would split one
            # element into two lines for the caller's `read`.
            *\\*|*[[:cntrl:]]*) echo "$hook: rejected a bashEditDiff path containing a quote, backslash or control character" >&2 ;;
            *)
                case "$seen" in
                    *$'\n'"$elem"$'\n'*) ;;
                    *) seen="$seen$elem"$'\n'; printf '%s\n' "$elem" ;;
                esac
                ;;
        esac
        rest="${rest#"${rest%%[![:space:]]*}"}"
        if [ "${rest:0:1}" != "," ]; then
            if [ "${rest:0:1}" != "]" ] && [ "$cut" = "1" ]; then
                echo "$hook: bashEditDiff.changedFiles runs past the read window — $skipped" >&2
                fb=$BASH_EDIT_FALLBACK_STATUS
            fi
            return "$fb"
        fi
        rest="${rest:1}"
    done
}
