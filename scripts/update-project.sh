#!/usr/bin/env bash
# update-project.sh — Check for and apply Project OS updates from upstream.
#
# Usage:
#   bash scripts/update-project.sh                    # Check for updates (dry run)
#   bash scripts/update-project.sh --apply            # Apply compatible updates
#   bash scripts/update-project.sh --apply --major    # Allow major version upgrades
#   bash scripts/update-project.sh --target v2.3      # Target a specific version
#   bash scripts/update-project.sh --diff-upstream    # Show unadopted upstream commits (no network)
#   bash scripts/update-project.sh --local-upstream DIR  # Update from a local dir (no gh, no network)
#
# Requires: gh CLI (authenticated), sha256sum
# --diff-upstream requires neither — it reads a local upstream cache (see --help)
# --local-upstream requires neither — it substitutes DIR for the release tarball (see --help)
# Run from project root.

set -euo pipefail

# Associative arrays require Bash 4+
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "ERROR: Bash 4+ required (found ${BASH_VERSION}). On macOS, install via: brew install bash" >&2
    exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$PROJECT_ROOT/.claude/manifest.json"
UPSTREAM="TwoPartDesign/project-os"

# Parse arguments
APPLY=false
ALLOW_MAJOR=false
TARGET_VERSION=""
DIFF_UPSTREAM=false
LOCAL_UPSTREAM=""

while [ $# -gt 0 ]; do
    case "$1" in
        --apply) APPLY=true ;;
        --major) ALLOW_MAJOR=true ;;
        --diff-upstream) DIFF_UPSTREAM=true ;;
        --target)
            if [ $# -lt 2 ]; then echo "ERROR: --target requires a version argument" >&2; exit 1; fi
            TARGET_VERSION="$2"; shift ;;
        --local-upstream)
            if [ $# -lt 2 ]; then echo "ERROR: --local-upstream requires a directory argument" >&2; exit 1; fi
            LOCAL_UPSTREAM="$2"; shift ;;
        --help|-h)
            echo "Usage: update-project.sh [--apply] [--major] [--target VERSION] [--diff-upstream] [--local-upstream DIR]"
            echo ""
            echo "Flags:"
            echo "  --apply           Apply updates (default is dry-run/check only)"
            echo "  --major           Allow major version upgrades (default: same major only)"
            echo "  --target          Target a specific version (e.g., v2.3)"
            echo "  --diff-upstream   Show upstream commits not yet adopted, grouped by area."
            echo "                    Reads a local upstream cache only — no network, no gh required."
            echo "  --local-upstream  Use DIR as the upstream source instead of a downloaded release."
            echo "                    Skips release listing/selection (Steps 2-4) entirely — zero gh"
            echo "                    calls, fully network-free. Classification and apply run unchanged."
            echo ""
            echo "Without --apply, shows what would change."
            exit 0
            ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# --- Version parsing helpers ---

parse_semver() {
    # Input: "v2.3" or "2.3" or "v2.3.1" → outputs "major minor patch"
    local ver="${1#v}"
    local major minor patch
    IFS='.' read -r major minor patch <<< "$ver"
    echo "${major:-0} ${minor:-0} ${patch:-0}"
}

version_gt() {
    # Returns 0 if $1 > $2
    local a_maj a_min a_pat b_maj b_min b_pat
    read -r a_maj a_min a_pat <<< "$(parse_semver "$1")"
    read -r b_maj b_min b_pat <<< "$(parse_semver "$2")"
    if [ "$a_maj" -gt "$b_maj" ]; then return 0; fi
    if [ "$a_maj" -eq "$b_maj" ] && [ "$a_min" -gt "$b_min" ]; then return 0; fi
    if [ "$a_maj" -eq "$b_maj" ] && [ "$a_min" -eq "$b_min" ] && [ "$a_pat" -gt "$b_pat" ]; then return 0; fi
    return 1
}

same_major() {
    local a_maj b_maj
    read -r a_maj _ _ <<< "$(parse_semver "$1")"
    read -r b_maj _ _ <<< "$(parse_semver "$2")"
    [ "$a_maj" = "$b_maj" ]
}

# --- Step 1: Read current manifest ---

