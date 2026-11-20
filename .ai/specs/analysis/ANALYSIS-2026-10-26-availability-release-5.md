# Pre-Implementation Analysis: Availability Contract — Phase 3 (Reservations), eComm Release 5

> **Spec**: `.ai/specs/2026-08-14-availability-contract.md` (Phases 1–2 implemented 2026-09-22; Phase 3 pending).
> **Scope of this analysis**: Phase 3 only: the `'checkout'` source type, `availability.reserve` / `.release` / `.commit`, the expiry and reconciliation jobs, and the shortfall events.
> **Verified against**: branch `feat/release-5-conversion` @ `3ca91c95d7`. This includes what Release 4 added to `availability` (`lib/quantityRules.ts`, D-R4-3) and the installed MikroORM v7 runtime. Every claim about the code cites the file it was read from.
> **Consumers checked**: checkout B.4 submit (`2026-03-19-checkout-simple-checkout.md` §7.1–7.4) and roadmap R5 (`2026-08-14-ecommerce-suite-roadmap.md`).
> **Issue prefix**: A. Related: `ANALYSIS-2026-10-26-customer-groups-release-5.md` (G), decisions `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` (D-R5-n).

## Executive Summary

The reservation design is sound in three respects:
- the hold is taken at submit, not at cart;
- commit changes the reservation in place and never releases first;
- the safety-stock gate is the authoritative check, not the read path.

The way §4.1 proposes to build it does not work on this codebase. Five Critical issues block Phase 3:

1. **No shared transaction.** `availability.reserve` cannot run its gate and the `wms` reserve calls in one transaction by "composing" `wms.inventory.reserve`. That command forks its own `EntityManager` and opens its own transaction on another connection. Holding the gate's locks therefore makes `wms` wait on its own caller, and not holding them reopens the safety-buffer race (A1).
2. **Phase 2 was never aligned with §4.2.** The gate would inherit its three defects (A2).
3. **Nowhere to keep the caller's key.** The caller's `idempotencyKey` has no home, so `release` and `commit` cannot find the hold (A3).
4. **No scope.** `release` and `commit` carry no tenant or organization (A4).
5. **The hold can expire during payment.** Checkout's 900 s hold can run out before `commit`. That leaves a paid order with nothing held, and checkout B.4 takes exactly this path (A5).

**Recommendation: needs spec updates first.** The fixes are additive:
- a transactional `wms` service beside the existing commands;
- one new `availability` table;
- an earlier commit point in checkout.

Three items need an owner decision (A5, A6, A14).

## Code baseline (what exists on the branch)

