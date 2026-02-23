================================================================================
  PROJECT OS v2 — SETUP GUIDE
================================================================================

A spec-driven development scaffold for Claude Code. Gives you a full workflow
pipeline, memory system, sub-agent orchestration, observability, and quality
gates — all using Claude Code's native features with zero external dependencies.

--------------------------------------------------------------------------------
  PREREQUISITES
--------------------------------------------------------------------------------

1. Node.js 18 or higher
     https://nodejs.org

2. Claude Code CLI
     npm install -g @anthropic/claude-code

3. An Anthropic API key or Claude.ai Pro/Max subscription
     API key: https://console.anthropic.com
     Set it in your environment: ANTHROPIC_API_KEY=your-key-here

   On Mac/Linux — add to ~/.bashrc or ~/.zshrc:
     export ANTHROPIC_API_KEY=your-key-here

   On Windows — set via System Environment Variables or in PowerShell:
     $env:ANTHROPIC_API_KEY="your-key-here"

Optional (enhances specific features):
  - jq      — enables JSON parsing in /tools:dashboard and /tools:metrics
  - gh CLI  — enables PR creation via scripts/create-pr.sh

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
     - Offer two optional feature toggles:
         Obsidian: enables wikilinks and frontmatter in knowledge files
         Context7: creates .mcp.json with a live library docs MCP server

4. That's it. Your environment is configured.

--------------------------------------------------------------------------------
  CREATING A NEW PROJECT
--------------------------------------------------------------------------------

1. Run the bootstrap script from the Project OS folder:

     Mac/Linux:
       bash scripts/new-project.sh my-project-name ~/projects/my-project-name

     Windows (Git Bash or WSL):
       bash scripts/new-project.sh my-project-name C:/Users/YourName/projects/my-project-name

   This copies the full scaffold (commands, agents, hooks, scripts, rules,
   adapters) into a new folder and makes an initial git commit.

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
  THE WORKFLOW (v2 — 7 phases)
--------------------------------------------------------------------------------

Always start at the top. Never skip from idea to build.

  /workflows:idea my-feature     Capture idea, research feasibility, write brief
  /workflows:design my-feature   Turn brief into a technical spec
  /workflows:plan my-feature     Decompose spec into atomic tasks with [?] drafts
  /pm:approve my-feature         Promote [?] drafts to [ ] approved tasks  <-- NEW
  /workflows:build my-feature    Implement with wave-based parallel sub-agents
  /workflows:review my-feature   Adversarial quality gate (security, arch, tests)
  /workflows:ship my-feature     Final validation, PR generation, mark complete

For small tasks (< 20 lines, single file), you can skip the pipeline and just
describe the change directly.

OPTIONAL — Competitive implementation path:
  /workflows:compete my-feature T1          Spawn N parallel implementations
  /workflows:compete-review my-feature T1   Score them side-by-side, pick winner

--------------------------------------------------------------------------------
  ALL COMMANDS
--------------------------------------------------------------------------------

