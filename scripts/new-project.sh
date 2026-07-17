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
#   NOTE: the adopt copy engine (template copies, orphan sweep, .obsidian
#   handling) is implemented here (#T70). Remaining finish steps --
#   gitignore block, .git init/setup.sh --adopt, generate-manifest.sh, the
#   full adopt report, and the scaffold commit -- land in #T71. This script
#   currently performs adopt-mode pre-flight, scaffold-directory creation,
#   template copies, and the orphan sweep, then stops with a clear notice.

set -euo pipefail

# copy_safe SRC DST CLASS -- adopt-mode collision-safe copy. CLASS is one of
# {framework, content}. Classification (which branch fires) always runs;
# only the actual filesystem mutations go through run_mut, so a --dry-run
# pass produces exactly the plan a real run would execute (see run_mut's
# docstring below; single decision path, round-3 MEDIUM in design.md).
#
#   1. DST missing               -> copy; append DST to CREATED_LIST.
#   2. DST exists, sha256==SRC   -> no-op (re-run idempotency).
#   3. DST exists, differs:
#      content   -> copy SRC to DST.upstream (skip if an existing
#                   DST.upstream is already hash-equal to SRC); append DST
#                   to CONFLICT_LIST. The user's file is never touched.
#      framework -> move DST to DST.pre-adopt (FAIL LOUDLY if a differing
#                   DST.pre-adopt already exists -- two adopt generations
#                   collided); copy SRC to DST; append DST to CREATED_LIST
#                   and DEMOTED_LIST.
#
# framework (.claude/**, scripts/** incl. scripts/lib) carries execution/
# prompt authority -- ours always wins the canonical path. content
# (CLAUDE.md, ROADMAP.md, global-CLAUDE.md, docs/knowledge/*.md) is never
# executed -- the user's file always wins the canonical path.
copy_safe() {
  src="$1"
  dst="$2"
  class="$3"

  if [ ! -e "$dst" ]; then
    run_mut mkdir -p "$(dirname "$dst")"
    run_mut cp "$src" "$dst"
    CREATED_LIST+=("$dst")
    return 0
  fi

  src_hash="$(sha256sum "$src" | cut -d' ' -f1)"
  dst_hash="$(sha256sum "$dst" | cut -d' ' -f1)"

  if [ "$src_hash" = "$dst_hash" ]; then
    # Our own prior copy (or the user's file already happens to match) --
    # nothing to do. Makes a partial/completed re-run clean.
    return 0
  fi

  case "$class" in
    content)
      upstream="$dst.upstream"
      if [ -e "$upstream" ]; then
        up_hash="$(sha256sum "$upstream" | cut -d' ' -f1)"
        if [ "$up_hash" = "$src_hash" ]; then
          return 0
        fi
      fi
      run_mut cp "$src" "$upstream"
      CONFLICT_LIST+=("$dst")
      ;;
    framework)
      preadopt="$dst.pre-adopt"
      if [ -e "$preadopt" ]; then
        pre_hash="$(sha256sum "$preadopt" | cut -d' ' -f1)"
        if [ "$pre_hash" != "$dst_hash" ]; then
          echo "ERROR: refusing to adopt -- $preadopt already exists and differs from the current $dst." >&2
          echo "This means two adopt generations collided; resolve manually before re-running." >&2
          exit 1
        fi
        # Identical content already quarantined from a prior run -- safe to
        # just re-install our canonical copy below.
      else
        run_mut mv "$dst" "$preadopt"
      fi
      run_mut cp "$src" "$dst"
      CREATED_LIST+=("$dst")
      DEMOTED_LIST+=("$dst")
      ;;
    *)
      echo "ERROR: copy_safe: unknown CLASS '$class' for $dst" >&2
      exit 1
      ;;
  esac
}