| Surface | State on branch | Source |
|---|---|---|
| `availability` module | Policies (entity, 6-level chain, CRUD, check tool, resolve preview). No reservation code, entity, command, worker or subscriber. | `availability/` tree; `availability/di.ts` |
| Events | `availability.policy.created/updated/deleted` only | `availability/events.ts` |
| Release 4 addition | `lib/quantityRules.ts` (`deriveQuantityRules`), a pure function imported by `ecommerce` and by `cart` (`commands/lines.ts:44`, `commands/merge.ts:16`) | D-R4-3 |
| Shared contract | `types.ts`, `registry.ts`, `catalogOnlyProvider.ts`; `AvailabilityQuery.bypassCache` (additive) | `packages/shared/src/lib/availability/` |
| `InventoryReservationSourceType` | `'order' \| 'transfer' \| 'manual'` (type and zod enum) | `wms/data/entities.ts:15`; `wms/data/validators.ts:16` |
| `InventoryReservation` | per **one warehouse** and one variant; `expires_at`, `status` (`active\|released\|fulfilled`), `idempotency_key`; **no `updated_at`**. The unique index on `(organization_id, idempotency_key)` covers only `status='active'` rows. | `wms/data/entities.ts:297-338` |
| wms idempotency key | Derived from `sourceType\|sourceId\|variant\|warehouse\|quantity`; it is not a caller key | `wms/lib/inventoryIdempotency.ts:37-52` |
| `wms.inventory.reserve` | `isUndoable: false`; requires `warehouseId`. Runs on `ctx.container.resolve('em').fork()` inside its own `transactional()`. Locks every balance of `(warehouse, variant)` with `FOR UPDATE` (ordered), allocates across locations and lots honoring lot eligibility, and replays idempotently. | `wms/commands/inventory-actions.ts:202-216,496-530,954-1080`; `wms/data/validators.ts:234-245` |
| `wms.inventory.release` | `reservationId` + `reason`; releases the **whole** row; no `quantity` input | `wms/data/validators.ts:247-252`; `inventory-actions.ts:1148-1240` |
| MikroORM v7 `fork()` | Does not keep the caller's transaction context unless `keepTransactionContext`, and `useContext` defaults to `false`. `transactional()` on the fork sees no existing transaction, so it opens a **new one on another connection**. | `node_modules/@mikro-orm/core/EntityManager.js` (`fork`, `getContext`, `transactional`); `utils/TransactionManager.js:18-23` |
| Phase 2 provider | `findProfile` **still falls back** to the product-level row on a variant lookup. Safety stock is subtracted per variant only, with no product pool. There is **no lot-eligibility filter**. `locationIds` filters `location_id`, while §4.1a/§4.2 say warehouses. | `wms/lib/availabilityCalculation.ts:86-99,148-153,294-323` |
| Sales-order automation | On `sales.order.confirmed` it tops up `source_type='order'` holds, splitting a variant across warehouses: preferred = assigned, else primary. It does this through `commandBus.execute('wms.inventory.reserve')` per bucket, **each its own transaction**. On `sales.order.cancelled` it releases `order` holds. | `wms/lib/salesOrderInventoryAutomation.ts:262-400`; `wms/subscribers/sales-order-confirmed-reserve.ts` |
| `sales.order.confirmed` | Emitted fire-and-forget (`void emit…`) on any status transition **into** `confirmed` | `sales/commands/documents.ts:969-990` |
| Expiry processing | **Nothing** reads `InventoryReservation.expires_at`; `wms` has no workers | `wms/` (no `workers/`) |
| Concurrency tests | `TC-WMS-030` (balance bucket concurrent create) only; no parallel-reserve test | `wms/__integration__/` |
| wms UI | The manual reserve dialog lists `['manual','order','transfer']` | `wms/components/backend/ReserveInventoryDialog.tsx:45` |

## Backward Compatibility

All 13 surfaces were checked. Phase 3 is additive if built as recommended.

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| A16 | 2 Types / 8 DB | `InventoryReservationSourceType` gains `'checkout'` in the exported type **and** the zod enum (`validators.ts:16`). The TS change is additive, but third-party exhaustive `switch`es break at compile time (spec R8). A tenant could also create a `'checkout'` hold by hand through the manual reserve API, and the expiry sweep would then release it. | Warning | Add the union member and an `UPGRADE_NOTES.md` entry (already planned in §15). Reject `sourceType: 'checkout'` on the public `wms` reserve route (system-only source); keep it off `ReserveInventoryDialog`; add an i18n label for listings. |
| A1-BC | 9 DI | The fix for A1 adds a `wms` DI service (`wmsReservationService`). It is additive, but a new contract surface. | OK (additive) | Name it and freeze it in §15 |
| — | 3 Signatures | `wms.inventory.release` gains optional `quantity` (§15), additive | OK | Also cover bucket shrink and key rebuild (A8) |
| — | 5 Events | New `availability.reservation.*` and `availability.shortfall.detected` ids; must not be confused with the existing `wms.inventory.reservation_shortfall` (A13) | OK | Payloads frozen on ship |
| — | 1, 4, 6, 7, 10, 11, 12, 13 | No renames or removals. Phase 3 adds no public routes; the optional admin list is A21. | OK | — |

### Missing BC Section

