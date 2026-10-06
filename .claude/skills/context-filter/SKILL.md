---
name: context-filter
description: Searches indexed project knowledge with freshness scoring and interprets freshness labels. Use when asked to check whether knowledge is stale or fresh, or to search the vault for prior decisions, patterns, bugs, or code.
---

# Freshness-Scored Knowledge Search

**Trigger**: Knowledge search, freshness checks.

Large tool output is handled natively: Claude Code spills oversized output to a
file and truncates Bash output at `bashOutputMaxChars` (2.1.261). There is no
manual routing step; read the spilled file with offset/limit when you need more.

## Protocol

### Search indexed knowledge:
```bash
node scripts/knowledge-index.ts search "auth flow" --fresh
node scripts/knowledge-index.ts search "error handling" --type code
```

The `output-index.sh` hook indexes large tool output as it lands, so a search
also finds output from earlier in the session.

## Freshness Interpretation
- **high** (has `date:` frontmatter or git-dated): trust content recency
- **medium** (file mtime with git context): likely accurate but verify for fast-moving areas
- **low** (mtime only): cross-reference before relying on
- **[STALE]** (>90 days unvalidated): explicitly flag when citing

## When to Use
- Searching knowledge vault for decisions, patterns, or prior art
- Checking whether a cited document is stale before relying on it

## When NOT to Use
- When you need the EXACT content (diffs, code you're editing): Read the file
