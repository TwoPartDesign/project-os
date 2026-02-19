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
