#!/usr/bin/env bash
# Estimate token cost of always-loaded context.

set -euo pipefail

echo "=== Context Token Estimates ==="
echo ""

estimate_tokens() {
  local file="$1"
  local label="$2"
  local chars tokens

  if [[ -f "$file" ]]; then
    chars=$(wc -c < "$file")
    tokens=$((chars / 4))
    printf "%-45s %6d tokens  (%d bytes)\n" "$label" "$tokens" "$chars"
  fi
}

estimate_tokens "CLAUDE.md" "Project constitution (CLAUDE.md)"
estimate_tokens "ROADMAP.md" "Roadmap"


echo ""
echo "--- Active specs ---"
for d in docs/specs/*/; do
  [[ -d "$d" ]] || continue
  echo "  $(basename "$d")/"
  for f in "${d}"*.md; do
    [[ -f "$f" ]] && estimate_tokens "$f" "    $(basename "$f")"
  done
done

echo ""
TOTAL_CHARS=0
# Always-loaded = CLAUDE.md plus unscoped rules (no `paths:` frontmatter key).
# docs/knowledge/ files load on demand and are not counted.
for f in CLAUDE.md .claude/rules/*.md; do
  [[ -f "$f" ]] || continue
  if [[ "$f" == .claude/rules/* ]] && head -n 20 "$f" | awk '{sub(/\r$/,"")} NR==1 && $0!="---"{exit 1} NR>1 && $0=="---"{exit 1} /^paths[[:space:]]*:/{found=1; exit 0} END{exit !found}'; then
    continue
  fi
  TOTAL_CHARS=$((TOTAL_CHARS + $(wc -c < "$f")))
done
TOTAL_TOKENS=$((TOTAL_CHARS / 4))
echo "=== TOTAL always-loaded: ~${TOTAL_TOKENS} tokens ==="
