#!/usr/bin/env bash
# generate-manifest.sh — Create .claude/manifest.json with sha256 hashes of all template files.
#
# Usage:
#   bash scripts/generate-manifest.sh [version]
#
# If version is omitted, attempts to read from git tags or defaults to "unknown".
# Run from project root. Output: .claude/manifest.json

set -euo pipefail

if ! command -v sha256sum &>/dev/null; then
    echo "ERROR: sha256sum not found. Install coreutils (macOS: brew install coreutils)." >&2
    exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$PROJECT_ROOT/.claude/manifest.json"

# Determine version
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    VERSION=$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 2>/dev/null || echo "unknown")
fi

# Template files that get copied by new-project.sh
# These are the ONLY files the update system will touch.
# Project-specific files (CLAUDE.md, ROADMAP.md, docs/specs/, docs/memory/, src/) are never updated.
TEMPLATE_DIRS=(
    ".claude/commands"
    ".claude/agents"
    ".claude/skills"
    ".claude/rules"
    ".claude/hooks"
    ".claude/security"
)

TEMPLATE_FILES=(
    ".claude/settings.json"
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
    "scripts/unblocked-tasks.sh"
    "scripts/create-pr.sh"
    "scripts/dashboard.sh"
    "scripts/sync-agent-rules.sh"
    "scripts/context-filter.sh"
    "scripts/validate-freshness.sh"
    "scripts/codex-review.sh"
    "scripts/generate-manifest.sh"
    "scripts/update-project.sh"
    "scripts/knowledge-index.ts"
    "scripts/dashboard-server.ts"
)

# Escape a string for JSON (handles \, ", and control chars)
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Build JSON manually (no jq dependency)
ESCAPED_VERSION=$(json_escape "$VERSION")
echo "{" > "$MANIFEST"
echo "  \"project_os_version\": \"$ESCAPED_VERSION\"," >> "$MANIFEST"
echo "  \"generated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> "$MANIFEST"
echo "  \"upstream\": \"TwoPartDesign/project-os\"," >> "$MANIFEST"
echo "  \"files\": {" >> "$MANIFEST"

first=true

hash_file() {
    local file="$1"
    local relpath="$2"
    if [ ! -f "$file" ]; then
        return
    fi
    local hash escaped_path
    hash=$(sha256sum "$file" | cut -d' ' -f1)
    escaped_path=$(json_escape "$relpath")
    if [ "$first" = true ]; then
        first=false
    else
        echo "," >> "$MANIFEST"
    fi
    printf '    "%s": "%s"' "$escaped_path" "$hash" >> "$MANIFEST"
}

# Hash directory trees
for dir in "${TEMPLATE_DIRS[@]}"; do
    full_dir="$PROJECT_ROOT/$dir"
    if [ ! -d "$full_dir" ]; then
        continue
    fi
    while IFS= read -r file; do
        relpath="${file#$PROJECT_ROOT/}"
        hash_file "$file" "$relpath"
    done < <(find "$full_dir" -type f | sort)
done

# Hash individual template files
for relpath in "${TEMPLATE_FILES[@]}"; do
    hash_file "$PROJECT_ROOT/$relpath" "$relpath"
done

# Hash scripts
for relpath in "${TEMPLATE_SCRIPTS[@]}"; do
    hash_file "$PROJECT_ROOT/$relpath" "$relpath"
done

# Hash scripts/lib/ directory
if [ -d "$PROJECT_ROOT/scripts/lib" ]; then
    while IFS= read -r file; do
        relpath="${file#$PROJECT_ROOT/}"
        hash_file "$file" "$relpath"
    done < <(find "$PROJECT_ROOT/scripts/lib" -type f | sort)
fi

echo "" >> "$MANIFEST"
echo "  }" >> "$MANIFEST"
echo "}" >> "$MANIFEST"

file_count=$(grep -c '"[a-f0-9]\{64\}"' "$MANIFEST" || echo 0)
echo "Manifest generated: $MANIFEST ($file_count files, version $VERSION)"
