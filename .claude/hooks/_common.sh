#!/bin/bash
# Shared utilities for Project OS hooks
# Common functions: path resolution, validation, JSON extraction

# Resolve a file path to its canonical form, preventing symlink escape and path traversal.
# Usage: resolved=$(resolve_project_path "$file") || exit 0
# Returns: canonical path on success, exits with error message on failure (returns 1)
resolve_project_path() {
    local file="$1"
    local project_root

    # Calculate project root relative to this script
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    project_root="$(cd "$script_dir/../.." && pwd)"

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

# Get project root (useful for referencing project-relative paths in hooks)
# Usage: root=$(get_project_root)
get_project_root() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ( cd "$script_dir/../.." && pwd )
}
