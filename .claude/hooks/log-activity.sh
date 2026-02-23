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

# JSON-escape a string (handles backslash, double-quote, control chars)
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Build JSON metadata from key=value pairs
metadata="{"
first=true
for arg in "$@"; do
    key="${arg%%=*}"
    value="${arg#*=}"
    # Sanitize: only allow alphanumeric, underscore, hyphen in keys
    key="$(echo "$key" | sed 's/[^a-zA-Z0-9_-]//g')"
    [ -z "$key" ] && continue
    # Properly escape value for JSON
    value="$(json_escape "$value")"
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

# Build the log entry (escape all interpolated values)
entry="{\"timestamp\": \"${TIMESTAMP}\", \"event\": \"$(json_escape "$EVENT")\""

if [ -n "$WORKTREE" ]; then
    entry="${entry}, \"worktree\": \"$(json_escape "$WORKTREE")\""
fi

if [ "$metadata" != "{}" ]; then
    entry="${entry}, \"metadata\": ${metadata}"
fi

entry="${entry}}"

# Append with file locking to handle concurrent writers
# Use flock if available, otherwise fall back to simple append
LOCK_FILE="${LOG_FILE}.lock"
if command -v flock &>/dev/null; then
    (
        flock -w 5 200 || { echo "log-activity: flock timeout, writing without lock" >&2; echo "$entry" >> "$LOG_FILE"; exit 0; }
        echo "$entry" >> "$LOG_FILE"
    ) 200>"$LOCK_FILE"
else
    echo "$entry" >> "$LOG_FILE"
fi
