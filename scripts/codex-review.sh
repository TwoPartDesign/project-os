#!/usr/bin/env bash
# codex-review.sh — Run a Codex review with stdin piping (avoids arg-splitting issues)
#
# Usage: bash scripts/codex-review.sh --prompt-file FILE [OPTIONS]
#
# Options:
#   --prompt-file FILE    Path to file containing the review prompt (required)
#   --diff-from BRANCH    Append `git diff BRANCH...HEAD` to the prompt
#   --mode MODE           read-only (default) or danger-full-access
#
# Why stdin? Passing multiline prompts as CLI args splits on whitespace on Windows.
# Piping via stdin avoids this entirely.
#
# Windows path note: Git Bash /tmp → %LOCALAPPDATA%\Temp (not C:\tmp).
# When PowerShell fallback is used, paths are converted via cygpath or $LOCALAPPDATA.

set -euo pipefail

# --- Cleanup ---
COMBINED=""
PS_SCRIPT=""
cleanup() {
    [ -n "$COMBINED" ] && rm -f "$COMBINED"
    [ -n "$PS_SCRIPT" ] && rm -f "$PS_SCRIPT"
}
trap cleanup EXIT

# --- Defaults ---
PROMPT_FILE=""
DIFF_FROM=""
MODE="read-only"

# --- Argument parsing ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prompt-file)
            if [[ $# -lt 2 ]]; then
                echo "ERROR: --prompt-file requires an argument" >&2
                exit 1
            fi
            shift
            PROMPT_FILE="$1"
            shift
            ;;
        --diff-from)
            if [[ $# -lt 2 ]]; then
                echo "ERROR: --diff-from requires an argument" >&2
                exit 1
            fi
            shift
            DIFF_FROM="$1"
            shift
            ;;
        --mode)
            if [[ $# -lt 2 ]]; then
                echo "ERROR: --mode requires an argument" >&2
                exit 1
            fi
            shift
            MODE="$1"
            shift
            ;;
        --help|-h)
            echo "Usage: bash scripts/codex-review.sh --prompt-file FILE [--diff-from BRANCH] [--mode MODE]"
            echo ""
            echo "Options:"
            echo "  --prompt-file FILE    Review prompt file (required)"
            echo "  --diff-from BRANCH    Append git diff BRANCH...HEAD to prompt"
            echo "  --mode MODE           read-only (default) or danger-full-access"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

# --- Validation ---
if [ -z "$PROMPT_FILE" ]; then
    echo "ERROR: --prompt-file is required" >&2
    echo "Run with --help for usage." >&2
    exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
    echo "ERROR: Prompt file not found: $PROMPT_FILE" >&2
    exit 1
fi

if [[ "$MODE" != "read-only" && "$MODE" != "danger-full-access" ]]; then
    echo "ERROR: --mode must be 'read-only' or 'danger-full-access'" >&2
    exit 1
fi

if [ -n "$DIFF_FROM" ]; then
    if [[ "$DIFF_FROM" =~ \.\. ]] || [[ ! "$DIFF_FROM" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
        echo "ERROR: Invalid branch name: $DIFF_FROM" >&2
        exit 1
    fi
fi

# --- Build combined prompt ---
COMBINED=$(mktemp /tmp/codex-review-XXXXXX.txt)

cat "$PROMPT_FILE" > "$COMBINED"

if [ -n "$DIFF_FROM" ]; then
    printf '\n\n---\n\n## Git Diff (%s...HEAD)\n\n```diff\n' "$DIFF_FROM" >> "$COMBINED"
    git diff "$DIFF_FROM...HEAD" >> "$COMBINED" 2>/dev/null || true
    printf '```\n' >> "$COMBINED"
fi

PROMPT_SIZE=$(wc -c < "$COMBINED")
echo "codex-review: prompt size ${PROMPT_SIZE} bytes, mode=${MODE}" >&2
if [ "$PROMPT_SIZE" -gt 102400 ]; then
    echo "WARNING: Prompt is ${PROMPT_SIZE} bytes — Codex may truncate (limit ~100KB)." >&2
fi

# --- Invoke Codex ---
if command -v codex >/dev/null 2>&1; then
    echo "codex-review: piping to codex via stdin" >&2
    codex exec -s "$MODE" < "$COMBINED"
    exit $?
fi

# Codex not in bash PATH — fall back to PowerShell
echo "codex-review: codex not in bash PATH, trying PowerShell fallback" >&2

# Convert /tmp path to Windows path that PowerShell can read
COMBINED_WIN=""
if command -v cygpath >/dev/null 2>&1; then
    COMBINED_WIN=$(cygpath -w "$COMBINED")
elif [ -n "${LOCALAPPDATA:-}" ]; then
    # Git Bash maps /tmp → %LOCALAPPDATA%\Temp
    LOCALAPPDATA_UNIX=$(echo "$LOCALAPPDATA" | tr '\\' '/')
    COMBINED_WIN=$(echo "$COMBINED" | sed "s|^/tmp|$LOCALAPPDATA_UNIX/Temp|")
    COMBINED_WIN=$(echo "$COMBINED_WIN" | tr '/' '\\')
else
    echo "ERROR: codex not in PATH, cygpath unavailable, and \$LOCALAPPDATA not set." >&2
    echo "  Install codex so it is accessible from Git Bash, or ensure cygpath is available." >&2
    exit 1
fi

if [ -z "$COMBINED_WIN" ]; then
    echo "ERROR: Could not convert temp file path for PowerShell." >&2
    exit 1
fi

# Write a .ps1 script — avoids arg-quoting issues in powershell -Command "..."
PS_SCRIPT=$(mktemp /tmp/codex-invoke-XXXXXX.ps1)

PS_SCRIPT_WIN=""
if command -v cygpath >/dev/null 2>&1; then
    PS_SCRIPT_WIN=$(cygpath -w "$PS_SCRIPT")
elif [ -n "${LOCALAPPDATA:-}" ]; then
    LOCALAPPDATA_UNIX=$(echo "$LOCALAPPDATA" | tr '\\' '/')
    PS_SCRIPT_WIN=$(echo "$PS_SCRIPT" | sed "s|^/tmp|$LOCALAPPDATA_UNIX/Temp|")
    PS_SCRIPT_WIN=$(echo "$PS_SCRIPT_WIN" | tr '/' '\\')
fi

if [ -z "$PS_SCRIPT_WIN" ]; then
    echo "ERROR: Could not convert PS script path for PowerShell." >&2
    exit 1
fi

# Single-quoted paths in PowerShell are literal (spaces safe)
cat > "$PS_SCRIPT" <<PSEOF
Get-Content -Path '$COMBINED_WIN' -Raw | codex exec -s $MODE
PSEOF

echo "codex-review: invoking via PowerShell -File" >&2
powershell.exe -File "$PS_SCRIPT_WIN"
