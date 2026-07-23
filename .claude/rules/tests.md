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


- Make every test file runnable in isolation.
- Do not use shared mutable state between test cases.
- Name tests using format: `[unit]_[scenario]_[expected]`.
- Use explicit setup in each test; avoid shared beforeEach.
- Mock external dependencies only, not internal modules.
- Assert specific values; do not assert truthiness alone.
- Test error message content, not just error type existence.
- Test error message content, not just error type existence.
- For security guards (containment, allowlists, escapes), test the in-bounds indirection cases — symlink to an in-scope sibling, prefix-collision paths — not only the obvious escape case.
