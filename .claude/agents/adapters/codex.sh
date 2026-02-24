#!/usr/bin/env bash
# codex.sh — OpenAI Codex agent adapter
# Implements the adapter interface for OpenAI Codex

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

cmd_execute() {
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

    # Read task description
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

    local task_desc
    task_desc="$(cat "$context_dir/task.md")"

    # Build conventions context
    local conventions=""
    if [ -f "$context_dir/conventions.md" ]; then
        conventions="$(cat "$context_dir/conventions.md")"
    fi

    # Build design context
    local design=""
    if [ -f "$context_dir/design.md" ]; then
        design="$(cat "$context_dir/design.md")"
    fi

    # Assemble prompt
    local prompt="You are an implementation agent. Your ONLY job is to complete this task:

${task_desc}

Conventions to follow:
${conventions}

Design context:
${design}

Instructions:
1. Write the implementation code
2. Write the tests specified in the task
3. Run the tests — they must pass
4. Do NOT modify any files not listed in this task
5. If you encounter an ambiguity, make the simplest choice and document it
6. When done, report: files created/modified, tests passed/failed, assumptions made"

    local task_id="${ADAPTER_TASK_ID:-unknown}"
    local max_turns="${ADAPTER_MAX_TURNS:-50}"
    local model="${ADAPTER_MODEL:-}"

    echo "codex adapter: executing task ${task_id}" >&2
    echo "  context_dir: ${context_dir}" >&2
    echo "  output_dir: ${output_dir}" >&2
    echo "  max_turns: ${max_turns}" >&2

    # Create temp file for prompt
    local prompt_file
    prompt_file="$(mktemp "$output_dir/prompt-XXXXXX.txt")"
    trap 'rm -f "$prompt_file"' EXIT

    echo "$prompt" > "$prompt_file"

    # Size guard: warn if prompt exceeds 102400 bytes
    local prompt_size
    prompt_size=$(wc -c < "$prompt_file")
    if [ "$prompt_size" -gt 102400 ]; then
        echo "WARNING: Prompt exceeds 102400 bytes (${prompt_size}). Codex may truncate." >&2
    fi

    # Pre-execution snapshot (tracked changes + untracked files)
    { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u > "$output_dir/pre-snapshot.txt" || true

    # Execute via codex CLI
    local codex_exit=0
    codex exec -s danger-full-access "$(cat "$prompt_file")" > "$output_dir/codex-output.txt" 2>&1 || codex_exit=$?

    # Post-execution snapshot (tracked changes + untracked files)
    { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u > "$output_dir/post-snapshot.txt" || true

    # Validate file scope
    if ! validate_file_scope "$context_dir" "$output_dir"; then
        echo "fail" > "$output_dir/result"
        local task_id="${ADAPTER_TASK_ID:-unknown}"
        cat > "$output_dir/completion-report.md" <<EOF
# Completion Report — Task ${task_id}

## Status
FAILED — unauthorized file changes detected.

## Details
See \`unauthorized-changes.txt\` for details. Unauthorized files have been reverted.
EOF
        exit 1
    fi

    # Determine success/failure
    if [ $codex_exit -eq 0 ]; then
        echo "pass" > "$output_dir/result"
        result_status="PASSED"
    else
        echo "fail" > "$output_dir/result"
        result_status="FAILED"
    fi

    # Create output artifacts
    mkdir -p "$output_dir/files"
    if [ -f "$output_dir/codex-output.txt" ]; then
        cp "$output_dir/codex-output.txt" "$output_dir/test-output.txt"
    fi

    # Generate completion report
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
