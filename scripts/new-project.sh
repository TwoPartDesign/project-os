#!/usr/bin/env bash
# Bootstrap a new project with the Project OS structure
# Usage: ./scripts/new-project.sh <project-name> <parent-path>
# Creates: <parent-path>/<project-name>/

set -euo pipefail

PROJECT_NAME="${1:-}"
PROJECT_PATH="${2:-}"

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_PATH" ]; then
  echo "Usage: new-project.sh <project-name> <project-path>" >&2
  exit 1
fi

# Validate project path: reject values starting with '-' (would be parsed as flags)
if [[ "$PROJECT_PATH" == -* ]]; then
    echo "ERROR: PROJECT_PATH '${PROJECT_PATH}' must not start with '-'." >&2
    exit 1
fi

# Reject path traversal sequences
if [[ "$PROJECT_PATH" =~ \.\. ]]; then
    echo "ERROR: PROJECT_PATH '${PROJECT_PATH}' must not contain '..'." >&2
    exit 1
fi

# Validate project name: reject path traversal and special chars that break sed
if [[ "$PROJECT_NAME" =~ \.\. ]] || [[ "$PROJECT_NAME" =~ [/\\] ]] || [[ ! "$PROJECT_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "ERROR: Invalid project name '${PROJECT_NAME}'. Use only alphanumeric, dots, hyphens, underscores." >&2
    exit 1
fi

FULL_PATH="$PROJECT_PATH/$PROJECT_NAME"

echo "Creating project: $PROJECT_NAME at $FULL_PATH"

if [ -d "$FULL_PATH" ]; then
    echo "ERROR: Directory already exists: $FULL_PATH" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$FULL_PATH"/{.claude/{commands/{workflows,tools,pm},agents,skills/{spec-driven-dev,tdd-workflow,session-management},sessions,rules,hooks,security},docs/{prd,research,knowledge,specs,memory},scripts,src}

cp -r "$TEMPLATE_DIR/.obsidian" "$FULL_PATH/" 2>/dev/null || true
cp -r "$TEMPLATE_DIR/.claude/commands" "$FULL_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/agents" "$FULL_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/skills" "$FULL_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/rules" "$FULL_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/hooks" "$FULL_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/security" "$FULL_PATH/.claude/"
cp "$TEMPLATE_DIR/.claude/settings.json" "$FULL_PATH/.claude/"

sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE_DIR/CLAUDE.template.md" > "$FULL_PATH/CLAUDE.md"
cp "$TEMPLATE_DIR/ROADMAP.template.md" "$FULL_PATH/ROADMAP.md"
cp "$TEMPLATE_DIR/global-CLAUDE.md" "$FULL_PATH/"

for f in decisions.md patterns.md bugs.md architecture.md kv.md metrics.md; do
  cp "$TEMPLATE_DIR/docs/knowledge/$f" "$FULL_PATH/docs/knowledge/"
done

touch "$FULL_PATH/docs/specs/.gitkeep"
touch "$FULL_PATH/docs/memory/.gitkeep"

for script in memory-search.sh audit-context.sh scrub-secrets.sh \
              validate-roadmap.sh unblocked-tasks.sh create-pr.sh dashboard.sh \
              sync-agent-rules.sh context-filter.sh validate-freshness.sh \
              codex-review.sh generate-manifest.sh update-project.sh; do
  cp "$TEMPLATE_DIR/scripts/$script" "$FULL_PATH/scripts/"
done
mkdir -p "$FULL_PATH/scripts/lib"
cp -r "$TEMPLATE_DIR/scripts/lib/." "$FULL_PATH/scripts/lib/"
for ts_script in knowledge-index.ts dashboard-server.ts; do
  [ -f "$TEMPLATE_DIR/scripts/$ts_script" ] && cp "$TEMPLATE_DIR/scripts/$ts_script" "$FULL_PATH/scripts/"
done
find "$FULL_PATH/scripts" -name "*.sh" -exec chmod +x {} + 2>/dev/null || true
find "$FULL_PATH/.claude/hooks" -name "*.sh" -exec chmod +x {} + 2>/dev/null || true
find "$FULL_PATH/.claude/security" -name "*.sh" -exec chmod +x {} + 2>/dev/null || true

# Generate update manifest (tracks template file hashes for future updates)
TEMPLATE_VERSION=$(git -C "$TEMPLATE_DIR" describe --tags --abbrev=0 2>/dev/null || echo "unknown")
bash "$FULL_PATH/scripts/generate-manifest.sh" "$TEMPLATE_VERSION"

cd "$FULL_PATH"
cat > .gitignore << 'GI'
CLAUDE.local.md
.claude/sessions/
.claude/logs/
.claude/settings.local.json
.claude/backups/
*.upstream
node_modules/
.env
.env.*

# Research output
docs/research/

# Feature specs (project-specific)
docs/specs/*
!docs/specs/.gitkeep

# Memory (cross-session, local only)
docs/memory/*
!docs/memory/.gitkeep

# Build output
dist/
build/

# Obsidian user state (vault config is committed; workspace state is not)
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/cache
GI

git init
git add .
git commit -m "chore: initialize project with Project OS scaffold"

echo ""
echo "Project '$PROJECT_NAME' initialized at $FULL_PATH"
echo ""
echo "Next steps:"
echo "  cd $FULL_PATH"
echo "  claude"
echo "  /tools:init               # Fill in project variables (run this first)"
echo "  /pm:prd [feature-name]    # Start with product thinking"
echo "  /workflows:idea [name]    # Or jump into a feature spec"
