#!/usr/bin/env bash
# tests/update-project-smoke.sh — Smoke suite for the release-archive guard in
# scripts/update-project.sh (Step 4: path check, then the closed entry-type
# allowlist: regular files and directories only).
#
# Pattern "Test Behaviour in a Copied Project Root": each case copies the real
# update-project.sh into a mktemp project root with a minimal manifest, puts a
# stub `gh` first on PATH (answers `release list`, and for `release download`
# copies a prepared tar.gz into --dir), and runs the copy. Nothing touches the
# real repo or the network.
#
# Usage: bash tests/update-project-smoke.sh
# Exit: 0 if every case passes, 1 if any assertion fails.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
UPDATE_SH="$REPO_ROOT/scripts/update-project.sh"

FAIL_COUNT=0
# One suite temp parent, created here and not inside $(...), so the EXIT trap
# removes every directory the helpers make beneath it.
SUITE_TMP=$(mktemp -d)

pass() { printf 'PASS: %s\n' "$1"; }
fail() {
    printf 'FAIL: %s\n' "$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

cleanup() {
    rm -rf "$SUITE_TMP" 2>/dev/null || true
}
trap cleanup EXIT

# python3 crafts the hostile tar archives; without it only the six archive
# cases are skipped. The script-list cases below never need it.
HAVE_PYTHON3=true
if ! command -v python3 &>/dev/null; then
    HAVE_PYTHON3=false
fi

# new_root -- print a fresh copied project root (script + manifest + gh stub).
# The stub's archive is taken from $GH_STUB_ARCHIVE at run time.
new_root() {
    local root
    root=$(mktemp -d "$SUITE_TMP/root.XXXXXX")
    mkdir -p "$root/scripts" "$root/.claude" "$root/bin"
    cp "$UPDATE_SH" "$root/scripts/update-project.sh"
    printf '{\n  "project_os_version": "v1.0"\n}\n' > "$root/.claude/manifest.json"
    cat > "$root/bin/gh" <<'STUB'
#!/usr/bin/env bash
# Stub gh: `release list` -> one newer same-major release; `release download`
# copies $GH_STUB_ARCHIVE into the --dir argument.
if [ "$1" = "release" ] && [ "$2" = "list" ]; then
    echo "v1.1"
    exit 0
fi
if [ "$1" = "release" ] && [ "$2" = "download" ]; then
    dir=""
    while [ $# -gt 0 ]; do
        if [ "$1" = "--dir" ]; then dir="$2"; fi
        shift
    done
    cp "$GH_STUB_ARCHIVE" "$dir/release.tar.gz"
    exit 0
fi
echo "stub gh: unexpected args: $*" >&2
exit 2
STUB
    chmod +x "$root/bin/gh"
    printf '%s' "$root"
}

# make_archive KIND OUT [OUTSIDE_DIR] -- craft a tar.gz with python's tarfile so
# entry order and types are exact. KINDs: clean, symlink_escape, symlink_inbounds,
# hardlink, dotdot.
make_archive() {
    python3 -I - "$1" "$2" "${3:-/nonexistent}" <<'PY'
import io, sys, tarfile

kind, out, outside = sys.argv[1], sys.argv[2], sys.argv[3]

def add_dir(t, name):
    i = tarfile.TarInfo(name); i.type = tarfile.DIRTYPE; i.mode = 0o755
    t.addfile(i)

def add_file(t, name, data=b"x\n"):
    i = tarfile.TarInfo(name); i.size = len(data); i.mode = 0o644
    t.addfile(i, io.BytesIO(data))

def add_link(t, name, target, hard=False):
    i = tarfile.TarInfo(name); i.type = tarfile.LNKTYPE if hard else tarfile.SYMTYPE
    i.linkname = target
    t.addfile(i)

with tarfile.open(out, "w:gz") as t:
    add_dir(t, "proj-1.1")
    if kind == "clean":
        add_file(t, "proj-1.1/README.md")
        add_dir(t, "proj-1.1/sub")
        add_file(t, "proj-1.1/sub/a.txt")
    elif kind == "symlink_escape":
        add_link(t, "proj-1.1/escape", outside)
        add_file(t, "proj-1.1/escape/evil.txt", b"pwned\n")
    elif kind == "symlink_inbounds":
        add_file(t, "proj-1.1/real.txt")
        add_link(t, "proj-1.1/alias.txt", "real.txt")
    elif kind == "hardlink":
        add_file(t, "proj-1.1/real.txt")
        add_link(t, "proj-1.1/hard.txt", "proj-1.1/real.txt", hard=True)
    elif kind == "dotdot":
        add_file(t, "proj-1.1/../outside.txt")
    else:
        raise SystemExit("unknown kind " + kind)
PY
}

# run_update ROOT ARCHIVE -- run the copied script; sets RUN_OUT / RUN_ERR / RUN_RC.
run_update() {
    local root="$1" archive="$2"
    RUN_OUT="$root/stdout.txt"
    RUN_ERR="$root/stderr.txt"
    RUN_RC=0
    # TMPDIR is pinned inside the root so the script's own mktemp is contained.
    mkdir -p "$root/tmp"
    (
        cd "$root" || exit 99
        PATH="$root/bin:$PATH" TMPDIR="$root/tmp" GH_STUB_ARCHIVE="$archive" \
            bash scripts/update-project.sh
    ) > "$RUN_OUT" 2> "$RUN_ERR" || RUN_RC=$?
}

LINK_MSG="ERROR: Archive contains a link or special entry (only regular files and directories are allowed). Aborting."
PATH_MSG="ERROR: Archive contains suspicious paths (absolute or ..). Aborting."

assert_refused_with() {
    local name="$1" msg="$2"
    if [ "$RUN_RC" -eq 1 ] && grep -qxF "$msg" "$RUN_ERR"; then
        pass "$name"
    else
        fail "$name (rc=$RUN_RC; stderr: $(cat "$RUN_ERR"))"
    fi
}

# --- updateProject_cleanArchive_passesGuard ---
test_clean() {
    local name="updateProject_cleanArchive_passesGuard"
    local root arc
    root=$(new_root); arc="$root/a.tar.gz"
    make_archive clean "$arc"
    run_update "$root" "$arc"
    if ! grep -q "Aborting\." "$RUN_ERR" "$RUN_OUT" \
        && grep -qx "Extracted to temp dir." "$RUN_OUT" \
        && grep -qx "Analyzing changes..." "$RUN_OUT"; then
        pass "$name"
    else
        fail "$name (rc=$RUN_RC; stdout: $(cat "$RUN_OUT"); stderr: $(cat "$RUN_ERR"))"
    fi
}

# --- updateProject_symlinkEscapeThenWrite_refusedOutsideUntouched ---
test_symlink_escape() {
    local name="updateProject_symlinkEscapeThenWrite_refusedOutsideUntouched"
    local root arc outside
    root=$(new_root); arc="$root/a.tar.gz"
    outside="$root/outside"
    mkdir -p "$outside"
    printf 'sentinel\n' > "$outside/keep.txt"
    make_archive symlink_escape "$arc" "$outside"
    run_update "$root" "$arc"
    local contents
    contents=$(ls -A "$outside")
    if [ "$RUN_RC" -eq 1 ] && grep -qxF "$LINK_MSG" "$RUN_ERR" \
        && [ "$contents" = "keep.txt" ] \
        && [ "$(cat "$outside/keep.txt")" = "sentinel" ]; then
        pass "$name"
    else
        fail "$name (rc=$RUN_RC; outside has: $contents; stderr: $(cat "$RUN_ERR"))"
    fi
}

# --- updateProject_inBoundsSymlink_refused ---
test_symlink_inbounds() {
    local name="updateProject_inBoundsSymlink_refused"
    local root arc
    root=$(new_root); arc="$root/a.tar.gz"
    make_archive symlink_inbounds "$arc"
    run_update "$root" "$arc"
    assert_refused_with "$name" "$LINK_MSG"
}

# --- updateProject_hardLink_refused ---
test_hardlink() {
    local name="updateProject_hardLink_refused"
    local root arc
    root=$(new_root); arc="$root/a.tar.gz"
    make_archive hardlink "$arc"
    run_update "$root" "$arc"
    assert_refused_with "$name" "$LINK_MSG"
}

# --- updateProject_dotDotEntry_refusedByNameCheck ---
test_dotdot() {
    local name="updateProject_dotDotEntry_refusedByNameCheck"
    local root arc
    root=$(new_root); arc="$root/a.tar.gz"
    make_archive dotdot "$arc"
    run_update "$root" "$arc"
    assert_refused_with "$name" "$PATH_MSG"
}

# --- updateProject_gitArchiveForm_passesGuard ---
# `git archive` emits a pax global header like GitHub's archives; `tar tv` does
# not list it, so the allowlist must still accept the archive.
test_git_archive() {
    local name="updateProject_gitArchiveForm_passesGuard"
    local root arc repo
    root=$(new_root); arc="$root/a.tar.gz"
    repo="$root/srcrepo"
    mkdir -p "$repo/sub"
    printf 'hello\n' > "$repo/README.md"
    printf 'a\n' > "$repo/sub/a.txt"
    git -C "$repo" init -q
    git -C "$repo" add -A
    git -C "$repo" -c user.name=t -c user.email=t@example.com commit -q -m init
    git -C "$repo" archive --format=tar.gz --prefix=proj-1.1/ HEAD -o "$arc"
    run_update "$root" "$arc"
    if ! grep -q "Aborting\." "$RUN_ERR" "$RUN_OUT" \
        && grep -qx "Extracted to temp dir." "$RUN_OUT"; then
        pass "$name"
    else
        fail "$name (rc=$RUN_RC; stdout: $(cat "$RUN_OUT"); stderr: $(cat "$RUN_ERR"))"
    fi
}

# --- updateProject_repoAsUpstream_noListWarning ---
# The template repo's own gate for TEMPLATE_SCRIPTS drift: a dry run of the
# copied updater against this repo as --local-upstream must not warn about a
# script on disk that the list omits, nor fail on a listed script that is
# missing. Fails on a developer's untracked script under scripts/ (intended).
test_repo_as_upstream() {
    local name="updateProject_repoAsUpstream_noListWarning"
    local root rc=0
    root=$(new_root)
    mkdir -p "$root/tmp"
    (
        cd "$root" || exit 99
        TMPDIR="$root/tmp" bash scripts/update-project.sh --local-upstream "$REPO_ROOT"
    ) > "$root/stdout.txt" 2> "$root/stderr.txt" || rc=$?
    if [ "$rc" -eq 0 ] \
        && ! grep -qF "not listed in TEMPLATE_SCRIPTS" "$root/stderr.txt" \
        && ! grep -qF "lists scripts not present" "$root/stderr.txt"; then
        pass "$name"
    else
        fail "$name (rc=$rc; stderr: $(cat "$root/stderr.txt"))"
    fi
}

# template_script_entries FILE -- print the sorted "scripts/..." entries inside
# the TEMPLATE_SCRIPTS=( ... ) block of FILE.
template_script_entries() {
    sed -n '/^TEMPLATE_SCRIPTS=(/,/^)/p' "$1" | grep -o '"scripts/[^"]*"' | sort
}

# --- updateProject_scriptLists_updaterMatchesManifestGenerator ---
# A script listed in the updater but missing from generate-manifest.sh never
# gets a manifest hash and is then a permanent CONFLICT downstream, so the two
# lists must name the same scripts.
test_script_lists_match() {
    local name="updateProject_scriptLists_updaterMatchesManifestGenerator"
    local root updater generator only_updater only_generator
    root=$(new_root)
    updater="$root/updater-entries.txt"
    generator="$root/generator-entries.txt"
    template_script_entries "$UPDATE_SH" > "$updater"
    template_script_entries "$REPO_ROOT/scripts/generate-manifest.sh" > "$generator"
    if [ -s "$updater" ] && cmp -s "$updater" "$generator"; then
        pass "$name"
    else
        only_updater=$(comm -23 "$updater" "$generator" | tr '\n' ' ')
        only_generator=$(comm -13 "$updater" "$generator" | tr '\n' ' ')
        fail "$name (only in update-project.sh: ${only_updater:-none}; only in generate-manifest.sh: ${only_generator:-none})"
    fi
}

# new_scratch -- print a fresh empty directory for capture files and fixtures
# that must live outside any tree whose digest is compared.
new_scratch() {
    local d
    d=$(mktemp -d "$SUITE_TMP/scratch.XXXXXX")
    printf '%s' "$d"
}

# new_target [VERSION [DIR]] -- print a project directory (DIR when given, else
# a fresh one): a manifest holding project_os_version (default v0.9, distinct
# from new_root's v1.0) and its own copy of the updater, as a real project has.
new_target() {
    local ver="${1:-v0.9}" t="${2:-}"
    if [ -z "$t" ]; then t=$(new_scratch); fi
    mkdir -p "$t/.claude" "$t/scripts"
    printf '{\n  "project_os_version": "%s"\n}\n' "$ver" > "$t/.claude/manifest.json"
    cp "$UPDATE_SH" "$t/scripts/update-project.sh"
    printf '%s' "$t"
}

# new_upstream [DIR] -- print an upstream directory (DIR when given, else a
# fresh one) whose scripts/ holds a one-line stub for every top-level *.sh and
# *.ts name in the repo's scripts/, so the updater's list check passes in both
# directions whatever the list holds.
new_upstream() {
    local up="${1:-}" f
    if [ -z "$up" ]; then up=$(new_scratch); fi
    mkdir -p "$up/scripts"
    while IFS= read -r f; do
        printf '# stub\n' > "$up/scripts/$(basename "$f")"
    done < <(find "$REPO_ROOT/scripts" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.ts' \))
    # The two children the updater runs on --apply leave a marker in their
    # working directory, so a case can tell where they ran. The map stub is
    # called twice (check, then check --heal) and exits 0 each time.
    printf '#!/usr/bin/env bash\n: > manifest-ran.marker\n' > "$up/scripts/generate-manifest.sh"
    printf 'require("fs").writeFileSync(require("path").join(process.cwd(), "map-ran.marker"), "");\nprocess.exit(0);\n' > "$up/scripts/system-map.ts"
    printf '%s' "$up"
}

# tree_digest DIR -- the sorted sha256sum of every file under DIR.
tree_digest() {
    (cd "$1" && find . -type f -exec sha256sum {} + | sort)
}

# refusal_case NAME MESSAGE ROOT TARGET ARG... -- run ROOT's copied updater with
# cwd at ROOT and ARGs; pass when it exits 1, stderr is exactly MESSAGE, stdout
# is empty, and the digests of ROOT (and of TARGET, when non-empty) are
# unchanged. Capture files live in a scratch dir outside both trees.
refusal_case() {
    local name="$1" msg="$2" root="$3" target="$4"
    shift 4
    local cap rc=0 root_before root_after target_before="" target_after=""
    cap=$(new_scratch)
    root_before=$(tree_digest "$root")
    if [ -n "$target" ]; then target_before=$(tree_digest "$target"); fi
    (
        cd "$root" || exit 99
        bash "$root/scripts/update-project.sh" "$@"
    ) > "$cap/stdout.txt" 2> "$cap/stderr.txt" || rc=$?
    root_after=$(tree_digest "$root")
    if [ -n "$target" ]; then target_after=$(tree_digest "$target"); fi
    if [ "$rc" -eq 1 ] \
        && [ "$(cat "$cap/stderr.txt")" = "$msg" ] \
        && [ ! -s "$cap/stdout.txt" ] \
        && [ "$root_before" = "$root_after" ] \
        && [ "$target_before" = "$target_after" ]; then
        pass "$name"
    else
        fail "$name (rc=$rc; stdout: $(cat "$cap/stdout.txt"); stderr: $(cat "$cap/stderr.txt"); root unchanged: $([ "$root_before" = "$root_after" ] && echo yes || echo no); target unchanged: $([ "$target_before" = "$target_after" ] && echo yes || echo no))"
    fi
}

ARG_MSG="ERROR: --project requires a directory argument"

# --- updateProject_projectFlagMissingArgument_refused ---
test_project_missing_argument() {
    refusal_case "updateProject_projectFlagMissingArgument_refused" \
        "$ARG_MSG" "$(new_root)" "" --project
}

# --- updateProject_projectFlagFlagAsArgument_refused ---
test_project_flag_as_argument() {
    refusal_case "updateProject_projectFlagFlagAsArgument_refused" \
        "$ARG_MSG" "$(new_root)" "" --project --apply
}

# --- updateProject_projectFlagEmptyArgument_refused ---
test_project_empty_argument() {
    refusal_case "updateProject_projectFlagEmptyArgument_refused" \
        "$ARG_MSG" "$(new_root)" "" --project ""
}

# --- updateProject_projectFlagMissingDir_refused ---
test_project_missing_dir() {
    local scratch
    scratch=$(new_scratch)
    refusal_case "updateProject_projectFlagMissingDir_refused" \
        "ERROR: --project directory not found: $scratch/nope" "$(new_root)" "" \
        --project "$scratch/nope"
}

# --- updateProject_projectFlagNotADirectory_refused ---
test_project_not_a_directory() {
    local scratch
    scratch=$(new_scratch)
    printf 'x\n' > "$scratch/file.txt"
    refusal_case "updateProject_projectFlagNotADirectory_refused" \
        "ERROR: --project is not a directory: $scratch/file.txt" "$(new_root)" "" \
        --project "$scratch/file.txt"
}

# --- updateProject_projectFlagOwnRoot_refused ---
# `--project ./` with cwd at the framework root is what an unset variable in
# `--project "./$UNSET"` expands to; it would update the framework itself.
test_project_own_root() {
    local root phys
    root=$(new_root)
    phys=$(cd "$root" && pwd -P)
    refusal_case "updateProject_projectFlagOwnRoot_refused" \
        "ERROR: --project points at this checkout ($phys). Omit --project to update it." \
        "$root" "" --project ./
}

# not_a_project_msg DIR -- the two-line rule 5 refusal for the project at DIR.
not_a_project_msg() {
    local phys
    phys=$(cd "$1" && pwd -P)
    printf '%s\n%s' \
        "ERROR: $phys is not a Project OS project with a manifest (.claude/manifest.json with a project_os_version is required)." \
        "For a repository without one, see: bash scripts/new-project.sh --adopt <dir>"
}

# --- updateProject_projectFlagNoManifest_refused ---
# A bare .claude/commands/workflows/ is not a marker only Project OS writes.
test_project_no_manifest() {
    local target
    target=$(new_scratch)
    mkdir -p "$target/.claude/commands/workflows"
    refusal_case "updateProject_projectFlagNoManifest_refused" \
        "$(not_a_project_msg "$target")" "$(new_root)" "$target" --project "$target"
}

# --- updateProject_projectFlagManifestIsDirectory_refused ---
test_project_manifest_is_directory() {
    local target
    target=$(new_scratch)
    mkdir -p "$target/.claude/manifest.json"
    refusal_case "updateProject_projectFlagManifestIsDirectory_refused" \
        "$(not_a_project_msg "$target")" "$(new_root)" "$target" --project "$target"
}

# --- updateProject_projectFlagManifestWithoutVersion_refused ---
test_project_manifest_without_version() {
    local target
    target=$(new_scratch)
    mkdir -p "$target/.claude"
    printf '{}\n' > "$target/.claude/manifest.json"
    refusal_case "updateProject_projectFlagManifestWithoutVersion_refused" \
        "$(not_a_project_msg "$target")" "$(new_root)" "$target" --project "$target"
}

# --- updateProject_projectFlagSymlinkedDir_resolvedOwnRootStillRefused ---
# A symlink to a valid target passes validation; a symlink to the framework
# root resolves to it and is refused. Skipped where ln -s does not link.
test_project_symlinked_dir() {
    local name="updateProject_projectFlagSymlinkedDir_resolvedOwnRootStillRefused"
    local root target upstream scratch cap rc=0 phys
    root=$(new_root); target=$(new_target); upstream=$(new_upstream)
    scratch=$(new_scratch); cap=$(new_scratch)
    ln -s "$target" "$scratch/to-target" 2>/dev/null || true
    ln -s "$root" "$scratch/to-root" 2>/dev/null || true
    if [ ! -L "$scratch/to-target" ] || [ ! -L "$scratch/to-root" ]; then
        echo "  SKIP: $name (host cannot create a symlink)"
        return 0
    fi
    (
        cd "$root" || exit 99
        bash "$root/scripts/update-project.sh" --local-upstream "$upstream" --project "$scratch/to-target"
    ) > "$cap/ok-stdout.txt" 2> "$cap/ok-stderr.txt" || rc=$?
    if [ "$rc" -ne 0 ]; then
        fail "$name (symlink to a valid target: rc=$rc; stderr: $(cat "$cap/ok-stderr.txt"))"
        return 0
    fi
    phys=$(cd "$root" && pwd -P)
    refusal_case "$name" \
        "ERROR: --project points at this checkout ($phys). Omit --project to update it." \
        "$root" "$target" --project "$scratch/to-root"
}

# --- updateProject_projectFlagDryRun_reportsTargetWritesNothing ---
# The framework root's updater run with --project TARGET must classify exactly
# as TARGET's own updater (a twin copy, run with no flag) does, differ only by
# the `Project:` line, and write nothing in either tree.
test_project_dry_run() {
    local name="updateProject_projectFlagDryRun_reportsTargetWritesNothing"
    local root work target twin upstream cap rc=0 phys problems=""
    local old_hash root_before root_after target_before target_after
    root=$(new_root); work=$(new_scratch); cap=$(new_scratch)
    target="$work/target"; twin="$work/twin"; upstream="$work/upstream"
    new_target v0.9 "$target" > /dev/null
    new_upstream "$upstream" > /dev/null
    # Upstream carries the updater itself, so the target's copy is unchanged.
    cp "$UPDATE_SH" "$upstream/scripts/update-project.sh"
    # Safe update: local matches the manifest hash, upstream differs.
    printf 'old\n' > "$target/scripts/memory-search.sh"
    old_hash=$(sha256sum "$target/scripts/memory-search.sh" | cut -d' ' -f1)
    # Unchanged: local already equals upstream. Every other script is new.
    cp "$upstream/scripts/audit-context.sh" "$target/scripts/audit-context.sh"
    printf '{\n  "project_os_version": "v0.9",\n  "files": {\n    "scripts/memory-search.sh": "%s"\n  }\n}\n' \
        "$old_hash" > "$target/.claude/manifest.json"
    cp -R "$target" "$twin"
    phys=$(cd "$target" && pwd -P)
    root_before=$(tree_digest "$root"); target_before=$(tree_digest "$target")

    (
        cd "$work" || exit 99
        bash "$root/scripts/update-project.sh" --project target/ --local-upstream upstream
    ) > "$cap/stdout.txt" 2> "$cap/stderr.txt" || rc=$?
    (
        cd "$work" || exit 99
        bash twin/scripts/update-project.sh --local-upstream upstream
    ) > "$cap/twin-stdout.txt" 2> "$cap/twin-stderr.txt" || problems="$problems twin exited non-zero;"
    grep -v '^Project: ' "$cap/stdout.txt" > "$cap/stdout-no-project.txt" || true

    root_after=$(tree_digest "$root"); target_after=$(tree_digest "$target")
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    grep -qxF "Project: $phys" "$cap/stdout.txt" || problems="$problems no 'Project: $phys' line;"
    grep -qxF "Current version: v0.9" "$cap/stdout.txt" || problems="$problems no 'Current version: v0.9' line;"
    grep -qxF "  ✓ scripts/memory-search.sh" "$cap/stdout.txt" || problems="$problems memory-search.sh not under Safe to update;"
    grep -qxF "  + scripts/setup.sh" "$cap/stdout.txt" || problems="$problems setup.sh not under New files;"
    grep -qxF "Unchanged: 2 files (already current or user-customized)" "$cap/stdout.txt" || problems="$problems unchanged count is not 2;"
    cmp -s "$cap/stdout-no-project.txt" "$cap/twin-stdout.txt" || problems="$problems report differs from the twin's own run;"
    [ "$root_before" = "$root_after" ] || problems="$problems framework root changed;"
    [ "$target_before" = "$target_after" ] || problems="$problems target changed;"
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems stderr: $(cat "$cap/stderr.txt"); diff vs twin: $(diff "$cap/stdout-no-project.txt" "$cap/twin-stdout.txt" | head -n 10))"
    fi
}

# --- updateProject_projectFlagDiffUpstreamNoCache_hintCarriesFlag ---
# With no upstream cache the re-run hint must repeat --project, or the next
# run would diff the framework checkout; without the flag it is unchanged.
test_project_diff_upstream_hint() {
    local name="updateProject_projectFlagDiffUpstreamNoCache_hintCarriesFlag"
    local root target cap rc=0 rc_plain=0 phys problems=""
    root=$(new_root); target=$(new_target); cap=$(new_scratch)
    phys=$(cd "$target" && pwd -P)
    (
        cd "$root" || exit 99
        PROJECT_OS_UPSTREAM_CACHE="$cap/no-such-cache" \
            bash scripts/update-project.sh --diff-upstream --project "$target"
    ) > "$cap/stdout.txt" 2> "$cap/stderr.txt" || rc=$?
    (
        cd "$target" || exit 99
        PROJECT_OS_UPSTREAM_CACHE="$cap/no-such-cache" \
            bash scripts/update-project.sh --diff-upstream
    ) > "$cap/plain-stdout.txt" 2> "$cap/plain-stderr.txt" || rc_plain=$?
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    [ "$rc_plain" -eq 0 ] || problems="$problems plain rc=$rc_plain;"
    grep -qxF "Then re-run: bash scripts/update-project.sh --diff-upstream --project \"$phys\"" "$cap/stdout.txt" \
        || problems="$problems flagged hint missing;"
    grep -qxF "Then re-run: bash scripts/update-project.sh --diff-upstream" "$cap/plain-stdout.txt" \
        || problems="$problems plain hint changed;"
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems stdout: $(cat "$cap/stdout.txt"); plain stdout: $(cat "$cap/plain-stdout.txt"))"
    fi
}

ASK_RULE_A='Bash(*update-project.sh*--project*--apply*)'
ASK_RULE_B='Bash(*update-project.sh*--apply*--project*)'

# write_ask_rules ROOT [RULE...] -- write ROOT/.claude/settings.json as minimal
# JSON holding the given ask rules (default: both cross-project rules). Not a
# copy of the repository's settings, which this suite must not depend on.
write_ask_rules() {
    local root="$1" rules="" r
    shift
    if [ $# -eq 0 ]; then set -- "$ASK_RULE_A" "$ASK_RULE_B"; fi
    for r in "$@"; do rules="${rules:+$rules, }\"$r\""; done
    mkdir -p "$root/.claude"
    printf '{\n  "permissions": {\n    "ask": [%s]\n  }\n}\n' "$rules" > "$root/.claude/settings.json"
}

# make_apply_fixture LOCAL_CONTENT [TARGET_NAME] -- set FX_ROOT (framework
# root), FX_WORK, FX_TARGET (named TARGET_NAME, default "my project", so its
# path holds a space; with a .gitignore), FX_UPSTREAM, FX_THIRD (a directory
# that is neither root nor target) and FX_CAP (capture files).
# scripts/memory-search.sh is "old\n" in the manifest and holds LOCAL_CONTENT
# locally: "old\n" makes it a safe update, anything else a conflict. Plain
# assignments, not command substitution, so each case builds its own set.
make_apply_fixture() {
    local local_content="$1" old_hash
    FX_ROOT=$(new_root); FX_WORK=$(new_scratch); FX_THIRD=$(new_scratch); FX_CAP=$(new_scratch)
    FX_TARGET="$FX_WORK/${2:-my project}"; FX_UPSTREAM="$FX_WORK/upstream"
    # --project with --apply is refused unless the framework root carries the ask rules.
    write_ask_rules "$FX_ROOT"
    new_target v0.9 "$FX_TARGET" > /dev/null
    new_upstream "$FX_UPSTREAM" > /dev/null
    # Upstream carries the updater itself, so the target's copy is unchanged.
    cp "$UPDATE_SH" "$FX_UPSTREAM/scripts/update-project.sh"
    printf 'old\n' > "$FX_WORK/old.txt"
    old_hash=$(sha256sum "$FX_WORK/old.txt" | cut -d' ' -f1)
    printf '%s' "$local_content" > "$FX_TARGET/scripts/memory-search.sh"
    printf 'node_modules/\n' > "$FX_TARGET/.gitignore"
    printf '{\n  "project_os_version": "v0.9",\n  "files": {\n    "scripts/memory-search.sh": "%s"\n  }\n}\n' \
        "$old_hash" > "$FX_TARGET/.claude/manifest.json"
}

# marker_report DIR... -- print which of the two marker files exist under each DIR.
marker_report() {
    local d
    for d in "$@"; do
        printf '%s: manifest=%s map=%s; ' "$d" \
            "$([ -e "$d/manifest-ran.marker" ] && echo yes || echo no)" \
            "$([ -e "$d/map-ran.marker" ] && echo yes || echo no)"
    done
}

# --- updateProject_projectFlagApply_writesTargetOnly ---
test_project_apply_writes_target_only() {
    local name="updateProject_projectFlagApply_writesTargetOnly"
    local rc=0 problems="" root_before root_after f rel
    make_apply_fixture $'old\n'
    root_before=$(tree_digest "$FX_ROOT")
    (
        cd "$FX_THIRD" || exit 99
        bash "$FX_ROOT/scripts/update-project.sh" --apply --project "$FX_TARGET" --local-upstream "$FX_UPSTREAM"
    ) > "$FX_CAP/stdout.txt" 2> "$FX_CAP/stderr.txt" || rc=$?
    root_after=$(tree_digest "$FX_ROOT")
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    # Updated (memory-search.sh) and new files are byte-identical to upstream.
    while IFS= read -r f; do
        rel="${f#"$FX_UPSTREAM"/}"
        cmp -s "$f" "$FX_TARGET/$rel" || problems="$problems $rel differs from upstream;"
    done < <(find "$FX_UPSTREAM/scripts" -maxdepth 1 -type f)
    compgen -G "$FX_TARGET/.claude/backups/pre-update-*" > /dev/null || problems="$problems no pre-update backup in the target;"
    grep -qxF '.claude/backups/' "$FX_TARGET/.gitignore" || problems="$problems .gitignore lacks the backups block;"
    [ "$root_before" = "$root_after" ] || problems="$problems framework root changed;"
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems stdout: $(cat "$FX_CAP/stdout.txt"); stderr: $(cat "$FX_CAP/stderr.txt"))"
    fi
}

# --- updateProject_projectFlagApply_childrenRunInTarget ---
test_project_apply_children_run_in_target() {
    local name="updateProject_projectFlagApply_childrenRunInTarget"
    local rc=0 problems=""
    if ! command -v node &>/dev/null; then
        echo "  SKIP: $name (node not found)"
        return 0
    fi
    make_apply_fixture $'old\n'
    (
        cd "$FX_THIRD" || exit 99
        bash "$FX_ROOT/scripts/update-project.sh" --apply --project "$FX_TARGET" --local-upstream "$FX_UPSTREAM"
    ) > "$FX_CAP/stdout.txt" 2> "$FX_CAP/stderr.txt" || rc=$?
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    [ -e "$FX_TARGET/manifest-ran.marker" ] || problems="$problems manifest child did not run in the target;"
    [ -e "$FX_TARGET/map-ran.marker" ] || problems="$problems map child did not run in the target;"
    if [ -e "$FX_ROOT/manifest-ran.marker" ] || [ -e "$FX_ROOT/map-ran.marker" ] \
        || [ -e "$FX_THIRD/manifest-ran.marker" ] || [ -e "$FX_THIRD/map-ran.marker" ]; then
        problems="$problems a marker exists outside the target;"
    fi
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems $(marker_report "$FX_TARGET" "$FX_ROOT" "$FX_THIRD") stderr: $(cat "$FX_CAP/stderr.txt"))"
    fi
}

