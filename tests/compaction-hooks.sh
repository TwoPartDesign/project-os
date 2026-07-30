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
# A transcript with no parseable usage record, so compact-suggest.sh falls back
# to byte growth. Used by the fallback tests.
make_transcript() {
    dd if=/dev/zero bs=1 count="$2" 2>/dev/null | tr '\0' 'x' > "$1"
}

# usage_line <input_tokens> <cache_read> <cache_creation>
# One assistant record carrying the usage object the hook sums.
usage_line() {
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","usage":{"input_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s,"output_tokens":42}}}\n' \
        "$1" "$2" "$3"
}

# sidechain_usage_line <input_tokens>
# A sub-agent turn. It lands in the same transcript and must never be mistaken
# for the main thread's context size.
sidechain_usage_line() {
    printf '{"type":"assistant","isSidechain":true,"message":{"role":"assistant","usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":42}}}\n' \
        "$1"
}

# make_token_transcript <path> <input_tokens> <cache_read> <cache_creation>
make_token_transcript() {
    printf '{"type":"user","message":{"role":"user","content":"hello"}}\n' > "$1"
    usage_line "$2" "$3" "$4" >> "$1"
}

# make_padded_token_transcript <path> <pad_bytes> <input_tokens>
# Large on disk, small in context — the shape that exposed the byte proxy as
# the wrong measurement. The pad is one long line with no "usage" key in it.
make_padded_token_transcript() {
    dd if=/dev/zero bs=1 count="$2" 2>/dev/null | tr '\0' 'x' > "$1"
    printf '\n' >> "$1"
    usage_line "$3" 0 0 >> "$1"
}

