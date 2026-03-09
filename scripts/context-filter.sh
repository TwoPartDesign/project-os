#!/bin/bash
set -euo pipefail

# context-filter.sh — Context filtering and indexing for large content
# Usage: scripts/context-filter.sh --file <path> --intent "query"
#        cat large.txt | scripts/context-filter.sh --intent "query"
#        scripts/context-filter.sh --file <path>

# ============================================================================
# Helper Functions
# ============================================================================

get_project_root() {
  local current="$PWD"
  for ((i = 0; i < 10; i++)); do
    if [ -d "$current/.claude" ]; then
      echo "$current"
      return 0
    fi
    local parent="$(cd "$current/.." && pwd)"
    if [ "$parent" = "$current" ]; then
      break
    fi
    current="$parent"
  done
  echo "$PWD"
}

format_size() {
  local bytes=$1
  if ((bytes < 1024)); then
    echo "${bytes}B"
  elif ((bytes < 1048576)); then
    local kb=$((bytes / 1024))
    local kb_dec=$(((bytes % 1024) * 10 / 1024))
    echo "${kb}.${kb_dec}KB"
  else
    local mb=$((bytes / 1048576))
    local mb_dec=$(((bytes % 1048576) * 10 / 1048576))
    echo "${mb}.${mb_dec}MB"
  fi
}

get_content_type() {
  local content="$1"
  local first_lines="${content:0:500}"

  if echo "$first_lines" | grep -qi "error\|warn\|fatal\|exception"; then
    echo "text/log"
  elif echo "$first_lines" | grep -qi "^#\|^##\|^-\|^\*"; then
    echo "text/markdown"
  elif echo "$first_lines" | grep -qi "json\|{.*:.*}"; then
    echo "application/json"
  else
    echo "text/plain"
  fi
}

extract_top_terms() {
  local content="$1"
  local limit=${2:-5}

  echo "$content" | tr ' ' '\n' | tr -d '[:punct:]' | grep -v '^$' | sort | uniq -c | sort -rn | head -n "$limit" | awk '{print $2 " (" $1 ")"}'
}

# ============================================================================
# Argument Parsing
# ============================================================================

