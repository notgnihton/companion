# Companion

This repository uses an **agent coordination workflow** for ongoing development.

## Working model
- Use GitHub Issues as the source of truth for tasks.
- Use `.github/ISSUE_TEMPLATE/copilot-agent-task.yml` for agent-assignable work.
- Use `docs/agent-backlog.md` to keep a lightweight assignment board.
- Follow `.github/copilot-instructions.md` for execution and handoff rules.

## Quick start for maintainers
1. Create issues from the Copilot Agent Task template.
2. Assign each issue to `github-copilot`, `codex`, or `pair`.
3. Require one PR per issue and include verification output.
4. Merge or create a follow-up issue to continue the chain.
