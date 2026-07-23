---
type: knowledge
tags: [bugs, debugging]
description: Bug root causes, fixes, and prevention rules
links: "[[patterns]], [[decisions]]"
date: "2026-07-12"
---

# Bug Root Causes

## Format
Each entry: Date, Symptom, Root Cause, Fix, Prevention Rule

---

<!-- Entries get appended here when bugs are found and fixed -->

### 2026-02-24: Fabricated CDN Version and SRI Hash

**Symptom**: Dashboard SSE live-update feature completely broken — htmx-ext-sse script fails to load (HTTP 404 from unpkg CDN).

**Root Cause**: Sub-agent hallucinated `htmx-ext-sse@2.3.0` (latest is 2.2.4) and generated a plausible-looking but fake SRI hash. Build phase did not verify CDN URLs exist.

**Fix**: Changed to `htmx-ext-sse@2.2.4` and regenerated SRI hash from actual file: `curl -s URL | openssl dgst -sha384 -binary | openssl base64 -A`.

**Prevention Rule**: Never trust AI-generated CDN versions or SRI hashes. Always verify: (1) package version exists on npm, (2) SRI hash is computed from the actual downloaded artifact.

### 2026-04-04: install-hooks.sh `--quiet` flag not honored

**Symptom**: `install-hooks.sh` passes `--quiet` to `test-rules` subcommand, but output is always verbose.

**Root Cause**: `cmdTestRules` in `security-scanner.ts` does not check for or honor a `--quiet` flag. The flag is silently ignored.

**Fix**: Cosmetic — not blocking. Fix when adding CLI flag parsing improvements.

**Prevention Rule**: When adding flags to wrapper scripts, verify the target command actually supports them.

### 2026-04-04: scan-rules.js triggers its own scanner

**Symptom**: Full-repo scan reports 12+ findings in `scripts/lib/scan-rules.js` (SSNs, credit card numbers, API key patterns).

**Root Cause**: The rules file contains test case data — real-looking secrets that are intentionally embedded for `test-rules` validation. These are false positives by design.

**Fix**: Added `scripts/lib/scan-rules.js` to `.claude/security/allowlist.json` path ignores. This is an accepted trade-off, not a bug — but documented here so future maintainers don't remove the allowlist entry thinking it's an error.

**Prevention Rule**: When a file legitimately contains secret-like test data, add it to the path allowlist and document why.

### 2026-07-17 — #T62 Bash-failure log investigation

**Symptom**: `scripts/maintain.sh`'s `failures` check flagged 14 recurring `Bash` tool failures in `.claude/logs/tool-failures.log` since tracking started (threshold `FAILURE_DRAFT_THRESHOLD`), filing draft `#T62`. By design the log records only `timestamp` + `tool=Bash` — never command content — so the failures needed correlation, not direct reading.

**Investigation**: Read all 15 entries currently in the log (the 14 that triggered `#T62`, spanning 2026-03-12T20:10Z–2026-07-17T16:02Z, plus one new entry at 19:26:21Z added after the maintenance run that filed the draft). Cross-referenced each timestamp against `.claude/logs/activity.jsonl` and `git log` commit timestamps (converting local `-05:00` commit times to UTC). Every failure clustered tightly (seconds to a few minutes) with an active-development commit or task-spawn/task-completed event:
- **2026-03-12 20:10–20:25Z** (4 failures, ~15 min): immediately precedes `929cac0`/`347ed04` — "harden hooks and adapters against edge-case failures" + hook-smoke-test commit. Consistent with deliberate edge-case/failure-path testing.
- **2026-07-16 21:34:33Z** (1): 17s before commit `3a5791d` (post-merge review fixes, T17-T32).
- **2026-07-16 23:06:49–23:11:24Z** (3): 1–6 min before commits `380a164`/`8d07d04`/`e6eb7ed` (security-scanner regex fix, MCP hook fix, scan-staged fix) — work directly involving Bash-heavy hook/scanner testing.
- **2026-07-16 23:36:00–23:43:13Z** (3): matches `activity.jsonl` `task-spawned`/`task-completed` events for dashboard-kanban T40/T41/T42/T43 almost to the second — three parallel sub-agents each hit one Bash hiccup during implementation.
- **2026-07-17 00:23:11Z** (1): 33s before commit `5e46574` (dashboard-kanban linear-parse fix) and 62s before `review-passed`.
- **2026-07-17 14:10:08Z** (1): 47s before commit `b5b3690` ("one-command activation + SessionStart clone fallback + bootstrap test").
- **2026-07-17 16:02:58Z** (1): 33s before commit `fb81866` ("SessionStart auto-run with 24h debounce") — maintenance-hook script testing.
- **2026-07-17 19:26:21Z** (1, post-#T62-filing): 9s before commit `03f525b` ("hook quarantine --no-chain") during adopt-existing-project work.

**Root Cause**: Not a single defect. All 15 failures fall inside active, Bash-heavy development work (hook/scanner testing, git operations during commits, bash script bootstrapping, parallel sub-agent task execution) — exactly the command shapes `docs/knowledge/windows-bash-scanner.md` catalogs as scanner-friction-prone on this Windows machine (quoted paths, `&&`/`$()`/piping, script-in-`-c` patterns). No cluster is anomalously large, no failure repeats in a tight retry-loop signature (ruling out a stuck command), and no cluster correlates with a single script or code path outside "normal dev activity." The evidence is circumstantial (log records no command content by design) but consistent across all 8 clusters and 3+ months of history.

**Fix**: None required — classified as expected friction, not a defect. Draft `#T62` should be closed/dismissed rather than converted into a fix task.

**Prevention Rule**: This is noise the failure log is designed to surface for eyeballing, not a bug queue. No code or process change needed; existing mitigations (`.claude/rules/bash.md`, `docs/knowledge/windows-bash-scanner.md`) already cover the causal patterns. If a future maintenance run flags a large single-timestamp burst (many failures in seconds, not minutes) or a cluster with no adjacent commit/activity correlation, treat that as the actionable signal — it would indicate a stuck retry loop or a command outside normal dev flow, unlike anything seen here. Ledger rotation is out of scope for this investigation — `maintain.sh` owns it.

### 2026-07-22 — getProjectRoot() fixture footgun

**Symptom**: Containment/path assertions in a test either pass or fail against the wrong "project root" — silently, with no error surfaced.

**Root Cause**: `getProjectRoot()` walks up from `cwd` looking for a `.claude` marker directory. A test fixture repo built without its own `.claude/` dir lets that walk keep climbing past the temp dir and false-match the machine's global `~/.claude` — so "project root" silently resolves to the user's home directory instead of the fixture.

**Fix**: None needed in `getProjectRoot()` itself — it's working as designed (walk-up marker resolution). The fix is in fixture construction: every fixture repo must create a `.claude/` dir so the walk terminates inside the fixture, not at the real machine's home directory.

**Prevention Rule**: Any test that builds a throwaway repo/fixture and then calls (directly or transitively) `getProjectRoot()` must create a `.claude/` dir in that fixture as part of setup, before any containment/path assertion. Found during #T89's test authoring.
