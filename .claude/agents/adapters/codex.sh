#!/usr/bin/env bash
# codex.sh — OpenAI Codex agent adapter
# Implements the adapter interface for OpenAI Codex

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared prompt template
source "$(dirname "${BASH_SOURCE[0]}")/_prompt-template.sh"

cmd_info() {
    cat <<'EOF'
{
  "name": "codex",
  "display_name": "OpenAI Codex",
  "version": "1.0",
  "supports_isolation": false,
  "supports_streaming": false,
  "model_default": "o4-mini",
  "supports_model_routing": false
}
EOF
}

cmd_health() {
    if ! command -v codex &>/dev/null; then
        echo "ERROR: codex CLI not found in PATH" >&2
        exit 1
    fi

    if ! codex --version &>/dev/null; then
        echo "ERROR: codex CLI is unresponsive" >&2
        exit 1
    fi

    local version
    version=$(codex --version 2>&1)
    echo "codex: available (${version})" >&2
    exit 0
}

validate_file_scope() {
    local context_dir="$1"
    local output_dir="$2"

    # Extract allowed files from task.md (lines under ## Files section)
    local allowed_files
    allowed_files=$(sed -n '/^## Files$/,/^##/p' "$context_dir/task.md" | sed '1d;$d' | sed 's/^[[:space:]]*-[[:space:]]*//' | sed 's/[[:space:]]*$//' | grep -v '^$' | sort -u)

    # Get pre and post snapshots
    local pre_snapshot post_snapshot changes
    pre_snapshot=$(sort "$output_dir/pre-snapshot.txt" 2>/dev/null || echo "")
    post_snapshot=$(sort "$output_dir/post-snapshot.txt" 2>/dev/null || echo "")

    # Find new changes: files in post but not in pre
    changes=$(comm -13 <(echo "$pre_snapshot") <(echo "$post_snapshot") 2>/dev/null || echo "")

    if [ -z "$changes" ]; then
        return 0
    fi

    local unauthorized=""
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! echo "$allowed_files" | grep -Fx "$file" >/dev/null 2>&1; then
            unauthorized="$unauthorized$file"$'\n'
        fi
    done <<< "$changes"

    if [ -n "$unauthorized" ]; then
        {
            echo "ERROR: Unauthorized file changes detected:"
            echo "$unauthorized"
        } >&2
        echo "$unauthorized" > "$output_dir/unauthorized-changes.txt"

        # Revert unauthorized files (tracked: checkout, untracked: rm)
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            if git ls-files --error-unmatch "$file" &>/dev/null; then
                git checkout HEAD -- "$file" 2>/dev/null && echo "Reverted: $file" >&2
            else
                rm -f "$file" 2>/dev/null && echo "Removed untracked: $file" >&2
            fi
        done <<< "$unauthorized"

        return 1
    fi

    return 0
}

validate_paths() {
    local context_dir="$1"
    local output_dir="$2"

    # Reject path traversal
    if [[ "$output_dir" =~ \.\. ]]; then
        echo "ERROR: output_dir must not contain '..': $output_dir" >&2
        exit 1
    fi
    if [[ "$context_dir" =~ \.\. ]]; then
        echo "ERROR: context_dir must not contain '..': $context_dir" >&2
        exit 1
    fi

    if [ ! -d "$context_dir" ]; then
        echo "ERROR: context_dir not found: $context_dir" >&2
        exit 1
    fi

    mkdir -p "$output_dir"
}

load_task_description() {
    local context_dir="$1"
    local output_dir="$2"

    if [ ! -f "$context_dir/task.md" ]; then
        echo "ERROR: task.md not found in context_dir" >&2
        echo "fail" > "$output_dir/result"
        local task_id="${ADAPTER_TASK_ID:-unknown}"
        cat > "$output_dir/completion-report.md" <<EREOF
# Completion Report — Task ${task_id}

## Status
FAILED — task.md not found in context directory.

## Error
Missing required file: ${context_dir}/task.md
EREOF
        exit 1
    fi

    cat "$context_dir/task.md"
}

build_context() {
    local context_dir="$1"
    local file_name="$2"

    if [ -f "$context_dir/$file_name" ]; then
        cat "$context_dir/$file_name"
    else
        echo ""
    fi
}

create_prompt_file() {
    local output_dir="$1"
    local prompt="$2"

    local prompt_file
    prompt_file="$(mktemp "$output_dir/prompt-XXXXXX.txt")"
    echo "$prompt" > "$prompt_file"
    echo "$prompt_file"
}

