#!/bin/bash
# Smoke tests for PostToolUse / SessionEnd hooks.
# Usage: bash tests/hook-smoke.sh
#
# TWO THINGS THIS FILE USED TO GET WRONG, both fixed in #T145.
#
# It ran the hooks against the LIVE repo. session-end-cleanup.sh prunes
# `.compact-handoff-*` records older than seven days, and a test invoking it
# with a real project root was therefore able to delete the ownership records
# that pre-compact.sh reads — a test suite that quietly damages the state of the
# thing it is testing. It also touched and removed files directly in
# `$PROJECT_ROOT/.claude/logs/`. Every test now runs in its own temp project.
#
# It asserted only exit codes. Every hook here is advisory: each one runs
# `set -euo pipefail` with `trap 'exit 0' ERR`, which is a promise that it exits
# 0 no matter what happens inside it. Asserting exit 0 against a script whose
# whole design is to exit 0 is close to asserting nothing — 14 of the 15
# original assertions passed against hooks replaced by `exit 0` stubs. The exit
# codes are still checked, because a hook that hangs or exits non-zero would
# break Claude Code, but every hook now also has at least one assertion about
# what it DID: a file written, a file left alone, a subprocess invoked, a line
# on stderr.
#
# Mutation testing: point PROJECT_OS_TEST_HOOKS at a directory of deliberately
# broken hooks and every behavioural assertion must fail there. The stub control
# lives at tests/hook-smoke-negctl.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# The hooks under test. Overridable so the suite can be run against a mutant
# tree without editing it — the same mechanism tests/compaction-hooks.sh uses.
REAL_HOOKS="${PROJECT_OS_TEST_HOOKS:-$PROJECT_ROOT/.claude/hooks}"

PASS=0
FAIL=0
ERRORS=""

ok() {
    PASS=$((PASS + 1))
    echo "  PASS: $1"
}

nope() {
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}
  FAIL: $1"
    echo "  FAIL: $1"
}

assert_eq() {
    local name="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then ok "$name"
    else nope "$name — expected [$expected], got [$actual]"; fi
}

assert_contains() {
    local name="$1" haystack="$2" needle="$3"
    case "$haystack" in
        *"$needle"*) ok "$name" ;;
        *) nope "$name — expected output to contain: $needle" ;;
    esac
}

assert_not_contains() {
    local name="$1" haystack="$2" needle="$3"
    case "$haystack" in
        *"$needle"*) nope "$name — output unexpectedly contained: $needle" ;;
        *) ok "$name" ;;
    esac
}

assert_file_exists() {
    local name="$1" path="$2"
    if [ -e "$path" ]; then ok "$name"; else nope "$name — expected to exist: $path"; fi
}

assert_file_absent() {
    local name="$1" path="$2"
    if [ -e "$path" ]; then nope "$name — expected NOT to exist: $path"; else ok "$name"; fi
}

# ── Sandbox ─────────────────────────────────────────────────────────────────
# Each hook derives its project root from its own location ($SCRIPT_DIR/../..),
# so a hook COPIED into <sandbox>/.claude/hooks/ reads and writes only inside
# the sandbox. That is the whole isolation mechanism — no environment variable
# redirects these hooks, and none should, since a root that a payload or a
# parent process can move is a root an untrusted repo can move.
SANDBOXES=()
cleanup() {
    local sb
    for sb in ${SANDBOXES+"${SANDBOXES[@]}"}; do
        [ -n "$sb" ] && rm -rf "$sb"
    done
}
trap cleanup EXIT

new_sandbox() {
    local sb h
    sb="$(mktemp -d)"
    SANDBOXES+=("$sb")
    mkdir -p "$sb/.claude/hooks" "$sb/.claude/logs" "$sb/.claude/sessions" "$sb/scripts"
    for h in _common.sh output-index.sh compact-suggest.sh tool-failure-log.sh \
             post-tool-use.sh session-end-cleanup.sh post-write-session.sh \
             log-activity.sh; do
        cp "$REAL_HOOKS/$h" "$sb/.claude/hooks/$h" 2>/dev/null || true
    done
    cp "$PROJECT_ROOT/scripts/scrub-secrets.sh" "$sb/scripts/scrub-secrets.sh" 2>/dev/null || true
    printf '%s' "$sb"
}

# run_hook <sandbox> <hook-name> <stdin> [VAR=val ...]
#   -> sets HOOK_EXIT, HOOK_OUT, HOOK_ERR
#
# stdout and stderr are captured separately: output-index.sh's advisory hint is
# a stderr line, and merging the streams would let a stdout write masquerade as
# it.
#
# Environment goes through `env`, not through a `VAR=val run_hook …` prefix. For
# a FUNCTION, bash keeps such an assignment in the shell after the call returns,
# so one test setting CONTEXT_FILTER_DISABLED=1 would silently disable indexing
# for every test that followed it — a whole section passing for the wrong
# reason. Passing it as an argument keeps the setting inside the one process
# that is supposed to see it.
HOOK_EXIT=0; HOOK_OUT=""; HOOK_ERR=""
run_hook() {
    local sb="$1" hook="$2" input="$3"
    shift 3
    local errf="$sb/.stderr"
    HOOK_EXIT=0
    HOOK_OUT=$(printf '%s' "$input" | env "$@" bash "$sb/.claude/hooks/$hook" 2>"$errf") || HOOK_EXIT=$?
    HOOK_ERR=$(cat "$errf" 2>/dev/null || true)
}

