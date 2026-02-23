#!/usr/bin/env bash
# log-activity.sh — Append structured JSONL events to activity log
#
# Usage: bash .claude/hooks/log-activity.sh <event> [key=value ...]
#
# Events: task-spawned, task-completed, task-failed, review-started,
#         review-passed, review-failed, revision-started, compete-spawned,
#         compete-selected, pr-created, feature-shipped, plan-approved,
#         session-preserved
#
# Example:
#   bash .claude/hooks/log-activity.sh task-spawned feature=auth task_id=T3 agent=implementer

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/.claude/logs"
LOG_FILE="${LOG_DIR}/activity.jsonl"

mkdir -p "$LOG_DIR"

EVENT="${1:-}"
shift || true

if [ -z "$EVENT" ]; then
    echo "Usage: log-activity.sh <event> [key=value ...]" >&2
    exit 1
fi

# Build JSON metadata from key=value pairs
metadata="{"
first=true
for arg in "$@"; do
    key="${arg%%=*}"
    value="${arg#*=}"
    # Sanitize: only allow alphanumeric, underscore, hyphen in keys
    key="$(echo "$key" | sed 's/[^a-zA-Z0-9_-]//g')"
    # Escape quotes in value
    value="$(echo "$value" | sed 's/"/\\"/g')"
    if [ "$first" = true ]; then
        first=false
    else
        metadata="${metadata}, "
    fi
    metadata="${metadata}\"${key}\": \"${value}\""
done
metadata="${metadata}}"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Detect current worktree (if any)
WORKTREE=""
if git rev-parse --is-inside-work-tree &>/dev/null; then
    wt_path="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
    if [[ "$wt_path" == *".claude/worktrees"* ]]; then
        WORKTREE="$(basename "$wt_path")"
    fi
fi

# Build the log entry
entry="{\"timestamp\": \"${TIMESTAMP}\", \"event\": \"${EVENT}\""

if [ -n "$WORKTREE" ]; then
    entry="${entry}, \"worktree\": \"${WORKTREE}\""
fi

if [ "$metadata" != "{}" ]; then
    entry="${entry}, \"metadata\": ${metadata}"
fi

entry="${entry}}"

# Append atomically
echo "$entry" >> "$LOG_FILE"
