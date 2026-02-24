---
type: knowledge
tags: [patterns, conventions]
description: Established code patterns and conventions discovered during development
links: "[[decisions]], [[architecture]]"
---

# Established Patterns

## Format
Each entry: Pattern Name, When to Use, Example, Anti-pattern to Avoid

---

<!-- Entries get appended here as patterns are discovered during build and review -->

### ROADMAP↔Tasks Dual-Track

**When to Use**: During `/workflows:build` when orchestrating parallel sub-agents.

**Pattern**: ROADMAP.md is the authoritative, git-versioned source of truth for task state. Native Tasks (TaskCreate/TaskUpdate/TaskList) serve as a runtime convenience layer for structured status queries during build execution. At each wave boundary, re-derive state from ROADMAP.md markers as a consistency check.

**Example**:
- Build start: parse ROADMAP.md → create native Tasks → compute waves
- During wave: TaskUpdate(status: "in_progress") on dispatch
- Wave boundary: re-read ROADMAP.md markers, cross-check against TaskList
- Build end: sync native Task states back to ROADMAP.md markers

**Anti-pattern**: Treating native Tasks as the source of truth. If TaskCreate fails or Tasks drift from ROADMAP markers, the build must continue using ROADMAP.md alone.
