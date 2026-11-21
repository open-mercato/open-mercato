# Checkpoint 1 — Steps 1.1–1.5

**Date:** 2026-11-19
**Runner:** local (no compose `app` container running)

## Targeted validation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p packages/core/tsconfig.json` after each of 1.1, 1.3, 1.4, 1.5 | clean |
| `npx jest src/modules/wms` (packages/core) after 1.1 / 1.3 / 1.4 / 1.5 | 94 suites, 688 → 689 tests passed; the pg suite is skipped without `OM_PG_INTEGRATION` |
| `npx eslint` on the changed wms files | clean |
| `OM_PG_INTEGRATION=1 jest wmsReservationService.integration.test.ts` (colima, testcontainers `postgres:16-alpine`) | 3 passed |

## Move fidelity

- The 15 helpers moved into `lib/wmsReservationService.ts` are byte-identical to main's `commands/inventory-actions.ts`. The only differences are the multi-line signature of `requireReservation` and the added return-type annotations (scripted per-function diff).
- The `reserveInTransaction` and `releaseInTransaction` bodies are identical to main's two command bodies once `innerTrx` is read as `trx` (scripted diff: `BODY 1 IDENTICAL`, `BODY 2 IDENTICAL`).
- `listCandidateBalances` keeps #5621's `isBalanceLocationReservable` filter and its `orderBy: { createdAt: 'asc', id: 'asc' }` lock order; the first service unit case asserts both lock mode and order.

## Regression proofs (each new test fails without its fix)

- `inventoryImportService.test.ts` › "reports the branded error code of a CrudHttpError thrown from another bundle": with `instanceof CrudHttpError` restored in `applyInventoryImport` → 1 failed / 19 passed.
- `wmsReservationService.integration.test.ts` › reserve rollback: with the service running on `trx.fork()` instead of the caller's `trx` → 1 failed / 2 passed.

## UI / browser checks

Skipped. No UI file is touched.

## Integration (Playwright)

Not run at this checkpoint. TC-WMS-002/021/027 are left for the final gate.
