---
description: "Spawn parallel research agents to investigate a topic from multiple angles"
---

# Research Tool

## Usage
`/tools:research [topic]`

## Process

Break the research topic into 2-3 independent questions. Spawn a sub-agent for each:

### Research Agent Template

Each agent searches in order:
1. `docs/knowledge/` — do we already know this?
2. `docs/research/` — has this been researched before?
3. Project codebase — existing implementation?
4. Local dependency docs (node_modules/README.md, etc.)

Each produces:
- QUESTION / ANSWER (with confidence) / SOURCES / CAVEATS / NEXT STEPS

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
