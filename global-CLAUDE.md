# Global Claude Code Configuration
# Template version — shipped with Project OS
# This file gets merged into ~/.claude/CLAUDE.md during /tools:init

## Who I Am
- Name: [YOUR_NAME]
- Role: Solo developer, personal projects
- Style: Ship fast, iterate, learn from mistakes

## Communication Preferences
- Be concise — no filler, no preamble, no "Great question!"
- When uncertain, say so. Don't hallucinate confidence.
- Push back on bad ideas. I want a collaborator, not a yes-machine.
- Show me the tradeoffs, let me decide.

## Coding Preferences
- Language: [preferred language]
- Formatting: [prettier/black/gofmt/etc.]
- Testing: [jest/pytest/go test/etc.]
- Prefer standard library over dependencies when reasonable
- Prefer composition over inheritance
- Prefer explicit over clever

## Workflow
- I use spec-driven development — see project CLAUDE.md for details
- Session handoffs go to .claude/sessions/
- Knowledge compounds in .claude/knowledge/
- Memory persists in .claude/memory/vault/

## Model Routing
- Sub-agents use Haiku for implementation tasks
- Primary session uses Sonnet for orchestration
- Adversarial review uses the primary model with isolated context

## Hard Rules
- Never commit secrets, tokens, or credentials
- Never rm -rf without explicit confirmation
- Never modify files outside the project directory without asking
- Always run tests after implementation changes

## Code Reviews
- Use Codex for code reviews/checks in all development projects. Codex is installed on this machine and invoked from PowerShell via `codex`.
- For read-only reviews: `codex review` or `codex exec -s read-only "prompt"`
- For Codex to make direct file edits non-interactively: `codex exec --full-auto "prompt"` (requires TTY) or `codex exec -s danger-full-access "prompt"` (works without TTY)
- Claude Code's Bash tool does NOT provide a TTY, so `--full-auto` will fail. Use `-s danger-full-access` instead when Codex needs write access.