# --- updateProject_projectFlagApplyConflict_upstreamCopyInTargetManifestSkipped ---
test_project_apply_conflict() {
    local name="updateProject_projectFlagApplyConflict_upstreamCopyInTargetManifestSkipped"
    local rc=0 problems="" phys
    make_apply_fixture $'mine\n'
    phys=$(cd "$FX_TARGET" && pwd -P)
    (
        cd "$FX_THIRD" || exit 99
        bash "$FX_ROOT/scripts/update-project.sh" --apply --project "$FX_TARGET" --local-upstream "$FX_UPSTREAM"
    ) > "$FX_CAP/stdout.txt" 2> "$FX_CAP/stderr.txt" || rc=$?
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    cmp -s "$FX_UPSTREAM/scripts/memory-search.sh" "$FX_TARGET/scripts/memory-search.sh.upstream" \
        || problems="$problems .upstream copy does not hold upstream's content;"
    [ "$(cat "$FX_TARGET/scripts/memory-search.sh")" = "mine" ] || problems="$problems local file changed;"
    if [ -e "$FX_TARGET/manifest-ran.marker" ] || [ -e "$FX_TARGET/map-ran.marker" ] \
        || [ -e "$FX_ROOT/manifest-ran.marker" ] || [ -e "$FX_ROOT/map-ran.marker" ] \
        || [ -e "$FX_THIRD/manifest-ran.marker" ] || [ -e "$FX_THIRD/map-ran.marker" ]; then
        problems="$problems a marker exists after a conflict;"
    fi
    grep -qF "Skipping manifest regeneration" "$FX_CAP/stdout.txt" || problems="$problems no 'Skipping manifest regeneration';"
    grep -qxF "  4. Run: bash \"$phys/scripts/generate-manifest.sh\" local:upstream" "$FX_CAP/stdout.txt" \
        || problems="$problems step 4 line lacks the target's absolute path;"
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems stdout: $(cat "$FX_CAP/stdout.txt"); stderr: $(cat "$FX_CAP/stderr.txt"))"
    fi
}

