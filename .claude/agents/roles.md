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

## Approver
- **Agents**: human (via Claude Code CLI)
- **Read**: all
- **Write**: all
- **Active Phases**: all
- **Responsibility**: Decide `/pm:approve`, design approval, scope changes, destructive actions. Invoking `/workflows:mvp` is standing consent for that feature's task promotion; ship still pauses.

## Lead
- **Agents**: primary session
- **Read**: all
- **Write**: specs, knowledge, ROADMAP, handoffs, git integration
- **Active Phases**: all
- **Responsibility**: Plan, brief, dispatch, arbitrate, integrate, run verification commands, report. Does not implement. Delegates suite runs and accepts output as evidence.

## Permission Model

```
             Read                  Write                              Phases
Architect    all                   specs/knowledge                    Idea, Design
Developer    specs/knowledge/src   code/tests/docs                    Build
Reviewer     all                   review-reports                     Review
Approver     all                   all                                all
Lead         all                   specs/knowledge/ROADMAP/handoffs/git-integration   all
```

Enforcement is advisory in v2. Agents should self-enforce based on their frontmatter.
Approver (human) can override any restriction.
