#!/bin/bash
# Validate MCP server output before it enters the context window
# Usage: validate-mcp-output.sh <mcp-name> <output-file>

MCP_NAME="$1"
OUTPUT_FILE="$2"
ALLOWLIST=".claude/security/mcp-allowlist.json"

if ! jq -e ".approved_mcps[\"$MCP_NAME\"]" "$ALLOWLIST" > /dev/null 2>&1; then
  echo "BLOCKED: $MCP_NAME is not in the approved MCP allowlist"
  exit 1
fi

MAX_SIZE=50000
FILE_SIZE=$(wc -c < "$OUTPUT_FILE")
if [ "$FILE_SIZE" -gt "$MAX_SIZE" ]; then
  echo "WARNING: MCP output exceeds $MAX_SIZE bytes ($FILE_SIZE). Truncating."
  head -c "$MAX_SIZE" "$OUTPUT_FILE" > "${OUTPUT_FILE}.truncated"
  mv "${OUTPUT_FILE}.truncated" "$OUTPUT_FILE"
fi

SUSPICIOUS_PATTERNS=("eval(" "exec(" "import os" "subprocess" "process.env" "__proto__" "constructor[" "<script>" "javascript:")

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  if grep -qi "$pattern" "$OUTPUT_FILE"; then
    echo "BLOCKED: Suspicious pattern '$pattern' found in MCP output from $MCP_NAME"
    exit 1
  fi
done

echo "PASS: $MCP_NAME output validated ($FILE_SIZE bytes)"
exit 0
