# Availability Contract

| Field | Value |
|-------|-------|
| **Status** | Specification |
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
- `reserve`/`release`/`commit` (§4.1) MUST be implemented as undoable commands per root `AGENTS.md` — either by delegating directly to `wms`'s existing `reserveInventory`/`releaseReservation` commands (already command-driven, already undoable) or by registering their own commands with `extractUndoPayload()`. The original draft specified them as plain async interface methods with no stated command binding; this is fixed in §4.1 below.

See `wms-roadmap.md` §"Cross-Module Availability Contract" for the canonical shared-side design this document now defers to for the base contract.

---

## TLDR

**Key Points:**
- A thin `availability` module owns `AvailabilityPolicy` — the sell-policy layer (stock-managed, backorder, preorder, thresholds) — and the reservation/checkout-hold lifecycle. The base `AvailabilityQuery`/`AvailabilityResult` contract, provider registry, and catalog-only fallback live in `packages/shared` (see Reconciliation note above); `wms` registers there as the authoritative provider.
- `catalog` has **no stock fields whatsoever** — no `manage_stock`, no `allow_backorder`, no `is_in_stock`. Sell policy therefore has no home today, so this module owns it as `AvailabilityPolicy`, resolved variant → product → store default.
- `InventoryBalance.quantity_available` is a **stored generated column** (`on_hand − reserved − allocated`) that does **not** subtract safety stock. Sellable quantity is a different number from available quantity, and conflating them oversells the safety buffer.
- `InventoryReservation` already carries `expires_at`, `idempotency_key`, `status` and `source_type` — everything a time-boxed checkout hold needs. The only gap is that `InventoryReservationSourceType` is `'order' | 'transfer' | 'manual'`; `'checkout'` is added additively.

**Scope:**
- `availabilityService` DI contract: `check`, `reserve`, `release`, `commit`
- `AvailabilityPolicy` entity and its resolution chain
- The `wms`-backed implementation and the catalog-only fallback
- Caching, staleness budget, and an explicitly documented oversell window
- Events and the reservation-expiry job

**Concerns:**
- Browse-time availability is advisory by design; the authoritative check happens at checkout submit. The window between them is a real oversell risk that this spec bounds and documents rather than pretends to eliminate.
- `InventoryBalance` is keyed on `catalog_variant_id` with no product column, so product-level availability is a rollup over variants — expensive on a listing page without careful batching
- Safety stock lives on `ProductInventoryProfile`, one row per product/variant, while balances are per warehouse+location+lot+serial; subtracting safety stock per balance row instead of once per variant would under-report stock by a factor of the location count

---

## 1) Overview

Every payload in the storefront suite carries an availability state, and nothing in the platform produces one. `wms` owns the numbers; `catalog` owns the products; no contract connects them, and neither should be queried directly by a storefront.

This module is the seam. It is intentionally small: one service interface, one policy entity, two implementations. Its value is that `ecommerce`, `cart` and `checkout` depend on a stable contract rather than on `wms`, which many tenants do not run.

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
├── data/
│   ├── entities.ts             # AvailabilityPolicy
│   └── validators.ts
├── lib/
│   ├── policyResolution.ts     # variant → product → store default
│   └── reservationCommands.ts  # reserve/release/commit — wraps wms's InventoryReservation commands
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

The base query/result shape (`AvailabilityQuery` = `{ tenantId, organizationId, items: AvailabilityItemQuery[] }`, `AvailabilityResult` = `{ byItem: Record<string, AvailabilityItemResult> }`, the `AvailabilityProvider` interface) is defined once in `packages/shared/src/lib/availability/types.ts` per the Reconciliation note — not repeated here as a competing definition. This module's own surface is the **reservation lifecycle**, which the shared contract deliberately excludes (availability there is read-only):

