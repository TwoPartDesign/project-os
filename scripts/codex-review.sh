#!/usr/bin/env bash
# codex-review.sh — Run a Codex code review via stdin piping
#
# Usage: bash scripts/codex-review.sh --prompt-file FILE [--diff-from BRANCH] [--mode MODE]
#
# Options:
#   --prompt-file FILE    Path to file containing the review prompt (required)
#   --diff-from BRANCH    Append `git diff BRANCH...HEAD` to the prompt
#   --mode MODE           read-only (default) or danger-full-access

set -euo pipefail

PROMPT_FILE=""
DIFF_FROM=""
MODE="read-only"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --prompt-file) shift; PROMPT_FILE="${1:?--prompt-file requires an argument}"; shift ;;
        --diff-from)   shift; DIFF_FROM="${1:?--diff-from requires an argument}"; shift ;;
        --mode)        shift; MODE="${1:?--mode requires an argument}"; shift ;;
        --help|-h)     head -10 "$0"; exit 0 ;;
        *)             echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# Validate
[[ -z "$PROMPT_FILE" ]] && { echo "ERROR: --prompt-file is required" >&2; exit 1; }
[[ ! -f "$PROMPT_FILE" ]] && { echo "ERROR: Prompt file not found: $PROMPT_FILE" >&2; exit 1; }
[[ "$MODE" != "read-only" && "$MODE" != "danger-full-access" ]] && { echo "ERROR: --mode must be 'read-only' or 'danger-full-access'" >&2; exit 1; }

if [[ -n "$DIFF_FROM" ]]; then
    [[ "$DIFF_FROM" =~ \.\. ]] || [[ ! "$DIFF_FROM" =~ ^[a-zA-Z0-9._/~^-]+$ ]] && { echo "ERROR: Invalid ref: $DIFF_FROM" >&2; exit 1; }
fi

# Build combined prompt in temp file
COMBINED=$(mktemp)
trap 'rm -f "$COMBINED"' EXIT

cat "$PROMPT_FILE" > "$COMBINED"

if [[ -n "$DIFF_FROM" ]]; then
    printf '\n\n---\n\n## Git Diff (%s...HEAD)\n\n```diff\n' "$DIFF_FROM" >> "$COMBINED"
    git diff "$DIFF_FROM...HEAD" >> "$COMBINED" 2>/dev/null || true
    printf '```\n' >> "$COMBINED"
fi

PROMPT_SIZE=$(wc -c < "$COMBINED")
echo "codex-review: ${PROMPT_SIZE} bytes, mode=${MODE}" >&2
[[ "$PROMPT_SIZE" -gt 102400 ]] && echo "WARNING: Prompt exceeds ~100KB — Codex may truncate." >&2

# Invoke
codex exec -s "$MODE" < "$COMBINED"