check_prompt_size() {
    local prompt_file="$1"

    local prompt_size
    prompt_size=$(wc -c < "$prompt_file")
    if [ "$prompt_size" -gt 102400 ]; then
        echo "WARNING: Prompt exceeds 102400 bytes (${prompt_size}). Codex may truncate." >&2
    fi
}

create_pre_snapshot() {
    local output_dir="$1"

    { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u > "$output_dir/pre-snapshot.txt" || true
}

create_post_snapshot() {
    local output_dir="$1"

    { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u > "$output_dir/post-snapshot.txt" || true
}

execute_codex() {
    local output_dir="$1"
    local prompt_file="$2"

    local codex_exit=0
    codex exec -s danger-full-access "$(cat "$prompt_file")" > "$output_dir/codex-output.txt" 2>&1 || codex_exit=$?
    echo "$codex_exit"
}

generate_completion_report() {
    local output_dir="$1"
    local task_id="$2"
    local result_status="$3"
    local model="$4"

    mkdir -p "$output_dir/files"
    if [ -f "$output_dir/codex-output.txt" ]; then
        cp "$output_dir/codex-output.txt" "$output_dir/test-output.txt"
    fi

    cat > "$output_dir/completion-report.md" <<EOF
# Completion Report — Task ${task_id}

## Status
${result_status}

## Execution Method
OpenAI Codex via \`codex exec -s danger-full-access\`

## Model
${model:-o4-mini (default)}

## Output
See \`codex-output.txt\` for full execution output.
EOF
}

cmd_execute() {
    local context_dir="$1"
    local output_dir="$2"

    # Phase 1: Validation
    validate_paths "$context_dir" "$output_dir"

    # Phase 2: Load task and context
    local task_desc
    task_desc=$(load_task_description "$context_dir" "$output_dir")

    local conventions
    conventions=$(build_context "$context_dir" "conventions.md")

    local design
    design=$(build_context "$context_dir" "design.md")

    # Phase 3: Build prompt
    local prompt
    prompt=$(build_prompt "$task_desc" "$conventions" "$design")

    local task_id="${ADAPTER_TASK_ID:-unknown}"
    local max_turns="${ADAPTER_MAX_TURNS:-50}"
    local model="${ADAPTER_MODEL:-}"

    echo "codex adapter: executing task ${task_id}" >&2
    echo "  context_dir: ${context_dir}" >&2
    echo "  output_dir: ${output_dir}" >&2
    echo "  max_turns: ${max_turns}" >&2

    # Phase 4: Prepare prompt file
    local prompt_file
    prompt_file=$(create_prompt_file "$output_dir" "$prompt")
    trap 'rm -f "$prompt_file"' EXIT

    check_prompt_size "$prompt_file"

    # Phase 5: Create pre-snapshot
    create_pre_snapshot "$output_dir"

    # Phase 6: Execute codex
    local codex_exit
    codex_exit=$(execute_codex "$output_dir" "$prompt_file")

    # Phase 7: Create post-snapshot
    create_post_snapshot "$output_dir"

    # Phase 8: Validate file scope
    if ! validate_file_scope "$context_dir" "$output_dir"; then
        echo "fail" > "$output_dir/result"
        cat > "$output_dir/completion-report.md" <<EOF
# Completion Report — Task ${task_id}

## Status
FAILED — unauthorized file changes detected.

## Details
See \`unauthorized-changes.txt\` for details. Unauthorized files have been reverted.
EOF
        exit 1
    fi

    # Phase 9: Determine result status
    local result_status
    if [ "$codex_exit" -eq 0 ]; then
        echo "pass" > "$output_dir/result"
        result_status="PASSED"
    else
        echo "fail" > "$output_dir/result"
        result_status="FAILED"
    fi

    # Phase 10: Generate completion report
    generate_completion_report "$output_dir" "$task_id" "$result_status" "$model"

    echo "codex adapter: task ${task_id} completed with status: ${result_status}" >&2
}

# --- Main dispatch ---
case "${1:-}" in
    info)    cmd_info ;;
    health)  cmd_health ;;
    execute)
        if [ $# -lt 3 ]; then
            echo "Usage: $0 execute <context_dir> <output_dir>" >&2
            exit 1
        fi
        cmd_execute "$2" "$3"
        ;;
    *)
        echo "Usage: $0 {info|health|execute <context_dir> <output_dir>}" >&2
        exit 1
        ;;
esac
