# Cart Module

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 7 — assisted-selling seam) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 5, Phase 2 |
| **Modules** | `cart` (new) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Availability Contract](./2026-08-14-availability-contract.md), [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md) |
| **Related** | [SPEC-055 Promotions](./SPEC-055-2026-02-23-promotions-module.md), [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md), [Assisted Selling](./2026-09-22-assisted-selling.md), [ADR-1](./2026-08-14-ecommerce-suite-roadmap.md#adr-1--the-cart-is-a-module-not-a-checkout-status), [ADR-2](./2026-08-14-ecommerce-suite-roadmap.md#adr-2--cart-never-computes-tax-or-totals-itself), [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge) |

---

## TLDR

**Key Points:**
- A channel-agnostic basket module. `Cart` and `CartLine` are first-class entities addressed by an opaque token, usable by the storefront, POS, pay links and AI purchasing agents alike. Checkout consumes a cart; it does not own one.
- **The cart does no arithmetic.** It resolves unit prices via `catalogPricingService`, discounts via `promotionsService`, then hands `SalesLineSnapshot[]` to `salesCalculationService.calculateDocumentTotals` with `documentKind: 'quote'`. Cart totals and order totals are produced by the same code, so they cannot disagree.
- Prices are **snapshotted per line with a resolution stamp**, and re-priced on a defined set of triggers. A cart that silently re-prices mid-session is as broken as one that never does; the trigger list is the contract.
- B2B changes cart behaviour in ways B2C never exercises: quantity breaks re-price the whole line as quantity crosses a tier, pack increments constrain quantities, and an over-threshold cart routes to approval before checkout.

**Scope:**
- `Cart`, `CartLine`, `CartPromotionApplication`, `CartMergeLog`
- The **proposal seam** (rev 7): a cart may hold the role `proposal` against another cart, and be merged into it on the buyer's acceptance. The conversation that carries it belongs to [`assisted_selling`](./2026-09-22-assisted-selling.md), not here
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

### 3.1a Commands (fixed 2026-08-17)

Every mutation is a registered command, mirroring `sales/commands/documents.ts` — this module has no exemption from root `AGENTS.md`'s "domain writes go through commands" rule, and an earlier draft of this spec had none of these, describing mutations as plain HTTP handlers instead:

```
cart.lines.add · cart.lines.update · cart.lines.remove · cart.lines.bulkAdd
cart.promotions.apply · cart.promotions.remove
cart.merge · cart.mergeUndo
cart.approval.request
cart.reprice
cart.proposal.create · cart.proposal.accept · cart.proposal.reject      (rev 7 — §7a)
```

`cart.proposal.accept` **delegates to `cart.merge`**; it is not a second merge implementation. That delegation is the whole reason the proposal seam costs this module three commands rather than an entity family: disclosure (`mergeSummary`), reversal (`cart.mergeUndo`), the append-only pre-merge snapshot (`CartMergeLog.source_snapshot`) and the mandatory whole-cart re-price (§7.3) are already specified, already tested, and already the behaviour a buyer accepting someone else's suggestion needs.

Each command's `execute` phase runs the optimistic-lock pre-check (§8.1) before touching the entity manager, then mutates `Cart`/`CartLine`/`CartPromotionApplication` inside `withAtomicFlush(em, phases, { transaction: true, label: 'cart.<op>' })` — not a raw conditional SQL update — because the write flow (load → call `catalogPricingService`/`promotionsService` → call `salesCalculationService.calculateDocumentTotals` → persist totals) is exactly the multi-phase "mutate → external work → mutate again" shape that helper exists to protect. Side effects (`emitCrudSideEffects`, cache invalidation, `clientBroadcast` events) fire after commit, never inside the atomic-flush block. `cart.lines.add`/`.remove` and `cart.merge` carry meaningful undo via `extractUndoPayload`; `cart.reprice` and pricing-triggered re-snapshots are not undoable (re-pricing to a stale price is not a state a client would ever want restored) and are documented as such.

### 3.2 Totals

```typescript
const result = await salesCalculationService.calculateDocumentTotals({
  documentKind: 'quote',
  lines: cart.lines.map(toSalesLineSnapshot),          // line/unit promotion effects ride here
  adjustments: orderScopedEffects.map(toSalesAdjustmentDraft),
  context: { tenantId, organizationId, currencyCode, metadata: { source: 'cart', cartId } },
})
```

`documentKind: 'quote'` reuses the existing `SalesDocumentKind` union (`'order' | 'quote' | 'invoice' | 'credit_memo'`) rather than extending it. A quote is precisely what a cart is — a non-binding priced document — and extending the union would ripple into document sequences, search indexing and the documents table for no gain.

The mapping is direct because `SalesLineSnapshot` already carries `productId`, `productVariantId`, `quantity`, `quantityUnit`, `uomSnapshot`, `unitPriceNet`, `unitPriceGross`, `discountAmount`, `taxRate`, `configuration` and even `promotionCode`. `SalesAdjustmentDraft` carries `scope: 'order' | 'line'`, `promotionId`, `amountNet`/`amountGross` and `position`. Promotion effects map onto these shapes without inventing a parallel model.

**Promotion effects split by target**, per SPEC-055 §B.6 — they do not all become adjustment drafts. Only `appliesTo: 'order'` effects (`CART_DISCOUNT`, `DELIVERY_DISCOUNT`) become `SalesAdjustmentDraft`. A `LINE_DISCOUNT` becomes `SalesLineSnapshot.discountAmount` on the matching line, because `SalesAdjustmentDraft` carries no line reference and `sales` currently rejects a line-attributed draft outright (`documents.ts` — *"Line-scoped adjustments are not supported yet."*). Three rules bind this mapping, each of them a mispriced cart if broken:

1. `discountAmount` is **per-unit over the line's full quantity**: assign `|amount| / lineQuantity` — never `unitAmount`, never the raw `amount`, and divide by `lineQuantity` rather than `appliedQuantity`. There is no basis flag to pick: `buildBaseLineResult` (`packages/core/src/modules/sales/lib/calculations.ts:80-123`) reads `discountAmount` as `discountPerUnit` and computes `min(max(discountPerUnit × quantity, 0), netSubtotalBeforeDiscount)` for every document kind. A benefit covering 5 of 8 units at −2.40 has `amount: "-12.00"`, so `discountAmount = 1.50` and `sales` reproduces `1.50 × 8 = 12.00`; assigning `unitAmount` would discount 19.20 and assigning `amount` 96.00. Where `lineQuantity` does not divide the total the 4 dp rounding (`calculations.ts:22-24`) leaves a sub-cent gap — the document total is authoritative, the effect's `amount` is the display figure.
2. `discountAmount` is a positive magnitude on a **net** basis; take the absolute value, and convert when the effect's `basis` is `'gross'`.
3. Several cumulative promotions on one line sum into that single scalar. Per-promotion attribution on the line does not survive; it lives in `PromotionUsage.effects_snapshot`.

SPEC-055 §B.7 defers giving `SalesAdjustmentDraft` a `lineId` to its own spec against `sales`, on blast-radius grounds — `sales` is shipped code with live orders, quotes and returns, while `cart` and `promotions` are both greenfield.

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
| `kind` | text | `basket \| proposal`, default `basket`. A **role**, not a status — `status` (below) is unchanged and orthogonal. See §7a |
| `proposed_to_cart_id` | uuid, nullable | The basket this cart proposes into. Check constraint: NOT NULL exactly when `kind = 'proposal'`, NULL otherwise. Self-reference by FK id within one module, so §3.1's no-cross-module-ORM rule is not in play |
| `sales_channel_id` | uuid, nullable | `sales.SalesChannel.id` |
| `status` | text | `active \| locked \| converted \| abandoned \| expired \| merged` |
| `currency_code` | text | Fixed at creation |
| `locale` | text | |
| `customer_id` | uuid, nullable | `customers.CustomerEntity.id` |
| `customer_user_id` | uuid, nullable | `customer_accounts.CustomerUser.id` |
| `customer_group_ids` | jsonb | `string[]` snapshot at last pricing, for drift detection |
| `price_kind_id` | uuid, nullable | Snapshot at last pricing |
| `tax_mode` | text | `gross \| net` |
| `email` | text, nullable | Guest identification; encrypted at rest — declared in `cart/encryption.ts`'s `defaultEncryptionMaps: [{ entityId: 'cart:cart', fields: [{ field: 'email' }] }]` (fixed 2026-08-17; an earlier draft asserted this in §17 without a backing declaration anywhere in the module) |
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

Indexes: unique `token`; `(tenant_id, customer_id, status)`; `(tenant_id, status, expires_at)` for the sweeper; `(tenant_id, status, last_activity_at)` for abandonment; `(tenant_id, proposed_to_cart_id, status)` partial on `kind = 'proposal'`, which is the query behind "what has been proposed to this buyer and is still live".

**No `version` column** (fixed 2026-08-17): an earlier draft added one for optimistic locking, but this platform's optimistic-lock helpers (`enforceCommandOptimisticLock`, `packages/shared/src/lib/crud/optimistic-lock-command.ts`) are hard-coded to ISO-timestamp comparison against `updated_at` — a generic integer counter cannot plug into them, and duplicating them for a bespoke `version` token was the same mistake already made and fixed in the sibling `customer-groups-and-b2b-terms.md` spec. `Cart.updatedAt` (from "Standard scoped columns," above) is the sole concurrency token — see §8.1.

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
| `added_by_actor_type` | text | `buyer \| rep \| ai_agent \| merge \| system` |
| `added_by_actor_id` | uuid, nullable | `auth.User.id` for `rep` and `ai_agent`, `customer_accounts.CustomerUser.id` for an identified `buyer`; NULL for a guest buyer, for `merge` and for `system`. FK id only, resolved through DI |
| `metadata` | jsonb, nullable | |

`added_by_actor_type` **replaces** rev 6's `added_by` (`buyer | agent | merchant | merge`), which carried no id at all — so no line could be attributed to a person, no commission could be computed and no audit could answer "who put this here". Two columns rather than one enum extension, because the id is the entire point. The vocabulary changed with it: `agent` → `ai_agent` (an AI agent is a principal with a row in `users` carrying `kind: 'agent'`, the platform's existing notion — not a nameless category), `merchant` → `rep` (a named salesperson, which is what the value was always used for), and `system` is new, for a line the platform authored on nobody's behalf. Adding `added_by_actor_id` beside the old column instead would have left two overlapping descriptions of the same fact with no rule reconciling them — the mistake this suite already made once and fixed in SPEC-029 §5.1.1.

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
| `outcome` | jsonb | Per-line disposition, **with the target line it became**. Shape fixed in rev 7: `Array<{ sourceLineId, targetLineId: string \| null, disposition: 'merged' \| 'summed' \| 'capped' \| 'declined' \| 'rejected', reason?: string }>` |
| `merged_by_actor_type` | text | `buyer \| rep \| ai_agent \| system` |
| `merged_by_actor_id` | uuid, nullable | `CustomerUser.id` for `buyer`, `auth.User.id` for `rep` and `ai_agent`, NULL for a guest buyer and for `system` |
| `proposal_cart_id` | uuid, nullable | Set when the merge was a proposal acceptance (§7a); NULL for a guest→customer merge |