FILE=""
INTENT=""
THRESHOLD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      if [[ $# -lt 2 ]]; then echo "Error: --file requires a value" >&2; exit 1; fi
      FILE="$2"
      shift 2
      ;;
    --intent)
      if [[ $# -lt 2 ]]; then echo "Error: --intent requires a value" >&2; exit 1; fi
      INTENT="$2"
      shift 2
      ;;
    --threshold)
      if [[ $# -lt 2 ]]; then echo "Error: --threshold requires a value" >&2; exit 1; fi
      THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ============================================================================
# Disable Check
# ============================================================================

if [ "${CONTEXT_FILTER_DISABLED:-0}" = "1" ]; then
  if [ -n "$FILE" ]; then
    cat "$FILE"
  else
    cat
  fi
  exit 0
fi

# ============================================================================
# Read Content
# ============================================================================

TMPFILE=""
CONTENT_PATH=""

if [ -n "$FILE" ]; then
  if [ ! -f "$FILE" ]; then
    echo "Error: File not found: $FILE" >&2
    exit 1
  fi
  CONTENT_PATH="$FILE"
  CONTENT=$(cat "$FILE")
else
  # Read from stdin
  TMPFILE=$(mktemp)
  trap "rm -f '$TMPFILE'" EXIT
  cat > "$TMPFILE"
  CONTENT_PATH="$TMPFILE"
  CONTENT=$(cat "$TMPFILE")
fi

# ============================================================================
# Get Threshold
# ============================================================================

PROJECT_ROOT=$(get_project_root)

if [ -z "$THRESHOLD" ]; then
  # Try to read from config
  if command -v node &>/dev/null; then
    THRESHOLD=$(node "$PROJECT_ROOT/scripts/knowledge-index.ts" config threshold_bytes 2>/dev/null || echo "5120")
  else
    THRESHOLD="5120"
  fi
fi

# ============================================================================
# Check Content Size
# ============================================================================

CONTENT_SIZE=${#CONTENT}
CONTENT_LINES=$(echo "$CONTENT" | wc -l)

# If under threshold, pass through
if ((CONTENT_SIZE <= THRESHOLD)); then
  echo "$CONTENT"
  exit 0
fi

# ============================================================================
# Content Over Threshold — Index and Filter
# ============================================================================

# Index the content
if command -v node &>/dev/null; then
  if ! node "$PROJECT_ROOT/scripts/knowledge-index.ts" index "$CONTENT_PATH" 2>/dev/null; then
    echo "Warning: indexing failed for content" >&2
  fi
fi

# ============================================================================
# Generate Output
# ============================================================================

REDUCED_SIZE=0
TIMESTAMP=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
CONFIDENCE="medium"  # dynamic content (stdin or temp) is medium confidence

if [ -n "$INTENT" ]; then
  # ========================================================================
  # With Intent: Search and Return Matching Sections
  # ========================================================================

  if command -v node &>/dev/null; then
    SEARCH_RESULTS=$(node "$PROJECT_ROOT/scripts/knowledge-index.ts" search "$INTENT" 2>/dev/null) || SEARCH_RESULTS=""
  else
    SEARCH_RESULTS=""
  fi

  if [ -z "$SEARCH_RESULTS" ]; then
    # Fallback: grep-based search
    MATCHED=$(echo "$CONTENT" | grep -Fin -- "$INTENT" | head -5)
    MATCH_COUNT=$(echo "$MATCHED" | grep -c . || echo 0)
  else
    # Parse search results (simplified)
    MATCH_COUNT=$(echo "$SEARCH_RESULTS" | grep -c "^\[" || echo 0)
  fi

  if ((MATCH_COUNT > 0)); then
    # Calculate reduced size from actual search results
    if [ -n "$SEARCH_RESULTS" ]; then
      REDUCED_SIZE=${#SEARCH_RESULTS}
    else
      REDUCED_SIZE=${#MATCHED}
    fi
    REDUCTION_PCT=$(( (CONTENT_SIZE - REDUCED_SIZE) * 100 / CONTENT_SIZE ))

    echo "-- Filtered: $(format_size $CONTENT_SIZE) -> $(format_size $REDUCED_SIZE) ($REDUCTION_PCT% reduction) --"
    echo "[FRESHCONTEXT] Retrieved: $TIMESTAMP | Confidence: $CONFIDENCE"
    echo ""
    echo "Matched $MATCH_COUNT sections for intent \"$INTENT\":"

    if [ -n "$SEARCH_RESULTS" ]; then
      echo "$SEARCH_RESULTS"
    else
      # Fallback grep output
      echo "$MATCHED" | while IFS= read -r line; do
        echo "[grep] $line"
      done
    fi

    echo "[Full content indexed. Search: node scripts/knowledge-index.ts search \"<terms>\"]"
  else
    # No matches found, pass through unchanged
    echo "$CONTENT"
    exit 0
  fi

else
  # ========================================================================
  # Without Intent: Return Statistical Summary
  # ========================================================================

  CONTENT_TYPE=$(get_content_type "$CONTENT")
  TOP_TERMS=$(extract_top_terms "$CONTENT" 5)

  echo "-- Summary: $(format_size $CONTENT_SIZE) ($CONTENT_LINES lines) --"
  echo "[FRESHCONTEXT] Retrieved: $TIMESTAMP | Confidence: $CONFIDENCE"
  echo ""
  echo "Content type: $CONTENT_TYPE"
  echo "Top terms:"
  echo "$TOP_TERMS" | sed 's/^/  /'
  echo "[Full content indexed. Search: node scripts/knowledge-index.ts search \"<terms>\"]"
fi

exit 2
