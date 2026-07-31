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
    # Compaction-pressure markers written by compact-suggest.sh / pre-compact.sh.
    # These three are session-private — nothing outside the owning session ever
    # reads them, so they die with it.
    rm -f "$LOG_DIR/.compact-base-$SESSION_ID" "$LOG_DIR/.compact-nudged-$SESSION_ID" "$LOG_DIR/.compact-cycle-$SESSION_ID"

    # .compact-handoff-* is deliberately NOT removed here. It is the one marker
    # read ACROSS sessions: it records which session authored which handoff, and
    # since #T144 it is the ENTIRE basis on which pre-compact.sh decides whether
    # a handoff may steer a compaction summary — there is no discovery fallback
    # behind it any more. Deleting it at SessionEnd un-claims this session's
    # handoffs the moment it exits, and the handoff outlives the session that
    # wrote it: a resumed or concurrent session compacting afterwards would find
    # nothing claimed and forward nothing, silently losing the instruction. The
    # handoff outlives the session; the record of who wrote it has to outlive it
    # too.
    #
    # The 7-day prune below is what eventually collects it, and that expiry is
    # now a real cost rather than a free one — a pruned claim means a handoff
    # that stops being forwarded. It is accepted because the alternative is an
    # unbounded log directory, and because the loss is announced: pre-compact.sh
    # names the unclaimed file in the checkpoint and says it was not forwarded.
fi

# Prune stale markers from sessions that never cleaned up (>7 days old)
find "$LOG_DIR" -maxdepth 1 -name '.tool-count-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-base-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-nudged-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-cycle-*' -type f -mtime +7 -delete 2>/dev/null || true
find "$LOG_DIR" -maxdepth 1 -name '.compact-handoff-*' -type f -mtime +7 -delete 2>/dev/null || true

# Opportunistic rotation of the append-only logs
rotate_log "$LOG_DIR/activity.jsonl"
rotate_log "$LOG_DIR/tool-failures.log"
rotate_log "$LOG_DIR/format-errors.log"

exit 0
