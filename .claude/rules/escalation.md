# Escalation Protocol

## Retry Cap
- Maximum **2 retries** per task. After 2 consecutive failures: STOP and surface the blocker.
- Never silently retry the same action a third time — it wastes quota and masks the real problem.

## Escalation Ladder
`sonnet` (high) → `opus` (high) → `fable` (high) (bare aliases — each resolves to the latest release in its family)

Raise effort `high → xhigh` before raising the model when the failure is reasoning depth, not capability.

A sub-agent dispatched by roster name takes the `model:`/`effort:` frontmatter of its agent file in `.claude/agents/` — `sonnet` at high effort for `implementer` and `documenter`, the default executor tier. `CLAUDE_CODE_SUBAGENT_MODEL` (`.claude/settings.json`) applies only to an unnamed spawn. Escalate a task one rung via a `(model: <model-id>)` annotation in ROADMAP.md only on persistent failures or decisions beyond task scope. The top rung (Fable 5, Mythos-class) is for architecture-defining decisions — not routine unblocking.

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
- The escalation ladder is `sonnet` (high) → `opus` (high) → `fable` (high); raise effort `high → xhigh` before raising the model when the failure is reasoning depth, not capability.
- A sub-agent dispatched by roster name runs at its agent file's own `model:`/`effort:` frontmatter (`sonnet` at high effort for `implementer` and `documenter`); `CLAUDE_CODE_SUBAGENT_MODEL` applies only to an unnamed spawn.