# --- updateProject_noFlagFromOtherCwd_childrenRunInProject ---
# Without the flag the children still run at the project root, not at the cwd
# the updater was started from.
test_no_flag_from_other_cwd() {
    local name="updateProject_noFlagFromOtherCwd_childrenRunInProject"
    local rc=0 problems=""
    if ! command -v node &>/dev/null; then
        echo "  SKIP: $name (node not found)"
        return 0
    fi
    make_apply_fixture $'old\n'
    (
        cd "$FX_THIRD" || exit 99
        bash "$FX_TARGET/scripts/update-project.sh" --apply --local-upstream "$FX_UPSTREAM"
    ) > "$FX_CAP/stdout.txt" 2> "$FX_CAP/stderr.txt" || rc=$?
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    [ -e "$FX_TARGET/manifest-ran.marker" ] || problems="$problems manifest child did not run in the project;"
    [ -e "$FX_TARGET/map-ran.marker" ] || problems="$problems map child did not run in the project;"
    if [ -e "$FX_THIRD/manifest-ran.marker" ] || [ -e "$FX_THIRD/map-ran.marker" ]; then
        problems="$problems a marker exists in the starting directory;"
    fi
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems $(marker_report "$FX_TARGET" "$FX_THIRD") stderr: $(cat "$FX_CAP/stderr.txt"))"
    fi
}

