#!/bin/bash
set -euo pipefail

# Archive stale session handoff files
# Moves all handoff files older than 2026-03-01 into .claude/sessions/archive/

SESSIONS_DIR=".claude/sessions"
ARCHIVE_DIR=".claude/sessions/archive"

# Create archive directory
mkdir -p "$ARCHIVE_DIR"

# Move files with dates before 2026-03-01
for file in "$SESSIONS_DIR"/handoff-2026-02-*.yaml; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "Moving $filename to archive/"
    mv "$file" "$ARCHIVE_DIR/$filename"
  fi
done

echo "Session archival complete. All February 2026 handoffs moved to $ARCHIVE_DIR"
