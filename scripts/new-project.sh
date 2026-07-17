#!/usr/bin/env bash
# Bootstrap a new project with the Project OS structure, or adopt Project OS
# in-place into an existing directory.
#
# Usage:
#   ./scripts/new-project.sh <project-name> <parent-path>
#     Fresh bootstrap. Creates <parent-path>/<project-name>/ from scratch.
#
#   ./scripts/new-project.sh --adopt <target-dir> [--dry-run] [--allow-nested]
#     In-place adoption of an existing directory. PROJECT_NAME is derived
#     from <target-dir>'s basename. Flags may appear in any order.
#       --dry-run       Run pre-flight + classification, write nothing,
#                       exit 0. (Adopt-mode only.)
#       --allow-nested  Permit adopting a directory that has no .git of its
#                       own but sits inside a parent git repository
#                       (refused by default). (Adopt-mode only.)
#
#   NOTE: the adopt copy engine (template copies, orphan sweep, gitignore
#   block, git init/commit, adopt report) is implemented in #T70. This
#   script currently performs adopt-mode pre-flight + scaffold-directory
#   creation only, then stops with a clear notice.

set -euo pipefail

# copy_safe SRC DST CLASS -- stub, fleshed out in #T70. CLASS is one of
# {framework, content}. Fresh-bootstrap mode never calls this function;
# it exists so the script stays parseable/runnable end-to-end for both
# modes ahead of the real copy engine landing.
copy_safe() {
  echo "copy_safe: not yet implemented (#T70)" >&2
  exit 1
}

# run_mut CMD [ARGS...] -- executes CMD only when DRY_RUN=0. Every
# filesystem mutation in adopt mode must go through this helper so
# --dry-run performs the full classification/branching pass with zero
# writes. Classification and branching decisions must NEVER be gated by
# DRY_RUN -- only the mutation call itself -- so the plan --dry-run prints
# is guaranteed to be the plan a real run would execute (single decision
# path; round-3 MEDIUM in design.md).
run_mut() {
  if [ "$DRY_RUN" -eq 0 ]; then
    "$@"
  fi
}

# ---- Arg parsing / mode dispatch ----
# A single pass over "$@" classifies known adopt-mode flags; everything
# else (including any argument that happens to start with "--" but isn't
# one of these three flags) falls through to POSITIONAL, preserving the
# original two-positional-argument fresh-mode usage byte-for-byte.
MODE="fresh"
DRY_RUN=0
ALLOW_NESTED=0
ADOPT_TARGET=""
POSITIONAL=()

