#!/usr/bin/env bash
# codex.sh — OpenAI Codex agent adapter (stub)
# Implements the adapter interface. Not yet functional — stub only in v2.

set -euo pipefail

cmd_info() {
    cat <<'EOF'
{
  "name": "codex",
  "display_name": "OpenAI Codex",
  "version": "0.1-stub",
  "supports_isolation": true,
  "supports_streaming": false,
  "model_default": "o4-mini"
}
EOF
}

cmd_health() {
    if command -v codex &>/dev/null; then
        echo "codex: CLI found but adapter not yet implemented (stub)" >&2
        exit 1
    else
        echo "codex: 'codex' CLI not found in PATH" >&2
        exit 1
    fi
}

cmd_execute() {
    local output_dir="$2"
    if [[ "$output_dir" =~ \.\. ]]; then
        echo "ERROR: output_dir must not contain '..': $output_dir" >&2
        exit 1
    fi
    mkdir -p "$output_dir"
    echo "fail" > "$output_dir/result"
    cat > "$output_dir/completion-report.md" <<'EOF'
# Completion Report — Codex Adapter (Stub)

## Status
NOT IMPLEMENTED — This is a stub adapter for v2.

The Codex adapter will be implemented in v2.1+ to support:
- `codex exec` CLI dispatch
- Worktree isolation via git worktrees
- Result collection and test verification

For now, tasks annotated with `(agent: codex)` will fall back to claude-code.
EOF
    echo "codex adapter: NOT IMPLEMENTED (stub). Use claude-code instead." >&2
    exit 1
}

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
