#!/usr/bin/env bash
# Bootstrap a new project with the Project OS structure
# Usage: ./scripts/new-project.sh <project-name> <project-path>

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

echo "Creating project: $PROJECT_NAME at $PROJECT_PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$PROJECT_PATH"/{.claude/{commands/{workflows,tools,pm},agents,skills/{spec-driven-dev,tdd-workflow,session-management},sessions,rules,hooks,security},docs/{prd,research,knowledge,specs,memory},scripts,src}

cp -r "$TEMPLATE_DIR/.obsidian" "$PROJECT_PATH/" 2>/dev/null || true
cp -r "$TEMPLATE_DIR/.claude/commands" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/agents" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/skills" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/rules" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/hooks" "$PROJECT_PATH/.claude/"
cp -r "$TEMPLATE_DIR/.claude/security" "$PROJECT_PATH/.claude/"
cp "$TEMPLATE_DIR/.claude/settings.json" "$PROJECT_PATH/.claude/"

sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE_DIR/CLAUDE.template.md" > "$PROJECT_PATH/CLAUDE.md"
cp "$TEMPLATE_DIR/ROADMAP.md" "$PROJECT_PATH/"
cp "$TEMPLATE_DIR/global-CLAUDE.md" "$PROJECT_PATH/"

for f in decisions.md patterns.md bugs.md architecture.md kv.md metrics.md; do
  cp "$TEMPLATE_DIR/docs/knowledge/$f" "$PROJECT_PATH/docs/knowledge/"
done

touch "$PROJECT_PATH/docs/specs/.gitkeep"
touch "$PROJECT_PATH/docs/memory/.gitkeep"

for script in memory-search.sh audit-context.sh scrub-secrets.sh \
              validate-roadmap.sh unblocked-tasks.sh create-pr.sh dashboard.sh; do
  cp "$TEMPLATE_DIR/scripts/$script" "$PROJECT_PATH/scripts/"
done
chmod +x "$PROJECT_PATH/scripts/"*.sh
chmod +x "$PROJECT_PATH/.claude/hooks/"*.sh 2>/dev/null
chmod +x "$PROJECT_PATH/.claude/security/"*.sh 2>/dev/null

cd "$PROJECT_PATH"
cat > .gitignore << 'GI'
CLAUDE.local.md
.claude/sessions/
.claude/logs/
.claude/settings.local.json
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
echo "Project '$PROJECT_NAME' initialized at $PROJECT_PATH"
echo ""
echo "Next steps:"
echo "  cd $PROJECT_PATH"
echo "  claude"
echo "  /tools:init               # Fill in project variables (run this first)"
echo "  /pm:prd [feature-name]    # Start with product thinking"
echo "  /workflows:idea [name]    # Or jump into a feature spec"
