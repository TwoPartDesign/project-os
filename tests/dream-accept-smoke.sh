#!/usr/bin/env bash
# Smoke tests for scripts/dream-accept.sh
# Each scenario builds its own isolated fixture project dir under a fresh
# mktemp -d, points PROJECT_OS_ROOT at it, and cleans up after itself —
# no shared mutable state between scenarios.
# Usage: bash tests/dream-accept-smoke.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DREAM_ACCEPT="$PROJECT_ROOT/scripts/dream-accept.sh"

PASS=0
FAIL=0
ERRORS=""

pass() {
    local name="$1"
    PASS=$((PASS + 1))
    echo "  PASS: $name"
}

fail() {
    local name="$1"
    local detail="$2"
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  FAIL: $name\n$detail"
    echo "  FAIL: $name"
}

assert_eq() {
    local name="$1" expected="$2" actual="$3" detail="$4"
    if [ "$expected" = "$actual" ]; then
        pass "$name"
    else
        fail "$name" "expected [$expected], got [$actual]\n$detail"
    fi
}

assert_true() {
    local name="$1" cond="$2" detail="$3"
    if [ "$cond" = "0" ]; then
        pass "$name"
    else
        fail "$name" "$detail"
    fi
}

# =============================================================================
echo "=== dream-accept.sh smoke tests ==="
echo ""

# --- Scenario (a): happy-path accept -----------------------------------------
echo "Scenario (a): happy-path accept"

FIXTURE_A="$(mktemp -d)"
mkdir -p "$FIXTURE_A/.claude"
mkdir -p "$FIXTURE_A/docs/memory"
echo "original content a" > "$FIXTURE_A/docs/memory/a.md"
echo "original content b" > "$FIXTURE_A/docs/memory/b.md"
TS_A="2026-01-01-0000"
mkdir -p "$FIXTURE_A/docs/memory/.dream-output/$TS_A/memory"
echo "consolidated content" > "$FIXTURE_A/docs/memory/.dream-output/$TS_A/memory/consolidated.md"

set +e
OUTPUT_A="$(PROJECT_OS_ROOT="$FIXTURE_A" bash "$DREAM_ACCEPT" "$TS_A" 2>&1)"
EXIT_A=$?
set -e

assert_eq "dreamAccept_happyPath_exitsZero" "0" "$EXIT_A" "$OUTPUT_A"

if [ -f "$FIXTURE_A/docs/memory/consolidated.md" ]; then
    STAGED_CONTENT="$(cat "$FIXTURE_A/docs/memory/consolidated.md")"
    assert_eq "dreamAccept_happyPath_stagedFileLandsInMemory" "consolidated content" "$STAGED_CONTENT" "$OUTPUT_A"
else
    fail "dreamAccept_happyPath_stagedFileLandsInMemory" "docs/memory/consolidated.md not found\n$OUTPUT_A"
fi

if [ -f "$FIXTURE_A/docs/memory/.archive/$TS_A/a.md" ] && [ -f "$FIXTURE_A/docs/memory/.archive/$TS_A/b.md" ]; then
    BACKUP_A="$(cat "$FIXTURE_A/docs/memory/.archive/$TS_A/a.md")"
    BACKUP_B="$(cat "$FIXTURE_A/docs/memory/.archive/$TS_A/b.md")"
    if [ "$BACKUP_A" = "original content a" ] && [ "$BACKUP_B" = "original content b" ]; then
        pass "dreamAccept_happyPath_backupContainsOriginals"
    else
        fail "dreamAccept_happyPath_backupContainsOriginals" "backup content mismatch\n$OUTPUT_A"
    fi
else
    fail "dreamAccept_happyPath_backupContainsOriginals" "backup dir missing files\n$OUTPUT_A"
fi

if [ -d "$FIXTURE_A/docs/memory/.dream-output/$TS_A" ]; then
    fail "dreamAccept_happyPath_stagingDirRemoved" "staging dir still present\n$OUTPUT_A"
else
    pass "dreamAccept_happyPath_stagingDirRemoved"
fi

rm -rf "$FIXTURE_A"
echo ""

# --- Scenario (b): invalid timestamp rejected --------------------------------
echo "Scenario (b): invalid timestamp rejected"

FIXTURE_B="$(mktemp -d)"
mkdir -p "$FIXTURE_B/.claude"
mkdir -p "$FIXTURE_B/docs/memory"
echo "untouched a" > "$FIXTURE_B/docs/memory/a.md"
echo "untouched b" > "$FIXTURE_B/docs/memory/b.md"