# A stand-in for scripts/knowledge-index.ts. The real one opens a SQLite
# database; what output-index.sh's own logic is responsible for is reading the
# threshold, comparing it against the output size, invoking the indexer, and
# emitting the hint. The stub records its argv so all four can be asserted
# without a database, and answers `config threshold_bytes` with a value small
# enough that a one-line fixture crosses it.
write_index_stub() {
    local sb="$1"
    cat > "$sb/scripts/knowledge-index.ts" <<'STUB'
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, '..', 'index-calls.log'), args[0] + '\n');
if (args[0] === 'config') console.log('100');
process.exit(0);
STUB
}

index_calls() {
    cat "$1/index-calls.log" 2>/dev/null || true
}

# Minimal valid hook payloads.
VALID_READ='{"tool_name":"Read","tool_input":{"file_path":"/x/test.txt"},"tool_response":"hello world","is_error":false}'
# The real PostToolUseFailure shape (captured from a nested headless session,
# #T213): no tool_response and no is_error — the event itself is the failure
# signal, and `error` carries the message.
VALID_FAILURE='{"session_id":"smoke1","hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"false","description":"Run false"},"tool_use_id":"toolu_smoke","error":"Exit code 1 boom","is_interrupt":false,"duration_ms":12}'
EMPTY_INPUT='{}'
INVALID_JSON='not json at all'

echo "=== Hook Smoke Tests ==="
echo ""

# ── output-index.sh ─────────────────────────────────────────────────────────
echo "output-index.sh:"

SB=$(new_sandbox)
write_index_stub "$SB"
BIG=$(printf 'x%.0s' $(seq 1 4000))
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"/x/big.txt\"},\"tool_response\":\"$BIG\",\"is_error\":false}"
assert_eq "outputIndex_largeOutput_exitsZero" 0 "$HOOK_EXIT"
assert_contains "outputIndex_largeOutput_invokesIndexer" "$(index_calls "$SB")" "index"
assert_contains "outputIndex_largeOutput_emitsHintOnStderr" "$HOOK_ERR" "Large output indexed"
# The hint is advisory context, not tool output. A hook that printed it on
# stdout would be corrupting the stream the tool result travels on.
assert_eq "outputIndex_hint_notOnStdout" "" "$HOOK_OUT"

SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh "$VALID_READ"
assert_eq "outputIndex_smallOutput_exitsZero" 0 "$HOOK_EXIT"
# `config` is read before the size comparison, so the stub IS invoked; what must
# not appear is an `index` call. Asserting on the log's content rather than its
# existence is what makes this discriminate.
assert_not_contains "outputIndex_smallOutput_doesNotIndex" "$(index_calls "$SB")" "index"
assert_not_contains "outputIndex_smallOutput_noHint" "$HOOK_ERR" "Large output indexed"

SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"/x/big.txt\"},\"tool_response\":\"$BIG\",\"is_error\":false}" \
    CONTEXT_FILTER_DISABLED=1
assert_eq "outputIndex_disabled_exitsZero" 0 "$HOOK_EXIT"
# The kill switch has to cut the work, not just the hint. If the indexer still
# ran, "disabled" would mean "silent", which is the opposite of the point.
assert_file_absent "outputIndex_disabled_indexerNeverInvoked" "$SB/index-calls.log"

SB=$(new_sandbox)
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"/x/big.txt\"},\"tool_response\":\"$BIG\",\"is_error\":false}"
assert_eq "outputIndex_noIndexScript_exitsZero" 0 "$HOOK_EXIT"
assert_not_contains "outputIndex_noIndexScript_noHint" "$HOOK_ERR" "Large output indexed"

# Bash does not send a string result: `tool_response` is an object carrying
# stdout/stderr/interrupted. A hook that only handled the string shape would
# index every Read and no Bash call, which is the half-dead version of the same
# bug — so the object shape gets its own fixture.
SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls -R\"},\"tool_response\":{\"stdout\":\"$BIG\",\"stderr\":\"\",\"interrupted\":false}}"
assert_eq "outputIndex_objectToolResponse_exitsZero" 0 "$HOOK_EXIT"
assert_contains "outputIndex_objectToolResponse_invokesIndexer" "$(index_calls "$SB")" "index"
assert_contains "outputIndex_objectToolResponse_emitsHintOnStderr" "$HOOK_ERR" "Large output indexed"

SB=$(new_sandbox)
write_index_stub "$SB"
run_hook "$SB" output-index.sh "$EMPTY_INPUT"
assert_eq "outputIndex_emptyJson_exitsZero" 0 "$HOOK_EXIT"
run_hook "$SB" output-index.sh "$INVALID_JSON"
assert_eq "outputIndex_invalidJson_exitsZero" 0 "$HOOK_EXIT"
assert_not_contains "outputIndex_invalidJson_doesNotIndex" "$(index_calls "$SB")" "index"

echo ""

# ── compact-suggest.sh ──────────────────────────────────────────────────────
# The forwarding, ownership and transcript-measurement behaviour of this hook is
# covered in depth by tests/compaction-hooks.sh. What is asserted here is the
# outermost contract — that a pressure signal reaches stdout as a well-formed
# PostToolUse response, and that it is issued once per compaction cycle.
echo "compact-suggest.sh:"

SB=$(new_sandbox)
printf '{"type":"user","message":{"content":"hello"}}\n' > "$SB/transcript.jsonl"
# The byte-growth branch, with the threshold lowered to something a one-line
# fixture crosses. The transcript carries no usage record, which is what selects
# that branch; the default 1.2 MB threshold would otherwise need a 1.2 MB file.
NUDGE_ENV=PROJECT_OS_COMPACT_NUDGE_BYTES=10
run_hook "$SB" compact-suggest.sh \
    "{\"session_id\":\"smoke1\",\"hook_event_name\":\"PostToolUse\",\"transcript_path\":\"$SB/transcript.jsonl\",\"tool_name\":\"Read\",\"tool_response\":\"ok\",\"is_error\":false}" \
    "$NUDGE_ENV"
