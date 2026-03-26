#!/bin/bash
# PreCompact hook: auto-generate a session handoff YAML before context compaction.
# Receives JSON on stdin: {"session_id": "...", "trigger": "auto"|"manual"}
# Writes to .claude/sessions/auto-checkpoint-TIMESTAMP.yaml
# Advisory hook — never surfaces errors to Claude Code.

set -euo pipefail
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source shared utilities
source "$SCRIPT_DIR/_common.sh"

SESSIONS_DIR="$PROJECT_ROOT/.claude/sessions"
ROADMAP="$PROJECT_ROOT/ROADMAP.md"

# ── Debounce ────────────────────────────────────────────────────────────────
# Skip if any auto-checkpoint was written in the last 10 minutes (600 seconds).
# Uses find with -mmin to check modification time; no pipes needed.
RECENT=$(find "$SESSIONS_DIR" -maxdepth 1 -name "auto-checkpoint-*.yaml" -mmin -10 2>/dev/null | head -1 || true)
if [ -n "$RECENT" ]; then
    exit 0
fi

# ── Timestamps ──────────────────────────────────────────────────────────────
TIMESTAMP_FILE=$(date +%Y-%m-%d-%H%M)
TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

CHECKPOINT_FILE="$SESSIONS_DIR/auto-checkpoint-$TIMESTAMP_FILE.yaml"

# ── Ensure sessions directory exists ────────────────────────────────────────
mkdir -p "$SESSIONS_DIR"

# ── Extract phase from ROADMAP.md ───────────────────────────────────────────
# Phase logic: [-] means build, [~] means review, else ad-hoc.
# Assumption: we grep only for marker presence, not full parse, for speed.
HAS_BUILD=$(grep -c '^\s*\[-\]' "$ROADMAP" 2>/dev/null || true)
HAS_REVIEW=$(grep -c '^\s*\[~\]' "$ROADMAP" 2>/dev/null || true)

if [ "$HAS_BUILD" -gt 0 ]; then
    PHASE="build"
elif [ "$HAS_REVIEW" -gt 0 ]; then
    PHASE="review"
else
    PHASE="ad-hoc"
fi

