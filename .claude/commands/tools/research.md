---
description: "Spawn parallel research agents to investigate a topic from multiple angles"
---

# Research Tool

## Usage
`/tools:research [topic]`

This is the canonical parallel research protocol. Other commands (e.g. `/workflows:idea`) invoke this fan-out by reference rather than restating it.

## Process

Break the research topic into 2-3 independent questions. Spawn a sub-agent for each question, dispatched per the researcher role spec (`.claude/agents/researcher.md`), which defines the search order agents follow.

Before spawning sub-agents, read `.claude/rules/bash.md` and extract the full content of its `## Agent Rules` section (everything after that heading). Store this as `BASH_AGENT_RULES` — sub-agents do not inherit CLAUDE.md, so append it to every agent prompt.

### Agent prompt template

Each agent prompt must contain:
1. The SINGLE focused question to investigate
2. The required output format (below)
3. The bash rules block:

```
CRITICAL — BASH COMMAND RULES:
[BASH_AGENT_RULES]
```

### Required Output Format (canonical — agents must produce exactly this)

- QUESTION: [the question investigated]
- ANSWER: [finding, with confidence: high/medium/low]
- SOURCES: [what was read]
- CAVEATS: [limitations, uncertainties]
- NEXT STEPS: [what would raise confidence if low]

## Synthesis

After all agents return, write `docs/research/[topic].md`:

```
# Research: [Topic]
**Date**: [TODAY]
**Confidence**: [overall]

## Summary
[2-3 paragraph synthesis]

## Detailed Findings
[Organized by theme]

## Open Questions
[What's still unclear]

## Recommendation
[What to do based on findings]
```

Notify user of key findings and confidence level.

Note: when this protocol is invoked from another command (e.g. `/workflows:idea`), that command may substitute its own synthesis target (such as a brief) for the `docs/research/` report — follow the invoking command's synthesis instructions in that case.