```typescript
// packages/core/src/modules/availability/lib/reservationCommands.ts
export type AvailabilityShortfallLine = {
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  available: number
}

/**
 * Time-boxed hold. Authoritative and transactional — this is the call that
 * decides whether an order may be placed. MUST NOT be called at browse time;
 * `resolveAvailability()` (packages/shared) is advisory only, this is not.
 *
 * Implemented as an undoable command (`registerCommand('availability.reserve', ...)`,
 * `extractUndoPayload()` on undo) that wraps `wms`'s existing `reserveInventory`
 * command per item — this module does not bypass wms's command layer, it composes
 * it. When `wms` is absent, reservation is unavailable and this command returns
 * `reserved: false` for every line with reason `'not_tracked'`.
 */
export async function reserveAvailability(input: {
  items: Array<{ catalogProductId: string; catalogVariantId?: string | null; quantity: number }>
  tenantId: string
  organizationId: string
  sourceType: 'checkout'
  sourceId: string
  idempotencyKey: string
  ttlSeconds: number
}): Promise<{
  reserved: boolean
  reservationIds: string[]
  expiresAt: string | null
  shortfall: AvailabilityShortfallLine[]
}>

/** Undoable command wrapping wms's releaseReservation. */
export async function releaseAvailability(input: { idempotencyKey: string; reason: string }): Promise<void>

/**
 * Converts a checkout hold into an order reservation. Idempotent. Implemented as
 * an undoable command that mutates the existing wms InventoryReservation's
 * source_type/source_id in place inside one transaction — never release-then-reserve.
 */
export async function commitAvailability(input: { idempotencyKey: string; orderId: string }): Promise<void>
```

**`resolveAvailability()` (shared) is advisory. `reserveAvailability()` (this module) is authoritative.** No caller may treat a `resolveAvailability()` result as a guarantee. This is stated here because it is the single most likely misuse.

### 4.2 The `wms` implementation

Sellable quantity, per variant, in one aggregation:

```sql
-- Aggregate across every in-scope location, THEN subtract the per-variant buffer
SELECT catalog_variant_id,
       SUM(quantity_available) AS aggregate_available
FROM   inventory_balances
WHERE  tenant_id = $1 AND organization_id = $2
  AND  catalog_variant_id = ANY($3)
  AND  (warehouse_id = ANY($4) OR $4 IS NULL)
  AND  deleted_at IS NULL
GROUP BY catalog_variant_id
```

```
sellable(variant) = max(0, aggregate_available(variant) − safety_stock(variant))
```

`safety_stock` comes from `ProductInventoryProfile`, matched on `catalog_variant_id` and falling back to the product-level profile row (`catalog_variant_id IS NULL`). It is subtracted **once per variant, after aggregation** — subtracting per balance row would multiply the buffer by the number of locations holding the item.

`low_stock` triggers when `sellable ≤ lowStockThreshold`, where the threshold is the policy override if set, otherwise `ProductInventoryProfile.reorder_point`, otherwise no low-stock state.

Product-level rollup (`variantId: null`) is `SUM` of sellable across the product's active variants, with state derived from the total.

**Batching.** A 24-item listing page with configurable products can span several hundred variants. `check` MUST issue exactly one balance aggregation, one profile lookup and one policy lookup per call regardless of item count. Per-item queries are a defect, not a performance nuance.

### 4.3 The fallback implementation

Ships as the built-in `catalog-only` provider in `packages/shared` (Reconciliation note) — not in this module, so it works even when `availability` itself is ejected. Returns `not_tracked` with `canFulfil: true` for every item, unless `availability` is installed and an `AvailabilityPolicy` explicitly marks the item unavailable or sets a preorder release date (soft-resolved via `tryResolve`, same as the `wms` provider does — §3.1). This keeps a `wms`-less *and* `availability`-less storefront fully functional, and makes the policy entity useful on its own once installed.

### 4.4 Reservation source type

`InventoryReservationSourceType` becomes `'order' | 'transfer' | 'manual' | 'checkout'`. Additive union extension — per `BACKWARD_COMPATIBILITY.md` this is permitted on an ADDITIVE-ONLY surface. Existing consumers narrowing on the three current values are unaffected; any exhaustive `switch` in `wms` gains a branch.

