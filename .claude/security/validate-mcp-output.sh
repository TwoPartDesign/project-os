#!/bin/bash
# Validate MCP server output before it enters the context window
# Usage: validate-mcp-output.sh <mcp-name> <output-file>
# Exit code contract (PostToolUse hook chain):
#   exit 0 — output validated clean.
#   exit 2 — flagged/blocked content; stderr is fed back to Claude as feedback.
#   exit 1 — operational error (bad arguments, unreadable file), shown to the
#            user only. Not used for flagged content.
# The caller's output file is never modified by this script.

set -euo pipefail

MCP_NAME="$1"
OUTPUT_FILE="$2"

# Get project root and validate OUTPUT_FILE path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Allowlist lives relative to the project root, not the caller's cwd
ALLOWLIST="$PROJECT_ROOT/.claude/security/mcp-allowlist.json"

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
  echo "BLOCKED: $MCP_NAME is not in the approved MCP allowlist" >&2
  exit 2
fi

# Oversize content: scan a truncated *copy* — never modify the caller's file
MAX_SIZE=50000
FILE_SIZE=$(wc -c < "$RESOLVED_FILE")
SCAN_FILE="$RESOLVED_FILE"
SCAN_COPY=""
if [ "$FILE_SIZE" -gt "$MAX_SIZE" ]; then
  echo "WARNING: MCP output exceeds $MAX_SIZE bytes ($FILE_SIZE). Scanning first $MAX_SIZE bytes only." >&2
  SCAN_COPY="${RESOLVED_FILE}.scan-truncated.$$"
  trap 'rm -f "$SCAN_COPY"' EXIT
  head -c "$MAX_SIZE" "$RESOLVED_FILE" > "$SCAN_COPY"
  SCAN_FILE="$SCAN_COPY"
fi

SUSPICIOUS_PATTERNS=("eval(" "exec(" "import os" "subprocess" "process.env" "__proto__" "constructor[" "<script>" "javascript:")

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  if grep -qiF "$pattern" "$SCAN_FILE"; then
    echo "BLOCKED: Suspicious pattern '$pattern' found in MCP output from $MCP_NAME" >&2
    exit 2
  fi
done

echo "PASS: $MCP_NAME output validated ($FILE_SIZE bytes)"
exit 0