assert_eq "compactSuggest_pressure_exitsZero" 0 "$HOOK_EXIT"
assert_contains "compactSuggest_pressure_emitsAdditionalContext" "$HOOK_OUT" \
    '"hookEventName":"PostToolUse"'
assert_contains "compactSuggest_pressure_namesTheHandoffCommand" "$HOOK_OUT" "/tools:handoff"
assert_file_exists "compactSuggest_pressure_spendsTheCycleMarker" \
    "$SB/.claude/logs/.compact-nudged-smoke1"

# Second firing, same cycle. One nudge per compaction cycle is the whole reason
# the marker exists; a hook that re-emitted would spend context on every tool
# call for the rest of the session.
run_hook "$SB" compact-suggest.sh \
    "{\"session_id\":\"smoke1\",\"hook_event_name\":\"PostToolUse\",\"transcript_path\":\"$SB/transcript.jsonl\",\"tool_name\":\"Read\",\"tool_response\":\"ok\",\"is_error\":false}" \
    "$NUDGE_ENV"
assert_eq "compactSuggest_secondFiringSameCycle_emitsNothing" "" "$HOOK_OUT"

SB=$(new_sandbox)
run_hook "$SB" compact-suggest.sh "$EMPTY_INPUT"
assert_eq "compactSuggest_emptyJson_exitsZero" 0 "$HOOK_EXIT"
# No transcript to measure means no basis for a pressure claim. Emitting here
# would be a nudge invented from nothing.
assert_eq "compactSuggest_emptyJson_emitsNothing" "" "$HOOK_OUT"

echo ""

# ── tool-failure-log.sh ─────────────────────────────────────────────────────
echo "tool-failure-log.sh:"

# #T213: the hook runs on the native PostToolUseFailure event, so being invoked
# with a tool_name IS the failure signal. It used to ride PostToolUse and gate on
# an `is_error` grep that matched a tool's own output text; the fixture below has
# no is_error at all, which is what makes this test discriminate against that
# gate coming back.
SB=$(new_sandbox)
run_hook "$SB" tool-failure-log.sh "$VALID_FAILURE"
assert_eq "toolFailureLog_nativeFailure_exitsZero" 0 "$HOOK_EXIT"
assert_contains "toolFailureLog_nativeFailure_logsToolName" \
    "$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)" "FAIL tool=Bash"
# The hook's contract is that it never records content. A log line carrying the
# command or the error message would be a privacy regression that an exit code
# cannot see.
assert_not_contains "toolFailureLog_nativeFailure_doesNotLogErrorMessage" \
    "$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)" "boom"
assert_not_contains "toolFailureLog_nativeFailure_doesNotLogCommand" \
    "$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)" "false"

SB=$(new_sandbox)
run_hook "$SB" tool-failure-log.sh "$INVALID_JSON"
assert_eq "toolFailureLog_invalidJson_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "toolFailureLog_invalidJson_writesNothing" \
    "$SB/.claude/logs/tool-failures.log"

SB=$(new_sandbox)
run_hook "$SB" tool-failure-log.sh "$EMPTY_INPUT"
assert_eq "toolFailureLog_emptyJson_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "toolFailureLog_emptyJson_writesNothing" \
    "$SB/.claude/logs/tool-failures.log"

SB=$(new_sandbox)
# tool_name is attacker-influenced in the sense that matters here: it reaches an
# append-only log a human reads. The sanitizer keeps [[:alnum:]_-], so the
# separators that would forge a second entry are dropped rather than escaped.
run_hook "$SB" tool-failure-log.sh \
    '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash; rm -rf /","tool_input":{},"error":"x","is_interrupt":false}'
LOGGED=$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)
assert_contains "toolFailureLog_punctuationInToolName_strippedNotEscaped" \
    "$LOGGED" "FAIL tool=Bashrm-rf"
assert_eq "toolFailureLog_punctuationInToolName_stillOneLine" 1 \
    "$(printf '%s\n' "$LOGGED" | grep -c 'FAIL tool=')"

# tool_input can carry a written file's entire contents, so a failing Write can
# be megabytes. The hook must still log it AND consume the whole payload: one
# that exited after the first match would hand the writer an EPIPE, which this
# suite sees as HOOK_EXIT 141 because run_hook pipes under `set -o pipefail`.
# 256 KB exceeds the pipe buffer, which is what makes the drain observable.
SB=$(new_sandbox)
FILLER=$(head -c 262144 /dev/zero | tr '\0' 'x')
run_hook "$SB" tool-failure-log.sh \
    "{\"hook_event_name\":\"PostToolUseFailure\",\"tool_name\":\"Write\",\"tool_input\":{\"content\":\"$FILLER\"},\"error\":\"denied\",\"is_interrupt\":false}"
assert_eq "toolFailureLog_largeToolInput_exitsZero" 0 "$HOOK_EXIT"
assert_contains "toolFailureLog_largeToolInput_stillLogged" \
    "$(cat "$SB/.claude/logs/tool-failures.log" 2>/dev/null || true)" "FAIL tool=Write"

# Wiring: the hook is registered on PostToolUseFailure and nowhere else. Run on
# the old PostToolUse `.*` entry it would log every successful call as a failure
# the moment the is_error gate was gone. Static, like the payload-schema block
# below: it reads the repo's own settings.json, not a sandbox. awk tracks the
# four-space-indented event key above each "command" line, which also keeps the
# permissions.allow entry for the same script out of the count.
WIRED_EVENTS=$(awk '/^    "[A-Za-z]+": \[/ { ev = $1 } /"command".*tool-failure-log\.sh/ { print ev }' \
    "$PROJECT_ROOT/.claude/settings.json" 2>/dev/null || true)