if [ ! -f "$MANIFEST" ]; then
    echo "WARNING: No manifest found at $MANIFEST"
    echo "This project was bootstrapped before the update system existed."
    echo "Running in legacy mode — existing files shown as conflicts, missing files as new."
    echo ""
    CURRENT_VERSION="unknown"
    LEGACY_MODE=true
else
    CURRENT_VERSION=$(grep '"project_os_version"' "$MANIFEST" | sed 's/.*: *"\([^"]*\)".*/\1/')
    LEGACY_MODE=false
fi

echo "Current version: $CURRENT_VERSION"

# --- Diff-upstream mode: what's changed upstream that we haven't adopted ---
# No network mid-run — reads a local clone of the upstream repo (the "upstream
# cache") if one is present. Degrades gracefully (prints instructions, exit 0)
# if git or the cache is missing.

if [ "$DIFF_UPSTREAM" = true ]; then
    if ! command -v git &>/dev/null; then
        echo ""
        echo "No git found — cannot diff against upstream. Skipping --diff-upstream."
        exit 0
    fi

    UPSTREAM_CACHE="${PROJECT_OS_UPSTREAM_CACHE:-$HOME/.project-os-upstream-cache}"

    if [ ! -d "$UPSTREAM_CACHE/.git" ]; then
        echo ""
        echo "No upstream cache found at $UPSTREAM_CACHE."
        echo "--diff-upstream never fetches over the network mid-run — populate the cache once:"
        echo "  git clone https://github.com/$UPSTREAM.git \"$UPSTREAM_CACHE\""
        echo "Refresh it later with: git -C \"$UPSTREAM_CACHE\" pull"
        echo "Then re-run: bash scripts/update-project.sh --diff-upstream"
        exit 0
    fi

    echo ""
    echo "Diffing upstream ($UPSTREAM_CACHE) against local version: $CURRENT_VERSION"
    echo ""

    RANGE=""
    if [ "$CURRENT_VERSION" != "unknown" ]; then
        for candidate in "v$CURRENT_VERSION" "$CURRENT_VERSION"; do
            if git -C "$UPSTREAM_CACHE" rev-parse -q --verify "$candidate" >/dev/null 2>&1; then
                RANGE="$candidate..HEAD"
                break
            fi
        done
    fi

    if [ -z "$RANGE" ]; then
        echo "NOTE: local version tag not found in upstream cache — showing last 90 days instead."
        LOG=$(git -C "$UPSTREAM_CACHE" log --oneline --no-merges --since="90 days ago" -- .claude/ scripts/ 2>/dev/null || true)
    else
        LOG=$(git -C "$UPSTREAM_CACHE" log --oneline --no-merges "$RANGE" -- .claude/ scripts/ 2>/dev/null || true)
    fi

    if [ -z "$LOG" ]; then
        echo "No upstream changes found under .claude/ or scripts/ in range. Nothing to adopt."
        exit 0
    fi

    # Group commits by area (command / skill / hook / agent / rule / script)
    declare -A AREA_COMMITS
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        hash="${line%% *}"
        files=$(git -C "$UPSTREAM_CACHE" show --name-only --pretty=format: "$hash" -- .claude/ scripts/ 2>/dev/null || true)
        areas=""
        echo "$files" | grep -q '^\.claude/commands/' && areas="$areas command"
        echo "$files" | grep -q '^\.claude/skills/' && areas="$areas skill"
        echo "$files" | grep -q '^\.claude/hooks/' && areas="$areas hook"
        echo "$files" | grep -q '^\.claude/agents/' && areas="$areas agent"
        echo "$files" | grep -q '^\.claude/rules/' && areas="$areas rule"
        echo "$files" | grep -qE '^scripts/' && areas="$areas script"
        areas="${areas# }"
        [ -z "$areas" ] && areas="other"
        for area in $areas; do
            if [ -z "${AREA_COMMITS[$area]:-}" ]; then
                AREA_COMMITS["$area"]="  $line"
            else
                AREA_COMMITS["$area"]="${AREA_COMMITS[$area]}"$'\n'"  $line"
            fi
        done
    done <<< "$LOG"

    for area in command skill hook agent rule script other; do
        if [ -n "${AREA_COMMITS[$area]:-}" ]; then
            count=$(echo "${AREA_COMMITS[$area]}" | grep -c '^  ' || true)
            echo "$area ($count):"
            echo "${AREA_COMMITS[$area]}"
            echo ""
        fi
    done

    echo "Review these against your local .claude/ and scripts/. Adopt manually, or via --target + --apply once you know what you want."
    exit 0