# run_suggest <sandbox> <transcript> [VAR=VAL ...]
# Runs compact-suggest.sh with a hermetic environment: the real session exports
# CLAUDE_CODE_AUTO_COMPACT_WINDOW and CLAUDE_AUTOCOMPACT_PCT_OVERRIDE via
# settings.json, and inheriting those would make these assertions depend on the
# machine running them. Trailing VAR=VAL arguments override the baseline.
run_suggest() {
    local sb="$1" transcript="$2"
    shift 2
    printf '{"session_id":"s1","transcript_path":"%s"}' "$transcript" \
        | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
              CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 \
              CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
              "$@" bash "$sb/.claude/hooks/compact-suggest.sh" 2>/dev/null
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

# ── Context signal (token measurement) ──────────────────────────────────────
# The nudge threshold is a percentage of the same window auto-compaction
# measures against, read from the transcript's usage records. These assert the
# real number is used — the byte path below is only a fallback.
echo "compact-suggest.sh context signal:"

# context_atNudgeThreshold_nudgesWithMeasuredPercentage
# 130000 / 200000 = 65%; the derived nudge point is 75 - 15 = 60%.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_atNudgeThreshold_nudges" "$OUT" '"hookEventName":"PostToolUse"'
assert_contains "context_nudge_reportsMeasuredPercentage" \
    "$OUT" "Context is at 65% of the 200000-token window"
assert_contains "context_nudge_reportsCompactionThreshold" "$OUT" "auto-compaction fires at 75%"

# context_belowNudgeThreshold_staysSilent — 100000 / 200000 = 50%, under 60%.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 100000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_belowNudgeThreshold_staysSilent" "$OUT" ""

# context_cacheTokensCountedTowardTotal
# input alone is 1000 (0%); with the two cache fields it is 130000 (65%). The
# cache fields carry nearly the whole context on a warm session, so omitting
# them would read as an almost-empty window.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 120000 9000
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_cacheTokensCountedTowardTotal" \
    "$OUT" "Context is at 65% of the 200000-token window"

# context_compactPctOverride_movesNudgePointWithIt
# At a 95% compaction threshold the nudge point derives to 80%, so 65% is quiet.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=95)
assert_eq "context_compactPctOverride_movesNudgePointWithIt" "$OUT" ""

# context_explicitNudgePct_overridesDerivation — 50% nudges when the floor is 40.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 100000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" PROJECT_OS_COMPACT_NUDGE_PCT=40)
assert_contains "context_explicitNudgePct_overridesDerivation" \
    "$OUT" "Context is at 50% of the 200000-token window"

# context_largerWindow_lowersMeasuredPercentage
# The same 130000 tokens are 65% of 200k but 32% of 400k — under the threshold.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000)
assert_eq "context_largerWindow_lowersMeasuredPercentage" "$OUT" ""

# context_sidechainRecord_notMistakenForMainThread
# A sub-agent turn writes its own usage into the same transcript. Here the main
# thread is at 20% and the sub-agent at 95%; reading the newest record blindly
# would nudge on the sub-agent's number.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 40000 0 0
sidechain_usage_line 190000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_sidechainRecord_notMistakenForMainThread" "$OUT" ""

# context_sidechainAfterMainThread_mainThreadStillMeasured
# The converse: skipping sidechains must not also discard the main-thread record
# that precedes them.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
sidechain_usage_line 500 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_sidechainAfterMainThread_mainThreadStillMeasured" \
    "$OUT" "Context is at 65% of the 200000-token window"

# context_largeTranscriptSmallContext_staysSilent
# The regression that motivated the token signal. The transcript keeps every
# discarded turn, so after a compaction it is large while the context is small.
# 400 KB of transcript against 20% context must not nudge, even with the byte
# fallback threshold set low enough to fire.
SB="$(new_sandbox)"
make_padded_token_transcript "$SB/transcript.jsonl" 400000 40000
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" PROJECT_OS_COMPACT_NUDGE_BYTES=100)
assert_eq "context_largeTranscriptSmallContext_staysSilent" "$OUT" ""

# context_noUsageRecord_fallsBackToByteGrowth
# The fallback must still fire, and must not claim a percentage it never
# measured.
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" PROJECT_OS_COMPACT_NUDGE_BYTES=100)
assert_contains "context_noUsageRecord_fallsBackToByteGrowth" \
    "$OUT" '"hookEventName":"PostToolUse"'
assert_contains "context_byteFallback_usesUnmeasuredWording" \
    "$OUT" "approaching its auto-compaction threshold"
assert_not_contains "context_byteFallback_claimsNoPercentage" "$OUT" "Context is at"

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

# forward_staleHandoff_ignored — first compaction of a session, so freshness
# falls back to the age window and a two-hour-old handoff is out of scope.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "STALE instruction"
touch -d '2 hours ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_eq "forward_staleHandoff_ignored" "$OUT" ""

# ── Cycle-scoped freshness ──────────────────────────────────────────────────
# Once a cycle marker exists, "fresh" means "written since the last
# compaction", not "written in the last 30 minutes". The wall-clock window is
# only the bootstrap for a session's first compaction.

# freshness_handoffWrittenThisCycleButOldByClock_stillForwarded
# Three hours into a cycle, an hour-old handoff is still the one describing the
# work being compacted. The age window alone would have discarded it.
SB="$(new_sandbox)"
touch -d '3 hours ago' "$SB/.claude/logs/.compact-cycle-s1"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "SLOW SESSION instruction"
touch -d '1 hour ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "freshness_handoffWrittenThisCycleButOldByClock_stillForwarded" \
    "$OUT" "SLOW SESSION instruction"

# freshness_handoffPredatingCycleMarker_ignoredEvenWhenRecent
# Written five minutes ago — well inside the age window — but before the last
# compaction, so it describes context that has already been summarized away.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "PREVIOUS CYCLE instruction"
touch -d '5 minutes ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
touch "$SB/.claude/logs/.compact-cycle-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "freshness_handoffPredatingCycleMarker_ignoredEvenWhenRecent" \
    "$OUT" "PREVIOUS CYCLE instruction"

# freshness_cycleMarkerReadBeforeItIsReset
# The marker is touched by this same hook. If that happened before discovery,
# every handoff would look older than the current cycle and nothing would ever
# be forwarded. Asserted with a marker that already exists, so the reset is a
# real overwrite rather than a first write.
SB="$(new_sandbox)"
touch -d '1 hour ago' "$SB/.claude/logs/.compact-cycle-s1"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "ORDERING instruction"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "freshness_cycleMarkerReadBeforeItIsReset" "$OUT" "ORDERING instruction"

# ── Session ownership ───────────────────────────────────────────────────────
# Handoff filenames carry a timestamp but no session identifier, so two sessions
# sharing one checkout are indistinguishable to the discovery glob alone.
# compact-suggest.sh records the path of any handoff it observed being written,
# and pre-compact.sh consults that record before the glob.

# ownership_writeOfHandoff_recordsAuthoringSession
# The record must be written even though this call produces no nudge — the
# handoff is written in response to a nudge that has already fired.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWNED instruction"
printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
assert_file_exists "ownership_writeOfHandoff_recordsAuthoringSession" \
    "$SB/.claude/logs/.compact-handoff-s1"
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "ownership_record_namesTheHandoffPath" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"

# ownership_recordWrittenAfterNudgeAlreadyFired
# The once-per-cycle exit sits early in the hook. Recording must happen before
# it, or the write that follows a nudge — i.e. every real handoff — is missed.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
touch "$SB/.claude/logs/.compact-nudged-s1"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "AFTER NUDGE instruction"
printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
assert_file_exists "ownership_recordWrittenAfterNudgeAlreadyFired" \
    "$SB/.claude/logs/.compact-handoff-s1"

# ownership_writeOfUnrelatedFile_recordsNothing
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/ROADMAP.md" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
assert_file_absent "ownership_writeOfUnrelatedFile_recordsNothing" \
    "$SB/.claude/logs/.compact-handoff-s1"

# ownership_concurrentSessionHandoff_notForwarded
# THE BUG THIS CLOSES. Session s2 wrote the newer handoff; s1 is the one
# compacting. Lexical order alone would hand s2's instruction to s1's
# summarizer, replacing the context s1 needs preserved.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "SESSION ONE instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "SESSION TWO instruction"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_ownHandoff_forwardedOverNewerForeignOne" \
    "$OUT" "SESSION ONE instruction"
assert_not_contains "ownership_concurrentSessionHandoff_notForwarded" \
    "$OUT" "SESSION TWO instruction"

# ownership_foreignHandoff_notPickedUpByGlobFallback
# s1 wrote no handoff at all, so there is nothing to prefer. The glob would
# otherwise hand it s2's — a claimed handoff is excluded from the fallback too.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "FOREIGN instruction"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "ownership_foreignHandoff_notPickedUpByGlobFallback" \
    "$OUT" "FOREIGN instruction"

# ownership_unclaimedHandoff_stillForwarded
# The fallback must not become a whitelist: a handoff nobody claimed — written
# before this feature existed, or by a tool the PostToolUse hook cannot see —
# is forwarded exactly as it was.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "UNCLAIMED instruction"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_unclaimedHandoff_stillForwarded" "$OUT" "UNCLAIMED instruction"

# ownership_newerForeignHandoff_fallsBackToOlderUnclaimedOne
# Exclusion must skip to the next candidate rather than abandoning the search.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "UNCLAIMED OLDER instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "CLAIMED NEWER instruction"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_newerForeignHandoff_fallsBackToOlderUnclaimedOne" \
    "$OUT" "UNCLAIMED OLDER instruction"
assert_not_contains "ownership_newerForeignHandoff_ignoresClaimedOne" \
    "$OUT" "CLAIMED NEWER instruction"

# ownership_claimOnPrefixCollidingPath_doesNotExcludeThisHandoff
# The exclusion test matches whole newline-framed lines. A claim on a path that
# merely ENDS with this handoff's name — a same-named file under a longer
# directory prefix — must not suppress the real one.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "PREFIX COLLISION instruction"
printf '%s\n' "/other/checkout$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_claimOnPrefixCollidingPath_doesNotExcludeThisHandoff" \
    "$OUT" "PREFIX COLLISION instruction"

# ownership_ownRecordFromPreviousCycle_notReforwarded
# Ownership is not a licence to ignore freshness: a handoff this session wrote
# before the last compaction has already been summarized away.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWN STALE instruction"
touch -d '5 minutes ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
touch "$SB/.claude/logs/.compact-cycle-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "ownership_ownRecordFromPreviousCycle_notReforwarded" \
    "$OUT" "OWN STALE instruction"

# ownership_recordPointingOutsideProject_rejected
# The record is a path read from disk and fed to the same containment guard as
# the glob result.
SB="$(new_sandbox)"
OUTSIDE="$(mktemp -d)"
SANDBOXES+=("$OUTSIDE")
printf 'compact_instruction: |\n  ESCAPED VIA RECORD instruction\n' \
    > "$OUTSIDE/handoff-2026-07-30-1400.yaml"
printf '%s\n' "$OUTSIDE/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "ownership_recordPointingOutsideProject_rejected" \
    "$OUT" "ESCAPED VIA RECORD instruction"

# ── Session ownership: more than one handoff per session ────────────────────
# A session can write several handoffs in one cycle. If the record kept only
# the newest, the earlier ones would look unattributed to a concurrent
# session's glob fallback — reintroducing the cross-session leak one handoff
# further back.

# ownership_secondHandoffWrite_appendsRatherThanReplaces
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "FIRST instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "SECOND instruction"
for NAME in handoff-2026-07-30-1200.yaml handoff-2026-07-30-1400.yaml; do
    printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
        "$SB/transcript.jsonl" "$SB/.claude/sessions/$NAME" \
        | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
              CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
              bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
done
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "ownership_secondHandoffWrite_appendsRatherThanReplaces" \
    "$RECORDED" \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml
$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"

# ownership_repeatedWriteOfSameHandoff_recordedOnce
# A handoff revised in place must not grow the record one line per edit.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "REVISED instruction"
for _ in 1 2 3; do
    printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Edit","tool_input":{"file_path":"%s"}}' \
        "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
        | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
              CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
              bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
done
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "ownership_repeatedWriteOfSameHandoff_recordedOnce" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"

# ownership_olderOfTwoForeignHandoffs_notForwarded
# THE BUG THIS CLOSES. s2 wrote both handoffs this cycle and s1 wrote none.
# Excluding only s2's newest claim would leave the older one looking unclaimed,
# and the glob fallback would forward it to s1's summarizer.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "FOREIGN FIRST instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "FOREIGN SECOND instruction"
printf '%s\n%s\n' \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "ownership_olderOfTwoForeignHandoffs_notForwarded" \
    "$OUT" "FOREIGN FIRST instruction"
assert_not_contains "ownership_newerOfTwoForeignHandoffs_notForwarded" \
    "$OUT" "FOREIGN SECOND instruction"

# ownership_multipleOwnHandoffs_newestForwarded
# The mirror case: reading only the record's first line would forward this
# session's stale handoff instead of the one it just wrote.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWN EARLIER instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "OWN LATER instruction"
printf '%s\n%s\n' \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_multipleOwnHandoffs_newestForwarded" \
    "$OUT" "OWN LATER instruction"
assert_not_contains "ownership_multipleOwnHandoffs_earlierNotForwarded" \
    "$OUT" "OWN EARLIER instruction"

# ownership_newestOwnClaimDeleted_fallsBackToSurvivingEarlierOne
# A claimed path that no longer exists must not blank out the whole record.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "SURVIVING instruction"
printf '%s\n%s\n' \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_newestOwnClaimDeleted_fallsBackToSurvivingEarlierOne" \
    "$OUT" "SURVIVING instruction"

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
assert_file_exists "cycle_preCompact_opensNewCycleMarker" "$SB/.claude/logs/.compact-cycle-s1"
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

# cycle_handoffConsumedOnce_notReforwardedNextCompaction
# The marker the first compaction opens must sit after the handoff it just
# read, or the same instruction would be replayed into every later compaction.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "ONE SHOT instruction"
FIRST=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "cycle_firstCompaction_forwardsHandoff" "$FIRST" "ONE SHOT instruction"
SECOND=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "cycle_handoffConsumedOnce_notReforwardedNextCompaction" \
    "$SECOND" "ONE SHOT instruction"

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

# checkpoint_inProgressTaskInEarlierFeatureSection_featureStillDerived
# Regression: the derivation used to track a per-section "saw a task" flag and
# print it at the next heading, but reset that flag on every `## Feature:`
# line. A later feature section with no in-progress task therefore erased the
# earlier one's match, and the checkpoint recorded feature "none".
SB="$(new_sandbox)"
{
    printf '# ROADMAP\n\n'
    printf '## Feature: early-feature\n\n'
    printf -- '- [-] Task under the early feature #T901\n\n'
    printf '## Feature: later-feature\n\n'
    printf -- '- [ ] Not started #T902\n'
} > "$SB/ROADMAP.md"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    BODY=$(cat "$CP")
    assert_contains "checkpoint_inProgressTaskInEarlierFeatureSection_featureStillDerived" \
        "$BODY" 'feature: "early-feature"'
    assert_not_contains "checkpoint_laterEmptyFeatureSection_doesNotEraseMatch" \
        "$BODY" 'feature: "none"'
else
    bad "checkpoint_inProgressTaskInEarlierFeatureSection_featureStillDerived — no checkpoint written"
fi

# checkpoint_noInProgressTask_featureIsNone
# The derivation must not name a feature merely because a heading exists.
SB="$(new_sandbox)"
printf '# ROADMAP\n\n## Feature: idle-feature\n\n- [ ] Not started #T903\n' > "$SB/ROADMAP.md"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    assert_contains "checkpoint_noInProgressTask_featureIsNone" "$(cat "$CP")" 'feature: "none"'
else
    bad "checkpoint_noInProgressTask_featureIsNone — no checkpoint written"
fi

# checkpoint_reviewMarkerInEarlierSection_featureStillDerived
# [~] (review) counts as in-progress for feature derivation, same as [-].
SB="$(new_sandbox)"
{
    printf '# ROADMAP\n\n'
    printf '## Feature: review-feature\n\n'
    printf -- '- [~] Task in review #T904\n\n'
    printf '## Feature: quiet-feature\n\n'
    printf -- '- [x] Done #T905\n'
} > "$SB/ROADMAP.md"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    BODY=$(cat "$CP")
    assert_contains "checkpoint_reviewMarkerInEarlierSection_featureStillDerived" \
        "$BODY" 'feature: "review-feature"'
    assert_contains "checkpoint_reviewMarkerOnly_phaseIsReview" "$BODY" 'phase: "review"'
else
    bad "checkpoint_reviewMarkerInEarlierSection_featureStillDerived — no checkpoint written"
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
touch "$SB/.claude/logs/.compact-base-s1" "$SB/.claude/logs/.compact-nudged-s1" \
      "$SB/.claude/logs/.compact-cycle-s1" "$SB/.claude/logs/.compact-handoff-s1"
printf '{"session_id":"s1","reason":"exit"}' \
    | bash "$SB/.claude/hooks/session-end-cleanup.sh" >/dev/null 2>&1
assert_file_absent "cleanup_sessionEnd_removesCompactBaseMarker" "$SB/.claude/logs/.compact-base-s1"
assert_file_absent "cleanup_sessionEnd_removesCompactNudgedMarker" "$SB/.claude/logs/.compact-nudged-s1"
assert_file_absent "cleanup_sessionEnd_removesCompactCycleMarker" "$SB/.claude/logs/.compact-cycle-s1"
assert_file_absent "cleanup_sessionEnd_removesHandoffOwnershipRecord" "$SB/.claude/logs/.compact-handoff-s1"

# cleanup_otherSessionMarkers_leftIntact
SB="$(new_sandbox)"
touch "$SB/.claude/logs/.compact-base-s1" "$SB/.claude/logs/.compact-base-s2" \
      "$SB/.claude/logs/.compact-cycle-s2" "$SB/.claude/logs/.compact-handoff-s2"
printf '{"session_id":"s1","reason":"exit"}' \
    | bash "$SB/.claude/hooks/session-end-cleanup.sh" >/dev/null 2>&1
assert_file_exists "cleanup_otherSessionMarkers_leftIntact" "$SB/.claude/logs/.compact-base-s2"
assert_file_exists "cleanup_otherSessionCycleMarker_leftIntact" "$SB/.claude/logs/.compact-cycle-s2"
assert_file_exists "cleanup_otherSessionOwnershipRecord_leftIntact" "$SB/.claude/logs/.compact-handoff-s2"

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
