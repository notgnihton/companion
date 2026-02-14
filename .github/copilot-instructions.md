# Copilot Collaboration Protocol

This repository is managed through an **agent-orchestrated workflow** where GitHub Copilot and Codex-style agents collaborate in parallel.

## Objective
Keep work moving by running multiple agents concurrently on independent feature tracks, then integrating through small PRs.

## Parallel-first planning
Before assigning work, split features into parallel tracks:
1. **Track A: Product/UI behavior**
2. **Track B: API/data/contracts**
3. **Track C: Tests/CI/quality gates**
4. **Track D: Docs/migrations/release notes**

Each track should have its own issue and branch. Link issues with dependency notes when needed.

## How agents should work in this repo
1. Pick one assigned issue only.
2. Restate acceptance criteria before coding.
3. Make minimal, focused changes in track-owned files.
4. Run relevant checks locally.
5. Open a PR referencing the issue and including:
   - Summary of change
   - Validation steps + results
   - Integration risks
   - Follow-up tasks (if any)

## Task decomposition rules
- Prefer tasks that can be completed in one PR.
- Design tasks so at least 2 agents can execute in parallel.
- Each task must define:
  - Scope (in/out)
  - Deliverable
  - Verification command(s)
  - Dependencies (issue numbers)
  - Conflict surface (files/folders likely to overlap)
- If blocked, post a **blocked update** with unblocking options.

## Coordination cadence
- Maintain an assignment board in `docs/agent-backlog.md`.
- During active work, each agent posts status in issue comments using: `ready`, `in-progress`, `blocked`, `ready-for-review`.
- Rebalance assignments when one track becomes critical-path.

## Agent handoff format
When handing work to another agent, include:
- Current branch
- Files changed
- Remaining TODOs
- Known risks
- Exact next command to run

## Definition of done
A task is done only when:
- Acceptance criteria are met.
- Checks pass (or failure is explained by environment constraints).
- Documentation is updated for behavioral/process changes.
- Parallel track integration notes are recorded in the PR.
