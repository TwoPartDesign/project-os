#!/bin/bash
# Scrub known secret patterns from a file in-place.
# Usage: bash scripts/scrub-secrets.sh <filepath>
# Prints count of secrets redacted to stderr.

set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "Usage: scrub-secrets.sh <filepath>" >&2
    exit 1
fi

COUNT=0

scrub() {
    local pattern="$1"
    local label="$2"
    local before
    before=$(grep -cE "$pattern" "$FILE" 2>/dev/null || true)
    if [ "$before" -gt 0 ]; then
        sed -i -E "s|$pattern|[$label]|g" "$FILE"
        COUNT=$((COUNT + before))
    fi
}

# OpenAI keys — project keys first (contain hyphens not matched by generic pattern)
scrub 'sk-proj-[a-zA-Z0-9_-]{20,}' 'REDACTED:OPENAI_PROJECT_KEY'
scrub 'sk-[a-zA-Z0-9]{20,}' 'REDACTED:OPENAI_KEY'

# Codex CLI uses standard OpenAI keys (sk- and sk-proj- prefixes)
# No additional patterns needed — already covered above

# Google AI / Gemini API keys
scrub 'AIza[a-zA-Z0-9_-]{35}' 'REDACTED:GOOGLE_AI_KEY'

# Anthropic keys
scrub 'sk-ant-[a-zA-Z0-9_-]{20,}' 'REDACTED:ANTHROPIC_KEY'

# GitHub tokens (all current token families)
scrub 'ghp_[a-zA-Z0-9]{36,}' 'REDACTED:GITHUB_TOKEN'
scrub 'gho_[a-zA-Z0-9]{36,}' 'REDACTED:GITHUB_OAUTH'
scrub 'ghu_[a-zA-Z0-9]{36,}' 'REDACTED:GITHUB_USER'
scrub 'ghs_[a-zA-Z0-9]{36,}' 'REDACTED:GITHUB_SERVER'
scrub 'ghr_[a-zA-Z0-9]{36,}' 'REDACTED:GITHUB_REFRESH'
scrub 'github_pat_[a-zA-Z0-9_]{20,}' 'REDACTED:GITHUB_PAT'

# AWS access keys (long-term and temporary STS keys)
scrub 'AKIA[A-Z0-9]{16}' 'REDACTED:AWS_KEY'
scrub 'ASIA[A-Z0-9]{16}' 'REDACTED:AWS_TEMP_KEY'

# Stripe keys
scrub 'sk_live_[a-zA-Z0-9]{24,}' 'REDACTED:STRIPE_KEY'
scrub 'rk_live_[a-zA-Z0-9]{24,}' 'REDACTED:STRIPE_RESTRICTED'

# Perplexity
scrub 'pplx-[a-zA-Z0-9]{48,}' 'REDACTED:PERPLEXITY_KEY'

# JWTs (header.payload.signature)
scrub 'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+' 'REDACTED:JWT'

# Bearer tokens (case-insensitive, min 20 chars after Bearer)
scrub 'Bearer [a-zA-Z0-9_-]{20,}' 'Bearer REDACTED:BEARER_TOKEN'
scrub 'bearer [a-zA-Z0-9_-]{20,}' 'bearer REDACTED:BEARER_TOKEN'

if [ "$COUNT" -gt 0 ]; then
    echo "scrub-secrets: redacted $COUNT secret(s) from $FILE" >&2
fi

exit 0