# --- updateProject_projectFlagOwnRootCaseVariant_refused ---
# On a case-insensitive filesystem a differently-cased spelling of this
# checkout resolves to the same directory but compares unequal as a string;
# the own-root check must still refuse it.
test_project_own_root_case_variant() {
    local name="updateProject_projectFlagOwnRootCaseVariant_refused"
    local root phys variant cap rc=0 err root_before root_after
    root=$(new_root); cap=$(new_scratch)
    phys=$(cd "$root" && pwd -P)
    variant="$(dirname "$phys")/$(basename "$phys" | tr '[:lower:]' '[:upper:]')"
    if [ "$variant" = "$phys" ] || [ ! -d "$variant" ]; then
        echo "  SKIP: $name (case-sensitive filesystem)"
        return 0
    fi
    root_before=$(tree_digest "$root")
    (
        cd "$root" || exit 99
        bash scripts/update-project.sh --project "$variant"
    ) > "$cap/stdout.txt" 2> "$cap/stderr.txt" || rc=$?
    err=$(cat "$cap/stderr.txt")
    root_after=$(tree_digest "$root")
    # Match the fixed text around the path, not the path's letter case.
    if [ "$rc" -eq 1 ] \
        && [[ "$err" == "ERROR: --project points at this checkout ("*"). Omit --project to update it." ]] \
        && [ ! -s "$cap/stdout.txt" ] \
        && [ "$root_before" = "$root_after" ]; then
        pass "$name"
    else
        fail "$name (rc=$rc; variant: $variant; stdout: $(cat "$cap/stdout.txt"); stderr: $err)"
    fi
}

