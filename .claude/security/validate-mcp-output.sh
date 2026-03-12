#!/bin/bash
# Validate MCP server output before it enters the context window
# Usage: validate-mcp-output.sh <mcp-name> <output-file>

set -euo pipefail

MCP_NAME="$1"
OUTPUT_FILE="$2"
ALLOWLIST=".claude/security/mcp-allowlist.json"

# Get project root and validate OUTPUT_FILE path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Canonicalize and validate OUTPUT_FILE path (prevent path traversal, symlink escape)
if [ -z "$OUTPUT_FILE" ] || [ ! -f "$OUTPUT_FILE" ]; then
  echo "ERROR: OUTPUT_FILE does not exist: $OUTPUT_FILE"
  exit 1
fi

# Reject if OUTPUT_FILE is a symlink (symlink escape guard)
if [ -L "$OUTPUT_FILE" ]; then
  echo "ERROR: OUTPUT_FILE must not be a symlink: $OUTPUT_FILE"
  exit 1
fi

# Canonicalize path and verify it's inside project root
RESOLVED_FILE="$(realpath "$OUTPUT_FILE" 2>/dev/null)" || {
  echo "ERROR: cannot canonicalize OUTPUT_FILE: $OUTPUT_FILE"
  exit 1
}

if [[ "$RESOLVED_FILE" != "$PROJECT_ROOT"/* ]]; then
  echo "ERROR: OUTPUT_FILE must be inside project root: $RESOLVED_FILE"
  exit 1
fi

if ! jq -e --arg name "$MCP_NAME" '.approved_mcps[$name]' "$ALLOWLIST" > /dev/null 2>&1; then
  echo "BLOCKED: $MCP_NAME is not in the approved MCP allowlist"
  exit 1
fi

MAX_SIZE=50000
FILE_SIZE=$(wc -c < "$RESOLVED_FILE")
if [ "$FILE_SIZE" -gt "$MAX_SIZE" ]; then
  echo "WARNING: MCP output exceeds $MAX_SIZE bytes ($FILE_SIZE). Truncating."
  TRUNCATED_FILE="${RESOLVED_FILE}.truncated"
  head -c "$MAX_SIZE" "$RESOLVED_FILE" > "$TRUNCATED_FILE"
  mv "$TRUNCATED_FILE" "$RESOLVED_FILE"
fi

SUSPICIOUS_PATTERNS=("eval(" "exec(" "import os" "subprocess" "process.env" "__proto__" "constructor[" "<script>" "javascript:")

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  if grep -qi "$pattern" "$RESOLVED_FILE"; then
    echo "BLOCKED: Suspicious pattern '$pattern' found in MCP output from $MCP_NAME"
    exit 1
  fi
done

echo "PASS: $MCP_NAME output validated ($FILE_SIZE bytes)"
exit 0
