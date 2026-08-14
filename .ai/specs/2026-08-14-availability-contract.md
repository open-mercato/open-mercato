# Availability Contract

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 2, Phase 0 |
| **Modules** | `availability` (new), `wms` (extended), `catalog` (unchanged) |
| **Related** | [ADR-4](./2026-08-14-ecommerce-suite-roadmap.md#adr-4--availability-is-a-contract-wms-is-one-implementation), [WMS Phase 1 — Core Inventory](./2026-04-15-wms-phase-1-core-inventory.md), [WMS Ledger Integrity](./2026-06-13-wms-ledger-integrity.md) |

---

## TLDR

**Key Points:**
- A thin `availability` module declares one DI contract, `availabilityService`, that answers *can this buyer get this quantity of this variant, and when*. `wms` registers the authoritative implementation; the module itself ships a `not tracked` fallback so a storefront works without `wms` installed.
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
├── index.ts
├── acl.ts
├── di.ts                       # registers the fallback; wms overrides
├── events.ts
├── data/
│   ├── entities.ts             # AvailabilityPolicy
│   └── validators.ts
├── lib/
│   ├── contract.ts             # AvailabilityService types — the public contract
│   ├── policyResolution.ts     # variant → product → store default
│   └── fallbackService.ts      # catalog-only implementation
├── api/                        # admin CRUD for policies
├── backend/                    # policy admin UI
└── i18n/
```

`wms/di.ts` registers its implementation under the same DI key, overriding the fallback when the module is enabled. Registration order is module load order; `wms` declares `availability` as a dependency so it always registers last.

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

`availability/lib/contract.ts` — this is the public surface. Every field is required reading for implementers.

```typescript
export type AvailabilityItemRef = {
  productId: string
  variantId?: string | null      // null → product-level rollup over variants
  quantity: number               // requested quantity; drives in_stock vs backorder
}

export type AvailabilityScope = {
  tenantId: string
  organizationId: string
  storeId?: string | null        // resolves store-level policy defaults
  channelId?: string | null
  locationIds?: string[] | null  // null = all fulfilment locations in scope
}

export type AvailabilityItemResult = {
  state: AvailabilityState
  sellableQuantity: number | null   // null when state is 'not_tracked'
  canFulfil: boolean                // requested quantity is obtainable by some path
  leadTimeDays: number | null       // populated for backorder and preorder
  releaseAt: string | null          // ISO date, preorder only
  maxOrderQuantity: number | null   // policy cap, independent of stock
  policySourceId: string | null     // which AvailabilityPolicy row decided this
}

export type AvailabilityResult = {
  byKey: Record<string, AvailabilityItemResult>  // key = `${productId}:${variantId ?? '-'}`
  computedAt: string
  isAuthoritative: boolean          // false when served from cache or by the fallback
}

export interface AvailabilityService {
  check(items: AvailabilityItemRef[], scope: AvailabilityScope): Promise<AvailabilityResult>

  /**
   * Time-boxed hold. Authoritative and transactional — this is the call that
   * decides whether an order may be placed. MUST NOT be called at browse time.
   */
  reserve(input: {
    items: AvailabilityItemRef[]
    scope: AvailabilityScope
    sourceType: 'checkout'
    sourceId: string
    idempotencyKey: string
    ttlSeconds: number
  }): Promise<{
    reserved: boolean
    reservationIds: string[]
    expiresAt: string | null
    shortfall: Array<{ productId: string; variantId: string | null; requested: number; available: number }>
  }>

  release(input: { idempotencyKey: string; reason: string }): Promise<void>

  /** Converts a checkout hold into an order reservation. Idempotent. */
  commit(input: { idempotencyKey: string; orderId: string }): Promise<void>
}
```

**`check` is advisory. `reserve` is authoritative.** No caller may treat a `check` result as a guarantee. This is stated in the contract's doc comment because it is the single most likely misuse.

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

Ships in `availability` itself. Returns `not_tracked` with `canFulfil: true` for every item, unless an `AvailabilityPolicy` explicitly marks the item unavailable or sets a preorder release date. This keeps a `wms`-less storefront fully functional and makes the policy entity useful on its own.

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
t0  buyer loads PDP            check() → in_stock, possibly up to 60s stale
t1  buyer adds to cart         check() → live, still advisory, no hold taken
t2  buyer fills checkout       (minutes; no hold)
t3  buyer submits              reserve() → authoritative, transactional, may fail
t4  payment confirmed          commit() → reservation becomes an order reservation
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

## 15) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `availability` reads `wms` data only through the `wms`-registered implementation; `product_id` / `variant_id` are FK ids |
| Tenant/organization scoping | Every query and every policy row scoped; asserted per test |
| No direct `wms` dependency from commerce | `ecommerce`, `cart` and `checkout` import only `availability/lib/contract` |
| Optional-module tolerance | Fallback ships in `availability`; no consumer requires `wms` |
| Backward compatibility | `InventoryReservationSourceType` extended additively; no field removed or retyped; noted in `UPGRADE_NOTES.md` |
| Zod validation | Policy routes; service inputs validated at the boundary |
| No `any` | Contract fully typed |
| Optimistic locking | `AvailabilityPolicy` exposes `updatedAt` for `CrudForm` |
| Cache safety | Tag-based invalidation via the `cache` module; no raw Redis |
| i18n | State labels and lead-time strings in `en.json` / `pl.json`; nothing hard-coded |
| Integration coverage | §12, shipping in the same change |

---

## 16) Changelog

### 2026-08-14
- Initial specification.
- Grounded in the implemented `wms` model: `InventoryBalance` (per warehouse + location + variant + lot + serial, with `quantity_available` a **stored generated column** equal to `on_hand − reserved − allocated`), `InventoryReservation` (`source_type`, `source_id`, `expires_at`, `status`, `idempotency_key` all already present), and `ProductInventoryProfile` (`safety_stock`, `reorder_point`, per product/variant).
- Confirmed `catalog` carries no stock or sell-policy fields, which is why `AvailabilityPolicy` is introduced here rather than as a `catalog` extension.
- Confirmed `wms/di.ts` registers entity classes only, with no service layer — the `availabilityService` registration is new.
