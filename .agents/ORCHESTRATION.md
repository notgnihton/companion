# Agent Orchestration Protocol

## Architecture

Issues are the **only interface**. Agents are GitHub-native assignees.

```
Orchestrator script
  → scans codebase
  → creates issues  
  → assigns @copilot / @codex / @claude
  → creates recursive orchestrator issue
  → loop ♻️
```

## Agent Assignment Rules

| Domain | Agent | Reason |
|--------|-------|--------|
| `apps/server/**` | `@codex` | Best at system-level code, API design |
| `apps/web/**` | `@claude` | Best at UI/UX, component design |
| `docs/**`, `.agents/**` | `@copilot` | Native GitHub integration, meta-tasks |
| CI, workflows, config | `@copilot` | Understands GitHub Actions natively |
| Tests | `@copilot` | Good coverage analysis |
| Ambiguous / meta | `@copilot` | Default for orchestration |

## Issue Format

Every issue must have:
```markdown
## Scope
What to do (and what NOT to do)

## Deliverable
Concrete output expected

## Verification
How to confirm it's done
```

## Recursive Loop

The orchestrator creates a meta-issue assigned to `@copilot`:
> "🔄 Orchestrator: discover and assign new work"

When closed, the `orchestrator.yml` workflow fires again → next scan → next issues → next meta-issue → ♻️

## Parallel Phases

### Phase 1: Foundations
- Codex: server runtime, orchestrator, API contracts
- Claude: dashboard shell, card layouts, polling hook
- Copilot: docs, setup automation, issue templates

### Phase 2: Integrations
- Codex: provider adapters and message normalization
- Claude: settings pages and onboarding UX
- Copilot: e2e scripts and release checklists

### Phase 3: Hardening
- Codex: reliability (retry, backoff, durable storage)
- Claude: accessibility and responsive tuning
- Copilot: CI gates and contributor docs
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