§15 exists and covers the source type and the `release.quantity` input. Add three items:
- the new `wms` transactional service and its DI key (A1);
- the new `availability_reservations` table (A3);
- the system-only rule for `'checkout'` on the public `wms` route (A16).

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Hold entity (§5) | `release` and `commit` by caller key, expiry, reconciliation and undo payloads have no row to work on (A3) | §5.3 `AvailabilityReservation` |
| Transaction design for reserve (§4.1) | The stated "same transaction as the wms reserve calls" is unbuildable through the command bus (A1) | §4.1b with lock order, service boundary and failure modes |
| Per-line outcome (§4.1) | The return shape cannot say `not_tracked`, `backorder` or `preorder` per line; wms-less and backorder tenants cannot check out (A6) | Per-line `outcome` |
| Warehouse allocation (§4.1) | `wms` needs a `warehouseId` per row; the spec never chooses one (A7) | Allocation rule |
| Hold lifecycle state machine | `active → committed / released / expired` transitions and who may race whom (commit vs expiry) are unstated (A5, A11) | State table with CAS guards |
| Event payloads (§9) | Subscribers and ops alerts cannot be written against bare ids (A13) | Payload types |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §4.1 signatures | `release`/`commit` lack scope (A4); there is no mismatch rule for a reused key (A15); `ttlSeconds` has no bounds (A17) | Fix signatures and zod |
| §4.4 confirmed-first path | Ignores the automation competing with the live checkout hold, key collision, and bucket metadata on partial release (A8) | Prefer avoiding the path (A5 option a); otherwise specify all three |
| §7 Oversell window | The timeline ends at "payment confirmed → commit". It omits the hold expiring during payment (A5) and the quote outcome (A9). | Add both |
| §10 Jobs | There is no worker, index, tenant iteration or CAS for expiry. "Checkout session no longer exists" cannot be checked from `availability` (A11, A12). | Redefine |
| §12 Coverage | The parallel last-unit test is single-warehouse only. Missing: cross-warehouse, product pool, non-checkout writer racing, expiry vs commit, wms-less checkout, backorder line (A20). | Extend |
| §13 Phase 3 | Does not list the Phase 2 alignment it depends on (A2) | Add as step 0 |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Never skip tenant/organization scoping | §4.1 `releaseAvailability({ idempotencyKey, reason })`, `commitAvailability({ idempotencyKey, orderId })` | A4 |
| No direct ORM relationships or business-logic imports across modules | The §4.1 gate "re-derives sellable … under locks" has to lock `wms` balance rows from `availability`. Doing it with `wms` entity imports or raw SQL on `wms` tables puts `wms`'s invariant in another module. | A1: the gate lives in `wms`, and `availability` soft-resolves it (`tryResolve`, `packages/core/AGENTS.md` → Cross-Module Coupling) |
| Background work through `@open-mercato/queue` workers, scoped payloads | §10 jobs have no worker definition | A11 |
| Commands for domain writes; undo must be real | §4.1 declares all three commands undoable, with undo paths that can themselves fail with `shortfall`. `wms` deliberately made the same operations non-undoable counter-actions. | A14 |
| Events declared with `createModuleEvents` | Phase 3 ids are not declared yet (expected); payloads are unspecified | A13 |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **A1** Gate and `wms` reserve in separate transactions | Two failure modes, depending on whether the gate holds its locks. With locks: submit hangs until `lock_timeout`/`idle_in_transaction` (120 s default), because `wms`'s `FOR UPDATE` waits on its own caller. Without locks: the safety buffer and pool are oversold under concurrency (R9 is back). Either way, multi-line all-or-nothing fails: earlier lines are committed when a later one shortfalls. | One transaction through a `wms` service (A1 fix) |
| **A5** Hold expires during payment | 3DS, BLIK, a bank redirect or a late gateway webhook pushes step 7 past 900 s. The sweep releases the stock, another buyer takes it, and the order is paid with nothing held. | Commit at document creation (A5 option a) plus CAS-fenced transitions |
| **A2** Gate built on the unaligned Phase 2 calculation | The pool is subtracted per variant (understock), quarantined or expired lots count as sellable (shortfall at reserve or a wrong admit), and location vs warehouse filtering is wrong | Align first, one shared SQL builder |
| **A6** wms-less or backorder tenant cannot check out | Checkout step 2 aborts on `reserved: false` (`ABORT 409 stock_shortfall`), so every order of a tenant without `wms`, and every backorder line, is refused | Per-line outcomes |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **A8** `sales.order.confirmed` fires at step 4 while the checkout hold still holds the stock | The automation finds no stock, emits a **false** `wms.inventory.reservation_shortfall` and reserves nothing. Commit later converts correctly, but ops sees phantom shortfalls. The rebuilt key can also collide with an automation row: a unique violation at commit. | Commit before confirm (A5 a); otherwise catch-and-merge on unique violation |
| **A9** Quote outcome keeps a checkout hold until expiry | 15 minutes of phantom-held stock per B2B quote, then no stock behind the quote | Release on quote outcome |
| **A11** Per-minute expiry scan without an index | Sequential scan of `wms_inventory_reservations` across tenants every minute | Partial index on the new hold table |
| **A12** Reconciliation cannot see checkout sessions | The job is unbuildable as written, or `availability` reads checkout tables directly | Redefine on hold-row ↔ wms-row drift |
| **A15** Same key, different items | A retry after a cart change returns the old hold, so the order is created against the wrong lines | 409 on mismatch |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Lock duration | Balance rows of the cart's variants (and pool siblings) stay locked for one short transaction | Keep the transaction free of external calls; lock in a stable order (balance id asc) |
| Deadlock against other writers | Other `wms` writers lock one `(warehouse, variant)` set per transaction | Single sorted lock statement in the gate; no other writer holds multi-variant locks |
| Cart imports `availability/lib/quantityRules` without a `requires` edge | A pure function in the same package, so there is no runtime coupling | None needed; note only |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **A1: build the gate and allocation as one transaction inside `wms`.**
  - *Problem.* §4.1 says `availability.reserve` "wraps `wms.inventory.reserve` per item" and re-derives sellable "under locks held in the same transaction as the wms reserve calls". The code makes this impossible:
    1. The command runs on `ctx.container.resolve('em').fork()` (`inventory-actions.ts:202-204`) inside its own `transactional()` (`:206-216`).
    2. In MikroORM v7 that fork carries no transaction context (`EntityManager.js` `fork`: `useContext ??= false`, no `keepTransactionContext`), so `transactional()` starts a new transaction on another connection (`TransactionManager.js:18-23`).
    3. The checkout spec already records the platform rule for its own steps (§7.2 step 4 note): "each commandBus.execute() call commits its own transaction".
  - *Fix.*
    1. Refactor the body of `wms.inventory.reserve` into an additive DI service, `wmsReservationService`, with `reserveInTransaction(trx, input)`, `releaseInTransaction(trx, …)` and `convertInTransaction(trx, …)`. The existing commands become thin wrappers, so nothing changes for current callers.
    2. Add `reserveLinesForCheckout(trx, { scope, lines, sourceType, sourceId, expiresAt })` to the same service. In one transaction it:
       - (a) locks with `FOR UPDATE`, ordered by id, every balance of every variant in the call plus every active variant of any product with a product-level pool;
       - (b) computes sellable per §4.2 (the A2-aligned builder) from the locked rows;
       - (c) checks per-variant and per-pool totals and returns `shortfall` without writing when any line fails;
       - (d) allocates across warehouses (A7) and inserts the rows.
    3. `availability.reserve` soft-resolves the service (`tryResolve`), writes its hold row (A3) in the **same** transaction, and commits once.
    4. Without `wms`, it skips the service and returns per-line `not_tracked` (A6).