assert_eq "toolFailureLog_settingsWiring_registeredOnlyOnPostToolUseFailure" \
    '"PostToolUseFailure":' "$WIRED_EVENTS"

echo ""

# ── log-activity.sh (PostModelSwitch hook mode) ─────────────────────────────
# #T203: `model-switched --stdin` logs which model actually took over. The
# fixtures below use aliases rather than full model ids; the hook copies whatever
# the payload carries, so the spelling is irrelevant to what is asserted. The
# payload shape (from_model / to_model / source) was captured from a real
# PostModelSwitch fired by `/model` inside a headless session. Whether the event
# also fires on a fallbackModel fallback is UNVERIFIED — it could not be provoked
# headlessly — so no fixture here claims a source value for it.
echo "log-activity.sh:"

# run_model_switch <sandbox> <stdin> — hook mode, sets HOOK_EXIT / HOOK_OUT.
run_model_switch() {
    local sb="$1" input="$2"
    HOOK_EXIT=0
    HOOK_OUT=$(printf '%s' "$input" | bash "$sb/.claude/hooks/log-activity.sh" model-switched --stdin 2>"$sb/.stderr") || HOOK_EXIT=$?
}
activity_log() { cat "$1/.claude/logs/activity.jsonl" 2>/dev/null || true; }

SB=$(new_sandbox)
run_model_switch "$SB" \
    '{"session_id":"smoke1","hook_event_name":"PostModelSwitch","from_model":"sonnet","to_model":"opus","requested_model":"opus","source":"command","context_tokens":0}'
assert_eq "activityLog_modelSwitched_exitsZero" 0 "$HOOK_EXIT"
assert_contains "activityLog_modelSwitched_logsEvent" "$(activity_log "$SB")" '"event": "model-switched"'
assert_contains "activityLog_modelSwitched_logsFrom" "$(activity_log "$SB")" '"from": "sonnet"'
assert_contains "activityLog_modelSwitched_logsTo" "$(activity_log "$SB")" '"to": "opus"'
assert_contains "activityLog_modelSwitched_logsSource" "$(activity_log "$SB")" '"source": "command"'
# requested_model is deliberately not a logged field: it is the user's spelling
# of to_model, so recording it would only add a second name for the same thing.
assert_not_contains "activityLog_modelSwitched_doesNotLogRequestedModel" "$(activity_log "$SB")" "requested"

SB=$(new_sandbox)
run_model_switch "$SB" '{"hook_event_name":"PostModelSwitch","to_model":"opus"}'
assert_eq "activityLog_modelSwitchedMissingFrom_exitsZero" 0 "$HOOK_EXIT"
assert_contains "activityLog_modelSwitchedMissingFrom_logsTo" "$(activity_log "$SB")" '"to": "opus"'
assert_not_contains "activityLog_modelSwitchedMissingFrom_doesNotLogFrom" "$(activity_log "$SB")" '"from"'

SB=$(new_sandbox)
run_model_switch "$SB" "$INVALID_JSON"
assert_eq "activityLog_modelSwitchedInvalidJson_exitsZero" 0 "$HOOK_EXIT"
assert_contains "activityLog_modelSwitchedInvalidJson_stillLogsEvent" "$(activity_log "$SB")" '"event": "model-switched"'
assert_not_contains "activityLog_modelSwitchedInvalidJson_doesNotLogMetadata" "$(activity_log "$SB")" '"metadata"'

# Values reach an append-only log. The charset is closed, so the characters that
# would forge a second field or entry are dropped rather than escaped.
SB=$(new_sandbox)
run_model_switch "$SB" \
    '{"hook_event_name":"PostModelSwitch","from_model":"sonnet; rm -rf /","to_model":"opus","source":"command"}'
assert_contains "activityLog_modelSwitchedPunctuation_strippedNotEscaped" "$(activity_log "$SB")" '"from": "sonnetrm-rf"'
assert_eq "activityLog_modelSwitchedPunctuation_stillOneLine" 1 \
    "$(printf '%s\n' "$(activity_log "$SB")" | grep -c 'model-switched')"

# Without --stdin the hook must not read stdin at all: the other callers are
# agents running it from a shell whose stdin may be an open pipe.
SB=$(new_sandbox)
HOOK_EXIT=0
printf '%s' '{"from_model":"sonnet","to_model":"opus"}' | bash "$SB/.claude/hooks/log-activity.sh" model-switched from=a to=b >/dev/null 2>&1 || HOOK_EXIT=$?
assert_eq "activityLog_modelSwitchedManualArgs_exitsZero" 0 "$HOOK_EXIT"
assert_contains "activityLog_modelSwitchedManualArgs_logsArgsNotPayload" "$(activity_log "$SB")" '"from": "a"'
assert_not_contains "activityLog_modelSwitchedManualArgs_doesNotLogPayload" "$(activity_log "$SB")" "sonnet"

# Wiring: PostModelSwitch runs log-activity.sh in hook mode. Static, like the
# tool-failure-log check above.
MODEL_SWITCH_WIRED=$(awk '/^    "[A-Za-z]+": \[/ { ev = $1 } /"command".*log-activity\.sh.* model-switched --stdin/ { print ev }' \
    "$PROJECT_ROOT/.claude/settings.json" 2>/dev/null || true)
assert_eq "activityLog_settingsWiring_modelSwitchedOnPostModelSwitch" \
    '"PostModelSwitch":' "$MODEL_SWITCH_WIRED"

echo ""

# ── post-tool-use.sh ────────────────────────────────────────────────────────
echo "post-tool-use.sh:"

