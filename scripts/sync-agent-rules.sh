#!/usr/bin/env bash
# sync-agent-rules.sh — Ensure ## Agent Rules sections are current in rule files.
#
# Usage:
#   bash scripts/sync-agent-rules.sh        # check mode — outputs stale file paths
#   bash scripts/sync-agent-rules.sh check  # same
#
# Exit codes:
#   0 — all sections current (or no stale files)
#   1 — one or more files are stale (paths printed to stdout)
#
# How it works:
#   1. For each rule file, hash the content above ## Agent Rules
#   2. Compare against the stored <!-- source-hash: ... --> in the section
#   3. Print stale paths; the build orchestrator spawns distillation agents for them

set -euo pipefail

# Rule files that sub-agents need — omit api.md (endpoint-specific) and preferences.md (human-facing)
RULES=(
    ".claude/rules/bash.md"
    ".claude/rules/tests.md"
    ".claude/rules/escalation.md"
)

stale=()

for file in "${RULES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "WARNING: $file not found, skipping" >&2
        continue
    fi

    # Hash only the content above ## Agent Rules (or whole file if section absent)
    if grep -q "^## Agent Rules" "$file"; then
        source_content=$(sed '/^## Agent Rules/,$d' "$file")
    else
        source_content=$(cat "$file")
    fi

    current_hash=$(printf '%s' "$source_content" | sha256sum | cut -d' ' -f1)

    # Extract stored hash from the section (if present)
    stored_hash=$(grep -o "<!-- source-hash: [a-f0-9]* -->" "$file" | grep -o "[a-f0-9]\{64\}" | head -1 || true)

    if [ -z "$stored_hash" ] || [ "$stored_hash" != "$current_hash" ]; then
        stale+=("$file")
    fi
done

if [ ${#stale[@]} -eq 0 ]; then
    echo "agent-rules: all sections current" >&2
    exit 0
fi

# Print stale paths to stdout for the orchestrator
for f in "${stale[@]}"; do
    echo "$f"
done
exit 1