`commit` transitions the reservation's `source_type` from `'checkout'` to `'order'` and rewrites `source_id` to the order id, rather than releasing and re-reserving — releasing first opens a window in which another buyer takes the stock out from under a paid order.

---

## 5) Data Models

### 5.1 `AvailabilityPolicy` (`availability_policies`)

Standard scoped columns. Exactly one of `variant_id` / `product_id` / neither (store-level default) is set.

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid, nullable | null = applies to all stores in the organization |
| `product_id` | uuid, nullable | `catalog.CatalogProduct.id` |
| `variant_id` | uuid, nullable | `catalog.CatalogProductVariant.id` |
| `is_stock_managed` | boolean | `false` → always `not_tracked` |
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

`wms` emits balance-change events already; this module subscribes and invalidates by tag. If `wms` is absent, nothing changes and nothing needs invalidating.

---

## 7) The Oversell Window

This is stated plainly because hiding it is how oversell bugs get shipped.

```
t0  buyer loads PDP            resolveAvailability() → in_stock, possibly up to 60s stale
t1  buyer adds to cart         resolveAvailability() → live, still advisory, no hold taken
t2  buyer fills checkout       (minutes; no hold)
t3  buyer submits              reserveAvailability() → authoritative, transactional, may fail
t4  payment confirmed          commitAvailability() → reservation becomes an order reservation
```

Stock is held only from **t3**. Between t0 and t3 another buyer may take it. At t3 the reservation either succeeds or returns `shortfall`, and checkout surfaces a line-level "no longer available" error rather than creating an unfulfillable order.

**Rejected alternative: reserve at add-to-cart.** It converts every abandoned cart into held stock, and with a typical abandonment rate it makes a popular item permanently unavailable. Every major platform (Shopify, Commercetools, Medusa) reserves at checkout, not at cart. Some retailers hold at cart for scarce goods; a per-policy `reserve_at_cart` flag is noted in Open Questions rather than built speculatively.

**Between t3 and t4** the reservation is held for `ttlSeconds` (default 900). If payment does not confirm, expiry releases it.

---

## 8) API Contracts

This module exposes **no public storefront endpoints**. Availability reaches the storefront embedded in `ecommerce` product payloads (spec 4). Admin routes only:

| Method | Path | Feature |
|---|---|---|
| GET/POST | `/api/availability/policies` | `availability.policies.view` / `.manage` |
| GET/PUT/DELETE | `/api/availability/policies/:id` | idem |
| POST | `/api/availability/check` | `availability.check` — admin/debug, mirrors the service |

`/api/availability/check` exists so support can reproduce what a buyer saw, including `policySourceId`.

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

```typescript
'availability.policy.created' | '.updated' | '.deleted'
'availability.reservation.created' | '.released' | '.committed' | '.expired'
'availability.state.changed'      // variant crossed a state boundary — drives back-in-stock notifications
'availability.shortfall.detected' // reserve() failed at submit; feeds an ops alert
```

`availability.state.changed` is emitted by the invalidation subscriber when a recomputed state differs from the cached one. It is the hook for back-in-stock subscriptions (spec 9) and MUST NOT be emitted per balance row — it is per variant, debounced to at most one event per variant per minute.

`availability.shortfall.detected` matters operationally: a rising rate means the staleness budget or the reservation model needs revisiting, and without the event nobody would know.

---

## 10) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `expire-checkout-reservations` | every minute | Release `source_type = 'checkout'` reservations past `expires_at`; emit `.expired` |
| `reconcile-orphan-reservations` | hourly | Find `active` checkout reservations whose checkout session no longer exists; release and report |

The one-minute cadence on expiry is deliberate: held stock that nobody is buying is lost revenue, and a 15-minute TTL plus a 15-minute sweep means a 30-minute worst case.

---

