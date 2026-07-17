#!/usr/bin/env bash
# tests/new-project-smoke.sh — end-to-end smoke test for the drop-in path
# (fresh bootstrap) AND the in-place adopt path (#T74).
#
# Fresh-bootstrap section: bootstraps a throwaway project via
# scripts/new-project.sh into a temp dir and asserts the project is actually
# usable: structure created, scripts (incl. the self-maintenance additions)
# copied, git initialized with the scaffold commit, git hooks installed by
# setup.sh, the initial system map generated, ROADMAP valid, and core
# lifecycle scripts runnable. Also verifies setup.sh is idempotent.
#
# Adopt-mode section: builds seeded fixture repos (legit + hostile elements
# per docs/specs/adopt-existing-project/design.md §Testing Strategy) and
# exercises `new-project.sh --adopt` against them -- content/framework
# collision handling, orphan quarantine, git-hook quarantine, .gitignore
# merge (LF + CRLF), completed-run idempotency, --dry-run zero-write, git
# history preservation (clean + pre-staged variants), manifest safety via the
# real update-project.sh --local-upstream classifier, and the three
# pre-flight refusals (already-adopted, symlinked .claude, nested no-.git).
#
# Requires Node + a configured git identity (present in dev/CI). Runs fully
# offline (no gh CLI, no network).
#
# Usage: bash tests/new-project-smoke.sh
# Exit: 0 if every assertion passes, 1 otherwise.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
NEW_PROJECT="$REPO_ROOT/scripts/new-project.sh"

FAIL=0
TMP=""
CLEANUP_DIRS=()

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

cleanup() {
    [ -n "$TMP" ] && rm -rf "$TMP" 2>/dev/null || true
    for d in "${CLEANUP_DIRS[@]}"; do
        [ -n "$d" ] && rm -rf "$d" 2>/dev/null || true
    done
}
trap cleanup EXIT

assert_file() { if [ -f "$1" ]; then pass "$2"; else fail "$2 (missing: $1)"; fi; }
assert_dir()  { if [ -d "$1" ]; then pass "$2"; else fail "$2 (missing dir: $1)"; fi; }
assert_eq() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 (expected '$1', got '$2')"; fi; }
assert_bytes_identical() {
    if [ -f "$1" ] && [ -f "$2" ] && cmp -s "$1" "$2"; then
        pass "$3"
    else
        fail "$3 (not byte-identical: $1 vs $2)"
    fi
}
# assert_contains HAYSTACK NEEDLE DESC -- substring check via case (errexit-safe, no grep exit-code risk)
assert_contains() {
    case "$1" in
        *"$2"*) pass "$3" ;;
        *) fail "$3 (missing substring: $2)" ;;
    esac
}
assert_not_contains() {
    case "$1" in
        *"$2"*) fail "$3 (unexpected substring present: $2)" ;;
        *) pass "$3" ;;
    esac
}

# --- Adopt-scenario helpers (#T74) ------------------------------------------

# new_tmp -- creates a fresh mktemp -d dir, registers it for cleanup, prints its path.
new_tmp() {
    local d
    d="$(mktemp -d)"
    CLEANUP_DIRS+=("$d")
    printf '%s' "$d"
}

safe_cat() { if [ -f "$1" ]; then cat "$1"; else printf '<MISSING:%s>' "$1"; fi; }

# hash_tree DIR [EXCLUDE_SUBSTRING] -- order-independent content hash of every
# regular file under DIR (relative path + sha256), skipping any relative path
# containing EXCLUDE_SUBSTRING. Used to prove "zero writes" / "byte-identical
# tree" without being defeated by files whose content is expected to vary
# (e.g. manifest.json's generation timestamp).
hash_tree() {
    local dir="$1"
    local exclude="${2:-}"
    {
        while IFS= read -r f; do
            local rel="${f#"$dir"/}"
            if [ -n "$exclude" ]; then
                case "$rel" in *"$exclude"*) continue ;; esac
            fi
            printf '%s %s\n' "$rel" "$(sha256sum "$f" | cut -d' ' -f1)"
        done < <(find "$dir" -type f 2>/dev/null | LC_ALL=C sort)
    } | sha256sum | cut -d' ' -f1
}

count_files_matching() {
    find "$1" -type f -name "$2" 2>/dev/null | wc -l | tr -d ' '
}

# run_adopt NEW_PROJECT_SCRIPT TARGET [extra adopt flags...]
# Sets ADOPT_OUT (combined stdout+stderr) and ADOPT_EC (exit code).
run_adopt() {
    local script="$1"
    local target="$2"
    shift 2
    set +e
    ADOPT_OUT="$(bash "$script" --adopt "$target" "$@" 2>&1)"
    ADOPT_EC=$?
    set -e
}

