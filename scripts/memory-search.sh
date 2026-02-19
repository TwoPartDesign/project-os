#!/bin/bash
# Search across all knowledge files
# Usage: ./scripts/memory-search.sh <query>

QUERY="$1"
if [ -z "$QUERY" ]; then
  echo "Usage: memory-search.sh <query>"
  exit 1
fi

echo "=== Knowledge Vault ==="
grep -rn -i --color=always "$QUERY" .claude/knowledge/ 2>/dev/null || echo "No matches"
echo ""
echo "=== Session Handoffs ==="
grep -rn -i --color=always "$QUERY" .claude/sessions/ 2>/dev/null || echo "No matches"
echo ""
echo "=== Research Docs ==="
grep -rn -i --color=always "$QUERY" docs/research/ 2>/dev/null || echo "No matches"
echo ""
echo "=== Specs ==="
grep -rn -i --color=always "$QUERY" .claude/specs/ 2>/dev/null || echo "No matches"
