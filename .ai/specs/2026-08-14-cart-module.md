# Cart Module

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 9 — Release 4 decisions applied; **Phases 1–3 implemented 2026-10-15, PR adeptofvoltron/open-mercato#15** — see §18 Changelog; Phase 4 unchanged, spec-only, not built) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 5, Phase 2 |
| **Modules** | `cart` (new) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Availability Contract](./2026-08-14-availability-contract.md), [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md) |
| **Related** | [SPEC-055 Promotions](./SPEC-055-2026-02-23-promotions-module.md), [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md), [Assisted Selling](./2026-09-22-assisted-selling.md), [ADR-1](./2026-08-14-ecommerce-suite-roadmap.md#adr-1--the-cart-is-a-module-not-a-checkout-status), [ADR-2](./2026-08-14-ecommerce-suite-roadmap.md#adr-2--cart-never-computes-tax-or-totals-itself), [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge) |
| **Release 4 decisions** | [eComm Release 4 Decisions](./analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md) D-R4-1…29 (authoritative audit trail; this revision is where they land in the spec text) |

---

## TLDR

**Key Points:**
- A channel-agnostic basket module. `Cart` and `CartLine` are first-class entities addressed by an opaque token, usable by the storefront, POS, pay links and AI purchasing agents alike. Checkout consumes a cart; it does not own one.
- **The cart does no arithmetic.** It resolves unit prices via `catalogBuyerPricingService.resolveLinePrice(...)` (rev 9 — D-R4-3), discounts via `promotionsService`, then hands `SalesLineSnapshot[]` to `salesCalculationService.calculateDocumentTotals` with `documentKind: 'quote'`. Cart totals and order totals are produced by the same code, so they cannot disagree.
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
- **(rev 9)** Scope, channel and store are never caller-supplied: a public route resolves them server-side via `storeContextService`, and request bodies are `.strict()` so a client cannot smuggle `assortmentScope`, `channel` or `storeId` into a mutation (D-R4-1, D-R4-2). This is the fix for the two Critical holes the Release 4 pre-implementation analysis found in rev 8.

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
             ├──► catalog       catalogBuyerPricingService.resolveLinePrice(...) — unit price for THIS buyer & quantity
             ├──► catalog       catalogScopedProductService.loadScopedProducts(ids, scope) — ancestor-expanded category/tag ids for the visibility check (§6a)
             ├──► promotions    promotionsService.evaluate(cart) — resolved effects
             ├──► availability  resolveAvailability(query, { moduleConfig, container }) — advisory state; shared quantity-rule derivation for §5.5
             ├──► sales         salesCalculationService.calculateDocumentTotals() — ALL arithmetic
             └──► customer_groups  resolveTerms() — tax mode, min order, approval threshold
```

**(rev 9 — D-R4-3)** `catalogBuyerPricingService` and `catalogScopedProductService` are additive services extracted from `ecommerce/lib/storefrontPricing.ts` into `catalog`, and the quantity-rule derivation is extracted from `ecommerce/lib/storefrontDetail.ts` into `availability`; `ecommerce` is refactored onto all three with no behaviour change, guarded by its existing `TC-ECOM-*` suites. This replaces rev 8's `catalogPricingService` (§3.1 S2 of the Release 4 analysis: no such sanctioned service existed — the only complete implementation was ecommerce-private) and the undefined availability-derived quantity rules of rev 8 §5.5 (S3).

`cart` has no inbound dependency. `checkout` reads it; it does not read `checkout`.

### 3.1a Commands (fixed 2026-08-17)

Every mutation is a registered command, mirroring `sales/commands/documents.ts` — this module has no exemption from root `AGENTS.md`'s "domain writes go through commands" rule, and an earlier draft of this spec had none of these, describing mutations as plain HTTP handlers instead:

```
cart.create · cart.get                                                  (rev 9 — §6a.1a; the route edge's two entry points)
cart.lines.add · cart.lines.update · cart.lines.remove · cart.lines.bulkAdd
cart.promotions.apply · cart.promotions.remove
cart.merge · cart.mergeUndo
cart.approval.request
cart.reprice
cart.lock · cart.unlock · cart.markConverted                            (rev 9 — §9, F7/C6; no public route)
cart.proposal.create · cart.proposal.accept · cart.proposal.reject      (rev 7 — §7a)
```

**(rev 9 — command undo table, F7/C6, D-R4-4).** `cart.lines.add`, `.remove`, `.bulkAdd` and `cart.merge` carry undo via `extractUndoPayload`. `cart.lines.update`, `cart.reprice`, `cart.lock`, `cart.unlock` and `cart.markConverted` are not undoable — re-pricing to a stale price, an in-flight checkout lock, or a conversion already reflected in a `SalesOrder` are none of them a state a client would ever want restored — and are documented as such rather than left silent on the question:

| Command | Undo | Reason |
|---|---|---|
| `cart.lines.add` / `.remove` / `.bulkAdd` | Yes | Reverses a buyer-visible content change |
| `cart.merge` | Yes (`cart.mergeUndo`, 15 min) | §7.2 |
| `cart.lines.update` | No | Quantity changes re-price; the "undo" a buyer wants is setting the quantity back, not a system rollback |
| `cart.reprice`, trigger-driven re-snapshots | No | Re-pricing to a stale price is never a desired restore target |
| `cart.lock` / `.unlock` | No | A lock is a checkout-session concern, not buyer content |
| `cart.markConverted` | No | Terminal; the cart becomes read-only history once a `SalesOrder` exists |

`cart.proposal.accept` **delegates to `cart.merge`**; it is not a second merge implementation. `cart.proposal.create` takes a target cart **id** (§7a.2). That delegation is the whole reason the proposal seam costs this module three commands rather than an entity family: disclosure (`mergeSummary`), reversal (`cart.mergeUndo`), the append-only pre-merge snapshot (`CartMergeLog.source_snapshot`) and the mandatory whole-cart re-price (§7.3) are already specified, already tested, and already the behaviour a buyer accepting someone else's suggestion needs.

Each command's `execute` phase runs the optimistic-lock pre-check (§8.1) before touching the entity manager, then mutates `Cart`/`CartLine`/`CartPromotionApplication` inside `withAtomicFlush(em, phases, { transaction: true, label: 'cart.<op>' })` — not a raw conditional SQL update — because the write flow (load → call `catalogBuyerPricingService.resolveLinePrice`/`promotionsService` → call `salesCalculationService.calculateDocumentTotals` → persist totals) is exactly the multi-phase "mutate → external work → mutate again" shape that helper exists to protect. Side effects (`emitCrudSideEffects`, cache invalidation, `clientBroadcast` events) fire after commit, never inside the atomic-flush block. `cart.lines.add`/`.remove` and `cart.merge` carry meaningful undo via `extractUndoPayload`; `cart.reprice` and pricing-triggered re-snapshots are not undoable (re-pricing to a stale price is not a state a client would ever want restored) and are documented as such.

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

**Promotion effects split by target**, per SPEC-055 §B.6 — they do not all become adjustment drafts. Only `appliesTo: 'order'` effects (`CART_DISCOUNT`) become `SalesAdjustmentDraft`; `DELIVERY_DISCOUNT` is excluded from cart-stage totals entirely (§6a below, C5/D-R4-14). A `LINE_DISCOUNT` becomes `SalesLineSnapshot.discountAmount` on the matching line, because `SalesAdjustmentDraft` carries no line reference and `sales` currently rejects a line-attributed draft outright (`documents.ts` — *"Line-scoped adjustments are not supported yet."*). Three rules bind this mapping, each of them a mispriced cart if broken:

1. **(rev 9 — C10/D-R4-9, replacing rev 8's per-unit-division rule).** `SalesLineSnapshot.discountAmountBasis` is set to `'line'` and `discountAmount = |amount|` — the resolved effect's net line-total discount, taken as-is, never divided by `lineQuantity` or `appliedQuantity`. `discountPercent` is never set on a promotion-sourced line (it would win over `discountAmount` per `sales/data/validators.ts:345` and silently discard the resolved amount). `buildBaseLineResult`'s basis-aware branch (`packages/core/src/modules/sales/lib/calculations.ts:97-116`, `resolveLineDiscountTotal`) consumes the line-total form directly, so a benefit covering 5 of 8 units at −2.40 (`amount: "-12.00"`) reaches `sales` as `discountAmount: 12.00, discountAmountBasis: 'line'` and the document reproduces 12.00 exactly — no per-unit re-derivation step exists to get wrong. `CartLine.discount_total_net` (§4.2) persists this figure so a re-read does not need to re-evaluate promotions to display it. Where the resolved effect does not divide evenly across units, the sub-cent question does not arise at all under the line basis; the document total is still the authoritative figure for any further rounding (e.g. tax computed on the discounted net).
2. `discountAmount` is a positive magnitude on a **net** basis; take the absolute value, and convert when the effect's `basis` is `'gross'` — mirroring `ResolvedEffect.amountNet`/`amountGross` (D-R4-10): the cart always maps `amountNet`, never derives one side from the other.
3. Several cumulative promotions on one line sum into that single scalar. Per-promotion attribution on the line does not survive; it lives in `PromotionUsage.effects_snapshot`.

SPEC-055 §B.7 defers giving `SalesAdjustmentDraft` a `lineId` to its own spec against `sales`, on blast-radius grounds — `sales` is shipped code with live orders, quotes and returns, while `cart` and `promotions` are both greenfield. This is unaffected by the C10 change above: the line-total discount still reaches `sales` through `SalesLineSnapshot.discountAmount`, not through a line-attributed adjustment draft.

**The release invariant (rev 9 — F3/D-R4-9), replacing rev 8's undefined "equals the `SalesOrder` produced."** Checkout does not exist in this release, so there is no order to compare against; the invariant is defined independently of it: *the same `SalesLineSnapshot[]` plus the same `SalesAdjustmentDraft[]` produce equal `SalesDocumentAmounts` for `documentKind: 'quote'` and `documentKind: 'order'`*, compared as 4-decimal-place numerics per key (never byte-for-byte, which JSON doubles vs `numeric(18,4)` make untestable). The Phase 2 gate (§14, §15) builds both documents from an identical snapshot set via the existing `sales` calculation path and, for the Phase 3 gate, via the existing `sales` create command against an order built from the cart's own lines — never a parallel order-creation stub.

**The cart stores the returned totals verbatim.** It does not round, re-sum or adjust them.

---

## 4) Data Models

Standard scoped columns throughout.

### 4.1 `Cart` (`carts`)

| Column | Type | Notes |
|---|---|---|
| `token_hash` | text | **(rev 9 — C13/D-R4-18, replacing rev 8's plaintext `token`).** SHA-256 (or equivalent) of the opaque, unguessable, 32+ bytes of CSPRNG entropy, base64url token. The plaintext token is returned **once**, at creation, in the response body only — never stored, logged, or re-derivable from `token_hash`. A proposal cart holds a `token_hash` only to satisfy the unique column; it is never returned by any route, command result or event, and never resolves (§8.3) |
| `store_id` | uuid, nullable | `ecommerce.EcommerceStore.id`; null for non-storefront channels; resolved server-side at the route edge, never caller-supplied (§6a.1a, D-R4-1) |
| `channel` | text | `storefront \| pos \| pay_link \| agent \| api`. **Immutable after creation (rev 9 — F2/C1/D-R4-2).** A public, unauthenticated route always creates `storefront`, bound to the store resolved from the request host; every other channel requires an authenticated principal holding an explicit feature |
| `kind` | text | `basket \| proposal`, default `basket`. A **role**, not a status — `status` (below) is unchanged and orthogonal. See §7a |
| `proposed_to_cart_id` | uuid, nullable | The basket this cart proposes into. Check constraint: NOT NULL exactly when `kind = 'proposal'`, NULL otherwise. Self-reference by FK id within one module, so §3.1's no-cross-module-ORM rule is not in play |
| `sales_channel_id` | uuid, nullable | `sales.SalesChannel.id` |
| `status` | text | `active \| locked \| converted \| abandoned \| expired \| merged` |
| `currency_code` | text | Fixed at creation |
| `locale` | text | |
| `customer_id` | uuid, nullable | `customers.CustomerEntity.id` — the identity that wins (D3/D3a, D-R4-28) |
| `customer_ids` | jsonb, nullable | **(rev 9 — W9/D-R4-28)** `string[]` snapshot of `BuyerContext.customerIds` (order-history and per-customer-limit identity is broader than the single winning `customer_id`) |
| `customer_user_id` | uuid, nullable | `customer_accounts.CustomerUser.id` |
| `customer_group_ids` | jsonb | `string[]` snapshot at last pricing, for drift detection |
| `price_kind_id` | uuid, nullable | Snapshot at last pricing |
| `tax_mode` | text | `gross \| net` |
| `email` | text, nullable | Guest identification; encrypted at rest — declared in `cart/encryption.ts`'s `defaultEncryptionMaps: [{ entityId: 'cart:cart', fields: [{ field: 'email' }] }]` (fixed 2026-08-17; an earlier draft asserted this in §17 without a backing declaration anywhere in the module) |
| `buyer_digest` | text | `StoreContext.digest` at last pricing — the drift detector; re-resolved and compared on **every** request, including GET (§5.2 trigger 2, W9) |
| `assortment_scope_hash` | text, nullable | **(rev 9 — W9)** Hash of the `EffectiveAssortmentScope` last used for the §6a visibility pass, distinct from `buyer_digest` (pricing can be stable while assortment membership lapses, and vice versa) |
| `totals` | jsonb | Verbatim `SalesDocumentCalculationResult.totals` |
| `totals_computed_at` | timestamptz | |
| `promotion_effects` | jsonb | Resolved effects from the last evaluation, for display |
| `requires_approval` | boolean | Set when gross exceeds the group threshold |
| `approval_id` | uuid, nullable | `customer_groups.CustomerPurchaseApproval.id` |
| `note` | text, nullable | Buyer-supplied; encrypted at rest alongside `email` (rev 9 — AGENTS.md free-text-about-people rule; `configuration` on `CartLine` stays plaintext because encrypting it breaks the stored `configuration_hash` generated column) |
| `metadata` | jsonb, nullable | |
| `merged_into_cart_id` | uuid, nullable | Set when `status = 'merged'` |
| `last_activity_at` | timestamptz | Drives abandonment |
| `last_price_change_at` | timestamptz, nullable | **(rev 9 — §5.3 referenced this column; rev 8 never declared it)** Set whenever a re-price populates `priceChanges` |
| `locked_at` | timestamptz, nullable | **(rev 9 — F7/C6/D-R4-4)** Set by `cart.lock` |
| `lock_expires_at` | timestamptz, nullable | **(rev 9 — F7/C6)** Lock timeout (default 30 min, §9); `release-stale-locks` clears both lock columns past this |
| `checkout_session_id` | text, nullable | **(rev 9 — F7/C6)** Opaque id supplied by the lock caller; returned in the `423 cart_locked` body (§9, §15 error catalogue) |
| `resolved_at` | timestamptz, nullable | **(rev 9 — Q6/D-R4-20, C8)** Set when a cart (basket or proposal) leaves `active` for any terminal-for-purge reason (`converted`, `abandoned` past purge-eligibility, `expired`, or — for a proposal — `merged`/`abandoned`). `purge-expired-carts` counts the 90-day retention window from this column rather than from `expires_at`, which is what makes an accepted or rejected proposal's retention well-defined (§7a.3, §12, §16 Q6) |
| `expires_at` | timestamptz | TTL |

Indexes: unique `token_hash`; `(tenant_id, customer_id, status)`; `(tenant_id, status, expires_at)` for the sweeper; `(tenant_id, status, last_activity_at)` for abandonment; `(tenant_id, status, resolved_at)` for the purge sweeper (rev 9); `(tenant_id, proposed_to_cart_id, status)` partial on `kind = 'proposal'`, which is the query behind "what has been proposed to this buyer and is still live".

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
| `discount_total_net` | numeric(16,4), nullable | **(rev 9 — F3/C10/D-R4-9)** The persisted net line-total discount mapped to `SalesLineSnapshot.discountAmount` (§3.2 rule 1); `null` when no promotion applies to the line |
| `promotion_id` | uuid, nullable | **(rev 9 — F4/C3/D-R4-7)** `promotions.Promotion.id` that produced this line, for a gift (`ADD_FREE_ITEM`) line. `null` for an ordinary purchased line |
| `origin` | text | **(rev 9 — F4/C3)** `customer \| promotion`, default `customer`. A `promotion` line is buyer-immutable (`cart.lines.update`/`.remove` on it return `409 promotion_line_immutable`; removal happens only by promotion/code removal reconciling the cart against a fresh `evaluate`), excluded from promotion eligibility (it cannot trigger or stack with the promotion that created it) but **included** in totals, and exempt from the §6a visibility check on add (its assortment is checked once, against the buyer's scope, before it is inserted — a line that would fail is never created, and the omission surfaces as a `product_unavailable` warning rather than a line) |
| `flag_state` | text, nullable | **(rev 9 — D-R4-5)** `product_unavailable \| null`. Set by the §6a.2/§6a.5 re-visibility pass; a flagged line is excluded from totals and from promotion evaluation, shown separately with a warning, and removing it never changes the price of any other line. Distinct from `availability_state` below — a flagged line failed the *assortment* check, not an *availability* check |
| `availability_state` | n/a | **(rev 9 — W14/D-R4-19, removed from rev 8).** Availability is **computed per response**, never persisted: a persisted field written on every read would bump `updated_at` on every read, 409-ing the buyer's very next write. `cartService` calls `resolveAvailability(...)` live and includes the result in `CartLineView` (§10.1); nothing here stores it |
| `configuration` | jsonb, nullable | Personalization, engraving, B2B configurator output |
| `added_by_actor_type` | text | `buyer \| rep \| ai_agent \| merge \| system` |
| `added_by_actor_id` | uuid, nullable | `auth.User.id` for `rep` and `ai_agent`, `customer_accounts.CustomerUser.id` for an identified `buyer`; NULL for a guest buyer, for `merge` and for `system`. FK id only, resolved through DI |
| `metadata` | jsonb, nullable | |
| `deleted_at` | timestamptz, nullable | **(rev 9)** Soft-delete stamp; `cart.lines.remove` sets it rather than hard-deleting, so `CartMergeLog.outcome` and `CartContext` history can still name a removed line. Every query filters `deleted_at IS NULL` except the merge-log join |

`added_by_actor_type` **replaces** rev 6's `added_by` (`buyer | agent | merchant | merge`), which carried no id at all — so no line could be attributed to a person, no commission could be computed and no audit could answer "who put this here". Two columns rather than one enum extension, because the id is the entire point. The vocabulary changed with it: `agent` → `ai_agent` (an AI agent is a principal with a row in `users` carrying `kind: 'agent'`, the platform's existing notion — not a nameless category), `merchant` → `rep` (a named salesperson, which is what the value was always used for), and `system` is new, for a line the platform authored on nobody's behalf. Adding `added_by_actor_id` beside the old column instead would have left two overlapping descriptions of the same fact with no rule reconciling them — the mistake this suite already made once and fixed in SPEC-029 §5.1.1.

**Constraint (rev 9 — W3): `UNIQUE NULLS NOT DISTINCT (cart_id, product_id, variant_id, configuration_hash, promotion_id) WHERE deleted_at IS NULL`.** Rev 8's plain `UNIQUE` admits duplicate plain lines, because Postgres treats each `NULL` in a unique index as distinct from every other `NULL` — most lines have a `null` `variant_id`. `NULLS NOT DISTINCT` (PG17 baseline; precedent in the `devices`/`availability` migrations) closes that, and adding `promotion_id` to the key is what keeps a gift line (`origin: 'promotion'`, non-null `promotion_id`) from ever merging into a paid line of the same product (F4) — the two rows differ on that column even when everything else matches. `configuration_hash` is a stored generated column over `configuration`, computed by the command and stored as a plain column (a stored *generated* column is not expressible in MikroORM) — the hash is checked at write time, the uniqueness at the database. Two identical products with different engraving are separate lines while two identical plain lines merge by quantity. A SQL-shape test asserts the constraint exists with exactly this column list.

### 4.3 `CartPromotionApplication` (`cart_promotion_applications`)

| Column | Type | Notes |
|---|---|---|
| `cart_id` | uuid | |
| `promotion_id` | uuid | `promotions.Promotion.id` |
| `code` | text, nullable | The entered code, if any |
| `code_id` | uuid, nullable | **(rev 9 — X1)** `promotions.PromotionCode.id`; aligns with SPEC-055 A.2's `codes: {id, type}[]` instead of rev 8's bare string `code` |
| `code_type` | text, nullable | **(rev 9 — X1)** Mirrors SPEC-055's code-kind enum (e.g. `single_use \| shared`) |
| `code_reservation_id` | uuid, nullable | SPEC-055 `CodeReservation.id`, keyed `(code_id, cart_id)` on the promotions side (C4/D-R4-8); released on cart expiry, abandonment, code removal or cart-side sweep, extended on activity |
| `scope` | text | `order \| line` |
| `cart_line_id` | uuid, nullable | For line scope |
| `effect` | jsonb | Resolved effect as returned by `promotionsService`, carrying both `amountNet` and `amountGross` (D-R4-10) |
| `amount_net` / `amount_gross` | numeric(16,4), nullable | |
| `applied_at` | timestamptz | |

**`CartIdempotencyKey` (`cart_idempotency_keys`) (rev 9 — §8.2, previously undeclared).**

| Column | Type | Notes |
|---|---|---|
| `cart_id` | uuid | FK → `carts` |
| `key` | text | The client-supplied `Idempotency-Key` |
| `request_digest` | text | Hash of the normalized request body, so a replayed key with a different body is detectable |
| `response_status` | integer | |
| `response_body` | jsonb | The original response envelope (§10.1), replayed verbatim |
| `created_at` | timestamptz | |

Unique `(cart_id, key)`. Swept by `expire-carts` alongside the cart it belongs to (no independent TTL — an idempotency key outlives its cart only as long as the cart does).

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
5. Checkout requests a lock (spec 7) — whole cart, mandatory, never skipped; when a tax provider is configured, the tax-providers roadmap proposes this re-price as the one that computes tax with the shipping address checkout holds (`2026-10-03-tax-providers-roadmap.md`, ADR-3, amendment 6a, §14 Q16); that is a proposal to the owners of this spec, and how the address reaches `cart.lock()` is for a later pointer, after this spec's lock amendment (whose lock input carries no address) merges
6. A promotion is applied or removed — effects only, not unit prices
7. An operator forces it through the admin cart view

It does **not** re-price on every read. A buyer refreshing the page five times sees a stable total.

### 5.3 Price change disclosure

When a re-price changes any line, the response carries a `priceChanges` array — old amount, new amount, reason, per line — and the cart records `last_price_change_at`. The client must show this; a total that changes without explanation reads as a bug or a dark pattern, and in a consumer context an undisclosed increase between basket and payment is a regulatory problem.

Re-pricing updates `updated_at` (the concurrency token, §8.1) but sets `versionBumpReason: 'repricing'` in the response, so a client that then submits its now-stale `updatedAt` gets a distinguishable answer rather than a bare conflict (R3). The distinguishing signal is response metadata attached whenever a mutation performed a repricing side effect — it works identically whether the underlying token is a timestamp or a counter, which is why dropping the `version` counter (§4.1) costs this behaviour nothing.

### 5.4 B2B quantity tiers

`catalogBuyerPricingService.resolveLinePrice(...)` is called with the line's actual quantity, so tier selection is automatic. The cart additionally exposes, per line, the next tier and the quantity needed to reach it:

```typescript
nextTier: { minQuantity: 100, unitAmount: 8.40, formatted: '8,40 zł', saving: '12%' } | null
```

This is the single highest-value B2B affordance on the read side, and it costs one extra row from a query already being made.

### 5.5 Quantity rules

`minOrderQuantity`, `maxOrderQuantity` and `quantityIncrement` come from the shared quantity-rule derivation in `availability` (rev 9 — D-R4-3/W16; extracted from `ecommerce/lib/storefrontDetail.ts` so cart and PDP cannot disagree) rather than the availability policy directly. A quantity violating an increment is **rejected with the nearest valid values offered** (`nearestValid`), not silently rounded — silent rounding on a pack-size field produces orders the buyer did not place. Below `minOrderQuantity` is rejected outright; above `maxOrderQuantity` is capped with a warning, never rejected.

---

## 6) Promotions

On every mutation that changes lines or quantities, and on code entry or removal, `cart` calls (rev 9 — X1/X2/C11/D-R4-21/D-R4-28, aligning to SPEC-055 A.2 instead of rev 8's mismatched shape):

```typescript
const effects = await promotionsService.evaluate({
  items: cart.lines.map(toPromotionCartLine),   // { lineId, productId, variantId, quantity, unitPriceNet, unitPriceGross, priceIsPromotional }
  codes: appliedCodes.map(c => ({ id: c.codeId, type: c.codeType })),   // array, never a single string (X1)
  buyer: {                                       // BuyerContext identity (D-R4-28)
    customerId,        // the winning identity (person wins, D3/D3a)
    customerIds,       // broader set for order-history and per-customer-limit rules
    customerGroupIds,
  },
  evaluatedAt: new Date().toISOString(),          // D-R4-13: date-window filtering happens at evaluation, not in the cache
})
```

`toPromotionCartLine` is defined here and sends only what the cart knows: ids, prices and quantities (`toPromotionCartContext`, undefined in rev 8, is withdrawn — there is no separate "cart context" object, just the lines and the buyer). **Context enrichment is promotions-side, in batch, from `productId`/`variantId`** (C11/D-R4-21): category, tag, producer, weight and attribute fields the cart cannot know are resolved by `promotions` via `catalogScopedProductService` and friends, not snapshotted onto `CartLine`. A field promotions cannot resolve for a given rule is `null` at evaluation time, so that rule evaluates false rather than the cart guessing; a promotion that newly becomes eligible once a field *is* resolvable (at checkout, which has more context) is disclosed through `priceChanges` with reason `promotion_newly_eligible` (§5.3). `priceIsPromotional` (D-R4-16) travels per item so a promotion can set `exclude_flags: exclude_promotional_prices` and have it enforced.

`promotions` owns the rule tree, the three-pass engine and all discount arithmetic; it returns **resolved effects**, each carrying `amountNet` and `amountGross` (D-R4-10). `cart` maps order-scope effects to `SalesAdjustmentDraft[]` and line-scope effects to `SalesLineSnapshot.discountAmount` (§3.2). The cart never computes a discount amount.

Not cached on the cart side: the rule tree depends on the entire cart composition, so any cache key would be the cart itself. (`promotions` caches the promotion *definitions*, not the evaluation result — D-R4-13.)

Code reservations (SPEC-055, amended per C4/D-R4-8) are per-cart: `reserveCode` is idempotent per `(code, cart)`, `extendReservation` keeps a reservation alive on cart activity, and release happens by `cartId` on cart expiry, abandonment or code removal — never by a shared `(code, customer)` key, which could not express two guest carts holding the same code. A reservation outliving its cart is the leak that makes single-use codes unusable; both the cart-side expiry sweeper and a promotions-side sweeper release them independently (X7).

`DELIVERY_DISCOUNT` effects are excluded from cart-stage totals (D-R4-14/C5): the cart sends `deliveryMethodCode: null, deliveryCost: null`, so no rule keyed on either ever matches, and any such effect the engine still returns is dropped before mapping, never displayed as `deferredToCheckout`. Checkout (out of scope here) re-evaluates with real delivery context.

Spec 6 aligns SPEC-055's cart interaction API to these calls.

---

## 6a) Assortment Visibility (added 2026-09-06)

Applies the amendments [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §0 records against this document. Without them, the cart is the hole in an otherwise-enforced control: `storefront-public-api.md` §3.3 gates every product-returning **read** behind `buildStorefrontProductScope`, and nothing here gated the **write**. A buyer, script or AI purchasing agent holding any product id could add a restricted product straight to a cart, and cart lines flow into `checkout` and `SalesOrder` creation per ADR-1/ADR-2 — so an invisible product was fully purchasable. That is R11 below, and it is the reason this section exists.

### 6a.1a Scope, store and channel are resolved at the route edge, never caller-supplied (rev 9 — F1/F2/C1/C2/D-R4-1/D-R4-2, replacing rev 8's caller-supplied model)

Rev 8's model had the storefront route resolve `assortmentScope` and the client-visible `channel`/`store` and pass them to the command as ordinary request fields. The Release 4 analysis found this is not a defense: `assortmentScope` is nullable (`null` reads as "unrestricted" and nothing rejected it), and nothing stopped a direct caller from choosing `channel: 'api'` on `POST /carts` to sidestep §6a entirely (F1, F2 — both **Critical**, independent of each other and of assisted selling).

**The fix moves resolution server-side, to the route edge, for every public entry point:**

- `cart.create` and `cart.get` — and every line/promotion/merge command reachable from a public route — are called from a route-edge helper that resolves `storeContextService.resolve(request)` (soft DI: no `storeContextService` registered means no storefront carts at all, a clean `503`) **before** invoking the command. The resolved `{ storeId, channel: 'storefront', assortmentScope, buyerDigest }` is passed as an **internal, branded command input** (`ResolvedCartRouteContext`, non-optional, never constructed from request JSON) — the same trust boundary shape visibility's own `EffectiveAssortmentScope` already uses.
- **Every public request body is `.strict()`** (zod), and none of them declares `assortmentScope`, `channel`, `storeId` or `salesChannelId` as a field. A client that sends one gets the ordinary zod `400 unrecognized key` — not a silently-ignored extra field, and not a value that reaches the command.
- An authenticated, feature-gated command path (§6a.4 below) is the only way to create or mutate a cart with a channel other than `storefront`; that path supplies its own trusted context, never the caller's request body.

```typescript
// api/cart/current/route.ts (route edge — not the command)
const ctx = await resolveCartRouteContext(request)   // storeContextService.resolve(request); 503 if absent
const result = await commands.run('cart.create', { routeContext: ctx })   // routeContext is internal; body carries none of it
```

```typescript
// commands/cart.ts — cart.lines.add (command, trusted input only)
async function execute({ cartId, productId, variantId, quantity, routeContext }: CartLinesAddInput) {
  const cart = await loadCart(cartId)
  if (cart.channel === 'storefront' || routeContext?.assortmentScope) {   // C2 — see §6a.1b
    const scoped = { id: product.id, categoryIds: product.categoryIds, tagIds: product.tagIds }
    if (!matchesScope(scoped, routeContext.assortmentScope)) {
      return rejectLine({ code: 'product_unavailable', lineId: existingLineId ?? null })
    }
  }
}
```

Rejection is a **non-fatal warning**, matching §10.1's existing convention for an out-of-stock line: the line is not added (or, for `.update`, the change is rejected and the line stays at its prior state), the request itself does not error, and `warnings` carries the code — which is what lets `bulkAdd` succeed partially across 50 lines.

### 6a.1b Enforcement key (rev 9 — C2/D-R4-1, resolving V1)

Rev 8 stated the enforcement condition two different ways in two places (§6a.1 keyed it on `channel === 'storefront'`; §6a.4/visibility §6.4 said "a scope is supplied"). Release 4 adopts the union: **enforce the assortment check if, and only if, the cart is `storefront` *or* a scope was resolved for this call.** In practice every `storefront` cart always has a resolved scope (§6a.1a), so the two conditions coincide for the public path; the `or` matters for a trusted in-process caller (e.g. assisted selling computing a preview) that supplies a scope against a non-`storefront` cart on purpose. A cart with neither — `pos`/`pay_link`/`agent`/`api` created through the authenticated path with no scope resolved — is exempt by §6a.4.

### 6a.1c Per-line check on add, update and bulk add

`cart.lines.add`, `cart.lines.update` and `cart.lines.bulkAdd` read `routeContext.assortmentScope` (or the trusted caller's explicit scope, §6a.1b) — never a request-body field — and run the §6a.1b check after loading the product for its existing name/sku snapshot (§4.2) and before persisting the line, exactly as the code block in §6a.1a shows.

### 6a.2 Whole-cart re-visibility pass at triggers 2 and 5

A per-line check alone leaves a time-of-check/time-of-use window: `CustomerGroupMembership.valid_until` is a first-class feature (spec 1 §5.2), so a buyer can legitimately add a Wholesale-only product while a member, have the membership lapse, and reach checkout with a line that was never re-checked.

So the re-pricing triggers in §5.2 that already run **whole-cart** carry a parallel re-*visibility* pass against the freshly-resolved scope:

- **Trigger 2** (buyer identity changes: login, logout, group membership change, per-customer assortment override change) — the case that produces the drift.
- **Trigger 5** (checkout requests a lock; "mandatory, never skipped") — the backstop.

A line that fails is **not deleted**. Deleting a buyer's line without disclosure is the failure class R2 and R4 already exist to prevent, and this does not add a third instance of it. The line is flagged `product_unavailable` in `warnings`, exactly as an out-of-stock line already is, and **the `active → locked` transition is refused while any line carries that flag** (§9) — mirroring the existing precedent that an over-`approval_required_above` cart cannot lock. The buyer removes or replaces the line, or regains access and re-triggers a re-price, before checkout proceeds.

### 6a.3 No write-side enumeration oracle

A restricted product and a nonexistent or deleted product id produce the **identical** `product_unavailable` warning — same body, same shape. This is `storefront-public-api.md` §4.2's handle-enumeration rule applied to a mutation: the read path goes to the trouble of collapsing "restricted" and "nonexistent" into one indistinguishable 404, and the write path must not hand that distinction back.

### 6a.4 Non-storefront channels are exempt by construction, and created only through an authenticated command (rev 9 — F2/C1/D-R4-2)

The visibility rule is keyed on **whether a scope was resolved**, not on an enumerated channel list: enforcement applies exactly to carts whose channel resolved a `StoreContext`, which today is `storefront` alone. `pos`, `pay_link`, `agent` and `api` carts have no channel binding and no buyer digest, so there is nothing to check against. A future channel that gains `StoreContext` resolution inherits enforcement automatically. An in-store POS sale by staff is a deliberately different trust boundary — assortment scope is a self-service merchandising control, not a sales permission.

**The companion rule rev 8 lacked (F2):** a client cannot *reach* that exemption by asking for it. `cart.create`'s public, unauthenticated path (§6a.1a) always produces a `storefront` cart bound to the host-resolved store — there is no field in any public request that selects a channel. Creating a `pos`, `pay_link`, `agent` or `api` cart requires calling `cart.create` from an **authenticated server principal** holding a channel-specific feature (`cart.channel.pos`, `cart.channel.payLink`, `cart.channel.agent`, `cart.channel.api` — `acl.ts`), supplying its own `channel`/`storeId`/`salesChannelId` as trusted command input, never from a request body reachable by an anonymous caller. `channel` is immutable once set (§4.1). A test asserts an anonymous `POST /current` with any attempt to influence the channel still yields `storefront`, and that `cart.create` called with `channel: 'api'` and no authenticated principal is rejected before a cart is ever persisted.

**The exemption is a property of the cart a line lives in, not a property that travels with the line.** §6a.5 states the consequence, and it is the reason this sentence had to be added.

### 6a.5 Merge runs a visibility pass (added 2026-09-22 — **Critical**, independent of assisted selling)

§6a.4's exemption and §7's merge compose into a bypass of R11, and rev 6 did not say so anywhere.

The composition: a cart in an exempt channel — `agent` or `api` today — may hold any line, by construction and by design. Merge then moves those lines into a `storefront`-channel cart, which *is* scope-enforced. Nothing in rev 6 re-checked them on the way in. §7.3 does mandate a whole-cart pass after a merge, but it mandates a re-***pricing*** pass, and §6a.2 lists re-***visibility*** against triggers 2 and 5 only — a merge is neither. So restricted lines entered an enforced cart through an unenforced one, and from there flowed through `checkout` into a `SalesOrder`. That is R11's exact failure text reached by a second route, and it is reachable today by any caller that can create an `agent`-channel cart, with no assisted selling involved.

**Rule.** A merge into a cart whose channel resolves a `StoreContext` runs a re-visibility pass over every incoming line against the **target** cart's freshly-resolved `EffectiveAssortmentScope`, before the lines are persisted.

**Where the scope comes from (rev 9 — D-R4-1, D-R4-22, replacing rev 8's caller-supplied model).** Exactly where §6a.1a's comes from, with one addition: the merge and lock route edges call `storeContextService.resolve(request, { fresh: true })` — an additive option (D-R4-22) that bypasses the normal 60-second resolution cache, because a merge or a checkout lock is precisely the moment a stale membership must not be trusted. Every merge into a storefront-channel target is triggered by the buyer's own storefront request — the login merge (`POST /current/merge`) and proposal acceptance (`POST /proposals/:proposalId/accept`, §7a.4) alike — and the route edge resolves fresh context for that request and passes the resolved `assortmentScope` as internal command input; `cart.merge` refuses a storefront-channel target with no resolved scope with the same `400 assortment_scope_required_for_storefront_channel`. "Freshly resolved" therefore means resolved — uncached — for the request performing the merge, which is the buyer's — never a value the proposal's author supplied at authoring time. `cart` gains no dependency on `ecommerce`. `preview` takes the scope the same way for its dry-run pass. An expiry sweeper for lapsed `customer_groups.membership.expired` rows that would otherwise only be caught on the buyer's next request is a follow-up (D-R4-22), not Release 4 scope.

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
| Guest cart empty | Keep the customer cart; the guest cart becomes `merged` into it with strategy `keep_target` and nothing moves (rev 8 — rev 7 said "discard", which set no status and emitted nothing, stranding anything keyed on the guest cart) |
| Both non-empty, disjoint lines | Union |
| Both non-empty, same product+variant+configuration | `sum` by default, capped at `maxOrderQuantity` |
| Conflict on a configured line | Keep both as separate lines |
| **Proposal accepted (§7a)** | `manual` — merge exactly the lines the buyer selected; every unselected line is recorded in `outcome` as `declined` and left in the source snapshot |

`keep_target` was in the same position until rev 8 gave the "guest cart empty" row a status and an event. `manual` was already a legal value of `CartMergeLog.strategy` in rev 6 (§4.4) and no row of this table ever produced it — a value the model admitted and the policy could not reach. §7a is what reaches it: per-line acceptance is exactly "the buyer chose which of these to take", which is what a manual strategy means and what neither `sum`, `replace` nor `keep_target` can express.

Default strategy is `sum`, configurable per store. Every merge writes a `CartMergeLog` with the full pre-merge source snapshot.

### 7.2 Disclosure and reversal

After a merge the response carries `mergeSummary` — lines added, quantities combined, anything capped, and (rev 7) anything **rejected** by the visibility pass of §6a.5 or **declined** by the buyer under the `manual` strategy. The UI must surface it. Every incoming line appears in the summary under exactly one disposition; a line that is silently absent from both the summary and the cart is the defect this rule exists to make impossible. `POST /current/undo-merge` restores the pre-merge state from the log within 15 minutes.

**Rejected alternative:** silently replacing the customer cart with the guest cart. It is the simplest rule and it deletes a basket the buyer assembled on another device, with no trace.

### 7.3 Re-pricing after merge

Mandatory and whole-cart — the buyer's group has just become known, so every line's price may change. This is exactly the case that trigger 2 exists for, and it is also the case most likely to surprise, so `priceChanges` matters most here.

Re-pricing is *not* the only whole-cart pass a merge owes: §6a.5 requires a re-visibility pass in the same operation. The two are separate concerns that happen to share a boundary, and rev 6 had only the first.

---

## 7a) Proposal Carts (added 2026-09-22 — rev 7)

The seam that lets somebody other than the buyer put a priced basket in front of the buyer, without ever touching the buyer's own. Everything about **who** is proposing, through what conversation, and with what presence disclosure belongs to [`assisted_selling`](./2026-09-22-assisted-selling.md). This section is the whole of the `cart` side.

### 7a.1 A proposal is a role, not a status

`Cart.kind = 'proposal'` with `proposed_to_cart_id` pointing at the target basket. It is an ordinary cart in every other respect: same line model, same price snapshots, same promotion evaluation, same totals through `salesCalculationService`, same limits, same TTL sweeper. `Cart.status` is untouched and orthogonal — a proposal is `active` while live, `expired` past its `expires_at`, `merged` once accepted (with `merged_into_cart_id` set to the target), and `abandoned` once rejected.

**Two lifecycle rules do not carry over, because for a proposal `abandoned` *means* rejected (rev 8).** The inactivity transition `active → abandoned` (§9) does not apply to `kind = 'proposal'` — a proposal is not a basket anyone is expected to touch, so it is always "inactive", and under the ordinary rule every live proposal would die at 24 h against a 72 h TTL without a `cart.proposal.rejected`; its only exit from `active` besides acceptance and rejection is the TTL. And `abandoned → active` on "any mutation" does not apply either: a rejection is final, and nothing can mutate a proposal cart anyway (below).

**A proposal cart is not addressable as a cart.** Its token is never issued (§4.1) and `cartService.resolveBasketByToken` resolves `kind = 'basket'` only (§8.3), so no token-bound route in §10 — lines, promotions, merge, reprice — can reach it. Independently of addressing, every line and promotion command refuses a `kind = 'proposal'` cart with `409 proposal_cart_immutable`; the only writers are `cart.proposal.*`, `cart.merge` (as the source of an acceptance), `cart.mergeUndo` and the sweepers. A published proposal is immutable: changing one is re-authoring it (assisted selling §6.4), which prices afresh.

**There is no `rejected` status and no proposal entity family.** `abandoned` is the existing terminal non-converting state and it is the accurate one; *why* a proposal ended — rejected by the buyer, withdrawn by its author, superseded by a re-authored one — is metadata about a conversation, and lives with the conversation in `assisted_selling`. Adding a fifth lifecycle to `Cart.status`, or a `CartProposal`/`CartProposalLine` pair beside `Cart`/`CartLine`, would duplicate a line model, a pricing path and a totals path that already exist and are already the ones that must produce the number the buyer pays.

### 7a.2 A proposal is priced as the buyer, never as its author

`cart.proposal.create` takes the **target cart's id** — its callers are authenticated server principals (§10), which have no business holding a buyer's credential and in assisted selling's case hold none — and the proposal cart is created carrying the target's `customer_id`, `customer_user_id`, `customer_group_ids`, `price_kind_id`, `currency_code`, `locale`, `tax_mode`, `channel`, `store_id`, `sales_channel_id` and `buyer_digest` — copied at creation and re-derived from the target on every re-price. The author's own identity, group membership and price kind never enter pricing at any point.

This is not a convenience. A rep resolving `catalogBuyerPricingService.resolveLinePrice(...)` under their own context, or an AI agent under a service principal's, produces a proposal the buyer accepts at a price the buyer will not be charged: the mandatory post-merge re-price (§7.3) then corrects it, and `priceChanges` discloses a rise the buyer never agreed to. The pricing context is a property of the basket being proposed *into*, and copying it at the seam is what makes that true by construction rather than by discipline. ADR-7 and ADR-9 are the suite-level statements of the same rule.

Because the proposal cart carries the target's `channel`, a proposal against a storefront basket is itself scope-enforced: §6a.1b's enforcement key applies to `cart.proposal.create` exactly as it applies to `cart.lines.add`, and §6a.5's pass at the merge boundary is the backstop rather than the only control. The scope passed to `cart.proposal.create` MUST be the **target buyer's**, resolved on the server — assisted selling does so through `storeContextService.resolveForBuyer` (its §6.3), as an internal, trusted argument, never a value its own request body carries — but `cart` does not have to trust that: `preview` and `accept` re-check every line against the scope of the buyer's own request, freshly resolved (§6a.5, D-R4-22).

### 7a.3 Expiry

`expires_at` on a proposal cart is set from the owning store's proposal TTL (default 72 h, configurable) rather than from the normal cart TTL, and the existing `expire-carts` sweeper (§12) retires it. An expired proposal is **not deleted** by expiry: it stays readable, so the buyer and the author see the same history of the conversation, and so a rejected-or-lapsed suggestion remains attributable — until the retention purge of §12, whose rule for proposal carts is §16 Q6. Re-proposing an expired basket is a new proposal cart, freshly priced — never a revival of the old one, whose snapshots are by then exactly as stale as the TTL says.

### 7a.4 Acceptance is a two-step merge

Acceptance never happens in one call, because the price the buyer saw in the proposal and the price the buyer will pay after the merge are resolved at different moments, and `cart` is the module that refuses to let those two differ silently (R4).

```
POST /api/cart/proposals/:proposalId/preview        buyer's basket token in the X-Cart-Token header
     → re-prices the proposal against the target's CURRENT buyer context,
       runs the §6a.5 visibility pass in dry-run,
       CREATES NOTHING,
       returns { acceptancePreview, acceptanceToken }      acceptanceToken TTL 15 min

POST /api/cart/proposals/:proposalId/accept         buyer's basket token in the X-Cart-Token header
     body: { acceptanceToken, lines: [{ proposalLineId, accepted: boolean }] }
     → re-resolves; if anything moved since the token was issued, 409 `proposal_changed`
       with a fresh preview and a fresh token
     → otherwise delegates to cart.merge { strategy: 'manual' }
```

**Addressed by id, authorised by the basket (rev 8).** Rev 7 put the buyer's token *and* a second, proposal-cart token in the path, which contradicted §8.3 twice over and handed the buyer a credential for the proposal cart itself — with nothing stopping it being used on the line routes to edit the author's priced proposal. Now the only credential is the buyer's own basket token, presented as every other token in this suite is; the proposal is named by id, and the route answers `404` unless that proposal's `proposed_to_cart_id` is the presented token's basket — the same `404` a nonexistent id gets, so ids cannot be probed across baskets.

`acceptancePreview` carries, per line, the proposed unit price, the price re-resolved now, the delta, and any `product_unavailable` rejection — the same disclosure vocabulary `priceChanges` and `mergeSummary` already use, so a client has one parser rather than three.

The token binds the target cart's `updatedAt` **and** the proposal cart's `updatedAt`. Either moving invalidates it. This is the shape [`storefront-customer-account.md`](./2026-08-14-storefront-customer-account.md) §7.3 already fixed for shopping-list conversion — "create NOTHING; return the preview and a short-lived `resolutionToken` … a buyer must never accept difference set A and receive cart B" — and the failure it prevents is identical here. It composes with, rather than replaces, §8.1's optimistic lock on the target cart.

`lines` is what makes the `manual` strategy of §7.1 reachable: the buyer takes two of five suggestions and the other three are recorded as `declined`, not deleted and not quietly merged.

A target cart in `locked` status refuses acceptance with `423 Locked` and the checkout session id, per §9 — the buyer is mid-checkout and the basket is not theirs to change at that moment either.

### 7a.5 Rejection

`cart.proposal.reject` sets the proposal cart to `abandoned` and releases any promotion code reservations it held (§6). It touches the target cart not at all — there is nothing to undo, because nothing was ever merged. This asymmetry with acceptance is the point of the whole design: **the cheap operation is the one that changes nothing.**

### 7a.6 What this module does not own

The thread, its participants and their presence; the message bodies; who may author a proposal and under which store mode; the AI agent, its tools and its budget; commission attribution after conversion. All of it is [`assisted_selling`](./2026-09-22-assisted-selling.md). `cart` never learns that a conversation exists: it has no `thread_id` column, no inbound dependency, and no knowledge of why a proposal was authored — consistent with §3.1's "`cart` has no inbound dependency".

### 7a.7 Undoing an acceptance (rev 8)

`POST /current/undo-merge` on a merge whose `CartMergeLog.proposal_cart_id` is set restores the target exactly as for any merge (§7.2), and additionally returns the proposal cart from `merged` to `active` — or to `expired` when its `expires_at` passed in the meantime — clearing `merged_into_cart_id`. It then emits `cart.proposal.acceptance_undone` (§11). Rev 7 promised that an undone acceptance "restores the proposal", and emitted nothing that would let the owner of the proposal's lifecycle learn it had happened.

A reopened proposal is acceptable again through a fresh `preview`; the consumed `acceptanceToken` stays consumed.

---

## 8) Concurrency & Idempotency

### 8.1 Optimistic locking (fixed 2026-08-17 — see §4.1)

Every mutating command starts with `enforceCommandOptimisticLock({ resourceKind: 'cart.cart', resourceId: cart.id, current: cart.updatedAt, request: ctx.request })` (`packages/shared/src/lib/crud/optimistic-lock-command.ts`) — the same mechanism every other command-driven write in this platform uses, not a bespoke conditional SQL update. The client sends its expected `updatedAt` via the standard `x-om-ext-optimistic-lock-expected-updated-at` header (or as a typed `updatedAt` field on the mutation body); the helper throws a `409` with the platform's standard `{ error, code, currentUpdatedAt, expectedUpdatedAt }` body on mismatch — the same shape every other conflict-bar-integrated surface in the admin UI already understands.

**Cart adds one thing on top, not instead of, that mechanism**: the `409` response body also embeds the full current `CartView` (§10.1) alongside the standard fields, so the client can reconcile without a second round trip — this was always additive to the platform's own conflict contract, never a reason to bypass it.

The lock check runs before any entity manager work; the entity mutations themselves run inside `withAtomicFlush(em, phases, { transaction: true, label: 'cart.<op>' })` (§3.1a) — not a raw SQL `UPDATE ... WHERE`, because the write flow interleaves external service calls (`catalogBuyerPricingService.resolveLinePrice`, `promotionsService`, `salesCalculationService`) with entity mutations, which is exactly the "mutate → external work → mutate again" shape `withAtomicFlush` exists to protect against a dropped scalar update.

### 8.2 Idempotency

Mutations accept an `Idempotency-Key`. A repeated key within the cart's lifetime returns the original result without re-applying — this is what makes "add to cart" safe under a double-tap or a retried request on a flaky mobile connection. The idempotency lookup precedes the §8.1 optimistic-lock check (clarified 2026-09-30): a retry of a mutation that landed but lost its response carries the pre-mutation `updatedAt`, so a lock check that ran first would answer it with a `409` against the cart the original request itself changed.

Keys are stored per cart with the resulting `updatedAt` and a response digest. A key replayed with a different body returns `422 idempotency_key_mismatch`.

### 8.3 Token security

The token is the only credential for an anonymous cart. Therefore: 32+ bytes of CSPRNG entropy; never in a URL path that could land in a referrer or a log (it is the `X-Cart-Token` header — §10, Q5 closed); rotated on merge **and on adoption** (§7.1, first row) so a guest token cannot address the customer's cart afterwards; and rate-limited per token to blunt enumeration (§15a).

**Only `token_hash` is persisted (rev 9 — C13/D-R4-18, replacing rev 8's plaintext `token` column, §4.1).** The plaintext token is returned exactly once, in the `POST /current` response body, and never again — not in any later `GET`, not in an event, not in a log line. Every subsequent request re-hashes the presented header value and looks up `token_hash`; a leaked log or database row contains no usable credential. This removes the "dummy-token wart" rev 8 carried for proposal carts (§4.1): a proposal's `token_hash` column is satisfied by a hash of a token that is never generated as a real secret, same as before, but now there is no plaintext anywhere to leak either way.

Token resolution is one DI-exposed function, `cartService.resolveBasketByToken(token, scope)`, tenant-scoped and restricted to `kind = 'basket'` — used by every token-bound route here and by consumers such as assisted selling, which resolve a buyer's token to a basket id instead of storing the token or a hash of it. A consumer keyed on the cart id is unaffected by rotation by construction.

**Q5 resolved (rev 9 — C7/D-R4-6).** Rev 8 left the basket routes carrying `:token` in the path, contradicting this section, with the fix deferred to Q5. Nothing is implemented, so the fix is free now: every basket route moves to `/api/cart/current/*`, credentialed by the `X-Cart-Token` header alone (§10). No route in this module accepts a token in a path segment or a query string, asserted by test.

---

## 9) Lifecycle

```
active ──lock (checkout)──► locked ──submit──► converted
  │                            │
  │                            └──unlock/timeout──► active
  ├──inactivity────────────► abandoned ──buyer returns──► active
  ├──TTL──────────────────► expired
  └──login merge, or proposal acceptance (source side)──► merged

  kind = 'proposal':  active ──accept──► merged ──undo──► active | expired
                        ├──reject──► abandoned        (final)
                        └──TTL─────► expired          (no inactivity abandonment)
```

| Transition | Rule |
|---|---|
| `active → locked` | **(rev 9 — F7/C6/D-R4-4)** `cartService.lock` / command `cart.lock`, called by `checkout` (no public route in Release 4); forces a whole-cart re-price **and a whole-cart re-visibility pass with a freshly-resolved buyer context** (§6a.2, §6a.5, D-R4-22) first; **refused with `409 cart_has_unavailable_lines` while any line carries a `flag_state`**; sets `locked_at`, `lock_expires_at` and the caller-supplied `checkout_session_id`; rejects mutation while locked |
| `locked → active` | `cartService.unlock` (command `cart.unlock`), explicit, or a lock timeout (default 30 min) clearing `locked_at`/`lock_expires_at` |
| `locked → converted` | **(rev 9 — F7/C6)** `cartService.markConverted` (command `cart.markConverted`), called by `checkout` once a `SalesOrder` exists; terminal — no command mutates a `converted` cart; sets `resolved_at` (§4.1, D-R4-20) |
| `active → abandoned` | Baskets: no activity for 24 h (configurable); emits an event for recovery flows. Proposals: only by `cart.proposal.reject` (§7a.5) |
| `abandoned → active` | Baskets only: any mutation; extends `expires_at`. Never for a proposal (§7a.1) |
| `active → expired` | `expires_at` reached (default 30 days for identified buyers, 7 for guests); releases promotion code reservations |
| `* → merged` | Login merge, or the source side of a proposal acceptance; `merged_into_cart_id` set |
| `merged → active \| expired` | Proposals only: `undo-merge` of their acceptance within 15 min (§7a.7) |

A `locked` cart that a client tries to mutate returns `423 Locked` with the checkout session id, not a generic error — the client needs to know to send the buyer back to checkout.

---

## 10) API Contracts

**Base `/api/cart`, basket routes header-bound at `/api/cart/current/*` (rev 9 — C7/D-R4-6, §16 Q5 closed, replacing rev 8's `:token` path segment).** The credential is the `X-Cart-Token` header alone — never a path segment, never a query string, never a cookie the platform reads itself (the storefront app owns an httpOnly cookie and forwards it as this header). Every request body is `.strict()` and carries no `assortmentScope`, `channel`, `storeId` or `salesChannelId` field (§6a.1a) — scope, store and channel are resolved from `storeContextService` at the route edge, not from the body. Every mutating route accepts the expected `updatedAt` (via the standard optimistic-lock header or a typed body field — §8.1) and `Idempotency-Key`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/current` | Create; returns the plaintext token **once** + `updatedAt`. Anonymous → `storefront`, bound to the host-resolved store (§6a.4) |
| GET | `/current` | Read; re-prices only if stale (trigger 4) or the buyer digest changed (W9) |
| PATCH | `/current` | Email, note, locale, currency |
| POST | `/current/lines` | Add line |
| PATCH | `/current/lines/[lineId]` | Change quantity or configuration |
| DELETE | `/current/lines/[lineId]` | Remove line |
| POST | `/current/lines/bulk` | Batch add — reorder, quick-order pad, agent proposals |
| POST | `/current/promotions` | Apply code |
| DELETE | `/current/promotions/[id]` | Remove |
| POST | `/current/merge` | Merge a guest cart into the session's cart; resolves the target's scope **fresh** (D-R4-22) |
| POST | `/current/undo-merge` | Reverse within 15 min |
| POST | `/current/reprice` | Force re-price |
| POST | `/current/request-approval` | B2B; creates a `CustomerPurchaseApproval` |
| GET | `/proposals` | Live proposals addressed to the presented token's basket, newest first (§7a). Token in header |
| POST | `/proposals` | Author a proposal; body names `targetCartId`. `cart.proposals.author`; **no** cart token at all — see below |
| POST | `/proposals/:proposalId/preview` | Pre-flight re-price + dry-run visibility pass; creates nothing; returns `acceptancePreview` + `acceptanceToken`. Token in header |
| POST | `/proposals/:proposalId/accept` | Per-line acceptance; delegates to `cart.merge` with `strategy: 'manual'`. Token in header |
| POST | `/proposals/:proposalId/reject` | Terminal; touches the target cart not at all. Token in header |

`cart.lock`/`.unlock`/`.markConverted` have **no public route** in Release 4 (F7/C6) — `checkout` calls the DI service/command directly, in-process.

**Authoring is the one route on this base path that a cart token cannot reach.** The proposal routes (rev 8) are addressed by proposal id with the buyer's basket token in the `X-Cart-Token` header, never the path (§7a.4, §8.3). `GET`, `preview`, `accept` and `reject` are token-bound like the rest of `/api/cart`, because they are the buyer acting on their own basket and a guest buyer has no session to present. `POST /proposals` is the opposite: it is somebody *other* than the buyer writing, so it requires an authenticated principal holding `cart.proposals.author` — a staff `auth.User`, or an AI agent principal (`users.kind = 'agent'`). It takes the target as `targetCartId` and accepts no cart token. Letting a leaked cart token author proposals into its own cart would hand an attacker a way to put priced lines in front of a buyer under the store's own branding, which is R15.

Admin keeps `/api/cart/carts` and `/api/cart/carts/[id]` (Phase 4, §10.2) — a distinct dynamic-segment name from the public `/current` base, so the two never collide in one Next.js route tree (this was rev 8's W2/§9 concern under the old `:token` shape; it does not arise under `/current`).

`/current/lines/bulk` exists because B2B quick-order pads and agent proposals add 50 lines at once, and 50 sequential mutations means 50 promotion evaluations and 50 version conflicts.

### 10.1 Response

Every endpoint returns the same envelope, so a client has one parser:

```typescript
{
  cart: {
    token?: string   // rev 9 — present ONLY on the POST /current creation response; every other response omits it (§8.3, C13)
    updatedAt: string; status: CartStatus
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
'cart.cart.created' | '.updated' | '.expired' | '.abandoned' | '.merged' | '.adopted' | '.converted' | '.purged'
'cart.line.added' | '.updated' | '.removed'
'cart.promotion.applied' | '.removed' | '.no_longer_valid'
'cart.price.changed'          // payload: per-line old/new and reason
'cart.approval.requested'
'cart.lock.acquired' | '.released' | '.timed_out'
'cart.line.visibility_rejected'   // added 2026-09-06 — §6a
'cart.proposal.created' | '.accepted' | '.rejected' | '.expired'   // added 2026-09-22 — §7a
'cart.proposal.acceptance_undone'                                   // added 2026-09-27 — §7a.7
```

**(rev 9 — D-R4-23).** `cart.line.visibility_rejected` is emitted **once per request**, carrying `{ cartId, tenantId, organizationId, productId: string | null, variantId: string | null, rejectedCount, reason: 'not_in_assortment', triggeredBy: 'add' | 'update' | 'bulkAdd' | 'merge' | 'reprice' | 'checkout_lock' }` — never once per line, which rev 8 implied for a multi-line `bulkAdd` or merge rejection. `tenantId`/`organizationId` are explicit on the payload rather than assumed from context, so an operator dashboard can aggregate across tenants without a join. It is emitted by every enforcement point (§6a.1a–c, §6a.2, §6a.5). It is **not** `clientBroadcast` — the buyer already sees the `product_unavailable` warning in the response body; this is the operator-facing signal, so a merchant who narrows a group's `assortment_scope` too far, or misconfigures a channel's `require_authentication`, sees a trend instead of scattered support tickets. Same reasoning as `availability.shortfall.detected` and `customer_groups.credit.limit_exceeded`.

The four lifecycle `cart.proposal.*` events carry `{ proposalCartId, targetCartId, authoredByActorType, authoredByActorId, lineCount }`, and `.accepted` additionally carries `mergeLogId` and `acceptedLineCount`. `cart.proposal.acceptance_undone` (rev 8, §7a.7) carries `{ proposalCartId, targetCartId, mergeLogId, proposalCartStatus: 'active' | 'expired' }`. They are `clientBroadcast: true` so a rep's console reflects a buyer's decision without polling, and — once the transport of [`assisted_selling`](./2026-09-22-assisted-selling.md) exists — they are the events its buyer-facing bridge relays. Like every other broadcast event in this platform they are a **signal, not a payload**: the recipient re-reads state through the API. They deliberately carry no line, price or total.

`cart.cart.converted` gains a payload requirement in rev 7, because commission attribution depends on it: it MUST carry `salesOrderId` and `lineMap: Array<{ cartLineId, salesOrderLineId }>`. Whoever creates the order from the cart holds that mapping at creation time — it is the same ordered traversal that builds `SalesLineSnapshot[]` — so this records an obligation on spec 7 (checkout) rather than inventing new work. Where `lineMap` is absent, a consumer degrades to order-level attribution and says so; it never guesses the mapping from product identity, because a cart may legitimately hold two lines of the same product with different `configuration_hash`.

`cart.line.visibility_rejected`'s `triggeredBy` enum gains `'merge'` (§6a.5) — an additional value on an existing event, not a new event.

**Lifecycle payloads (rev 8).** Rev 7 had consumers subscribing to `cart.cart.merged` with no payload defined. Signal-only, like everything else here — ids, never a token:

| Event | Payload |
|---|---|
| `cart.cart.merged` | `{ sourceCartId, targetCartId, kind: 'basket' \| 'proposal', mergeLogId, strategy, proposalCartId: string \| null, customerId, customerUserId }` — `kind` is the **source** cart's, so a consumer tracking baskets filters out proposal acceptances |
| `cart.cart.adopted` | `{ cartId, customerId, customerUserId }` — new: §7.1's "customer cart empty" row re-owns the guest cart and rotates its token without merging anything, and rev 7 emitted nothing for it |
| `cart.cart.purged` | `{ cartId, kind, proposedToCartId: string \| null }` — new: emitted per cart by `purge-expired-carts`, so a consumer holding a cart id learns it no longer resolves |

`cart.cart.abandoned` is emitted for baskets only; a proposal's rejection is `cart.proposal.rejected`.

`cart.cart.abandoned` is the hook for recovery flows (out of scope here). `cart.price.changed` feeds analytics on how often snapshots go stale, which is how the staleness budget gets tuned with evidence.

`clientBroadcast: true` on line and totals events so a second tab updates via the DOM Event Bridge instead of polling.

---

## 12) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `mark-abandoned-carts` | every 15 min | `active` → `abandoned` past the inactivity window. `kind = 'basket'` only — a proposal is never abandoned by inactivity (§7a.1) |
| `expire-carts` | hourly | Expire past TTL; release promotion code reservations. The expiry path for proposals, at their own `expires_at` (§7a.3); emits `cart.proposal.expired` for them |
| `release-stale-locks` | every 5 min | `locked` → `active` past the lock timeout |
| `purge-expired-carts` | daily | Hard-delete carts expired more than 90 days ago, retaining the merge log; emits `cart.cart.purged` per cart. For proposal carts the rule is §16 Q6 |

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
| R11 | Write path bypasses read-side assortment visibility | **Critical** | `cart` | A product hidden from browsing is still purchasable: a buyer, script or AI agent holding a product id (a stale link, a scraped sitemap, an id from an unrelated source) `POST`s it to `/api/cart/current/lines`, and the line flows through `checkout` into a `SalesOrder`. A read-side 404 that a cart mutation ignores is a suggestion, not a control; and (rev 9) a caller-supplied scope field is itself an attack surface — a client sending `assortmentScope: null` or `channel: 'api'` must not be able to opt out. | §6a.1a–c: scope, channel and store are resolved server-side at the route edge from `storeContextService`, never accepted from the request body (`.strict()` schemas reject the field outright); `lines.add`/`.update`/`.bulkAdd` enforce whenever the cart is `storefront` **or** a scope was resolved (§6a.1b); §6a.2's whole-cart pass at triggers 2 and 5 closes the time-of-check/time-of-use window a lapsing membership opens, with the checkout lock refused while a line is flagged | Low once shipped — the residual is a future cart mutation forgetting the same check, mitigated by §6a.4's channel-keyed rule rather than an enumerated list |
| R12 | Write-side rejection becomes its own enumeration oracle | Medium | `cart` | A distinguishable "restricted" vs "not found" response lets a script map a private assortment through cart-add attempts — the write-side analogue of `storefront-public-api.md` R4. | §6a.3: identical `product_unavailable` warning for both cases, asserted by test | Low |
| R13 | Merge admits lines that never passed an assortment check | **Critical** | `cart` | §6a.4 exempts channels that resolve no `StoreContext` — today `agent` and `api`. A caller creates an `agent`-channel cart holding a restricted product, merges it into the buyer's storefront cart, and the line reaches `checkout` and `SalesOrder` having never been checked. §7.3's post-merge pass is a re-*pricing* pass; §6a.2 lists re-*visibility* against triggers 2 and 5 only, and a merge is neither. Reachable with no assisted selling involved. | §6a.5: a merge into a scope-resolving cart runs the visibility pass over every incoming line against the **target's** freshly-resolved scope, reports failures in `mergeSummary` and `CartMergeLog.outcome`, and neither admits nor deletes them. Ships with **Phase 3**, beside the merge it corrects | Low once shipped — residual is a future merge-like path forgetting the pass, mitigated by keying the rule on the target cart rather than on an enumerated source channel |
| R14 | Proposal priced as its author rather than as the buyer | **High** | `cart`, legal | A rep on a staff price kind, or an AI agent running under a service principal, authors a proposal; `catalogBuyerPricingService.resolveLinePrice(...)` resolves against the author's context. The buyer accepts 84,00 zł, the mandatory post-merge re-price (§7.3) corrects it to 129,00 zł, and `priceChanges` discloses an increase the buyer never agreed to — an undisclosed-increase complaint dressed up as a disclosure. Worse in B2B, where the two contexts differ by a negotiated contract rather than by a rounding. | §7a.2: the proposal cart copies the **target's** pricing context (`customer_group_ids`, `price_kind_id`, `currency_code`, `tax_mode`, `buyer_digest`, `channel`) at creation and re-derives it from the target on every re-price; the author's identity never enters pricing. Asserted by a test that authors as a rep on a different price kind and compares against the buyer's own resolution | Low |
| R15 | Proposal authoring reachable by a cart token | **High** | `cart` | Every other route on `/api/cart` is token-bound, so authoring is written the same way by symmetry. A leaked token (R6) then lets an attacker inject priced lines into the buyer's own proposal tray, rendered in the store's branding and one click from the basket — phishing with the merchant's trust behind it. | §10: `POST /proposals` requires an authenticated principal holding `cart.proposals.author` and accepts no cart token and is the single route on this base path a token alone cannot reach; accept/reject/preview stay token-bound because there the token holder *is* the buyer. Asserted by a test that presents a valid cart token with no principal and expects `401` | Low |
| R16 | Actor attribution lost or unverifiable | Medium | `cart` | `added_by_actor_id` is written from request input rather than from the authenticated principal, so a caller attributes a line to another rep — or the column is left NULL on a path nobody remembered, and commission silently under-reports. | `added_by_actor_type`/`_id` are set by the command from `ctx.auth`, never from the request body, and are non-nullable for `rep`/`ai_agent`; a test asserts a body-supplied actor id is ignored. `CartMergeLog` records the merging actor with the same rule | Low |

---

## 14) Integration Coverage

**Gate re-cut (rev 9 — W13/D-R4-29), replacing rev 8's inconsistent Phase 1/2 split:**
- **Phase 1 gate:** line CRUD, snapshotting, the R1 assortment-visibility suite (built into the first line command, §6a), idempotency, concurrency, and the four sweepers.
- **Phase 2 gate:** triggers 1–4 and 7 each verified in isolation (no other action re-prices), quantity tiers and `nextTier`, quantity rules, and the totals-equivalence property test **without promotions**.
- **Phase 3 gate:** triggers 5 and 6, the R13 merge-visibility suite, promotions integration (code application, reservations), the lock/convert surface, the totals-equivalence property test **with promotions** (built via the existing `sales` create command against an order from the cart's own lines), and the P95 ≤ 150 ms benchmark at 200 promotions × 50 lines.

**Totals correctness (`TC-CART-TOT-*`, Phase 2 gate without promotions / Phase 3 gate with promotions):**
- `TC-CART-TOT-01` Cart totals (`documentKind: 'quote'`) equal the totals of an order (`documentKind: 'order'`) built from the identical `SalesLineSnapshot[]` + adjustments, across a tax matrix including compound rates, mixed rates within a cart, and rounding boundaries, compared as 4 dp numerics per key (R1, F3)
- `TC-CART-TOT-02` Totals stored verbatim; no re-rounding on read
- `TC-CART-TOT-03` Order-scope promotion effects reach `salesCalculationService` as `SalesAdjustmentDraft`; line-scope effects reach it as `SalesLineSnapshot.discountAmount` with `discountAmountBasis: 'line'` carrying the resolved effect's net total **as-is**, never divided (SPEC-055 §B.6, C10/D-R4-9 — replacing rev 8's per-unit-division rule)
- `TC-CART-TOT-04` Assigning the old per-unit mapping (`|amount| / lineQuantity`) or the raw gross `amount` instead of the net line-total both fail this test, so neither rev-8 mis-mapping can silently regress (SPEC-055 A-R6 / `TC-PROM-060`)
- `TC-CART-TOT-05` A non-dividing quantity (a property-test generator, not a fixed fixture) still produces equal totals under the line-basis mapping, over the tax matrix, with and without promotions (replaces rev 8's "partial coverage" assertion, which only made sense under the withdrawn per-unit rule)

**Pricing (`TC-CART-PRICE-*`, Phase 2 gate):**
- `TC-CART-PRICE-01` Snapshot stable across repeated reads within the staleness budget; two GETs inside the budget leave `updated_at` unchanged (W14)
- `TC-CART-PRICE-02` Each of the seven triggers re-prices, and no other action does
- `TC-CART-PRICE-03` Crossing a `min_quantity` boundary re-prices that line only
- `TC-CART-PRICE-04` `nextTier` correct, absent at the top tier
- `TC-CART-PRICE-05` Personal customer price beats group price beats channel default
- `TC-CART-PRICE-06` `price_row_id` names the winning row
- `TC-CART-PRICE-07` `priceChanges` populated on every change, absent otherwise (R4); a digest mismatch (buyer context changed) fires on a GET, not only a mutation (W9)
- `TC-CART-PRICE-08` Availability is never persisted: a line's `availability_state` in the response reflects a live `resolveAvailability` call on every read, and no column is written by a read (W14)

**Concurrency & idempotency (`TC-CART-CONC-*`, Phase 1 gate):**
- `TC-CART-CONC-01` Two clients presenting the same `updatedAt`: one succeeds, one gets 409 (standard `enforceCommandOptimisticLock` body) with the current cart additionally embedded
- `TC-CART-CONC-02` Repeated `Idempotency-Key` returns the original result without re-applying; the lookup precedes the optimistic-lock check (§8.2)
- `TC-CART-CONC-03` Same key with a different body returns 422
- `TC-CART-CONC-04` Re-pricing bump carries `versionBumpReason: 'repricing'` (R3)
- `TC-CART-CONC-05` 20 parallel add-line calls yield a consistent final quantity

**Merge (`TC-CART-MERGE-*`, Phase 3 gate):**
- `TC-CART-MERGE-01` All six §7.1 situations, including the `manual` row added in rev 7
- `TC-CART-MERGE-02` `CartMergeLog` captures the full pre-merge source
- `TC-CART-MERGE-03` `undo-merge` restores within 15 minutes, refuses after
- `TC-CART-MERGE-04` Post-merge re-price applied and disclosed, using a **freshly resolved** buyer context (D-R4-22), not the 60 s cache
- `TC-CART-MERGE-05` Token rotated; the old guest token no longer resolves (R6)

**B2B (`TC-CART-B2B-*`, Phase 2 gate):**
- `TC-CART-B2B-01` Quantity increment violation rejected with nearest valid values (R9), via the shared `availability` derivation (D-R4-3)
- `TC-CART-B2B-02` Below `minOrderQuantity` rejected; above `maxOrderQuantity` capped with a warning
- `TC-CART-B2B-03` Over `approval_required_above` sets `requiresApproval` and blocks the checkout lock
- `TC-CART-B2B-04` Net tax mode from group terms reflected in totals

**Assortment visibility (R11/R12 regression suite, §6a) — `TC-CART-R1-*`, Phase 1 gate, built into the first line command:**
- `TC-CART-R1-01` `lines.add` on a `storefront` cart with a restricted product: rejected with `product_unavailable`; totals unaffected
- `TC-CART-R1-02` `lines.add` with a request body carrying `assortmentScope: null`, or any value at all, for `assortmentScope`/`channel`/`storeId`: `400` (zod `.strict()` unrecognized-key rejection) before the command runs — body-supplied scope can never substitute for the route-edge resolution
- `TC-CART-R1-03` `POST /current` (anonymous) with `channel: 'api'` in the body: `400`, and the cart that would have been rejected is never persisted
- `TC-CART-R1-04` `lines.bulkAdd` mixing visible and restricted products: visible ones added, restricted ones reported per-line in `warnings`, no whole-batch failure
- `TC-CART-R1-05` `lines.update` on a line whose product has since become restricted: rejected, the existing line untouched and **not** deleted, `lineId` populated in the warning
- `TC-CART-R1-06` `pos`/`pay_link`/`agent`/`api` carts created via the authenticated path: no assortment check, no rejection regardless of storefront assortment status (§6a.4)
- `TC-CART-R1-07` **The TOCTOU fixture:** add a line while the buyer is a member of a scoped group, expire the membership, request the checkout lock (trigger 5) — the lock is refused while the line is flagged, and the line is still present
- `TC-CART-R1-08` A membership change mid-session (trigger 2) runs the same whole-cart pass without waiting for checkout
- `TC-CART-R1-09` A restricted and a nonexistent product id produce identical `lines.add` responses in body and timing (R12)
- `TC-CART-R1-10` `cart.line.visibility_rejected` emitted once per request, with the correct `rejectedCount` and `triggeredBy`, from every enforcement point (§6a.1a–c, §6a.2)
- `TC-CART-R1-11` An anonymous caller presenting a valid cart token cannot create a non-`storefront` cart, mutate `channel`, or supply a scope through any request field on any route (F1/F2 regression, §6a.1a/§6a.4)

**Merge visibility (R13 regression suite, §6a.5) — `TC-CART-R13-*`, Phase 3 gate:**
- `TC-CART-R13-01` A line added in an exempt-channel cart (`agent`, `api`) that is outside the target's assortment is **rejected** on merge into a storefront cart: absent from the target, present in `mergeSummary` with `disposition: 'rejected'`, present in `CartMergeLog.outcome`, and still present in `source_snapshot`
- `TC-CART-R13-02` The same merge leaves visible lines unaffected — a partial rejection is never a whole-merge failure
- `TC-CART-R13-03` `undo-merge` after a partially-rejected merge restores the pre-merge target exactly
- `TC-CART-R13-04` Every incoming line appears in `mergeSummary` under exactly one disposition; a fixture asserts no line is absent from both the summary and the cart
- `TC-CART-R13-05` Every `outcome` entry names its `targetLineId` when the disposition produced a line, and `null` when it did not; a merge that sums two lines of one product with different `configuration_hash` maps each source line to the correct distinct target
- `TC-CART-R13-06` `cart.line.visibility_rejected` emitted with `triggeredBy: 'merge'`
- `TC-CART-R13-07` A merge into a `pos`/`pay_link` target runs no pass and rejects nothing (§6a.4 unchanged)
- `TC-CART-R13-08` The merge resolves the target's scope **fresh** (`{ fresh: true }`, D-R4-22), not from the 60 s cache, so a membership that lapsed moments before the merge is still caught

**Promotions and lock integration (`TC-CART-PROM-*`, Phase 3 gate):**
- `TC-CART-PROM-01` A gift (`ADD_FREE_ITEM`) line is created with `origin: 'promotion'` and `promotion_id` set, is included in totals, excluded from eligibility, and cannot be edited or removed by the buyer (`409 promotion_line_immutable`) — only reconciled by a fresh `evaluate` on promotion/code removal
- `TC-CART-PROM-02` A gift that fails the buyer's assortment is never inserted and yields a `product_unavailable` warning instead of a line (D-R4-7)
- `TC-CART-PROM-03` Two carts holding the same code each get an independent `CodeReservation` (`code_id, cart_id`); releasing one does not release the other (D-R4-8/F5)
- `TC-CART-PROM-04` A reservation extends on cart activity and is released by `cartId` on cart expiry, abandonment or code removal; a lapsed reservation emits `cart.promotion.no_longer_valid` with a warning
- `TC-CART-PROM-05` `DELIVERY_DISCOUNT` effects never reach cart totals; the cart never sends a delivery method or cost (F6/D-R4-14)
- `TC-CART-PROM-06` `cartService.lock` forces a re-price and the §6a.2 visibility pass first, and refuses with `409 cart_has_unavailable_lines` while any line is flagged (F7/C6/D-R4-4)
- `TC-CART-PROM-07` P95 ≤ 150 ms evaluating 200 promotions × 50 lines (R5/X6, pinned at 200 per C11/D-R4-21, benchmarked here rather than at "≥ 100")

**Proposals (§7a) — Phase 4, unchanged by Release 4:**
- `cart.proposal.create` against a target on a different price kind produces line prices byte-identical to the target buyer's own resolution, not the author's (R14)
- A proposal against a storefront target requires a resolved scope and rejects a restricted product at authoring time, per §6a.1b (never a caller-supplied body field, §6a.1a)
- `preview` and `accept` re-check every line against the freshly-resolved scope of the buyer's own request, and refuse a storefront target without one (`400`); a scope narrowed after authoring still rejects the line (§6a.5, D-R4-22)
- `POST /proposals` with a valid cart token and no authenticated principal returns `401`; with a principal lacking `cart.proposals.author`, `403` (R15)
- A proposal cart's token appears in no response or event, and resolving it through any token-bound route returns `404`; every line and promotion command refuses a `kind = 'proposal'` cart with `409 proposal_cart_immutable` (rev 8)
- `preview`/`accept`/`reject` for a proposal addressed to a different basket than the presented token's return the same `404` as a nonexistent id; no proposal route accepts a token in the path
- A live proposal is not marked `abandoned` by `mark-abandoned-carts` past the inactivity window, and emits no `cart.proposal.rejected`; a rejected proposal never returns to `active`
- Adoption rotates the token and emits `cart.cart.adopted`; a merge emits `cart.cart.merged` with `kind` of the source, and a proposal acceptance's merge event carries `kind: 'proposal'`
- `preview` creates nothing: no cart, no line, no merge log, asserted by row counts before and after
- `accept` with a stale `acceptanceToken` returns `409 proposal_changed` carrying a fresh preview and a fresh token, and merges nothing
- `accept` with a token whose target `updatedAt` moved, and separately whose proposal `updatedAt` moved, both `409`
- `acceptanceToken` expires after 15 minutes and is single-use
- Per-line acceptance merges exactly the selected lines; unselected lines are recorded `declined` and are neither merged nor deleted; `CartMergeLog.strategy` is `manual`
- Acceptance re-prices whole-cart and discloses `priceChanges` alongside `mergeSummary` in one response
- `undo-merge` reverses an acceptance within 15 minutes, restores the proposal to `active` when it has not yet expired (else `expired`), and emits `cart.proposal.acceptance_undone` exactly once with that status
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

**Rev 9 re-cuts the Phase 1–3 gates (W13/D-R4-29) to match where the Release 4 analysis actually exercises each risk.** Rev 8 had the totals-equivalence property test gate Phase 1 while promotions (the thing most likely to break it) integrate in Phase 3, and listed "each trigger in isolation" as a Phase 2 gate that silently included triggers 5 and 6, which do not exist until Phase 3. The three gates below are self-consistent; the full test-ID list is §14.

**File manifest** (`packages/core/src/modules/cart/`): `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `di.ts`, `encryption.ts`; `data/{entities,validators}.ts`; `commands/{lines,cart,promotions,merge,lock}.ts`; `lib/{cartService,reprice,triggers,quantityRules,mergePolicy,tokens,idempotency,toSalesSnapshots,toPromotionContext,routeContext}.ts`; `api/cart/current/**`, `api/cart/proposals/**`, `api/openapi.ts`; `workers/*.ts`; `migrations/`; `i18n/{de,en,es,ko,pl}.json`; `__integration__/TC-CART-*.spec.ts`; `__tests__/` (totals and scoped-product property tests). `index.ts` declares `requires: catalog, sales, customer_groups` (promotions added when Phase 3 lands; ecommerce soft).

**Migration note (D-R4-19/D-R4-20):** the Phase 1 migration includes every Phase-4-seam column up front — `Cart.kind` (default `basket`) + `proposed_to_cart_id` with its check constraint, `CartLine.added_by_actor_type`/`_id`, `CartMergeLog.merged_by_actor_type`/`_id` + `proposal_cart_id`, and `Cart.resolved_at` — because adding them later, once baskets exist, is a second migration against a live table for no benefit; every basket-only query filters `kind = 'basket'` from Phase 1 on, and a non-basket cart is refused with `409 proposal_cart_immutable` by every line/promotion command from Phase 1 on, even though nothing produces a `kind = 'proposal'` cart before Phase 4. `token_hash` (not plaintext `token`) and the absence of `availability_state`/`availability_checked_at` columns (W14) are Phase 1 migration facts, not later cleanup.

### Phase 1 — Core cart, with visibility built into the first line command
Entities (including every Phase-4-seam column per the migration note above), `token_hash` generation, line CRUD, snapshots, `salesCalculationService` totals, optimistic locking, idempotency (`CartIdempotencyKey`), the §6a.1a–c server-derived visibility check on every line command, TTL and all four sweepers.

**Gate:** `TC-CART-R1-*` (the full assortment-visibility suite, attacking the HTTP surface per F1/F2, not only the command) and `TC-CART-CONC-*` pass. No storefront add-to-cart path ships before this gate.

### Phase 2 — Pricing behaviour
Triggers 1–4 and 7, `priceChanges` disclosure, quantity tiers and `nextTier`, quantity rules (via the shared `availability` derivation, D-R4-3), availability advisory computed per response (never persisted, W14), the totals-equivalence property test **without promotions**.

**Gate:** `TC-CART-PRICE-*`, `TC-CART-B2B-*` and `TC-CART-TOT-01/02/04/05` (the promotion-effect assertions in `TC-CART-TOT-03` gate here only insofar as "no promotion effect" is itself a case of the property test) pass; each trigger verified in isolation; no re-price outside the seven-trigger set.

### Phase 3 — Promotions, merge, lock and the release gate
`promotionsService` integration (§6, code application and per-cart reservations, D-R4-8), triggers 5 and 6, merge policy, `CartMergeLog` with its polymorphic actor, undo, **the merge-time re-visibility pass of §6a.5**, and the lock/convert surface (`cartService.lock/unlock/markConverted`, F7/C6).

§6a.5 sits here rather than in Phase 4 because it corrects merge, not proposals: the defect it closes (R13) exists the moment merge exists, independently of whether assisted selling is ever built. Deferring it would ship this phase with a documented Critical and would let the suite's Phase 1 gate — which already requires the cart-side assortment check — pass over a route that defeats it.

**Gate:** `TC-CART-MERGE-*`, `TC-CART-R13-*`, `TC-CART-PROM-*` pass; merge covers the five login situations with a restorable log (the sixth, proposal acceptance, gates in Phase 4); reservations released on expiry; a restricted line merged from an exempt-channel cart is rejected, disclosed and recoverable, never silently admitted and never silently dropped; `TC-CART-TOT-01` passes **with** promotions, built through the existing `sales` create command against an order from the cart's own lines; the P95 ≤ 150 ms benchmark passes at 200 promotions × 50 lines. This is the Release 4 completion gate for `cart`.

### Phase 4 — B2B and admin (out of Release 4 scope)
Approval routing, bulk lines, admin cart list, abandonment events, **and the whole proposal seam (§7a)**: the `manual` merge strategy, the three `cart.proposal.*` commands, the five proposal routes, the `cart.proposal.*` events including `.acceptance_undone`, the proposal exemptions in the sweepers, and `cart.cart.adopted` / `.purged`. (`Cart.kind` / `proposed_to_cart_id` and `CartLine.added_by_actor_*` already exist from the Phase 1 migration, per D-R4-19.)

**Gate:** an over-threshold cart cannot lock until approved; a 100-line bulk add evaluates promotions once; a proposal authored by a rep on a different price kind prices identically to the buyer's own resolution; `preview` creates nothing and a stale `acceptanceToken` cannot merge.

---

## 15a) Error Codes and Rate Limits (rev 9 — previously undeclared)

### Error-code catalogue

| Code | HTTP | Meaning |
|---|---|---|
| `product_unavailable` | 200 (warning) | §6a — restricted or nonexistent product; never distinguishable (§6a.3) |
| `quantity_increment_violation` | 422 | Carries `nearestValid` (§5.5) |
| `quantity_below_min` | 422 | |
| `quantity_capped` | 200 (warning) | Above `maxOrderQuantity`, capped rather than rejected |
| `cart_locked` | 423 | Carries `checkoutSessionId` (§9) |
| `cart_has_unavailable_lines` | 409 | `cart.lock` refused while a line is flagged (F7) |
| `cart_not_active` | 409 | **(rev 9 — F15)** A write was attempted against a non-active cart (merged/expired/abandoned/converted); the response carries the cart's actual `status` |
| `idempotency_key_mismatch` | 422 | §8.2 |
| `promotion_line_immutable` | 409 | A buyer attempted to edit/remove a gift line (F4) |
| `proposal_cart_immutable` | 409 | A line/promotion command targeted a `kind = 'proposal'` cart (§7a.1) |
| `assortment_scope_required_for_storefront_channel` | 400 | No `StoreContext` resolved for a route that needs one (§6a.1a) — never caused by a missing *request field* in rev 9, only by `storeContextService` itself failing to resolve |
| `proposal_changed` | 409 | Stale `acceptanceToken` (§7a.4) |
| `code_reservation_unavailable` | 409 | Budget or per-customer limit exhausted (D-R4-8/D-R4-12) |

### Rate limits

Via the shared `ratelimit` module (`checkRateLimit`, `readEndpointRateLimitConfig`), env prefix `CART_*`, per cart token **and** per IP:

| Scope | Default |
|---|---|
| `CART_CREATE` | 20 / min / IP |
| `CART_MUTATE` (lines, promotions, merge, reprice) | 60 / min / token |
| `CART_READ` | 120 / min / token |

---

## 16) Open Questions

1. **Saved carts / multiple named carts** — B2B buyers maintain recurring order templates. The model supports it (a `name` column and a `saved` status), but the UX belongs to spec 9. *Deferred; not built speculatively.* **Closed 2026-09-16:** spec 9 split the two meanings that "template" conflated — a parked basket is a saved cart, resumed once (and merged via the existing `cart.merge`/`cart.mergeUndo` when the buyer already holds one), while a reusable named set of products and quantities is a shopping list owned by `customer_accounts`. A copy-a-cart-into-a-new-cart primitive was briefly flagged against §3.1a as a gap; it is withdrawn — no new `cart` command is required.
2. **Cross-store carts** — scoped to one store per the roadmap. Revisit if a tenant wants a shared basket across storefronts.
3. **Cart-level currency switching** — currently re-prices the whole cart. Whether a buyer may switch currency mid-cart at all, or must start over, is a merchandising decision. *Assumed re-price is acceptable.*
4. **Agent-authored carts** — `added_by: 'agent'` is in the model. Whether an AI-proposed line needs explicit buyer confirmation before it counts toward totals is an approval-contract question for the AI framework. *Reserved, not specified.* **Closed 2026-09-22 (rev 7):** the question dissolves rather than being answered. An unaccepted line is not in the buyer's cart at all — it is in a separate cart holding the role `proposal` (§7a) — so it cannot count toward the buyer's totals, and nothing has to decide whether it does. The alternative that was implicitly on the table, a per-line `pending` flag, would have pushed a conditional into every totals path in a module whose entire discipline is that it performs no arithmetic of its own; it would also have had to be honoured by `promotionsService` evaluation, by the `salesCalculationService` mapping and by every `nextTier` and threshold calculation, each of which is a place the flag could be forgotten. It was never an approval-contract question for the AI framework: it was a modelling question about where an unaccepted intention lives, and the same answer serves a human rep, for whom the AI framework has nothing to say.
5. **The cart token in `/carts/:token/...` paths** (raised 2026-09-27). **Closed 2026-10-14 (rev 9 — C7/D-R4-6).** Moved to a header-bound `/api/cart/current/*` shape before Phase 1 (§10, §8.3): the only credential is `X-Cart-Token`; the platform does not read a cookie for it — the storefront app owns an httpOnly cookie and forwards the header itself (CSRF boundary stays with the storefront). `POST /current` returns the token once in the body. Admin keeps `/carts` and `/carts/:id` (Phase 4), so there is no path collision with the public routes. Nothing is implemented, so the change was free; `storefront-app.md` is the consumer that must call the new shape.
6. **Retention of resolved proposal carts** (raised 2026-09-27). **Closed 2026-10-14 (rev 9 — C8/D-R4-20).** Adopted the stated default: proposal carts follow the 90-day purge, counted from `resolved_at` (§4.1) rather than `expires_at` — which is what makes an accepted or rejected proposal's retention well-defined, since `resolved_at` is set at resolution (acceptance, rejection or expiry) while `expires_at` is set at creation. Each purge emits `cart.cart.purged` so assisted selling can render "details purged" on a surviving metadata row; accepted lines survive in `CartMergeLog.source_snapshot`, which the purge already retains. The only Release 4 obligation this closes with is the `resolved_at` column landing in the Phase 1 migration (D-R4-19); the purge sweeper's proposal-aware behaviour is Phase 4 work, same as the rest of the proposal seam.

---

## 16a) Migration & Backward Compatibility (rev 9 — previously missing, per the Release 4 analysis §2)

`cart` is greenfield: no implementation exists anywhere in the repository, so no deprecation protocol is triggered and no bridge is owed for any rename this revision makes.

- **Module id.** `cart` stays singular (C9/D-R4-17) — a recorded exception to the root `AGENTS.md` "modules plural" rule, alongside the existing `ecommerce` and `checkout` exceptions. Frozen on first release.
- **Contract freeze.** Every `cart.*` event id, every `/api/cart/*` route, every table name, every ACL feature id and every DI key this spec names becomes **STABLE** per `BACKWARD_COMPATIBILITY.md` the moment Phase 1 ships. The additive DI keys this release also mints on `catalog` (`catalogBuyerPricingService`, `catalogScopedProductService`) and `availability` (the quantity-rule derivation) are **ADDITIVE-ONLY** and were called out to the owner as a multi-module change (D-R4-3) before this revision landed — the owner's approval is recorded there, not re-requested here.
- **Rev 6/7/8 renames are breaking on paper only.** `added_by` → `added_by_actor_type`/`_id`, `merged_by_customer_user_id` → `merged_by_actor_type`/`_id`, and this revision's `token` → `token_hash` and `assortmentScope`-as-body-field → route-edge resolution are all renames of a column or a contract shape that has never shipped. No migration bridges any of them; the Phase 1 migration simply creates the final shape directly.
- **ADR-1/ADR-2 continuity.** This revision withdraws no architectural decision SPEC-029 v3's cart-as-session model made obsolete; ADR-1 (cart is a module, not a checkout status) and ADR-2 (cart never computes totals) are unaffected by Release 4.
- **SPEC-055 namespace.** The promotions calls in §6 already assume SPEC-055's current (post-namespace-move) module layout; no bridge is needed because `cart` has never called the old layout.
- **Generated registries.** `yarn generate` after Phase 1 lands; `apps/mercato/src/modules.ts` gains `cart` and `promotions` only at Step 7.8, kept commented out in the `create-app` template per the D22 precedent (`yarn template:sync:fix`).

---

## 17) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | All references are FK ids; catalog, promotions, availability, sales and groups reached through DI services |
| No reimplemented arithmetic | ADR-2 enforced; totals stored verbatim; property test gates it |
| Tenant/organization scoping | Every entity and query; cross-tenant token resolution rejected |
| Optimistic locking | `updated_at` via `enforceCommandOptimisticLock` (§8.1, fixed 2026-08-17 — no `version` counter; the platform's helper is hard-coded to timestamp comparison and cannot accept one), distinguishable re-price bumps via `versionBumpReason` |
| Command pattern | Every mutation is a registered command (§3.1a, fixed 2026-08-17 — an earlier draft described plain HTTP handlers with no command wiring at all) |
| Scope/channel/store never caller-supplied | **(rev 9 — F1/F2/D-R4-1/D-R4-2)** Resolved server-side at the route edge via `storeContextService`; public request bodies are `.strict()` and declare no such field (§6a.1a) |
| Trust boundaries | Public routes resolve `storeContextService` soft-DI at the edge; a missing registration yields no storefront carts, never an unchecked write (§6a.1a) |
| Bearer credential at rest | Only `token_hash` is persisted; the plaintext token is shown once, at creation (§4.1, §8.3, C13/D-R4-18) |
| Encryption | `email` and `note` declared in `cart/encryption.ts`'s `defaultEncryptionMaps` (`entityId: 'cart:cart'`); reads via `findWithDecryption`; `configuration` stays plaintext because encrypting it breaks the stored `configuration_hash` generated column |
| Zod validation | All routes; `.strict()` on every public body (§6a.1a); `z.infer` types |
| No `any` | Service and payload contracts fully typed |
| i18n | Warning and error codes translated (§15a catalogue); no hard-coded user-facing strings |
| Rate limiting | Per token and per IP on public mutation routes, via the shared `ratelimit` module, env prefix `CART_*` (§15a) |
| Queue usage | Sweepers via the `queue` worker contract, not custom timers; registered through `schedulerService` in `onTenantCreated` and an Upgrade Action (W6) |
| Events | `createModuleEvents`; `clientBroadcast` on line and totals events; `cart.line.visibility_rejected` once per request, never `clientBroadcast` (D-R4-23) |
| Actor attribution | `added_by_actor_type`/`_id` and `merged_by_actor_type`/`_id` written from `ctx.auth`, never from request input; polymorphic across `auth.User` and `customer_accounts.CustomerUser` by FK id, with no ORM relation to either (§4.2, §4.4) |
| Staff never mutate a buyer's basket | No admin route mutates a line on a cart the principal does not own; content changes are authored as proposals and take effect on acceptance (§10.2), asserted by a route-enumeration test (§14) |
| Buyer pricing context is not the author's | A proposal cart copies the target's pricing context and re-derives it on every re-price; the author's identity never enters pricing (§7a.2, R14) |
| Backward compatibility | New module; no existing contract surface changes. `SalesDocumentKind` deliberately **not** extended. Rev 7's replacement of `added_by` and `merged_by_customer_user_id` is a breaking rename **on paper only** — `cart` has no implementation anywhere in the repository, so no deprecation protocol is triggered and no bridge is owed |
| Integration coverage | §14, shipping in the same change |

---

## 18) Changelog

### 2026-10-16 (Phase 8 manual-QA fixes — F14, F12, CONC-05, F10, F15, F13)

Fixes for `cart` findings from the PR's two manual-QA rounds (`#issuecomment-6217199918`, `#issuecomment-6217322094`), tracked step-by-step in `.ai/runs/2026-10-14-ecommerce-release-4-write-side/{PLAN,HANDOFF,NOTIFY}.md` Phase 8. Each fix shipped with its own regression test against the live repro from the QA comment.

- **F14 (Step 8.1, commit `d7e9118b44`)**: `fetchLinePriceRows` (`lib/reprice.ts`) matched a line's variant price rows with `{ $or: [{ product }, { variant }] }`, so a variant line could pick up a sibling variant's price row (both carry the same `product_id`). Narrowed to the variant's own rows (`variant_id IS NULL OR variant_id = line.variantId`), shared with `commands/lines.ts`'s identical existing rule rather than duplicating it a third time.
- **F12 (Step 8.2, commit `c5be747249`)**: `cart.lines.add`/`.update`/`.remove`/`.bulkAdd` only ever touched the one line they mutated and never re-ran promotions or recomputed `Cart.totals` — see §4.1's `Cart` entity note above and `cart/AGENTS.md`'s Key Entities section for the corrected, current behavior (totals are now live after every accepted write, reusing `cart.reprice`'s own promotions-effects + totals phases). Undo handlers for all three now dispatch `cart.reprice` (trigger `'undo'`) so a reversed line mutation restores `Cart.totals` too, not just the line.
- **CONC-05 (Step 8.3, already landed pre-Phase-8 via commit `dd0747db83`)**: `cart.lines.add`'s merge-by-quantity race (no lock spanning the read-decide-write sequence) is closed by a per-cart `pg_advisory_xact_lock` held for the whole `withAtomicFlush({transaction:true})` block in both `addLineCommand` and `bulkAddLinesCommand`. `TC-CART-CONC-05` is un-skipped and passes against live Postgres (20 concurrent adds → exactly 1 line at quantity 20).
- **F10 (Step 8.4, commit `30090ba149`)**: `CartView.promotions` was `never[]`/hardcoded `[]`. Implemented §10.1's `AppliedPromotionView[]` from `CartPromotionApplication` rows (promotion id/name, code string if any, scope, `amountNet`/`amountGross`, `cartLineId` for line-scoped effects) — enough for a client to list applied promotions and call `DELETE /current/promotions/{promotionId}` by the listed id.
- **F15/F13 (Step 8.5, commit `cb1cdd3ab4`)**: a write against a non-active cart (merged/expired/abandoned/converted) returned a generic `404` this spec never documented for that case — now a distinguishable `409 cart_not_active` carrying the cart's real `status` (new §15a row above); `GET` is unaffected (still `200` with the status disclosed). Every storefront-facing `warnings[].message` used to carry a raw `[internal]`-prefixed placeholder — now resolved through `cart.warnings.*` i18n keys (`lib/warningMessages.ts`), five locales, shared across `lib/cartView.ts` and all six `/current/*` route files.

Validation evidence: full `cart`+`promotions` jest suite 466/466 at Checkpoint 4 (up from 419 at the start of Phase 8); live `cart/__integration__/` Playwright re-run recorded in `checkpoint-5-checks.md` under the same run folder.

### 2026-10-16 (Step 8.11 — the 3.4 Part A repoint closed as a permanent exemption, not a deferral)

Closes the open item the 2026-10-15 entry below flagged ("An owner decision... is still open"). Owner decision (`.ai/runs/2026-10-14-ecommerce-release-4-write-side/PLAN.md` Phase 8 intro, 2026-10-16): `ecommerce/lib/storefrontPricing.ts` stays on its own batched `resolveStorefrontPrices` path **permanently** and is not repointed onto `catalogBuyerPricingService.resolveLinePrice` — the repoint was implemented, tested, and found to regress the Storefront Public API's documented O(1)-queries-per-page invariant (measured: listing query-budget tests 15→21, detail 7-11→16-34, the "doesn't grow with variant count" test 9→28; full detail in NOTIFY.md's 2026-10-15T00:30:00Z entry). Documented in both files' own header comments plus a one-line cross-reference in `catalog/AGENTS.md`'s new "Buyer-facing line pricing" note. Guarded by a new equivalence test, `ecommerce/lib/__tests__/storefrontPricingEquivalence.test.ts`, asserting the two pricing paths resolve the SAME unit price for a base/regular row, a sale-kind row, a quantity-tier row, a customer-group row, and the F14 two-variant scenario (each variant resolving its own price, never a sibling's) — all 6 cases confirmed equivalent on this pass; no divergence found.

### 2026-10-15 (Phases 1–3 implemented — PR #15)

Implementation record for rev 9: `cart` Phases 1–3 shipped on `feat/release-4-write-side` (`adeptofvoltron/open-mercato#15`), tracked step-by-step in `.ai/runs/2026-10-14-ecommerce-release-4-write-side/{PLAN,HANDOFF,NOTIFY}.md`. Per PLAN.md's own Step 7.7 instruction, this spec stays in `.ai/specs/` (not moved to `implemented/`) — Phase 4 (B2B approvals, bulk lines, the admin cart list, the proposal seam §7a) remains unbuilt. Deviations and findings a future reader should know about without re-reading the run's 56 steps:

- `toPromotionCartContext` (this document's own §6 rename target) shipped as `toPromotionCartLine` + a new `buildPromotionsEffectsPhase`, both in `cart/lib/promotionContext.ts` — confirms the rename this revision already called for.
- §15a's error-code catalogue is missing two codes the implementation needed and now emits: `cart_merge_scope_mismatch` (400 — `cart.merge` rejecting a cross-store/cross-currency merge, the "same store and currency only" scope qualifier §7.1 names) and `merge_undo_window_expired` (409 — `cart.mergeUndo` past the 15-minute window). Add both to §15a in the next content revision.
- §6a.2's whole-cart re-visibility pass (named in `lib/visibility.ts`'s own header comment since Phase 1) was never actually built until Step 7.4 of the implementation — closed then, gated on `trigger === 'buyer_context_changed'` and extended to also run on `trigger === 'merge'` (closing an ADOPT-merge gap the implementing agent itself flagged) and `trigger === 'lock'` (wired at Step 7.5). §6a.5's merge-time pass (R13, Critical) shipped the same step as the §6a.2 fix, not earlier.
- **Open item, not fixed**: `cart.lines.add`'s merge-by-quantity path has no row lock and no unique-violation retry — 20 concurrent adds of the same product either `500` or silently lose quantity, reproduced against real Postgres. Tracked as CONC-05; regression test is `test.skip()` in `cart/__integration__/TC-CART-CONC-01-05-concurrency-idempotency.spec.ts` with the root cause documented inline. A fix needs a pessimistic lock (or a cart-aggregate lock) spanning the read and the command's `withAtomicFlush` phases.
- **Open item, not fixed**: a real currency/locale change through the storefront route always also changes the buyer digest (`ecommerce/lib/buyerContext.ts`'s digest formula embeds both `currencyCode` and `effectiveLocale`), so `detectCartRepriceTrigger`'s precedence resolves the disclosed reason to `buyer_context_changed`, never `currency_changed`/`locale_changed` — and `applyCartRepriceTriggerFields` then never syncs `Cart.currencyCode`/`Cart.locale`, since it only writes the fields belonging to the specific winning reason. `lib/triggers.ts`'s own doc comment ("identical no matter which reason wins") is contradicted for currency/locale drift specifically. Fix: sync `currencyCode`/`locale` from the fresh context whenever trigger 2 or 3 fires, not only when one is the labeled winner.
- **Open item, not fixed** (affects this spec's own §3.1/F8 dependency): `catalogBuyerPricingService.resolveLinePrice` (the §3.1 extraction) is built per-line with no shared-cache/batch mode, so `ecommerce/lib/storefrontPricing.ts` was NOT repointed onto it — doing so regressed the Storefront Public API's own documented O(1)-query-budget invariant. `ecommerce` keeps its own, separate pricing resolution for now. An owner decision (extend `catalogBuyerPricingService` with a page-batch mode, or treat `storefrontPricing.ts` as permanently exempt from this repoint) is still open.
- `priceIsPromotional` is wired into `toPromotionCartLine` but hardcoded `false` — nothing upstream (`catalogBuyerPricingService`/`ResolvedLinePrice`) populates the signal yet, so D-R4-16's field exists on the wire without real data behind it.

Validation evidence at completion: 178 `cart` jest tests; 26 passed / 1 skipped (CONC-05) / 0 failed across the full `cart/__integration__/` Playwright suite; P95 = 1.035ms against the 150ms budget (Step 7.6, "the Release 4 completion gate for `cart`").

### 2026-10-14 (rev 9 — eComm Release 4 decisions applied)

Applies every owner decision in [eComm Release 4 Decisions](./analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md) D-R4-1…29 (C1–C14 of the cart pre-implementation analysis) ahead of Phases 1–3 implementation. No change to the domain model's core shape; every change below closes a Critical, a missing section, or a cross-spec mismatch the analysis found.

- **F1/F2 (Critical) closed — scope, channel and store are server-derived, never caller-supplied (§6a.1a–c, §6a.4, D-R4-1, D-R4-2).** Replaces rev 8's model where a public route passed `assortmentScope`/`channel`/`store` through as ordinary, nullable request fields. Public request bodies are now `.strict()`; a client cannot send `assortmentScope: null` or `channel: 'api'` to bypass the visibility check or the channel exemption.
- **F3 (Critical) closed — the release invariant is defined, and the discount mapping is corrected (§3.2, §14, C10, D-R4-9).** `discountAmountBasis: 'line'` with the resolved effect's net total taken as-is (never `|amount| / lineQuantity`), persisted as `CartLine.discount_total_net`. The invariant compares `quote` vs `order` `SalesDocumentAmounts` as 4 dp numerics, built via the existing `sales` commands — there is no `SalesOrder` to compare against in this release's checkout-free scope, so rev 8's "equals the order produced" is replaced with this definition.
- **F4 (Critical) closed — gift lines are representable (§4.2, C3, D-R4-7).** `CartLine.promotion_id` + `origin` added to the data model and to the unique index (now `UNIQUE NULLS NOT DISTINCT`, W3), so a gift line can never merge into a paid line.
- **F5 closed — reservation ownership moves to SPEC-055 (C4, D-R4-8).** Recorded here as the cart-side contract (`code_id`/`code_type` on `CartPromotionApplication`, §4.3); the entity change itself ships in the SPEC-055 amendment.
- **F6 closed — `DELIVERY_DISCOUNT` excluded from cart-stage totals (§6, §3.2, C5, D-R4-14).**
- **F7 (Critical) closed — the lock/convert surface is specified (§3.1a, §9, §10, C6, D-R4-4).** `cartService.lock/unlock/markConverted`, DI + commands, no public route; `lock` forces a re-price and a fresh re-visibility pass and refuses with `409 cart_has_unavailable_lines`.
- **F8 closed — sanctioned pricing/scoped-product/quantity-rule services (§3.1, C12, D-R4-3, owner-approved multi-module change).** `catalogBuyerPricingService`, `catalogScopedProductService` (additive, `catalog`), shared quantity-rule derivation (additive, `availability`); `ecommerce` repointed with no behaviour change.
- **§4.1 `Cart`:** `token` → `token_hash` (C13/D-R4-18); added `locked_at`, `lock_expires_at`, `checkout_session_id` (F7), `resolved_at` (Q6/D-R4-20), `last_price_change_at` (previously referenced in §5.3 but never declared), `customer_ids`, `assortment_scope_hash` (W9).
- **§4.2 `CartLine`:** added `discount_total_net`, `promotion_id`, `origin`, `flag_state` (D-R4-5 — a flagged line is excluded from totals and promotion evaluation, shown separately), `deleted_at`; removed the persisted `availability_state`/`availability_checked_at` columns (W14/D-R4-19 — computed per response, never persisted, so a read can never bump `updated_at` into a false 409).
- **§4.3 `CartIdempotencyKey` declared** (previously referenced in §8.2 with no entity).
- **§6 reconciled with SPEC-055 A.2 (X1, X2, C11, D-R4-21, D-R4-28):** `codes` is an array of `{id, type}`, never a bare string; `buyer` carries `BuyerContext` identity; context enrichment (category, tag, attribute fields) happens promotions-side, in batch, from `productId`/`variantId` — `toPromotionCartContext` (undefined in rev 8) is withdrawn in favour of `toPromotionCartLine`.
- **§10 moved to header-bound `/api/cart/current/*` (C7/D-R4-6, §16 Q5 closed).** The only credential is `X-Cart-Token`; no route accepts a token in a path or query string.
- **§15 gates re-cut (W13/D-R4-29):** Phase 1 = line CRUD + the full R1 visibility suite + idempotency + sweepers; Phase 2 = triggers 1–4/7 + totals equivalence without promotions; Phase 3 = triggers 5/6 + promotions + merge + §6a.5 + lock + totals equivalence with promotions + the P95 benchmark. Phase-4-seam columns (D-R4-19) and `resolved_at` (D-R4-20) ship in the Phase 1 migration regardless.
- **§14 assigned `TC-CART-*` test-case ids** throughout, replacing rev 8's unlabelled acceptance-criteria bullets.
- **§15a (new) — error-code and rate-limit catalogue**, previously undeclared.
- **§16a (new) — Migration & Backward Compatibility section**, previously missing; records the module-id exception (C9/D-R4-17) and the contract-freeze/ADDITIVE-ONLY facts for the new `catalog`/`availability` DI keys.
- Module id stays `cart` (C9/D-R4-17, decided, not reopened).

### 2026-10-12 (the lock's re-price and tax)
- **§5.2 trigger 5 names the proposal for the lock's re-price when a tax provider is configured:** tax with the shipping address checkout holds, proposed in the tax-providers roadmap (`2026-10-03-tax-providers-roadmap.md`, ADR-3, amendment 6a, §14 Q16; in review as #6918) and not decided here; how the address reaches `cart.lock()` is for a later pointer, after the lock amendment (#7212, whose lock input carries no address) merges.

### 2026-10-11 (availability entry point)
- **§3.1 points at the real availability entry point.** The availability contract replaced its `availabilityService` DI key with `resolveAvailability()` in `packages/shared` (§4.1a of [Availability Contract](./2026-08-14-availability-contract.md)) plus the `availability.reserve`/`.release`/`.commit` commands; no such DI key exists, so the `cart → availability` edge now reads `resolveAvailability(query, { moduleConfig, container })`. The `+ quantity rules` annotation is dropped from that edge: the shared result carries no min/max/increment, and how the cart obtains them is tracked with the §5.5 gap. Recorded from the post-merge review of #5384.

### 2026-09-30 (§8.2 ordering clarified)
- **§8.2 states that the idempotency lookup runs before the §8.1 optimistic-lock check.** §8.1's "every mutating command starts with" the lock check read, literally, as the opposite order, under which a retried mutation that had already landed gets a `409` instead of its original result. One sentence, no contract change: cart is unimplemented. Requested by [Offline Field Mode](./2026-09-22-offline-field-mode.md) §3.3, whose chunked replay depends on it; the storefront's own double-tap retry (storefront-app §5.2) depends on it too.

### 2026-09-27 (rev 8 — proposal seam review fixes)

Fixes the `cart` half of the 2026-09-25 assisted-selling review (M2–M6). No change to Phases 1–2 or to the core decision.

- **The proposal cart's own token is no longer a buyer credential (M4).** Rev 7 routed `/carts/:token/proposals/:proposalToken/...`, putting two tokens in the path against §8.3 and giving the buyer a token that the line routes would have accepted, so the author's priced proposal could be edited. Proposal routes are now `/api/cart/proposals/:proposalId/*` under the buyer's header/cookie token (§7a.4, §10); `cartService.resolveBasketByToken` resolves baskets only, and line and promotion commands refuse a proposal cart (§7a.1). The pre-existing token-in-path basket routes are §16 Q5.
- **`cart.proposal.create` takes the target cart id, not its token (M6),** and the merge-boundary scope is the one the buyer's own request supplies, stated in §6a.5 (M2).
- **Undo reaches the proposal (M3).** `undo-merge` of an acceptance returns the proposal cart to `active` (or `expired`) and emits the new `cart.proposal.acceptance_undone` (§7a.7, §9, §11).
- **Sweepers re-specified for proposals (M5).** No inactivity abandonment — it would have rejected every live proposal at 24 h against a 72 h TTL with no event — and `abandoned` is final for a proposal (§7a.1, §9, §12). Retention is §16 Q6.
- **Lifecycle payloads defined (M6).** `cart.cart.merged` has a payload carrying the source cart's `kind`; `cart.cart.adopted` is new, because adoption rotated the token with no event; `cart.cart.purged` is new. Token rotation now also covers adoption (§8.3).
- §9's diagram and transition table show proposal acceptance and undo (m6); the Phase 3 gate counts the five login situations it covers.
- **"Guest cart empty" is a `keep_target` merge, not a discard (§7.1).** Rev 7's discard set no status and emitted no event, so a conversation opened on an empty guest basket — the common "ask before adding" case — was stranded at login.

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
