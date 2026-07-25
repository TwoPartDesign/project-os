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

# Determine version. Precedence: explicit arg > existing "-dev" marker in the
# current manifest (a forward dev version must not be clobbered by a regen that
# falls back to the latest tag) > latest git tag > "unknown".
VERSION="${1:-}"
if [ -z "$VERSION" ] && [ -f "$MANIFEST" ]; then
    EXISTING_VERSION=$(grep -m1 '"project_os_version"' "$MANIFEST" | sed -E 's/.*"project_os_version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
    case "$EXISTING_VERSION" in
        *-dev) VERSION="$EXISTING_VERSION" ;;
    esac
fi
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
    ".claude/maintenance-policy.yaml"
    "docs/knowledge/decisions.md"
    "docs/knowledge/patterns.md"
    "docs/knowledge/bugs.md"
    "docs/knowledge/architecture.md"
    "docs/knowledge/kv.md"
    "docs/knowledge/metrics.md"
    "docs/knowledge/skill-edit-rejections.md"
)

# ==========================================================================
# seed_hashes -- the write-once record of the CONTENT the framework handed
# this project at bootstrap, so a detector can tell "still template" from
# "localized". Deliberately SEPARATE from "files":
#
#   files       = framework files we maintain and may update. RECOMPUTED on
#                 every run, including by update-project.sh:599 at the end of
#                 every /tools:update.
#   seed_hashes = one-time bootstrap content. NEVER recomputed once recorded.
#
# That distinction is the whole point. A detector reading "files" would be
# correct exactly until the project's first /tools:update, after which
# files[path] holds the USER's hash and hash-equality proves nothing.
#
# See docs/specs/template-content-leakage/design.md ("Data Model").
# ==========================================================================

# Watched content paths, in emission order. MUST stay in sync with
# RESIDUE_WATCHED in scripts/lib/system-map-lib.ts.
SEED_WATCHED=(
    "docs/knowledge/architecture.md"
    "docs/knowledge/patterns.md"
    "docs/knowledge/decisions.md"
    "docs/knowledge/bugs.md"
    "docs/knowledge/metrics.md"
    ".claude/rules/preferences.md"
)

