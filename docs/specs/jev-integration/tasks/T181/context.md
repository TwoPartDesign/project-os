# Task T181 context

Feature: jev-integration
Source: ../../tasks.md
Design: ../../design.md

Common rules for every task:
- Tests use `node:test`, one fixture per test, no shared `beforeEach`,
  names `[unit]_[scenario]_[expected]`, specific-value assertions, error
  message content asserted. Any test needing a project root copies the
  needed files into a `mkdtempSync` directory and never touches this repo's
  `.claude/logs/` or `docs/specs/`.
- All `execFileSync` calls take argv arrays. No shell strings.
- Every exported function has a docstring.
- No runtime npm dependency. Node `>=22.18` only.
- Run only the suite covering the file you changed:
  `node --test tests/<name>.test.ts`.

### T181: Settings block, permission entry, egress allowlist file
- **Files**: `.claude/settings.json` (modify: `permissions.allow` array and `project_os` object), `.claude/security/egress-allowlist.json` (create)
- **Pattern**: `project_os.context_filter` block at `.claude/settings.json` lines 108-120 for shape; `.claude/security/mcp-allowlist.json` for the allowlist file's field style.
- **Implementation**:
  - Add to `permissions.allow`, directly after `"Bash(node scripts/skill-ledger.ts*)"`: `"Bash(node scripts/review-triage.ts*)"`.
  - Add to `project_os`, after `context_filter`: `"jev": { "enabled": false, "model": "jev-latest", "timeout_ms": 5000, "max_body_tokens": 60000, "thresholds": { "duplicate_p": 0.85, "out_of_scope_p": 0.8, "severity_confidence": 0.8 } }`.
  - Create `.claude/security/egress-allowlist.json` with exactly: `description` ("Allowlist of hosts that project scripts may send data to directly over HTTPS. Sibling of mcp-allowlist.json, which governs MCP servers only."), `approved_egress` → `"api.typesafe.ai"` → `{ "caller": "scripts/lib/decide.ts", "endpoint": "https://api.typesafe.ai/v1/systemone", "data_classes": ["finding.severity", "finding.reviewer", "finding.file", "finding.lines", "finding.issue", "finding.fix", "changed_files"], "guards": ["scrub+rescan", "key-denylist", "entropy>=4.0"], "risk_level": "low", "rationale": "Typed decisions over already-local review findings; no file contents or diffs; off by default.", "audit_date": "2026-09-20" }`, `blocked_capabilities: ["endpoint_override", "file_content_egress", "diff_egress"]`, `review_cadence: "monthly"`.
  - Keep JSON formatted as the existing files are (two-space indent). Do not reorder existing keys.
- **Tests**: none in this task (the allowlist-to-constant test lands in T185). Run `node --test tests/shipped-settings.test.ts` to confirm nothing there breaks.
- **Acceptance Criteria**:
  - [ ] `node -e` is not used; verify with `node --test tests/shipped-settings.test.ts` passing
  - [ ] `git diff .claude/settings.json` shows only the two additions
  - [ ] `.claude/security/egress-allowlist.json` parses and has the keys listed
- **Size**: Small
- **Status**: [?]
