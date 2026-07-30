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
SKIP=0
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

# An assertion the machine cannot run — a missing locale, not a passing test.
# Counted apart from PASS so a skipped assertion can never be mistaken for a
# satisfied one in the totals.
skip() {
    SKIP=$((SKIP + 1))
    echo "  SKIP: $1"
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

# append_sidechain_run <path> <count> <input_tokens>
# A sub-agent invocation long enough to bury the main thread's newest usage
# record, and to leave a sidechain turn as the newest record in the transcript.
append_sidechain_run() {
    local i=0
    while [ "$i" -lt "$2" ]; do
        sidechain_usage_line "$3" >> "$1"
        i=$((i + 1))
    done
}

# append_toolresult_run <path> <count>
# Main-thread tool results: no usage object, so they carry no number and do not
# make the newest record a sidechain one either. This is the case the escalating
# tail window exists for — the scan has to reach back past all of them.
append_toolresult_run() {
    local i=0
    while [ "$i" -lt "$2" ]; do
        printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":"tool result"}}\n' >> "$1"
        i=$((i + 1))
    done
}

# nested_usage_line <tool_payload_tokens> <real_input_tokens>
# An assistant record whose tool_use input happens to carry its own "usage"
# object. JSON serialization puts message.content — and therefore the tool
# payload — ahead of message.usage, so a leftmost search finds the wrong one.
nested_usage_line() {
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}],"usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":42}}}\n' \
        "$1" "$2"
}

# user_usage_line <input_tokens>
# A user record whose toolUseResult body carries a usage object — the shape an
# MCP server response or a file read of a transcript would produce. It is not a
# turn the model was fed, so it must never be measured as one.
user_usage_line() {
    printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":"tool result"},"toolUseResult":{"usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n' \
        "$1"
}

# toolresult_assistant_line <tokens>
# A user record whose toolUseResult is a STRUCTURED object carrying both
# "type":"assistant" and a usage object. That is the common shape, not an exotic
# one — 687 of 2958 records in the transcript this was measured against have an
# object there (plus 65 arrays) — and the JSON nested in it is NOT escaped, so a
# whole-line search for the record type finds "assistant" here and measures a
# tool payload as the session's context.
#
# The nested object carries no isSidechain flag on purpose. With one, a textual
# scan skips the record for the right outcome by the wrong reason, and the test
# stops exercising the type key it exists to pin. Nested sidechain flags are
# covered separately by nested_sidechain_flag_line.
toolresult_assistant_line() {
    printf '{"type":"user","isSidechain":false,"message":{"role":"user","content":"tool result"},"toolUseResult":{"type":"assistant","usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n' \
        "$1"
}

# deep_usage_only_line <tokens>
# An assistant record whose ONLY usage object is buried in a tool_use input.
# There is nothing at message.usage to measure, so the record must be skipped
# outright rather than measured on the payload that happens to be there.
deep_usage_only_line() {
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}]}}\n' \
        "$1"
}

# escaped_decoy_usage_line <decoy_tokens> <real_tokens>
# An assistant record quoting a transcript excerpt inside a string value, so the
# decoy keys in it are escaped, followed by the real message.usage. Escape
# sequences are stripped before strings are collapsed, so the quoted blob
# contributes neither a sentinel nor a brace — and the depth walk and the
# index() walk have to agree on which "usage": key is the real one.
escaped_decoy_usage_line() {
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":"excerpt: {\\"type\\":\\"assistant\\",\\"usage\\":{\\"input_tokens\\":%s}}","usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":42}}}\n' \
        "$1" "$2"
}

