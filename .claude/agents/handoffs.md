# Phase Handoff Contracts

Each phase transition produces and consumes specific artifacts. No phase may start without its required input artifact being present and valid.

## Idea → Design
- **Produces**: `docs/specs/<feature>/brief.md`
- **Required fields**: problem, solution, scope, constraints, feasibility assessment
- **Validation**: File exists, all required sections present

## Design → Plan
- **Produces**: `docs/specs/<feature>/design.md`
- **Required fields**: architecture decision, technical approach, data model, key interfaces, file changes, testing strategy, security considerations
- **Required status**: `Status: APPROVED` header in design.md
- **Validation**: File exists, status is APPROVED, all required sections present

## Plan → Approve
- **Produces**: ROADMAP.md entries with `[?]` markers and `#TN` IDs
- **Produces**: `docs/specs/<feature>/tasks.md`
- **Required fields**: dependency graph, per-task specs with files/implementation/tests/acceptance criteria
- **Validation**: `scripts/validate-roadmap.sh` passes, all tasks have IDs and deps

## Approve → Build
- **Produces**: ROADMAP.md entries promoted from `[?]` to `[ ]`
- **Gate**: `/pm:approve` must be run by Orchestrator (human)
- **Validation**: No `[?]` tasks remain for the feature being built

## Build → Review
- **Produces**: Per-task `docs/specs/<feature>/completion-report-TN.md`
- **Required fields**: files changed, tests passed, assumptions made
- **Produces**: ROADMAP.md entries moved to `[~]` (Review)
- **Validation**: All tasks marked `[~]` or `[x]`, completion reports exist

## Review → Ship
- **Produces**: `docs/specs/<feature>/review.md`
- **Required status**: GATE PASSED
- **Validation**: No MUST FIX items remain

## Review → Build (Revision)
- **Produces**: `docs/specs/<feature>/revision-request.md`
- **Required fields**: failing tasks, required changes, linked review findings
- **Validation**: Tasks marked `[!]` have corresponding revision items