Rev 6 described `outcome` only as "per-line disposition and reason", which is enough to render a `mergeSummary` and not enough to trace one. Provenance is the stated purpose of this log — "a lost basket can be reconstructed" — and a disposition with no target line id cannot be joined to the line it produced, so any consumer asking "where did this line in my order come from" had to guess by product identity, which is unsound the moment a cart holds two lines of one product with different `configuration_hash`. Fixing the shape costs nothing and is what makes per-line attribution expressible at all ([Assisted Selling](./2026-09-22-assisted-selling.md) §6.7).

`merged_by_actor_type`/`_id` **replace** rev 6's `merged_by_customer_user_id`. That column could only name a `CustomerUser`, which was adequate while login was the only thing that caused a merge. A sales rep is an `auth.User` — a different table, with no foreign key between the two (`users` and `customer_users` are deliberately separate, down to distinct JWT audiences) — so a single-typed column could not record who performed a proposal acceptance at all, and would have silently recorded NULL.

Without this log, "my basket disappeared when I logged in" is unanswerable. With it, it is a support query and, if needed, a restore. Rev 7 extends that guarantee to "where did these three lines come from".

---

## 5) Pricing & Re-pricing

### 5.1 Snapshot

On add, and on every re-price, each line stores `unit_price_net`, `unit_price_gross`, `tax_rate`, `price_kind_id`, `price_row_id`, `price_tier_min_quantity` and `priced_at`. `price_row_id` exists so support can answer "why is this line 87 zł" by naming the row.

### 5.2 Re-pricing triggers

A cart re-prices when, and only when:

1. A line's quantity changes such that it crosses a `min_quantity` / `max_quantity` tier boundary — only the affected line
2. Buyer identity changes: login, logout, a group membership change, or a change to that customer's own assortment override (created, edited, deleted, or lapsing past its `valid_until`) altering `buyer_digest` — whole cart
3. Currency or locale changes — whole cart
4. A line snapshot is older than the staleness budget (default 30 minutes) and the cart is read — whole cart
5. Checkout requests a lock (spec 7) — whole cart, mandatory, never skipped
6. A promotion is applied or removed — effects only, not unit prices
7. An operator forces it through the admin cart view

It does **not** re-price on every read. A buyer refreshing the page five times sees a stable total.

### 5.3 Price change disclosure

When a re-price changes any line, the response carries a `priceChanges` array — old amount, new amount, reason, per line — and the cart records `last_price_change_at`. The client must show this; a total that changes without explanation reads as a bug or a dark pattern, and in a consumer context an undisclosed increase between basket and payment is a regulatory problem.

Re-pricing updates `updated_at` (the concurrency token, §8.1) but sets `versionBumpReason: 'repricing'` in the response, so a client that then submits its now-stale `updatedAt` gets a distinguishable answer rather than a bare conflict (R3). The distinguishing signal is response metadata attached whenever a mutation performed a repricing side effect — it works identically whether the underlying token is a timestamp or a counter, which is why dropping the `version` counter (§4.1) costs this behaviour nothing.

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

## 6a) Assortment Visibility (added 2026-09-06)

