# Agent Roles

Roles define what each agent type can do. Permissions are advisory in v2 (enforcement planned for v2.1).

## Architect
- **Agents**: researcher
- **Read**: all project files
- **Write**: specs, knowledge, research
- **Active Phases**: Idea, Design
- **Responsibility**: Investigate, design, document decisions. Never write implementation code.

## Developer
- **Agents**: implementer, documenter
- **Read**: specs, knowledge, task description, relevant source files
- **Write**: code, tests, docs, completion reports
- **Active Phases**: Build
- **Responsibility**: Implement exactly what the spec says. Stay within task scope.

## Reviewer
- **Agents**: reviewer-architecture, reviewer-security, reviewer-tests
- **Read**: all project files
- **Write**: review reports only
- **Active Phases**: Review
- **Responsibility**: Evaluate quality, security, and design alignment. Never modify source code.

## Orchestrator
- **Agents**: human (via Claude Code CLI)
- **Read**: all
- **Write**: all
- **Active Phases**: all
- **Responsibility**: Coordinate workflow, approve drafts, resolve conflicts, make final decisions.

## Permission Model

```
             Read                  Write              Phases
Architect    all                   specs/knowledge    Idea, Design
Developer    specs/knowledge/src   code/tests/docs    Build
Reviewer     all                   review-reports     Review
Orchestrator all                   all                all
```

Enforcement is advisory in v2. Agents should self-enforce based on their frontmatter.
Orchestrator (human) can override any restriction.