# --- updateProject_projectFlagManifestTokenAsValue_refused ---
# The token as a value is not the key: {"note": "project_os_version"} is no manifest.
test_project_manifest_token_as_value() {
    local target
    target=$(new_scratch)
    mkdir -p "$target/.claude"
    printf '{"note": "project_os_version"}\n' > "$target/.claude/manifest.json"
    refusal_case "updateProject_projectFlagManifestTokenAsValue_refused" \
        "$(not_a_project_msg "$target")" "$(new_root)" "$target" --project "$target"
}

# --- updateProject_projectFlagManifestEmptyVersion_refused ---
test_project_manifest_empty_version() {
    local target
    target=$(new_scratch)
    mkdir -p "$target/.claude"
    printf '{"project_os_version": ""}\n' > "$target/.claude/manifest.json"
    refusal_case "updateProject_projectFlagManifestEmptyVersion_refused" \
        "$(not_a_project_msg "$target")" "$(new_root)" "$target" --project "$target"
}

# --- updateProject_projectFlagSpecialCharPath_commandsSingleQuoted ---
# A project directory named a$(echo INJ)b must come out single-quoted in both
# printed copy-paste commands, so pasting them expands nothing.
test_project_special_char_path() {
    local name="updateProject_projectFlagSpecialCharPath_commandsSingleQuoted"
    local problems="" phys rc_hint=0 rc_apply=0
    make_apply_fixture $'mine\n' 'a$(echo INJ)b'
    phys=$(cd "$FX_TARGET" && pwd -P)
    (
        cd "$FX_THIRD" || exit 99
        PROJECT_OS_UPSTREAM_CACHE="$FX_CAP/no-such-cache" \
            bash "$FX_ROOT/scripts/update-project.sh" --diff-upstream --project "$FX_TARGET"
    ) > "$FX_CAP/hint-stdout.txt" 2> "$FX_CAP/hint-stderr.txt" || rc_hint=$?
    (
        cd "$FX_THIRD" || exit 99
        bash "$FX_ROOT/scripts/update-project.sh" --apply --project "$FX_TARGET" --local-upstream "$FX_UPSTREAM"
    ) > "$FX_CAP/apply-stdout.txt" 2> "$FX_CAP/apply-stderr.txt" || rc_apply=$?
    [ "$rc_hint" -eq 0 ] || problems="$problems hint rc=$rc_hint;"
    [ "$rc_apply" -eq 0 ] || problems="$problems apply rc=$rc_apply;"
    grep -qxF "Then re-run: bash scripts/update-project.sh --diff-upstream --project '$phys'" "$FX_CAP/hint-stdout.txt" \
        || problems="$problems re-run hint is not single-quoted;"
    grep -qxF "  4. Run: bash '$phys/scripts/generate-manifest.sh' local:upstream" "$FX_CAP/apply-stdout.txt" \
        || problems="$problems step 4 is not single-quoted;"
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems hint stdout: $(cat "$FX_CAP/hint-stdout.txt"); apply stdout: $(cat "$FX_CAP/apply-stdout.txt"))"
    fi
}

