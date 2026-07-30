#!/bin/bash
# Behavioural tests for the compaction-gate hooks:
#   .claude/hooks/compact-suggest.sh  (PostToolUse pressure nudge)
#   .claude/hooks/pre-compact.sh      (PreCompact instruction forwarding)
#
# hook-smoke.sh only asserts these exit 0. This file asserts what they DO:
# that the nudge fires exactly once per compaction cycle, that pre-compact
# forwards a drafted compact_instruction as plain text, and that the paths it
# reads are contained.
#
# Isolation: every test builds a fresh sandbox project root and copies the
# hooks into it. The hooks derive their project root from their own location
# ($SCRIPT_DIR/../..), so a copied hook reads and writes only inside the
# sandbox — the real .claude/sessions/ and .claude/logs/ are never touched.
#
# Usage: bash tests/compaction-hooks.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REAL_HOOKS="$PROJECT_ROOT/.claude/hooks"

PASS=0
FAIL=0
ERRORS=""
SANDBOXES=()

cleanup() {
    local sb
    for sb in ${SANDBOXES+"${SANDBOXES[@]}"}; do
        [ -n "$sb" ] && rm -rf "$sb"
    done
}
trap cleanup EXIT

ok() {
    PASS=$((PASS + 1))
    echo "  PASS: $1"
}

bad() {
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}
  FAIL: $1"
    echo "  FAIL: $1"
}

# assert_contains <name> <haystack> <needle>
assert_contains() {
    case "$2" in
        *"$3"*) ok "$1" ;;
        *)      bad "$1 — expected output to contain: $3" ;;
    esac
}

# assert_not_contains <name> <haystack> <needle>
assert_not_contains() {
    case "$2" in
        *"$3"*) bad "$1 — output unexpectedly contained: $3" ;;
        *)      ok "$1" ;;
    esac
}

assert_file_exists() {
    if [ -e "$2" ]; then ok "$1"; else bad "$1 — missing: $2"; fi
}

assert_file_absent() {
    if [ -e "$2" ]; then bad "$1 — unexpectedly present: $2"; else ok "$1"; fi
}

assert_eq() {
    if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — expected '$3', got '$2'"; fi
}

# ── Sandbox ─────────────────────────────────────────────────────────────────
# Echoes the sandbox root. The caller uses $SB/.claude/hooks/<hook>.sh.
new_sandbox() {
    local sb
    sb="$(mktemp -d)"
    SANDBOXES+=("$sb")

    mkdir -p "$sb/.claude/hooks" "$sb/.claude/sessions" "$sb/.claude/logs" "$sb/scripts"
    cp "$REAL_HOOKS/_common.sh" "$REAL_HOOKS/compact-suggest.sh" \
       "$REAL_HOOKS/pre-compact.sh" "$REAL_HOOKS/session-end-cleanup.sh" \
       "$sb/.claude/hooks/"

    # A system-map stub that reports "no drift", so drift lines don't pollute
    # stdout assertions. drift_the_map() replaces it when drift is the subject.
    printf 'process.exit(0);\n' > "$sb/scripts/system-map.ts"

    printf '# ROADMAP\n\n## Feature: sandbox-feature\n\n- [-] Sandbox task in progress #T900\n' \
        > "$sb/ROADMAP.md"

    echo "$sb"
}

drift_the_map() {
    printf 'process.exit(3);\n' > "$1/scripts/system-map.ts"
}

# write_handoff <sandbox> <name> <instruction-body>
# Body lines are written with the 2-space block-scalar indent the hook strips.
write_handoff() {
    local sb="$1" name="$2" body="$3"
    {
        printf 'timestamp: "2026-07-30T00:00:00Z"\n'
        printf 'phase: "build"\n'
        printf 'feature: "sandbox-feature"\n'
        printf '\n'
        printf 'compact_instruction: |\n'
        while IFS= read -r line; do
            printf '  %s\n' "$line"
        done <<< "$body"
    } > "$sb/.claude/sessions/$name"
}

# make_transcript <path> <bytes>
make_transcript() {
    dd if=/dev/zero bs=1 count="$2" 2>/dev/null | tr '\0' 'x' > "$1"
}

echo "=== Compaction Hook Behaviour ==="
echo ""

