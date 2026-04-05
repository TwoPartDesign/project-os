---
type: knowledge
tags: [bugs, debugging]
description: Bug root causes, fixes, and prevention rules
links: "[[patterns]], [[decisions]]"
date: "2026-03-03"
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
