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
    resolved="$(realpath "$file" 2>/dev/null || readlink -f "$file" 2>/dev/null)" || {
        echo "WARNING: cannot canonicalize '$file' (realpath/readlink unavailable)" >&2
        return 1
    }

    # If resolution produced empty string, fail
    [ -z "$resolved" ] && return 1

    # Reject path traversal (explicit defense against ..)
    case "$resolved" in
        *..* ) return 1 ;;
    esac

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
    if dir=$(cd "$dir" 2>/dev/null && pwd -P); then
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

# Get project root (useful for referencing project-relative paths in hooks)
# Usage: root=$(get_project_root)
get_project_root() {
    # Physical, so this agrees with resolve_project_path's realpath'd candidates
    # and with canonicalize_payload_path. All three must produce one spelling.
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
    ( cd "$script_dir/../.." && pwd -P )
}