# seed_fixture DIR [crlf] -- builds a seeded fake pre-existing repo containing
# BOTH legit and hostile adopt-target elements (design.md §Testing Strategy):
# own CLAUDE.md, tuned .gitignore (optionally CRLF), package.json +
# pnpm-lock.yaml, src/app.ts, own .claude/settings.json (framework collision),
# own .claude/commands/mycmd.md (non-template orphan), own scripts/setup.sh
# (framework collision) and scripts/build.js (non-template orphan), planted
# .obsidian/plugins/x/main.js + community-plugins.json, pre-planted unmarked
# .git/hooks/pre-commit, and real git history (one commit, clean index).
seed_fixture() {
    local dir="$1"
    local crlf="${2:-}"

    mkdir -p "$dir"
    printf '# My Own Project\n\nThis is my own CLAUDE.md. Do not overwrite it.\n' > "$dir/CLAUDE.md"

    if [ "$crlf" = "crlf" ]; then
        printf 'node_modules/\r\nmy-secret.local\r\ndist/\r\n' > "$dir/.gitignore"
    else
        printf 'node_modules/\nmy-secret.local\ndist/\n' > "$dir/.gitignore"
    fi

    printf '{\n  "name": "fixture-app",\n  "version": "1.0.0"\n}\n' > "$dir/package.json"
    printf 'lockfileVersion: 5.4\n' > "$dir/pnpm-lock.yaml"
    mkdir -p "$dir/src"
    printf 'export const greeting = "hi";\n' > "$dir/src/app.ts"

    mkdir -p "$dir/.claude/commands"
    printf '{\n  "hooks": {}\n}\n' > "$dir/.claude/settings.json"
    printf '# My Command\n\nCustom user command, not a template name.\n' > "$dir/.claude/commands/mycmd.md"

    mkdir -p "$dir/scripts"
    printf '#!/bin/sh\necho "my own setup, not the template"\n' > "$dir/scripts/setup.sh"
    printf 'console.log("my own build script");\n' > "$dir/scripts/build.js"

    mkdir -p "$dir/.obsidian/plugins/x"
    printf 'module.exports = {};\n' > "$dir/.obsidian/plugins/x/main.js"
    printf '["x"]\n' > "$dir/.obsidian/community-plugins.json"

    mkdir -p "$dir/docs/knowledge"
    printf '# My Decisions\n\nWe decided X.\n' > "$dir/docs/knowledge/decisions.md"

    git -C "$dir" init --quiet
    git -C "$dir" config user.email "fixture@test.local"
    git -C "$dir" config user.name "Fixture Tester"

    mkdir -p "$dir/.git/hooks"
    printf '#!/bin/sh\necho "custom pre-commit"\n' > "$dir/.git/hooks/pre-commit"
    chmod +x "$dir/.git/hooks/pre-commit" 2>/dev/null || true

    git -C "$dir" add -A
    git -C "$dir" commit --quiet -m "seed: initial fixture repo"
}

# build_template_checkout DEST -- copies just the paths new-project.sh's
# adopt mode / update-project.sh's classifier actually read (mirrors
# generate-manifest.sh's TEMPLATE_DIRS/TEMPLATE_FILES/TEMPLATE_SCRIPTS) out of
# this worktree's CURRENT working tree (including any uncommitted pulls from
# master -- see task setup) into a standalone directory. Running
# DEST/scripts/new-project.sh --adopt self-resolves its TEMPLATE_DIR to DEST,
# so DEST behaves as an independent "upstream checkout" for scenario 9.
build_template_checkout() {
    local dest="$1"
    mkdir -p "$dest/.claude"
    local sub
    for sub in commands agents skills rules hooks security; do
        cp -r "$REPO_ROOT/.claude/$sub" "$dest/.claude/$sub"
    done
    cp "$REPO_ROOT/.claude/settings.json" "$dest/.claude/settings.json"
    cp "$REPO_ROOT/.claude/maintenance-policy.yaml" "$dest/.claude/maintenance-policy.yaml"
    cp -r "$REPO_ROOT/scripts" "$dest/scripts"
    mkdir -p "$dest/docs/knowledge"
    local f
    for f in decisions.md patterns.md bugs.md architecture.md kv.md metrics.md; do
        cp "$REPO_ROOT/docs/knowledge/$f" "$dest/docs/knowledge/$f"
    done
    cp "$REPO_ROOT/CLAUDE.template.md" "$dest/CLAUDE.template.md"
    cp "$REPO_ROOT/ROADMAP.template.md" "$dest/ROADMAP.template.md"
    cp "$REPO_ROOT/global-CLAUDE.md" "$dest/global-CLAUDE.md"
    if [ -d "$REPO_ROOT/.obsidian" ]; then
        cp -r "$REPO_ROOT/.obsidian" "$dest/.obsidian"
    fi
}

if ! command -v node >/dev/null 2>&1; then
    echo "SKIP: Node not available — the drop-in path needs Node 22.18+."
    exit 0
