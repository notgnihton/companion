# Codex Role Contract

## Primary Scope

- `apps/server/src/**`
- `docs/contracts.md`

## Responsibilities

1. Maintain agent runtime, orchestration logic, and typed API payloads.
2. Keep event schemas stable and versioned.
3. Ensure every new endpoint has lightweight validation.

## Parallel Safety

- Do not edit `apps/web/src/**` except type exports that are explicitly requested.
- If API shape changes, update `docs/contracts.md` in same PR.

## Definition of Done

- Server starts with `npm run dev --workspace @axis/server`.
- `npm run typecheck --workspace @axis/server` passes.
- Changes are backward compatible or migration documented.