- **A2: finish the Phase 2 alignment first.**
  - *Problem.* §13 Phase 2 already states the shipped provider must be fixed, and it has not been:
    - `findProfile` falls back to the product row (`availabilityCalculation.ts:148-153`);
    - there is no product-pool subtraction at rollup (`:294-323`);
    - there is no lot filter (`:94-99`);
    - `locationIds` filters `location_id` (`:86-90`), while §4.1a/§4.2 key on warehouses.
  - *Fix.* A Phase 3 "step 0" implements one SQL builder used by both the read provider (no locks) and the gate (locked variant), with the §12 R1, pool and ineligible-lot tests. Separately, decide whether `locationIds` means warehouses (contract text) or locations (code), and make the type name say it.
- **A3: add the hold entity.**
  - *Problem.* The caller's `idempotencyKey` (checkout `stock_reservation_key`) has nowhere to live:
    - wms rows store a derived key (`inventoryIdempotency.ts:37-52`), unique only while `active` (`entities.ts:301-305`);
    - `release`/`commit` by caller key cannot find the rows;
    - a key reused with different items is undetectable;
    - expiry and reconciliation have no per-hold record;
    - undo needs the reservation ids.
  - *Fix.* `AvailabilityReservation` (`availability_reservations`) with these columns:
    - `tenant_id`, `organization_id`;
    - `idempotency_key` (unique per tenant and organization);
    - `source_type`, `source_id`;
    - `status` (`active | committed | released | expired`);
    - `expires_at`;
    - `items` (jsonb snapshot: product, variant, quantity, per-line outcome);
    - `wms_reservation_ids` (jsonb);
    - `order_id`, `created_at`, `updated_at`.

    Every transition is a conditional update on the expected status. This is the fenced-lease rule from lesson `durable-quota-reservations-need-fenced-leases`.
