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
- Remove duplication
- Improve naming
- Extract functions if needed
- Run tests again — must still pass

## Edge Case Protocol
After the happy path passes, add tests for:
- Null/undefined/empty inputs
- Boundary values (0, -1, MAX_INT, empty string)
- Error conditions (network failure, malformed data)
- Concurrent access (if applicable)

## Test Naming
`[unit]_[scenario]_[expected result]`
Example: `parseConfig_emptyInput_returnsDefault`