Workflow pipeline:
  /workflows:idea         Capture rough idea, spawn research agents, write brief
  /workflows:design       Adversarial first-principles design with self-review
  /workflows:plan         Decompose design into atomic tasks ([?] drafts, #TN IDs)
  /workflows:build        Wave-based parallel sub-agents with worktree isolation
  /workflows:review       Three isolated reviewers: security, arch, test coverage
  /workflows:ship         Pre-ship checklist, PR generation, metrics snapshot
  /workflows:compete      Spawn N competing implementations with diff strategies
  /workflows:compete-review  Side-by-side scoring to pick the best implementation

Tools:
  /tools:init             First-run setup — fill in placeholders, configure globals
  /tools:handoff          Save session state before closing (resume later)
  /tools:catchup          Restore context from last session handoff
  /tools:commit           Quality-checked git commit with pre-flight scan
  /tools:research         Spawn parallel agents to investigate a topic
  /tools:kv               Quick key-value notes (set/get/list/search)
  /tools:dashboard        Cross-project status dashboard — all Project OS projects
  /tools:metrics          Query activity logs: task durations, model splits, trends

Product management:
  /pm:prd                 Guided product requirements doc via Socratic discovery
  /pm:epic                Break a PRD into tracked tasks in ROADMAP.md
  /pm:status              Snapshot of current project state
  /pm:approve             Governance gate — promote [?] drafts to [ ] approved

--------------------------------------------------------------------------------
  ROADMAP.md FORMAT (v2)
--------------------------------------------------------------------------------

Task format: - [X] Description (depends: #T1) (agent: codex) #T2

Markers:
  [?]  Draft — pending /pm:approve
  [ ]  Todo — approved, ready for work
  [-]  In Progress — agent working on it
  [~]  Review — awaiting review pass
  [>]  Competing — multiple implementations racing
  [x]  Done
  [!]  Blocked — waiting on something external

Task IDs:    #TN on every task (e.g. #T1, #T12)
Deps:        (depends: #T1, #T2) — task won't appear as unblocked until deps are [x]
Agent:       (agent: codex) — routes task to a specific adapter (optional)

Scripts that automate ROADMAP management:
  scripts/unblocked-tasks.sh     Output JSON array of tasks ready to run
  scripts/validate-roadmap.sh    Check for cycles, dangling refs, state errors

--------------------------------------------------------------------------------
  PROJECT STRUCTURE
--------------------------------------------------------------------------------

  CLAUDE.md                    Project constitution — rules, stack, conventions
  CLAUDE.template.md           Clean template used when bootstrapping new projects
  CHANGELOG.md                 Release history
  ROADMAP.md                   Task tracking with DAG dependency graph
  global-CLAUDE.md             Template for ~/.claude/CLAUDE.md (used by /tools:init)
  project-os-guide.md          Extended architecture and implementation guide

  docs/
    product.md                 Product vision (filled in by /tools:init)
    tech.md                    Tech stack decisions
    knowledge/                 Compounding project knowledge vault
      architecture.md          Living system design doc
      decisions.md             Architecture decision records
      patterns.md              Established code conventions
      bugs.md                  Root causes and fixes
      metrics.md               Per-feature performance metrics template
      kv.md                    Key-value store
    specs/                     Feature specs (gitignored, created by pipeline)
    memory/                    Cross-session persistent memory (gitignored)
    research/                  Research artifacts (gitignored)

  .claude/
    commands/
      workflows/               idea, design, plan, build, review, ship,
                               compete, compete-review
      tools/                   init, handoff, catchup, commit, research,
                               kv, dashboard, metrics
      pm/                      prd, epic, status, approve
    agents/
      implementer.md           Writes code — no design authority
      researcher.md            Research only — no writes
      reviewer-security.md     Security-focused reviewer
      reviewer-architecture.md Architecture drift reviewer
      reviewer-tests.md        Test coverage reviewer
      documenter.md            Docs and comments
      roles.md                 Role definitions (Architect/Developer/Reviewer/Orchestrator)
      handoffs.md              Phase transition artifact contracts
      adapters/
        INTERFACE.md           Adapter contract spec
        claude-code.sh         Claude Code adapter (functional)
        codex.sh               Codex adapter (stub)
        gemini.sh              Gemini adapter (stub)
        aider.sh               Aider adapter (stub)
        amp.sh                 Amp adapter (stub)
    skills/                    On-demand protocols (spec-driven-dev, tdd, session)
    rules/                     Glob-matched contextual rules (api, tests, escalation)
    hooks/
      post-tool-use.sh         Auto-formatter after file edits
      post-mcp-validate.sh     Validates MCP server output against allowlist
      post-write-session.sh    Scrubs secrets from session handoff files
      tool-failure-log.sh      Logs tool failures (timestamp + name only)
      compact-suggest.sh       Warns when context is filling up
      log-activity.sh          JSONL event logging for metrics
      notify-phase-change.sh   Desktop/terminal notifications on phase transitions
      preserve-sessions.sh     Saves worktree sessions before cleanup
    security/
      mcp-allowlist.json       Approved external MCP servers
      validate-mcp-output.sh   MCP output validation helper
    sessions/                  Session handoff YAML files (gitignored)
    logs/                      Hook-generated JSONL event logs (gitignored)
    settings.json              Model config, permissions, and hook definitions

  scripts/
    new-project.sh             Bootstrap a new project from this template
    memory-search.sh           Search across all knowledge and session files
    audit-context.sh           Estimate token cost of loaded context
    scrub-secrets.sh           Redact API keys and tokens from any file
    unblocked-tasks.sh         Parse ROADMAP DAG, output unblocked tasks as JSON
    validate-roadmap.sh        Validate ROADMAP (cycles, dangling refs, consistency)
    create-pr.sh               Auto-generate PR with description from specs
    dashboard.sh               Cross-project status scanner

--------------------------------------------------------------------------------
  TIPS
--------------------------------------------------------------------------------

- Run /tools:handoff before ending any session that has work in progress.
  This saves a structured YAML snapshot so you can resume with zero context
  loss using /tools:catchup.

- Always run /pm:approve after /workflows:plan before building. This is the
  governance gate — it ensures you've consciously reviewed and approved every
  task before handing it to sub-agents.

- The knowledge vault (docs/knowledge/) compounds over time. Decisions,
  patterns, and bug root causes get appended there automatically during the
  build and review phases.

- Sub-agents (used by /workflows:build and /workflows:review) run on Haiku by
  default to keep costs low. The primary session uses Sonnet. Change this in
  .claude/settings.json under CLAUDE_CODE_SUBAGENT_MODEL.

- Use /clear between unrelated tasks. A fresh context window is the single
  most impactful performance optimization.

- For critical tasks, use /workflows:compete instead of /workflows:build to
  get N parallel implementations and pick the best via /workflows:compete-review.

- Activity is logged automatically to .claude/logs/activity.jsonl. Use
  /tools:metrics to query task durations, model distributions, and feature
  comparisons over time.

- Use /tools:dashboard (or bash scripts/dashboard.sh ~/projects) to see the
  status of all your Project OS projects at once.

- scripts/validate-roadmap.sh checks your ROADMAP.md for cycles, dangling
  dependency references, and state inconsistencies before /workflows:build runs.

================================================================================