SB=$(new_sandbox)
printf 'x\n' > "$SB/note.md"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SB/note.md\"},\"tool_response\":\"ok\",\"is_error\":false}"
assert_eq "postToolUse_inProjectFile_exitsZero" 0 "$HOOK_EXIT"
# A .md file matches no formatter branch, so the only observable effect is that
# the hook got PAST containment. That is the thing worth asserting: the log
# directory is created after resolve_project_path returns, and never before it.
assert_file_exists "postToolUse_inProjectFile_reachesLogDirSetup" "$SB/.claude/logs"

SB=$(new_sandbox)
OUTSIDE=$(mktemp -d)
SANDBOXES+=("$OUTSIDE")
printf 'x\n' > "$OUTSIDE/elsewhere.md"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$OUTSIDE/elsewhere.md\"},\"tool_response\":\"ok\",\"is_error\":false}"
assert_eq "postToolUse_outOfProjectFile_exitsZero" 0 "$HOOK_EXIT"
# The containment check has to be the FIRST thing with an effect. If the log
# directory appeared here, the hook would be doing work on behalf of a path it
# is about to reject.
assert_file_absent "postToolUse_outOfProjectFile_noSideEffect" "$SB/.claude/logs"

SB=$(new_sandbox)
printf 'x\n' > "$SB/note.md"
rm -rf "$SB/.claude/logs"
# Windows delivers file_path as a native backslash path, and the runtime's JSON
# escaping doubles each separator. Unconverted, `[ -f ]` fails and the hook
# silently formats nothing — the same silent no-op that
# canonicalize_payload_path exists to prevent one layer down.
WINPATH=$(printf '%s' "$SB/note.md" | sed 's|/|\\\\|g')
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$WINPATH\"},\"tool_response\":\"ok\",\"is_error\":false}"
assert_eq "postToolUse_backslashPayloadPath_exitsZero" 0 "$HOOK_EXIT"
assert_file_exists "postToolUse_backslashPayloadPath_stillResolved" "$SB/.claude/logs"

SB=$(new_sandbox)
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh "$EMPTY_INPUT"
assert_eq "postToolUse_emptyJson_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "postToolUse_emptyJson_noSideEffect" "$SB/.claude/logs"

# #T148: the payload read is bounded, and the bound has a blind spot — file_path
# lives inside tool_input, the object that also carries a written file's entire
# contents, so a large enough write can push it past the window. The hook then
# formats nothing. That is a defensible cost only if it is audible, so it says
# so on stderr; a formatter that skips exactly the largest files in silence is
# the failure this hook already carries one fix for.
SB=$(new_sandbox)
printf 'x\n' > "$SB/note.md"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SB/note.md\"}}" \
    PROJECT_OS_HOOK_PAYLOAD_BYTES=16
assert_contains "postToolUse_filePathBeyondBound_saysSoOnStderr" \
    "$HOOK_ERR" "not formatting"
assert_file_absent "postToolUse_filePathBeyondBound_noSideEffect" "$SB/.claude/logs"

# The other half of the same bound: a payload far larger than the window still
# works when the key is inside it, which is the ordinary case.
#
# This is also the drain assertion, and the filler is 256 KB for that reason
# rather than for the file_path test above. The hook stops reading at 256 bytes;
# if it then exited without consuming the rest, the writer takes EPIPE. A few KB
# would not prove anything — the pipe buffer would swallow it and the writer
# would never notice — so the filler has to exceed the buffer. The suite runs
# under `set -o pipefail` and run_hook feeds the payload through a pipe, so a
# writer killed by SIGPIPE surfaces as HOOK_EXIT 141: the exitsZero assertion
# below is what fails when the drain is removed.
SB=$(new_sandbox)
printf 'x\n' > "$SB/note.md"
rm -rf "$SB/.claude/logs"
TAIL_FILLER=$(head -c 262144 /dev/zero | tr '\0' 'x')
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SB/note.md\"},\"tool_response\":\"$TAIL_FILLER\"}" \
    PROJECT_OS_HOOK_PAYLOAD_BYTES=256
assert_eq "postToolUse_payloadPastBound_exitsZero" 0 "$HOOK_EXIT"
assert_file_exists "postToolUse_payloadPastBound_keyInWindow_stillResolved" \
    "$SB/.claude/logs"

echo ""

# ── post-write-session.sh ───────────────────────────────────────────────────
# #T169: the payload path used to be compared against .claude/sessions/ raw,
# unresolved. A backslash path (Windows) or a symlinked sessions directory
# named a real session file but never matched the prefix check, so the hook
# silently skipped scrubbing it — a secret shipped in a handoff file with no
# error anywhere. canonicalize_payload_path + resolve_project_path fix both.
echo "post-write-session.sh:"

SECRET_LINE='api_key: sk-abcdefghijklmnopqrstuvwx'  # scan:allow (fake fixture token, not a real secret)

SB=$(new_sandbox)
printf '%s\n' "$SECRET_LINE" > "$SB/.claude/sessions/handoff.yaml"
# Windows delivers file_path as a native backslash path, and the runtime's JSON
# escaping doubles each separator. Unconverted, resolve_project_path's
# `[ -f "$file" ]` fails against the raw backslash spelling and the hook
# silently skips scrubbing a session file that IS under .claude/sessions/.
WINPATH=$(printf '%s' "$SB/.claude/sessions/handoff.yaml" | sed 's|/|\\\\|g')
run_hook "$SB" post-write-session.sh \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$WINPATH\"},\"tool_response\":\"ok\",\"is_error\":false}"
assert_eq "postWriteSession_backslashPayloadPath_exitsZero" 0 "$HOOK_EXIT"
assert_not_contains "postWriteSession_backslashPayloadPath_secretScrubbed" \
    "$(cat "$SB/.claude/sessions/handoff.yaml" 2>/dev/null || true)" "sk-abcdefghijklmnopqrstuvwx"  # scan:allow (fake fixture token, not a real secret)
