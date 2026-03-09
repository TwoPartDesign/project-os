#!/usr/bin/env bash
set -euo pipefail
# Search across all knowledge files
# Usage: ./scripts/memory-search.sh <query>

QUERY="${1:-}"
if [ -z "$QUERY" ]; then
  echo "Usage: memory-search.sh <query>"
  exit 1
fi

# Check if knowledge index exists
if [ -f ".claude/index/knowledge.db" ]; then
  # Use FTS5 index for ranked search
  node scripts/knowledge-index.ts search "$@"
else
  # Fall back to grep search
  echo "Note: Knowledge index not found. Run 'node scripts/knowledge-index.ts index-vault' for ranked search."
  echo ""
  echo "=== Knowledge Vault ==="
  grep -rn -i --color=auto -e "$QUERY" docs/knowledge/ 2>/dev/null || echo "No matches"
  echo ""
  echo "=== Session Handoffs ==="
  grep -rn -i --color=auto -e "$QUERY" .claude/sessions/ 2>/dev/null || echo "No matches"
  echo ""
  echo "=== Research Docs ==="
  grep -rn -i --color=auto -e "$QUERY" docs/research/ 2>/dev/null || echo "No matches"
  echo ""
  echo "=== Specs ==="
  grep -rn -i --color=auto -e "$QUERY" docs/specs/ 2>/dev/null || echo "No matches"
fi
