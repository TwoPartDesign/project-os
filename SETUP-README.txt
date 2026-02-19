================================================================================
  PROJECT OS — SETUP GUIDE
================================================================================

A spec-driven development scaffold for Claude Code. Gives you a full workflow
pipeline, memory system, sub-agent orchestration, and quality gates — all using
Claude Code's native features with zero external dependencies.

--------------------------------------------------------------------------------
  PREREQUISITES
--------------------------------------------------------------------------------

1. Node.js 18 or higher
     https://nodejs.org

2. Claude Code CLI
     npm install -g @anthropic/claude-code

3. An Anthropic API key
     https://console.anthropic.com
     Set it in your environment: ANTHROPIC_API_KEY=your-key-here

   On Mac/Linux — add to ~/.bashrc or ~/.zshrc:
     export ANTHROPIC_API_KEY=your-key-here

   On Windows — set via System Environment Variables or in PowerShell:
     $env:ANTHROPIC_API_KEY="your-key-here"

--------------------------------------------------------------------------------
  FIRST-TIME SETUP (do this once)
--------------------------------------------------------------------------------

1. Unzip this folder somewhere permanent — this is your template library.
   Good locations:
     Mac/Linux:  ~/claude-os/
     Windows:    C:\Users\YourName\claude-os\

2. Open a terminal in that folder and launch Claude Code:
     cd ~/claude-os
     claude

3. Run the init command:
     /tools:init

   This will:
     - Ask a few questions about you and your preferences
     - Set up your global Claude config (~/.claude/CLAUDE.md)
     - Fill in any remaining placeholders in the Project OS itself

4. That's it. Your environment is configured.

--------------------------------------------------------------------------------
  CREATING A NEW PROJECT
--------------------------------------------------------------------------------

1. Run the bootstrap script from the Project OS folder:

     Mac/Linux:
       ./scripts/new-project.sh my-project-name ~/projects/my-project-name

     Windows (Git Bash or WSL):
       bash scripts/new-project.sh my-project-name C:/Users/YourName/projects/my-project-name

   This copies the full scaffold (commands, agents, skills, rules, hooks) into
   a new folder and makes an initial git commit.

2. Open the new project in Claude Code:
     cd ~/projects/my-project-name
     claude

3. Run init for the new project:
     /tools:init

   This will:
     - Ask about the project (name, type, stack, scope)
     - Fill in all placeholders in the project's CLAUDE.md and docs/
     - Offer to merge/update your global ~/.claude/CLAUDE.md if the
       template has sections you're missing
     - Save a project profile to memory for future recommendations

--------------------------------------------------------------------------------
  STARTING WORK ON A FEATURE
--------------------------------------------------------------------------------

The workflow has six phases. Always start at the top.

  /workflows:idea my-feature     Capture idea, research feasibility, write brief
  /workflows:design my-feature   Turn brief into a technical spec
  /workflows:plan my-feature     Decompose spec into atomic tasks
  /workflows:build my-feature    Implement with parallel sub-agents
  /workflows:review my-feature   Adversarial quality gate (security, arch, tests)
  /workflows:ship my-feature     Final checks and mark complete

Never skip from idea to build. The design phase catches most mistakes.

For small tasks (< 20 lines, single file), you can skip the pipeline and just
describe the change directly.

--------------------------------------------------------------------------------
  OTHER USEFUL COMMANDS
--------------------------------------------------------------------------------

  /tools:handoff     Save session state before closing (resume later)
  /tools:catchup     Restore context from last session
  /tools:commit      Quality-checked git commit with pre-flight scan
  /tools:research    Spawn parallel agents to investigate a topic
  /tools:kv          Quick key-value notes (set/get/list)

  /pm:prd            Guided product requirements doc
  /pm:epic           Break a PRD into tracked tasks in ROADMAP.md
  /pm:status         Snapshot of current project state

--------------------------------------------------------------------------------
  PROJECT STRUCTURE (what got created)
--------------------------------------------------------------------------------

  CLAUDE.md                    Project constitution — rules, stack, conventions
  ROADMAP.md                   Task tracking (Todo / In Progress / Done / Blocked)
  global-CLAUDE.md             Template for ~/.claude/CLAUDE.md (used by /tools:init)
  CLAUDE.template.md           Clean template used when bootstrapping new projects
  docs/
    product.md                 Product vision (filled in by /tools:init)
    tech.md                    Tech stack decisions
  .claude/
    commands/                  All slash commands (workflows/, tools/, pm/)
    agents/                    Sub-agent persona definitions
    skills/                    On-demand protocols (SDD, TDD, session management)
    knowledge/                 Compounding project knowledge vault
    sessions/                  Session handoff files (gitignored)
    specs/                     Feature specs created by the workflow pipeline
    rules/                     Glob-matched contextual rules (api, tests)
    hooks/                     Post-tool-use auto-formatter
    security/                  MCP output validation (optional)
    settings.json              Model config and permission allowlist
  scripts/
    new-project.sh             Bootstrap a new project from this template
    memory-search.sh           Search across all knowledge and session files
    audit-context.sh           Estimate token cost of loaded context

--------------------------------------------------------------------------------
  TIPS
--------------------------------------------------------------------------------

- Run /tools:handoff before ending any session that has work in progress.
  This saves a structured YAML snapshot so you can resume with zero context loss.

- The knowledge vault (.claude/knowledge/) compounds over time. Decisions,
  patterns, and bug root causes get appended there and are referenced by the
  workflow commands automatically.

- Sub-agents (used by /workflows:build and /workflows:review) run on Haiku
  by default to keep costs low. The primary session uses Sonnet. Change this
  in .claude/settings.json under CLAUDE_CODE_SUBAGENT_MODEL.

- Use /clear between unrelated tasks. A fresh context window is the single
  most impactful performance optimization.

- The ROADMAP.md legend:
    [ ]  Todo
    [-]  In Progress
    [x]  Done
    [!]  Blocked

================================================================================
