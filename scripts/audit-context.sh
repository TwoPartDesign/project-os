#!/bin/bash
# Estimate token cost of always-loaded context

echo "=== Context Token Estimates ==="
echo ""

estimate_tokens() {
  local file="$1"
  local label="$2"
  if [ -f "$file" ]; then
    chars=$(wc -c < "$file")
    tokens=$((chars / 4))
    printf "%-45s %6d tokens  (%d bytes)\n" "$label" "$tokens" "$chars"
  fi
}

estimate_tokens "CLAUDE.md" "Project constitution (CLAUDE.md)"
estimate_tokens "ROADMAP.md" "Roadmap"

echo ""
echo "--- Knowledge vault ---"
for f in .claude/knowledge/*.md; do
  [ -f "$f" ] && estimate_tokens "$f" "  $(basename $f)"
done

echo ""
echo "--- Active specs ---"
for d in .claude/specs/*/; do
  [ -d "$d" ] || continue
  echo "  $(basename $d)/"
  for f in "$d"*.md; do
    [ -f "$f" ] && estimate_tokens "$f" "    $(basename $f)"
  done
done

echo ""
TOTAL_CHARS=0
for f in CLAUDE.md .claude/knowledge/*.md; do
  [ -f "$f" ] && TOTAL_CHARS=$((TOTAL_CHARS + $(wc -c < "$f")))
done
TOTAL_TOKENS=$((TOTAL_CHARS / 4))
echo "=== TOTAL always-loaded: ~${TOTAL_TOKENS} tokens ==="