# copy_tree_safe REL_TREE CLASS -- walks every FILE (never directory) under
# TEMPLATE_DIR/REL_TREE and calls copy_safe per file, mirroring the same
# relative path under ADOPT_TARGET/REL_TREE. An empty/absent template
# subtree is a no-op.
copy_tree_safe() {
  rel_tree="$1"
  tree_class="$2"
  src_dir="$TEMPLATE_DIR/$rel_tree"
  [ -d "$src_dir" ] || return 0
  while IFS= read -r walk_file; do
    walk_rel="${walk_file#"$src_dir"/}"
    copy_safe "$walk_file" "$ADOPT_TARGET/$rel_tree/$walk_rel" "$tree_class"
  done < <(find "$src_dir" -type f | sort)
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

# ---- Shared template file/dir lists (single source for BOTH modes) ----
# Avoids the copy-list drift documented as a known failure mode
# (design.md): fresh mode's scaffold loop and adopt mode's copy_safe loop
# below iterate these SAME arrays.

# Framework class: everything under .claude/** and scripts/** (incl.
# scripts/lib) -- carries execution/prompt authority (settings.json runs
# hooks; scripts are executed; commands/skills/rules steer the LLM).
FRAMEWORK_TREES=(
  ".claude/commands"
  ".claude/agents"
  ".claude/skills"
  ".claude/rules"
  ".claude/hooks"
  ".claude/security"
  "scripts/lib"
)
FRAMEWORK_FILES=(
  ".claude/settings.json"
  ".claude/maintenance-policy.yaml"
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
  "scripts/maintain.sh"
  "scripts/dream-accept.sh"
  "scripts/install-hooks.sh"
  "scripts/install-global-commands.sh"
  "scripts/setup.sh"
)
# Optional native-TS scripts -- historically copied only if present (fresh
# mode's existing "[ -f ... ] &&" guard); preserved so a future ts script
# added to the template but not yet to this list degrades gracefully
# instead of hard-failing bootstrap/adopt.
FRAMEWORK_FILES_OPTIONAL=(
  "scripts/knowledge-index.ts"
  "scripts/dashboard-server.ts"
  "scripts/observation-parser.ts"
  "scripts/security-scanner.ts"
  "scripts/system-map.ts"
  "scripts/maintain-draft.ts"
)
# Content class: never executed by any tool -- the user's file always wins
# the canonical path in adopt mode. Entries are "SRC_REL|DST_REL"; ROADMAP
# is the only rename (template's *.template.md naming vs. the scaffolded
# name). CLAUDE.md is handled separately below (sed substitution runs
# first, into a temp file that becomes copy_safe's SRC).
CONTENT_FILES=(
  "ROADMAP.template.md|ROADMAP.md"
  "global-CLAUDE.md|global-CLAUDE.md"
  "docs/knowledge/decisions.md|docs/knowledge/decisions.md"
  "docs/knowledge/patterns.md|docs/knowledge/patterns.md"
  "docs/knowledge/bugs.md|docs/knowledge/bugs.md"
  "docs/knowledge/architecture.md|docs/knowledge/architecture.md"
  "docs/knowledge/kv.md|docs/knowledge/kv.md"
  "docs/knowledge/metrics.md|docs/knowledge/metrics.md"
)

if [ "$MODE" = "adopt" ]; then
  # ================= Adopt mode =================

  # Report accumulators -- populated by the copy engine below. CREATED_LIST
  # is later used (in #T71) as the git add pathspec, so the orphan sweep
  # (which only relocates pre-existing user files) must NEVER append to it.
  CREATED_LIST=()
  CONFLICT_LIST=()
  DEMOTED_LIST=()
  CLAUDE_ORPHAN_LIST=()
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
  # scan; copy_safe/copy_tree_safe use `find` (no -L), which does not
  # follow symlinked directories, and `cp`/`mv` on a per-file basis, so a
  # deeper symlink is simply skipped rather than written through.
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

  # Used by the copy engine; computed here so it's available below.
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TEMPLATE_DIR="$(dirname "$SCRIPT_DIR")"

  # Scaffold directories, minus src/ (fresh mode creates src/ as a landing
  # spot for a brand-new project; an adopted repo already has its own
  # source layout). Routed through run_mut so --dry-run writes nothing.
  run_mut mkdir -p "$ADOPT_TARGET"/{.claude/{commands/{workflows,tools,pm},agents,skills/{spec-driven-dev,tdd-workflow,session-management},sessions,rules,hooks,security},docs/{prd,research,knowledge,specs,memory},scripts}

  # --- Orphan-sweep snapshot (BEFORE any copy_safe call) ---
  # Captures the target's OWN pre-existing files under .claude/** and
  # scripts/** so the sweep below (which runs after the copy pass) reflects
  # what was there originally -- not files copy_safe itself just
  # created/demoted during this run.
  PRE_CLAUDE_FILES=()
  if [ -d "$ADOPT_TARGET/.claude" ]; then
    while IFS= read -r f; do PRE_CLAUDE_FILES+=("$f"); done < <(find "$ADOPT_TARGET/.claude" -type f | sort)
  fi
  PRE_SCRIPTS_FILES=()
  if [ -d "$ADOPT_TARGET/scripts" ]; then
    while IFS= read -r f; do PRE_SCRIPTS_FILES+=("$f"); done < <(find "$ADOPT_TARGET/scripts" -type f | sort)
  fi

  # --- Template copies via copy_safe, one shared list per design.md step 4 ---
  for tree in "${FRAMEWORK_TREES[@]}"; do
    copy_tree_safe "$tree" framework
  done

  for rel in "${FRAMEWORK_FILES[@]}"; do
    src="$TEMPLATE_DIR/$rel"
    if [ ! -f "$src" ]; then
      echo "ERROR: template file missing: $src" >&2
      exit 1
    fi
    copy_safe "$src" "$ADOPT_TARGET/$rel" framework
  done

  for rel in "${FRAMEWORK_FILES_OPTIONAL[@]}"; do
    src="$TEMPLATE_DIR/$rel"
    if [ -f "$src" ]; then
      copy_safe "$src" "$ADOPT_TARGET/$rel" framework
    fi
  done

  # CLAUDE.md: sed substitution runs FIRST into a temp file; that temp file
  # is copy_safe's SRC, so a conflicted target gets a fully-substituted
  # CLAUDE.md.upstream, never a raw "[PROJECT_NAME]" template.
  CLAUDE_MD_TMP="$(mktemp)"
  sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE_DIR/CLAUDE.template.md" > "$CLAUDE_MD_TMP"
  copy_safe "$CLAUDE_MD_TMP" "$ADOPT_TARGET/CLAUDE.md" content
  rm -f "$CLAUDE_MD_TMP"

  for pair in "${CONTENT_FILES[@]}"; do
    src_rel="${pair%%|*}"
    dst_rel="${pair#*|}"
    src="$TEMPLATE_DIR/$src_rel"
    if [ ! -f "$src" ]; then
      echo "ERROR: template file missing: $src" >&2
      exit 1
    fi
    copy_safe "$src" "$ADOPT_TARGET/$dst_rel" content
  done

  # --- .obsidian: NOT a copy_safe class (design.md) ---
  # Obsidian auto-executes community-plugins.json + plugins/*/main.js on
  # vault open. If the target already has ANY .obsidian/, our copy is
  # skipped entirely (theirs is live app config; conflicts here are
  # pointless) and any plugin presence is flagged instead of touched.
  if [ -d "$TEMPLATE_DIR/.obsidian" ]; then
    if [ -e "$ADOPT_TARGET/.obsidian" ]; then
      if [ -f "$ADOPT_TARGET/.obsidian/community-plugins.json" ]; then
        ORPHAN_EXEC_LIST+=(".obsidian/community-plugins.json (pre-existing; not overwritten -- Obsidian auto-runs listed plugins on vault open)")
      fi
      if [ -d "$ADOPT_TARGET/.obsidian/plugins" ]; then
        ORPHAN_EXEC_LIST+=(".obsidian/plugins/ (pre-existing; not overwritten -- Obsidian auto-runs plugin main.js on vault open)")
      fi
    else
      run_mut cp -r "$TEMPLATE_DIR/.obsidian" "$ADOPT_TARGET/"
      while IFS= read -r f; do
        obs_rel="${f#"$TEMPLATE_DIR"/}"
        CREATED_LIST+=("$ADOPT_TARGET/$obs_rel")
      done < <(find "$TEMPLATE_DIR/.obsidian" -type f | sort)
    fi
  fi

  # --- Orphan sweep (after copies; design.md step 5) ---
  # Pre-existing files under .claude/** with no template counterpart carry
  # execution/prompt authority once adopted (settings.json pre-approves
  # `bash scripts/*` / `bash .claude/hooks/*`) -- quarantine them to a
  # mirrored .claude.pre-adopt/ tree. Pre-existing files under scripts/**
  # with no template counterpart are left in place (a repo's own scripts/
  # is a common, load-bearing convention) but enumerated as
  # UNREVIEWED-EXECUTABLE. Exclusion rule: any path matching *.pre-adopt or
  # under .claude.pre-adopt/ is never an orphan candidate -- those are
  # copy_safe's own demotion artifacts from the copy pass above (already
  # reported as DEMOTED); without this rule the sweep would relocate them a
  # second time on a re-run and break the "demoted file stays byte-
  # identical beside its canonical path" guarantee. The sweep never
  # appends to CREATED_LIST.

  declare -A TEMPLATE_CLAUDE_RELPATHS=()
  for tree in "${FRAMEWORK_TREES[@]}"; do
    case "$tree" in
      .claude/*)
        src_dir="$TEMPLATE_DIR/$tree"
        [ -d "$src_dir" ] || continue
        while IFS= read -r f; do
          TEMPLATE_CLAUDE_RELPATHS["${f#"$TEMPLATE_DIR"/}"]=1
        done < <(find "$src_dir" -type f)
        ;;
    esac
  done
  for rel in "${FRAMEWORK_FILES[@]}"; do
    case "$rel" in
      .claude/*) TEMPLATE_CLAUDE_RELPATHS["$rel"]=1 ;;
    esac
  done

  declare -A TEMPLATE_SCRIPTS_RELPATHS=()
  for tree in "${FRAMEWORK_TREES[@]}"; do
    case "$tree" in
      scripts/*)
        src_dir="$TEMPLATE_DIR/$tree"
        [ -d "$src_dir" ] || continue
        while IFS= read -r f; do
          TEMPLATE_SCRIPTS_RELPATHS["${f#"$TEMPLATE_DIR"/}"]=1
        done < <(find "$src_dir" -type f)
        ;;
    esac
  done
  for rel in "${FRAMEWORK_FILES[@]}" "${FRAMEWORK_FILES_OPTIONAL[@]}"; do
    case "$rel" in
      scripts/*) TEMPLATE_SCRIPTS_RELPATHS["$rel"]=1 ;;
    esac
  done

  for f in "${PRE_CLAUDE_FILES[@]}"; do
    rel="${f#"$ADOPT_TARGET"/}"
    case "$rel" in
      *.pre-adopt|.claude.pre-adopt/*) continue ;;
    esac
    if [ -z "${TEMPLATE_CLAUDE_RELPATHS[$rel]:-}" ]; then
      dest="$ADOPT_TARGET/.claude.pre-adopt/${rel#.claude/}"
      run_mut mkdir -p "$(dirname "$dest")"
      run_mut mv "$f" "$dest"
      CLAUDE_ORPHAN_LIST+=("$rel -> .claude.pre-adopt/${rel#.claude/}")
    fi
  done

  for f in "${PRE_SCRIPTS_FILES[@]}"; do
    rel="${f#"$ADOPT_TARGET"/}"
    case "$rel" in
      *.pre-adopt|.claude.pre-adopt/*) continue ;;
    esac
    if [ -z "${TEMPLATE_SCRIPTS_RELPATHS[$rel]:-}" ]; then
      ORPHAN_EXEC_LIST+=("$rel")
    fi
  done

  # --- Copy-pass + sweep summary (informational; the full formatted adopt
  # report lands in #T71) ---
  echo ""
  echo "Copy pass summary:"
  echo "  CREATED: ${#CREATED_LIST[@]}"
  echo "  CONFLICT (.upstream, user's file kept canonical): ${#CONFLICT_LIST[@]}"
  for c in "${CONFLICT_LIST[@]}"; do echo "    $c"; done
  echo "  DEMOTED (.pre-adopt, ours is now canonical): ${#DEMOTED_LIST[@]}"
  for d in "${DEMOTED_LIST[@]}"; do echo "    $d"; done
  echo "  CLAUDE ORPHANS quarantined to .claude.pre-adopt/: ${#CLAUDE_ORPHAN_LIST[@]}"
  for o in "${CLAUDE_ORPHAN_LIST[@]}"; do echo "    $o"; done
  echo "  UNREVIEWED-EXECUTABLE (scripts/ orphans + .obsidian plugin flags): ${#ORPHAN_EXEC_LIST[@]}"
  for o in "${ORPHAN_EXEC_LIST[@]}"; do echo "    $o"; done

  # --- Adopt finish steps not yet implemented (#T71) ---
  # Template copies, the orphan sweep, and .obsidian handling are complete
  # and safely re-runnable. gitignore block, .git init, setup.sh --adopt
  # (hook quarantine), generate-manifest.sh, the full formatted adopt
  # report, and the scaffold commit land in #T71. Stop here so a partial
  # adoption can never half-run.
  echo ""
  echo "adopt finish steps pending (#T71)." >&2
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

# Template copies -- iterates the SAME shared lists (FRAMEWORK_TREES,
# FRAMEWORK_FILES, FRAMEWORK_FILES_OPTIONAL, CONTENT_FILES) that adopt mode
# drives through copy_safe/copy_tree_safe above. Fresh mode has no
# collisions to resolve (the directory was just created empty), so it uses
# plain cp -- but the file LIST is the single source of truth for both
# modes (design.md acceptance criterion: no second copy list introduced).
for tree in "${FRAMEWORK_TREES[@]}"; do
  cp -r "$TEMPLATE_DIR/$tree" "$FULL_PATH/$(dirname "$tree")/"
done

for rel in "${FRAMEWORK_FILES[@]}"; do
  cp "$TEMPLATE_DIR/$rel" "$FULL_PATH/$rel"
done

for rel in "${FRAMEWORK_FILES_OPTIONAL[@]}"; do
  [ -f "$TEMPLATE_DIR/$rel" ] && cp "$TEMPLATE_DIR/$rel" "$FULL_PATH/$rel"
done

sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE_DIR/CLAUDE.template.md" > "$FULL_PATH/CLAUDE.md"

for pair in "${CONTENT_FILES[@]}"; do
  src_rel="${pair%%|*}"
  dst_rel="${pair#*|}"
  cp "$TEMPLATE_DIR/$src_rel" "$FULL_PATH/$dst_rel"
done

touch "$FULL_PATH/docs/specs/.gitkeep"
touch "$FULL_PATH/docs/memory/.gitkeep"

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