# --- updateProject_relativeTmpdirApply_noTempDirLeftBehind ---
# A relative TMPDIR is resolved against the project root once the updater has
# cd'd there before Step 9, which orphaned the temp dir. Started from another
# directory with a relative TMPDIR, nothing may be left behind.
test_relative_tmpdir_cleanup() {
    local name="updateProject_relativeTmpdirApply_noTempDirLeftBehind"
    local root start repo rc=0 problems=""
    root=$(new_root); start=$(new_scratch); repo=$(new_scratch)
    mkdir -p "$repo/.claude" "$start/reltmp"
    printf 'name: x\n' > "$repo/.claude/maintenance-policy.yaml"
    git -C "$repo" init -q
    git -C "$repo" add -A
    git -C "$repo" -c user.name=t -c user.email=t@example.com commit -q -m init
    git -C "$repo" archive --format=tar.gz --prefix=proj-1.1/ HEAD -o "$start/a.tar.gz"
    # Step 9 needs a manifest generator in the project.
    printf '#!/usr/bin/env bash\nexit 0\n' > "$root/scripts/generate-manifest.sh"
    (
        cd "$start" || exit 99
        PATH="$root/bin:$PATH" TMPDIR=reltmp GH_STUB_ARCHIVE="$start/a.tar.gz" \
            bash "$root/scripts/update-project.sh" --apply
    ) > "$start/stdout.txt" 2> "$start/stderr.txt" || rc=$?
    [ "$rc" -eq 0 ] || problems="$problems rc=$rc;"
    [ -f "$root/.claude/maintenance-policy.yaml" ] || problems="$problems apply did not reach the project;"
    [ -z "$(ls -A "$start/reltmp")" ] || problems="$problems left behind: $(ls -A "$start/reltmp");"
    if [ -z "$problems" ]; then
        pass "$name"
    else
        fail "$name ($problems stdout: $(cat "$start/stdout.txt"); stderr: $(cat "$start/stderr.txt"))"
    fi
}

