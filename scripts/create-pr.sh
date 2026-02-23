#!/usr/bin/env bash
# create-pr.sh — Generate a pull request with AI-assisted description
#
# Usage: bash scripts/create-pr.sh <feature_name> [base_branch]
#
# Requires: gh CLI authenticated

set -euo pipefail

FEATURE="${1:-}"

if [ -z "$FEATURE" ]; then
    echo "Usage: create-pr.sh <feature_name> [base_branch]" >&2
    exit 1
fi

# Auto-detect default branch if not specified
if [ -n "${2:-}" ]; then
    BASE="$2"
elif git rev-parse --verify main &>/dev/null; then
    BASE="main"
elif git rev-parse --verify master &>/dev/null; then
    BASE="master"
else
    echo "ERROR: Could not detect default branch. Specify explicitly: create-pr.sh <feature> <base>" >&2
    exit 1
fi

# Verify gh is available
if ! command -v gh &>/dev/null; then
    echo "ERROR: gh CLI not found. Install from https://cli.github.com/" >&2
    exit 1
fi

# Verify we're on a named branch (not detached HEAD)
CURRENT_BRANCH="$(git branch --show-current)"
if [ -z "$CURRENT_BRANCH" ]; then
    echo "ERROR: Detached HEAD state. Switch to a feature branch first." >&2
    exit 1
fi
if [ "$CURRENT_BRANCH" = "$BASE" ]; then
    echo "ERROR: Cannot create PR from $BASE branch. Switch to a feature branch first." >&2
    exit 1
fi

# Verify base branch exists
if ! git rev-parse --verify "$BASE" &>/dev/null; then
    echo "ERROR: Base branch '$BASE' does not exist." >&2
    exit 1
fi

# Verify there are commits to include
COMMIT_COUNT="$(git rev-list "${BASE}..HEAD" --count)"
if [ "$COMMIT_COUNT" -eq 0 ]; then
    echo "ERROR: No commits between $BASE and HEAD. Nothing to create a PR for." >&2
    exit 1
fi

# Gather context for PR description
COMMIT_LOG="$(git log "${BASE}..HEAD" --oneline --no-decorate)"
FILES_CHANGED="$(git diff "${BASE}..HEAD" --stat)"
DIFF_SUMMARY="$(git diff "${BASE}..HEAD" --shortstat)"

# Check if tasks.md exists for this feature
TASK_SUMMARY=""
TASKS_FILE="docs/specs/${FEATURE}/tasks.md"
if [ -f "$TASKS_FILE" ]; then
    # Extract task list (lines starting with ### T)
    TASK_SUMMARY="$(grep -E '^### T[0-9]+:' "$TASKS_FILE" 2>/dev/null || echo "No task breakdown available")"
fi

# Check for review status
REVIEW_STATUS=""
REVIEW_FILE="docs/specs/${FEATURE}/review.md"
if [ -f "$REVIEW_FILE" ]; then
    if grep -q "GATE PASSED" "$REVIEW_FILE" 2>/dev/null; then
        REVIEW_STATUS="Review gate: PASSED"
    elif grep -q "GATE FAILED" "$REVIEW_FILE" 2>/dev/null; then
        REVIEW_STATUS="Review gate: FAILED (check review.md for details)"
    fi
fi

# Build PR title
PR_TITLE="feat: ${FEATURE} — $(echo "$COMMIT_LOG" | head -1 | sed 's/^[a-f0-9]* //')"
# Truncate to 72 chars
PR_TITLE="${PR_TITLE:0:72}"

# Build PR body
PR_BODY="## Summary

Feature: \`${FEATURE}\`
Commits: ${COMMIT_COUNT}
${DIFF_SUMMARY}

## Changes

\`\`\`
${FILES_CHANGED}
\`\`\`

## Commit Log

\`\`\`
${COMMIT_LOG}
\`\`\`"

if [ -n "$TASK_SUMMARY" ]; then
    PR_BODY="${PR_BODY}

## Tasks

${TASK_SUMMARY}"
fi

if [ -n "$REVIEW_STATUS" ]; then
    PR_BODY="${PR_BODY}

## Review

${REVIEW_STATUS}"
fi

# Create the PR
echo "Creating PR: ${PR_TITLE}" >&2
gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$BASE"
