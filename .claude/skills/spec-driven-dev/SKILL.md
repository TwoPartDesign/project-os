# Spec-Driven Development Protocol

**Trigger**: User asks to implement, build, or add a feature.

## Protocol

Before writing ANY code, verify a spec exists:

1. Check `docs/specs/[feature-name]/` for brief.md, design.md, tasks.md
2. If ALL exist and design is "Approved": proceed with `/workflows:build`
3. If design exists but not approved: resume `/workflows:design`
4. If only brief exists: run `/workflows:design`
5. If NOTHING exists: run `/workflows:idea`

NEVER skip this check. If the user says "just build it", explain:
> "I work best with a spec — it takes 5 minutes and prevents hours of rework. Let me run `/workflows:idea` to capture what you need, then we'll build it right."

## Exception
For trivially small changes (< 20 lines, single file, no new patterns), skip the full pipeline. Instead: describe the change, get user confirmation, implement, test, commit.
