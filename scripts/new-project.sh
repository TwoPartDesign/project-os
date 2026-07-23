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
#   The adopt copy engine (template copies, orphan sweep, .obsidian
#   handling) is #T70; the finish sequence (chmod, gitignore block, .git
#   init, setup.sh --adopt hook quarantine, generate-manifest.sh, the full
#   adopt report, and the scaffold commit) is #T71. --dry-run runs the full
#   classification + report with zero writes; a real run exits 0 on
#   success.

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

# gitignore_template -- prints the template .gitignore content to stdout.
# Single source for BOTH modes (fresh mode writes it verbatim; adopt mode's
# merge_gitignore below diffs against it). *.pre-adopt and
# .claude.pre-adopt/ sit alongside *.upstream -- all three are adopt-mode
# demotion/conflict artifacts that must never be committed.
gitignore_template() {
  cat <<'GI'
CLAUDE.local.md
.claude/sessions/
.claude/logs/
.claude/settings.local.json
.claude/backups/
*.upstream
*.pre-adopt
.claude.pre-adopt/
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
}

MARK_START="# >>> project-os >>>"
MARK_END="# <<< project-os <<<"

# merge_gitignore TARGET -- adopt-mode .gitignore step (design.md step 6).
# TARGET absent -> write the template verbatim (sets GITIGNORE_MODIFIED=1).
# TARGET present -> normalize the whole file to LF for comparison, strip any
# existing project-os marker block (wherever it sits), recompute the block
# from template lines not already present verbatim elsewhere in the file
# (dedup), and re-append it at the end -- so a second run always finds the
# block already in its recomputed position and converges (idempotent) even
# though the block may move to EOF on its first rewrite. The WHOLE file is
# then re-rendered using the file's ORIGINAL dominant line ending (CRLF if a
# majority of its original lines ended \r\n, else LF), which guarantees no
# mixed-ending duplicates rather than trying to preserve line endings
# per-region. Sets GITIGNORE_MODIFIED=1 only if the resulting bytes differ
# from what was on disk.
GITIGNORE_MODIFIED=0
merge_gitignore() {
  target="$1"
  GITIGNORE_MODIFIED=0

  if [ ! -e "$target" ]; then
    tmp_out="$(mktemp)"
    gitignore_template > "$tmp_out"
    run_mut cp "$tmp_out" "$target"
    rm -f "$tmp_out"
    GITIGNORE_MODIFIED=1
    return 0
  fi

  # Dominant line ending of the file AS IT EXISTS ON DISK right now.
  total_lines="$(wc -l < "$target" | tr -d ' ')"
  crlf_lines="$(grep -c $'\r$' "$target" 2>/dev/null || true)"
  crlf_lines="${crlf_lines:-0}"
  eol=$'\n'
  if [ "${total_lines:-0}" -gt 0 ] && [ "$crlf_lines" -ge $(( (total_lines + 1) / 2 )) ]; then
    eol=$'\r\n'
  fi

  mapfile -t all_lines < <(sed 's/\r$//' "$target")

  before=()
  in_block=0
  for line in "${all_lines[@]}"; do
    if [ "$line" = "$MARK_START" ]; then in_block=1; continue; fi
    if [ "$line" = "$MARK_END" ]; then in_block=0; continue; fi
    [ "$in_block" -eq 1 ] && continue
    before+=("$line")
  done

  mapfile -t template_lines < <(gitignore_template)

  # Blank lines are template FORMATTING (section separators), never
  # dedupeable content -- deduping them against "before" would (a) collapse
  # every blank the template has whenever the user's own .gitignore already
  # contains any blank line, and (b) on a re-run, collapse them all against
  # the single separator blank this function itself writes just before
  # MARK_START (see final[] below), which survives stripping because it
  # sits OUTSIDE the marker block and so lands back in "before" next time.
  # Always keep every blank line from the template; only dedupe real
  # patterns.
  block=()
  for tline in "${template_lines[@]}"; do
    if [ -z "$tline" ]; then
      block+=("$tline")
      continue
    fi
    found=0
    for eline in "${before[@]}"; do
      if [ "$eline" = "$tline" ]; then found=1; break; fi
    done
    if [ "$found" -eq 0 ]; then block+=("$tline"); fi
  done

  final=("${before[@]}")
  if [ "${#final[@]}" -gt 0 ] && [ -n "${final[${#final[@]}-1]}" ]; then
    final+=("")
  fi
  final+=("$MARK_START" "${block[@]}" "$MARK_END")

  tmp_out="$(mktemp)"
  for l in "${final[@]}"; do
    printf "%s%s" "$l" "$eol" >> "$tmp_out"
  done

  if ! cmp -s "$tmp_out" "$target"; then
    GITIGNORE_MODIFIED=1
    run_mut cp "$tmp_out" "$target"
  fi
  rm -f "$tmp_out"
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
  "scripts/detect-stack.ts"
  "scripts/skill-apply.ts"
  "scripts/skill-ledger.ts"
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
  "docs/knowledge/skill-edit-rejections.md|docs/knowledge/skill-edit-rejections.md"
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
  # root, template-managed root file, or ANY path NESTED beneath one of the
  # managed trees, is a symlink. Prevents scaffold writes from
  # escaping the target through a planted link. copy_safe/copy_tree_safe's
  # `mkdir -p` and `cp`/`mv` write THROUGH a destination symlink -- a link
  # planted deep inside .claude/, scripts/, docs/, or .obsidian/ lets a
  # scaffold write land outside ADOPT_TARGET. (The `find` calls those
  # helpers use walk TEMPLATE_DIR -- the read-only *source* tree -- and not
  # following symlinked directories there protects against a hostile
  # template, not a hostile destination; it says nothing about writes into
  # ADOPT_TARGET, so it cannot substitute for scanning the destination.)
  # Scope: top-level entries directly under the target (.claude, scripts,
  # docs, .obsidian trees + root files) via -L, PLUS a recursive `find
  # -type l` under each of those trees (only for trees that exist) to catch
  # nested links.
  SYMLINK_HITS=()
  for rel in .claude scripts docs .obsidian CLAUDE.md ROADMAP.md global-CLAUDE.md .gitignore; do
    path="$ADOPT_TARGET/$rel"
    if [ -L "$path" ]; then
      SYMLINK_HITS+=("$path")
    fi
  done
  for rel in .claude scripts docs .obsidian; do
    dir="$ADOPT_TARGET/$rel"
    [ -d "$dir" ] || continue
    while IFS= read -r link; do
      SYMLINK_HITS+=("$link")
    done < <(find "$dir" -type l | sort)
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
  # \( -type f -o -type l \) (not just -type f) so a symlink orphan is seen
  # by the sweep too -- defense-in-depth behind the pre-flight symlink
  # refusal above, which already hard-fails before any of this runs; in
  # practice a symlink here means the pre-flight scan above missed it.
  PRE_CLAUDE_FILES=()
  if [ -d "$ADOPT_TARGET/.claude" ]; then
    while IFS= read -r f; do PRE_CLAUDE_FILES+=("$f"); done < <(find "$ADOPT_TARGET/.claude" \( -type f -o -type l \) | sort)
  fi
  PRE_SCRIPTS_FILES=()
  if [ -d "$ADOPT_TARGET/scripts" ]; then
    while IFS= read -r f; do PRE_SCRIPTS_FILES+=("$f"); done < <(find "$ADOPT_TARGET/scripts" \( -type f -o -type l \) | sort)
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
  for rel in "${FRAMEWORK_FILES[@]}"; do
    case "$rel" in
      scripts/*) TEMPLATE_SCRIPTS_RELPATHS["$rel"]=1 ;;
    esac
  done
  # FRAMEWORK_FILES_OPTIONAL entries only count as template-known if they
  # actually exist in TEMPLATE_DIR (mirrors the copy pass's own [ -f ... ]
  # guard above) -- otherwise a pre-existing target file at an absent-
  # optional path would silently escape UNREVIEWED-EXECUTABLE reporting.
  for rel in "${FRAMEWORK_FILES_OPTIONAL[@]}"; do
    case "$rel" in
      scripts/*)
        [ -f "$TEMPLATE_DIR/$rel" ] && TEMPLATE_SCRIPTS_RELPATHS["$rel"]=1
        ;;
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

  # --- chmod +x on adopt-copied .sh files (mirrors fresh-mode's chmod step
  # below; deferred from #T70) --- Driven from CREATED_LIST (files the
  # scaffold itself just placed/overwrote under scripts/, .claude/hooks/,
  # .claude/security/) rather than a blanket `find ... -name "*.sh"` -- a
  # blanket find would also chmod +x any *pre-existing* orphan .sh file the
  # target already had at those paths, actively escalating the accepted
  # UNREVIEWED-EXECUTABLE residual risk instead of merely reporting it. At
  # this point in the run CREATED_LIST holds only entries from the copy
  # pass + .obsidian copy above (the manifest/system-map "extra" files are
  # appended later, after this step, and are never .sh anyway).
  for f in "${CREATED_LIST[@]}"; do
    rel="${f#"$ADOPT_TARGET"/}"
    case "$rel" in
      scripts/*.sh|.claude/hooks/*.sh|.claude/security/*.sh)
        run_mut chmod +x "$f"
        ;;
    esac
  done

  # --- .gitignore (design.md step 6) ---
  merge_gitignore "$ADOPT_TARGET/.gitignore"

  # --- git init only when no .git (file or dir) already exists (step 7) ---
  if [ ! -e "$ADOPT_TARGET/.git" ]; then
    run_mut git -C "$ADOPT_TARGET" init --quiet
  fi

  # --- Git hook quarantine classification (step 8) ---
  # Mirrors security-scanner.ts's own "already ours?" marker check so the
  # report (and --dry-run) reflect what setup.sh --adopt will do (or would
  # do) without requiring it to actually run first. Read-only -- never
  # gated by DRY_RUN. A brand-new `git init` has no hooks dir contents yet,
  # so this naturally finds nothing to quarantine on a target with no prior
  # .git.
  if HOOKS_DIR="$(git -C "$ADOPT_TARGET" rev-parse --git-path hooks 2>/dev/null)"; then
    case "$HOOKS_DIR" in
      /*|[A-Za-z]:*) : ;;
      *) HOOKS_DIR="$ADOPT_TARGET/$HOOKS_DIR" ;;
    esac
    # Same 20 standard hook names security-scanner.ts's ALL_GIT_HOOK_NAMES
    # quarantines in --no-chain mode -- keep the lists in sync (review r2
    # MEDIUM: the report, and especially --dry-run, must reflect the full
    # quarantine scope, not just pre-commit/pre-push).
    for hook in applypatch-msg pre-applypatch post-applypatch pre-commit \
                pre-merge-commit prepare-commit-msg commit-msg post-commit \
                pre-rebase post-checkout post-merge pre-push pre-receive \
                update post-receive post-update push-to-checkout pre-auto-gc \
                post-rewrite sendemail-validate; do
      hook_path="$HOOKS_DIR/$hook"
      if [ -f "$hook_path" ] && ! grep -q "Auto-installed by Project OS security scanner" "$hook_path" 2>/dev/null; then
        QUARANTINED_HOOKS+=("$hook")
      fi
    done
  fi

  # --- setup.sh --adopt: installs hooks in quarantine mode (--no-chain),
  # renaming any pre-existing unmarked hook to <hook>.pre-adopt instead of
  # chaining it (step 8 continued). install-hooks.sh -> security-scanner.ts
  # resolve the git/project root from the PROCESS cwd (process.cwd()), not
  # from the script's own path -- so, mirroring fresh mode's `cd
  # "$FULL_PATH"` before its own setup.sh call, this must run with cwd
  # already inside ADOPT_TARGET. bash -c keeps this a single command for
  # run_mut (which just execs its argv, no shell parsing of its own).
  #
  # Failure is NOT swallowed: a failing setup.sh --adopt means hook
  # quarantine/install may be incomplete, so the run must not silently
  # proceed to a success-shaped report and a commit. On failure this
  # records a WARNINGS entry (surfaced in the report below), and after the
  # report prints, the run exits nonzero WITHOUT committing (see the
  # SETUP_FAILED check just before the commit step). ---
  SETUP_FAILED=0
  if ! run_mut bash -c 'cd "$1" && exec bash "$1/scripts/setup.sh" --adopt' _ "$ADOPT_TARGET"; then
    SETUP_FAILED=1
    WARNINGS+=("setup.sh --adopt FAILED -- hook install/quarantine may be incomplete. Nothing was committed. Review the output above, run 'cd $ADOPT_TARGET && bash scripts/setup.sh --adopt' manually, then re-run this adopt (idempotent) to commit.")
  fi

  # --- generate-manifest.sh, invoked exactly as fresh mode does (step 9).
  # scripts/ is framework class, so this copy is guaranteed ours. ---
  TEMPLATE_VERSION=$(git -C "$TEMPLATE_DIR" describe --tags --abbrev=0 2>/dev/null || echo "unknown")
  run_mut bash "$ADOPT_TARGET/scripts/generate-manifest.sh" "$TEMPLATE_VERSION"

  # --- .claude/manifest.json and docs/maps/* are generated IN PLACE by
  # generate-manifest.sh / setup.sh's system-map step above, not via
  # copy_safe, so they never landed in CREATED_LIST. Add any that exist and
  # are not already tracked by git so they ride the same commit pathspec as
  # everything else (never rely on the pre-commit hook's own auto-heal
  # staging to carry them in -- that only fires if the hook happens to run
  # and succeed). Skip already-tracked files so a completed-run re-adopt
  # (setup.sh --adopt / generate-manifest.sh are both idempotent and leave
  # these byte-identical) doesn't manufacture a non-empty CREATED_LIST and
  # break the "skip commit when nothing changed" guarantee.
  if [ "$DRY_RUN" -eq 0 ]; then
    for extra in "$ADOPT_TARGET/.claude/manifest.json" "$ADOPT_TARGET/docs/maps/.maps.lock" "$ADOPT_TARGET/docs/maps/module-graph.mmd" "$ADOPT_TARGET/docs/maps/system-map.md"; do
      if [ -f "$extra" ] && ! git -C "$ADOPT_TARGET" ls-files --error-unmatch "${extra#"$ADOPT_TARGET"/}" >/dev/null 2>&1; then
        CREATED_LIST+=("$extra")
      fi
    done
  fi

  # --- Adopt report, printed BEFORE any commit (step 10). Always printed --
  # even when setup.sh --adopt failed -- so the operator sees exactly what
  # WAS staged/classified before deciding how to recover. ---
  echo ""
  echo "===== ADOPT REPORT ====="
  if [ "$SETUP_FAILED" -eq 1 ]; then
    echo ""
    echo "*** SETUP FAILED: scripts/setup.sh --adopt did not complete successfully. ***"
    echo "*** Hook install/quarantine may be incomplete. Nothing will be committed. ***"
  fi
  echo ""
  echo "CREATED (${#CREATED_LIST[@]} files):"
  if [ "${#CREATED_LIST[@]}" -gt 20 ]; then
    for f in "${CREATED_LIST[@]:0:20}"; do echo "  $f"; done
    echo "  ...and $(( ${#CREATED_LIST[@]} - 20 )) more"
  else
    for f in "${CREATED_LIST[@]}"; do echo "  $f"; done
  fi
  echo ""
  echo "CONFLICT -- your file kept canonical; ours landed beside it as <file>.upstream, review and merge by hand (${#CONFLICT_LIST[@]}):"
  for f in "${CONFLICT_LIST[@]}"; do echo "  $f"; done
  echo ""
  echo "DEMOTED -- review before your next Claude session: these previously held execution authority (${#DEMOTED_LIST[@]} + ${#CLAUDE_ORPHAN_LIST[@]} orphans):"
  for f in "${DEMOTED_LIST[@]}"; do echo "  $f"; done
  for f in "${CLAUDE_ORPHAN_LIST[@]}"; do echo "  $f"; done
  echo ""
  echo "UNREVIEWED-EXECUTABLE -- template settings.json permissions pre-approve running scripts/*.sh; review these before your next session (${#ORPHAN_EXEC_LIST[@]}):"
  for f in "${ORPHAN_EXEC_LIST[@]}"; do echo "  $f"; done
  echo ""
  echo "QUARANTINED GIT HOOKS -- renamed <hook>.pre-adopt, never chained; review and manually reinstall if wanted (${#QUARANTINED_HOOKS[@]}):"
  for h in "${QUARANTINED_HOOKS[@]}"; do echo "  $h"; done
  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo ""
    echo "WARNINGS:"
    for w in "${WARNINGS[@]}"; do echo "  $w"; done
  fi
  echo ""
  echo "Next step: cd $ADOPT_TARGET && claude, then run /tools:init to fill in project variables."
  echo ""

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "(--dry-run: no files were written; the report above reflects the plan a real run would execute.)"
    exit 0
  fi

  # setup.sh --adopt failed above: the report has been printed (with the
  # SETUP FAILED banner and the WARNINGS entry) but nothing is committed --
  # exit nonzero so the failure cannot be mistaken for a successful adopt.
  if [ "$SETUP_FAILED" -eq 1 ]; then
    echo "Exiting nonzero: setup.sh --adopt failed. Nothing was committed. See SETUP FAILED / WARNINGS above."
    exit 1
  fi

  # --- Commit (adopt), step 11. NEVER git add . / git add -A here: only the
  # files this run actually created (+ .gitignore if it changed) may be
  # staged, so a pre-existing repo's other untracked/modified files are
  # never swept into our commit. ---
  if ! git -C "$ADOPT_TARGET" diff --cached --quiet 2>/dev/null; then
    echo "Skipping commit: $ADOPT_TARGET's git index already has staged changes."
    echo "Review the CREATED files listed above, then stage and commit yourself, e.g.:"
    echo "  git -C \"$ADOPT_TARGET\" add <files>"
    echo "  git -C \"$ADOPT_TARGET\" commit -m \"chore: adopt Project OS scaffold\""
    exit 0
  fi

  PATHSPEC_FILE="$(mktemp)"
  for f in "${CREATED_LIST[@]}"; do
    printf '%s\n' "${f#"$ADOPT_TARGET"/}" >> "$PATHSPEC_FILE"
  done
  if [ "$GITIGNORE_MODIFIED" -eq 1 ]; then
    printf '%s\n' ".gitignore" >> "$PATHSPEC_FILE"
  fi

  if [ ! -s "$PATHSPEC_FILE" ]; then
    echo "Nothing to commit (no new or changed files this run)."
    rm -f "$PATHSPEC_FILE"
    exit 0
  fi

  git -C "$ADOPT_TARGET" add --pathspec-from-file="$PATHSPEC_FILE"
  rm -f "$PATHSPEC_FILE"

  COMMIT_MSG_FILE="$(mktemp)"
  printf 'chore: adopt Project OS scaffold\n' > "$COMMIT_MSG_FILE"
  git -C "$ADOPT_TARGET" commit --quiet -F "$COMMIT_MSG_FILE"
  rm -f "$COMMIT_MSG_FILE"

  echo "Committed Project OS scaffold to $ADOPT_TARGET."
  exit 0
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
# Single source of truth shared with adopt mode's merge_gitignore (see
# gitignore_template() above) -- keeps *.pre-adopt/.claude.pre-adopt/
# entries in sync across both modes without a second copy of this list.
gitignore_template > .gitignore

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