- **A4: scope `release` and `commit`.** Both take `{ tenantId, organizationId }` and look the hold up by `(tenant, organization, idempotency_key)`. Same defect class as customer-groups G2.
- **A5: the hold must outlive payment (owner decision).**
  - *Problem.* Checkout takes the hold at step 2 with `ttlSeconds: 900` (§7.2) and commits only at step 7, after the gateway result, or step 8 for on-account. The expiry sweep (§10) releases any `active` checkout hold past `expires_at`. Two failures follow:
    1. A slow payment loses its stock before `commit`, and `commit` then finds a released hold.
    2. Even a fast payment can race the sweep.
  - *Options.*
    - **(a) Commit at document creation.** Checkout runs `availability.commit` right after step 4 creates the order, before payment. The hold becomes an `order` reservation:
      - it never expires, because nothing expires `order` rows;
      - a failed payment's compensation already cancels the order, and `wms` already releases `order` holds on `sales.order.cancelled`;
      - commit precedes any later confirmation, so A8 cannot occur.

      Cost: an unpaid order holds stock until payment fails or the order is cancelled. That is bounded by the gateway timeout plus checkout's recovery jobs.
    - **(b) Renew the lease.** Entering `awaiting_payment` extends `expires_at` (for example to 60 min), and the sweep skips holds whose session is `awaiting_payment`. Commit stays at payment. The cost is a second timeout to tune, and the A8 path stays reachable.
    - **(c) Longer TTL.** It shrinks the window without closing it.

    **Recommended: (a).** It also removes the confirmed-first branch of §4.4 from the checkout path.
  - Either way, `commit` and the sweep both use CAS on `status = 'active'`. A commit that loses to the sweep tries one fresh reserve, and on shortfall surfaces `stock_lost_after_payment` for ops (raising a notification), never silently.

### Important Gaps (Should Address)

- **A6: per-line outcomes; no-`wms` and policy semantics (owner decision on backorder).**
  - *Problem.* The return shape is `{ reserved, reservationIds, expiresAt, shortfall }`. The "reason `not_tracked`" that §4.1 promises for the no-`wms` case is not representable, and checkout aborts on `reserved: false`. Backorder, preorder and non-stock-managed lines are not mentioned at all.
  - *Fix.* Return `lines: Array<{ key, outcome: 'held' | 'not_tracked' | 'preorder' | 'backorder' | 'shortfall', heldQuantity, backorderQuantity }>`; `reserved` is true when no line has `shortfall`. Rules:
    - not stock-managed, or no `wms`: `not_tracked`, nothing held;
    - preorder before `releaseAt`: nothing held;
    - backorder: **recommended** to hold `min(requested, sellable)` and admit the rest as backorder (owner decision; the alternative holds nothing).

    Line policy comes from `policyResolutionService` (already in DI).
