---
type: knowledge
tags: [bugs, debugging]
description: Bug root causes, fixes, and prevention rules
links: "[[patterns]], [[decisions]]"
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