## 11) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Safety stock subtracted per location | **High** | `availability`, `wms` | An item stocked in 4 locations with `safety_stock = 5` reports 20 units held back instead of 5, so 15 sellable units are invisible. Silent revenue loss — nothing errors. | Subtract once per variant after aggregation (§4.2); explicit multi-location test with asymmetric balances | Low |
| R2 | Oversell between browse and submit | Medium | `availability`, `cart` | Two buyers see the last unit; both check out; one `reserve()` fails at submit. | Bounded and documented (§7); submit surfaces a line-level shortfall rather than creating an unfulfillable order; `shortfall.detected` monitors the rate | Medium — inherent to reserve-at-checkout; accepted deliberately, not by omission |
| R3 | Stale cache after a stock movement | Medium | `availability` | A large goods-receipt lands; the storefront shows out-of-stock for up to 60s. | Tag invalidation on `wms` movement events makes this near-instant in practice; the 60s TTL is the ceiling only when events are lost | Low |
| R4 | N+1 on listing pages | **High** | `availability` | 24 configurable products × 8 variants issues 192 balance queries per render; the listing page becomes the slowest route in the app. | Contract mandates one aggregation per `check` call regardless of item count; a test asserts the query count for a 200-variant batch | Low |
| R5 | `wms` absent, storefront claims stock | Medium | `availability` | The fallback returns `not_tracked` and a naive storefront renders "In stock" for an item nobody counts. | `not_tracked` is a distinct state and the spec forbids rendering it as in-stock; spec 10 defines its presentation (no badge at all) | Low |
| R6 | Reservation leak on checkout abandonment | Medium | `availability` | Sessions abandoned after `reserve()` hold stock until TTL; at scale a meaningful slice of inventory is invisible. | One-minute expiry sweep; hourly orphan reconciliation; TTL default 900s | Low |
| R7 | Release-then-reserve race at commit | **High** | `availability`, `checkout` | A naive `commit` releasing the checkout hold before creating the order reservation lets a concurrent buyer take stock from a paid order. | `commit` mutates the existing reservation in place (`source_type`, `source_id`) inside one transaction; never release-then-reserve | Low |
| R8 | Union extension breaks exhaustive switches | Low | `wms` | Adding `'checkout'` to `InventoryReservationSourceType` makes any exhaustive `switch` non-exhaustive at compile time. | Compile-time failure, not runtime — surfaced by `yarn typecheck` and fixed in the same change; documented in `UPGRADE_NOTES.md` for third-party modules | Low |

---

## 12) Integration Coverage

**Service behaviour:**
- Sellable = aggregate available − safety stock, with the item stocked in 4 locations and asymmetric balances (R1)
- `not_tracked` from the fallback with `wms` disabled; authoritative state with it enabled
- State boundaries: exact-quantity request is `in_stock`; one over is `out_of_stock` or `backorder` per policy
- `low_stock` from the policy override, and from `reorder_point` when there is no override
- `preorder` before `preorder_release_at`, `in_stock` after
- Product-level rollup equals the sum over active variants; inactive variants excluded
- Policy resolution across all six chain levels with `policySourceId` correct at each
- Query count for a 200-variant `check` is constant (R4)

**Reservation behaviour:**
- `reserve` succeeds, holds stock, and a subsequent `check` reflects the hold
- `reserve` with insufficient stock returns `shortfall` and holds nothing (all-or-nothing per call)
- Repeated `idempotencyKey` returns the original reservation without double-holding
- N parallel `reserve` calls for the last unit succeed exactly once
- `commit` mutates in place; no window in which the stock is unheld (R7)
- Expiry releases and emits `.expired`; orphan reconciliation catches sessionless holds

**API paths:** every route in §8, with tenant isolation asserted against a second-tenant fixture.

**UI paths:** policy list, policy edit with the resolution-chain preview, admin check tool showing `policySourceId`.

---

## 13) Implementation Phases

### Phase 1 — Contract and fallback
`availability` module, `contract.ts`, `AvailabilityPolicy`, policy resolution, fallback implementation, admin CRUD.

**Gate:** a storefront-shaped consumer gets coherent states with `wms` disabled; policy resolution correct at all six levels.

### Phase 2 — `wms` implementation
Batched aggregation, safety-stock handling, low-stock thresholds, product rollup, cache and event-driven invalidation.

