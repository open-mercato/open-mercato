# Availability Contract

| Field | Value |
|-------|-------|
| **Status** | Specification (Phase 1 + Phase 2 implemented 2026-09-22; Phase 3 — reservations — still pending, revised 2026-10-26 for eComm Release 5, re-landing audit remediated 2026-11-19) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 2, Phase 0 |
| **Modules** | `availability` (new), `wms` (extended), `catalog` (unchanged) |
| **Related** | [ADR-4](./2026-08-14-ecommerce-suite-roadmap.md#adr-4--availability-is-a-contract-wms-is-one-implementation), [WMS Phase 1 — Core Inventory](./2026-04-15-wms-phase-1-core-inventory.md), [WMS Ledger Integrity](./2026-06-13-wms-ledger-integrity.md) |

---

## Reconciliation note (2026-08-17)

The parallel `open-mercato` upstream repo independently designed the same contract as a Phase 0 addition to its own `.ai/specs/2026-04-15-wms-roadmap.md` (rev 10), approved and reviewed there before this document's design was known to it. A joint `/om-pre-implement-spec` audit on both documents flagged the collision as a Critical backward-compatibility risk (a DI/type contract can only be frozen once — see `BACKWARD_COMPATIBILITY.md` categories 2 and 9). The two designs are reconciled as of rev 10 of that document and this revision of this one. What changed here, relative to the original 2026-08-14 design below:

- The base `AvailabilityQuery` / `AvailabilityResult` / `AvailabilityProvider` types, the provider registry, and the built-in `catalog-only` fallback move to `packages/shared/src/lib/availability/` — they are **not** owned by this `availability` module. This keeps every consumer (`ecommerce`, `cart`, `checkout`, `catalog`) dependency-free the way `packages/shared` already is for every module, instead of requiring a new core module install.
- Provider registration is an explicit `availabilityProviderRegistry.register({ id, getAvailability })` call (mirrors `packages/shared/src/lib/ai/llm-provider-registry.ts`), not "same DI key, registration order is module load order." `wms` registers as provider id `'wms'`.
- Provider **selection** is per-tenant via `ModuleConfigService('availability', 'selectedProvider')` (`auto`/`wms`/`catalog-only`, safe fallback to `catalog-only` if the selected id is not currently registered) — not implicit "whichever registered last wins for the whole process."
- This `availability` module is re-scoped, not removed: it keeps everything that is genuine net-new business capability and has no equivalent in the shared contract — `AvailabilityPolicy`, its resolution chain, the admin CRUD, and the reservation/checkout-hold lifecycle (§4.1, §10). It stops being the module that *defines* the base contract; it becomes one of several things (alongside `wms`) that can be consulted when a provider computes a result.
- `AvailabilityItemRef.productId`/`.variantId` are renamed `catalogProductId`/`catalogVariantId` to match this repo's existing `catalog_product_id`/`catalog_variant_id` convention (used throughout `wms`'s own entities) and the shared contract's field names.
- The fallback's `not_tracked` state and `canFulfil: true` default (§3.2 below) is unchanged and was in fact adopted upstream into `wms-roadmap.md` rev 11 as the more correct choice over an earlier draft that defaulted to `in_stock` — no change needed here.
- `reserve`/`release`/`commit` (§4.1) are this module's own commands, registered with `registerCommand(...)` and **`isUndoable: false`** (D-R5-10, 2026-10-26), the same choice `wms` made for `wms.inventory.reserve`/`wms.inventory.release` (`wms/commands/inventory-actions.ts`): a stock hold sits on an append-only ledger, and its reversal is an explicit, audited counter-action, not a generic undo verb. Reversal is `availability.release` with a reason, or the checkout compensation table (checkout §7.3). No audit-log Undo can return a committed order hold to `checkout` or release stock under a live session. The commands do **not** call `wms`'s commands through the command bus: each `wms` command forks its own `EntityManager` and commits its own transaction, so the gate and the `wms` writes could never share one. They call the additive `wmsReservationService` (§4.1b) inside their own transaction instead. The 2026-08-17 and 2026-10-11 revisions specified undoable commands that composed `wms.inventory.reserve`; both claims are withdrawn by the 2026-10-26 revision.

### Status of the deferral (2026-09-06) — read this before implementing

**The section this note defers to is not present in this repository.** `.ai/specs/2026-04-15-wms-roadmap.md` exists here and contains no "Cross-Module Availability Contract" section; neither "rev 10" nor "rev 11" appears in it. `packages/shared/src/lib/availability/` does not exist either. So as written, the deferral pointed at nothing an implementer could open, and §4.1's `AvailabilityItemQuery` / `AvailabilityItemResult` were named but defined nowhere.

Deferring a contract to an unreachable document is worse than either alternative, because two teams starting Phase 1 and Phase 2 in parallel each re-derive the shape and land two incompatible interfaces — the exact collision this reconciliation exists to prevent, since a DI/type contract can only be frozen once (`BACKWARD_COMPATIBILITY.md` categories 2 and 9).

**Resolution, stated as an assumption rather than a new decision.** §4.1a below now carries the complete base contract, written down from what this document already specifies piecemeal across §3.2 (the state union), §4.1 (the query/result outline), §4.2 (the sellable computation), §6 (`isAuthoritative`) and the roadmap's ADR-4 — plus the four changes this reconciliation already agreed (shared location, explicit registry, per-tenant provider selection, `catalogProductId`/`catalogVariantId` naming). It is a transcription of the agreed design, not a competing one.

**If the upstream `wms-roadmap.md` § "Cross-Module Availability Contract" lands in this repository, it wins** and §4.1a is superseded — that priority is unchanged from the original reconciliation. Until it does, §4.1a is what Phase 1 builds against, so the phase is not blocked on a document that may never arrive. Whoever lands that section MUST diff it against §4.1a and reconcile in one direction explicitly.

---

## TLDR

**Key Points:**
- A thin `availability` module owns `AvailabilityPolicy` — the sell-policy layer (stock-managed, backorder, preorder, thresholds) — and the reservation/checkout-hold lifecycle. The base `AvailabilityQuery`/`AvailabilityResult` contract, provider registry, and catalog-only fallback live in `packages/shared` (see Reconciliation note above); `wms` registers there as the authoritative provider.
- `catalog` has **no stock fields whatsoever** — no `manage_stock`, no `allow_backorder`, no `is_in_stock`. Sell policy therefore has no home today, so this module owns it as `AvailabilityPolicy`, resolved variant → product → store default.
- `InventoryBalance.quantity_available` is a **stored generated column** (`on_hand − reserved − allocated`) that does **not** subtract safety stock. Sellable quantity is a different number from available quantity, and conflating them oversells the safety buffer.
- `InventoryReservation` already carries `expires_at`, `idempotency_key`, `status` and `source_type`, so a checkout hold is stored as `wms` rows with the new additive source type `'checkout'`. The `wms` rows cannot carry the caller's idempotency key or the hold's lifecycle, so this module adds one table, `availability_reservations` (§5.3), one row per hold.
- The hold is taken at checkout submit and committed to an `order` reservation as soon as the order document exists, before payment (D-R5-8). An order hold never expires; a failed payment cancels the order, and `wms` releases `order` holds on `sales.order.cancelled`.
- The authoritative gate and the `wms` writes run in **one** database transaction through an additive `wms` DI service, `wmsReservationService` (§4.1b), not through the `wms` commands, which each commit their own transaction.
- Every line returns its own outcome (`held | not_tracked | preorder | backorder | shortfall`, D-R5-9). A tenant without `wms`, or a line nobody counts, never blocks checkout.

**Scope:**
- `resolveAvailability()` read contract (in `packages/shared`) plus the `availability.reserve` / `.release` / `.commit` commands (`isUndoable: false`, D-R5-10)
- `AvailabilityPolicy` entity and its resolution chain
- The `wms`-backed implementation and the catalog-only fallback
- Caching, staleness budget, and an explicitly documented oversell window
- The `AvailabilityReservation` hold entity, the `wmsReservationService` extraction, the expiry and drift-reconciliation jobs, and the reservation and shortfall events with payloads

**Concerns:**
- Browse-time availability is advisory by design; the authoritative check happens at checkout submit. The window between them is a real oversell risk that this spec bounds and documents rather than pretends to eliminate.
- `InventoryBalance` is keyed on `catalog_variant_id` with no product column, so product-level availability is a rollup over variants — expensive on a listing page without careful batching
- Safety stock lives on `ProductInventoryProfile`, one row per product/variant, while balances are per warehouse+location+lot+serial; subtracting safety stock per balance row instead of once per variant would under-report stock by a factor of the location count

---

## 1) Overview

Every payload in the storefront suite carries an availability state, and nothing in the platform produces one. `wms` owns the numbers; `catalog` owns the products; no contract connects them, and neither should be queried directly by a storefront.

This module is the seam. It is intentionally small: one shared read contract (`resolveAvailability()` in `packages/shared`), the `availability.reserve`/`.release`/`.commit` commands, and one policy entity. Its value is that `ecommerce`, `cart` and `checkout` depend on a stable contract rather than on `wms`, which many tenants do not run.

---

## 2) Problem Statement

### 2.1 Availability is asserted, never sourced

SPEC-029 uses `availability: 'in_stock' | 'out_of_stock' | 'backorder'` in three payload types (§8.4 list item, §8.5 variant detail, §9.1 filter) without naming a source. The suite cannot be built on a field nobody computes.

### 2.2 There is no sell policy anywhere

`catalog` entities carry no stock-related field at all. The questions a storefront must answer have no data behind them:

- Is this product stock-managed, or is it a service that is always purchasable?
- May a buyer order beyond available stock (backorder), and with what stated lead time?
- Is this a pre-order with a release date?
- Below what quantity do we show "only 2 left"?
- Do we hide out-of-stock products or show them greyed out?

SPEC-029 puts two of these on the store settings blob (`features.showOutOfStock`, `features.allowBackorder`) as tenant-wide booleans. Real assortments need per-product overrides: a distributor backorders commodity parts but never backorders clearance stock.

### 2.3 Direct `wms` querying would be the wrong fix

A storefront reading `InventoryBalance` directly would create a cross-module ORM dependency (forbidden by root `AGENTS.md`), a hard dependency on an optional module, and a coupling to WMS internals — lots, serials, locations, zones — that commerce has no business knowing.

### 2.4 Available ≠ sellable

`InventoryBalance.quantity_available` is a stored generated column:

```
quantity_available = quantity_on_hand − quantity_reserved − quantity_allocated
```

`ProductInventoryProfile.safety_stock` is a separate buffer the warehouse holds back, and `reorder_point` signals replenishment. Selling down to `quantity_available` sells the safety buffer. Sellable quantity must be defined as a distinct number, computed once per variant after aggregating locations.

---

## 3) Proposed Solution

### 3.1 Module shape

```
packages/core/src/modules/availability/
├── index.ts                    # ejectable: true — this module is optional
├── acl.ts
├── di.ts                       # registers policyResolutionService; does NOT own the base contract
├── events.ts
├── notifications.ts            # stock_lost_after_payment ops notification (§4.1)
├── data/
│   ├── entities.ts             # AvailabilityPolicy, AvailabilityReservation (§5.3)
│   └── validators.ts
├── commands/
│   └── reservations.ts         # availability.reserve / .release / .commit (isUndoable: false)
├── lib/
│   ├── policyResolution.ts     # variant → product → store default
│   └── reservationCommands.ts  # typed entry points (§4.1); call wmsReservationService (§4.1b)
├── workers/                    # expire-reservations, reconcile-reservations (§10)
├── api/                        # admin CRUD for policies
├── backend/                    # policy admin UI
└── i18n/
```

The base contract types (`AvailabilityQuery`, `AvailabilityResult`, `AvailabilityProvider`) and the `availabilityProviderRegistry` live in `packages/shared/src/lib/availability/` — this module does not define or own them (see Reconciliation note).

`wms/di.ts` registers its implementation into the shared registry: `availabilityProviderRegistry.register({ id: 'wms', getAvailability })`. Registration is explicit and idempotent (replace-by-id), not order-dependent. Inside its `getAvailability`, the `wms` provider soft-resolves `availability`'s `policyResolutionService` via the local `tryResolve()` pattern (`packages/core/AGENTS.md` § Cross-Module Coupling) to layer sell-policy (backorder, preorder, thresholds, `maxOrderQuantity`) on top of the raw sellable-quantity computation (§4.2); when `availability` is ejected, policy fields default open (`allow_backorder: false`, no thresholds, no caps) exactly as if a store-level default row existed. `wms` never hard-`requires` `availability`.

### 3.2 States

```typescript
type AvailabilityState =
  | 'in_stock'      // sellable ≥ requested quantity
  | 'low_stock'     // sellable ≥ requested, but ≤ lowStockThreshold
  | 'out_of_stock'  // sellable < requested and no backorder/preorder path
  | 'backorder'     // sellable insufficient, but backorder permitted
  | 'preorder'      // not yet released; releaseAt in the future
  | 'not_tracked'   // no stock management for this item — always purchasable
```

`not_tracked` is what the fallback returns, and what a service or digital product returns even with `wms` installed. It is distinct from `in_stock`: the storefront must not render "in stock" for something whose stock nobody counts.

---

## 4) Architecture

### 4.1 Contract

The base query/result shape and the `AvailabilityProvider` interface live in `packages/shared/src/lib/availability/types.ts` per the Reconciliation note — **§4.1a writes them out**, because the document they were deferred to does not exist in this repository (see "Status of the deferral" above). This module's own surface is the **reservation lifecycle**, which the shared contract deliberately excludes (availability there is read-only):

```typescript
// packages/core/src/modules/availability/lib/reservationCommands.ts
export type ReservationScope = { tenantId: string; organizationId: string }

export type AvailabilityShortfallLine = {
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  available: number
}

export type AvailabilityReservationLineOutcome = 'held' | 'not_tracked' | 'preorder' | 'backorder' | 'shortfall'

export type AvailabilityReservationLine = {
  key: string                  // `${catalogProductId}:${catalogVariantId ?? ''}`, the same key as AvailabilityResult.byItem
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  outcome: AvailabilityReservationLineOutcome
  heldQuantity: number         // 0 unless outcome is 'held' or 'backorder'
  backorderQuantity: number    // > 0 only for 'backorder'
  available: number | null     // sellable seen by the gate; null for 'not_tracked' and 'preorder'
}

export type AvailabilityReservationStatus = 'active' | 'committed' | 'released' | 'expired' | 'stock_lost'  // 'stock_lost' is terminal (§5.3)

/**
 * Authoritative, transactional hold. MUST NOT be called at browse time.
 * Command `availability.reserve`, isUndoable: false (D-R5-10).
 */
export async function reserveAvailability(input: ReservationScope & {
  items: Array<{ catalogProductId: string; catalogVariantId?: string | null; quantity: number }>  // quantity: positive decimal, at most 4 places
  sourceType: 'checkout'
  sourceId: string
  idempotencyKey: string
  ttlSeconds?: number              // zod: integer 60–3600, default 900 (A17)
  warehouseIds?: string[] | null   // additive (D-R5-31); null or omitted → every warehouse of the organization; [] is rejected
  storeId?: string | null          // additive (D-R5-AV6); selects the policy chain (§5.2); checkout passes the session's store
}): Promise<{
  reserved: boolean                // true when no line has outcome 'shortfall'
  reservationId: string | null     // AvailabilityReservation.id; null when reserved is false
  status: AvailabilityReservationStatus | null
  expiresAt: string | null         // ISO-8601; null when reserved is false
  lines: AvailabilityReservationLine[]
  shortfall: AvailabilityShortfallLine[]  // the 'shortfall' lines; empty when reserved is true
}>

/**
 * Counter-action. Command `availability.release`, isUndoable: false.
 * No-op on a hold that is not 'active' or does not exist (A21).
 */
export async function releaseAvailability(input: ReservationScope & {
  idempotencyKey: string
  reason: string                   // audited; checkout uses e.g. 'checkout_compensation', 'session_expired', 'quote'
}): Promise<{
  reservationId: string | null
  status: AvailabilityReservationStatus | 'not_found'   // the status after the call
  released: boolean                // true only when this call moved the hold from 'active' to 'released'
}>

/**
 * Converts a checkout hold into an order reservation in place.
 * Command `availability.commit`, isUndoable: false. Idempotent per (idempotencyKey, orderId).
 */
export async function commitAvailability(input: ReservationScope & {
  idempotencyKey: string
  orderId: string
}): Promise<{
  reservationId: string
  status: 'committed' | 'recovered' | 'stock_lost'
  shortfall: AvailabilityShortfallLine[]   // non-empty only for 'stock_lost'
}>
```

**Validation** (`data/validators.ts`, zod). `items` is non-empty. Each `quantity` is a positive decimal with at most 4 decimal places, the scale of the `wms` quantity columns (`numeric(16,4)`); the item snapshot in §5.3 stores `requested`, `heldQuantity` and `backorderQuantity` with the same type, so the input schema and the snapshot schema accept the same values. An `(catalogProductId, catalogVariantId)` pair appears at most once per call (the caller sums duplicate cart lines); a duplicate fails with the issue key `availability.reservations.errors.duplicateLine`, which exists in every `availability` locale file. `ttlSeconds` is an integer from 60 to 3600, default 900 (A17). `warehouseIds` is `null`, omitted, or a non-empty array of uuids; `[]` fails validation, because "no warehouse" must never silently mean "every warehouse". `reason` is a non-empty string of at most 120 characters, the bound of `wms.inventory.release`, because it is also written to the `wms` rows. `sourceType` accepts only `'checkout'`.