fi

if [ -n "$LOCAL_UPSTREAM" ]; then
    # --- --local-upstream short-circuit ---
    # Substitutes a local directory for the release tarball. Runs BEFORE the
    # gh-CLI presence check below and skips Steps 2-4 entirely (release list,
    # version selection, same-major gate, archive download/extract) — zero
    # gh invocations, fully network-free. Classification (Step 6) and the
    # apply flow run unchanged against this directory.
    if [ ! -d "$LOCAL_UPSTREAM" ]; then
        echo "ERROR: --local-upstream directory not found: $LOCAL_UPSTREAM" >&2
        exit 1
    fi
    if ! command -v sha256sum &>/dev/null; then
        echo "ERROR: sha256sum not found. Install coreutils (macOS: brew install coreutils)." >&2
        exit 1
    fi
    # Canonicalize to absolute (mirrors PROJECT_ROOT above) so relpath math
    # downstream (Steps 5-8) behaves the same regardless of invocation cwd.
    UPSTREAM_ROOT="$(cd "$LOCAL_UPSTREAM" && pwd)"
    CHOSEN="local:$(basename "$UPSTREAM_ROOT")"  # display-only past this point
    echo ""
    echo "Using local upstream: $UPSTREAM_ROOT"
    echo "Target version: $CHOSEN"
else
    # --- Step 2: Fetch available releases ---

    echo "Checking upstream releases..."

    if ! command -v gh &>/dev/null; then
        echo "ERROR: gh CLI not found. Install it: https://cli.github.com/" >&2
        exit 1
    fi

    if ! command -v sha256sum &>/dev/null; then
        echo "ERROR: sha256sum not found. Install coreutils (macOS: brew install coreutils)." >&2
        exit 1
    fi

    RELEASES=$(gh release list --repo "$UPSTREAM" --limit 20 --json tagName,isPrerelease --jq '.[] | select(.isPrerelease == false) | .tagName' 2>/dev/null || true)

    if [ -z "$RELEASES" ]; then
        echo "ERROR: Could not fetch releases from $UPSTREAM." >&2
        echo "Check: gh auth status" >&2
        exit 1
    fi

    echo "Available releases:"
    echo "$RELEASES" | while read -r tag; do
        if [ "$tag" = "$CURRENT_VERSION" ] || [ "$tag" = "v$CURRENT_VERSION" ]; then
            echo "  $tag (current)"
        else
            echo "  $tag"
        fi
    done

    # --- Step 3: Determine target version ---

    if [ -n "$TARGET_VERSION" ]; then
        # User specified a target
        CHOSEN="$TARGET_VERSION"
        # Validate it exists
        if ! echo "$RELEASES" | grep -Fqx "$CHOSEN"; then
            # Try with v prefix
            if echo "$RELEASES" | grep -Fqx "v$CHOSEN"; then
                CHOSEN="v$CHOSEN"
            else
                echo "ERROR: Version $TARGET_VERSION not found in releases." >&2
                exit 1
            fi
        fi
    else
        # Sort releases by semver descending, then find best compatible version
        SORTED_RELEASES=$(echo "$RELEASES" | while read -r t; do
            read -r maj min pat <<< "$(parse_semver "$t")"
            printf '%03d%03d%03d %s\n' "$maj" "$min" "$pat" "$t"
        done | sort -rn | awk '{print $2}')

        CHOSEN=""
        while read -r tag; do
            if [ "$CURRENT_VERSION" = "unknown" ]; then
                # Legacy mode: pick the latest release (but respect --major guard)
                if [ "$ALLOW_MAJOR" = false ]; then
                    echo "WARNING: Legacy mode (no manifest) — cannot determine current major version." >&2
                    echo "  Using latest release $tag. Use --major to suppress this warning." >&2
                fi
                CHOSEN="$tag"
                break
            fi
            # Skip current or older versions (parse_semver handles v prefix)
            if ! version_gt "$tag" "$CURRENT_VERSION"; then
                continue
            fi
            # Check major version compatibility
            if [ "$ALLOW_MAJOR" = false ] && ! same_major "$tag" "$CURRENT_VERSION"; then
                echo "  Skipping $tag (major version change — use --major to allow)"
                continue
            fi
            CHOSEN="$tag"
            break
        done <<< "$SORTED_RELEASES"
    fi

    if [ -z "$CHOSEN" ]; then
        echo ""
        echo "Already up to date (${CURRENT_VERSION})."
        exit 0
    fi

    echo ""
    echo "Target version: $CHOSEN"

    # Check major version safety
    if [ "$CURRENT_VERSION" != "unknown" ] && [ "$ALLOW_MAJOR" = false ]; then
        if ! same_major "$CHOSEN" "$CURRENT_VERSION"; then
            echo "ERROR: $CHOSEN is a major version change. Use --major to allow." >&2
            exit 1
        fi
    fi

    # --- Step 4: Download release archive ---

    TMPDIR=$(mktemp -d)
    trap 'rm -rf "$TMPDIR"' EXIT

    echo "Downloading $CHOSEN..."
    gh release download "$CHOSEN" --repo "$UPSTREAM" --archive tar.gz --dir "$TMPDIR" 2>/dev/null

    ARCHIVE=$(find "$TMPDIR" -name "*.tar.gz" | head -1)
    if [ -z "$ARCHIVE" ]; then
        echo "ERROR: Failed to download release archive." >&2
        exit 1
    fi

    # Extract (validate archive contents first — reject absolute or traversal paths)
    EXTRACT_DIR="$TMPDIR/extracted"
    mkdir -p "$EXTRACT_DIR"
    if tar tzf "$ARCHIVE" | grep -qE '(^/|\.\.)'; then
        echo "ERROR: Archive contains suspicious paths (absolute or ..). Aborting." >&2
        exit 1
    fi
    tar xzf "$ARCHIVE" -C "$EXTRACT_DIR"

    # Find the root of the extracted repo (GitHub archives have exactly one top-level dir)
    CHILD_DIRS=$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d)
    CHILD_COUNT=$(echo "$CHILD_DIRS" | wc -l)
    if [ "$CHILD_COUNT" -ne 1 ] || [ -z "$CHILD_DIRS" ]; then
        echo "ERROR: Expected exactly one directory in archive, found $CHILD_COUNT." >&2
        exit 1
    fi
    UPSTREAM_ROOT="$CHILD_DIRS"

    echo "Extracted to temp dir."
