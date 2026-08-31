# Checkout Module — Unified Checkout Funnel

| Field | Value |
|-------|-------|
| **Status** | Specification (v2.1 — rescoped 2026-08-14, pre-implementation fixes 2026-08-17) |
| **Author** | Piotr Karwatka (v1), rescoped for the ecommerce suite (v2) |
| **Created** | 2026-03-19 |
| **Rescoped** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 7, Phase 3 |
| **Package** | `@open-mercato/checkout` |
| **Related** | [Phase A — Pay Links](./implemented/2026-03-19-checkout-pay-links.md) *(implemented)*, [Cart Module](./2026-08-14-cart-module.md), [Availability Contract](./2026-08-14-availability-contract.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [SPEC-041 UMES](./implemented/SPEC-041-2026-02-24-universal-module-extension-system.md), [SPEC-044 Payment Gateways](./implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md) |

> **v2 rescope notice.** v1 specified `CheckoutCartItem`, a merchant-defined item list on a link. Per [ADR-3](./2026-08-14-ecommerce-suite-roadmap.md#adr-3--checkout-is-one-funnel-owned-by-open-mercatocheckout), `@open-mercato/checkout` is now the **single checkout funnel for every channel** and consumes a [`cart`](./2026-08-14-cart-module.md) rather than owning line items. `CheckoutCartItem` is withdrawn (§14). SPEC-029 §19's competing workflow-driven session is withdrawn in its own document. Phase A pay links are unchanged and remain in production.

---

## TLDR

**Key Points:**
- One funnel, two entry modes. A **merchant-initiated** checkout (pay link, simple checkout) creates a cart from link-defined lines; a **buyer-initiated** checkout (storefront, POS, agent) arrives with an existing cart token. From the moment a `CheckoutSession` exists, both are the same code path.
- `CheckoutSession` holds `cart_id`, addresses, delivery selection, payment intent and the resulting quote or order. It never holds lines — the cart does.
- **The funnel core is a fixed state machine, not a workflow.** `workflows` is used where it is strong — the B2B approval sub-flow and post-submit orchestration — and kept out of the sub-second, payment-adjacent conversion path. §5 justifies the split.
- Submit is the only authoritative moment: re-price the cart, reserve stock, reserve credit, create the document, take payment, commit the reservation. It is idempotent under retry and safe under concurrent double-submit, or it produces duplicate orders and double charges.
- B2B branches at submit: an approved buyer on account creates an **order** against a reserved credit line; a buyer requesting terms creates a **quote** for the merchant to convert.

**Scope:**
- `CheckoutSession`, `CheckoutSessionEvent`; `CheckoutTransaction` extended with `session_id`
- Cart lock/unlock protocol; the submit transaction and its compensation
- Address capture, delivery rate selection via `shipping_carriers`, payment via `payment_gateways`
- B2B: purchase on account, credit reservation, PO number capture, approval gating, quote-vs-order branch
- Retirement of `CheckoutCartItem` in favour of cart-backed links

**Concerns:**
- The submit path spans five modules with external side effects; partial failure after payment is the highest-consequence scenario in the suite and needs explicit compensation, not optimism
- Cart lock and session lifetime can diverge, stranding a cart nobody can edit or buy
- Reserving stock and credit before payment means a failed payment must release both, reliably, including after a process crash

---

## 1) Overview

Checkout converts intent into a commitment. It is the shortest part of the buyer's journey and carries almost all of the platform's transactional risk: it touches money, stock, credit and legally binding documents, and it does so while a person waits.

The design principle throughout is that **exactly one moment is authoritative**. Everything before submit is advisory, re-tryable and cheap to get wrong. Submit is transactional, idempotent and compensated. Spreading authority across several steps is what produces orders without stock, payments without orders, and credit consumed by baskets nobody bought.

---

## 2) Problem Statement

### 2.1 Two competing checkout models

SPEC-029 §19 specified a workflow-driven `EcommerceCheckoutSession` creating orders. v1 of this document specified `CheckoutCartItem` plus quote→order conversion, also creating orders. Both were unimplemented past Phase A. Two order-creation paths with different idempotency guarantees is how a platform ships duplicate orders.

ADR-3 resolves it: this package owns the funnel. SPEC-029 §19 is withdrawn.

### 2.2 A cart-shaped hole

v1's `CheckoutCartItem` is a merchant-authored, immutable item list. It cannot represent a shopper-mutable basket: no promotion evaluation, no re-pricing, no availability, no quantity tiers, no merge on login. Building the storefront on it would mean re-implementing all of that inside checkout.

With the `cart` module those behaviours exist once. A merchant-defined link becomes *a cart created from a template*, which is strictly more capable than a static item list — a buyer can adjust quantities on a simple checkout link if the merchant allows it.

### 2.3 Nothing coordinates the commitment

Order creation, stock reservation, credit reservation and payment authorization each exist in isolation. Nothing sequences them, and nothing undoes the earlier ones when a later one fails. A payment captured against an order that could not be created is a manual refund and a support incident.

### 2.4 B2B cannot be bolted on afterwards

Purchase on account is not a payment method that skips payment — it consumes a credit line, needs a PO number on the document, may require approval before it can proceed at all, and may produce a quote rather than an order. These decisions happen at submit, in the same transaction as everything else.

---

## 3) Architecture

### 3.1 Position

```
  merchant-initiated                    buyer-initiated
  (pay link, simple checkout)           (storefront, POS, agent)
        │                                        │
        │ CheckoutLink → cart from template      │ existing cart token
        ▼                                        ▼
        └────────────► CheckoutSession ◄─────────┘
                             │
        ┌────────────┬───────┼────────────┬──────────────┬───────────────┐
        ▼            ▼       ▼            ▼              ▼               ▼
      cart      availability  customer_groups   shipping_carriers  payment_gateways   sales
   lock/read     reserve/       credit,           rate quote,        intent,        quote/order
   /reprice      commit         approval          method select      capture        via commandBus
```

`checkout` depends on all of these. None depends on `checkout`.

### 3.2 Entry modes

| Mode | Cart origin | Mutable by buyer |
|---|---|---|
| Pay link (Phase A) | None — a single amount, no cart | n/a, unchanged |
| Simple checkout | Created from `CheckoutLinkCartTemplate` at first visit | Per link setting, default no |
| Storefront / POS / agent | Existing cart, token supplied | Yes, until lock |

Phase A pay links keep their existing path end to end. They create a `CheckoutTransaction` with no `session_id` and no cart, exactly as today. This spec adds nothing to them and removes nothing from them.

### 3.3 Cross-module integration

| Direction | Mechanism |
|---|---|
| → `cart` | DI `cartService`: read, lock, reprice, unlock, mark converted |
| → `availability` | DI `availabilityService`: `reserve`, `release`, `commit` |
| → `customer_groups` | DI `customerGroupsService`: `resolveTerms`, `checkCredit`, `reserveCredit`, `releaseCredit` |
| → `shipping_carriers` | DI rate quoting; selected method snapshotted onto the session |
| → `payment_gateways` | Phase A provider descriptor surface, unchanged |
| → `sales` | `commandBus`: `sales.quotes.create`, `sales.quotes.convert_to_order`, order creation |
| ← `sales` | UMES widget: "Created from checkout" badge when `metadata.sourceModule = 'checkout'` |
| → `promotions` | DI `promotionsService.registerUsage()` at submit step 7 (§7.2); `revertUsage()` called by `sales` on order cancellation, not by `checkout` directly. **Added 2026-08-17** — an earlier draft used `promotionsService` in §7.2 without listing the dependency here; confirmed via `SPEC-055`'s Amendment §A.2, which names `checkout` as the architecturally-destined in-process caller. Hard dependency, same as `cart`'s own `requires: ['promotions']` (`cart-module.md` §A.2b) — no advisory/optional fallback: a failed `registerUsage` call is a real submit failure, not a degraded-but-functional path. |
| → `workflows` | Two uses, both async/human-scheduled per §5: the B2B approval sub-flow (§8.2, session parks in `awaiting_approval` pending a workflow decision) and post-submit orchestration (§5.1). **Added 2026-08-17** — omitted from this table despite being load-bearing for §5's own architecture decision. |

Retained from v1 unchanged, except the two additions above. The quote→order path through the command bus was the right call and is reused for both entry modes.

---

## 4) Data Models

### 4.1 `CheckoutSession` (`checkout_sessions`)

Standard scoped columns.

| Column | Type | Notes |
|---|---|---|
| `token` | text | Opaque, unguessable, CSPRNG; the public identifier |
| `cart_id` | uuid | `cart.Cart.id`. **The session never holds lines** |
| `store_id` | uuid, nullable | `ecommerce.EcommerceStore.id` |
| `link_id` | uuid, nullable | `checkout.CheckoutLink.id` for merchant-initiated |
| `channel` | text | `storefront \| pos \| pay_link \| agent \| api` |
| `status` | text | `open \| awaiting_approval \| submitting \| awaiting_payment \| completed \| failed \| canceled \| expired` |
| `step` | text | `contact \| addresses \| delivery \| payment \| review` |
| `currency_code` | text | From the cart, immutable once the session exists |
| `locale` | text | |
| `email` | text, nullable | Encrypted at rest |
| `phone` | text, nullable | Encrypted at rest |
| `customer_id` / `customer_user_id` | uuid, nullable | |
| `shipping_address` | jsonb, nullable | Encrypted at rest |
| `billing_address` | jsonb, nullable | Encrypted at rest |
| `billing_same_as_shipping` | boolean | |
| `shipping_method` | jsonb, nullable | Snapshot: carrier, service, price, ETA, quoted-at |
| `delivery_window_id` | uuid, nullable | `sales.SalesDeliveryWindow.id` |
| `payment_method_code` | text, nullable | Includes `on_account` |
| `payment_intent_ref` | text, nullable | Gateway reference |
| `purchase_order_number` | text, nullable | B2B |
| `approval_id` | uuid, nullable | `customer_groups.CustomerPurchaseApproval.id` |
| `credit_reservation_key` | text, nullable | Idempotency key used with `reserveCredit` |
| `stock_reservation_key` | text, nullable | Idempotency key used with `availabilityService.reserve` |
| `submit_idempotency_key` | text, nullable | Unique per session; the duplicate-submit guard |
| `outcome_kind` | text, nullable | `order \| quote` |
| `sales_order_id` / `sales_quote_id` | uuid, nullable | |
| `terms_accepted_at` | timestamptz, nullable | |
| `consent_flags` | jsonb, nullable | Marketing consent, passed to promotions |
| `failure_code` / `failure_detail` | text, nullable | |
| `expires_at` | timestamptz | |
| `completed_at` | timestamptz, nullable | |

Indexes: unique `token`; unique `(tenant_id, submit_idempotency_key)` where non-null; `(tenant_id, status, expires_at)`.

**No `version` column** (fixed 2026-08-17): an earlier draft added one for optimistic locking, but this repo's real, already-shipped `@open-mercato/checkout` package (Phase A) never used one — `checkout.link.update`/`checkout.template.update` already lock via `enforceCommandOptimisticLockWithGuards` against `record.updatedAt` (`commands/links.ts`, `commands/templates.ts`), and their own test suite (`commands/__tests__/optimistic-lock.test.ts`) asserts ISO-timestamp comparison, not an integer counter. `CheckoutSession.updatedAt` (standard scoped column, above) is the sole concurrency token — same mechanism this package already uses for `CheckoutLink`/`CheckoutLinkTemplate`, applied here for the first time to a new entity rather than reinvented. The conditional `open → submitting` transition (§7.4) is a separate, additional CAS guard on `status`, not a substitute for this.

### 4.2 `CheckoutSessionEvent` (`checkout_session_events`)

Append-only audit of every step transition, external call and outcome. No update, no delete.

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid | |
| `kind` | text | `step_entered \| field_updated \| rate_quoted \| stock_reserved \| credit_reserved \| payment_initiated \| payment_result \| document_created \| compensation \| failure` |
| `payload` | jsonb | Redacted — never card data, never full addresses |
| `actor` | text | `buyer \| system \| merchant \| agent` |
| `created_at` | timestamptz | |

This exists because a failed checkout is a support conversation, and "what happened" must be answerable without reading application logs. It is the audit trail SPEC-029 §19.2 wanted from workflows, obtained without putting the engine in the hot path.

### 4.3 `CheckoutLinkCartTemplate` (`checkout_link_cart_templates`)

Replaces v1's `CheckoutCartItem`. Merchant-defined lines that seed a cart on first visit.

| Column | Type | Notes |
|---|---|---|
| `link_id` | uuid | FK → `checkout_links` |
| `product_id` / `variant_id` | uuid, nullable | Catalog reference |
| `name` | text | Snapshot or freeform for non-catalog items |
| `description` | text, nullable | |
| `sku` | text, nullable | |
| `quantity` | integer | Default 1 |
| `unit_price_override` | numeric(12,2), nullable | Null → resolve from catalog for the buyer |
| `currency_code` | text | |
| `image_url` | text, nullable | |
| `is_quantity_editable` | boolean | Default `false` |
| `sort_order` | integer | |

Currency rules from v1 are retained: one currency per link; mixed-currency templates rejected at admin write; the currency must be supported by the link's gateway descriptor.

`unit_price_override` is new and matters — with a real cart behind it, a template line without an override resolves the buyer's own price, so a simple checkout link sent to a wholesale customer prices at their contract rate. v1 could not do that.

### 4.4 `CheckoutTransaction` (extended, additive)

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid, nullable | Null for Phase A pay links |
| `quote_id` | uuid, nullable | New, additive — proposed in v1 but never implemented past Phase A (fixed 2026-08-17; the real `CheckoutTransaction` entity has no such column today) |
| `order_id` | uuid, nullable | New, additive — same as above |

Additive nullable columns only. Phase A behaviour is untouched.

---

## 5) Why the Funnel Is Not a Workflow

SPEC-029 §19.2 argued for `workflows` on four grounds: audit trail, per-store configurability, async activities, and saga compensation. Each is real. None requires the engine in the conversion path.

| Argument | Resolution |
|---|---|
| Audit trail | `CheckoutSessionEvent` (§4.2) is append-only and purpose-shaped, with redaction rules a generic event log would not enforce |
| Configurability | Step visibility and order are per-store configuration on the link or store, not a graph. The realistic variation is which of five known steps appear, not arbitrary topology |
| Async activities | Post-submit orchestration **is** a workflow (§5.1). Nothing before submit is async |
| Compensation | The submit transaction has explicit, ordered compensation (§7.3). A saga across five modules with external side effects needs hand-written compensation regardless; a generic engine does not supply it |

Against, and decisive:

- **Latency.** Checkout is the conversion-critical path. Every step transition through a durable engine adds writes and reads to an interaction a person is waiting on.
- **Durability risk.** [Durable Workflow User-Task Continuation](./2026-07-15-durable-workflow-user-task-continuation.md) documents that `completeUserTask()` currently flushes `COMPLETED` before executing the transition, so a failure can leave a completed task on a paused instance. That is an acceptable characteristic for a back-office approval and an unacceptable one for a payment step. It is being fixed; the funnel should not be the first thing to depend on the fix.
- **Testability.** A five-state machine with an explicit transition table is exhaustively testable. A configurable graph is not.

### 5.1 Where `workflows` is used

1. **B2B approval sub-flow** — long-running, human-in-the-loop, spanning hours or days, with notifications and escalation. Exactly what the engine is for. The session parks in `awaiting_approval` and resumes on the workflow's decision.
2. **Post-submit orchestration** — confirmation email, invoice generation, fulfilment handoff, ERP sync. After the buyer is gone, where retries and durability matter more than latency.

The boundary: **synchronous and buyer-facing is a state machine; asynchronous or human-scheduled is a workflow.**

### 5.2 Step machine

```
contact ──► addresses ──► delivery ──► payment ──► review ──► [submit]
   ▲            ▲             ▲            ▲          │
   └────────────┴─────────────┴────────────┴──────────┘   (free backward navigation)
```

Steps are skippable by configuration: a digital-only cart skips `delivery`; a known logged-in buyer with one address skips `contact` and `addresses`; purchase on account skips gateway selection in `payment` but not the step (PO number is captured there).

Backward navigation is always allowed before submit. Changing an address after selecting delivery **invalidates the rate quote** and returns the buyer to `delivery` with the reason stated — a stale rate is a shipping cost the merchant absorbs.

---

## 6) Cart Lock Protocol

| Phase | Cart state | Buyer may edit |
|---|---|---|
| Session created | `active` | Yes |
| Entering `review` | `active` | Yes |
| Submit begins | `locked` (with a forced re-price) | No |
| Submit succeeds | `converted` | No |
| Submit fails | `active` (unlocked) | Yes |
| Session expires or is canceled | `active` (unlocked) | Yes |

The cart is locked **only for the duration of submit**, not for the whole funnel. Locking at session creation would strand a cart behind every abandoned checkout, and abandoned checkouts are the majority.

`cart.lock()` forces a whole-cart re-price (cart spec §5.2 trigger 5). If that changes any total, **submit aborts before any side effect** and returns `409 price_changed` with the `priceChanges` payload. The buyer re-confirms an amount they have seen. This is the mechanism that prevents charging a price the buyer never agreed to.

A locked cart rejects mutation with `423 Locked` and the session id, so a second tab sends the buyer back to checkout rather than showing a broken basket.

---

## 7) Submit

The only authoritative moment in the funnel.

### 7.1 Preconditions

Checked before any side effect; all failures are cheap and leave nothing to undo.

1. Session `open`, not expired, expected `updatedAt` matches (§4.1)
2. `submit_idempotency_key` present and not already completed (§7.4)
3. Cart non-empty and belongs to this session
4. Required steps complete for the effective configuration
5. Terms accepted where required
6. B2B: cart value under `approval_required_above`, or an `approved` approval is attached
7. B2B: cart value at or above `min_order_value`

### 7.2 Sequence

```
 1. cart.lock()                          → forced re-price
    ├─ totals changed → ABORT 409 price_changed (nothing to undo)
    └─ unchanged → continue
 2. availabilityService.reserve(items, key = stock_reservation_key, ttl 900s)
    └─ shortfall → unlock cart, ABORT 409 stock_shortfall (line detail)
 3. IF payment_method = on_account:
       customerGroupsService.reserveCredit(amount, key = credit_reservation_key)
       └─ refused → release stock, unlock cart, ABORT 402 credit_refused
 4. Create the sales document via commandBus:
       outcome_kind = 'quote' → sales.quotes.create           (status awaiting_approval)
       outcome_kind = 'order' → sales.quotes.create
                              + sales.quotes.convert_to_order
    (fixed 2026-08-17: each commandBus.execute() call commits its own
     transaction in this platform — there is no mechanism for two
     sequential calls to share one. If sales.quotes.create succeeds and
     .convert_to_order then fails, the compensation below still applies
     — the orphaned quote is left in place, not deleted, and is visible
     to the merchant exactly like any other unconverted quote; nothing
     is undone at the sales-document layer, only credit/stock/cart)
    └─ failure → release credit, release stock, unlock cart, ABORT 500
 5. IF outcome is a quote → status = completed. DONE. (no payment)
 6. IF payment via gateway:
       status = awaiting_payment; create payment intent; hand off to the provider
       └─ intent creation fails → compensate 4,3,2; ABORT 502
 7. Payment result (callback or polling — Phase A path):
       success → availabilityService.commit(key, orderId)
                 promotionsService.registerUsage(...)
                 cart.markConverted()
                 status = completed
                 emit checkout.session.completed → post-submit workflow
       failure → compensate: cancel order, release credit, release stock,
                 unlock cart, status = failed with failure_code
 8. IF on_account (no gateway):
       availabilityService.commit(key, orderId); credit reservation stands
       until settled by invoicing; status = completed
```

### 7.3 Compensation

Ordered, reverse of acquisition, each step idempotent and safe to re-run:

| Failure at | Compensation |
|---|---|
| 2 (stock) | Unlock cart |
| 3 (credit) | Release stock; unlock cart |
| 4 (document) | Release credit; release stock; unlock cart. If `sales.quotes.create` succeeded but `.convert_to_order` failed (§7.2 step 4 note), the created quote is left in place rather than deleted — it is a legitimate, visible quote a merchant can still act on, not a failed-submit artifact to clean up |
| 6 (intent) | Cancel document; release credit; release stock; unlock cart |
| 7 (payment) | Cancel order; release credit; release stock; unlock cart |

Every compensation is keyed on the same idempotency keys as acquisition, so re-running is a no-op rather than a double release. Each writes a `CheckoutSessionEvent` of kind `compensation`.

**A compensation that itself fails** is written as a `failure` event, raises an operational notification, and enqueues a retry job. It is never swallowed: a leaked stock or credit reservation is invisible inventory or invisible exposure, and both need a human.

### 7.4 Idempotency and concurrency

`submit_idempotency_key` is client-generated, unique per session, sent on every submit attempt.

- First call proceeds
- A repeat while the first is in flight returns `409 submit_in_progress` — it does not queue behind it
- A repeat after success returns the original result, including `sales_order_id`, with `200`
- A repeat after failure is permitted and starts a fresh attempt with fresh reservation keys

Concurrency is enforced by a conditional update `status = 'open' → 'submitting'`. Exactly one caller wins. This is the guard against the double-tap and the retried-request duplicate order.

---

## 8) B2B at Submit

### 8.1 Order or quote

| Buyer situation | Outcome |
|---|---|
| Prepayment via gateway | Order, after payment |
| Purchase on account, credit available | Order, credit reserved |
| Purchase on account, over limit | Blocked at precondition; offered prepayment or a quote |
| Requesting terms / negotiated pricing | Quote for the merchant to convert |
| Over approval threshold, not yet approved | Blocked; `request-approval` offered |

### 8.2 Approval gate

An over-threshold session transitions to `awaiting_approval`, creates a `CustomerPurchaseApproval` (spec 1 §5.6), and starts the approval workflow. The cart is **not** locked while waiting — approval can take days and a locked cart holds nothing useful. On approval the session returns to `open` with a forced re-price; prices may legitimately have moved in the interim, and the approved amount is re-checked against the new total. If the total rose above the approved amount, approval is re-requested rather than silently honoured.

### 8.3 Credit

Reserved at submit via `reserveCredit` in a serializable transaction (spec 1 §6). It is **not** released on order completion — it stands as exposure until invoicing settles it via `settleCredit`. Releasing at completion would mean the limit only constrained in-flight checkouts, which is not what a credit limit is.

### 8.4 PO number

Captured at the `payment` step when the group's terms require it, validated for format if the tenant configures one, and written to the sales document — a B2B invoice without the buyer's PO number will not be paid.

---

## 9) API Contracts

Base `/api/checkout`. Public, token-bound, optional buyer session. Mutating routes take the expected `updatedAt` (standard optimistic-lock header, or a typed body field).

| Method | Path | Purpose |
|---|---|---|
| POST | `/sessions` | Create from a cart token or a link |
| GET | `/sessions/:token` | Current state, step, available transitions |
| PATCH | `/sessions/:token` | Contact, addresses, PO number, consent |
| POST | `/sessions/:token/step` | Navigate; validates the step being left |
| GET | `/sessions/:token/delivery-options` | Live rate quote for the current address and cart |
| POST | `/sessions/:token/delivery` | Select a method; snapshots the rate |
| GET | `/sessions/:token/payment-methods` | Available methods incl. `on_account` eligibility |
| POST | `/sessions/:token/payment` | Select method; create the intent when applicable |
| POST | `/sessions/:token/request-approval` | B2B approval |
| POST | `/sessions/:token/submit` | §7. Requires `Idempotency-Key` |
| POST | `/sessions/:token/cancel` | Unlock the cart, release reservations |
| GET | `/sessions/:token/result` | Post-submit outcome for the confirmation page |

Admin: `GET /api/checkout/sessions` and `/sessions/:id` under `checkout.sessions.view`, including the event trail. Read-only.

### 9.1 ACL

**Fixed 2026-08-17**: an earlier draft invented `checkout.links.view`/`checkout.links.manage` and labeled them `// Phase A`. Neither id exists — the real, already-shipped `acl.ts` declares six flat features (`checkout.view`, `.create`, `.edit`, `.delete`, `.viewPii`, `.export`) with no `checkout.links.*` namespace. Implementing the fabricated ids as written would have created a second, uncoordinated authorization surface over the same links/templates resource. Corrected: link/template access reuses the real Phase A features unchanged; only the genuinely new session-admin surface (§9, admin routes) gets new ids.

```typescript
// Reused from Phase A, unchanged — packages/checkout/src/modules/checkout/acl.ts
// checkout.view    — includes viewing checkout links and transactions (now also sessions, §9)
// checkout.create  — includes creating checkout links/templates
// checkout.edit    — includes editing checkout links/templates
// checkout.delete  — includes deleting checkout links/templates
// checkout.viewPii — customer PII on links/transactions (now also on sessions)
// checkout.export  — exporting checkout transactions

// New in this spec
export const newFeatures = [
  { id: 'checkout.sessions.view',   title: 'View checkout sessions', module: 'checkout', dependsOn: ['checkout.view'] },
  { id: 'checkout.sessions.manage', title: 'Manage checkout sessions (force-expire, force re-price)', module: 'checkout', dependsOn: ['checkout.sessions.view'] },
]
```

`GET /api/checkout/sessions`/`:id` (§9, admin) gate on `checkout.sessions.view`; the admin-forced actions gate on `checkout.sessions.manage`. Link/template routes keep gating on `checkout.view`/`.edit`/`.create`/`.delete` exactly as they do today — no change to Phase A's authorization surface.

---

## 10) Events

```typescript
'checkout.session.created' | '.step_changed' | '.submitted' | '.completed'
                           | '.failed' | '.canceled' | '.expired'
'checkout.session.approval_requested' | '.approved' | '.rejected'
'checkout.payment.initiated' | '.succeeded' | '.failed'
'checkout.compensation.executed' | '.failed'
'checkout.cartTemplate.created' | '.updated' | '.deleted' | '.reordered'
```

`checkout.session.completed` starts the post-submit workflow (§5.1). `checkout.compensation.failed` raises an operational notification — it is the event that must never be ignored.

**Relationship to Phase A's `checkout.transaction.*` events (clarified 2026-08-17)**: Phase A's existing `checkout.transaction.sessionStarted`/`.completed`/`.failed` are unchanged AND continue to fire for every `CheckoutTransaction` row, session-backed or not — `checkout.payment.*` is additive and session-scoped, firing *alongside* the transaction-level events for a session-based checkout, not instead of them. A subscriber written against Phase A's `checkout.transaction.*` family (transaction-scoped, works for both pay-link and session flows) keeps working unmodified; a new subscriber that needs session context (step, cart, buyer) uses `checkout.payment.*` instead.

---

## 11) Commands

Retained from v1, renamed for the template:

| Command | Undo |
|---|---|
| `checkout.cartTemplate.create` | Delete the created row |
| `checkout.cartTemplate.update` | Restore the before-snapshot |
| `checkout.cartTemplate.delete` | Restore the row |
| `checkout.cartTemplate.reorder` | Restore the previous order |
| `checkout.session.lock` | none — locking a cart for submit is not meaningfully reversible mid-flow |
| `checkout.session.reserveStock` | none |
| `checkout.session.reserveCredit` | none |
| `checkout.session.createDocument` | none |
| `checkout.session.initiatePayment` | none |
| `checkout.session.complete` | none |
| `checkout.session.fail` | none |

Admin mutations remain undoable. **Fixed 2026-08-17**: an earlier draft said session transitions are "not commands... exposing them as undoable admin operations would let a merchant 'undo' a payment" — but non-undoable and command-routed are not the same choice, and Phase A's own `checkout.transaction.create`/`checkout.transaction.updateStatus` are already command-routed despite having no meaningful undo either (`commands/transactions.ts`). Each step of the submit sequence (§7.2) is now a registered command with a no-op `undo` — this keeps the correct, load-bearing rule (a payment must never be "undoable") while giving session writes the same mutation-guard/interceptor/audit wiring every other domain write in this platform gets through the command bus.

`checkout.transaction.updateStatus` itself has, since 2026-08-04, enforced a strict transition state machine (`VALID_CHECKOUT_TRANSITIONS`, rejecting regressions out of `completed`/`failed`/`cancelled`/`expired`) plus an atomic compare-and-swap via `tx.nativeUpdate` with the previous status pinned in the `WHERE` clause, returning `409` on a lost write race between the submit route and the gateway webhook. The conditional `open → submitting` guard on `CheckoutSession.status` (§7.4) is the same CAS pattern applied to the new session entity.

---

## 12) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `expire-checkout-sessions` | every 5 min | Expire past TTL; unlock carts; release reservations |
| `recover-stuck-submits` | every minute | Sessions in `submitting` beyond 120 s: determine the true outcome from the gateway and either complete or compensate |
| `retry-failed-compensations` | every 5 min | Re-run failed compensations with backoff; escalate after 5 attempts |
| `expire-awaiting-payment` | every 5 min | Past the intent TTL: compensate and fail |

`recover-stuck-submits` handles the crash-between-steps case. Without it, a process dying at step 6 leaves stock and credit reserved against a session nobody will ever complete.

---

## 13) Security

- Session token is CSPRNG, never in a URL path, rotated never (the session is short-lived), rate-limited per token
- A session may only be created against a cart the caller can prove access to — the cart token, or an authenticated session owning the cart
- Addresses, email and phone encrypted at rest; read through the decryption helpers. **Named 2026-08-17**: extends the already-shipped `checkout/encryption.ts`'s `defaultEncryptionMaps` (which already covers `checkout:checkout_link_template`, `checkout:checkout_link`, `checkout:checkout_transaction`) with `{ entityId: 'checkout:checkout_session', fields: [{ field: 'email' }, { field: 'phone' }, { field: 'shipping_address' }, { field: 'billing_address' }] }` — reusing existing infrastructure, not new plumbing.
- Card data never touches the platform; the Phase A provider delegation is unchanged
- `CheckoutSessionEvent.payload` is redacted at write time — never card data, never full addresses, never gateway secrets
- Rate limits: submit 10/min per session and 60/min per IP; rate quoting 30/min per session (each call may hit a carrier API)
- `on_account` eligibility is resolved server-side from group terms; a client asking for it without entitlement is refused, never trusted
- Cross-tenant: session, cart, link and store must resolve to the same tenant and organization, checked on every request

---

## 14) Withdrawn from v1

| v1 element | Disposition |
|---|---|
| `CheckoutCartItem` entity | **Withdrawn.** Replaced by `CheckoutLinkCartTemplate` seeding a real `Cart`. Never implemented — Phase B was unscheduled — so this is a specification change with no migration and no deprecation protocol. |
| `checkout.cartItem.*` commands | Renamed to `checkout.cartTemplate.*`. Never shipped. |
| Cart totals computed in checkout | Withdrawn. The cart owns totals via `salesCalculationService` (ADR-2); checkout reads them. |
| One-page checkout as the only shape | Generalized to the configurable step machine (§5.2). A one-page layout remains achievable by enabling all steps on one screen — that is a presentation decision for spec 10. |

Phase A is untouched: `CheckoutLinkTemplate`, `CheckoutLink` and `CheckoutTransaction` keep their behaviour, and the pay-link flow does not pass through `CheckoutSession`.

---

## 15) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Payment captured without an order | **Critical** | Payment succeeds at step 7; order creation already succeeded at 4 but the completion write fails; the buyer is charged and sees a failure. | Document is created **before** payment (step 4 precedes 6), so a successful payment always has a document to attach to; `recover-stuck-submits` reconciles against the gateway; compensation cancels the order on payment failure | Low |
| R2 | Duplicate order from double submit | **Critical** | Double-tap or a retried request creates two orders and two charges. | Conditional `open → submitting` transition admits exactly one caller; `submit_idempotency_key` unique per session; a repeat returns the original result (§7.4); a concurrent-submit test is a merge gate | Low |
| R3 | Leaked stock or credit reservation | **High** | The process dies between steps 2 and 4; stock and credit stay reserved against a session that will never complete. Invisible inventory and invisible credit exposure. | `recover-stuck-submits` every minute; reservation TTLs are independent backstops; `retry-failed-compensations` with escalation; `checkout.compensation.failed` raises an operational notification | Low |
| R4 | Price changed between review and charge | **High** | A promotion expires during checkout; the buyer is charged more than the reviewed total. | `cart.lock()` forces a re-price and submit **aborts** on any change with `409 price_changed` before any side effect; the buyer re-confirms (§6) | Low |
| R5 | Stale shipping rate | Medium | The buyer changes the address after selecting delivery; the quoted rate no longer applies and the merchant absorbs the difference. | An address change invalidates the quote and returns the buyer to `delivery` with the reason stated (§5.2); the rate snapshot carries `quotedAt` and is re-validated at submit | Low |
| R6 | Cart stranded in `locked` | Medium | Submit crashes after locking; the buyer cannot edit their basket and sees a permanently broken cart. | Lock only spans submit; `cart`'s `release-stale-locks` job runs every 5 minutes; every compensation path unlocks; session expiry unlocks | Low |
| R7 | Credit overshoot via concurrent checkouts | **High** | Two on-account checkouts for one customer each pass the precondition and jointly exceed the limit. | `reserveCredit` re-checks inside a serializable transaction (spec 1 R1); the precondition check is advisory and the reservation is authoritative | Low |
| R8 | Approval bypassed by a price change | Medium | A cart approved at 150 000 re-prices to 180 000 after approval and is submitted against the stale approval. | On resume, the re-priced total is re-checked against the approved amount; a higher total re-requests approval (§8.2) | Low |
| R9 | Compensation failure swallowed | **High** | A release call fails and is logged but not surfaced; the leak persists silently. | Never swallowed: a `failure` event, an operational notification, a retry job, escalation after 5 attempts (§7.3) | Low |
| R10 | Rate-quote API abuse | Medium | Each `delivery-options` call hits a carrier API; scripted calls incur cost and may trip carrier rate limits. | 30/min per session; quotes cached 5 min per address+cart hash; carrier failures degrade to configured flat rates rather than blocking checkout | Low |

---

## 16) Integration Coverage

**Submit correctness (Phase 3 gate):**
- Happy-path B2C: order created, stock committed, payment captured, cart converted
- Happy-path B2B on account: order created, credit reserved and standing, no gateway call
- Quote outcome: quote created, no payment, no stock commitment
- Concurrent double submit creates exactly one order (R2)
- Repeated `Idempotency-Key` after success returns the original `sales_order_id`
- Repeat while in flight returns `409 submit_in_progress`
- Retry after failure starts a fresh attempt with fresh reservation keys

**Compensation:**
- Injected failure at each of steps 2, 3, 4, 6 and 7 leaves no reservation, no document and an unlocked cart
- A failing compensation raises the notification and is retried (R9)
- A process killed mid-submit is reconciled by `recover-stuck-submits` (R3)

**Price and rate integrity:**
- A promotion expiring mid-checkout aborts submit with `409 price_changed` and no side effect (R4)
- An address change after delivery selection invalidates the quote and returns to `delivery` (R5)
- A rate older than its validity is re-quoted at submit

**B2B:**
- Over-threshold session blocks submit and offers approval
- Approval, re-price upward, re-approval required (R8)
- Credit refused blocks submit and offers prepayment or a quote
- N parallel on-account submits respect the limit exactly (R7)
- PO number required by group terms blocks submit when absent, and reaches the document
- Below `min_order_value` blocked at precondition

**Cart interaction:**
- Cart locked only during submit; mutation while locked returns `423` with the session id
- Every failure path unlocks; the stale-lock job unlocks a crashed one (R6)
- Cart marked `converted` only on success

**Entry modes:**
- Phase A pay link is unaffected: no session, no cart, existing path end to end
- A simple checkout link seeds a cart from the template; a template line without `unit_price_override` prices at the buyer's own rate
- `is_quantity_editable = false` rejects a quantity change
- A storefront session over an existing cart token

**Security:** cross-tenant session/cart/link combinations rejected; addresses encrypted at rest; event payloads redacted; `on_account` refused without entitlement; rate limits enforced.

---

## 17) Implementation Plan

### Phase B.1 — Session and step machine
`CheckoutSession`, `CheckoutSessionEvent`, token handling, step machine with configurable visibility, contact and address capture, optimistic locking, session expiry.

**Gate:** the step machine's transition table is exhaustively tested; sessions expire and unlock cleanly.

### Phase B.2 — Cart-backed links
`CheckoutLinkCartTemplate`, template→cart seeding, `checkout.cartTemplate.*` commands, admin CrudForm group, currency and gateway-descriptor validation.

**Gate:** a template line without an override prices per buyer; mixed-currency templates rejected.

### Phase B.3 — Delivery and payment
Rate quoting via `shipping_carriers` with caching and degradation, method selection and snapshotting, payment-method resolution including `on_account` eligibility, intent creation over the Phase A surface.

**Gate:** stale-rate invalidation verified; carrier failure degrades rather than blocking.

### Phase B.4 — Submit
The full sequence, compensation, idempotency, concurrency guard, recovery and retry jobs, quote-vs-order branch.

**Gate:** every submit-correctness and compensation test passes, including the killed-process case.

### Phase B.5 — B2B
Credit reservation, approval gating and resume, PO capture, `min_order_value`, on-account documents.

**Gate:** the parallel on-account limit test passes; re-approval on price increase verified.

### Phase B.6 — Hardening
Rate limits, encryption, redaction, admin session viewer with the event trail, post-submit workflow, integration coverage.

---

## 18) Open Questions

1. **Guest checkout for on-account** — assumed impossible: purchase on account requires an authenticated `CustomerUser` linked to a company. Confirm no tenant needs a magic-link variant.
2. **Partial fulfilment at submit** — when only part of a cart is reservable, the current design fails the whole submit. Allowing a split (ship what is available, backorder the rest) is a real B2B expectation and needs its own design.
3. **Saved payment methods** — repeat B2B buyers will want stored instruments. Belongs to `payment_gateways` plus spec 9, not here.
4. **Multi-currency on account** — a credit account is per currency (spec 1 §15.3). A buyer checking out in a currency with no account is refused; whether that should fall back to prepayment automatically is a merchandising decision.

---

## 19) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | All references are FK ids; cart, availability, groups, shipping, payments and sales reached via DI or `commandBus` |
| No reimplemented arithmetic | Totals come from the cart, which delegates to `salesCalculationService` (ADR-2) |
| Tenant/organization scoping | Session, cart, link and store must agree; asserted per request and per test |
| Optimistic locking | `updatedAt` via `enforceCommandOptimisticLockWithGuards` (fixed 2026-08-17 — no `version` counter; matches Phase A's already-shipped `checkout.link.update`/`.template.update`); conditional `open → submitting` transition is a separate, additional CAS guard |
| Encryption | Email, phone and both addresses encrypted; read via `findWithDecryption`; event payloads redacted; extends the already-shipped `checkout/encryption.ts` (§13, named 2026-08-17) |
| Zod validation | All routes; `z.infer` types |
| No `any` | State machine, session and payload contracts fully typed |
| Mutation guards / commands | Admin template mutations and session transitions both command-routed (§11, fixed 2026-08-17); session-transition commands carry no meaningful undo, admin mutations do |
| i18n | Step labels, failure codes and validation messages translated |
| Queue usage | All four jobs via the `queue` worker contract |
| ACL feature reuse | Link/template routes gate on Phase A's real `checkout.view`/`.edit`/`.create`/`.delete` (fixed 2026-08-17 — an earlier draft fabricated `checkout.links.view`/`.manage`, which don't exist); only `checkout.sessions.view`/`.manage` are genuinely new (§9.1) |
| Module dependencies (`requires`) | Hard: `cart`, `sales`, `promotions` (§3.3, added 2026-08-17), `availability`, `customer_groups`. Soft/consumer-only, unchanged from Phase A: `payment_gateways`, `shipping_carriers`. `workflows` is used (§5.1, §8.2) but only for the async approval/post-submit paths, not the synchronous funnel |
| Backward compatibility | Phase A unchanged; `CheckoutTransaction` extended with nullable columns only; withdrawn v1 elements were never implemented, so no deprecation protocol applies |
| Integration coverage | §16, shipping in the same change |

---

## 20) Changelog

### 2026-08-21 — merged with `main`

Reconciled with `main`'s `checkout.transaction.updateStatus` hardening (PR #4814, merged 2026-08-04): a strict transition state machine (`VALID_CHECKOUT_TRANSITIONS`) plus an atomic compare-and-swap via `tx.nativeUpdate`, closing a race between the submit route and the gateway webhook. No spec changes were required beyond noting it in §11 (Undo/Command Semantics) as the precedent the new `CheckoutSession.status` CAS guard (§7.4) follows.

### 2026-08-17 — v2.1 (pre-implementation fixes)

Fixed the findings of a `/om-pre-implement-spec` audit (`ANALYSIS-2026-03-19-checkout-simple-checkout.md`), run against the already-shipped Phase A source (`packages/checkout/src/modules/checkout/`) rather than against convention alone, since this spec extends live code:

- **Critical**: `CheckoutSession.version: integer` removed — the fourth occurrence of this mistake across the suite, and the worst, since it contradicted Phase A's own already-shipped `enforceCommandOptimisticLockWithGuards`/`updatedAt` pattern (`commands/links.ts`, `commands/templates.ts`). `updatedAt` is now the sole concurrency token throughout §4.1/§7.1/§9/§19.
- **Critical**: §9.1 fabricated `checkout.links.view`/`checkout.links.manage` labeled "Phase A" — neither exists in the real `acl.ts` (which declares `checkout.view`/`.create`/`.edit`/`.delete`/`.viewPii`/`.export`). Fixed: link/template routes reuse the real features unchanged; only `checkout.sessions.view`/`.manage` are genuinely new.
- Added `promotions` (hard dependency, §7.2 step 7's `registerUsage` call) and `workflows` (approval sub-flow, post-submit orchestration) to §3.3's cross-module integration table — both were used elsewhere in the document but absent from its own dependency table.
- §11: session transitions are now registered, non-undoable commands (mirroring Phase A's own `checkout.transaction.updateStatus` precedent) rather than framed as exempt from the command bus entirely — the "never undoable" rule is unchanged, only the "therefore not a command" conclusion was wrong.
- §7.2 step 4: clarified that two sequential `commandBus.execute()` calls do not share one DB transaction in this platform (each commits independently); added the resulting orphaned-quote case to §7.3's compensation table.
- §4.4: reworded `CheckoutTransaction.quote_id`/`.order_id` from "retained from v1" to "new, additive" — the real entity has neither column today.
- §10: clarified `checkout.payment.*` fires alongside, not instead of, Phase A's existing `checkout.transaction.*` events.
- §13/§19: named the exact `checkout/encryption.ts` addition backing the `CheckoutSession` encryption claim, reusing the package's already-shipped encryption-map infrastructure.

### 2026-08-14 — v2 (rescope)

- Rescoped from "simple checkout for pay links" to **the unified checkout funnel for every channel**, per ADR-3. SPEC-029 §19's competing workflow-driven session is withdrawn in that document.
- Withdrew `CheckoutCartItem` in favour of `CheckoutLinkCartTemplate` seeding a real `Cart` (§14). Never implemented, so no migration. Added `unit_price_override`, so a link sent to a wholesale buyer prices at their contract rate — impossible under v1's static item list.
- Introduced `CheckoutSession` holding `cart_id` rather than lines, and `CheckoutSessionEvent` as a purpose-shaped, redacted audit trail.
- **Decided the roadmap's open question on the step machine:** fixed state machine for the synchronous funnel, `workflows` for the B2B approval sub-flow and post-submit orchestration (§5). Grounded partly in [Durable Workflow User-Task Continuation](./2026-07-15-durable-workflow-user-task-continuation.md), which documents that `completeUserTask()` currently flushes `COMPLETED` before executing its transition — acceptable for a back-office approval, not for a payment step.
- Specified the submit sequence with ordered, idempotent compensation, a conditional-transition concurrency guard and a crash-recovery job (§7, §12).
- Added the cart lock protocol with a mandatory re-price and abort-on-change (§6), closing the undisclosed-price-increase risk.
- Added B2B at submit: order-vs-quote branch, credit reservation held until settlement rather than released on completion, approval gating with re-approval on price increase, PO capture (§8).
- Retained from v1 unchanged: the quote→order path via `commandBus`, currency rules for links, undoable admin mutations, UMES traceability widget, and the entire Phase A pay-link flow.

### 2026-03-19 — v1

- Initial Phase B specification: `CheckoutCartItem`, product/service selection from catalog or freeform, one-page checkout, quote creation on submit and order creation on payment, `salesCalculationService` integration, UMES extension points, four-phase plan. *(Cart ownership and the funnel shape superseded by v2; the sales integration approach carried forward.)*
