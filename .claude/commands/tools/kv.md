---
description: "Quick key-value memory — save or recall facts without ceremony"
---

# KV Memory Tool

- `/tools:kv set [key] [value]` — Save a fact
- `/tools:kv get [key]` — Recall a fact
- `/tools:kv list` — Show all keys
- `/tools:kv search [query]` — Find entries

## Storage

File: `docs/knowledge/kv.md`

Format per entry:
```
## [key]
**Set**: [date]
**Value**: [value]
```

For `set`: Append or update. For `get`: Find key header, return value.
For `list`: Return all headers. For `search`: Grep and return matches.