set +e
OUTPUT_B="$(PROJECT_OS_ROOT="$FIXTURE_B" bash "$DREAM_ACCEPT" "../evil" 2>&1)"
EXIT_B=$?
set -e

if [ "$EXIT_B" -ne 0 ]; then
    pass "dreamAccept_invalidTimestamp_exitsNonzero"
else
    fail "dreamAccept_invalidTimestamp_exitsNonzero" "expected nonzero exit, got 0\n$OUTPUT_B"
fi

if echo "$OUTPUT_B" | grep -q "invalid timestamp"; then
    pass "dreamAccept_invalidTimestamp_errorMessageMentionsFormat"
else
    fail "dreamAccept_invalidTimestamp_errorMessageMentionsFormat" "$OUTPUT_B"
fi

CONTENT_A_AFTER="$(cat "$FIXTURE_B/docs/memory/a.md")"
CONTENT_B_AFTER="$(cat "$FIXTURE_B/docs/memory/b.md")"
if [ "$CONTENT_A_AFTER" = "untouched a" ] && [ "$CONTENT_B_AFTER" = "untouched b" ] && [ ! -d "$FIXTURE_B/docs/memory/.archive" ]; then
    pass "dreamAccept_invalidTimestamp_memoryUntouched"
else
    fail "dreamAccept_invalidTimestamp_memoryUntouched" "docs/memory was modified\n$OUTPUT_B"
fi

rm -rf "$FIXTURE_B"
echo ""

# --- Scenario (c): missing staging dir ---------------------------------------
echo "Scenario (c): missing staging dir"

FIXTURE_C="$(mktemp -d)"
mkdir -p "$FIXTURE_C/.claude"
mkdir -p "$FIXTURE_C/docs/memory"
echo "untouched a" > "$FIXTURE_C/docs/memory/a.md"
echo "untouched b" > "$FIXTURE_C/docs/memory/b.md"
TS_C="2026-02-02-0000"
# Deliberately: no docs/memory/.dream-output/$TS_C directory created.

set +e
OUTPUT_C="$(PROJECT_OS_ROOT="$FIXTURE_C" bash "$DREAM_ACCEPT" "$TS_C" 2>&1)"
EXIT_C=$?
set -e

if [ "$EXIT_C" -ne 0 ]; then
    pass "dreamAccept_missingStagingDir_exitsNonzero"
else
    fail "dreamAccept_missingStagingDir_exitsNonzero" "expected nonzero exit, got 0\n$OUTPUT_C"
fi

if echo "$OUTPUT_C" | grep -q "staging directory not found"; then
    pass "dreamAccept_missingStagingDir_errorMessageIsSpecific"
else
    fail "dreamAccept_missingStagingDir_errorMessageIsSpecific" "$OUTPUT_C"
fi

CONTENT_A_AFTER_C="$(cat "$FIXTURE_C/docs/memory/a.md")"
if [ "$CONTENT_A_AFTER_C" = "untouched a" ] && [ ! -d "$FIXTURE_C/docs/memory/.archive" ]; then
    pass "dreamAccept_missingStagingDir_memoryUntouched"
else
    fail "dreamAccept_missingStagingDir_memoryUntouched" "docs/memory was modified\n$OUTPUT_C"
fi

rm -rf "$FIXTURE_C"
echo ""

# --- Scenario (d): interrupted swap is recovered ------------------------------
echo "Scenario (d): interrupted swap recovery"

FIXTURE_D="$(mktemp -d)"
mkdir -p "$FIXTURE_D/.claude"
mkdir -p "$FIXTURE_D/docs/memory"
TS_D="2026-03-03-0000"

# Simulate mid-swap state: docs/memory currently holds partially-applied
# content, the pre-swap backup exists under .archive/, and the in-progress
# marker was left behind by an interrupted prior run.
echo "partially applied content" > "$FIXTURE_D/docs/memory/a.md"
mkdir -p "$FIXTURE_D/docs/memory/.archive/$TS_D"
echo "original a" > "$FIXTURE_D/docs/memory/.archive/$TS_D/a.md"
echo "original b" > "$FIXTURE_D/docs/memory/.archive/$TS_D/b.md"
mkdir -p "$FIXTURE_D/docs/memory/.dream-output/$TS_D/memory"
touch "$FIXTURE_D/docs/memory/.dream-output/$TS_D/.swap-in-progress"

