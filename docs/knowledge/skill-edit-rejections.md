---
type: knowledge
tags: [skill-edits, rejections]
description: Ledger of rejected skill-edit proposals and why, fed back into reflection as negative feedback
links: "[[decisions]]"
date: "2026-07-22"
---

# Skill-Edit Rejection Ledger

This ledger records skill-edit proposals a human rejected, along with the reason for rejection. `/tools:reflect` loads this ledger as negative feedback so it does not re-propose edits already ruled out — the load is scoped to all entries targeting files in the current reflection scope plus the 10 most recent entries overall, never the whole file.

## Entry Format

Each rejection is one entry, in this exact format:

```
## <date> — <fingerprint>
- **Proposed**: <summary> (feature: <feature>, draft #<task>)
- **Rejected because**: <reason>
```

**Written only by `scripts/skill-ledger.ts`** — never hand-edit entries. Hand-edits can break the fingerprint-in-heading grep contract that dedup and reflection loading rely on.

## Hardening (owner opt-in)

Downstream projects that never legitimately edit instruction files can add `permissions.deny` entries for Edit/Write on `.claude/rules/**`, `.claude/skills/**`, `.claude/commands/**` — `scripts/skill-apply.ts` remains the sanctioned apply path. This is not the default: the framework repo edits instruction files as its normal work.

---

<!-- entries below — machine-written by scripts/skill-ledger.ts -->