fi

TMP="$(mktemp -d)"
PROJ="$TMP/testproj"

# --- Bootstrap ----------------------------------------------------------------
echo "Bootstrapping a project via new-project.sh ..."
set +e
OUT="$(bash "$NEW_PROJECT" "testproj" "$TMP" 2>&1)"
EC=$?
set -e
if [ "$EC" -eq 0 ]; then
    pass "new-project.sh exits 0"
else
    fail "new-project.sh exited $EC: $OUT"
    echo "$FAIL assertion(s) failed"
    exit 1
fi

# --- Structure ----------------------------------------------------------------
assert_dir  "$PROJ/.claude/commands/workflows" "workflow commands copied"
assert_dir  "$PROJ/.claude/hooks"              "hooks copied"
assert_file "$PROJ/CLAUDE.md"                  "CLAUDE.md created"
assert_file "$PROJ/ROADMAP.md"                 "ROADMAP.md created"
assert_file "$PROJ/.claude/settings.json"      "settings.json copied"
assert_file "$PROJ/.claude/maintenance-policy.yaml" "maintenance-policy.yaml copied"

# --- Scripts (incl. self-maintenance + activation additions) ------------------
for s in setup.sh install-hooks.sh install-global-commands.sh maintain.sh \
         dream-accept.sh validate-roadmap.sh generate-manifest.sh; do
    assert_file "$PROJ/scripts/$s" "script copied: $s"
done
for t in system-map.ts maintain-draft.ts knowledge-index.ts security-scanner.ts; do
    assert_file "$PROJ/scripts/$t" "script copied: $t"
done
assert_file "$PROJ/scripts/lib/project-root.ts"   "lib copied: project-root.ts"
assert_file "$PROJ/scripts/lib/system-map-lib.ts" "lib copied: system-map-lib.ts"

# --- Git + activation ---------------------------------------------------------
assert_dir "$PROJ/.git" "git repository initialized"
if git -C "$PROJ" log --oneline 2>/dev/null | grep -q "initialize project"; then
    pass "scaffold commit present"
else
    fail "scaffold commit missing"
fi
if [ -f "$PROJ/.git/hooks/pre-commit" ] && grep -q "security-scanner.ts scan-staged" "$PROJ/.git/hooks/pre-commit" 2>/dev/null; then
    pass "setup.sh installed the git pre-commit hook"
else
    fail "git pre-commit hook not installed by setup.sh"
fi
assert_file "$PROJ/docs/maps/.maps.lock" "initial system map generated by setup.sh"
assert_file "$PROJ/.claude/manifest.json" "update manifest generated"

# --- ROADMAP validity ---------------------------------------------------------
set +e
bash "$PROJ/scripts/validate-roadmap.sh" "$PROJ/ROADMAP.md" >/dev/null 2>&1
VR=$?
set -e
if [ "$VR" -eq 0 ]; then pass "bootstrapped ROADMAP.md is valid"; else fail "bootstrapped ROADMAP.md fails validation"; fi

# --- Lifecycle scripts run in the new project ---------------------------------
set +e
(cd "$PROJ" && node scripts/system-map.ts check >/dev/null 2>&1)
SM=$?
set -e
if [ "$SM" -eq 0 ]; then pass "system-map.ts check exits 0 (committed maps fresh)"; else fail "system-map.ts check exited $SM in new project"; fi

set +e
(cd "$PROJ" && bash scripts/maintain.sh --dry-run >/dev/null 2>&1)
MT=$?
set -e
if [ "$MT" -eq 0 ]; then pass "maintain.sh --dry-run exits 0"; else fail "maintain.sh --dry-run exited $MT in new project"; fi

# --- setup.sh idempotence -----------------------------------------------------
set +e
SETUP_OUT="$(cd "$PROJ" && bash scripts/setup.sh --check 2>&1)"
SU=$?
set -e
if [ "$SU" -eq 0 ] && [ -z "$SETUP_OUT" ]; then
    pass "setup.sh --check is idempotent (silent no-op when already set up)"
else
    fail "setup.sh --check not idempotent: exit=$SU out='$SETUP_OUT'"
fi

# ================================================================================
# Adopt-mode scenarios (#T74) -- design.md §Testing Strategy scenarios 1-11.
# Each scenario builds its own seeded fixture via seed_fixture() (isolation:
# no shared mutable state between scenarios). Scenario 11 (all 29
# fresh-bootstrap assertions above still pass) is satisfied by construction:
# this is the same suite run, same $FAIL counter, executed top to bottom.
# ================================================================================

