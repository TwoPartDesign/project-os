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
TMP_DIRS=()

pass() { printf 'PASS: %s\n' "$1"; }
fail() {
    printf 'FAIL: %s\n' "$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

cleanup() {
    local d
    for d in "${TMP_DIRS[@]}"; do
        rm -rf "$d" 2>/dev/null || true
    done
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
    root=$(mktemp -d)
    TMP_DIRS+=("$root")
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
    d=$(mktemp -d)
    TMP_DIRS+=("$d")
    printf '%s' "$d"
}

# new_target [VERSION] -- print a fresh project directory: a manifest holding
# project_os_version (default v0.9, distinct from new_root's v1.0) and its own
# copy of the updater, as a real project has.
new_target() {
    local ver="${1:-v0.9}" t
    t=$(new_scratch)
    mkdir -p "$t/.claude" "$t/scripts"
    printf '{\n  "project_os_version": "%s"\n}\n' "$ver" > "$t/.claude/manifest.json"
    cp "$UPDATE_SH" "$t/scripts/update-project.sh"
    printf '%s' "$t"
}

# new_upstream -- print a fresh upstream directory whose scripts/ holds a
# one-line stub for every top-level *.sh and *.ts name in the repo's scripts/,
# so the updater's list check passes in both directions whatever the list holds.
new_upstream() {
    local up f
    up=$(new_scratch)
    mkdir -p "$up/scripts"
    while IFS= read -r f; do
        printf '# stub\n' > "$up/scripts/$(basename "$f")"
    done < <(find "$REPO_ROOT/scripts" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.ts' \))
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

echo ""
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "All update-project smoke cases passed."
    exit 0
fi
echo "$FAIL_COUNT update-project smoke case(s) failed."
exit 1