- **A7: warehouse allocation.** `wms` rows need a `warehouseId` (`validators.ts:234-245`), and the spec never picks one (Open Question 2 assumes all locations).
  - Reuse the automation's ordering, extracted to a shared helper: `sortWarehouseAvailabilityForReservation`, preferring the primary warehouse (`salesOrderInventoryAutomation.ts:307`).
  - Use one wms row per `(variant, warehouse)`.
  - Store-to-warehouse mapping stays out of scope and is stated.
- **A8: the §4.4 confirmed-first path, if kept.**
  - *Problem.*
    - The automation competes with the live checkout hold for the same stock, which produces a false `wms.inventory.reservation_shortfall` and no `order` rows.
    - `commit`'s rebuilt key can equal an automation row's key (same source, variant, warehouse and quantity), which is a unique violation (`entities.ts:301-305`).
    - The new partial `release.quantity` must shrink `metadata.allocatedBuckets` (spec silent; recommend newest bucket first) and rebuild the key, because quantity is part of it (`inventoryIdempotency.ts:51`).
  - *Fix.* With A5 (a), checkout never takes this path; keep it only for integrators who confirm first, and specify the three points.
- **A9: quote outcome.** Checkout §7.2 step 5 completes a quote with no `commit`, so the hold lingers until expiry and backs nothing. Release the hold at step 5. A quote is non-binding; stock is taken when the merchant converts and confirms, through the existing automation. Record this in checkout §7.2 and in §7 here.
- **A10: roadmap R5 contradicts checkout.**
  - *Problem.* R5's mitigation says the reservation happens "inside the order transaction". Checkout §7.2 (fixed 2026-08-17) states each step commits its own transaction, and compensation, not one transaction, gives atomicity.
  - *Fix.* Correct R5 to say: authoritative hold at submit before the document, compensated on failure; no unheld window from the hold until `commit` (given A5). The user-facing invariant still holds.
- **A11: expiry job.**
  - A queue worker on a one-minute schedule, cross-tenant in batches.
  - It selects from `availability_reservations` using a partial index on `expires_at` `where status = 'active'`.
  - For each hold: CAS to `expired`, release the wms rows through the service in the same transaction, then emit `availability.reservation.expired` after commit.
  - Nothing in `wms` processes `expires_at` today, so this job is the only release path.
- **A12: reconciliation, redefined.**
  - *Problem.* `availability` cannot ask whether a checkout session exists (no import, and `checkout` is not a dependency).
  - *Fix.* The hourly job checks drift instead:
    - (a) a hold row is `active` but its wms rows are released or missing;
    - (b) a wms `'checkout'` row has no hold row;
    - (c) a hold is `committed` but its rows are still `'checkout'`.

    It repairs and reports each case. Checkout releases its own holds when its sessions expire or are cancelled (its recovery jobs).
- **A13: events and payloads.**
  - Declare:
    - `availability.reservation.created|released|committed|expired`, with `{ tenantId, organizationId, reservationId, sourceType, sourceId, lines: [{ catalogProductId, catalogVariantId, heldQuantity }] }`;
    - `availability.shortfall.detected`, with `{ tenantId, organizationId, sourceType, sourceId, lines: AvailabilityShortfallLine[] }`, once per call.
  - Document the difference from `wms.inventory.reservation_shortfall`, which is order automation.
  - `availability.state.changed` stays with spec 9 (back-in-stock) and is not Release 5 scope; state that.
- **A14: undo semantics (owner decision).**
  - *Problem.* §4.1 makes all three commands undoable, with undo paths that can fail (`shortfall`) and that would let an admin "undo" a committed order hold from the audit log. `wms` made the same operations `isUndoable: false` counter-actions on purpose (`inventory-actions.ts` header).
  - *Recommended.* `availability.reserve/release/commit` are `isUndoable: false`, audited, with explicit counter-actions; the checkout compensation table (§7.3) is the "undo".
  - *Alternative.* Keep the spec's undo design, but block undo when the hold's source has moved on (order exists or is paid).
