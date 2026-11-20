# Checkout Module — Unified Checkout Funnel

| Field | Value |
|-------|-------|
| **Status** | Specification (v2.4.1 — recovery never fresh-locks, payment results decided by the intent's disposition 2026-11-20; v2.4 — Release 5 re-landing remediation 2026-11-19 on top of the v2.3 revision of 2026-10-26; Phases B.1–B.5 in eComm Release 5, re-landed as steps CH0a–CH6b (§17); B.6 out except the security minimum moved into B.1/B.3) |
| **Author** | Piotr Karwatka (v1), rescoped for the ecommerce suite (v2) |
| **Created** | 2026-03-19 |
| **Rescoped** | 2026-08-14 |
| **Revised** | 2026-10-26 (Release 5: [pre-implementation analysis](./analysis/ANALYSIS-2026-10-26-checkout-release-5.md) C1–C26, [owner decisions](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md) D-R5-1…36, [cross-spec review](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md) X1–X20); 2026-11-19 (re-landing audit [`pre-implement-2026-03-19-checkout-simple-checkout-release-5.md`](../analysis/pre-implement-2026-03-19-checkout-simple-checkout-release-5.md), owner decisions D-R5-CH1…CH7, §21) |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 7, Phase 3 |
| **Package** | `@open-mercato/checkout` |
| **Related** | [Phase A — Pay Links](./implemented/2026-03-19-checkout-pay-links.md) *(implemented)*, [Cart Module](./2026-08-14-cart-module.md), [Availability Contract](./2026-08-14-availability-contract.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), SPEC-055 Promotions (C5, D-R5-17 amendments), SPEC-029 (`storeContextService.resolveForBuyer`, D-R5-22), [SPEC-041 UMES](./implemented/SPEC-041-2026-02-24-universal-module-extension-system.md), [SPEC-044 Payment Gateways](./implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md) |

> **v2 rescope notice.** v1 specified `CheckoutCartItem`, a merchant-defined item list on a link. Per [ADR-3](./2026-08-14-ecommerce-suite-roadmap.md#adr-3--checkout-is-one-funnel-owned-by-open-mercatocheckout), `@open-mercato/checkout` is now the **single checkout funnel for every channel** and consumes a [`cart`](./2026-08-14-cart-module.md) rather than owning line items. `CheckoutCartItem` is withdrawn (§14). SPEC-029 §19's competing workflow-driven session is withdrawn in its own document. Phase A pay links are unchanged and remain in production.

> **Release 5 notice (v2.3).** Phases B.1–B.5 ship in eComm Release 5. The platform sells through the API and pay links, with no storefront of its own, so every buyer route is specified as a public API contract (§9.0). B.6 (admin session viewer, the four seeded workflow definitions of §5.1) stays out; its security minimum (rate limits, session encryption map, event redaction, token hash, cross-tenant check) moves into B.1/B.3 (C14).

---

## TLDR

**Key Points:**
- One funnel, two entry modes. A **merchant-initiated** checkout (simple checkout link) seeds a cart from link-defined lines through a trusted in-process context (D-R5-19); a **buyer-initiated** checkout (storefront API client, POS, agent) arrives with an existing cart token. From the moment a `CheckoutSession` exists, both are the same code path.
- `CheckoutSession` holds `cart_id`, addresses, delivery selection, payment method, PO number and the resulting quote or order. It never holds lines (the cart does) and never holds an approval (the cart is the approval subject, D-R5-3).
- The session is addressed as `/api/checkout/sessions/current/*` with an `X-Checkout-Session-Token` header. Only a hash of the token is stored. A session on an identified cart also needs the buyer's own customer session on every route, otherwise `404` (D-R5-21, D-R5-33).
- **The funnel core is a fixed state machine, not a workflow.** No workflow runs in Release 5. Approval resumes are event-driven from `customer_groups` (C11).
- Submit is the only authoritative moment. In order:
  1. lock and re-price the cart (with a fresh visibility pass);
  2. re-evaluate delivery promotions, check the cart's sales snapshot against `Cart.totals`, and have `sales` compute the payable amount (D-R5-CH6);
  3. reserve stock;
  4. reserve credit for the full payable amount;
  5. create the order directly with `sales.orders.create` (or, for `request_quote`, the quote), idempotently under `external_reference`, and check its persisted totals (D-R5-CH1);
  6. commit stock, link the credit reservation and consume promotion codes and budgets;
  7. only then take payment, and record it on the order.

  After the order exists, every failure is compensated by **cancelling the order** (§7.3).
- B2B branches at submit: on account creates an **order** against reserved credit; the `request_quote` payment method creates a **quote** for the merchant to convert (D-R5-20). No checkout order passes through a quote.
- `checkout` declares no new `requires`. Session features soft-resolve their peers, and Phase A pay links keep working with none of them installed (D-R5-18). Checkout reads other modules' data only through their services, never with queries on their tables (D-R5-CH5).

**Scope:**
- `CheckoutSession`, `CheckoutSessionEvent`; `CheckoutTransaction` extended with `session_id`, `quote_id`, `order_id` and the payment-recording markers (§4.4)
- Cart lock/extend/unlock protocol across payment; the submit sequence and its compensation; payment recording on the order; the recovery decision table and the repair jobs
- Three Phase A changes: fail-closed rate limits answer `503` without a limiter, and the gateway subscribers rethrow retryable failures and resume session payments (§3.2)
- Address capture, delivery rate selection via `shipping_carriers` with a flat-rate fallback, delivery promotions, payment via `payment_gateways`
- B2B: purchase on account, credit reservation, PO number capture, approval gating with event-driven resume, quote branch
- Retirement of `CheckoutCartItem` in favour of cart-backed links

**Concerns:**
- The submit path spans six modules with external side effects. Partial failure after payment is the highest-consequence scenario in the suite and needs explicit compensation, not optimism.
- Cart lock and session lifetime can diverge, stranding a cart nobody can edit or buy, or releasing a cart the buyer is still paying for (C1).
- Reserving stock and credit, and consuming codes, before payment means a failed payment must reverse all of them reliably, including after a process crash.

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

Order creation, stock reservation, credit reservation, promotion usage and payment authorization each exist in isolation. Nothing sequences them, and nothing undoes the earlier ones when a later one fails. A payment captured against an order that could not be created is a manual refund and a support incident.

### 2.4 B2B cannot be bolted on afterwards

Purchase on account is not a payment method that skips payment — it consumes a credit line, needs a PO number on the document, may require approval before it can proceed at all, and may produce a quote rather than an order. These decisions happen at submit, in the same sequence as everything else.

---

## 3) Architecture

### 3.1 Position

```
  merchant-initiated                    buyer-initiated
  (simple checkout link)                (storefront API client, POS, agent)
        │                                        │
        │ CheckoutLink → cart from template      │ X-Cart-Token (+ customer session
        │ (trusted context, D-R5-19)             │  when the cart is identified)
        ▼                                        ▼
        └────────────► CheckoutSession ◄─────────┘
                             │
   ┌──────────┬──────────────┼───────────────┬───────────────┬───────────────┬──────────┐
   ▼          ▼              ▼               ▼               ▼               ▼          ▼
  cart   availability  customer_groups   promotions   shipping_carriers payment_gateways sales
 lock/    reserve/      credit,           evaluate,     rate quote        intent,       quote/order
 extend/  release/      approval (read)   useCode,                        status        via commandBus
 convert  commit                          registerUsage
```

`checkout` uses all of these, and none depends on `checkout`. Every arrow is **soft**: §3.4 states what each session feature does when its peer is absent.

### 3.2 Entry modes

| Mode | Cart origin | Mutable by buyer |
|---|---|---|
| Pay link (Phase A) | None — a single amount, no cart | n/a, unchanged |
| Simple checkout | Created from `CheckoutLinkCartTemplate` at first visit, channel `pay_link`, through the trusted context (§4.3) | Per template line (`is_quantity_editable`), default no |
| Storefront API / POS / agent | Existing cart, `X-Cart-Token` supplied | Yes, until lock |

Phase A pay links keep their existing path end to end. They create a `CheckoutTransaction` with no `session_id` and no cart, exactly as today. A test boots an app with only `checkout` + `payment_gateways` and completes a pay link (D-R5-18). Release 5 changes Phase A in exactly these ways (each is Ask First under `packages/checkout/AGENTS.md` and approved; §14a rows 14–17):

1. **Fail-closed without a limiter (CH0a).** A route whose rate limit is declared `fail-closed` answers `503` when no `rateLimiterService` is registered. Today `enforceCheckoutRateLimit` logs and skips the check in that case. This applies to `POST /api/checkout/pay/[slug]/submit` and `/verify-password` and to every fail-closed session route (§13). Fail-open routes keep today's behaviour.
2. **Gateway subscribers (CH0b, D-R5-CH3).** The four `gateway-payment-{authorized,captured,failed,cancelled}` subscribers split failures in two. A `404`/`409` refusal from `checkout.transaction.updateStatus` cannot be fixed by a retry: it goes to `main`'s `reportGatewayStatusSyncFailure` (`checkout/lib/gateway-status-sync.ts`, #9597) and is swallowed. That helper logs the expected refusals at debug level and reports the terminal `409` ("captured on an expired transaction") as an error. Every other failure (a non-HTTP error, a `5xx`, a lock or connection timeout) is reported with `reportError` and rethrown, so the persistent event is redelivered. The helper's export stays. For a transaction with a `session_id`, the subscriber also resumes the session (§7.2 step 7, "Payment result").
3. **Link-less transactions.** `checkout_transactions.link_id` becomes nullable, because a session-backed transaction has no link (§4.4). `checkout.transaction.updateStatus` accepts a row without a link instead of answering `404`; the Phase A link branch is unchanged.

### 3.3 Cross-module integration

| Direction | Mechanism |
|---|---|
| → `cart` | DI `cartService`: `lock` (with `checkoutSessionId`, `lockTtlMs`, `purpose`, route context), `unlock`, `markConverted` (with `salesOrderId`/`salesQuoteId` and `lineMap`), and the read methods listed below (D-R5-CH5). Command `cart.approval.request` for `request-approval`. Commands `cart.create` and the line adds for link seeding (D-R5-19). |
| → `availability` | `commandBus`: `availability.reserve`, `availability.release`, `availability.commit`, every input scoped by `{ tenantId, organizationId }` and keyed by `stock_reservation_key`; `reserve` also passes `storeId: cart.storeId` (null for a store-less cart, Availability D-R5-AV6) |
| → `customer_groups` | DI `customerGroupsService.resolveTerms` (terms incl. `approval_required_above`, `min_order_value`, `terms_currency_code`, `allow_purchase_on_account`, `allow_quote_requests`, `requires_po_number`). DI `customerCreditService`: `checkCredit`, `reserveCredit`, `releaseCredit`, `linkCreditReservationToOrder`. DI `customerPurchaseApprovalService`: `getApproval`, `getActiveApprovalForSubject` (read only; checkout creates no approval, D-R5-3). Subscribes to `customer_groups.approval.*` (§8.2). |
| → `ecommerce` (SPEC-029) | DI `storeContextService.resolve(request, { fresh: true })` at the edge; `storeContextService.resolveForBuyer(...)` for pay-link buyer identity (D-R5-22); recovery never calls it (D-R5-SF4) |
| → `promotions` | DI `promotionsService`: `evaluate` with delivery context (D-R5-17), `useCode` with the `orderId` (`UseCodeInput.orderId`), `registerUsage` before payment (C5, D-R4-26). Checkout calls no reversal itself. Reversal after cancellation is **promotions-owned**: a promotions subscriber on `sales.order.cancelled` runs `revertUsage({ orderId })` and `revertCodeUse({ orderId })` idempotently (SPEC-055 amendment, C5). Because `useCode` already carries the `orderId`, that subscriber covers every use checkout consumed. `revertCodeUse?` is an optional member of the service; a caller that needs it checks for it and fails closed when it is absent. `sales` never calls promotions. |
| → `shipping_carriers` | DI `shippingCarrierService.calculateRates` (§5.3); selected method snapshotted onto the session |
| → `wms` | Soft. The primary warehouse's address as the delivery origin (§5.3), through a new `wms` read method (below). Carrier quoting is gated on that method's availability, never on `wmsReservationService`. |
| → `payment_gateways` | `paymentGatewayService.createPaymentSession`, `getPaymentStatus`, and in lost-lock reconciliation `cancelPayment`/`refundPayment` with their existing optional `operationId` (§7.2). The existing surface, unchanged |
| → `sales` | `commandBus`: `sales.orders.create` for the order outcome (D-R5-CH1), with `suppressStaffNotification: true` (D-R5-CH8), `sales.quotes.create` for the `request_quote` outcome only, `sales.orders.update` (status `confirmed` at completion, `canceled` in compensation), `sales.payments.create` for a captured or authorised gateway payment (§7.2 step 7). Reads through the `sales` lookup service listed below (D-R5-CH5). |
| ← `sales` | UMES widget: "Created from checkout" badge when `metadata.sourceModule = 'checkout'` |
| → `workflows` | **None in Release 5.** The four post-conversion definitions of §5.1 are B.6. Checkout emits its events (§10) either way, so a later definition subscribes without a checkout change. |

**Peer reads go through services (D-R5-CH5).** Checkout never queries another module's tables, with an ORM or with Kysely. It reads through the services below. The ones marked *new* are cross-module requirements on the owning spec (§16, "Cross-module requirements").

| Service | Method | Returns | Used by |
|---|---|---|---|
| `cartService` (*new reads*, cart spec) | `getCheckoutView({ cartId, tenantId, organizationId })` | status, lock holder (`checkoutSessionId`), `channel`, `storeId`, `salesChannelId`, `currencyCode`, `locale`, `customerId`, `customerUserId`, the company id, `approvalId`, `updatedAt`, `totals` (the `Cart.totals` keys as decimal strings) | session create, every `/current/*` binding check (§9.0), submit preconditions, recovery |
| `cartService` (*new reads*, cart spec) | `getSalesSnapshot({ cartId, tenantId, organizationId, checkoutSessionId })` | the exact `SalesLineSnapshot[]` and `SalesAdjustmentDraft[]` behind `Cart.totals`, metadata included (`metadata.taxRate` on every discount draft, `metadata.cartLineId` on every line incl. gift lines), plus `appliedCodes: { codeId, codeString, promotionId }[]` | §7.2 steps 2 and 5, step 6c |
| `salesDocumentLookupService` (*new*, `sales`) | `resolveOrderStatusEntryId({ tenantId, organizationId, value })` | the `sales.order_status` dictionary entry id for `draft`, `confirmed` or `canceled`, or null. Wraps `sales/lib/statusHelpers.ts` `resolveStatusEntryIdByValue` | §7.2 steps 5 and 7, §7.3 |
| `salesDocumentLookupService` (*new*, `sales`) | `findOrderByExternalReference({ tenantId, organizationId, externalReference })` / `findQuoteByExternalReference(…)` | `{ id, number, statusValue, totals, lines: { id, cartLineId }[] }` or null; `totals` are the persisted document's total keys as decimal strings; `cartLineId` is read from each line's `metadata.cartLineId` | §7.2 step 5 (idempotency, totals check, `lineMap`), §12.1 |
| `salesDocumentLookupService` (*new*, `sales`) | `findPaymentByReference({ tenantId, organizationId, orderId, paymentReference })` | the payment id or null | §7.2 step 7 payment recording, `repair-gateway-payments` |
| `wmsWarehouseLookupService` (*new*, `wms`) | `getPrimaryWarehouseAddress({ tenantId, organizationId })` | `{ addressLine1, city, postalCode, country }` or null | §5.3 origin |
| `storeContextService` (SPEC-029) | `resolve(request, { fresh: true })`, `resolveForBuyer(…)` | the store, its default sales channel id (from `ecommerce_store_channel_bindings` with `is_default`), buyer identity | §4.3, §7.1 |
| `customerGroupsService`, `customerCreditService`, `customerPurchaseApprovalService`, `promotionsService`, `shippingCarrierService`, `paymentGatewayService` | as in the table above | | |

The reference reads `carts`, `cart_promotion_applications`, `promotions`, `sales_quotes`, `sales_orders`, `sales_order_lines`, `sales_payments`, `dictionaries` and `wms_warehouses` with raw Kysely (`lib/cartPeer.ts`, `lib/cartLinesPeer.ts`, `lib/warehousePeer.ts`, `commands/submit.ts`); the port replaces every such read with the service calls above.

Checkout's own tables (`checkout_sessions`, `checkout_session_events`, `checkout_transactions`, `checkout_links`, `checkout_link_cart_templates`) are read with `findWithDecryption`/`findOneWithDecryption`.

### 3.4 Soft dependencies (D-R5-18)

`checkout/index.ts` declares no new `requires` (C10). Session features resolve every peer through `container.tryResolve` at the call site.

| Peer absent | Effect |
|---|---|
| `cart` (`cartService`) | Every `/api/checkout/sessions*` buyer route answers `503 checkout_sessions_unavailable`. Pay links unaffected. |
| `sales` (`salesDocumentLookupService`) | Same as `cart`: no document can be created, so sessions are unavailable (`503 checkout_sessions_unavailable`). |
| `customer_groups` (`customerCreditService`, `customerPurchaseApprovalService`) | `on_account` and `request_quote` are not offered; no approval gate beyond what `cart.lock` itself enforces; `min_order_value` and PO checks skipped (no terms). |
| `availability` | Stock step skipped; every line reports `not_tracked` (D-R5-9). |
| `promotions` | No delivery promotions, no code consumption or usage registration (the cart itself carries no promotions without it). |
| `shipping_carriers` | Rates come only from the flat-rate fallback (§5.3); with no fallback configured, carts cannot pass `delivery` (`422 delivery_unavailable`). |
| `wms` (`wmsWarehouseLookupService`) | No origin address, so carriers are not quoted; only flat rates are offered (§5.3). |
| `payment_gateways` | Only `on_account` / `request_quote` are offered. |
| `ecommerce` (`storeContextService`) | Storefront-channel carts cannot be locked (no fresh context, C2) and sessions on them are refused with `503 checkout_sessions_unavailable`; link and API carts proceed without a store. |

---

## 4) Data Models

### 4.1 `CheckoutSession` (`checkout_sessions`)

Standard scoped columns (`id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`).

| Column | Type | Notes |
|---|---|---|
| `token_hash` | text | SHA-256 of the session token. The plaintext token is CSPRNG (32 bytes, base64url), returned **once** by `POST /api/checkout/sessions` and never stored or logged (C4, D-R4-18) |
| `cart_id` | uuid | `cart.Cart.id`. **The session never holds lines** |
| `store_id` | uuid, nullable | `ecommerce.EcommerceStore.id`; null for link and API carts (X13) |
| `link_id` | uuid, nullable | `checkout.CheckoutLink.id` for merchant-initiated |
| `channel` | text | `storefront \| pos \| pay_link \| agent \| api`, copied from the cart |
| `status` | text | `open \| awaiting_approval \| submitting \| awaiting_payment \| completed \| failed \| canceled \| expired` |
| `step` | text | `contact \| addresses \| delivery \| payment \| review` |
| `currency_code` | text | From the cart, immutable once the session exists |
| `locale` | text | |
| `email` | text, nullable | Encrypted at rest |
| `phone` | text, nullable | Encrypted at rest |
| `customer_id` / `customer_user_id` | uuid, nullable | Copied from the cart at creation, for the audit trail and events only. The binding of §9.0 is checked against the **live cart's** `customer_user_id` (`cartService.getCheckoutView`), never against this copy, so a token issued for a guest cart cannot act for a buyer who logged in and claimed the cart later |
| `shipping_address` | jsonb, nullable | Encrypted at rest |
| `billing_address` | jsonb, nullable | Encrypted at rest |
| `billing_same_as_shipping` | boolean | |
| `shipping_method` | jsonb, nullable | Snapshot: `providerKey`, service, `deliveryMethodCode`, price, ETA, `quotedAt`, `source: 'carrier' \| 'flat_rate'` |
| `quoted_totals` | jsonb, nullable | The totals the buyer saw at review: `{ goodsGross, deliveryCost, deliveryDiscount, payableGross, currencyCode, appliedPromotionIds, cartUpdatedAt, evaluatedAt }`. Amounts are decimal strings computed by `sales` (D-R5-CH6). Written at delivery selection and on entering `review`; cleared when the cart's `updatedAt` differs from `cartUpdatedAt` on a session read, and when the address, delivery method or payment method changes. Compared at submit (§7.2 step 2) |
| `delivery_window_id` | uuid, nullable | `sales.SalesDeliveryWindow.id` |
| `payment_method_code` | text, nullable | A gateway `providerKey`, `on_account` or `request_quote` (D-R5-20). Set by `POST /sessions/current/payment` (§5.5, D-R5-CH2) |
| `payment_intent_ref` | text, nullable | Gateway reference |
| `payment_expires_at` | timestamptz, nullable | Gateway session expiry; drives the lock extension and `expire-awaiting-payment` (§6, §12) |
| `purchase_order_number` | text, nullable | B2B; set by `POST /sessions/current/payment` (D-R5-CH2); written to the document's `customer_reference` (`SalesOrder` for the order outcome, `SalesQuote` for `request_quote`) |
| `credit_reservation_key` | text, nullable | Idempotency key used with `reserveCredit`; fresh per attempt |
| `stock_reservation_key` | text, nullable | Idempotency key used with `availability.reserve`; fresh per attempt |
| `submit_idempotency_key` | text, nullable | Client-supplied `Idempotency-Key` of the current attempt; the duplicate-submit guard |
| `submit_attempt` | integer | Starts at 0, incremented when an attempt begins. Part of the document's `external_reference` (§7.2) |
| `submit_progress` | text, nullable | Last completed submit step: `locked \| stock_reserved \| credit_reserved \| document_created \| finalized \| payment_initiated`, then the paid-completion checkpoints `order_confirmed \| cart_converted` (§7.2, paid completion), or `compensating` while an order cancellation has not yet succeeded (§7.3). Read by recovery (§12.1) and `repair-order-compensation` (§12) |
| `submit_started_at` | timestamptz, nullable | Start of the current attempt; recovery threshold |
| `outcome_kind` | text, nullable | `order \| quote` |
| `sales_order_id` / `sales_quote_id` | uuid, nullable | |
| `terms_accepted_at` | timestamptz, nullable | |
| `consent_flags` | jsonb, nullable | Marketing consent, passed to promotions |
| `failure_code` / `failure_detail` | text, nullable | `failure_code` from the §9.2 catalogue; `failure_detail` never holds PII |
| `expires_at` | timestamptz | |
| `completed_at` | timestamptz, nullable | |

Indexes: unique `token_hash`; unique `(tenant_id, submit_idempotency_key)` where non-null; `(tenant_id, status, expires_at)`; `(tenant_id, cart_id, status)` for the one-live-session-per-cart rule (§9.0) and the approval subscriber (§8.2).

**Removed in v2.3**: `token` (plaintext, C4), `approval_id` (the cart holds `Cart.approvalId`; the session reads it, D-R5-3, X6) and `workflow_instance_id` (no workflow drives the session in Release 5, C11; B.6 adds a correlation column additively if its definitions need one). None of the three was ever implemented.

**Optimistic locking (C20).** `CheckoutSession.updatedAt` is the concurrency token for every mutating buyer route, through `enforceCommandOptimisticLockWithGuards` as Phase A's `checkout.link.update`/`checkout.template.update` already do (no `version` column). The conditional `open → submitting` transition (§7.4) is a separate, additional CAS guard on `status`, not a substitute for it.

### 4.2 `CheckoutSessionEvent` (`checkout_session_events`)

Append-only audit of every step transition, external call and outcome. No update, no delete; exempt from optimistic locking (C20).

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid | |
| `kind` | text | `step_entered \| field_updated \| rate_quoted \| promotions_evaluated \| cart_locked \| stock_reserved \| credit_reserved \| document_created \| stock_committed \| promotions_registered \| payment_initiated \| payment_result \| approval_state \| recovery \| compensation \| failure` |
| `payload` | jsonb | Redacted at write time (§13): ids, codes, amounts and statuses only — never card data, addresses, e-mail, phone or gateway secrets |
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
| `unit_price_override` | numeric, nullable, mapped with `ExactDecimalType` like Phase A's checkout money columns (#7324) | Null → resolve from catalog for the buyer |
| `currency_code` | text | |
| `image_url` | text, nullable | |
| `is_quantity_editable` | boolean | Default `false` |
| `sort_order` | integer | |

Currency rules from v1 are retained: one currency per link; mixed-currency templates rejected at admin write; the currency must be supported by the link's gateway descriptor. Template rows are written only through the `checkout.cartTemplate.*` commands (§11) from the link's admin form; a port that ships rows without those commands, the form and the currency check does not pass the B.2 gate (CH3, §17).

**Link settings added for cart-backed links (B.2, additive columns on `checkout_links` and `checkout_link_templates`).** `sales_channel_id` (uuid, nullable: the `sales.SalesChannel` a link cart's documents are scoped to) and the flat-rate fallback `flat_rate_shipping_amount` (`ExactDecimalType`), `flat_rate_shipping_currency_code`, `flat_rate_shipping_label` and `flat_rate_shipping_tax_rate` (all nullable). They are written through the existing `checkout.link.*`/`checkout.template.*` commands and the link admin form, like every other link field.

`unit_price_override` matters: with a real cart behind it, a template line without an override resolves the buyer's own price, so a simple checkout link sent to a wholesale customer prices at their contract rate.

**Optimistic locking (C20).** Template rows are a sub-resource edited inside the link's `CrudForm` and saved with it. They are guarded by the parent `CheckoutLink.updatedAt` (the AGENTS.md sub-resource exemption); they carry the standard `updated_at` but no header of their own.

**Seeding a cart from a template (B.2, D-R5-19, D-R5-22).**
1. The Phase A link checks pass first: active, not expired, the password access cookie (`readCheckoutAccessCookie`) where the link has a password, and a **capacity probe**: a link whose `maxCompletions` is already reached is refused. The probe reserves nothing, so a tokenless `POST /sessions` cannot use up a link. The slot itself is reserved atomically at submit (a conditional increment that fails when the limit is reached) and released exactly once, on the session's status CAS to `failed`, `canceled` or `expired` after a reservation. A buyer who returns to the same link with the session token resumes that session instead of seeding a new cart.
2. Checkout builds a context with `buildTrustedCommandContext({ tenantId: link.tenantId, organizationId: link.organizationId, actorType: 'system', reason: 'checkout.link.seed:' + link.id })` from `@open-mercato/shared/lib/commands/trusted-context` (D-R5-CH7). The scope comes only from the link row, never from request input, and the audit entry is marked system-initiated.
3. Buyer identity: when a customer session is present (`getCustomerAuthFromRequest`) and its tenant and organization equal the link's, checkout resolves `storeContextService.resolveForBuyer({ tenantId, organizationId, customerUserId })` with **no store**. It passes the resulting identity (`customerId`, `customerIds` with the company, `customerGroupIds`, `priceKindId`) and the link's `sales_channel_id` to `cart.create` (channel `pay_link`), so template lines without an override price at the buyer's own rate and credit, approval and terms resolve to the company. Without a customer session, the cart is a guest cart.
4. Lines are added through the cart's line-add command, only from the template. The request body never contributes lines.

### 4.4 `CheckoutTransaction` (extended, additive)

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid, nullable | Null for Phase A pay links. Index `(tenant_id, session_id)` |
| `quote_id` | uuid, nullable | New, additive. The real `CheckoutTransaction` entity has no such column today |
| `order_id` | uuid, nullable | New, additive. Same as above |
| `payment_recorded_at` | timestamptz, nullable | Set when the `sales` payment for this transaction exists (§7.2 step 7, "Payment recording") |
| `payment_repair_attempted_at` | timestamptz, nullable | Last `repair-gateway-payments` attempt (§12) |
| `link_id` | uuid, **now nullable** | Was NOT NULL. A session-backed transaction has no link |
| `checkout_disposition` | text, nullable | New, additive. What checkout has decided for this intent: `setup \| published \| completing \| completed \| compensating \| compensated` (§7.2, payment result disposition). Null for Phase A rows |
| `completion_claim_token` / `completion_lease_expires_at` | uuid / timestamptz, nullable | New, additive. The owner of a `completing` disposition and the end of its lease (§7.2, paid completion). Null outside `completing` |

`checkout_disposition` changes only by a conditional update (`WHERE id = :transactionId AND checkout_disposition = :expected`, plus the claim token and an expired lease when a `completing` claim is taken over), in the same database transaction as the matching session write when there is one. Exactly one caller wins each transition; the loser re-reads the row and follows the state the winner left. Allowed transitions: `setup → published` (7c), `setup → compensating` (lost lock after the intent), `published → completing` (a paid result claims completion), `completing → completing` (takeover of an expired lease, new token), `completing → completed` (final completion write), `published → compensating` (payment failure or expiry), `compensating → compensated` (the reversal returned a result and §7.3 is done), `compensated → compensating` (a paid result arrives for an intent that is not already refunded or cancelled, §7.2). `completed` is terminal; `compensated` is terminal unless such a result reopens it.

Partial index `(tenant_id, organization_id, payment_repair_attempted_at nulls first, updated_at, id) where payment_recorded_at is null and status = 'completed' and session_id is not null and order_id is not null`, so the repair sweep reads only outstanding rows.

A session-backed gateway payment creates one `CheckoutTransaction` per attempt at §7.2 step 7, with `session_id` and `order_id` set, `link_id` null and `checkout_disposition = 'setup'`. Phase A rows keep `session_id`, `quote_id`, `order_id` and the disposition columns null and always carry a `link_id`. Dropping NOT NULL on `link_id` changes the `CheckoutTransaction.linkId` type to `string | null` and lets `GET /api/checkout/transactions` return `linkId: null` for session rows: a BC warning recorded in §14a row 15 with an UPGRADE_NOTES entry.

---

## 5) Why the Funnel Is Not a Workflow

SPEC-029 §19.2 argued for `workflows` on four grounds: audit trail, per-store configurability, async activities, and saga compensation. Each is real. None requires the engine in the conversion path.

| Argument | Resolution |
|---|---|
| Audit trail | `CheckoutSessionEvent` (§4.2) is append-only and purpose-shaped, with redaction rules a generic event log would not enforce |
| Configurability | Step visibility and order are per-store configuration on the link or store, not a graph. The realistic variation is which of five known steps appear, not arbitrary topology |
| Async activities | Four post-conversion processes **are** workflows (§5.1, B.6). Nothing before submit is async |
| Compensation | The submit sequence has explicit, ordered compensation (§7.3). A saga across six modules with external side effects needs hand-written compensation regardless; a generic engine does not supply it |

### The dividing criterion

Not latency. **The character of the failure.**

[Durable Workflow User-Task Continuation](./2026-07-15-durable-workflow-user-task-continuation.md) documents the engine's failure mode: `completeUserTask()` flushes `COMPLETED` before executing the transition, so a crash between the two leaves a completed task on a paused instance. The instance **stalls** — it does not corrupt, it does not double-execute, it stops.

A stall where a human is already waiting is an inconvenience: somebody sees a halted instance and resumes it, and nothing was lost in the meantime. A stall on the payment path is money taken without an order behind it.

> **`workflows` where a stall is an inconvenience. The state machine where a stall is a loss.**

This is a sharper line than "synchronous versus asynchronous", and it puts the same things on the same sides: what the buyer waits for is exactly what must not stall.

Supporting, in descending weight:

- **Data protection.** The workflow event log is immutable by module contract — a `WorkflowEvent` MUST NOT be updated or deleted after creation. `CheckoutSessionEvent` is redacted at write time (§13). Driving the funnel through the engine would put contact details and addresses into a log that by design cannot be erased, against a right to erasure the session's own trail is built to honour. The engine offers no redaction hook to close this.
- **Anonymous buyers.** A `USER_TASK` requires `assignedTo` or `assignedToRoles`. A guest checking out has neither. Portal user tasks give logged-in portal principals an identity; they give an anonymous buyer none. A funnel built from tasks cannot serve guest checkout, which is the majority of B2C conversions.
- **Latency.** Checkout is the conversion-critical path. Every step transition through a durable engine adds writes and reads to an interaction a person is waiting on.
- **Testability.** A five-state machine with an explicit transition table is exhaustively testable. A configurable graph is not.

### What changed in the engine on 2026-09-15, and why the decision stands

PR #5718 landed substantial `workflows` work on `develop`. Three parts of it bear on this section:

| Landed | Effect here |
|---|---|
| `WAIT_FOR_CONDITION` — a step that pauses until a predicate over the run context holds, woken by a scoped write to the instance context and backstopped by a polling job with a hard timeout | Removes signal correlation as a precondition for a B.6 definition. **It does not change the funnel decision** — `awaiting_payment` is already a durable state with a recovery job (§12), and routing it through the engine would add a dependency without adding a guarantee |
| Portal user tasks — a signed-in portal principal has their own task list | Would close the approver-identity gap for an engine-driven approval. In Release 5 approvals are decided through `customer_groups`' own portal and staff routes (D-R5-1), so checkout needs neither |
| `workflowDefinitionAuthoring` — a module may own a real workflow definition | This is how the B.6 definitions in §5.1 ship: authored in code by `checkout`, seeded per tenant, visible and editable in the Studio afterwards |

None of the three open engine specs is a precondition for anything in this spec. [Correlated Workflow Signal Waits](./2026-07-20-correlated-workflow-signal-waits.md) is superseded for this purpose by the mechanism above; [Stable Workflow Activity Outputs](./2026-07-20-stable-workflow-activity-outputs.md) is authoring convenience; [Durable Workflow User-Task Continuation](./2026-07-15-durable-workflow-user-task-continuation.md) only matters to a B.6 definition with user tasks.

### 5.1 Where `workflows` is used (B.6, not Release 5)

Four processes, all past the point where the buyer is waiting. Each ships in B.6 as a code-authored definition owned by `checkout` and seeded per tenant. **None ships in Release 5**; the events they subscribe to (§10) are emitted from B.1–B.5, so adding them later changes nothing in the funnel.

**1. Post-submit orchestration.** Triggered by `checkout.session.completed`. Confirmation email, invoice generation, fulfilment handoff, ERP sync. The buyer is gone; retries and durability matter and latency does not.

**2. B2B approval escalation.** In Release 5 the approval itself is owned by `customer_groups`: request, decision slots, expiry, in-app and e-mail notifications (D-R5-1, D-R5-6, D-R5-32). Checkout parks the session and resumes it from `customer_groups.approval.*` events (§8.2). A B.6 definition may add escalation on top (remind, escalate to a supervisor), triggered by `customer_groups.approval.requested`; it never decides the approval and never writes the session.

**3. Abandoned-checkout recovery.** Triggered by `checkout.session.expired`. Reminder, then reminder with an incentive, then stop. It touches no reservation and no payment.

**4. Failed-compensation escalation.** Triggered by `checkout.compensation.failed`. Detection and mechanical retry stay in the background job (§7.3, §12); the escalation ladder is a human-scheduled process. In Release 5 the operational notification of §7.3 is the escalation.

#### The contract between the funnel and the engine (B.6)

| # | Direction | Mechanism |
|---|---|---|
| 1 | checkout → `workflows` | A domain event (§10). Definitions subscribe through their own triggers; checkout never calls `startWorkflow()` inline on the request path |
| 2 | `workflows` → checkout | The command bus only (`checkout.session.*`, §11). A definition never writes `checkout_sessions` directly |
| 3 | correlation | Not needed by the four definitions above, which act on events; B.6 adds a nullable correlation column additively if a definition needs one |

A tenant that disables `workflows` loses the B.6 processes and still has a working checkout.

### 5.2 Step machine

```
contact ──► addresses ──► delivery ──► payment ──► review ──► [submit]
   ▲            ▲             ▲            ▲          │
   └────────────┴─────────────┴────────────┴──────────┘   (free backward navigation)
```

Steps are skippable by configuration: a known logged-in buyer with one address skips `contact` and `addresses` (the session is prefilled from that address); `on_account` and `request_quote` skip gateway selection in `payment` but not the step (the PO number is captured there, §8.4). **`delivery` is never skipped in Release 5 (D-R5-CH4):** every cart is treated as physical, and submit requires a selected shipping method and a shipping address (`422 steps_incomplete`, `details.steps: ['delivery']`).

> **Later (not Release 5): digital-only carts.** Skipping `delivery` needs a cart-level "requires shipping" fact derived from the lines, no shipping method, no shipping address and no shipping adjustment. It is deferred; Release 5 must not infer it.

`POST /sessions/current/step` validates the step being left: `contact` needs `email`; `addresses` needs a shipping address (and a billing address unless `billing_same_as_shipping`); `delivery` needs `shipping_method`; `payment` needs `payment_method_code` and, when required, the PO number. Moving backward never validates. A forward move over an incomplete step answers `422 steps_incomplete` with `details.steps`.

Backward navigation is always allowed before submit. Changing an address after selecting delivery **invalidates the rate quote** (clears `shipping_method` and `quoted_totals`) and returns the buyer to `delivery` with the reason stated (`details.reason: 'address_changed'` on the next `GET /current`) — a stale rate is a shipping cost the merchant absorbs. Any cart change after review (the cart's `updatedAt` differs from `quoted_totals.cartUpdatedAt` on the next session read) clears `quoted_totals`, so `review` re-evaluates before submit is offered. `quoted_totals` covers the goods as well as delivery: submit compares `goodsGross`, `deliveryCost`, `deliveryDiscount` and `payableGross`, not only the delivery figures (§7.2 step 2). The reference stores and compares only the delivery cost and discount, and never clears `quoted_totals` on a cart change; the port must implement the full rule. When a tax provider is configured, tax can depend on the shipping address as well (`2026-10-03-tax-providers-roadmap.md`, ADR-3); under the default state `product-rate` (its ADR-5) nothing changes. That the lock's re-price (§6) computes with that address the figure the buyer confirms, and whether the funnel shows a tax estimate at the address step, are proposed to the owners of this spec in that roadmap (amendment 6a, §14 Q16) and are not decided here; the Release 5 lock input carries no address.

### 5.3 Delivery rate quoting (C13, D-R5-35)

`GET /api/checkout/sessions/current/delivery-options` calls `shippingCarrierService.calculateRates({ providerKey, origin, destination, packages, … })` for each configured provider:

| Input | Source |
|---|---|
| `providerKey` | The providers enabled in the store settings (storefront carts) or the link settings (link carts); API/agent carts without a store use the tenant's enabled providers |
| `origin` | The primary warehouse's address from `wms` (`wmsWarehouseLookupService.getPrimaryWarehouseAddress`). `ecommerce` stores have no structured address today, so the store is not an origin source. No origin (no `wms`, or no primary warehouse with an address) → carriers are not called and only flat rates are offered |
| `destination` | `shipping_address` |
| `packages` | One parcel per cart, weight and dimensions summed from catalog product weight and dimensions; lines without data contribute a configured default (single-parcel default: 1 kg, 30×20×10 cm) |

- Quotes are cached 5 min per `(address hash, cart hash)` (R10) and re-validated at submit (R5).
- **Currency.** A carrier rate or a flat rate whose currency differs from the session's `currency_code` is dropped, never converted or relabelled.
- **Net amounts and tax.** A rate's amount is a **net** amount in the session currency. The shipping charge reaches `sales` as a `kind: 'shipping'` adjustment with `amountNet = rate` and `metadata.taxRate` = the shipping tax rate (`settings.shipping.taxRate` of the store, or the link's `flat_rate_shipping_tax_rate`; unset = `0`, untaxed). `sales` derives the gross and the tax portion (`salesCalculationService`); checkout does no tax arithmetic. A delivery discount is a `kind: 'discount'` adjustment carrying the same `metadata.taxRate`, so `sales` reduces the tax with it (the #8425 rule).
- **Flat-rate fallback (D-R5-35).** When a carrier call fails, no provider is configured, or no origin exists, the flat rates from the **store settings** (`settings.shipping.flatRate`, an **optional** key of `EcommerceStoreSettings`: storefront carts) or the **link settings** (the `flat_rate_shipping_*` columns of §4.3: link carts) are offered instead, marked `source: 'flat_rate'`. Without a fallback configured, the call answers `422 delivery_unavailable`.
- Selecting a method (`POST …/current/delivery`) snapshots it into `shipping_method`.

### 5.4 Delivery promotions (D-R5-17, D-R4-24 (2)(3))

The `delivery_method` rule and the `DELIVERY_DISCOUNT` effect are authorable in Release 5 (SPEC-055 amendment); checkout is their source.
- **At delivery selection** and again on entering `review`, checkout calls `promotionsService.evaluate` with the cart's buyer context plus `deliveryMethodCode` and `deliveryCost`, and stores the result in `quoted_totals`. `deliveryCost` is the **gross** shipping charge (SPEC-055 D-R5-PR8, matching the gross payable of D-R5-24): the `amountGross` that `sales` computes for the `shipping` adjustment of §5.3 (`salesCalculationService`), never the net rate. `quoted_totals.deliveryCost` holds the same gross figure.
- **Discount basis.** `promotions` returns the delivery discount as a gross amount. Checkout passes it to `sales` as the `kind: 'discount'` adjustment of §5.3 with `amountGross` set and the shipping `metadata.taxRate`; `sales` derives its net amount and tax. The same inputs, including the cart's applied code strings, are passed at selection, at review and at submit, so the three evaluations can only differ when the promotion data changed.
- **At submit**, after the lock, it evaluates again (§7.2 step 2). A different delivery discount or a newly applicable promotion aborts with `409 price_changed`, reason `delivery_changed` or `promotion_newly_eligible` (the cart's vocabulary).
- The delivery discount reaches the document as an adjustment on the shipping charge computed by `sales`, never by checkout arithmetic. Its budget is registered before payment (§7.2 step 6). Cart-stage totals still exclude delivery.

### 5.5 Payment methods

`GET /api/checkout/sessions/current/payment-methods` returns, server-side:
- the gateway methods from the store or link configuration whose descriptor supports the session currency;
- `on_account` when the cart is identified (OQ1), the resolved terms have `allow_purchase_on_account`, and `customerCreditService.checkCredit` returns an account in the cart currency that is not on hold (D-R5-5). The response carries the `checkCredit` reason when it is not offered (`no_account`, `on_hold`, `not_permitted`), so the client can explain it;
- `request_quote` when the resolved terms have `allow_quote_requests = true` (tenant default `false`, D-R5-20).

`POST …/current/payment` stores the choice in `payment_method_code` and the PO number in `purchase_order_number` (D-R5-CH2). A method that the list does not offer is refused with `422 payment_method_unavailable`; entitlement is never trusted from the client. The PO number is checked for the tenant's format there when one is configured (`422 purchase_order_number_invalid`). Changing the method clears `quoted_totals`. Submit takes no payment method or PO number in its body: it re-runs the same listing and re-validates the stored method and PO number against it (§7.1 checks 7 and 10). The gateway intent is **not** created here: it is created by submit after the order exists (§7.2 step 7).

---

## 6) Cart Lock Protocol

| Phase | Cart state | Buyer may edit |
|---|---|---|
| Session created | `active` | Yes |
| `awaiting_approval` | `active` (not locked, not abandoned: cart K5) | Yes |
| Entering `review` | `active` | Yes |
| Submit begins | `locked` (forced re-price, fresh visibility pass, session id recorded) | No |
| `awaiting_payment` | `locked`, lock extended to the payment expiry plus a margin (C1) | No |
| Submit succeeds | `converted` (`markConverted` with the session id) | No |
| Submit fails, compensated | `active` (`unlock` with the session id) | Yes |
| Session expires or is canceled before submit | `active` (nothing to unlock) | Yes |

The cart is locked **from submit until the outcome**, including payment, and never for the whole funnel. Locking at session creation would strand a cart behind every abandoned checkout, and abandoned checkouts are the majority.

**Lock input (cart contract, C1, C2, D-R5-23).** `cartService.lock({ cartId, tenantId, organizationId, checkoutSessionId, lockTtlMs?, purpose, routeContext? })`:
- `checkoutSessionId` is the session id. A second `lock` with the **same** `checkoutSessionId` on a locked cart is an idempotent extend: it returns the cart and sets the new expiry, with no re-price and no visibility pass (X15). A different session gets `423 cart_locked`. Checkout makes every extend with `extendOnly: true`, so an extend of a lock that lapsed answers `409 cart_lock_lost` instead of taking a fresh lock (cart §9.1, D-R5-SF4).
- `purpose` is `'quote'` when `payment_method_code = 'request_quote'`, else `'order'`. `'quote'` skips the approval gate and `min_order_value`; the visibility pass, store/channel checks and re-price still run (D-R5-23).
- `routeContext`: for a `storefront` cart checkout passes the buyer's request so the cart builds a fresh `ResolvedCartRouteContext` itself (C2); checkout imports nothing from `cart/lib`. A storefront cart without a context is refused by the cart with `400 assortment_scope_required_for_storefront_channel`; checkout never sends one without. Recovery (no request) never takes a fresh lock, so it never needs a context: it only extends a lock its session still holds (§12.1, D-R5-SF4).
- `lockTtlMs`: the cart default (30 min) at step 1; at step 7 checkout extends to `payment_expires_at − now + 15 min`, within the cart's bound. The session enters `awaiting_payment` only after that extend succeeds. A `409 cart_lock_lost` there cancels or refunds the intent and cancels the order (§7.2).

**Unlock and convert.** `unlock` and `markConverted` carry `checkoutSessionId`; a mismatch is a uniform `404` (C1), so a stale session can never release or convert a cart another session holds.

**Re-price on lock.** If the forced re-price changes any total, `cart.lock` returns `priceChanges` and submit **aborts before any side effect** with `409 price_changed`. The buyer re-confirms an amount they have seen. The cart's own refusals pass through unchanged: `409 cart_has_unavailable_lines` (visibility, D-R4-24 (1)), `409 cart_requires_approval`, `409 approval_requires_identified_buyer` (D-R5-12), `409 cart_not_active`, `423 cart_locked`.

A locked cart rejects mutation with `423 cart_locked` and the session id, so a second tab sends the buyer back to checkout rather than showing a broken basket.

The cart's `release-stale-locks` sweeper can never release a cart mid-payment: the lock outlives `payment_expires_at` by the margin, and `expire-awaiting-payment` (§12) resolves the session at `payment_expires_at`.

---

## 7) Submit

The only authoritative moment in the funnel.

### 7.1 Preconditions

Checked before any side effect; all failures are cheap and leave nothing to undo.

1. Session `open`, not expired, expected `updatedAt` matches (§4.1); otherwise `409 session_not_open` or the optimistic-lock `409`.
2. `Idempotency-Key` present; the §7.4 rules apply.
3. Cart non-empty, `active`, and `cart.id = session.cart_id`.
4. **Consistency (C9, X13, D-R4-24 (4)).** Tenant, organization, `cart.channel` and the cart currency equal the session's; when the cart has a `store_id`, it equals the store resolved for the request (`storeContextService.resolve(request, { fresh: true })`). Otherwise `409 cart_store_mismatch`. The same check runs at session creation.
5. **Sales channel (R-5, `sales/AGENTS.md`: every document is scoped to a channel).** The document's `channelId` resolves as: the cart's `salesChannelId`; else, for a storefront cart, the store's default channel binding (`storeContextService`); else, for a link cart, the link's `sales_channel_id` (§4.3). API, agent and POS carts must carry `salesChannelId` from `cart.create`. No channel → `422 sales_channel_unresolved`. The same check runs at session creation.
6. Required steps complete for the effective configuration, including a shipping method and a shipping address for every cart (D-R5-CH4); otherwise `422 steps_incomplete`. Terms accepted where required.
7. The stored `payment_method_code` is still offered by the §5.5 listing, re-run now (D-R5-CH2); otherwise `422 payment_method_unavailable`.
8. **Approval (order purpose only).** Advisory read of the cart's approval state: if the cart requires approval (cart K1 basis: goods gross after promotions, excluding delivery, in the cart currency; a currency other than `terms_currency_code` always requires it, D-R5-4; `terms_currency_code` falls back to the organization's base currency, D-R5-37) and `Cart.approvalId` is not `approved` for at least the current total, answer `409 cart_requires_approval` with `request-approval` as the next action. A guest cart above the threshold answers `409 approval_requires_identified_buyer` (D-R5-12). `cart.lock` re-checks both authoritatively (K2).
9. **`min_order_value` (order purpose only, D-R5-4).** Compared with the goods gross after promotions when the cart currency equals `terms_currency_code` (base-currency fallback, D-R5-37); not checked otherwise. Below it: `409 below_min_order_value`. Amounts compare as exact decimals, never floats.
10. **PO number.** The stored `purchase_order_number` is present when the resolved `requires_po_number` is true (D-R5-28), otherwise `422 purchase_order_number_required`; it matches the tenant's format when one is configured, otherwise `422 purchase_order_number_invalid`.
11. `quoted_totals` present and computed for the current cart version (`quoted_totals.cartUpdatedAt` equals the cart's `updatedAt`, §5.2); otherwise `409 price_changed` with reason `review_required`.

### 7.2 Sequence

Each step commits on its own (every `commandBus.execute()` commits its own transaction), is idempotent under its key, and records `submit_progress` plus a `CheckoutSessionEvent` when it completes. No step holds a database connection while it waits on another: a nested command runs on the caller's transaction (`ctx.transactionalEm`) when the caller has one, and never opens a second connection inside an open transaction (#8414). `attempt = submit_attempt` after the `open → submitting` CAS increments it. `stock_reservation_key = 'checkout:' + sessionId + ':' + attempt + ':stock'`, `credit_reservation_key = 'checkout:' + sessionId + ':' + attempt + ':credit'` and `documentRef = 'checkout:' + sessionId + ':' + attempt`.

**Money.** Checkout does no money arithmetic (ADR-2, D-R5-CH6). Every total comes from `sales`: the cart's own totals, or `salesCalculationService.calculateDocumentTotals`. Checkout only compares, as exact decimal strings at the currency's decimal places; it never compares floats or uses an epsilon.

```
 0. CAS open → submitting; submit_attempt += 1; fresh keys; emit checkout.session.submitted
    Pay-link session: reserve the link slot atomically (§4.3); limit reached → status open;
    ABORT 409 link_usage_limit_reached

 1. cartService.lock({ cartId, tenantId, organizationId, checkoutSessionId: sessionId,
                       purpose: 'order' | 'quote', routeContext })                 [§6]
    ├─ priceChanges non-empty → ABORT 409 price_changed (nothing else taken)
    ├─ cart refusal (409/423, §6)  → ABORT, code passed through
    └─ progress = locked

 2. Snapshot, totals and delivery (C7, D-R5-17, D-R5-24, D-R5-CH6). No document exists yet.
    a. snapshot = cartService.getSalesSnapshot(...): the exact line snapshots and adjustment
       drafts behind Cart.totals, metadata included (metadata.taxRate on discount drafts).
       Self-check: salesCalculationService.calculateDocumentTotals(snapshot lines +
       snapshot adjustments) equals Cart.totals on every key
       └─ mismatch → unlock; ABORT 500 totals_mismatch + ops notification (nothing else taken)
    b. Re-validate the shipping rate if older than its validity (§5.3);
       promotionsService.evaluate with deliveryMethodCode/deliveryCost, deliveryCost = the
       gross shipping charge computed by sales (same inputs as §5.4)
    c. documentTotals = salesCalculationService.calculateDocumentTotals(snapshot lines +
       snapshot adjustments + the shipping adjustment + the delivery-discount adjustment)
       payable = documentTotals.grandTotalGrossAmount
    d. goods gross, delivery cost, delivery discount or payable differ from quoted_totals
       └─ unlock; ABORT 409 price_changed (delivery_changed | promotion_newly_eligible |
                                           review_required)

 3. availability.reserve({ tenantId, organizationId, storeId: cart.storeId, items,
      sourceType: 'checkout', sourceId: sessionId, idempotencyKey: stock_reservation_key,
      ttlSeconds: 900 })
    storeId selects the policy chain, so a store-level allow_backorder or
    is_stock_managed = false row applies at submit as it did at browse (Availability
    D-R5-AV6); null for a store-less cart (link and API carts), which resolves policies
    without a store
    Per-line outcome: held | not_tracked | preorder | backorder | shortfall (D-R5-9)
    ├─ any shortfall line → release; unlock; ABORT 409 stock_shortfall (shortfall lines only)
    └─ progress = stock_reserved   (skipped when availability is absent: all not_tracked)

 4. IF payment_method = on_account:
      customerCreditService.reserveCredit({ scope, customerId: <company per cart identity>,
        currencyCode, amount: payable, idempotencyKey: credit_reservation_key })   (D-R5-24)
      ├─ refused → release stock; unlock; ABORT 402 credit_refused (reason)
      └─ progress = credit_reserved

 5. Document (idempotent on the document itself, C3, D-R5-CH1):
    ORDER OUTCOME (gateway or on_account)
    a. salesDocumentLookupService.findOrderByExternalReference({ tenantId, organizationId,
       externalReference: documentRef }). Found → reuse it, skip to 5c.
    b. Not found → sales.orders.create per the field mapping below: statusEntryId of the
       non-confirmed status `draft` (C17), externalReference = documentRef,
       customerReference = PO number, channelId, the shipping and payment method fields,
       customerSnapshot, the snapshot's exact lines and adjustments plus the shipping and
       delivery-discount adjustments, suppressStaffNotification = true (D-R5-CH8)
    c. Totals invariant (C7, D-R5-24): every total key of the persisted order (read back
       through the lookup) equals documentTotals. That includes the goods keys (subtotals and
       discount total equal Cart.totals) and the grand total gross (= payable). Checked for
       every payment method
       └─ mismatch → compensate (§7.3, cancel the order); ABORT 500 totals_mismatch
                     + ops notification
    d. lineMap from the persisted order lines' metadata.cartLineId (C18)
    e. Write sales_order_id; progress = document_created

    QUOTE OUTCOME (request_quote) — instead of 5a–5e:
       findQuoteByExternalReference(documentRef) → reuse, or sales.quotes.create with the
       same mapping (status entry `draft`); the same 5c check
       └─ mismatch → release stock; unlock; ABORT 500 totals_mismatch + ops
          notification (the quote is left as an ordinary, visible draft quote)
       Write sales_quote_id; availability.release(stock_reservation_key, reason 'quote')
                                                                     (C16, A9)
       cartService.markConverted({ …, checkoutSessionId, salesQuoteId,
                                    lineMap: [{ cartLineId, salesQuoteLineId }] })   (D-R5-26)
       status = completed; emit checkout.session.completed. DONE (no payment, no credit)

 6. ORDER OUTCOME — finalize before payment:
    a. availability.commit({ tenantId, organizationId, idempotencyKey: stock_reservation_key,
       orderId })                                                     (D-R5-8)
       └─ result 'stock_lost' (sweep won and the fresh reserve fell short) → compensate
          (§7.3, cancel order); ops notification; ABORT 409 stock_shortfall. No payment is
          ever started on a stock_lost order.
    b. IF on_account: customerCreditService.linkCreditReservationToOrder({ scope,
       idempotencyKey: credit_reservation_key, orderId })             (C6)
    c. promotionsService.useCode({ codeId, codeString, cartId, orderId, customerId, type })
       per snapshot.appliedCodes entry; promotionsService.registerUsage({ orderId,
       orderType: 'order', customerId, currency, appliedPromotions })  (C5, D-R4-26)
       └─ refused code or non-empty budgetExceeded → compensate (§7.3);
          ABORT 409 promotion_unavailable (the next lock re-prices without it)
    d. progress = finalized

 7. IF gateway:
    a. paymentGatewayService.createPaymentSession({ providerKey: payment_method_code,
         amount: payable, currencyCode, successUrl, cancelUrl, ... }) (return URLs per §9.3);
       CheckoutTransaction with session_id, order_id, link_id null,
       checkout_disposition = setup; payment_intent_ref, payment_expires_at
       (provider expiry, default 60 min)
       └─ intent creation fails → compensate (§7.3); ABORT 502 payment_unavailable
    b. cartService.lock(same checkoutSessionId, extendOnly: true,
                        lockTtlMs = payment_expires_at − now + 15 min)          (C1 extend)
       └─ 409 cart_lock_lost (the lock lapsed during the gateway call, or was swept) →
          CAS disposition setup → compensating; lost-lock reconciliation (below);
          compensate (§7.3, cancel order); disposition = compensated;
          ABORT 409 cart_lock_lost. The payment hand-off is never returned.
    c. Only after 7b succeeded, in one transaction: CAS disposition setup → published;
       status = awaiting_payment; progress = payment_initiated;
       emit checkout.payment.initiated; respond with the payment hand-off (§9.3).
       Then read the gateway status once: a success deferred while the disposition
       was setup (below) claims paid completion now
    Payment result (below) → dispatched on checkout_disposition → complete or compensate.

 8. IF on_account (no gateway):
       sales.orders.update(statusEntryId of `confirmed`) → emits sales.order.confirmed;
       markConverted with salesOrderId + lineMap; status = completed;
       emit checkout.session.completed. The credit reservation stands until a payment is
       settled through /adjust or settleCredit (D-R5-2).
```

**Field mapping: session and cart → document (D-R5-CH1, G2).** The same mapping serves `sales.orders.create` and, for `request_quote`, `sales.quotes.create`.

| Document field | Source |
|---|---|
| `externalReference` | `documentRef` = `'checkout:' + sessionId + ':' + attempt` |
| `customerReference` | `session.purchase_order_number` (PO number, D-R5-28) |
| `statusEntryId` | the `sales.order_status` entry `draft` (`salesDocumentLookupService.resolveOrderStatusEntryId`); `sales` uses that one dictionary for orders and quotes. No entry → `503 checkout_sessions_unavailable` and an ops notification; checkout never creates dictionary entries |
| `channelId` | §7.1 check 5 |
| `currencyCode` | session `currency_code` |
| `customerEntityId` | the **locked** cart's company (or person) id, read after step 1, never the session's creation-time copy |
| `customerSnapshot` | `{ email, phone, displayName }` from the session contact fields (encrypted by `sales`' own map) |
| `billingAddressSnapshot` / `shippingAddressSnapshot` | session `billing_address` (or `shipping_address` when `billing_same_as_shipping`) / `shipping_address` |
| `shippingMethodCode` / `shippingMethodSnapshot` | `shipping_method.deliveryMethodCode` / the whole `shipping_method` snapshot |
| `deliveryWindowId` | session `delivery_window_id` |
| `paymentMethodCode` / `paymentMethodSnapshot` | `payment_method_code` (`on_account` and `request_quote` included, so staff see how the buyer pays, #8413) / `{ kind, providerKey?, label }` |
| `lines` | `snapshot.lines`, unchanged; each keeps `metadata.cartLineId` (gift lines included, C18) |
| `adjustments` | `snapshot.adjustments` unchanged (metadata included), plus the `shipping` adjustment and the delivery-discount adjustment of §5.3 |
| `metadata` | `{ sourceModule: 'checkout', checkoutSessionId, checkoutAttempt }` |
| `suppressStaffNotification` | `true`, order outcome only (D-R5-CH8). Not sent to `sales.quotes.create` |

`sales.orders.create` already accepts every field above on `main` (`sales/data/validators.ts` `orderCreateSchema`), except `suppressStaffNotification`. The line schemas must accept the `null` values a `SalesLineSnapshot` carries (`quantityUnit`, `unitPriceNet`, `productId`, `metadata` and the rest). The reference widened the shared line schemas (`linePricingSchema`, `lineSharedSchema`) that quote **and** order lines both use; the port keeps that widening for both (§14a row 3). `sales.quotes.create` gains `externalReference` and `customerReference` (absent from `quoteCreateSchema` on `main`). `sales.orders.create` notifies `sales.orders.manage` holders of a new order (`sales.order.created`). A checkout order is a `draft` until it is paid or, for `on_account`, finalized, and it may still be compensated. So `sales.orders.create` gains an additive optional input `suppressStaffNotification?: boolean` (default `false`, D-R5-CH8): when `true`, `sales` does not notify at create and sends the `sales.order.created` notification when the order is first confirmed (step 8 for `on_account`, "Captured or authorised" for a gateway). An order compensated before confirmation notifies nobody. No checkout order raises a quote notification.

**The port must change (D-R5-CH1).** The reference creates every document as a quote and converts it with `sales.quotes.convert_to_order`. On `main` that command hard-deletes the quote and copies neither `external_reference` nor `customer_reference`, so the order outcome loses its idempotency key, its PO number and its status, and staff are notified of a quote. The re-land creates the order directly and never calls `convert_to_order`. The reference also checks totals by recomputing the snapshot after the quote exists, and compares the payable only for `on_account`; the port runs the self-check before any document and compares the persisted document for every payment method.

**`lineMap` (C18).** Read from the persisted document's lines (`salesDocumentLookupService`, `metadata.cartLineId`): order lines for the order outcome, quote lines for the quote outcome. A cart line without a document line is an internal error (`500`, compensated).

**Payment result (step 7).** The gateway's answer reaches the session through four paths, and all of them go through the same disposition claim, so exactly one caller completes or compensates an intent:
1. **Webhook.** The Phase A `gateway-payment-*` subscribers update the `CheckoutTransaction` as today; for a transaction with a `session_id`, they then run the disposition dispatch below (§3.2 item 2).
2. **Expiry.** `expire-awaiting-payment` reads the gateway status at `payment_expires_at` and runs the same dispatch (§12).
3. **Recovery.** `recover-stuck-submits` for a session in `awaiting_payment` with a settled transaction, and for a `completing` claim whose lease expired (§12.1).
4. **Publication.** Step 7c, which reads the gateway status once after `setup → published`.

**Payment result disposition.** A payment result is decided by the `checkout_disposition` of the transaction it names, read and changed under the §4.4 conditional update. It is never decided by the session status alone, because the session leaves `awaiting_payment` both when it completes and when it is compensated.

| `checkout_disposition` | Captured or authorised | Failed, cancelled or expired |
|---|---|---|
| `setup` (7a done, 7b/7c unresolved: submit in flight, or crashed and awaiting recovery) | **Deferred.** No confirm, no conversion, no refund. The result is acknowledged to the gateway and only the gateway status is recorded on the transaction (Phase A path). Whichever step resolves the setup reads that status afterwards: 7c, after its CAS to `published`, claims paid completion; the lost-lock path, after its CAS to `compensating`, refunds | Deferred the same way; 7c or reconciliation reads it |
| `published` (`awaiting_payment`) | CAS `published → completing` with a new claim token and lease; the winner runs paid completion (below) | CAS `published → compensating`; compensate (§7.3); status `failed` with `payment_failed` or `payment_expired`; emit `checkout.payment.failed`; disposition `compensated` |
| `completing`, lease live | **Duplicate while the owner works.** Acknowledged; nothing else. The claim owner finishes | Not expected after a success; recorded on the transaction, operational notification, no automatic action |
| `completing`, lease expired | **Owner presumed dead.** CAS takeover (`completing → completing` on the old token and the expired lease, new token and lease); the winner resumes paid completion from its checkpoint | As the row above |
| `completed` | **Replay or concurrent poll.** Acknowledged, never refunded and never notified. The session is already `completed`: both are written in one transaction | As the row above |
| `compensating` / `compensated` | Reconciled, never confirmed, never `markConverted`. First `getPaymentStatus(transactionId, scope)`: `refunded`, `partially_refunded` after this intent's refund, `cancelled`, `failed` or `expired` → acknowledged, nothing to do. Otherwise a `compensated` intent is reopened (`compensated → compensating`), then `refundPayment` under the operation contract (below), and the operational notification | Acknowledged; nothing to reverse |

Only the caller whose conditional update wins acts. A webhook and a poll delivering the same success race on `published → completing`; the loser reads `completing` and acknowledges.

**Paid completion (single owner, checkpointed).** The holder of the `completing` claim runs these steps. Each is idempotent and records a `submit_progress` checkpoint when it commits, so a new owner resumes after the last one:
1. Record the payment (below). Never blocks completion.
2. `sales.orders.update(statusEntryId of confirmed)` → emits `sales.order.confirmed` (C17), unless the order read through the lookup is already `confirmed`. Checkpoint `order_confirmed`.
3. `cartService.markConverted({ …, checkoutSessionId, salesOrderId, lineMap })` (C18, D-R5-16), with `lineMap` rebuilt from the persisted order lines. A cart already converted by **this** session for **this** order answers the cart's conversion replay (`200`, `alreadyConverted: true`, cart §9.1, D-R5-CA12, landing with #9999), which counts as success. Checkpoint `cart_converted`.
4. One transaction: CAS `completing → completed` on the owner's claim token, and session `status = completed`, `completed_at`. Then emit `checkout.payment.succeeded` and `checkout.session.completed`, once, because only the winner of this CAS emits.

Every step re-checks that the caller still holds the claim (its token, a live lease) before it calls another module, and extends the lease when it does. The lease is 120 s, the `recover-stuck-submits` threshold. A crash at any point leaves `completing` with an expiring lease. Nobody has to deliver another callback: `recover-stuck-submits` takes the claim over once the lease expires and resumes from the checkpoint (§12.1). A crash after `markConverted` committed but before its checkpoint, or before the final write, is resumed the same way: the repeated `markConverted` is the cart's replay, so the cart is converted once and the session still reaches `completed`. The intent becomes terminal (`completed`) in the same transaction as the session (`completed`). The order (`confirmed`) and the cart (`converted`) are terminal before that write.

`GET /sessions/current/result` only reads this state. The client polls it after the buyer returns to its `successUrl`.

**Lost lock after the intent (D-R5-SF4).** The intent exists, but this session no longer holds the basket it was priced for, so checkout never publishes `awaiting_payment` and never returns the hand-off. A live-lock extension is the precondition of `awaiting_payment` on the submit path and in recovery (§12.1). The reversal is requested before the order is cancelled, but the cancellation never waits for it to settle:
1. The conditional update `checkout_disposition setup → compensating` (§4.4) is written first. From then on this intent is durably marked for compensation, and a payment result for it can only be reconciled, never confirmed.
2. `paymentGatewayService.getPaymentStatus(transactionId, scope)` reads the provider state.
3. `pending` → `cancelPayment` cancels the intent. `authorized` → `cancelPayment` voids the authorization. `captured` or `partially_captured` → `refundPayment` refunds the captured amount. Each paid state raises an operational notification, because a payment on an unpublished hand-off is unexpected. `cancelled`, `failed` and `expired` need no gateway call. `unknown` is retried as a failed compensation (below).
4. The cancel or refund follows the operation contract below. The `CheckoutTransaction` records the outcome, and a `compensation` event names the intent.
5. Compensation per §7.3 runs whatever the reversal's outcome: it cancels the order and releases stock, credit and the pay-link slot. The session becomes `failed` (`cart_lock_lost` on the submit path, `submit_recovery_failed` in recovery), or stays `failed` with `submit_progress = compensating` while the order cancellation is outstanding. The cart is not unlocked: the session no longer holds it, so `unlock` answers `404`, and that answer is expected, not a compensation failure.
6. `checkout_disposition compensating → compensated` once the reversal has returned a result (or needed no gateway call) **and** §7.3 is done. A reversal still in flight or failed leaves the disposition `compensating` for `repair-order-compensation` (§12), independently of the session.

**Cancel and refund operation contract.** Every caller that reverses this intent — the lost-lock path, a late success on a `compensating` or `compensated` intent, and the reconciliation retry — sends the **same request**, so `payment_gateways`' operation idempotency (`payment-operation-idempotency.ts`) collapses repeats into one provider call:
- `refundPayment(transactionId, amount: undefined, reason: 'checkout:compensation', scope, operationId: 'checkout:' + transactionId + ':refund')` and `cancelPayment(transactionId, reason: 'checkout:compensation', scope, operationId: 'checkout:' + transactionId + ':cancel')`. The reason names no cause, because the same request serves a lost lock, a late success after expiry and every retry; the cause is in the `compensation` event. `amount` is always omitted, so the provider refunds the whole captured amount. A caller never computes an amount and never varies the reason, so the operation's request hash is the same for every caller.
- **Recorded result** (the operation `succeeded` and the transaction's status is unchanged since): the repeat returns it. The reversal is settled.
- **Any other `409`**: either the replay of a finished operation after the transaction's status moved on (`executeManualOperation` refuses to replay then, e.g. after the provider's webhook moved a refund from pending to `refunded`), or the action not allowed in the current status (`assertManualActionAllowed`). The caller reads `getPaymentStatus(transactionId, scope)`. `refunded`, `partially_refunded` after this intent's refund, `cancelled`, `failed` or `expired` → the reversal is settled. Any other status is a failed compensation (below).
- **`409 payment_operation_in_progress`** (another caller's call is still within its operation lease): the reversal is **not** settled. The losing caller leaves the disposition `compensating`, records a `compensation` event (`refund_in_flight`), and returns. A webhook delivery is acknowledged. `repair-order-compensation` (§12) calls again with the same request. That call returns the recorded result once the first call has finished, or re-claims the operation after its lease expires. Only a returned result moves the disposition to `compensated`.
- **`409 payment_operation_conflict`** (the same `operationId` with a different request) cannot happen under this contract. If it does, it is a defect: reported with `reportError`, an operational notification, the disposition left `compensating`, and never retried under a new `operationId`, because a new id would issue a second refund.
- A provider failure is a failed compensation (§7.3): a `failure` event, `checkout.compensation.failed`, an operational notification, and a retry by `repair-order-compensation` with the same request. The disposition stays `compensating` until a result is returned.

**Payment recording (G4, #8423, #8821).** For every captured or authorised session payment, checkout executes `sales.payments.create({ orderId, amount, currencyCode, paymentMethodCode, paymentReference: <gateway transaction id>, receivedAt })`. It is idempotent per `(order, paymentReference)`: checkout first looks the payment up (`findPaymentByReference`), and `sales.payments.create` refuses a duplicate reference on the same order (a cross-spec requirement on `sales`). On success checkout sets `checkout_transactions.payment_recorded_at`. A failure does not block completion: it is reported (`reportError`) and left for `repair-gateway-payments` (§12). Phase A pay-link transactions are not recorded on any order.

**Why commit precedes payment (D-R5-8).** The checkout hold becomes an `order` reservation that nothing expires, so a payment longer than the hold TTL cannot lose the stock. Because the order is created in `draft` and moves to `confirmed` only after commit, `sales.order.confirmed` never fires while a checkout hold still exists, and the `wms` auto-reservation finds the order's own reservation instead of reserving the same stock twice (C17; the Availability Contract §4.4 confirmed-first path remains only for integrators who confirm first).

### 7.3 Compensation

Reverse of acquisition, each action idempotent under the acquisition key and safe to re-run.

| Failure at | Compensation |
|---|---|
| 1 (lock refused / price changed) | Nothing |
| 2 (snapshot self-check, delivery re-evaluation) | Unlock cart |
| 3 (stock shortfall) | `availability.release` (no-op if nothing held); unlock cart |
| 4 (credit refused) | Release stock; unlock cart |
| 5a/5b with no order (order creation failed) | Release credit (`releaseCredit({ scope, reserveIdempotencyKey, reason })`); release stock; unlock cart |
| Quote outcome, 5c mismatch | As above; the draft quote stays as an ordinary, visible quote. Checkout does not delete documents |
| 5c–8 (order exists: totals mismatch, commit/link/code failure, intent failure, lock lost after the intent, payment failure or expiry) | **Cancel the order**: `submit_progress = compensating`, then `sales.orders.update(statusEntryId of canceled)`, emitting `sales.order.cancelled`. That one event releases the order's stock hold (`wms`), the linked credit reservation (`customer_groups` subscriber, D-R5-2 via C6) and the promotion usage and code uses (`promotions` subscriber, C5; every use carries the `orderId`, so checkout calls no `revertCodeUse` itself). Checkout then releases credit by key if step 6b did not run, releases stock by key if step 6a did not run, releases the pay-link slot, and unlocks the cart. After `409 cart_lock_lost` the intent is reconciled first (§7.2, lost lock after the intent) and the unlock is skipped, because the session no longer holds the cart |

Every compensation writes a `CheckoutSessionEvent` of kind `compensation` and emits `checkout.compensation.executed`.

**A compensation that itself fails** is written as a `failure` event, reported with `reportError`, emits `checkout.compensation.failed` and raises the ops notification (§10.1). It is never swallowed: a leaked stock or credit reservation is invisible inventory or invisible exposure, and both need a human. An order cancellation is retried three times in-process; if it still fails, the session stays `failed` with `submit_progress = compensating`, and `repair-order-compensation` (§12) retries it until it succeeds.

Submit-step commands are not undoable (§11, D-R5-10); compensation is the only reversal, and the audit-log Undo cannot return a committed order hold to `checkout` or release stock under a live session.

### 7.4 Idempotency and concurrency

`Idempotency-Key` is client-generated and sent on every submit attempt; it is stored as `submit_idempotency_key`.

- First call proceeds.
- A repeat while the attempt is in flight (`submitting`) returns `409 submit_in_progress`; it does not queue behind it.
- A repeat after success returns the original result, including `sales_order_id` or `sales_quote_id`, with `200`.
- A repeat with the same key while `awaiting_payment` returns the current payment hand-off (`200`).
- A new key after failure starts a fresh attempt with fresh reservation keys and a new `submit_attempt`, so the document's `external_reference` is fresh as well.

Concurrency is enforced by the conditional update `status = 'open' → 'submitting'` (row-level CAS on `status` plus `updated_at`). Exactly one caller wins. This is the guard against the double-tap and the retried-request duplicate order. The `external_reference` lookup-before-create on the document itself (`sales_orders` for an order, `sales_quotes` for a quote, §7.2 step 5a) is the guard against a crash between document creation and the session write. The key lives on the document that survives, so no later step can delete it.

A repeat request gets the same response body as the original (§9.3, `SubmitResponse`). The payment hand-off of a repeat is read again from the gateway transaction; checkout never stores a `clientSecret`.

---

## 8) B2B at Submit

### 8.1 Order or quote

| Buyer situation | Outcome |
|---|---|
| Prepayment via gateway | Order, confirmed after payment |
| Purchase on account, credit available | Order, credit reserved for the full payable amount (D-R5-24) |
| Purchase on account, credit refused | `402 credit_refused`; offered prepayment or, where `allow_quote_requests` allows it, `request_quote` (D-R5-5 wording per D-R5-20, X12). Nothing switches to a quote automatically |
| `request_quote` chosen (terms allow it) | Quote for the merchant to convert; cart locked with `purpose: 'quote'`, so no approval gate and no `min_order_value` (D-R5-23); no credit, stock released (C16) |
| Over approval threshold, not yet approved (order purpose) | `409 cart_requires_approval`; `request-approval` offered |

### 8.2 Approval gate (C11, D-R5-1, D-R5-3, X6)

The cart is the canonical approval subject (D-R5-3). Checkout creates no approval and stores no approval id.

1. **Request.** `POST /api/checkout/sessions/current/request-approval` executes `cart.approval.request` for the session's cart. The amount comes from the cart's server-side totals (K1 basis), never from the request body. The cart records `Cart.approvalId`. The session moves to `awaiting_approval`, the cart is **not** locked and is not considered abandoned (cart K5), and nothing is reserved. Checkout emits `checkout.session.approval_requested` as a state signal; notifications come only from `customer_groups` (D-R5-32).
2. **Deciders.** Configured per group by `approval_policy` (`buyer | merchant | both`, D-R5-1): buyer-side `CustomerUser`s of the company holding `customer_groups.portal.approvals.decide`, staff holding `customer_groups.approvals.decide`, or both in any order. Checkout is unaware of which side decided.
3. **Resume (event-driven, no workflow).** A checkout subscriber on `customer_groups.approval.approved | rejected | expired | withdrawn` with `subjectType = 'cart'` finds the live session in `awaiting_approval` for that cart in the event's tenant and organization:
   - `approved` → `open`, `quoted_totals` cleared so review re-evaluates; emits `checkout.session.approval_approved`;
   - `rejected` → `failed`, `failure_code = 'approval_rejected'`; emits `checkout.session.approval_rejected`;
   - `expired` / `withdrawn` → `open` (the buyer may request again or reduce the cart); emits `checkout.session.approval_rejected` with the outcome in the payload.

   No live session (expired, canceled, superseded) → the event is ignored.
4. **The approval outlives the session (X6).** A session that expires in `awaiting_approval` leaves the approval on the cart. A new session on that cart starts in `awaiting_approval` when `customerPurchaseApprovalService.getActiveApprovalForSubject({ scope, subjectType: 'cart', subjectId: cartId })` returns a pending approval, and in `open` when the cart's approval is approved. The reference never calls `getActiveApprovalForSubject` at session creation; the port must add it.
5. **Price rise (R8, D-R5-3).** Approval is consent up to an amount in a currency. Line changes at the same or a lower total keep it. At submit, `cart.lock` (K2) compares the re-priced total with the approved amount; a higher total refuses with `409 cart_requires_approval`, and the buyer re-requests. Nothing is silently honoured.

The engine-driven approval sub-flow, its stalled-instance monitor and `workflow_instance_id` are withdrawn from Release 5 (§14).

### 8.3 Credit (D-R5-2, D-R5-24, C6, C23)

- Reserved at submit step 4 via `customerCreditService.reserveCredit`, for the **full payable amount**: goods gross after promotions + the selected delivery cost − the delivery discount, from the submit-time evaluation. `sales` computes that amount (`salesCalculationService.calculateDocumentTotals` over the snapshot plus the shipping and delivery-discount adjustments, §7.2 step 2c, D-R5-CH6); checkout adds nothing up. The same result is what the order's persisted grand total must equal (§7.2 step 5c). The approval basis stays goods-only (K1).
- Concurrency is a `PESSIMISTIC_WRITE` row lock on `CustomerCreditAccount` inside `withAtomicFlush(…, { transaction: true })` (customer-groups §6, G1); no serializable transaction.
- The credit is resolved for the company in every channel: storefront carts through the buyer's store context, link and API carts through `resolveForBuyer` identity (D-R5-22).
- After the order exists, checkout links the reservation to it with `linkCreditReservationToOrder` (step 6b). If the order is later cancelled, by compensation or by the merchant, `customer_groups` releases the order's unsettled reservation automatically on `sales.order.cancelled` (D-R5-2).
- The reservation is **not** released on completion. It stands as exposure until a payment is settled through `/adjust` or by an integration calling `settleCredit` (D-R5-2). Without an integration, exposure after payment is settled manually.
- No account in the cart currency → `checkCredit` returns `no_account`; `on_account` is not offered (§5.5).

### 8.4 PO number (D-R5-28)

Captured at the `payment` step by `POST /sessions/current/payment` and stored in `purchase_order_number` (D-R5-CH2). Required when the resolved `requires_po_number` term is true (nullable, inherited, tenant default `false`); validated for format if the tenant configures one, both at `/payment` and again at submit. Written by `sales.orders.create` to `SalesOrder.customer_reference` for the order outcome, and by `sales.quotes.create` to `SalesQuote.customer_reference` for `request_quote` (§7.2 field mapping). No conversion is involved. A B2B invoice without the buyer's PO number will not be paid.

### 8.5 `min_order_value` (D-R5-4, D-R5-23)

Checked by checkout as precondition 9 (§7.1), on the K1 basis (goods gross after promotions), in `terms_currency_code`. A cart in another currency is not checked. A `request_quote` submit skips it.

### 8.6 Quote branch (D-R5-20, D-R5-23, D-R5-26, C16, C17)

- Offered as the `request_quote` payment method only when `allow_quote_requests` resolves true.
- Lock with `purpose: 'quote'`; the stock reservation still surfaces shortfalls and is released right after the quote exists (a quote is non-binding; stock is taken when the merchant converts and confirms, through the existing automation).
- The quote is created by `sales.quotes.create`, the only checkout use of that command (D-R5-CH1), in the `draft` status entry (C17), with `externalReference = documentRef`, the PO number as `customerReference`, the §7.2 field mapping and `metadata.cartLineId` on every line. It is idempotent through `findQuoteByExternalReference` and the `sales_quotes (tenant_id, external_reference)` index (D-R5-30). The cart is converted with `salesQuoteId` and a quote `lineMap`.
- Creating the quote notifies `sales.quotes.manage` holders (`sales.quote.created`). That is the intended signal here: the merchant has a quote to review.
- No payment, no credit, no promotion code consumption or usage registration. Approval returns at quote acceptance (`subject_type: 'quote'`), which is outside Release 5: the merchant converts the quote.

---

## 9) API Contracts

Base `/api/checkout`. All bodies validated with zod in `data/validators.ts`; §9.3 gives each route's request and response schema. Mutating buyer routes take the session's expected `updatedAt` in the standard optimistic-lock header (`x-om-ext-optimistic-lock-expected-updated-at`); a stale value answers the standard optimistic-lock `409`.

**Mutation guards (R-2).** These are custom write routes, not `makeCrudRoute` routes. Every buyer `POST`/`PATCH` calls `runMutationGuards(...)` (`@open-mercato/shared/lib/crud/mutation-guard-registry`) before it executes its command, with the session's scope, the target entity `checkout:checkout_session` and `userFeatures: []` (a buyer holds no staff features). A guard refusal is returned unchanged. The reference wires no guards on these routes; the port must add them.

### 9.0 Buyer authentication and session transport (C4, C12, D-R5-21, D-R5-33)

**Token.** `POST /api/checkout/sessions` returns `{ token, session }`. The plaintext token is returned only there; the server stores `token_hash`. Every `/api/checkout/sessions/current/*` route takes it in the `X-Checkout-Session-Token` header, never in the path or query. A lost token is recovered by creating a new session.

**Creating a session.**
- *Buyer-initiated* (`{ source: 'cart' }`): requires `X-Cart-Token`. When the cart has `customer_user_id`, the request must also carry the matching customer session (`getCustomerAuthFromRequest`, cookie or Bearer customer JWT); otherwise `404` with the unknown-cart body (D-R5-21). For a storefront cart the store comes from `storeContextService.resolve(request, { fresh: true })` on the store's mapped host and must equal `cart.store_id` (§7.1 check 4).
- *Merchant-initiated* (`{ source: 'link', slug }`, B.2): the Phase A link checks and the access cookie apply; the cart is seeded per §4.3.
- **One live session per cart.** A new session on a cart cancels an earlier `open` or `awaiting_approval` session for it. If the earlier one is `submitting` or `awaiting_payment`, creation answers `409 submit_in_progress`.

**Binding on every route (D-R5-33).** The binding source is the **live cart's** `customer_user_id`, read on every request through `cartService.getCheckoutView`, not the session's creation-time copy. When it is set, every `/api/checkout/sessions/current/*` route requires the customer session whose `customerUserId` equals it; otherwise `404` with the same body as an unknown token. A guest cart that a buyer later claims by logging in therefore needs that buyer's session from then on. Guest sessions are token-only.

**Scope on every route (C21).** Session, cart, link, store, customer and approval resolve to one tenant and organization; any disagreement is answered as `404` (unknown token).

**Route resolution.** The literal segment `current` is routed before `:id`, so the buyer routes and the admin `GET /api/checkout/sessions/:id` never collide (the cart's D-R4-6 split).

| Method | Path | Purpose | Phase |
|---|---|---|---|
| POST | `/sessions` | Create from a cart token or a link; returns the plaintext token once | B.1 (cart, CH1b), B.2 (link, CH3) |
| GET | `/sessions/current` | Current state, step, available transitions, `quoted_totals` | B.1 (CH1b) |
| PATCH | `/sessions/current` | Contact, addresses, consent, terms acceptance | B.1 (CH1b) |
| POST | `/sessions/current/step` | Navigate; validates the step being left (§5.2) | B.1 (CH1b) — new work, absent from the reference |
| POST | `/sessions/current/cancel` | Cancel an `open` or `awaiting_approval` session (nothing reserved; the cart's approval is kept, X6) | B.1 (CH1b) — new work |
| GET | `/sessions/current/delivery-options` | Rate quote for the current address and cart (§5.3); evaluates delivery promotions | B.3 (CH2a) |
| POST | `/sessions/current/delivery` | Select a method; snapshots the rate and the evaluation | B.3 (CH2b) |
| GET | `/sessions/current/payment-methods` | Gateway methods, `on_account` and `request_quote` eligibility (§5.5) | B.3 (gateway, CH2b), B.5 (`on_account`, `request_quote`, CH6a) |
| POST | `/sessions/current/payment` | Select a method; PO number (D-R5-CH2) | B.3 (CH2b), PO number B.5 (CH6a) — new work |
| POST | `/sessions/current/submit` | §7. Requires `Idempotency-Key`; the body carries only the return paths | B.4 (CH5a) |
| GET | `/sessions/current/result` | Post-submit outcome: `outcome_kind`, document ids and numbers, per-line stock outcomes, payment hand-off | B.4 (CH5a) — new work |
| POST | `/sessions/current/request-approval` | Delegates to `cart.approval.request` (§8.2) | B.5 (CH6b) |

Admin (staff auth): `GET /api/checkout/sessions` and `GET /api/checkout/sessions/:id` under `checkout.sessions.view` ship in B.1 (CH1b) as read-only routes. They return `CheckoutSessionView` (§9.3) and the event trail; PII fields only for a caller holding `checkout.viewPii`. The admin-forced actions (force-expire, force re-price) under `checkout.sessions.manage` and the viewer pages are B.6. The `current` segment is routed before `:id`.

### 9.1 ACL (C25, D-R5-34)

Link/template access reuses the real Phase A features unchanged; only the session-admin surface gets new ids.

```typescript
// Reused from Phase A, unchanged — packages/checkout/src/modules/checkout/acl.ts
// checkout.view    — includes viewing checkout links and transactions (now also sessions, §9)
// checkout.create  — includes creating checkout links/templates
// checkout.edit    — includes editing checkout links/templates
// checkout.delete  — includes deleting checkout links/templates
// checkout.viewPii — customer PII on links/transactions (now also on sessions)
// checkout.export  — exporting checkout transactions

// New in this spec (B.1)
export const newFeatures = [
  { id: 'checkout.sessions.view',   title: 'View checkout sessions', module: 'checkout', dependsOn: ['checkout.view'] },
  { id: 'checkout.sessions.manage', title: 'Manage checkout sessions (force-expire, force re-price)', module: 'checkout', dependsOn: ['checkout.sessions.view'] },
]
```

Grants in `setup.ts` `defaultRoleFeatures`: `superadmin` is covered by `checkout.*`; `admin` has an explicit feature list on `main`, which gains both ids; `employee` gets `checkout.sessions.view` only; `checkout.sessions.manage` stays with `admin` or is granted by hand (least privilege, D-R5-34). Existing tenants run `yarn mercato auth sync-role-acls`. Buyer routes are not ACL-gated; they are token-bound (§9.0).

### 9.2 Error codes

Every refusal body is `{ error: <code>, message, details? }`, with a translated `message`. The client branches on `error`.

| Code | HTTP | Raised by | Meaning / next action |
|---|---|---|---|
| `checkout_sessions_unavailable` | 503 | All session routes | `cart` or `sales` absent, or a storefront cart without `storeContextService` (§3.4) |
| `cart_store_mismatch` | 409 | Create, submit | Tenant, organization, channel, currency or (when the cart has one) store differ (C9, X13) |
| `session_not_open` | 409 | Mutations, submit | Session is not `open` |
| `steps_incomplete` | 422 | Step, submit | Required step missing; `details.steps` |
| `sales_channel_unresolved` | 422 | Create, submit | No sales channel resolves for the cart (§7.1 check 5) |
| `delivery_unavailable` | 422 | Delivery | No carrier rate and no flat-rate fallback (§5.3), or an unknown `deliveryMethodCode` |
| `payment_method_unavailable` | 422 | Payment, submit | Method not offered to this buyer (§5.5) |
| `purchase_order_number_required` | 422 | Submit | `requires_po_number` term (§8.4) |
| `purchase_order_number_invalid` | 422 | Payment, submit | PO number does not match the tenant's format (§8.4) |
| `invalid_return_url` | 422 | Submit | `successUrl`/`cancelUrl` is not a safe relative path (§9.3) |
| `link_usage_limit_reached` | 409 | Create (link), submit | The link's `maxCompletions` is reached (§4.3) |
| `idempotency_key_required` | 400 | Submit | Header missing, or not 16–128 characters |
| `below_min_order_value` | 409 | Submit | §8.5; `details.minOrderValue`, `currencyCode` |
| `cart_requires_approval` | 409 | Submit (passthrough from cart) | Request approval |
| `approval_requires_identified_buyer` | 409 | Submit (passthrough from cart) | Guest above threshold; sign in (D-R5-12) |
| `cart_has_unavailable_lines` | 409 | Submit (passthrough from cart) | A line left the buyer's assortment; remove it (US-B4) |
| `cart_not_active` | 409 | Create, submit (passthrough) | Cart merged, converted or abandoned; start from the current cart |
| `cart_locked` | 423 | Create, submit (passthrough) | Another session holds the cart |
| `price_changed` | 409 | Submit | `details.reasons` incl. cart reasons, `delivery_changed`, `promotion_newly_eligible`, `review_required`; `details.priceChanges`; re-confirm |
| `stock_shortfall` | 409 | Submit | `details.lines` with the `shortfall` lines only |
| `credit_refused` | 402 | Submit | `details.reason`: `no_account \| on_hold \| limit_exceeded \| not_permitted`; offered prepayment or `request_quote` |
| `promotion_unavailable` | 409 | Submit | A code was refused or a budget is exhausted; the next lock re-prices without it |
| `totals_mismatch` | 500 | Submit | The cart's snapshot does not reproduce `Cart.totals`, or the persisted document's totals differ from the `sales` computation; compensated; ops notified. Used for nothing else (a missing cart is `cart_not_active`) |
| `payment_unavailable` | 502 | Submit | Gateway intent creation failed; compensated |
| `cart_lock_lost` | 409 | Submit (passthrough from cart) | The cart lock lapsed before the step 7b extend; the intent is cancelled or refunded and the order cancelled; resubmit from the cart (§7.2) |
| `submit_in_progress` | 409 | Submit, create | An attempt is in flight (§7.4) |
| `approval_not_required` | 409 | Request-approval (passthrough from cart) | Below the threshold |
| — | 404 | All `/current/*` | Unknown token, binding mismatch (§9.0) or scope mismatch; one body for all |
| — | 429 | Rate-limited routes | §13 |
| — | 503 | Fail-closed rate-limited routes | The limiter is not registered or cannot decide (§3.2 item 1, §13) |

`session.failure_code` uses the codes above plus `approval_rejected`, `payment_failed`, `payment_expired` and `submit_recovery_failed`.

### 9.3 Request and response schemas

The schemas are written as zod in `checkout/data/validators.ts`; the shapes below are their contract. Money is a decimal string at the currency's decimal places (`Money = z.string()`). Timestamps are ISO-8601 strings. Every `/current/*` request carries `X-Checkout-Session-Token`. Unknown body keys are rejected (`.strict()`), so a client cannot slip in lines, prices or entitlements.

**Shared shapes.**

```typescript
type Step = 'contact' | 'addresses' | 'delivery' | 'payment' | 'review'
type Address = {
  name?: string; companyName?: string; addressLine1: string; addressLine2?: string
  buildingNumber?: string; flatNumber?: string; city: string; region?: string
  postalCode: string; country: string /* ISO 3166-1 alpha-2 */
}
type ShippingMethodSnapshot = {
  deliveryMethodCode: string; providerKey: string | null; serviceCode: string | null
  label: string; cost: Money /* net, §5.3 */; currencyCode: string
  estimatedDays: number | null; quotedAt: string; source: 'carrier' | 'flat_rate'
}
type QuotedTotals = {
  goodsGross: Money; deliveryCost: Money; deliveryDiscount: Money; payableGross: Money
  currencyCode: string; appliedPromotionIds: string[]; cartUpdatedAt: string; evaluatedAt: string
}
type CheckoutSessionView = {
  id: string; status: SessionStatus; step: Step; channel: string
  cartId: string; storeId: string | null; linkId: string | null
  currencyCode: string; locale: string | null
  customerId: string | null; customerUserId: string | null
  email: string | null; phone: string | null                 // buyer's own session; admin only with checkout.viewPii
  shippingAddress: Address | null; billingAddress: Address | null; billingSameAsShipping: boolean
  shippingMethod: ShippingMethodSnapshot | null; quotedTotals: QuotedTotals | null
  paymentMethodCode: string | null; purchaseOrderNumber: string | null
  requiredSteps: Step[]; completedSteps: Step[]; availableTransitions: Step[]
  invalidation: { reason: 'address_changed' | 'cart_changed' } | null
  submitAttempt: number; submitProgress: string | null
  outcomeKind: 'order' | 'quote' | null; salesOrderId: string | null; salesQuoteId: string | null
  failureCode: string | null; termsAcceptedAt: string | null; consentFlags: Record<string, boolean> | null
  expiresAt: string; completedAt: string | null; createdAt: string; updatedAt: string
}
type PaymentHandoff = {
  providerKey: string; transactionId: string
  redirectUrl: string | null; clientSecret: string | null; expiresAt: string
}
```

`CheckoutSessionView` never contains `token_hash`, the reservation or idempotency keys, `payment_intent_ref` or `failure_detail`.

| Route | Request | Response |
|---|---|---|
| `POST /sessions` | Body `{ source: 'cart' }` with header `X-Cart-Token` (plus the customer session for an identified cart), or `{ source: 'link', slug: string }` with the link's access cookie | `201 { token: string, session: CheckoutSessionView }`. `token` appears only here |
| `GET /sessions/current` | — | `200 { session: CheckoutSessionView }` |
| `PATCH /sessions/current` | Body, every key optional: `{ email?: string \| null, phone?: string \| null, shippingAddress?: Address \| null, billingAddress?: Address \| null, billingSameAsShipping?: boolean, locale?: string, consentFlags?: Record<string, boolean>, termsAccepted?: boolean }`; optimistic-lock header | `200 { session }` |
| `POST /sessions/current/step` | `{ to: Step }`; optimistic-lock header | `200 { session }`; `422 steps_incomplete` |
| `POST /sessions/current/cancel` | `{}`; optimistic-lock header | `200 { session }` (status `canceled`) |
| `GET /sessions/current/delivery-options` | — | `200 { options: { deliveryMethodCode, providerKey, serviceCode, label, cost: Money, costGross: Money, currencyCode, estimatedDays, source, deliveryDiscount: Money }[], evaluatedAt }`; `costGross` and `deliveryDiscount` are computed by `sales`/`promotions`, for display |
| `POST /sessions/current/delivery` | `{ deliveryMethodCode: string, deliveryWindowId?: string }`; optimistic-lock header. Never a price: the route re-resolves the rate server-side | `200 { session }` with `shippingMethod` and `quotedTotals` set; `422 delivery_unavailable` for a code not just offered |
| `GET /sessions/current/payment-methods` | — | `200 { methods: ({ kind: 'gateway', providerKey, label } \| { kind: 'on_account' } \| { kind: 'request_quote' })[], unavailable: { kind: 'on_account', reason: 'no_account' \| 'on_hold' \| 'not_permitted' }[], purchaseOrderNumber: { required: boolean, pattern: string \| null } }` |
| `POST /sessions/current/payment` | `{ paymentMethodCode: string /* providerKey, 'on_account' or 'request_quote' */, purchaseOrderNumber?: string \| null }`; optimistic-lock header | `200 { session }`; `422 payment_method_unavailable`, `422 purchase_order_number_invalid` |
| `POST /sessions/current/submit` | Header `Idempotency-Key` (16–128 characters); optimistic-lock header. Body `{ successUrl?: string, cancelUrl?: string }`. No payment method, PO number, line or amount: those come from the session and the cart (D-R5-CH2) | `200 SubmitResponse` (below), for the first call and for every same-key repeat (§7.4) |
| `GET /sessions/current/result` | — | `200 ResultResponse` (below), in every session status; before any submit, `outcomeKind` is null |
| `POST /sessions/current/request-approval` | `{}`; optimistic-lock header | `200 { session, approvalId: string }` (status `awaiting_approval`) |

```typescript
type SubmitResponse = {
  session: CheckoutSessionView
  outcomeKind: 'order' | 'quote'
  salesOrderId: string | null; salesOrderNumber: string | null
  salesQuoteId: string | null; salesQuoteNumber: string | null
  next: 'pay' | 'done'                       // 'pay' only for a gateway method
  paymentHandoff: PaymentHandoff | null      // set when next = 'pay'
}
type ResultResponse = Omit<SubmitResponse, 'outcomeKind' | 'next'> & {
  outcomeKind: 'order' | 'quote' | null; next: 'pay' | 'done' | null   // null before any submit
  status: SessionStatus                       // awaiting_payment, completed, failed, ...
  lines: { cartLineId: string; outcome: 'held' | 'not_tracked' | 'preorder' | 'backorder';
           heldQuantity: string; backorderedQuantity: string }[]
  failureCode: string | null
}
```

**Payment hand-off.** For a redirect gateway the client sends the buyer to `redirectUrl`; for an embedded gateway it mounts the provider's component with `clientSecret` and `providerKey`. The hand-off is read from the payment gateway's transaction each time it is returned (submit, a same-key repeat while `awaiting_payment`, `/result` while `awaiting_payment`); checkout stores no `clientSecret`. After the buyer returns, the client polls `GET /sessions/current/result` until `status` leaves `awaiting_payment`. The session itself resumes from the gateway webhook, the expiry job or recovery (§7.2, "Payment result"), never from the return request.

**Return URLs.** `successUrl` and `cancelUrl` are **relative paths** (start with a single `/`, no scheme, no host, no `//`, no backslash or control character). The server resolves them against the **server-pinned origin** (`CHECKOUT_ALLOWED_ORIGINS`, `APP_URL` or `NEXT_PUBLIC_APP_URL`; loopback only in development), never against the request's `Host` or `X-Forwarded-Host` (`packages/checkout/AGENTS.md`, Security Notes). An absolute URL or an unsafe path answers `422 invalid_return_url`. Omitting them is valid for embedded presentations that need no return URL. A non-loopback deployment with no configured origin refuses submit with `500`, as Phase A does.

---

## 10) Events

Declared with `createModuleEvents`. These are state signals: no checkout event sends a notification to a buyer or approver (D-R5-32). The only notification checkout raises is the staff-facing ops notification of §10.1. Every payload carries `tenantId` and `organizationId`, carries ids and statuses only, and never PII (C22).

| Event | Payload (besides `tenantId`, `organizationId`, `sessionId`) |
|---|---|
| `checkout.session.created` | `cartId`, `channel`, `storeId`, `linkId`, `customerId` |
| `checkout.session.step_changed` | `fromStep`, `toStep` |
| `checkout.session.submitted` | `cartId`, `attempt`, `paymentMethodCode` |
| `checkout.session.completed` | `cartId`, `outcomeKind`, `salesOrderId`, `salesQuoteId`, `paymentMethodCode` |
| `checkout.session.failed` | `cartId`, `attempt`, `failureCode` |
| `checkout.session.canceled` | `cartId`, `reason` (`buyer \| superseded \| merchant`) |
| `checkout.session.expired` | `cartId`, `fromStatus` |
| `checkout.session.approval_requested` | `cartId`, `approvalId` |
| `checkout.session.approval_approved` | `cartId`, `approvalId` |
| `checkout.session.approval_rejected` | `cartId`, `approvalId`, `outcome` (`rejected \| expired \| withdrawn`) |
| `checkout.payment.initiated` | `orderId`, `transactionId`, `providerKey` |
| `checkout.payment.succeeded` | `orderId`, `transactionId` |
| `checkout.payment.failed` | `orderId`, `transactionId`, `failureCode` |
| `checkout.compensation.executed` | `attempt`, `atStep`, `actions[]` |
| `checkout.compensation.failed` | `attempt`, `atStep`, `action`, `retryCount` |
| `checkout.cartTemplate.created` / `.updated` / `.deleted` / `.reordered` | `linkId`, `templateLineId` (`.reordered`: `linkId`) |

The approval events are emitted by the §8.2 handlers. They are not the approval's own events, which are `customer_groups.approval.*`.

**Relationship to Phase A's `checkout.transaction.*` events.** Phase A's `checkout.transaction.sessionStarted`/`.completed`/`.failed` are unchanged and continue to fire for every `CheckoutTransaction` row, session-backed or not. `checkout.payment.*` is additive and session-scoped, firing *alongside* the transaction-level events for a session-based checkout, not instead of them.

Every event in the table is declared in `checkout/events.ts`, including `checkout.session.step_changed` and `checkout.cartTemplate.*`, which the reference does not declare; the port must add them. The payloads are exactly the table's: `checkout.session.submitted` carries `paymentMethodCode`, and `checkout.compensation.failed` carries one `action` per event.

### 10.1 Ops notification (G6)

| Field | Value |
|---|---|
| Type id | `checkout.session.attentionRequired`, declared in `checkout/notifications.ts` beside the Phase A types (additive, §14a row 20) |
| Recipients | Staff holding `checkout.sessions.view` in the session's organization (`buildFeatureNotificationFromType`, `requiredFeature: 'checkout.sessions.view'`; wildcard grants match) |
| Raised by | `checkout.compensation.failed` (after the in-process retries); `500 totals_mismatch` (both checks of §7.2); `availability.commit` returning `stock_lost`; `submit_recovery_failed`; a missing `draft`/`confirmed`/`canceled` status entry; `repair-gateway-payments` giving up on a transaction after 5 attempts |
| Body | session id, failure code, order or quote number when one exists, attempt. Never PII |
| Link | `/backend/sales/orders/:id` when an order exists (the session viewer is B.6); otherwise none |
| Dedupe | One notification per `(sessionId, attempt, failureCode)` |

---

## 11) Commands

| Command | Undo |
|---|---|
| `checkout.cartTemplate.create` | Delete the created row |
| `checkout.cartTemplate.update` | Restore the before-snapshot |
| `checkout.cartTemplate.delete` | Restore the row |
| `checkout.cartTemplate.reorder` | Restore the previous order |
| `checkout.session.create` | none |
| `checkout.session.update` (contact, addresses, step, delivery, payment) | none |
| `checkout.session.cancel` | none |
| `checkout.session.lock` | none |
| `checkout.session.reserveStock` | none |
| `checkout.session.reserveCredit` | none |
| `checkout.session.createDocument` | none |
| `checkout.session.finalize` (commit, credit link, codes and usage) | none |
| `checkout.session.initiatePayment` | none |
| `checkout.session.complete` | none |
| `checkout.session.fail` | none |
| `checkout.session.compensate` | none |
| `checkout.session.applyApprovalOutcome` | none |

Session commands are registered with `isUndoable: false`, consistently with `availability.reserve/release/commit` and `wms.inventory.reserve/release` (D-R5-10). They exist so that every session write passes the same interceptors and audit trail as any other domain write. Commands do not run mutation guards by themselves: the buyer routes call `runMutationGuards` before executing them (§9, R-2). Reversal is the explicit compensation of §7.3, never an audit-log Undo. Template commands are admin mutations and stay undoable.

Every command file is imported by `commands/index.ts`, so workers and subscribers resolve the same registry as routes. The reference does not import `commands/approval.ts` there; the port must.

Subscribers and workers that execute commands do so with a real request container (`SubscriberContext.container`, `WorkerJobContainer`), never a bare `em`, so nested commands find their DI peers. A caught error is reported with `reportError` before it is handled; HTTP errors are recognised with `isCrudHttpError`, never `instanceof CrudHttpError` (which fails across bundles).

`checkout.transaction.updateStatus` enforces a strict transition state machine (`VALID_CHECKOUT_TRANSITIONS`) plus an atomic compare-and-swap via `tx.nativeUpdate` with the previous status pinned in the `WHERE` clause, returning `409` on a lost race between the submit route and the gateway webhook. The `open → submitting` guard on `CheckoutSession.status` (§7.4) is the same CAS pattern applied to the new entity.

---

## 12) Background Jobs

All via the `queue` worker contract. Every worker reads checkout rows with `findWithDecryption`, runs commands with a real container (§11), and reports a caught error with `reportError`.

| Job | Cadence | Purpose |
|---|---|---|
| `expire-checkout-sessions` | every 5 min | Expire `open` and `awaiting_approval` sessions past TTL. Nothing is reserved in either state, so nothing is released; the cart's approval is kept (X6) |
| `recover-stuck-submits` | every minute | Sessions in `submitting` with `submit_started_at` older than 120 s, and session transactions in `completing` whose `completion_lease_expires_at` has passed: §12.1 |
| `expire-awaiting-payment` | every 5 min | `awaiting_payment` past `payment_expires_at`: read the gateway status; paid → claim completion through `published → completing` (§7.2 "Payment result disposition"); otherwise `published → compensating`, compensate (cancel the order) and fail with `payment_expired`. A webhook that won the CAS first leaves the job nothing to do. Runs before the extended cart lock can lapse (§6) |
| `repair-gateway-payments` | every 15 min | Session transactions that are `completed` with `payment_recorded_at` null (the §4.4 partial index): record the `sales` payment idempotently (§7.2 "Payment recording"), set `payment_repair_attempted_at`; ops notification after 5 failed attempts on one transaction |
| `repair-order-compensation` | every 10 min | Sessions `failed` with `submit_progress = compensating`: retry the order cancellation and the remaining releases of §7.3 until they succeed. Session transactions in `compensating`: re-send the intent's cancel or refund with the same request (§7.2, cancel and refund operation contract) until it is settled, then `compensated` once the session's §7.3 compensation is also done. Ops notification on the first failure of each session |

`repair-order-compensation` replaces v2.3's `retry-failed-compensations`: only an order cancellation can be left half done, because every earlier compensation is a keyed release retried in-process.

**Schedules for every tenant (G5, #8822).** One helper, `ensureCheckoutSessionSchedules(ctx)`, registers the five schedules through `schedulerService` (skipped when it is not registered), next to Phase A's `ensureTransactionExpirySchedule`. Three callers use it: `setup.ts` `seedDefaults`, `onOrganizationCreated`, and a `configs` upgrade action `checkout.register-schedules` that an existing tenant runs once. `checkout` registers that action through the DI key `checkoutScheduleUpgradeRegistrar`, because `configs` lives in `@open-mercato/core` and must not import `checkout` (§14a row 21). The action runs at upgrade when `UPGRADE_ACTIONS_ENABLED` is set; UPGRADE_NOTES says so.

### 12.1 Recovery decision table (C24)

Recovery runs under `buildTrustedCommandContext({ tenantId, organizationId, actorType: 'system', reason: 'checkout.recovery:' + sessionId })` (`@open-mercato/shared/lib/commands/trusted-context`, D-R5-CH7) with the session's own scope. Recovery never takes a fresh cart lock and never calls `resolveForBuyer` (D-R5-SF4, SPEC-029 §6.3). It only unlocks, converts, or extends with `extendOnly: true` a cart this session still holds (cart §9.1). The extend-only call is the probe: it checks and extends the lock atomically, so a lock released by the cart's stale-lock sweeper between a check and an extend cannot turn into a fresh lock. Each probe reads by the attempt's key. The document probe is `salesDocumentLookupService.findOrderByExternalReference` (or `findQuoteByExternalReference` for `request_quote`) with `documentRef` (D-R5-CH1).

| `submit_progress` | Probe | Action |
|---|---|---|
| null (crashed inside step 0 or 1) | Cart status and lock holder | Locked by this session → unlock; release the pay-link slot if reserved; status `open`. Not locked → status `open` |
| `locked` | Availability hold by `stock_reservation_key` | Hold exists → release it. Unlock; status `open` (the buyer resubmits and re-confirms) |
| `stock_reserved` or `credit_reserved` (a crash in step 4 or 5) | First the **order** by `external_reference = documentRef`; then the credit ledger by `credit_reservation_key` (on account) | **Order absent** → no document was created: release credit if reserved, release stock, unlock, `open`. **Order present** → it is live and holds the attempt: write `sales_order_id`, set `document_created`, and resume forward from 5c (the totals check), never releasing anything first. Quote outcome: quote absent → release stock, unlock, `open`; quote present → resume the quote branch |
| `document_created` | Hold status, credit entry `orderId`, promotion usage by `orderId` | Resume step 6 forward; each sub-step is idempotent under its key |
| `finalized` | Gateway transaction by session | No intent → `cart.lock({ extendOnly: true })`, then resume step 7 from 7a (create intent). Intent with `checkout_disposition = setup` (crash between 7a and 7c) → resume from 7b: `cart.lock({ extendOnly: true, lockTtlMs })` to the intent's expiry, and only then 7c (`setup → published`, status `awaiting_payment`, then the deferred-success read). Intent with `compensating` → resume reconciliation and §7.3. Either extend answering `409 cart_lock_lost` (the lock lapsed or was swept) → reconcile an existing intent (§7.2, lost lock after the intent), compensate per §7.3 and fail with `submit_recovery_failed`; never re-lock (D-R5-SF4) |
| `payment_initiated` / `awaiting_payment` with a settled transaction | Gateway status | Run the "Payment result disposition" dispatch (§7.2) |
| `payment_initiated`, `order_confirmed` or `cart_converted`, transaction `completing` with an expired lease | The claim token and lease; the order status; the cart by `checkoutSessionId` | Take the claim over (§4.4), then resume paid completion after the last checkpoint (§7.2). A cart already converted by this session for this order is the cart's replay, so the step counts as done. Ends with `completing → completed` and session `completed` in one transaction |
| `compensating` | — | Left to `repair-order-compensation` |
| any, attempt older than the payment TTL without an intent | — | Compensate per §7.3 and fail with `submit_recovery_failed`; ops notification |

A recovery that resumes forward never creates a second document: the order (or quote) carries `external_reference = documentRef`, and the lookup runs before every create (C3, D-R5-CH1). A recovery never releases holds while an order for the attempt exists; only cancelling that order releases them (§7.3).

---

## 13) Security

Everything in this section ships with the phase that introduces the route (C14); none of it waits for B.6.

- **Token.** CSPRNG, carried only in `X-Checkout-Session-Token`, never in a URL path or query, never logged; stored as `token_hash` only (C4, D-R4-18). Not rotated (the session is short-lived).
- **Buyer binding.** A session on an identified cart requires the matching customer session on every buyer route (§9.0). Creating a session requires proof of cart access: `X-Cart-Token` plus, for an identified cart, the matching customer session; or the link checks.
- **Encryption (B.1).** `checkout/encryption.ts`'s `defaultEncryptionMaps` gains `{ entityId: 'checkout:checkout_session', fields: [{ field: 'email' }, { field: 'phone' }, { field: 'shipping_address' }, { field: 'billing_address' }] }`; reads go through `findWithDecryption`. `defaultEncryptionMaps` reaches only tenants created afterwards, so the same step ships a **backfill migration** (R-1, `packages/core/AGENTS.md` → Encryption): `this.addSql(buildEncryptionMapBackfillSql({ entityId: 'checkout:checkout_session', fields: [...] }))` from `@open-mercato/shared/lib/encryption/migration-backfill`, with the entity id and fields written literally and an empty `down()`, exactly as `checkout/migrations/Migration20261109120000.ts` does for the Phase A maps. A unit test modelled on `migrations/__tests__/Migration20261109120000.test.ts` asserts the generated SQL. The migration runs in the same release as the table, before any session row exists.
- **Redaction (B.1).** `CheckoutSessionEvent.payload` is redacted at write time: never card data, addresses, e-mail, phone or gateway secrets.
- **Rate limits** through the Phase A helper `enforceCheckoutRateLimit` (`readEndpointRateLimitConfig`). A `fail-closed` route answers `503` both when the limiter cannot decide and when no `rateLimiterService` is registered (§3.2 item 1). Per-session buckets are keyed by the token hash, never the token:

  | Route | Limit | Posture |
  |---|---|---|
  | `POST /sessions` (B.1) | 20/min per IP | fail-closed |
  | `PATCH`/`POST` under `/sessions/current` (B.1) | 60/min per session, 120/min per IP | fail-closed |
  | `POST /sessions/current/submit` (B.4) | 10/min per session, 60/min per IP | fail-closed |
  | `GET /sessions/current/delivery-options` (B.3) | 30/min per session | fail-closed |
  | Other `GET` under `/sessions/current` | 120/min per session | fail-open |

- **Card data** never touches the platform; the Phase A provider delegation is unchanged.
- **Entitlement.** `on_account`, `request_quote` and PO rules are resolved server-side from group terms; a client asking for a method without entitlement is refused, never trusted.
- **Cross-tenant (C21).** Session, cart, link, store, customer and approval resolve to one tenant and organization, checked on every request; a mismatch is a `404`.
- **Trusted contexts.** Link seeding and recovery build their context with `buildTrustedCommandContext` (`@open-mercato/shared/lib/commands/trusted-context`, also re-exported by `@open-mercato/shared/lib/commands`, D-R5-CH7) from stored rows (link, session), never from request input; audit entries are marked system-initiated (D-R5-19, X10).
- **Return URLs.** Gateway return URLs are relative paths resolved against the server-pinned origin (§9.3).
- **Mutation guards.** Every buyer write calls `runMutationGuards` (§9).

---

## 14) Withdrawn

### 14.1 Withdrawn from v1

| v1 element | Disposition |
|---|---|
| `CheckoutCartItem` entity | **Withdrawn.** Replaced by `CheckoutLinkCartTemplate` seeding a real `Cart`. Never implemented, so this is a specification change with no migration and no deprecation protocol. |
| `checkout.cartItem.*` commands | Renamed to `checkout.cartTemplate.*`. Never shipped. |
| Cart totals computed in checkout | Withdrawn. The cart owns totals via `salesCalculationService` (ADR-2); checkout reads them. |
| One-page checkout as the only shape | Generalized to the configurable step machine (§5.2). |

### 14.2 Withdrawn from v2.1 (Release 5 revision)

None of these was implemented.

| v2.1 element | Disposition |
|---|---|
| `/api/checkout/sessions/:token/*` routes, plaintext `token` column | `/api/checkout/sessions/current/*` with `X-Checkout-Session-Token`; `token_hash` (C4) |
| `CheckoutSession.approval_id`, checkout-created `CustomerPurchaseApproval` | The cart is the subject; `Cart.approvalId` (D-R5-3, X6) |
| `CheckoutSession.workflow_instance_id`, workflow-driven approval resume, stalled-instance monitor | Event-driven resume from `customer_groups.approval.*` (C11); B.6 re-adds a correlation column only if needed |
| Hard `requires: cart, sales, promotions, availability, customer_groups` | Soft peers via `tryResolve`; `503 checkout_sessions_unavailable` (D-R5-18) |
| `availability.commit` at payment success (steps 7/8) | Commit right after the order is created (D-R5-8) |
| `registerUsage` after payment; `sales` calling `revertUsage` | `useCode` + `registerUsage` before payment; promotions-owned `sales.order.cancelled` subscriber reverts (C5) |
| Credit "in a serializable transaction", held "until invoicing settles it" | Row lock (G1); held until settled through `/adjust` or `settleCredit` (D-R5-2) |

### 14.3 Withdrawn from v2.3 (re-landing remediation, 2026-11-19)

| v2.3 element | Disposition |
|---|---|
| Order outcome as `sales.quotes.create` + `sales.quotes.convert_to_order`; idempotency on the quote's `external_reference` | `sales.orders.create` directly, idempotent on `sales_orders.external_reference` (D-R5-CH1). `convert_to_order` deletes the quote and drops both references on `main` |
| `retry-failed-compensations` | `repair-order-compensation` plus `repair-gateway-payments` (§12) |
| Checkout calling `revertCodeUse({ cartId })` | Not called; every code use carries the `orderId` and the promotions cancellation subscriber reverts it (C5) |
| Digital-only carts skipping `delivery` | Deferred (§5.2 "Later", D-R5-CH4) |
| Store address as the delivery origin | The primary `wms` warehouse; stores have no structured address (§5.3) |

Phase A keeps its behaviour except for the three changes of §3.2: `CheckoutLinkTemplate`, `CheckoutLink` and `CheckoutTransaction` keep their pay-link flow, and that flow does not pass through `CheckoutSession`.

---

## 14a) Migration & Backward Compatibility

Checkout's session surface is new or additive. Phase A changes in four rows (14–17), each approved under the Ask First rules of `packages/checkout/AGENTS.md`. The contract changes in other modules are specified in their own specs; this table is the checklist they must match.

| # | Surface (BACKWARD_COMPATIBILITY.md) | Change | Classification | Owner spec |
|---|---|---|---|---|
| 1 | Module metadata / generated (1, 13) | `checkout/index.ts` `requires` **unchanged** (C10, D-R5-18) | No change | this spec |
| 2 | DB schema (8) | New `checkout_sessions`, `checkout_session_events`, `checkout_link_cart_templates`; nullable `session_id`/`quote_id`/`order_id`/`payment_recorded_at`/`payment_repair_attempted_at`/`checkout_disposition`/`completion_claim_token`/`completion_lease_expires_at` on `checkout_transactions`, index `(tenant_id, session_id)` and the repair partial index (§4.4) | Additive | this spec |
| 3 | Signatures (3) | `sales.quotes.create` gains `externalReference` and `customerReference`. `sales.orders.create` gains the optional `suppressStaffNotification` (D-R5-CH8); omitted, behaviour is unchanged. The shared line schemas (`linePricingSchema`, `lineSharedSchema`), used by order **and** quote lines, accept `null` wherever `SalesLineSnapshot` declares `\| null` | Warning (widening a validator); UPGRADE_NOTES entry listing every widened field | sales |
| 4 | DB schema (8) | Index `sales_quotes (tenant_id, external_reference)` | Additive, approved (D-R5-30) | sales migration |
| 5 | DB schema (8) | Index `sales_orders (tenant_id, external_reference)` | Additive, Ask First on `sales` approved (D-R5-CH1) | sales migration |
| 6 | DI keys / signatures (9, 3) | New `salesDocumentLookupService` (`resolveOrderStatusEntryId`, `findOrderByExternalReference`, `findQuoteByExternalReference`, `findPaymentByReference`, §3.3); `sales.payments.create` refuses a duplicate `paymentReference` on the same order | Additive (new key); the duplicate refusal is a Warning with an UPGRADE_NOTES entry | sales |
| 7 | API routes (7) | New `/api/checkout/sessions`, `/sessions/current/*`, admin `GET /sessions` and `GET /sessions/:id` | Additive | this spec |
| 8 | Events (5) | New `checkout.session.*`, `checkout.payment.*`, `checkout.compensation.*`, `checkout.cartTemplate.*` | Additive | this spec |
| 9 | ACL (10) | `checkout.sessions.view`, `checkout.sessions.manage`; Phase A features unchanged | Additive; run `yarn mercato auth sync-role-acls` | this spec |
| 10 | Encryption map + data | `checkout:checkout_session` entry **and** a `buildEncryptionMapBackfillSql` migration for existing tenants (§13, R-1) | Additive | this spec |
| 11 | Signatures (3) | `cart.lock` gains `lockTtlMs`, `purpose`, idempotent same-session extend, atomic `extendOnly` (`409 cart_lock_lost`); `unlock`/`markConverted` require `checkoutSessionId`; `markConverted` gains `salesOrderId`, `salesQuoteId`, `lineMap` and a same-session, same-document replay (`alreadyConverted: true`, pending #9999); storefront lock without context refused | Additive (C1, C2, K8, D-R5-16, D-R5-23, D-R5-26, D-R5-SF4, D-R5-CA12) | cart spec |
| 12 | Signatures (3) | `cartService.getCheckoutView` and `getSalesSnapshot` (§3.3); the snapshot's adjustment drafts are the exact drafts behind `Cart.totals`, metadata (`taxRate`) included | Additive (D-R5-CH5, G3) | cart spec §3.1a, `TC-CART-LOCK-06` |
| 13 | Signatures (3) | Trusted pay-link cart creation path, with `salesChannelId` | Additive, Ask First approved (D-R5-19) | cart spec §6a.4 |
| 14 | API routes (7), Phase A | Fail-closed routes (`POST /api/checkout/pay/[slug]/submit`, `/verify-password`, the session routes) answer `503` when no limiter is registered; reverses the skip tested by #5030 | Warning (behaviour change), approved 2026-11-19; UPGRADE_NOTES: configure the rate limiter | this spec |
| 15 | Types / DB (2, 8), Phase A | `checkout_transactions.link_id` drops NOT NULL; `CheckoutTransaction.linkId: string \| null`; `GET /api/checkout/transactions` can return `linkId: null` | Warning; UPGRADE_NOTES for API consumers | this spec |
| 16 | Subscribers (Phase A) | The four `gateway-payment-*` subscribers rethrow retryable failures and resume session payments; `reportGatewayStatusSyncFailure` and its import path stay | Behaviour change, approved (D-R5-CH3) | this spec |
| 17 | Commands (Phase A) | `checkout.transaction.updateStatus` accepts a transaction without a link | Additive | this spec |
| 18 | DB schema (8), Phase A tables | `checkout_links` and `checkout_link_templates` gain nullable `sales_channel_id` and `flat_rate_shipping_*` columns (§4.3) | Additive | this spec |
| 19 | Signatures / events (3, 5) | `promotionsService.revertCodeUse?` **optional**; `UseCodeInput.orderId`; promotions subscriber on `sales.order.cancelled`; delivery promotions authorable | Additive (C5, D-R5-17); checkout never depends on `revertCodeUse` | SPEC-055 |
| 20 | Notification type ids (11) | `checkout.session.attentionRequired` (§10.1) | Additive | this spec |
| 21 | DI keys (9) | `checkoutScheduleUpgradeRegistrar` and the `configs` upgrade action `checkout.register-schedules` (§12) | Additive | this spec |
| 22 | Signatures / DI (3, 9) | `customerCreditService.linkCreditReservationToOrder`; terms `allow_quote_requests`, `requires_po_number`, `terms_currency_code`, `approval_policy` | Additive (C6, D-R5-20, D-R5-28, D-R5-4, D-R5-1) | customer-groups spec |
| 23 | Signatures / types (3, 2) | `storeContextService.resolveForBuyer` with optional store; the store context exposes its default sales channel id; `EcommerceStoreSettings.shipping` is an **optional** key holding `flatRate` and `taxRate` | Additive (D-R5-22, D-R5-35) | SPEC-029 |
| 24 | DI keys (9) | `wmsWarehouseLookupService.getPrimaryWarehouseAddress` | Additive | wms |
| 25 | Imports (4) | `buildTrustedCommandContext({ tenantId, organizationId, actorType, actorId?, reason })` in `@open-mercato/shared/lib/commands/trusted-context`, re-exported by `@open-mercato/shared/lib/commands` | Additive (X10, D-R5-CH7) | shared |

No row removes or renames a contract; no deprecation protocol applies.

**Phase A non-regression (C10).** A test boots an app with only `checkout` + `payment_gateways` and completes a pay link end to end. The existing Phase A tests run unchanged, including the `update-transaction-status` suite, except the #5030 rate-limit tests, which assert the new `503` (row 14).

**Upgrade steps.**
1. `yarn db:migrate`: new tables, nullable columns, the two `sales` indexes, and the `checkout:checkout_session` encryption-map backfill (a data migration).
2. `yarn mercato auth sync-role-acls` for the new grants.
3. Run the `checkout.register-schedules` upgrade action (automatic when `UPGRADE_ACTIONS_ENABLED` is set), so existing tenants get the five schedules.
4. Register a rate limiter (`RATE_LIMIT_*`) before upgrading: fail-closed routes answer `503` without one.
5. Configure the checkout origin (`APP_URL`, `NEXT_PUBLIC_APP_URL` or `CHECKOUT_ALLOWED_ORIGINS`) for session return URLs.

UPGRADE_NOTES carries one entry per Warning row (3, 6, 14, 15) and one for step 3.

---

## 15) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Payment captured without an order | **Critical** | Payment succeeds; the completion write fails; the buyer is charged and sees a failure. | The order is created and finalized **before** the intent (§7.2 steps 5–7), so a successful payment always has an order; the webhook resume, `expire-awaiting-payment` and recovery read the gateway status before compensating; the gateway subscribers rethrow retryable failures so the event is redelivered (D-R5-CH3) | Low |
| R2 | Duplicate order from double submit | **Critical** | Double-tap or a retried request creates two orders and two charges. | Conditional `open → submitting` admits exactly one caller; `Idempotency-Key` per attempt; a repeat returns the original result (§7.4); concurrent-submit test is a merge gate | Low |
| R3 | Leaked stock or credit reservation | **High** | The process dies mid-submit; stock and credit stay reserved against a session that will never complete. | `recover-stuck-submits` with the §12.1 table; checkout holds have a 900 s TTL as a backstop until commit; after commit, cancellation releases through `sales.order.cancelled`; `checkout.compensation.failed` raises an ops notification | Low |
| R4 | Price changed between review and charge | **High** | A promotion expires or a delivery promotion changes during checkout; the buyer is charged more than the reviewed total. | `cart.lock` re-price and the submit-time delivery evaluation abort with `409 price_changed` before any side effect (§6, §7.2 step 2) | Low |
| R5 | Stale shipping rate | Medium | The buyer changes the address after selecting delivery; the merchant absorbs the difference. | An address change invalidates the quote (§5.2); the snapshot carries `quotedAt` and is re-validated at submit | Low |
| R6 | Cart stranded in `locked` | Medium | Submit crashes after locking. | Recovery unlocks (§12.1); every compensation unlocks; the cart's `release-stale-locks` sweeper remains the backstop | Low |
| R7 | Credit overshoot via concurrent checkouts | **High** | Two on-account checkouts for one company jointly exceed the limit. | `reserveCredit` takes a `PESSIMISTIC_WRITE` row lock on the credit account (G1); the eligibility check is advisory and the reservation authoritative; N=20 parallel test | Low |
| R8 | Approval bypassed by a price change | Medium | A cart approved at 150 000 re-prices to 180 000 and is submitted against the stale approval. | `cart.lock` compares the re-priced total with the approved amount (K2, D-R5-3) and refuses with `409 cart_requires_approval` | Low |
| R9 | Compensation failure swallowed | **High** | A release call fails and is logged but not surfaced. | Never swallowed: `failure` event, `checkout.compensation.failed`, ops notification, retry job (§7.3) | Low |
| R10 | Rate-quote API abuse | Medium | Scripted `delivery-options` calls incur carrier cost. | 30/min per session; 5 min cache; flat-rate fallback on carrier failure (§5.3) | Low |
| R11 | Cart unlocked mid-payment (C1) | **Critical** | The 30 min cart lock lapses during a slow payment; the buyer edits or re-buys the basket while the first order completes. | Lock extended to the payment expiry + 15 min under the same session id; `unlock`/`markConverted` require the session id; `expire-awaiting-payment` resolves first (§6) | Low |
| R12 | Duplicate or orphan order after a crash (C3) | **Critical** | A crash after `sales.orders.create` and before the session write; recovery releases the holds of a live order, or creates a second one, and the buyer pays twice. | The order itself carries `external_reference = documentRef`, indexed on `sales_orders` (D-R5-CH1); recovery looks it up first and resumes forward when it exists, releasing nothing (§12.1); a kill test placed exactly after order creation | Low |
| R13 | Codes reused or budgets overrun (C5) | **High** | A single-use code is never consumed, or a budget overrun is found after capture. | `useCode` + `registerUsage` before payment; abort with `409 promotion_unavailable`; promotions-owned reversal on cancellation | Low |
| R14 | Visibility pass skipped at submit (C2) | **High** | A product that left the buyer's assortment is bought. | Storefront lock without a fresh context is refused by the cart; checkout always passes the request; recovery never fresh-locks (D-R5-SF4) | Low |
| R15 | Phase A regression (C10) | **High** | Hard `requires` stop pay-link-only apps from booting. | No new `requires`; soft peers; non-regression boot test | Low |
| R16 | Totals drift between cart, review and document (C7, D-R5-24) | Medium | The buyer accepts one amount and is invoiced another, or credit is reserved for a different amount; a percentage code with tax loses its tax reduction (#9389, #8425). | One draft source (the cart's exact snapshot, metadata included); a pre-document self-check against `Cart.totals`; payable computed by `sales` (D-R5-CH6); post-create equality of every persisted total for every payment method; `500 totals_mismatch` compensates and notifies ops | Low |
| R18 | Connection-pool exhaustion under parallel submits (#8414) | **High** | Nested commands each open a connection inside an open transaction; last-unit buyers get `500` and the N=20 test fails. | Nested commands run on the caller's transaction (`ctx.transactionalEm`); no step waits on another while holding a connection (§7.2); the N=20 test sized to the pool and run against real Postgres in CI (#9183) | Low |
| R19 | False `totals_mismatch` from rounding | Medium | Floats or 2 dp vs 4 dp comparisons refuse valid orders. | Exact decimal strings at the currency's decimal places; `sales` computes every figure; one comparison rule (§7.2 "Money") | Low |
| R20 | Subscribers or workers without a real container | Medium | A recovery or webhook resume dispatches commands that cannot resolve their peers; a promoted order ends cancelled. | Real container hand-off (`SubscriberContext.container`, `WorkerJobContainer`) as a B.4 prerequisite (§11) | Low |
| R21 | Payment captured but not recorded on the order (#8423, #8821) | **High** | The order shows nothing paid; the transaction stays `processing`. | `sales.payments.create` at every completion site, idempotent per `(order, paymentReference)`; `repair-gateway-payments` sweep (§12) | Low |
| R22 | Lock lost between intent and extend (D-R5-SF4) | **High** | The lock lapses during the gateway call; the session publishes `awaiting_payment` on a released basket, the buyer pays, and `markConverted` refuses the conversion. | `awaiting_payment` only after a successful `extendOnly` extend; `409 cart_lock_lost` marks the intent `compensating`, cancels, voids or refunds it and cancels the order; a late success refunds only an intent durably marked for compensation (§7.2, §12.1) | Low |
| R23 | Paid order refunded by a replayed or early payment result (D-R5-SF4) | **Critical** | A replayed success webhook or a concurrent poll arrives after normal completion, or a success arrives while submit is still between 7a and 7c, and a status-based rule sends it to the refund path. | Results are dispatched on the intent's `checkout_disposition` under a conditional update (§4.4, §7.2 payment result disposition): `completing`/`completed` acknowledge, `setup` defers, only `compensating`/`compensated` refunds; every cancel and refund sends one fixed request under a per-intent `operationId`, and an in-flight answer is never taken as settled (§7.2, cancel and refund operation contract) | Low |
| R24 | Paid completion run twice, or stranded half done | **High** | A duplicate result runs the completion while the first handler is still confirming the order, or the process dies after the cart is converted and before the session is written; the order is confirmed twice, or the buyer has paid and the session never completes. | One `completing` claim with a token and a 120 s lease; checkpoints `order_confirmed` and `cart_converted`; `recover-stuck-submits` takes over an expired lease without waiting for a callback; the repeated `markConverted` is the cart's same-session replay (D-R5-CA12); intent and session become `completed` in one transaction (§7.2, paid completion) | Low |
| R17 | Session token replay by a third party | Medium | A leaked session token on an identified cart is replayed. | Binding to the customer session (§9.0); `404` on mismatch; token never in URLs or logs | Low (guest sessions remain token-only by design) |

---

## 16) Integration Coverage

Integration tests are self-contained: each creates its tenant, store, products, stock, groups, terms, credit accounts, promotions and carts through API fixtures and cleans up in teardown. A second-tenant fixture exists for every public route.

**API paths (every new route):**
- `POST /api/checkout/sessions` — from a cart token (guest, identified with matching customer session, identified without it → 404, identified with another buyer's session → 404); from a link (B.2); token returned once and only its hash stored; second session on the same cart supersedes an `open` one and is refused while `submitting`; `503 checkout_sessions_unavailable` with `cart` disabled.
- `GET /api/checkout/sessions/current` — token in header works; token in path or query is not accepted; unknown token, binding mismatch and other-tenant token answer the same 404; a guest-cart token stops working without the buyer's session once that buyer claims the cart (binding to the live cart, §9.0); the response matches `CheckoutSessionView` and never carries `tokenHash` or reservation keys.
- `PATCH /api/checkout/sessions/current` — contact and addresses saved and encrypted at rest; stale `updatedAt` → 409; binding 404.
- `POST /api/checkout/sessions/current/step` — transition table exhaustively; a forward move over an incomplete step → `422 steps_incomplete`; binding 404.
- `POST /api/checkout/sessions/current/cancel` — `open` and `awaiting_approval` canceled; the cart's approval survives; binding 404.
- `GET /api/checkout/sessions/current/delivery-options` — carrier rate with the primary-warehouse origin and package defaults; no `wms` → flat rates only; carrier failure → flat rate from store settings (storefront cart) and from link settings (link cart); a rate in another currency is dropped; no fallback → `422 delivery_unavailable`; delivery promotion evaluated; rate limit 30/min; binding 404.
- `POST /api/checkout/sessions/current/delivery` — snapshot and `quoted_totals` written; binding 404.
- `GET /api/checkout/sessions/current/payment-methods` — `on_account` offered only with entitlement and an account in the currency (reasons `no_account`, `on_hold`); `request_quote` only with `allow_quote_requests`; binding 404.
- `POST /api/checkout/sessions/current/payment` — unoffered method → `422 payment_method_unavailable`; method and PO stored on the session; bad PO format → `422 purchase_order_number_invalid`; changing the method clears `quoted_totals`; binding 404.
- `POST /api/checkout/sessions/current/submit` — the submit cases below; missing or short `Idempotency-Key` → `400`; an absolute or `//` return URL → `422 invalid_return_url`; a relative one is resolved against the configured origin, never the request `Host`; a body with `paymentMethodCode` is rejected (strict schema); a gateway submit returns a `paymentHandoff` with `redirectUrl` or `clientSecret`; binding 404.
- `GET /api/checkout/sessions/current/result` — order and quote outcomes, per-line stock outcomes, the hand-off while `awaiting_payment`, `completed` after the webhook; binding 404.
- `POST /api/checkout/sessions/current/request-approval` — session parks in `awaiting_approval`, `Cart.approvalId` set, no session approval id; below threshold → `409 approval_not_required`; binding 404.
- Admin `GET /api/checkout/sessions` and `/sessions/:id` — `checkout.sessions.view` required; PII only with `checkout.viewPii`; another tenant's session is `404`.
- Admin ACL: `checkout.sessions.view` granted to `employee` and `admin`; `checkout.sessions.manage` to `admin` only (asserted on the role grants).
- Every buyer `POST`/`PATCH` runs the registered mutation guards: a test guard that refuses blocks the write (R-2).

**Submit correctness:**
- Happy-path B2C: order created directly by `sales.orders.create` in `draft`, with `externalReference`, `channelId`, the method fields, `customerSnapshot` and both addresses (the full §7.2 field mapping asserted); no `sales.quote.created` notification is sent and no quote exists; no `sales.order.created` notification is sent at create, and exactly one is sent when the order is confirmed (D-R5-CH8); a gateway order compensated before payment sends none; stock committed before the intent, codes consumed with the `orderId` and usage registered before the intent, payment captured, a `sales` payment recorded with `paymentReference` = the gateway transaction id and `payment_recorded_at` set, order `confirmed` only after commit, cart converted with `salesOrderId` and a `lineMap` covering every cart line incl. gifts (C17, C18, G2, G4).
- Happy-path B2B on account: credit reserved for the `sales`-computed payable (goods + delivery − delivery discount, D-R5-24, D-R5-CH6), linked to the order, standing after completion; `paymentMethodCode: 'on_account'` and the PO number in `customerReference` on the order; no gateway call.
- Quote outcome (`request_quote`): quote created with PO in `customer_reference`; no payment, no credit, stock released; cart converted with `salesQuoteId` and a quote `lineMap`; approval and `min_order_value` not applied (D-R5-23).
- Concurrent double submit creates exactly one order (R2); repeat after success returns the original ids; repeat in flight → `409 submit_in_progress`; new key after failure → fresh keys and a fresh `external_reference`.
- Goods totals and payable equality; a forced mismatch compensates with `500 totals_mismatch` and the ops notification (C7).
- **Percentage code with tax (G3, #9389):** a cart with a percentage promotion code and a taxed product submits successfully, for a gateway and for `on_account`; the order's tax total equals the cart's reduced tax; the snapshot self-check fails before any document exists when the snapshot drops `metadata.taxRate` (no orphan document).
- Taxed shipping: the shipping adjustment's tax comes from `metadata.taxRate`; the order's grand total gross equals the payable.
- A cart without a shipping method or address cannot submit (`422 steps_incomplete`, D-R5-CH4).
- No resolvable sales channel → `422 sales_channel_unresolved`.
- Backorder line holds `min(requested, sellable)` and does not abort; a shortfall line aborts with only the shortfall lines listed; `not_tracked` with `availability` disabled (D-R5-9).

**Compensation and recovery (C26):**
- `availability.commit` returning `stock_lost` (expiry sweep forced to win before step 6a, stock taken by another order): the order is cancelled, no payment intent is created, submit answers `409 stock_shortfall` (D-R5-8).
- Injected failure at each of steps 1, 2, 3, 4, 5a, 5b, 5c, 6a, 6b, 6c, 7 (intent) and payment failure: no stock held, no credit reserved, codes and usage reverted, the order (if any) cancelled, and the cart unlocked.
- A process killed after each of steps 1–7 is reconciled by `recover-stuck-submits` per §12.1 **without a duplicate quote or order** (C3, C24).
- **Kill right after `sales.orders.create`, before the session write (G1):** recovery finds the order by `external_reference`, releases nothing, and completes or compensates it; a second submit by the buyer creates no second order.
- A payment recording failure is repaired by `repair-gateway-payments` exactly once (G4); an order cancellation that fails three times is finished by `repair-order-compensation`.
- A gateway subscriber whose command fails with a `5xx` rethrows and the event is redelivered; a terminal `409` is reported and swallowed (D-R5-CH3).
- A failing compensation raises the notification and is retried (R9).
- Credit released by `customer_groups` when the order is cancelled (C6).
- Code reuse refused; code returned on payment failure; budget overrun aborts with `409 promotion_unavailable` before payment (C5).

**Lock and payment (C1, C2):**
- Lock held through a payment longer than 30 min; the cart sweeper does not release it; `expire-awaiting-payment` compensates at the payment expiry.
- `unlock`/`markConverted` with another session id → 404.
- A storefront cart locked without a context is refused; checkout always supplies one.
- **Lost lock at `finalized` (D-R5-SF4).** For a storefront cart and for a pay-link cart each: a session stuck at `finalized` with no intent, whose cart lock lapsed or was cleared by `release-stale-locks` before recovery ran, is compensated (order cancelled, stock and credit released) and fails with `submit_recovery_failed`. The cart is `active` and not re-locked, no re-price runs, and the storefront cart produces no `400 assortment_scope_required_for_storefront_channel`. With the lock still live, recovery extends it and creates the intent.
- **Lost lock after the intent (D-R5-SF4).** For a storefront cart and for a pay-link cart each, the lock is forced to expire (and, in a second variant, swept by `release-stale-locks`) between `createPaymentSession` and the step 7b extend:
  - On the submit path, submit answers `409 cart_lock_lost`, the session never enters `awaiting_payment`, and no hand-off is returned. The intent is cancelled through `cancelPayment`, the order is cancelled, stock, credit and code uses are released, and the cart is not re-locked.
  - In recovery, a session crashed between 7a and 7c with the lock since lapsed is reconciled the same way and fails with `submit_recovery_failed`. With the lock still live, recovery extends it and only then sets `awaiting_payment`.
  - A gateway stub reporting the intent authorized gets `cancelPayment`; one reporting it captured gets `refundPayment`. Both raise the operational notification.
  - A `success` webhook delivered afterwards for that transaction neither confirms the order nor converts the cart. The disposition is `compensating` or `compensated`, so it refunds under the intent's refund contract and raises the operational notification.
- **Refund retry against the real operation layer (§7.2, cancel and refund operation contract).** These run through the real `paymentGatewayService` and `payment-operation-idempotency.ts` with a test adapter, never a stub that deduplicates by key. The adapter's `refund` blocks until the test releases it.
  - Overlap: a late success and a `repair-order-compensation` run refund the same `compensating` intent at once. The second call gets `409 payment_operation_in_progress`, is not treated as settled, and leaves the disposition `compensating`. After the adapter is released, the next repair run returns the recorded result and moves the disposition to `compensated`. The adapter received one refund, and there is one `gateway_payment_operations` row for `checkout:<transactionId>:refund`.
  - Sequence: a reconciliation retry after a late success has already refunded returns the recorded result and issues no second adapter call. In a second variant the provider's webhook moves the transaction to `refunded` before the retry, so the replay answers a `409`; the retry reads `refunded`, settles, and issues no second adapter call.
  - Late success after compensation: an intent `compensated` on payment expiry (cancelled) later reports captured. The result reopens it to `compensating` and refunds it once. With the refund first answering `payment_operation_in_progress`, the disposition stays `compensating` and `repair-order-compensation` finishes it. A captured result for an intent already `refunded` is acknowledged and does not reopen it.
  - Lost lock with a refund in flight: the order is still cancelled and stock and credit released while the refund is pending; the session is `failed`; the disposition becomes `compensated` only after the refund returns.
  - Same request: the lost-lock path, the late-success path and the repair worker send the same `amount` (omitted) and `reason`, so none of them gets `payment_operation_conflict`. A forced payload drift in a unit test raises `payment_operation_conflict`, the operational notification, no retry under another `operationId`, and the disposition stays `compensating`.
- **Payment result disposition (R23).**
  - Replay after normal completion: a session completes through a `success` webhook; the same webhook is delivered again and a poll reports success concurrently. Both are acknowledged, the order stays `confirmed`, the cart stays converted, and no `refundPayment`, `cancelPayment` or operational notification is issued.
  - Concurrent first delivery: a webhook and a poll deliver the same success at once; exactly one wins `published → completing`, the order is confirmed once and `markConverted` runs once.
  - Callback before publication: a gateway stub delivers `success` after 7a and before 7c. Nothing is confirmed, converted or refunded while the disposition is `setup`. When 7b succeeds, 7c publishes and then claims completion from the recorded status. When 7b answers `409 cart_lock_lost` instead, the intent is refunded once and the order cancelled. Both variants also run with the process killed before 7c, resolved by recovery.
- **Paid completion (R24).**
  - Duplicate before the first handler finishes: the completion owner is paused after `sales.orders.update` (confirmed) and before `markConverted`. A second `success` delivery and an `expire-awaiting-payment` run both read `completing` with a live lease and only acknowledge. The order is confirmed once, the cart converted once, one `checkout.session.completed` is emitted, and nothing is refunded.
  - Crash after conversion, before the final session write: the owner is killed after `markConverted` commits. No further callback is delivered. Once the lease expires, `recover-stuck-submits` takes the claim over, its `markConverted` gets `alreadyConverted: true`, and the intent and the session reach `completed` in one transaction. One `cart.cart.converted` and one `checkout.session.completed` exist. The same test runs with the kill before the `cart_converted` checkpoint.
  - Crash after confirmation, before conversion: recovery skips the confirm (the order is already `confirmed`) and converts the cart.

**Price, delivery and consistency:**
- A promotion expiring mid-checkout aborts with `409 price_changed` and no side effect (R4).
- A delivery promotion changing between review and submit aborts with `delivery_changed`; a newly eligible one with `promotion_newly_eligible` (C8).
- An address change after delivery selection invalidates the quote (R5); a stale rate is re-quoted at submit.
- Store, channel and currency mismatch → `409 cart_store_mismatch`; a link cart without a store is not compared on store (C9, X13).

**B2B:**
- Over-threshold submit → `409 cart_requires_approval`; guest above threshold → `409 approval_requires_identified_buyer`.
- `approved` event returns the session to `open`; `rejected` fails it; `expired`/`withdrawn` return it to `open`; an event for an expired session is ignored; a new session on the cart picks up the pending approval (X6).
- Approval, re-price upward, `409 cart_requires_approval` at lock (R8).
- `approval_policy = both` resolves only after both sides approve (driven through `customer_groups` routes; checkout observes the event only).
- Credit refused → `402 credit_refused` with reason; offered prepayment and, where allowed, `request_quote`.
- N=20 parallel on-account submits respect the limit exactly (R7), and N=20 parallel submits for the last unit give one order and 19 `409 stock_shortfall`, never a `500` (R18). Both run against real Postgres in suites named so CI selects them (#9183).
- `requires_po_number` blocks submit without a PO and the PO reaches the order.
- Below `min_order_value` blocked; another currency not checked.

**Entry modes:**
- Phase A pay link unaffected with `cart` disabled, in an app with only `checkout` + `payment_gateways` (C10, D-R5-18).
- A tokenless `POST /sessions` on a link at `maxCompletions − 1` does not consume the last slot; two parallel submits on it complete one and refuse the other with `409 link_usage_limit_reached`; a failed submit releases its slot once.
- A simple checkout link seeds a `pay_link` cart through the trusted context; a template line without `unit_price_override` prices at a logged-in buyer's own rate and credit resolves to the company (D-R5-19, D-R5-22); the request body cannot add lines.
- `is_quantity_editable = false` rejects a quantity change.

**Security:**
- Cross-tenant session/cart/link/store/approval combinations rejected on every public route (C21).
- `checkout:checkout_session` fields encrypted at rest; event payloads redacted (C14). The backfill migration's unit test asserts its SQL; a tenant created before the migration encrypts session PII after it runs (R-1).
- A fail-closed route answers `503` with no rate limiter registered; a fail-open route proceeds (§3.2 item 1).
- Schedules: a tenant upgraded with `checkout.register-schedules` has all five session schedules (G5).
- Rate limits on `POST /sessions`, `/current` mutations, submit and `delivery-options` enforced (C14).

**Cross-module requirements.** Checkout's steps depend on these changes in other modules. Each belongs to the owning spec, which is edited separately; the step that needs it is named.

| Module (spec) | Requirement | Needed by |
|---|---|---|
| `cart` (cart spec) | `cartService.getCheckoutView` (§3.3): the live cart's status, lock holder, identity incl. `customerUserId` and company, `storeId`, `channel`, `salesChannelId`, `currencyCode`, `approvalId`, `updatedAt`, `totals` | CH1a |
| `cart` (cart spec §3.1a, `TC-CART-LOCK-06`) | `cartService.getSalesSnapshot`: the **exact** adjustment drafts behind `Cart.totals`, metadata (`taxRate`) included, plus `metadata.cartLineId` on every line and the applied codes. `TC-CART-LOCK-06` uses a percentage code with tax. The reference's `cart/lib/toSalesSnapshots.ts` rebuilds the drafts from `CartPromotionApplication` rows without metadata and must change | CH4 |
| `cart` (cart spec §9.1) | Lock contract of §6 (`lockTtlMs`, `purpose`, same-session extend, atomic `extendOnly` answering `409 cart_lock_lost`, `checkoutSessionId` on `unlock`/`markConverted`, `lineMap`); `markConverted` replay for the same session and document returning `alreadyConverted: true` (D-R5-CA12, pending #9999), relied on by paid completion (§7.2); trusted pay-link creation with `salesChannelId` | CH1a, CH3, CH4, CH5a, CH5b |
| `sales` | `salesDocumentLookupService` (§3.3); index `sales_orders (tenant_id, external_reference)` (D-R5-CH1); index `sales_quotes (tenant_id, external_reference)` (D-R5-30); `quoteCreateSchema` gains `externalReference`/`customerReference`; `orderCreateSchema` gains `suppressStaffNotification?: boolean`, and an order created with it sends its `sales.order.created` staff notification at first confirmation instead of at create (D-R5-CH8); the shared line schemas accept snapshot `null`s for order and quote lines; `sales.payments.create` idempotent per `(order, paymentReference)`; `sales.order.cancelled` emitted on every cancellation path, including an undo that re-cancels (#8404, #8406) | CH4, CH5a |
| `promotions` (SPEC-055) | `UseCodeInput.orderId`; the `sales.order.cancelled` subscriber running `revertUsage`/`revertCodeUse` by `orderId`; `revertCodeUse?` optional; delivery promotions authorable | CH2b, CH4 |
| `customer_groups` (customer-groups spec) | `linkCreditReservationToOrder`, the row-locked `reserveCredit`, approval service and events, the new terms | CH6a, CH6b |
| `ecommerce` (SPEC-029) | `resolveForBuyer` with optional store; the store context's default sales channel id; `EcommerceStoreSettings.shipping` optional with `flatRate` and `taxRate` | CH1a, CH2a, CH3 |
| `wms` | `wmsWarehouseLookupService.getPrimaryWarehouseAddress` | CH2a |
| `shared` | `buildTrustedCommandContext` in `lib/commands/trusted-context.ts`, re-exported by `lib/commands` (D-R5-CH7); subscriber and worker container hand-off (`SubscriberContext.container`, `WorkerJobContainer.register`) | CH3, CH4, CH5b |

---

## 17) Implementation Plan

Release 5 order (cross-spec review, final implementation order): B.1 and B.3 in wave 2, B.2 in wave 3, B.4 in wave 4, B.5 in wave 5. The phases are re-landed as one-PR steps from closed PR #8268 (`bdb747c36a`). Each step ports the reference's code for its files together with the review fixes made to them, applies the "port must change" rules stated in this spec, and ships its §16 tests in the same PR. A step starts only when its cross-module prerequisites (§16, "Cross-module requirements") are merged.

| Phase | Steps |
|---|---|
| Phase A changes | CH0a, CH0b |
| B.1 Session and step machine | CH1a, CH1b |
| B.3 Delivery and payment | CH2a, CH2b |
| B.2 Cart-backed links | CH3 |
| B.4 Submit | CH4, CH5a, CH5b |
| B.5 B2B | CH6a, CH6b |

### CH0a — Phase A: fail-closed rate limit
`enforceCheckoutRateLimit` answers `503` under `fail-closed` when no `rateLimiterService` is registered (§3.2 item 1); the #5030 tests assert it; UPGRADE_NOTES entry (§14a row 14).
**Prerequisites:** none. **Gate:** pay-link submit and `/verify-password` answer `503` without a limiter; fail-open routes unchanged; the Phase A suite passes.

### CH0b — Phase A: gateway subscribers (D-R5-CH3)
The four `gateway-payment-*` subscribers rethrow retryable failures and keep `reportGatewayStatusSyncFailure` for `404`/`409` refusals (§3.2 item 2). The session-resume call is added in CH5a.
**Prerequisites:** none. **Gate:** a `5xx` from `updateStatus` is rethrown and redelivered; the terminal `409` is reported and swallowed; the `update-transaction-status` suite runs unchanged.

### CH1a — Session aggregate
`CheckoutSession`, `CheckoutSessionEvent`, their migration, the session status machine, `token_hash`, payload redaction, `checkout.session.create/update/cancel` commands (all imported by `commands/index.ts`), the §10 events, the encryption map **and its backfill migration** (§13, R-1), ACL features and grants (§9.1), the soft-peer helper and `503 checkout_sessions_unavailable` (§3.4).
**Prerequisites:** `cartService.getCheckoutView` (cart); the store context's default sales channel (SPEC-029). **Gate:** status-machine unit tests; the backfill migration test; encryption at rest.

### CH1b — Session routes, C14 minimum, expiry worker
`POST /sessions` from a cart token, `GET`/`PATCH /sessions/current`, `/step`, `/cancel`, admin `GET /sessions` and `/sessions/:id`, with the §9.3 schemas; the §9.0 transport, binding to the live cart, scope `404`s; `runMutationGuards` on every write; optimistic locking; rate limits on `POST /sessions` and `/current` mutations; `expire-checkout-sessions` with `ensureCheckoutSessionSchedules` and the `checkout.register-schedules` upgrade action (§12). `/step` and `/cancel` are new work.
**Prerequisites:** CH0a, CH1a. **Gate:** transition table exhaustively tested; binding and cross-tenant `404`s; schedules present after the upgrade action; Phase A non-regression boot test.

### CH2a — Delivery rate quoting and flat rate
`GET /sessions/current/delivery-options` with the §5.3 inputs (primary-warehouse origin, packages, currency filter, net amounts and `metadata.taxRate`), the 5-minute cache, the flat-rate fallback from store settings and the link's `flat_rate_shipping_*` columns (§4.3, migration), and its rate limit.
**Prerequisites:** CH1b; `wmsWarehouseLookupService` (wms); optional `EcommerceStoreSettings.shipping` (SPEC-029). **Gate:** carrier failure degrades to the flat rate; another-currency rate dropped; no `wms` → flat rates only; `422 delivery_unavailable` without a fallback.

### CH2b — Delivery selection, delivery promotions, payment methods and `/payment`
`POST /delivery` with the snapshot and `quoted_totals` (payable from `salesCalculationService`, D-R5-CH6); the §5.2 invalidation rules; delivery promotion evaluation with identical inputs (§5.4); `GET /payment-methods` for gateway methods; `POST /payment` storing the method and PO number (D-R5-CH2), new work.
**Prerequisites:** CH2a; SPEC-055 delivery promotions un-hidden (D-R5-17). **Gate:** stale-rate invalidation; `quoted_totals` cleared on a cart change; unoffered method → `422`.

### CH3 — Cart-backed links
`CheckoutLinkCartTemplate`, the `checkout.cartTemplate.*` commands and the link `CrudForm` group, currency and gateway-descriptor validation, the link's `sales_channel_id`, `POST /sessions` from a link with trusted seeding and the capacity probe (§4.3).
**Prerequisites:** CH1b; the cart's trusted pay-link path (D-R5-19); `resolveForBuyer` with optional store (D-R5-22); `buildTrustedCommandContext` (shared, D-R5-CH7). **Gate:** a template line without an override prices per buyer; mixed-currency templates rejected through the command; the request body cannot add lines; a tokenless create consumes no slot.

### CH4 — Submit saga I: direct order creation and compensation
The §7.2 steps 0–6 as commands: the pay-link slot reservation, lock, snapshot self-check and `sales`-computed payable, stock reserve, document creation with `sales.orders.create` and the field mapping (D-R5-CH1), the persisted-totals check, commit, code use with `orderId`, usage registration; the §7.3 compensation with `compensating`; the ops notification type (§10.1). Exact decimals; nested commands on the caller's transaction.
**Prerequisites:** CH2b; availability Phase 3 (`reserve`/`release`/`commit`, D-R5-8…10); the cart lock contract and `getSalesSnapshot` with metadata; `salesDocumentLookupService`, both `sales` indexes, the line-schema widening and the quote-create fields; promotions `UseCodeInput.orderId` and the cancellation subscriber; the container hand-off (shared). **Gate:** the percentage-code-with-tax case for every payment method; the full field mapping on the order; no quote notification; an injected failure at each of steps 1–6 compensates completely.

### CH5a — Submit route, replay, return URLs, payment recording
`POST /sessions/current/submit` and `GET /sessions/current/result` with the §9.3 schemas; `Idempotency-Key` replay (§7.4); step 7 (intent, `extendOnly` lock extension, publication, hand-off); the `checkout_disposition` dispatch, the paid-completion claim and the cancel and refund operation contract (§7.2); the return-URL rule; the `checkout_transactions` columns, nullable `link_id` and the link-less `updateStatus` branch (§14a rows 15, 17); the session resume in the gateway subscribers; payment recording with `sales.payments.create`; submit rate limits. `/result` is new work.
**Prerequisites:** CH0b, CH4; `sales.payments.create` idempotent per `(order, paymentReference)`. **Gate:** the B2C happy path end to end with a recorded payment; concurrent double submit creates one order; same-key replay returns the same body; unsafe return URLs refused.

### CH5b — Recovery and repair workers
`recover-stuck-submits` (§12.1, order-level probe), `expire-awaiting-payment`, `repair-gateway-payments`, `repair-order-compensation`, all registered by `ensureCheckoutSessionSchedules`; reads with `findWithDecryption`, errors with `isCrudHttpError` and `reportError`.
**Prerequisites:** CH5a; the container hand-off for workers. **Gate:** a process killed after each step, including right after order creation, is reconciled without a duplicate order and without releasing a live order's holds; a payment-recording failure and a failed cancellation are each repaired; the lost-lock, refund-retry and paid-completion cases of §16 pass, including the crash after conversion with no further callback.

### CH6a — On-account credit, PO number, minimum order, quote requests
`on_account` and `request_quote` in `/payment-methods`; credit reserve, link and release (§8.3); PO required and format checks (§8.4); `min_order_value` (§8.5); the quote branch with `sales.quotes.create` (§8.6).
**Prerequisites:** CH5b; customer-groups Phases 3–4 (row-locked credit service, new terms); the cart's `purpose: 'quote'` (D-R5-23). **Gate:** the N=20 parallel on-account test on real Postgres; the PO number on the order; the quote outcome with a quote `lineMap`.

### CH6b — Approvals
`POST /request-approval`, the four `customer_groups.approval.*` subscribers (§8.2), a new session starting in `awaiting_approval` for a pending cart approval (§8.2 item 4), re-approval on a price rise.
**Prerequisites:** CH6a; the customer-groups approval service and events; the cart approval gate K1–K5. **Gate:** every approval outcome moves the session as §8.2 states; a new session picks up a pending approval; a higher re-priced total refuses with `409 cart_requires_approval`.

### Phase B.6 — Admin viewer and workflows (not Release 5)
Admin session viewer pages with the event trail and the `checkout.sessions.manage` actions; the four seeded workflow definitions of §5.1. The security minimum and the read-only admin routes already shipped in CH1b.

---

## 18) Open Questions

None blocks Release 5. Each item states the assumption Release 5 runs on, or is out of scope.

1. **Guest checkout for on-account** — assumed impossible: purchase on account requires an authenticated `CustomerUser` linked to a company. Confirm no tenant needs a magic-link variant.
2. **Partial fulfilment of non-backorder lines at submit** — narrowed by D-R5-9: backorder-enabled lines already hold what is sellable and admit the rest. What remains open is a split for lines **without** backorder (ship what is available, cancel or defer the rest), which needs its own design.
3. **Saved payment methods** — repeat B2B buyers will want stored instruments. Belongs to `payment_gateways` plus spec 9, not here.
4. **Multi-currency on account** — a credit account is per currency. A buyer checking out in a currency with no account is not offered `on_account` (`no_account`); whether that should fall back to prepayment automatically is a merchandising decision.

---

## 19) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | All references are FK ids; peers reached via DI (`tryResolve`) or `commandBus`; other modules' data read only through their services, never their tables (§3.3, D-R5-CH5) |
| No reimplemented arithmetic | Goods totals come from the cart's exact snapshot; the payable, the shipping charge, its tax and the delivery discount are computed by `sales` (D-R5-CH6); checkout only compares exact decimals (§7.2 steps 2 and 5c) |
| Tenant/organization scoping | Session, cart, link, store, customer and approval agree on every request; recovery and seeding use the stored scope (§13) |
| Optimistic locking | `CheckoutSession.updatedAt` via `enforceCommandOptimisticLockWithGuards`; `open → submitting` CAS; template rows guarded by `CheckoutLink.updatedAt`; event rows append-only (C20) |
| Encryption | Email, phone and both addresses via the `checkout:checkout_session` map in B.1, with the backfill migration for existing tenants (R-1); `findWithDecryption` in routes and workers; payloads redacted (C14) |
| Bearer credentials | Session token only in a header, only its hash at rest (C4) |
| Rate limiting | Public mutation routes rate-limited from the phase that introduces them (C14) |
| Zod validation | All routes; `z.infer` types |
| No `any` | State machine, session and payload contracts fully typed |
| Mutation guards / commands | Every buyer write calls `runMutationGuards` before its command (§9, R-2); session transitions are command-routed and not undoable (D-R5-10); admin template mutations undoable (§11) |
| i18n | Step labels, error codes and validation messages translated |
| Queue usage | All five jobs via the `queue` worker contract, scheduled for new and existing tenants (§12) |
| ACL | Phase A features reused; `checkout.sessions.view` (employee, admin) and `.manage` (admin) new; sync-role-acls documented (D-R5-34) |
| Module dependencies (`requires`) | Unchanged from Phase A. `cart`, `sales`, `availability`, `customer_groups`, `promotions`, `shipping_carriers`, `payment_gateways`, `ecommerce` are soft peers (§3.4, D-R5-18). No `workflows` use in Release 5 |
| Cross-module coupling | Upstream never depends on downstream: promotions and customer groups react to `sales.order.cancelled` themselves; `sales` calls neither (C5, D-R5-2) |
| Events | Every payload carries `tenantId`/`organizationId`; state signals only; approval notifications owned by `customer_groups` (D-R5-32) |
| Backward compatibility | §14a, including the four Phase A rows and the UPGRADE_NOTES entries; Phase A non-regression test |
| Error reporting | Every catch that records an error calls `reportError` (§11, §12) |
| Integration coverage | §16, every new API path, shipping in the same change as each phase |

---

## 20) User Story Map (Prototype Input)

Added 2026-09-16 to support the `om-mockup-prototype` click-through; revised 2026-10-26 for Release 5. Derived from §5.2's step machine, §6's lock protocol, §7's submit sequence, §8's B2B rules and §15's risk register. The actor is a buyer in the funnel unless stated. In Release 5 the "screen" is the integrator's client over the public API; the acceptance criteria are stated against the API response.

### Epic A — Completing a checkout

- **US-A1** — As a buyer, I want to move through contact, addresses, delivery, payment and review, so that I can complete an order without losing what I have already entered.
  - AC: steps the effective configuration does not need are skipped, not shown disabled — a known buyer with one address skips `contact` and `addresses` (§5.2). Every Release 5 cart has a `delivery` step (D-R5-CH4).
  - AC: backward navigation is always allowed before submit.
  - AC: changing an address after selecting delivery invalidates the rate quote and returns the buyer to `delivery` **with the reason stated** (§5.2, R5).
  - AC: the step list is returned by the session, never hard-coded in the client.

- **US-A2** — As a buyer, I want submit to produce either an order or a quote depending on my terms, so that a negotiated purchase does not have to pretend to be a card payment.
  - AC: a gateway or `on_account` method gives `outcome_kind: 'order'`; the `request_quote` method, offered only when `allow_quote_requests` allows it, gives `outcome_kind: 'quote'` immediately with no payment (§8.6).
  - AC: the result names which of the two happened and what comes next; a quote confirmation must not read like an order confirmation.

### Epic B — Being refused, before anything happens

Every refusal names what went wrong and what the buyer can do instead (§9.2).

- **US-B1** — As a buyer, I want submit to abort when the price moved between review and charge, so that I am never charged an amount I did not agree to (R4).
  - AC: the lock's re-price or the submit-time delivery evaluation aborts with `409 price_changed` before any side effect, with the per-line changes, the reasons (`delivery_changed`, `promotion_newly_eligible`) and the new total (§6, §7.2 steps 1 and 2).
- **US-B2** — As a buyer, I want a stock shortfall named per line, so that I can adjust rather than guess (§7.2 step 3).
  - AC: only `shortfall` lines are listed; backorder lines proceed with the held and backordered quantities reported in `/result` (D-R5-9).
- **US-B3** — As a B2B buyer over my credit limit, I want to be told, and offered prepayment or, where my terms allow it, a quote request, so that the checkout is not a dead end (`402 credit_refused`, §8.1).
- **US-B4** — As a buyer holding a line that left my assortment, I want the lock refused with that line named, so that I can remove it (`409 cart_has_unavailable_lines`; [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §6.2, US-F1).
- **US-B5** — As a buyer over the approval threshold, I want `request-approval` offered rather than a bare refusal (`409 cart_requires_approval`, §8.1). As a guest over the threshold, I am asked to sign in (`409 approval_requires_identified_buyer`).

### Epic C — Waiting for an approval

- **US-C1** — As a B2B buyer, I want my cart to stay editable while an approval is pending, so that days of waiting do not strand my basket (§8.2).
  - AC: the session parks in `awaiting_approval`, **the cart is not locked**, and nothing is reserved.
  - AC: the approval survives the session: a new session on the same cart shows it as pending (X6).
  - AC: the decision may come from my company's approver, the merchant, or both, per my group's policy (D-R5-1); notifications come from `customer_groups`.
- **US-C2** — As a B2B buyer whose approved total has since risen, I want approval requested again rather than silently honoured (R8).
  - AC: at submit the lock compares the re-priced total with the approved amount; a higher total answers `409 cart_requires_approval` with both figures. A same or lower total proceeds.

### Epic D — Two tabs, two taps

- **US-D1** — As a buyer with the basket open in a second tab, I want editing it during submit or payment to send me back to checkout (§6, R6, R11).
  - AC: a locked cart rejects mutation with `423 cart_locked` **and the session id**; the lock holds for the whole payment.
- **US-D2** — As a buyer who double-tapped submit, I want the second attempt refused rather than queued (R2).
  - AC: a repeat in flight returns `409 submit_in_progress`; a repeat after success returns the original result including `sales_order_id`; a new key after failure starts a fresh attempt (§7.4).

### Epic E — Operating a checkout that went wrong

- **US-E1** — As a support agent, I want a read-only session list and detail with the full event trail (§4.2, §9). **B.6** (viewer); the ACL features ship in B.1.
  - AC: the trail is append-only and redacted at write time, and the screen says so (§13).
  - AC: force re-price and force-expire are command-routed admin mutations, gated on `checkout.sessions.manage` separately from `checkout.sessions.view` (§9.1).
- **US-E2** — As an operator, I want a failed compensation surfaced rather than logged (R9).
  - AC: a `failure` event, `checkout.compensation.failed`, the `checkout.session.attentionRequired` notification (§10.1) and a retry by `repair-order-compensation` — never swallowed.

### Cross-cutting rules

- No refusal is a bare status code: each names what happened and what the buyer can do next.
- Nothing is reserved before it is needed. Before the order exists, everything taken is released in reverse order; after it exists, the order is cancelled and its cancellation releases the rest (§7.3).
- Server-decided sets — the step list, the payment methods, the available outcomes — are returned by the session, never hard-coded in the client.

### Risks without a screen

**R1** (payment without an order), **R3** (leaked reservation), **R7** (credit overshoot), **R10** (rate-quote abuse), **R12** (duplicate document) and **R13** (codes and budgets) have no buyer-facing or admin-facing state of their own. They are mitigated by the conditional status update, the idempotency keys and `external_reference`, the credit row lock, the pre-payment usage registration and rate limiting — mechanisms, not screens.

---

## 21) Changelog

### 2026-11-20 — v2.4.1 (recovery never fresh-locks; payment results decided by the intent's disposition)

Applies SPEC-029 decision D-R5-SF4 (owner, 2026-11-19): no recovery path takes a fresh cart lock. Rebased onto v2.4 (#9998, D-R5-CH1: the order is created directly with `sales.orders.create`), so this copy and #9998's agree on the document path. Review of #10000 (@haxiorz, @pkarw), 2026-11-20.

- §3.3, §6 `routeContext`, §12.1 and R14: recovery no longer builds a cart context through `resolveForBuyer`. It only unlocks, extends or converts a cart its session still holds.
- §6, §7.2 step 7, §7.3, §9.2, §12.1, R22: step 7 is split into intent (7a), `extendOnly` extend (7b) and publication (7c). `awaiting_payment` is set only after a successful extend, on the submit path and in recovery. A `409 cart_lock_lost` after the intent reads the gateway status, then cancels, voids or refunds the intent before the order is cancelled.
- §4.4, §7.2, §12, §12.1, R23: payment results are decided by the intent's `CheckoutTransaction.checkout_disposition` (`setup | published | completing | completed | compensating | compensated`), changed only by a conditional update, never by the session status. A success while `setup` is deferred; a replay for a `completing` or `completed` intent is acknowledged and never refunded; only `compensating` and `compensated` refund.
- §4.1, §4.4, §7.2 "Paid completion", §12, §12.1, R24: paid completion has one owner. The `published → completing` CAS takes a claim token and a 120 s lease. Confirm and conversion are checkpointed (`order_confirmed`, `cart_converted`). `recover-stuck-submits` takes over an expired lease with no callback needed. The repeated `markConverted` is the cart's same-session replay (`alreadyConverted: true`, cart D-R5-CA12). Intent and session become `completed` in one transaction. Supersedes the v2.4 "claim the `awaiting_payment` session (a CAS on `status`)".
- §7.2 "Cancel and refund operation contract", §12 `repair-order-compensation`: every reversal of an intent sends one fixed request (`amount` omitted, `reason: 'checkout:compensation'`, `operationId` `checkout:<transactionId>:refund|cancel`). `payment_operation_in_progress` is never taken as settled: the disposition stays `compensating` and the repair worker re-sends until a result returns. Any other `409` (a replay after the status moved, or an action the status no longer allows) is settled by reading the gateway status. `payment_operation_conflict` is a defect and is never retried under another id. A paid result reopens a `compensated` intent (`compensated → compensating`) unless it is already refunded or cancelled, so its refund has a retry owner. §7.3 runs whatever the reversal's outcome; the disposition becomes `compensated` only when both are done.
- §16: lost lock at `finalized` and after the intent; refund overlap and sequence against the real operation-idempotency layer; replay after completion; concurrent first delivery; callback before publication; a duplicate before the first completion handler finishes; a crash after conversion and before the final session write.
- Supersedes the v2.3 line "recovery builds it through `resolveForBuyer` (D-R5-22, X15)".
- Merge order: #9988, then #9998, then this PR (its checkout diff then shrinks to the lines above), then #9999 (cart D-R5-CA12, which this version relies on).

### 2026-11-19 — v2.4 (Re-landing audit — remediation of `.ai/analysis/pre-implement-2026-03-19-checkout-simple-checkout-release-5.md`)

Remediation of the pre-implementation audit of the re-land from closed PR #8268 (verdict no-go: 6 Critical, 19 Important). Verified against `main` and the reference `bdb747c36a`.

- **Header, TLDR, §3.** The order outcome is created directly; peer reads go through services. §3.2 lists the three Phase A changes (fail-closed `503`, gateway subscribers, link-less transactions). §3.3 names `sales.orders.create`, `sales.payments.create`, the optional `revertCodeUse?`, `wms` as a soft peer, and a table of the peer read methods, new ones marked. §3.4 adds `wms`.
- **§4.** Binding reads the live cart's `customer_user_id`. `quoted_totals` lifecycle stated. `submit_progress` gains `compensating`. Template money uses `ExactDecimalType`. Link capacity: probe at seeding, atomic slot at submit, single release. Link columns `sales_channel_id` and `flat_rate_shipping_*`. `CheckoutTransaction` gains the payment-recording columns and the repair index; `link_id` becomes nullable.
- **§5.** `delivery` is never skipped (digital-only carts deferred). `/step` validation rules. Rate origin from the primary `wms` warehouse; other-currency rates dropped; rates are net, taxed by `sales` through `metadata.taxRate`; the store `shipping` setting is optional. `/payment` stores the method and the PO number; submit re-validates them.
- **§7.** New precondition for the sales channel; stored method and PO re-validated; exact decimals. §7.2 rewritten: snapshot self-check against `Cart.totals` before any document; payable computed by `sales`; the order created with `sales.orders.create`, idempotent on its own `external_reference`; persisted-totals check for every payment method; a session/cart → document field mapping; `lineMap` from the order lines; how a gateway result resumes the session; payment recording on the order; `availability.reserve` receives `storeId: cart.storeId` (null for a store-less cart) so store-level policies apply at submit (Availability D-R5-AV6, review of #9998). §7.3: cancellation with `compensating` and `repair-order-compensation`; no `revertCodeUse` call.
- **§8.** PO number written by `sales.orders.create`; credit reserved for the `sales`-computed payable; a new session picks up a pending approval; the quote branch is the only `sales.quotes.create` use.
- **§9.** Mutation guards on every buyer write; the optimistic-lock header named; binding to the live cart; route phases and the four routes that are new work; read-only admin routes in CH1b; §9.1 grants match `setup.ts`; new error codes; new §9.3 request/response schemas, payment hand-off and return-URL rule.
- **§10–§13.** Event declarations and payloads fixed; new §10.1 ops notification. §11: command registration, real containers, `reportError`, `isCrudHttpError`. §12: five jobs, schedules for existing tenants through one helper and an upgrade action; recovery probes the order first and never releases a live order's holds. §13: encryption backfill migration, fail-closed `503`, trusted-context import path.
- **§14, §14a.** New §14.3 withdrawals. §14a rewritten: 25 rows including the `sales` changes, the `sales_orders` index, the four Phase A rows, the notification type and DI key; upgrade steps now include the backfill, the schedule upgrade action, the rate limiter and the origin.
- **§15–§20.** Risks R18–R21; R1, R12, R16 updated. §16 adds the G1–G4 cases, the percentage-code-with-tax case, the field mapping, return URLs, mutation guards, schedules, real-Postgres suites in CI, and a cross-module requirements table. §17 re-cut into steps CH0a–CH6b with prerequisites and gates. §18–§20 aligned.

#### Owner decisions (2026-11-19)

- **D-R5-CH1** — The order outcome is created directly with `sales.orders.create` (status `draft`, `externalReference`, `customerReference`, `channelId`, method fields, `customerSnapshot`), idempotent on a new `sales_orders (tenant_id, external_reference)` index; `sales.quotes.create` only for `request_quote`; `lineMap` from order-line `metadata.cartLineId`. Findings: Blockers 1–2, G1, G2, R6, C17, #9390, #8413. Owner, 2026-11-19.
- **D-R5-CH2** — Payment method and PO number are selected by `POST /sessions/current/payment` and stored on the session; submit re-validates them; `/step`, `/cancel` and `/result` stay as specified. Finding: D2, S5, S6. Owner, 2026-11-19.
- **D-R5-CH3** — The four Phase A `gateway-payment-*` subscribers rethrow retryable failures and keep `reportGatewayStatusSyncFailure` for the swallowed terminal-`409` branch; a Phase A change approved under Ask First. Finding: D3, S23, BC 8, R-3. Owner, 2026-11-19.
- **D-R5-CH4** — Digital-only carts are not in Release 5: submit requires a shipping method and address. Finding: D4, S15. Owner, 2026-11-19.
- **D-R5-CH5** — Checkout reads other modules' data through their services (`cartService` reads; a `sales` status-entry resolver and order-by-reference lookup), never with raw queries on their tables. Finding: D5, S19. Owner, 2026-11-19.
- **D-R5-CH6** — The payable amount for the D-R5-24 credit reservation and the C7 totals guard is computed by `sales` (`salesCalculationService.calculateDocumentTotals` with the shipping line and the delivery-discount adjustment), not by checkout. Finding: roadmap audit, ADR-2; G3. Owner, 2026-11-19.
- **D-R5-CH7** — The trusted-context helper is imported from `@open-mercato/shared/lib/commands/trusted-context` (`trusted-context.ts`), with the barrel `@open-mercato/shared/lib/commands` as a second entry point. Finding: R6 (6), S22. Owner, 2026-11-19.
- **D-R5-CH8** — `sales.orders.create` gains the additive optional input `suppressStaffNotification?: boolean`, which checkout sets on every order outcome. Such an order is not announced at create; `sales` sends the `sales.order.created` staff notification when the order is first confirmed (paid, or finalized for `on_account`). Owner, 2026-11-19.
- **D-R5-CH9** — Names approved: the status entry `draft` for new checkout orders and quotes, `422 sales_channel_unresolved`, the link column `sales_channel_id`, the store setting `settings.shipping.taxRate` and the notification `checkout.session.attentionRequired`. Owner, 2026-11-19.

### 2026-10-26 — v2.3 (Release 5 spec revision)

Revised for eComm Release 5 (Phases B.1–B.5; B.6 out except its security minimum) from the pre-implementation analysis (C1–C26), the owner decisions D-R5-1…36 and the cross-spec review (X1–X20). Phase A pay links are unchanged. Numbered v2.3 because the 2026-09-16 revision already used v2.2.

- **Header, TLDR, §3.** Release 5 notice. §3.3 names the DI keys `customerCreditService`, `customerPurchaseApprovalService`, `storeContextService.resolveForBuyer`, and the promotions calls. New §3.4: every peer is soft (`tryResolve`), and the session routes answer `503 checkout_sessions_unavailable` without `cart` (D-R5-18, C10).
- **§4.**
  - `token` → `token_hash` (C4).
  - `approval_id` and `workflow_instance_id` removed (D-R5-3, X6, C11).
  - Added `quoted_totals`, `payment_expires_at`, `submit_attempt`, `submit_progress` and `submit_started_at` for the totals check, the lock extension and recovery.
  - Template rows guarded by `CheckoutLink.updatedAt` (C20).
  - Pay-link cart seeding through `buildTrustedCommandContext` and `resolveForBuyer` without a store (D-R5-19, D-R5-22).
  - `CheckoutTransaction` columns stated.
- **§5.** No workflow in Release 5; the approval belongs to `customer_groups`. New §5.3 rate inputs and the flat-rate fallback from store or link settings (C13, D-R5-35); §5.4 delivery promotions (D-R5-17); §5.5 payment methods, including `request_quote` (D-R5-20).
- **§6 lock protocol.**
  - The lock is held through payment and extended under the same session id (C1).
  - `unlock`/`markConverted` require the session id.
  - A fresh route context is required for storefront carts (C2); recovery builds it through `resolveForBuyer` (D-R5-22, X15).
  - `purpose: 'quote'` (D-R5-23).
- **§7 submit, rewritten to the C19 sequence.**
  - Store, channel and currency consistency; the store is compared only when the cart has one (C9, X13).
  - Delivery re-evaluation after the lock (D-R5-17).
  - Per-line stock outcomes; abort only on shortfall (D-R5-9).
  - Credit reserved for the full payable amount (D-R5-24).
  - Idempotent document creation via `external_reference` (C3, D-R5-30), in a non-confirmed status (C17).
  - Goods and payable equality, with `500 totals_mismatch` (C7, D-R5-24).
  - Commit right after document creation (D-R5-8).
  - `linkCreditReservationToOrder` (C6).
  - `useCode` + `registerUsage` before payment (C5, D-R4-26).
  - `markConverted` with `salesOrderId`/`lineMap`, or `salesQuoteId` and a quote `lineMap` (D-R5-16, D-R5-26, C18).
  - The compensation table makes "cancel order" the single compensation after the order exists. Reversal of promotions is promotions-owned, and the earlier "`sales` calls `revertUsage`" is withdrawn.
- **§8 B2B.**
  - The approver can be on either side, per group (D-R5-1).
  - The cart is the subject, with no session approval id (D-R5-3).
  - The resume is event-driven and the approval outlives the session (C11, X6).
  - Credit wording: row lock instead of serializable (C23); settlement through `/adjust` or `settleCredit` (D-R5-2).
  - `requires_po_number` (D-R5-28); `min_order_value` in `terms_currency_code` (D-R5-4).
  - Quote branch with `allow_quote_requests` (D-R5-20, D-R5-23, C16).
  - Refusal wording per D-R5-20 (X12).
- **§9.**
  - New §9.0 buyer auth and transport: `/sessions/current/*` with `X-Checkout-Session-Token`, one live session per cart, and the identified-session binding on every route (C4, C12, D-R5-21, D-R5-33).
  - Route table with phases.
  - §9.1 grants (D-R5-34, C25).
  - New §9.2 error-code catalogue.
- **§10–§13.**
  - Event payload table with scope and no PII (C22, D-R5-32).
  - Session commands are not undoable (D-R5-10).
  - Recovery decision table §12.1 (C24).
  - Security minimum moved into B.1/B.3/B.4 (C14).
- **§14, §14a.** v2.1 withdrawals listed. New Migration & BC section listing every additive contract, the Phase A non-regression test and the upgrade steps.
- **§15–§21.**
  - Risks R11–R17 added.
  - Integration coverage for every new API path, the binding 404s and the C26 cases.
  - Plan re-cut with cross-module dependencies.
  - OQ2 narrowed (D-R5-9).
  - Compliance and user stories updated.

### 2026-09-16 — user story map

- **§20 user story map added.** The spec described a step machine, a submit sequence and a risk register but never stated who wanted what, so a prototype had to infer the flow from a numbered procedure. Five epics derived from §5.2, §6, §7, §8 and §15; no new scope. The four risks with no screen of their own are named as such rather than left to look missing. The changelog moves from §20 to §21.

### 2026-10-12 — tax providers (pointer, no version change)

Two sentences in §5.2: when a tax provider is configured, tax can depend on the shipping address as well; under the default state `product-rate` nothing changes. That the lock's re-price (§6) computes the confirmed figure with that address, and whether the funnel shows a tax estimate at the address step, are proposed to the owners of this spec in the tax-providers roadmap (`2026-10-03-tax-providers-roadmap.md`, in review as #6918; its amendment 6a and §14 Q16) and are not decided here; how the address reaches the lock is for a later pointer, after the lock amendment (#7212, whose lock input carries no address) merges.

### 2026-10-11 — availability entry points

- **§3.3, §4.1 and §7.2 call the real availability commands.** The `availabilityService` DI contract does not exist: the availability spec replaced it with the `availability.reserve` / `.release` / `.commit` commands (§4.1 and §15 of [Availability Contract](./2026-08-14-availability-contract.md)). The integration table, the `stock_reservation_key` note and the submit sequence now name those commands and pass the input object `reserve`/`commit` define. §7.2 also stated that `availability.commit` runs before the order reaches a status emitting `sales.order.confirmed`, with the Availability Contract §4.4 conflict rule otherwise. *(Superseded 2026-10-26 by D-R5-8: commit right after document creation, and the order is created non-confirmed.)* Recorded from the post-merge review of #5384.

### 2026-09-16 — v2.2 (workflow boundary restated)

Rewrote §5 and §5.1 after re-reading the engine as it actually stands on `develop` following PR #5718 (merged 2026-09-15). The decision is unchanged — the funnel stays a state machine — but the previous justification had aged and under-specified the part it decided in favour of `workflows`.

- **§5 — the criterion is now the character of the failure, not latency.** The engine's documented defect stalls an instance; a stall is an inconvenience where a human is already waiting and a loss where money is. Latency, testability, data protection and anonymous buyers are stated as supporting reasons in descending weight rather than as the argument itself.
- **§5 — two reasons stated for the first time.** The workflow event log is immutable by module contract while `CheckoutSessionEvent` is redacted at write time, so driving the funnel through the engine would put buyer PII somewhere a right-to-erasure request cannot reach it. And a `USER_TASK` needs `assignedTo`/`assignedToRoles`, which a guest buyer does not have — a task-shaped funnel cannot serve guest checkout at all.
- **§5 — reconciled with PR #5718.** `WAIT_FOR_CONDITION` plus the scoped instance-context write removes signal correlation as a precondition; portal user tasks close the approver-identity gap; `workflowDefinitionAuthoring` is how the definitions ship.
- **§5.1 — two uses became four**: post-submit orchestration, the B2B approval sub-flow, abandoned-checkout recovery and failed-compensation escalation. *(2026-10-26: all four moved to B.6; the approval sub-flow became escalation only.)*
- **§4.1** gained `workflow_instance_id`. *(Removed 2026-10-26, never implemented.)*

### 2026-08-21 — merged with `main`

Reconciled with `main`'s `checkout.transaction.updateStatus` hardening (PR #4814, merged 2026-08-04): a strict transition state machine (`VALID_CHECKOUT_TRANSITIONS`) plus an atomic compare-and-swap via `tx.nativeUpdate`, closing a race between the submit route and the gateway webhook. Noted in §11 as the precedent the new `CheckoutSession.status` CAS guard (§7.4) follows.

### 2026-08-17 — v2.1 (pre-implementation fixes)

Fixed the findings of a `/om-pre-implement-spec` audit (`ANALYSIS-2026-03-19-checkout-simple-checkout.md`), run against the already-shipped Phase A source:

- **Critical**: `CheckoutSession.version: integer` removed; `updatedAt` is the sole concurrency token, matching Phase A's `enforceCommandOptimisticLockWithGuards`.
- **Critical**: §9.1 fabricated `checkout.links.view`/`checkout.links.manage`; link/template routes reuse the real Phase A features, and only `checkout.sessions.view`/`.manage` are new.
- Added `promotions` and `workflows` to §3.3. *(2026-10-26: `promotions` is a soft peer, no workflow in Release 5.)*
- §11: session transitions are registered, non-undoable commands.
- §7.2: two sequential `commandBus.execute()` calls do not share one DB transaction; the orphaned-quote case added to §7.3.
- §4.4: `CheckoutTransaction.quote_id`/`.order_id` are new, additive.
- §10: `checkout.payment.*` fires alongside Phase A's `checkout.transaction.*` events.
- §13/§19: the `checkout/encryption.ts` addition named.

### 2026-08-14 — v2 (rescope)

- Rescoped from "simple checkout for pay links" to **the unified checkout funnel for every channel**, per ADR-3. SPEC-029 §19's competing workflow-driven session is withdrawn in that document.
- Withdrew `CheckoutCartItem` in favour of `CheckoutLinkCartTemplate` seeding a real `Cart` (§14). Added `unit_price_override`.
- Introduced `CheckoutSession` holding `cart_id` rather than lines, and `CheckoutSessionEvent` as a purpose-shaped, redacted audit trail.
- Decided the step machine question: fixed state machine for the synchronous funnel, `workflows` for asynchronous post-conversion processes (§5).
- Specified the submit sequence with ordered, idempotent compensation, a conditional-transition concurrency guard and a crash-recovery job (§7, §12).
- Added the cart lock protocol with a mandatory re-price and abort-on-change (§6).
- Added B2B at submit: order-vs-quote branch, credit reservation held until settlement, approval gating with re-approval on price increase, PO capture (§8).
- Retained from v1: the quote→order path via `commandBus`, currency rules for links, undoable admin mutations, UMES traceability widget, and the entire Phase A pay-link flow.

### 2026-03-19 — v1

- Initial Phase B specification: `CheckoutCartItem`, product/service selection from catalog or freeform, one-page checkout, quote creation on submit and order creation on payment, `salesCalculationService` integration, UMES extension points, four-phase plan. *(Cart ownership and the funnel shape superseded by v2; the sales integration approach carried forward.)*
