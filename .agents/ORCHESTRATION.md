# AXIS Parallel Orchestration Protocol

## Goal

Enable Codex, Claude, and Copilot to deliver features in parallel with minimal merge conflict risk.

## Branching Convention

- `feat/codex/<ticket-id>-<slug>`
- `feat/claude/<ticket-id>-<slug>`
- `feat/copilot/<ticket-id>-<slug>`

## File Ownership Matrix

- `apps/server/src/**`: default owner `Codex`
- `apps/web/src/**`: default owner `Claude`
- `docs/**`, `.agents/**`, CI, lint rules: default owner `Copilot`

## Parallel Phases

### Phase 1: Foundations

- Codex: server runtime, orchestrator, API contracts.
- Claude: dashboard shell, card layouts, polling hook.
- Copilot: docs, setup automation, issue templates.

### Phase 2: Integrations

- Codex: provider adapters and message normalization.
- Claude: settings pages and onboarding UX.
- Copilot: e2e scripts and release checklists.

### Phase 3: Hardening

- Codex: reliability (retry, backoff, durable storage).
- Claude: accessibility and responsive tuning.
- Copilot: CI gates and contributor docs.

## Handoff Template

Use this in PR descriptions:

```md
## Scope
- Ticket:
- Owner:
- Paths:

## Contract Checks
- [ ] No writes outside owned paths
- [ ] API schema unchanged OR schema changes documented
- [ ] Tests run

## Handoff Notes
- Risks:
- Follow-ups:
```

## Conflict Resolution

1. The owner of the touched path decides final merge plan.
2. If API contracts change, block dependent PRs until `docs/contracts.md` is updated.
3. Prefer additive changes over large rewrites.
