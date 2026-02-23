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

EVENT="${1:-}"
DETAIL="${2:-}"
EXTRA="${3:-}"

if [ -z "$EVENT" ]; then
    echo "Usage: notify-phase-change.sh <event> [details]" >&2
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

# Try OS-level notification if available
if command -v notify-send &>/dev/null; then
    # Linux
    notify-send "Project OS" "$MSG" 2>/dev/null || true
elif command -v osascript &>/dev/null; then
    # macOS
    osascript -e "display notification \"${MSG}\" with title \"Project OS\"" 2>/dev/null || true
elif command -v powershell.exe &>/dev/null; then
    # Windows (from Git Bash)
    powershell.exe -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show('${MSG}','Project OS','OK','Information')" 2>/dev/null &
    disown 2>/dev/null || true
fi
