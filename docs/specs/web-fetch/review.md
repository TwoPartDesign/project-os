# Review Report: web-fetch (Re-Review)

**Date**: 2026-04-06
**Feature**: web-fetch (T18-T27 + quality cascade + 7-fix rebuild)
**Reviewers**: 3 isolated agents (drift, security, quality)
**Review Round**: 2 (re-review after rebuild)
**Prior Review**: FAILED (2 MUST FIX, 5 SHOULD FIX) — all 7 fixed in commit 3f55808

---

## Fix Verification

All 7 prior findings confirmed fixed:

| Fix | Status | Verification |
|-----|--------|-------------|
| Fix 1: Rate limiter singleton | VERIFIED | `globalRateLimiter` used at line 527, no per-call instantiation |
| Fix 2: wordCount on cache hits | VERIFIED | Both paths compute from `cached.content.trim().split()` |
| Fix 3: SSRF redirect validation | VERIFIED | `redirect: "manual"`, per-hop `validateUrl()`, MAX_REDIRECTS=5 |
| Fix 4: Retry-After cap | VERIFIED | `Math.min(parseInt(...), MAX_RETRY_AFTER_SEC)` at line 337 |
| Fix 5: ReDoS bounds | VERIFIED | All 5 patterns bounded to `[\s\S]{0,10000}?` |
| Fix 6: Cloud metadata blocklist | VERIFIED | `169.254.170.2` added to BLOCKED_HOSTNAMES |
| Fix 7: IPv6 ULA range | VERIFIED | `lower.startsWith("fc")` covers full fc00::/7 |

---

## New Findings

### SHOULD FIX

**S1: `currentUrl` state bleeds across retry iterations**
- File: `pipeline.ts:281`
- `let currentUrl = url` declared outside the retry loop. After redirects mutate it, retry attempts start from the final redirect target instead of the original URL. Weakens SSRF guarantees on retry paths.
- Fix: Reset `currentUrl = url` at the top of each retry iteration.

**S2: `globalRateLimiter` ignores `cfg.rateLimit.defaultRps`**
- File: `pipeline.ts:478`
- Hardcoded `new RateLimiter(2)` at module scope. Config field `rateLimit.defaultRps` is dead code.
- Fix: Either lazy-initialize the singleton using config on first `fetchUrl()` call, or remove the config field and document the hardcoded value.

### CONSIDER

**C1: DNS rebinding gap in SSRF validation**
- File: `pipeline.ts:145-165`
- `validateUrl()` resolves DNS to check the IP, but `fetch()` resolves DNS independently. An attacker-controlled DNS server could return different IPs for each resolution. This is inherent to application-layer SSRF defense without custom DNS resolvers — Node's `fetch()` doesn't accept pre-resolved IPs. Not actionable in v1 without significant architecture changes. Document as a known limitation.

**C2: `fetchUrl` is 195 lines — exceeds 50-line guideline**
- File: `pipeline.ts:487-692`
- Stages 3-9 inlined in one function. Stage comments make it readable. Decomposing into helpers (buildCacheResult, runExtraction, writeCacheEntry) would improve testability but is optional for a personal project.

**C3: Duplicated cache-result builder**
- File: `pipeline.ts:509-522,558-571`
- Two identical return blocks for cold-cache-hit and 304-not-modified paths. A `buildCachedResult()` helper would eliminate duplication.

**C4: Magic number `3.5` (chars-per-token ratio)**
- File: `pipeline.ts:454,653`
- Used twice without a named constant. Should be `const CHARS_PER_TOKEN = 3.5`.

**C5: 6 config fields defined but never consumed**
- File: `config.ts:44-61`
- `wayback`, `headlessThreshold`, `respectRobotsTxt`, `sanitizeInjections`, `includeMetadataHeader`, `stripImages` are v2 placeholders never read by pipeline.

**C6: Sanitizer test coverage gaps**
- File: `tests/web-fetch-sanitizer.test.ts`
- Stage 8 (whitespace normalization) and `dangerous-attr` removal have no dedicated unit tests.

**C7: `void offset` dead variable**
- File: `extractor.ts:381`
- Should be removed rather than suppressed.

**C8: Duplicate backoff logic in two catch branches**
- File: `pipeline.ts:370-386`
- Network-error and AbortError branches compute identical exponential-backoff delay.

**C9: `pipeline_qualityGate_lowConfidence_hasHeadings` test is permissive**
- File: `tests/web-fetch-pipeline.test.ts:447-475`
- Accepts all three confidence values — provides no real signal.

### PASSED

- All 7 prior review findings correctly fixed
- No hardcoded secrets or credentials
- SQL injection protected (parameterized queries throughout)
- Path traversal protected (SHA-256 hex filenames)
- JSON-RPC stdout pollution prevented
- MCP tool input validated before dispatch
- Test naming follows `[unit]_[scenario]_[expected]` convention
- All mock cleanup in `finally` blocks
- No `console.log` in production paths
- Docstrings on all public exports
- No TODO/FIXME/HACK without ROADMAP entries

---

## Gate Decision

**GATE PASSED WITH NOTES.**

No MUST FIX items. Two SHOULD FIX items (S1: currentUrl bleed, S2: rate limiter config) are real but neither causes incorrect behavior in the default/common case. Nine CONSIDER items are optional quality improvements.

The user decides which notes to address before shipping.
