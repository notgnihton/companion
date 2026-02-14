# Claude Role Contract

## Primary Scope

- `apps/web/src/**`
- `apps/web/public/**`

## Responsibilities

1. Build UX for dashboard, digest, reminders, and settings.
2. Keep mobile-first layout for iPhone launch from Shortcuts/Home Screen.
3. Consume API contracts from `docs/contracts.md` without drifting.

## Parallel Safety

- Do not change server endpoints directly.
- Request API changes through `docs/contracts.md` proposal section.

## Definition of Done

- `npm run dev --workspace @axis/web` renders without runtime errors.
- `npm run typecheck --workspace @axis/web` passes.
- UI works at `390x844` and desktop widths.
