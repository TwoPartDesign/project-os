#!/usr/bin/env bash
# _prompt-template.sh — Shared prompt template for agent adapters
# Sourced by codex.sh and claude-code.sh

build_prompt() {
    local task_desc="$1"
    local conventions="$2"
    local design="$3"

    cat <<EOF
You are an implementation agent. Your ONLY job is to complete this task:

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
6. When done, report: files created/modified, tests passed/failed, assumptions made
EOF
}