# ── compact-suggest.sh ──────────────────────────────────────────────────────
echo "compact-suggest.sh:"

# nudge_transcriptGrowthOverThreshold_emitsAdditionalContext
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
OUT=$(printf '{"session_id":"s1","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_contains "nudge_transcriptGrowthOverThreshold_emitsAdditionalContext" \
    "$OUT" '"hookEventName":"PostToolUse"'
assert_contains "nudge_message_namesHandoffCommand" "$OUT" "/tools:handoff"
assert_contains "nudge_message_namesCompactInstructionField" "$OUT" "compact_instruction"

# nudge_growthUnderThreshold_staysSilent
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 50
OUT=$(printf '{"session_id":"s1","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=100000 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_eq "nudge_growthUnderThreshold_staysSilent" "$OUT" ""

# nudge_secondCallSameCycle_staysSilent  (one nudge per compaction cycle)
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
PAYLOAD=$(printf '{"session_id":"s1","transcript_path":"%s"}' "$SB/transcript.jsonl")
echo "$PAYLOAD" | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
OUT=$(echo "$PAYLOAD" | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_eq "nudge_secondCallSameCycle_staysSilent" "$OUT" ""
assert_file_exists "nudge_firstCall_writesNudgedMarker" "$SB/.claude/logs/.compact-nudged-s1"

# nudge_transcriptSmallerThanBaseline_resetsBaselineWithoutNudging
SB="$(new_sandbox)"
printf '99999\n' > "$SB/.claude/logs/.compact-base-s1"
make_transcript "$SB/transcript.jsonl" 500
OUT=$(printf '{"session_id":"s1","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_eq "nudge_transcriptSmallerThanBaseline_staysSilent" "$OUT" ""
NEW_BASE=$(tr -cd '0-9' < "$SB/.claude/logs/.compact-base-s1")
assert_eq "nudge_transcriptSmallerThanBaseline_rewritesBaseline" "$NEW_BASE" "500"

# nudge_missingTranscript_staysSilent
SB="$(new_sandbox)"
OUT=$(printf '{"session_id":"s1","transcript_path":"%s/nope.jsonl"}' "$SB" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=1 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_eq "nudge_missingTranscript_staysSilent" "$OUT" ""

# nudge_traversalSessionId_sanitizedIntoLogDir
# "../../etc/passwd" must become "etcpasswd" — a marker inside .claude/logs/,
# not a write that escapes it.
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
printf '{"session_id":"../../etc/passwd","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
assert_file_exists "sessionId_traversal_sanitizedToLogDir" \
    "$SB/.claude/logs/.compact-nudged-etcpasswd"
ESCAPED=$(find "$SB" -name '.compact-nudged-*' -not -path "$SB/.claude/logs/*" 2>/dev/null | head -1)
assert_eq "sessionId_traversal_wroteNothingOutsideLogDir" "$ESCAPED" ""

echo ""

# ── pre-compact.sh ──────────────────────────────────────────────────────────
echo "pre-compact.sh:"

# forward_freshHandoff_printsInstructionAsPlainText
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" \
    "Preserve the awk extraction in pre-compact.sh:78-82.
Safe to drop: the abandoned flock counter."
OUT=$(printf '{"session_id":"s1","trigger":"auto","transcript_path":""}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "forward_freshHandoff_printsInstructionBody" \
    "$OUT" "Preserve the awk extraction in pre-compact.sh:78-82."
assert_contains "forward_freshHandoff_printsSecondLine" \
    "$OUT" "Safe to drop: the abandoned flock counter."
assert_contains "forward_freshHandoff_pointsAtHandoffPath" \
    "$OUT" ".claude/sessions/handoff-2026-07-30-1200.yaml"
# The runtime forwards stdout verbatim as summarizer instructions, so a JSON
# envelope here would be read as instruction text.
assert_not_contains "forward_stdout_isPlainTextNotJson" "$OUT" "hookSpecificOutput"

# forward_multipleHandoffs_usesNewestByName
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-0900.yaml" "OLDER instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "NEWER instruction"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "forward_multipleHandoffs_usesNewestByName" "$OUT" "NEWER instruction"
assert_not_contains "forward_multipleHandoffs_ignoresOlder" "$OUT" "OLDER instruction"

# forward_unfilledPlaceholder_treatedAsAbsent
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" \
    "[A /compact instruction tuned to the current task, e.g.:
 \"Focus on the auth middleware refactor in src/middleware/auth.ts.\"]"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_eq "forward_unfilledPlaceholder_treatedAsAbsent" "$OUT" ""

# forward_staleHandoff_ignored — older than PROJECT_OS_HANDOFF_MAX_AGE_MIN
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "STALE instruction"
touch -d '2 hours ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_eq "forward_staleHandoff_ignored" "$OUT" ""

# forward_noHandoff_cleanMap_printsNothing
SB="$(new_sandbox)"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_eq "forward_noHandoff_cleanMap_printsNothing" "$OUT" ""

# forward_driftedMap_noHandoff_printsCaveatOnly
SB="$(new_sandbox)"
drift_the_map "$SB"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "forward_driftedMap_noHandoff_printsCaveat" "$OUT" "system map at docs/maps/ is drifted"

# forward_driftedMap_withHandoff_printsBoth
SB="$(new_sandbox)"
drift_the_map "$SB"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "Keep the pressure-baseline reset."
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "forward_driftedMap_withHandoff_printsInstruction" "$OUT" "Keep the pressure-baseline reset."
assert_contains "forward_driftedMap_withHandoff_printsCaveat" "$OUT" "system map at docs/maps/ is drifted"

# ── Containment ─────────────────────────────────────────────────────────────
# Handoff discovery is `find -type f`, which never yields a symlink, and
# resolve_project_path re-checks containment. Both indirection cases must be
# rejected: the one that escapes the project AND the one that stays inside it.

# containment_symlinkEscapingProject_rejected
SB="$(new_sandbox)"
OUTSIDE="$(mktemp -d)"
SANDBOXES+=("$OUTSIDE")
mkdir -p "$OUTSIDE/.claude/sessions"
write_handoff "$OUTSIDE" "handoff-2026-07-30-1200.yaml" "ESCAPED instruction"
ln -s "$OUTSIDE/.claude/sessions/handoff-2026-07-30-1200.yaml" \
      "$SB/.claude/sessions/handoff-2026-07-30-1300.yaml"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "containment_symlinkEscapingProject_rejected" "$OUT" "ESCAPED instruction"

# containment_symlinkToInScopeSibling_alsoRejected
# The link target is inside the project, so containment alone would allow it.
# `-type f` rejects it anyway — the discovery rule is "regular files only",
# not "files that resolve somewhere acceptable". Asserted so a future switch to
# `-type f -o -type l` fails here rather than silently widening the surface.
SB="$(new_sandbox)"
mkdir -p "$SB/docs"
write_handoff "$SB" "../../docs/planted.yaml" "SIBLING instruction"
ln -s "$SB/docs/planted.yaml" "$SB/.claude/sessions/handoff-2026-07-30-1300.yaml"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "containment_symlinkToInScopeSibling_alsoRejected" "$OUT" "SIBLING instruction"

# ── Cycle handshake ─────────────────────────────────────────────────────────
# pre-compact.sh must reset the nudge state so the next cycle can nudge again.

# cycle_preCompact_clearsNudgedMarkerAndResetsBaseline
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
touch "$SB/.claude/logs/.compact-nudged-s1"
printf '0\n' > "$SB/.claude/logs/.compact-base-s1"
printf '{"session_id":"s1","trigger":"auto","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
assert_file_absent "cycle_preCompact_clearsNudgedMarker" "$SB/.claude/logs/.compact-nudged-s1"
NEW_BASE=$(tr -cd '0-9' < "$SB/.claude/logs/.compact-base-s1")
assert_eq "cycle_preCompact_resetsBaselineToCurrentSize" "$NEW_BASE" "500"
# Same transcript, same size: growth since the reset is 0, so no re-nudge.
OUT=$(printf '{"session_id":"s1","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_eq "cycle_afterReset_noGrowth_staysSilent" "$OUT" ""
# Grow past the threshold again: the next cycle earns its own nudge.
make_transcript "$SB/transcript.jsonl" 900
OUT=$(printf '{"session_id":"s1","transcript_path":"%s"}' "$SB/transcript.jsonl" \
    | PROJECT_OS_COMPACT_NUDGE_BYTES=100 bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_contains "cycle_afterReset_newGrowth_nudgesAgain" "$OUT" '"hookEventName":"PostToolUse"'

echo ""

# ── Checkpoint ──────────────────────────────────────────────────────────────
echo "pre-compact.sh checkpoint:"

# checkpoint_noRecentCheckpoint_writesFileWithRoadmapPhase
SB="$(new_sandbox)"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    ok "checkpoint_noRecentCheckpoint_writesFile"
    BODY=$(cat "$CP")
    assert_contains "checkpoint_derivesPhaseFromRoadmapMarkers" "$BODY" 'phase: "build"'
    assert_contains "checkpoint_derivesFeatureFromRoadmapHeading" "$BODY" 'feature: "sandbox-feature"'
    assert_contains "checkpoint_recordsInProgressTaskDescription" "$BODY" "Sandbox task in progress"
    assert_contains "checkpoint_noHandoff_saysRationaleWasNotCaptured" \
        "$BODY" "No fresh handoff was written before this compaction"
else
    bad "checkpoint_noRecentCheckpoint_writesFile — no auto-checkpoint-*.yaml produced"
fi

# checkpoint_recentCheckpointExists_debouncedButStillForwardsInstruction
# The debounce must gate the file write only. Instruction forwarding has to
# happen on every compaction or a second compaction loses its guidance.
SB="$(new_sandbox)"
touch "$SB/.claude/sessions/auto-checkpoint-2026-07-30-1200.yaml"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "Debounce must not gate stdout."
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "checkpoint_debounced_stillForwardsInstruction" "$OUT" "Debounce must not gate stdout."
COUNT=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | wc -l)
COUNT=$(echo "$COUNT" | tr -cd '0-9')
assert_eq "checkpoint_debounced_writesNoSecondFile" "$COUNT" "1"

echo ""

# ── Malformed input ─────────────────────────────────────────────────────────
# Both hooks are advisory: garbage stdin must degrade to silence, not to a
# non-zero exit that surfaces in the Claude Code UI. hook-smoke.sh covers
# compact-suggest.sh against the real project root; pre-compact.sh is only
# exercised here, because running it unsandboxed writes an auto-checkpoint
# into the real .claude/sessions/.
echo "malformed input:"

for CASE in 'empty:{}' 'notJson:not json at all' 'nullBytesInSessionId:{"session_id":"a b"}'; do
    NAME="${CASE%%:*}"
    PAYLOAD="${CASE#*:}"

    SB="$(new_sandbox)"
    RC=0
    echo "$PAYLOAD" | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1 || RC=$?
    assert_eq "preCompact_${NAME}_exitsZero" "$RC" "0"

    RC=0
    echo "$PAYLOAD" | bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1 || RC=$?
    assert_eq "compactSuggest_${NAME}_exitsZero" "$RC" "0"
done

echo ""

# ── session-end-cleanup.sh ──────────────────────────────────────────────────
echo "session-end-cleanup.sh:"

# cleanup_sessionEnd_removesCompactionMarkers
SB="$(new_sandbox)"
touch "$SB/.claude/logs/.compact-base-s1" "$SB/.claude/logs/.compact-nudged-s1"
printf '{"session_id":"s1","reason":"exit"}' \
    | bash "$SB/.claude/hooks/session-end-cleanup.sh" >/dev/null 2>&1
assert_file_absent "cleanup_sessionEnd_removesCompactBaseMarker" "$SB/.claude/logs/.compact-base-s1"
assert_file_absent "cleanup_sessionEnd_removesCompactNudgedMarker" "$SB/.claude/logs/.compact-nudged-s1"

# cleanup_otherSessionMarkers_leftIntact
SB="$(new_sandbox)"
touch "$SB/.claude/logs/.compact-base-s1" "$SB/.claude/logs/.compact-base-s2"
printf '{"session_id":"s1","reason":"exit"}' \
    | bash "$SB/.claude/hooks/session-end-cleanup.sh" >/dev/null 2>&1
assert_file_exists "cleanup_otherSessionMarkers_leftIntact" "$SB/.claude/logs/.compact-base-s2"

echo ""

# ── Summary ─────────────────────────────────────────────────────────────────
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:$ERRORS"
    exit 1
fi

exit 0