# ask_rules_case NAME SETTINGS_MODE ORDER -- refusal of --project with --apply
# when the framework root's settings.json lacks the ask rules. SETTINGS_MODE:
# none (no file), empty ({}), onlyA, onlyB. ORDER: apply-first or project-first.
ask_rules_case() {
    local name="$1" mode="$2" order="$3" root target upstream phys msg
    root=$(new_root); target=$(new_target); upstream=$(new_upstream)
    case "$mode" in
        none) ;;
        empty) printf '{}\n' > "$root/.claude/settings.json" ;;
        onlyA) write_ask_rules "$root" "$ASK_RULE_A" ;;
        onlyB) write_ask_rules "$root" "$ASK_RULE_B" ;;
    esac
    phys=$(cd "$root" && pwd -P)
    msg=$(printf '%s\n%s' \
        "ERROR: --project with --apply needs the ask rules for a cross-project apply in $phys/.claude/settings.json." \
        'Merge the "ask" block from this release'"'"'s .claude/settings.json (after an update it is saved as .claude/settings.json.upstream), then re-run.')
    if [ "$order" = apply-first ]; then
        refusal_case "$name" "$msg" "$root" "$target" --apply --project "$target" --local-upstream "$upstream"
    else
        refusal_case "$name" "$msg" "$root" "$target" --project "$target" --local-upstream "$upstream" --apply
    fi
}