set +e
OUTPUT_D="$(PROJECT_OS_ROOT="$FIXTURE_D" bash "$DREAM_ACCEPT" "irrelevant-arg" 2>&1)"
EXIT_D=$?
set -e

assert_eq "dreamAccept_interruptedSwap_exitsOne" "1" "$EXIT_D" "$OUTPUT_D"

if echo "$OUTPUT_D" | grep -q "recovered interrupted swap from $TS_D"; then
    pass "dreamAccept_interruptedSwap_printsRecoveryMessage"
else
    fail "dreamAccept_interruptedSwap_printsRecoveryMessage" "$OUTPUT_D"
fi

if [ -f "$FIXTURE_D/docs/memory/.dream-output/$TS_D/.swap-in-progress" ]; then
    fail "dreamAccept_interruptedSwap_markerRemoved" "marker still present\n$OUTPUT_D"
else
    pass "dreamAccept_interruptedSwap_markerRemoved"
fi

RESTORED_A="$(cat "$FIXTURE_D/docs/memory/a.md" 2>/dev/null || echo "MISSING")"
if [ "$RESTORED_A" = "original a" ]; then
    pass "dreamAccept_interruptedSwap_restoresBackupContent"
else
    fail "dreamAccept_interruptedSwap_restoresBackupContent" "expected [original a], got [$RESTORED_A]\n$OUTPUT_D"
fi

if [ -f "$FIXTURE_D/docs/memory/b.md" ] && [ "$(cat "$FIXTURE_D/docs/memory/b.md")" = "original b" ]; then
    pass "dreamAccept_interruptedSwap_restoresAllBackupFiles"
else
    fail "dreamAccept_interruptedSwap_restoresAllBackupFiles" "b.md not restored\n$OUTPUT_D"
fi

rm -rf "$FIXTURE_D"
echo ""

# --- Scenario (e): manifest-driven source removal (true swap) ----------------
echo "Scenario (e): manifest-driven source removal"

FIXTURE_E="$(mktemp -d)"
mkdir -p "$FIXTURE_E/.claude"
mkdir -p "$FIXTURE_E/docs/memory"
echo "source a" > "$FIXTURE_E/docs/memory/a.md"
echo "source b" > "$FIXTURE_E/docs/memory/b.md"
echo "unlisted c" > "$FIXTURE_E/docs/memory/c.md"
TS_E="2026-04-04-0000"
mkdir -p "$FIXTURE_E/docs/memory/.dream-output/$TS_E/memory"
echo "consolidated a+b" > "$FIXTURE_E/docs/memory/.dream-output/$TS_E/memory/consolidated.md"
MANIFEST_E="$FIXTURE_E/docs/memory/.dream-output/$TS_E/manifest.yaml"
echo 'timestamp: "2026-04-04-0000"' > "$MANIFEST_E"
echo 'model: sonnet' >> "$MANIFEST_E"
echo 'session_count: 2' >> "$MANIFEST_E"
echo 'memory_files:' >> "$MANIFEST_E"
echo '  - docs/memory/a.md' >> "$MANIFEST_E"
echo '  - docs/memory/b.md' >> "$MANIFEST_E"
echo 'session_files:' >> "$MANIFEST_E"
echo '  - .claude/sessions/handoff-x.yaml' >> "$MANIFEST_E"

set +e
OUTPUT_E="$(PROJECT_OS_ROOT="$FIXTURE_E" bash "$DREAM_ACCEPT" "$TS_E" 2>&1)"
EXIT_E=$?
set -e

assert_eq "dreamAccept_manifestRemoval_exitsZero" "0" "$EXIT_E" "$OUTPUT_E"

if [ -f "$FIXTURE_E/docs/memory/consolidated.md" ]; then
    pass "dreamAccept_manifestRemoval_consolidatedFileLands"
else
    fail "dreamAccept_manifestRemoval_consolidatedFileLands" "consolidated.md not found\n$OUTPUT_E"
fi

if [ ! -f "$FIXTURE_E/docs/memory/a.md" ] && [ ! -f "$FIXTURE_E/docs/memory/b.md" ]; then
    pass "dreamAccept_manifestRemoval_consumedSourcesRemovedFromMemory"
