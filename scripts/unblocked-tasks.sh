#!/usr/bin/env bash
# unblocked-tasks.sh — Parse ROADMAP.md and output unblocked tasks as JSON
#
# A task is "unblocked" when:
#   1. Its status is [ ] (Todo / approved)
#   2. All its dependencies (depends: #TN) are [x] (Done)
#
# Usage: bash scripts/unblocked-tasks.sh [--agent <name>] [path/to/ROADMAP.md]
# Output: JSON array of unblocked task objects
#
# Options:
#   --agent <name>  Filter tasks by agent annotation (e.g., --agent codex)
#                   Tasks with no annotation are treated as "claude-code"

set -euo pipefail

# Parse arguments
FILTER_AGENT=""
ROADMAP="ROADMAP.md"

while [ $# -gt 0 ]; do
    case "$1" in
        --agent)
            if [ $# -lt 2 ]; then
                echo "Error: --agent requires a value" >&2
                exit 1
            fi
            FILTER_AGENT="$2"
            shift 2
            ;;
        *)
            ROADMAP="$1"
            shift
            ;;
    esac
done

if [ ! -f "$ROADMAP" ]; then
    echo "Error: $ROADMAP not found" >&2
    exit 1
fi

# Valid markers
VALID_MARKERS="? -~>x! "

# Regex patterns stored in variables (avoids bash ERE parsing issues)
re_task='^[[:space:]]*-[[:space:]]\[(.)][[:space:]](.+)#T([0-9]+)[[:space:]]*$'
re_deps='depends:[[:space:]]*([^)]+)'
re_agent='agent:[[:space:]]*([^)]+)'

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

# Pass 1: Build a map of task_id -> status
declare -A task_status

while IFS= read -r line; do
    if [[ "$line" =~ $re_task ]]; then
        marker="${BASH_REMATCH[1]}"
        task_id="${BASH_REMATCH[3]}"

        # Warn on unrecognized markers
        if [[ "$VALID_MARKERS" != *"$marker"* ]]; then
            echo "Warning: Unrecognized marker [$marker] on task #T${task_id}" >&2
        fi

        # Warn on duplicate IDs (first wins)
        if [ -n "${task_status[$task_id]:-}" ]; then
            echo "Warning: Duplicate task ID #T${task_id} — using first occurrence" >&2
            continue
        fi

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

        # Apply agent filter if specified
        if [ -n "$FILTER_AGENT" ]; then
            effective_agent="${agent:-claude-code}"
            if [ "$effective_agent" != "$FILTER_AGENT" ]; then
                continue
            fi
        fi

        # Output as JSON object
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi

        printf '  {"id": "#T%s", "description": "%s", "depends": [%s]' \
            "$task_id" \
            "$(json_escape "$description")" \
            "$dep_list"

        if [ -n "$agent" ]; then
            printf ', "agent": "%s"' "$(json_escape "$agent")"
        fi

        printf '}'
    fi
done < "$ROADMAP"

echo ""
echo "]"
