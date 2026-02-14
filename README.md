# Companion

This repository uses an **agent coordination workflow** focused on running multiple agents in parallel.

## Working model
- Use GitHub Issues as the source of truth for tasks.
- Use `.github/ISSUE_TEMPLATE/copilot-agent-task.yml` for agent-assignable work.
- Split work into parallel tracks (A/B/C/D) to keep agents unblocked.
- Use `docs/agent-backlog.md` as the assignment board.
- Follow `.github/copilot-instructions.md` for execution, handoff, and integration rules.

## Quick start for maintainers
1. Break upcoming features into independent parallel tracks.
2. Create one issue per track from the Copilot Agent Task template.
3. Assign each issue to `github-copilot`, `codex`, or `pair`.
4. Require one PR per issue with verification output and integration notes.
5. Merge by dependency order and open follow-up integration issues as needed.
