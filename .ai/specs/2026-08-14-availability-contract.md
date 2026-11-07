# Availability Contract

| Field | Value |
|-------|-------|
| **Status** | Specification (Phase 1 + Phase 2 implemented 2026-09-22; Phase 3 — reservations — still pending, revised 2026-10-26 for eComm Release 5) |
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

export type AvailabilityReservationStatus = 'active' | 'committed' | 'released' | 'expired'

/**
 * Authoritative, transactional hold. MUST NOT be called at browse time.
 * Command `availability.reserve`, isUndoable: false (D-R5-10).
 */
export async function reserveAvailability(input: ReservationScope & {
  items: Array<{ catalogProductId: string; catalogVariantId?: string | null; quantity: number }>
  sourceType: 'checkout'
  sourceId: string
  idempotencyKey: string
  ttlSeconds?: number              // zod: integer 60–3600, default 900 (A17)
  warehouseIds?: string[] | null   // additive (D-R5-31); null → every warehouse of the organization
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
  reason: string                   // audited; checkout uses e.g. 'checkout_compensation', 'session_expired', 'quote_outcome'
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

**Validation** (`data/validators.ts`, zod). `items` is non-empty, each `quantity` is a positive number, and an `(catalogProductId, catalogVariantId)` pair appears at most once per call (the caller sums duplicate cart lines). `ttlSeconds` is an integer from 60 to 3600, default 900 (A17). `reason` is a non-empty string of at most 200 characters. `sourceType` accepts only `'checkout'`.

**Scope (A4).** All three commands take `tenantId` and `organizationId` and find the hold by `(tenant_id, organization_id, idempotency_key)`. A key that exists only in another organization is `not_found` for `release` and a not-found command error for `commit`; nothing outside the caller's scope is read or written.

**Per-line outcomes (D-R5-9).** Each line's policy comes from `policyResolutionService` (already in this module's DI), with the same chain and module defaults as the read path (§5.2):

| Line | Outcome | Held |
|---|---|---|
| `is_stock_managed` resolves `false`, or `wmsReservationService` is not resolvable, or the tenant's selected provider (§4.1a) is not `wms` (D-R5-18: no `wms` means `not_tracked`) | `not_tracked` | nothing |
| `preorder_release_at` is in the future | `preorder` | nothing |
| stock-managed, `requested ≤ sellable` | `held` | `requested` |
| stock-managed, `requested > sellable`, `allow_backorder` | `backorder` | `min(requested, sellable)`; `backorderQuantity = requested − heldQuantity` |
| stock-managed, `requested > sellable`, no backorder | `shortfall` | nothing |
| stock-managed line without `catalogVariantId` | `shortfall` with `available: 0` | nothing (`wms` balances exist only per variant; checkout always passes the cart line's variant) |

`not_tracked` and `preorder` lines never fail the call. `reserved` is `true` when no line is `shortfall`. When any line is `shortfall`, the call writes nothing (all-or-nothing): `reservationId` and `expiresAt` are `null`, every line reports `heldQuantity: 0`, and `availability.shortfall.detected` is emitted once for the call. When `reserved` is `true`, the call writes one `AvailabilityReservation` row (§5.3) even when no line holds anything, so `release` and `commit` work the same way for every outcome.

**The gate.** For stock-managed lines, the call re-derives each variant's sellable quantity with the §4.2 builder (safety stock and lot eligibility included) on balance rows it has locked, in the same transaction that writes the `wms` rows (§4.1b). For a product with a product-level safety-stock pool it also checks the sum of the call's quantities for that product's variants against the product-level sellable (the per-variant sellable summed, minus the pool); a `backorder` line takes what the pool leaves after the `held` lines. Active holds already sit inside `quantity_available` and are not counted again. `wms` allocation alone uses raw `on_hand − reserved − allocated`, so this gate is what keeps the safety buffer from being sold.

**Warehouse allocation (A7).** Per variant, warehouses are ordered by the existing `sortWarehouseAvailabilityForReservation` (`wms/lib/primaryWarehousePolicy.ts`, already used by the sales-order automation): the primary warehouse first, then the others by eligible available quantity. The held quantity is filled greedily in that order, with **one `wms` reservation row per `(variant, warehouse)`**. Inside a warehouse, location and lot buckets are allocated exactly as `wms.inventory.reserve` allocates them today (the code moves into the service in step 1, §13). `warehouseIds` narrows the warehouses considered. Which warehouses serve which store is out of scope for Release 5 (Open Question 2); with no `warehouseIds`, every warehouse of the organization is in scope.

**Idempotency and key mismatch (A15).** `idempotency_key` is unique per `(tenant_id, organization_id)` across every status. A call with a known key replays: when `sourceType`, `sourceId` and the normalized `items` (sorted by line key, equal quantities) match the stored hold, it returns the stored result with the hold's current status and writes nothing, even when the hold is `released` or `expired`. When any of them differs, it answers `409 idempotency_key_mismatch` and writes nothing. Checkout mints a new `stock_reservation_key` for every submit attempt whose cart content differs from the previous attempt (re-price or edit).

**Release (A21).** `release` moves an `active` hold to `released` with a CAS update on `status = 'active'` and releases its `wms` rows through `wmsReservationService.releaseInTransaction` in the same transaction. On a hold that is `committed`, `released` or `expired`, or on an unknown key, it changes nothing and returns the current status (`not_found` for an unknown key), so checkout's `retry-failed-compensations` can re-run it safely. A committed hold is never released here: its stock belongs to the order, and cancelling the order releases it through `wms`'s existing `sales.order.cancelled` handling.

**Commit (D-R5-8).** Checkout calls `commit` right after its step 4 creates the order document, **before payment**. In one transaction it moves the hold from `active` to `committed` with a CAS update on `status = 'active'` (recording `order_id`) and converts every `wms` row through `wmsReservationService.convertInTransaction`: `source_type` `'checkout'` → `'order'`, `source_id` → the order id, the `wms` `idempotency_key` rebuilt for the new source (§4.4), and `expires_at` cleared. The stock is never unheld, because nothing is released first. An `order` row never expires. If payment then fails or is abandoned, checkout's compensation cancels the order and `wms` releases the `order` rows on `sales.order.cancelled`.
- A repeat call for a `committed` hold with the same `orderId` returns `committed` and writes nothing; with a different `orderId` it answers `409 idempotency_key_mismatch`.
- When the CAS finds the hold `expired` or `released` (the sweep or a compensation won), `commit` makes **one** fresh gated reserve for the hold's stored items, written directly as `order` rows (`sourceType: 'order'`, `sourceId` = the order id, no expiry), in the same transaction and with the same per-line rules. On success the hold moves to `committed` by CAS on the status it read, and the result is `recovered`.
- If that fresh reserve finds a shortfall, nothing is written and the result is `stock_lost`: the order exists and its stock is gone. `commit` emits `availability.shortfall.detected` with `reason: 'stock_lost_after_payment'` and raises the in-app notification `availability.stock_lost_after_payment` for ops (§9); it never fails silently. The code keeps the name D-R5-8 gave it although commit now runs before payment: it marks an order whose stock was lost after the order was created. What checkout does with such an order is checkout §7.2's decision.

**Quote outcome (D-R5-20, A9).** When submit ends with `outcome_kind: 'quote'`, checkout calls `release` with `reason: 'quote_outcome'` after the quote document is created. A quote is non-binding: no stock is held behind it, and stock is taken when the merchant converts the quote and confirms the order, through `wms`'s existing `sales.order.confirmed` automation.

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

**`locationIds` and `warehouseIds` (D-R5-31).** The shipped provider filters `locationIds` on `wms_inventory_balances.location_id`, while earlier text in this section and in §4.2 spoke of warehouses. The shipped meaning stands and is now documented: `locationIds` are location ids. Warehouse filtering is the additive optional `warehouseIds` field; no shipped field changes meaning. The read provider and the reservation gate (§4.1) both accept `warehouseIds` through the shared §4.2 builder.

**Not in the shared contract, deliberately:** reservations. `reserve`/`release`/`commit` are transactional writes owned by this module (§4.1), not read-side helpers, and putting them in `packages/shared` would give a dependency-free package a transaction boundary.

### 4.1b Transaction design: `wmsReservationService` (A1)

**Why not the `wms` commands.** `wms.inventory.reserve` runs on `ctx.container.resolve('em').fork()` inside its own `transactional()` (`wms/commands/inventory-actions.ts`). In MikroORM v7 that fork carries no transaction context, so its `transactional()` opens a new transaction on another connection. Calling it from inside the gate's transaction fails one of two ways. If the gate holds its balance locks, `wms`'s own `FOR UPDATE` waits on its caller until the lock or idle timeout, and submit hangs. If it does not, two buyers pass the gate together and the safety buffer is sold (R9), and a multi-line call that fails on line 3 has already committed lines 1–2. Checkout §7.2 records the same platform rule for its own steps: every `commandBus.execute()` commits its own transaction.

**Service boundary.** `wms` registers an additive DI service, `wmsReservationService`, in `wms/di.ts`. Its methods take the caller's transactional `EntityManager` and never fork, open or commit a transaction:

```typescript
// packages/core/src/modules/wms/lib/reservationService.ts
type Scope = { tenantId: string; organizationId: string }

export type WmsReservationService = {
  /** Body of wms.inventory.reserve, unchanged: one (warehouse, variant), bucket allocation, idempotent replay. */
  reserveInTransaction(trx: EntityManager, input: Scope & InventoryReservationCreateInput): Promise<WmsWriteResult<{ reservationId: string; allocatedBuckets: AllocatedBucket[] }>>
  /** Body of wms.inventory.release; optional additive `quantity` for the §4.4 integrator path. */
  releaseInTransaction(trx: EntityManager, input: Scope & { reservationId: string; reason: string; quantity?: number }): Promise<WmsWriteResult<{ releasedQuantity: number }>>
  /** In-place source change: source_type/source_id rewritten, idempotency_key rebuilt, expires_at cleared. */
  convertInTransaction(trx: EntityManager, input: Scope & { reservationId: string; sourceType: 'order'; sourceId: string }): Promise<WmsWriteResult<{ reservationId: string }>>
  /** The gate (§4.1): lock, compute sellable, check, allocate across warehouses, insert. All or nothing. */
  reserveLinesForCheckout(trx: EntityManager, input: {
    scope: Scope
    lines: Array<{ key: string; catalogProductId: string; catalogVariantId: string; quantity: number; mode: 'exact' | 'up_to_sellable' }>
    sourceType: 'checkout' | 'order'
    sourceId: string
    expiresAt: Date | null
    warehouseIds?: string[] | null
  }): Promise<
    | WmsWriteResult<{ ok: true; lines: Array<{ key: string; sellable: number; heldQuantity: number; reservationIds: string[] }> }>
    | { ok: false; lines: Array<{ key: string; requested: number; sellable: number }> }
  >
  /** Runs the side effects a write collected, after the caller's transaction committed (A19). */
  emitSideEffects(sideEffects: WmsSideEffects): Promise<void>
}
type WmsWriteResult<T> = T & { sideEffects: WmsSideEffects }
```

`mode: 'up_to_sellable'` is used for backorder lines (hold `min(requested, sellable)`); `mode: 'exact'` for every other stock-managed line. `sourceType: 'order'` is used only by the commit recovery path (§4.1). The existing `wms.inventory.reserve` and `wms.inventory.release` commands become thin wrappers: they open their transaction as today, call the matching `…InTransaction` method, and call `emitSideEffects` after commit. `convertInTransaction` and `reserveLinesForCheckout` are new and have no command of their own; only `availability`'s commands call them. Nothing changes for current callers; the existing `wms` tests are the safety net (§13 step 1).

`availability` soft-resolves the service with `tryResolve` (`packages/core/AGENTS.md` → Cross-Module Coupling) and never imports `wms` entities or writes SQL against `wms` tables. The locking and sellable logic is `wms`'s invariant and stays in `wms`.

**One transaction, in this order.** `availability.reserve` opens one transaction (`em.transactional`) and:
1. inserts its `AvailabilityReservation` row with `status = 'active'`. The unique index on `(tenant_id, organization_id, idempotency_key)` serializes two calls with the same key: the second waits on the index, then replays or answers `409` (§4.1);
2. calls `reserveLinesForCheckout`, which locks with **one** `SELECT … FOR UPDATE` statement, ordered by balance id, every balance row of every variant in the call plus every active variant of any product in the call that has a product-level pool;
3. inside the service: computes sellable from the locked rows with the §4.2 builder (locked variant), checks per-variant and per-pool totals, and returns `ok: false` without writing when any `exact` line fails;
4. inside the service: allocates across warehouses (§4.1, A7), inserts the `wms` rows with `source_type = 'checkout'` and `expires_at`, and updates the balances' reserved quantity;
5. writes the hold's `items` (with per-line outcomes) and `wms_reservation_ids` onto its row and commits once.

After the commit, and only then, it calls `emitSideEffects` (the `emitInventorySideEffects` path and the `wms.inventory.reserved` event, so the existing `invalidate-availability-cache` subscriber fires and browse reads are not stale for the full 60 s, A19) and emits `availability.reservation.created` (§9). `release`, `commit` and the expiry worker follow the same pattern: CAS on the hold row, the service call(s), one commit, side effects and events after commit. A call with only `not_tracked`/`preorder` lines, or a tenant without `wms`, skips steps 2–4.

**Deadlocks.** Every other `wms` writer locks one `(warehouse, variant)` set per transaction, ordered by id; the sales-order automation runs one command (one transaction) per bucket. The gate takes all its locks in one statement in the same global id order, so no lock cycle exists. The transaction makes no external call (no HTTP, no gateway, no event dispatch) while it holds the locks.

**Failure modes.**

| Failure | Result |
|---|---|
| A line is `shortfall` | The transaction rolls back: no hold row, no `wms` rows. `availability.shortfall.detected` is emitted after the rollback. |
| Lock wait exceeds the database `lock_timeout`, or a serialization or connection error | The transaction rolls back and the command throws; nothing is held. Checkout treats it as a failed submit step; its compensation's `release` finds no hold and is a no-op (A21). |
| Unique violation on the hold key (a concurrent same-key call won) | The transaction rolls back; the command re-reads the winner's row and replays it or answers `409 idempotency_key_mismatch`. |
| Process dies after commit, before side effects | The stock is correct. The cache entry stays stale for at most its 60 s TTL and the events of that call are lost, as for the `wms` commands today. The drift job (§10) does not depend on events. |
| `wmsReservationService` not resolvable | Every line is `not_tracked` (D-R5-18); the hold row is written with no `wms` rows. |

### 4.2 The `wms` implementation

Sellable quantity, per variant, in one aggregation. **One SQL builder** in `wms` produces this statement for both callers (A2): the read provider (`wms/lib/availabilityCalculation.ts`, no locks) and the reservation gate (`reserveLinesForCheckout`, §4.1b), which computes the same numbers from the balance rows it has locked with `FOR UPDATE`. There is exactly one definition of sellable; the two paths cannot drift.

```sql
-- Aggregate across every in-scope location, THEN subtract the per-variant buffer.
-- Ineligible lots (quarantined or expired) are excluded, matching wms.inventory.reserve.
SELECT b.catalog_variant_id,
       SUM(b.quantity_available) AS aggregate_available
FROM   wms_inventory_balances b
LEFT JOIN wms_inventory_lots l ON l.id = b.lot_id AND l.deleted_at IS NULL
WHERE  b.tenant_id = $1 AND b.organization_id = $2
  AND  b.catalog_variant_id = ANY($3)
  AND  (b.warehouse_id = ANY($4) OR $4 IS NULL)   -- warehouseIds (additive, D-R5-31)
  AND  (b.location_id = ANY($5) OR $5 IS NULL)    -- locationIds (location ids, as shipped)
  AND  b.deleted_at IS NULL
  AND  (b.lot_id IS NULL OR (l.status = 'available' AND (l.expires_at IS NULL OR l.expires_at > now())))
GROUP BY b.catalog_variant_id
```

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

`InventoryReservationSourceType` becomes `'order' | 'transfer' | 'manual' | 'checkout'`. Additive union extension — per `BACKWARD_COMPATIBILITY.md` this is permitted on an ADDITIVE-ONLY surface. Existing consumers narrowing on the three current values are unaffected; any exhaustive `switch` in `wms` gains a branch.

`commit` transitions the reservation's `source_type` from `'checkout'` to `'order'` and rewrites `source_id` to the order id, rather than releasing and re-reserving — releasing first opens a window in which another buyer takes the stock out from under an order that already exists.

It MUST also rebuild the reservation's wms `idempotency_key`, because `wms` derives that key from `source_type` and `source_id` alongside the variant, warehouse and quantity (`wms/lib/inventoryIdempotency.ts`); rewriting the first two while leaving the key stale produces a row that `wms`'s own idempotent replay can never match again, so a later `reserve` for the same order and bucket would take the quantity a second time.

**`'checkout'` is a system-only source (A16).** Only `availability`'s commands create `'checkout'` rows. The public `POST /api/wms/inventory/reserve` route rejects `sourceType: 'checkout'` with `400` (its zod schema for the route narrows the enum to `'order' | 'transfer' | 'manual'`), so a tenant cannot create by hand a hold that the expiry sweep would later release. `ReserveInventoryDialog` keeps offering only the three manual sources. Reservation listings show `'checkout'` rows with a translated label (`en.json`/`pl.json` in `wms/i18n`), never the raw value.

**Interaction with the `sales.order.confirmed` automation.** `wms`'s subscriber tops up only reservations whose `source_type` is `order` and `source_id` is the order id, subtracting what they already hold (`wms/lib/salesOrderInventoryAutomation.ts`). A hold still on `'checkout'` is invisible to it. Checkout commits right after creating the order document and before any status that emits `sales.order.confirmed` (D-R5-8, §4.1), so on the checkout path the automation always finds the `order` rows and reserves nothing more.

**Confirmed-first path, kept only for integrators who confirm first (A8).** An integrator calling `availability.reserve` directly may confirm the order before calling `commit`. Checkout never takes this path. For that integrator, `commit` reads the order's per-variant quantities from the sales order lines through the query engine (`E.sales.sales_order_line`, as the subscriber loads them, never a `sales` ORM import), looks up the order's active reservations for the variant (`source_type = 'order'`, `source_id` = the order id, summed across warehouses, because the subscriber splits a variant across warehouse buckets), converts only the part of the checkout hold the order does not already hold, and releases the rest, all in one transaction. Three points are specified:
1. **The automation competes with the live checkout hold.** When it ran while the checkout hold still held the stock, it found too little stock, emitted a false `wms.inventory.reservation_shortfall` and reserved less (or nothing). `commit` repairs the quantity as above. The false shortfall event is not retracted; integrators who confirm first accept it, which is why checkout commits first.
2. **Key collision.** The rebuilt `wms` key (`sourceType|sourceId|variant|warehouse|quantity`, `wms/lib/inventoryIdempotency.ts`) can equal the key of an automation row for the same order, variant, warehouse and quantity; the active-only unique index then rejects the conversion. `convertInTransaction` checks for an active row with the rebuilt key first; when one exists, it releases the checkout row's quantity instead of converting it (the order is already held), so the unique index is never hit.
3. **Partial release.** Releasing part of a checkout row uses `releaseInTransaction` with the optional `quantity`. It reduces the row, the balances' reserved quantity and `metadata.allocatedBuckets` **newest bucket first**, then rebuilds the row's key because quantity is part of it, all under the same locks.

`wms.inventory.release` exposes the same optional `quantity` input (additive, §15).

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
| `status` | text | `active \| committed \| released \| expired` |
| `expires_at` | timestamptz | `now() + ttlSeconds` at reserve; kept on `committed` rows for the record, ignored by the sweep |
| `items` | jsonb | Snapshot per line: `catalogProductId`, `catalogVariantId`, `requested`, `outcome`, `heldQuantity`, `backorderQuantity` |
| `wms_reservation_ids` | jsonb | `string[]` of the `wms_inventory_reservations` ids the hold owns; empty when no line holds stock |
| `order_id` | uuid, nullable | Set by `commit` |
| `status_reason` | text, nullable | Reason of the last transition (`release` reason, `expired`, `reconciled`) |
| `created_at`, `updated_at` | timestamptz | `updated_at` changes on every transition |

Indexes:
- unique `(tenant_id, organization_id, idempotency_key)` over **all** statuses, so a key is never reused for different content (§4.1, A15);
- partial `(expires_at) WHERE status = 'active'` for the expiry sweep (§10, A11);
- `(tenant_id, organization_id, source_type, source_id)` for lookups by session.

No `deleted_at`: rows are never soft-deleted; they are the audit trail of the hold. Retention (purging old `released`/`expired` rows) is not in Release 5 scope. The table is not user-editable (no admin form, A18), so it carries `updated_at` for transitions only, with no optimistic-lock header.

**State machine.** Every transition is a conditional update on the expected status (`UPDATE … WHERE id = ? AND status = ?`), the fenced-lease rule; an update that matches zero rows lost the race and changes nothing.

| From | To | By | Guard |
|---|---|---|---|
| (none) | `active` | `reserve` | unique key |
| `active` | `committed` | `commit` | `status = 'active'` |
| `active` | `released` | `release` | `status = 'active'` |
| `active` | `expired` | expiry worker | `status = 'active' AND expires_at < now()` |
| `expired` / `released` | `committed` | `commit` recovery (fresh reserve succeeded, §4.1) | `status` = the value `commit` read |
| `committed` | (none) | — | Terminal here. The `order` rows are released by `wms` when the order is cancelled. |

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

`wms` emits balance-change events already; this module subscribes and invalidates by tag. If `wms` is absent, nothing changes and nothing needs invalidating. Reservation writes made through `wmsReservationService` emit the same `wms` side effects after their transaction commits (§4.1b, A19), so a hold, release, commit or expiry invalidates browse reads like any other `wms` movement.

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
t4' quote document created     (payment method request_quote) releaseAvailability(reason 'quote_outcome');
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

**Phase 3 adds no routes.** `availability.reserve`, `.release` and `.commit` are reached only in-process through the command bus (checkout resolves them softly, D-R5-18); none has an HTTP route. The admin reservations list (`GET /api/availability/reservations`) is **outside Release 5** (A18, D-R5-34); `AvailabilityReservation` keeps `expires_at`, `items` and per-line `heldQuantity` so it can be added later without a migration. The only route-level change in Phase 3 is in `wms`: `POST /api/wms/inventory/reserve` rejects `sourceType: 'checkout'` with `400` (§4.4, A16).

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

Declared in `availability/events.ts` with `createModuleEvents`. Every payload carries `tenantId` and `organizationId` (D-R5-32). Reservation and shortfall events are emitted **after** the transaction that caused them commits (or, for a shortfall, after it rolled back), never from inside it.

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
| `availability.shortfall.detected` | `reserve`, `commit` | Once per call with at least one `shortfall` line, or once when commit recovery finds the stock gone |

**Not to be confused with `wms.inventory.reservation_shortfall`.** That event belongs to `wms`'s sales-order automation (an order could not be fully reserved after confirmation). `availability.shortfall.detected` is the checkout-path gate refusing a hold. They are separate signals and neither replaces the other.

`availability.shortfall.detected` matters operationally: a rising rate means the staleness budget or the reservation model needs revisiting, and without the event nobody would know.

**Notification.** `reason: 'stock_lost_after_payment'` also raises the in-app notification type `availability.stock_lost_after_payment` (declared in `availability/notifications.ts`, i18n title and body in `en.json`/`pl.json`), sent to staff of the organization holding `availability.policies.manage`. It names the order and the lines. No other Phase 3 event notifies anyone.

**`availability.state.changed` stays with spec 9** (back-in-stock) and is not Release 5 scope. When built, it is emitted by the invalidation subscriber when a recomputed state differs from the cached one, per variant, debounced to at most one event per variant per minute, never per balance row.

---

## 10) Background Jobs

Both jobs are `@open-mercato/queue` workers in `availability/workers/`, following the `cart` sweeper pattern (`cart/workers/expire.worker.ts`, schedules registered in `setup.ts`): one scheduled tick per tenant whose payload carries the scope (`{ tenantId }`, D-R5-32), `concurrency: 1`, and a tick without `tenantId` is logged and skipped. Each tick processes the tenant's organizations in batches and is idempotent: running it twice changes nothing the first run did not.

| Job (worker id) | Cadence | Purpose |
|---|---|---|
| `availability:expire-reservations` | every minute | Expire `active` holds past `expires_at` (A11) |
| `availability:reconcile-reservations` | hourly | Detect and repair drift between hold rows and `wms` rows (A12) |

**Expiry (A11).** Selects up to 200 holds per batch with `status = 'active' AND expires_at < now()` for the tenant, using the partial index `(expires_at) WHERE status = 'active'` (§5.3), so the per-minute tick never scans committed or released rows. Each hold runs in its own transaction: CAS `active → expired` (`status_reason = 'ttl'`); when the CAS matches a row, release its `wms` rows through `wmsReservationService.releaseInTransaction`; commit; then `emitSideEffects` and `availability.reservation.expired`. A CAS that matches nothing means `commit` or `release` won, and the hold is skipped. Nothing in `wms` processes `InventoryReservation.expires_at` today, so this job is the only path that frees an abandoned checkout hold; it touches only holds owned by `availability`, never `wms` rows of other sources. With the 900 s default TTL and a one-minute tick, an abandoned hold is freed after about 16 minutes at worst.

**Reconciliation (A12), redefined as a drift check.** `availability` cannot ask whether a checkout session still exists (it does not depend on `checkout`). Checkout releases its own holds when its sessions expire or are cancelled (its recovery jobs). This job checks only that the two sides of a hold agree:

| Drift | Repair | Report |
|---|---|---|
| (a) hold `active`, but one or more of its `wms` rows are released or missing | Release the remaining `wms` rows; CAS the hold `active → released` with `status_reason = 'reconciled'`; emit `availability.reservation.released` | Logged with tenant, organization, hold id |
| (b) active `wms` row with `source_type = 'checkout'` that no hold's `wms_reservation_ids` contains | Release the `wms` row through the service | Logged with the `wms` reservation id |
| (c) hold `committed`, but one or more of its `wms` rows still have `source_type = 'checkout'` | Convert them through `convertInTransaction` with the hold's `order_id` | Logged with hold id and order id |

Each repair runs in its own transaction with the same CAS guards as §5.3. Repairs are logged through the structured logger (`createLogger('availability')`) with a per-tick count; a non-zero count is a defect signal, not a routine event. Drift (b) only considers rows older than the maximum TTL (3600 s) so that a hold mid-transaction is never touched.

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
| R9 | Safety stock or lot eligibility bypassed at reserve time | **High** | `availability`, `wms` | `wms.inventory.reserve` allocates against raw `on_hand − reserved − allocated`; a gate that skips the §4.2 sellable re-derivation lets a checkout hold sell the safety buffer or a quarantined/expired lot, with no error. | The gate runs inside `wmsReservationService.reserveLinesForCheckout`, which locks the balance rows, re-derives sellable with the shared §4.2 builder (safety stock, pool and lot eligibility included) and writes the `wms` rows in the same transaction (§4.1b); §12 asserts the buffer, pool and ineligible-lot cases under parallel load | Low |
| R10 | Gate and `wms` writes in separate transactions (A1) | **High** | `availability`, `wms` | Composing `wms.inventory.reserve` through the command bus opens a second transaction on another connection: with the gate's locks held, submit hangs until the lock timeout; without them, the safety buffer and the pool are oversold, and a multi-line call commits lines 1–2 before line 3 fails. | One transaction through `wmsReservationService` (§4.1b); one sorted lock statement; the parallel tests in §12 (single warehouse, split across two warehouses, product pool) | Low |
| R11 | Hold expires during payment (A5) | **High** | `availability`, `checkout` | 3DS, BLIK or a slow webhook pushes payment past the TTL; the sweep frees the stock and another buyer takes it from a paid order. | Commit at order-document creation, before payment (D-R5-8); `order` rows never expire; commit and sweep race only through CAS on `status = 'active'`; a losing commit re-reserves once and raises `stock_lost_after_payment` | Low |
| R12 | Same key reused with a different cart (A15) | Medium | `availability`, `checkout` | A retry after a cart edit replays the old hold, and the order is created against lines that are not held. | `409 idempotency_key_mismatch` on any difference in source or items; checkout mints a new key per attempt with different content | Low |
| R13 | Phase 2 provider not aligned before the gate (A2) | **High** | `availability`, `wms` | The gate inherits the product-row fallback, the missing pool subtraction and the missing lot filter: shortfalls on stock that exists, or quarantined stock admitted. | Phase 3 step 0 (§13) aligns the provider and introduces the one shared SQL builder before any reservation code | Low |
| R14 | Hand-made `'checkout'` holds (A16) | Low | `wms` | A tenant creates a `'checkout'` row through the manual reserve route; the drift check then releases it as orphaned. | `'checkout'` is system-only: the public `wms` route rejects it with `400`; the dialog does not offer it | Low |
| R15 | Missed cache invalidation after a hold (A19) | Medium | `availability`, `wms` | The service path skips `wms` side effects; browse reads show the stock as available for the full 60 s after it was held. | `emitSideEffects` after every commit (§4.1b); §12 asserts that a `check` right after `reserve` reflects the hold | Low |
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

**Phase 2 alignment (step 0, A2):**
- R1 multi-location test, product-pool rollup test and ineligible-lot test pass against the shared SQL builder, for both the read provider and the locked gate variant
- A variant query never falls back to the product-level profile row
- `locationIds` filters locations and `warehouseIds` filters warehouses, separately and combined (D-R5-31)

**`wms` service extraction (step 1, A1):**
- The existing `wms` reserve and release integration tests pass unchanged with the commands as wrappers over `wmsReservationService`
- `reserveInTransaction` and `releaseInTransaction` called inside a caller's transaction write nothing when that transaction rolls back
- `POST /api/wms/inventory/reserve` with `sourceType: 'checkout'` answers `400` and writes nothing (A16)

**Reservation behaviour (step 2):**
- `reserve` succeeds, holds stock, writes one `AvailabilityReservation` row, and a `check` issued right after reflects the hold (cache invalidated after commit, A19)
- `reserve` refuses a quantity that fits raw available but exceeds sellable — 10 on hand with a buffer of 8 gives sellable 2, so a reserve of 5 is refused and no pair of 5s can both succeed
- `reserve` refuses a quantity held only in a quarantined or expired lot
- Multi-line all-or-nothing: line 3 `shortfall` leaves lines 1–2 unheld, no hold row and no `wms` rows; `availability.shortfall.detected` is emitted once with line 3
- N parallel `reserve` calls for the last unit, single warehouse: exactly one succeeds
- N parallel `reserve` calls for the last units with the stock **split across two warehouses**: exactly the sellable total is held, one `wms` row per `(variant, warehouse)`, primary warehouse filled first
- Parallel `reserve` calls for different variants of a product with a **product-level pool**: the pool is never sold
- A checkout `reserve` racing a `sales.order.confirmed` automation reserve for the same variant: the sellable total is never exceeded and neither side deadlocks
- Repeated `idempotencyKey` with the same content returns the original hold without double-holding; with different items or `sourceId` answers `409 idempotency_key_mismatch` and writes nothing (A15)
- `ttlSeconds` outside 60–3600 is rejected; omitted gives 900 and `expiresAt = now + 900 s` (A17)
- A tenant without `wms` (module disabled) reserves with every line `not_tracked`, `reserved: true`, and checkout does not abort (D-R5-9, D-R5-18)
- A line whose policy is `is_stock_managed = false` is `not_tracked`; a preorder line before `preorder_release_at` is `preorder`; both hold nothing
- A backorder line with 3 sellable and 5 requested holds 3 and returns `backorderQuantity: 2` (D-R5-9)
- `release` of an active hold frees the `wms` rows and emits `.released`; a second `release`, a `release` of a committed or expired hold, and a `release` with an unknown key change nothing and return the current status (A21)
- `commit` converts the `wms` rows in place (`source_type 'order'`, `source_id` = order id, rebuilt key, `expires_at` cleared); no moment exists in which the stock is unheld (R7); a repeat with the same order id is a no-op, with another order id `409`
- `commit` followed by `sales.order.confirmed` for the same order holds exactly the ordered quantity, with no second reservation
- `commit` racing the expiry sweep on an expired-at-boundary hold: exactly one CAS wins; when the sweep wins, `commit` re-reserves once (`recovered`), and when the stock is gone it returns `stock_lost`, emits `availability.shortfall.detected` with `reason: 'stock_lost_after_payment'` and creates the `availability.stock_lost_after_payment` notification (D-R5-8)
- Cancelling the committed order releases the `order` rows through `wms`'s existing subscriber
- Quote outcome: `release` with `reason: 'quote_outcome'` leaves nothing held (D-R5-20, A9)
- Confirmed-first integrator path (§4.4): `sales.order.confirmed` before `commit` keeps exactly the ordered quantity held; a key collision with an automation row does not raise a unique violation; a partial release shrinks the newest bucket first and rebuilds the key
- Expiry worker: expires only `active` holds past `expires_at`, releases their `wms` rows, emits `.expired`, skips holds committed in the meantime; a tick without `tenantId` is skipped
- Drift check repairs cases (a), (b) and (c) of §10 and is a no-op on a consistent tenant
- Every event payload carries `tenantId` and `organizationId` (D-R5-32)
- Tenant isolation on every path: `reserve`, `release` and `commit` from a second tenant or organization with the first one's key find nothing and change nothing; workers touch only the tenant in their payload

**API paths:** every route in §8, with tenant isolation asserted against a second-tenant fixture. Phase 3 adds no route; its only route-level change, the `400` for `sourceType: 'checkout'` on `POST /api/wms/inventory/reserve`, is covered above.

**UI paths:** policy list, policy edit with the resolution-chain preview, admin check tool showing `policySourceId`. Phase 3: the `wms` manual reserve dialog (`ReserveInventoryDialog`) offers only `manual`, `order` and `transfer`, and the `wms` reservations list shows a `'checkout'` row with its translated label.

---

## 13) Implementation Phases

### Phase 1 — Base contract, fallback and policy

Two deliverables with different homes, per the Reconciliation note — an earlier revision of this list still named a `contract.ts` inside this module and a fallback owned by it, both of which that note had already relocated:

- **`packages/shared/src/lib/availability/`** — `AvailabilityQuery` / `AvailabilityResult` / `AvailabilityProvider` types, the `availabilityProviderRegistry`, and the built-in `catalog-only` fallback provider. Dependency-free, so it works even when this module is ejected.
- **`packages/core/src/modules/availability/`** — `AvailabilityPolicy`, `lib/policyResolution.ts`, admin CRUD, `acl.ts`, `events.ts`. No `contract.ts`; this module consumes the shared types rather than defining them (§3.1).

**Gate:** a storefront-shaped consumer gets coherent states with `wms` disabled; policy resolution correct at all six levels.

### Phase 2 — `wms` implementation
Batched aggregation, safety-stock handling, low-stock thresholds, product rollup, cache and event-driven invalidation.

The provider shipped for Phase 2 (`wms/lib/availabilityCalculation.ts`) predates this amendment and must be brought in line with §4.2 (still open on 2026-10-26; done as Phase 3 step 0): `findProfile` falls back to the product-level row on a variant lookup, `sellableFor` subtracts safety stock per variant, the product rollup simply sums the per-variant sellable with no product-pool subtraction, and no lot-eligibility filter is applied. The R1 multi-location test, the product-level-pool rollup test and the ineligible-lot test in §12 cover the alignment.

**Gate:** R1 and R4 tests pass, plus the product-level-pool rollup and ineligible-lot tests (§12); states match hand-computed expectations on a seeded multi-location warehouse.

### Phase 3 — Reservations

Release 5 (`ANALYSIS-2026-10-26-availability-release-5.md`, D-R5-8…10). Three steps, each with its own gate; a step starts only when the previous gate is green.

**Step 0 — Phase 2 alignment (A2).** One SQL builder in `wms` for sellable (§4.2), used by the read provider now and by the gate in step 2. `findProfile` stops falling back to the product row on a variant lookup; the product pool is subtracted once at rollup; the lot-eligibility filter is applied; `locationIds` keeps filtering locations and the additive `warehouseIds` is added to `AvailabilityQuery` and the builder (D-R5-31).
**Gate:** the R1 multi-location, product-pool rollup and ineligible-lot tests pass; the `locationIds`/`warehouseIds` tests pass; R4's constant query count still holds.

**Step 1 — `wmsReservationService` extraction (A1).** Move the bodies of `wms.inventory.reserve` and `wms.inventory.release` into `wmsReservationService` (`reserveInTransaction`, `releaseInTransaction`, `emitSideEffects`); the commands become wrappers with no behaviour change. Add `convertInTransaction`, the optional `quantity` on release (bucket shrink newest first, key rebuild), the `'checkout'` union member, the system-only rule on the public route, the dialog and i18n label, and the `UPGRADE_NOTES.md` entry (A16).
**Gate:** every existing `wms` reserve/release test passes unchanged; the in-transaction rollback tests and the `400` on `sourceType: 'checkout'` pass; `yarn typecheck` is green across packages (exhaustive switches updated).

**Step 2 — hold, reserve, release, commit, jobs.** In this order:
1. `AvailabilityReservation` entity and migration (§5.3), `reserveLinesForCheckout` in `wms`, and `availability.reserve` (§4.1, §4.1b). Its gate: the parallel tests (single warehouse, two warehouses, product pool, racing the confirm automation) and multi-line all-or-nothing pass before anything else in this step is built;
2. `availability.release` and `availability.commit` (with the recovery path and the `availability.stock_lost_after_payment` notification), events with payloads (§9);
3. the expiry and drift-check workers and their schedules (§10).
**Gate:** every Phase 3 case in §12 passes, including commit racing the sweep (exactly one wins), the wms-less tenant, the backorder line, the quote release, the key mismatch and tenant isolation.

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
- `InventoryReservationSourceType` gains `'checkout'` — additive per `BACKWARD_COMPATIBILITY.md` category 8 (Database Schema, additive-only); any exhaustive `switch` over the union needs a new branch, a compile-time failure caught by `yarn typecheck`, documented in `UPGRADE_NOTES.md`.
- New ACL features (`availability.policies.view/.manage`, `availability.check`) are additive; `setup.ts` MUST declare `defaultRoleFeatures` for `admin`/`employee` so existing tenants receive them via `yarn mercato auth sync-role-acls`, not only new tenants via `onTenantCreated`.
- No consumer (`catalog`, `sales`, `wms`) gets a hard `requires: ['availability']` — `availability` remains fully ejectable, matching `wms`'s own `ejectable: true` precedent. `wms`'s optional dependency on `availability`'s policy resolution is soft (`tryResolve`), never a hard `requires`.
- `reserve`/`release`/`commit` ship as new commands (`availability.reserve`/`.release`/`.commit`, `isUndoable: false`, D-R5-10); no existing command is renamed or removed.
- `wms.inventory.release` gains an optional additive `quantity` input — today it takes only `reservationId` and `reason` (`wms/data/validators.ts`) — that reduces the reservation row, the balance's reserved quantity and `metadata.allocatedBuckets` (newest bucket first) under the same locks and rebuilds the row's key. Only the confirmed-first integrator path (§4.4) needs it; making `quantity` optional leaves every existing caller unchanged.
- **New DI key `wmsReservationService`** (category 9, additive). Registered by `wms`; methods `reserveInTransaction`, `releaseInTransaction`, `convertInTransaction`, `reserveLinesForCheckout`, `emitSideEffects` (§4.1b). The method names and input shapes are frozen when Phase 3 ships; later changes are additive only. `wms.inventory.reserve`/`.release` keep their ids, inputs and results; they become wrappers over the service.
- **New table `availability_reservations`** (category 8, additive), with its migration and `.snapshot-open-mercato.json` update in the `availability` module. No existing table changes.
- **`'checkout'` is system-only on the public `wms` route** (category 7). `POST /api/wms/inventory/reserve` answers `400` for `sourceType: 'checkout'`, a value that did not exist before Phase 3, so no existing request changes behaviour. The exported `InventoryReservationSourceType` and the shared zod enum include `'checkout'`; only the route schema excludes it. `UPGRADE_NOTES.md` records the new union member (exhaustive switches), the system-only rule, and the listing label.
- **`AvailabilityQuery.warehouseIds`** (category 2, additive, D-R5-31): a new optional field in `packages/shared/src/lib/availability/types.ts`. `locationIds` keeps its shipped meaning (location ids), now documented; no shipped field changes meaning.
- **New event ids** (category 5, additive): `availability.reservation.created|released|committed|expired` and `availability.shortfall.detected`, payloads per §9, frozen when Phase 3 ships. **New notification type** (category 11, additive): `availability.stock_lost_after_payment`.
- No new ACL feature, no new public route, no new CLI command in Phase 3.

---

## 16) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `wms`'s provider reads its own entities; `availability`'s policy resolution is soft-resolved by `wms` via `tryResolve`, never an ORM relation; `availability` soft-resolves `wmsReservationService` and stores `wms` reservation ids as plain ids (`wms_reservation_ids`), never imports `wms` entities or queries `wms` tables; `catalog_product_id` / `catalog_variant_id` / `order_id` are FK ids throughout |
| Tenant/organization scoping | Every query and every policy row scoped; `reserve`/`release`/`commit` take `tenantId` + `organizationId` and find the hold by `(tenant, organization, key)` (A4); worker payloads carry `tenantId` (D-R5-32); asserted per test |
| No direct `wms` dependency from commerce | `ecommerce`, `cart` and `checkout` depend only on `packages/shared`'s `resolveAvailability()` (no module `requires` edge at all) for reads, and on `availability`'s `reserveAvailability()`/`releaseAvailability()`/`commitAvailability()` commands for holds |
| Optional-module tolerance | Base contract + `catalog-only` fallback ship in `packages/shared` (zero footprint); `availability` module itself is `ejectable: true`; no consumer requires either `wms` or `availability` to boot |
| Backward compatibility | `InventoryReservationSourceType` extended additively; new DI key, table, events, notification type and `warehouseIds` field, all additive; no field removed or retyped; noted in `UPGRADE_NOTES.md` — see §15 |
| Zod validation | Policy routes; command inputs validated at the boundary |
| No `any` | Contract fully typed |
| Optimistic locking | `AvailabilityPolicy` exposes `updatedAt` for `CrudForm`. `AvailabilityReservation` is not user-editable (no form, no route); its transitions are fenced by CAS on `status` (§5.3) |
| Command pattern | `availability.reserve`/`.release`/`.commit` are registered commands with `isUndoable: false` (D-R5-10), audited, like `wms.inventory.reserve`/`.release`. Reversal is an explicit counter-action: `release` with a reason, or checkout's compensation table (checkout §7.3), never an audit-log Undo. They do not call `wms` commands through the command bus; they call `wmsReservationService` inside their own single transaction (§4.1b), and the `wms` side effects run after commit (A19) |
| Cache safety | Tag-based invalidation via the `cache` module; no raw Redis |
| i18n | State labels and lead-time strings in `en.json` / `pl.json`; the `'checkout'` source label in `wms/i18n`; the `availability.stock_lost_after_payment` notification title and body; nothing hard-coded |
| Background work | Expiry and drift-check are `@open-mercato/queue` workers with tenant-scoped payloads (§10) |
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
  - AC: a lost hold on an existing order also raises the in-app notification `availability.stock_lost_after_payment` naming the order and lines; it never fails silently.

- **US-D2** — As an ops/support user, I want abandoned checkout holds to release automatically and holds that disagree with their `wms` rows to be repaired by reconciliation, so abandoned checkouts don't quietly lock up sellable stock (R6).
  - AC: default `ttlSeconds` is 900 (bounded 60–3600); the one-minute expiry sweep gives a documented worst case of about 16 minutes (§10). Only holds still `active` expire; a hold committed to an order never does.
  - AC: a hold whose `wms` rows were released or are missing, a `'checkout'` `wms` row with no hold, and a committed hold whose rows are still `'checkout'` are each repaired and logged by the hourly drift check (§10); none is left silently.
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
