#!/bin/bash
# Bootstrap a new project with the Project OS structure
# Usage: ./scripts/new-project.sh <project-name> <project-path>

PROJECT_NAME="$1"
PROJECT_PATH="$2"

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_PATH" ]; then
  echo "Usage: new-project.sh <project-name> <project-path>"
  exit 1
fi

echo "Creating project: $PROJECT_NAME at $PROJECT_PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$PROJECT_PATH"/{.claude/{commands/{workflows,tools,pm},agents,skills/{spec-driven-dev,tdd-workflow,session-management},knowledge,sessions,specs,rules,hooks,security},docs/{prd,research},scripts,src}

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

for f in decisions.md patterns.md bugs.md architecture.md kv.md; do
  cp "$TEMPLATE_DIR/.claude/knowledge/$f" "$PROJECT_PATH/.claude/knowledge/"
done

cp "$TEMPLATE_DIR/scripts/memory-search.sh" "$PROJECT_PATH/scripts/"
cp "$TEMPLATE_DIR/scripts/audit-context.sh" "$PROJECT_PATH/scripts/"
chmod +x "$PROJECT_PATH/scripts/"*.sh
chmod +x "$PROJECT_PATH/.claude/hooks/"*.sh 2>/dev/null
chmod +x "$PROJECT_PATH/.claude/security/"*.sh 2>/dev/null

cd "$PROJECT_PATH"
cat > .gitignore << 'GI'
CLAUDE.local.md
.claude/sessions/
.claude/settings.local.json
node_modules/
.env
.env.*
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