# nested_sidechain_flag_line <tokens>
# A main-thread assistant record whose tool_use input carries "isSidechain":true
# — a payload that DESCRIBES a sub-agent rather than a sub-agent turn. Read
# textually the record looks like a sidechain one and its number is discarded.
nested_sidechain_flag_line() {
    printf '{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"isSidechain":true}}],"usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":42}}}\n' \
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

# run_suggest_as <sandbox> <transcript> <agent_id> [env...]
# The same run, with an `agent_id` in the payload. Key order mirrors the real
# hook payload, where both `session_id` and `agent_id` are serialized ahead of
# `tool_input` — the property the first-match extraction depends on.
run_suggest_as() {
    local sb="$1" transcript="$2" agent="$3"
    shift 3
    printf '{"session_id":"s1","transcript_path":"%s","agent_id":"%s"}' "$transcript" "$agent" \
        | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
              CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 \
              CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
              "$@" bash "$sb/.claude/hooks/compact-suggest.sh" 2>/dev/null
}

# run_suggest_padded <sandbox> <transcript> <pad_bytes> [env...]
# The same run with a tool_response of <pad_bytes> filler characters, standing
# in for a large tool result. PostToolUse fires after the tool produced that
# result but before the model's next request, so it appears in no usage record
# yet and the payload is the only place it can be measured.
run_suggest_padded() {
    local sb="$1" transcript="$2" pad="$3"
    shift 3
    local filler
    filler=$(dd if=/dev/zero bs=1 count="$pad" 2>/dev/null | tr '\0' 'x')
    printf '{"session_id":"s1","transcript_path":"%s","hook_event_name":"PostToolUse","tool_name":"Read","tool_response":"%s"}' \
        "$transcript" "$filler" \
        | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
              CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 \
              CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
              "$@" bash "$sb/.claude/hooks/compact-suggest.sh" 2>/dev/null
}

# run_suggest_pre <sandbox> <transcript> <tool_name> <file_path>
# A PreToolUse payload. `hook_event_name` sits in the same prefix as
# `session_id` and `tool_name`, ahead of `tool_input`, which is what makes
# first-match extraction of it safe against file contents.
run_suggest_pre() {
    local sb="$1" transcript="$2" tool="$3" path="$4"
    printf '{"session_id":"s1","transcript_path":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' \
        "$transcript" "$tool" "$path" \
        | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
              CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 \
              CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
              bash "$sb/.claude/hooks/compact-suggest.sh" 2>/dev/null
}

# run_suggest_body <sandbox> <transcript> <tool_response> [VAR=VAL ...]
# Like run_suggest_padded, but the caller supplies the payload body verbatim
# instead of a byte count. The locale tests need a body whose character count
# and byte count differ, which a run of ASCII filler cannot produce.
run_suggest_body() {
    local sb="$1" transcript="$2" body="$3"
    shift 3
    printf '{"session_id":"s1","transcript_path":"%s","hook_event_name":"PostToolUse","tool_name":"Read","tool_response":"%s"}' \
        "$transcript" "$body" \
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

# context_newestRecordIsSidechain_defersInsteadOfNudging
# The main thread is at 65% — over the nudge point — but a sub-agent turn is the
# newest record, so a sub-agent is mid-run and this firing is almost certainly
# one of its own tool calls. `additionalContext` lands in the context of the
# agent that made the call, so nudging here talks to an agent that can neither
# write a handoff nor be compacted. Deferring costs one turn; delivering to the
# wrong agent costs the whole cycle.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
sidechain_usage_line 500 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_newestRecordIsSidechain_defersInsteadOfNudging" "$OUT" ""

# context_newestRecordIsSidechain_leavesNudgeMarkerUnspent
# The half of the bug that outlives the firing. One nudge is allowed per
# compaction cycle, so a nudge emitted into a sub-agent does not merely go to
# the wrong reader — it burns the marker, and the main thread is silently
# skipped for the rest of the cycle. Deferring must not write the marker.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
sidechain_usage_line 500 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_file_absent "context_newestRecordIsSidechain_leavesNudgeMarkerUnspent" \
    "$SB/.claude/logs/.compact-nudged-s1"

# context_newestRecordIsSidechain_byteProxyDoesNotOverrideTheDefer
# The gate has to be checked before the byte fallback, not after it. With the
# byte threshold forced down to 1000 the fallback would fire on any transcript;
# silence proves the defer is reached first.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
sidechain_usage_line 500 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" PROJECT_OS_COMPACT_NUDGE_BYTES=1000)
assert_eq "context_newestRecordIsSidechain_byteProxyDoesNotOverrideTheDefer" "$OUT" ""

# context_sidechainRunThenMainThreadTurn_nudgesOnceTheMainThreadResumes
# The deferral is a delay, not a suppression. 200 sidechain records bury the
# earlier main-thread record, but once the main thread takes a turn again it is
# the newest and the nudge fires — and on the main thread's number, not the
# sub-agent's 500. Skipping sidechains must not discard the main-thread record.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_sidechain_run "$SB/transcript.jsonl" 200 500
usage_line 150000 0 0 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_sidechainRunThenMainThreadTurn_nudgesOnceTheMainThreadResumes" \
    "$OUT" "Context is at 75% of the 200000-token window"

# context_longNonAssistantTail_escalatesWindowToFindMainThread
# What the escalating window is still for, now that a sidechain tail defers
# rather than digs. A run of tool-result records carries no usage object at all,
# so a fixed 60-line tail returns nothing and the hook falls through to the byte
# proxy — silent here, because 200 short records are nowhere near 1.2 MB, at 75%
# of the window. Widening to 600 finds the real number.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_toolresult_run "$SB/transcript.jsonl" 200
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_longNonAssistantTail_escalatesWindowToFindMainThread" \
    "$OUT" "Context is at 75% of the 200000-token window"

# context_nonAssistantTailBeyondLargestWindow_fallsBackToBytes
# The escalation is bounded at 4000 lines, so the miss is narrowed, not closed.
# Pinning the ceiling keeps it a stated limit rather than an accident: raise it
# and these two assertions are what have to change. 4100 short records are
# well under the 1.2 MB byte threshold, so the default run is silent; forcing
# the threshold down proves it is the byte branch — not the token branch — that
# produced the silence.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_toolresult_run "$SB/transcript.jsonl" 4100
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_nonAssistantTailBeyondLargestWindow_fallsBackToBytes" "$OUT" ""
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_toolresult_run "$SB/transcript.jsonl" 4100
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl" PROJECT_OS_COMPACT_NUDGE_BYTES=1000)
assert_contains "context_nonAssistantTailBeyondLargestWindow_byteProxyMessageNotTokenMessage" \
    "$OUT" "This session is approaching its auto-compaction threshold."

# context_twoFieldScanOutput_notFusedIntoOneNumber
# The scan returns "<tokens> <sidechain-flag>". Stripping non-digits across the
# whole line rather than splitting the fields first fuses "100000 0" into
# "1000000" — a fivefold overreading that nudges at a real 50%. Observed live
# during this change, which is why it is pinned: 50% is under the 60% nudge
# point, so correct handling is silence.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 100000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_twoFieldScanOutput_notFusedIntoOneNumber" "$OUT" ""

# context_usageKeyInsideToolInput_measuresMessageUsageNotToolPayload
# The record's tool_use input carries a decoy usage object of 5 tokens, and
# message.usage — serialized after it — carries the real 150000 (75%). A
# leftmost search reads 5, computes 0%, and stays silent at exactly the moment
# the nudge is most needed.
SB="$(new_sandbox)"
printf '{"type":"user","message":{"role":"user","content":"hello"}}\n' > "$SB/transcript.jsonl"
nested_usage_line 5 150000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_usageKeyInsideToolInput_measuresMessageUsageNotToolPayload" \
    "$OUT" "Context is at 75% of the 200000-token window"

# context_userRecordWithUsageBody_ignored
# A user record's toolUseResult is arbitrary JSON from outside the session. Here
# the main thread sits at 100000 (50%, quiet) and a tool result reports 190000;
# measuring the user record would nudge on a number the model was never fed.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 100000 0 0
user_usage_line 190000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_userRecordWithUsageBody_ignored" "$OUT" ""

# ── Record type read structurally, not textually ────────────────────────────
# The record-type guard used to search the whole line for `"type":"assistant"`.
# Anchoring it to the record's own field is not possible positionally either:
# `message` is serialized ahead of the top-level `type` in all 1185 assistant
# records measured, at a mean offset of 2194 bytes and a maximum of 33108, so
# there is no prefix worth trusting. These pin the depth-aware parse that
# replaced it.

# context_toolResultCarryingAssistantType_ignored
# The false positive the textual guard could not see. A tool result is arbitrary
# JSON from outside the session, and an object there carrying BOTH
# `"type":"assistant"` and a usage object satisfies the very guard that existed
# to exclude it. The main thread sits at 50% and is quiet; measuring the tool
# result reports 95% and nudges on a number the model was never fed.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 100000 0 0
toolresult_assistant_line 190000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_toolResultCarryingAssistantType_ignored" "$OUT" ""

# context_usageOnlyDeeperThanMessage_recordSkippedEntirely
# The companion to the decoy test above, with the real usage object absent
# rather than merely later: an assistant record whose only usage object sits in
# a tool_use input. Taking the last — or the only — usage key measures the
# payload. Depth is what distinguishes them, so a record with nothing at depth 2
# has nothing to contribute and must fall through to the earlier record.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 100000 0 0
deep_usage_only_line 190000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_usageOnlyDeeperThanMessage_recordSkippedEntirely" "$OUT" ""

# context_escapedDecoyInStringValue_measuresTheRealUsageKey
# Escaped keys are invisible to both halves of the parse — the sentinel pass
# skips them because a `\"` is not a `"`, and the index() walk skips them for
# the same reason — so the two counts stay in step and the real message.usage
# is still the one measured. Reducing the record to a skeleton must not lose
# that key: 150000 is 75%, and silence here would be the nudge suppressed at
# exactly the moment it is most needed.
SB="$(new_sandbox)"
printf '{"type":"user","message":{"role":"user","content":"hello"}}\n' > "$SB/transcript.jsonl"
escaped_decoy_usage_line 5 150000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_escapedDecoyInStringValue_measuresTheRealUsageKey" \
    "$OUT" "Context is at 75% of the 200000-token window"

# context_nestedSidechainFlagInToolInput_notTreatedAsSubagentTurn
# `isSidechain` is read at depth 1 for the same reason `type` is. A tool_use
# input that happens to carry the flag describes a sub-agent; it does not make
# the record one, and discarding the record's number costs the whole nudge —
# the byte fallback it drops through to is nowhere near its threshold here.
SB="$(new_sandbox)"
printf '{"type":"user","message":{"role":"user","content":"hello"}}\n' > "$SB/transcript.jsonl"
nested_sidechain_flag_line 150000 >> "$SB/transcript.jsonl"
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_contains "context_nestedSidechainFlagInToolInput_notTreatedAsSubagentTurn" \
    "$OUT" "Context is at 75% of the 200000-token window"

# ── The result that just landed ─────────────────────────────────────────────
# PostToolUse fires before the completed result reaches the model, so the newest
# usage record describes the request that ASKED for the tool. Normally the next
# tool call absorbs the lag; it matters when one result crosses the whole gap
# between the nudge line and the compaction line in a single step, because then
# auto-compaction fires before any further PostToolUse can nudge.

# context_largePendingToolResult_countedTowardPressure
# 118000 tokens is 59% — one point under the nudge line. A 40 KB result is
# ~10000 tokens at the conventional four bytes each, which puts the next request
# at 64% and inside the window where a handoff can still be written.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 118000 0 0
OUT=$(run_suggest_padded "$SB" "$SB/transcript.jsonl" 40000)
assert_contains "context_largePendingToolResult_countedTowardPressure" \
    "$OUT" "Context is at 64% of the 200000-token window"

# context_smallPayload_doesNotPerturbTheMeasurement
# The correction is bounded by the payload it measures, so an ordinary tool call
# moves the reading by tens of tokens, not thousands. The same 59% stays quiet.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 118000 0 0
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_smallPayload_doesNotPerturbTheMeasurement" "$OUT" ""

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

# context_mainThreadAgentId_nudgesThroughSidechainTail
# THE CASE THE TAIL HEURISTIC GOT WRONG. The main thread's own PostToolUse for
# a completed `Task` fires while the sub-agent's last turn is still the newest
# usage-bearing record, so tail inference reads "sub-agent mid-run" and drops a
# genuine main-thread firing. `agent_id` equal to the session id says otherwise,
# and the nudge is delivered to the one context that can act on it.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_sidechain_run "$SB/transcript.jsonl" 5 500
OUT=$(run_suggest_as "$SB" "$SB/transcript.jsonl" s1)
assert_contains "context_mainThreadAgentId_nudgesThroughSidechainTail" \
    "$OUT" "Context is at 75% of the 200000-token window"

# context_mainThreadAgentId_escalatesWindowPastSidechainRun
# The scan loop stopped as soon as it saw a sidechain tail, which was right only
# while that tail decided delivery. Once identity is known, a sidechain tail is
# precisely the case needing the WIDER window: 200 sub-agent records bury the
# main thread's number past the 60-line read, and the 600-line read finds it.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_sidechain_run "$SB/transcript.jsonl" 200 500
OUT=$(run_suggest_as "$SB" "$SB/transcript.jsonl" s1)
assert_contains "context_mainThreadAgentId_escalatesWindowPastSidechainRun" \
    "$OUT" "Context is at 75% of the 200000-token window"

# context_subagentAgentId_defersEvenWithMainThreadTailNewest
# The other direction, and the one inference cannot reach at all: a sub-agent's
# first tool call, before it has produced any turn of its own, leaves the main
# thread's record newest. The tail says "main thread"; the payload says the
# caller is a sub-agent, which can neither run /tools:handoff nor be compacted.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
OUT=$(run_suggest_as "$SB" "$SB/transcript.jsonl" agent_abc123)
assert_eq "context_subagentAgentId_defersEvenWithMainThreadTailNewest" "$OUT" ""

# context_subagentAgentId_leavesNudgeMarkerUnspent
# Deferral is only worth anything if the cycle's one nudge survives it. The
# marker is keyed on the session id, which a sub-agent firing shares.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
run_suggest_as "$SB" "$SB/transcript.jsonl" agent_abc123 >/dev/null
assert_file_absent "context_subagentAgentId_leavesNudgeMarkerUnspent" \
    "$SB/.claude/logs/.compact-nudged-s1"

# context_subagentAgentId_byteProxyDoesNotOverrideTheDefer
# The identity exit sits above both signals, so the byte fallback cannot smuggle
# the nudge into a sub-agent's context when the token read comes up empty.
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
OUT=$(run_suggest_as "$SB" "$SB/transcript.jsonl" agent_abc123 PROJECT_OS_COMPACT_NUDGE_BYTES=100)
assert_eq "context_subagentAgentId_byteProxyDoesNotOverrideTheDefer" "$OUT" ""

# context_mainThreadAgentId_byteProxyStillFires
# ...and does not suppress it on the main thread, where the same payload minus
# the sub-agent id must behave exactly as an agent_id-less one does.
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 500
OUT=$(run_suggest_as "$SB" "$SB/transcript.jsonl" s1 PROJECT_OS_COMPACT_NUDGE_BYTES=100)
assert_contains "context_mainThreadAgentId_byteProxyStillFires" \
    "$OUT" "approaching its auto-compaction threshold"

# context_noAgentIdInPayload_fallsBackToTailHeuristic
# An absent key means an older CLI, not a main thread. Reading absence as "main"
# would retire the sidechain guard silently, so absence keeps the old inference:
# sidechain tail newest, defer.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
append_sidechain_run "$SB/transcript.jsonl" 5 500
OUT=$(run_suggest "$SB" "$SB/transcript.jsonl")
assert_eq "context_noAgentIdInPayload_fallsBackToTailHeuristic" "$OUT" ""

# context_subagentAgentId_recordsHandoffClaim
# The identity exit is placed BELOW the ownership claim on purpose: a sub-agent
# that writes a handoff has still written it, and the claim is what keeps every
# other session's fallback glob off it. Silencing the nudge must not silence the
# bookkeeping.
SB="$(new_sandbox)"
make_transcript "$SB/transcript.jsonl" 50
printf '{"session_id":"s1","transcript_path":"%s","agent_id":"agent_abc123","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    | bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "context_subagentAgentId_recordsHandoffClaim" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"

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

# ownership_readOfHandoff_recordsNothing
# A Read payload carries tool_input.file_path exactly like a Write one. Without
# a tool_name gate, /tools:catchup — whose entire job is to read the previous
# session's handoff — made the reader claim the author's file.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "FOREIGN instruction"
printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Read","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
assert_file_absent "ownership_readOfHandoff_recordsNothing" \
    "$SB/.claude/logs/.compact-handoff-s1"

# ownership_readOfForeignHandoff_notForwardedToTheReader
# THE BUG THIS CLOSES, end to end. s2 wrote and claimed the handoff; s1 only
# read it. A claim from that read sent s1 down the ownership branch, so s1's
# summarizer received instructions written for s2's task. (At the time that
# branch also skipped the age window, which made even an ancient handoff
# eligible; both branches share one window now, but the tool-name gate is what
# keeps a reader out of the record in the first place.)
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "SESSION TWO instruction"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
printf '{"session_id":"s1","transcript_path":"%s","tool_name":"Read","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "ownership_readOfForeignHandoff_notForwardedToTheReader" \
    "$OUT" "SESSION TWO instruction"

# ownership_editOfHandoff_stillRecords
# The gate is a tool-name allowlist, so it has to keep admitting the write tools
# a handoff is actually revised with, not just the one that creates it.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "REVISED instruction"
printf '{"session_id":"s1","transcript_path":"%s","tool_name":"MultiEdit","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "ownership_editOfHandoff_stillRecords" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"

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

# ── Ownership claimed ahead of the write ────────────────────────────────────
# Recorded only after the write, the claim trails the artifact it describes: for
# the interval between the file appearing on disk and the PostToolUse hook
# appending its path, the handoff exists unclaimed. The hook therefore also runs
# on PreToolUse for the write tools, where it records the claim and stops.

# preToolUse_handoffWrite_claimsBeforeTheFileExists
# The claim is on record while the path still points at nothing — which is the
# whole point, and is why pre-compact.sh skips claimed paths that do not exist.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
run_suggest_pre "$SB" "$SB/transcript.jsonl" Write \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" >/dev/null
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "preToolUse_handoffWrite_claimsBeforeTheFileExists" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"
assert_file_absent "preToolUse_claimRecorded_whileFileStillAbsent" \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"

# preToolUse_claimPrecedesPublication_foreignSessionDoesNotForwardIt
# THE RACE THIS CLOSES. s1 claims, then publishes; s2 compacts in between. With
# the claim trailing the write, s2's fallback glob finds an unattributed handoff
# and forwards s1's compact_instruction to s2's summarizer — and a claim
# appended a millisecond later cannot un-compact anything.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
run_suggest_pre "$SB" "$SB/transcript.jsonl" Write \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" >/dev/null
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "RACE WINDOW instruction"
OUT=$(printf '{"session_id":"s2","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "preToolUse_claimPrecedesPublication_foreignSessionDoesNotForwardIt" \
    "$OUT" "RACE WINDOW instruction"

# preToolUse_pass_emitsNothingAndExitsZero
# PreToolUse is the one event where a hook can deny the tool call, so an
# advisory hook must print nothing and exit 0 there — and there is nothing to
# say in any case: the tool has not run, so no result can be accounted for. The
# context here is at 75%, far past the nudge line, which is exactly when a stray
# byte on stdout would be most likely.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 150000 0 0
RC=0
OUT=$(run_suggest_pre "$SB" "$SB/transcript.jsonl" Write \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml") || RC=$?
assert_eq "preToolUse_pass_emitsNothing" "$OUT" ""
assert_eq "preToolUse_pass_exitsZero" "$RC" "0"
assert_file_absent "preToolUse_pass_leavesNudgeMarkerUnspent" \
    "$SB/.claude/logs/.compact-nudged-s1"

# preToolUse_readOfHandoff_claimsNothing
# The tool-name gate governs both passes. Claiming earlier must not mean
# claiming more widely: /tools:catchup reads the previous session's handoff, and
# a claim from that read is worse than no ownership tracking at all.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "FOREIGN instruction"
run_suggest_pre "$SB" "$SB/transcript.jsonl" Read \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" >/dev/null
assert_file_absent "preToolUse_readOfHandoff_claimsNothing" \
    "$SB/.claude/logs/.compact-handoff-s1"

# preToolUse_thenPostToolUse_sameHandoffClaimedOnce
# The PostToolUse pass is kept as the backstop for a write the PreToolUse hook
# did not see the start of, so the ordinary path runs both. Both collapse
# against the last line, so claiming twice costs one line, not two.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
run_suggest_pre "$SB" "$SB/transcript.jsonl" Write \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" >/dev/null
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "CLAIMED TWICE instruction"
printf '{"session_id":"s1","transcript_path":"%s","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "preToolUse_thenPostToolUse_sameHandoffClaimedOnce" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"

# ── The PreToolUse claim is a reservation, so it may only reserve ───────────
# PostToolUse records a fact: the write happened. PreToolUse records an
# intention, and nothing can retract it — the tool may be denied at the
# permission prompt or fail on its own terms, and no hook event fires to say
# so. For a path being CREATED an unretractable claim is harmless: the file
# never appears, and both readers in pre-compact.sh skip a claimed path that is
# not there. For a path that ALREADY EXISTS it is the leak this record exists
# to prevent, so the claim is taken only where the file does not yet exist —
# which is exactly the set that has the publication race in it.

# preToolUse_editOfExistingForeignHandoff_claimsNothing
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "ANOTHER SESSION instruction"
run_suggest_pre "$SB" "$SB/transcript.jsonl" Edit \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" >/dev/null
assert_file_absent "preToolUse_editOfExistingForeignHandoff_claimsNothing" \
    "$SB/.claude/logs/.compact-handoff-s1"

# preToolUse_editOfExistingForeignHandoff_instructionNotForwarded
# The end-to-end consequence, asserted through both real hooks rather than
# through the record alone: s2 attempts an edit of a handoff it did not write,
# the edit never lands, and s2 then compacts. A claim recorded on intent would
# make the ownership branch accept a file that genuinely exists and hand s2 the
# other session's instruction.
#
# s1 must claim the handoff for this to test what it says it tests. An
# UNCLAIMED handoff is forwarded to s2 by the glob fallback anyway — that is
# the documented pre-existing behaviour for a handoff no session attributes to
# itself, and asserting against it would fail for a reason that has nothing to
# do with the pre-claim.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "ANOTHER SESSION instruction"
printf '{"session_id":"s1","transcript_path":"%s","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
printf '{"session_id":"s2","transcript_path":"%s","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"%s"}}' \
    "$SB/transcript.jsonl" "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" >/dev/null 2>&1
assert_file_absent "preToolUse_failedForeignEdit_leavesNoClaimRecord" \
    "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s2","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "preToolUse_editOfExistingForeignHandoff_instructionNotForwarded" \
    "$OUT" "ANOTHER SESSION instruction"

# preToolUse_writeToAbsentPath_stillClaims
# The existence gate must not swallow the case the pre-claim was added for. A
# handoff being created for the first time has no file at its path yet, so the
# round-11 behaviour is unchanged — asserted here with `Edit` because the tool
# name is not what decides it.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
run_suggest_pre "$SB" "$SB/transcript.jsonl" Edit \
    "$SB/.claude/sessions/handoff-2026-07-30-1500.yaml" >/dev/null
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "preToolUse_writeToAbsentPath_stillClaims" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1500.yaml"

# preToolUse_pathOccupiedByDirectory_claimsNothing
# The gate is `-e`, not `-f`. A path already occupied by a directory is not one
# this session is about to bring into existence either, and the question the
# test asks is "is there already something here that a claim would be a claim
# ON" — a distinction `-f` would get wrong in the direction that claims.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
mkdir -p "$SB/.claude/sessions/handoff-2026-07-30-1600.yaml"
run_suggest_pre "$SB" "$SB/transcript.jsonl" Write \
    "$SB/.claude/sessions/handoff-2026-07-30-1600.yaml" >/dev/null
assert_file_absent "preToolUse_pathOccupiedByDirectory_claimsNothing" \
    "$SB/.claude/logs/.compact-handoff-s1"

# preToolUse_ownPublishedHandoffEdited_claimSurvives
# The other side of the gate: a session revising its own handoff gets no new
# claim, and needs none — it claimed the path when it created the file. The
# record must still name it, or the ownership branch would fall through to the
# glob fallback for a session that did everything right.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 1000 0 0
run_suggest_pre "$SB" "$SB/transcript.jsonl" Write \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" >/dev/null
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "OWN REVISED instruction"
run_suggest_pre "$SB" "$SB/transcript.jsonl" Edit \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" >/dev/null
RECORDED=$(cat "$SB/.claude/logs/.compact-handoff-s1" 2>/dev/null || true)
assert_eq "preToolUse_ownPublishedHandoffEdited_claimSurvives" \
    "$RECORDED" "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "preToolUse_ownPublishedHandoffEdited_instructionStillForwarded" \
    "$OUT" "OWN REVISED instruction"

# ── The pending-payload estimate is measured in bytes, not characters ───────
# `${#INPUT}` counts CHARACTERS under a multibyte locale and BYTES under C, and
# the divisor below it is calibrated in bytes. A hook that inherits its locale
# from the caller therefore measures a CJK-heavy tool result at a third of its
# size — so compact-suggest.sh pins `LC_ALL=C` rather than trusting the
# environment. `C.utf8` is present on most Debian-derived images and is the
# default there; where it is absent there is nothing to regress against.
CJK_BODY=$(printf '\346\227\245%.0s' $(seq 1 4000))
CJK_BYTES=$(printf '%s' "$CJK_BODY" | LC_ALL=C wc -c | tr -d ' ')

# locale_cjkFixture_isThreeBytesPerCharacter
# The fixture is the experiment: if it ever stops being 4000 characters at 3
# bytes each, both assertions below would pass for the wrong reason.
assert_eq "locale_cjkFixture_isThreeBytesPerCharacter" "$CJK_BYTES" "12000"

if locale -a 2>/dev/null | grep -qx 'C.utf8'; then
    # A base of 118000 tokens against a 200000-token window is 59% — one point
    # under the 60% nudge line (75 - 15). Measured as bytes the pending payload
    # adds ~3000 tokens and crosses it; measured as characters it adds ~1000 and
    # does not. The two readings of the same payload land on opposite sides.

    # locale_utf8EnvironmentWithCjkPayload_measuredInBytesAndNudges
    SB="$(new_sandbox)"
    make_token_transcript "$SB/transcript.jsonl" 118000 0 0
    OUT=$(run_suggest_body "$SB" "$SB/transcript.jsonl" "$CJK_BODY" LC_ALL=C.utf8)
    assert_contains "locale_utf8EnvironmentWithCjkPayload_measuredInBytesAndNudges" \
        "$OUT" "Context is at 60% of the 200000-token window"

    # locale_utf8EnvironmentWithoutPayload_staysBelowTheLine
    # The control. Without it the assertion above would also pass if the base
    # alone were over the line, which would test nothing about the payload.
    SB="$(new_sandbox)"
    make_token_transcript "$SB/transcript.jsonl" 118000 0 0
    OUT=$(run_suggest_body "$SB" "$SB/transcript.jsonl" "" LC_ALL=C.utf8)
    assert_eq "locale_utf8EnvironmentWithoutPayload_staysBelowTheLine" "$OUT" ""
else
    skip "locale_utf8EnvironmentWithCjkPayload_measuredInBytesAndNudges — no C.utf8 locale"
    skip "locale_utf8EnvironmentWithoutPayload_staysBelowTheLine — no C.utf8 locale"
fi

# postToolUse_explicitEventName_stillNudges
# The early exit keys on the event name, and every real payload carries one —
# including the PostToolUse payloads the nudge depends on. Testing only the
# absent-key case would leave the live path unasserted.
SB="$(new_sandbox)"
make_token_transcript "$SB/transcript.jsonl" 130000 0 0
OUT=$(printf '{"session_id":"s1","transcript_path":"%s","hook_event_name":"PostToolUse","tool_name":"Read"}' \
    "$SB/transcript.jsonl" \
    | env -u PROJECT_OS_COMPACT_NUDGE_PCT -u PROJECT_OS_COMPACT_NUDGE_BYTES \
          CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 \
          bash "$SB/.claude/hooks/compact-suggest.sh" 2>/dev/null)
assert_contains "postToolUse_explicitEventName_stillNudges" \
    "$OUT" "Context is at 65% of the 200000-token window"

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

# ownership_ownHandoffOlderThanAgeWindow_notForwardedWithoutCycleMarker
# Freshness applied to the glob but not to the owned branch, so before this
# session's first compaction — no cycle marker yet — ANY owned handoff was
# forwarded regardless of age. A session that wrote a handoff hours ago and has
# been working since would hand the summarizer an instruction describing work
# that is already finished. The age window now governs both branches.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWN ANCIENT instruction"
touch -d '90 minutes ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_not_contains "ownership_ownHandoffOlderThanAgeWindow_notForwardedWithoutCycleMarker" \
    "$OUT" "OWN ANCIENT instruction"

# ownership_ownHandoffWithinAgeWindow_forwardedWithoutCycleMarker
# The window is a filter, not a second claim requirement: the ordinary first
# compaction of a session that just wrote its handoff still forwards it.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWN FRESH instruction"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_ownHandoffWithinAgeWindow_forwardedWithoutCycleMarker" \
    "$OUT" "OWN FRESH instruction"

# ownership_ownHandoffOlderThanAgeWindow_stillForwardedWhenNewerThanCycleMarker
# Where a cycle marker exists it remains the authority, and it is the stricter
# signal: "written since the last compaction" is what freshness actually means.
# A long-running session compacting a second time must not lose a handoff merely
# for having been written more than the window ago.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWN POST-CYCLE instruction"
touch -d '90 minutes ago' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml"
touch "$SB/.claude/logs/.compact-cycle-s1"
touch -d '150 minutes ago' "$SB/.claude/logs/.compact-cycle-s1"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_ownHandoffOlderThanAgeWindow_stillForwardedWhenNewerThanCycleMarker" \
    "$OUT" "OWN POST-CYCLE instruction"

# ownership_staleOwnHandoffAfterFreshOne_fallsBackToTheFreshOne
# The loop keeps the LAST accepted record, so an unfiltered stale entry does not
# merely add a candidate — it displaces a good one. Claims are appended in write
# order, and a session that re-ran /tools:handoff on an old path would end up
# forwarding the stale body over the fresh one.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1200.yaml" "OWN RECENT instruction"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "OWN OUTDATED instruction"
touch -d '90 minutes ago' "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml"
printf '%s\n%s\n' \
    "$SB/.claude/sessions/handoff-2026-07-30-1200.yaml" \
    "$SB/.claude/sessions/handoff-2026-07-30-1400.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "ownership_staleOwnHandoffAfterFreshOne_fallsBackToTheFreshOne" \
    "$OUT" "OWN RECENT instruction"
assert_not_contains "ownership_staleOwnHandoffAfterFreshOne_outdatedNotForwarded" \
    "$OUT" "OWN OUTDATED instruction"

# ── Filename collision resistance ───────────────────────────────────────────
# Ownership tracking cannot disambiguate two sessions that wrote the SAME path,
# and at minute granularity two /tools:handoff runs in one minute produced
# exactly that: one file, whichever body was written last, claimed by both
# records. handoff.md now generates handoff-YYYY-MM-DD-HHMMSS-<token>.yaml. The
# hooks never parse the token — what they rely on is that it comes after the
# full timestamp, so these tests pin the ordering that assumption rests on.

# naming_twoSessionsSameMinute_eachForwardsItsOwnHandoff
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-140012-9021.yaml" "SESSION ONE same-minute instruction"
write_handoff "$SB" "handoff-2026-07-30-140044-317.yaml" "SESSION TWO same-minute instruction"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-140012-9021.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s1"
printf '%s\n' "$SB/.claude/sessions/handoff-2026-07-30-140044-317.yaml" \
    > "$SB/.claude/logs/.compact-handoff-s2"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "naming_twoSessionsSameMinute_eachForwardsItsOwnHandoff" \
    "$OUT" "SESSION ONE same-minute instruction"
assert_not_contains "naming_twoSessionsSameMinute_doesNotForwardTheOtherSession" \
    "$OUT" "SESSION TWO same-minute instruction"

# naming_variableWidthToken_newestBySecondsStillWins
# The token is $RANDOM, so it is 1-5 digits wide. A wider token on an older
# file must not out-sort a narrower one on a newer file — the seconds field
# decides first because it precedes the token.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-140012-99999.yaml" "EARLIER SECOND instruction"
write_handoff "$SB" "handoff-2026-07-30-140059-7.yaml" "LATER SECOND instruction"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "naming_variableWidthToken_newestBySecondsStillWins" \
    "$OUT" "LATER SECOND instruction"
assert_not_contains "naming_variableWidthToken_earlierSecondNotForwarded" \
    "$OUT" "EARLIER SECOND instruction"

# naming_legacyMinuteNameVersusSuffixedName_suffixedWins
# Handoffs written before this scheme are still on disk. A legacy …-1400.yaml
# and a suffixed …-140030-42.yaml from thirty seconds later must order by time.
# In byte order they do ('.' < '3'); under a UTF-8 locale, where glibc gives
# punctuation a weaker first-level weight, they compare as 1400yaml vs
# 14003042yaml and invert — which is why the hook pins LC_ALL=C on the sort.
# The env below makes this a real regression test where that locale is
# installed; on a C-only image (no en_US.UTF-8 in `locale -a`, as in this
# project's container) sort falls back to C and only byte order is exercised.
SB="$(new_sandbox)"
write_handoff "$SB" "handoff-2026-07-30-1400.yaml" "LEGACY NAME instruction"
write_handoff "$SB" "handoff-2026-07-30-140030-42.yaml" "SUFFIXED NAME instruction"
OUT=$(printf '{"session_id":"s1","trigger":"auto"}' \
    | LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 bash "$SB/.claude/hooks/pre-compact.sh" 2>/dev/null)
assert_contains "naming_legacyMinuteNameVersusSuffixedName_suffixedWins" \
    "$OUT" "SUFFIXED NAME instruction"
assert_not_contains "naming_legacyMinuteNameVersusSuffixedName_legacyNotForwarded" \
    "$OUT" "LEGACY NAME instruction"

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

# checkpoint_roadmapTextNeedingYamlEscaping_writtenAsValidYaml
# The same failure the path list had, from a source the reader controls even
# more directly. Task descriptions and feature headings went into double-quoted
# scalars with only `"` escaped, so a backslash in either ended the escape
# sequence at an illegal character and made the WHOLE checkpoint unparseable —
# taking the objective, the handoff pointer and every other field with it. A
# Windows path or a regex in a task title is all it takes.
SB="$(new_sandbox)"
{
    printf '# ROADMAP\n\n'
    printf '## Feature: parse C:\\shellout paths\n\n'
    printf -- '- [-] Fix the C:\\path parser and the "quoted" case #T906\n'
} > "$SB/ROADMAP.md"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    BODY=$(cat "$CP")
    assert_contains "checkpoint_roadmapDescriptionBackslash_escapedForYaml" \
        "$BODY" 'description: "Fix the C:\\path parser and the \"quoted\" case"'
    assert_contains "checkpoint_featureHeadingBackslash_escapedForYaml" \
        "$BODY" 'feature: "parse C:\\shellout paths"'
    # The point of escaping is that everything AFTER the offending value
    # survives. An unescaped backslash cost the fields below it, not itself.
    assert_contains "checkpoint_backslashInRoadmap_laterFieldsStillWritten" \
        "$BODY" "compact_instruction:"
    # The block scalar takes its content verbatim — escaping there would put a
    # literal backslash into the summarizer's instructions.
    assert_contains "checkpoint_blockScalar_keepsRoadmapTextRaw" \
        "$BODY" 'Working on parse C:\shellout paths'
else
    bad "checkpoint_roadmapTextNeedingYamlEscaping_writtenAsValidYaml — no checkpoint written"
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

# checkpoint_untrackedDirectory_recordsIndividualFiles
# `git status --porcelain` collapses a wholly untracked directory to a single
# `?? dir/` entry. A session that built a new feature under a new directory is
# exactly the one with the most to preserve, and it handed the next session a
# directory name instead of the files it had just written. This sandbox is a
# real repo — the others are bare mktemp dirs where git reports nothing at all,
# so this is the only checkpoint test that exercises modified_files.
SB="$(new_sandbox)"
git init -q "$SB" >/dev/null 2>&1
printf 'ignored-out/\n' > "$SB/.gitignore"
mkdir -p "$SB/newfeature/nested" "$SB/ignored-out"
printf 'alpha\n' > "$SB/newfeature/nested/alpha.txt"
printf 'beta\n' > "$SB/newfeature/beta.txt"
printf 'z\n' > "$SB/ignored-out/secret.txt"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    BODY=$(cat "$CP")
    assert_contains "checkpoint_untrackedDirectory_recordsNestedFile" \
        "$BODY" 'path: "newfeature/nested/alpha.txt"'
    assert_contains "checkpoint_untrackedDirectory_recordsSiblingFile" \
        "$BODY" 'path: "newfeature/beta.txt"'
    assert_not_contains "checkpoint_untrackedDirectory_doesNotRecordBareDirectory" \
        "$BODY" 'path: "newfeature/"'
    assert_contains "checkpoint_untrackedFile_classifiedAsCreated" \
        "$BODY" 'change_type: created'
    # Expanding untracked directories must not also start reporting ignored
    # paths — build output and caches are excluded at both -u settings.
    assert_not_contains "checkpoint_gitignoredPath_stillExcluded" \
        "$BODY" "ignored-out/secret.txt"
else
    bad "checkpoint_untrackedDirectory_recordsIndividualFiles — no checkpoint written"
fi

# checkpoint_pathNeedingGitQuoting_writtenAsValidYaml
# Without -z, git C-quotes any path outside plain ASCII: café.txt is reported as
# "caf\303\251.txt" under the default core.quotePath. Stripping the surrounding
# quotes left the octal escapes in the value, and \3 is not a legal escape in a
# double-quoted YAML scalar — so one accented filename made the whole checkpoint
# unparseable, costing the session every other field in it. Untracked paths are
# the likeliest to carry a human-typed name, so expanding them walked into it.
SB="$(new_sandbox)"
git init -q "$SB" >/dev/null 2>&1
# Pinned rather than inherited: core.quotePath defaults to true, but a machine
# whose global config turns it off would quietly make this test pass against the
# unfixed hook. -z ignores the setting entirely, which is the point.
git -C "$SB" config core.quotePath true >/dev/null 2>&1
printf 'x\n' > "$SB/café.txt"
printf 'y\n' > "$SB/a\\b\"c.txt"
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    BODY=$(cat "$CP")
    assert_contains "checkpoint_nonAsciiPath_writtenAsRawUtf8" \
        "$BODY" 'path: "café.txt"'
    assert_not_contains "checkpoint_nonAsciiPath_noOctalEscapeLeftInValue" \
        "$BODY" 'caf\303\251'
    # Backslash escaped first, then the quote — reversing the order would
    # re-escape the backslash the quote escape just introduced.
    assert_contains "checkpoint_pathWithBackslashAndQuote_bothEscapedForYaml" \
        "$BODY" 'path: "a\\b\"c.txt"'
else
    bad "checkpoint_pathNeedingGitQuoting_writtenAsValidYaml — no checkpoint written"
fi

# checkpoint_renamedPath_recordsDestinationOnly
# Under -z a rename is two NUL-terminated records — `XY <new>\0<old>\0` — not
# one `old -> new` string. Leaving the origin unread made it the next entry, its
# status bytes taken from whatever its own filename started with, so a rename
# produced a phantom second file with an invented change_type.
SB="$(new_sandbox)"
git init -q "$SB" >/dev/null 2>&1
printf 'contents\n' > "$SB/before.txt"
git -C "$SB" add before.txt >/dev/null 2>&1
git -C "$SB" -c user.email=t@example.com -c user.name=T commit -q -m base >/dev/null 2>&1
git -C "$SB" mv before.txt after.txt >/dev/null 2>&1
printf '{"session_id":"s1","trigger":"auto"}' \
    | bash "$SB/.claude/hooks/pre-compact.sh" >/dev/null 2>&1
CP=$(find "$SB/.claude/sessions" -name 'auto-checkpoint-*.yaml' -type f 2>/dev/null | head -1)
if [ -n "$CP" ]; then
    BODY=$(cat "$CP")
    assert_contains "checkpoint_renamedPath_recordsDestination" \
        "$BODY" 'path: "after.txt"'
    assert_not_contains "checkpoint_renamedPath_doesNotAlsoRecordOrigin" \
        "$BODY" 'before.txt'
else
    bad "checkpoint_renamedPath_recordsDestinationOnly — no checkpoint written"
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

# cleanup_sessionEnd_keepsOwnHandoffOwnershipRecord
# The other three markers are session-private, but .compact-handoff-* is read
# ACROSS sessions: it is what tells a concurrent session that a handoff on disk
# already belongs to someone. Deleting it at SessionEnd un-claims this session's
# handoffs the instant it exits, so the next session's fallback glob picks up
# the newest file and forwards a compact_instruction written for a task that is
# not its own. The claim has to outlive the session, exactly as the handoff it
# points at does; the 7-day prune below is what collects it.
assert_file_exists "cleanup_sessionEnd_keepsOwnHandoffOwnershipRecord" \
    "$SB/.claude/logs/.compact-handoff-s1"

# cleanup_staleHandoffOwnershipRecord_prunedAfterSevenDays
# Retention is bounded, not permanent — the record is kept for the concurrent
# reader, not forever. touch -d backdates past the -mtime +7 window.
SB="$(new_sandbox)"
touch "$SB/.claude/logs/.compact-handoff-s9"
touch -d '30 days ago' "$SB/.claude/logs/.compact-handoff-s9" 2>/dev/null \
    || touch -t 202001010000 "$SB/.claude/logs/.compact-handoff-s9"
printf '{"session_id":"s1","reason":"exit"}' \
    | bash "$SB/.claude/hooks/session-end-cleanup.sh" >/dev/null 2>&1
assert_file_absent "cleanup_staleHandoffOwnershipRecord_prunedAfterSevenDays" \
    "$SB/.claude/logs/.compact-handoff-s9"

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

# ── Hook registration ───────────────────────────────────────────────────────
# Every other assertion in this file invokes a hook directly, which means none
# of them can tell whether the hook is wired to the event it was written for.
# The PreToolUse claim is the case where that gap bites: the claim block reads
# `file_path` out of `tool_input` and works on a PreToolUse payload whether or
# not the hook is registered for that event, so the entire pre-claim can be
# dead in production with the unit tests still green. These read the real
# settings.json.
echo "hook registration (.claude/settings.json):"

SB="$(new_sandbox)"
printf '%s\n' \
    'const fs = require("fs");' \
    'const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));' \
    'const [, , , event, needle] = process.argv;' \
    'const matchers = [];' \
    'for (const entry of (settings.hooks && settings.hooks[event]) || []) {' \
    '  for (const hook of entry.hooks || []) {' \
    '    if (typeof hook.command === "string" && hook.command.includes(needle)) {' \
    '      matchers.push(entry.matcher === undefined ? "*" : entry.matcher);' \
    '    }' \
    '  }' \
    '}' \
    'process.stdout.write(matchers.join(","));' \
    > "$SB/scripts/hook-matchers.js"

matchers_for() {
    node "$SB/scripts/hook-matchers.js" \
        "$PROJECT_ROOT/.claude/settings.json" "$1" "compact-suggest.sh" 2>/dev/null
}

# wiring_claimToolList_readFromTheHookSource
# The tool list the claim block actually gates on, lifted from the `case` that
# follows the TOOL_NAME switch. Pinned to a literal so the comparison below
# cannot pass vacuously on two empty strings if this extraction ever breaks.
CLAIM_TOOLS=$(awk '/case "\$TOOL_NAME" in/ { getline; gsub(/[ )]/, ""); print; exit }' \
    "$PROJECT_ROOT/.claude/hooks/compact-suggest.sh")
assert_eq "wiring_claimToolList_readFromTheHookSource" \
    "$CLAIM_TOOLS" "Write|Edit|MultiEdit|NotebookEdit"

# wiring_preToolUseMatcher_equalsTheClaimToolList
# A write tool the claim handles but the matcher omits is a handoff whose claim
# lands only on the PostToolUse backstop — the race Finding 3 closed, reopened
# silently. Equality keeps the two lists from drifting apart in either
# direction.
assert_eq "wiring_preToolUseMatcher_equalsTheClaimToolList" \
    "$(matchers_for PreToolUse)" "$CLAIM_TOOLS"

# wiring_compactSuggest_stillRegisteredOnPostToolUse
# The PreToolUse pass exits before measuring anything, so it replaces nothing:
# the nudge, and the claim backstop for a write this session did not start,
# both still depend on the catch-all PostToolUse registration.
assert_eq "wiring_compactSuggest_stillRegisteredOnPostToolUse" \
    "$(matchers_for PostToolUse)" ".*"

echo ""

# ── Summary ─────────────────────────────────────────────────────────────────
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"
[ "$SKIP" -gt 0 ] && echo "  $SKIP skipped (unavailable on this machine)"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:$ERRORS"
    exit 1
fi

exit 0
