#!/bin/bash
# PreCompact hook: forward the session's drafted compact instruction to the
# compaction summarizer, and save a filesystem-derived checkpoint as a fallback.
#
# Receives JSON on stdin: {"session_id":..., "trigger":"auto"|"manual",
#                          "transcript_path":..., "custom_instructions":...}
#
# STDOUT CONTRACT — read this before changing any `printf` below.
# The runtime collects the stdout of every successful PreCompact hook into
# `newCustomInstructions` and merges it into the compaction's own custom
# instructions (after the user's, separated by a blank line). Whatever this
# script prints therefore becomes guidance for the summarizer. Two consequences:
#   1. Print plain text only. Do NOT print a JSON envelope — it would be
#      forwarded verbatim as instructions.
#   2. Print nothing when there is nothing useful to say. Empty output is
#      filtered out by the runtime; noise is not.
#
# This hook does NOT block. Blocking is possible (exit 2) but pointless here:
# on the auto path the block reason reaches only a debug log, never Claude, so
# it defers compaction without telling anyone why. The nudge that actually
# causes a handoff to be written lives in compact-suggest.sh (PostToolUse),
# which can inject `additionalContext` into Claude's context.
#
# Advisory hook — never surfaces errors to Claude Code.

set -euo pipefail
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$SCRIPT_DIR/_common.sh"

SESSIONS_DIR="$PROJECT_ROOT/.claude/sessions"
LOG_DIR="$PROJECT_ROOT/.claude/logs"
ROADMAP="$PROJECT_ROOT/ROADMAP.md"

# A handoff older than this is treated as describing earlier work, not the
# state being compacted away now.
HANDOFF_MAX_AGE_MIN="${PROJECT_OS_HANDOFF_MAX_AGE_MIN:-30}"

# Debounce for the checkpoint FILE WRITE only — never for the stdout
# contribution below, which must be emitted on every compaction.
CHECKPOINT_DEBOUNCE_MIN=10

# Escape a value for a double-quoted YAML scalar. Backslash goes first, so the
# escapes introduced after it are not themselves re-escaped.
#
# EVERY double-quoted scalar in the checkpoint built from data this hook did not
# author has to go through here. The checkpoint is one document: an unescaped
# character anywhere in it does not corrupt one field, it makes the whole file
# unparseable, and the next session loses the objective, the in-progress tasks
# and the handoff pointer along with the offending value. The path list learned
# that from an accented filename; the ROADMAP-derived values below are the same
# hazard from a source the reader controls even more directly — a task
# description reading `- [-] Fix the C:\path parser #T1` ends the scalar's
# escape sequence at `\p` and takes the document with it.
yaml_escape() {
    local v="$1"
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    v="${v//$'\t'/\\t}"
    v="${v//$'\n'/\\n}"
    printf '%s' "$v"
}

mkdir -p "$SESSIONS_DIR" "$LOG_DIR"

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(session_id_from_json "$INPUT")
TRANSCRIPT=$(json_string_field "$INPUT" transcript_path)

TIMESTAMP_FILE=$(date +%Y-%m-%d-%H%M)
TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CHECKPOINT_FILE="$SESSIONS_DIR/auto-checkpoint-$TIMESTAMP_FILE.yaml"

