#!/usr/bin/env bash
# dream-accept.sh — Promote a staged /tools:dream proposal into docs/memory/.
#
# Backs up the current docs/memory/*.md into docs/memory/.archive/<timestamp>/,
# copies the staged docs/memory/.dream-output/<timestamp>/memory/*.md files into
# docs/memory/, rebuilds the knowledge index (best-effort), and removes the
# staging directory. Recovers automatically from an interrupted prior run
# before doing anything else.
#
# Usage: bash scripts/dream-accept.sh <timestamp>
#   <timestamp>  Must match YYYY-MM-DD-HHMM (e.g. 2026-07-16-1530).
#
# Env:
#   PROJECT_OS_ROOT  Override project root resolution (used by tests to point
#                     at an isolated fixture directory instead of walking up
#                     from this script's real location).
set -euo pipefail
shopt -s nullglob

# --- Resolve PROJECT_ROOT ---------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${PROJECT_OS_ROOT:-}" ]; then
  PROJECT_ROOT="$PROJECT_OS_ROOT"
else
  DIR="$SCRIPT_DIR"
  PROJECT_ROOT=""
  while [ "$DIR" != "/" ] && [ -n "$DIR" ]; do
    if [ -d "$DIR/.claude" ]; then
      PROJECT_ROOT="$DIR"
      break
    fi
    DIR="$(dirname "$DIR")"
  done
  if [ -z "$PROJECT_ROOT" ]; then
    echo "error: could not locate project root (no .claude directory found above $SCRIPT_DIR)" >&2
    exit 1
  fi
fi

MEMORY_DIR="$PROJECT_ROOT/docs/memory"
DREAM_OUTPUT_DIR="$MEMORY_DIR/.dream-output"
ARCHIVE_DIR="$MEMORY_DIR/.archive"

# --- Recovery first: restore any interrupted prior swap ---------------------
for marker in "$DREAM_OUTPUT_DIR"/*/.swap-in-progress; do
  [ -e "$marker" ] || continue
  stage_dir="$(dirname "$marker")"
  ts="$(basename "$stage_dir")"
  backup_dir="$ARCHIVE_DIR/$ts"

  if [ -d "$backup_dir" ]; then
    for f in "$backup_dir"/*.md; do
      [ -e "$f" ] || continue
      cp "$f" "$MEMORY_DIR/"
    done
  fi

  rm -f "$marker"
  echo "recovered interrupted swap from $ts"
  exit 1
done

# --- Validate arguments -------------------------------------------------
TIMESTAMP="${1:-}"

if [ -z "$TIMESTAMP" ]; then
  echo "error: missing timestamp argument" >&2
  echo "usage: dream-accept.sh <timestamp>" >&2
  exit 1
fi

if ! [[ "$TIMESTAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}$ ]]; then
  echo "error: invalid timestamp format" >&2
  exit 1
fi

STAGE_DIR="$DREAM_OUTPUT_DIR/$TIMESTAMP"
STAGE_MEMORY_DIR="$STAGE_DIR/memory"

if [ ! -d "$STAGE_MEMORY_DIR" ]; then
  echo "error: staging directory not found: $STAGE_MEMORY_DIR" >&2
  exit 1
fi

# --- Swap: mark in-progress, back up, apply ---------------------------------
MARKER="$STAGE_DIR/.swap-in-progress"
touch "$MARKER"

BACKUP_DIR="$ARCHIVE_DIR/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

for f in "$MEMORY_DIR"/*.md; do
  [ -e "$f" ] || continue
  cp "$f" "$BACKUP_DIR/"
done

STAGED_COUNT=0
for f in "$STAGE_MEMORY_DIR"/*.md; do
  [ -e "$f" ] || continue
  cp "$f" "$MEMORY_DIR/"
  STAGED_COUNT=$((STAGED_COUNT + 1))
done

# --- Rebuild the knowledge index (best-effort) ------------------------------
if [ -f "$PROJECT_ROOT/scripts/knowledge-index.ts" ]; then
  if ! node "$PROJECT_ROOT/scripts/knowledge-index.ts" rebuild; then
    echo "warning: knowledge-index rebuild failed; run 'node scripts/knowledge-index.ts rebuild' manually"
  fi
else
  echo "warning: scripts/knowledge-index.ts not found under $PROJECT_ROOT; skipping index rebuild"
fi

# --- Finish: clear marker, remove staging dir -------------------------------
rm -f "$MARKER"
rm -rf "$STAGE_DIR"

echo "dream-accept: applied $STAGED_COUNT file(s) from $TIMESTAMP"
echo "  backup: $BACKUP_DIR"
echo "  staging dir removed: $STAGE_DIR"