assert_contains "postWriteSession_backslashPayloadPath_redactionMarkerWritten" \
    "$(cat "$SB/.claude/sessions/handoff.yaml" 2>/dev/null || true)" "REDACTED:OPENAI_KEY"

# In-bounds indirection: a session file reached through a symlink to the real
# sessions directory. realpath resolves it back inside SESSION_DIR, so this
# must scrub exactly like the direct path does.
SB=$(new_sandbox)
printf '%s\n' "$SECRET_LINE" > "$SB/.claude/sessions/via-symlink.yaml"
# `ln -s` on a directory can succeed (exit 0) on Windows/MSYS while silently
# falling back to a junction rather than a real symlink — `-L` is false on it
# and realpath never resolves through it, which would make this case fail for
# a reason unrelated to the hook. Require an actual symlink, not just a
# successful exit, before trusting the result.
if ln -s "$SB/.claude/sessions" "$SB/session-link" 2>/dev/null && [ -L "$SB/session-link" ]; then
    run_hook "$SB" post-write-session.sh \
        "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$SB/session-link/via-symlink.yaml\"},\"tool_response\":\"ok\",\"is_error\":false}"
    assert_eq "postWriteSession_symlinkedSessionsDir_exitsZero" 0 "$HOOK_EXIT"
    assert_not_contains "postWriteSession_symlinkedSessionsDir_secretScrubbed" \
        "$(cat "$SB/.claude/sessions/via-symlink.yaml" 2>/dev/null || true)" "sk-abcdefghijklmnopqrstuvwx"  # scan:allow (fake fixture token, not a real secret)
else
    echo "  SKIP: postWriteSession_symlinkedSessionsDir_secretScrubbed (symlink creation unsupported)"
fi

echo ""

# ── bashEditDiff: Bash-made edits (#T202) ───────────────────────────────────
# Both hooks also ride the PostToolUse `Bash` matcher and take their files from
# tool_response.bashEditDiff.changedFiles — the payload shape verified in probe
# (e), CLI 2.1.290. `npx` is stubbed on PATH so "formatted" is asserted as the
# exact prettier invocation rather than inferred from a log directory.
echo "bashEditDiff (post-tool-use.sh / post-write-session.sh):"

# bash_payload <changedFiles-array-body> — a Bash PostToolUse payload.
bash_payload() {
    printf '{"hook_event_name":"PostToolUse","tool_name":"Bash","permission_mode":"auto","tool_input":{"command":"sed -i s/one/two/ f","description":"edit"},"tool_response":{"stdout":"","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false,"bashEditDiff":{"files":[],"moreFiles":0,"changedFiles":[%s]}},"tool_use_id":"toolu_smoke","duration_ms":1}' "$1"
}

# npx_stub <sandbox> — a fake npx that records its argv, one call per line.
npx_stub() {
    mkdir -p "$1/bin"
    printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "%s/npx-calls.log"\n' "$1" > "$1/bin/npx"
    chmod +x "$1/bin/npx"
}

npx_calls() {
    cat "$1/npx-calls.log" 2>/dev/null || true
}

# In-repo file, with a space in its path: formatted at its canonical path.
SB=$(new_sandbox); npx_stub "$SB"; SBP=$(cd "$SB" && pwd -P)
mkdir -p "$SB/src dir"
printf 'const a=1\n' > "$SB/src dir/a.ts"
run_hook "$SB" post-tool-use.sh "$(bash_payload "\"$SB/src dir/a.ts\"")" PATH="$SB/bin:$PATH"
assert_eq "postToolUse_bashEditDiffInRepo_exitsZero" 0 "$HOOK_EXIT"
assert_eq "postToolUse_bashEditDiffInRepo_formatted" \
    "prettier --write $SBP/src dir/a.ts" "$(npx_calls "$SB")"

# Outside the repo: ignored.
SB=$(new_sandbox); npx_stub "$SB"
OUTSIDE=$(mktemp -d)
SANDBOXES+=("$OUTSIDE")
printf 'const a=1\n' > "$OUTSIDE/x.ts"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh "$(bash_payload "\"$OUTSIDE/x.ts\"")" PATH="$SB/bin:$PATH"
assert_eq "postToolUse_bashEditDiffOutsideRepo_exitsZero" 0 "$HOOK_EXIT"
assert_eq "postToolUse_bashEditDiffOutsideRepo_noSideEffect" "" "$(npx_calls "$SB")"

# Prefix collision: `<root>-evil/x.ts` shares the root's spelling as a string
# prefix but is outside it. Containment must compare with the trailing `/`.
SB=$(new_sandbox); npx_stub "$SB"
mkdir -p "$SB-evil"
SANDBOXES+=("$SB-evil")
printf 'const a=1\n' > "$SB-evil/x.ts"
run_hook "$SB" post-tool-use.sh "$(bash_payload "\"$SB-evil/x.ts\"")" PATH="$SB/bin:$PATH"
assert_eq "postToolUse_bashEditDiffPrefixCollision_exitsZero" 0 "$HOOK_EXIT"
assert_eq "postToolUse_bashEditDiffPrefixCollision_noSideEffect" "" "$(npx_calls "$SB")"

# Symlink to an in-scope sibling: followed, and the TARGET is what is formatted.
SB=$(new_sandbox); npx_stub "$SB"; SBP=$(cd "$SB" && pwd -P)
printf 'const a=1\n' > "$SB/real.ts"
if ln -s "$SB/real.ts" "$SB/link.ts" 2>/dev/null && [ -L "$SB/link.ts" ]; then
    run_hook "$SB" post-tool-use.sh "$(bash_payload "\"$SB/link.ts\"")" PATH="$SB/bin:$PATH"
    assert_eq "postToolUse_bashEditDiffSymlinkToSibling_formatsTarget" \
        "prettier --write $SBP/real.ts" "$(npx_calls "$SB")"