fi

# --- Step 5: Generate upstream manifest ---

echo "Analyzing changes..."

# Build list of upstream template files (same logic as generate-manifest.sh)
TEMPLATE_DIRS=(
    ".claude/commands"
    ".claude/agents"
    ".claude/skills"
    ".claude/rules"
    ".claude/hooks"
    ".claude/security"
)

declare -A UPSTREAM_HASHES
declare -A LOCAL_HASHES
declare -A MANIFEST_HASHES

# Hash upstream files
for dir in "${TEMPLATE_DIRS[@]}"; do
    full_dir="$UPSTREAM_ROOT/$dir"
    if [ ! -d "$full_dir" ]; then continue; fi
    while IFS= read -r file; do
        relpath="${file#$UPSTREAM_ROOT/}"
        hash=$(sha256sum "$file" | cut -d' ' -f1)
        UPSTREAM_HASHES["$relpath"]="$hash"
    done < <(find "$full_dir" -type f | sort)
done

TEMPLATE_FILES=(
    ".claude/settings.json"
    ".claude/maintenance-policy.yaml"
    "docs/knowledge/decisions.md"
    "docs/knowledge/patterns.md"
    "docs/knowledge/bugs.md"
    "docs/knowledge/architecture.md"
    "docs/knowledge/kv.md"
    "docs/knowledge/metrics.md"
)

TEMPLATE_SCRIPTS=(
    "scripts/memory-search.sh"
    "scripts/audit-context.sh"
    "scripts/scrub-secrets.sh"
    "scripts/validate-roadmap.sh"
    "scripts/create-pr.sh"
    "scripts/dashboard.sh"
    "scripts/context-filter.sh"
    "scripts/validate-freshness.sh"
    "scripts/codex-review.sh"
    "scripts/generate-manifest.sh"
    "scripts/update-project.sh"
    "scripts/sync-hooks.sh"
    "scripts/knowledge-index.ts"
    "scripts/dashboard-server.ts"
    "scripts/observation-parser.ts"
    "scripts/security-scanner.ts"
    "scripts/system-map.ts"
    "scripts/detect-stack.ts"
    "scripts/maintain-draft.ts"
    "scripts/maintain.sh"
    "scripts/dream-accept.sh"
    "scripts/install-hooks.sh"
    "scripts/install-global-commands.sh"
    "scripts/new-project.sh"
    "scripts/setup.sh"
)

