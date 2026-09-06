#!/bin/bash
# PostToolUse advisory hook: index large tool outputs and hint Claude via additionalContext
# Fires for: Bash, Read, Grep, WebFetch
# Behavior: If output exceeds threshold, index it and print hint to stderr (becomes additionalContext)
# Does NOT modify tool output — advisory only.

set -euo pipefail
trap 'exit 0' ERR  # Advisory hook — never surface errors to Claude Code

# Check if context filtering is disabled
if [ "${CONTEXT_FILTER_DISABLED:-0}" = "1" ]; then
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source shared utilities
source "$SCRIPT_DIR/_common.sh"

# Indexing runs .ts scripts directly via node (type stripping + node:sqlite).
# Degrade loudly but cleanly when node is missing or too old.
if ! node_available "large-output indexing (knowledge-index.ts)"; then
    exit 0
fi

# Write input to temp file so node can read it (heredoc consumes stdin).
#
# Straight from stdin to the file — this hook never needs the payload in a bash
# variable, and `INPUT=$(cat)` would be the most expensive line in it. Command
# substitution assembles its result byte-wise at roughly 7 MB/s here, so a 20 MB
# payload cost 2.8s to slurp and then be written straight back out; the redirect
# does the same job in 88ms. This is the hook that exists BECAUSE outputs get
# large, so it is the one that was paying that most often.
INPUT_FILE=$(mktemp)
EXTRACT_DIR=$(mktemp -d)
cat > "$INPUT_FILE"
trap "rm -rf '$INPUT_FILE' '$EXTRACT_DIR'" EXIT

# Each field lands in its own file under EXTRACT_DIR. No shell text is built
# from payload content, so nothing is eval'd and nothing is escaped — the
# previous key='value' + eval scheme doubled every backslash (corrupting
# Windows paths in the index) and reinstated a whole-payload command
# substitution this file's own comment above says was removed.
INPUT_PATH="$INPUT_FILE" EXTRACT_DIR="$EXTRACT_DIR" node 2>/dev/null << 'EXTRACT_SCRIPT' || exit 0
try {
  const fs = require('fs');
  const path = require('path');
  const d = JSON.parse(fs.readFileSync(process.env.INPUT_PATH, 'utf8'));
  // PostToolUse delivers the tool's parameters as `tool_input` and its result
  // as `tool_response`. This hook read `arguments`/`output` — keys the runtime
  // has never sent — so every field came back empty, the size check compared 0
  // against the threshold, and the hook returned 0 without ever indexing
  // anything. Silent, because it is advisory and exits 0 by design.
  const args = d.tool_input || {};
  // `tool_response` is not one shape: Bash sends an object with stdout/stderr,
  // Read and Grep send a string or a { content } / { file } object. Take the
  // text when there is a text field, and fall back to the serialized object so
  // an unfamiliar shape is still indexed rather than silently dropped.
  const r = d.tool_response;
  let out = '';
  if (typeof r === 'string') {
    out = r;
  } else if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string') out = r.stdout;
    else if (typeof r.content === 'string') out = r.content;
    else out = JSON.stringify(r);
  }
  const w = (name, v) => fs.writeFileSync(path.join(process.env.EXTRACT_DIR, name), v || '');
  w('tool_name', d.tool_name);
  w('output', out);
  w('command', (args.command || '').substring(0, 50));
  w('file_path', args.file_path);
  w('pattern', (args.pattern || '').substring(0, 50));
  w('url', (args.url || '').substring(0, 100));
} catch { process.exit(1); }
EXTRACT_SCRIPT

# The output file doubles as the indexer's input; the payload text never
# enters a bash variable.
TEMP_FILE="$EXTRACT_DIR/output"
[ -s "$TEMP_FILE" ] || exit 0
TOOL_NAME=$(cat "$EXTRACT_DIR/tool_name")
ARG_COMMAND=$(cat "$EXTRACT_DIR/command")
ARG_FILE_PATH=$(cat "$EXTRACT_DIR/file_path")
ARG_PATTERN=$(cat "$EXTRACT_DIR/pattern")
ARG_URL=$(cat "$EXTRACT_DIR/url")

# Check if knowledge-index.ts exists — skip indexing entirely if not
INDEX_SCRIPT="$PROJECT_ROOT/scripts/knowledge-index.ts"
[ ! -f "$INDEX_SCRIPT" ] && exit 0

# Get threshold from config via knowledge-index.ts
THRESHOLD=$(node "$INDEX_SCRIPT" config threshold_bytes 2>/dev/null || echo "5120")
[ -z "$THRESHOLD" ] && THRESHOLD=5120

# Measure output size in bytes
OUTPUT_SIZE=$(wc -c < "$TEMP_FILE" | tr -d '[:space:]')

# If under threshold, no action needed
if [ "$OUTPUT_SIZE" -le "$THRESHOLD" ]; then
    exit 0
fi

# Output exceeds threshold — index it
OBS_COUNT=0
OBS_FILE=""
cleanup() { rm -rf "$INPUT_FILE" "$EXTRACT_DIR" "${OBS_FILE:-}"; }
trap cleanup EXIT

# ── Extract structured observations ─────────────────────────────────────
# Call the observation parser to extract typed facts from the output.
# Falls back to raw indexing if parser fails (advisory — no errors surfaced).
PARSER_SCRIPT="$PROJECT_ROOT/scripts/observation-parser.ts"
if [ -f "$PARSER_SCRIPT" ]; then
    OBSERVATIONS=$(node "$PARSER_SCRIPT" "$TEMP_FILE" 2>/dev/null || true)
    if [ -n "$OBSERVATIONS" ]; then
        # Write observations to a temp file for potential downstream use
        OBS_FILE=$(mktemp)
        printf '%s' "$OBSERVATIONS" > "$OBS_FILE"
        # Count extracted observations for the hint message
        OBS_COUNT=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('$OBS_FILE','utf8'));console.log(d.observation_count||0)}catch{console.log(0)}" 2>/dev/null || echo "0")
    fi
fi

# Persist extracted observations to the observation_meta DB table
# This enables --obs-type filtering in knowledge-index.ts search
if [ -n "$OBS_FILE" ] && [ -f "$OBS_FILE" ]; then
    node "$INDEX_SCRIPT" index-observations "$TEMP_FILE" "$OBS_FILE" 2>/dev/null || true
fi

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
if node "$INDEX_SCRIPT" index "$TEMP_FILE" --confidence "$FRESHNESS_CONFIDENCE" >/dev/null 2>&1; then
    # Success: print hint to stderr (becomes additionalContext)
    KB_SIZE=$((OUTPUT_SIZE / 1024))
    # Escape intent for display (replace single quotes)
    SAFE_INTENT=$(printf '%s' "$INTENT" | tr "'" "_")
    echo "Large output indexed (${KB_SIZE} KB, ${OBS_COUNT:-0} observations extracted). Use: node scripts/knowledge-index.ts search '${SAFE_INTENT}' for filtered view." >&2
fi

exit 0