**Scope (A4).** All three commands take `tenantId` and `organizationId` and find the hold by `(tenant_id, organization_id, idempotency_key)`. When a caller context is present, the input scope must match it (`ensureTenantScope` / `ensureOrganizationScope`, `shared/lib/commands/scope.ts`); a mismatch answers `403`. A key that exists only in another organization is `not_found` for `release` and `404 reservation_not_found` for `commit`; nothing outside the caller's scope is read or written.

**Errors.** Every error is a `CrudHttpError`; callers across a DI boundary test it with `isCrudHttpError`, never `instanceof`.

| Command | Status | `error` | When |
|---|---|---|---|
| all three | `400` | zod issues | Input fails validation |
| all three | `403` | scope error | Input `tenantId`/`organizationId` differs from the caller context |
| `reserve` | `409` | `idempotency_key_mismatch` | The key is known with a different `sourceType`, `sourceId` or normalized `items` (A15) |
| `reserve` | — | — | A shortfall is a result (`reserved: false`), not an error |
| `release` | — | — | An unknown key returns `status: 'not_found'`; it never throws for a missing or non-`active` hold (A21) |
| `commit` | `404` | `reservation_not_found` | No hold with this key in the caller's scope; checkout treats it as a no-op |
| `commit` | `409` | `idempotency_key_mismatch` | The hold is `committed` or `stock_lost` for a different `orderId` |
| `commit` | `409` | `commit_conflict` | The recovery CAS found the hold moved after it was read; nothing is written |

Lock and connection failures (§4.1b failure modes) surface as the underlying error and are never mapped to a shortfall.

**Per-line outcomes (D-R5-9).** Each line's policy comes from `policyResolutionService` (already in this module's DI), with the same chain and module defaults as the read path (§5.2). Policies resolve with the input's `storeId` (D-R5-AV6), so a store-level `allow_backorder` or `is_stock_managed = false` row applies at submit exactly as it did at browse:

| Line | Outcome | Held |
|---|---|---|
| `is_stock_managed` resolves `false`, or `wmsReservationService` is not resolvable, or the tenant's selected provider is not `wms` (D-R5-18: no `wms` means `not_tracked`). The selected provider is resolved exactly as `resolveAvailability()` resolves it (§4.1a): `catalog-only`, or `auto`/`wms` with `wms` not registered, gives `not_tracked` | `not_tracked` | nothing |
| `preorder_release_at` is in the future | `preorder` | nothing |
| stock-managed, `requested ≤ sellable` | `held` | `requested` |
| stock-managed, `requested > sellable`, `allow_backorder` | `backorder` | `min(requested, sellable)`; `backorderQuantity = requested − heldQuantity` |
| stock-managed, `requested > sellable`, no backorder | `shortfall` | nothing |
| stock-managed line without `catalogVariantId` | `shortfall` with `available: 0` | nothing (`wms` balances exist only per variant; checkout always passes the cart line's variant) |

`not_tracked` and `preorder` lines never fail the call. `reserved` is `true` when no line is `shortfall`. When any line is `shortfall`, the call writes nothing (all-or-nothing): `reservationId` and `expiresAt` are `null`, every line reports `heldQuantity: 0`, and `availability.shortfall.detected` is emitted once for the call. When `reserved` is `true`, the call writes one `AvailabilityReservation` row (§5.3) even when no line holds anything, so `release` and `commit` work the same way for every outcome.

**The gate.** For stock-managed lines, the call re-derives each variant's sellable quantity with the §4.2 sellable computation (safety stock, lot eligibility and the staging/dock exclusion included) on balance rows it has locked, in the same transaction that writes the `wms` rows (§4.1b). For a product with a product-level safety-stock pool it also checks the sum of the call's quantities for that product's variants against the product-level sellable (the per-variant sellable summed, minus the pool); a `backorder` line takes what the pool leaves after the `held` lines. Active holds already sit inside `quantity_available` and are not counted again. `wms` allocation alone uses raw `on_hand − reserved − allocated`, so this gate is what keeps the safety buffer from being sold.

**Warehouse allocation (A7).** Per variant, warehouses are ordered by the existing `sortWarehouseAvailabilityForReservation` (`wms/lib/primaryWarehousePolicy.ts`, already used by the sales-order automation): the primary warehouse first, then the others by eligible available quantity. The held quantity is filled greedily in that order, with **one `wms` reservation row per `(variant, warehouse)`**. Inside a warehouse, location and lot buckets are allocated exactly as `wms.inventory.reserve` allocates them today (the code moves into the service in step W1, §13). `warehouseIds` narrows the warehouses considered. Which warehouses serve which store is out of scope for Release 5 (Open Question 2); with no `warehouseIds`, every warehouse of the organization is in scope.

**Idempotency and key mismatch (A15).** `idempotency_key` is unique per `(tenant_id, organization_id)` across every status. A call with a known key replays: when `sourceType`, `sourceId` and the normalized `items` (sorted by line key, equal quantities) match the stored hold, it returns the stored result with the hold's current status and writes nothing, even when the hold is `released` or `expired`. When any of them differs, it answers `409 idempotency_key_mismatch` and writes nothing. Checkout mints a new `stock_reservation_key` for every submit attempt whose cart content differs from the previous attempt (re-price or edit).

**Release (A21).** `release` moves an `active` hold to `released` with a CAS update on `status = 'active'` and releases its `wms` rows through `wmsReservationService.releaseInTransaction` in the same transaction. On a hold that is `committed`, `released`, `expired` or `stock_lost`, or on an unknown key, it changes nothing and returns the current status (`not_found` for an unknown key), so checkout's `retry-failed-compensations` can re-run it safely. A committed hold is never released here: its stock belongs to the order, and cancelling the order releases it through `wms`'s existing `sales.order.cancelled` handling.

**Commit (D-R5-8).** Checkout calls `commit` right after its step 4 creates the order document, **before payment**. In one transaction it moves the hold from `active` to `committed` with a CAS update on `status = 'active'` (recording `order_id`) and converts every `wms` row through `wmsReservationService.convertInTransaction`: `source_type` `'checkout'` → `'order'`, `source_id` → the order id, the `wms` `idempotency_key` rebuilt for the new source (§4.4), and `expires_at` cleared. The stock is never unheld, because nothing is released first. An `order` row never expires. If payment then fails or is abandoned, checkout's compensation cancels the order and `wms` releases the `order` rows on `sales.order.cancelled`.
- A repeat call for a `committed` hold with the same `orderId` returns `committed` and writes nothing; with a different `orderId` it answers `409 idempotency_key_mismatch`.
- A repeat call for a `stock_lost` hold with the same `orderId` returns `stock_lost` with the stored shortfall. It does not re-gate, emits no event and sends no second notification (D-R5-AV3). With a different `orderId` it answers `409 idempotency_key_mismatch`.
- When any `wms` row of a still-`active` hold returns `not_convertible` (missing, not `active`, not `'checkout'`, or owned by another source), the conversion transaction rolls back and the call takes the recovery path below.

**Commit recovery.** It runs when the CAS finds the hold `expired` or `released` (the sweep or a compensation won), or after a `not_convertible` row. It is **one** transaction:
1. For each stock-managed variant of the hold (outcome `held` or `backorder`, `heldQuantity > 0`), in variant id order, it takes the source-variant advisory lock for `(organization, 'order', orderId, variant)`, the same lock the confirmed-first conversion and the automation's reserve use (§4.4, D-R5-AV2). It takes these locks before any balance lock.
2. It releases every row in the hold's `wms_reservation_ids` that is still `active` with `source_type = 'checkout'` and the hold's `source_id`, so no leftover checkout row survives next to the new order rows.
3. Under the advisory lock it sums the active `order` rows the order already holds for the variant (the `sales.order.confirmed` automation may have reserved them) and subtracts that sum from the line's `heldQuantity`.
4. It re-gates what is left with `reserveLinesForCheckout` in `exact` mode for every line, backorder lines included, because the order already promised `heldQuantity` (D-R5-AV4). The rows are written directly as `order` rows (`sourceType: 'order'`, `sourceId` = the order id, no expiry), within the hold's stored `warehouse_ids`.
5. On success it moves the hold to `committed` by CAS on the status it read, records `order_id`, and rewrites `wms_reservation_ids` to the `order` rows this call created, so the drift check (§10) sees a consistent hold. A CAS that matches zero rows rolls everything back and answers `409 commit_conflict`. The result is `recovered`.

If the re-gate finds a shortfall, the recovery transaction rolls back and the result is `stock_lost`: the order exists and its stock is gone. In a second short transaction, `commit` moves the hold to the terminal status `stock_lost` by CAS on the status it read, with `order_id`, `status_reason = 'stock_lost_after_payment'` and the shortfall lines (§5.3). Only the call whose CAS matched emits `availability.shortfall.detected` with `reason: 'stock_lost_after_payment'` and raises the in-app notification `availability.stock_lost_after_payment` for ops (§9). A notification failure is logged and reported with `reportError`, never swallowed. The code keeps the name D-R5-8 gave it although commit now runs before payment: it marks an order whose stock was lost after the order was created. What checkout does with such an order is checkout §7.2's decision.

**Quote outcome (D-R5-20, A9).** When submit ends with `outcome_kind: 'quote'`, checkout calls `release` with `reason: 'quote'` after the quote document is created. A quote is non-binding: no stock is held behind it, and stock is taken when the merchant converts the quote and confirms the order, through `wms`'s existing `sales.order.confirmed` automation.

**`resolveAvailability()` (shared) is advisory. `reserveAvailability()` (this module) is authoritative.** No caller may treat a `resolveAvailability()` result as a guarantee. This is stated here because it is the single most likely misuse.

### 4.1a The base contract (`packages/shared/src/lib/availability/`)

Zero module dependencies, so `ecommerce`, `cart`, `checkout` and `catalog` consume it without a `requires` edge on either `availability` or `wms`.

```typescript
// packages/shared/src/lib/availability/types.ts

export type AvailabilityState =
  | 'in_stock' | 'low_stock' | 'out_of_stock' | 'backorder' | 'preorder' | 'not_tracked'

export type AvailabilityItemQuery = {
  catalogProductId: string
  catalogVariantId?: string | null   // null → product-level rollup over active variants (§4.2)
  quantity: number                   // the quantity being asked about; state is relative to it
}

export type AvailabilityQuery = {
  tenantId: string
  organizationId: string
  items: AvailabilityItemQuery[]
  storeId?: string | null            // selects the policy chain (§5.2)
  channelId?: string | null
  locationIds?: string[] | null      // wms LOCATION ids (wms_locations.id), as shipped; null → every location (D-R5-31)
  warehouseIds?: string[] | null     // additive (D-R5-31): wms warehouse ids; null → every warehouse. Combined with locationIds by AND
}

export type AvailabilityItemResult = {
  state: AvailabilityState
  availableQuantity: number | null   // sellable, per §4.2; null = not tracked
  canFulfil: boolean                 // the requested quantity can be met, incl. a backorder/preorder path
  leadTimeDays: number | null        // set for 'backorder'
  releaseAt: string | null           // ISO-8601; set for 'preorder'
  isAuthoritative: boolean           // false for a cached browse-time read (§6) — never a guarantee
  policySourceId: string | null      // the AvailabilityPolicy row that decided, or null for a module default
}

export type AvailabilityResult = {
  byItem: Record<string, AvailabilityItemResult>   // key: `${catalogProductId}:${catalogVariantId ?? ''}`
}

export interface AvailabilityProvider {
  id: string
  getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult>
}
```

```typescript
// packages/shared/src/lib/availability/registry.ts
// Mirrors packages/shared/src/lib/ai/llm-provider-registry.ts.

export const availabilityProviderRegistry: {
  register(provider: AvailabilityProvider): void   // idempotent, replace-by-id — never order-dependent
  get(id: string): AvailabilityProvider | null
  list(): AvailabilityProvider[]
}

/** The entry point every read-side consumer calls. Advisory — see §4.1. */
export function resolveAvailability(query: AvailabilityQuery): Promise<AvailabilityResult>
```

`resolveAvailability()` picks the provider from `ModuleConfigService('availability', 'selectedProvider')` — `auto` | `wms` | `catalog-only`, per tenant, falling back safely to `catalog-only` when the selected id is not currently registered. `auto` means "the highest-precedence registered provider", which is `wms` when installed. The built-in `catalog-only` provider is always registered and returns `not_tracked` with `canFulfil: true` and `isAuthoritative: true` (nothing to be stale about) for every item, unless `availability` is installed and a policy says otherwise (§4.3).

The result key is stable and derivable by the caller, so a batched response maps back onto the request without positional matching.

**`locationIds` and `warehouseIds` (D-R5-31).** The shipped provider filters `locationIds` on `wms_inventory_balances.location_id`, while earlier text in this section and in §4.2 spoke of warehouses. The shipped meaning stands and is now documented: `locationIds` are location ids. Warehouse filtering is the additive optional `warehouseIds` field; no shipped field changes meaning. The read provider and the reservation gate (§4.1) both accept `warehouseIds` and apply it before the shared §4.2 sellable computation.

**Not in the shared contract, deliberately:** reservations. `reserve`/`release`/`commit` are transactional writes owned by this module (§4.1), not read-side helpers, and putting them in `packages/shared` would give a dependency-free package a transaction boundary.

### 4.1b Transaction design: `wmsReservationService` (A1)

**Why not the `wms` commands.** `wms.inventory.reserve` runs on `ctx.container.resolve('em').fork()` inside its own `transactional()` (`wms/commands/inventory-actions.ts`). In MikroORM v7 that fork carries no transaction context, so its `transactional()` opens a new transaction on another connection. Calling it from inside the gate's transaction fails one of two ways. If the gate holds its balance locks, `wms`'s own `FOR UPDATE` waits on its caller until the lock or idle timeout, and submit hangs. If it does not, two buyers pass the gate together and the safety buffer is sold (R9), and a multi-line call that fails on line 3 has already committed lines 1–2. Checkout §7.2 records the same platform rule for its own steps: every `commandBus.execute()` commits its own transaction.

**Service boundary.** `wms` registers an additive DI service, `wmsReservationService`, in `wms/di.ts`, implemented in `wms/lib/wmsReservationService.ts`. Its methods take the caller's transactional `EntityManager` and the caller's `CommandRuntimeContext`, in that order, and never fork, open or commit a transaction. Writes that must be undone on their own run in a savepoint of the caller's transaction (`runInTransaction` on `trx`), never in a new one:

```typescript
// packages/core/src/modules/wms/lib/wmsReservationService.ts
type Scope = { tenantId: string; organizationId: string }

export class WmsReservationService {
  /** Body of wms.inventory.reserve: one (warehouse, variant), bucket allocation, idempotent replay. */
  reserveInTransaction(trx: EntityManager, ctx: CommandRuntimeContext, input: InventoryReservationCreateInput,
    options?: { sourceTargetQuantity?: number }): Promise<ReserveInTransactionResult>
  /** Body of wms.inventory.release. A row that is no longer 'active' is a no-op (W1b). */
  releaseInTransaction(trx: EntityManager, ctx: CommandRuntimeContext, input: InventoryReservationReleaseInput,
    options?: { rejectSourceTypes?: InventoryReservationSourceType[] }): Promise<ReleaseInTransactionResult>
  /** In-place source change of one 'checkout' row: source_type/source_id rewritten, key rebuilt, expires_at cleared (§4.4). */
  convertInTransaction(trx: EntityManager, ctx: CommandRuntimeContext, input: ConvertInTransactionInput): Promise<ConvertInTransactionResult>
  /** The gate (§4.1): lock, compute sellable, check, allocate across warehouses, insert. All or nothing. */
  reserveLinesForCheckout(trx: EntityManager, ctx: CommandRuntimeContext, input: ReserveLinesForCheckoutInput): Promise<ReserveLinesForCheckoutResult>
  /** Runs the side effects a write collected, after the transaction that owns them committed (A19, §6). */
  emitSideEffects(ctx: CommandRuntimeContext, sideEffects: WmsSideEffects): Promise<void>
  /** @internal — availability's commit recovery and drift check only; not part of the frozen contract. */
  findReservationsByIds(trx: EntityManager, ctx: CommandRuntimeContext, input: Scope & { ids: string[] }): Promise<InventoryReservation[]>
  /** @internal — availability's drift check (b) only; tenant-wide read, filter-scoped by tenant_id. */
  listActiveReservationsBySourceType(trx: EntityManager, input: { tenantId: string; sourceType: string; createdBefore: Date; cursor?: string | null; limit: number }): Promise<InventoryReservation[]>
}

type ReserveInTransactionResult = {
  reservationId: string
  allocatedBuckets: Array<{ locationId: string; lotId: string | null; quantity: string }>
  tenantId: string; organizationId: string; warehouseId: string; catalogVariantId: string
  quantity: number
  reservationEntity: InventoryReservation
  touchedBalances: InventoryBalance[]
  idempotentReplay: boolean
  sourceHeldQuantity?: number        // set with sourceTargetQuantity: what the source holds of the variant after the call
}
type ReleaseInTransactionResult = {
  reservationId: string; warehouseId: string; catalogVariantId: string
  quantity: string                   // the released quantity, as a numeric string
  tenantId: string; organizationId: string
  reservationEntity: InventoryReservation
  touchedBalances: InventoryBalance[]
}
type ConvertInTransactionInput = Scope & { reservationId: string; sourceType: 'order'; sourceId: string; expectedSourceId?: string }
type ConvertInTransactionResult = {
  reservationId: string
  reservationEntity: InventoryReservation | null
  outcome: 'converted' | 'already_converted' | 'covered_released' | 'not_convertible'
  reason?: 'missing' | 'not_active' | 'not_checkout' | 'source_mismatch'   // set for 'not_convertible'
  touchedBalances: InventoryBalance[]
}
type ReserveLinesForCheckoutInput = {
  scope: Scope
  lines: Array<{ key: string; catalogProductId: string; catalogVariantId: string; quantity: number; mode: 'exact' | 'up_to_sellable' }>
  sourceType: 'checkout' | 'order'
  sourceId: string
  expiresAt: Date | null
  warehouseIds?: string[] | null
}
type ReserveLinesForCheckoutResult =
  | { ok: true; lines: Array<{ key: string; sellable: number; heldQuantity: number; reservationIds: string[] }>; sideEffects: WmsSideEffects }
  | { ok: false; lines: Array<{ key: string; requested: number; sellable: number }> }
type WmsSideEffects = {
  reservations?: Array<{ entity: InventoryReservation; action: 'created' | 'updated' }>
  balances?: Array<{ entity: InventoryBalance; action: 'updated' }>
  released?: Array<{ reservationId: string; warehouseId: string; catalogVariantId: string; quantity: string }>  // drives wms.inventory.released
}
```

`mode: 'up_to_sellable'` is used for backorder lines (hold `min(requested, sellable)`); `mode: 'exact'` for every other stock-managed line and for every line of the commit recovery (D-R5-AV4). `sourceType: 'order'` is used only by the commit recovery path (§4.1). The existing `wms.inventory.reserve` and `wms.inventory.release` commands become thin wrappers: they open their transaction as today, call the matching `…InTransaction` method, and run their post-commit work after commit. `convertInTransaction` and `reserveLinesForCheckout` are new and have no command of their own; only `availability`'s commands call them. The two `@internal` readers exist for `availability`'s recovery and drift check; they are registered on the same key but are not frozen by §15 and may change without notice. Behaviour changes to the existing commands are limited to the two fixes listed in §13 W1b and §15.

`availability` soft-resolves the service with `tryResolve` (`packages/core/AGENTS.md` → Cross-Module Coupling) and never imports `wms` entities or writes SQL against `wms` tables. The locking and sellable logic is `wms`'s invariant and stays in `wms`.

**One connection.** Nothing that runs under a row lock or an advisory lock may take a second pool connection. Every read and write goes through `trx` (ORM calls with `lockMode: PESSIMISTIC_WRITE` for locks, `trx.execute()` for the advisory lock), never `em.getConnection().execute()` and never a fresh `fork()`. The shipped read path (`wms/lib/availabilityCalculation.ts`) uses `getConnection().execute()` and is therefore not reusable under the gate's locks; the shared part is the §4.2 sellable computation, not the SQL.

**One transaction, in this order.** `availability.reserve` opens one transaction (`em.transactional`, or a savepoint of the caller's transaction, see below) and:
1. inserts its `AvailabilityReservation` row with `status = 'active'` in a savepoint. The unique index on `(tenant_id, organization_id, idempotency_key)` serializes two calls with the same key: the second waits on the index until the first ends. If the first committed, the insert fails, only the savepoint rolls back, and the call re-reads the winner's row and replays it or answers `409` (§4.1). If the first rolled back, the insert succeeds and the call continues. The hold row goes in **before** the gate runs (D-R5-AV1); the reference implementation (PR #8268, `availability/lib/reservationCommands.ts`) runs the gate first and inserts the hold last, and the port MUST reverse that order;
2. calls `reserveLinesForCheckout`, which locks, through `trx`, every balance row of every variant in the call plus every active variant of any product in the call that has a product-level pool. Locks are taken in the order every other `wms` writer uses (D-R5-AV7): variants ordered by `catalog_variant_id`, and within a variant the balance rows ordered by `(created_at, id)`, the order of `listCandidateBalances` (`wms/commands/inventory-actions.ts`). The reference locks the whole set ordered by `id`; the port MUST change it;
3. inside the service: computes sellable from the locked rows with the §4.2 sellable computation (staging/dock and ineligible lots excluded), checks per-variant and per-pool totals, and returns `ok: false` without writing when any `exact` line fails;
4. inside the service: allocates across warehouses (§4.1, A7), inserts the `wms` rows with `source_type = 'checkout'` and `expires_at` through `reserveInTransaction` on the same `trx`, and updates the balances' reserved quantity;
5. writes the hold's `items` (with per-line outcomes) and `wms_reservation_ids` onto its row and commits once.

A call with only `not_tracked`/`preorder` lines, or a tenant without `wms`, skips steps 2–4. `release`, `commit` and the expiry worker follow the same pattern: CAS on the hold row, the service call(s), one commit, then the post-commit work.

**After the commit.** Only after the transaction that owns the writes has committed, the command:
1. calls `emitSideEffects(ctx, sideEffects)`. It runs the CRUD side effects of every touched reservation and balance row (`emitCrudSideEffects` with `inventoryReservationCrudEvents` and `inventoryBalanceCrudEvents`). The balance side effect emits `wms.inventory_balance.updated`, and that is what the `wms:invalidate-availability-cache` subscriber (`wms/subscribers/invalidate-availability-cache.ts`, event `wms.inventory_balance.*`) listens to, so browse reads are not stale for the full 60 s (A19, §6);
2. in the same call, emits the `wms` domain events the command wrappers emit (D-R5-AV8): `wms.inventory.reserved` for every created row, `wms.inventory.released` for every released or shrunk row (with the released quantity), and runs the low-stock check (`emitLowStockEventIfNeeded`) once per touched variant. A converted row changes no quantity and emits no domain event. Checkout traffic is therefore visible to every existing `wms.inventory.*` consumer, and a checkout that takes stock below the reorder point raises `wms.inventory.low_stock`;
3. emits its own `availability.reservation.*` or `availability.shortfall.detected` event (§9).

**Called inside a caller's transaction.** When the caller passes `ctx.transactionalEm` (checkout's submit does, #8414), the commands run on that `EntityManager`; they open a savepoint, never a fork, so the request keeps one connection. The caller then owns the commit. The command does not run the post-commit work itself: it registers it with `onTransactionLifetimeComplete(ctx.transactionalEm, …)` (`packages/shared/src/lib/commands/transaction-lifetime.ts`) and runs it only when the outcome is `committed`. On `rolled_back` it drops it, so no event, cache invalidation or index update is ever emitted for a hold that never existed. Without `ctx.transactionalEm`, the command owns its transaction and runs the post-commit work after its own commit.

**Deadlocks.** The gate, `wms.inventory.reserve` and the sales-order automation lock balance rows in the same global order (step 2 of the reserve order above), and the automation runs one command (one transaction) per bucket, so no lock cycle exists between them. Advisory locks follow two rules. A caller that blocks on the source-variant advisory lock (the conversion and the commit recovery, §4.4) takes it for a variant before it touches that variant's balances, and when it needs several variants it takes them in variant id order (`commit` converts the hold's rows sorted by variant id). A caller that already holds balance locks (the automation's `sourceTargetQuantity` reserve) only tries the lock and fails fast with `409 source_reservation_busy`. No deadlock retry is specified, because none is needed. The transaction makes no external call (no HTTP, no gateway, no event dispatch) while it holds the locks.

**Failure modes.**

| Failure | Result |
|---|---|
| A line is `shortfall` | The transaction rolls back: no hold row, no `wms` rows. `availability.shortfall.detected` is emitted after the rollback (under a caller transaction: when the caller's lifetime completes). |
| Lock wait exceeds the database `lock_timeout`, or a serialization or connection error | The transaction rolls back and the command throws; nothing is held. Checkout treats it as a failed submit step; its compensation's `release` finds no hold and is a no-op (A21). |
| Unique violation on the hold key (a concurrent same-key call won) | Only the insert savepoint rolls back; the command re-reads the winner's row and replays it or answers `409 idempotency_key_mismatch`. |
| The caller's outer transaction rolls back after the command returned | The hold and its `wms` rows roll back with it; the deferred post-commit work is dropped. |
| Process dies after commit, before side effects | The stock is correct. The cache entry stays stale for at most its 60 s TTL and the events of that call are lost, as for the `wms` commands today. The drift job (§10) does not depend on events. |
| `wmsReservationService` not resolvable | Every line is `not_tracked` (D-R5-18); the hold row is written with no `wms` rows. |

### 4.2 The `wms` implementation

Sellable quantity, per variant, in one aggregation. **One sellable computation** in `wms` serves both callers (A2): one shared function that takes the aggregated rows per variant (available quantity per warehouse, already filtered) plus the profile rows, and returns per-variant and per-product sellable. It has two inputs:
- the read provider (`wms/lib/availabilityCalculation.ts`, no locks) aggregates in SQL with the statement below;
- the reservation gate (`reserveLinesForCheckout`, §4.1b) reads the balance rows it has locked through the transaction (an ORM read with `PESSIMISTIC_WRITE`, never `getConnection().execute()`) and aggregates them in memory with the same filters.

Both inputs apply the same three filters: balance not deleted, lot eligible, location reservable. There is exactly one definition of sellable, and the two paths cannot drift.

```sql
-- Aggregate across every in-scope location, THEN subtract the per-variant buffer.
-- Ineligible lots (quarantined or expired) and staging/dock locations are excluded, matching wms.inventory.reserve.
SELECT b.catalog_variant_id,
       b.warehouse_id,
       SUM(b.quantity_available) AS aggregate_available
FROM   wms_inventory_balances b
LEFT JOIN wms_inventory_lots l ON l.id = b.lot_id AND l.deleted_at IS NULL
LEFT JOIN wms_warehouse_locations loc ON loc.id = b.location_id
WHERE  b.tenant_id = $1 AND b.organization_id = $2
  AND  b.catalog_variant_id = ANY($3)
  AND  (b.warehouse_id = ANY($4) OR $4 IS NULL)   -- warehouseIds (additive, D-R5-31)
  AND  (b.location_id = ANY($5) OR $5 IS NULL)    -- locationIds (location ids, as shipped)
  AND  b.deleted_at IS NULL
  AND  (b.lot_id IS NULL OR (l.status = 'available' AND (l.expires_at IS NULL OR l.expires_at > now())))
  AND  (loc.type IS NULL OR loc.type NOT IN ('staging', 'dock'))
GROUP BY b.catalog_variant_id, b.warehouse_id
```

**Reservable locations.** Staging and dock locations hold inbound stock and are never pick or reserve candidates. `wms.inventory.reserve` already skips them (`isBalanceLocationReservable` over `NON_RESERVABLE_LOCATION_TYPES`, `wms/lib/inventoryPolicy.ts`). The read path and the gate apply the same rule, so stock on staging or dock is not sellable anywhere. Without it, the PDP shows stock that submit refuses, and the gate counts quantity that `reserveInTransaction` then refuses to allocate, which surfaces as a raw `409 insufficient_stock` instead of a structured shortfall.

```
sellable(variant) = max(0, aggregate_available(variant) − safety_stock(variant))
```

`safety_stock` comes from `ProductInventoryProfile`, matched on `catalog_variant_id`. A variant-level row is subtracted **once per variant, after aggregation** — subtracting per balance row would multiply the buffer by the number of locations holding the item. A row with `catalog_variant_id IS NULL` is a **product-level pool**: it is subtracted once, from the product rollup total, not once per variant, and a variant query MUST NOT fall back to it (falling back multiplies the buffer by the variant count — four variants with `safety_stock = 5` and 3 units each would report nothing sellable with 12 units on hand). The §4.1 reserve gate applies the same pool on the checkout path: it checks the sum of the call's requested quantities for the product's variants against the product-level sellable (the per-variant sellable summed, minus the pool), not only the line's own variant sellable; active holds are already inside `quantity_available` and are not counted again.

Only eligible lots count toward sellable: a balance whose lot status is not `available`, or whose `expires_at` has passed, is excluded, matching the eligibility `wms.inventory.reserve` applies. Without this, a quarantined or expired lot reads as permanently in stock while every `reserve` against it returns `shortfall`.

`low_stock` triggers when `sellable ≤ lowStockThreshold`, where the threshold is the policy override if set, otherwise `ProductInventoryProfile.reorder_point`, otherwise no low-stock state.

Product-level rollup (`variantId: null`) is `max(0, SUM of per-variant sellable across the product's active variants − the product-level safety-stock pool once)`, with state derived from the total.

**Batching.** A 24-item listing page with configurable products can span several hundred variants. `check` MUST issue exactly one balance aggregation, one profile lookup and one policy lookup per call regardless of item count. Per-item queries are a defect, not a performance nuance.

### 4.3 The fallback implementation

Ships as the built-in `catalog-only` provider in `packages/shared` (Reconciliation note) — not in this module, so it works even when `availability` itself is ejected. Returns `not_tracked` with `canFulfil: true` for every item, unless `availability` is installed and an `AvailabilityPolicy` explicitly marks the item unavailable or sets a preorder release date (soft-resolved via `tryResolve`, same as the `wms` provider does — §3.1). This keeps a `wms`-less *and* `availability`-less storefront fully functional, and makes the policy entity useful on its own once installed.

### 4.4 Reservation source type

`InventoryReservationSourceType` becomes `'order' | 'transfer' | 'manual' | 'checkout'`. Additive union extension of an exported type (`BACKWARD_COMPATIBILITY.md` category 2); the `source_type` column is `text`, so no migration is needed. Existing consumers narrowing on the three current values are unaffected; any exhaustive `switch` in `wms` gains a branch.

`commit` transitions the reservation's `source_type` from `'checkout'` to `'order'` and rewrites `source_id` to the order id, rather than releasing and re-reserving — releasing first opens a window in which another buyer takes the stock out from under an order that already exists.

It MUST also rebuild the reservation's wms `idempotency_key`, because `wms` derives that key from `source_type` and `source_id` alongside the variant, warehouse and quantity (`wms/lib/inventoryIdempotency.ts`); rewriting the first two while leaving the key stale produces a row that `wms`'s own idempotent replay can never match again, so a later `reserve` for the same order and bucket would take the quantity a second time. When another active row already owns the rebuilt key, the converted row gets the key `<rebuilt key>|converted|<reservation id>`, so the active-only unique index never rejects the conversion.

**`'checkout'` is a system-only source (A16, D-R5-AV5).** Only `availability` creates, releases or allocates `'checkout'` rows. The mechanism is one command guard, stated once:
- `wms.inventory.reserve` refuses `sourceType: 'checkout'` with `400 checkout_reservation_is_system_only`;
- `wms.inventory.release` refuses to release a `'checkout'` row with the same `400` (it calls `releaseInTransaction` with `rejectSourceTypes: ['checkout']`);
- `wms.inventory.allocate` refuses to allocate a `'checkout'` row with the same `400`.

The guard sits in the commands, so it covers the public routes (`POST /api/wms/inventory/reserve`, `/release`, `/allocate`) and every command-bus caller. The shared zod enum includes `'checkout'`, because listings and filters need it; the route schemas do not narrow it, and the OpenAPI doc of each of the three routes marks `'checkout'` as system-only (rejected with `400`). `availability`'s own paths (release, commit, commit recovery, expiry, drift repair) call the service directly and pass no `rejectSourceTypes`. A tenant therefore cannot create by hand a hold that the expiry sweep would later release, nor release a hold that `availability` still believes it owns. `ReserveInventoryDialog` keeps offering only the three manual sources. `WmsInventoryConsolePage` hides the release and allocate actions on `'checkout'` rows. Reservation listings show `'checkout'` rows with a translated label (every `wms/i18n` locale file), never the raw value.

**Interaction with the `sales.order.confirmed` automation.** `wms`'s subscriber tops up only reservations whose `source_type` is `order` and `source_id` is the order id (`wms/lib/salesOrderInventoryAutomation.ts`). A hold still on `'checkout'` is invisible to it. Checkout commits right after creating the order document and before any status that emits `sales.order.confirmed` (D-R5-8, §4.1), so on the checkout path the automation always finds the `order` rows and reserves nothing more.

**Confirmed-first path, kept only for integrators who confirm first (A8, D-R5-AV2).** An integrator calling `availability.reserve` directly may confirm the order before calling `commit`. Checkout never takes this path. The automation and the conversion then both decide "how much does this order already hold of this variant". One protocol serializes that decision:

1. **Source-variant advisory lock.** A transaction-scoped advisory lock per `(organization, source type, source id, variant)`: `pg_advisory_xact_lock(hashtextextended('wms:source-variant-reservation:<organizationId>:<sourceType>:<sourceId>:<variantId>', 0))`, taken through `trx.execute()` on the transaction's own connection and released at commit. It covers every `order` row of that order and variant, across warehouses.
2. **The automation's reserve.** `wms.inventory.reserve` gains an optional command input `sourceTargetQuantity`; the HTTP route's schema strips it, so only in-process callers can set it. The automation passes the order's required quantity for the variant. After taking its balance locks, the service **tries** the advisory lock (`pg_try_advisory_xact_lock`). If the lock is busy, it fails fast with `409 source_reservation_busy` and holds nothing. If it gets the lock, it sums the source's active rows of the variant across warehouses and reserves at most `sourceTargetQuantity − held`; when nothing is missing, it replays an existing row instead of writing. The result carries `sourceHeldQuantity`, what the source holds after the call. The `wms.inventory.reserve` command retries `source_reservation_busy` up to five times (20, 40, 80, 160, 320 ms), each attempt in its own transaction on a fresh fork; the last failure surfaces as `409`, and the persistent `sales.order.confirmed` subscriber is redelivered.
3. **The conversion.** `convertInTransaction` locks the checkout row, then **blocks** on the advisory lock for `(organization, 'order', orderId, variant)`, then locks the order's other active rows for the variant that were not themselves converted from checkout (the covering rows). It claims covering quantity row by row and records the claim on the covering row's metadata, so a sibling checkout row of the same order (another warehouse) never counts the same coverage twice. A fully covered checkout row is released (`covered_released`). A partly covered row is shrunk by the covered quantity, then converted (`converted`).
4. **The shrink.** A private service helper, `shrinkReservationBuckets`, reduces the row's quantity, the balances' reserved (or allocated) quantity and `metadata.allocatedBuckets`, **newest bucket first**, under the locks already held; the key is rebuilt afterwards because quantity is part of it. It has no command and no route.
5. **The outcome.** Either the automation's reserve commits first and the conversion counts it, or the automation runs after the conversion and counts the converted row. The two never jointly hold more than the order needs. The automation may still have emitted a false `wms.inventory.reservation_shortfall` while the checkout hold held the stock; that event is not retracted, which is why checkout commits first.

`wms.inventory.release` gains no `quantity` input; partial release exists only inside the service.


---

## 5) Data Models

### 5.1 `AvailabilityPolicy` (`availability_policies`)

Standard scoped columns. Exactly one of `variant_id` / `product_id` / neither (store-level default) is set.

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid, nullable | null = applies to all stores in the organization |
| `product_id` | uuid, nullable | `catalog.CatalogProduct.id` |
| `variant_id` | uuid, nullable | `catalog.CatalogProductVariant.id` |
| `is_stock_managed` | boolean, nullable | `false` → always `not_tracked`; `null` = inherit from the next row in §5.2 |
| `allow_backorder` | boolean | Default `false` |
| `backorder_lead_time_days` | integer, nullable | Displayed to the buyer; required when `allow_backorder` |
| `preorder_release_at` | timestamptz, nullable | Before this instant the state is `preorder` |
| `low_stock_threshold` | integer, nullable | Overrides `ProductInventoryProfile.reorder_point` |
| `min_order_quantity` | integer, nullable | |
| `max_order_quantity` | integer, nullable | Cap independent of stock — B2B allocation of scarce goods |
| `quantity_increment` | integer, nullable | Pack size; quantities must be a multiple |
| `hide_when_out_of_stock` | boolean | Overrides the store's `showOutOfStock` for this item |
| `is_active` | boolean | |

Constraints: unique `(tenant_id, organization_id, store_id, product_id, variant_id)` among non-deleted rows; `variant_id` non-null requires `product_id` non-null.

### 5.2 Resolution chain

Per field, most specific wins:

```
variant + store  →  variant (all stores)  →  product + store  →  product (all stores)
                 →  store default row     →  module default
```

Module defaults: `is_stock_managed: true` when `wms` is enabled and a `ProductInventoryProfile` exists for the item, otherwise `false`; `allow_backorder: false`; no thresholds or caps.

`policySourceId` in the result names the row that decided, so the admin can explain an unexpected state — the same explainability principle as `ResolvedTerms.sourceGroupId` in spec 1.

**Note on SPEC-029 store settings.** `EcommerceStoreSettings.features.showOutOfStock` and `.allowBackorder` become the store-level defaults in this chain rather than independent switches. The rewritten SPEC-029 states this.


### 5.3 `AvailabilityReservation` (`availability_reservations`) (A3)

One row per hold, the record `release`, `commit`, the expiry sweep and reconciliation work on. The `wms` rows cannot carry it: their `idempotency_key` is derived from `sourceType|sourceId|variant|warehouse|quantity` (`wms/lib/inventoryIdempotency.ts`), not the caller's key, and is unique only while `active`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id`, `organization_id` | uuid | Scope; every lookup filters on both |
| `idempotency_key` | text | The caller's key (checkout `stock_reservation_key`) |
| `source_type` | text | `'checkout'` |
| `source_id` | text | Checkout session id |
| `status` | text | `active \| committed \| released \| expired \| stock_lost` |
| `expires_at` | timestamptz, not null | `now() + ttlSeconds` at reserve; kept on `committed` rows for the record, ignored by the sweep |
| `items` | jsonb | Snapshot per line: `catalogProductId`, `catalogVariantId`, `requested`, `outcome`, `heldQuantity`, `backorderQuantity` (quantities are decimals with the §4.1 input type) |
| `warehouse_ids` | jsonb, nullable | The `warehouseIds` of the reserve call (`null` = every warehouse); the commit recovery re-gates within them |
| `wms_reservation_ids` | jsonb | `string[]` of the `wms_inventory_reservations` ids the hold owns; empty when no line holds stock; rewritten by commit recovery to the new `order` rows |
| `order_id` | uuid, nullable | Set by `commit` (also on `stock_lost`) |
| `shortfall` | jsonb, nullable | `AvailabilityShortfallLine[]`; set only with `stock_lost`, returned by a repeated `commit` |
| `status_reason` | text, nullable | Reason of the last transition: the `release` reason, `ttl` (expiry), `reconciled` (drift repair), `stock_lost_after_payment` |
| `created_at`, `updated_at` | timestamptz | `updated_at` changes on every transition |

Indexes:
- unique `(tenant_id, organization_id, idempotency_key)` over **all** statuses, so a key is never reused for different content (§4.1, A15). Its prefix also serves scope lookups, so there is no separate `(tenant_id, organization_id)` index;
- partial `(expires_at) WHERE status = 'active'` for the expiry sweep (§10, A11);
- `(tenant_id, organization_id, source_type, source_id)` for lookups by session.

The migration has a `down()` that drops the table.

No `deleted_at`: rows are never soft-deleted; they are the audit trail of the hold. Retention (purging old `released`/`expired` rows) is not in Release 5 scope. The table is not user-editable (no admin form, A18), so it carries `updated_at` for transitions only, with no optimistic-lock header. It holds no personal data (ids, quantities and reason codes only), so it has no encryption map and needs no `buildEncryptionMapBackfillSql` migration.

**State machine.** Every transition is a conditional update on the expected status (`UPDATE … WHERE id = ? AND status = ?`), the fenced-lease rule; an update that matches zero rows lost the race and changes nothing.

| From | To | By | Guard |
|---|---|---|---|
| (none) | `active` | `reserve` | unique key |
| `active` | `committed` | `commit` | `status = 'active'` |
| `active` | `released` | `release` | `status = 'active'` |
| `active` | `expired` | expiry worker | `status = 'active' AND expires_at < now()` |
| `active` / `expired` / `released` | `committed` | `commit` recovery (re-gate succeeded, §4.1) | `status` = the value `commit` read |
| `active` / `expired` / `released` | `stock_lost` | `commit` recovery (re-gate found a shortfall, §4.1) | `status` = the value `commit` read |
| `committed` | (none) | — | Terminal here. The `order` rows are released by `wms` when the order is cancelled. |
| `stock_lost` | (none) | — | Terminal (D-R5-AV3). A repeated `commit` returns the stored result; `release`, the sweep and the drift check never touch it. |

`commit` and the expiry worker race only on `active`; exactly one wins (D-R5-8). `release` never leaves a terminal state (A21).
---

## 6) Caching & Staleness

| Call | Cached | TTL | Invalidation |
|---|---|---|---|
| `check` (browse) | Yes | 60s | Tag `availability:{tenantId}:{variantId}` on any `wms` movement, reservation or balance change |
| `check` (cart re-validation) | No | — | Always live |
| `reserve` / `release` / `commit` | Never | — | Transactional |
| Policy resolution | Yes | 300s | Tag `availability-policy:{tenantId}` on policy write |

Cached results set `isAuthoritative: false`. A caller that needs certainty calls `reserve`.

**Staleness budget: 60 seconds.** A storefront may display availability up to 60s stale. This is a deliberate trade against issuing a live aggregation per listing render. Cart re-validation and checkout bypass the cache.

`wms` emits balance-change events already; this module subscribes and invalidates by tag. If `wms` is absent, nothing changes and nothing needs invalidating. The invalidation rides on the balance CRUD side effect: every balance row a reservation write touches goes through `emitCrudSideEffects` with `inventoryBalanceCrudEvents`, which emits `wms.inventory_balance.updated`, and the `wms:invalidate-availability-cache` subscriber listens to `wms.inventory_balance.*`. Reservation writes made through `wmsReservationService` return their touched balances in `sideEffects`, and `emitSideEffects` runs them after the owning transaction commits (§4.1b, A19), so a hold, release, commit, recovery or expiry invalidates browse reads like any other `wms` movement. The `wms.inventory.reserved` / `.released` domain events (D-R5-AV8) are emitted by the same call for their own consumers; the cache does not depend on them.

---

## 7) The Oversell Window

This is stated plainly because hiding it is how oversell bugs get shipped.

```
t0  buyer loads PDP            resolveAvailability() → in_stock, possibly up to 60s stale
t1  buyer adds to cart         resolveAvailability() → live, still advisory, no hold taken
t2  buyer fills checkout       (minutes; no hold)
t3  buyer submits              reserveAvailability() → authoritative, transactional, may fail
                               checkout hold: source_type 'checkout', expires after ttlSeconds (default 900)
t4  order document created     commitAvailability() → the same wms rows become order rows, in place;
                               no expiry from here on
t5  payment                    success → order proceeds, stock stays held for fulfilment
                               failure / abandonment → checkout cancels the order →
                               wms releases the order rows on sales.order.cancelled
t4' quote document created     (payment method request_quote) releaseAvailability(reason 'quote');
                               nothing held behind the quote
```

Stock is held from **t3**. Between t0 and t3 another buyer may take it. At t3 the reservation either succeeds or returns per-line `shortfall`, and checkout surfaces a line-level "no longer available" error rather than creating an unfulfillable order. Lines that are `not_tracked`, `preorder` or `backorder` do not fail submit (§4.1).

| Window | What holds the stock | How it ends |
|---|---|---|
| t0–t3 browse, cart, checkout form | Nothing | — (the accepted oversell window, R2) |
| t3–t4 submit to order document | The checkout hold (`AvailabilityReservation` `active`, `wms` rows `'checkout'`) | `commit` at t4; checkout compensation `release` when a step before t4 fails; the expiry sweep after `ttlSeconds` when the session dies |
| t4–t5 order exists, payment pending | `order` reservation rows (hold `committed`) | Payment success keeps them; payment failure or abandonment cancels the order and `wms` releases them. No timer, so a slow 3DS, BLIK or bank redirect cannot lose the stock (D-R5-8). |
| t4' quote outcome | Nothing after the release | The merchant converts the quote; stock is taken at confirmation by `wms`'s existing automation (D-R5-20, A9) |

The t3–t4 window is short (checkout's own steps, no gateway call), so a 900 s TTL is ample. If it is exceeded anyway and the sweep wins, `commit` makes one fresh reserve and, when the stock is gone, raises `stock_lost_after_payment` (§4.1). An unpaid order holds its stock until payment fails or the order is cancelled; checkout's gateway timeout and recovery jobs bound that time.

**Rejected alternative: reserve at add-to-cart.** It converts every abandoned cart into held stock, and with a typical abandonment rate it makes a popular item permanently unavailable. Every major platform (Shopify, Commercetools, Medusa) reserves at checkout, not at cart. Some retailers hold at cart for scarce goods; a per-policy `reserve_at_cart` flag is noted in Open Questions rather than built speculatively.

---

## 8) API Contracts

This module exposes **no public storefront endpoints**. Availability reaches the storefront embedded in `ecommerce` product payloads (spec 4). Admin routes only:

| Method | Path | Feature |
|---|---|---|
| GET/POST | `/api/availability/policies` | `availability.policies.view` / `.manage` |
| GET/PUT/DELETE | `/api/availability/policies/:id` | idem |
| POST | `/api/availability/check` | `availability.check` — admin/debug, mirrors the service |

`/api/availability/check` exists so support can reproduce what a buyer saw, including `policySourceId`.

**Phase 3 adds no routes.** `availability.reserve`, `.release` and `.commit` are reached only in-process through the command bus (checkout resolves them softly, D-R5-18); none has an HTTP route. The admin reservations list (`GET /api/availability/reservations`) is **outside Release 5** (A18, D-R5-34); `AvailabilityReservation` keeps `expires_at`, `items` and per-line `heldQuantity` so it can be added later without a migration. The only route-level changes in Phase 3 are in `wms`, and they come from the command guard (§4.4, A16, D-R5-AV5): `POST /api/wms/inventory/reserve` rejects `sourceType: 'checkout'`, and `POST /api/wms/inventory/release` and `POST /api/wms/inventory/allocate` reject a `'checkout'` row, each with `400 checkout_reservation_is_system_only`. The OpenAPI docs of the three routes mark `'checkout'` as system-only. `POST /api/wms/inventory/release` on a row that is no longer `active` becomes a no-op (§13 W1b, §15).

### 8.1 ACL features

```typescript
export const features = [
  { id: 'availability.policies.view',   title: 'View availability policies' },
  { id: 'availability.policies.manage', title: 'Manage availability policies' },
  { id: 'availability.check',           title: 'Run availability checks' },
]
```

---

## 9) Events

Declared in `availability/events.ts` with `createModuleEvents`. Every payload carries `tenantId` and `organizationId` (D-R5-32). Reservation and shortfall events are emitted **after** the transaction that caused them commits (or, for a shortfall, after it rolled back), never from inside it. When the command runs inside a caller's transaction (`ctx.transactionalEm`), "after" means the caller's commit: the events are registered with `onTransactionLifetimeComplete` and dropped if the caller rolls back (§4.1b). The same calls also emit `wms.inventory.reserved` / `.released` and the low-stock check for the `wms` rows they touch (§4.1b, D-R5-AV8).

```typescript
'availability.policy.created' | '.updated' | '.deleted'                         // shipped
'availability.reservation.created' | '.released' | '.committed' | '.expired'    // Phase 3
'availability.shortfall.detected'                                                // Phase 3
'availability.state.changed'                                                     // spec 9, not Release 5

type AvailabilityReservationEventPayload = {
  tenantId: string
  organizationId: string
  reservationId: string            // AvailabilityReservation.id
  sourceType: 'checkout'
  sourceId: string
  lines: Array<{ catalogProductId: string; catalogVariantId: string | null; heldQuantity: number }>
  orderId?: string                 // '.committed' only
  reason?: string                  // '.released' (the caller's reason) and '.expired' ('ttl')
  recovered?: boolean              // '.committed' only: true when commit re-reserved after losing to the sweep (§4.1)
}

type AvailabilityShortfallDetectedPayload = {
  tenantId: string
  organizationId: string
  sourceType: 'checkout'
  sourceId: string
  reason: 'reserve' | 'stock_lost_after_payment'
  orderId?: string                 // 'stock_lost_after_payment' only
  lines: AvailabilityShortfallLine[]   // §4.1
}
```

| Event | Emitted by | When |
|---|---|---|
| `availability.reservation.created` | `reserve` | A new hold row committed (not on replay) |
| `availability.reservation.released` | `release`, reconciliation | The hold moved `active → released` |
| `availability.reservation.committed` | `commit` | The hold moved to `committed` (including recovery) |
| `availability.reservation.expired` | expiry worker | The hold moved `active → expired` |
| `availability.shortfall.detected` | `reserve`, `commit` | Once per call with at least one `shortfall` line, or once when commit recovery moves the hold to `stock_lost` (never again on a repeated `commit`) |

**Not to be confused with `wms.inventory.reservation_shortfall`.** That event belongs to `wms`'s sales-order automation (an order could not be fully reserved after confirmation). `availability.shortfall.detected` is the checkout-path gate refusing a hold. They are separate signals and neither replaces the other.

`availability.shortfall.detected` matters operationally: a rising rate means the staleness budget or the reservation model needs revisiting, and without the event nobody would know.

**Notification.** `reason: 'stock_lost_after_payment'` also raises the in-app notification type `availability.stock_lost_after_payment` (declared in `availability/notifications.ts`, i18n title and body in every `availability` locale file: `en`, `pl`, `de`, `es`, `ko`), sent to staff of the organization holding `availability.policies.manage`. It names the order and the number of short lines (`sellableCount`); the line detail is in the event and on the hold's `shortfall` column. It is sent once per hold, when the hold moves to `stock_lost`. A failure to create it is logged and reported with `reportError`; it never masks the event and never fails silently. No other Phase 3 event notifies anyone.

**`availability.state.changed` stays with spec 9** (back-in-stock) and is not Release 5 scope. When built, it is emitted by the invalidation subscriber when a recomputed state differs from the cached one, per variant, debounced to at most one event per variant per minute, never per balance row.

---

## 10) Background Jobs

Both jobs are `@open-mercato/queue` workers in `availability/workers/`, following the `cart` sweeper pattern (`cart/workers/expire.worker.ts`): one scheduled tick per tenant whose payload carries the scope (`{ tenantId }`, D-R5-32), `concurrency: 1`, and a tick without `tenantId` is logged and skipped. Each tick processes the tenant's organizations in batches and is idempotent: running it twice changes nothing the first run did not.

**Schedules.** The schedules are owned by `availability` and target only `availability`'s own workers. They are registered in two places:
- `availability/setup.ts` `seedDefaults`, for new tenants (best effort: a scheduler failure is logged and does not abort tenant setup, as in `cart/setup.ts`);
- the upgrade action `availability.register-reservation-sweep-schedules` in `configs/lib/upgrade-actions.ts`, for existing tenants, because `seedDefaults` never runs for them. It is modelled on `cart.register-sweeper-schedules`, has `requiredModules: ['availability']`, i18n message/CTA/success/loading keys in `configs/i18n`, and its `version` is the `@open-mercato/core` release it ships in (the version of the AV3 merge; not a version that has already shipped).

Schedule ids are deterministic and pass the scheduler's `z.uuid()` validation. The scheduler rebuilds the job `scope`, so a test asserts that the `tenantId` reaches the worker through the scheduler, not only through a hand-built payload.

| Job (worker id) | Cadence | Purpose |
|---|---|---|
| `availability:expire-reservations` | every minute | Expire `active` holds past `expires_at` (A11) |
| `availability:reconcile-reservations` | hourly | Detect and repair drift between hold rows and `wms` rows (A12) |

**Expiry (A11).** Selects up to 200 holds per batch with `status = 'active' AND expires_at < now()` for the tenant, using the partial index `(expires_at) WHERE status = 'active'` (§5.3), so the per-minute tick never scans committed or released rows. Each hold runs in its own transaction: CAS `active → expired` (`status_reason = 'ttl'`); when the CAS matches a row, release its `wms` rows through `wmsReservationService.releaseInTransaction`; commit; then `emitSideEffects` and `availability.reservation.expired`. A CAS that matches nothing means `commit` or `release` won, and the hold is skipped. Each hold is isolated: its transaction runs in its own `try/catch`; a failure is logged with tenant, organization and hold id, reported with `reportError`, and the batch continues with the next hold. A hold that fails is not retried in the same tick (the next batch excludes the ids that already failed), so one poison hold never stops the tenant's other holds from expiring. Nothing in `wms` processes `InventoryReservation.expires_at` today, so this job is the only path that frees an abandoned checkout hold; it touches only holds owned by `availability`, never `wms` rows of other sources. With the 900 s default TTL and a one-minute tick, an abandoned hold is freed after about 16 minutes at worst.

**Reconciliation (A12), redefined as a drift check.** `availability` cannot ask whether a checkout session still exists (it does not depend on `checkout`). Checkout releases its own holds when its sessions expire or are cancelled (its recovery jobs). This job checks only that the two sides of a hold agree:

| Drift | Repair | Report |
|---|---|---|
| (a) hold `active`, but one or more of its `wms` rows are released or missing | Release the remaining `wms` rows; CAS the hold `active → released` with `status_reason = 'reconciled'`; emit `availability.reservation.released` | Logged with tenant, organization, hold id |
| (b) active `wms` row with `source_type = 'checkout'` that no hold's `wms_reservation_ids` contains | Release the `wms` row through the service | Logged with the `wms` reservation id |
| (c) hold `committed`, but one or more of its `wms` rows still have `source_type = 'checkout'` | Convert them through `convertInTransaction` with the hold's `order_id`; a `not_convertible` result is not repaired | Logged with hold id and order id; a `not_convertible` row is also reported |
| (d) hold `committed`, but one or more of its `wms` rows are released or missing | None: the stock belongs to the order, and the order may legitimately have been cancelled or fulfilled | Report only, with hold id and order id |

Each repair runs in its own transaction with the same CAS guards as §5.3, inside its own `try/catch` like the expiry (a failure is reported and the tick continues). Repairs and reports are logged through the structured logger (`createLogger('availability')`) with a per-tick count, and each drift case is also reported through telemetry `reportError` with its own code (`availability.drift.active_wms_missing`, `.orphan_checkout_row`, `.committed_still_checkout`, `.committed_wms_released`); a non-zero count is a defect signal, not a routine event. Drift (b) is tenant-wide: it scans the tenant's active `'checkout'` rows across organizations through `listActiveReservationsBySourceType` and builds a per-row scope from each row. It only considers rows older than the maximum TTL (3600 s), so that a hold mid-transaction is never touched. Because commit recovery rewrites `wms_reservation_ids` to the new `order` rows (§4.1), a recovered hold does not trigger drift (d).

---

## 11) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Safety stock subtracted per location | **High** | `availability`, `wms` | An item stocked in 4 locations with `safety_stock = 5` reports 20 units held back instead of 5, so 15 sellable units are invisible. Silent revenue loss — nothing errors. | Subtract once per variant after aggregation (§4.2); explicit multi-location test with asymmetric balances | Low |
| R2 | Oversell between browse and submit | Medium | `availability`, `cart` | Two buyers see the last unit; both check out; one `reserve()` fails at submit. | Bounded and documented (§7); submit surfaces a line-level shortfall rather than creating an unfulfillable order; `shortfall.detected` monitors the rate | Medium — inherent to reserve-at-checkout; accepted deliberately, not by omission |
| R3 | Stale cache after a stock movement | Medium | `availability` | A large goods-receipt lands; the storefront shows out-of-stock for up to 60s. | Tag invalidation on `wms` movement events makes this near-instant in practice; the 60s TTL is the ceiling only when events are lost | Low |
| R4 | N+1 on listing pages | **High** | `availability` | 24 configurable products × 8 variants issues 192 balance queries per render; the listing page becomes the slowest route in the app. | Contract mandates one aggregation per `check` call regardless of item count; a test asserts the query count for a 200-variant batch | Low |
| R5 | `wms` absent, storefront claims stock | Medium | `availability` | The fallback returns `not_tracked` and a naive storefront renders "In stock" for an item nobody counts. | `not_tracked` is a distinct state and the spec forbids rendering it as in-stock; spec 10 defines its presentation (no badge at all) | Low |
| R6 | Reservation leak on checkout abandonment | Medium | `availability` | Sessions abandoned between submit and order creation hold stock until TTL; at scale a meaningful slice of inventory is invisible. | One-minute expiry sweep over a partial index (§10); checkout releases holds of its expired or cancelled sessions; hourly drift check; TTL default 900 s, bounded 60–3600 s | Low |
| R7 | Release-then-reserve race at commit | **High** | `availability`, `checkout` | A naive `commit` releasing the checkout hold before creating the order reservation lets a concurrent buyer take stock from an order that already exists. | `commit` converts the existing `wms` rows in place (`source_type`, `source_id`, rebuilt key) through `convertInTransaction` inside one transaction; never release-then-reserve | Low |
| R8 | Union extension breaks exhaustive switches | Low | `wms` | Adding `'checkout'` to `InventoryReservationSourceType` makes any exhaustive `switch` non-exhaustive at compile time. | Compile-time failure, not runtime — surfaced by `yarn typecheck` and fixed in the same change; documented in `UPGRADE_NOTES.md` for third-party modules | Low |
| R9 | Safety stock or lot eligibility bypassed at reserve time | **High** | `availability`, `wms` | `wms.inventory.reserve` allocates against raw `on_hand − reserved − allocated`; a gate that skips the §4.2 sellable re-derivation lets a checkout hold sell the safety buffer or a quarantined/expired lot, with no error. | The gate runs inside `wmsReservationService.reserveLinesForCheckout`, which locks the balance rows, re-derives sellable with the shared §4.2 sellable computation (safety stock, pool, lot eligibility and the staging/dock exclusion included) and writes the `wms` rows in the same transaction (§4.1b); §12 asserts the buffer, pool and ineligible-lot cases under parallel load | Low |
| R10 | Gate and `wms` writes in separate transactions (A1) | **High** | `availability`, `wms` | Composing `wms.inventory.reserve` through the command bus opens a second transaction on another connection: with the gate's locks held, submit hangs until the lock timeout; without them, the safety buffer and the pool are oversold, and a multi-line call commits lines 1–2 before line 3 fails. | One transaction through `wmsReservationService` (§4.1b), on the caller's connection; locks in the global `wms` order; the parallel tests in §12 (single warehouse, split across two warehouses, product pool) | Low |
| R11 | Hold expires during payment (A5) | **High** | `availability`, `checkout` | 3DS, BLIK or a slow webhook pushes payment past the TTL; the sweep frees the stock and another buyer takes it from a paid order. | Commit at order-document creation, before payment (D-R5-8); `order` rows never expire; commit and sweep race only through CAS on `status = 'active'`; a losing commit re-reserves once and raises `stock_lost_after_payment` | Low |
| R12 | Same key reused with a different cart (A15) | Medium | `availability`, `checkout` | A retry after a cart edit replays the old hold, and the order is created against lines that are not held. | `409 idempotency_key_mismatch` on any difference in source or items; checkout mints a new key per attempt with different content | Low |
| R13 | Phase 2 provider not aligned before the gate (A2) | **High** | `availability`, `wms` | The gate inherits the product-row fallback, the missing pool subtraction and the missing lot filter: shortfalls on stock that exists, or quarantined stock admitted. | Phase 3 step W2 (§13) aligns the provider, adds the staging/dock exclusion to the read path and introduces the one shared sellable computation before any reservation code | Low |
| R14 | Hand-made or hand-released `'checkout'` holds (A16) | Low | `wms` | A tenant creates a `'checkout'` row through the manual reserve route, and the drift check then releases it as orphaned; or staff release or allocate a live checkout row, and the hold no longer matches its `wms` rows. | `'checkout'` is system-only: the `wms.inventory.reserve`, `.release` and `.allocate` commands reject it with `400 checkout_reservation_is_system_only`; the dialog does not offer it and the console hides release and allocate for it (D-R5-AV5) | Low |
| R15 | Missed cache invalidation after a hold (A19) | Medium | `availability`, `wms` | The service path skips `wms` side effects; browse reads show the stock as available for the full 60 s after it was held. | `emitSideEffects` after every commit runs the balance CRUD side effects, whose `wms.inventory_balance.updated` event drives the cache subscriber (§4.1b, §6); §12 asserts that a `check` right after `reserve` reflects the hold | Low |
| R17 | Lock-order inversion between the gate and other `wms` writers | **High** | `availability`, `wms` | The gate locks in one order and `wms.inventory.reserve` or the automation in another; Postgres aborts one side with a deadlock: a failed submit or a redelivered automation event. | One global lock order (variant id, then `(created_at, id)`) for every writer; blocking advisory locks only before balance locks; try-lock after them (§4.1b, D-R5-AV7); §12 races the gate against the automation | Low |
| R18 | Pool exhaustion under parallel last-unit submits (#8414) | **High** | `availability`, `checkout` | A command forks a second connection while the caller's connection holds a lock; with the pool sized to request concurrency, every request waits on itself and submit answers `500`. | Run on `ctx.transactionalEm`, never a fork; no second connection under any lock (§4.1b); a real-Postgres test with the pool sized to the concurrency (§12) | Low |
| R19 | Events for a hold that never existed | Medium | `availability`, `wms` | The command emits after its savepoint, then the caller's transaction rolls back; subscribers and indexes see a phantom hold. | Post-commit work is registered with `onTransactionLifetimeComplete` and dropped on rollback (§4.1b) | Low |
| R20 | Confirmed-first conversion or recovery over-reserves | **High** | `availability`, `wms` | The automation and the conversion (or the recovery) both top up the same order and variant; the order holds more than it needs. | Source-variant advisory lock, `sourceTargetQuantity`, covering-row claims, recovery netting (§4.1, §4.4, D-R5-AV2, D-R5-AV4); §12 real-Postgres race test | Low |
| R21 | Checkout submit live before the expiry worker | Medium | `availability`, `checkout` | Checkout submit reaches `main` while no expiry job runs; abandoned holds stay held until checkout's own recovery frees them. | §13 landing order: AV3 merges before checkout submit is reachable | Low |
| R16 | Unpaid orders hold stock (D-R5-8) | Low | `availability`, `checkout` | Buyers who abandon at the payment step keep stock held on an unpaid order. | Bounded by the gateway timeout and checkout's recovery jobs, which cancel the order; `wms` then releases the `order` rows. Accepted as the cost of never losing stock under a paid order. | Low |

**Out of Release 5 (D-R5-34, A18):** the admin reservations list (`GET /api/availability/reservations`, feature `availability.reservations.view`). No ACL feature is added by Phase 3.

---

## 12) Integration Coverage

**Service behaviour:**
- Sellable = aggregate available − safety stock, with the item stocked in 4 locations and asymmetric balances (R1)
- `not_tracked` from the fallback with `wms` disabled; authoritative state with it enabled
- State boundaries: exact-quantity request is `in_stock`; one over is `out_of_stock` or `backorder` per policy
- `low_stock` from the policy override, and from `reorder_point` when there is no override
- `preorder` before `preorder_release_at`, `in_stock` after
- Product-level rollup equals the sum over active variants minus the product-level safety-stock pool, subtracted once; inactive variants excluded; 4 variants with 3 units each and a pool of 5 report 7 sellable
- A quarantined or expired lot is excluded from sellable, not counted as `in_stock`
- Policy resolution across all six chain levels with `policySourceId` correct at each
- Query count for a 200-variant `check` is constant (R4)

**Phase 2 alignment (step W2, A2):**
- R1 multi-location test, product-pool rollup test and ineligible-lot test pass against the shared sellable computation, for both inputs: the read provider's SQL and the gate's locked ORM read
- Staging and dock stock is not sellable: a variant with stock only on a `staging` or `dock` location reads as out of stock on the read path, and the gate returns a structured `shortfall` for it, never a raw `409 insufficient_stock`
- A variant query never falls back to the product-level profile row
- `locationIds` filters locations and `warehouseIds` filters warehouses, separately and combined (D-R5-31)

**`wms` service extraction (steps W1 and W1b, A1):**
- W1: the existing `wms` reserve and release integration tests pass unchanged with the commands as wrappers over `wmsReservationService`; the Playwright suites TC-WMS-002 (insufficient-stock rejection), TC-WMS-021 (concurrent reservation locking) and TC-WMS-027 (ledger integrity) pass; they fail if a `CrudHttpError` thrown inside the DI-resolved service loses its status and body at a `wms/api` catch site or in an automation predicate
- W1: `reserveInTransaction` and `releaseInTransaction` called inside a caller's transaction write nothing when that transaction rolls back
- W1b: two concurrent `wms.inventory.reserve` calls with the same derived key create one row; the loser replays it from the savepoint and leaves no balance change behind
- W1b: `wms.inventory.release` of a row that is already `released` changes no balance and answers success with the row id; it neither decrements again nor throws `balance_integrity_violation`

**`'checkout'` source (step AV1, A16):**
- API: `POST /api/wms/inventory/reserve` with `sourceType: 'checkout'` answers `400 checkout_reservation_is_system_only` and writes nothing
- API: `POST /api/wms/inventory/release` and `POST /api/wms/inventory/allocate` on a `'checkout'` row answer the same `400` and change nothing
- Command level: the same three guards hold for a direct `commandBus.execute()` call

**Reservation behaviour (steps AV2a and AV2b):**
- `reserve` succeeds, holds stock, writes one `AvailabilityReservation` row, and a `check` issued right after reflects the hold (cache invalidated through the balance CRUD side effect after commit, A19)
- `reserve` emits `wms.inventory.reserved` per created `wms` row and `wms.inventory.low_stock` when the hold takes the variant to its reorder point (D-R5-AV8)
- `reserve` refuses a quantity that fits raw available but exceeds sellable — 10 on hand with a buffer of 8 gives sellable 2, so a reserve of 5 is refused and no pair of 5s can both succeed
- `reserve` refuses a quantity held only in a quarantined or expired lot, or only on a staging or dock location
- Multi-line all-or-nothing: line 3 `shortfall` leaves lines 1–2 unheld, no hold row and no `wms` rows; `availability.shortfall.detected` is emitted once with line 3
- N parallel `reserve` calls for the last unit, single warehouse: exactly one succeeds
- N parallel `reserve` calls for the last units with the stock **split across two warehouses**: exactly the sellable total is held, one `wms` row per `(variant, warehouse)`, primary warehouse filled first
- Parallel `reserve` calls for different variants of a product with a **product-level pool**: the pool is never sold
- A checkout `reserve` racing a `sales.order.confirmed` automation reserve for the same variant, with balance rows whose id order differs from their creation order: the sellable total is never exceeded and neither side deadlocks (D-R5-AV7)
- Two parallel `reserve` calls with the same `idempotencyKey`: one hold, the loser replays it (D-R5-AV1); it never returns `reserved: false` or emits `availability.shortfall.detected`
- Repeated `idempotencyKey` with the same content returns the original hold without double-holding; with different items or `sourceId` answers `409 idempotency_key_mismatch` and writes nothing (A15)
- `ttlSeconds` outside 60–3600 is rejected; omitted gives 900 and `expiresAt = now + 900 s` (A17); `warehouseIds: []` is rejected; a duplicate line answers `availability.reservations.errors.duplicateLine`; a decimal quantity with 4 places is accepted and stored unchanged in the snapshot
- A caller context whose organization differs from the input answers `403` on all three commands
- A tenant without `wms` (module disabled) reserves with every line `not_tracked`, `reserved: true`, and checkout does not abort (D-R5-9, D-R5-18); so does a tenant whose selected provider is `catalog-only` while `wms` is installed
- A store-level policy row with `allow_backorder` applies when `reserve` is called with that `storeId`, and not for another store (D-R5-AV6)
- A line whose policy is `is_stock_managed = false` is `not_tracked`; a preorder line before `preorder_release_at` is `preorder`; both hold nothing
- A backorder line with 3 sellable and 5 requested holds 3 and returns `backorderQuantity: 2` (D-R5-9)
- `reserve` inside a caller's transaction that then rolls back leaves no hold, no `wms` rows, and emits no `availability.*` or `wms.*` event and no CRUD side effect
- `release` of an active hold frees the `wms` rows and emits `.released` and `wms.inventory.released`; a second `release`, a `release` of a committed, expired or `stock_lost` hold, and a `release` with an unknown key change nothing and return the current status (A21)
- `commit` converts the `wms` rows in place (`source_type 'order'`, `source_id` = order id, rebuilt key, `expires_at` cleared); no moment exists in which the stock is unheld (R7); a repeat with the same order id is a no-op, with another order id `409 idempotency_key_mismatch`; an unknown key answers `404 reservation_not_found`
- `commit` followed by `sales.order.confirmed` for the same order holds exactly the ordered quantity, with no second reservation
- `commit` racing the expiry sweep on an expired-at-boundary hold: exactly one CAS wins; when the sweep wins, `commit` re-reserves once (`recovered`) and `wms_reservation_ids` then lists the new `order` rows; when the stock is gone it returns `stock_lost`, emits `availability.shortfall.detected` with `reason: 'stock_lost_after_payment'` and creates the `availability.stock_lost_after_payment` notification (D-R5-8)
- A second `commit` on a `stock_lost` hold returns `stock_lost` with the same shortfall, re-gates nothing, emits no event and creates no second notification (D-R5-AV3)
- Commit recovery of a backorder line re-gates `heldQuantity` in `exact` mode; when the automation already holds part of the order's variant, recovery reserves only the rest (D-R5-AV4)
- Commit recovery after a `not_convertible` row on an `active` hold releases the leftover checkout rows and re-gates; a recovery CAS that loses answers `409 commit_conflict` and leaves nothing written
- A failing notification channel during `stock_lost` is reported through `reportError` and does not fail `commit`
- Cancelling the committed order releases the `order` rows through `wms`'s existing subscriber
- Quote outcome: `release` with `reason: 'quote'` leaves nothing held (D-R5-20, A9)
- Confirmed-first integrator path (§4.4, D-R5-AV2): `sales.order.confirmed` before `commit` keeps exactly the ordered quantity held, also when the order spans two warehouses; a key collision with an automation row gets the `|converted|<id>` suffix and raises no unique violation; a partly covered checkout row shrinks its newest bucket first
- The automation's reserve with `sourceTargetQuantity` racing `commit` for the same order and variant: the order never holds more than its line quantity; a busy lock answers `source_reservation_busy` and the retry succeeds
- Expiry worker: expires only `active` holds past `expires_at`, releases their `wms` rows, emits `.expired`, skips holds committed in the meantime; a tick without `tenantId` is skipped; a hold whose release throws is reported and the other holds of the batch still expire
- Drift check repairs cases (a), (b) and (c) of §10, reports case (d) without repairing it, and is a no-op on a consistent tenant and on a recovered hold
- The upgrade action `availability.register-reservation-sweep-schedules` registers both schedules for an existing tenant, and the scheduled tick reaches the worker with that tenant's `tenantId`
- Every event payload carries `tenantId` and `organizationId` (D-R5-32)
- Every audit log entry of `reserve`, `release` and `commit` uses an i18n action label key and records `reason` for `release`
- Tenant isolation on every path: `reserve`, `release` and `commit` from a second tenant or organization with the first one's key find nothing and change nothing; workers touch only the tenant in their payload

**Real-Postgres execution (A20).** The race cases above, the product-pool case, the confirmed-first race and pool exhaustion run as real-Postgres suites (`*.pg.test.ts` or `*.integration.test.ts` under `OM_PG_INTEGRATION=1`), not with mocks. A suite that never runs is no coverage, so:
- a CI command selects them: `packages/core`'s `test:pg-integration` pattern (today limited to `catalog|communication_channels|eudr|integrations|progress|staff`, `workflows` and two migration suites) gains `availability` and the `wms` reservation suites, and the CI job that runs it has a Postgres service;
- the step's PR shows the selection with `jest --listTests` for that command, and every new PG suite appears in the list;
- a pool-exhaustion suite (`reservationCommands.pool-exhaustion.integration.test.ts`) runs N parallel last-unit `reserve` calls through a caller transaction with the pool sized to exactly N connections, and every call completes without a pool timeout (#8414).

**API paths:** every route in §8, with tenant isolation asserted against a second-tenant fixture. Phase 3 adds no route; its route-level changes, the `400 checkout_reservation_is_system_only` on `POST /api/wms/inventory/reserve`, `/release` and `/allocate` and the no-op release of a non-`active` row, are covered above at API level.

**UI paths:** policy list, policy edit with the resolution-chain preview, admin check tool showing `policySourceId`. Phase 3: the `wms` manual reserve dialog (`ReserveInventoryDialog`) offers only `manual`, `order` and `transfer`; the `wms` reservations list shows a `'checkout'` row with its translated label; `WmsInventoryConsolePage` shows no release or allocate action on a `'checkout'` row.

---

## 13) Implementation Phases

### Phase 1 — Base contract, fallback and policy

Two deliverables with different homes, per the Reconciliation note — an earlier revision of this list still named a `contract.ts` inside this module and a fallback owned by it, both of which that note had already relocated:

- **`packages/shared/src/lib/availability/`** — `AvailabilityQuery` / `AvailabilityResult` / `AvailabilityProvider` types, the `availabilityProviderRegistry`, and the built-in `catalog-only` fallback provider. Dependency-free, so it works even when this module is ejected.
- **`packages/core/src/modules/availability/`** — `AvailabilityPolicy`, `lib/policyResolution.ts`, admin CRUD, `acl.ts`, `events.ts`. No `contract.ts`; this module consumes the shared types rather than defining them (§3.1).

**Gate:** a storefront-shaped consumer gets coherent states with `wms` disabled; policy resolution correct at all six levels.

### Phase 2 — `wms` implementation
Batched aggregation, safety-stock handling, low-stock thresholds, product rollup, cache and event-driven invalidation.

The provider shipped for Phase 2 (`wms/lib/availabilityCalculation.ts`) predates this amendment and must be brought in line with §4.2 (still open on 2026-10-26; done as Phase 3 step W2): `findProfile` falls back to the product-level row on a variant lookup, `sellableFor` subtracts safety stock per variant, the product rollup simply sums the per-variant sellable with no product-pool subtraction, and no lot-eligibility filter is applied. The R1 multi-location test, the product-level-pool rollup test and the ineligible-lot test in §12 cover the alignment.

**Gate:** R1 and R4 tests pass, plus the product-level-pool rollup and ineligible-lot tests (§12); states match hand-computed expectations on a seeded multi-location warehouse.

### Phase 3 — Reservations

Release 5 (`ANALYSIS-2026-10-26-availability-release-5.md`, D-R5-8…10, D-R5-AV1…8). Seven steps, each one small PR with its own gate; a step starts only when the previous gate is green. Every step's PR names its step id and is checked against the deliverables and the gate below.

**W1 — `wmsReservationService` extraction, a pure move (A1).** Move the bodies of `wms.inventory.reserve` and `wms.inventory.release` into `wms/lib/wmsReservationService.ts` (`reserveInTransaction`, `releaseInTransaction`, `emitSideEffects`) and register `wmsReservationService` in `wms/di.ts`. The commands become wrappers that keep their post-commit work (side effects, `wms.inventory.reserved`/`.released`, low-stock check). Because errors now cross a DI boundary, every `instanceof CrudHttpError` that can see a service error becomes `isCrudHttpError`: the six `wms/api` catch sites (`api/inventory/helpers.ts`, `api/inventory/import/helpers.ts`, `api/scan/putaway/route.ts`, `api/scan/receive/route.ts`, `api/scan/resolve-location/route.ts`, `api/scan/resolve-lot/route.ts`) and the two predicates in `wms/lib/salesOrderInventoryAutomation.ts` (`insufficient_stock`, `balance_integrity_violation`). No behaviour change. `emitSideEffects` is deferred to AV2a (decided 2026-11-24 on #10020): W1's command wrappers keep emitting after commit, and AV2a moves the post-commit work into the service together with its `onTransactionLifetimeComplete` deferral. Both service entry points authorize the input tenant and organization and put them into every reservation, warehouse and balance predicate before lookup or lock, so a direct caller cannot charge one scope's stock to another.
**Gate:** every existing `wms` reserve/release test passes unchanged; TC-WMS-002, TC-WMS-021 and TC-WMS-027 pass; the in-transaction rollback tests (§12) pass.

**W1b — two deliberate behaviour fixes in the existing commands.** (1) `reserveInTransaction` writes in a savepoint; when the insert loses the active-key race, only the savepoint rolls back and the call replays the winner's row. (2) `releaseInTransaction` on a row that is no longer `active` is a no-op that returns the row; it never decrements the balance again. Both are named in §15 and `UPGRADE_NOTES.md`. A21, the expiry sweep and drift (a) depend on (2).
**Gate:** the two W1b tests in §12 pass; every W1 gate test still passes.

**W2 — Phase 2 alignment (A2).** One sellable computation in `wms` (§4.2), with the read provider's SQL as its first input now and the gate's locked read in AV2a. `findProfile` stops falling back to the product row on a variant lookup; the product pool is subtracted once at rollup; the lot-eligibility filter and the staging/dock exclusion are applied on the read path; `locationIds` keeps filtering locations and the additive `warehouseIds` is added to `AvailabilityQuery` (D-R5-31).
**Gate:** the R1 multi-location, product-pool rollup, ineligible-lot and staging/dock tests pass; the `locationIds`/`warehouseIds` tests pass; R4's constant query count still holds.

**AV1 — the hold entity and the `'checkout'` source.** `AvailabilityReservation` entity, migration with `down()` and snapshot (§5.3). The `'checkout'` union member, the command guard on `wms.inventory.reserve`, `.release` and `.allocate` (D-R5-AV5), the OpenAPI system-only note, `ReserveInventoryDialog` unchanged, the release and allocate actions hidden in `WmsInventoryConsolePage`, the translated label in every `wms` locale, and the `UPGRADE_NOTES.md` entry (A16).
**Gate:** the AV1 API and command tests in §12 pass; `yarn typecheck` is green across packages (exhaustive switches updated); the migration applies and reverts.

**AV2a — `reserve` and `release`.** Prerequisite: F1, the shared `buildTrustedCommandContext` helper in `@open-mercato/shared/lib/commands/trusted-context` (roadmap), is on `main`; this step's commands build their service context with it. Deliverables: `reserveLinesForCheckout` in `wms` with the global lock order (D-R5-AV7) and the gate's input to the sellable computation; `availability.reserve` (hold row first, D-R5-AV1; selected-provider check; `storeId`, D-R5-AV6) and `availability.release`; the error table (§4.1); post-commit work including the `wms` domain events (D-R5-AV8), deferred through `onTransactionLifetimeComplete` under a caller transaction; events `.created`, `.released`, `shortfall.detected` (§9); the real-Postgres suites and their CI selection (§12), including pool exhaustion.
**Gate:** the parallel tests (single warehouse, two warehouses, product pool, racing the confirm automation, same-key race), multi-line all-or-nothing, the caller-rollback test and pool exhaustion pass **in CI against Postgres**, shown by `jest --listTests`; every `reserve`/`release` case in §12 passes.

**AV2b — `commit`, recovery and the confirmed-first protocol.** `convertInTransaction` with the source-variant advisory lock, covering-row claims, private `shrinkReservationBuckets` and the `|converted|<id>` key suffix (§4.4, D-R5-AV2); `sourceTargetQuantity` on `wms.inventory.reserve` with `sourceHeldQuantity` and `409 source_reservation_busy` plus bounded retries, and the automation passing it; `availability.commit` with recovery (`exact` mode, netting of automation rows, rewrite of `wms_reservation_ids`, D-R5-AV4), the terminal `stock_lost` status (D-R5-AV3), the `availability.stock_lost_after_payment` notification with `reportError` in its catch, and `.committed`.
**Gate:** every `commit` and confirmed-first case in §12 passes, including commit racing the sweep (exactly one wins), the repeated `stock_lost`, the recovery netting and the `sourceTargetQuantity` race against Postgres.

**AV3 — jobs.** The expiry and drift-check workers (§10) with per-hold failure isolation, drift cases (a)–(d), schedules in `seedDefaults` and the upgrade action `availability.register-reservation-sweep-schedules` with its i18n keys, versioned to the release it ships in.
**Gate:** the worker, drift and upgrade-action cases in §12 pass, including a poison hold that does not stop the batch and the scheduler-scope assertion.

**Landing order with checkout.** Checkout submit (its re-land slice CH4) MUST NOT be reachable on `main` before AV3 has merged. Without the expiry worker, only checkout's own recovery frees an abandoned hold. If CH4 is ready first, it waits.

**All steps.** Audit log labels of the new commands are i18n keys (`availability.audit.reservations.*`), never English strings, and `release` records its `reason` in the log context.

Consumers revised in the same Release 5 spec pass, not here: checkout §7.2/§7.3 (commit right after step 4, payment failure compensated by cancelling the order, quote release, abort only on `shortfall` lines, a new key per attempt with different content), and roadmap R5, whose "inside the order transaction" wording is corrected in the roadmap file by its own editor (A10): the hold is authoritative at submit before the document, compensated on failure, with no unheld window until `commit`.

Phases 1 and 2 unblock spec 4 (public API). Phase 3 is required only by spec 7 (checkout) and may run in parallel with specs 3–5.

---

## 14) Open Questions

1. **Reserve at cart for scarce goods** — a per-policy `reserve_at_cart` flag with a short TTL would serve ticketing and limited drops. *Deferred; §7 records why it is not the default.*
2. **Store-to-warehouse allocation** — which warehouses serve which store is a fulfilment-rules question that belongs with shipping. *Narrowed 2026-10-26:* `locationIds` means locations and `warehouseIds` is the additive warehouse filter (D-R5-31); the reservation gate allocates primary warehouse first across every warehouse of the organization (§4.1, A7). Mapping a store to its warehouses stays out of Release 5.
3. **Backorder capacity** — `allow_backorder` is unbounded; a tenant may want "backorder up to 100 units". *Deferred.* A backorder line holds `min(requested, sellable)` and admits the rest unbounded (D-R5-9); `max_order_quantity` gives a blunt cap in the meantime.
4. **Channel-specific stock allocation** — reserving a slice of inventory for a channel (marketplace vs. own store) is a real B2B requirement with no model here. *Out of scope; would extend `AvailabilityPolicy` with channel allocations.*
5. ~~**Commit point, backorder holding, undo semantics**~~ — *Closed 2026-10-26* by D-R5-8 (commit at order-document creation), D-R5-9 (backorder holds what is sellable) and D-R5-10 (commands not undoable).
6. **`availability.state.changed`** — back-in-stock signal; *deferred to spec 9*, not Release 5 (§9).

---

## 15) Migration & Backward Compatibility

- This spec introduces a brand-new DI/type contract, written out in §4.1a. The Reconciliation note originally deferred its canonical shape to `wms-roadmap.md` rev 11; that section is not present in this repository (see "Status of the deferral"), so §4.1a stands as the shape Phase 1 builds against. If that upstream section lands here it supersedes §4.1a, and whoever lands it MUST diff the two and reconcile explicitly in one direction — a DI/type contract can only be frozen once (`BACKWARD_COMPATIBILITY.md` categories 2 and 9). Implementers MUST NOT re-derive the shape from this file's original 2026-08-14 draft either way.
- `InventoryReservationSourceType` gains `'checkout'` — additive extension of an exported union, `BACKWARD_COMPATIBILITY.md` category 2 (Types). The `source_type` column is `text`, so no migration is needed. Any exhaustive `switch` over the union needs a new branch, a compile-time failure caught by `yarn typecheck`, documented in `UPGRADE_NOTES.md`.
- New ACL features (`availability.policies.view/.manage`, `availability.check`) are additive; `setup.ts` MUST declare `defaultRoleFeatures` for `admin`/`employee` so existing tenants receive them via `yarn mercato auth sync-role-acls`, not only new tenants via `onTenantCreated`.
- No consumer (`catalog`, `sales`, `wms`) gets a hard `requires: ['availability']` — `availability` remains fully ejectable, matching `wms`'s own `ejectable: true` precedent. `wms`'s optional dependency on `availability`'s policy resolution is soft (`tryResolve`), never a hard `requires`.
- `reserve`/`release`/`commit` ship as new commands (`availability.reserve`/`.release`/`.commit`, `isUndoable: false`, D-R5-10); no existing command is renamed or removed.
- `availability.reserve` takes an optional `storeId` (additive, D-R5-AV6); omitting it resolves policies as before, without a store.
- `wms.inventory.release` input is unchanged: it gains **no** `quantity` input. Partial release (newest bucket first) is the private service helper `shrinkReservationBuckets`, used only by `convertInTransaction` (§4.4, D-R5-AV2).
- **`wms.inventory.reserve` gains the optional command input `sourceTargetQuantity`** (categories 3 and 7, additive, D-R5-AV2). The HTTP route schema (`inventoryReservationCreateSchema`) strips it, so the public route is unchanged; only in-process callers (the `sales.order.confirmed` automation) set it, through `inventoryReservationCreateCommandSchema`. With it, the result gains the optional `sourceHeldQuantity`, and the command can answer the new `409 source_reservation_busy` after five bounded retries. Callers that do not pass it see no change. The automation now passes it on every reserve, so every `wms` tenant takes the source-variant advisory lock on automation reserves and may see a redelivered `sales.order.confirmed` subscriber run when the lock stays busy; `UPGRADE_NOTES.md` records it.
- **Two deliberate behaviour fixes in the existing `wms` commands** (category 7 behaviour, §13 W1b). `POST /api/wms/inventory/release` (and `wms.inventory.release`) on a row that is no longer `active` becomes a no-op that returns the row; before, it decremented the balance again or threw `balance_integrity_violation`. `wms.inventory.reserve` that loses the active-key insert race now replays the winner's row from a savepoint instead of failing. Both only remove failure modes; `UPGRADE_NOTES.md` records them.
- **New DI key `wmsReservationService`** (category 9, additive), implemented in `wms/lib/wmsReservationService.ts`. Frozen when Phase 3 ships, with later changes additive only: the methods `reserveInTransaction`, `releaseInTransaction`, `convertInTransaction`, `reserveLinesForCheckout` (each `(trx, ctx, input[, options])`) and `emitSideEffects(ctx, sideEffects)`, their options (`sourceTargetQuantity`, `rejectSourceTypes`) and their result types, exactly as §4.1b writes them. `findReservationsByIds` and `listActiveReservationsBySourceType` are marked `@internal` and are not frozen. `wms.inventory.reserve`/`.release` keep their ids, inputs and results (plus the additive `sourceTargetQuantity` above); they become wrappers over the service.
- **New table `availability_reservations`** (category 8, additive), with its migration and `.snapshot-open-mercato.json` update in the `availability` module. No existing table changes.
- **`'checkout'` is system-only** (category 7, D-R5-AV5). One command guard: `wms.inventory.reserve` refuses `sourceType: 'checkout'`, and `wms.inventory.release` and `wms.inventory.allocate` refuse a `'checkout'` row, each with `400 checkout_reservation_is_system_only`. The value did not exist before Phase 3, so no existing request changes behaviour. The exported `InventoryReservationSourceType` and the shared zod enum include `'checkout'`, and so do the route request schemas; the OpenAPI doc of each of the three routes marks the value system-only.
- **`AvailabilityQuery.warehouseIds`** (category 2, additive, D-R5-31): a new optional field in `packages/shared/src/lib/availability/types.ts`. `locationIds` keeps its shipped meaning (location ids), now documented; no shipped field changes meaning.
- **New event ids** (category 5, additive): `availability.reservation.created|released|committed|expired` and `availability.shortfall.detected`, payloads per §9, frozen when Phase 3 ships. **New notification type** (category 11, additive): `availability.stock_lost_after_payment`.
- **New upgrade action** `availability.register-reservation-sweep-schedules` (`configs/lib/upgrade-actions.ts`, additive), versioned to the `@open-mercato/core` release it ships in; it registers the §10 schedules for existing tenants.
- No new ACL feature, no new public route, no new CLI command in Phase 3.

**`UPGRADE_NOTES.md` lines this phase must add** (each in the PR of its step):
- W1b: `wms.inventory.release` on a non-`active` row is a no-op; a lost reserve insert race replays instead of failing.
- AV1: `InventoryReservationSourceType` gains `'checkout'` (update exhaustive switches); `'checkout'` rows are system-only and refused by reserve, release and allocate with `400 checkout_reservation_is_system_only`; listings show a translated label.
- AV2a: `wmsReservationService` DI key; `availability.reserve`/`.release` commands; `availability.reserve` accepts `storeId`; checkout holds now emit `wms.inventory.reserved`/`.released` and the low-stock check like manual reservations.
- AV2b: `wms.inventory.reserve` accepts `sourceTargetQuantity` in-process, returns `sourceHeldQuantity`, and may answer `409 source_reservation_busy`; the `sales.order.confirmed` automation uses it and can be redelivered; `availability.commit`; hold status `stock_lost`.
- AV3: run the upgrade action `availability.register-reservation-sweep-schedules` for existing tenants.

---

## 16) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `wms`'s provider reads its own entities; `availability`'s policy resolution is soft-resolved by `wms` via `tryResolve`, never an ORM relation; `availability` soft-resolves `wmsReservationService` and stores `wms` reservation ids as plain ids (`wms_reservation_ids`), never imports `wms` entities or queries `wms` tables; `catalog_product_id` / `catalog_variant_id` / `order_id` are FK ids throughout |
| Tenant/organization scoping | Every query and every policy row scoped; `reserve`/`release`/`commit` take `tenantId` + `organizationId` and find the hold by `(tenant, organization, key)` (A4); worker payloads carry `tenantId` (D-R5-32); asserted per test |
| No direct `wms` dependency from commerce | `ecommerce`, `cart` and `checkout` depend only on `packages/shared`'s `resolveAvailability()` (no module `requires` edge at all) for reads, and on `availability`'s `reserveAvailability()`/`releaseAvailability()`/`commitAvailability()` commands for holds |
| Optional-module tolerance | Base contract + `catalog-only` fallback ship in `packages/shared` (zero footprint); `availability` module itself is `ejectable: true`; no consumer requires either `wms` or `availability` to boot |
| Backward compatibility | `InventoryReservationSourceType` extended additively; new DI key, table, events, notification type, upgrade action, `warehouseIds`, `storeId` and `sourceTargetQuantity`, all additive; two named behaviour fixes in `wms` (W1b); no field removed or retyped; noted in `UPGRADE_NOTES.md` — see §15 |
| Zod validation | Policy routes; command inputs validated at the boundary |
| No `any` | Contract fully typed |
| Optimistic locking | `AvailabilityPolicy` exposes `updatedAt` for `CrudForm`. `AvailabilityReservation` is not user-editable (no form, no route); its transitions are fenced by CAS on `status` (§5.3) |
| Command pattern | `availability.reserve`/`.release`/`.commit` are registered commands with `isUndoable: false` (D-R5-10), audited, like `wms.inventory.reserve`/`.release`. Their audit entries use i18n action label keys (`availability.audit.reservations.*`), and `release` records its `reason` in the log context. Reversal is an explicit counter-action: `release` with a reason, or checkout's compensation table (checkout §7.3), never an audit-log Undo. They do not call `wms` commands through the command bus; they call `wmsReservationService` inside their own single transaction, or a savepoint of the caller's (§4.1b), and the `wms` side effects and events run after the owning commit and are dropped on rollback (A19) |
| Cache safety | Tag-based invalidation via the `cache` module; no raw Redis |
| i18n | State labels and lead-time strings, the `availability.stock_lost_after_payment` notification title and body, the audit action labels and the `duplicateLine` error key in every `availability` locale (`en`, `pl`, `de`, `es`, `ko`); the `'checkout'` source label in every `wms/i18n` locale; the upgrade-action keys in `configs/i18n`; nothing hard-coded |
| Error reporting | Every catch that records an error also calls `reportError`: the notification catch in `commit`, the per-hold catch of the expiry sweep, the per-repair catch and the drift reports of the drift check |
| Connections under lock | Nothing under a row or advisory lock takes a second pool connection; the commands reuse `ctx.transactionalEm` (§4.1b, #8414) |
| Background work | Expiry and drift-check are `@open-mercato/queue` workers with tenant-scoped payloads, per-hold failure isolation, schedules in `seedDefaults` and an upgrade action for existing tenants (§10) |
| Events | Declared with `createModuleEvents`; payloads carry `tenantId`/`organizationId` (§9) |
| Integration coverage | §12, shipping in the same change |

---

## 17) User Story Map (Prototype Input)

*Added 2026-08-31 to support the `om-mockup-prototype` backend click-through. Derived from §5, §8, §9, §12's data/API/event contracts; no new scope. Epics A–B are backoffice UI journeys; Epics C–D are internal service-contract journeys (storefront/checkout developers and ops/support) with no dedicated end-user screen — a prototype built from them should treat their screens as illustrative debug/ops tooling, not the contract itself.*

### Epic A — Sell Policy Configuration
Merchandiser authors per-variant/product/store sell policy.

- **US-A1** — As a merchandiser, I want to set sell-policy fields (stock-managed toggle, backorder + lead time, preorder release date, low-stock threshold, min/max/increment quantity, hide-when-out-of-stock) on a policy row scoped to a variant, product, or store default, so that buyers see accurate purchasability without engineering involvement.
  - AC: a variant/product with no policy row yet shows "No policy set — inheriting from parent/tenant defaults" (§5.2's module default), never a form pre-filled with blanks that look like explicit zeros.
  - AC: policy list/edit requires `availability.policies.view`/`.manage`; a view-only role sees read-only fields and no Save action, not a 403 after submit.
  - AC: enabling `allow_backorder` makes `backorder_lead_time_days` required inline, validated before submit.
  - AC: `min_order_quantity`/`max_order_quantity`/`quantity_increment`/`low_stock_threshold` reject negative input and `max < min` inline.
  - AC: saving over a stale version shows the platform conflict bar (`surfaceRecordConflict`) naming the concurrent editor's change, per root `AGENTS.md` optimistic locking.
  - AC: Cmd/Ctrl+Enter submits the policy form, Escape cancels.
  - AC: `is_stock_managed` defaults per §5.2's module default (checked when `wms` is enabled and a `ProductInventoryProfile` exists, else unchecked) — shown as a real toggle state, not blank.

- **US-A2** — As a merchandiser, I want to see which level of the resolution chain (variant+store → variant → product+store → product → store default → module default) currently decides each field before I save an override, so that I don't create a redundant or conflicting one.
  - AC: a brand-new product with no policy rows anywhere shows every field resolving to "module default", clearly labeled.
  - AC: the resolution preview updates live as the admin edits the form, before save.

### Epic B — Diagnosing Availability States
Support explains why a buyer saw a given state.

- **US-B1** — As a support agent, I want an admin check tool that reproduces exactly what a buyer saw (state, sellable quantity, `policySourceId`) for a given item/tenant/store, so that I can answer "why is this out of stock" without re-deriving the resolution chain by hand.
  - AC: gated by `availability.check`; a user without it gets an explicit no-access state, not a silent empty result.
  - AC: querying an item with no balance data and no policy (fallback path) returns `not_tracked` with a plain explanation, not an error.
  - AC: an unknown item id shows an inline "no such product/variant" error, never a stack trace or blank panel.
  - AC: quantity defaults to 1, store defaults to the tenant's default store.
  - AC: Cmd/Ctrl+Enter runs the check.

- **US-B2** — As a support agent, I want the check result to name the exact `policySourceId` (or "module default") for every resolved field, so that I can explain an unexpected state without guessing across store/product/variant overrides.
  - AC: each resolved field shows its source as a visible child(variant) → parent(product) → store → module-default trace, not a tooltip that must be discovered (mirrors the customer-groups Epic C "explain terms" pattern).
  - AC: `not_tracked` is visually and textually distinct from `in_stock` in the tool's own output — it must never render as "in stock" (R5, §3.2).

### Epic C — Advisory vs. Authoritative Availability (internal consumer contract)
Storefront/checkout developers rely on the read/hold distinction from §7.

- **US-C1** — As a storefront developer building a listing or PDP, I want `resolveAvailability()`'s result to unambiguously mark itself advisory (`isAuthoritative: false`, up to 60s stale), so that I never treat a browse-time state as a stock guarantee.
  - AC: the response shape makes advisory-vs-live unambiguous for every call site (browse-cached vs. cart-live, §6) — acceptance here is contract clarity, not a UI state.
  - AC: `not_tracked` cannot be collapsed into `in_stock` by a naive consumer reading the response (R5).

- **US-C2** — As a checkout developer, I want `reserveAvailability()` to be the single authoritative gate before an order is placed, returning a per-line shortfall instead of an opaque failure, so that checkout shows one "no longer available" error per line rather than failing the whole cart blindly.
  - AC: a shortfall response names each affected `catalogProductId`/`catalogVariantId` with requested vs. available quantity (§4.1's `AvailabilityShortfallLine`).
  - AC: every line returns an outcome (`held`, `not_tracked`, `preorder`, `backorder`, `shortfall`, D-R5-9); checkout aborts only on `shortfall` lines, so a tenant without `wms` or a backorder line never blocks checkout.
  - AC: a reserve with any `shortfall` line holds nothing — all-or-nothing per call (§12); there is no partial state to roll back.
  - AC: N parallel reserve calls for the last unit succeed exactly once; the loser gets a shortfall response, never a silent double-sell (§12).

### Epic D — Shortfall & Reservation Lifecycle (Ops/Support)
Ops/support keep abandoned holds from locking up stock.

- **US-D1** — As an ops/support user, I want to be alerted when the checkout shortfall rate rises, so that I know when the staleness budget or reservation model needs revisiting rather than hearing it from angry buyers.
  - AC: `availability.shortfall.detected` fires once per `reserve()` with a `shortfall` line, and once with `reason: 'stock_lost_after_payment'` when `commit` cannot recover a lost hold (§9) — this story is observability-only; no dashboard is in this spec's scope (§8 defines no public storefront endpoints).
  - AC: a lost hold on an existing order also raises the in-app notification `availability.stock_lost_after_payment` naming the order and the number of short lines, once per hold; it never fails silently.

- **US-D2** — As an ops/support user, I want abandoned checkout holds to release automatically and holds that disagree with their `wms` rows to be repaired by reconciliation, so abandoned checkouts don't quietly lock up sellable stock (R6).
  - AC: default `ttlSeconds` is 900 (bounded 60–3600); the one-minute expiry sweep gives a documented worst case of about 16 minutes (§10). Only holds still `active` expire; a hold committed to an order never does.
  - AC: a hold whose `wms` rows were released or are missing, a `'checkout'` `wms` row with no hold, and a committed hold whose rows are still `'checkout'` are each repaired and logged by the hourly drift check (§10); a committed hold whose rows are released or missing is reported; none is left silently.
  - AC: there is no audit-log Undo for `reserve`, `release` or `commit` (D-R5-10). Reversal is an explicit counter-action: `release` with a reason, or cancelling the order for a committed hold. `release` is safe to run more than once: on a hold that is no longer `active` it changes nothing and returns the current status (A21).
  - AC: Release 5 ships no reservations screen (A18, D-R5-34); the hold row keeps `expiresAt` and per-line `heldQuantity` so the list can be added later.

### Cross-cutting rules (apply to every screen/consumer above)

- `resolveAvailability()` (advisory) and `reserveAvailability()`/`commitAvailability()` (authoritative) must never be conflated by any caller or screen — the single most likely misuse (§4.1).
- `not_tracked` is never rendered as `in_stock`, anywhere a state renders (§3.2, R5).
- `check()` issues exactly one balance aggregation, one profile lookup, one policy lookup per call regardless of item count (§4.2) — no screen or prototype may assume per-item calls.
- Every policy edit dialog: Cmd/Ctrl+Enter submits, Escape cancels (root `AGENTS.md`).
- The optimistic-lock conflict bar is the platform's shared component, reused here for `AvailabilityPolicy` edits — not redrawn.
- No hardcoded status colors — the six availability states use DS status tokens.

---

## 18) Changelog

### 2026-11-24 (W1 review on #10020)
- §13 W1: `emitSideEffects` deferred to AV2a; the service validates input scope at both entry points and scopes every reservation, warehouse and balance lookup.

### 2026-11-19 (Re-landing audit — remediation of `.ai/analysis/pre-implement-2026-08-14-availability-contract-release-5.md`)
- C1 — §4.2: "one SQL builder" replaced by one sellable computation with two inputs (the read provider's SQL and the gate's locked ORM read); staging/dock locations excluded on both paths, matching `isBalanceLocationReservable`; §12 step-W2 test "staging/dock stock is not sellable"; R9, R13 updated.
- C2 — §4.1b Deadlocks: the gate locks in the global `wms` order (variant id, then `(created_at, id)`); advisory-lock rule (blocking before balance locks, try-lock after); no deadlock retry (D-R5-AV7); R17.
- C3 — §4.1b, §6, R15: cache invalidation comes from the balance CRUD side effect (`wms.inventory_balance.updated` → `wms:invalidate-availability-cache`); the domain events are a separate step (I8).
- I1 — §4.1b step 1: hold row first in a savepoint, then the gate (D-R5-AV1).
- I2 — §4.1 outcome table: the selected provider is resolved as `resolveAvailability()` does; `catalog-only` gives `not_tracked`.
- I3 — §4.1b "Called inside a caller's transaction", §9: commands run on `ctx.transactionalEm`; post-commit work deferred with `onTransactionLifetimeComplete`, dropped on rollback; "One connection" invariant; R18, R19.
- I4 — §4.1 error table per command (`403` scope, `404 reservation_not_found`, `409 commit_conflict`, `409 idempotency_key_mismatch`), `isCrudHttpError` across DI.
- I5, O2 — §4.4 rewritten to the confirmed-first protocol (D-R5-AV2); §15 drops the public `quantity` input on `wms.inventory.release`; R20.
- I6 — §4.1 commit recovery: leftover checkout rows released first; `not_convertible` on an `active` hold goes to recovery; `wms_reservation_ids` rewritten; automation rows netted (D-R5-AV4); §10 drift (d) not triggered by a recovered hold.
- I7, O3 — `stock_lost` is a terminal hold status (§4.1 type, §5.3 column `shortfall` and state machine, §9) (D-R5-AV3).
- I8 — §4.1b, §6, §9: the service path emits `wms.inventory.reserved`/`.released` and runs the low-stock check (D-R5-AV8).
- I9 — §13 W1 (`isCrudHttpError` at the six `wms/api` catch sites and the automation predicates; TC-WMS-002/021/027 in the gate) and W1b (savepoint replay, non-`active` release no-op); "no behaviour change" kept only for W1; §15 names both fixes.
- I10, O5 — §4.4, §8, §12, R14: one command guard refuses `'checkout'` on reserve, release and allocate with `400 checkout_reservation_is_system_only`; OpenAPI marks the value system-only; the console hides release and allocate (D-R5-AV5).
- I11 — §12 "Real-Postgres execution": CI selection in `test:pg-integration`, `jest --listTests` evidence, pool-sized-to-concurrency suite; AV2a gate runs in CI.
- I12 — §10 Schedules, §15: `seedDefaults` plus the upgrade action `availability.register-reservation-sweep-schedules`, versioned to the release it ships in; scheduler-scope assertion.
- I13 — §10: per-hold `try/catch` with `reportError` in the expiry sweep and the drift repairs.
- I14, O6 — §4.1: optional `storeId` on `reserve`; policies resolve with it (D-R5-AV6).
- I15 — §13 AV2a: F1 (`buildTrustedCommandContext`) is a prerequisite.
- I16 — §4.1, §9, §13, §16: `reportError` in the notification catch; i18n audit labels; `reason` in the audit log.
- I17 — §4.1 Validation, §5.3: decimal quantity (4 places) in input and snapshot; `warehouseIds: []` rejected; `duplicateLine` key in every locale.
- I18 — §13 landing order: checkout submit (CH4) is not reachable on `main` before AV3; R21.
- I19 — §4.1b, §15: real file `wms/lib/wmsReservationService.ts`, signatures `(trx, ctx, input[, options])`, `emitSideEffects(ctx, sideEffects)`, real result shapes; `findReservationsByIds` / `listActiveReservationsBySourceType` marked `@internal`.
- B1–B5 — §15: frozen service surface (B1); `sourceTargetQuantity` / `sourceHeldQuantity` / `409 source_reservation_busy` (B2); the two W1b behaviour fixes (B3); command guard and OpenAPI note (B4); category 2 for the union (B5); the `UPGRADE_NOTES.md` lines per step. B6 is covered by I8.
- N1 category fix (§4.4, §15). N2 `status_reason` `ttl`, `expires_at` not null, no extra scope index, `down()` (§5.3). N3 notification carries a line count, five locales (§9). N4 checkout's release reason `'quote'` (§4.1, §7); `reason` capped at 120 like `wms.inventory.release`. N5 `warehouse_ids` stored on the hold and used by recovery (§5.3, §4.1). N6 no personal data, no encryption map (§5.3). N7 API-level `400` tests (§12). N8 §13 Phase 3 aligned to the seven steps W1, W1b, W2, AV1, AV2a, AV2b, AV3, each with its gate. N9 drift (d) report-only, telemetry codes, drift (b) tenant-wide (§10).

#### Owner decisions (2026-11-19)
- **D-R5-AV1** — Inside `availability.reserve` the hold row is inserted first, then the gate runs; the reference order must change when ported. (O1, I1) — owner, 2026-11-19
- **D-R5-AV2** — The confirmed-first path adopts the reference protocol: source-variant advisory lock, `sourceTargetQuantity`, `|converted|<id>` key suffix, private newest-first `shrinkReservationBuckets`, `sourceHeldQuantity`, `409 source_reservation_busy` with bounded retries; no public `quantity` on `wms.inventory.release`. (O2, I5) — owner, 2026-11-19
- **D-R5-AV3** — `stock_lost` is a terminal hold status; a repeated `commit` returns it without re-gating or a second notification. (O3, I7) — owner, 2026-11-19
- **D-R5-AV4** — Commit recovery re-reserves `heldQuantity` in `exact` mode and subtracts active `order` rows the automation already holds, under the conversion advisory lock. (O4, I6) — owner, 2026-11-19
- **D-R5-AV5** — `'checkout'` rows are refused by `wms.inventory.reserve`, `.release` and `.allocate` with `400 checkout_reservation_is_system_only` (command guard; OpenAPI marks the value system-only); the console hides release and allocate. (O5, I10, B4) — owner, 2026-11-19
- **D-R5-AV6** — `availability.reserve` takes an optional `storeId`; policies resolve with it; checkout passes the session's store. (O6, I14) — owner, 2026-11-19
- **D-R5-AV7** — The gate locks balance rows in the global `wms` order: variants by variant id, within a variant by `(created_at, id)`; no deadlock retry. (C2) — owner, 2026-11-19
- **D-R5-AV8** — The service path emits the same post-commit `wms.inventory.reserved` / `.released` events as the command wrappers and runs the low-stock check. (I8) — owner, 2026-11-19

### 2026-10-26 (Release 5 spec revision)
Source: `ANALYSIS-2026-10-26-availability-release-5.md` (A1–A21), owner decisions D-R5-8, -9, -10, -18, -20, -31, -32, -34 (`ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md`), cross-spec review `ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md`.
- Reconciliation note, §4.1, §16: `availability.reserve`/`.release`/`.commit` are `isUndoable: false`, audited counter-actions (D-R5-10). The undo design of 2026-08-17/2026-10-11 and the claim that the commands compose `wms.inventory.reserve` "in the same transaction" are withdrawn.
- §4.1b (new): the gate and the `wms` writes run in one transaction through the additive `wmsReservationService` (`reserveInTransaction`, `releaseInTransaction`, `convertInTransaction`, `reserveLinesForCheckout`, `emitSideEffects`), with lock order, service boundary and failure modes; `wms` side effects run after commit (A1, A19).
- §4.1: signatures rewritten. Scope on `release`/`commit` (A4); per-line outcomes `held | not_tracked | preorder | backorder | shortfall`, backorder holds `min(requested, sellable)` (D-R5-9, A6); no `wms` means `not_tracked` (D-R5-18); allocation primary warehouse first via `sortWarehouseAvailabilityForReservation`, one row per `(variant, warehouse)`, store-to-warehouse out of scope (A7); `409 idempotency_key_mismatch` (A15); `ttlSeconds` 60–3600, default 900 (A17); release on a non-active hold is a no-op (A21); commit at order-document creation with CAS on `status = 'active'`, one fresh reserve on loss and `stock_lost_after_payment` (D-R5-8, A5); quote outcome releases the hold (D-R5-20, A9).
- §4.1a, §4.2: `locationIds` documented as location ids, additive `warehouseIds` (D-R5-31); one shared SQL builder for the read provider and the gate (A2).
- §4.4: `'checkout'` is system-only on `POST /api/wms/inventory/reserve`, kept off `ReserveInventoryDialog`, with an i18n label (A16). The confirmed-first path leaves the checkout flow and is kept only for integrators who confirm first, with the automation conflict, key collision and partial-release bucket rules specified (A8).
- §5.3 (new): `AvailabilityReservation` (`availability_reservations`) with indexes and a CAS state machine (A3).
- §7: timeline shows the checkout hold from submit to the order document, then the order hold until payment or cancellation, plus the quote row (D-R5-8, A5, A9).
- §8: Phase 3 adds no routes; the admin reservations list is out of Release 5 (A18, D-R5-34).
- §9: event payloads with `tenantId`/`organizationId` (A13, D-R5-32), the distinction from `wms.inventory.reservation_shortfall`, the `availability.stock_lost_after_payment` notification; `availability.state.changed` stays with spec 9.
- §10: expiry worker over a partial index with CAS (A11); reconciliation redefined as a hold ↔ `wms` drift check (A12); tenant-scoped tick payloads.
- §11: R6, R7, R9 updated; R10–R16 added. §12: Phase 3 coverage per A20 plus step 0/1 tests. §13: Phase 3 split into step 0 (Phase 2 alignment), step 1 (`wmsReservationService` extraction), step 2 (hold, commands, jobs), each with a gate; roadmap R5 is corrected in its own file (A10). §14: Open Question 2 narrowed, 3 updated, decisions recorded. §15: new DI key, table, system-only source, `warehouseIds`, events and notification type. §17: US-C2, US-D1, US-D2 updated.

### 2026-10-11 (post-merge review of #5384)
- Reconciliation note, §4.1 and §16: corrected the claim that the `wms` reservation commands are already undoable and named them by id. `wms.inventory.reserve`/`wms.inventory.release` are deliberately `isUndoable: false` (`wms/commands/inventory-actions.ts`) — counter-actions over an append-only ledger. `availability.reserve`/`.release`/`.commit` stay this module's own undoable commands; each `extractUndoPayload()` records what its undo needs, and undo is per command: `reserve` → `wms.inventory.release`; `release` → re-reserve via `availability.reserve` from the original reserve input recorded in its undo payload (`items`, `sourceId`, `ttlSeconds`, scope) under a fresh idempotency key (the released row is not `active`, and `wms`'s idempotent replay matches only active holds), failing with `shortfall` when the stock is gone by then; `commit` → restore `source_type`/`source_id`/`idempotency_key`, or, on the already-confirmed path, re-reserve the released remainder via `availability.reserve` (failing with `shortfall` if the stock is gone).
- TLDR and §1: the `availabilityService` DI contract is replaced by the shared `resolveAvailability()` read contract plus the `availability.reserve`/`.release`/`.commit` commands.
- §4.1: `reserve` now re-derives each line's sellable quantity from §4.2 — safety stock and lot eligibility included — under locks held in the same transaction as the wms reserve calls and returns `reserved: false` with `shortfall` when `requested > sellable`; for a product-level safety-stock pool it also checks the sum of the call's requested quantities for the product's variants against the product-level sellable (the per-variant sellable summed, minus the pool) under the same locks — active holds already sit inside `quantity_available` — so the authoritative hold no longer sells the safety buffer on the checkout path.
- §4.2: the aggregation joins `wms_inventory_lots` (excluding soft-deleted lots) and excludes balances whose lot is not `available` or has expired, matching `wms.inventory.reserve`'s eligibility; a product-level `safety_stock` (`catalog_variant_id IS NULL`) is defined as a product pool subtracted once at rollup, never per variant, with variant queries not falling back to it and §4.1's reserve gate applying it.
- §4.4: `commit` rebuilds the wms `idempotency_key` when it rewrites `source_type`/`source_id` to the order, runs before `sales.order.confirmed`, and — when the order is confirmed first — reads the order's per-variant quantities from the sales order lines through the query engine (as the subscriber does), matches the order's active reservations for the variant summed across warehouses (not by idempotency key, since the subscriber splits a variant across warehouse buckets), converts only the shortfall the order does not already hold and releases the part of the checkout hold the order already covers, in one transaction, so the order is never reserved twice.
- §15: `wms.inventory.release` gains an optional additive `quantity` input (it takes only `reservationId` and `reason` today, `wms/data/validators.ts`) that reduces the reservation row and the balance's reserved quantity under the same locks; `commit` uses it to release part of a checkout hold, making it a `wms` prerequisite of phase 3 with existing callers unaffected.
- §11: added R9 (safety-stock or lot-eligibility bypass at reserve time).
- §12: added coverage for the safety-buffer gate, ineligible lots, the product safety-stock pool and both commit/auto-reservation orderings.
- §13 Phase 2: notes that the shipped provider (`wms/lib/availabilityCalculation.ts`) still falls back to the product-level row, subtracts per variant, sums the rollup without the product pool and applies no lot filter; it must be brought in line with §4.2, covered by the §12 R1, product-pool and ineligible-lot tests.
- §10 and §17/US-D2: corrected the expiry worst case from 30 minutes to about 16 minutes (900s TTL + a sweep of at most one minute).

### 2026-09-30 (review fixes on PR #6709)
- §5.1: `is_stock_managed` is nullable and cascades like the other nullable fields; `null` defers to the next less-specific row and finally to the §5.2 module default. A store-default row created only to set a threshold no longer switches stock tracking off for every product. Migration `Migration20260930120000_availability`.
- §5.2: when `wms` runs without the `availability` module, its open policy default derives `is_stock_managed` from the inventory profiles it already loaded (tracked only when a `ProductInventoryProfile` exists), matching the module default.
- Providers resolve their dependencies from the calling request's container (`resolveAvailability(query, { container })`) instead of a closure over the container that registered them.

### 2026-09-22 (Phase 1 + Phase 2 implemented)
- Implemented §13 Phase 1 (base contract in `packages/shared/src/lib/availability/`, the `availability` module's `AvailabilityPolicy` + 6-level resolution chain + admin CRUD + admin check tool) and Phase 2 (`wms`'s `AvailabilityProvider`: batched sellable-quantity aggregation, safety-stock-once-per-variant, low-stock thresholds, product rollup, 60s-TTL cache with balance-change invalidation). Phase 3 (reservations) remains unimplemented — this spec stays in `.ai/specs/`, not `.ai/specs/implemented/`.
- Implementation deviations from the literal spec text, each justified against an existing codebase precedent (full rationale in the PR's run folder, `.ai/runs/2026-09-22-release-2-availability-contract/PLAN.md` § Key design decisions):
  - `resolveAvailability()`'s per-tenant provider selection takes an optional, locally-declared `moduleConfig` reader port rather than importing `ModuleConfigService` directly, keeping `packages/shared` at zero domain dependencies (mirrors `llm-provider-registry.ts`'s existing port/adapter pattern).
  - The `catalog-only` fallback's optional `AvailabilityPolicy` awareness (§4.3) is wired through a settable module-level hook (`setCatalogOnlyPolicyLookup`) rather than a container parameter on the provider interface, since `packages/shared` has no DI container to receive one.
  - §6's cache invalidation tag is `wms`'s own single coarse `wms:availability` tag (tenant-scoped automatically), not the literal per-`{tenantId}:{variantId}` tag named in the table — matching the already-shipped `WMS_INVENTORY_CACHE_TAG` precedent and its documented over- vs under-invalidation tradeoff.
  - `AvailabilityQuery` gained an additive, optional `bypassCache?: boolean` field so §6's "cart re-validation: never cached" row has a caller-facing hook, ahead of any caller in this repository actually needing it (cart/checkout are out of scope here).
- `events.ts` declares only `availability.policy.{created,updated,deleted}` — `availability.state.changed`, `availability.reservation.*`, and `availability.shortfall.detected` are not declared, since nothing in Phase 1/2 emits them; they belong to Phase 3 / spec 9 and will be added when that work lands.

### 2026-08-31 (story map)
- Added §17 User Story Map to support the `om-mockup-prototype` backend click-through: 4 epics, 9 stories, UX acceptance criteria (empty/permission/error/optimistic-lock/keyboard/default-value states applied only where genuinely applicable — Epics C/D are internal service-contract journeys, not end-user screens). No scope change.

### 2026-09-06
- **The 2026-08-17 deferral pointed at a section that does not exist in this repository.** `.ai/specs/2026-04-15-wms-roadmap.md` is present and carries no "Cross-Module Availability Contract" section; `packages/shared/src/lib/availability/` does not exist; and §4.1's `AvailabilityItemQuery` / `AvailabilityItemResult` were named but defined nowhere, leaving the module's central contract unreachable and Phase 1 unimplementable. Added a "Status of the deferral" note stating this plainly, and **§4.1a**, which writes out the base contract from what this document already specified across §3.2, §4.1, §4.2 and §6 plus the four changes the reconciliation itself agreed — a transcription of the agreed design, not a competing one. The upstream section still wins if it lands; until then §4.1a is what Phase 1 builds against, so the phase is not blocked on a document that may never arrive.
- §13 Phase 1's deliverable list still named a `contract.ts` inside this module and a fallback owned by it — both relocated to `packages/shared` by the 2026-08-17 reconciliation, and neither present in §3.1's own module tree. Split into the two real deliverables with their actual homes.
- §15 updated to match.

### 2026-08-17
- Reconciled with the independently-approved `wms-roadmap.md` rev 10/11 design for the same contract, found by a joint `/om-pre-implement-spec` audit (see Reconciliation note at the top of this document). Base contract, registry, and catalog-only fallback move to `packages/shared`; this module is re-scoped to `AvailabilityPolicy` + the reservation lifecycle; `AvailabilityItemRef.productId`/`.variantId` renamed to `catalogProductId`/`catalogVariantId`; `reserve`/`release`/`commit` specified as undoable commands wrapping `wms`'s existing reservation commands; added §15 Migration & Backward Compatibility (previously missing).

### 2026-08-14
- Initial specification.
- Grounded in the implemented `wms` model: `InventoryBalance` (per warehouse + location + variant + lot + serial, with `quantity_available` a **stored generated column** equal to `on_hand − reserved − allocated`), `InventoryReservation` (`source_type`, `source_id`, `expires_at`, `status`, `idempotency_key` all already present), and `ProductInventoryProfile` (`safety_stock`, `reorder_point`, per product/variant).
- Confirmed `catalog` carries no stock or sell-policy fields, which is why `AvailabilityPolicy` is introduced here rather than as a `catalog` extension.
- Confirmed `wms/di.ts` registers entity classes only, with no service layer — the `availabilityService` registration is new.
