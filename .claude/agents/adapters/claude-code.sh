#!/usr/bin/env bash
# claude-code.sh — Claude Code agent adapter
# Implements the adapter interface for Claude Code (native, default adapter)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared prompt template
source "$(dirname "${BASH_SOURCE[0]}")/_prompt-template.sh"

cmd_info() {
    cat <<'EOF'
{
  "name": "claude-code",
  "display_name": "Claude Code",
  "version": "1.0",
  "supports_isolation": true,
  "supports_streaming": false,
  "model_default": "haiku",
  "supports_model_routing": true
}
EOF
}

cmd_health() {
    # Claude Code adapter works via the Task tool (orchestrator dispatch), not the CLI directly.
    # Health is always OK when running inside Claude Code — the CLI check is informational only.
    if command -v claude &>/dev/null; then
        echo "claude-code: available (CLI in PATH)" >&2
    else
        echo "claude-code: available (Task tool dispatch — CLI not required in PATH)" >&2
    fi
    exit 0
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

    # Assemble prompt using shared template
    local prompt
    prompt=$(build_prompt "$task_desc" "$conventions" "$design")

    local task_id="${ADAPTER_TASK_ID:-unknown}"
    local max_turns="${ADAPTER_MAX_TURNS:-50}"
    local model="${ADAPTER_MODEL:-}"
    model="${model:-haiku}"

    # Claude Code native execution — uses Task tool with isolation: worktree
    # In practice, the build orchestrator dispatches via the Task tool directly.
    # This script serves as the adapter contract implementation for CLI-based dispatch.

    echo "claude-code adapter: executing task ${task_id}" >&2
    echo "  context_dir: ${context_dir}" >&2
    echo "  output_dir: ${output_dir}" >&2
    echo "  max_turns: ${max_turns}" >&2
    echo "  model: ${model}" >&2

    # Write the prompt for the orchestrator to use
    echo "$prompt" > "$output_dir/prompt.md"

    # The orchestrator reads prompt.md and dispatches via Task tool.
    # This adapter doesn't invoke claude directly — the orchestrator does.
    # Mark as ready for dispatch.
    echo "pass" > "$output_dir/result"

    # Create output artifacts per INTERFACE.md contract
    mkdir -p "$output_dir/files"
    echo "# Test output will be populated by orchestrator after dispatch" > "$output_dir/test-output.txt"

    cat > "$output_dir/completion-report.md" <<EOF
# Completion Report — Task ${task_id}

## Status
Adapter prepared prompt for orchestrator dispatch.

## Dispatch Method
Claude Code Task tool with \`isolation: worktree\`

## Model
${model}
EOF

    echo "claude-code adapter: prompt ready at ${output_dir}/prompt.md" >&2
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
