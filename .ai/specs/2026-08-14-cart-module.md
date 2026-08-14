# Cart Module

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 5, Phase 2 |
| **Modules** | `cart` (new) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Availability Contract](./2026-08-14-availability-contract.md), [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md) |
| **Related** | [SPEC-055 Promotions](./SPEC-055-2026-02-23-promotions-module.md), [ADR-1](./2026-08-14-ecommerce-suite-roadmap.md#adr-1--the-cart-is-a-module-not-a-checkout-status), [ADR-2](./2026-08-14-ecommerce-suite-roadmap.md#adr-2--cart-never-computes-tax-or-totals-itself) |

---

## TLDR

**Key Points:**
- A channel-agnostic basket module. `Cart` and `CartLine` are first-class entities addressed by an opaque token, usable by the storefront, POS, pay links and AI purchasing agents alike. Checkout consumes a cart; it does not own one.
- **The cart does no arithmetic.** It resolves unit prices via `catalogPricingService`, discounts via `promotionsService`, then hands `SalesLineSnapshot[]` to `salesCalculationService.calculateDocumentTotals` with `documentKind: 'quote'`. Cart totals and order totals are produced by the same code, so they cannot disagree.
- Prices are **snapshotted per line with a resolution stamp**, and re-priced on a defined set of triggers. A cart that silently re-prices mid-session is as broken as one that never does; the trigger list is the contract.
- B2B changes cart behaviour in ways B2C never exercises: quantity breaks re-price the whole line as quantity crosses a tier, pack increments constrain quantities, and an over-threshold cart routes to approval before checkout.

**Scope:**
- `Cart`, `CartLine`, `CartPromotionApplication`, `CartMergeLog`
- Line management, price snapshotting and the re-pricing trigger set
- Totals via `salesCalculationService`; promotion effects via `promotionsService`
- Optimistic locking, idempotent mutation, guest→customer merge
- TTL, abandonment events, cleanup
- Public token-bound API

**Concerns:**
- Guest→customer merge has no universally correct rule; the chosen policy must be explicit, reversible and logged, because getting it wrong silently deletes a buyer's basket
- Optimistic locking on a cart that the server itself re-prices means the server can bump the version under a client that did nothing wrong; re-pricing must not be indistinguishable from a concurrent edit
- Promotion evaluation on every mutation is expensive; caching it is unsafe because the rule tree depends on the whole cart

---

## 1) Overview

A cart is a priced, mutable collection of intended purchases belonging to a buyer or an anonymous visitor, valid for a bounded period, in one currency, for one store.

That is the whole domain. Everything adjacent — who the buyer is, what an address is, how delivery is chosen, how payment is taken, what an order is — belongs to another module. The cart's discipline is knowing what it is not.

---

## 2) Problem Statement

### 2.1 Nothing owns a basket

Four channels need one and none has one. SPEC-029 v3 proposed folding the basket into a checkout session, which makes it the storefront funnel's private state. POS (SPEC-022) would then need its own, pay links have `CheckoutCartItem` shaped for merchant-defined static contents rather than shopper mutation, and an AI purchasing agent would have nowhere to assemble a proposal before asking for approval.

### 2.2 Totals must not be reimplemented

`sales` owns `SalesTaxRate` and a calculation service with line hooks, totals hooks, adjustment drafts and an event bus. Any basket computing its own tax will disagree with the order it produces — not hypothetically, but on the first compound tax rate or rounding boundary. The consequence is an invoice that does not match the price the buyer accepted.

### 2.3 Snapshot versus live price

Neither extreme works. A cart holding a price forever lets a buyer check out at last month's price. A cart re-resolving on every read changes the total while the buyer is looking at it, including downward-then-upward as a promotion window closes. What is needed is a snapshot with defined invalidation, and that set of triggers has to be written down.

### 2.4 B2B is not B2C with a different price

A wholesale line at quantity 99 and the same line at 100 are different prices per unit, because `CatalogProductPrice.min_quantity` says so. Pack increments make quantity 7 invalid where 6 and 8 are fine. An order above the group's `approval_required_above` cannot proceed to checkout at all. None of this exists in a B2C basket, and all of it is line-level behaviour that belongs here rather than in checkout.

---

## 3) Architecture

### 3.1 Position

```
storefront / POS / pay link / AI agent
              │  cart token (opaque)
              ▼
        ┌──────────┐
        │   cart   │   lines, quantities, snapshots, totals, TTL
        └────┬─────┘
             ├──► catalog       catalogPricingService — unit price for THIS buyer & quantity
             ├──► promotions    promotionsService.evaluate(cart) — resolved effects
             ├──► availability  availabilityService.check() — advisory state + quantity rules
             ├──► sales         salesCalculationService.calculateDocumentTotals() — ALL arithmetic
             └──► customer_groups  resolveTerms() — tax mode, min order, approval threshold
```

`cart` has no inbound dependency. `checkout` reads it; it does not read `checkout`.

### 3.2 Totals

```typescript
const result = await salesCalculationService.calculateDocumentTotals({
  documentKind: 'quote',
  lines: cart.lines.map(toSalesLineSnapshot),
  adjustments: promotionEffects.map(toSalesAdjustmentDraft),
  context: { tenantId, organizationId, currencyCode, metadata: { source: 'cart', cartId } },
})
```

`documentKind: 'quote'` reuses the existing `SalesDocumentKind` union (`'order' | 'quote' | 'invoice' | 'credit_memo'`) rather than extending it. A quote is precisely what a cart is — a non-binding priced document — and extending the union would ripple into document sequences, search indexing and the documents table for no gain.

The mapping is direct because `SalesLineSnapshot` already carries `productId`, `productVariantId`, `quantity`, `quantityUnit`, `uomSnapshot`, `unitPriceNet`, `unitPriceGross`, `discountAmount`, `taxRate`, `configuration` and even `promotionCode`. `SalesAdjustmentDraft` carries `scope: 'order' | 'line'`, `promotionId`, `amountNet`/`amountGross` and `position`. Promotion effects map onto adjustment drafts without inventing a parallel shape.

**The cart stores the returned totals verbatim.** It does not round, re-sum or adjust them.

---

## 4) Data Models

Standard scoped columns throughout.

### 4.1 `Cart` (`carts`)

| Column | Type | Notes |
|---|---|---|
| `token` | text | Opaque, unguessable, 32+ bytes of CSPRNG entropy, base64url. The public identifier |
| `store_id` | uuid, nullable | `ecommerce.EcommerceStore.id`; null for non-storefront channels |
| `channel` | text | `storefront \| pos \| pay_link \| agent \| api` |
| `sales_channel_id` | uuid, nullable | `sales.SalesChannel.id` |
| `status` | text | `active \| locked \| converted \| abandoned \| expired \| merged` |
| `version` | integer | Optimistic locking; incremented on every accepted mutation |
| `currency_code` | text | Fixed at creation |
| `locale` | text | |
| `customer_id` | uuid, nullable | `customers.CustomerEntity.id` |
| `customer_user_id` | uuid, nullable | `customer_accounts.CustomerUser.id` |
| `customer_group_ids` | jsonb | `string[]` snapshot at last pricing, for drift detection |
| `price_kind_id` | uuid, nullable | Snapshot at last pricing |
| `tax_mode` | text | `gross \| net` |
| `email` | text, nullable | Guest identification; encrypted at rest |
| `buyer_digest` | text | `StoreContext.digest` at last pricing — the drift detector |
| `totals` | jsonb | Verbatim `SalesDocumentCalculationResult.totals` |
| `totals_computed_at` | timestamptz | |
| `promotion_effects` | jsonb | Resolved effects from the last evaluation, for display |
| `requires_approval` | boolean | Set when gross exceeds the group threshold |
| `approval_id` | uuid, nullable | `customer_groups.CustomerPurchaseApproval.id` |
| `note` | text, nullable | Buyer-supplied |
| `metadata` | jsonb, nullable | |
| `merged_into_cart_id` | uuid, nullable | Set when `status = 'merged'` |
| `last_activity_at` | timestamptz | Drives abandonment |
| `expires_at` | timestamptz | TTL |

Indexes: unique `token`; `(tenant_id, customer_id, status)`; `(tenant_id, status, expires_at)` for the sweeper; `(tenant_id, status, last_activity_at)` for abandonment.

### 4.2 `CartLine` (`cart_lines`)

| Column | Type | Notes |
|---|---|---|
| `cart_id` | uuid | FK → `carts` |
| `line_number` | integer | Stable display order |
| `product_id` | uuid | `catalog.CatalogProduct.id` |
| `variant_id` | uuid, nullable | |
| `sku` | text, nullable | Snapshot |
| `name` | text | Snapshot — survives the product being renamed or deleted |
| `option_values` | jsonb, nullable | `Record<string, string>` snapshot |
| `quantity` | numeric(16,4) | |
| `quantity_unit` | text, nullable | |
| `uom_snapshot` | jsonb, nullable | Maps to `SalesLineUomSnapshot` |
| `unit_price_net` | numeric(16,4), nullable | Snapshot |
| `unit_price_gross` | numeric(16,4), nullable | Snapshot |
| `tax_rate` | numeric(7,4), nullable | Snapshot |
| `price_kind_id` | uuid, nullable | Which kind produced the snapshot |
| `price_row_id` | uuid, nullable | Which `CatalogProductPrice` won — explainability |
| `price_tier_min_quantity` | integer, nullable | The tier in force; a quantity change crossing it forces a re-price |
| `priced_at` | timestamptz | Snapshot stamp |
| `line_totals` | jsonb | Verbatim `SalesLineCalculationResult` |
| `availability_state` | text, nullable | Advisory, from the last check |
| `availability_checked_at` | timestamptz, nullable | |
| `configuration` | jsonb, nullable | Personalization, engraving, B2B configurator output |
| `added_by` | text | `buyer \| agent \| merchant \| merge` |
| `metadata` | jsonb, nullable | |

Constraint: unique `(cart_id, product_id, variant_id, configuration_hash)` among non-deleted lines. `configuration_hash` is a stored generated column over `configuration`, so two identical products with different engraving are separate lines while two identical plain lines merge by quantity.

### 4.3 `CartPromotionApplication` (`cart_promotion_applications`)

| Column | Type | Notes |
|---|---|---|
| `cart_id` | uuid | |
| `promotion_id` | uuid | `promotions.Promotion.id` |
| `code` | text, nullable | The entered code, if any |
| `code_reservation_id` | uuid, nullable | SPEC-055 reservation, released on cart expiry |
| `scope` | text | `order \| line` |
| `cart_line_id` | uuid, nullable | For line scope |
| `effect` | jsonb | Resolved effect as returned by `promotionsService` |
| `amount_net` / `amount_gross` | numeric(16,4), nullable | |
| `applied_at` | timestamptz | |

### 4.4 `CartMergeLog` (`cart_merge_logs`)

Append-only. Records every merge so a lost basket can be reconstructed.

| Column | Type | Notes |
|---|---|---|
| `source_cart_id` / `target_cart_id` | uuid | |
| `strategy` | text | `sum \| replace \| keep_target \| manual` |
| `source_snapshot` | jsonb | Full source lines before the merge |
| `outcome` | jsonb | Per-line disposition and reason |
| `merged_by_customer_user_id` | uuid, nullable | |

Without this log, "my basket disappeared when I logged in" is unanswerable. With it, it is a support query and, if needed, a restore.

---

## 5) Pricing & Re-pricing

### 5.1 Snapshot

On add, and on every re-price, each line stores `unit_price_net`, `unit_price_gross`, `tax_rate`, `price_kind_id`, `price_row_id`, `price_tier_min_quantity` and `priced_at`. `price_row_id` exists so support can answer "why is this line 87 zł" by naming the row.

### 5.2 Re-pricing triggers

A cart re-prices when, and only when:

1. A line's quantity changes such that it crosses a `min_quantity` / `max_quantity` tier boundary — only the affected line
2. Buyer identity changes: login, logout, or a group membership change altering `buyer_digest` — whole cart
3. Currency or locale changes — whole cart
4. A line snapshot is older than the staleness budget (default 30 minutes) and the cart is read — whole cart
5. Checkout requests a lock (spec 7) — whole cart, mandatory, never skipped
6. A promotion is applied or removed — effects only, not unit prices
7. An operator forces it through the admin cart view

It does **not** re-price on every read. A buyer refreshing the page five times sees a stable total.

### 5.3 Price change disclosure

When a re-price changes any line, the response carries a `priceChanges` array — old amount, new amount, reason, per line — and the cart records `last_price_change_at`. The client must show this; a total that changes without explanation reads as a bug or a dark pattern, and in a consumer context an undisclosed increase between basket and payment is a regulatory problem.

Re-pricing increments `version` but sets `versionBumpReason: 'repricing'` in the response, so a client that then submits its stale version gets a distinguishable answer rather than a bare conflict (R3).

### 5.4 B2B quantity tiers

`catalogPricingService` is called with the line's actual quantity, so tier selection is automatic. The cart additionally exposes, per line, the next tier and the quantity needed to reach it:

```typescript
nextTier: { minQuantity: 100, unitAmount: 8.40, formatted: '8,40 zł', saving: '12%' } | null
```

This is the single highest-value B2B affordance on the read side, and it costs one extra row from a query already being made.

### 5.5 Quantity rules

`minOrderQuantity`, `maxOrderQuantity` and `quantityIncrement` come from the availability policy. A quantity violating an increment is **rejected with the nearest valid values offered**, not silently rounded — silent rounding on a pack-size field produces orders the buyer did not place.

---

## 6) Promotions

On every mutation that changes lines or quantities, and on code entry or removal, `cart` calls:

```typescript
const effects = await promotionsService.evaluate({
  cart: toPromotionCartContext(cart),
  codes: appliedCodes,
  buyer: { customerId, customerGroupIds, channelId },
})
```

`promotions` owns the rule tree, the three-pass engine and all discount arithmetic; it returns **resolved effects**. `cart` maps them to `SalesAdjustmentDraft[]` and passes them to `salesCalculationService`. The cart never computes a discount amount.

Not cached: the rule tree depends on the entire cart composition, so any cache key would be the cart itself.

Code reservations (SPEC-055) are taken at code entry and released on cart expiry, abandonment or code removal. A reservation outliving its cart is the leak that makes single-use codes unusable; the expiry sweeper releases them.

Spec 6 aligns SPEC-055's cart interaction API to these calls.

---

## 7) Guest → Customer Merge

The hardest correctness question in the module, because every strategy is wrong for some buyer.

### 7.1 Policy

On login with both an active guest cart and an existing customer cart:

| Situation | Action |
|---|---|
| Customer cart empty | Adopt the guest cart: reassign ownership, re-price, done |
| Guest cart empty | Keep the customer cart; discard the guest cart |
| Both non-empty, disjoint lines | Union |
| Both non-empty, same product+variant+configuration | `sum` by default, capped at `maxOrderQuantity` |
| Conflict on a configured line | Keep both as separate lines |

Default strategy is `sum`, configurable per store. Every merge writes a `CartMergeLog` with the full pre-merge source snapshot.

### 7.2 Disclosure and reversal

After a merge the response carries `mergeSummary` — lines added, quantities combined, anything capped. The UI must surface it. `POST /carts/:token/undo-merge` restores the pre-merge state from the log within 15 minutes.

**Rejected alternative:** silently replacing the customer cart with the guest cart. It is the simplest rule and it deletes a basket the buyer assembled on another device, with no trace.

### 7.3 Re-pricing after merge

Mandatory and whole-cart — the buyer's group has just become known, so every line's price may change. This is exactly the case that trigger 2 exists for, and it is also the case most likely to surprise, so `priceChanges` matters most here.

---

## 8) Concurrency & Idempotency

### 8.1 Optimistic locking

Every mutation carries the client's `version`. The server applies it with a conditional update (`WHERE version = $expected`) and increments atomically. A mismatch returns `409` with the current cart state embedded, so the client can reconcile without a second round trip.

### 8.2 Idempotency

Mutations accept an `Idempotency-Key`. A repeated key within the cart's lifetime returns the original result without re-applying — this is what makes "add to cart" safe under a double-tap or a retried request on a flaky mobile connection.

Keys are stored per cart with the resulting version and a response digest. A key replayed with a different body returns `422 idempotency_key_mismatch`.

### 8.3 Token security

The token is the only credential for an anonymous cart. Therefore: 32+ bytes of CSPRNG entropy; never in a URL path that could land in a referrer or a log (it is a header or an httpOnly cookie); rotated on merge so a guest token cannot address the merged customer cart afterwards; and rate-limited per token to blunt enumeration.

---

## 9) Lifecycle

```
active ──lock (checkout)──► locked ──submit──► converted
  │                            │
  │                            └──unlock/timeout──► active
  ├──inactivity────────────► abandoned ──buyer returns──► active
  ├──TTL──────────────────► expired
  └──login merge──────────► merged
```

| Transition | Rule |
|---|---|
| `active → locked` | Requested by `checkout`; forces a whole-cart re-price first; rejects mutation while locked |
| `locked → active` | Explicit unlock, or a lock timeout (default 30 min) |
| `active → abandoned` | No activity for 24 h (configurable); emits an event for recovery flows |
| `abandoned → active` | Any mutation; extends `expires_at` |
| `active → expired` | `expires_at` reached (default 30 days for identified buyers, 7 for guests); releases promotion code reservations |
| `* → merged` | Login merge; `merged_into_cart_id` set |

A `locked` cart that a client tries to mutate returns `423 Locked` with the checkout session id, not a generic error — the client needs to know to send the buyer back to checkout.

---

## 10) API Contracts

Base `/api/cart`. Token-bound, public with an optional buyer session. Every mutating route accepts `version` and `Idempotency-Key`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/carts` | Create; returns token + version |
| GET | `/carts/:token` | Read; re-prices only if stale (trigger 4) |
| POST | `/carts/:token/lines` | Add line |
| PATCH | `/carts/:token/lines/:lineId` | Change quantity or configuration |
| DELETE | `/carts/:token/lines/:lineId` | Remove line |
| POST | `/carts/:token/lines/bulk` | Batch add — reorder, quick-order pad, agent proposals |
| PATCH | `/carts/:token` | Email, note, locale, currency |
| POST | `/carts/:token/promotions` | Apply code |
| DELETE | `/carts/:token/promotions/:id` | Remove |
| POST | `/carts/:token/merge` | Merge a guest cart into the session's cart |
| POST | `/carts/:token/undo-merge` | Reverse within 15 min |
| POST | `/carts/:token/reprice` | Force re-price |
| POST | `/carts/:token/request-approval` | B2B; creates a `CustomerPurchaseApproval` |

`/carts/:token/lines/bulk` exists because B2B quick-order pads and agent proposals add 50 lines at once, and 50 sequential mutations means 50 promotion evaluations and 50 version conflicts.

### 10.1 Response

Every endpoint returns the same envelope, so a client has one parser:

```typescript
{
  cart: {
    token: string; version: number; status: CartStatus
    currencyCode: string; locale: string; taxMode: 'gross' | 'net'
    lines: CartLineView[]
    totals: SalesDocumentAmounts
    promotions: AppliedPromotionView[]
    requiresApproval: boolean
    approval: { id: string; status: string } | null
    itemCount: number; lineCount: number
    expiresAt: string
  }
  priceChanges?: PriceChange[]
  mergeSummary?: MergeSummary
  versionBumpReason?: 'mutation' | 'repricing' | 'merge'
  warnings?: Array<{ code: string; lineId?: string; message: string }>
}
```

`warnings` carries non-fatal conditions — a line that went out of stock, a promotion that stopped applying, a quantity capped. These must not be errors (they should not block the buyer) and must not be silent.

### 10.2 Admin

`GET /api/cart/carts` and `/carts/:id` under `cart.carts.view` — an abandoned-cart list with buyer, value and age. Read-only; support may inspect and force a re-price but not edit a buyer's basket.

### 10.3 ACL

```typescript
export const features = [
  { id: 'cart.carts.view',    title: 'View carts' },
  { id: 'cart.carts.manage',  title: 'Manage carts (reprice, expire)' },
  { id: 'cart.settings.manage', title: 'Manage cart settings' },
]
```

---

## 11) Events

```typescript
'cart.cart.created' | '.updated' | '.expired' | '.abandoned' | '.merged' | '.converted'
'cart.line.added' | '.updated' | '.removed'
'cart.promotion.applied' | '.removed' | '.no_longer_valid'
'cart.price.changed'          // payload: per-line old/new and reason
'cart.approval.requested'
'cart.lock.acquired' | '.released' | '.timed_out'
```

`cart.cart.abandoned` is the hook for recovery flows (out of scope here). `cart.price.changed` feeds analytics on how often snapshots go stale, which is how the staleness budget gets tuned with evidence.

`clientBroadcast: true` on line and totals events so a second tab updates via the DOM Event Bridge instead of polling.

---

## 12) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `mark-abandoned-carts` | every 15 min | `active` → `abandoned` past the inactivity window |
| `expire-carts` | hourly | Expire past TTL; release promotion code reservations |
| `release-stale-locks` | every 5 min | `locked` → `active` past the lock timeout |
| `purge-expired-carts` | daily | Hard-delete carts expired more than 90 days ago, retaining the merge log |

---

## 13) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Cart and order totals diverge | **Critical** | `cart`, `sales` | The cart rounds a tax amount differently from the order it produces; the buyer accepts 123,00 zł and is invoiced 123,45 zł. Consumer-law exposure and a reconciliation problem on every affected order. | ADR-2: all arithmetic through `salesCalculationService`; totals stored verbatim; a property-based test over the tax-rate matrix asserts cart totals equal order totals for the same lines — a Phase 2 gate | Low |
| R2 | Guest cart silently destroyed on login | **High** | `cart` | A buyer assembles a basket on mobile, logs in, and a `replace` merge deletes the desktop cart they were about to buy. Unrecoverable and invisible. | Documented policy (§7.1) defaulting to `sum`; `CartMergeLog` retains the full pre-merge snapshot; `mergeSummary` disclosed; 15-minute undo | Low |
| R3 | Re-pricing indistinguishable from a conflict | Medium | `cart` | The server re-prices on read, bumping the version; the client's next mutation 409s though nothing concurrent happened. Repeated, it looks like a broken cart. | `versionBumpReason: 'repricing'`; the 409 body embeds the current cart so the client reconciles in one round trip; re-price on read only past the staleness budget | Low |
| R4 | Undisclosed price increase | **High** | `cart`, legal | A promotion expires between add and checkout; the total rises silently and the buyer pays more than they agreed. | `priceChanges` on every response where a snapshot changed; `cart.price.changed` event; spec 10 requires the UI to surface it; checkout re-prices and must re-confirm | Low |
| R5 | Promotion evaluation cost | Medium | `cart`, `promotions` | Every mutation evaluates the full rule tree; a 50-line B2B quick order triggers 50 evaluations. | `/lines/bulk` evaluates once for the batch; SPEC-055's lightweight product-page variant used where a full pass is not needed; evaluation latency budgeted at P95 < 150 ms for a 50-line cart | Medium — depends on SPEC-055's engine performance, measured at the Phase 2 gate |
| R6 | Cart token leakage | **High** | `cart` | A token in a URL path reaches referrer headers, server logs and analytics; anyone holding it reads and mutates the basket, including the buyer's email. | 32+ byte CSPRNG token; header or httpOnly cookie only, never a path segment; rotated on merge; per-token rate limit; `email` encrypted at rest | Low |
| R7 | Stale availability accepted at checkout | Medium | `cart`, `availability` | A line marked `in_stock` 30 minutes ago is out of stock at submit; checkout fails after payment details are entered. | Availability in the cart is explicitly advisory; checkout re-checks and reserves at submit (availability spec §7); `warnings` surfaces a line that went out of stock on any read | Medium — inherent to reserve-at-checkout, and disclosed |
| R8 | Orphaned promotion code reservations | Medium | `cart`, `promotions` | Abandoned carts hold single-use code reservations; a limited campaign exhausts against baskets nobody bought. | Expiry sweeper releases reservations; abandonment releases them ahead of full expiry; reservation TTL is independent of and shorter than cart TTL | Low |
| R9 | Silent quantity rounding | Medium | `cart` | A pack-size increment of 6 silently rounds a request for 7 up to 12; the buyer receives and is billed for twice what they wanted. | Rejected with nearest valid values offered, never rounded (§5.5) | Low |
| R10 | Unbounded cart growth | Low | `cart` | A script adds 100 000 lines; promotion evaluation and totals become a denial of service. | 200 lines per cart, 10 000 units per line; per-token rate limit; batch endpoint capped at 100 lines per call | Low |

---

## 14) Integration Coverage

**Totals correctness (Phase 2 gate):**
- Cart totals equal the totals of the `SalesOrder` produced from the same lines, across a tax matrix including compound rates, mixed rates within a cart, and rounding boundaries (R1)
- Totals stored verbatim; no re-rounding on read
- Line and order-scope promotion adjustments reach `salesCalculationService` as `SalesAdjustmentDraft` and are reflected in totals

**Pricing:**
- Snapshot stable across repeated reads within the staleness budget
- Each of the seven triggers re-prices, and no other action does
- Crossing a `min_quantity` boundary re-prices that line only
- `nextTier` correct, absent at the top tier
- Personal customer price beats group price beats channel default
- `price_row_id` names the winning row
- `priceChanges` populated on every change, absent otherwise (R4)

**Concurrency:**
- Two clients at the same version: one succeeds, one gets 409 with the current cart embedded
- Repeated `Idempotency-Key` returns the original result without re-applying
- Same key with a different body returns 422
- Re-pricing bump carries `versionBumpReason: 'repricing'` (R3)
- 20 parallel add-line calls yield a consistent final quantity

**Merge:**
- All five §7.1 situations
- `CartMergeLog` captures the full pre-merge source
- `undo-merge` restores within 15 minutes, refuses after
- Post-merge re-price applied and disclosed
- Token rotated; the old guest token no longer resolves (R6)

**B2B:**
- Quantity increment violation rejected with nearest valid values (R9)
- Below `minOrderQuantity` rejected; above `maxOrderQuantity` capped with a warning
- Over `approval_required_above` sets `requiresApproval` and blocks the checkout lock
- Net tax mode from group terms reflected in totals

**Lifecycle:**
- Lock forces a re-price; mutation while locked returns 423 with the session id
- Lock timeout returns the cart to active
- Abandonment and expiry transitions; expiry releases code reservations (R8)
- Limits enforced (R10)

**API:** every route, with tenant isolation and cross-tenant token rejection.

---

## 15) Implementation Phases

### Phase 1 — Core cart
Entities, token generation, line CRUD, snapshots, `salesCalculationService` totals, optimistic locking, idempotency, TTL and sweepers.

**Gate:** the totals-equivalence property test passes; concurrency tests pass.

### Phase 2 — Pricing behaviour
Trigger set, `priceChanges` disclosure, quantity tiers and `nextTier`, quantity rules, availability advisory and warnings.

**Gate:** each trigger verified in isolation; no re-price outside the set.

### Phase 3 — Promotions and merge
`promotionsService` integration, code application and reservations, merge policy, `CartMergeLog`, undo.

**Gate:** merge covers all five situations with a restorable log; reservations released on expiry.

### Phase 4 — B2B and admin
Approval routing, bulk lines, admin cart list, abandonment events.

**Gate:** an over-threshold cart cannot lock until approved; a 100-line bulk add evaluates promotions once.

---

## 16) Open Questions

1. **Saved carts / multiple named carts** — B2B buyers maintain recurring order templates. The model supports it (a `name` column and a `saved` status), but the UX belongs to spec 9. *Deferred; not built speculatively.*
2. **Cross-store carts** — scoped to one store per the roadmap. Revisit if a tenant wants a shared basket across storefronts.
3. **Cart-level currency switching** — currently re-prices the whole cart. Whether a buyer may switch currency mid-cart at all, or must start over, is a merchandising decision. *Assumed re-price is acceptable.*
4. **Agent-authored carts** — `added_by: 'agent'` is in the model. Whether an AI-proposed line needs explicit buyer confirmation before it counts toward totals is an approval-contract question for the AI framework. *Reserved, not specified.*

---

## 17) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | All references are FK ids; catalog, promotions, availability, sales and groups reached through DI services |
| No reimplemented arithmetic | ADR-2 enforced; totals stored verbatim; property test gates it |
| Tenant/organization scoping | Every entity and query; cross-tenant token resolution rejected |
| Optimistic locking | `version` on `Cart`, conditional update, distinguishable re-price bumps |
| Encryption | `email` uses the encryption helpers; reads via `findWithDecryption` |
| Zod validation | All routes; `z.infer` types |
| No `any` | Service and payload contracts fully typed |
| i18n | Warning and error codes translated; no hard-coded user-facing strings |
| Rate limiting | Per token and per IP on public mutation routes |
| Queue usage | Sweepers via the `queue` worker contract, not custom timers |
| Events | `createModuleEvents`; `clientBroadcast` on line and totals events |
| Backward compatibility | New module; no existing contract surface changes. `SalesDocumentKind` deliberately **not** extended |
| Integration coverage | §14, shipping in the same change |

---

## 18) Changelog

### 2026-08-14
- Initial specification, replacing SPEC-029 v3 §7.4's cart-as-checkout-session model per ADR-1.
- Grounded in the implemented `sales` calculation contract: `SalesCalculationService.calculateDocumentTotals({ documentKind, lines, adjustments, context })`, with `SalesLineSnapshot` already carrying `productId`, `productVariantId`, `quantity`, `uomSnapshot`, `unitPriceNet`/`Gross`, `discountAmount`, `taxRate`, `configuration` and `promotionCode`, and `SalesAdjustmentDraft` already carrying `scope`, `promotionId` and net/gross amounts — so cart lines and promotion effects map onto the existing shapes without a parallel model.
- Chose `documentKind: 'quote'` over extending `SalesDocumentKind` (`'order' | 'quote' | 'invoice' | 'credit_memo'`), avoiding ripple into document sequences, search indexing and the documents table.
- Carried forward v3's idempotency and optimistic-locking reasoning (v3 §7.5), extending it with a distinguishable re-price version bump, which v3 did not anticipate because its cart never re-priced.
- Added the re-pricing trigger set, price-change disclosure, the merge policy with an append-only log and undo, and B2B quantity-tier behaviour — none of which existed in v3.
