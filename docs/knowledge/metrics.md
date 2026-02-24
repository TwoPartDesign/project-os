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

### Feature: native-foundations (v2.1)
- **Duration**: 2026-02-24 (single day, multi-session)
- **Tasks**: 11 total, 11 completed, 0 blocked
- **Waves**: 4 (W1: T1-T5+T8-T10, W2: T6, W3: T7, W4: T11)
- **Revisions**: 2 review cycles (Round 1 failed on 1 MUST FIX, Round 2 passed)
- **First-pass review rate**: 91% (10/11 tasks passed first review)
- **Compete usage**: 0 tasks
- **Model split**: 100% Haiku (sub-agents), Opus orchestration
- **Lines changed**: +539 / -52 across 14 files
- **Commits**: 12 (9 feature, 2 fix, 1 docs)
- **Key finding**: AI-generated CDN versions/SRI hashes must be verified against npm registry
