#!/usr/bin/env bash
# log-activity.sh — Append structured JSONL events to activity log
#
# Usage: bash .claude/hooks/log-activity.sh <event> [key=value ...]
#
# Events: task-spawned, task-completed, task-failed, review-started,
#         review-passed, review-failed, revision-started, compete-spawned,
#         compete-selected, pr-created, feature-shipped, plan-approved,
#         session-preserved, jev-queried, jev-declined, review-triaged,
#         model-switched
#
# Example:
#   bash .claude/hooks/log-activity.sh task-spawned feature=auth task_id=T3 agent=implementer
#
# Hook mode (#T203): registered on PostModelSwitch as
#   bash .claude/hooks/log-activity.sh model-switched --stdin
# `--stdin` reads the hook payload and logs from=<from_model> to=<to_model>
# source=<source>. Any field the payload lacks is omitted, never invented, and
# hook mode always exits 0 — it is advisory and must not surface errors to
# Claude Code. Without `--stdin` stdin is never read, so a manual call cannot
# hang on an open pipe.

set -euo pipefail

# Hook mode must never fail the session, including on the setup lines below.
case " $* " in
    *" --stdin "*) trap 'exit 0' ERR ;;
esac

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/.claude/logs"
LOG_FILE="${LOG_DIR}/activity.jsonl"

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

mkdir -p "$LOG_DIR"
rotate_log "$LOG_FILE"

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

# Hook mode: replace `--stdin` with key=value pairs read from the payload.
# Values reach an append-only log, so each is reduced to a closed charset
# (model names are [A-Za-z0-9._:\[\]-]) and length-capped rather than escaped.
ARGS=()
STDIN_MODE=false
for arg in "$@"; do
    if [ "$arg" = "--stdin" ]; then
        STDIN_MODE=true
    else
        ARGS+=("$arg")
    fi
done

if [ "$STDIN_MODE" = true ]; then
    PAYLOAD="$(head -c 65536 2>/dev/null || true)"
    cat >/dev/null 2>&1 || true  # drain the rest so the writer never takes EPIPE
    payload_field() {
        local v
        v="$(printf '%s' "$PAYLOAD" | grep -aoE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" 2>/dev/null | sed -n '1p' | sed 's/^[^:]*:[[:space:]]*"//;s/"$//' || true)"
        v="$(printf '%s' "$v" | tr -cd 'A-Za-z0-9._:[]-' | cut -c1-80)"
        printf '%s' "$v"
    }
    for pair in from:from_model to:to_model source:source; do
        v="$(payload_field "${pair#*:}")"
        if [ -n "$v" ]; then ARGS+=("${pair%%:*}=$v"); fi
    done
fi

# Build JSON metadata from key=value pairs
metadata="{"
first=true
for arg in ${ARGS[@]+"${ARGS[@]}"}; do
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
        flock -w 5 200 || { echo "log-activity: flock timeout, dropping event" >&2; exit 0; }
        echo "$entry" >> "$LOG_FILE"
    ) 200>"$LOCK_FILE"
else
    echo "$entry" >> "$LOG_FILE"
fi