else
    fail "dreamAccept_manifestRemoval_consumedSourcesRemovedFromMemory" "a.md or b.md still present in docs/memory\n$OUTPUT_E"
fi

if [ -f "$FIXTURE_E/docs/memory/.archive/$TS_E/a.md" ] && [ -f "$FIXTURE_E/docs/memory/.archive/$TS_E/b.md" ]; then
    ARCHIVED_A="$(cat "$FIXTURE_E/docs/memory/.archive/$TS_E/a.md")"
    ARCHIVED_B="$(cat "$FIXTURE_E/docs/memory/.archive/$TS_E/b.md")"
    if [ "$ARCHIVED_A" = "source a" ] && [ "$ARCHIVED_B" = "source b" ]; then
        pass "dreamAccept_manifestRemoval_removedSourcesSurviveInArchive"
    else
        fail "dreamAccept_manifestRemoval_removedSourcesSurviveInArchive" "archive content mismatch\n$OUTPUT_E"
    fi
else
    fail "dreamAccept_manifestRemoval_removedSourcesSurviveInArchive" "archive missing a.md/b.md\n$OUTPUT_E"
fi

if [ -f "$FIXTURE_E/docs/memory/c.md" ] && [ "$(cat "$FIXTURE_E/docs/memory/c.md")" = "unlisted c" ]; then
    pass "dreamAccept_manifestRemoval_unlistedFileSurvives"
else
    fail "dreamAccept_manifestRemoval_unlistedFileSurvives" "c.md missing or modified\n$OUTPUT_E"
fi

if echo "$OUTPUT_E" | grep -q "removed 2 consumed source file(s) per manifest.yaml"; then
    pass "dreamAccept_manifestRemoval_reportsRemovedCount"
else
    fail "dreamAccept_manifestRemoval_reportsRemovedCount" "$OUTPUT_E"
fi

rm -rf "$FIXTURE_E"
echo ""

# --- Scenario (f): missing manifest degrades gracefully ----------------------
echo "Scenario (f): missing manifest.yaml degrades gracefully (no removals)"

FIXTURE_F="$(mktemp -d)"
mkdir -p "$FIXTURE_F/.claude"
mkdir -p "$FIXTURE_F/docs/memory"
echo "source a" > "$FIXTURE_F/docs/memory/a.md"
echo "source b" > "$FIXTURE_F/docs/memory/b.md"
TS_F="2026-05-05-0000"
mkdir -p "$FIXTURE_F/docs/memory/.dream-output/$TS_F/memory"
echo "consolidated a+b" > "$FIXTURE_F/docs/memory/.dream-output/$TS_F/memory/consolidated.md"
# Deliberately: no manifest.yaml written in the staging dir.

set +e
OUTPUT_F="$(PROJECT_OS_ROOT="$FIXTURE_F" bash "$DREAM_ACCEPT" "$TS_F" 2>&1)"
EXIT_F=$?
set -e

assert_eq "dreamAccept_missingManifest_exitsZero" "0" "$EXIT_F" "$OUTPUT_F"

if echo "$OUTPUT_F" | grep -q "warning: manifest.yaml missing or unparseable — additive apply only; sources not removed; clean up manually"; then
    pass "dreamAccept_missingManifest_printsExactWarning"
else
    fail "dreamAccept_missingManifest_printsExactWarning" "$OUTPUT_F"
fi

if [ -f "$FIXTURE_F/docs/memory/a.md" ] && [ "$(cat "$FIXTURE_F/docs/memory/a.md")" = "source a" ] \
   && [ -f "$FIXTURE_F/docs/memory/b.md" ] && [ "$(cat "$FIXTURE_F/docs/memory/b.md")" = "source b" ]; then
    pass "dreamAccept_missingManifest_noSourcesRemoved"
else
    fail "dreamAccept_missingManifest_noSourcesRemoved" "a.md or b.md missing/modified\n$OUTPUT_F"
fi

if [ -f "$FIXTURE_F/docs/memory/consolidated.md" ]; then
    pass "dreamAccept_missingManifest_stagedFileStillApplied"
else
    fail "dreamAccept_missingManifest_stagedFileStillApplied" "consolidated.md not found (additive apply should still happen)\n$OUTPUT_F"
fi

rm -rf "$FIXTURE_F"
echo ""

# --- Summary ------------------------------------------------------------------
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:"
    echo -e "$ERRORS"
    exit 1
fi

exit 0
