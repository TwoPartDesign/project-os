#!/usr/bin/env bash
# gemini.sh — Google Gemini CLI agent adapter (stub)
# Implements the adapter interface. Not yet functional — stub only in v2.

set -euo pipefail

cmd_info() {
    cat <<'EOF'
{
  "name": "gemini",
  "display_name": "Gemini CLI",
  "version": "0.1-stub",
  "supports_isolation": true,
  "supports_streaming": false,
  "model_default": "gemini-2.5-pro"
}
EOF
}

cmd_health() {
    if command -v gemini &>/dev/null; then
        echo "gemini: CLI found but adapter not yet implemented (stub)" >&2
        exit 1
    else
        echo "gemini: 'gemini' CLI not found in PATH" >&2
        exit 1
    fi
}

cmd_execute() {
    local output_dir="$2"
    mkdir -p "$output_dir"
    echo "fail" > "$output_dir/result"
    cat > "$output_dir/completion-report.md" <<'EOF'
# Completion Report — Gemini Adapter (Stub)

## Status
NOT IMPLEMENTED — This is a stub adapter for v2.

The Gemini adapter will be implemented in v2.1+ to support:
- `gemini` CLI dispatch
- Worktree isolation
- Result collection and test verification

For now, tasks annotated with `(agent: gemini)` will fall back to claude-code.
EOF
    echo "gemini adapter: NOT IMPLEMENTED (stub). Use claude-code instead." >&2
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