else
    echo "  SKIP: postToolUse_bashEditDiffSymlinkToSibling_formatsTarget (symlink creation unsupported)"
fi

# A quote in a path: rejected, not unescaped — and the parser carries on to the
# next element, which is still formatted.
SB=$(new_sandbox); npx_stub "$SB"; SBP=$(cd "$SB" && pwd -P)
printf 'const a=1\n' > "$SB/q\"x.ts"
printf 'const a=1\n' > "$SB/ok.ts"
run_hook "$SB" post-tool-use.sh "$(bash_payload "\"$SB/q\\\"x.ts\",\"$SB/ok.ts\"")" PATH="$SB/bin:$PATH"
assert_eq "postToolUse_bashEditDiffQuoteInPath_exitsZero" 0 "$HOOK_EXIT"
assert_eq "postToolUse_bashEditDiffQuoteInPath_formatsOnlyTheSafePath" \
    "prettier --write $SBP/ok.ts" "$(npx_calls "$SB")"
assert_contains "postToolUse_bashEditDiffQuoteInPath_rejectedOnStderr" \
    "$HOOK_ERR" "rejected a bashEditDiff path"

# A Bash payload without bashEditDiff (default mode, channel off): no-op.
SB=$(new_sandbox); npx_stub "$SB"
printf 'const a=1\n' > "$SB/a.ts"
rm -rf "$SB/.claude/logs"
run_hook "$SB" post-tool-use.sh \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"true\"},\"tool_response\":{\"stdout\":\"\",\"stderr\":\"\",\"interrupted\":false}}" \
    PATH="$SB/bin:$PATH"
assert_eq "postToolUse_bashWithoutEditDiff_exitsZero" 0 "$HOOK_EXIT"
assert_eq "postToolUse_bashWithoutEditDiff_noSideEffect" "" "$(npx_calls "$SB")$HOOK_ERR"
assert_file_absent "postToolUse_bashWithoutEditDiff_logDir_noSideEffect" "$SB/.claude/logs"

# Session file edited through Bash: scrubbed.
SB=$(new_sandbox)
printf '%s\n' "$SECRET_LINE" > "$SB/.claude/sessions/bash-edit.yaml"
run_hook "$SB" post-write-session.sh "$(bash_payload "\"$SB/.claude/sessions/bash-edit.yaml\"")"
assert_eq "postWriteSession_bashEditDiffSessionFile_exitsZero" 0 "$HOOK_EXIT"
assert_contains "postWriteSession_bashEditDiffSessionFile_secretScrubbed" \
    "$(cat "$SB/.claude/sessions/bash-edit.yaml" 2>/dev/null || true)" "REDACTED:OPENAI_KEY"

# Same hook, no bashEditDiff: the session file is left as written.
SB=$(new_sandbox)
printf '%s\n' "$SECRET_LINE" > "$SB/.claude/sessions/untouched.yaml"
run_hook "$SB" post-write-session.sh \
    "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"true\"},\"tool_response\":{\"stdout\":\"\",\"stderr\":\"\",\"interrupted\":false}}"
assert_eq "postWriteSession_bashWithoutEditDiff_exitsZero" 0 "$HOOK_EXIT"
assert_eq "postWriteSession_bashWithoutEditDiff_noSideEffect" \
    "$SECRET_LINE" "$(cat "$SB/.claude/sessions/untouched.yaml" 2>/dev/null || true)"

# Wiring: both hooks registered on a PostToolUse matcher that includes Bash.
# Static, like the tool-failure-log check above.
BASH_EDIT_WIRED=$(awk '/"matcher":/ { m = $2 } /"command".*post-(tool-use|write-session)\.sh/ { print m }' \
    "$PROJECT_ROOT/.claude/settings.json" 2>/dev/null || true)
assert_eq "bashEditDiff_settingsWiring_bothHooksOnBashMatcher" \
    '"Write|Edit|Bash",
"Write|Edit|Bash",' "$BASH_EDIT_WIRED"

echo ""

# ── session-end-cleanup.sh ──────────────────────────────────────────────────
echo "session-end-cleanup.sh:"

SB=$(new_sandbox)
LOGS="$SB/.claude/logs"
touch "$LOGS/.tool-count-smoke1" "$LOGS/.tool-count-smoke1.lock"
touch "$LOGS/.compact-cycle-smoke1" "$LOGS/.compact-handoff-smoke1"
touch "$LOGS/.tool-count-other"
touch -d '8 days ago' "$LOGS/.tool-count-ancient" 2>/dev/null || touch "$LOGS/.tool-count-ancient"
run_hook "$SB" session-end-cleanup.sh '{"session_id":"smoke1","reason":"exit"}'
assert_eq "sessionEnd_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "sessionEnd_ownCounter_removed" "$LOGS/.tool-count-smoke1"
assert_file_absent "sessionEnd_ownCounterLock_removed" "$LOGS/.tool-count-smoke1.lock"
assert_file_absent "sessionEnd_ownCycleMarker_removed" "$LOGS/.compact-cycle-smoke1"
# The one marker deliberately NOT removed: pre-compact.sh reads ownership
# records across sessions, so deleting this at SessionEnd would un-claim the
# handoff the moment the session exits.
assert_file_exists "sessionEnd_ownHandoffRecord_deliberatelyKept" "$LOGS/.compact-handoff-smoke1"
assert_file_exists "sessionEnd_freshForeignCounter_notPruned" "$LOGS/.tool-count-other"

SB=$(new_sandbox)
LOGS="$SB/.claude/logs"
if touch -d '8 days ago' "$LOGS/.tool-count-ancient" 2>/dev/null; then
    run_hook "$SB" session-end-cleanup.sh '{"session_id":"smoke1","reason":"exit"}'
    assert_file_absent "sessionEnd_staleForeignCounter_pruned" "$LOGS/.tool-count-ancient"