# --- Scenario 1: content-class files preserved; CLAUDE.md.upstream substituted -
echo ""
echo "=== Adopt scenario 1: content-class files byte-identical; CLAUDE.md.upstream substituted ==="
S1="$(new_tmp)"
seed_fixture "$S1"
CLAUDE_BEFORE="$(safe_cat "$S1/CLAUDE.md")"
DECISIONS_BEFORE="$(safe_cat "$S1/docs/knowledge/decisions.md")"
run_adopt "$NEW_PROJECT" "$S1"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario1: adopt exits 0"; else fail "scenario1: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
assert_eq "$CLAUDE_BEFORE" "$(safe_cat "$S1/CLAUDE.md")" "scenario1: canonical CLAUDE.md byte-identical to user's original"
assert_eq "$DECISIONS_BEFORE" "$(safe_cat "$S1/docs/knowledge/decisions.md")" "scenario1: canonical decisions.md byte-identical to user's original"
assert_file "$S1/CLAUDE.md.upstream" "scenario1: CLAUDE.md.upstream created"
if [ -f "$S1/CLAUDE.md.upstream" ]; then
    UP_CONTENT="$(cat "$S1/CLAUDE.md.upstream")"
    assert_not_contains "$UP_CONTENT" "[PROJECT_NAME]" "scenario1: CLAUDE.md.upstream has no literal [PROJECT_NAME]"
    EXPECTED_NAME="$(basename "$S1")"
    assert_contains "$UP_CONTENT" "$EXPECTED_NAME" "scenario1: CLAUDE.md.upstream contains derived project name '$EXPECTED_NAME'"
else
    fail "scenario1: CLAUDE.md.upstream missing, cannot check substitution"
fi
assert_file "$S1/docs/knowledge/decisions.md.upstream" "scenario1: decisions.md.upstream created (content conflict)"

# --- Scenario 2: framework collisions -- ours wins canonical, theirs demoted --
echo ""
echo "=== Adopt scenario 2: framework-class collisions demoted, ours wins canonical ==="
S2="$(new_tmp)"
seed_fixture "$S2"
SETTINGS_BEFORE="$(safe_cat "$S2/.claude/settings.json")"
SETUP_BEFORE="$(safe_cat "$S2/scripts/setup.sh")"
run_adopt "$NEW_PROJECT" "$S2"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario2: adopt exits 0"; else fail "scenario2: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
assert_bytes_identical "$S2/.claude/settings.json" "$REPO_ROOT/.claude/settings.json" "scenario2: canonical settings.json is ours"
assert_bytes_identical "$S2/scripts/setup.sh" "$REPO_ROOT/scripts/setup.sh" "scenario2: canonical setup.sh is ours"
assert_file "$S2/.claude/settings.json.pre-adopt" "scenario2: .claude/settings.json.pre-adopt created"
assert_eq "$SETTINGS_BEFORE" "$(safe_cat "$S2/.claude/settings.json.pre-adopt")" "scenario2: user's settings.json preserved byte-identical at .pre-adopt"
assert_file "$S2/scripts/setup.sh.pre-adopt" "scenario2: scripts/setup.sh.pre-adopt created"
assert_eq "$SETUP_BEFORE" "$(safe_cat "$S2/scripts/setup.sh.pre-adopt")" "scenario2: user's setup.sh preserved byte-identical at .pre-adopt"
assert_contains "$ADOPT_OUT" ".claude/settings.json" "scenario2: settings.json listed in DEMOTED report section"
assert_contains "$ADOPT_OUT" "scripts/setup.sh" "scenario2: setup.sh listed in DEMOTED report section"

# --- Scenario 3: orphan handling -- .claude quarantined, scripts flagged, obsidian flagged -
echo ""
echo "=== Adopt scenario 3: orphan handling (.claude quarantine, scripts flag, .obsidian flag) ==="
S3="$(new_tmp)"
seed_fixture "$S3"
MYCMD_BEFORE="$(safe_cat "$S3/.claude/commands/mycmd.md")"
BUILD_BEFORE="$(safe_cat "$S3/scripts/build.js")"
run_adopt "$NEW_PROJECT" "$S3"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario3: adopt exits 0"; else fail "scenario3: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
if [ -f "$S3/.claude/commands/mycmd.md" ]; then
    fail "scenario3: .claude/commands/mycmd.md still at original path (should be quarantined)"
else
    pass "scenario3: .claude/commands/mycmd.md removed from original path"
fi
assert_file "$S3/.claude.pre-adopt/commands/mycmd.md" "scenario3: mycmd.md quarantined to .claude.pre-adopt/commands/mycmd.md"
assert_eq "$MYCMD_BEFORE" "$(safe_cat "$S3/.claude.pre-adopt/commands/mycmd.md")" "scenario3: mycmd.md byte-identical after quarantine"
assert_contains "$ADOPT_OUT" "mycmd.md" "scenario3: mycmd.md orphan reported"
assert_file "$S3/scripts/build.js" "scenario3: scripts/build.js untouched at original path"
assert_eq "$BUILD_BEFORE" "$(safe_cat "$S3/scripts/build.js")" "scenario3: scripts/build.js content unchanged"
assert_contains "$ADOPT_OUT" "UNREVIEWED-EXECUTABLE" "scenario3: UNREVIEWED-EXECUTABLE section present in report"
assert_contains "$ADOPT_OUT" "scripts/build.js" "scenario3: scripts/build.js listed as unreviewed executable"
assert_file "$S3/.obsidian/plugins/x/main.js" "scenario3: .obsidian plugin file not overwritten"
assert_file "$S3/.obsidian/community-plugins.json" "scenario3: .obsidian community-plugins.json not overwritten"
assert_contains "$ADOPT_OUT" ".obsidian" "scenario3: .obsidian presence flagged in report"

