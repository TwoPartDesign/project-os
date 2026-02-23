#!/usr/bin/env bash
# dashboard.sh — Scan projects directory and display Project OS status table
#
# Usage: bash scripts/dashboard.sh [projects_root]
# Default: ~/projects

set -euo pipefail

PROJECTS_ROOT="${1:-$HOME/projects}"

if [ ! -d "$PROJECTS_ROOT" ]; then
    echo "Projects directory not found: $PROJECTS_ROOT" >&2
    echo "Configure in .claude/settings.json → project_os.dashboard.projects_root" >&2
    exit 1
fi

# Regex for ROADMAP task lines
re_task='^[[:space:]]*-[[:space:]]\[(.)\]'

# Header
printf "\n"
printf "Project OS Dashboard\n"
printf "═══════════════════════════════════════════════════════════════\n"
printf "%-20s %-20s %5s %5s %6s %5s %7s\n" "Project" "Branch" "Todo" "WIP" "Review" "Done" "Blocked"
printf "───────────────────────────────────────────────────────────────\n"

total_todo=0
total_wip=0
total_review=0
total_done=0
total_blocked=0
project_count=0
last_activity=""
last_activity_project=""

for dir in "$PROJECTS_ROOT"/*/; do
    [ -d "$dir" ] || continue

    # Must have CLAUDE.md (Project OS indicator)
    if [ ! -f "${dir}CLAUDE.md" ]; then
        continue
    fi

    project_name="$(basename "$dir")"
    project_count=$((project_count + 1))

    # Get current branch
    branch=""
    if [ -d "${dir}.git" ] || [ -f "${dir}.git" ]; then
        branch="$(git -C "$dir" branch --show-current 2>/dev/null || echo "detached")"
    fi

    # Count task statuses from ROADMAP.md
    todo=0; wip=0; review=0; done=0; blocked=0

    if [ -f "${dir}ROADMAP.md" ]; then
        while IFS= read -r line; do
            if [[ "$line" =~ $re_task ]]; then
                marker="${BASH_REMATCH[1]}"
                case "$marker" in
                    " ") todo=$((todo + 1)) ;;
                    "-") wip=$((wip + 1)) ;;
                    "~") review=$((review + 1)) ;;
                    "x") done=$((done + 1)) ;;
                    "!") blocked=$((blocked + 1)) ;;
                    ">") wip=$((wip + 1)) ;;  # competing counts as WIP
                    "?") ;;  # drafts not counted
                esac
            fi
        done < "${dir}ROADMAP.md"
    fi

    # Track last activity
    activity_log="${dir}.claude/logs/activity.jsonl"
    if [ -f "$activity_log" ]; then
        last_line="$(tail -1 "$activity_log" 2>/dev/null || echo "")"
        if [ -n "$last_line" ]; then
            ts="$(echo "$last_line" | grep -o '"timestamp": "[^"]*"' | head -1 | sed 's/"timestamp": "//;s/"//')"
            if [ -n "$ts" ] && { [ -z "$last_activity" ] || [[ "$ts" > "$last_activity" ]]; }; then
                last_activity="$ts"
                last_activity_project="$project_name"
            fi
        fi
    fi

    # Print row
    printf "%-20s %-20s %5d %5d %6d %5d %7d\n" \
        "${project_name:0:20}" "${branch:0:20}" "$todo" "$wip" "$review" "$done" "$blocked"

    total_todo=$((total_todo + todo))
    total_wip=$((total_wip + wip))
    total_review=$((total_review + review))
    total_done=$((total_done + done))
    total_blocked=$((total_blocked + blocked))
done

printf "───────────────────────────────────────────────────────────────\n"
printf "%-20s %-20s %5d %5d %6d %5d %7d\n" \
    "Totals (${project_count})" "" "$total_todo" "$total_wip" "$total_review" "$total_done" "$total_blocked"

# Count active worktrees across all projects
worktree_count=0
for dir in "$PROJECTS_ROOT"/*/; do
    wt_dir="${dir}.claude/worktrees"
    if [ -d "$wt_dir" ]; then
        for wt in "$wt_dir"/*/; do
            [ -d "$wt" ] && worktree_count=$((worktree_count + 1))
        done
    fi
done

printf "\nActive worktrees: %d\n" "$worktree_count"

if [ -n "$last_activity" ]; then
    printf "Last activity: %s (%s)\n" "$last_activity" "$last_activity_project"
fi

printf "\n"
