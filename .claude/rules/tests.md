---
globs: ["**/*.test.*", "**/*.spec.*", "**/test_*", "**/tests/**"]
description: "Rules applied when working with test files"
---

- Every test file must be runnable in isolation
- No shared mutable state between test cases
- Use descriptive test names: `[unit]_[scenario]_[expected]`
- Prefer explicit setup in each test over shared beforeEach
- Mock external dependencies, not internal modules
- Assert specific values, not just truthiness
- Test error messages, not just error types

## Agent Rules

<!-- source-hash: 066af0c6db661e5bec3b3ca0fb77f973e1faea961b6f6f1b666aa77a95d053e7 -->

- Make every test file runnable in isolation.
- Do not use shared mutable state between test cases.
- Name tests using format: `[unit]_[scenario]_[expected]`.
- Use explicit setup in each test; avoid shared beforeEach.
- Mock external dependencies only, not internal modules.
- Assert specific values; do not assert truthiness alone.
- Test error message content, not just error type existence.