Applies the amendments [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §0 records against this document. Without them, the cart is the hole in an otherwise-enforced control: `storefront-public-api.md` §3.3 gates every product-returning **read** behind `buildStorefrontProductScope`, and nothing here gated the **write**. A buyer, script or AI purchasing agent holding any product id could add a restricted product straight to a cart, and cart lines flow into `checkout` and `SalesOrder` creation per ADR-1/ADR-2 — so an invisible product was fully purchasable. That is R11 below, and it is the reason this section exists.

### 6a.1 Per-line check on add, update and bulk add

`cart.lines.add`, `cart.lines.update` and `cart.lines.bulkAdd` gain one input field:

```typescript
assortmentScope?: EffectiveAssortmentScope   // packages/shared/src/lib/catalog-visibility/
```

After loading the product for its existing name/sku snapshot (§4.2) and before persisting the line:

```typescript
if (cart.channel === 'storefront') {
  if (input.assortmentScope === undefined) {
    throw new ValidationError('assortment_scope_required_for_storefront_channel')   // 400
  }
  const scoped = { id: product.id, categoryIds: product.categoryIds, tagIds: product.tagIds }
  if (!matchesScope(scoped, input.assortmentScope)) {
    return rejectLine({ code: 'product_unavailable', lineId: existingLineId ?? null })
  }
}
```

The caller **supplies** the scope rather than `cart` re-deriving it: the storefront route that proxies here has already called `storeContextService.resolve()` for pricing, so it passes the same `buyer.assortmentScope` through unchanged. This matches ADR-7 ("resolved once, at the edge") and keeps `cart` free of any new dependency on `ecommerce` or `customer_groups` beyond the `resolveTerms()` edge §3.1 already declares. Making the field **required when `channel === 'storefront'`** — validated, not merely optional — turns "the route layer forgot to pass it" into a `400` here rather than a silent bypass.

Rejection is a **non-fatal warning**, matching §10.1's existing convention for an out-of-stock line: the line is not added (or, for `.update`, the change is rejected and the line stays at its prior state), the request itself does not error, and `warnings` carries the code — which is what lets `bulkAdd` succeed partially across 50 lines.

### 6a.2 Whole-cart re-visibility pass at triggers 2 and 5

A per-line check alone leaves a time-of-check/time-of-use window: `CustomerGroupMembership.valid_until` is a first-class feature (spec 1 §5.2), so a buyer can legitimately add a Wholesale-only product while a member, have the membership lapse, and reach checkout with a line that was never re-checked.

So the re-pricing triggers in §5.2 that already run **whole-cart** carry a parallel re-*visibility* pass against the freshly-resolved scope:

- **Trigger 2** (buyer identity changes: login, logout, group membership change, per-customer assortment override change) — the case that produces the drift.
- **Trigger 5** (checkout requests a lock; "mandatory, never skipped") — the backstop.

A line that fails is **not deleted**. Deleting a buyer's line without disclosure is the failure class R2 and R4 already exist to prevent, and this does not add a third instance of it. The line is flagged `product_unavailable` in `warnings`, exactly as an out-of-stock line already is, and **the `active → locked` transition is refused while any line carries that flag** (§9) — mirroring the existing precedent that an over-`approval_required_above` cart cannot lock. The buyer removes or replaces the line, or regains access and re-triggers a re-price, before checkout proceeds.

### 6a.3 No write-side enumeration oracle

A restricted product and a nonexistent or deleted product id produce the **identical** `product_unavailable` warning — same body, same shape. This is `storefront-public-api.md` §4.2's handle-enumeration rule applied to a mutation: the read path goes to the trouble of collapsing "restricted" and "nonexistent" into one indistinguishable 404, and the write path must not hand that distinction back.

### 6a.4 Non-storefront channels are exempt by construction

The rule is keyed on **whether a scope was resolved**, not on an enumerated channel list: enforcement applies exactly to carts whose channel resolved a `StoreContext`, which today is `storefront` alone. `pos`, `pay_link`, `agent` and `api` carts have no channel binding and no buyer digest, so there is nothing to check against. A future channel that gains `StoreContext` resolution inherits enforcement automatically. An in-store POS sale by staff is a deliberately different trust boundary — assortment scope is a self-service merchandising control, not a sales permission.

**The exemption is a property of the cart a line lives in, not a property that travels with the line.** §6a.5 states the consequence, and it is the reason this sentence had to be added.

### 6a.5 Merge runs a visibility pass (added 2026-09-22 — **Critical**, independent of assisted selling)

§6a.4's exemption and §7's merge compose into a bypass of R11, and rev 6 did not say so anywhere.

The composition: a cart in an exempt channel — `agent` or `api` today — may hold any line, by construction and by design. Merge then moves those lines into a `storefront`-channel cart, which *is* scope-enforced. Nothing in rev 6 re-checked them on the way in. §7.3 does mandate a whole-cart pass after a merge, but it mandates a re-***pricing*** pass, and §6a.2 lists re-***visibility*** against triggers 2 and 5 only — a merge is neither. So restricted lines entered an enforced cart through an unenforced one, and from there flowed through `checkout` into a `SalesOrder`. That is R11's exact failure text reached by a second route, and it is reachable today by any caller that can create an `agent`-channel cart, with no assisted selling involved.

**Rule.** A merge into a cart whose channel resolves a `StoreContext` runs a re-visibility pass over every incoming line against the **target** cart's freshly-resolved `EffectiveAssortmentScope`, before the lines are persisted.

**A failing line is neither admitted nor deleted.** It is reported in `mergeSummary` (§7.2) with `disposition: 'rejected'` and `reason: 'product_unavailable'`, recorded with the same disposition in `CartMergeLog.outcome`, and left in the source snapshot so the merge stays reversible. Silently admitting it is R11; silently dropping it is the class of failure R2 and R4 already exist to prevent, and this section does not introduce a third instance of it. The buyer is told which lines did not come across, and why, in the same response that tells them what did.

`cart.line.visibility_rejected` (§11) gains `triggeredBy: 'merge'` — an additional value on an existing enum, not a new event.

**Phasing.** This lands with **Phase 3** (§15), beside the merge it corrects — not with the proposal seam in Phase 4. The defect exists as soon as merge exists; deferring the fix to Phase 4 would ship Phase 3 with a documented Critical, and would let the suite's Phase 2 gate — which already requires the cart-side assortment check — pass over a route that defeats it.

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
| **Proposal accepted (§7a)** | `manual` — merge exactly the lines the buyer selected; every unselected line is recorded in `outcome` as `declined` and left in the source snapshot |

`manual` was already a legal value of `CartMergeLog.strategy` in rev 6 (§4.4) and no row of this table ever produced it — a value the model admitted and the policy could not reach. §7a is what reaches it: per-line acceptance is exactly "the buyer chose which of these to take", which is what a manual strategy means and what neither `sum`, `replace` nor `keep_target` can express.

Default strategy is `sum`, configurable per store. Every merge writes a `CartMergeLog` with the full pre-merge source snapshot.

### 7.2 Disclosure and reversal

After a merge the response carries `mergeSummary` — lines added, quantities combined, anything capped, and (rev 7) anything **rejected** by the visibility pass of §6a.5 or **declined** by the buyer under the `manual` strategy. The UI must surface it. Every incoming line appears in the summary under exactly one disposition; a line that is silently absent from both the summary and the cart is the defect this rule exists to make impossible. `POST /carts/:token/undo-merge` restores the pre-merge state from the log within 15 minutes.

**Rejected alternative:** silently replacing the customer cart with the guest cart. It is the simplest rule and it deletes a basket the buyer assembled on another device, with no trace.

### 7.3 Re-pricing after merge

Mandatory and whole-cart — the buyer's group has just become known, so every line's price may change. This is exactly the case that trigger 2 exists for, and it is also the case most likely to surprise, so `priceChanges` matters most here.

Re-pricing is *not* the only whole-cart pass a merge owes: §6a.5 requires a re-visibility pass in the same operation. The two are separate concerns that happen to share a boundary, and rev 6 had only the first.

---

## 7a) Proposal Carts (added 2026-09-22 — rev 7)

The seam that lets somebody other than the buyer put a priced basket in front of the buyer, without ever touching the buyer's own. Everything about **who** is proposing, through what conversation, and with what presence disclosure belongs to [`assisted_selling`](./2026-09-22-assisted-selling.md). This section is the whole of the `cart` side.

### 7a.1 A proposal is a role, not a status

`Cart.kind = 'proposal'` with `proposed_to_cart_id` pointing at the target basket. It is an ordinary cart in every other respect: same line model, same price snapshots, same promotion evaluation, same totals through `salesCalculationService`, same limits, same TTL sweeper. `Cart.status` is untouched and orthogonal — a proposal is `active` while live, `expired` past its `expires_at`, `merged` once accepted (with `merged_into_cart_id` set to the target), and `abandoned` once rejected.

**There is no `rejected` status and no proposal entity family.** `abandoned` is the existing terminal non-converting state and it is the accurate one; *why* a proposal ended — rejected by the buyer, withdrawn by its author, superseded by a re-authored one — is metadata about a conversation, and lives with the conversation in `assisted_selling`. Adding a fifth lifecycle to `Cart.status`, or a `CartProposal`/`CartProposalLine` pair beside `Cart`/`CartLine`, would duplicate a line model, a pricing path and a totals path that already exist and are already the ones that must produce the number the buyer pays.

### 7a.2 A proposal is priced as the buyer, never as its author

`cart.proposal.create` takes the **target cart's token**, and the proposal cart is created carrying the target's `customer_id`, `customer_user_id`, `customer_group_ids`, `price_kind_id`, `currency_code`, `locale`, `tax_mode`, `channel`, `store_id`, `sales_channel_id` and `buyer_digest` — copied at creation and re-derived from the target on every re-price. The author's own identity, group membership and price kind never enter pricing at any point.

This is not a convenience. A rep resolving `catalogPricingService` under their own context, or an AI agent under a service principal's, produces a proposal the buyer accepts at a price the buyer will not be charged: the mandatory post-merge re-price (§7.3) then corrects it, and `priceChanges` discloses a rise the buyer never agreed to. The pricing context is a property of the basket being proposed *into*, and copying it at the seam is what makes that true by construction rather than by discipline. ADR-7 and ADR-9 are the suite-level statements of the same rule.

Because the proposal cart carries the target's `channel`, a proposal against a storefront basket is itself scope-enforced: §6a.1's `assortmentScope` requirement applies to `cart.proposal.create` exactly as it applies to `cart.lines.add`, and §6a.5's pass at the merge boundary is the backstop rather than the only control.

### 7a.3 Expiry

`expires_at` on a proposal cart is set from the owning store's proposal TTL (default 72 h, configurable) rather than from the normal cart TTL, and the existing `expire-carts` sweeper (§12) retires it. An expired proposal is **not deleted**: it stays readable, so the buyer and the author see the same history of the conversation, and so a rejected-or-lapsed suggestion remains attributable. Re-proposing an expired basket is a new proposal cart, freshly priced — never a revival of the old one, whose snapshots are by then exactly as stale as the TTL says.

### 7a.4 Acceptance is a two-step merge

Acceptance never happens in one call, because the price the buyer saw in the proposal and the price the buyer will pay after the merge are resolved at different moments, and `cart` is the module that refuses to let those two differ silently (R4).

```
POST /carts/:token/proposals/:proposalToken/preview
     → re-prices the proposal against the target's CURRENT buyer context,
       runs the §6a.5 visibility pass in dry-run,
       CREATES NOTHING,
       returns { acceptancePreview, acceptanceToken }      acceptanceToken TTL 15 min

POST /carts/:token/proposals/:proposalToken/accept
     body: { acceptanceToken, lines: [{ proposalLineId, accepted: boolean }] }
     → re-resolves; if anything moved since the token was issued, 409 `proposal_changed`
       with a fresh preview and a fresh token
     → otherwise delegates to cart.merge { strategy: 'manual' }
```

`acceptancePreview` carries, per line, the proposed unit price, the price re-resolved now, the delta, and any `product_unavailable` rejection — the same disclosure vocabulary `priceChanges` and `mergeSummary` already use, so a client has one parser rather than three.

The token binds the target cart's `updatedAt` **and** the proposal cart's `updatedAt`. Either moving invalidates it. This is the shape [`storefront-customer-account.md`](./2026-08-14-storefront-customer-account.md) §7.3 already fixed for reorder preview — "create NOTHING; return the preview and a short-lived `resolutionToken` … a buyer must never accept difference set A and receive cart B" — and the failure it prevents is identical here. It composes with, rather than replaces, §8.1's optimistic lock on the target cart.

`lines` is what makes the `manual` strategy of §7.1 reachable: the buyer takes two of five suggestions and the other three are recorded as `declined`, not deleted and not quietly merged.

A target cart in `locked` status refuses acceptance with `423 Locked` and the checkout session id, per §9 — the buyer is mid-checkout and the basket is not theirs to change at that moment either.

### 7a.5 Rejection

`cart.proposal.reject` sets the proposal cart to `abandoned` and releases any promotion code reservations it held (§6). It touches the target cart not at all — there is nothing to undo, because nothing was ever merged. This asymmetry with acceptance is the point of the whole design: **the cheap operation is the one that changes nothing.**

### 7a.6 What this module does not own

The thread, its participants and their presence; the message bodies; who may author a proposal and under which store mode; the AI agent, its tools and its budget; commission attribution after conversion. All of it is [`assisted_selling`](./2026-09-22-assisted-selling.md). `cart` never learns that a conversation exists: it has no `thread_id` column, no inbound dependency, and no knowledge of why a proposal was authored — consistent with §3.1's "`cart` has no inbound dependency".

---

## 8) Concurrency & Idempotency

### 8.1 Optimistic locking (fixed 2026-08-17 — see §4.1)

Every mutating command starts with `enforceCommandOptimisticLock({ resourceKind: 'cart.cart', resourceId: cart.id, current: cart.updatedAt, request: ctx.request })` (`packages/shared/src/lib/crud/optimistic-lock-command.ts`) — the same mechanism every other command-driven write in this platform uses, not a bespoke conditional SQL update. The client sends its expected `updatedAt` via the standard `x-om-ext-optimistic-lock-expected-updated-at` header (or as a typed `updatedAt` field on the mutation body); the helper throws a `409` with the platform's standard `{ error, code, currentUpdatedAt, expectedUpdatedAt }` body on mismatch — the same shape every other conflict-bar-integrated surface in the admin UI already understands.

**Cart adds one thing on top, not instead of, that mechanism**: the `409` response body also embeds the full current `CartView` (§10.1) alongside the standard fields, so the client can reconcile without a second round trip — this was always additive to the platform's own conflict contract, never a reason to bypass it.

The lock check runs before any entity manager work; the entity mutations themselves run inside `withAtomicFlush(em, phases, { transaction: true, label: 'cart.<op>' })` (§3.1a) — not a raw SQL `UPDATE ... WHERE`, because the write flow interleaves external service calls (`catalogPricingService`, `promotionsService`, `salesCalculationService`) with entity mutations, which is exactly the "mutate → external work → mutate again" shape `withAtomicFlush` exists to protect against a dropped scalar update.

### 8.2 Idempotency

Mutations accept an `Idempotency-Key`. A repeated key within the cart's lifetime returns the original result without re-applying — this is what makes "add to cart" safe under a double-tap or a retried request on a flaky mobile connection.

Keys are stored per cart with the resulting `updatedAt` and a response digest. A key replayed with a different body returns `422 idempotency_key_mismatch`.

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
| `active → locked` | Requested by `checkout`; forces a whole-cart re-price **and a whole-cart re-visibility pass** (§6a.2) first; **rejected while any line carries an unresolved `product_unavailable` warning**; rejects mutation while locked |
| `locked → active` | Explicit unlock, or a lock timeout (default 30 min) |
| `active → abandoned` | No activity for 24 h (configurable); emits an event for recovery flows |
| `abandoned → active` | Any mutation; extends `expires_at` |
| `active → expired` | `expires_at` reached (default 30 days for identified buyers, 7 for guests); releases promotion code reservations |
| `* → merged` | Login merge; `merged_into_cart_id` set |

A `locked` cart that a client tries to mutate returns `423 Locked` with the checkout session id, not a generic error — the client needs to know to send the buyer back to checkout.

---

## 10) API Contracts

Base `/api/cart`. Token-bound, public with an optional buyer session. Every mutating route accepts the expected `updatedAt` (via the standard optimistic-lock header or a typed body field — §8.1) and `Idempotency-Key`. The three line-mutating routes additionally carry `assortmentScope`, required for storefront-channel carts (§6a.1).

| Method | Path | Purpose |
|---|---|---|
| POST | `/carts` | Create; returns token + `updatedAt` |
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
| GET | `/carts/:token/proposals` | Live proposals addressed to this cart, newest first (§7a) |
| POST | `/carts/:token/proposals` | Author a proposal against this cart. `cart.proposals.author`; **not** token-only — see below |
| POST | `/carts/:token/proposals/:proposalToken/preview` | Pre-flight re-price + dry-run visibility pass; creates nothing; returns `acceptancePreview` + `acceptanceToken` |
| POST | `/carts/:token/proposals/:proposalToken/accept` | Per-line acceptance; delegates to `cart.merge` with `strategy: 'manual'` |
| POST | `/carts/:token/proposals/:proposalToken/reject` | Terminal; touches the target cart not at all |

**Authoring is the one route on this base path that a cart token alone cannot reach.** `GET`, `preview`, `accept` and `reject` are token-bound like the rest of `/api/cart`, because they are the buyer acting on their own basket and a guest buyer has no session to present. `POST /carts/:token/proposals` is the opposite: it is somebody *other* than the buyer writing, so it requires an authenticated principal holding `cart.proposals.author` — a staff `auth.User`, or an AI agent principal (`users.kind = 'agent'`). Letting a leaked cart token author proposals into its own cart would hand an attacker a way to put priced lines in front of a buyer under the store's own branding, which is R15.

`/carts/:token/lines/bulk` exists because B2B quick-order pads and agent proposals add 50 lines at once, and 50 sequential mutations means 50 promotion evaluations and 50 version conflicts.

### 10.1 Response

Every endpoint returns the same envelope, so a client has one parser:

```typescript
{
  cart: {
    token: string; updatedAt: string; status: CartStatus
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

`GET /api/cart/carts` and `/carts/:id` under `cart.carts.view` — an abandoned-cart list with buyer, value and age, plus (rev 7) proposal carts filterable by `kind` and by target.

**Staff never edit a buyer's basket. They author proposals.** Rev 6 stated the first half of that as a flat prohibition — *"support may inspect and force a re-price but not edit a buyer's basket"* — and stopped there, which left the thing staff actually need to do with no specified way to do it. A prohibition with no alternative is not a boundary; it is a gap that gets closed by whoever is under pressure first, in whatever way is available, usually a direct write.

The rule in force from rev 7:

- Read-only inspection and a forced re-price remain available under `cart.carts.view` / `cart.carts.manage`, exactly as before.
- Any *content* change a staff member wants in a buyer's basket is authored as a proposal cart (§7a) and takes effect only when the buyer accepts it.
- There is no admin route that adds, updates or removes a line on a cart the staff member does not own. The absence is deliberate and is asserted by test (§14).

The prohibition is unchanged in effect and stronger in practice, because it is now a contract with a defined counterpart rather than a dead end.

### 10.3 ACL

```typescript
export const features = [
  { id: 'cart.carts.view',    title: 'View carts' },
  { id: 'cart.carts.manage',  title: 'Manage carts (reprice, expire)' },
  { id: 'cart.settings.manage', title: 'Manage cart settings' },
  { id: 'cart.proposals.author', title: 'Author proposal carts' },   // rev 7
  { id: 'cart.proposals.view',   title: 'View proposal carts' },     // rev 7
]
```

`cart.proposals.author` gates the write and nothing else: it says a principal may put a priced basket in front of a buyer. Which buyers, in which conversation, under which store mode — that is `assisted_selling`'s to decide, and it holds its own features. Acceptance and rejection carry **no** feature: they are the buyer acting on their own cart through their own token, and a guest buyer has no ACL identity to check.

---

## 11) Events

```typescript
'cart.cart.created' | '.updated' | '.expired' | '.abandoned' | '.merged' | '.converted'
'cart.line.added' | '.updated' | '.removed'
'cart.promotion.applied' | '.removed' | '.no_longer_valid'
'cart.price.changed'          // payload: per-line old/new and reason
'cart.approval.requested'
'cart.lock.acquired' | '.released' | '.timed_out'
'cart.line.visibility_rejected'   // added 2026-09-06 — §6a
'cart.proposal.created' | '.accepted' | '.rejected' | '.expired'   // added 2026-09-22 — §7a
```

`cart.line.visibility_rejected` carries `{ cartId, productId, variantId, reason: 'not_in_assortment', triggeredBy: 'add' | 'update' | 'bulkAdd' | 'reprice' | 'checkout_lock' }` and is emitted by both enforcement points (§6a.1, §6a.2). It is **not** `clientBroadcast` — the buyer already sees the `product_unavailable` warning in the response body; this is the operator-facing signal, so a merchant who narrows a group's `assortment_scope` too far, or misconfigures a channel's `require_authentication`, sees a trend instead of scattered support tickets. Same reasoning as `availability.shortfall.detected` and `customer_groups.credit.limit_exceeded`.

The four `cart.proposal.*` events carry `{ proposalCartId, targetCartId, authoredByActorType, authoredByActorId, lineCount }`, and `.accepted` additionally carries `mergeLogId` and `acceptedLineCount`. They are `clientBroadcast: true` so a rep's console reflects a buyer's decision without polling, and — once the transport of [`assisted_selling`](./2026-09-22-assisted-selling.md) exists — they are the events its buyer-facing bridge relays. Like every other broadcast event in this platform they are a **signal, not a payload**: the recipient re-reads state through the API. They deliberately carry no line, price or total.

`cart.cart.converted` gains a payload requirement in rev 7, because commission attribution depends on it: it MUST carry `salesOrderId` and `lineMap: Array<{ cartLineId, salesOrderLineId }>`. Whoever creates the order from the cart holds that mapping at creation time — it is the same ordered traversal that builds `SalesLineSnapshot[]` — so this records an obligation on spec 7 (checkout) rather than inventing new work. Where `lineMap` is absent, a consumer degrades to order-level attribution and says so; it never guesses the mapping from product identity, because a cart may legitimately hold two lines of the same product with different `configuration_hash`.

`cart.line.visibility_rejected`'s `triggeredBy` enum gains `'merge'` (§6a.5) — an additional value on an existing event, not a new event.

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
| R11 | Write path bypasses read-side assortment visibility | **Critical** | `cart` | A product hidden from browsing is still purchasable: a buyer, script or AI agent holding a product id (a stale link, a scraped sitemap, an id from an unrelated source) `POST`s it to `/carts/:token/lines`, and the line flows through `checkout` into a `SalesOrder`. A read-side 404 that a cart mutation ignores is a suggestion, not a control. | §6a.1: `assortmentScope` is a validated, required input on `lines.add`/`.update`/`.bulkAdd` for storefront-channel carts — omission is a `400`, not a silent pass-through; §6a.2's whole-cart pass at triggers 2 and 5 closes the time-of-check/time-of-use window a lapsing membership opens, with the checkout lock refused while a line is flagged | Low once shipped — the residual is a future cart mutation forgetting the same check, mitigated by §6a.4's channel-keyed rule rather than an enumerated list |
| R12 | Write-side rejection becomes its own enumeration oracle | Medium | `cart` | A distinguishable "restricted" vs "not found" response lets a script map a private assortment through cart-add attempts — the write-side analogue of `storefront-public-api.md` R4. | §6a.3: identical `product_unavailable` warning for both cases, asserted by test | Low |
| R13 | Merge admits lines that never passed an assortment check | **Critical** | `cart` | §6a.4 exempts channels that resolve no `StoreContext` — today `agent` and `api`. A caller creates an `agent`-channel cart holding a restricted product, merges it into the buyer's storefront cart, and the line reaches `checkout` and `SalesOrder` having never been checked. §7.3's post-merge pass is a re-*pricing* pass; §6a.2 lists re-*visibility* against triggers 2 and 5 only, and a merge is neither. Reachable with no assisted selling involved. | §6a.5: a merge into a scope-resolving cart runs the visibility pass over every incoming line against the **target's** freshly-resolved scope, reports failures in `mergeSummary` and `CartMergeLog.outcome`, and neither admits nor deletes them. Ships with **Phase 3**, beside the merge it corrects | Low once shipped — residual is a future merge-like path forgetting the pass, mitigated by keying the rule on the target cart rather than on an enumerated source channel |
| R14 | Proposal priced as its author rather than as the buyer | **High** | `cart`, legal | A rep on a staff price kind, or an AI agent running under a service principal, authors a proposal; `catalogPricingService` resolves against the author's context. The buyer accepts 84,00 zł, the mandatory post-merge re-price (§7.3) corrects it to 129,00 zł, and `priceChanges` discloses an increase the buyer never agreed to — an undisclosed-increase complaint dressed up as a disclosure. Worse in B2B, where the two contexts differ by a negotiated contract rather than by a rounding. | §7a.2: the proposal cart copies the **target's** pricing context (`customer_group_ids`, `price_kind_id`, `currency_code`, `tax_mode`, `buyer_digest`, `channel`) at creation and re-derives it from the target on every re-price; the author's identity never enters pricing. Asserted by a test that authors as a rep on a different price kind and compares against the buyer's own resolution | Low |
| R15 | Proposal authoring reachable by a cart token | **High** | `cart` | Every other route on `/api/cart` is token-bound, so authoring is written the same way by symmetry. A leaked token (R6) then lets an attacker inject priced lines into the buyer's own proposal tray, rendered in the store's branding and one click from the basket — phishing with the merchant's trust behind it. | §10: `POST /carts/:token/proposals` requires an authenticated principal holding `cart.proposals.author` and is the single route on this base path a token alone cannot reach; accept/reject/preview stay token-bound because there the token holder *is* the buyer. Asserted by a test that presents a valid cart token with no principal and expects `401` | Low |
| R16 | Actor attribution lost or unverifiable | Medium | `cart` | `added_by_actor_id` is written from request input rather than from the authenticated principal, so a caller attributes a line to another rep — or the column is left NULL on a path nobody remembered, and commission silently under-reports. | `added_by_actor_type`/`_id` are set by the command from `ctx.auth`, never from the request body, and are non-nullable for `rep`/`ai_agent`; a test asserts a body-supplied actor id is ignored. `CartMergeLog` records the merging actor with the same rule | Low |

---

## 14) Integration Coverage

**Totals correctness (Phase 2 gate):**
- Cart totals equal the totals of the `SalesOrder` produced from the same lines, across a tax matrix including compound rates, mixed rates within a cart, and rounding boundaries (R1)
- Totals stored verbatim; no re-rounding on read
- Order-scope promotion effects reach `salesCalculationService` as `SalesAdjustmentDraft`, line- and unit-scope effects as `SalesLineSnapshot.discountAmount` carrying `|amount| / lineQuantity`, and both are reflected in totals (SPEC-055 §B.6)
- A partially covered line (`appliedQuantity < lineQuantity`) discounts `unitAmount × appliedQuantity`, not `unitAmount × lineQuantity` — asserted in all three directions (correct mapping, `unitAmount` assigned directly, raw `amount` assigned) so neither mis-mapping can pass (SPEC-055 A-R6 / `TC-PROM-060`)
- Where `lineQuantity` does not divide `|amount|` evenly, the byte-identical-totals assertion above compares document totals; the effect's `amount` may differ from the realised discount by up to the 4 dp rounding step

**Pricing:**
- Snapshot stable across repeated reads within the staleness budget
- Each of the seven triggers re-prices, and no other action does
- Crossing a `min_quantity` boundary re-prices that line only
- `nextTier` correct, absent at the top tier
- Personal customer price beats group price beats channel default
- `price_row_id` names the winning row
- `priceChanges` populated on every change, absent otherwise (R4)

**Concurrency:**
- Two clients presenting the same `updatedAt`: one succeeds, one gets 409 (standard `enforceCommandOptimisticLock` body) with the current cart additionally embedded
- Repeated `Idempotency-Key` returns the original result without re-applying
- Same key with a different body returns 422
- Re-pricing bump carries `versionBumpReason: 'repricing'` (R3)
- 20 parallel add-line calls yield a consistent final quantity

**Merge:**
- All six §7.1 situations, including the `manual` row added in rev 7
- `CartMergeLog` captures the full pre-merge source
- `undo-merge` restores within 15 minutes, refuses after
- Post-merge re-price applied and disclosed
- Token rotated; the old guest token no longer resolves (R6)

**B2B:**
- Quantity increment violation rejected with nearest valid values (R9)
- Below `minOrderQuantity` rejected; above `maxOrderQuantity` capped with a warning
- Over `approval_required_above` sets `requiresApproval` and blocks the checkout lock
- Net tax mode from group terms reflected in totals

**Assortment visibility (R11/R12 regression suite, §6a):**
- `lines.add` with a restricted product and a correctly-supplied `assortmentScope`: rejected with `product_unavailable`; totals unaffected
- `lines.add` on a `storefront`-channel cart with `assortmentScope` omitted: `400 assortment_scope_required_for_storefront_channel`, no line added
- `lines.bulkAdd` mixing visible and restricted products: visible ones added, restricted ones reported per-line in `warnings`, no whole-batch failure
- `lines.update` on a line whose product has since become restricted: rejected, the existing line untouched and **not** deleted, `lineId` populated in the warning
- `pos`/`pay_link`/`agent`/`api` carts: no `assortmentScope` required, no rejection regardless of storefront assortment status (§6a.4)
- **The TOCTOU fixture:** add a line while the buyer is a member of a scoped group, expire the membership, request the checkout lock (trigger 5) — the lock is refused while the line is flagged, and the line is still present
- A membership change mid-session (trigger 2) runs the same whole-cart pass without waiting for checkout
- A restricted and a nonexistent product id produce identical `lines.add` responses in body and timing (R12)
- `cart.line.visibility_rejected` emitted from both enforcement points with the correct `triggeredBy`

**Merge visibility (R13 regression suite, §6a.5) — Phase 3:**
- A line added in an exempt-channel cart (`agent`, `api`) that is outside the target's assortment is **rejected** on merge into a storefront cart: absent from the target, present in `mergeSummary` with `disposition: 'rejected'`, present in `CartMergeLog.outcome`, and still present in `source_snapshot`
- The same merge leaves visible lines unaffected — a partial rejection is never a whole-merge failure
- `undo-merge` after a partially-rejected merge restores the pre-merge target exactly
- Every incoming line appears in `mergeSummary` under exactly one disposition; a fixture asserts no line is absent from both the summary and the cart
- Every `outcome` entry names its `targetLineId` when the disposition produced a line, and `null` when it did not; a merge that sums two lines of one product with different `configuration_hash` maps each source line to the correct distinct target
- `cart.line.visibility_rejected` emitted with `triggeredBy: 'merge'`
- A merge into a `pos`/`pay_link` target runs no pass and rejects nothing (§6a.4 unchanged)

**Proposals (§7a) — Phase 4:**
- `cart.proposal.create` against a target on a different price kind produces line prices byte-identical to the target buyer's own resolution, not the author's (R14)
- A proposal against a storefront target requires `assortmentScope` and rejects a restricted product at authoring time, per §6a.1
- `POST /carts/:token/proposals` with a valid cart token and no authenticated principal returns `401`; with a principal lacking `cart.proposals.author`, `403` (R15)
- `preview` creates nothing: no cart, no line, no merge log, asserted by row counts before and after
- `accept` with a stale `acceptanceToken` returns `409 proposal_changed` carrying a fresh preview and a fresh token, and merges nothing
- `accept` with a token whose target `updatedAt` moved, and separately whose proposal `updatedAt` moved, both `409`
- `acceptanceToken` expires after 15 minutes and is single-use
- Per-line acceptance merges exactly the selected lines; unselected lines are recorded `declined` and are neither merged nor deleted; `CartMergeLog.strategy` is `manual`
- Acceptance re-prices whole-cart and discloses `priceChanges` alongside `mergeSummary` in one response
- `undo-merge` reverses an acceptance within 15 minutes and restores the proposal to `active` when it has not yet expired
- Acceptance against a `locked` target returns `423` with the checkout session id
- Rejection sets the proposal to `abandoned`, releases its code reservations, and leaves the target cart byte-identical
- An expired proposal is readable, is not accept-able, and is not deleted by the sweeper
- **No admin route mutates a line on a cart the principal does not own** — asserted by enumerating the module's registered routes, so a future addition fails the test rather than silently reopening §10.2
- `added_by_actor_id` supplied in a request body is ignored; the value written is the authenticated principal's (R16)
- Attribution survives acceptance: lines merged from a proposal keep `added_by_actor_type = 'rep' | 'ai_agent'` and their author's id, rather than being rewritten to `merge`

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
`promotionsService` integration, code application and reservations, merge policy, `CartMergeLog` with its polymorphic actor, undo, **and the merge-time re-visibility pass of §6a.5**.

§6a.5 sits here rather than in Phase 4 because it corrects merge, not proposals: the defect it closes (R13) exists the moment merge exists, independently of whether assisted selling is ever built. Deferring it would ship this phase with a documented Critical and would let the suite's Phase 2 gate — which already requires the cart-side assortment check — pass over a route that defeats it.

**Gate:** merge covers all six situations with a restorable log; reservations released on expiry; a restricted line merged from an exempt-channel cart is rejected, disclosed and recoverable, never silently admitted and never silently dropped.

### Phase 4 — B2B and admin
Approval routing, bulk lines, admin cart list, abandonment events, **and the whole proposal seam (§7a)**: `Cart.kind` / `proposed_to_cart_id`, `CartLine.added_by_actor_*`, the `manual` merge strategy, the three `cart.proposal.*` commands, the five proposal routes and the `cart.proposal.*` events.

**Gate:** an over-threshold cart cannot lock until approved; a 100-line bulk add evaluates promotions once; a proposal authored by a rep on a different price kind prices identically to the buyer's own resolution; `preview` creates nothing and a stale `acceptanceToken` cannot merge.

---

## 16) Open Questions

1. **Saved carts / multiple named carts** — B2B buyers maintain recurring order templates. The model supports it (a `name` column and a `saved` status), but the UX belongs to spec 9. *Deferred; not built speculatively.* **Closed 2026-09-16:** spec 9 split the two meanings that "template" conflated — a parked basket is a saved cart, resumed once (and merged via the existing `cart.merge`/`cart.mergeUndo` when the buyer already holds one), while a reusable named set of products and quantities is a shopping list owned by `customer_accounts`. A copy-a-cart-into-a-new-cart primitive was briefly flagged against §3.1a as a gap; it is withdrawn — no new `cart` command is required.
2. **Cross-store carts** — scoped to one store per the roadmap. Revisit if a tenant wants a shared basket across storefronts.
3. **Cart-level currency switching** — currently re-prices the whole cart. Whether a buyer may switch currency mid-cart at all, or must start over, is a merchandising decision. *Assumed re-price is acceptable.*
4. **Agent-authored carts** — `added_by: 'agent'` is in the model. Whether an AI-proposed line needs explicit buyer confirmation before it counts toward totals is an approval-contract question for the AI framework. *Reserved, not specified.* **Closed 2026-09-22 (rev 7):** the question dissolves rather than being answered. An unaccepted line is not in the buyer's cart at all — it is in a separate cart holding the role `proposal` (§7a) — so it cannot count toward the buyer's totals, and nothing has to decide whether it does. The alternative that was implicitly on the table, a per-line `pending` flag, would have pushed a conditional into every totals path in a module whose entire discipline is that it performs no arithmetic of its own; it would also have had to be honoured by `promotionsService` evaluation, by the `salesCalculationService` mapping and by every `nextTier` and threshold calculation, each of which is a place the flag could be forgotten. It was never an approval-contract question for the AI framework: it was a modelling question about where an unaccepted intention lives, and the same answer serves a human rep, for whom the AI framework has nothing to say.

---

## 17) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | All references are FK ids; catalog, promotions, availability, sales and groups reached through DI services |
| No reimplemented arithmetic | ADR-2 enforced; totals stored verbatim; property test gates it |
| Tenant/organization scoping | Every entity and query; cross-tenant token resolution rejected |
| Optimistic locking | `updated_at` via `enforceCommandOptimisticLock` (§8.1, fixed 2026-08-17 — no `version` counter; the platform's helper is hard-coded to timestamp comparison and cannot accept one), distinguishable re-price bumps via `versionBumpReason` |
| Command pattern | Every mutation is a registered command (§3.1a, fixed 2026-08-17 — an earlier draft described plain HTTP handlers with no command wiring at all) |
| Encryption | `email` declared in `cart/encryption.ts`'s `defaultEncryptionMaps` (`entityId: 'cart:cart'`); reads via `findWithDecryption` |
| Zod validation | All routes; `z.infer` types |
| No `any` | Service and payload contracts fully typed |
| i18n | Warning and error codes translated; no hard-coded user-facing strings |
| Rate limiting | Per token and per IP on public mutation routes |
| Queue usage | Sweepers via the `queue` worker contract, not custom timers |
| Events | `createModuleEvents`; `clientBroadcast` on line and totals events |
| Actor attribution | `added_by_actor_type`/`_id` and `merged_by_actor_type`/`_id` written from `ctx.auth`, never from request input; polymorphic across `auth.User` and `customer_accounts.CustomerUser` by FK id, with no ORM relation to either (§4.2, §4.4) |
| Staff never mutate a buyer's basket | No admin route mutates a line on a cart the principal does not own; content changes are authored as proposals and take effect on acceptance (§10.2), asserted by a route-enumeration test (§14) |
| Buyer pricing context is not the author's | A proposal cart copies the target's pricing context and re-derives it on every re-price; the author's identity never enters pricing (§7a.2, R14) |
| Backward compatibility | New module; no existing contract surface changes. `SalesDocumentKind` deliberately **not** extended. Rev 7's replacement of `added_by` and `merged_by_customer_user_id` is a breaking rename **on paper only** — `cart` has no implementation anywhere in the repository, so no deprecation protocol is triggered and no bridge is owed |
| Integration coverage | §14, shipping in the same change |

---

## 18) Changelog

### 2026-09-22 (rev 7 — the proposal seam, and a Critical in merge)

Adds the `cart` half of [Assisted Selling](./2026-09-22-assisted-selling.md) (suite spec 13, [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge)) and closes a Critical that is independent of it. Phases 1 and 2 are untouched; Phase 3 gains one correction, Phase 4 gains the seam.

**What was wrong, not merely missing:**

- **`CartLine.added_by` named a question it could not answer.** `buyer | agent | merchant | merge`, with no id anywhere on the line. The column exists precisely to record who put a line in a basket, and it could not name them — so commission attribution was impossible, and "who added this" was unanswerable in support and in audit. Replaced by `added_by_actor_type` + `added_by_actor_id` (§4.2). Adding the id beside the old column was rejected: two overlapping descriptions of one fact with no reconciling rule is the error SPEC-029 §5.1.1 already had to unwind once in this suite.
- **`CartMergeLog.outcome` recorded a disposition with nothing to join it to.** Rev 6 typed it only as "per-line disposition and reason". The log's stated purpose is provenance, and without the target line id a consumer tracing an order line back to what produced it has to guess by product identity — unsound as soon as a cart holds two lines of one product differing by `configuration_hash`. Shape fixed in §4.4.
- **`CartMergeLog.merged_by_customer_user_id` could not record a staff merge.** It is typed to `CustomerUser`, and a sales rep is an `auth.User` — a separate table with no foreign key between them, separated down to the JWT audience. Any merge performed by staff would have written NULL into the one column the log exists to populate. Replaced by `merged_by_actor_type` + `merged_by_actor_id`, plus `proposal_cart_id` (§4.4).
- **`CartMergeLog.strategy` admitted `manual` and §7.1's policy table could never produce it.** A value the model allowed and the specification could not reach. §7a.4's per-line acceptance is what reaches it, and §7.1 now carries the row.
- **§10.2 stated a prohibition with no counterpart.** "Support may inspect and force a re-price but not edit a buyer's basket" is correct and was, on its own, a dead end: it named what staff must not do and nothing about what they should. A boundary with no specified alternative is closed by whoever is under pressure first. Rewritten as a contract — staff author proposals, the buyer accepts — with the prohibition intact, an explicit statement that no such admin route exists, and a route-enumeration test so a future addition fails rather than silently reopening it.
- **§6a.4 and §7 composed into a bypass of R11, and nothing said so.** Exempt channels (`agent`, `api`) may hold any line by design; merge moves lines into an enforced storefront cart; §7.3's mandatory post-merge pass is a re-*pricing* pass and §6a.2 lists re-*visibility* against triggers 2 and 5 only, neither of which is a merge. Restricted lines therefore entered an enforced cart through an unenforced one and flowed on to `SalesOrder` — R11's exact failure text by a second route, reachable today by any caller able to create an `agent`-channel cart, with no assisted selling involved. Added §6a.5 (new **R13**, Critical) and the sentence in §6a.4 that the exemption belongs to the cart a line lives in and does not travel with the line. **Ships with Phase 3**, beside the merge it corrects.
- **The document mis-stated its own revision.** The status header read "rev 3 — sibling amendments applied" while the changelog had reached rev 6. Corrected.

**What was added:**

- §7a **Proposal Carts**: `Cart.kind: 'basket' | 'proposal'` as a **role** — `Cart.status` is unchanged and orthogonal — with `proposed_to_cart_id` and a check constraint binding the two (§4.1); pricing under the *target's* buyer context, copied at creation and re-derived on every re-price (§7a.2); expiry from a per-store TTL with the existing sweeper, and an expired proposal kept readable rather than deleted (§7a.3); the two-step `preview` → `acceptanceToken` → `accept` acceptance with per-line selection (§7a.4); and rejection that touches the target cart not at all (§7a.5).
- Acceptance **delegates to `cart.merge`** with `strategy: 'manual'` rather than reimplementing it, which is what makes the seam cost three commands instead of an entity family — `mergeSummary`, `CartMergeLog.source_snapshot`, the 15-minute `undo-merge` and the mandatory whole-cart re-price are already the behaviour a buyer accepting a suggestion needs.
- A deliberate **no**: no `CartProposal` / `CartProposalLine` family, and no fifth value on `Cart.status`. A rejected proposal is `abandoned` — the existing terminal non-converting state — and *why* it ended is metadata about a conversation, owned by `assisted_selling`.
- §10: five proposal routes, four token-bound and one — authoring — requiring an authenticated principal, which is **R15**; §10.3: `cart.proposals.author` / `.view`, with acceptance deliberately carrying no feature because a guest buyer has no ACL identity.
- §11: `cart.proposal.created/.accepted/.rejected/.expired`, signal-only and `clientBroadcast`; `triggeredBy: 'merge'` added to the existing `cart.line.visibility_rejected`; and a payload requirement on `cart.cart.converted` (`salesOrderId` + `lineMap`) that commission attribution depends on, recorded as an obligation on spec 7 rather than as new work here.
- §13: **R13** (merge admits unchecked lines, Critical), **R14** (proposal priced as its author, High), **R15** (authoring reachable by a cart token, High), **R16** (attribution forged or lost, Medium).
- §14: a merge-visibility regression suite for Phase 3 and a proposal suite for Phase 4, including the assertions that `preview` creates nothing, that a stale `acceptanceToken` cannot merge, that a body-supplied actor id is ignored, and that no admin route mutates another principal's cart.
- §16 Open Question 4 **closed** — dissolved rather than answered.

### 2026-09-16 (rev 6 — per-customer assortment overrides reach trigger 2)

Applied from [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.6/§6.2. That spec now resolves catalog visibility per customer as well as per group, and a per-customer override carries its own `valid_until` exactly as a group membership does.

- §5.2 trigger 2 and §9's restatement of it now read "buyer identity changes: login, logout, a group membership change, **or a change to that customer's own assortment override**". Without that clause the override would have been the one buyer-side change that reaches the checkout lock unchecked — R7's shape, reintroduced through a new column rather than through the original TOCTOU window. No change to §6a's check itself: it consumes a resolved `EffectiveAssortmentScope` and has never known how many sources produced it.

### 2026-09-09 (rev 5 — the per-unit discount contract stated correctly)

Rev 4's §3 rule 1 was specified against a `sales` API that does not exist. It mandated `discountAmountBasis: 'line'` and attributed the behaviour to `resolveLineDiscountTotal` in `sales/lib/calculations.ts`; neither identifier occurs anywhere in the repository. `SalesLineSnapshot` (`packages/core/src/modules/sales/lib/types.ts:35-63`) has no basis field, and `buildBaseLineResult` (`calculations.ts:80-123`) reads `discountAmount` as `discountPerUnit` and multiplies it by the line's full `quantity` unconditionally — the one basis rev 4 forbade, with no way to opt out. Followed as written, `cart` would have assigned the effect's total and discounted it `lineQuantity` times over: on SPEC-055 TC-PROM-065(a)'s figures, a 200.00 line free against an intended 40.00.

- §3 rule 1: replaced with the real contract — `discountAmount = |amount| / lineQuantity` (the line's **full** quantity, not `appliedQuantity`), with both mis-mappings and their arithmetic named, and the sub-cent rounding residual stated.
- §14: acceptance criteria restated against that mapping, the partial-coverage assertion widened from two directions to three, and the rounding gap called out against the byte-identical-totals gate.

### 2026-09-07 (rev 4 — promotion effect mapping corrected)

Applied [SPEC-055](./SPEC-055-2026-02-23-promotions-module.md) §B.6. This document previously said promotion effects "map onto adjustment drafts" wholesale — a mapping the `sales` module rejects: `SalesAdjustmentDraft` carries no line reference, and `documents.ts` throws `400 "Line-scoped adjustments are not supported yet."` when a line-attributed draft arrives. Left as written, every per-line promotion would have either failed at order creation or silently detached its discount from the line.

- §3: promotion effects now **split by target** — only `appliesTo: 'order'` effects become `SalesAdjustmentDraft`; `LINE_DISCOUNT` (targets `line` and `unit`) becomes `SalesLineSnapshot.discountAmount` on the matching line. Added the three binding rules: the per-unit amount (mis-stated here as a basis flag, corrected in rev 5), positive magnitude on a net basis with gross→net conversion, and summation of cumulative promotions into the single line scalar with attribution deferred to `PromotionUsage.effects_snapshot`.
- §14: split the promotion-adjustment acceptance criterion by target, and added the partial-coverage totals assertion (widened in rev 5) (SPEC-055 A-R6 / `TC-PROM-060`).

### 2026-09-06 (rev 3 — sibling amendments applied)

Applied the amendments [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §0 records against this document. Leaving them pending in a sibling file would have meant this spec — the one that actually owns the `cart` module, and reads as complete — specifying the write path with no visibility check at all, which is the Critical hole that document exists to close.

- Added **§6a Assortment Visibility**: the per-line check on `lines.add`/`.update`/`.bulkAdd` with a validated, storefront-required `assortmentScope` input (§6a.1); the whole-cart re-visibility pass at re-pricing triggers 2 and 5 closing the membership-lapse TOCTOU window (§6a.2); the no-enumeration-oracle rejection shape (§6a.3); and the channel-keyed exemption rule for `pos`/`pay_link`/`agent`/`api` (§6a.4).
- §9: the `active → locked` transition now runs the re-visibility pass and is **refused** while any line carries an unresolved `product_unavailable` warning — mirroring the existing `requiresApproval`-blocks-lock precedent.
- §11: added `cart.line.visibility_rejected`, operator-facing, not `clientBroadcast`.
- §13: added R11 (write path bypasses read-side visibility, **Critical**) and R12 (write-side enumeration oracle, Medium).
- §14: added the R11/R12 regression suite, including the membership-expiry-then-checkout-lock fixture.

No entity or column changes to `cart`. The new command input is an additive field on an unimplemented command signature.

### 2026-08-17 (rev 2 — pre-implementation fixes)

Fixed two Critical findings from a `/om-pre-implement-spec` audit (`ANALYSIS-2026-08-14-cart-module.md`):

- **`Cart.version: integer` removed.** The original draft carried forward SPEC-029 v3's already-superseded "version optimistic locking" reasoning instead of this platform's actual mechanism — the same mistake already made and fixed in the sibling `customer-groups-and-b2b-terms.md` spec. `packages/shared/src/lib/crud/optimistic-lock-command.ts`'s `enforceCommandOptimisticLock` is hard-coded to `updated_at`/ISO-timestamp comparison and cannot accept a generic counter. Fixed: `Cart.updatedAt` is the sole concurrency token (§4.1, §8.1); the 409 body still embeds the full current cart as an addition on top of the platform's standard conflict shape, losing no client-facing behaviour.
- **Command pattern wiring added.** The original draft described every cart mutation as a plain HTTP handler with a raw conditional SQL update — no `registerCommand`, no undo, no `withAtomicFlush`. Added §3.1a naming every mutation as a registered command, and rewrote §8.1's write flow as lock pre-check → `withAtomicFlush` → post-commit side effects, mirroring `sales/commands/documents.ts`.
- Added the missing `cart/encryption.ts` declaration backing §17's `email`-encryption claim.

### 2026-08-14
- Initial specification, replacing SPEC-029 v3 §7.4's cart-as-checkout-session model per ADR-1.
- Grounded in the implemented `sales` calculation contract: `SalesCalculationService.calculateDocumentTotals({ documentKind, lines, adjustments, context })`, with `SalesLineSnapshot` already carrying `productId`, `productVariantId`, `quantity`, `uomSnapshot`, `unitPriceNet`/`Gross`, `discountAmount`, `taxRate`, `configuration` and `promotionCode`, and `SalesAdjustmentDraft` already carrying `scope`, `promotionId` and net/gross amounts — so cart lines and promotion effects map onto the existing shapes without a parallel model.
- Chose `documentKind: 'quote'` over extending `SalesDocumentKind` (`'order' | 'quote' | 'invoice' | 'credit_memo'`), avoiding ripple into document sequences, search indexing and the documents table.
- Carried forward v3's idempotency and optimistic-locking reasoning (v3 §7.5), extending it with a distinguishable re-price version bump, which v3 did not anticipate because its cart never re-priced.
- Added the re-pricing trigger set, price-change disclosure, the merge policy with an append-only log and undo, and B2B quantity-tier behaviour — none of which existed in v3.