# --- Scenario 4: pre-planted git hook quarantined, no chain invocation -------
echo ""
echo "=== Adopt scenario 4: pre-planted git hook quarantined, no chain invocation ==="
S4="$(new_tmp)"
seed_fixture "$S4"
HOOK_BEFORE="$(safe_cat "$S4/.git/hooks/pre-commit")"
run_adopt "$NEW_PROJECT" "$S4"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario4: adopt exits 0"; else fail "scenario4: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
assert_file "$S4/.git/hooks/pre-commit.pre-adopt" "scenario4: original pre-commit quarantined to .pre-adopt"
assert_eq "$HOOK_BEFORE" "$(safe_cat "$S4/.git/hooks/pre-commit.pre-adopt")" "scenario4: original pre-commit hook byte-identical at .pre-adopt"
if [ -f "$S4/.git/hooks/pre-commit" ]; then
    if grep -q "security-scanner.ts scan-staged" "$S4/.git/hooks/pre-commit" 2>/dev/null; then
        pass "scenario4: new pre-commit hook installed by Project OS"
    else
        fail "scenario4: installed pre-commit hook missing Project OS marker"
    fi
    if grep -Eq '\.local"|\.pre-adopt"' "$S4/.git/hooks/pre-commit" 2>/dev/null; then
        fail "scenario4: installed hook still contains a chain invocation"
    else
        pass "scenario4: installed hook has no chain invocation (--no-chain quarantine)"
    fi
else
    fail "scenario4: .git/hooks/pre-commit missing after adopt"
fi
assert_contains "$ADOPT_OUT" "QUARANTINED GIT HOOKS" "scenario4: quarantine section present in report"
assert_contains "$ADOPT_OUT" "pre-commit" "scenario4: pre-commit hook listed as quarantined"

# --- Scenario 5: .gitignore merge (LF + CRLF variant) ------------------------
echo ""
echo "=== Adopt scenario 5: .gitignore merge keeps user lines, single project-os block ==="
S5="$(new_tmp)"
seed_fixture "$S5"
run_adopt "$NEW_PROJECT" "$S5"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario5: adopt exits 0"; else fail "scenario5: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
if [ -f "$S5/.gitignore" ]; then
    G5="$(cat "$S5/.gitignore")"
    assert_contains "$G5" "node_modules/" "scenario5: user's node_modules/ line retained"
    assert_contains "$G5" "my-secret.local" "scenario5: user's my-secret.local line retained"
    BLOCK_COUNT="$(grep -c '^# >>> project-os >>>$' "$S5/.gitignore" 2>/dev/null || true)"
    assert_eq "1" "${BLOCK_COUNT:-0}" "scenario5: exactly one project-os marker block"
    assert_contains "$G5" "*.pre-adopt" "scenario5: gitignore includes *.pre-adopt"
    assert_contains "$G5" ".claude.pre-adopt/" "scenario5: gitignore includes .claude.pre-adopt/"
else
    fail "scenario5: .gitignore missing after adopt"
fi

echo ""
echo "=== Adopt scenario 5b: CRLF .gitignore variant gains no mixed-ending duplicates ==="
S5C="$(new_tmp)"
seed_fixture "$S5C" crlf
run_adopt "$NEW_PROJECT" "$S5C"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario5b: adopt exits 0 (CRLF fixture)"; else fail "scenario5b: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
if [ -f "$S5C/.gitignore" ]; then
    TOTAL_LINES="$(grep -c '' "$S5C/.gitignore" 2>/dev/null || true)"
    CRLF_LINES="$(grep -c $'\r$' "$S5C/.gitignore" 2>/dev/null || true)"
    assert_eq "${TOTAL_LINES:-0}" "${CRLF_LINES:-0}" "scenario5b: every line in merged CRLF .gitignore ends CRLF (no mixed endings)"
    BLOCK_COUNT_C="$(grep -c '^# >>> project-os >>>' "$S5C/.gitignore" 2>/dev/null || true)"
    assert_eq "1" "${BLOCK_COUNT_C:-0}" "scenario5b: exactly one project-os marker block (CRLF fixture)"
else
    fail "scenario5b: .gitignore missing after adopt (CRLF fixture)"
fi