while [ $# -gt 0 ]; do
  case "$1" in
    --adopt)
      MODE="adopt"
      ADOPT_TARGET="${2:-}"
      if [ -z "$ADOPT_TARGET" ]; then
        echo "ERROR: --adopt requires a target directory argument." >&2
        exit 1
      fi
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --allow-nested)
      ALLOW_NESTED=1
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [ "$MODE" = "adopt" ]; then
  # ================= Adopt mode (skeleton; engine lands in #T70) =================

  # Report accumulators -- populated by the copy engine (#T70). Declared
  # here so downstream code (and this skeleton's own WARNINGS use) has a
  # stable shape to append to.
  CREATED_LIST=()
  CONFLICT_LIST=()
  DEMOTED_LIST=()
  ORPHAN_EXEC_LIST=()
  QUARANTINED_HOOKS=()
  WARNINGS=()

  # --- Pre-flight (before ANY write) ---

  if [ ! -e "$ADOPT_TARGET" ]; then
    echo "ERROR: --adopt target does not exist: $ADOPT_TARGET" >&2
    exit 1
  fi
  if [ ! -d "$ADOPT_TARGET" ]; then
    echo "ERROR: --adopt target is not a directory: $ADOPT_TARGET" >&2
    exit 1
  fi

  # Reject path traversal sequences on the raw argument first (same
  # posture as fresh-mode's PROJECT_PATH check above) -- checked before
  # realpath resolution so a deliberately crafted ".." pattern is rejected
  # by pattern, not only neutralized by normalization.
  if [[ "$ADOPT_TARGET" =~ \.\. ]]; then
    echo "ERROR: --adopt target '${ADOPT_TARGET}' must not contain '..'." >&2
    exit 1
  fi

  # realpath-resolve (subshell cd; does not affect this script's cwd).
  ADOPT_TARGET="$(cd "$ADOPT_TARGET" && pwd)"

  # Already a Project OS project? Point at the update flow, not adopt.
  if [ -f "$ADOPT_TARGET/.claude/manifest.json" ]; then
    echo "ERROR: $ADOPT_TARGET is already a Project OS project (.claude/manifest.json exists)." >&2
    echo "Use 'bash scripts/update-project.sh' to update it instead." >&2
    exit 1
  fi

  # Symlink pre-flight: hard fail if any template-managed destination tree
  # root, or template-managed root file, is itself a symlink. Prevents
  # scaffold writes from escaping the target through a planted link.
  # Scope: the top-level template-managed entries directly under the
  # target (.claude, scripts, docs, .obsidian trees + root files) -- these
  # are all direct children of ADOPT_TARGET, so checking them covers their
  # own "ancestor" (the target root) by construction. Symlinks planted
  # deeper inside one of these trees are out of scope for this pre-flight
  # scan; the copy engine (#T70) must itself avoid following symlinks
  # when writing individual files.
  SYMLINK_HITS=()
  for rel in .claude scripts docs .obsidian CLAUDE.md ROADMAP.md global-CLAUDE.md .gitignore; do
    path="$ADOPT_TARGET/$rel"
    if [ -L "$path" ]; then
      SYMLINK_HITS+=("$path")
    fi
  done
  if [ "${#SYMLINK_HITS[@]}" -gt 0 ]; then
    echo "ERROR: refusing to adopt -- symlink(s) found at template-managed path(s):" >&2
    for hit in "${SYMLINK_HITS[@]}"; do
      echo "  $hit" >&2
    done
    exit 1
  fi

  # Nested-repo check: target has no .git of its own, but sits inside a
  # parent git repository -> refuse unless explicitly allowed. (If
  # ADOPT_TARGET had its own .git, rev-parse --show-toplevel would resolve
  # to ADOPT_TARGET itself and this branch would not run; reaching here
  # with a successful rev-parse means the toplevel is necessarily some
  # ancestor of ADOPT_TARGET.)
  if [ ! -e "$ADOPT_TARGET/.git" ]; then
    if PARENT_TOPLEVEL="$(git -C "$ADOPT_TARGET" rev-parse --show-toplevel 2>/dev/null)"; then
      if [ "$ALLOW_NESTED" -eq 0 ]; then
        echo "ERROR: $ADOPT_TARGET has no .git of its own but is nested inside an existing repo at $PARENT_TOPLEVEL." >&2
        echo "Re-run with --allow-nested to adopt anyway." >&2
        exit 1
      fi
    fi
  fi

  # Linked-worktree target: .git is a file, not a directory. Hooks are
  # shared from the main repo checkout, so the scaffold commit made here
  # will not be scanned locally. Warn and continue (not a refusal).
  if [ -f "$ADOPT_TARGET/.git" ]; then
    WARNINGS+=("$ADOPT_TARGET has a linked-worktree .git file: git hooks are shared from the main repo checkout, so the scaffold commit will not be scanned locally.")
  fi

  # --- PROJECT_NAME derivation (not a mutation) ---
  RAW_NAME="$(basename "$ADOPT_TARGET")"
  PROJECT_NAME="$(printf '%s' "$RAW_NAME" | tr ' _' '--')"
  PROJECT_NAME="$(printf '%s' "$PROJECT_NAME" | tr -cd 'a-zA-Z0-9._-')"

  # Validated by the existing charset rule (same regex as fresh mode above).
  if [[ "$PROJECT_NAME" =~ \.\. ]] || [[ "$PROJECT_NAME" =~ [/\\] ]] || [[ ! "$PROJECT_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "ERROR: Invalid project name '${PROJECT_NAME}' derived from target folder '${RAW_NAME}'. Use only alphanumeric, dots, hyphens, underscores." >&2
    exit 1
  fi

  echo "Adopting project: $PROJECT_NAME at $ADOPT_TARGET"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "(--dry-run: no files will be written)"
  fi

  for w in "${WARNINGS[@]}"; do
    echo "WARNING: $w" >&2
  done

  # Used by the copy engine (#T70); computed here so the skeleton already
  # has them available.
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

  # Scaffold directories, minus src/ (fresh mode creates src/ as a landing
  # spot for a brand-new project; an adopted repo already has its own
  # source layout). Routed through run_mut so --dry-run writes nothing.
  run_mut mkdir -p "$ADOPT_TARGET"/{.claude/{commands/{workflows,tools,pm},agents,skills/{spec-driven-dev,tdd-workflow,session-management},sessions,rules,hooks,security},docs/{prd,research,knowledge,specs,memory},scripts}

  # --- Adopt copy engine not yet implemented (#T70) ---
  # Pre-flight and scaffold-directory creation are complete. Template
  # copies via copy_safe(), the orphan sweep, gitignore block, git
  # init/commit, and the adopt report land in #T70. Stop here so a
  # partial adoption can never half-run.
  echo ""
  echo "Adopt pre-flight complete; adopt engine incomplete (#T70)." >&2
  if [ "$DRY_RUN" -eq 1 ]; then
    exit 0
  else
    exit 3
  fi
fi

# ================= Fresh-bootstrap mode (unchanged behavior) =================
PROJECT_NAME="${POSITIONAL[0]:-}"
PROJECT_PATH="${POSITIONAL[1]:-}"

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
cp "$TEMPLATE_DIR/.claude/maintenance-policy.yaml" "$FULL_PATH/.claude/"

sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE_DIR/CLAUDE.template.md" > "$FULL_PATH/CLAUDE.md"
cp "$TEMPLATE_DIR/ROADMAP.template.md" "$FULL_PATH/ROADMAP.md"
cp "$TEMPLATE_DIR/global-CLAUDE.md" "$FULL_PATH/"

for f in decisions.md patterns.md bugs.md architecture.md kv.md metrics.md; do
  cp "$TEMPLATE_DIR/docs/knowledge/$f" "$FULL_PATH/docs/knowledge/"
done

touch "$FULL_PATH/docs/specs/.gitkeep"
touch "$FULL_PATH/docs/memory/.gitkeep"

for script in memory-search.sh audit-context.sh scrub-secrets.sh \
              validate-roadmap.sh create-pr.sh dashboard.sh \
              context-filter.sh validate-freshness.sh \
              codex-review.sh generate-manifest.sh update-project.sh \
              sync-hooks.sh maintain.sh dream-accept.sh \
              install-hooks.sh install-global-commands.sh setup.sh; do
  cp "$TEMPLATE_DIR/scripts/$script" "$FULL_PATH/scripts/"
done
mkdir -p "$FULL_PATH/scripts/lib"
cp -r "$TEMPLATE_DIR/scripts/lib/." "$FULL_PATH/scripts/lib/"
for ts_script in knowledge-index.ts dashboard-server.ts observation-parser.ts security-scanner.ts \
                 system-map.ts maintain-draft.ts; do
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

# Activate the project: install git hooks (secret scanner + system-map
# auto-heal) and generate the initial system map. Idempotent and Node-guarded;
# the same routine runs as a SessionStart fallback for cloned projects. The
# initial commit below then passes through the freshly installed hooks.
bash "$FULL_PATH/scripts/setup.sh" || echo "WARN: setup.sh reported an issue; run 'bash scripts/setup.sh' after 'cd $FULL_PATH'." >&2

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
echo ""
echo "Already set up: git hooks + system map (via scripts/setup.sh)."
echo "If you later CLONE this project elsewhere, run 'bash scripts/setup.sh'"
echo "once to reinstall git hooks (they don't travel with 'git clone') — or"
echo "just open it in Claude, which runs that setup automatically."