# --- updateProject_projectFlagApplyEmptySettings_refused ---
test_apply_rules_empty_settings() {
    ask_rules_case "updateProject_projectFlagApplyEmptySettings_refused" empty apply-first
}

# --- updateProject_projectFlagApplyNoSettingsFile_refused ---
test_apply_rules_no_settings() {
    ask_rules_case "updateProject_projectFlagApplyNoSettingsFile_refused" none project-first
}

# --- updateProject_projectFlagApplyOnlyFirstRule_refused ---
test_apply_rules_only_first() {
    ask_rules_case "updateProject_projectFlagApplyOnlyFirstRule_refused" onlyA apply-first
}

# --- updateProject_projectFlagApplyOnlySecondRule_refused ---
test_apply_rules_only_second() {
    ask_rules_case "updateProject_projectFlagApplyOnlySecondRule_refused" onlyB project-first
}

# --- updateProject_projectFlagDryRunWithoutAskRules_exitsZero ---
# A dry run executes nothing from the target and writes nothing, so it needs no rules.
test_dry_run_without_rules() {
    local name="updateProject_projectFlagDryRunWithoutAskRules_exitsZero"
    local root target upstream cap rc=0
    root=$(new_root); target=$(new_target); upstream=$(new_upstream); cap=$(new_scratch)
    (
        cd "$root" || exit 99
        bash scripts/update-project.sh --project "$target" --local-upstream "$upstream"
    ) > "$cap/stdout.txt" 2> "$cap/stderr.txt" || rc=$?
    if [ "$rc" -eq 0 ] && [ ! -e "$root/.claude/settings.json" ] \
        && grep -q '^Dry run complete\.' "$cap/stdout.txt"; then
        pass "$name"
    else
        fail "$name (rc=$rc; stdout: $(cat "$cap/stdout.txt"); stderr: $(cat "$cap/stderr.txt"))"
    fi
}

if [ "$HAVE_PYTHON3" = true ]; then
    test_clean
    test_symlink_escape
    test_symlink_inbounds
    test_hardlink
    test_dotdot
    test_git_archive
else
    echo "SKIP: python3 not found (needed to craft hostile tar archives); 6 archive cases not run"
fi
test_repo_as_upstream
test_script_lists_match
test_project_missing_argument
test_project_flag_as_argument
test_project_empty_argument
test_project_missing_dir
test_project_not_a_directory
test_project_own_root
test_project_no_manifest
test_project_manifest_is_directory
test_project_manifest_without_version
test_project_symlinked_dir
test_project_dry_run
test_project_diff_upstream_hint
test_project_apply_writes_target_only
test_project_apply_children_run_in_target
test_project_apply_conflict
test_no_flag_from_other_cwd
test_project_own_root_case_variant
test_project_manifest_token_as_value
test_project_manifest_empty_version
test_project_special_char_path
test_relative_tmpdir_cleanup
test_apply_rules_empty_settings
test_apply_rules_no_settings
test_apply_rules_only_first
test_apply_rules_only_second
test_dry_run_without_rules

echo ""
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "All update-project smoke cases passed."
    exit 0
fi
echo "$FAIL_COUNT update-project smoke case(s) failed."
exit 1
