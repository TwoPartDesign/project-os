#!/usr/bin/env bash
# dream-accept.sh — Swap a staged /tools:dream proposal into docs/memory/.
#
# Backs up the current docs/memory/*.md into docs/memory/.archive/<timestamp>/,
# copies the staged docs/memory/.dream-output/<timestamp>/memory/*.md files into
# docs/memory/, removes the consumed source files listed in the staging
# manifest.yaml's memory_files list (a true swap, not merely additive),
# rebuilds the knowledge index (best-effort), and removes the staging
# directory. Recovers automatically from an interrupted prior run before
# doing anything else.
#
# If manifest.yaml is missing or its memory_files list can't be parsed, the
# swap degrades to the old additive-only behavior: staged files are still
# applied, but no source files are removed (a warning is printed instead).
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
# A crash between the backup, staged-copy, and manifest-driven source-removal
# steps below leaves the marker present. Recovery here re-copies every *.md
# from the backup dir back into docs/memory/ verbatim, which both re-adds any
# consumed source that had already been removed and overwrites any staged
# file that had already been applied — i.e. a full rollback to pre-swap
# state, regardless of exactly which step was interrupted.
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

# --- Remove consumed source files per manifest.yaml (true swap) -------------
# manifest.yaml (written by /tools:dream, see .claude/commands/tools/dream.md
# Step 4 — "inputs used (memory file list, session file list with count)")
# is expected to carry the consumed memory files as a block-style YAML list:
#
#   memory_files:
#     - docs/memory/a.md
#     - docs/memory/b.md
#
# A flow-style `memory_files: [a.md, b.md]` list is also accepted. Bare
# filenames or docs/memory/-prefixed paths, quoted or not, both work — only
# the basename is used (docs/memory/ is a flat directory).
#
# If manifest.yaml is missing, has no memory_files key, or the key can't be
# parsed, this degrades to the old additive-only behavior: print a warning
# and remove nothing. A file is only ever removed if it (a) is listed as a
# consumed source, (b) currently exists in docs/memory/, and (c) is
# byte-identical to its backup copy in $BACKUP_DIR. Condition (c) also
# protects a source file whose name collides with a freshly staged output
# file: its content will have changed, so the cmp fails and it's left alone.
MANIFEST="$STAGE_DIR/manifest.yaml"
MANIFEST_PARSE_OK=0
CONSUMED_SOURCES=()

_trim_dequote() {
  local s="$1"
  s="${s%%#*}"                    # strip inline comment
  s="${s%$'\r'}"                  # strip trailing CR (CRLF manifest)
  s="${s#"${s%%[![:space:]]*}"}"  # ltrim
  s="${s%"${s##*[![:space:]]}"}"  # rtrim
  s="${s%\"}"; s="${s#\"}"        # strip double quotes
  s="${s%\'}"; s="${s#\'}"        # strip single quotes
  printf '%s' "$s"
}

if [ -f "$MANIFEST" ]; then
  in_block=0
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    raw_line="${raw_line%$'\r'}"

    if [[ "$raw_line" =~ ^memory_files:[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      # flow style: memory_files: [a.md, b.md]
      MANIFEST_PARSE_OK=1
      in_block=0
      IFS=',' read -ra _inline_items <<< "${BASH_REMATCH[1]}"
      for raw_item in "${_inline_items[@]}"; do
        item="$(_trim_dequote "$raw_item")"
        base="${item##*/}"
        [ -n "$base" ] && CONSUMED_SOURCES+=("$base")
      done
      continue
    fi

    if [[ "$raw_line" =~ ^[A-Za-z_][A-Za-z0-9_]*: ]]; then
      if [[ "$raw_line" =~ ^memory_files:[[:space:]]*$ ]]; then
        in_block=1
        MANIFEST_PARSE_OK=1
      else
        in_block=0
      fi
      continue
    fi

    if [ "$in_block" -eq 1 ] && [[ "$raw_line" =~ ^[[:space:]]*-[[:space:]]*(.+)$ ]]; then
      item="$(_trim_dequote "${BASH_REMATCH[1]}")"
      base="${item##*/}"
      [ -n "$base" ] && CONSUMED_SOURCES+=("$base")
    elif [ -n "$raw_line" ] && [[ ! "$raw_line" =~ ^[[:space:]]*$ ]]; then
      in_block=0
    fi
  done < "$MANIFEST"
fi

REMOVED_COUNT=0
if [ "$MANIFEST_PARSE_OK" -eq 1 ] && [ "${#CONSUMED_SOURCES[@]}" -gt 0 ]; then
  for src in "${CONSUMED_SOURCES[@]}"; do
    current="$MEMORY_DIR/$src"
    backup="$BACKUP_DIR/$src"
    if [ -f "$current" ] && [ -f "$backup" ] && cmp -s "$current" "$backup"; then
      rm -f "$current"
      REMOVED_COUNT=$((REMOVED_COUNT + 1))
    fi
  done
else
  echo "warning: manifest.yaml missing or unparseable — additive apply only; sources not removed; clean up manually" >&2
fi

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
if [ "$MANIFEST_PARSE_OK" -eq 1 ]; then
  echo "  removed $REMOVED_COUNT consumed source file(s) per manifest.yaml"
fi
echo "  staging dir removed: $STAGE_DIR"
