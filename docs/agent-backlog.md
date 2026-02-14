# Agent Backlog

Use this backlog to coordinate work between GitHub Copilot and Codex-style agents.

## Parallel workflow
1. Split a feature into parallel tracks (A/B/C/D).
2. Create one issue per track from **Copilot Agent Task** template.
3. Assign each issue to an agent.
4. Agent creates a branch: `agent/<issue-number>-<slug>`.
5. Agent ships one PR per issue.
6. Merge PRs in dependency order; open follow-up issues for integration gaps.

## Parallel track map
- **Track A (Product/UI):** user-facing behavior and interaction flow
- **Track B (API/Data):** contracts, schema, storage, backend behavior
- **Track C (Quality):** tests, CI, lint, observability hooks
- **Track D (Docs/Release):** docs, migration notes, rollout checklist

## Suggested initial task set (parallelizable)

### A1) UX and navigation baseline
- **Agent:** github-copilot
- **Issue title:** `[Agent Task] Define user flow and navigation baseline`
- **Track:** A
- **Depends on:** none
- **Deliverable:** user-flow doc or initial UI structure

### B1) API contract scaffold
- **Agent:** codex
- **Issue title:** `[Agent Task] Add API contract scaffold`
- **Track:** B
- **Depends on:** none
- **Deliverable:** contract/types and example endpoint stubs

### C1) CI + test harness
- **Agent:** codex
- **Issue title:** `[Agent Task] Add CI and minimal test harness`
- **Track:** C
- **Depends on:** B1 for API targets (optional)
- **Deliverable:** CI workflow + smoke tests

### D1) Contribution and release process
- **Agent:** github-copilot
- **Issue title:** `[Agent Task] Add contribution guide and release checklist`
- **Track:** D
- **Depends on:** none
- **Deliverable:** CONTRIBUTING + release checklist

## Assignment board

| Issue | Track | Agent | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| (create) A1 UX/navigation baseline | A | github-copilot | ready | none | Can start now |
| (create) B1 API contract scaffold | B | codex | ready | none | Can start now |
| (create) C1 CI + test harness | C | codex | ready | optional B1 | Prepare early |
| (create) D1 Contribution/release docs | D | github-copilot | ready | none | Run in parallel |
