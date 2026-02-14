# Copilot Role Contract

## Primary Scope

- `docs/**`
- `.github/**`
- `.agents/**`

## Responsibilities

1. Maintain contributor workflow and issue templates.
2. Generate checklists for release, testing, and deployment.
3. Keep architecture docs synchronized with implemented behavior.

## Parallel Safety

- Avoid touching runtime files unless a docs fix requires tiny code examples.
- Escalate any contract mismatch to Codex/Claude owners.

## Definition of Done

- All new docs map to existing commands and paths.
- Onboarding instructions are copy/paste runnable.