else
    echo "  SKIP: sessionEnd_staleForeignCounter_pruned (touch -d unsupported)"
fi

SB=$(new_sandbox)
LOGS="$SB/.claude/logs"
touch "$LOGS/.tool-count-evil"
touch "$SB/.tool-count-evil"
# session_id lands in a filename. `../../.tool-count-evil` sanitizes to
# `.tool-countevil` — every separator and dot dropped — so neither the intended
# escape nor the in-directory file of that name is what gets deleted. Asserting
# BOTH is the point: a sanitizer that merely stripped `..` would leave the
# escape working through the slashes.
run_hook "$SB" session-end-cleanup.sh '{"session_id":"../../.tool-count-evil","reason":"exit"}'
assert_eq "sessionEnd_traversalSessionId_exitsZero" 0 "$HOOK_EXIT"
assert_file_exists "sessionEnd_traversalSessionId_nothingDeletedOutsideLogDir" "$SB/.tool-count-evil"
assert_file_exists "sessionEnd_traversalSessionId_nothingDeletedInsideEither" "$LOGS/.tool-count-evil"

SB=$(new_sandbox)
run_hook "$SB" session-end-cleanup.sh "$EMPTY_INPUT"
assert_eq "sessionEnd_emptyJson_exitsZero" 0 "$HOOK_EXIT"
run_hook "$SB" session-end-cleanup.sh "$INVALID_JSON"
assert_eq "sessionEnd_invalidJson_exitsZero" 0 "$HOOK_EXIT"

SB=$(new_sandbox)
rm -rf "$SB/.claude/logs"
run_hook "$SB" session-end-cleanup.sh '{"session_id":"smoke1","reason":"exit"}'
assert_eq "sessionEnd_noLogDir_exitsZero" 0 "$HOOK_EXIT"
assert_file_absent "sessionEnd_noLogDir_doesNotCreateOne" "$SB/.claude/logs"

echo ""

# ── notify-phase-change.sh ──────────────────────────────────────────────────
# #T172 made the Windows branch terminal-only: no notify-send/osascript call,
# just the stderr line — that line IS the notification on that platform, so
# its whole contract is checked together here. The hook takes positional CLI
# args rather than a JSON stdin payload and touches no project state, so it
# runs directly against the repo's own hook rather than through
# run_hook/new_sandbox's copy-and-pipe machinery; the sandbox is used only to
# capture stdout/stderr. This is deliberately $PROJECT_ROOT, not $REAL_HOOKS:
# notify-phase-change.sh is not in HOOK_NAMES (tests/hook-smoke-negctl.sh), so
# a mutant dir never contains it, and pointing at $REAL_HOOKS would make this
# assertion fail against every mutant for a missing-file reason unrelated to
# whatever the mutant is sabotaging.
echo "notify-phase-change.sh:"

SB=$(new_sandbox)
bash "$PROJECT_ROOT/.claude/hooks/notify-phase-change.sh" review-requested some-feature \
    >"$SB/notify.out" 2>"$SB/notify.err"
NOTIFY_EXIT=$?
NOTIFY_OUT=$(cat "$SB/notify.out" 2>/dev/null || true)
NOTIFY_ERR=$(cat "$SB/notify.err" 2>/dev/null || true)

if [ "$NOTIFY_EXIT" -eq 0 ] \
    && printf '%s' "$NOTIFY_ERR" | grep -Eq '^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\] PROJECT-OS:' \
    && [ -z "$NOTIFY_OUT" ]; then
    ok "notifyPhaseChange_windowsTerminalOnly_exit0StderrLineNoStdout"
else
    nope "notifyPhaseChange_windowsTerminalOnly_exit0StderrLineNoStdout — exit=$NOTIFY_EXIT stdout=[$NOTIFY_OUT] stderr=[$NOTIFY_ERR]"
fi

echo ""

# ── Payload schema hygiene ──────────────────────────────────────────────────
# output-index.sh read `arguments` and `output` off the PostToolUse payload for
# its whole life. The runtime sends `tool_input` and `tool_response`, so every
# field it extracted was empty and the hook indexed nothing — and it PASSED the
# section above, because the fixtures were written from the same wrong schema
# as the hook. Behavioural assertions cannot catch that: fixture and subject
# agreed with each other and disagreed only with reality.
#
# So this is a static check, and it is deliberately not run against the sandbox
# or against $REAL_HOOKS. It lints the repo's own hooks and this file's own
# fixtures, which is where a reintroduced wrong key would live; pointing it at a
# mutant tree would let it pass vacuously.
echo "payload schema:"

# The regexes are spelled so they cannot match themselves: each needs a quote
# immediately against the key name, and these carry `(` in between.
STALE_FIXTURES=$(grep -nE '\\?"(arguments|output)\\?"[[:space:]]*:' \
    "$SCRIPT_DIR/hook-smoke.sh" 2>/dev/null || true)
assert_eq "payloadSchema_fixturesInThisFile_nameToolInputAndToolResponse" \
    "" "$STALE_FIXTURES"

STALE_HOOKS=$(grep -rnE '\.(arguments|output)\b|\\?"(arguments|output)\\?"[[:space:]]*:' \
    "$PROJECT_ROOT/.claude/hooks" 2>/dev/null || true)
assert_eq "payloadSchema_hookScripts_readToolInputAndToolResponse" \
    "" "$STALE_HOOKS"

echo ""

# ── Summary ─────────────────────────────────────────────────────────────────
echo "=== Results ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:"
    printf '%s\n' "$ERRORS"
    exit 1
fi

exit 0
