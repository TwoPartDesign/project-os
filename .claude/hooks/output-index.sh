#!/bin/bash
# PostToolUse advisory hook: index large tool outputs and hint Claude via additionalContext
# Fires for: Bash, Read, Grep, WebFetch
# Behavior: If output exceeds threshold, index it and print hint to stderr (becomes additionalContext)
# Does NOT modify tool output — advisory only.

# Check if context filtering is disabled
if [ "${CONTEXT_FILTER_DISABLED:-0}" = "1" ]; then
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source shared utilities
source "$SCRIPT_DIR/_common.sh"

INPUT=$(cat)

# Extract all needed fields from JSON in a single node call
eval "$(node -e "
try {
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const esc = s => (s || '').replace(/'/g, \"'\\\\''\");
  console.log('TOOL_NAME=\\'' + esc(d.tool_name) + '\\'');
  console.log('OUTPUT=\\'' + esc(d.output) + '\\'');
  const args = d.arguments || {};
  console.log('ARG_COMMAND=\\'' + esc(args.command || '').substring(0,50) + '\\'');
  console.log('ARG_FILE_PATH=\\'' + esc(args.file_path || '') + '\\'');
  console.log('ARG_PATTERN=\\'' + esc(args.pattern || '').substring(0,50) + '\\'');
  console.log('ARG_URL=\\'' + esc(args.url || '').substring(0,100) + '\\'');
} catch { process.exit(1); }
" <<< "$INPUT")" 2>/dev/null || exit 0

# If no output, nothing to do
[ -z "$OUTPUT" ] && exit 0

# Get threshold from config via knowledge-index.ts
THRESHOLD=$(node "$PROJECT_ROOT/scripts/knowledge-index.ts" config threshold_bytes 2>/dev/null || echo "5120")
[ -z "$THRESHOLD" ] && THRESHOLD=5120

# Measure output size in bytes
OUTPUT_SIZE=${#OUTPUT}

# If under threshold, no action needed
if [ "$OUTPUT_SIZE" -le "$THRESHOLD" ]; then
    exit 0
fi

# Output exceeds threshold — index it
TEMP_FILE=$(mktemp)
trap "rm -f '$TEMP_FILE'" EXIT

# Write output to temp file safely (printf avoids echo's backslash/flag issues)
printf '%s' "$OUTPUT" > "$TEMP_FILE"

# Infer intent and freshness metadata based on tool type
INTENT=""
FRESHNESS_CONFIDENCE="medium"

case "$TOOL_NAME" in
    "Bash")
        INTENT="$ARG_COMMAND"
        FRESHNESS_CONFIDENCE="medium"
        ;;
    "Read")
        INTENT=$(basename "$ARG_FILE_PATH" 2>/dev/null || echo "file")
        if [ -f "$ARG_FILE_PATH" ]; then
            FRESHNESS_CONFIDENCE="high"
        fi
        ;;
    "Grep")
        INTENT="$ARG_PATTERN"
        FRESHNESS_CONFIDENCE="medium"
        ;;
    "WebFetch")
        INTENT="$ARG_URL"
        FRESHNESS_CONFIDENCE="low"
        ;;
    *)
        FRESHNESS_CONFIDENCE="medium"
        ;;
esac

# Index the output via knowledge-index.ts (suppress stdout, keep stderr for hint)
if node "$PROJECT_ROOT/scripts/knowledge-index.ts" index "$TEMP_FILE" --confidence "$FRESHNESS_CONFIDENCE" >/dev/null 2>&1; then
    # Success: print hint to stderr (becomes additionalContext)
    KB_SIZE=$((OUTPUT_SIZE / 1024))
    # Escape intent for display (replace single quotes)
    SAFE_INTENT=$(printf '%s' "$INTENT" | tr "'" "_")
    echo "Large output indexed (${KB_SIZE} KB). Use: node scripts/knowledge-index.ts search '${SAFE_INTENT}' for filtered view." >&2
fi

exit 0
