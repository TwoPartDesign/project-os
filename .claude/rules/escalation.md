# Escalation Protocol

## Retry Cap
- Maximum **2 retries** per task. After 2 consecutive failures: STOP and surface the blocker.
- Never silently retry the same action a third time — it wastes quota and masks the real problem.

## Escalation Ladder
`haiku` → `sonnet` → `opus` → `fable` (bare aliases — each resolves to the latest release in its family)

Sub-agent tasks default to the model in `CLAUDE_CODE_SUBAGENT_MODEL` (`.claude/settings.json`). Escalate a task one rung via a `(model: <model-id>)` annotation in ROADMAP.md only on persistent failures or decisions beyond task scope. The top rung (Fable 5, Mythos-class) is for architecture-defining decisions — not routine unblocking.

## Downshift Rule
After resolving a blocker on a higher-tier model, return follow-up tasks to the default sub-agent model.
Keeping a top-tier model on easy follow-up tasks is wasteful.

## When to Escalate
- 2 consecutive tool failures on the same operation
- Ambiguous requirements that couldn't be resolved with clarifying questions
- Architectural or security decisions beyond the task scope
- Complex multi-file refactors where planning quality matters

## Escalation Message Format
When hitting the retry cap, output:
> "Retry cap reached on [operation]. Blocker: [specific issue]. Suggested next: [action]."
Then stop and wait for user direction.

## Agent Rules

- Maximum **2 retries** per task. After 2 consecutive failures: STOP and surface the blocker.
- Never silently retry the same action a third time — it wastes quota and masks the real problem.
- When hitting the retry cap, output: "Retry cap reached on [operation]. Blocker: [specific issue]. Suggested next: [action]." Then stop and wait for direction.