# ── Locate the freshest handoff ─────────────────────────────────────────────
# MUST run before the cycle marker is touched below. The freshness rule reads
# that marker's mtime, so resetting it first would make every handoff look
# older than the current cycle and nothing would ever be forwarded.
#
# Freshness is "written during the current compaction cycle": the marker is
# touched at each compaction, so -newer than it means "since the last
# compaction". That is the question actually being asked, and it needs no
# tuning — a slow session that took two hours between handoff and compaction
# still qualifies, and a handoff from before the last compaction never does.
# The age window is the fallback for the first compaction of a session, when
# no marker exists yet.
#
# Filenames are handoff-YYYY-MM-DD-HHMMSS-<token>.yaml, so lexical order is
# chronological and `sort | tail -1` is portable where find -printf is not. The
# token is a collision-resistant suffix, not an identifier this hook reads — it
# sits after the full timestamp precisely so it cannot perturb that ordering.
# Names written before the suffix existed (…-HHMM.yaml) still sort correctly
# against it — but only in byte order, so the sort is pinned to LC_ALL=C. A
# UTF-8 locale collates punctuation weakly, which would rank the legacy
# `…-1400.yaml` above `…-140030-42.yaml` written thirty seconds later.
# -type f rejects symlinks; resolve_project_path enforces containment before
# any read.
#
# Timestamps alone cannot tell two sessions apart, and a second session working
# in the same checkout writes into the same directory. compact-suggest.sh
# records the path of any handoff THIS session wrote, so that record is
# consulted first; the glob remains for handoffs written by other means. Both
# paths obey the same freshness rule — ownership does not license forwarding a
# handoff this session wrote before the previous compaction.
CYCLE_FILE="$LOG_DIR/.compact-cycle-$SESSION_ID"
OWNED_FILE="$LOG_DIR/.compact-handoff-$SESSION_ID"

# The record holds every handoff this session wrote, appended in order, so the
# last line that still exists and is fresh is the one to forward.
HANDOFF=""
if [ -f "$OWNED_FILE" ]; then
    while IFS= read -r OWNED; do
        [ -n "$OWNED" ] || continue
        [ -f "$OWNED" ] || continue
        if [ ! -f "$CYCLE_FILE" ] || [ "$OWNED" -nt "$CYCLE_FILE" ]; then
            HANDOFF="$OWNED"
        fi
    done < "$OWNED_FILE"
fi

if [ -z "$HANDOFF" ]; then
    if [ -f "$CYCLE_FILE" ]; then
        CANDIDATES=$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name 'handoff-*.yaml' -newer "$CYCLE_FILE" 2>/dev/null | LC_ALL=C sort || true)
    else
        CANDIDATES=$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name 'handoff-*.yaml' -mmin -"$HANDOFF_MAX_AGE_MIN" 2>/dev/null | LC_ALL=C sort || true)
    fi

    # Every session in this checkout writes its ownership record into the same
    # log directory, so a handoff another session claimed is identifiable even
    # from here. Skipping those makes the fallback safe in the case that
    # motivated ownership tracking; what remains unattributed is a handoff no
    # session claimed, which is the pre-existing behaviour.
    #
    # EVERY line of each foreign record counts, not just the newest: a session
    # that wrote two handoffs this cycle claims both, and reading only the last
    # would leave its earlier one looking unattributed and forwardable here.
    #
    # CLAIMED is newline-framed on both sides and matched with the newlines
    # included, so `/s/handoff-1.yaml` cannot be satisfied by a claim on
    # `/s/handoff-1.yaml` written under a longer directory prefix.
    CLAIMED=$'\n'
    for OWNERSHIP_RECORD in "$LOG_DIR"/.compact-handoff-*; do
        [ -f "$OWNERSHIP_RECORD" ] || continue
        case "$OWNERSHIP_RECORD" in
            */".compact-handoff-$SESSION_ID") continue ;;
        esac
        while IFS= read -r OTHER; do
            [ -n "$OTHER" ] || continue
            CLAIMED="$CLAIMED$OTHER"$'\n'
        done < "$OWNERSHIP_RECORD"
    done

    # Ascending order, so the last one accepted is the newest unclaimed handoff.
    while IFS= read -r CANDIDATE; do
        [ -n "$CANDIDATE" ] || continue
        case "$CLAIMED" in
            *$'\n'"$CANDIDATE"$'\n'*) continue ;;
        esac
        HANDOFF="$CANDIDATE"
    done <<< "$CANDIDATES"
