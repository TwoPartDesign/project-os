#!/bin/bash
# SessionEnd hook: clean up per-session artifacts in .claude/logs/
# - removes this session's .tool-count-<session_id> counter and its .lock
# - prunes counter/lock files older than 7 days from sessions that never
#   fired a SessionEnd (crashes, container reclaims)
# - opportunistically rotates the append-only logs
# Advisory hook — never surfaces errors, always exits 0.

set -euo pipefail
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

LOG_DIR="$(get_project_root)/.claude/logs"
[ -d "$LOG_DIR" ] || exit 0

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(echo "$INPUT" | grep -oE '"session_id"\s*:\s*"[^"]*"' | sed 's/.*"session_id"[^"]*"//;s/".*//' | head -1 || true)
# Sanitize: allow only alphanumeric, hyphen, underscore (matches compact-suggest.sh)
SESSION_ID=$(echo "$SESSION_ID" | tr -cd '[:alnum:]_-')

if [ -n "$SESSION_ID" ]; then
    rm -f "$LOG_DIR/.tool-count-$SESSION_ID" "$LOG_DIR/.tool-count-$SESSION_ID.lock"
fi

# Prune stale counters from sessions that never cleaned up (>7 days old)
find "$LOG_DIR" -maxdepth 1 -name '.tool-count-*' -type f -mtime +7 -delete 2>/dev/null || true

# Opportunistic rotation of the append-only logs
rotate_log "$LOG_DIR/activity.jsonl"
rotate_log "$LOG_DIR/tool-failures.log"
rotate_log "$LOG_DIR/format-errors.log"

exit 0
