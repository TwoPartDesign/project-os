#!/usr/bin/env bash
# Install Project OS global Claude commands to ~/.claude/commands/
# Run this once after cloning, or re-run to pick up updates.
# Usage: bash scripts/install-global-commands.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_COMMANDS_DIR="$SCRIPT_DIR/../.claude/commands"
GLOBAL_COMMANDS_DIR="$HOME/.claude/commands"

if [ ! -d "$REPO_COMMANDS_DIR" ]; then
  echo "ERROR: .claude/commands/ not found in repo (expected at $REPO_COMMANDS_DIR)" >&2
  exit 1
fi

echo "Installing Project OS global commands..."
echo "  Source : $REPO_COMMANDS_DIR"
echo "  Target : $GLOBAL_COMMANDS_DIR"
echo ""

mkdir -p "$GLOBAL_COMMANDS_DIR"

# Copy all command files, preserving subdirectory structure
find "$REPO_COMMANDS_DIR" -name "*.md" | while IFS= read -r src; do
  # Compute relative path from REPO_COMMANDS_DIR
  rel="${src#$REPO_COMMANDS_DIR/}"
  dest="$GLOBAL_COMMANDS_DIR/$rel"
  dest_dir="$(dirname "$dest")"

  mkdir -p "$dest_dir"

  if [ -f "$dest" ]; then
    echo "  [update] $rel"
  else
    echo "  [new]    $rel"
  fi

  cp "$src" "$dest"
done

echo ""
echo "Done. Commands available globally in any Claude session."
echo "Run /tools:new-project from any directory to bootstrap a new project."
