#!/usr/bin/env bash
# notify-phase-change.sh — Terminal notification on phase transition events
#
# Usage: bash .claude/hooks/notify-phase-change.sh <event> [details]
#
# Events:
#   task-unblocked      <task_id>
#   review-requested    <feature>
#   review-failed       <feature> <task_id>
#   approval-needed     <feature>
#   compete-complete    <feature> <task_id>
#   feature-complete    <feature>

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: notify-phase-change.sh <event> [details] [extra]" >&2
    exit 1
fi

EVENT="${1:-}"
DETAIL="${2:-}"
EXTRA="${3:-}"

if [ -z "$EVENT" ]; then
    echo "Usage: notify-phase-change.sh <event> [details] [extra]" >&2
    exit 1
fi

# Format the notification message
case "$EVENT" in
    task-unblocked)
        MSG="Task ${DETAIL} is now unblocked and ready for work"
        ;;
    review-requested)
        MSG="Feature '${DETAIL}' is ready for review"
        ;;
    review-failed)
        MSG="Review FAILED for ${DETAIL} task ${EXTRA} — revision needed"
        ;;
    approval-needed)
        MSG="Feature '${DETAIL}' has draft tasks awaiting /pm:approve"
        ;;
    compete-complete)
        MSG="Competitive implementations complete for ${DETAIL} task ${EXTRA}"
        ;;
    feature-complete)
        MSG="Feature '${DETAIL}' — all tasks done, ready for /workflows:ship"
        ;;
    *)
        MSG="Phase event: ${EVENT} ${DETAIL} ${EXTRA}"
        ;;
esac

TIMESTAMP="$(date '+%H:%M:%S')"

# Terminal notification (works in most terminals)
echo "[${TIMESTAMP}] PROJECT-OS: ${MSG}" >&2

# Sanitize message for safe shell interpolation (strip control chars, quotes, backslashes)
SAFE_MSG="$(printf '%s' "$MSG" | tr -d '\000-\037\\\"'"'"'`$')"

# Try OS-level notification if available
if command -v notify-send &>/dev/null; then
    # Linux — notify-send handles escaping safely via argument passing
    notify-send "Project OS" "$SAFE_MSG" 2>/dev/null || true
elif command -v osascript &>/dev/null; then
    # macOS — use -s flag with stdin to avoid shell interpolation in -e
    printf 'display notification "%s" with title "Project OS"' "$SAFE_MSG" | osascript 2>/dev/null || true
elif command -v powershell.exe &>/dev/null; then
    # Windows — pass message via environment variable to avoid interpolation
    NOTIFY_MSG="$SAFE_MSG" powershell.exe -NoProfile -Command \
        '[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null; [System.Windows.Forms.MessageBox]::Show($env:NOTIFY_MSG,"Project OS","OK","Information")' 2>/dev/null &
    disown 2>/dev/null || true
fi
