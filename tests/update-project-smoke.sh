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

if ! command -v python3 &>/dev/null; then
    echo "SKIP: python3 not found (needed to craft hostile tar archives)"
    exit 0
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

test_clean
test_symlink_escape
test_symlink_inbounds
test_hardlink
test_dotdot
test_git_archive

echo ""
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo "All update-project smoke cases passed."
    exit 0
fi
echo "$FAIL_COUNT update-project smoke case(s) failed."
exit 1