for relpath in "${TEMPLATE_FILES[@]}" "${TEMPLATE_SCRIPTS[@]}"; do
    file="$UPSTREAM_ROOT/$relpath"
    if [ -f "$file" ]; then
        hash=$(sha256sum "$file" | cut -d' ' -f1)
        UPSTREAM_HASHES["$relpath"]="$hash"
    fi
done

# Hash scripts/lib/
if [ -d "$UPSTREAM_ROOT/scripts/lib" ]; then
    while IFS= read -r file; do
        relpath="${file#$UPSTREAM_ROOT/}"
        hash=$(sha256sum "$file" | cut -d' ' -f1)
        UPSTREAM_HASHES["$relpath"]="$hash"
    done < <(find "$UPSTREAM_ROOT/scripts/lib" -type f | sort)
fi

# Hash local files and read manifest hashes
for relpath in "${!UPSTREAM_HASHES[@]}"; do
    local_file="$PROJECT_ROOT/$relpath"
    if [ -f "$local_file" ]; then
        LOCAL_HASHES["$relpath"]=$(sha256sum "$local_file" | cut -d' ' -f1)
    fi
done

# Read manifest hashes (if not legacy)
if [ "$LEGACY_MODE" = false ]; then
    while IFS= read -r line; do
        # Parse "    "path/to/file": "hash"" lines
        if [[ "$line" =~ ^[[:space:]]*\"([^\"]+)\":[[:space:]]*\"([a-f0-9]{64})\" ]]; then
            MANIFEST_HASHES["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        fi
    done < "$MANIFEST"
fi

# --- Step 6: Classify changes ---

SAFE_UPDATE=()
CONFLICT=()
NEW_FILES=()
UNCHANGED=()

for relpath in "${!UPSTREAM_HASHES[@]}"; do
    upstream_hash="${UPSTREAM_HASHES[$relpath]}"
    local_hash="${LOCAL_HASHES[$relpath]:-}"
    manifest_hash="${MANIFEST_HASHES[$relpath]:-}"

    if [ -z "$local_hash" ]; then
        # File doesn't exist locally — new file from upstream
        NEW_FILES+=("$relpath")
    elif [ "$upstream_hash" = "$local_hash" ]; then
        # Already matches upstream — no change needed
        UNCHANGED+=("$relpath")
    elif [ "$LEGACY_MODE" = true ]; then
        # No manifest — can't tell if user modified it
        CONFLICT+=("$relpath")
    elif [ "$local_hash" = "$manifest_hash" ]; then
        # Local matches what was originally installed — safe to update
        SAFE_UPDATE+=("$relpath")
    elif [ "$upstream_hash" = "$manifest_hash" ]; then
        # Upstream hasn't changed but local has — user customized, skip
        UNCHANGED+=("$relpath")
    else
        # Both upstream and local changed — real conflict
        CONFLICT+=("$relpath")
    fi
done

# --- Step 7: Report ---

echo ""
echo "=== Update Report: $CURRENT_VERSION → $CHOSEN ==="
echo ""

if [ ${#SAFE_UPDATE[@]} -gt 0 ]; then
    echo "Safe to update (${#SAFE_UPDATE[@]} files — untouched locally):"
    for f in "${SAFE_UPDATE[@]}"; do echo "  ✓ $f"; done
    echo ""
fi

if [ ${#NEW_FILES[@]} -gt 0 ]; then
    echo "New files (${#NEW_FILES[@]} — added in $CHOSEN):"
    for f in "${NEW_FILES[@]}"; do echo "  + $f"; done
    echo ""
fi

if [ ${#CONFLICT[@]} -gt 0 ]; then
    echo "Conflicts (${#CONFLICT[@]} — modified locally AND upstream):"
    for f in "${CONFLICT[@]}"; do echo "  ! $f"; done
    echo "  These will be saved as <file>.upstream for manual review."
    echo ""
fi

if [ ${#UNCHANGED[@]} -gt 0 ]; then
    echo "Unchanged: ${#UNCHANGED[@]} files (already current or user-customized)"
    echo ""
fi

TOTAL_CHANGES=$(( ${#SAFE_UPDATE[@]} + ${#NEW_FILES[@]} + ${#CONFLICT[@]} ))
if [ "$TOTAL_CHANGES" -eq 0 ]; then
    echo "No changes to apply."
    exit 0
fi

# --- Step 8: Apply (if --apply) ---

if [ "$APPLY" = false ]; then
    echo "Dry run complete. Run with --apply to apply these changes."
    exit 0
fi

echo "Applying updates..."

# Create backup
BACKUP_DIR="$PROJECT_ROOT/.claude/backups/pre-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

applied=0
conflicts=0

# Apply safe updates
for relpath in "${SAFE_UPDATE[@]}"; do
    src="$UPSTREAM_ROOT/$relpath"
    dst="$PROJECT_ROOT/$relpath"
    # Backup
    backup_path="$BACKUP_DIR/$relpath"
    mkdir -p "$(dirname "$backup_path")"
    cp "$dst" "$backup_path"
    # Update
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  Updated: $relpath"
    applied=$((applied + 1))
done

# Apply new files
for relpath in "${NEW_FILES[@]}"; do
    src="$UPSTREAM_ROOT/$relpath"
    dst="$PROJECT_ROOT/$relpath"
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  Added: $relpath"
    applied=$((applied + 1))
done

# Handle conflicts — save as .upstream
for relpath in "${CONFLICT[@]}"; do
    src="$UPSTREAM_ROOT/$relpath"
    dst="$PROJECT_ROOT/$relpath"
    # Backup current
    backup_path="$BACKUP_DIR/$relpath"
    mkdir -p "$(dirname "$backup_path")"
    cp "$dst" "$backup_path"
    # Save upstream version alongside
    cp "$src" "${dst}.upstream"
    echo "  Conflict: $relpath → saved ${relpath}.upstream for review"
    conflicts=$((conflicts + 1))
done

# Fix permissions
find "$PROJECT_ROOT/scripts" -name "*.sh" -exec chmod +x {} + 2>/dev/null || true
find "$PROJECT_ROOT/.claude/hooks" -name "*.sh" -exec chmod +x {} + 2>/dev/null || true

# Ensure .gitignore has updater artifact patterns
GITIGNORE="$PROJECT_ROOT/.gitignore"
if [ -f "$GITIGNORE" ]; then
    if ! grep -qF '.claude/backups/' "$GITIGNORE"; then
        printf '\n# Update system artifacts\n.claude/backups/\n*.upstream\n' >> "$GITIGNORE"
        echo "Added update system patterns to .gitignore"
    fi
fi

# --- Step 9: Regenerate manifest (only if no conflicts) ---

echo ""
if [ "$conflicts" -gt 0 ]; then
    echo "Skipping manifest regeneration — $conflicts conflict(s) need resolution first."
else
    echo "Regenerating manifest..."
    bash "$PROJECT_ROOT/scripts/generate-manifest.sh" "${CHOSEN#v}"

    # --- Step 10: Verify system map integrity ---
    if [ -f "$PROJECT_ROOT/scripts/system-map.ts" ]; then
        echo "Verifying system map..."
        if node "$PROJECT_ROOT/scripts/system-map.ts" check >/dev/null 2>&1; then
            MAP_WAS_FRESH=true
        else
            MAP_WAS_FRESH=false
        fi
        node "$PROJECT_ROOT/scripts/system-map.ts" check --heal >/dev/null 2>&1 || true
        if [ "$MAP_WAS_FRESH" = true ]; then
            echo "map verified"
        else
            echo "map healed after update"
        fi
    fi
fi

# --- Summary ---

echo ""
echo "=== Update Complete ==="
echo "  Applied: $applied files"
echo "  Conflicts: $conflicts files (review .upstream files)"
echo "  Backup: $BACKUP_DIR"
echo ""

if [ "$conflicts" -gt 0 ]; then
    echo "Next steps:"
    echo "  1. Review each .upstream file against your local version"
    echo "  2. Merge changes you want to keep"
    echo "  3. Delete the .upstream files when done"
    echo "  4. Run: bash scripts/generate-manifest.sh ${CHOSEN#v}"
    echo "     (to update manifest after resolving conflicts)"
fi
