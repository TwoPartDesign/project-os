---
name: spec-driven-dev
description: Enforces spec-first development — before writing any code, verifies a brief, design, and approved tasks exist in docs/specs/ and routes to the right workflow phase. Use whenever the user asks to implement, build, or add a feature, except trivially small single-file changes.
---

# Spec-Driven Development Router

**Trigger**: User asks to implement, build, or add a feature.

This skill detects the current lifecycle phase and routes to the matching `/workflows:*` command. Phase internals (what each command does) live in `.claude/commands/workflows/*.md` — do not restate or improvise them.

## Phase Detection & Routing

Before writing ANY code, check `docs/specs/[feature-name]/` for artifacts and route:

| Artifacts present | Prerequisite check | Route to |
|---|---|---|
| Nothing | — | `/workflows:idea` |
| `brief.md` only | — | `/workflows:design` |
| `design.md` exists, Status not APPROVED | — | resume `/workflows:design` |
| `design.md` APPROVED, no `tasks.md` | — | `/workflows:plan` |
| `brief.md` + `design.md` (APPROVED) + `tasks.md` | No `[?]` (draft) tasks remain in ROADMAP.md for this feature — if drafts exist, run `/pm:approve` first | `/workflows:build` |

NEVER skip this check. If the user says "just build it", explain:
> "I work best with a spec — it takes 5 minutes and prevents hours of rework. Let me run `/workflows:idea` to capture what you need, then we'll build it right."

## Exception
For trivially small changes (< 20 lines, single file, no new patterns), skip the full pipeline. Instead: describe the change, get user confirmation, implement, test, commit.
