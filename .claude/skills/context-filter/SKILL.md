# Context-Aware Output Filtering

**Trigger**: Large output processing, knowledge search, freshness checks.

## Protocol

When you encounter or expect large output (>5KB), route through the filter
INSTEAD of reading directly:

### Instead of reading large files:
```bash
# DON'T: cat large-log.txt  (floods context)
# DO:
scripts/context-filter.sh --file large-log.txt --intent "errors"
```

### Instead of running commands with large output:
```bash
# DON'T: npm test 2>&1  (dumps full test output)
# DO: capture to file, then filter
npm test > /tmp/test-output.txt 2>&1
scripts/context-filter.sh --file /tmp/test-output.txt --intent "failures"
```

### Search indexed knowledge:
```bash
node scripts/knowledge-index.ts search "auth flow" --fresh
node scripts/knowledge-index.ts search "error handling" --type code
```

## Freshness Interpretation
- **high** (has `date:` frontmatter or git-dated): trust content recency
- **medium** (file mtime with git context): likely accurate but verify for fast-moving areas
- **low** (mtime only): cross-reference before relying on
- **[STALE]** (>90 days unvalidated): explicitly flag when citing

## When to Use
- Reading files you know are large (logs, test output, build output, configs)
- Running commands that produce verbose output (git log, npm test, find)
- Searching knowledge vault for decisions, patterns, or prior art

## When NOT to Use
- Reading small files (<5KB) — direct Read is fine
- Running simple commands with short output (git status, ls)
- When you need the EXACT content (diffs, code you're editing)

## Sub-Agent Guidance
Sub-agents should use context-filter.sh for any tool output >5KB.
Include `--intent` matching the task description for best results.
