#!/usr/bin/env bash
# amp.sh — Amp (Sourcegraph) agent adapter (stub)
# Implements the adapter interface. Not yet functional — stub only in v2.

set -euo pipefail

cmd_info() {
    cat <<'EOF'
{
  "name": "amp",
  "display_name": "Amp (Sourcegraph)",
  "version": "0.1-stub",
  "supports_isolation": false,
  "supports_streaming": true,
  "model_default": "sonnet"
}
EOF
}

cmd_health() {
    if command -v amp &>/dev/null; then
        echo "amp: CLI found but adapter not yet implemented (stub)" >&2
        exit 1
    else
        echo "amp: 'amp' CLI not found in PATH" >&2
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
# Completion Report — Amp Adapter (Stub)

## Status
NOT IMPLEMENTED — This is a stub adapter for v2.

The Amp adapter will be implemented in v2.1+ to support:
- `amp` CLI dispatch
- Thread-based isolation
- Result collection and test verification

For now, tasks annotated with `(agent: amp)` will fall back to claude-code.
EOF
    echo "amp adapter: NOT IMPLEMENTED (stub). Use claude-code instead." >&2
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