fi
if [ -n "$HANDOFF" ]; then
    HANDOFF=$(resolve_project_path "$HANDOFF") || HANDOFF=""
fi

# ── Open the next compaction cycle ──────────────────────────────────────────
# Each cycle earns one nudge and accepts handoffs written after this point.
# The cycle marker is touched only here, never by compact-suggest.sh, so
# nothing can move the boundary mid-cycle.
touch "$CYCLE_FILE" 2>/dev/null || true
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    wc -c < "$TRANSCRIPT" > "$LOG_DIR/.compact-base-$SESSION_ID" 2>/dev/null || true
fi
rm -f "$LOG_DIR/.compact-nudged-$SESSION_ID"

# ── Extract its compact_instruction block scalar ────────────────────────────
# awk reads the file directly — no pipe from another command.
COMPACT_INSTRUCTION=""
if [ -n "$HANDOFF" ]; then
    COMPACT_INSTRUCTION=$(awk '
        /^compact_instruction:/ { grab = 1; next }
        grab && /^[^[:space:]]/ { grab = 0 }
        grab { sub(/^  /, ""); print }
    ' "$HANDOFF" 2>/dev/null || true)
fi

# Drop a placeholder that was never filled in.
case "$COMPACT_INSTRUCTION" in
    *"[A /compact instruction tuned"*) COMPACT_INSTRUCTION="" ;;
esac

# ── System map: observe, never heal ─────────────────────────────────────────
# `check` re-hashes working-tree inputs against .maps.lock and exits 3 on
# drift. It writes nothing without --heal, and healing here would be wrong:
# the map's source of authority is the git index, and mid-build drift is
# expected rather than actionable.
MAP_DRIFTED=0
if node_available "system map drift check" 2>/dev/null; then
    if ! (cd "$PROJECT_ROOT" && node scripts/system-map.ts check >/dev/null 2>&1); then
        MAP_DRIFTED=1
    fi
fi

# ── Checkpoint (debounced) ──────────────────────────────────────────────────
RECENT=$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name "auto-checkpoint-*.yaml" -mmin -"$CHECKPOINT_DEBOUNCE_MIN" 2>/dev/null | head -1 || true)

