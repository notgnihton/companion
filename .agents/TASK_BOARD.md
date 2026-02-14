# Task Board

Tasks are managed via GitHub Issues. This file is a snapshot.

## Active Agents

- **@copilot** — Docs, CI, config, tests, orchestration
- **@codex** — Server, backend, API, runtime
- **@claude** — Frontend, UI, components, styling

## How Work Flows

1. Orchestrator scans codebase → creates issues
2. Issues assigned to best agent
3. Agent works → creates PR
4. Auto-merge pipeline handles the rest
5. Recursive orchestrator issue triggers next scan

## View Live Board

```bash
# All open agent tasks
gh issue list --label agent-task --state open

# Recently closed
gh issue list --label agent-task --state closed --limit 10

# Agent PRs
gh pr list --label agent-task
```
