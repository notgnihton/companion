# Companion

An autonomous, self-improving project powered by GitHub's native AI agents.

## How It Works

```
Orchestrator (daily + on issue close)
  │
  ├─ Scans codebase for TODOs, missing tests, doc gaps
  ├─ Creates well-scoped GitHub issues
  ├─ Assigns each to the best agent:
  │     @copilot  → docs, CI, config, tests
  │     @codex    → server, backend, API
  │     @claude   → frontend, UI, components
  │
  └─ Creates a new orchestrator issue (recursive ♻️)
       │
       Agent works on issue → creates PR → auto-merges
       │
       Orchestrator issue closes → triggers next scan
       │
       ♻️ Loop continues forever
```

### Agents

| Agent | Strength | Assigned Work |
|-------|----------|--------------|
| **@copilot** | Native GitHub integration, GPT-5 / Claude Sonnet 4.5 | Docs, CI, config, tests, meta-tasks |
| **@codex** | Deep code generation, gpt-5.3-codex | Server, backend, runtime, API |
| **@claude** | UI/UX, reasoning, Claude Sonnet 4.5 | Frontend, components, styling |

### Workflows

| Workflow | Purpose |
|----------|---------|
| `orchestrator.yml` | Discover work → create issues → assign agents |
| `agent-auto-pr.yml` | Auto-create PRs from `agent/*` branches |
| `agent-pr-automation.yml` | Auto-rebase and auto-merge agent PRs |

### The Recursive Loop

The orchestrator creates a special issue: *"🔄 Orchestrator: discover and assign new work"*. This issue is assigned to `@copilot`. When Copilot completes it (or it's closed), the workflow fires again — creating the next batch of issues and the next orchestrator issue. The loop runs forever.

## Quick Start

```bash
# Trigger the orchestrator manually
gh workflow run orchestrator.yml

# Or create an issue and assign to an agent
gh issue create --title "Add health check endpoint" \
  --body "## Scope\nAdd GET /health\n\n## Deliverable\nReturns {status: ok}" \
  --label "agent-task" \
  --assignee "copilot"
```

## Project Structure

```
apps/
  server/    → Backend (Codex territory)
  web/       → Frontend (Claude territory)
docs/        → Documentation (Copilot territory)
.agents/     → Agent coordination & contracts
.github/
  scripts/   → Orchestrator script
  workflows/ → Automation workflows
```

## Working Model

- **Issues are the source of truth** — all work starts as an issue
- **Agents are assignees** — `@copilot`, `@codex`, `@claude`
- **Auto-merge pipeline** — agent branches → PR → rebase → merge
- **No CLI wrappers** — GitHub handles agent execution natively
- **Recursive discovery** — the system finds its own work

### For Manual Contributions
1. Create issues without `agent-task` label
2. Work on them manually in feature branches
3. Create PRs normally
4. Manual review and merge