if [ -z "$RECENT" ]; then
    # Phase from ROADMAP markers: [-] means build, [~] means review.
    # ROADMAP tasks are markdown list items — "- [-] Task #T1" — so the marker
    # is never at the start of the line. Patterns that anchored [-] to
    # line-start-plus-whitespace matched nothing, and every checkpoint recorded
    # phase "ad-hoc" / feature "none" regardless of what was in flight.
    HAS_BUILD=$(grep -cE '^[[:space:]]*([-*][[:space:]]+)?\[-\]' "$ROADMAP" 2>/dev/null || true)
    HAS_REVIEW=$(grep -cE '^[[:space:]]*([-*][[:space:]]+)?\[~\]' "$ROADMAP" 2>/dev/null || true)
    HAS_BUILD="${HAS_BUILD:-0}"
    HAS_REVIEW="${HAS_REVIEW:-0}"

    if [ "$HAS_BUILD" -gt 0 ]; then
        PHASE="build"
    elif [ "$HAS_REVIEW" -gt 0 ]; then
        PHASE="review"
    else
        PHASE="ad-hoc"
    fi

    # The feature owning the first in-progress task. An earlier version tracked
    # a per-section `found_task` flag and printed it at the next heading, which
    # reset the flag every time a new `## Feature:` heading appeared — so an
    # in-progress task in an early section was forgotten as soon as a later
    # section without one was read, and FEATURE came out "none". Printing at the
    # first marker instead removes the state that could be lost.
    FEATURE=$(awk '
        /^## Feature:/ { current = substr($0, index($0, ":") + 2); next }
        /^[[:space:]]*([-*][[:space:]]+)?\[[-~]\]/ {
            if (current != "") { print current; exit }
        }
    ' "$ROADMAP" 2>/dev/null | head -1 || true)
    FEATURE="${FEATURE#"${FEATURE%%[![:space:]]*}"}"
    FEATURE="${FEATURE%"${FEATURE##*[![:space:]]}"}"
    [ -z "$FEATURE" ] && FEATURE="none"

    IN_PROGRESS_RAW=$(awk '
        /^[[:space:]]*([-*][[:space:]]+)?\[-\]/ {
            line = $0
            sub(/^[[:space:]]*([-*][[:space:]]+)?\[-\][[:space:]]*/, "", line)
            sub(/[[:space:]]+#T[0-9]+.*$/, "", line)
            if (length(line) > 0) print line
        }
    ' "$ROADMAP" 2>/dev/null || true)

    # git status --porcelain, not git diff --name-only: the latter reports
    # neither staged nor untracked files, so a session that staged all its work
    # recorded an empty modified_files exactly when it had most to lose.
    #
    # --untracked-files=all because the default collapses a wholly untracked
    # directory to a single `?? dir/` entry. A session that built a new feature
    # under a new directory is precisely the one with the most to preserve, and
    # it would have handed the next session a directory name instead of the
    # files it just wrote. Ignored paths stay excluded either way, so this
    # expands what is already reported rather than widening the set.
    #
    # -z, and read through process substitution rather than a variable. Without
    # -z, git applies C-style quoting to any path outside plain ASCII: under the
    # default core.quotePath, `café.txt` is reported as `"caf\303\251.txt"`.
    # Stripping the surrounding quotes — all the previous version did — left the
    # octal escapes in place, and `\3` is not a legal escape inside a
    # double-quoted YAML scalar, so the checkpoint failed to parse *as a whole*.
    # One accented filename cost the session every other field in the file:
    # objective, in-progress tasks, handoff pointer. Untracked paths are the
    # ones most likely to be freshly created with a human-typed name, so the
    # expansion above walked straight into it.
    #
    # core.quotePath=false was not enough: it un-quotes non-ASCII only, and
    # leaves `"`, `\`, newline and tab quoted and escaped. -z disables quoting
    # entirely and emits paths as raw bytes. It cannot be captured with $( ),
    # which drops NUL bytes, hence the process substitution.

    IN_PROGRESS_YAML=""
    TASK_LIST=""
    if [ -n "$IN_PROGRESS_RAW" ]; then
        while IFS= read -r task_desc; do
            [ -z "$task_desc" ] && continue
            SAFE_DESC=$(yaml_escape "$task_desc")
            IN_PROGRESS_YAML="${IN_PROGRESS_YAML}    - description: \"${SAFE_DESC}\"
      files: \"\"
      state: \"in-progress at compaction time\"
"
            if [ -n "$TASK_LIST" ]; then
                TASK_LIST="${TASK_LIST}; ${task_desc}"
            else
                TASK_LIST="$task_desc"
            fi
        done <<< "$IN_PROGRESS_RAW"
    fi

    if [ -z "$IN_PROGRESS_YAML" ]; then
        IN_PROGRESS_YAML="    - description: \"(none)\"
      files: \"\"
      state: \"in-progress at compaction time\"
"
        TASK_LIST="(none)"
    fi

    MODIFIED_FILES_YAML=""
    while IFS= read -r -d '' entry; do
        [ -z "$entry" ] && continue
        st="${entry:0:2}"
        fpath="${entry:3}"
        # Under -z a rename or copy is two records — `XY <new>\0<old>\0` — not
        # one `old -> new` string. The destination arrives first, which is the
        # one worth recording, so the origin is read and dropped. Leaving it
        # unread would have made the *previous* filename the next entry, with
        # its status bytes taken from whatever the path happened to start with.
        case "$st" in
            R*|C*|?R|?C) IFS= read -r -d '' _origpath || true ;;
        esac
        [ -z "$fpath" ] && continue
        case "$st" in
            "??"*) ctype="created" ;;
            *D*)   ctype="deleted" ;;
            A*)    ctype="created" ;;
            *)     ctype="modified" ;;
        esac
        # -z hands back raw bytes, which is the point — but raw bytes include
        # the four characters a double-quoted scalar reserves.
        SAFE_PATH=$(yaml_escape "$fpath")
        MODIFIED_FILES_YAML="${MODIFIED_FILES_YAML}  - path: \"${SAFE_PATH}\"
    change_type: ${ctype}
    summary: \"uncommitted change (git status ${st})\"