# --- Scenario 6: completed-run idempotency (manifest deleted, full re-adopt) -
echo ""
echo "=== Adopt scenario 6: completed-run idempotency (manifest deleted, full re-adopt) ==="
S6="$(new_tmp)"
seed_fixture "$S6"
run_adopt "$NEW_PROJECT" "$S6"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario6: initial adopt exits 0"; else fail "scenario6: initial adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
HEAD_BEFORE="$(git -C "$S6" rev-parse HEAD 2>/dev/null || true)"
rm -f "$S6/.claude/manifest.json"
UPSTREAM_COUNT_BEFORE="$(count_files_matching "$S6" "*.upstream")"
PREADOPT_COUNT_BEFORE="$(count_files_matching "$S6" "*.pre-adopt")"
HASH_BEFORE="$(hash_tree "$S6" "manifest.json")"
run_adopt "$NEW_PROJECT" "$S6"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario6: second adopt (manifest deleted) exits 0"; else fail "scenario6: second adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
UPSTREAM_COUNT_AFTER="$(count_files_matching "$S6" "*.upstream")"
PREADOPT_COUNT_AFTER="$(count_files_matching "$S6" "*.pre-adopt")"
assert_eq "$UPSTREAM_COUNT_BEFORE" "$UPSTREAM_COUNT_AFTER" "scenario6: no new .upstream files on re-adopt"
assert_eq "$PREADOPT_COUNT_BEFORE" "$PREADOPT_COUNT_AFTER" "scenario6: no new .pre-adopt files on re-adopt"
HASH_AFTER="$(hash_tree "$S6" "manifest.json")"
assert_eq "$HASH_BEFORE" "$HASH_AFTER" "scenario6: tree byte-identical on re-adopt (excl. manifest.json timestamp)"
HEAD_AFTER="$(git -C "$S6" rev-parse HEAD 2>/dev/null || true)"
assert_eq "$HEAD_BEFORE" "$HEAD_AFTER" "scenario6: no new commit created on re-adopt"
assert_file "$S6/.claude/manifest.json" "scenario6: manifest.json regenerated after deletion"

# --- Scenario 7: --dry-run prints full plan, writes nothing ------------------
echo ""
echo "=== Adopt scenario 7: --dry-run prints full plan, writes nothing ==="
S7="$(new_tmp)"
seed_fixture "$S7"
HASH_DRY_BEFORE="$(hash_tree "$S7")"
run_adopt "$NEW_PROJECT" "$S7" --dry-run
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario7: --dry-run exits 0"; else fail "scenario7: --dry-run exited $ADOPT_EC: $ADOPT_OUT"; fi
assert_contains "$ADOPT_OUT" "ADOPT REPORT" "scenario7: dry-run prints ADOPT REPORT"
assert_contains "$ADOPT_OUT" "no files will be written" "scenario7: dry-run announces no-write mode"
assert_contains "$ADOPT_OUT" "no files were written" "scenario7: dry-run report confirms zero writes"
HASH_DRY_AFTER="$(hash_tree "$S7")"
assert_eq "$HASH_DRY_BEFORE" "$HASH_DRY_AFTER" "scenario7: fixture tree hash-identical after --dry-run"
if [ -f "$S7/.claude/manifest.json" ]; then fail "scenario7: manifest.json was written despite --dry-run"; else pass "scenario7: no manifest.json written by --dry-run"; fi

# --- Scenario 8a: clean index -- scaffold commit contains only new/changed files -
echo ""
echo "=== Adopt scenario 8a: clean index -- scaffold commit contains only new/changed files ==="
S8A="$(new_tmp)"
seed_fixture "$S8A"
PRE_COMMIT_SHA="$(git -C "$S8A" rev-parse HEAD 2>/dev/null || true)"
run_adopt "$NEW_PROJECT" "$S8A"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario8a: adopt exits 0"; else fail "scenario8a: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
POST_COMMIT_SHA="$(git -C "$S8A" rev-parse HEAD 2>/dev/null || true)"
if [ -n "$PRE_COMMIT_SHA" ] && [ "$PRE_COMMIT_SHA" != "$POST_COMMIT_SHA" ]; then
    pass "scenario8a: a new scaffold commit was created"
else
    fail "scenario8a: no new commit created"
