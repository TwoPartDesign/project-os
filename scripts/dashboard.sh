#!/usr/bin/env bash
# dashboard.sh — Scan projects directory and display Project OS status table
#
# Usage: bash scripts/dashboard.sh [--json] [projects_root]
# Default: ~/projects
# Options:
#   --json  Output JSON instead of ASCII table

set -euo pipefail

# Parse options
OUTPUT_JSON=false
PROJECTS_ROOT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --json)
            OUTPUT_JSON=true
            shift
            ;;
        *)
            PROJECTS_ROOT="$1"
            shift
            ;;
    esac
done

# If PROJECTS_ROOT not provided via argument, read from settings.json or use default
if [ -z "$PROJECTS_ROOT" ]; then
    SETTINGS_FILE=".claude/settings.json"
    DEFAULT_ROOT="$HOME/projects"

    if [ -f "$SETTINGS_FILE" ] && command -v jq &>/dev/null; then
        config_root="$(jq -r '.project_os.dashboard.projects_root // empty' "$SETTINGS_FILE" 2>/dev/null || echo "")"
        if [ -n "$config_root" ]; then
            # Expand ~ to $HOME
            PROJECTS_ROOT="${config_root/#\~/$HOME}"
        else
            PROJECTS_ROOT="$DEFAULT_ROOT"
        fi
    else
        PROJECTS_ROOT="$DEFAULT_ROOT"
    fi
fi

if [ ! -d "$PROJECTS_ROOT" ]; then
    echo "Projects directory not found: $PROJECTS_ROOT" >&2
    echo "Configure in .claude/settings.json → project_os.dashboard.projects_root" >&2
    exit 1
fi

# Regex for ROADMAP task lines
re_task='^[[:space:]]*-[[:space:]]\[(.)\]'

# Get current timestamp in ISO-8601 format
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")"

# Collect projects data into arrays
declare -a project_names
declare -a project_paths
declare -a project_branches
declare -a project_todos
declare -a project_wips
declare -a project_reviews
declare -a project_dones
declare -a project_blockeds
declare -a project_drafts
declare -a project_activities

total_draft=0
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
        branch="$(git -C "$dir" branch --show-current 2>/dev/null)"
        branch="${branch:-detached}"
    fi

    # Count task statuses from ROADMAP.md
    todo=0; wip=0; review=0; done=0; blocked=0; draft=0

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
                    "?") draft=$((draft + 1)) ;;  # count drafts for JSON
                esac
            fi
        done < "${dir}ROADMAP.md"
    fi

    # Track last activity
    activity_ts=""
    activity_log="${dir}.claude/logs/activity.jsonl"
    if [ -f "$activity_log" ]; then
        last_line="$(tail -1 "$activity_log" 2>/dev/null || echo "")"
        if [ -n "$last_line" ]; then
            if command -v jq &>/dev/null; then
                activity_ts="$(echo "$last_line" | jq -r '.timestamp // empty' 2>/dev/null || echo "")"
            else
                activity_ts="$(echo "$last_line" | grep -o '"timestamp": "[^"]*"' | head -1 | sed 's/"timestamp": "//;s/"//')"
            fi
            if [ -n "$activity_ts" ] && { [ -z "$last_activity" ] || [[ "$activity_ts" > "$last_activity" ]]; }; then
                last_activity="$activity_ts"
                last_activity_project="$project_name"
            fi
        fi
    fi

    # Store project data
    project_names+=("$project_name")
    project_paths+=("$dir")
    project_branches+=("$branch")
    project_drafts+=("$draft")
    project_todos+=("$todo")
    project_wips+=("$wip")
    project_reviews+=("$review")
    project_dones+=("$done")
    project_blockeds+=("$blocked")
    project_activities+=("$activity_ts")

    total_draft=$((total_draft + draft))
    total_todo=$((total_todo + todo))
    total_wip=$((total_wip + wip))
    total_review=$((total_review + review))
    total_done=$((total_done + done))
    total_blocked=$((total_blocked + blocked))
done

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

# JSON-escape a string: backslashes, double quotes, and control characters
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Output in requested format
if [ "$OUTPUT_JSON" = true ]; then
    # JSON output
    printf "{"
    printf "\"timestamp\": \"%s\", " "$(json_escape "$timestamp")"
    printf "\"projects\": ["

    first_project=true
    for ((i = 0; i < project_count; i++)); do
        if [ "$first_project" = true ]; then
            first_project=false
        else
            printf ", "
        fi
        printf "{"
        printf "\"name\": \"%s\", " "$(json_escape "${project_names[$i]}")"
        printf "\"path\": \"%s\", " "$(json_escape "${project_paths[$i]}")"
        printf "\"branch\": \"%s\", " "$(json_escape "${project_branches[$i]}")"
        printf "\"tasks\": {\"draft\": %d, \"todo\": %d, \"wip\": %d, \"review\": %d, \"done\": %d, \"blocked\": %d}, " \
            "${project_drafts[$i]}" "${project_todos[$i]}" "${project_wips[$i]}" "${project_reviews[$i]}" "${project_dones[$i]}" "${project_blockeds[$i]}"
        printf "\"last_activity\": \"%s\"" "$(json_escape "${project_activities[$i]}")"
        printf "}"
    done

    printf "], "
    printf "\"totals\": {\"draft\": %d, \"todo\": %d, \"wip\": %d, \"review\": %d, \"done\": %d, \"blocked\": %d}, " \
        "$total_draft" "$total_todo" "$total_wip" "$total_review" "$total_done" "$total_blocked"
    printf "\"worktrees\": %d" "$worktree_count"
    printf "}\n"
else
    # ASCII table output
    printf "\n"
    printf "Project OS Dashboard\n"
    printf "═══════════════════════════════════════════════════════════════\n"
    printf "%-20s %-20s %5s %5s %6s %5s %7s\n" "Project" "Branch" "Todo" "WIP" "Review" "Done" "Blocked"
    printf "───────────────────────────────────────────────────────────────\n"

    for ((i = 0; i < project_count; i++)); do
        printf "%-20s %-20s %5d %5d %6d %5d %7d\n" \
            "${project_names[$i]:0:20}" "${project_branches[$i]:0:20}" \
            "${project_todos[$i]}" "${project_wips[$i]}" "${project_reviews[$i]}" "${project_dones[$i]}" "${project_blockeds[$i]}"
    done

    printf "───────────────────────────────────────────────────────────────\n"
    printf "%-20s %-20s %5d %5d %6d %5d %7d\n" \
        "Totals (${project_count})" "" "$total_todo" "$total_wip" "$total_review" "$total_done" "$total_blocked"

    printf "\nActive worktrees: %d\n" "$worktree_count"

    if [ -n "$last_activity" ]; then
        printf "Last activity: %s (%s)\n" "$last_activity" "$last_activity_project"
    fi

    printf "\n"
fi