**Gate:** R1 and R4 tests pass; states match hand-computed expectations on a seeded multi-location warehouse.

### Phase 3 — Reservations
`'checkout'` source type, `reserve` / `release` / `commit`, expiry and reconciliation jobs, shortfall events.

**Gate:** the parallel last-unit test admits exactly one; `commit` has no unheld window; expiry sweep verified.

Phases 1 and 2 unblock spec 4 (public API). Phase 3 is required only by spec 7 (checkout) and may run in parallel with specs 3–5.

---

## 14) Open Questions

1. **Reserve at cart for scarce goods** — a per-policy `reserve_at_cart` flag with a short TTL would serve ticketing and limited drops. *Deferred; §7 records why it is not the default.*
2. **Location selection for multi-warehouse stores** — `scope.locationIds` is in the contract but nothing populates it. Which warehouses serve which store is a fulfilment-rules question that belongs with shipping. *Assumed all in-scope locations for v1.*
3. **Backorder capacity** — `allow_backorder` is unbounded; a tenant may want "backorder up to 100 units". *Deferred; `max_order_quantity` gives a blunt cap in the meantime.*
4. **Channel-specific stock allocation** — reserving a slice of inventory for a channel (marketplace vs. own store) is a real B2B requirement with no model here. *Out of scope; would extend `AvailabilityPolicy` with channel allocations.*

---

## 15) Migration & Backward Compatibility

- This spec introduces a brand-new DI/type contract. Per the Reconciliation note, the base contract's canonical location and shape are decided by `wms-roadmap.md` rev 11 in the upstream repo, not by this document alone — implementers MUST build against that shape, not re-derive it from this file's original 2026-08-14 draft.
- `InventoryReservationSourceType` gains `'checkout'` — additive per `BACKWARD_COMPATIBILITY.md` category 8 (Database Schema, additive-only); any exhaustive `switch` over the union needs a new branch, a compile-time failure caught by `yarn typecheck`, documented in `UPGRADE_NOTES.md`.
- New ACL features (`availability.policies.view/.manage`, `availability.check`) are additive; `setup.ts` MUST declare `defaultRoleFeatures` for `admin`/`employee` so existing tenants receive them via `yarn mercato auth sync-role-acls`, not only new tenants via `onTenantCreated`.
- No consumer (`catalog`, `sales`, `wms`) gets a hard `requires: ['availability']` — `availability` remains fully ejectable, matching `wms`'s own `ejectable: true` precedent. `wms`'s optional dependency on `availability`'s policy resolution is soft (`tryResolve`), never a hard `requires`.
- `reserve`/`release`/`commit` ship as new commands (`availability.reserve`/`.release`/`.commit`); no existing command is renamed or removed.

---

## 16) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `wms`'s provider reads its own entities; `availability`'s policy resolution is soft-resolved by `wms` via `tryResolve`, never an ORM relation; `catalog_product_id` / `catalog_variant_id` are FK ids throughout |
| Tenant/organization scoping | Every query and every policy row scoped; asserted per test |
| No direct `wms` dependency from commerce | `ecommerce`, `cart` and `checkout` depend only on `packages/shared`'s `resolveAvailability()` (no module `requires` edge at all) for reads, and on `availability`'s `reserveAvailability()`/`releaseAvailability()`/`commitAvailability()` commands for holds |
| Optional-module tolerance | Base contract + `catalog-only` fallback ship in `packages/shared` (zero footprint); `availability` module itself is `ejectable: true`; no consumer requires either `wms` or `availability` to boot |
| Backward compatibility | `InventoryReservationSourceType` extended additively; no field removed or retyped; noted in `UPGRADE_NOTES.md` — see §15 |
| Zod validation | Policy routes; command inputs validated at the boundary |
| No `any` | Contract fully typed |
| Optimistic locking | `AvailabilityPolicy` exposes `updatedAt` for `CrudForm` |
| Command pattern | `reserve`/`release`/`commit` are undoable commands wrapping `wms`'s existing `reserveInventory`/`releaseReservation`, not bypassing the command layer (Reconciliation note) |
| Cache safety | Tag-based invalidation via the `cache` module; no raw Redis |
| i18n | State labels and lead-time strings in `en.json` / `pl.json`; nothing hard-coded |
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
  - AC: a failed/partial reserve holds nothing — all-or-nothing per call (§12); there is no partial state to roll back.
  - AC: N parallel reserve calls for the last unit succeed exactly once; the loser gets a shortfall response, never a silent double-sell (§12).