"
    done < <(git -C "$PROJECT_ROOT" status --porcelain -z --untracked-files=all 2>/dev/null || true)

    if [ -n "$COMPACT_INSTRUCTION" ]; then
        HANDOFF_NOTE="Rich handoff available at ${HANDOFF#"$PROJECT_ROOT/"}"
    else
        HANDOFF_NOTE="No fresh handoff was written before this compaction; decisions and rationale from this session were not captured."
    fi

    {
        printf 'timestamp: "%s"\n' "$TIMESTAMP_ISO"
        printf 'phase: "%s"\n' "$PHASE"
        printf 'feature: "%s"\n' "$(yaml_escape "$FEATURE")"
        printf '\n'
        printf 'objective: |\n'
        printf '  Auto-checkpoint before context compaction\n'
        printf '\n'
        printf 'progress:\n'
        printf '  completed: []\n'
        printf '  in_progress:\n'
        printf '%s' "$IN_PROGRESS_YAML"
        printf '\n'
        printf 'decisions: []\n'
        printf '\n'
        printf 'modified_files:\n'
        if [ -n "$MODIFIED_FILES_YAML" ]; then
            printf '%s' "$MODIFIED_FILES_YAML"
        else
            printf '  []\n'
        fi
        printf '\n'
        printf 'blockers: []\n'
        printf '\n'
        printf 'next_steps:\n'
        printf '  - priority: 1\n'
        printf '    action: "Resume with /tools:catchup"\n'
        printf '    context: "Auto-checkpoint captured before compaction"\n'
        printf '\n'
        printf 'context_notes: |\n'
        printf '  This checkpoint was auto-generated by the PreCompact hook.\n'
        printf '  %s\n' "$HANDOFF_NOTE"
        if [ "$MAP_DRIFTED" -eq 1 ]; then
            printf '  System map drifted at compaction time — it describes committed state.\n'
        fi
        printf '\n'
        # Literal block scalar, so FEATURE and TASK_LIST go in RAW — do not
        # route these through yaml_escape. A block scalar takes its content
        # verbatim; escaping would put a literal backslash into the summarizer's
        # instructions. Only the indentation matters, and both values are built
        # from `read -r` lines, so neither can contain a newline to break it.
        printf 'compact_instruction: |\n'
        printf '  Working on %s. In-progress tasks: %s.\n' "$FEATURE" "$TASK_LIST"
    } > "$CHECKPOINT_FILE"
fi

# ── Contribute to the compaction instructions ───────────────────────────────
# Plain text only. Silence when there is nothing worth saying.
if [ -n "$COMPACT_INSTRUCTION" ]; then
    printf '%s\n' "$COMPACT_INSTRUCTION"
    printf '\n'
    printf 'Session state for this work is saved at %s — read it with /tools:catchup before resuming.\n' "${HANDOFF#"$PROJECT_ROOT/"}"
    if [ "$MAP_DRIFTED" -eq 1 ]; then
        printf 'The system map at docs/maps/ is drifted: it describes committed state, not the working tree. Re-read hook and command wiring from source before trusting it.\n'
    fi
elif [ "$MAP_DRIFTED" -eq 1 ]; then
    printf 'The system map at docs/maps/ is drifted: it describes committed state, not the working tree. Re-read hook and command wiring from source before trusting it.\n'
fi

exit 0
