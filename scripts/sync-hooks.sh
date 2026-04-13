#!/usr/bin/env bash
# sync-hooks.sh — Sync hooks from Project OS template to a target project.
#
# Usage:
#   bash scripts/sync-hooks.sh                          # Sync to current project
#   bash scripts/sync-hooks.sh /path/to/other/project   # Sync to another project
#
# What it does:
#   1. Copies all hooks from the template .claude/hooks/ to the target
#   2. New hooks (missing locally) are added directly
#   3. Modified hooks (local differs from upstream) are saved as .upstream for review
#   4. Unchanged hooks are skipped
#   5. Syncs hook wiring in settings.json if the target has stale definitions
#   6. Sets executable permissions on all hook scripts
#
# No gh CLI required — works from the local template repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_ROOT="${1:-$TEMPLATE_ROOT}"

# Resolve to absolute path
TARGET_ROOT="$(cd "$TARGET_ROOT" && pwd)"

TEMPLATE_HOOKS="$TEMPLATE_ROOT/.claude/hooks"
TARGET_HOOKS="$TARGET_ROOT/.claude/hooks"

if [ ! -d "$TEMPLATE_HOOKS" ]; then
    echo "ERROR: Template hooks not found at $TEMPLATE_HOOKS" >&2
    exit 1
fi

# Create target hooks dir if missing
mkdir -p "$TARGET_HOOKS"

echo "Syncing hooks: $TEMPLATE_HOOKS → $TARGET_HOOKS"
echo ""

added=0
updated=0
conflicts=0
unchanged=0

while IFS= read -r src_file; do
    filename="$(basename "$src_file")"
    dst_file="$TARGET_HOOKS/$filename"

    if [ ! -f "$dst_file" ]; then
        # New hook — add it
        cp "$src_file" "$dst_file"
        echo "  + Added: $filename"
        added=$((added + 1))
    elif cmp -s "$src_file" "$dst_file"; then
        # Identical — skip
        unchanged=$((unchanged + 1))
    else
        # Different — save upstream version for review
        cp "$src_file" "${dst_file}.upstream"
        echo "  ! Conflict: $filename (saved ${filename}.upstream)"
        conflicts=$((conflicts + 1))
    fi
done < <(find "$TEMPLATE_HOOKS" -maxdepth 1 -type f -name "*.sh" | sort)

# Set executable permissions
find "$TARGET_HOOKS" -name "*.sh" -exec chmod +x {} + 2>/dev/null || true

echo ""

# --- Sync settings.json hook wiring ---

TEMPLATE_SETTINGS="$TEMPLATE_ROOT/.claude/settings.json"
TARGET_SETTINGS="$TARGET_ROOT/.claude/settings.json"

if [ -f "$TEMPLATE_SETTINGS" ] && [ -f "$TARGET_SETTINGS" ]; then
    # Check if target settings has a "hooks" key
    if grep -q '"hooks"' "$TARGET_SETTINGS"; then
        # Compare just the hooks section — if different, offer upstream
        if ! cmp -s "$TEMPLATE_SETTINGS" "$TARGET_SETTINGS"; then
            # Check if hooks section specifically differs
            # Extract hooks blocks for comparison (simple approach: hash the hooks lines)
            template_hooks_hash=$(grep -A 1000 '"hooks"' "$TEMPLATE_SETTINGS" | sha256sum | cut -d' ' -f1)
            target_hooks_hash=$(grep -A 1000 '"hooks"' "$TARGET_SETTINGS" | sha256sum | cut -d' ' -f1)

            if [ "$template_hooks_hash" != "$target_hooks_hash" ]; then
                cp "$TEMPLATE_SETTINGS" "${TARGET_SETTINGS}.upstream"
                echo "  ! settings.json hook definitions differ — saved settings.json.upstream for review"
                echo "    Compare the 'hooks' section and merge any new hook wiring."
                conflicts=$((conflicts + 1))
            fi
        fi
    else
        # Target has no hooks section at all — save upstream for reference
        cp "$TEMPLATE_SETTINGS" "${TARGET_SETTINGS}.upstream"
        echo "  ! settings.json has no hooks section — saved settings.json.upstream"
        echo "    Copy the 'hooks' block from the upstream version."
        conflicts=$((conflicts + 1))
    fi
fi

# --- Summary ---

echo ""
echo "=== Sync Complete ==="
echo "  Added:     $added"
echo "  Unchanged: $unchanged"
echo "  Conflicts: $conflicts"

if [ "$conflicts" -gt 0 ]; then
    echo ""
    echo "Review .upstream files, merge what you need, then delete them."
fi

if [ "$added" -gt 0 ]; then
    echo ""
    echo "New hooks are ready to use. No further action needed."
fi
