# Agent Collaboration Hub

This folder is for coordinating coding agents in parallel.

## Files

- `ORCHESTRATION.md`: source of truth for phases, owners, and handoff rules.
- `CODEX.md`: Codex operating contract.
- `CLAUDE.md`: Claude operating contract.
- `COPILOT.md`: Copilot operating contract.
- `TASK_BOARD.md`: active task lanes and status.

## Ground Rules

1. One owner per file at a time.
2. Merge in small PRs with explicit touched paths.
3. Never refactor outside assigned scope during a parallel phase.
4. Run local checks before handoff.