# Framework-repo seed sources: destination path -> templates/ source path.
# Present ONLY in this repo (templates/ is never copied into a project), which
# is exactly what makes it the framework-repo discriminator -- in Project OS
# itself the seeds differ from the live files, so the detector stays silent
# here without any special-casing.
seed_source_for() {
    case "$1" in
        docs/knowledge/*) printf 'templates/knowledge/%s' "${1#docs/knowledge/}" ;;
        .claude/rules/*) printf 'templates/rules/%s' "${1#.claude/rules/}" ;;
        *) return 1 ;;
    esac
}

# Extract a seed_hashes value from the existing manifest. Prints nothing when
# absent. Scoped to the seed_hashes block so a same-named key under "files"
# can never be mistaken for a seed hash.
existing_seed_hash() {
    [ -f "$MANIFEST" ] || return 0
    sed -n '/"seed_hashes"[[:space:]]*:[[:space:]]*{/,/}/p' "$MANIFEST" \
        | grep -m1 -F "\"$1\":" \
        | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/'
}

# Extract a files-block value from the existing manifest (the one-time
# promotion source for projects cloned before seed_hashes existed).
existing_files_hash() {
    [ -f "$MANIFEST" ] || return 0
    sed -n '/"files"[[:space:]]*:[[:space:]]*{/,$p' "$MANIFEST" \
        | grep -m1 -F "\"$1\":" \
        | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/'
}

# Resolve the seed hash for one watched path. First match wins:
#   1. templates/ source exists  -> hash the SEED (framework repo)
#   2. existing seed_hashes      -> carry forward VERBATIM (/tools:update)
#   3. existing files entry      -> promote once (pre-seed_hashes clone)
#   4. no prior manifest         -> hash the local file (fresh bootstrap:
#                                   what is on disk IS the seed
#                                   new-project.sh just copied)
# Prints a bare sha256 or nothing. Every value that did not come from
# sha256sum on this run is validated as ^[a-f0-9]{64}$ before it is trusted --
# this manifest is assembled by string concatenation with no jq, so an
# unvalidated carried-forward value is a JSON-injection vector.
resolve_seed_hash() {
    local relpath="$1" src carried

    if src=$(seed_source_for "$relpath") && [ -f "$PROJECT_ROOT/$src" ]; then
        sha256sum "$PROJECT_ROOT/$src" | cut -d' ' -f1
        return 0
    fi

    carried=$(existing_seed_hash "$relpath")
    if [ -n "$carried" ]; then
        if [[ "$carried" =~ ^[a-f0-9]{64}$ ]]; then
            printf '%s' "$carried"
            return 0
        fi
        echo "WARN: dropping malformed seed_hashes value for $relpath (not a sha256)." >&2
        return 0
    fi

    carried=$(existing_files_hash "$relpath")
    if [ -n "$carried" ]; then
        if [[ "$carried" =~ ^[a-f0-9]{64}$ ]]; then
            printf '%s' "$carried"
            return 0
        fi
        echo "WARN: dropping malformed files value for $relpath (not a sha256)." >&2
        return 0
    fi

    if [ ! -f "$MANIFEST" ] && [ -f "$PROJECT_ROOT/$relpath" ]; then
        sha256sum "$PROJECT_ROOT/$relpath" | cut -d' ' -f1
        return 0
    fi

    return 0
}

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
    "scripts/maintain-draft.ts"
    "scripts/maintain.sh"
    "scripts/dream-accept.sh"
    "scripts/install-hooks.sh"
    "scripts/install-global-commands.sh"
    "scripts/new-project.sh"
    "scripts/setup.sh"
    "scripts/detect-stack.ts"
    "scripts/skill-apply.ts"
    "scripts/skill-ledger.ts"
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

# Resolve every seed hash BEFORE the manifest is truncated below -- rules 2
# and 3 read the CURRENT manifest, so they must run while it still exists.
declare -A SEED_HASHES=()
for relpath in "${SEED_WATCHED[@]}"; do
    resolved=$(resolve_seed_hash "$relpath")
    if [ -n "$resolved" ]; then
        SEED_HASHES["$relpath"]="$resolved"
    fi
done

# Build JSON manually (no jq dependency)
ESCAPED_VERSION=$(json_escape "$VERSION")
echo "{" > "$MANIFEST"
echo "  \"project_os_version\": \"$ESCAPED_VERSION\"," >> "$MANIFEST"
echo "  \"generated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> "$MANIFEST"
echo "  \"upstream\": \"TwoPartDesign/project-os\"," >> "$MANIFEST"

# seed_hashes emitted before "files" so it survives a truncated/partial read
# and is visible at the top of a diff. Keys come from SEED_WATCHED (a fixed
# in-script list), never from the parsed manifest, so a hand-edited key can
# never reach this output; values are sha256-validated in resolve_seed_hash.
echo "  \"seed_hashes\": {" >> "$MANIFEST"
seed_first=true
for relpath in "${SEED_WATCHED[@]}"; do
    hash="${SEED_HASHES[$relpath]:-}"
    [ -n "$hash" ] || continue
    if [ "$seed_first" = true ]; then
        seed_first=false
    else
        echo "," >> "$MANIFEST"
    fi
    printf '    "%s": "%s"' "$(json_escape "$relpath")" "$hash" >> "$MANIFEST"
done
echo "" >> "$MANIFEST"
echo "  }," >> "$MANIFEST"

echo "  \"files\": {" >> "$MANIFEST"

first=true

# The manifest must always record Project OS's OWN content for a path, never
# the user's. If a path is content-conflicted, the user's version stays at
# the canonical path and Project OS's version lands beside it as
# "<file>.upstream" (see update-project.sh conflict handling). If the
# manifest recorded the user's hash for that path, the next update-project.sh
# run would see local==manifest and classify it SAFE_UPDATE
# (update-project.sh:442-444), silently overwriting the user's file. Hashing
# the ".upstream" sibling when present keeps the manifest entry equal to
# Project OS's content, so the classifier correctly yields CONFLICT and the
# user's file is preserved.
hash_file() {
    local file="$1"
    local relpath="$2"
    if [ -f "$file.upstream" ]; then
        file="$file.upstream"
    elif [ ! -f "$file" ]; then
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

# Count only the "files" block -- seed_hashes entries are also 64-hex and
# would otherwise inflate this number by len(SEED_WATCHED).
file_count=$(sed -n '/"files"[[:space:]]*:[[:space:]]*{/,$p' "$MANIFEST" | grep -c '"[a-f0-9]\{64\}"' || echo 0)
seed_count="${#SEED_HASHES[@]}"
echo "Manifest generated: $MANIFEST ($file_count files, $seed_count seed hashes, version $VERSION)"
