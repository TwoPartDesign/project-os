# ROADMAP.md Format Specification

This document defines the authoritative format for ROADMAP.md, used to track tasks, dependencies, and feature progress across the entire project.

---

## Marker Legend

| Marker | Name | Meaning | Who Sets | Transition | Terminal |
|--------|------|---------|----------|-----------|----------|
| `[?]` | Draft | Pending approval from `/pm:approve` | `/workflows:plan` | → `[ ]` | No |
| `[ ]` | Todo | Approved, ready for work | `/pm:approve` | → `[-]` | No |
| `[-]` | In Progress | Agent actively working | Builder on task start | → `[~]` | No |
| `[~]` | Review | Awaiting review pass | Builder on completion | → `[x]` or `[!]` | No |
| `[>]` | Competing | Multiple implementations racing | `/workflows:compete` | → `[x]` | No |
| `[x]` | Done | Completed and merged | `/workflows:review` PASS | — | Yes |
| `[!]` | Blocked | Cannot proceed | Any phase | → `[-]` | No |

---

## Task ID Syntax

### `#TN` Format

- `T` = literal character "T"
- `N` = unique integer per project
- Example: `#T1`, `#T15`, `#T42`

### Uniqueness Rules

- **Global uniqueness**: Every `#TN` ID must be unique across the entire ROADMAP.md
- **Allocation strategy**: Before assigning new IDs, scan ROADMAP.md for the highest existing `N` value and start from `N+1`
- **Never reuse IDs**: If a task is deleted, its ID is retired permanently
- **Collision detection**: Run `bash scripts/validate-roadmap.sh` after any manual edit to detect duplicate IDs

### ID Format in Task Lines

Task lines follow this format:

```
- [marker] Task description (depends: #TX, #TY) #TN (agent: agent-name)
```

Where:
- `[marker]` = one of the markers above
- `Task description` = human-readable task summary
- `(depends: ...)` = optional dependency clause (see Dependencies section)
- `#TN` = unique task ID (required)
- `(agent: agent-name)` = optional agent routing (e.g., `(agent: codex)`)

### Examples

```markdown
- [ ] Implement user login flow #T1
- [ ] Add test coverage for login (depends: #T1) #T2
- [ ] Review security of auth token storage (depends: #T1, #T2) #T3 (agent: reviewer-security)
- [-] Refactor API response format #T4
```

---

## Dependency Syntax

### Inline Dependencies

Dependencies are declared inline using the `(depends: ...)` syntax:

```markdown
- [ ] Task description (depends: #T1, #T2) #T3
```

Rules:
- Dependencies are optional
- Multiple dependencies separated by commas and spaces
- Dependencies must reference existing `#TN` IDs in the ROADMAP
- A task cannot depend on itself
- Circular dependencies are an error (detected by `validate-roadmap.sh`)

### Dependency Graph

Before implementing a task group, the planner creates a dependency graph showing which tasks can run in parallel:

```
T1 → T3 → T5
T2 → T3
T4 (independent)
```

This can be represented in ROADMAP.md as a comment block for reference.

### Validation

Run after any changes:
```bash
bash scripts/validate-roadmap.sh
```

This detects:
- Cycles (A depends on B, B depends on A)
- Dangling references (dependency on non-existent `#TN`)
- Duplicate IDs (same `#TN` used twice)

---

## Section Heading Conventions

### Feature Sections

Each feature gets its own top-level section:

```markdown
## Feature: [feature-name]

### Draft
- [?] ...

### Todo
- [ ] ...

### In Progress
- [-] ...

### Review
- [~] ...

### Done
- [x] ...
```

### Organizational Notes

- Section headings are optional organizational grouping; **markers are authoritative**
- A task with marker `[x]` is done, even if listed under "In Progress"
- Tasks are typically organized by lifecycle phase, but custom sections are allowed

### Backlog Sections

```markdown
## Backlog

### Ideas
<!-- Raw ideas not yet spec'd. Run /workflows:idea to promote. -->

### Icebox
<!-- Parked ideas. Revisit quarterly. -->
```

### Completed Section

```markdown
## Completed
<!-- Moved here after /workflows:ship -->
```

---

## State Transitions

### Valid Transitions

| From | To | Trigger | Who |
|------|----|---------|----|
| `[?]` | `[ ]` | `/pm:approve` | PM / user |
| `[ ]` | `[-]` | Task start | Builder |
| `[-]` | `[~]` | Build complete | Builder |
| `[~]` | `[x]` | Review PASS | Reviewer |
| `[~]` | `[!]` | Review FAIL | Reviewer |
| `[!]` | `[-]` | Blocker resolved | Builder |
| `[ ]` | `[>]` | `/workflows:compete` | User |
| `[>]` | `[x]` | `/workflows:compete-review` winner selected | User |

