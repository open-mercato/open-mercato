# Checkpoint 1 - Steps 2.2a..2.6a

**Recorded:** 2026-09-19T14:54:24Z
**Steps covered:** 2.2a, 2.2b, 2.3, 2.4, 2.6a
**Commit range:** `0e94e1179..71102151b` (5 code commits on `feat/market-display-profile-wave1b`)
**Runner:** local (no compose `app` container is running on this host; `omw` runs the dev server directly)

## Touched areas

| Area | What changed |
|---|---|
| `packages/shared/src/lib/display/` | `addressDisplayProfile` added; `formatMoney` gained a `notation` option |
| `packages/ui/src/backend/detail/` | `AddressEditor`, `AddressTiles`, `addressFormat` render from the address descriptor |
| `packages/core/src/modules/customers/` | address twin, list and detail surfaces, form factories, the whole calendar, the conflicts route |
| `packages/core/src/modules/sales/` | document money and date chokepoints, documents table, detail page, addresses, tax breakdown stamps |

## Checks

| Check | Scope | Result |
|---|---|---|
| `turbo run typecheck` | `@open-mercato/shared`, `@open-mercato/ui`, `@open-mercato/core` | pass |
| `yarn workspace @open-mercato/shared test` | `display` suite (37 tests) | pass |
| `yarn workspace @open-mercato/ui test` | `addressFormat` suites (11 tests) | pass |
| `yarn workspace @open-mercato/core test` | `customers` (268 suites / 1779 tests) | pass |
| `yarn workspace @open-mercato/core test` | `calendar` (21 suites / 225 tests) | pass |
| `yarn workspace @open-mercato/core test` | `sales` (128 suites / 1007 tests) | pass |
| `yarn generate` | repo | pass, no drift (`git status` clean apart from this run folder) |
| `yarn build:packages` | 38 packages | pass |
| `yarn i18n:check-sync` | 62 modules, 5 locales | pass, all in sync |
| `yarn i18n:check-usage` | repo | advisory only (4253 unused keys, pre-existing baseline) |

## UI verification - skipped at this checkpoint

The dev server runs and serves the app (`GET /backend` on the slot redirects to `/login` with `200`, `/` renders
`/start`), so the environment itself is healthy and the rebuilt packages compile.

Browser evidence is deliberately deferred to the final gate, for one reason that is not a tooling gap:

- This slot is attached to the **shared instance database** (this run adds no migration, so `omw up` was the right
  call per the task's environment note). Its admin credentials are not ones this run holds - the repository's
  documented seed login (`admin@acme.com`) is rejected, because the shared instance is not a freshly seeded tenant.
- More importantly, demonstrating the change **requires writing a US market display profile row**, and writing one on
  the shared instance database would change how every other slot on this host renders. That is exactly the case
  `CLAUDE.local.md` reserves `omw up --fresh` for.

Plan: take `omw up --fresh` at the final gate, seed a US profile, and capture the screenshots there. Per the loop
contract, UI verification does not block development, so Steps 2.7 onward continue meanwhile.

No `checkpoint-1-artifacts/` directory was created, because this checkpoint produced no artifacts.

## Notes

- A rules-of-hooks defect that predates this run was found and fixed in Step 2.4: `MonthGrid`'s `buildWeeks` is a
  plain function and was calling `useDisplayProfile()` from inside a `useMemo`.
- One deliberate rendering change for a tenant with no market is recorded in Step 2.3's commit message: the company
  card's "today, HH:MM" stamp now uses the short time style.
