# Execution plan — R5 W1: extract `wmsReservationService`

**Date:** 2026-11-19
**Slug:** r5-w1-extract-reservation-service
**Branch:** feat/r5-w1-extract-reservation-service (from `refs/remotes/pr/9990`, tip `3bd0cf1484`)
**PR base:** main (stacked on #9990 and #9988)
**Source spec:** .ai/specs/2026-08-14-availability-contract.md — §4.1b, §12 (W1 rows), §13 Phase 3 step W1, §15
**Re-landing plan card:** "W1" of `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` (see Assumptions)
**Reference implementation:** closed PR #8268 at `bdb747c36a` (diff base `b7b5309ccc`); method bodies from fork commit `4f9534f849`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Move the shared scope, transaction and balance helpers to commands/shared.ts | inline | done | 8ef55e8422 |
| 1 | 1.2 | Add WmsReservationService with reserveInTransaction and releaseInTransaction | inline | done | 60e2f9219b |
| 1 | 1.3 | Turn wms.inventory.reserve and .release into wrappers over the DI service | inline | done | ec6793c823 |
| 1 | 1.4 | Recognise CrudHttpError by brand at the wms catch sites and automation predicates | inline | done | 20131b5262 |
| 1 | 1.5 | Prove a caller-transaction rollback leaves no reservation writes against Postgres | inline | done | pending |

## Goal

Move the bodies of `wms.inventory.reserve` and `wms.inventory.release` into a DI service `wmsReservationService` whose methods take the caller's `EntityManager`, so a later in-process caller (`availability`, AV2a) can run them inside its own transaction. The commands become thin wrappers. No behaviour change.

## Scope (packages/core/src/modules/wms/)

- `lib/wmsReservationService.ts` (new): `WmsReservationService` with `reserveInTransaction(trx, ctx, input)` / `releaseInTransaction(trx, ctx, input)` — bodies from `4f9534f849` L401–549 / L551–609 (`innerTrx` inside); types `AllocationBucket`, `ReservationMetadata` (no `coverageClaimedForOrderConversion`), `ReserveInTransactionResult` (no `sourceHeldQuantity`), `ReleaseInTransactionResult`; helpers from REF_HEAD L424–569 and L630–767 (`listCandidateBalances` keeps #5621's `isBalanceLocationReservable` filter); header L1–25.
- `di.ts`: register `wmsReservationService`.
- `commands/inventory-actions.ts`: edited in place (main's file, never the fork's) — moved helpers deleted, `resolveReservationService`, thin wrappers; `allocate` imports `extractReservationMetadata`, `findReservationBucketBalance`, `requireReservation`, `AllocationBucket` back from the service; unused imports dropped.
- `commands/shared.ts`: the ten moved helpers (`Scope`, `resolveScope`, `runInTransaction(em, operation)` — two parameters, `toNumber`, `setNumeric`, `getAvailableQuantity`, `isUniqueConstraintError`, `findExactBalanceForUpdate`, `requireWarehouse`, `loadProfileForVariant`).
- `isCrudHttpError` instead of `instanceof CrudHttpError`: `api/inventory/helpers.ts`, `api/inventory/import/helpers.ts`, `api/scan/{putaway,receive,resolve-location,resolve-lot}/route.ts`, `applyInventoryImport` (`lib/inventoryImportService.ts`), the two predicates of `lib/salesOrderInventoryAutomation.ts`.
- Tests: `lib/__tests__/wmsReservationService.test.ts` (REF L1–216 + L365–460: 6 cases); `commands/__tests__/inventory-actions.reserve-release.test.ts` (import + DI stub only); `lib/__tests__/inventoryImportService.test.ts` (+1 case); a real-Postgres caller-rollback suite (spec §12 W1 row 2).

## Non-goals

- W1b: savepoint replay, non-`active` release guard, `runInTransaction` options.
- AV1: `rejectSourceTypes`, `'checkout'` source and its command guard.
- AV2a: `reserveLinesForCheckout`, `emitSideEffects`.
- AV2b: `convertInTransaction` (no stub), `sourceTargetQuantity` / `sourceHeldQuantity`.
- AV3: `listActiveReservationsBySourceType`.
- `instanceof CrudHttpError` in `api/dashboard/operational`, `api/sales-orders/[salesOrderId]/warehouse-assignment` and `lib/asnVendor.ts` — untouched (no service error reaches them).

## Implementation Plan

### Phase 1 — the move

#### Step 1.1 — Move the shared scope, transaction and balance helpers to commands/shared.ts
Cut the ten helpers out of `commands/inventory-actions.ts` into `commands/shared.ts` verbatim (REF diff of `shared.ts`, minus `runInTransaction`'s `options`), import them back. Pure move; every existing wms unit test passes.

#### Step 1.2 — Add WmsReservationService with reserveInTransaction and releaseInTransaction
New `lib/wmsReservationService.ts` per Scope, registered in `di.ts` as `asFunction(() => new WmsReservationService()).scoped().proxy()`. Unit suite with the six REF cases (lock order + split allocation, idempotent replay, ambient transaction, insufficient_stock, release decrement, balance_integrity_violation).

#### Step 1.3 — Turn wms.inventory.reserve and .release into wrappers over the DI service
Delete the moved helpers and the two inline bodies from `inventory-actions.ts`; add `resolveReservationService(ctx)`; the commands fork `em` as today, call the service, keep their post-commit work (CRUD side effects, `wms.inventory.reserved`/`.released`, low-stock check). Command test gains the import and the DI stub only.

#### Step 1.4 — Recognise CrudHttpError by brand at the wms catch sites and automation predicates
Swap `instanceof CrudHttpError` for `isCrudHttpError` at the six `wms/api` catch sites, `applyInventoryImport` and the two `salesOrderInventoryAutomation` predicates. `inventoryImportService.test.ts` gains the foreign-bundle case.

#### Step 1.5 — Prove a caller-transaction rollback leaves no reservation writes against Postgres
`lib/__tests__/wmsReservationService.integration.test.ts` (gated by `OM_PG_INTEGRATION=1`, testcontainers Postgres): `reserveInTransaction` then `releaseInTransaction` inside a caller's `em.transactional()` that throws afterwards leave no reservation row and an unchanged balance. Add `wms/.+\.integration` to `test:pg-integration`'s selection so CI runs it.

## Spec vs card differences (rule R4: the spec wins)

1. **Caller-rollback test (spec §12, W1 row 2)** — not on the card; added as Step 1.5.
2. **`emitSideEffects` (spec §13 W1 lists it among the moved methods; the card defers it to AV2a).** Deliberate deviation, kept on the card's side: §4.1b defines `emitSideEffects(ctx, sideEffects: WmsSideEffects)` to also emit `wms.inventory.reserved`/`.released` and run the low-stock check (D-R5-AV8), and `WmsSideEffects.released` is AV2a's shape. The same W1 paragraph says the commands *keep* their post-commit work, so in W1 the method would have no caller (inert, which the card forbids) or would re-route the commands' events (a redesign the reference does not contain). It lands in AV2a with its first caller. Flagged in the PR body for the reviewer.
3. **Spec §4.1b signatures** list `options` on `reserveInTransaction`/`releaseInTransaction`; W1 ships the two-argument-plus-input form. The options are additive and arrive with AV1/AV2b, as §15 allows ("later changes additive only").

## Audit findings and decisions that concern W1

From `.ai/analysis/pre-implement-2026-08-14-availability-contract-release-5.md` and the spec's 2026-11-19 changelog:

- **I9** — `isCrudHttpError` at the six `wms/api` catch sites plus the automation predicates is a W1 deliverable; TC-WMS-002/021/027 are part of the gate; "no behaviour change" holds only for W1 (savepoint replay and the release guard are W1b). → Step 1.4, gate.
- **I19 / B1** — file `wms/lib/wmsReservationService.ts`; methods `(trx, ctx, input)`; release returns `quantity: string`. → Step 1.2.
- **A1** — one transaction via a `wms` service; caller-transaction composition. → Steps 1.2, 1.5.
- **C2 / D-R5-AV7** — global lock order is `listCandidateBalances`' `(created_at, id)`; the move must keep it. → Step 1.2 (unit case asserts the `orderBy`).
- **I11** — real-Postgres suites need CI selection in `test:pg-integration`. → Step 1.5 adds `wms`.
- D-R5-AV1…AV6, AV8 — concern AV1/AV2a/AV2b; nothing to do in W1.

## Assumptions

- The binding re-landing plan file (`.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md`) was not present in the primary checkout or any git ref when this run started. The run proceeds on the W1 card text as quoted in the task order, which restates the card's scope, non-goals, must-keeps, gate and PR shape; common rules R1–R14 were applied only as far as the order cites them (R1 port-not-redesign with the `4f9534f849` body exception; R4 spec wins).

## Risks

- Errors now cross a DI boundary: a missed `instanceof` would turn a 409 into a 500 (TC-WMS-002/021/027). Mitigated by Step 1.4 and the foreign-bundle unit case.
- Lock order must stay identical (deadlock-freedom argument of D-R5-AV7). Mitigated by moving `listCandidateBalances` verbatim and asserting its `orderBy`.
- Editing `packages/core/package.json` (Step 1.5) makes CI run the dependency audit; it fails only on advisories a PR introduces.

## External References

None (`--skill-url` not passed).
