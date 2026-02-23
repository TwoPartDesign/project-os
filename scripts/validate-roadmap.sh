#!/usr/bin/env bash
# validate-roadmap.sh — Validate ROADMAP.md format, deps, and consistency
#
# Checks:
#   1. All task IDs are unique
#   2. All dependency references point to existing tasks
#   3. No dependency cycles
#   4. State consistency (e.g., done task can't depend on non-done task)
#   5. Orphan detection (tasks with deps on non-existent IDs)
#
# Usage: bash scripts/validate-roadmap.sh [path/to/ROADMAP.md]
# Exit: 0 if valid, 1 if errors found
#
# Expected task format: - [X] Description (depends: #T1) #T2
# The #TN task ID MUST appear at end-of-line. Lines without a trailing #TN are ignored.

set -euo pipefail

ROADMAP="${1:-ROADMAP.md}"
errors=0

if [ ! -f "$ROADMAP" ]; then
    echo "ERROR: $ROADMAP not found" >&2
    exit 1
fi

# Valid markers
VALID_MARKERS="? -~>x! "

# Regex patterns stored in variables (avoids bash ERE parsing issues)
# Note: #TN task ID must appear at end-of-line (after optional trailing whitespace).
# Format: - [X] Description text (depends: #T1) #T2
re_task='^[[:space:]]*-[[:space:]]\[(.)\][[:space:]](.+)#T([0-9]+)[[:space:]]*$'
re_deps='depends:[[:space:]]*([^)]+)'
re_agent='agent:[[:space:]]*([^)]+)'

# Parse all tasks
declare -A task_status
declare -A task_deps
declare -A task_desc
declare -a task_ids=()

while IFS= read -r line; do
    if [[ "$line" =~ $re_task ]]; then
        marker="${BASH_REMATCH[1]}"
        body="${BASH_REMATCH[2]}"
        task_id="${BASH_REMATCH[3]}"

        # Validate marker
        if [[ "$VALID_MARKERS" != *"$marker"* ]]; then
            echo "ERROR: Unrecognized marker [$marker] on task #T${task_id}" >&2
            errors=$((errors + 1))
        fi

        # Check uniqueness
        if [ -n "${task_status[$task_id]:-}" ]; then
            echo "ERROR: Duplicate task ID #T${task_id}" >&2
            errors=$((errors + 1))
        fi

        task_status["$task_id"]="$marker"
        task_ids+=("$task_id")

        # Extract description
        desc="$body"
        desc="${desc%% (depends:*}"
        desc="${desc%% (agent:*}"
        task_desc["$task_id"]="$(echo "$desc" | sed 's/[[:space:]]*$//')"

        # Extract dependencies
        deps=""
        if [[ "$body" =~ $re_deps ]]; then
            deps="${BASH_REMATCH[1]}"
        fi
        task_deps["$task_id"]="$deps"
    fi
done < "$ROADMAP"

if [ ${#task_ids[@]} -eq 0 ]; then
    echo "OK: No tasks found in $ROADMAP (empty roadmap)"
    exit 0
fi

echo "Found ${#task_ids[@]} task(s)"

# Check 1: Dangling dependency references
for id in "${task_ids[@]}"; do
    deps="${task_deps[$id]}"
    if [ -z "$deps" ]; then
        continue
    fi
    IFS=',' read -ra dep_parts <<< "$deps"
    for dep in "${dep_parts[@]}"; do
        dep_id="$(echo "$dep" | sed 's/[[:space:]]//g; s/#T//')"
        if [ -z "${task_status[$dep_id]:-}" ]; then
            echo "ERROR: #T${id} depends on #T${dep_id}, which does not exist" >&2
            errors=$((errors + 1))
        fi
    done
done

# Check 2: State consistency
# A [x] (done) task should not depend on a non-[x] task
for id in "${task_ids[@]}"; do
    if [ "${task_status[$id]}" != "x" ]; then
        continue
    fi
    deps="${task_deps[$id]}"
    if [ -z "$deps" ]; then
        continue
    fi
    IFS=',' read -ra dep_parts <<< "$deps"
    for dep in "${dep_parts[@]}"; do
        dep_id="$(echo "$dep" | sed 's/[[:space:]]//g; s/#T//')"
        dep_st="${task_status[$dep_id]:-}"
        if [ -n "$dep_st" ] && [ "$dep_st" != "x" ]; then
            echo "ERROR: #T${id} is done but depends on #T${dep_id} which is [${dep_st}]" >&2
            errors=$((errors + 1))
        fi
    done
done

# An [-] (in progress) task should not depend on a [?] (draft) task
for id in "${task_ids[@]}"; do
    if [ "${task_status[$id]}" != "-" ]; then
        continue
    fi
    deps="${task_deps[$id]}"
    if [ -z "$deps" ]; then
        continue
    fi
    IFS=',' read -ra dep_parts <<< "$deps"
    for dep in "${dep_parts[@]}"; do
        dep_id="$(echo "$dep" | sed 's/[[:space:]]//g; s/#T//')"
        dep_st="${task_status[$dep_id]:-}"
        if [ "$dep_st" = "?" ]; then
            echo "ERROR: #T${id} is in-progress but depends on #T${dep_id} which is still draft [?]" >&2
            errors=$((errors + 1))
        fi
    done
done

# Check 3: Cycle detection (DFS-based)
declare -A visited  # 0=unvisited, 1=in-stack, 2=done
for id in "${task_ids[@]}"; do
    visited["$id"]=0
done

dfs() {
    local node="$1"
    visited["$node"]=1  # mark in-stack

    local deps="${task_deps[$node]}"
    if [ -n "$deps" ]; then
        IFS=',' read -ra dep_parts <<< "$deps"
        for dep in "${dep_parts[@]}"; do
            local dep_id
            dep_id="$(echo "$dep" | sed 's/[[:space:]]//g; s/#T//')"
            # Skip dep_ids that aren't in the task list (already flagged as dangling)
            if [ -z "${visited[$dep_id]:-}" ]; then
                continue
            fi
            local state="${visited[$dep_id]}"
            if [ "$state" -eq 1 ]; then
                echo "ERROR: Dependency cycle detected involving #T${node} -> #T${dep_id}" >&2
                errors=$((errors + 1))
                # Mark done before returning to avoid stale in-stack state
                visited["$node"]=2
                return
            elif [ "$state" -eq 0 ]; then
                dfs "$dep_id"
            fi
        done
    fi

    visited["$node"]=2  # mark done
}

for id in "${task_ids[@]}"; do
    if [ "${visited[$id]}" -eq 0 ]; then
        dfs "$id"
    fi
done

# Summary
if [ "$errors" -gt 0 ]; then
    echo ""
    echo "FAILED: $errors error(s) found in $ROADMAP" >&2
    exit 1
else
    echo "OK: $ROADMAP is valid"
    exit 0
fi