fi
# Plain diff (not --diff-filter=A): .claude/settings.json, scripts/setup.sh
# and .gitignore already existed in the seed commit (framework collisions /
# the user's own .gitignore), so the adopt commit MODIFIES them rather than
# adding them -- diff-filter=A would miss genuinely-changed-by-this-commit
# paths that started life as the user's own pre-existing file.
COMMIT_FILES="$(git -C "$S8A" diff --name-only "$PRE_COMMIT_SHA" "$POST_COMMIT_SHA" 2>/dev/null || true)"
assert_contains "$COMMIT_FILES" ".claude/settings.json" "scenario8a: commit includes canonical settings.json"
assert_contains "$COMMIT_FILES" "scripts/setup.sh" "scenario8a: commit includes canonical setup.sh"
assert_contains "$COMMIT_FILES" ".claude/manifest.json" "scenario8a: commit includes manifest.json"
assert_contains "$COMMIT_FILES" ".gitignore" "scenario8a: commit includes updated .gitignore"
assert_not_contains "$COMMIT_FILES" "package.json" "scenario8a: commit excludes pre-existing package.json"
assert_not_contains "$COMMIT_FILES" "pnpm-lock.yaml" "scenario8a: commit excludes pre-existing pnpm-lock.yaml"
assert_not_contains "$COMMIT_FILES" "src/app.ts" "scenario8a: commit excludes pre-existing src/app.ts"
assert_not_contains "$COMMIT_FILES" ".upstream" "scenario8a: commit excludes any .upstream file"
assert_not_contains "$COMMIT_FILES" ".pre-adopt" "scenario8a: commit excludes any .pre-adopt file"
assert_not_contains "$COMMIT_FILES" ".claude.pre-adopt" "scenario8a: commit excludes quarantined .claude.pre-adopt tree"
assert_not_contains "$COMMIT_FILES" "docs/knowledge/decisions.md" "scenario8a: commit excludes conflicted decisions.md (kept canonical, uncommitted)"

# --- Scenario 8b: pre-staged uncommitted change -- adopt skips commit --------
echo ""
echo "=== Adopt scenario 8b: pre-staged uncommitted change -- adopt skips commit, staged file untouched ==="
S8B="$(new_tmp)"
seed_fixture "$S8B"
printf 'export const greeting = "hi (locally modified)";\n' > "$S8B/src/app.ts"
git -C "$S8B" add src/app.ts
STAGED_CONTENT_BEFORE="$(git -C "$S8B" show :src/app.ts 2>/dev/null || true)"
PRE_COMMIT_SHA_B="$(git -C "$S8B" rev-parse HEAD 2>/dev/null || true)"
run_adopt "$NEW_PROJECT" "$S8B"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario8b: adopt exits 0"; else fail "scenario8b: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi
POST_COMMIT_SHA_B="$(git -C "$S8B" rev-parse HEAD 2>/dev/null || true)"
assert_eq "$PRE_COMMIT_SHA_B" "$POST_COMMIT_SHA_B" "scenario8b: no commit created when index already has staged changes"
STAGED_CONTENT_AFTER="$(git -C "$S8B" show :src/app.ts 2>/dev/null || true)"
assert_eq "$STAGED_CONTENT_BEFORE" "$STAGED_CONTENT_AFTER" "scenario8b: user's staged file untouched"
assert_contains "$ADOPT_OUT" "Skipping commit" "scenario8b: adopt reports skipped commit"

# --- Scenario 9: manifest safety via the REAL update-project.sh classifier ---
echo ""
echo "=== Adopt scenario 9: manifest safety via the real update-project.sh classifier ==="
TEMPLATE_CHECKOUT="$(new_tmp)"
build_template_checkout "$TEMPLATE_CHECKOUT"
S9="$(new_tmp)"
seed_fixture "$S9"
run_adopt "$TEMPLATE_CHECKOUT/scripts/new-project.sh" "$S9"
if [ "$ADOPT_EC" -eq 0 ]; then pass "scenario9: adopt (from template checkout) exits 0"; else fail "scenario9: adopt exited $ADOPT_EC: $ADOPT_OUT"; fi

UPSTREAM_HASH_AT_ADOPT=""
if [ -f "$S9/docs/knowledge/decisions.md.upstream" ]; then
    UPSTREAM_HASH_AT_ADOPT="$(sha256sum "$S9/docs/knowledge/decisions.md.upstream" | cut -d' ' -f1)"
fi
MANIFEST_LINE="$(grep '"docs/knowledge/decisions.md":' "$S9/.claude/manifest.json" 2>/dev/null || true)"
MANIFEST_HASH="$(printf '%s' "$MANIFEST_LINE" | sed -E 's/.*: *"([a-f0-9]{64})".*/\1/')"
assert_eq "$UPSTREAM_HASH_AT_ADOPT" "$MANIFEST_HASH" "scenario9: manifest hash for conflicted path equals sha256 of .upstream sibling"

# Simulate upstream drift: mutate the checkout's decisions.md so a LATER
# update-project.sh run sees a real upstream change beyond what the manifest
# recorded at adopt time (otherwise upstream_hash==manifest_hash trivially
# classifies UNCHANGED rather than exercising the CONFLICT branch).
printf '# My Decisions\n\nWe decided X.\nUpstream added a new decision Y.\n' > "$TEMPLATE_CHECKOUT/docs/knowledge/decisions.md"

