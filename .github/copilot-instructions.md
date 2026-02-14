# Copilot Collaboration Protocol

This repository is managed through an **agent-orchestrated workflow** where GitHub Copilot and Codex-style agents collaborate.

## Objective
Keep work moving asynchronously by assigning small, verifiable tasks to agents and tracking outcomes in issues/PRs.

## How agents should work in this repo
1. Pick one issue or task at a time.
2. Restate acceptance criteria before coding.
3. Make minimal, focused changes.
4. Run relevant checks locally.
5. Open a PR that references the issue and includes:
   - Summary of change
   - Validation steps + results
   - Follow-up tasks (if any)

## Task decomposition rules
- Prefer tasks that can be completed in one PR.
- Each task must define:
  - Scope (in/out)
  - Deliverable
  - Verification command(s)
- If blocked, create a "blocked" update with proposed unblocking options.

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
