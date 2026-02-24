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
    resolved="$(realpath "$file" 2>/dev/null || readlink -f "$file" 2>/dev/null)" || return 1

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
    echo "$input" | grep -oE '"file_path"\s*:\s*"[^"]*"' | sed 's/.*"file_path"[^"]*"//;s/".*//'
}

# Get project root (useful for referencing project-relative paths in hooks)
# Usage: root=$(get_project_root)
get_project_root() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$script_dir/../.." && pwd
}
