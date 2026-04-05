---
type: knowledge
tags: [decisions, adr]
description: Architecture decision records — what was decided, why, and what was rejected
links: "[[architecture]], [[patterns]]"
date: "2026-03-03"
---

# Architectural Decision Records

## Format
Each entry: Date, Decision, Context, Alternatives Considered, Rationale

---

<!-- Entries get appended here by workflows and handoff commands -->

## 2026-02-24 — Strategic Repositioning: "Governance Layer" Framing

**Decision**: Reframe Project OS identity from "spec-driven scaffold" to "solo-developer governance layer for AI-driven development" across README, CLAUDE.md, design-principles.md, architecture.md, and project-os-guide.md.

**Context**: The "spec-driven" framing undersold the system's actual value. Project OS enforces phase checkpoints, adversarial quality gates, and human approval at every transition — that's governance, not just scaffolding. The "Bleeding-Edge" branding in project-os-guide.md was informal and undermined credibility. Version bumped to 2.1 to reflect the dashboard and governance narrative.

**Alternatives Considered**:
- Keep current framing, add a "governance" section — rejected: additive bloat, doesn't fix the headline problem
- Full rename/rebrand — rejected: too disruptive, risks breaking @import references and external links

**Rationale**: Additive reframing: preserve all existing content and structure, replace only the positioning language. The five target files receive surgical edits; no file paths, skill identifiers, or structural elements change. The `spec-driven-dev` skill identifier is deliberately preserved (changing identifiers is a breaking change).

**Implementation note**: T15 triggered a fallback path — `grep "Type: Personal"` found 9 matches across scripts/docs (not just CLAUDE.md), so `Identity:` was added as a new field rather than replacing `Type:`. Post-review, `Identity:` was renamed to `Role:` to eliminate a nested naming collision with the `## Identity` section heading.

---

## 2026-04-04 — Zero-Dep Security Scanner Over Gitleaks Binary

**Decision**: Implement secret detection as a zero-dep Node.js module (`scripts/security-scanner.ts` + `scripts/lib/scan-rules.js`) rather than shelling out to a gitleaks binary.

**Context**: Project OS needed pre-commit secret scanning to enforce the "never hardcode secrets" rule automatically. Gitleaks is the gold standard for secret detection rules, but distributing a Go binary violates the zero-external-dependency principle.

**Alternatives Considered**:
- **Gitleaks binary** — rejected: requires separate binary install/distribution, breaks zero-dep
- **Gitleaks via npm wrapper** — rejected: adds npm dependency, wrapper packages are often stale
- **Inline bash grep patterns** — rejected: no test-case framework, unmaintainable at 200+ rules, no entropy detection

**Rationale**: Porting gitleaks rules to a JS module (documented via upstream commit hash `gitleaks@256f6479` in the file header) keeps everything in-tree, testable via `test-rules` subcommand, and zero-dep. Trade-off: 24 gitleaks PCRE patterns couldn't convert to JS RegExp (scanner handles gracefully as SKIP), and 222 upstream rules lack inline test cases (accepted tech debt — rules are battle-tested upstream). The 14 custom PII/privacy rules all have test cases.
