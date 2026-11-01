# Cart Module

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 10 — Release 5 decisions applied; **Phases 1–3 implemented 2026-10-15, PR adeptofvoltron/open-mercato#15**; Phase 4 (B2B, admin, approval gate, checkout lock contract and the §7a proposal seam) specified for eComm Release 5, not built — see §15 and §18 Changelog) |
| **Created** | 2026-08-14 |
| **Revised** | 2026-10-26 (rev 10 — Release 5 spec revision) |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 5, Phase 2 |
| **Modules** | `cart` (new) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Availability Contract](./2026-08-14-availability-contract.md), [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md) |
| **Related** | [SPEC-055 Promotions](./SPEC-055-2026-02-23-promotions-module.md), [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md), [Assisted Selling](./2026-09-22-assisted-selling.md), [ADR-1](./2026-08-14-ecommerce-suite-roadmap.md#adr-1--the-cart-is-a-module-not-a-checkout-status), [ADR-2](./2026-08-14-ecommerce-suite-roadmap.md#adr-2--cart-never-computes-tax-or-totals-itself), [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--a-proposal-is-a-cart-and-acceptance-is-a-merge) |
| **Release 4 decisions** | [eComm Release 4 Decisions](./analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md) D-R4-1…29 (authoritative audit trail; this revision is where they land in the spec text) |
| **Release 5 decisions** | [eComm Release 5 Decisions](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md) D-R5-1…36 (authoritative); findings K1–K17 ([cart analysis](./analysis/ANALYSIS-2026-10-26-cart-module-release-5.md)), X1–X20 ([cross-spec](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md)), S-items ([assisted selling](./analysis/ANALYSIS-2026-10-26-assisted-selling-release-5.md)) and C-items ([checkout](./analysis/ANALYSIS-2026-10-26-checkout-release-5.md)) land in rev 10 |

---

## TLDR

**Key Points:**
- A channel-agnostic basket module. `Cart` and `CartLine` are first-class entities addressed by an opaque token, usable by the storefront, POS, pay links and AI purchasing agents alike. Checkout consumes a cart; it does not own one.
- **The cart does no arithmetic.** It resolves unit prices via `catalogBuyerPricingService.resolveLinePrice(...)` (rev 9 — D-R4-3), discounts via `promotionsService`, then hands `SalesLineSnapshot[]` to `salesCalculationService.calculateDocumentTotals` with `documentKind: 'quote'`. Cart totals and order totals are produced by the same code, so they cannot disagree.
- Prices are **snapshotted per line with a resolution stamp**, and re-priced on a defined set of triggers. A cart that silently re-prices mid-session is as broken as one that never does; the trigger list is the contract.
- B2B changes cart behaviour in ways B2C never exercises: quantity breaks re-price the whole line as quantity crosses a tier, pack increments constrain quantities, and an over-threshold cart routes to approval before checkout.
- **(rev 10 — Release 5)** The approval gate is specified (§9a): one amount basis (goods gross after promotions, excluding delivery, in the cart currency), `cart.lock` refuses `409 cart_requires_approval` without a qualifying approval, guests over the threshold are refused (D-R5-12), every channel is gated (D-R5-29), and a quote request skips the gate (`purpose: 'quote'`, D-R5-23). An identified basket answers only to its own buyer's session on every buyer route (§8.4, D-R5-21). The lock gains a session-bound TTL and extend for checkout (§9), `markConverted` carries the order or quote `lineMap` (§11), the admin cart list ships (§10.2), and the proposal seam of §7a ships in Release 5 (D-R5-11) with no undo of an acceptance (D-R5-25).

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
             ├──► customer_groups  resolveTerms() — tax mode, approval threshold, terms currency (§9a)
             ├──► customer_groups  customerPurchaseApprovalService — request / read / withdraw the cart's approval (§9a, rev 10)
             └──► ecommerce (soft) storeContextService.resolve(request) at the route edge; resolveForBuyer(...) on trusted paths (§6a.4, rev 10)
```

**(rev 9 — D-R4-3)** `catalogBuyerPricingService` and `catalogScopedProductService` are additive services extracted from `ecommerce/lib/storefrontPricing.ts` into `catalog`, and the quantity-rule derivation is extracted from `ecommerce/lib/storefrontDetail.ts` into `availability`; `ecommerce` is refactored onto all three with no behaviour change, guarded by its existing `TC-ECOM-*` suites. This replaces rev 8's `catalogPricingService` (§3.1 S2 of the Release 4 analysis: no such sanctioned service existed — the only complete implementation was ecommerce-private) and the undefined availability-derived quantity rules of rev 8 §5.5 (S3).

`cart` has no inbound dependency. `checkout` reads it; it does not read `checkout`. **(rev 10)** `customer_groups` is already a hard `requires`; the approval service is resolved by DI and no `customer_groups` entity is imported. `cart` subscribes to `customer_groups.approval.*` (§9a.5) — a subscription on a module it already depends on, never the reverse.

### 3.1a Commands (fixed 2026-08-17)

Every mutation is a registered command, mirroring `sales/commands/documents.ts` — this module has no exemption from root `AGENTS.md`'s "domain writes go through commands" rule, and an earlier draft of this spec had none of these, describing mutations as plain HTTP handlers instead:

```
cart.create · cart.get                                                  (rev 9 — §6a.1a; the route edge's two entry points)
cart.lines.add · cart.lines.update · cart.lines.remove · cart.lines.bulkAdd
cart.promotions.apply · cart.promotions.remove
cart.merge · cart.mergeUndo
cart.approval.request
cart.reprice
cart.lock · cart.unlock · cart.markConverted                            (rev 9 — §9, F7/C6; no public route; rev 10 — session-bound extend, purpose, lineMap)
cart.proposal.create · cart.proposal.accept · cart.proposal.reject      (rev 7 — §7a)
```

**(rev 10) Reads exposed to checkout.** Besides the commands, `cartService` exposes one read for checkout (C7): `cartService.getSalesSnapshot({ cartId, tenantId, organizationId, checkoutSessionId })` returns `{ lines: Array<{ cartLineId, snapshot: SalesLineSnapshot }>, adjustments: SalesAdjustmentDraft[], totals, currencyCode, updatedAt }`, built by the same `lib/toSalesSnapshots` mapping that produces `Cart.totals` (§3.2), so checkout never re-maps lines and the C7 equality check compares like with like. It answers only for a `locked` cart whose `checkout_session_id` matches; anything else is the uniform `404`. Flagged lines (§4.2 `flag_state`) cannot exist on a locked cart (§9) and are therefore never in the snapshot.

**(rev 10) Trusted command context (X10).** Three callers run cart commands without a request: checkout seeding a pay-link cart (D-R5-19, §6a.4), assisted selling re-authoring a proposal as its original author (D-R5-14, §7a.2), and checkout recovery re-locking a cart (D-R5-22, §9). Each builds its context through the one shared helper `buildTrustedCommandContext({ tenantId, organizationId, actor: { type: 'system' } | { type: 'user'; userId }, reason })` (`@open-mercato/shared/lib/commands/trustedContext`). A `user` actor's ACL is loaded fresh by the helper, and `cart` checks features against it through `rbacService` (wildcards honoured) exactly as for an HTTP principal. Audit entries written under such a context are marked system-initiated by the helper; `cart` adds no marker of its own. No HTTP input can produce such a context.

**(rev 9 — command undo table, F7/C6, D-R4-4).** `cart.lines.add`, `.remove`, `.bulkAdd` and `cart.merge` carry undo via `extractUndoPayload`. `cart.lines.update`, `cart.reprice`, `cart.lock`, `cart.unlock` and `cart.markConverted` are not undoable — re-pricing to a stale price, an in-flight checkout lock, or a conversion already reflected in a `SalesOrder` are none of them a state a client would ever want restored — and are documented as such rather than left silent on the question:

| Command | Undo | Reason |
|---|---|---|
| `cart.lines.add` / `.remove` / `.bulkAdd` | Yes | Reverses a buyer-visible content change |
| `cart.merge` | Yes (`cart.mergeUndo`, 15 min) — **except** a proposal acceptance (rev 10 — D-R5-25) | §7.2; §7a.7 |
| `cart.approval.request` | No | The request lives in `customer_groups`; reversal is `withdrawApproval`, an explicit counter-action (§9a.4) |
| `cart.proposal.create` / `.reject` | No | A published proposal is withdrawn by rejecting it (§7a.5), never by rolling back its creation |
| `cart.lines.update` | No | Quantity changes re-price; the "undo" a buyer wants is setting the quantity back, not a system rollback |
| `cart.reprice`, trigger-driven re-snapshots | No | Re-pricing to a stale price is never a desired restore target |
| `cart.lock` / `.unlock` | No | A lock is a checkout-session concern, not buyer content |
| `cart.markConverted` | No | Terminal; the cart becomes read-only history once a `SalesOrder` exists |

`cart.proposal.accept` **delegates to `cart.merge`**; it is not a second merge implementation. `cart.proposal.create` takes a target cart **id** (§7a.2). That delegation is the whole reason the proposal seam costs this module three commands rather than an entity family: disclosure (`mergeSummary`), the append-only pre-merge snapshot (`CartMergeLog.source_snapshot`) and the mandatory whole-cart re-price (§7.3) are already specified, already tested, and already the behaviour a buyer accepting someone else's suggestion needs. (Rev 10 — D-R5-25: `cart.mergeUndo` refuses an acceptance, §7a.7.)

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
| `requires_approval` | boolean | **(rev 10 — K2)** Recomputed by the §9a.2 rule on every totals change and again from fresh terms at `cart.lock`. A cached display value only: the lock never trusts it |
| `approval_id` | uuid, nullable | `customer_groups.CustomerPurchaseApproval.id`. **(rev 10 — K3)** The cart's one authoritative approval; moves to the new request when the buyer re-requests. Status is never denormalised here — every read goes to `customerPurchaseApprovalService.getApproval` (§9a.4) |
| `awaiting_approval_since` | timestamptz, nullable | **(rev 10 — K5/X14)** Set by `cart.approval.request` while the approval is pending; cleared by the §9a.5 subscriber on the decision or expiry event, and by `cart` itself whenever it withdraws the approval or `approval_id` moves. `mark-abandoned-carts` skips a basket with this set, without a per-row call into `customer_groups` |
| `note` | text, nullable | Buyer-supplied; encrypted at rest alongside `email` (rev 9 — AGENTS.md free-text-about-people rule; `configuration` on `CartLine` stays plaintext because encrypting it breaks the stored `configuration_hash` generated column) |
| `metadata` | jsonb, nullable | |
| `merged_into_cart_id` | uuid, nullable | Set when `status = 'merged'` |
| `last_activity_at` | timestamptz | Drives abandonment |
| `last_price_change_at` | timestamptz, nullable | **(rev 9 — §5.3 referenced this column; rev 8 never declared it)** Set whenever a re-price populates `priceChanges` |
| `locked_at` | timestamptz, nullable | **(rev 9 — F7/C6/D-R4-4)** Set by `cart.lock` |
| `lock_expires_at` | timestamptz, nullable | **(rev 9 — F7/C6)** Lock timeout (default 30 min, §9); `release-stale-locks` clears both lock columns past this. **(rev 10 — C1)** Set from the caller's `lockTtlMs` when given, and moved forward by an extend from the same checkout session |
| `checkout_session_id` | text, nullable | **(rev 9 — F7/C6)** Opaque id supplied by the lock caller; returned in the `423 cart_locked` body (§9, §15 error catalogue). **(rev 10 — C1)** Also the binding key: `unlock`, `markConverted`, `getSalesSnapshot` and an extend must present the same value |
| `resolved_at` | timestamptz, nullable | **(rev 9 — Q6/D-R4-20, C8)** Set when a cart (basket or proposal) leaves `active` for any terminal-for-purge reason (`converted`, `abandoned` past purge-eligibility, `expired`, or — for a proposal — `merged`/`abandoned`). `purge-expired-carts` counts the 90-day retention window from this column rather than from `expires_at`, which is what makes an accepted or rejected proposal's retention well-defined (§7a.3, §12, §16 Q6) |
| `expires_at` | timestamptz | TTL. For a proposal, `now + ttlSeconds` from `cart.proposal.create` (§7a.3, rev 10 — S5) |

Indexes: unique `token_hash`; `(tenant_id, customer_id, status)`; `(tenant_id, status, expires_at)` for the sweeper; `(tenant_id, status, last_activity_at)` for abandonment; `(tenant_id, status, resolved_at)` for the purge sweeper (rev 9); `(tenant_id, proposed_to_cart_id, status)` partial on `kind = 'proposal'`, which is the query behind "what has been proposed to this buyer and is still live"; **(rev 10 — K6)** `(tenant_id, organization_id, kind, last_activity_at)` for the admin list's default sort (§10.2).

**A proposal's author (rev 10).** `Cart` has no `authored_by_*` column, and rev 10 adds none. Every line of a proposal is written by `cart.proposal.create` from `ctx.auth` (R16), so a proposal's author is its lines' `added_by_actor_type`/`_id`, and the `cart.proposal.*` payloads (§11) read it from there. The authoritative authorship record, with the approving rep for an AI draft, is assisted selling's `AssistedSellingProposal`.

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
| `unit_price_override` | jsonb, nullable | **(rev 10 — D-R5-19)** `{ amount: string, basis: 'net' \| 'gross' }`, written only by the trusted pay-link seeding path (§6a.4) from the link template's `unit_price_override`. When set, every re-price keeps it: the line passes it to `salesCalculationService` as `unitPriceNet` or `unitPriceGross` with the tax rate the catalog resolves for the product, `price_row_id` and `price_kind_id` stay `null`, and `nextTier` is `null`. No public body can set it (`.strict()`, §6a.1a) |
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
2. Buyer identity changes: login (a guest basket becoming identified), a group membership change, or a change to that customer's own assortment override (created, edited, deleted, or lapsing past its `valid_until`) altering `buyer_digest` — whole cart. **(rev 10 — D-R5-21)** Logout is no longer a trigger on an identified basket: a request without that buyer's session answers `404` and changes nothing (§8.4), and the storefront starts a new guest cart instead
3. Currency or locale changes — whole cart
4. A line snapshot is older than the staleness budget (default 30 minutes) and the cart is read — whole cart
5. Checkout requests a lock (spec 7) — whole cart, mandatory, never skipped; when a tax provider is configured, the tax-providers roadmap proposes this re-price as the one that computes tax with the shipping address checkout holds (`2026-10-03-tax-providers-roadmap.md`, ADR-3, amendment 6a, §14 Q16); that is a proposal to the owners of this spec, and how the address reaches `cart.lock()` is for a later pointer, after this spec's lock amendment (whose lock input carries no address) merges
6. A promotion is applied or removed — effects only, not unit prices
7. An operator forces it through the admin cart view (`POST /api/cart/carts/:id/reprice`, §10.2)

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
- **(rev 10 — D-R5-21)** The same route edge enforces the identity binding of §8.4 before any command runs: an identified basket answers `404` unless the request carries that buyer's customer session.

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

- **Trigger 2** (buyer identity changes: login, group membership change, per-customer assortment override change) — the case that produces the drift.
- **Trigger 5** (checkout requests a lock; "mandatory, never skipped") — the backstop.

A line that fails is **not deleted**. Deleting a buyer's line without disclosure is the failure class R2 and R4 already exist to prevent, and this does not add a third instance of it. The line is flagged `product_unavailable` in `warnings`, exactly as an out-of-stock line already is, and **the `active → locked` transition is refused while any line carries that flag** (§9) — mirroring the precedent that an over-`approval_required_above` cart cannot lock (§9a). The buyer removes or replaces the line, or regains access and re-triggers a re-price, before checkout proceeds.

### 6a.3 No write-side enumeration oracle

A restricted product and a nonexistent or deleted product id produce the **identical** `product_unavailable` warning — same body, same shape. This is `storefront-public-api.md` §4.2's handle-enumeration rule applied to a mutation: the read path goes to the trouble of collapsing "restricted" and "nonexistent" into one indistinguishable 404, and the write path must not hand that distinction back.

### 6a.4 Non-storefront channels are exempt by construction, and created only through an authenticated command (rev 9 — F2/C1/D-R4-2)

The visibility rule is keyed on **whether a scope was resolved**, not on an enumerated channel list: enforcement applies exactly to carts whose channel resolved a `StoreContext`, which today is `storefront` alone. `pos`, `pay_link`, `agent` and `api` carts have no channel binding and no buyer digest, so there is nothing to check against. A future channel that gains `StoreContext` resolution inherits enforcement automatically. An in-store POS sale by staff is a deliberately different trust boundary — assortment scope is a self-service merchandising control, not a sales permission.

**The companion rule rev 8 lacked (F2):** a client cannot *reach* that exemption by asking for it. `cart.create`'s public, unauthenticated path (§6a.1a) always produces a `storefront` cart bound to the host-resolved store — there is no field in any public request that selects a channel. Creating a `pos`, `pay_link`, `agent` or `api` cart requires calling `cart.create` from an **authenticated server principal** holding a channel-specific feature (`cart.channel.pos`, `cart.channel.payLink`, `cart.channel.agent`, `cart.channel.api` — `acl.ts`), supplying its own `channel`/`storeId`/`salesChannelId` as trusted command input, never from a request body reachable by an anonymous caller. `channel` is immutable once set (§4.1). A test asserts an anonymous `POST /current` with any attempt to influence the channel still yields `storefront`, and that `cart.create` called with `channel: 'api'` and no authenticated principal is rejected before a cart is ever persisted.

**The exemption is a property of the cart a line lives in, not a property that travels with the line.** §6a.5 states the consequence, and it is the reason this sentence had to be added.

**(rev 10 — D-R5-22) Buyer identity on the trusted path.** Before rev 10 a trusted-path cart created for a customer stored `customer_ids = [customerId]`, `customer_group_ids = []` and `price_kind_id = null` (X2), so credit, approval and terms resolved against the person, not the company, and the buyer's contract price was never applied. From rev 10, when a trusted caller names a buyer (`customerUserId` or `customerId`), `cart.create` resolves identity through `storeContextService.resolveForBuyer({ tenantId, organizationId, storeId?, customerUserId?, customerId? })` (SPEC-029), taken with `tryResolve`. `storeId` is passed only when the cart has one. The result fills `customer_id`, `customer_ids` (person and company), `customer_user_id`, `customer_group_ids`, `price_kind_id`, `tax_mode` and `buyer_digest`. The same call refreshes identity at every whole-cart re-price of a non-storefront cart that has a buyer (lock, the admin re-price, recovery). The trusted path uses the seam for **identity only**: an `assortmentScope` it returns is not applied, and the §6a.4 exemption above is unchanged. When `ecommerce` is absent, identity falls back to the trusted input as before (`customer_ids = [customerId]`, no groups, no price kind). That fallback is documented, not silent: the cart then prices at list and resolves terms against the person.

**(rev 10 — D-R5-19) The trusted pay-link seeding path.** The public `/pay/[slug]` flow has no authenticated principal, so it cannot hold `cart.channel.payLink`. The owner approved one exception (Ask First on the cart contract, recorded in D-R5-19):
1. Only after checkout's own link checks pass (active, not expired, usage limit, password), checkout builds a context with `buildTrustedCommandContext({ tenantId, organizationId, actor: { type: 'system' }, reason: 'checkout.pay_link:<linkId>' })` (§3.1a). Tenant and organization are the link's own, never request input.
2. It calls `cart.create` with `channel: 'pay_link'`, then adds the template's lines through the command bus (`cart.lines.add` / `.bulkAdd`). The lines come only from the merchant's template. A template line with `unit_price_override` is written with `CartLine.unit_price_override` (§4.2); a line without one prices at the buyer's own rate.
3. When the request carries a customer session (`getCustomerAuthFromRequest`), checkout passes its `customerUserId` and identity resolves as above, so a wholesale buyer opening a link pays their contract price.
4. A `system` context is accepted for `channel: 'pay_link'` only. Every other non-storefront channel still requires a principal holding its `cart.channel.*` feature. The audit entry is marked system-initiated by the helper and names the link id through `reason`.

The pay-link cart carries the same approval gate as every other channel (D-R5-29, §9a).

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

After a merge the response carries `mergeSummary` — lines added, quantities combined, anything capped, and (rev 7) anything **rejected** by the visibility pass of §6a.5 or **declined** by the buyer under the `manual` strategy. The UI must surface it. Every incoming line appears in the summary under exactly one disposition; a line that is silently absent from both the summary and the cart is the defect this rule exists to make impossible. `POST /current/undo-merge` restores the pre-merge state from the log within 15 minutes. **(rev 10 — D-R5-25)** A proposal acceptance is the one merge it refuses, with `409 merge_undo_not_supported_for_proposal` (§7a.7).

**Rejected alternative:** silently replacing the customer cart with the guest cart. It is the simplest rule and it deletes a basket the buyer assembled on another device, with no trace.

### 7.3 Re-pricing after merge

Mandatory and whole-cart — the buyer's group has just become known, so every line's price may change. This is exactly the case that trigger 2 exists for, and it is also the case most likely to surprise, so `priceChanges` matters most here.

Re-pricing is *not* the only whole-cart pass a merge owes: §6a.5 requires a re-visibility pass in the same operation. The two are separate concerns that happen to share a boundary, and rev 6 had only the first.

### 7.4 Approvals across a merge (rev 10 — K3)

An approval is consent to spend up to an amount for one cart (D-R5-3). A merge changes which cart holds the lines, so it settles the approval on both sides in the same command:

- **Source side.** A source basket whose `approval_id` names a `pending` approval has it withdrawn (`customerPurchaseApprovalService.withdrawApproval`, actor `system`) inside the merge command, and its `awaiting_approval_since` is cleared. An `approved` approval on the source is left as is: the source is `merged`, terminal, and can never lock, so the approval can never be used again. It does not transfer to the target.
- **Target side.** The mandatory post-merge re-price (§7.3) recomputes `requires_approval` (§9a.2). The target's own approval stays on the target. If the merged total now exceeds its amount, it stops qualifying and the buyer re-requests (D-R5-3).
- **Undo.** `cart.mergeUndo` recomputes the target. A withdrawn source approval is **not** restored: the buyer re-requests after an undo if the restored source still needs one.

A proposal acceptance follows the same target-side rule, so an accepted proposal can make a previously approved basket need approval again. That is intended: the buyer has just chosen to spend more.

---

## 7a) Proposal Carts (added 2026-09-22 — rev 7)

The seam that lets somebody other than the buyer put a priced basket in front of the buyer, without ever touching the buyer's own. Everything about **who** is proposing, through what conversation, and with what presence disclosure belongs to [`assisted_selling`](./2026-09-22-assisted-selling.md). This section is the whole of the `cart` side.

### 7a.1 A proposal is a role, not a status

`Cart.kind = 'proposal'` with `proposed_to_cart_id` pointing at the target basket. It is an ordinary cart in every other respect: same line model, same price snapshots, same promotion evaluation, same totals through `salesCalculationService`, same limits, same TTL sweeper. `Cart.status` is untouched and orthogonal — a proposal is `active` while live, `expired` past its `expires_at`, `merged` once accepted (with `merged_into_cart_id` set to the target), and `abandoned` once rejected.

**Two lifecycle rules do not carry over, because for a proposal `abandoned` *means* rejected (rev 8).** The inactivity transition `active → abandoned` (§9) does not apply to `kind = 'proposal'` — a proposal is not a basket anyone is expected to touch, so it is always "inactive", and under the ordinary rule every live proposal would die at 24 h against a 72 h TTL without a `cart.proposal.rejected`; its only exit from `active` besides acceptance and rejection is the TTL. And `abandoned → active` on "any mutation" does not apply either: a rejection is final, and nothing can mutate a proposal cart anyway (below).

**A proposal cart is not addressable as a cart.** Its token is never issued (§4.1) and `cartService.resolveBasketByToken` resolves `kind = 'basket'` only (§8.3), so no token-bound route in §10 — lines, promotions, merge, reprice — can reach it. Independently of addressing, every line, promotion, lock and admin-reprice command loads its cart with `kind = 'basket'`, so a `kind = 'proposal'` cart id answers the same `404` as an unknown cart. **(rev 10 — K10)** Rev 8/9 specified a distinguishable `409 proposal_cart_immutable` here; Release 4 shipped the structural not-found instead, and rev 10 adopts it, because a distinguishable code would tell a caller that a guessed id is a live proposal. The only writers of a proposal cart are `cart.proposal.*`, `cart.merge` (as the source of an acceptance) and the sweepers. A published proposal is immutable: changing one is re-authoring it (assisted selling §6.4), which prices afresh.

**There is no `rejected` status and no proposal entity family.** `abandoned` is the existing terminal non-converting state and it is the accurate one; *why* a proposal ended — rejected by the buyer, withdrawn by its author, superseded by a re-authored one — is metadata about a conversation, and lives with the conversation in `assisted_selling`. Adding a fifth lifecycle to `Cart.status`, or a `CartProposal`/`CartProposalLine` pair beside `Cart`/`CartLine`, would duplicate a line model, a pricing path and a totals path that already exist and are already the ones that must produce the number the buyer pays.

### 7a.2 A proposal is priced as the buyer, never as its author

`cart.proposal.create` takes the **target cart's id** — its callers are authenticated server principals (§10), which have no business holding a buyer's credential and in assisted selling's case hold none — and the proposal cart is created carrying the target's `customer_id`, `customer_user_id`, `customer_group_ids`, `price_kind_id`, `currency_code`, `locale`, `tax_mode`, `channel`, `store_id`, `sales_channel_id` and `buyer_digest` — copied at creation and re-derived from the target on every re-price. The author's own identity, group membership and price kind never enter pricing at any point.

This is not a convenience. A rep resolving `catalogBuyerPricingService.resolveLinePrice(...)` under their own context, or an AI agent under a service principal's, produces a proposal the buyer accepts at a price the buyer will not be charged: the mandatory post-merge re-price (§7.3) then corrects it, and `priceChanges` discloses a rise the buyer never agreed to. The pricing context is a property of the basket being proposed *into*, and copying it at the seam is what makes that true by construction rather than by discipline. ADR-7 and ADR-9 are the suite-level statements of the same rule.

Because the proposal cart carries the target's `channel`, a proposal against a storefront basket is itself scope-enforced: §6a.1b's enforcement key applies to `cart.proposal.create` exactly as it applies to `cart.lines.add`, and §6a.5's pass at the merge boundary is the backstop rather than the only control. The scope passed to `cart.proposal.create` MUST be the **target buyer's**, resolved on the server — assisted selling does so through `storeContextService.resolveForBuyer` (its §6.3), as an internal, trusted argument, never a value its own request body carries — but `cart` does not have to trust that: `preview` and `accept` re-check every line against the scope of the buyer's own request, freshly resolved (§6a.5, D-R4-22).

**The create contract (rev 10 — S5, S13, S14, D-R5-14).**

```typescript
cart.proposal.create({
  targetCartId: string,                 // a kind = 'basket', status = 'active' | 'abandoned' cart in the caller's tenant and organization
  lines: Array<{ productId: string; variantId?: string | null; quantity: string; configuration?: Record<string, unknown> | null }>,  // 1..100
  ttlSeconds?: number,                  // 3600..1209600, default 259200 (72 h)
  routeContext?: ResolvedCartRouteContext,  // the TARGET buyer's scope from resolveForBuyer; required when the target is storefront
})
// → { proposalCartId, lines: CartLineView[], totals, warnings, rejectedLines: Array<{ productId, variantId, reason: 'product_unavailable' }> }
```

- **Caller.** An authenticated principal holding `cart.proposals.author` (§10). In Release 5 the only caller is `assisted_selling` (§6.3 there), which validates the shape before it freezes (D-R5-11).
- **Visibility (S13/K13).** Each line runs the §6a.1b check against `routeContext.assortmentScope`. A storefront target without a context is refused with `400 assortment_scope_required_for_storefront_channel`. Rejected lines are returned to the author in `rejectedLines` and in `warnings`, never silently dropped. They emit one `cart.line.visibility_rejected` per call with `triggeredBy: 'proposal_create'`. A proposal with no admissible line is not created (`422 proposal_empty`, every line in `rejectedLines`).
- **No promotion codes (S14/K14).** The input has no code field. Automatic promotions are evaluated as for any cart, and no code reservation is ever taken for a proposal in Release 5.
- **TTL (S5).** `expires_at = now + ttlSeconds` (§7a.3). `cart` reads no store setting; `assisted_selling` passes its `proposal_ttl_seconds`.
- **Target state.** A `locked` target refuses with `423 cart_locked`, and a `merged`, `expired` or `converted` target with `409 cart_not_active`. Proposing into an `abandoned` basket does not reactivate it: authoring is not buyer activity.
- **Re-authoring on the author's behalf (D-R5-14).** When `assisted_selling` re-authors after a login merge, it calls `cart.proposal.create` under `buildTrustedCommandContext({ …, actor: { type: 'user', userId: <original author> }, reason: 'assisted_selling.reauthor' })` (§3.1a). `cart` applies the same `cart.proposals.author` check against that user's freshly loaded ACL and writes `added_by_actor_*` from that context, so attribution stays the original author's. If the check fails, `cart` refuses (`403`) and assisted selling falls back as its §8.1 states. The audit entry is marked system-initiated by the helper.

### 7a.3 Expiry

`expires_at` on a proposal cart is `now + ttlSeconds`, an input of `cart.proposal.create` (rev 10 — S5; bounded 3600–1 209 600 s, default 259 200 s = 72 h) rather than the normal cart TTL. The caller owns the setting (`assisted_selling` passes its store's `proposal_ttl_seconds`), so `cart` gains no inbound dependency. The existing `expire-carts` sweeper (§12) retires it. An expired proposal is **not deleted** by expiry: it stays readable, so the buyer and the author see the same history of the conversation, and so a rejected-or-lapsed suggestion remains attributable — until the retention purge of §12, whose rule for proposal carts is §16 Q6. Re-proposing an expired basket is a new proposal cart, freshly priced — never a revival of the old one, whose snapshots are by then exactly as stale as the TTL says.

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

**Addressed by id, authorised by the basket (rev 8).** Rev 7 put the buyer's token *and* a second, proposal-cart token in the path, which contradicted §8.3 twice over and handed the buyer a credential for the proposal cart itself — with nothing stopping it being used on the line routes to edit the author's priced proposal. Now the credential is the buyer's own basket token, presented as every other token in this suite is; the proposal is named by id, and the route answers `404` unless that proposal's `proposed_to_cart_id` is the presented token's basket — the same `404` a nonexistent id gets, so ids cannot be probed across baskets.

**Bound to the identified buyer (rev 10 — D-R5-13, D-R5-21).** When the target basket has `customer_user_id`, `GET /proposals` and `preview`/`accept`/`reject` also require the customer session (`getCustomerAuthFromRequest`, cookie or Bearer customer JWT) whose `customerUserId` equals the basket's, exactly as every `/current/*` route does (§8.4). Without it they answer the same `404` as a foreign proposal id. A guest basket stays token-only. D-R5-13 introduced the rule for these routes; D-R5-21 made it the cart-wide rule, so the token alone can no longer strip a basket's identity first and then reach its proposals (X1).

**Approval after acceptance (rev 10).** Acceptance is a merge, so §7.4's target-side rule applies: the whole-cart re-price recomputes `requires_approval`, and an approval that no longer covers the new total stops qualifying.

`acceptancePreview` carries, per line, the proposed unit price, the price re-resolved now, the delta, and any `product_unavailable` rejection — the same disclosure vocabulary `priceChanges` and `mergeSummary` already use, so a client has one parser rather than three.

The token binds the target cart's `updatedAt` **and** the proposal cart's `updatedAt`. Either moving invalidates it. This is the shape [`storefront-customer-account.md`](./2026-08-14-storefront-customer-account.md) §7.3 already fixed for shopping-list conversion — "create NOTHING; return the preview and a short-lived `resolutionToken` … a buyer must never accept difference set A and receive cart B" — and the failure it prevents is identical here. It composes with, rather than replaces, §8.1's optimistic lock on the target cart.

`lines` is what makes the `manual` strategy of §7.1 reachable: the buyer takes two of five suggestions and the other three are recorded as `declined`, not deleted and not quietly merged.

A target cart in `locked` status refuses acceptance with `423 Locked` and the checkout session id, per §9 — the buyer is mid-checkout and the basket is not theirs to change at that moment either.

### 7a.5 Rejection

`cart.proposal.reject` sets the proposal cart to `abandoned`, sets `resolved_at`, and releases code reservations by `cartId` (`codeService.releaseCode`) for every `CartPromotionApplication` row of the proposal (§6). In Release 5 a proposal holds no codes (S14), so the release finds nothing, but the rule stays correct if codes are added later. It touches the target cart not at all — there is nothing to undo, because nothing was ever merged. This asymmetry with acceptance is the point of the whole design: **the cheap operation is the one that changes nothing.**

**(rev 10) Two callers.** The buyer rejects through `POST /proposals/:proposalId/reject` (token-bound, §7a.4 binding). The author's side ends a proposal in-process: `assisted_selling` withdraw, supersede and re-author call `cart.proposal.reject` under a principal holding `cart.proposals.author` in the proposal's organization (assisted selling §6.4). `cart.proposal.rejected` records which side ended it (`rejectedBy: 'buyer' | 'author'`, §11). Rejecting a proposal that is not `active` is a no-op that returns its current status, so a withdraw racing a buyer's accept or the expiry sweeper never errors.

### 7a.6 What this module does not own

The thread, its participants and their presence; the message bodies; who may author a proposal and under which store mode; the AI agent, its tools and its budget; commission attribution after conversion. All of it is [`assisted_selling`](./2026-09-22-assisted-selling.md). `cart` never learns that a conversation exists: it has no `thread_id` column, no inbound dependency, and no knowledge of why a proposal was authored — consistent with §3.1's "`cart` has no inbound dependency".

### 7a.7 An acceptance is not undone (rev 10 — D-R5-25, replacing rev 8's reopening undo)

`POST /current/undo-merge` on a merge whose `CartMergeLog.proposal_cart_id` is set is refused with `409 merge_undo_not_supported_for_proposal`, and nothing changes. The buyer removes unwanted lines through the ordinary line routes. The proposal stays `merged` (`accepted` in assisted selling), and the attribution that `cart.cart.converted` and `CartMergeLog.outcome` give its lines stays intact.

Rev 8 let undo return the proposal to `active` (or `expired`) and emit `cart.proposal.acceptance_undone`. Under the seam that ships in Release 5 that left `assisted_selling` with an `accepted` proposal whose lines were gone and an attribution with nothing to attribute (X8). The refusal is simpler, and the ordinary line routes already give the buyer the same practical outcome.

`cart.proposal.acceptance_undone` stays declared in `events.ts` — event ids are frozen once shipped (§16a) — and is **never emitted**. Consumers must not depend on it. The 15-minute undo of a login merge (§7.2) is unchanged. When the acceptance was made into a basket that a login merge then merged elsewhere, only that later login merge can be undone.

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

Token resolution is one DI-exposed function, `cartService.resolveBasketByToken(token, scope)`, tenant-scoped and restricted to `kind = 'basket'` — used by every token-bound route here and by consumers such as assisted selling, which resolve a buyer's token to a basket id instead of storing the token or a hash of it. A consumer keyed on the cart id is unaffected by rotation by construction. **(rev 10)** Consumers that resolve a token for a buyer route apply the §8.4 binding as well (assisted selling's buyer thread routes do, D-R5-13).

**Q5 resolved (rev 9 — C7/D-R4-6).** Rev 8 left the basket routes carrying `:token` in the path, contradicting this section, with the fix deferred to Q5. Nothing is implemented, so the fix is free now: every basket route moves to `/api/cart/current/*`, credentialed by the `X-Cart-Token` header (§10), plus the customer session for an identified basket from rev 10 (§8.4). No route in this module accepts a token in a path segment or a query string, asserted by test.

### 8.4 An identified basket answers only to its own buyer (rev 10 — D-R5-21)

**Rule.** When a basket has `customer_user_id`, every `/api/cart/current/*` route, every `/api/cart/proposals/*` buyer route (§7a.4) and every consumer's buyer route keyed on the basket requires, besides `X-Cart-Token`, the customer session (`getCustomerAuthFromRequest`, cookie or Bearer customer JWT) whose `customerUserId` equals the basket's. Otherwise the route answers `404` with the same body as an unknown cart, and nothing runs: no re-price, no re-identification, no activity stamp. A guest basket (`customer_user_id` null) stays token-only.

**What it closes (X1).** Through Release 4, trigger 2 re-identified a basket to whoever presented its token: `applyCartRepriceTriggerFields` wrote `customerUserId = input.customerUserId ?? null`. One anonymous `GET /api/cart/current` with a kept token turned an identified basket into a guest basket. That disclosed B2B contract prices, re-priced the basket to list, and then let D-R5-13's proposal binding be bypassed. The likeliest path is accidental: a shared workstation or kiosk where the storefront kept the token after logout. Sylius API v2 uses the same model (`VisitorBasedExtension`); its one route without the check was CVE-2026-31821.

**Consequences.**
- Re-identification runs in one direction only: a guest basket presented with a customer session becomes identified (trigger 2, login). An identified basket is never re-identified to another buyer or to anonymous.
- After logout the storefront starts a new guest cart. A later login merges it as today (§7).
- `POST /current/merge`: the session cart is bound by the rule above, and a `sourceToken` that resolves an identified basket of another buyer is the same `404`.
- Non-HTTP callers (checkout in-process, sweepers, admin) are unaffected. Checkout's own session routes apply the same rule (D-R5-33).
- The binding check runs at the route edge before the idempotency lookup (§8.2), so a replayed `Idempotency-Key` cannot return a stored response to the wrong buyer.

**Behaviour change against Release 4.** A storefront that relied on a kept token after logout now gets `404` and must start a new cart. Recorded in `UPGRADE_NOTES.md` and §16a. Ask First on the cart contract, approved in D-R5-21.

---

## 9) Lifecycle

```
active ──lock (checkout; approval gate §9a)──► locked ──submit──► converted
  │                                              │  ▲
  │                                              │  └──extend (same checkoutSessionId)
  │                                              └──unlock/timeout──► active
  ├──inactivity (not while awaiting approval)──► abandoned ──buyer returns──► active
  ├──TTL──────────────────► expired
  └──login merge, or proposal acceptance (source side)──► merged

  kind = 'proposal':  active ──accept──► merged         (final; no undo, D-R5-25)
                        ├──reject──► abandoned        (final)
                        └──TTL─────► expired          (no inactivity abandonment)
```

| Transition | Rule |
|---|---|
| `active → locked` | **(rev 9 — F7/C6/D-R4-4)** `cartService.lock` / command `cart.lock`, called by `checkout` (no public route); forces a whole-cart re-price **and a whole-cart re-visibility pass with a freshly-resolved buyer context** (§6a.2, §6a.5, D-R4-22) first; **refused with `409 cart_has_unavailable_lines` while any line carries a `flag_state`**; **(rev 10)** then the approval gate (§9a), refused with `409 cart_requires_approval` or `409 approval_requires_identified_buyer` unless `purpose: 'quote'`; sets `locked_at`, `lock_expires_at` and the caller-supplied `checkout_session_id`; rejects mutation while locked |
| `locked → locked` (extend) | **(rev 10 — C1/X15)** `cart.lock` with the **same** `checkoutSessionId` on a locked cart: moves `lock_expires_at` to `now + (lockTtlMs ?? default)` and returns the cart. No re-price, no visibility pass, no approval gate, no route context needed. A different session id still gets `423 cart_locked` |
| `locked → active` | `cartService.unlock` (command `cart.unlock`) with the matching `checkoutSessionId`, or a lock timeout (default 30 min) clearing `locked_at`/`lock_expires_at` |
| `locked → converted` | **(rev 9 — F7/C6)** `cartService.markConverted` (command `cart.markConverted`) with the matching `checkoutSessionId`, called by `checkout` once the order (or, for a quote request, the quote) exists; terminal — no command mutates a `converted` cart; sets `resolved_at` (§4.1, D-R4-20); **(rev 10)** carries the conversion payload below and settles the approval per §9a.4 |
| `active → abandoned` | Baskets: no activity for 24 h (configurable), **except while `awaiting_approval_since` is set** (rev 10 — K5); releases code reservations by `cartId` (rev 10 — K11); emits `cart.cart.abandoned` for recovery flows. Proposals: only by `cart.proposal.reject` (§7a.5) |
| `abandoned → active` | Baskets only: any mutation; extends `expires_at`. Never for a proposal (§7a.1). "Any mutation" is intentionally the mutation *attempt*, not its outcome — `loadMutableCart` reactivates before input validation runs, so a rejected add (inactive product, quantity ≤ 0) still reactivates the basket and moves `last_activity_at` (nit raised in the 2026-10-23 re-review) |
| `active → expired` | `expires_at` reached (default 30 days for identified buyers, 7 for guests; a proposal's own `ttlSeconds`); releases promotion code reservations by `cartId`; **(rev 10 — K3)** withdraws a pending approval |
| `* → merged` | Login merge, or the source side of a proposal acceptance; `merged_into_cart_id` set; **(rev 10 — K3)** withdraws the source's pending approval (§7.4) |
| `merged → active` | Baskets only: `undo-merge` of a login merge within 15 min (§7.2). **(rev 10 — D-R5-25)** Never for a proposal: rev 8's `merged → active \| expired` reopening is withdrawn (§7a.7) |

A `locked` cart that a client tries to mutate returns `423 Locked` with the checkout session id, not a generic error — the client needs to know to send the buyer back to checkout.

### 9.1 The checkout lock contract (rev 10 — C1, C2, C7, K8, D-R5-16, D-R5-22, D-R5-23, D-R5-26)

```typescript
cart.lock({
  cartId, tenantId, organizationId,
  checkoutSessionId: string,
  lockTtlMs?: number,                    // 60_000..86_400_000; default 1_800_000 (30 min)
  purpose?: 'order' | 'quote',           // default 'order' (§9a.6)
  routeContext?: ResolvedCartRouteContext,  // required for a storefront cart unless this is an extend
}) → { cart: CartView; priceChanges?: PriceChange[]; extended: boolean }

cart.unlock({ cartId, tenantId, organizationId, checkoutSessionId })

cart.markConverted({
  cartId, tenantId, organizationId, checkoutSessionId,
  salesOrderId?: string,
  salesQuoteId?: string,
  lineMap?: Array<{ cartLineId: string; salesOrderLineId?: string; salesQuoteLineId?: string }>,
})
```

- **Session binding (C1).** `unlock`, `markConverted` and `getSalesSnapshot` require the `checkoutSessionId` the cart was locked with. A mismatch, or a cart that is not locked, is the uniform `404`, so a stale session cannot unlock or convert a cart another session now holds.
- **Lock TTL and extend (C1).** `lockTtlMs` is bounded (60 s–24 h) and defaults to the existing 30 min. Checkout extends the lock when its session enters `awaiting_payment` to cover the payment intent's TTL, and compensates through its own `expire-awaiting-payment` job before the lock can lapse. Extending is idempotent and runs nothing but the TTL update. `release-stale-locks` (§12) is unchanged: it unlocks only past `lock_expires_at`. An extend never changes `purpose`, so checkout unlocks and locks again when the buyer switches between a quote request and an order.
- **Route context (C2).** A fresh (non-extend) lock of a `storefront` cart without `routeContext` is refused with `400 assortment_scope_required_for_storefront_channel`. This adds the assertion Release 4 deferred in `commands/lock.ts` "until a real caller exists". Checkout builds the context from the buyer's request with `{ fresh: true }`. **Recovery (X15, D-R5-22)** has no request: it builds the context with `resolveForBuyer({ tenantId, organizationId, storeId: cart.storeId, customerUserId: cart.customerUserId, customerId: cart.customerId })` from the cart's stored identity, never from request input, under `buildTrustedCommandContext` (§3.1a). A non-storefront cart needs no scope; its identity is refreshed per §6a.4.
- **Order of checks on a fresh lock.** Status (`409 cart_not_active`; another session's lock `423 cart_locked`) → whole-cart re-price → visibility pass (`409 cart_has_unavailable_lines`) → approval gate (§9a, skipped for `purpose: 'quote'`) → set the lock columns. Any `priceChanges` are returned, and checkout aborts on them per its own contract.
- **Conversion payload (K8, D-R5-16, D-R5-26).** Checkout B.4 always sends `salesOrderId` + `lineMap` with `salesOrderLineId` for the order outcome, and `salesQuoteId` + `lineMap` with `salesQuoteLineId` for the `request_quote` outcome. The fields stay optional in the signature (additive), but Release 5 checkout treats them as mandatory. Every `cartLineId` must be a live line of the cart, and every customer line must appear exactly once. A malformed map is refused with an internal `400` and nothing is written. Gift lines (`origin: 'promotion'`) are mapped like any other line. Both ids and the map are emitted on `cart.cart.converted` (§11).
- **Store, channel and currency (C9, X13).** Consistency between the cart and the checkout session is checkout's precondition, not a lock check. The lock result's `cart` carries `storeId` (null for link and API carts, where checkout skips the store comparison), `channel` and `currencyCode` for it.
- **Snapshot read (C7).** `cartService.getSalesSnapshot` (§3.1a) is the only source checkout uses to build the quote. It reads the locked cart, so it equals what the lock priced.

---

## 9a) Approval Gate (rev 10 — K1–K5, D-R5-3, D-R5-4, D-R5-12, D-R5-23, D-R5-29, D-R5-32)

Through Release 4 nothing computed `requires_approval` (always written `false`) and `cart.lock` ignored approval entirely. Checkout's precondition was then the only control, and it had no data to read. This section is the rule cart, `customer_groups` and checkout all follow.

### 9a.1 Basis and currency (K1, D-R5-4)

- **Amount basis.** `totals.grandTotalGrossAmount` of the cart: goods after promotions, **excluding delivery** (cart-stage totals never include it, D-R4-14/D-R5-17). The same figure is `CustomerPurchaseApproval.amount_gross` at request time, and checkout's approval precondition uses it too. Checkout never compares its delivery-inclusive total with an approval, because under D-R5-3 adding shipping would otherwise invalidate every approval. (Credit uses the full payable amount, D-R5-24; that is a different basis on purpose.)
- **Threshold and currency.** Terms are resolved by `customerGroupsService.resolveTerms({ customerIds: cart.customerIds, tenantId })` for the cart's own buyer identity, so every channel is covered (D-R5-29). The threshold is `approvalRequiredAbove`, in `termsCurrencyCode`. The amounts are compared only when the cart's `currency_code` equals `termsCurrencyCode`. `resolveTerms` already falls back to the organization's base currency when no group sets `termsCurrencyCode` (D-R5-37). In every other case where a threshold is set, including a `termsCurrencyCode` still `null` because the organization has no base currency, approval is required (fail-closed, no FX conversion).
- **No threshold** (`approvalRequiredAbove` null after inheritance): approval is never required.

### 9a.2 Computing `requires_approval` (K2)

`requires_approval = threshold set AND (currency mismatch OR goods gross > threshold)`.

It is recomputed inside the totals phase of every command that changes `Cart.totals` (line writes, promotions, merge, reprice, proposal acceptance on the target) and again at `cart.lock` from **fresh** terms. The threshold is deliberately not part of `buyer_digest`, so a terms change would not otherwise re-trigger a re-price. The stored flag is for display only; the lock never trusts it.

### 9a.3 The gate in `cart.lock` (K2, D-R5-12, D-R5-29)

On a fresh lock with `purpose: 'order'`, after the visibility pass:

1. Recompute `requires_approval` from fresh terms. If false, pass.
2. If the cart has no `customer_user_id`, refuse with `409 approval_requires_identified_buyer`. A guest cannot request approval (X7: only a `CustomerUser` requests in Release 5). After login, the merge re-prices the basket under the customer's own group, which then follows the normal path (D-R5-12). `customer_groups` warns in its terms form when a threshold is set on the tenant's default group, and names guest orders and pay links in that warning.
3. Read `Cart.approval_id` live through `customerPurchaseApprovalService.getApproval`. It **qualifies** when its status is `approved`, its `currencyCode` equals the cart's, and its `amountGross ≥` the current goods gross. If it qualifies, pass. Otherwise refuse with `409 cart_requires_approval`, body `{ code, approval: { id, status, amountGross, currencyCode } | null, amountGross, currencyCode }`.

The approval policy (`buyer | merchant | both`, D-R5-1) is opaque to the cart: it reads only the final status. No channel is exempt (D-R5-29): `pay_link`, `api` and `agent` carts run the same gate using the identity from §6a.4. An extend (§9.1) skips the gate, since the lock it extends already passed it.

### 9a.4 Requesting, and the approval across the cart's lifecycle (K3, K4, D-R5-3, D-R5-27)

`cart.approval.request` (route `POST /api/cart/current/request-approval`, §10) is the only way a cart's approval is created. There is no public create route in `customer_groups`, and the amount comes only from the server-side totals.

1. Preconditions: an identified basket with the matching session (§8.4); otherwise `409 approval_requires_identified_buyer`. `merged`/`expired`/`converted` → `409 cart_not_active`; `locked` → `423 cart_locked`; `abandoned` reactivates as for any basket mutation (§9).
2. Recompute `requires_approval` from fresh terms. False → `409 approval_not_required`. A current approval that already qualifies is also `409 approval_not_required`.
3. If `approval_id` names a `pending` approval whose amount and currency still cover the cart, return it (`200`): the request is idempotent while pending. If the pending approval no longer covers the cart, `cart` withdraws it first.
4. Otherwise call `customerPurchaseApprovalService.requestApproval({ scope, customerId: <the company in cart.customerIds, per customer-groups G11>, requestedBy: { actorType: 'customer_user', actorId: cart.customerUserId }, subjectType: 'cart', subjectId: cart.id, amountGross: <goods gross, decimal string>, currencyCode: cart.currencyCode })`. The requester comes from auth, never the body. The expiry is `customer_groups`' default (14 days, per tenant, D-R5-27).
5. Write `approval_id` (it moves to the new request) and `awaiting_approval_since = now`. After commit, emit `cart.approval.requested` (§11) when a new approval was created.

Only one approval is authoritative: `Cart.approval_id`. An older approved approval that still names this cart as its subject is never read by cart or checkout.

| Cart event | Effect on its approval |
|---|---|
| Lines or totals change, goods gross at or below the approved amount | Approval stays and still qualifies (D-R5-3: only a higher total invalidates) |
| Goods gross rises above the approved (or pending) amount | Approval stays on the cart but no longer qualifies; the buyer re-requests, which withdraws a pending one first and moves `approval_id` |
| Merged into another cart (source side) | Pending: `withdrawApproval`, `awaiting_approval_since` cleared (§7.4). Approved: left as is, unusable because the source is terminal |
| Merge target (login merge or proposal acceptance) | Recomputed; the target's approval qualifies only if it still covers the new total (§7.4) |
| Undo of a login merge | Target recomputed; a withdrawn source approval is not restored |
| Expired (`expire-carts`) or purged | Pending: `withdrawApproval` (cart expiry ends a request earlier than the 14-day approval expiry, D-R5-27) |
| Abandoned | Never while `awaiting_approval_since` is set (K5); an approved or rejected approval does not block abandonment |
| Converted | Approved: left `approved`; the cart is terminal, so it cannot be reused. Pending (a `purpose: 'quote'` conversion, §9a.6): withdrawn |
| Approval decided or expired in `customer_groups` | §9a.5 subscriber clears `awaiting_approval_since`; `approval_id` is unchanged |

Withdrawals are calls from cart commands and sweepers into the approval service, with actor `system`. They are idempotent: an approval that is no longer `pending` (`409 approval_not_pending` from `customer_groups`) counts as already settled.

`CartView.approval` (§10.1) is read live in one batched call per request, never denormalised.

### 9a.5 The approval subscriber (K5)

A persistent, idempotent `cart` subscriber on `customer_groups.approval.approved | rejected | expired | withdrawn` handles payloads with `subjectType = 'cart'`. It filters on `tenantId`/`organizationId` first, then loads the cart by `subjectId`. When the cart's `approval_id` equals the event's `approvalId`, it clears `awaiting_approval_since`; otherwise it does nothing. It changes no other column and emits nothing. The write bumps `updated_at` like any server-side change. A buyer whose next write carries the older value gets the standard `409` with the current cart embedded (§8.1), which is the right prompt to re-read after a decision. Checkout resumes its own sessions with its own subscriber on the same events (checkout C11). The cart is the canonical subject (D-R5-3), and the session stores no approval id (X6).

### 9a.6 Quote requests skip the gate (D-R5-23)

`cart.lock({ …, purpose: 'quote' })` is how checkout locks for the `request_quote` payment method (D-R5-20). With `purpose: 'quote'` the approval gate (§9a.3) is skipped. The re-price and the visibility pass still run, and so do checkout's own store/channel checks (§9.1). `min_order_value` is checked by checkout, never by the cart (cart exposes only `purpose`); checkout skips it for a quote as well. Approval returns at quote acceptance (`subject_type: 'quote'`), which is outside Release 5: the merchant converts the quote. `markConverted` after a quote outcome withdraws a pending cart approval (§9a.4).

### 9a.7 What the cart does not own

Who may decide, the decision slots, notifications and e-mail (D-R5-6, D-R5-32), the approval's own expiry job, and the portal decide routes all belong to `customer_groups`. `cart.approval.requested` is a state signal only. Checkout's `/api/checkout/sessions/current/request-approval` delegates to `cart.approval.request` rather than creating an approval of its own.

---

## 10) API Contracts

**Base `/api/cart`, basket routes header-bound at `/api/cart/current/*` (rev 9 — C7/D-R4-6, §16 Q5 closed, replacing rev 8's `:token` path segment).** The credential is the `X-Cart-Token` header alone — never a path segment, never a query string, never a cookie the platform reads itself (the storefront app owns an httpOnly cookie and forwards it as this header). Every request body is `.strict()` and carries no `assortmentScope`, `channel`, `storeId` or `salesChannelId` field (§6a.1a) — scope, store and channel are resolved from `storeContextService` at the route edge, not from the body. Every mutating route accepts the expected `updatedAt` (via the standard optimistic-lock header or a typed body field — §8.1) and `Idempotency-Key`.

**Binding rule (rev 10 — D-R5-21, §8.4).** Every `/current/*` route and every buyer `/proposals/*` route answers `404`, with the unknown-cart body, when the basket has `customer_user_id` and the request lacks that buyer's customer session (cookie or Bearer customer JWT). Guest baskets stay token-only.

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
| POST | `/current/undo-merge` | Reverse within 15 min; refuses a proposal acceptance with `409 merge_undo_not_supported_for_proposal` (rev 10 — D-R5-25) |
| POST | `/current/reprice` | Force re-price |
| POST | `/current/request-approval` | B2B; `cart.approval.request` (§9a.4) — contract below (rev 10) |
| GET | `/proposals` | Live proposals addressed to the presented token's basket, newest first (§7a). Token in header, plus the binding rule |
| POST | `/proposals` | Author a proposal (`cart.proposal.create`, §7a.2); body names `targetCartId`. `cart.proposals.author`; **no** cart token at all — see below |
| POST | `/proposals/:proposalId/preview` | Pre-flight re-price + dry-run visibility pass; creates nothing; returns `acceptancePreview` + `acceptanceToken`. Token in header, plus the binding rule |
| POST | `/proposals/:proposalId/accept` | Per-line acceptance; delegates to `cart.merge` with `strategy: 'manual'`. Token in header, plus the binding rule |
| POST | `/proposals/:proposalId/reject` | Terminal; touches the target cart not at all. Token in header, plus the binding rule |
| GET | `/carts` | Admin list (rev 10 — K6, §10.2). `cart.carts.view` |
| GET | `/carts/:id` | Admin detail (§10.2). `cart.carts.view` |
| POST | `/carts/:id/reprice` | Admin forced re-price, trigger 7 (§10.2). `cart.carts.manage` |

`cart.lock`/`.unlock`/`.markConverted` and `cartService.getSalesSnapshot` have **no public route** (F7/C6, §9.1) — `checkout` calls the DI service/command directly, in-process.

**`POST /current/request-approval` (rev 10 — K4).**
- Body: `{}` (`.strict()`; amount, currency, requester and subject come from the server, never the body). `Idempotency-Key` and the optimistic-lock header are accepted as on every mutation.
- Auth: `X-Cart-Token` plus the matching customer session (§8.4). A guest basket gets `409 approval_requires_identified_buyer`.
- `200`: the §10.1 envelope with `cart.approval` populated and `cart.awaitingApprovalSince` set. The same pending approval is returned on repeat (idempotent while pending, §9a.4).
- Errors: `409 approval_not_required`, `409 approval_requires_identified_buyer`, `409 cart_not_active`, `423 cart_locked`, `404` (unknown cart or binding failure), `503` when `customer_groups`' approval service is not registered.
- Rate limit: `CART_MUTATE` (§15a).

**Authoring is the one route on this base path that a cart token cannot reach.** The proposal routes (rev 8) are addressed by proposal id with the buyer's basket token in the `X-Cart-Token` header, never the path (§7a.4, §8.3). `GET`, `preview`, `accept` and `reject` are token-bound like the rest of `/api/cart`, because they are the buyer acting on their own basket and a guest buyer has no session to present. `POST /proposals` is the opposite: it is somebody *other* than the buyer writing, so it requires an authenticated principal holding `cart.proposals.author` — a staff `auth.User`, or an AI agent principal (`users.kind = 'agent'`). It takes the target as `targetCartId` and accepts no cart token. Letting a leaked cart token author proposals into its own cart would hand an attacker a way to put priced lines in front of a buyer under the store's own branding, which is R15.

Admin keeps `/api/cart/carts`, `/api/cart/carts/[id]` and `/api/cart/carts/[id]/reprice` (Phase 4, §10.2) — a distinct dynamic-segment name from the public `/current` base, so the two never collide in one Next.js route tree (this was rev 8's W2/§9 concern under the old `:token` shape; it does not arise under `/current`).

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
    approval: { id: string; status: string; amountGross: string; currencyCode: string; qualifies: boolean } | null   // rev 10 — read live (§9a.4)
    awaitingApprovalSince: string | null                                                                          // rev 10 — K5
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

**(rev 10 — K6, X5.)** Three staff routes, organization-scoped (`organizationIds` from the caller's scope, never across tenants), never returning `token_hash` or any token.

**`GET /api/cart/carts`** — `makeCrudRoute` list with `indexer: { entityType: E.cart.cart }`, `cart.carts.view`.
- Filters: `kind` (default `basket`; `proposal` accepted and additionally requires `cart.proposals.view`, else `403`), `proposedToCartId` (with `kind=proposal`), `status`, `channel`, `storeId`, `customerId`, `requiresApproval`, `awaitingApproval` (boolean on `awaiting_approval_since`), `lastActivityFrom`/`lastActivityTo`, `ids` (the shared multi-id filter).
- Sort: `lastActivityAt` (default, descending) or `grandTotalGrossAmount`. `pageSize ≤ 100`.
- Row: `id`, `kind`, `status`, `channel`, `storeId`, `customerId`, `customerUserId`, `email` (decrypted), `currencyCode`, `grandTotalGrossAmount`, `lineCount`, `requiresApproval`, `approvalId`, `awaitingApprovalSince`, `proposedToCartId`, `lastActivityAt`, `expiresAt`, `updatedAt`.
- `email` and `note` are encrypted (§17), so the list decrypts through the query engine and offers **no free-text e-mail search**: an `$ilike` on ciphertext matches nothing and fails silently. Staff search by `customerId` instead.

**`GET /api/cart/carts/:id`** — `cart.carts.view` (`cart.carts.view` + `cart.proposals.view` for a proposal). Returns the §10.1 `cart` view without `token`, plus `email`/`note` decrypted, `kind`, `channel`, `storeId`, `customerId`, `customerUserId`, `proposedToCartId`, line `added_by_actor_*`, `warnings`, the approval read live (§9a.4; `null` with no error when `customer_groups`' approval service is absent), and the `CartMergeLog` entries where the cart is source or target (`id`, `strategy`, `createdAt`, `mergedByActorType`, `proposalCartId`). The assisted-selling console reads a buyer's basket through this route (cross-spec review, "Duplicated mechanisms: admin cart reads").

**`POST /api/cart/carts/:id/reprice`** — trigger 7, `cart.carts.manage`, body `{}` `.strict()`.
- The optimistic-lock header is **required** for this route: a missing header is `400`, a stale one the standard `409` with the cart embedded (§8.1).
- Runs `cart.reprice` whole-cart for a `kind = 'basket'` cart in `active` or `abandoned` status. Identity is refreshed through `resolveForBuyer` from the stored identity, with `cart.storeId` when present, so a storefront cart also gets the §6a.2 visibility pass against its buyer's current scope (D-R5-22).
- It is not buyer activity: it neither reactivates an `abandoned` basket nor moves `last_activity_at`.
- Response: the §10.1 envelope with `versionBumpReason: 'repricing'` and `priceChanges`. Errors: `423 cart_locked`, `409 cart_not_active`, `404` (unknown id, other organization, or a proposal — a proposal re-prices only from its target, §7a.2).

**Backend pages.** `/backend/cart/carts` (a `DataTable` with `entityId: 'cart:cart'`, `extensionTableId: 'cart.carts'`, the filters above, `kind` defaulting to baskets) and `/backend/cart/carts/[id]` (read-only detail with a Re-price action wrapped in `useGuardedMutation(...).runMutation(...)` with `withScopedApiRequestHeaders(buildOptimisticLockHeader(cart.updatedAt), …)`, conflicts surfaced by `surfaceRecordConflict`). `LoadingMessage`/`ErrorMessage` states; every string in `cart/i18n/{de,en,es,ko,pl}.json`.

**Staff never edit a buyer's basket. They author proposals (rev 7, unchanged).**
- Inspection and the forced re-price above are the only staff operations on a buyer's basket.
- Any *content* change a staff member wants in a buyer's basket is authored as a proposal cart (§7a) and takes effect only when the buyer accepts it.
- There is no admin route that adds, updates or removes a line on a cart the staff member does not own. The absence is deliberate and is asserted by a route-enumeration test (§14). A prohibition with no alternative gets closed by whoever is under pressure first, usually with a direct write; the proposal seam is the alternative.
- Staff cannot request approval for a buyer either (X7): `staff_user` stays a reserved requester type in `customer_groups`, and no Release 5 route accepts it.

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

`cart.proposals.author` gates the write and nothing else: it says a principal may put a priced basket in front of a buyer. Which buyers, in which conversation, under which store mode — that is `assisted_selling`'s to decide, and it holds its own features. Acceptance and rejection carry **no** feature: they are the buyer acting on their own cart through their own token (and session, §8.4), and a guest buyer has no ACL identity to check. The author-side rejection (§7a.5) requires `cart.proposals.author`. `cart.proposals.view` gates proposal rows in the admin list and detail (§10.2).

**(rev 10)** No new feature is added. `request-approval` is a buyer route and carries none; approval decisions are `customer_groups`' features. `setup.ts` grants are unchanged: `employee` keeps `cart.carts.view`, and `cart.carts.manage` and `cart.proposals.*` stay with `admin` (`cart.*`) or are granted by hand, the same least-privilege line as D-R5-7.

---

## 11) Events

```typescript
'cart.cart.created' | '.updated' | '.expired' | '.abandoned' | '.merged' | '.adopted' | '.converted' | '.purged'
'cart.line.added' | '.updated' | '.removed'
'cart.promotion.applied' | '.removed' | '.no_longer_valid'
'cart.price.changed'          // payload: per-line old/new and reason
'cart.approval.requested'         // rev 10 — payload below; state signal only (D-R5-32)
'cart.lock.acquired' | '.released' | '.timed_out'
'cart.line.visibility_rejected'   // added 2026-09-06 — §6a
'cart.proposal.created' | '.accepted' | '.rejected' | '.expired'   // added 2026-09-22 — §7a
'cart.proposal.acceptance_undone'                                   // added 2026-09-27 — rev 10: declared, never emitted (§7a.7, D-R5-25)
```

**Scope on every payload (rev 10 — S3, D-R5-32).** Every event payload this revision adds or extends carries `tenantId` and `organizationId`, and every subscriber (in `cart` or elsewhere) filters on them before it loads anything by id. The payloads below are the full Release 5 shapes. Fields are only ever added (§16a).

**(rev 9 — D-R4-23).** `cart.line.visibility_rejected` is emitted **once per request**, carrying `{ cartId, tenantId, organizationId, productId: string | null, variantId: string | null, rejectedCount, reason: 'not_in_assortment', triggeredBy: 'add' | 'update' | 'bulkAdd' | 'merge' | 'reprice' | 'checkout_lock' | 'proposal_create' }` (rev 10 — S13/K13 adds `proposal_create`; for that value `cartId` is the target basket, since no proposal cart may exist yet) — never once per line, which rev 8 implied for a multi-line `bulkAdd` or merge rejection. `tenantId`/`organizationId` are explicit on the payload rather than assumed from context, so an operator dashboard can aggregate across tenants without a join. It is emitted by every enforcement point (§6a.1a–c, §6a.2, §6a.5). It is **not** `clientBroadcast` — the buyer already sees the `product_unavailable` warning in the response body; this is the operator-facing signal, so a merchant who narrows a group's `assortment_scope` too far, or misconfigures a channel's `require_authentication`, sees a trend instead of scattered support tickets. Same reasoning as `availability.shortfall.detected` and `customer_groups.credit.limit_exceeded`.

The four lifecycle `cart.proposal.*` events carry `{ proposalCartId, targetCartId, tenantId, organizationId, authoredByActorType, authoredByActorId, lineCount }` (rev 10 — S3 adds the scope; the author is read from the proposal's lines, §4.1). `.accepted` additionally carries `mergeLogId` and `acceptedLineCount`; `.rejected` additionally carries `rejectedBy: 'buyer' | 'author'` (rev 10, §7a.5). `cart.proposal.acceptance_undone` is never emitted from rev 10 (§7a.7). They are `clientBroadcast: true` so a rep's console reflects a buyer's decision without polling, and — once the transport of [`assisted_selling`](./2026-09-22-assisted-selling.md) exists — they are the events its buyer-facing bridge relays. Like every other broadcast event in this platform they are a **signal, not a payload**: the recipient re-reads state through the API. They deliberately carry no line, price or total.

`cart.cart.converted` gains a payload requirement in rev 7, because commission attribution depends on it. **(rev 10 — K8, D-R5-16, D-R5-26)** Release 4 emitted only `{ cartId, tenantId, organizationId }`; the Release 5 payload is:

```typescript
{ cartId, tenantId, organizationId, checkoutSessionId,
  salesOrderId: string | null,           // order outcome
  salesQuoteId: string | null,           // request_quote outcome (D-R5-26)
  lineMap: Array<{ cartLineId: string; salesOrderLineId?: string; salesQuoteLineId?: string }> | null }
```

Checkout B.4 passes these to `cart.markConverted` (§9.1) and Release 5 treats `lineMap` as mandatory (D-R5-16). Checkout holds the mapping at creation time: it writes `metadata.cartLineId` on each quote line, and `convert_to_order` copies it onto the order line (checkout C18). Where `lineMap` is absent, a consumer degrades to order-level attribution and says so (`assisted_selling.attribution.degraded`); it never guesses the mapping from product identity, because a cart may legitimately hold two lines of the same product with different `configuration_hash`. Re-linking quote-line attribution after the quote later converts to an order is outside Release 5.

`cart.line.visibility_rejected`'s `triggeredBy` enum gains `'merge'` (§6a.5) and, in rev 10, `'proposal_create'` (§7a.2) — additional values on an existing event, not new events.

**`cart.approval.requested` (rev 10 — K7, D-R5-32).** `{ cartId, approvalId, tenantId, organizationId, customerId, customerUserId, amountGross, currencyCode }`, emitted after commit by `cart.approval.request` only when a new approval was created (an idempotent repeat emits nothing). `customerId` is the company the approval was requested for. It is a state signal for consumers that follow a cart, not a notification: `customer_groups` alone notifies deciders and requesters (in-app and e-mail, D-R5-6). Not `clientBroadcast`. It keeps a cart-side consumer from depending on `customer_groups` events to follow a cart.

**Lifecycle payloads (rev 8).** Rev 7 had consumers subscribing to `cart.cart.merged` with no payload defined. Signal-only, like everything else here — ids, never a token:

| Event | Payload |
|---|---|
| `cart.cart.merged` | `{ sourceCartId, targetCartId, tenantId, organizationId, kind: 'basket' \| 'proposal', mergeLogId, strategy, proposalCartId: string \| null, customerId, customerUserId }` — `kind` is the **source** cart's, so a consumer tracking baskets filters out proposal acceptances. Rev 10 (S3) adds the scope |
| `cart.cart.adopted` | `{ cartId, tenantId, organizationId, customerId, customerUserId }` — §7.1's "customer cart empty" row re-owns the guest cart and rotates its token without merging anything. Rev 10 (S3) adds the scope |
| `cart.cart.purged` | `{ cartId, tenantId, organizationId, kind, proposedToCartId: string \| null }` — emitted per cart by `purge-expired-carts`, so a consumer holding a cart id learns it no longer resolves. Rev 10 adds the scope |
| `cart.cart.abandoned` | **(rev 10 — K9)** `{ cartId, tenantId, organizationId, storeId, channel, customerId, customerUserId, hasEmail, currencyCode, grandTotalGrossAmount, lineCount, lastActivityAt }` — Release 4 emitted `{ cartId }` only. No e-mail address and no line detail: a recovery flow re-reads through the admin API |

`cart.cart.abandoned` is emitted for baskets only; a proposal's rejection is `cart.proposal.rejected`.

`cart.cart.abandoned` is the hook for recovery flows (out of scope here; checkout B.6 / workflows). `cart.price.changed` feeds analytics on how often snapshots go stale, which is how the staleness budget gets tuned with evidence.

`clientBroadcast: true` on line and totals events so a second tab updates via the DOM Event Bridge instead of polling.

---

## 12) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `mark-abandoned-carts` | every 15 min | `active` → `abandoned` past the inactivity window. `kind = 'basket'` only — a proposal is never abandoned by inactivity (§7a.1). **(rev 10 — K5)** Skips baskets with `awaiting_approval_since` set (a column filter, no call into `customer_groups`). **(rev 10 — K11)** Releases code reservations by `cartId` (`codeService.releaseCode`) for each abandoned basket; a basket that returns re-reserves on its next evaluation, or drops the code with `cart.promotion.no_longer_valid`. Emits `cart.cart.abandoned` with the K9 payload (§11) |
| `expire-carts` | hourly | Baskets: expire past TTL, set `resolved_at`, release code reservations by `cartId` (rev 10 — K11, closing the Release 4 deferral in `lib/sweepers.ts`), withdraw a pending approval (rev 10 — K3, §9a.4). **(rev 10 — S15/K15)** Proposals: `kind = 'proposal'` rows past their own `expires_at` (§7a.3) → `expired`, `resolved_at` set, reservations released by `cartId`, `cart.proposal.expired` with scope (§11). An expired proposal is kept readable, never deleted here |
| `release-stale-locks` | every 5 min | `locked` → `active` past `lock_expires_at` (which an extend moves forward, §9.1). Proposals are never locked |
| `purge-expired-carts` | daily | Hard-delete carts whose `resolved_at` is more than 90 days old, retaining the merge log; carts still referenced by `CartMergeLog` are excluded; emits `cart.cart.purged` with scope per cart. **(rev 10 — S15/K15)** Covers `kind = 'proposal'` as well (§16 Q6): rejected and expired proposals purge 90 days after `resolved_at`; accepted proposals stay while `CartMergeLog.proposal_cart_id` references them. Withdraws a pending approval left on a purged basket (normally already withdrawn at expiry) |

**(rev 10) One persistent subscriber**, not a job: `customer_groups.approval.approved | rejected | expired | withdrawn` → clear `awaiting_approval_since` (§9a.5).

Release 4 filtered all four sweepers on `kind = 'basket'`, so no proposal would ever have been retired. The rev 10 branches are the K15 work. Every sweeper keeps its per-tenant scheduling (`registerCartSweeperSchedules`) unchanged.

---

## 13) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Cart and order totals diverge | **Critical** | `cart`, `sales` | The cart rounds a tax amount differently from the order it produces; the buyer accepts 123,00 zł and is invoiced 123,45 zł. Consumer-law exposure and a reconciliation problem on every affected order. | ADR-2: all arithmetic through `salesCalculationService`; totals stored verbatim; a property-based test over the tax-rate matrix asserts cart totals equal order totals for the same lines — a Phase 2 gate | Low |
| R2 | Guest cart silently destroyed on login | **High** | `cart` | A buyer assembles a basket on mobile, logs in, and a `replace` merge deletes the desktop cart they were about to buy. Unrecoverable and invisible. | Documented policy (§7.1) defaulting to `sum`; `CartMergeLog` retains the full pre-merge snapshot; `mergeSummary` disclosed; 15-minute undo | Low |
| R3 | Re-pricing indistinguishable from a conflict | Medium | `cart` | The server re-prices on read, bumping the version; the client's next mutation 409s though nothing concurrent happened. Repeated, it looks like a broken cart. | `versionBumpReason: 'repricing'`; the 409 body embeds the current cart so the client reconciles in one round trip; re-price on read only past the staleness budget | Low |
| R4 | Undisclosed price increase | **High** | `cart`, legal | A promotion expires between add and checkout; the total rises silently and the buyer pays more than they agreed. | `priceChanges` on every response where a snapshot changed; `cart.price.changed` event; spec 10 requires the UI to surface it; checkout re-prices and must re-confirm | Low |
| R5 | Promotion evaluation cost | Medium | `cart`, `promotions` | Every mutation evaluates the full rule tree; a 50-line B2B quick order triggers 50 evaluations. | `/lines/bulk` evaluates once for the batch; SPEC-055's lightweight product-page variant used where a full pass is not needed; evaluation latency budgeted at P95 < 150 ms for a 50-line cart | Medium — depends on SPEC-055's engine performance, measured at the Phase 2 gate |
| R6 | Cart token leakage | **High** | `cart` | A token in a URL path reaches referrer headers, server logs and analytics; anyone holding it reads and mutates the basket, including the buyer's email. | 32+ byte CSPRNG token; `X-Cart-Token` header only (the platform reads no cookie for it), never a path segment; only `token_hash` stored; rotated on merge and adoption; per-token rate limit; `email` encrypted at rest; **(rev 10)** an identified basket additionally needs its buyer's session (§8.4), so a leaked token alone reaches only guest baskets | Low |
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
| R17 | Over-threshold cart reaches checkout without approval | **Critical** | `cart`, `customer_groups`, `checkout` | Release 4 never computes `requires_approval` and `cart.lock` ignores approval; a buyer above their group's `approval_required_above` locks, pays and gets an order their company never authorised (K2). | §9a.3: the gate runs inside `cart.lock` on fresh terms, reads the approval live, and refuses `409 cart_requires_approval`; one amount basis for cart, approval and checkout (K1); currency mismatch and guests fail closed (D-R5-4, D-R5-12); no channel exemption (D-R5-29). `TC-CART-APR-*` | Low |
| R18 | A kept token strips an identified basket's identity | **High** | `cart`, `assisted_selling` | A storefront keeps the cart token after logout on a shared workstation; the next anonymous request re-identifies the basket as a guest, disclosing contract prices and opening its proposals to the token alone (X1). | §8.4 (D-R5-21): an identified basket answers `404` to any request without its buyer's session on every buyer route; re-identification runs guest → identified only. `TC-CART-BIND-*` | Low — a stolen token *and* session remain a full compromise, as on any platform |
| R19 | Cart lock lapses mid-payment | **High** | `cart`, `checkout` | `release-stale-locks` unlocks at 30 min while the buyer is on a slow payment page; the buyer edits the cart, the session completes, `markConverted` fails and the basket is buyable again — a second order from one basket (C1). | §9.1: `lockTtlMs` and an idempotent extend bound to `checkoutSessionId`; `unlock`/`markConverted` require the matching session (uniform 404); checkout compensates before the lock can lapse. `TC-CART-LOCK-*` | Low |
| R20 | Abandonment nags a buyer waiting on their own approver | Medium | `cart` | Approval takes days; at 24 h of inactivity the cart turns `abandoned`, recovery mail goes out, and code reservations are released under a buyer who did nothing wrong (K5). | `awaiting_approval_since` excludes the basket from `mark-abandoned-carts`; cleared on decision by the §9a.5 subscriber | Low |
| R21 | An approval covers lines it never saw | Medium | `cart`, `customer_groups` | An approval granted for cart A survives a merge that adds a guest cart's lines, or is reused after conversion (K3). | Approval qualifies only while its amount covers the current goods gross (D-R5-3); source-side withdrawal on merge, withdrawal on expiry; converted carts are terminal (§9a.4 table) | Low — same-or-lower totals with different lines still pass, which D-R5-3 accepts on purpose |
| R22 | The trusted context becomes a channel-feature bypass | **High** | `cart`, `checkout` | A system context minted from request input, or accepted for any channel, lets an anonymous caller create `api`/`agent` carts and skip §6a enforcement (R11 by a third route). | §6a.4: `buildTrustedCommandContext` is reachable from no HTTP input; a `system` actor is accepted for `channel: 'pay_link'` only, after checkout's link checks, with tenant and organization from the link; lines only from the merchant template; audited as system-initiated. A test asserts a `system` context cannot create any other channel | Low |
| R23 | A proposal is retired never, or by the wrong rule | Medium | `cart`, `assisted_selling` | The Release 4 sweepers filter `kind = 'basket'`, so a live proposal would outlive its TTL forever and a resolved one would never purge (K15). | §12 proposal branches: expiry at own `expires_at` with `cart.proposal.expired`, purge 90 days after `resolved_at` unless referenced by `CartMergeLog`, never abandoned by inactivity. `TC-CART-SWP-*` | Low |

---

## 14) Integration Coverage

**Gate re-cut (rev 9 — W13/D-R4-29), replacing rev 8's inconsistent Phase 1/2 split:**
- **Phase 1 gate:** line CRUD, snapshotting, the R1 assortment-visibility suite (built into the first line command, §6a), idempotency, concurrency, and the four sweepers.
- **Phase 2 gate:** triggers 1–4 and 7 each verified in isolation (no other action re-prices), quantity tiers and `nextTier`, quantity rules, and the totals-equivalence property test **without promotions**.
- **Phase 3 gate:** triggers 5 and 6, the R13 merge-visibility suite, promotions integration (code application, reservations), the lock/convert surface, the totals-equivalence property test **with promotions** (built via the existing `sales` create command against an order from the cart's own lines), and the P95 ≤ 150 ms benchmark at 200 promotions × 50 lines.
- **(rev 10) Phase 4a gate:** `TC-CART-BIND-*`, `TC-CART-LOCK-*`, `TC-CART-TRUST-*`, `TC-CART-ADM-*`, `TC-CART-SWP-01/02/05`, `TC-CART-B2B-05`.
- **(rev 10) Phase 4b gate:** `TC-CART-APR-*`, `TC-CART-B2B-03`.
- **(rev 10) Phase 4c gate:** `TC-CART-PROP-*`, `TC-CART-SWP-03/04`. These replace the inert-seam pin test the cart analysis proposed (K12) for the case where the seam was deferred; the seam ships (D-R5-11, X5).

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
- `TC-CART-B2B-03` Over `approval_required_above` sets `requiresApproval` and blocks the checkout lock (rev 10: moves to the Phase 4b gate; the full suite is `TC-CART-APR-*`)
- `TC-CART-B2B-04` Net tax mode from group terms reflected in totals
- `TC-CART-B2B-05` (rev 10 — K17, Phase 4a gate) `POST /current/lines/bulk` with 100 entries calls `promotionsService.evaluate` exactly once (spy) and recomputes totals once; 101 entries are refused with `422` before any write

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

**Approval gate (`TC-CART-APR-*`, rev 10 — K17, Phase 4b gate; API-level, fixtures create the group, terms, company, `CustomerUser` and session through API):**
- `TC-CART-APR-01` Crossing the threshold sets `requiresApproval` on every totals change (add, update, remove, bulk, promotion apply/remove, merge, proposal acceptance) and clears it when the total falls back under
- `TC-CART-APR-02` `cart.lock` without an approval refuses `409 cart_requires_approval`, with the approval (`null`) and the goods gross in the body
- `TC-CART-APR-03` With an `approved` approval covering the goods gross in the cart currency, the lock succeeds; `POST /current/request-approval` returns `200` with `approval` and `awaitingApprovalSince`, repeats idempotently while pending, and emits `cart.approval.requested` once
- `TC-CART-APR-04` A total raised above the approved amount refuses the lock; a re-request withdraws nothing approved, moves `approval_id`, and the new approval unlocks; a lower total with different lines still locks (D-R5-3)
- `TC-CART-APR-05` A cart in a currency other than `termsCurrencyCode` always requires approval (D-R5-4); a threshold with no group-level currency is compared in the organization's base currency (D-R5-37), and only without a base currency does every cart require approval
- `TC-CART-APR-06` A guest cart over the threshold refuses the lock with `409 approval_requires_identified_buyer`, and `request-approval` on it answers the same; after login and merge the cart follows the normal path (D-R5-12)
- `TC-CART-APR-07` A basket with a pending approval is skipped by `mark-abandoned-carts` past the inactivity window; after `customer_groups.approval.approved` the subscriber clears `awaiting_approval_since` and the next sweep may abandon it (K5)
- `TC-CART-APR-08` The source's pending approval is withdrawn on a login merge and on expiry; a converted cart's approved approval cannot unlock any other cart; undo of a merge does not restore a withdrawn approval (K3)
- `TC-CART-APR-09` `purpose: 'quote'` locks an over-threshold cart without approval, still runs the re-price and visibility pass, and `markConverted` with `salesQuoteId` withdraws a pending approval (D-R5-23)
- `TC-CART-APR-10` A `pay_link` and an `api` cart with an identified buyer are gated exactly like a storefront cart, with terms resolved to the company through `resolveForBuyer` (D-R5-29, D-R5-22)
- `TC-CART-APR-11` `request-approval` with any body field is `400`; `409 approval_not_required` under the threshold; `423` on a locked cart; tenant and organization isolation (another organization's token and session cannot request against the cart)

**Identity binding (`TC-CART-BIND-*`, rev 10 — D-R5-21/D-R5-13, Phase 4a gate):**
- `TC-CART-BIND-01` For an identified basket, each `/current/*` route (GET, PATCH, lines, lines/bulk, lines/[lineId], promotions, promotions/[id], merge, undo-merge, request-approval) answers `404` with the unknown-cart body to the token alone, to the token with another buyer's session, and to the token with a staff JWT; the body is byte-identical to an unknown token's
- `TC-CART-BIND-02` Re-identification regression (X1): an anonymous `GET /current` with an identified basket's token leaves `customer_user_id`, prices and `updated_at` unchanged
- `TC-CART-BIND-03` A guest basket stays token-only; presenting a customer session identifies it (trigger 2), after which the token alone gets `404`
- `TC-CART-BIND-04` The same `404` cases on `GET /proposals` and `preview`/`accept`/`reject` for an identified target, accepted with the Bearer customer JWT and with the cookie
- `TC-CART-BIND-05` `POST /current/merge` with a `sourceToken` resolving another buyer's identified basket answers `404` and merges nothing
- `TC-CART-BIND-06` A replayed `Idempotency-Key` from the buyer's own request returns nothing to a request failing the binding (`404`, no stored response)

**Lock contract (`TC-CART-LOCK-*`, rev 10 — C1/C2/C7/K8, Phase 4a gate; service-level, called as checkout calls it):**
- `TC-CART-LOCK-01` A second `lock` with the same `checkoutSessionId` extends `lock_expires_at`, returns `extended: true`, and runs no re-price (spy) and no visibility pass; another session id gets `423 cart_locked`
- `TC-CART-LOCK-02` `lockTtlMs` outside 60 s–24 h is refused; the default stays 30 min; `release-stale-locks` respects an extended expiry
- `TC-CART-LOCK-03` `unlock`, `markConverted` and `getSalesSnapshot` with a mismatched `checkoutSessionId`, or on an unlocked cart, answer the uniform `404` and change nothing
- `TC-CART-LOCK-04` A fresh lock of a storefront cart without `routeContext` is `400 assortment_scope_required_for_storefront_channel`; a recovery lock built through `resolveForBuyer` from the stored identity succeeds and runs the visibility pass
- `TC-CART-LOCK-05` `markConverted` with `salesOrderId` + `lineMap` emits `cart.cart.converted` with both, scope and `checkoutSessionId`; with `salesQuoteId` + `salesQuoteLineId` entries likewise; a map naming a foreign line, or omitting a customer line, is refused and writes nothing
- `TC-CART-LOCK-06` `getSalesSnapshot` returns `SalesLineSnapshot[]` + adjustments whose `calculateDocumentTotals` result equals `Cart.totals` at 4 dp per key, each paired with its `cartLineId`, gift lines included

**Trusted pay-link path (`TC-CART-TRUST-*`, rev 10 — D-R5-19/D-R5-22, Phase 4a gate):**
- `TC-CART-TRUST-01` A `system` trusted context creates a `pay_link` cart and adds template lines; the audit entry is system-initiated and names the link; a template line with `unit_price_override` keeps it across a re-price, one without it prices at the buyer's rate when a customer session is passed and at list otherwise
- `TC-CART-TRUST-02` A `system` trusted context cannot create a `storefront`, `pos`, `agent` or `api` cart; no HTTP body can set `unit_price_override` (`400`)
- `TC-CART-TRUST-03` A trusted `api` cart created for a `customerUserId` stores the person and company in `customer_ids`, the group ids and the price kind from `resolveForBuyer`; with `ecommerce` absent it falls back to `[customerId]` with no groups

**Admin (`TC-CART-ADM-*`, rev 10 — K6, Phase 4a gate):**
- `TC-CART-ADM-01` `GET /api/cart/carts` defaults to baskets, filters by `status`, `channel`, `storeId`, `customerId`, `requiresApproval`, `awaitingApproval` and activity range, sorts by `lastActivityAt` and `grandTotalGrossAmount`, caps `pageSize` at 100, and never returns a token or `token_hash`
- `TC-CART-ADM-02` `kind=proposal` (with `proposedToCartId`) requires `cart.proposals.view` (`403` without it)
- `TC-CART-ADM-03` Tenant and organization isolation on list, detail and reprice: another organization's cart is absent from the list and `404` on detail and reprice
- `TC-CART-ADM-04` `GET /api/cart/carts/:id` returns lines, warnings, the live approval and merge-log entries, with `email`/`note` decrypted
- `TC-CART-ADM-05` `POST /api/cart/carts/:id/reprice` without the optimistic-lock header is `400`, with a stale one `409` with the cart embedded, with a current one `200` and `versionBumpReason: 'repricing'`; it neither reactivates an abandoned basket nor moves `last_activity_at`; a locked cart `423`; a proposal id `404`
- `TC-CART-ADM-06` **No admin route mutates a line on a cart the principal does not own** — asserted by enumerating the module's registered routes, so a future addition fails the test rather than silently reopening §10.2
- `TC-CART-ADM-07` (Playwright) the backend list opens with baskets, filters, opens a detail page, and a forced re-price surfaces the conflict bar on a stale version

**Sweepers and events (`TC-CART-SWP-*`, rev 10 — K5, K9, K11, K15/S15, S3):**
- `TC-CART-SWP-01` `mark-abandoned-carts` emits `cart.cart.abandoned` with the K9 payload (no e-mail, scope present) and releases the basket's code reservations by `cartId`
- `TC-CART-SWP-02` `expire-carts` releases code reservations by `cartId` and withdraws a pending approval for a basket
- `TC-CART-SWP-03` A live proposal past the inactivity window is not abandoned; past its own `expires_at` it becomes `expired` with `resolved_at` set and emits `cart.proposal.expired` with `tenantId`/`organizationId`; it stays readable
- `TC-CART-SWP-04` `purge-expired-carts` deletes a rejected and an expired proposal 90 days after `resolved_at`, keeps an accepted proposal referenced by `CartMergeLog`, and emits `cart.cart.purged` with scope
- `TC-CART-SWP-05` `cart.cart.merged`, `.adopted` and every `cart.proposal.*` payload carry `tenantId`/`organizationId` (S3)

**Proposals (`TC-CART-PROP-*`, §7a — Phase 4c gate; rev 10 — S16: no author UI exists, so every test authors through `POST /api/cart/proposals` with an API key holding `cart.proposals.author`, and acts as the buyer with `X-Cart-Token` plus, for an identified basket, a customer JWT):**
- `TC-CART-PROP-01` `cart.proposal.create` against a target on a different price kind produces line prices byte-identical to the target buyer's own resolution, not the author's (R14)
- `TC-CART-PROP-02` A proposal against a storefront target requires a resolved scope (`400` without) and reports a restricted product in `rejectedLines`, emitting `cart.line.visibility_rejected` with `triggeredBy: 'proposal_create'`; all lines rejected is `422 proposal_empty` and creates nothing (S13)
- `TC-CART-PROP-03` `ttlSeconds` sets `expires_at`; values outside 3600–1 209 600 are refused; the default is 72 h (S5); a body with a promotion-code field is `400` (S14)
- `TC-CART-PROP-04` `preview` and `accept` re-check every line against the freshly-resolved scope of the buyer's own request, and refuse a storefront target without one (`400`); a scope narrowed after authoring still rejects the line (§6a.5, D-R4-22)
- `TC-CART-PROP-05` `POST /proposals` with a valid cart token and no authenticated principal returns `401`; with a principal lacking `cart.proposals.author`, `403` (R15)
- `TC-CART-PROP-06` A proposal cart's token appears in no response or event; its id on any line, promotion, lock or admin-reprice path answers the same `404` as an unknown cart (K10 — structural, no distinguishable code)
- `TC-CART-PROP-07` `GET /proposals` and `preview`/`accept`/`reject` for a proposal addressed to a different basket than the presented token's return the same `404` as a nonexistent id; no proposal route accepts a token in the path
- `TC-CART-PROP-08` A live proposal is not marked `abandoned` by `mark-abandoned-carts`, and emits no `cart.proposal.rejected`; a rejected proposal never returns to `active`
- `TC-CART-PROP-09` Adoption rotates the token and emits `cart.cart.adopted`; a merge emits `cart.cart.merged` with `kind` of the source, and a proposal acceptance's merge event carries `kind: 'proposal'`
- `TC-CART-PROP-10` `preview` creates nothing: no cart, no line, no merge log, asserted by row counts before and after
- `TC-CART-PROP-11` `accept` with a stale `acceptanceToken` returns `409 proposal_changed` carrying a fresh preview and a fresh token, and merges nothing; a token whose target `updatedAt` moved, and separately whose proposal `updatedAt` moved, both `409`; the token expires after 15 minutes and is single-use
- `TC-CART-PROP-12` Per-line acceptance merges exactly the selected lines; unselected lines are recorded `declined` and are neither merged nor deleted; `CartMergeLog.strategy` is `manual`; acceptance re-prices whole-cart, discloses `priceChanges` alongside `mergeSummary`, and recomputes `requiresApproval` on the target
- `TC-CART-PROP-13` `POST /current/undo-merge` after an acceptance returns `409 merge_undo_not_supported_for_proposal`, the target and the proposal stay unchanged, and no `cart.proposal.acceptance_undone` is emitted (D-R5-25)
- `TC-CART-PROP-14` Acceptance against a `locked` target returns `423` with the checkout session id
- `TC-CART-PROP-15` Buyer rejection sets the proposal to `abandoned` with `resolved_at`, emits `cart.proposal.rejected` with `rejectedBy: 'buyer'`, and leaves the target cart byte-identical; an author-side rejection emits `rejectedBy: 'author'`; rejecting a non-active proposal is a no-op returning its status
- `TC-CART-PROP-16` An expired proposal is readable, is not accept-able, and is not deleted by the expiry sweeper
- `TC-CART-PROP-17` `added_by_actor_id` supplied in a request body is ignored; the value written is the authenticated principal's (R16); a re-author under `buildTrustedCommandContext` for the original author keeps that author on every line, and is refused (`403`) when the author lost `cart.proposals.author` (D-R5-14)
- `TC-CART-PROP-18` Attribution survives acceptance: lines merged from a proposal keep `added_by_actor_type = 'rep' | 'ai_agent'` and their author's id, rather than being rewritten to `merge`

**Lifecycle:**
- Lock forces a re-price (except an extend, `TC-CART-LOCK-01`); mutation while locked returns 423 with the session id
- Lock timeout returns the cart to active
- Abandonment and expiry transitions; expiry releases code reservations (R8)
- Limits enforced (R10)

**API:** every route, with tenant isolation and cross-tenant token rejection. **(rev 10)** New API paths and their suites: `POST /current/request-approval` (`TC-CART-APR-*`, `TC-CART-BIND-01`); `GET /carts`, `GET /carts/:id`, `POST /carts/:id/reprice` (`TC-CART-ADM-*`); `GET /proposals`, `POST /proposals`, `POST /proposals/:id/{preview,accept,reject}` (`TC-CART-PROP-*`, `TC-CART-BIND-04`); the undo refusal on `POST /current/undo-merge` (`TC-CART-PROP-13`). Every integration test creates its fixtures through the API and removes them in teardown; none relies on seeded data.

---

## 15) Implementation Phases

**Rev 9 re-cuts the Phase 1–3 gates (W13/D-R4-29) to match where the Release 4 analysis actually exercises each risk.** Rev 8 had the totals-equivalence property test gate Phase 1 while promotions (the thing most likely to break it) integrate in Phase 3, and listed "each trigger in isolation" as a Phase 2 gate that silently included triggers 5 and 6, which do not exist until Phase 3. The three gates below are self-consistent; the full test-ID list is §14.

**File manifest** (`packages/core/src/modules/cart/`): `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `di.ts`, `encryption.ts`; `data/{entities,validators}.ts`; `commands/{lines,cart,promotions,merge,lock}.ts`; `lib/{cartService,reprice,triggers,quantityRules,mergePolicy,tokens,idempotency,toSalesSnapshots,toPromotionContext,routeContext}.ts`; `api/cart/current/**`, `api/cart/proposals/**`, `api/openapi.ts`; `workers/*.ts`; `migrations/`; `i18n/{de,en,es,ko,pl}.json`; `__integration__/TC-CART-*.spec.ts`; `__tests__/` (totals and scoped-product property tests). `index.ts` declares `requires: catalog, sales, customer_groups` (promotions added when Phase 3 lands; ecommerce soft). **(rev 10) Phase 4 adds:** `commands/{approval,proposals}.ts`; `lib/{approvalGate,salesSnapshot}.ts`; `subscribers/approval-decided.ts`; `api/cart/current/request-approval/route.ts`, `api/cart/proposals/**`, `api/cart/carts/{route.ts,[id]/route.ts,[id]/reprice/route.ts}`; `backend/cart/carts/{page.tsx,[id]/page.tsx}`; a migration for `awaiting_approval_since`, `CartLine.unit_price_override` and the admin-list index. `index.ts` `requires` is unchanged: `customer_groups` is already required, and `ecommerce` (`resolveForBuyer`) stays soft through `tryResolve`.

**Migration note (D-R4-19/D-R4-20):** the Phase 1 migration includes every Phase-4-seam column up front — `Cart.kind` (default `basket`) + `proposed_to_cart_id` with its check constraint, `CartLine.added_by_actor_type`/`_id`, `CartMergeLog.merged_by_actor_type`/`_id` + `proposal_cart_id`, and `Cart.resolved_at` — because adding them later, once baskets exist, is a second migration against a live table for no benefit; every basket-only query filters `kind = 'basket'` from Phase 1 on, so a non-basket cart id is the structural `404` on every line/promotion command (rev 10 — K10; rev 9 specified `409 proposal_cart_immutable`, which was never emitted). Rev 10's Phase 4 migration is additive only: one nullable column on `carts`, one on `cart_lines`, one index. `token_hash` (not plaintext `token`) and the absence of `availability_state`/`availability_checked_at` columns (W14) are Phase 1 migration facts, not later cleanup.

### Phase 1 — Core cart, with visibility built into the first line command
Entities (including every Phase-4-seam column per the migration note above), `token_hash` generation, line CRUD, snapshots, `salesCalculationService` totals, optimistic locking, idempotency (`CartIdempotencyKey`), the §6a.1a–c server-derived visibility check on every line command, TTL and all four sweepers.

**Gate:** `TC-CART-R1-*` (the full assortment-visibility suite, attacking the HTTP surface per F1/F2, not only the command) and `TC-CART-CONC-*` pass. No storefront add-to-cart path ships before this gate.

### Phase 2 — Pricing behaviour
Triggers 1–4 and 7, `priceChanges` disclosure, quantity tiers and `nextTier`, quantity rules (via the shared `availability` derivation, D-R4-3), availability advisory computed per response (never persisted, W14), the totals-equivalence property test **without promotions**.

**Gate:** `TC-CART-PRICE-*`, `TC-CART-B2B-*` and `TC-CART-TOT-01/02/04/05` (the promotion-effect assertions in `TC-CART-TOT-03` gate here only insofar as "no promotion effect" is itself a case of the property test) pass; each trigger verified in isolation; no re-price outside the seven-trigger set.

### Phase 3 — Promotions, merge, lock and the release gate
`promotionsService` integration (§6, code application and per-cart reservations, D-R4-8), triggers 5 and 6, merge policy, `CartMergeLog` with its polymorphic actor, undo, **the merge-time re-visibility pass of §6a.5**, and the lock/convert surface (`cartService.lock/unlock/markConverted`, F7/C6).

§6a.5 sits here rather than in Phase 4 because it corrects merge, not proposals: the defect it closes (R13) exists the moment merge exists, independently of whether assisted selling is ever built. Deferring it would ship this phase with a documented Critical and would let the suite's Phase 1 gate — which already requires the cart-side assortment check — pass over a route that defeats it.

**Gate:** `TC-CART-MERGE-*`, `TC-CART-R13-*`, `TC-CART-PROM-*` pass; merge covers the five login situations with a restorable log (the sixth, proposal acceptance, gates in Phase 4c); reservations released on expiry; a restricted line merged from an exempt-channel cart is rejected, disclosed and recoverable, never silently admitted and never silently dropped; `TC-CART-TOT-01` passes **with** promotions, built through the existing `sales` create command against an order from the cart's own lines; the P95 ≤ 150 ms benchmark passes at 200 promotions × 50 lines. This is the Release 4 completion gate for `cart`.

### Phase 4 — B2B, admin, checkout contract and the proposal seam (eComm Release 5)

**(rev 10 — D-R5-11.)** Phase 4 ships in Release 5 in full, including §7a: the owner kept the seam in the release against the analysis' recommendation to split it out, and added its author side (assisted-selling Phase 1) to the release. Release 4 already shipped part of the Phase 4 list: bulk lines (`/current/lines/bulk`, the 100-entry cap, one promotions-and-totals phase), `mark-abandoned-carts` with `cart.cart.abandoned`, and the emission of `cart.cart.adopted`/`.purged`. Phase 4 adds the rest in three steps, ordered by the Release 5 implementation waves:

#### Phase 4a — checkout contract, binding, admin (wave 2)
Prerequisites: the trusted-context helper (X10) and the event scope fields (wave 1); `resolveForBuyer` with optional store (SPEC-029, wave 1).
- The lock contract of §9.1 (C1, C2/X15): `lockTtlMs`, idempotent extend, session-bound `unlock`/`markConverted`, `400` for a storefront lock without context, recovery context through `resolveForBuyer`.
- `cartService.getSalesSnapshot` (C7).
- `markConverted` inputs and the `cart.cart.converted` payload (K8, D-R5-16, D-R5-26).
- The identity binding of §8.4 on every `/current/*` route (D-R5-21), with the `UPGRADE_NOTES.md` entry.
- The trusted path of §6a.4: identity through `resolveForBuyer` (D-R5-22) and the pay-link seeding path with `CartLine.unit_price_override` (D-R5-19).
- The admin list, detail, forced re-price and backend pages (§10.2, K6).
- The K9 abandonment payload, K11 code-reservation release in `mark-abandoned`/`expire`, and scope on `merged`/`adopted`/`purged` (S3).
- The bulk gate test (`TC-CART-B2B-05`).

**Gate:** `TC-CART-BIND-*`, `TC-CART-LOCK-*`, `TC-CART-TRUST-*`, `TC-CART-ADM-*`, `TC-CART-SWP-01/02/05`, `TC-CART-B2B-05` pass; checkout B.1 can lock, extend, snapshot and convert a cart in-process with no route of its own into `cart`.

#### Phase 4b — the approval gate (wave 3)
Prerequisite: `customer_groups` Phase 4 approvals (`customerPurchaseApprovalService`, the `approval.*` events, `termsCurrencyCode`), wave 2.
- §9a in full: `requires_approval` computation (K1, K2), the gate in `cart.lock` with `purpose` (D-R5-23) and no channel exemption (D-R5-29), guest refusal (D-R5-12), `cart.approval.request` and `POST /current/request-approval` (K4), the lifecycle table (K3), `awaiting_approval_since` with the §9a.5 subscriber and the abandonment exclusion (K5), and `cart.approval.requested` (K7, D-R5-32).

**Gate:** `TC-CART-APR-*` and `TC-CART-B2B-03` pass: an over-threshold cart cannot lock until approved, in any channel and either currency case, and a quote request locks without approval.

#### Phase 4c — the proposal seam (wave 3)
Prerequisite: `resolveForBuyer` (wave 1). Precedes assisted-selling Phase 1 (wave 4), its only author.
- §7a in full: `cart.proposal.create` with `ttlSeconds`, no codes and `triggeredBy: 'proposal_create'` (S5, S13/K13, S14/K14); the five proposal routes with the D-R5-13/-21 binding; `cart.proposal.accept` through `cart.merge` with `strategy: 'manual'`; `cart.proposal.reject` for both callers with release by `cartId`; the undo refusal (D-R5-25); the sweeper branches for proposals (S15/K15); scope on every `cart.proposal.*` payload (S3).

**Gate:** `TC-CART-PROP-*` and `TC-CART-SWP-03/04` pass through the API with an API principal holding `cart.proposals.author` (S16/K16); the sixth merge situation of §7.1 (`manual`) passes `TC-CART-MERGE-01`; a proposal authored by a rep on a different price kind prices identically to the buyer's own resolution; `preview` creates nothing and a stale `acceptanceToken` cannot merge; an acceptance cannot be undone.

**Contract freeze.** The five proposal routes and the `cart.proposal.create` input become STABLE on ship (§16a), before `assisted_selling` has run in production. Assisted-selling Phase 1 is built in the same release against them (D-R5-11), which is the validation the analysis asked for.

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
| `cart_not_active` | 409 | **(rev 9 — F15, corrected 2026-10-23 — #7880)** A write was attempted against a merged, expired or converted cart; the response carries the cart's actual `status`. An `abandoned` basket is not refused — §9's `abandoned → active` applies: the write reactivates it and extends `expires_at` |
| `idempotency_key_mismatch` | 422 | §8.2 |
| `promotion_line_immutable` | 409 | A buyer attempted to edit/remove a gift line (F4) |
| `assortment_scope_required_for_storefront_channel` | 400 | No `StoreContext` resolved for a route that needs one (§6a.1a) — never caused by a missing *request field* in rev 9, only by `storeContextService` itself failing to resolve. **(rev 10 — C2)** Also a fresh `cart.lock` of a storefront cart without `routeContext` (§9.1), and `cart.proposal.create` against a storefront target without one (§7a.2) |
| `proposal_changed` | 409 | Stale `acceptanceToken` (§7a.4) |
| `code_reservation_unavailable` | 409 | Budget or per-customer limit exhausted (D-R4-8/D-R4-12) |
| `cart_merge_scope_mismatch` | 400 | **(rev 10 — K10; emitted since Release 4, undocumented until now)** `cart.merge` refused a cross-store or cross-currency merge (§7.1 "same store and currency only") |
| `merge_undo_window_expired` | 409 | **(rev 10 — K10; emitted since Release 4)** `cart.mergeUndo` past the 15-minute window (§7.2) |
| `merge_undo_not_supported_for_proposal` | 409 | **(rev 10 — D-R5-25)** `undo-merge` of a proposal acceptance (§7a.7) |
| `cart_requires_approval` | 409 | **(rev 10 — K2)** `cart.lock` without a qualifying approval; body carries the approval (or `null`), the goods gross and currency (§9a.3). Checkout passes it through |
| `approval_requires_identified_buyer` | 409 | **(rev 10 — D-R5-12)** Over the threshold on a cart with no `customer_user_id`, at lock or on `request-approval` (§9a.3, §9a.4) |
| `approval_not_required` | 409 | **(rev 10 — K4)** `request-approval` on a cart under the threshold, or one whose current approval already qualifies |
| `proposal_empty` | 422 | **(rev 10 — S13)** `cart.proposal.create` with no line admissible under the target buyer's scope; every line in `rejectedLines` |
| — (uniform `404`) | 404 | Unknown token; an identified basket without its buyer's session (§8.4, D-R5-21); a proposal id on a basket path (§7a.1, K10); a lock/convert/snapshot call with a mismatched `checkoutSessionId` (§9.1). One body for all of them, so none can be told apart |

**(rev 10 — K10) Withdrawn codes.** `proposal_cart_immutable` (409) was specified in rev 8/9 and never emitted: the code answers the structural `404` instead, and rev 10 adopts that (§7a.1). D-R4-19's `501 not_supported` for `strategy: 'manual'` before Phase 4 is withdrawn too: the merge request schema is `{ sourceToken }.strict()`, the server picks the strategy, and `manual` is reachable only through `cart.proposal.accept`. Neither code was ever on the wire, so no consumer is affected.

All new codes get `cart.errors.*` keys in the five locales.

### Rate limits

Via the shared `ratelimit` module (`checkRateLimit`, `readEndpointRateLimitConfig`), env prefix `CART_*`, per cart token **and** per IP:

| Scope | Default |
|---|---|
| `CART_CREATE` | 20 / min / IP |
| `CART_MUTATE` (lines, promotions, merge, reprice; rev 10: `request-approval`, `proposals/:id/{preview,accept,reject}`) | 60 / min / token |
| `CART_READ` (rev 10: includes `GET /proposals`) | 120 / min / token |

Staff routes (`/carts/*`, `POST /proposals`) are authenticated and use the platform's standard API limits, not the `CART_*` buckets.

---

## 16) Open Questions

1. **Saved carts / multiple named carts** — B2B buyers maintain recurring order templates. The model supports it (a `name` column and a `saved` status), but the UX belongs to spec 9. *Deferred; not built speculatively.* **Closed 2026-09-16:** spec 9 split the two meanings that "template" conflated — a parked basket is a saved cart, resumed once (and merged via the existing `cart.merge`/`cart.mergeUndo` when the buyer already holds one), while a reusable named set of products and quantities is a shopping list owned by `customer_accounts`. A copy-a-cart-into-a-new-cart primitive was briefly flagged against §3.1a as a gap; it is withdrawn — no new `cart` command is required.
2. **Cross-store carts** — scoped to one store per the roadmap. Revisit if a tenant wants a shared basket across storefronts.
3. **Cart-level currency switching** — currently re-prices the whole cart. Whether a buyer may switch currency mid-cart at all, or must start over, is a merchandising decision. *Assumed re-price is acceptable.*
4. **Agent-authored carts** — `added_by: 'agent'` is in the model. Whether an AI-proposed line needs explicit buyer confirmation before it counts toward totals is an approval-contract question for the AI framework. *Reserved, not specified.* **Closed 2026-09-22 (rev 7):** the question dissolves rather than being answered. An unaccepted line is not in the buyer's cart at all — it is in a separate cart holding the role `proposal` (§7a) — so it cannot count toward the buyer's totals, and nothing has to decide whether it does. The alternative that was implicitly on the table, a per-line `pending` flag, would have pushed a conditional into every totals path in a module whose entire discipline is that it performs no arithmetic of its own; it would also have had to be honoured by `promotionsService` evaluation, by the `salesCalculationService` mapping and by every `nextTier` and threshold calculation, each of which is a place the flag could be forgotten. It was never an approval-contract question for the AI framework: it was a modelling question about where an unaccepted intention lives, and the same answer serves a human rep, for whom the AI framework has nothing to say. **Status 2026-10-26 (rev 10 — D-R5-11):** the closure is now realised in a release: §7a ships in Release 5 with assisted-selling Phase 1 as its author. The assisted-selling rev 7 decision of 2026-09-21 (proposal-cart seam) is unchanged, and D-R5-25 narrows it only by removing the undo of an acceptance.
5. **The cart token in `/carts/:token/...` paths** (raised 2026-09-27). **Closed 2026-10-14 (rev 9 — C7/D-R4-6).** Moved to a header-bound `/api/cart/current/*` shape before Phase 1 (§10, §8.3): the only credential is `X-Cart-Token`; the platform does not read a cookie for it — the storefront app owns an httpOnly cookie and forwards the header itself (CSRF boundary stays with the storefront). `POST /current` returns the token once in the body. Admin keeps `/carts` and `/carts/:id` (Phase 4), so there is no path collision with the public routes. Nothing is implemented, so the change was free; `storefront-app.md` is the consumer that must call the new shape.
6. **Retention of resolved proposal carts** (raised 2026-09-27). **Closed 2026-10-14 (rev 9 — C8/D-R4-20).** Adopted the stated default: proposal carts follow the 90-day purge, counted from `resolved_at` (§4.1) rather than `expires_at` — which is what makes an accepted or rejected proposal's retention well-defined, since `resolved_at` is set at resolution (acceptance, rejection or expiry) while `expires_at` is set at creation. Each purge emits `cart.cart.purged` so assisted selling can render "details purged" on a surviving metadata row; accepted lines survive in `CartMergeLog.source_snapshot`, which the purge already retains. The only Release 4 obligation this closes with is the `resolved_at` column landing in the Phase 1 migration (D-R4-19); the purge sweeper's proposal-aware behaviour is Phase 4 work, same as the rest of the proposal seam (rev 10: Phase 4c, §12).
7. **Approval granularity and the cart's approval subject** (raised by the Release 5 analyses, G8/K1). **Closed 2026-10-26 (D-R5-3, D-R5-4).** The cart is the one approval subject; only a goods total above the approved amount, in the cart's currency, invalidates an approval; no line-level digest. §9a.
8. **Guest carts over a threshold** (K4). **Closed 2026-10-26 (D-R5-12).** Refused at lock with `409 approval_requires_identified_buyer`; the group terms form warns on a default-group threshold. §9a.3.
9. **Token-only re-identification of a basket** (X1, left open by D-R5-13). **Closed 2026-10-26 (D-R5-21).** An identified basket needs its buyer's session on every buyer route. §8.4.

Deliberately left for later, not open in Release 5: per-approver authority limits and approval chains (customer-groups G24), re-linking quote-line attribution after a quote converts to an order (D-R5-26), and the membership-expiry sweeper of D-R4-22.

---

## 16a) Migration & Backward Compatibility (rev 9 — previously missing, per the Release 4 analysis §2)

At rev 9 `cart` was greenfield, so no deprecation protocol was triggered and no bridge was owed for any rename that revision made. **From rev 10 that is no longer true:** Phases 1–3 shipped in Release 4, so their contract surfaces are frozen, and every rev 10 change follows `BACKWARD_COMPATIBILITY.md` (the Release 5 additions at the end of this section).

- **Module id.** `cart` stays singular (C9/D-R4-17) — a recorded exception to the root `AGENTS.md` "modules plural" rule, alongside the existing `ecommerce` and `checkout` exceptions. Frozen on first release.
- **Contract freeze.** Every `cart.*` event id, every `/api/cart/*` route, every table name, every ACL feature id and every DI key this spec names becomes **STABLE** per `BACKWARD_COMPATIBILITY.md` the moment Phase 1 ships. The additive DI keys this release also mints on `catalog` (`catalogBuyerPricingService`, `catalogScopedProductService`) and `availability` (the quantity-rule derivation) are **ADDITIVE-ONLY** and were called out to the owner as a multi-module change (D-R4-3) before this revision landed — the owner's approval is recorded there, not re-requested here.
- **Rev 6/7/8 renames are breaking on paper only.** `added_by` → `added_by_actor_type`/`_id`, `merged_by_customer_user_id` → `merged_by_actor_type`/`_id`, and this revision's `token` → `token_hash` and `assortmentScope`-as-body-field → route-edge resolution are all renames of a column or a contract shape that has never shipped. No migration bridges any of them; the Phase 1 migration simply creates the final shape directly.
- **ADR-1/ADR-2 continuity.** This revision withdraws no architectural decision SPEC-029 v3's cart-as-session model made obsolete; ADR-1 (cart is a module, not a checkout status) and ADR-2 (cart never computes totals) are unaffected by Release 4.
- **SPEC-055 namespace.** The promotions calls in §6 already assume SPEC-055's current (post-namespace-move) module layout; no bridge is needed because `cart` has never called the old layout.
- **Generated registries.** `yarn generate` after Phase 1 lands; `apps/mercato/src/modules.ts` gains `cart` and `promotions` only at Step 7.8, kept commented out in the `create-app` template per the D22 precedent (`yarn template:sync:fix`).

**Release 5 additions (rev 10).** Every item is additive or a documented behaviour change; nothing shipped is removed or renamed.

| Surface | Change | Class |
|---|---|---|
| DB schema | `carts.awaiting_approval_since` timestamptz nullable (K5/X14); `cart_lines.unit_price_override` jsonb nullable (D-R5-19); index `(tenant_id, organization_id, kind, last_activity_at)` (K6). No column renamed or dropped | Additive |
| Command signatures | `cart.lock` gains optional `lockTtlMs`, `purpose`; `cart.unlock` / `cart.markConverted` require the `checkoutSessionId` they already stored (the only caller, checkout, is new in Release 5); `cart.markConverted` gains optional `salesOrderId`, `salesQuoteId`, `lineMap`; `cart.lock` returns `extended` | Additive (no Release 4 caller exists) |
| DI | `cartService.getSalesSnapshot` (new method on an existing key) | Additive |
| Event payloads | `cart.cart.abandoned` grows from `{ cartId }` to the K9 shape; `cart.cart.converted` gains `checkoutSessionId`, `salesOrderId`, `salesQuoteId`, `lineMap`; `tenantId`/`organizationId` added to `cart.cart.merged`, `.adopted`, `.purged` and `cart.proposal.*`; `cart.proposal.rejected` gains `rejectedBy`; `cart.line.visibility_rejected.triggeredBy` gains `'proposal_create'`; `cart.approval.requested` gets its first payload (never emitted before) | Additive; fields are never removed |
| Event ids | `cart.proposal.acceptance_undone` stays declared and is never emitted (D-R5-25). Not removed, because ids are frozen | Unchanged id, documented as unused |
| API routes | New: `POST /current/request-approval`, `GET /proposals`, `POST /proposals`, `POST /proposals/:id/{preview,accept,reject}`, `GET /carts`, `GET /carts/:id`, `POST /carts/:id/reprice` | Additive |
| API behaviour | **D-R5-21:** an identified basket now answers `404` on every `/current/*` route without its buyer's customer session (§8.4). In Release 4 the token alone sufficed and re-identified the basket | **Behaviour change**, Ask First approved in D-R5-21; recorded in `UPGRADE_NOTES.md` (storefronts must forward the customer session with the cart token, and start a new guest cart after logout) |
| API behaviour | `POST /current/undo-merge` refuses a proposal acceptance (D-R5-25); no acceptance existed in Release 4 | Additive |
| Error codes | New: `cart_requires_approval`, `approval_requires_identified_buyer`, `approval_not_required`, `merge_undo_not_supported_for_proposal`, `proposal_empty`; documented at last: `cart_merge_scope_mismatch`, `merge_undo_window_expired`; withdrawn from the spec, never emitted: `proposal_cart_immutable`, `501 not_supported` (§15a) | Additive / documentation |
| ACL | No new features; grants unchanged | Unchanged |
| Contract freeze | The proposal routes, `cart.proposal.create`'s input and the `cart.proposal.*` payloads become STABLE when Phase 4c ships | — |

The `UPGRADE_NOTES.md` entry for D-R5-21 is written with the Phase 4a implementation, not by this spec revision.

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
| Staff never mutate a buyer's basket | No admin route mutates a line on a cart the principal does not own; content changes are authored as proposals and take effect on acceptance (§10.2), asserted by a route-enumeration test (`TC-CART-ADM-06`) |
| Buyer pricing context is not the author's | A proposal cart copies the target's pricing context and re-derives it on every re-price; the author's identity never enters pricing (§7a.2, R14) |
| Backward compatibility | `SalesDocumentKind` deliberately **not** extended. Rev 7's renames were on paper only (nothing had shipped). **Rev 10:** Phases 1–3 shipped, so every Release 5 change is additive except the documented D-R5-21 behaviour change (§16a, `UPGRADE_NOTES.md`) |
| Approval gate | **(rev 10)** One amount basis, fail-closed currency and guest rules, no channel exemption; the lock reads the approval live through `customerPurchaseApprovalService` by DI, never a `customer_groups` entity; notifications stay with `customer_groups` (§9a, D-R5-32) |
| Identity binding | **(rev 10)** An identified basket needs its buyer's session on every buyer route, answered with the unknown-cart `404` (§8.4, D-R5-21) |
| Trusted contexts | **(rev 10)** Built only through `buildTrustedCommandContext`, never from HTTP input; a `system` actor creates `pay_link` carts only; audited as system-initiated (§3.1a, §6a.4, X10) |
| Event scope | **(rev 10)** Every new or extended payload carries `tenantId`/`organizationId`; subscribers filter on them first (§11, S3, D-R5-32) |
| Admin UI | **(rev 10)** `DataTable` with `entityId` + `extensionTableId`, `pageSize ≤ 100`, encrypted fields decrypted through the query engine with no ciphertext search, the re-price write in `useGuardedMutation` with the optimistic-lock header and `surfaceRecordConflict`, i18n in five locales (§10.2) |
| Integration coverage | §14, shipping in the same change; rev 10 lists a suite for every new API path (request-approval, admin list/detail/reprice, the five proposal routes, the undo refusal) and the binding `404` cases |

---

## 18) Changelog

### 2026-10-26 (rev 10 — Release 5 spec revision)

Applies the eComm Release 5 owner decisions that touch `cart` ([decisions](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md) D-R5-3, -4, -11, -12, -13, -14, -16, -19, -21, -22, -23, -25, -26, -29, -32), the cart pre-implementation findings K1–K11 and K13–K17, the cross-spec findings X1, X2, X5, X7, X8, X9, X10, X11, X14, X15, the assisted-selling findings S2, S3, S5, S13–S16, and the checkout findings C1, C2, C7, C9, C12, C18. Spec only; no code.

- **Approval gate (new §9a — K1–K5, K7, D-R5-3, -4, -12, -23, -29, -32).** One basis (`totals.grandTotalGrossAmount`, goods after promotions, excluding delivery, cart currency); `requires_approval` recomputed on every totals change and from fresh terms at lock; `cart.lock` refuses `409 cart_requires_approval` without a qualifying approval read live; currency mismatch fails closed; guests are refused with `409 approval_requires_identified_buyer`; no channel exemption; `purpose: 'quote'` skips the gate (`min_order_value` stays with checkout). `cart.approval.request` / `POST /current/request-approval` specified (body `{}`, requester from auth, idempotent while pending). Lifecycle table for merge, expiry, purge, abandonment, conversion and undo. New `Cart.awaiting_approval_since` (K5/X14) with a `customer_groups.approval.*` subscriber and the abandonment exclusion. `cart.approval.requested` gets a payload and stays a state signal (D-R5-32).
- **Identity binding (new §8.4 — D-R5-21, X1, D-R5-13).** An identified basket answers the unknown-cart `404` on every `/current/*` and proposal buyer route without its buyer's customer session; re-identification runs guest → identified only; trigger 2 no longer covers logout (§5.2). Behaviour change against Release 4, recorded in §16a for `UPGRADE_NOTES.md`.
- **Checkout lock contract (new §9.1 — C1, C2, C7, X15, K8, D-R5-16, -22, -23, -26).** `lockTtlMs` (60 s–24 h, default 30 min), idempotent extend with the same `checkoutSessionId`, session-bound `unlock`/`markConverted`/`getSalesSnapshot` (uniform `404`), `400 assortment_scope_required_for_storefront_channel` for a storefront lock without context, recovery context through `resolveForBuyer`. `markConverted` takes `salesOrderId`/`salesQuoteId` + `lineMap`; `cart.cart.converted` carries them. New `cartService.getSalesSnapshot` (C7).
- **Trusted path (§6a.4, §3.1a — D-R5-19, D-R5-22, X2, X10, C12).** Identity on trusted carts from `resolveForBuyer` (identity only, no scope; documented fallback without `ecommerce`). The pay-link seeding path under `buildTrustedCommandContext` with a `system` actor, `pay_link` only, lines from the template, new `CartLine.unit_price_override`. One trusted-context helper for pay-link seeding, re-authoring and recovery.
- **Admin (§10.2 — K6, X5).** `GET /api/cart/carts` (default `kind = basket`, accepts `proposal` with `cart.proposals.view`), `GET /api/cart/carts/:id`, `POST /api/cart/carts/:id/reprice` (trigger 7, optimistic-lock header required), backend pages; no ciphertext e-mail search. The stale rev 6 quote ("support may inspect …") replaced by the contract.
- **Proposal seam completed for Release 5 (§7a — D-R5-11, -13, -14, -25, K13–K16, S3, S5, S13–S16).** Create contract with `ttlSeconds` (S5), no codes (S14), `triggeredBy: 'proposal_create'` and `422 proposal_empty` (S13); binding on the buyer routes; author-side rejection with `rejectedBy`; release by `cartId`; re-author under the trusted helper as the original author. **§7a.7 rewritten:** an acceptance is never undone (`409 merge_undo_not_supported_for_proposal`); `cart.proposal.acceptance_undone` stays declared and is never emitted; §9 drops `merged → active | expired` for proposals.
- **Merge (§7.4 new — K3, D-R5-25).** Source-side withdrawal of a pending approval, target-side recompute, no restoration on undo, no undo of an acceptance.
- **Events (§11 — K7, K8, K9, S3, S13, D-R5-26, D-R5-32).** Scope on every new or extended payload; full payloads for `cart.cart.abandoned`, `.converted`, `cart.approval.requested`; scope added to `merged`, `adopted`, `purged` and `cart.proposal.*`.
- **Jobs (§12 — K5, K11, K15/S15).** Abandonment skips baskets awaiting approval and releases code reservations; expiry releases reservations and withdraws pending approvals; proposal branches for expiry and purge.
- **Error codes (§15a — K10).** Added `cart_requires_approval`, `approval_requires_identified_buyer`, `approval_not_required`, `merge_undo_not_supported_for_proposal`, `proposal_empty`, and the two codes Release 4 emitted without documenting (`cart_merge_scope_mismatch`, `merge_undo_window_expired`). Withdrew `proposal_cart_immutable` and D-R4-19's `501 not_supported`, neither of which was ever emitted, in favour of the structural `404` the code already returns (§7a.1, migration note).
- **Phases (§15 — D-R5-11).** Phase 4 re-cut into 4a (checkout contract, binding, trusted path, admin; wave 2), 4b (approval gate; wave 3) and 4c (proposal seam; wave 3), each with its gate. The analysis' recommendation to split the seam out of Release 5 was overruled by D-R5-11.
- **Coverage (§14 — K17, S16, X5).** New suites `TC-CART-APR-01…11`, `TC-CART-BIND-*`, `TC-CART-LOCK-*`, `TC-CART-TRUST-*`, `TC-CART-ADM-*`, `TC-CART-SWP-*`, `TC-CART-B2B-05`; the proposal list renumbered as `TC-CART-PROP-*` and driven through the API with an API principal (S16). The undo-of-acceptance test inverted to the refusal. The K12 inert-seam test is not added, because the seam ships.
- **Risks (§13).** R6 corrected (header only, no cookie read by the platform). New R17–R23: approval bypass, token-only identity strip, lock lapse mid-payment, abandonment while awaiting approval, approval covering unseen lines, trusted-context bypass, proposals never retired.
- **§16:** Q4 status noted (the seam ships, D-R5-11); Q7–Q9 recorded as closed by D-R5-3/-4, D-R5-12 and D-R5-21. **§16a:** "greenfield" corrected now that Phases 1–3 shipped; Release 5 additions table. **§17:** approval, binding, trusted-context, event-scope and admin-UI rows.

### 2026-10-24 (re-review M1 — PR #7592)

- **M1**: the #7880 fix below reactivated every `cart.lines.*`/`cart.promotions.*` write path but missed `cart.merge` — a merge against an `abandoned` session or guest basket still 404'd instead of reactivating it, so a buyer whose idle basket had been swept could not recover it by logging in and merging a guest cart. `commands/merge.ts` now calls `recordBasketMutationActivity` on both the session and guest carts, right after the lock check and before the (now `abandoned`-free) status gate, matching §9's "any basket mutation" rule. `cart.mdx` and the merge route's `openApi` 404 text corrected to match.

### 2026-10-23 (QA round 2 — #7880)

- **#7880**: the F15 fix listed `abandoned` among the states that refuse a write with `409 cart_not_active`, contradicting §9's `abandoned → active` (baskets only, any mutation, extends `expires_at`). Every buyer write path (`cart.lines.add`/`.update`/`.bulkAdd`/`.remove`, `cart.promotions.apply`/`.remove`) now reactivates an `abandoned` basket first (`lib/cartActivity.ts`), clearing `resolved_at` and extending `expires_at` by the §9 default TTL. The same writes now also advance `last_activity_at`, which §4.1 says drives abandonment but no mutation updated before — an actively used basket was swept to `abandoned` 24 h after creation. Proposals are unaffected (their write paths never load `kind = 'basket'`). §15a's `cart_not_active` row and `cart.mdx` corrected.

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
