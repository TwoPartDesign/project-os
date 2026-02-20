# Escalation Protocol

## Retry Cap
- Maximum **2 retries** per task. After 2 consecutive failures: STOP and surface the blocker.
- Never silently retry the same action a third time — it wastes quota and masks the real problem.

## Escalation Ladder
Haiku → Sonnet → Opus

Default to Haiku. Escalate only on persistent failures or architectural decisions beyond task scope.

## Downshift Rule
After resolving a blocker on a higher-tier model, return to Haiku for routine follow-up.
Staying on Opus for easy follow-up tasks is wasteful.

## When to Escalate
- 2 consecutive tool failures on the same operation
- Ambiguous requirements that couldn't be resolved with clarifying questions
- Architectural or security decisions beyond the task scope
- Complex multi-file refactors where planning quality matters

## Escalation Message Format
When hitting the retry cap, output:
> "Retry cap reached on [operation]. Blocker: [specific issue]. Suggested next: [action]."
Then stop and wait for user direction.
