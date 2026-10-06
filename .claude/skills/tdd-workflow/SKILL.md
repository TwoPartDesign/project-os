---
name: tdd-workflow
description: Red-Green-Refactor test-driven development cycle with an edge-case protocol and test naming convention. Use when the user asks to write tests, run tdd, verify behavior, or improve coverage, or when an implementation task requires tests.
---

# Test-Driven Development Protocol

**Trigger**: User asks to write tests, or implementation task requires tests.

## Red-Green-Refactor Cycle

### 1. RED — Write the failing test first
- Test describes the desired behavior, not the implementation
- Test should fail for the RIGHT reason (missing function, not syntax error)
- Run the test, confirm it fails, capture the error output

### 2. GREEN — Write the minimum code to pass
- Do not write more than what the test requires
- No optimization, no edge cases, no cleanup — just make it pass
- Run the test, confirm it passes

### 3. REFACTOR — Clean up without changing behavior
- Run the tests again, confirm they still pass

## Edge Case Protocol
After the happy path passes, add tests for edge cases.

## Test Naming
`[unit]_[scenario]_[expected result]`
Example: `parseConfig_emptyInput_returnsDefault`