- **A15: key mismatch.** Same key with different `items` or `sourceId` returns 409 `idempotency_key_mismatch`. Checkout mints a new `stock_reservation_key` per submit attempt whose cart content differs (re-price or edit).

### Nice-to-Have Gaps

- **A16:** see BC table (system-only `'checkout'`, dialog, i18n, `UPGRADE_NOTES.md`).
- **A17:** `ttlSeconds` zod bounds (for example 60–3600, default 900). An `expiresAt` is returned per hold.
- **A18:** `expiresAt` and `heldQuantity` on the hold make the US-D2 ops view possible later. An optional admin `GET /api/availability/reservations` (`availability.reservations.view`, with an `employee` grant) can come later; Release 5 can skip it.
- **A19: cache invalidation after reserve.** The new service path must emit the same side effects as the command (`emitInventorySideEffects`, `wms.inventory.reserved/released`) **after** commit. Otherwise the existing `invalidate-availability-cache` subscriber never fires and browse reads stay stale for the full 60 s.
- **A20: integration coverage to add to §12:**
  - parallel last unit with stock **split across two warehouses**;
  - parallel reserves against a **product pool**;
  - a checkout reserve racing a `sales.order.confirmed` automation reserve;
  - multi-line all-or-nothing (line 3 shortfall leaves lines 1–2 unheld);
  - `commit` racing the expiry sweep (exactly one wins; the loser path per A5);
  - a wms-less tenant checking out (`not_tracked`, no abort);
  - a backorder line (A6);
  - quote outcome releases (A9);
  - key mismatch 409;
  - tenant isolation on every path.
- **A21:** a compensation-retry hook. Checkout's `retry-failed-compensations` must be able to re-run `availability.release` safely, so release on a non-`active` hold is a no-op that returns its current status.

## Remediation Plan

### Before Implementation (Must Do)

1. **Owner decisions — taken 2026-10-26, see `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` (D-R5-8 commit at document creation, D-R5-9 backorder holds sellable, D-R5-10 not undoable):**
   - A5: commit point (recommend at document creation);
   - A6: backorder line holding;
   - A14: undoable or counter-action commands.
2. **Spec revision of the availability contract:**
   - §4.1 / new §4.1b: the transaction design through `wmsReservationService` (A1), the per-line outcome (A6), allocation (A7), scope (A4), mismatch rule (A15), TTL bounds (A17);
   - new §5.3 `AvailabilityReservation` (A3);
   - §4.4 trimmed or kept per A5/A8;
   - §7 timeline with the payment and quote rows (A5, A9);
   - §9 payloads (A13);
   - §10 jobs (A11, A12);
   - §12 coverage (A20);
   - §13 Phase 3 step 0 (A2);
   - §15 additions (A1-BC, A3, A16).
3. **Consumer updates in the same pass:**
   - checkout §7.2 (commit point, quote release, per-line outcomes, new key per attempt);
   - roadmap R5 (A10).

### During Implementation (Add to Spec)

1. Step 0: the Phase 2 alignment with the shared SQL builder and its three tests (A2).
2. Step 1: extract the `wms` service, with the commands as wrappers and no behaviour change. Existing `wms` tests are the safety net.
3. Step 2: the hold entity, `availability.reserve` and the parallel tests (A20) as the gate, then `release`/`commit`, then the jobs.

### Post-Implementation (Follow Up)

1. Store-to-warehouse allocation rules (Open Question 2) with shipping.
2. `availability.state.changed` with spec 9.
3. Move the spec to `implemented/` once Phase 3 ships. It is the last phase.

## Recommendation

**Needs spec updates first.** Before any Phase 3 code, fix A1–A5 in the spec and record the three owner decisions. The work stays additive: one `wms` service extracted from existing command bodies, one `availability` table, one new union member. Option A5 (a) also removes the most fragile branch of §4.4 from the checkout path.