### Epic D — Shortfall & Reservation Lifecycle (Ops/Support)
Ops/support keep abandoned holds from locking up stock.

- **US-D1** — As an ops/support user, I want to be alerted when the checkout shortfall rate rises, so that I know when the staleness budget or reservation model needs revisiting rather than hearing it from angry buyers.
  - AC: `availability.shortfall.detected` fires on every failed `reserve()` (§9) — this story is observability-only; no dashboard is in this spec's scope (§8 defines no public storefront endpoints).

- **US-D2** — As an ops/support user, I want abandoned checkout holds to release automatically and orphaned holds (dead sessions) to be caught by reconciliation, so abandoned carts don't quietly lock up sellable stock (R6).
  - AC: default `ttlSeconds` is 900; the one-minute expiry sweep gives a documented 30-minute worst case (§10).
  - AC: an orphan reservation (session gone) is released and reported, never silently left held.
  - AC: release is idempotent against the same `idempotencyKey` — safe to run more than once, so no separate "undo" action is needed.

### Cross-cutting rules (apply to every screen/consumer above)

- `resolveAvailability()` (advisory) and `reserveAvailability()`/`commitAvailability()` (authoritative) must never be conflated by any caller or screen — the single most likely misuse (§4.1).
- `not_tracked` is never rendered as `in_stock`, anywhere a state renders (§3.2, R5).
- `check()` issues exactly one balance aggregation, one profile lookup, one policy lookup per call regardless of item count (§4.2) — no screen or prototype may assume per-item calls.
- Every policy edit dialog: Cmd/Ctrl+Enter submits, Escape cancels (root `AGENTS.md`).
- The optimistic-lock conflict bar is the platform's shared component, reused here for `AvailabilityPolicy` edits — not redrawn.
- No hardcoded status colors — the six availability states use DS status tokens.

---

## 18) Changelog

### 2026-08-31 (story map)
- Added §17 User Story Map to support the `om-mockup-prototype` backend click-through: 4 epics, 9 stories, UX acceptance criteria (empty/permission/error/optimistic-lock/keyboard/default-value states applied only where genuinely applicable — Epics C/D are internal service-contract journeys, not end-user screens). No scope change.

### 2026-08-17
- Reconciled with the independently-approved `wms-roadmap.md` rev 10/11 design for the same contract, found by a joint `/om-pre-implement-spec` audit (see Reconciliation note at the top of this document). Base contract, registry, and catalog-only fallback move to `packages/shared`; this module is re-scoped to `AvailabilityPolicy` + the reservation lifecycle; `AvailabilityItemRef.productId`/`.variantId` renamed to `catalogProductId`/`catalogVariantId`; `reserve`/`release`/`commit` specified as undoable commands wrapping `wms`'s existing reservation commands; added §15 Migration & Backward Compatibility (previously missing).

### 2026-08-14
- Initial specification.
- Grounded in the implemented `wms` model: `InventoryBalance` (per warehouse + location + variant + lot + serial, with `quantity_available` a **stored generated column** equal to `on_hand − reserved − allocated`), `InventoryReservation` (`source_type`, `source_id`, `expires_at`, `status`, `idempotency_key` all already present), and `ProductInventoryProfile` (`safety_stock`, `reorder_point`, per product/variant).
- Confirmed `catalog` carries no stock or sell-policy fields, which is why `AvailabilityPolicy` is introduced here rather than as a `catalog` extension.
- Confirmed `wms/di.ts` registers entity classes only, with no service layer — the `availabilityService` registration is new.
