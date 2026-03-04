#!/usr/bin/env bash
# Install the /tools:new-project command globally so it's available in any Claude session.
# All other commands are project-local and don't need global installation.
# Usage: bash scripts/install-global-commands.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../.claude/commands/tools/new-project.md"
DEST_DIR="$HOME/.claude/commands/tools"
DEST="$DEST_DIR/new-project.md"

if [ ! -f "$SRC" ]; then
  echo "ERROR: source not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

if [ -f "$DEST" ]; then
  echo "  [update] tools/new-project.md"
else
  echo "  [new]    tools/new-project.md"
fi

cp "$SRC" "$DEST"

echo ""
echo "Done. /tools:new-project is now available in any Claude session."