set +e
UPDATE_OUT="$(bash "$S9/scripts/update-project.sh" --local-upstream "$TEMPLATE_CHECKOUT" 2>&1)"
UPDATE_EC=$?
set -e
if [ "$UPDATE_EC" -eq 0 ]; then pass "scenario9: update-project.sh --local-upstream exits 0"; else fail "scenario9: update-project.sh exited $UPDATE_EC: $UPDATE_OUT"; fi
assert_contains "$UPDATE_OUT" "! docs/knowledge/decisions.md" "scenario9: decisions.md classified CONFLICT (! marker)"
assert_not_contains "$UPDATE_OUT" "✓ docs/knowledge/decisions.md" "scenario9: decisions.md NOT classified SAFE_UPDATE (no ✓ marker)"

# --- Scenario 10: three refusals, each before any write ----------------------
echo ""
echo "=== Adopt scenario 10a: refuse target that already has .claude/manifest.json ==="
S10A="$(new_tmp)"
seed_fixture "$S10A"
mkdir -p "$S10A/.claude"
printf '{"project_os_version":"1.0.0"}\n' > "$S10A/.claude/manifest.json"
HASH_10A_BEFORE="$(hash_tree "$S10A")"
run_adopt "$NEW_PROJECT" "$S10A"
if [ "$ADOPT_EC" -ne 0 ]; then pass "scenario10a: adopt refuses (nonzero exit) when manifest.json already present"; else fail "scenario10a: adopt did not refuse an already-adopted target"; fi
assert_contains "$ADOPT_OUT" "already a Project OS project" "scenario10a: refusal message names the reason"
assert_contains "$ADOPT_OUT" "update-project.sh" "scenario10a: refusal message points to update-project.sh"
HASH_10A_AFTER="$(hash_tree "$S10A")"
assert_eq "$HASH_10A_BEFORE" "$HASH_10A_AFTER" "scenario10a: zero writes on refusal"

echo ""
echo "=== Adopt scenario 10b: hard fail on symlink at .claude before any write ==="
S10B="$(new_tmp)"
seed_fixture "$S10B"
rm -rf "$S10B/.claude"
LINK_TARGET_10B="$(new_tmp)"
set +e
MSYS=winsymlinks:nativestrict ln -s "$LINK_TARGET_10B" "$S10B/.claude" 2>/dev/null
LN_EC=$?
set -e
if [ "$LN_EC" -eq 0 ] && [ -L "$S10B/.claude" ]; then
    HASH_10B_BEFORE="$(hash_tree "$S10B")"
    run_adopt "$NEW_PROJECT" "$S10B"
    if [ "$ADOPT_EC" -ne 0 ]; then pass "scenario10b: adopt refuses (nonzero exit) on symlinked .claude"; else fail "scenario10b: adopt did not refuse a symlinked .claude target"; fi
    assert_contains "$ADOPT_OUT" "symlink" "scenario10b: refusal message mentions symlink"
    HASH_10B_AFTER="$(hash_tree "$S10B")"
    assert_eq "$HASH_10B_BEFORE" "$HASH_10B_AFTER" "scenario10b: zero writes on symlink refusal"
else
    echo "SKIP: scenario10b (could not create a native symlink on this system)"
fi

echo ""
echo "=== Adopt scenario 10c: refuse nested no-.git target without --allow-nested ==="
PARENT10C="$(new_tmp)"
git -C "$PARENT10C" init --quiet
git -C "$PARENT10C" config user.email "fixture@test.local"
git -C "$PARENT10C" config user.name "Fixture Tester"
printf 'placeholder\n' > "$PARENT10C/readme.md"
git -C "$PARENT10C" add readme.md
git -C "$PARENT10C" commit --quiet -m "seed parent repo"
NESTED10C="$PARENT10C/nested-child"
mkdir -p "$NESTED10C"
printf 'export const x = 1;\n' > "$NESTED10C/src_placeholder.ts"
HASH_10C_BEFORE="$(hash_tree "$NESTED10C")"
run_adopt "$NEW_PROJECT" "$NESTED10C"
if [ "$ADOPT_EC" -ne 0 ]; then pass "scenario10c: adopt refuses (nonzero exit) on nested no-.git target"; else fail "scenario10c: adopt did not refuse a nested no-.git target"; fi
assert_contains "$ADOPT_OUT" "nested inside an existing repo" "scenario10c: refusal message explains nesting"
assert_contains "$ADOPT_OUT" "--allow-nested" "scenario10c: refusal message suggests --allow-nested"
HASH_10C_AFTER="$(hash_tree "$NESTED10C")"
assert_eq "$HASH_10C_BEFORE" "$HASH_10C_AFTER" "scenario10c: zero writes on nested-repo refusal"

echo ""
if [ "$FAIL" -eq 0 ]; then
    echo "ALL ASSERTIONS PASSED"
    exit 0
else
    echo "$FAIL ASSERTION(S) FAILED"
    exit 1
fi
