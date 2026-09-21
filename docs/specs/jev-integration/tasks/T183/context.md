# Task T183 context

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

### T183: `egress-guard.ts` staging, scrub subprocess, positive re-scan, composition
- **Depends on**: T178, T180
- **Files**: `scripts/lib/egress-guard.ts` (modify: append), `tests/egress-guard.test.ts` (modify: append)
- **Pattern**: `execFileSync(argv[0], argv.slice(1), { stdio: "pipe" })` as in `scripts/maintain-draft.ts:257`. Copied-project-root tests as in `tests/security-scanner.test.ts` (copy `scripts/security-scanner.ts`, `scripts/lib/scan-rules.js`, `scripts/lib/project-root.ts`, `.claude/security/allowlist.json` into the temp root; the scanner resolves its root from its own location).
- **Implementation**:
  - Export `type GuardDeps = { projectRoot: string; egressDir?: string; scrubCmd?: (file: string) => { status: number }; scanCmd?: (file: string) => { status: number } }`.
  - Export `resolveEgressDir(projectRoot, egressDir = join(projectRoot, ".claude/logs/jev")): string | null`: `mkdirSync(dir, { recursive: true, mode: 0o700 })`; `realpathSync(dir)` must equal or start with `realpathSync(projectRoot) + sep`; return the real path or `null`.
  - Export `guardEgressFields(fields: string[], deps: GuardDeps): { fields: string[]; redactions: number } | { refused: "egress-dir-unsafe" | "scrub-failed" }`:
    1. `resolveEgressDir` → `null` ⇒ `{ refused: "egress-dir-unsafe" }`.
    2. Write `escapeField` of each field, one per line, to `egress-<pid>-<randomBytes(6).toString("hex")>.txt` with `writeFileSync(path, text, { flag: "wx", mode: 0o600 })`.
    3. `scrubCmd(path)` (default: `execFileSync("node", [join(projectRoot, "scripts/security-scanner.ts"), "scrub", path], { cwd: projectRoot, stdio: "pipe" })` wrapped to return `{ status }` and never throw). Its status is ignored.
    4. Re-read the file; split on `\n`; require line count `=== fields.length`; then `scanCmd(path)` (default: same but `["scan-files", "--quiet", path]`) must return `status === 0`. Any failure, missing file, or thrown error ⇒ `{ refused: "scrub-failed" }`.
    5. `unescapeField` each line, then `redactFields` (from T180). Return `{ fields, redactions }`.
    6. `finally`: `rmSync` with `force: true` on `path`, `path + ".tmp"`, `path + ".tmp.bak"`.
- **Tests**:
  - `tests/egress-guard.test.ts` (append):
    - Test: `guardEgressFields_realScrub_redactsKnownPatterns` — Setup: copied root; fields `["token ghp_" + 36 chars, "other"]`; real default commands. Assert: field 0 contains `[REDACTED:` and not the `ghp_` token; `redactions >= 0`; the egress dir is empty afterwards. Expected: scrubbed by the scanner.
    - Test: `guardEgressFields_bareSkToken_redactedByNewRule` — Setup: copied root; field `"sk-" + 40 high-entropy chars`. Assert: contains `[REDACTED:bare-sk-token]`. Expected: T178 rule fires end to end.
    - Test: `guardEgressFields_scrubExitsZeroButSecretRemains_refusesScrubFailed` — Setup: `scrubCmd` returns `{status: 0}` without touching the file; `scanCmd` returns `{status: 1}`. Assert: `refused === "scrub-failed"`. Expected: exit code not trusted.
    - Test: `guardEgressFields_scrubChangesLineCount_refusesScrubFailed` — Setup: `scrubCmd` rewrites the file with one fewer line; `scanCmd` returns 0. Assert: `refused === "scrub-failed"`.
    - Test: `guardEgressFields_scrubThrows_refusesAndCleansUp` — Setup: `scrubCmd` throws. Assert: `refused === "scrub-failed"`; no `egress-*` file, `.tmp`, or `.tmp.bak` remains in the dir.
    - Test: `guardEgressFields_egressDirSymlinkOutsideRoot_refusesEgressDirUnsafe` — Setup: temp root; `.claude/logs/jev` is a symlink to a sibling temp dir outside the root. Assert: `refused === "egress-dir-unsafe"`; the target dir has no new files. Expected: containment holds.
    - Test: `guardEgressFields_egressDirSymlinkToInRootSibling_proceeds` — Setup: symlink to `<root>/.claude/logs/jev-real`. Assert: not refused. Expected: in-bounds indirection allowed.
    - Test: `guardEgressFields_fieldWithNewline_roundTripsAndCountsLines` — Setup: field containing `\n`; stub commands succeed. Assert: returned field equals the input.
    - Test: `guardEgressFields_stagingFileMode_0600` — Setup: `scrubCmd` captures `statSync(file).mode & 0o777`. Assert: `0o600` (skip on `process.platform === "win32"` with a message).
- **Acceptance Criteria**:
  - [ ] Every refusal path is covered by a test naming the exact `refused` value
  - [ ] No staging file survives any test (asserted in the throw test and the real-scrub test)
  - [ ] `node --test tests/egress-guard.test.ts` passes
- **Size**: Medium
- **Status**: [?]
