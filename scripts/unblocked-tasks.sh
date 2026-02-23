#!/usr/bin/env bash
# unblocked-tasks.sh — Parse ROADMAP.md and output unblocked tasks as JSON
#
# A task is "unblocked" when:
#   1. Its status is [ ] (Todo / approved)
#   2. All its dependencies (depends: #TN) are [x] (Done)
#
# Usage: bash scripts/unblocked-tasks.sh [path/to/ROADMAP.md]
# Output: JSON array of unblocked task objects

set -euo pipefail

ROADMAP="${1:-ROADMAP.md}"

if [ ! -f "$ROADMAP" ]; then
    echo "Error: $ROADMAP not found" >&2
    exit 1
fi

# Regex patterns stored in variables (avoids bash ERE parsing issues)
re_task='^[[:space:]]*-[[:space:]]\[(.)\][[:space:]](.+)#T([0-9]+)[[:space:]]*$'
re_deps='depends:[[:space:]]*([^)]+)'
re_agent='agent:[[:space:]]*([^)]+)'

# Pass 1: Build a map of task_id -> status
declare -A task_status

while IFS= read -r line; do
    if [[ "$line" =~ $re_task ]]; then
        marker="${BASH_REMATCH[1]}"
        task_id="${BASH_REMATCH[3]}"
        task_status["$task_id"]="$marker"
    fi
done < "$ROADMAP"

# Pass 2: Find unblocked tasks (status [ ] with all deps [x])
first=true
echo "["

while IFS= read -r line; do
    if [[ "$line" =~ $re_task ]]; then
        marker="${BASH_REMATCH[1]}"
        body="${BASH_REMATCH[2]}"
        task_id="${BASH_REMATCH[3]}"

        # Only consider [ ] (Todo) tasks
        if [ "$marker" != " " ]; then
            continue
        fi

        # Extract description (strip dependency and agent annotations)
        description="$body"
        description="${description%% (depends:*}"
        description="${description%% (agent:*}"
        # Trim trailing whitespace
        description="$(echo "$description" | sed 's/[[:space:]]*$//')"

        # Extract dependencies
        deps=""
        if [[ "$body" =~ $re_deps ]]; then
            deps="${BASH_REMATCH[1]}"
        fi

        # Extract agent annotation if present
        agent=""
        if [[ "$body" =~ $re_agent ]]; then
            agent="${BASH_REMATCH[1]}"
        fi

        # Check if all dependencies are done
        blocked=false
        dep_list=""
        if [ -n "$deps" ]; then
            IFS=',' read -ra dep_parts <<< "$deps"
            for dep in "${dep_parts[@]}"; do
                dep="$(echo "$dep" | sed 's/[[:space:]]//g; s/#T//')"
                dep_list="${dep_list:+$dep_list, }\"#T${dep}\""
                dep_status="${task_status[$dep]:-}"
                if [ "$dep_status" != "x" ]; then
                    blocked=true
                fi
            done
        fi

        if [ "$blocked" = true ]; then
            continue
        fi

        # Output as JSON object
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi

        printf '  {"id": "#T%s", "description": "%s", "depends": [%s]' \
            "$task_id" \
            "$(echo "$description" | sed 's/"/\\"/g')" \
            "$dep_list"

        if [ -n "$agent" ]; then
            printf ', "agent": "%s"' "$agent"
        fi

        printf '}'
    fi
done < "$ROADMAP"

echo ""
echo "]"