### Invalid Transitions

These transitions are errors and indicate miscommunication:

- `[?]` → `[-]` (must approve first)
- `[x]` → anything (terminal state)
- `[!]` → `[~]` (must return to `[-]` first)
- `[>]` → `[~]` (competing tasks don't go to review; winner goes to `[x]`)

---

## Complete Template

```markdown
# Roadmap

## Legend

| Marker | Meaning | Transition |
|--------|---------|------------|
| `[?]` | Draft — pending `/pm:approve` | → `[ ]` on approval |
| `[ ]` | Todo — approved, ready for work | → `[-]` when started |
| `[-]` | In Progress — agent working | → `[~]` when complete |
| `[~]` | Review — awaiting review pass | → `[x]` on pass, `[!]` on fail |
| `[>]` | Competing — multiple implementations | → `[x]` when winner selected |
| `[x]` | Done | Terminal |
| `[!]` | Blocked | → `[-]` when unblocked |

### Dependency Syntax
Tasks use `#TN` IDs. Dependencies declared inline: `(depends: #T1, #T2)`.

### Agent Routing
Optional agent annotation: `(agent: agent-name)`.

Format spec: `docs/knowledge/roadmap-format.md`

---

## Current Sprint
<!-- Updated automatically by /workflows:plan and /pm:epic -->

## Backlog
<!-- Ideas that have been captured but not yet designed -->

## Completed
<!-- Moved here after /workflows:ship -->
```

---

## Validation Script

After any manual changes to ROADMAP.md, run:

```bash
bash scripts/validate-roadmap.sh
```

This validates:
- No duplicate `#TN` IDs
- All dependencies reference valid `#TN` IDs
- No circular dependencies (A→B→C→A)
- Marker syntax is correct

---

## Examples

### Single Feature with Independent Tasks

```markdown
## Feature: User Authentication

### Draft
<!-- New tasks start here. Run /pm:approve to promote to Todo. -->
- [?] Create User model and schema #T1
- [?] Implement password hashing utility #T2
- [?] Build login API endpoint (depends: #T1, #T2) #T3

### Todo

### In Progress

### Review

### Done
```

After `/pm:approve`:

```markdown
## Feature: User Authentication

### Draft

### Todo
- [ ] Create User model and schema #T1
- [ ] Implement password hashing utility #T2
- [ ] Build login API endpoint (depends: #T1, #T2) #T3

### In Progress

### Review

### Done
```

### Multi-Wave Feature with Competitive Implementation

```markdown
## Feature: Dashboard Redesign

### Draft

### Todo
- [ ] Design new layout grid system #T5
- [ ] Implement responsive layout (depends: #T5) #T6
- [ ] Write component tests (depends: #T6) #T7

### In Progress
- [-] Design new layout grid system #T5

### Review

### Done

---

## Feature: Dashboard Performance Optimization

### Draft
- [>] Add caching layer (approach: redis) #T8
- [>] Add caching layer (approach: in-memory) #T9
- [>] Add caching layer (approach: service-worker) #T10

### Todo

### In Progress

### Review

### Done
```

After `/workflows:compete-review` selects winner:

```markdown
- [x] Add caching layer (approach: redis) #T8

### Todo
- [ ] Add caching layer (approach: in-memory) #T9
- [ ] Add caching layer (approach: service-worker) #T10
```

---

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| `[?] task (depends: #T10)` without `#TN` ID | ID required for linking | Add `#TN` at end: `(depends: #T10) #T11` |
| `[?] task (depends: #T99)` but T99 doesn't exist | Dangling reference | Update depends or assign T99 first |
| Two tasks with same `#TN` | Collision | Scan for highest N, use N+1 |
| `[x]` task under "In Progress" section | Confusing organization | Move to "Done" section or trust marker |
| Circular: T1 depends on T2, T2 depends on T1 | Build will fail | Re-plan dependencies using `validate-roadmap.sh` |
| `[?] task` assigned to builder without `/pm:approve` | Not officially approved | Run `/pm:approve` first |

---

## Related Documents

- **Design Principles**: `docs/knowledge/design-principles.md`
- **Workflow Specifications**: `.claude/commands/workflows/plan.md` (task decomposition), `.claude/commands/pm/approve.md` (approval workflow)
