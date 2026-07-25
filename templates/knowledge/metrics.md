# Feature Metrics

Track per-feature implementation metrics. Updated by `/workflows:ship` and queryable via `/tools:metrics`.

## Template

```markdown
### Feature: <name>
- **Duration**: start → end (total days)
- **Tasks**: N total, N completed, N blocked
- **Waves**: N waves (from /workflows:build)
- **Revisions**: N review cycles before pass
- **First-pass review rate**: N% (tasks passing review on first attempt)
- **Compete usage**: N tasks used /workflows:compete
- **Model split**: N% Haiku, N% Sonnet, N% Opus
- **Lines changed**: +N / -N
- **PR**: #N (if applicable)
```

## Completed Features

<!-- Entries added by /workflows:ship -->