# ── Extract feature name ────────────────────────────────────────────────────
# Find the ## Feature: heading whose section contains [-] or [~] tasks.
# Approach: read ROADMAP line-by-line in awk, tracking section headers.
# Assumption: the first section containing [-] or [~] tasks wins.
# Using awk via a separate process (no pipes in the Bash call itself — awk
# reads the file directly as an argument, not piped from another command).
FEATURE=$(awk '
    /^## Feature:/ { current = substr($0, index($0, ":") + 2); found_task = 0 }
    /^\s*\[-\]/ || /^\s*\[~\]/ { found_task = 1 }
    /^## / && !/^## Feature:/ { if (found_task) { print current; exit } }
    END { if (found_task) print current }
' "$ROADMAP" 2>/dev/null | head -1 || true)

# Strip leading/trailing whitespace
FEATURE="${FEATURE#"${FEATURE%%[![:space:]]*}"}"
FEATURE="${FEATURE%"${FEATURE##*[![:space:]]}"}"

if [ -z "$FEATURE" ]; then
    FEATURE="none"
fi

# ── Collect in-progress task descriptions ──────────────────────────────────
# Extract lines matching [-] and strip the marker prefix.
# Use grep + sed via process substitution is disallowed; use awk instead.
IN_PROGRESS_RAW=$(awk '
    /^\s*\[-\]/ {
        line = $0
        sub(/^\s*\[-\]\s*/, "", line)
        # Strip trailing task ID like #T1 or (agent: ...) suffixes
        sub(/\s+#T[0-9]+.*$/, "", line)
        if (length(line) > 0) print line
    }
' "$ROADMAP" 2>/dev/null || true)

# ── Collect modified files via git ──────────────────────────────────────────
# git -C pattern; no pipes — capture output directly.
MODIFIED_FILES=$(git -C "$PROJECT_ROOT" diff --name-only 2>/dev/null || true)

# ── Build YAML sections ─────────────────────────────────────────────────────

# Build in_progress YAML block
IN_PROGRESS_YAML=""
TASK_LIST=""
if [ -n "$IN_PROGRESS_RAW" ]; then
    while IFS= read -r task_desc; do
        [ -z "$task_desc" ] && continue
        # Escape any double-quotes in the description for YAML safety
        SAFE_DESC="${task_desc//\"/\\\"}"
        IN_PROGRESS_YAML="${IN_PROGRESS_YAML}    - description: \"${SAFE_DESC}\"
      files: \"\"
      state: \"in-progress at compaction time\"
"
        if [ -n "$TASK_LIST" ]; then
            TASK_LIST="${TASK_LIST}; ${task_desc}"
        else
            TASK_LIST="$task_desc"
        fi
    done <<< "$IN_PROGRESS_RAW"
fi

if [ -z "$IN_PROGRESS_YAML" ]; then
    IN_PROGRESS_YAML="    - description: \"(none)\"
      files: \"\"
      state: \"in-progress at compaction time\"
"
    TASK_LIST="(none)"
fi

# Build modified_files YAML block
MODIFIED_FILES_YAML=""
if [ -n "$MODIFIED_FILES" ]; then
    while IFS= read -r fpath; do
        [ -z "$fpath" ] && continue
        SAFE_PATH="${fpath//\"/\\\"}"
        MODIFIED_FILES_YAML="${MODIFIED_FILES_YAML}  - path: \"${SAFE_PATH}\"
    change_type: modified
    summary: \"uncommitted change\"
"
    done <<< "$MODIFIED_FILES"
fi

if [ -z "$MODIFIED_FILES_YAML" ]; then
    MODIFIED_FILES_YAML=""
fi

# ── Write the YAML file ─────────────────────────────────────────────────────
# Use printf to avoid echo variable-expansion issues.
{
    printf 'timestamp: "%s"\n' "$TIMESTAMP_ISO"
    printf 'phase: "%s"\n' "$PHASE"
    printf 'feature: "%s"\n' "${FEATURE//\"/\\\"}"
    printf '\n'
    printf 'objective: |\n'
    printf '  Auto-checkpoint before context compaction\n'
    printf '\n'
    printf 'progress:\n'
    printf '  completed: []\n'
    printf '  in_progress:\n'
    printf '%s' "$IN_PROGRESS_YAML"
    printf '\n'
    printf 'decisions: []\n'
    printf '\n'
    printf 'modified_files:\n'
    if [ -n "$MODIFIED_FILES_YAML" ]; then
        printf '%s' "$MODIFIED_FILES_YAML"
    else
        printf '  []\n'
    fi
    printf '\n'
    printf 'blockers: []\n'
    printf '\n'
    printf 'next_steps:\n'
    printf '  - priority: 1\n'
    printf '    action: "Resume with /tools:catchup"\n'
    printf '    context: "Auto-checkpoint captured before compaction"\n'
    printf '\n'
    printf 'context_notes: |\n'
    printf '  This checkpoint was auto-generated by the PreCompact hook.\n'
    printf '\n'
    printf 'compact_instruction: |\n'
    printf '  Working on %s. In-progress tasks: %s.\n' "$FEATURE" "$TASK_LIST"
} > "$CHECKPOINT_FILE"

# ── Emit additionalContext JSON to stdout ────────────────────────────────────
# PreCompact hooks communicate back via stdout JSON.
printf '{"hookSpecificOutput":{"hookEventName":"PreCompact","additionalContext":"Auto-checkpoint saved to .claude/sessions/auto-checkpoint-%s.yaml. Resume with /tools:catchup"}}\n' "$TIMESTAMP_FILE"

exit 0
