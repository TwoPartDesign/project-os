#!/usr/bin/env bash
# preserve-sessions.sh — Copy session files from worktrees to project root
# Prevents session loss on worktree cleanup (Claude Code bug #20210)
#
# Usage: Called as a hook or manually before worktree removal.
#   bash .claude/hooks/preserve-sessions.sh [worktree_path]
#
# If no worktree_path given, scans all worktrees under .claude/worktrees/

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION_DIR="${PROJECT_ROOT}/.claude/sessions"
WORKTREE_BASE="${PROJECT_ROOT}/.claude/worktrees"

mkdir -p "$SESSION_DIR"

copy_sessions() {
    local wt_path="$1"
    local wt_session_dir="${wt_path}/.claude/sessions"

    if [ ! -d "$wt_session_dir" ]; then
        return 0
    fi

    local count=0
    for f in "$wt_session_dir"/*; do
        [ -f "$f" ] || continue
        local basename
        basename="$(basename "$f")"
        if [ ! -f "${SESSION_DIR}/${basename}" ]; then
            cp "$f" "${SESSION_DIR}/${basename}"
            count=$((count + 1))
        fi
    done

    if [ "$count" -gt 0 ]; then
        echo "preserve-sessions: copied $count session file(s) from $(basename "$wt_path")" >&2
    fi
}

if [ $# -ge 1 ]; then
    # Single worktree path provided
    copy_sessions "$1"
else
    # Scan all worktrees
    if [ ! -d "$WORKTREE_BASE" ]; then
        exit 0
    fi
    for wt in "$WORKTREE_BASE"/*/; do
        [ -d "$wt" ] || continue
        copy_sessions "$wt"
    done
fi
