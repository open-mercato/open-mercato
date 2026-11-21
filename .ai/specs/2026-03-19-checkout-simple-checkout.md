# Checkout Module — Unified Checkout Funnel

| Field | Value |
|-------|-------|
| **Status** | Specification (v2.4.8 — reconciled with #9691 (per-attempt replay record, atomic promotion step, gateway activation gate, link-backed transaction routes and events), settlement by terminal provider status, order id kept with the first compensation checkpoint 2026-11-21; v2.4.7 — attempt-scoped cart locks and permanent document-key retirement 2026-11-20; v2.4.6 — durable cancellation event, per-attempt document creation key and reopen fence, payment session identity committed before the provider call 2026-11-20; v2.4.5 — stalled compensation resumed by recovery, paid-completion checkpoints written in the gateway session state 2026-11-20; v2.4.4 — fenced confirm and cancel transitions, confirmation boundary, conversion pending, a durable payment operation-key ledger, merge gate with #9998 2026-11-20; v2.4.3 — opt-in Sales payment operation key, terminal events acknowledged by persistent-queue acceptance, pay-link slot ownership and on-account recovery 2026-11-20; v2.4.2 — write-boundary fencing, durable terminal events, one settlement predicate 2026-11-20; v2.4.1 — recovery never fresh-locks, payment results decided by the intent's disposition 2026-11-20; v2.4 — Release 5 re-landing remediation 2026-11-19 on top of the v2.3 revision of 2026-10-26; Phases B.1–B.5 in eComm Release 5, re-landed as steps CH0a–CH6b (§17); B.6 out except the security minimum moved into B.1/B.3) |
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
  5. create the order directly with `sales.orders.create` (or, for `request_quote`, the quote), once per attempt under the opt-in `creationKey` that `sales` enforces, and check its persisted totals (D-R5-CH1);
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
| → `promotions` | DI `promotionsService`: `evaluate` with delivery context (D-R5-17), `useCode` with the `orderId` (`UseCodeInput.orderId`), `registerUsage` before payment (C5, D-R4-26). Consumption and budget registration commit in one fenced transaction at step 6c (§7.5). Checkout calls no reversal itself. Reversal after cancellation is **promotions-owned**: a promotions subscriber on `sales.order.cancelled` runs `revertUsage({ orderId })` and `revertCodeUse({ orderId })` idempotently (SPEC-055 amendment, C5). Because `useCode` already carries the `orderId`, that subscriber covers every use checkout consumed. `revertCodeUse?` is an optional member of the service; a caller that needs it checks for it and fails closed when it is absent. Checkout calls neither `useCode` nor `registerUsage` on quote creation; a discounted quote-to-order conversion has its own sales-owned integration gate (§8.6). `sales` never calls promotions. |
| → `shipping_carriers` | DI `shippingCarrierService.calculateRates` (§5.3); selected method snapshotted onto the session |
| → `wms` | Soft. The primary warehouse's address as the delivery origin (§5.3), through a new `wms` read method (below). Carrier quoting is gated on that method's availability, never on `wmsReservationService`. |
| → `payment_gateways` | `paymentGatewayService.createPaymentSession`, `getPaymentStatus`, and in lost-lock reconciliation `cancelPayment`/`refundPayment` with their existing optional `operationId` (§7.2). The existing surface, unchanged |
| → `sales` | `commandBus`: `sales.orders.create` for the order outcome (D-R5-CH1), with `suppressStaffNotification: true` (D-R5-CH8), `sales.quotes.create` for the `request_quote` outcome only, both with `creationKey = documentRef`, `sales.documents.retire_creation_key` before recovery or compensation releases an attempt without an order (§7.2, document creation key), `sales.orders.update` (status `confirmed` at completion, `canceled` in compensation, always fenced, the cancel with its durable event, §7.3), `sales.payments.create` for a captured or authorised gateway payment (§7.2 step 7). Reads through the `sales` lookup service listed below (D-R5-CH5). |
| ← `sales` | UMES widget: "Created from checkout" badge when `metadata.sourceModule = 'checkout'` |
| → `workflows` | **None in Release 5.** The four post-conversion definitions of §5.1 are B.6. Checkout emits its events (§10) either way, so a later definition subscribes without a checkout change. |

**Peer reads go through services (D-R5-CH5).** Checkout never queries another module's tables, with an ORM or with Kysely. It reads through the services below. The ones marked *new* are cross-module requirements on the owning spec (§16, "Cross-module requirements").

| Service | Method | Returns | Used by |
|---|---|---|---|
| `cartService` (*new reads*, cart spec) | `getCheckoutView({ cartId, tenantId, organizationId })` | status, lock holder (`checkoutSessionId` and its `checkoutAttempt`, §6), `channel`, `storeId`, `salesChannelId`, `currencyCode`, `locale`, `customerId`, `customerUserId`, the company id, `approvalId`, `updatedAt`, `totals` (the `Cart.totals` keys as decimal strings) | session create, every `/current/*` binding check (§9.0), submit preconditions, recovery |
| `cartService` (*new reads*, cart spec) | `getSalesSnapshot({ cartId, tenantId, organizationId, checkoutSessionId })` | the exact `SalesLineSnapshot[]` and `SalesAdjustmentDraft[]` behind `Cart.totals`, metadata included (`metadata.taxRate` on every discount draft, `metadata.cartLineId` on every line incl. gift lines), plus `appliedCodes: { codeId, codeString, promotionId }[]` | §7.2 steps 2 and 5, step 6c |
| `salesDocumentLookupService` (*new*, `sales`) | `resolveOrderStatusEntryId({ tenantId, organizationId, value })` | the `sales.order_status` dictionary entry id for `draft`, `confirmed` or `canceled`, or null. Wraps `sales/lib/statusHelpers.ts` `resolveStatusEntryIdByValue` | §7.2 steps 5 and 7, §7.3 |
| `salesDocumentLookupService` (*new*, `sales`) | `findOrderByExternalReference({ tenantId, organizationId, externalReference })` / `findQuoteByExternalReference(…)` | `{ id, number, statusValue, totals, lines: { id, cartLineId }[] }` or null; `totals` are the persisted document's total keys as decimal strings; `cartLineId` is read from each line's `metadata.cartLineId` | Staff and support reads by reference; checkout never decides on them |
| `salesDocumentLookupService` (*new*, `sales`) | `findDocumentByCreationKey({ tenantId, organizationId, creationKey })` | `{ documentKind, state: 'created' \| 'removed' \| 'retired', document: <the shape above> \| null }` or null, read from the `sales_document_creation_keys` ledger (§7.2, document creation key) | §7.2 step 5 (shortcut read, totals check, `lineMap`), §12.1 |
| `salesDocumentLookupService` (*new*, `sales`) | `findPaymentByOperationKey({ tenantId, organizationId, orderId, operationKey })` | `{ paymentId, state: 'live' \| 'removed' }` or null, read from the operation-key ledger `sales_payment_operation_keys`, which outlives the payment row: `removed` means a payment was recorded under the key and later undone or deleted, and the key stays retired (§7.2, payment operation key) | §7.2 step 7 payment recording, `repair-gateway-payments` |
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
| `submit_progress` | text, nullable | Last completed submit step: `locked \| stock_reserved \| credit_reserved \| document_created \| finalized \| payment_initiated`, then the completion checkpoints `order_confirmed \| cart_converted`, written by paid completion (§7.2) and by the on-account step 8 (§7.2 step 8), `compensating` while an order cancellation has not yet succeeded (§7.3), and `compensated` once it has and the §7.3 releases are done, written with the session's `failed` status (§7.3, checkpoint writes); `reopening` while recovery or a compensation without an order returns an attempt to `open` (§12.1, reopen claim). A `completed` session left at `order_confirmed` is a **pending conversion**: the order is confirmed and the cart is not yet converted (§7.3, conversion pending). Every write is conditional on the attempt, an eligible status and the expected prior checkpoint (§7.3, checkpoint writes). Paid completion writes its checkpoints while the session is still `awaiting_payment`, together with its claim token on the transaction (§7.2, fencing at the write boundary). Read by recovery (§12.1) and `repair-order-compensation` (§12) |
| `link_slot_attempt` | integer, nullable | Pay-link sessions only. The `submit_attempt` that holds one of the link's `maxCompletions` slots. Set in the same transaction as the link's conditional `completion_count` increment (§7.2 step 0) and cleared in the same transaction as the matching decrement (§4.3), so the slot's owner survives any crash. Null when the session holds no slot. Stays set on a `completed` session: the slot is consumed |
| `submit_started_at` | timestamptz, nullable | Start of the current attempt; recovery threshold |
| `outcome_kind` | text, nullable | `order \| quote` |
| `sales_order_id` / `sales_quote_id` | uuid, nullable | |
| `terms_accepted_at` | timestamptz, nullable | |
| `consent_flags` | jsonb, nullable | Marketing consent, passed to promotions |
| `failure_code` / `failure_detail` | text, nullable | `failure_code` from the §9.2 catalogue; `failure_detail` never holds PII. On a `completed` session only `cart_conversion_lost` is ever set (§7.3, conversion pending). On a session at `compensating` that is not yet `failed`, `failure_code` holds the failure being compensated: it is written with the `compensating` checkpoint, so whoever finishes the compensation fails the session with the same code (§7.3, stalled compensation). It is not an outcome until the session is `failed` |
| `expires_at` | timestamptz | |
| `completed_at` | timestamptz, nullable | |
| `pending_events` | jsonb, nullable | The delivery work of a terminal write: an ordered array of `{ eventId, payload }`, written in the same transaction that makes the session `completed` or `failed`. Each entry is removed only after the persistent event queue has accepted it (§10, "Terminal events"). Payloads are the §10 payloads: ids and statuses only, never PII. Null when nothing is owed |

Indexes: unique `token_hash`; `(tenant_id, status, expires_at)`; partial unique `(tenant_id, organization_id, cart_id)` over `open`, `awaiting_approval`, `submitting` and `awaiting_payment` for the one-live-session-per-cart rule (§9.0); `(tenant_id, cart_id, status)` for the `cart_already_ordered` guard (§7.3, conversion pending) and the approval subscriber (§8.2); partial `(tenant_id, updated_at) WHERE pending_events IS NOT NULL` for the terminal-event sweep (§12). There is no session-level unique index on `submit_idempotency_key`: each key is recorded on its own attempt row (§4.5).

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
1. The Phase A link checks pass first: active, not expired, the password access cookie (`readCheckoutAccessCookie`) where the link has a password, and a **capacity probe**: a link whose `maxCompletions` is already reached is refused. The probe reserves nothing, so a tokenless `POST /sessions` cannot use up a link. The slot itself is reserved atomically at submit (§7.2 step 0): a conditional increment of `checkout_links.completion_count` that fails when the limit is reached, committed in one transaction with `checkout_sessions.link_slot_attempt = attempt`. It is released exactly once, by one conditional write: `UPDATE checkout_sessions SET link_slot_attempt = NULL WHERE id = :sessionId AND link_slot_attempt = :attempt`, with the link's decrement in the same transaction only when that update matched a row. The release runs in the same transaction as every status write that ends the attempt without completing it: back to `open` (recovery, §12.1), or to `failed`, `canceled` or `expired`. It depends only on the session row, never on whether the session still holds the cart lock. A second release finds `link_slot_attempt` already null and does nothing. A buyer who returns to the same link with the session token resumes that session instead of seeding a new cart.
2. Checkout builds a context with `buildTrustedCommandContext({ tenantId: link.tenantId, organizationId: link.organizationId, actorType: 'system', reason: 'checkout.link.seed:' + link.id })` from `@open-mercato/shared/lib/commands/trusted-context` (D-R5-CH7). The scope comes only from the link row, never from request input, and the audit entry is marked system-initiated.
3. Buyer identity: when a customer session is present (`getCustomerAuthFromRequest`) and its tenant and organization equal the link's, checkout resolves `storeContextService.resolveForBuyer({ tenantId, organizationId, customerUserId })` with **no store**. It passes the resulting identity (`customerId`, `customerIds` with the company, `customerGroupIds`, `priceKindId`) and the link's `sales_channel_id` to `cart.create` (channel `pay_link`), so template lines without an override price at the buyer's own rate and credit, approval and terms resolve to the company. The cart is a **guest cart** in every other case (SPEC-029 §6.3): no customer session, or one outside the link's scope; `storeContextService` not registered; a service without `resolveForBuyer`; or a refusal (`StorefrontResolutionError`, logged as a warning with the link id). A guest cart stores no `customerId`, `customerUserId`, company, `customerGroupIds` or buyer `priceKindId`. Its template lines without an override price at the link's own channel price, the price a buyer with no session already gets. The buyer can still pay the link.
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

`checkout_disposition` changes only by a conditional update (`WHERE id = :transactionId AND checkout_disposition = :expected`, plus the claim token and an expired lease when a `completing` claim is taken over), in the same database transaction as the matching session write when there is one. Exactly one caller wins each transition; the loser re-reads the row and follows the state the winner left. Allowed transitions: `setup → published` (7c), `setup → compensating` (lost lock after the intent), `published → completing` (a paid result claims completion), `completing → completing` (takeover of an expired lease, new token), `completing → completed` (final completion write), `published → compensating` (payment failure or expiry), `compensating → compensated` (only when the **settlement predicate** holds: the intent's reversal is settled by a terminal provider status (`refunded`, `partially_refunded` after this intent's refund, `cancelled`, `failed` or `expired`) or needed no gateway call, under the operation contract of §7.2, never by a recorded result whose status is still `pending`, **and** the session's §7.3 compensation is done (`submit_progress = compensated`); every path that compensates an intent applies this one predicate), `compensated → compensating` (a paid result arrives for an intent that is not already refunded or cancelled, §7.2). `completed` is terminal; `compensated` is terminal unless such a result reopens it.

Partial index `(tenant_id, organization_id, payment_repair_attempted_at nulls first, updated_at, id) where payment_recorded_at is null and status = 'completed' and session_id is not null and order_id is not null`, so the repair sweep reads only outstanding rows.

A session-backed gateway payment creates one `CheckoutTransaction` per attempt at §7.2 step 7a.i, committed before any provider call, with `session_id` and `order_id` set, `link_id` null, `idempotency_key = 'checkout:' + sessionId + ':' + attempt + ':payment-session'` and `checkout_disposition = 'setup'`. Every session transaction is linkless, including one for a session seeded from a link: the link's capacity is held by the session's slot (§4.3), never by the transaction. Its id is the `paymentId` of every `createPaymentSession` call for the attempt (§7.2, payment session identity). Unique index `(tenant_id, order_id) WHERE session_id IS NOT NULL`: the order is per attempt, so this is one row per attempt, and a second inserter of the same attempt reuses the first row. The shipped scoped idempotency guarantee for link-bound rows, `(organization_id, tenant_id, link_id, idempotency_key)`, becomes a partial unique index `WHERE link_id IS NOT NULL`, and session rows get the scoped unique `(organization_id, tenant_id, session_id, idempotency_key) WHERE session_id IS NOT NULL`. Phase A rows keep `session_id`, `quote_id`, `order_id` and the disposition columns null and always carry a `link_id`. Link lookup, counter updates and legacy event production stay on the link-backed path; a null link requires a scoped checkout session and order instead, with the same transition validation and status CAS (§10). A missing or out-of-scope non-null link remains an error.

**Existing transaction routes stay link-backed (BC).** Dropping NOT NULL on `link_id` makes the entity property `CheckoutTransaction.linkId` `string | null`, but no existing response changes shape. `GET /api/checkout/transactions`, `GET /api/checkout/transactions/:id` and `GET /api/checkout/transactions/by-gateway/:gatewayTransactionId` add `link_id IS NOT NULL` to their scoped query, so their default results are exactly today's Phase A rows and every returned `linkId` is still a string (the backend transactions page declares `linkId: string`). A session-backed row is never listed there, and the two detail routes answer their existing `404` for it. Session payments are exposed only through the new admin `GET /api/checkout/sessions/:id` (§9.1, `checkout.sessions.view`, PII under `checkout.viewPii`), whose `transactions[]` carries `transactionId`, `status`, `paymentStatus`, `amount`, `currency`, `gatewayProvider`, `gatewayTransactionId`, `checkoutDisposition` and no `linkId`. The entity type change is recorded in §14a row 15.

---

### 4.5 `CheckoutSessionAttempt` (`checkout_session_attempts`)

One row per submit attempt, so each `Idempotency-Key` replays its own result instead of overwriting a single session column (§7.4). Carried forward from the #9691 submit-path amendment as the **replay record**. It is not a second fence: ownership stays on the session's attempt-pinned checkpoint writes and the write-boundary identities (§7.3, §7.4). Standard scoped columns (`id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`) apply.

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid | |
| `attempt` | integer | The session's `submit_attempt` for this attempt |
| `idempotency_key` | text | Client-generated, one per attempt |
| `outcome` | text | `in_flight \| awaiting_payment \| completed \| failed \| interrupted` |
| `sales_order_id` / `sales_quote_id` | uuid, nullable | The document this attempt produced |
| `terminal_result` | jsonb, nullable | The original `SubmitResponse` (§9.3) or the definitive failure code, HTTP status and replay-safe details. No `clientSecret`, credentials or PII |

Indexes: unique `(tenant_id, organization_id, session_id, idempotency_key)`; unique `(tenant_id, session_id, attempt)`. The row is inserted in the step 0 transaction (`outcome = in_flight`) and its `outcome` and `terminal_result` are written in the same transaction as the session write that ends or hands off the attempt: the terminal writes of §7.2 and §7.3, the `awaiting_payment` publication (7c) and the reopen to `open` (`interrupted`, §12.1). The session keeps the current attempt's key on `submit_idempotency_key` for convenience.

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
- the gateway methods from the store or link configuration whose descriptor supports the session currency and whose B.4 path meets the activation gate in §12.1;
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
| `awaiting_payment` within the committed lock window | `locked`, with an extension covering the payment expiry plus the margin (C1) | No |
| Cart lock expires with the payment outcome unresolved | Cart sweeper can return it to `active` at its committed expiry | Yes. The unresolved checkout attempt still excludes another submit (§12.1) |
| Submit succeeds | `converted` (`markConverted` with the session id) | No |
| Submit fails, compensated | `active` (`unlock` with the session id) | Yes |
| Session expires or is canceled before submit | `active` (nothing to unlock) | Yes |

The cart lock is acquired during submit. The lock covers payment up to its committed expiry or until an earlier terminal cart transition. Locking at session creation would strand a cart behind every abandoned checkout, and abandoned checkouts are the majority.

**Lock input (cart contract, C1, C2, D-R5-23).** `cartService.lock({ cartId, tenantId, organizationId, checkoutSessionId, checkoutAttempt?, lockTtlMs?, purpose, routeContext? })`:
- `checkoutSessionId` is the session id. A second `lock` with the **same** holder on a **live** lock (`lock_expires_at > now()`) is an idempotent extend: it returns the cart and sets the new expiry, with no re-price and no visibility pass (X15). On a lapsed lock, swept or not, a `lock` without `extendOnly` is never an extend: it is a fresh lock with every check (cart §9.1, D-R5-CA11). A different session gets `423 cart_locked`. Checkout makes every extend with `extendOnly: true`, so an extend of a lock that lapsed answers `409 cart_lock_lost` instead of taking a fresh lock (cart §9.1, D-R5-SF4, D-R5-CA11). On a lapsed lock `markConverted` and `getSalesSnapshot` answer the uniform `404`, never `cart_lock_lost`.
- **Attempt-scoped lock.** Every session-backed checkout lock supplies `checkoutAttempt: submit_attempt`, allocated in step 0. Cart persists it in a new nullable lock column alongside the session id, writes both under the cart row lock at acquisition, and clears both on release, conversion or expiry. Every checkout extend, snapshot read, unlock and conversion supplies that same pair. Match the pair under the cart row lock or in the conditional write itself, including on recovery. A different attempt on a live lock gets the existing holder-mismatch response for the operation. Existing callers can omit the new input for unversioned locks. An omitted attempt cannot match an attempt-scoped lock. Persist the attempt with the conversion identity so same-document replay can match after the lock fields are cleared.
- `purpose` is `'quote'` when `payment_method_code = 'request_quote'`, else `'order'`. `'quote'` skips the approval gate and `min_order_value`; the visibility pass, store/channel checks and re-price still run (D-R5-23).
- `routeContext`: for a `storefront` cart checkout passes the buyer's request so the cart builds a fresh `ResolvedCartRouteContext` itself (C2); checkout imports nothing from `cart/lib`. A storefront cart without a context is refused by the cart with `400 assortment_scope_required_for_storefront_channel`; checkout never sends one without. Recovery (no request) never takes a fresh lock, so it never needs a context: it only extends a lock its session still holds (§12.1, D-R5-SF4).
- `lockTtlMs`: the cart default (30 min) at step 1; at step 7 checkout extends to `payment_expires_at − now + 15 min`, within the cart's bound. The session enters `awaiting_payment` only after that extend succeeds. A `409 cart_lock_lost` there cancels or refunds the intent and cancels the order (§7.2).

**Unlock and convert.** `unlock` and `markConverted` carry `checkoutSessionId`; a mismatch is a uniform `404` (C1). For checkout the holder match includes `checkoutAttempt`, so a stale worker cannot release or convert the cart for a later submit of the same session.

**Stale acquisition after a reopen.** A worker paused before its step 1 Cart call can acquire the lock after recovery reopened its attempt. The holder rule refuses every *different* attempt, so that lock would otherwise block the cart until its 30 min expiry. Two scoped cleanups release it, each with the stale lock's own `(checkoutSessionId, checkoutAttempt)` pair, so neither can touch a live attempt's lock:
1. **By the stale worker.** Its `locked` checkpoint is pinned to the attempt, `submitting` and a null checkpoint. After a reopen that write matches no row. The worker then unlocks with its own pair, writes nothing else and answers `409 submit_interrupted` (§7.2 step 1).
2. **By the next request on the cart.** A worker that dies after the lock commits leaves no one to run step 1. `GET /sessions/current`, `POST /sessions` and submit precondition 3 read the holder through `getCheckoutView`. A holder that is a checkout session with no attempt in flight under that number is stale: its session is not `submitting` or `awaiting_payment` at that `submit_attempt`, or it is canceled, expired or failed. The request releases that lock with the holder's pair before it continues, and records a `recovery` session event. A holder whose attempt is in flight is never released this way.
R38's reopen therefore never leaves the reopened cart locked by an attempt that can no longer complete.

**Re-price on lock.** If the forced re-price changes any total, `cart.lock` returns `priceChanges`; submit releases its own lock and returns `409 price_changed` before reserving anything or creating a document. The buyer re-confirms an amount they have seen. The cart's own refusals pass through unchanged: `409 cart_has_unavailable_lines` (visibility, D-R4-24 (1)), `409 cart_requires_approval`, `409 approval_requires_identified_buyer` (D-R5-12), `409 cart_not_active`, `423 cart_locked`.

A locked cart rejects mutation with `423 cart_locked` and the session id, so a second tab sends the buyer back to checkout rather than showing a broken basket.

The cart's `release-stale-locks` sweeper applies the committed expiry. Checkout verifies the extension covers the payment expiry plus its margin before handing off to the buyer. When payment cannot be reconciled before expiry, apply the gate in §12.1. An expired cart lock does not prove gateway failure.

---

## 7) Submit

The only authoritative moment in the funnel.

### 7.1 Preconditions

Checked before any side effect; all failures are cheap and leave nothing to undo.

1. Session `open`, not expired, expected `updatedAt` matches (§4.1); otherwise `409 session_not_open` or the optimistic-lock `409`.
2. `Idempotency-Key` present; the §7.4 rules apply.
3. Cart non-empty, `active`, and `cart.id = session.cart_id`; no `completed` session on the same cart is left at `order_confirmed` (a pending conversion, §7.3), otherwise `409 cart_already_ordered`.
4. **Consistency (C9, X13, D-R4-24 (4)).** Tenant, organization, `cart.channel` and the cart currency equal the session's; when the cart has a `store_id`, it equals the store resolved for the request (`storeContextService.resolve(request, { fresh: true })`). Otherwise `409 cart_store_mismatch`. The same check runs at session creation.
5. **Sales channel (R-5, `sales/AGENTS.md`: every document is scoped to a channel).** The document's `channelId` resolves as: the cart's `salesChannelId`; else, for a storefront cart, the store's default channel binding (`storeContextService`); else, for a link cart, the link's `sales_channel_id` (§4.3). API, agent and POS carts must carry `salesChannelId` from `cart.create`. No channel → `422 sales_channel_unresolved`. The same check runs at session creation.
6. Required steps complete for the effective configuration, including a shipping method and a shipping address for every cart (D-R5-CH4); otherwise `422 steps_incomplete`. Terms accepted where required.
7. The stored `payment_method_code` is still offered by the §5.5 listing, re-run now, including the B.4 gateway activation gate (D-R5-CH2, §12.1); otherwise `422 payment_method_unavailable` before any submit side effect.
8. **Approval (order purpose only).** Advisory read of the cart's approval state: if the cart requires approval (cart K1 basis: goods gross after promotions, excluding delivery, in the cart currency; a currency other than `terms_currency_code` always requires it, D-R5-4; `terms_currency_code` falls back to the organization's base currency, D-R5-37) and `Cart.approvalId` is not `approved` for at least the current total, answer `409 cart_requires_approval` with `request-approval` as the next action. A guest cart above the threshold answers `409 approval_requires_identified_buyer` (D-R5-12). `cart.lock` re-checks both authoritatively (K2).
9. **`min_order_value` (order purpose only, D-R5-4).** Compared with the goods gross after promotions when the cart currency equals `terms_currency_code` (base-currency fallback, D-R5-37); not checked otherwise. Below it: `409 below_min_order_value`. Amounts compare as exact decimals, never floats.
10. **PO number.** The stored `purchase_order_number` is present when the resolved `requires_po_number` is true (D-R5-28), otherwise `422 purchase_order_number_required`; it matches the tenant's format when one is configured, otherwise `422 purchase_order_number_invalid`.
11. `quoted_totals` present and computed for the current cart version (`quoted_totals.cartUpdatedAt` equals the cart's `updatedAt`, §5.2); otherwise `409 price_changed` with reason `review_required`.

### 7.2 Sequence

Each step commits on its own (every `commandBus.execute()` commits its own transaction), is idempotent under its key, and records `submit_progress` plus a `CheckoutSessionEvent` when it completes. No step holds a database connection while it waits on another: a nested command runs on the caller's transaction (`ctx.transactionalEm`) when the caller has one, and never opens a second connection inside an open transaction (#8414). `attempt = submit_attempt` after the `open → submitting` CAS increments it. `stock_reservation_key = 'checkout:' + sessionId + ':' + attempt + ':stock'`, `credit_reservation_key = 'checkout:' + sessionId + ':' + attempt + ':credit'` and `documentRef = 'checkout:' + sessionId + ':' + attempt`.

**Durable identity before dispatch.** An independent effect (a Sales create, a reservation, a provider session, a payment record) is dispatched only under an identity committed before the call: the document creation key, the reservation keys, the attempt's `CheckoutTransaction` and the payment operation key. An unknown outcome is reconciled through that identity before any incompatible action. A missing row is never read as a rollback while the call can still commit (§12.1, unresolved outcomes).

**Money.** Checkout does no money arithmetic (ADR-2, D-R5-CH6). Every total comes from `sales`: the cart's own totals, or `salesCalculationService.calculateDocumentTotals`. Checkout only compares, as exact decimal strings at the currency's decimal places; it never compares floats or uses an epsilon.

```
 0. One transaction: CAS open → submitting; submit_attempt += 1; fresh keys; insert the
    attempt row (§4.5, outcome in_flight).
    Pay-link session, in the same transaction: the conditional completion_count increment
    and link_slot_attempt = attempt (§4.3)
    ├─ limit reached → the transaction rolls back; the session stays open with no slot;
    │  ABORT 409 link_usage_limit_reached
    └─ committed → emit checkout.session.submitted

 1. cartService.lock({ cartId, tenantId, organizationId, checkoutSessionId: sessionId,
                       checkoutAttempt: attempt, purpose: 'order' | 'quote',
                       routeContext })                                            [§6]
    ├─ priceChanges non-empty → unlock (same session and attempt); ABORT 409
    │  price_changed (nothing else taken)
    ├─ the `locked` checkpoint write matches no row (recovery reopened this attempt
    │  meanwhile, §12.1) → unlock with this attempt's pair, write nothing; ABORT 409
    │  submit_interrupted (stale acquisition, §6)
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

 5. Document (one per attempt, decided at the `sales` write boundary by the document
    creation key, below; C3, D-R5-CH1):
    ORDER OUTCOME (gateway or on_account)
    a. salesDocumentLookupService.findDocumentByCreationKey({ tenantId, organizationId,
       creationKey: documentRef }). A `created` order → reuse it, skip to 5c. The read is
       only a shortcut; a miss decides nothing (5b does). It never matches by
       externalReference, which any caller can repeat
    b. Not found → sales.orders.create per the field mapping below, with
       creationKey = documentRef: statusEntryId of the non-confirmed status `draft` (C17),
       externalReference = documentRef, customerReference = PO number, channelId, the
       shipping and payment method fields, customerSnapshot, the snapshot's exact lines and
       adjustments plus the shipping and delivery-discount adjustments,
       suppressStaffNotification = true (D-R5-CH8)
       ├─ created, or { duplicate: true } (another caller of this attempt created it) →
       │  that order; continue at 5c
       └─ 409 document_creation_key_retired (recovery retired the key and reopened the
          attempt, §12.1) → no order exists or can exist for this attempt: release credit
          and stock by this attempt's keys (a hold re-taken after recovery's release is
          released here; both are no-ops otherwise), unlock only with this attempt's pair
          (a newer attempt's lock never matches it, §6), write nothing; ABORT 409
          submit_interrupted
    c. Totals invariant (C7, D-R5-24): every total key of the persisted order (read back
       by its creation key, findDocumentByCreationKey) equals documentTotals. That includes the goods keys (subtotals and
       discount total equal Cart.totals) and the grand total gross (= payable). Checked for
       every payment method
       └─ mismatch → compensate (§7.3, cancel the order); ABORT 500 totals_mismatch
                     + ops notification
    d. lineMap from the persisted order lines' metadata.cartLineId (C18)
    e. Write sales_order_id; progress = document_created

    QUOTE OUTCOME (request_quote) — instead of 5a–5e:
       findDocumentByCreationKey(documentRef) → a `created` quote is reused, or sales.quotes.create with the
       same mapping and creationKey = documentRef (status entry `draft`), with the same two
       answers as 5b; the same 5c check
       └─ mismatch → release stock; unlock; ABORT 500 totals_mismatch + ops
          notification (the quote is left as an ordinary, visible draft quote)
       Write sales_quote_id; availability.release(stock_reservation_key, reason 'quote')
                                                                     (C16, A9)
       cartService.markConverted({ …, checkoutSessionId, salesQuoteId,
                                    lineMap: [{ cartLineId, salesQuoteLineId }] })   (D-R5-26)
       status = completed with pending_events [checkout.session.completed] in one write;
       deliver (§10, terminal events). DONE (no payment, no credit)

 6. ORDER OUTCOME — finalize before payment:
    a. availability.commit({ tenantId, organizationId, idempotencyKey: stock_reservation_key,
       orderId })                                                     (D-R5-8)
       └─ result 'stock_lost' (sweep won and the fresh reserve fell short) → compensate
          (§7.3, cancel order); ops notification; ABORT 409 stock_shortfall. No payment is
          ever started on a stock_lost order.
    b. IF on_account: customerCreditService.linkCreditReservationToOrder({ scope,
       idempotencyKey: credit_reservation_key, orderId })             (C6)
    c. One transaction under the attempt's checkpoint predicate (§7.5):
       promotionsService.registerUsage({ orderId, orderType: 'order', customerId,
       currency, appliedPromotions }) for the full snapshot first, then
       promotionsService.useCode({ codeId, codeString, cartId, orderId, customerId, type })
       once per distinct snapshot.appliedCodes entry, and progress = finalized
                                                                     (C5, D-R4-26)
       └─ refused code or non-empty budgetExceeded → roll back all of 6c (zero promotion
          writes); compensate (§7.3); ABORT 409 promotion_unavailable before payment
          (the next lock re-prices without it)
    d. The 6c commit is the `finalized` checkpoint; nothing else is written

 7. IF gateway:
    a. The attempt's payment identity first, then the intent (payment session identity,
       below):
       i.   One transaction, conditional on the attempt, `submitting` and `finalized`: insert
            the attempt's CheckoutTransaction (id generated now, session_id, order_id,
            link_id null, checkout_disposition = setup). The unique index
            (tenant_id, order_id) WHERE session_id IS NOT NULL (§4.4) keeps one row per
            attempt, because the order is per attempt: a unique violation means another
            caller of this attempt inserted it first → roll back, then read that row by
            order_id and reuse it. No provider call
            starts before this row commits
       ii.  paymentGatewayService.createPaymentSession({ providerKey: payment_method_code,
              paymentId: <that row's id>,
              idempotencyKey: 'checkout:' + sessionId + ':' + attempt + ':payment-session',
              orderId, amount: payable, currencyCode, successUrl, cancelUrl, ... })
            (return URLs per §9.3). Every caller of the attempt sends this same paymentId
            and idempotencyKey
       iii. Conditional session write (attempt, `submitting`, payment_intent_ref null or
            equal): payment_intent_ref, payment_expires_at (provider expiry, default 60 min)
       └─ intent creation fails → CAS disposition setup → compensating and reconcile the
          row as after a lost lock (below; a timed-out creation may have been accepted, so
          the row is resolved by the same identity first); compensate (§7.3);
          ABORT 502 payment_unavailable
    b. cartService.lock(same checkoutSessionId and checkoutAttempt, extendOnly: true,
                        lockTtlMs = payment_expires_at − now + 15 min)          (C1 extend)
       └─ 409 cart_lock_lost (the lock lapsed during the gateway call, or was swept) →
          CAS disposition setup → compensating; lost-lock reconciliation (below):
          reverse the intent and compensate (§7.3, cancel order); session failed;
          compensating → compensated only under the settlement predicate (§4.4), so a
          reversal still in flight or failed keeps the disposition compensating for
          repair-order-compensation (§12); ABORT 409 cart_lock_lost.
          The payment hand-off is never returned.
    c. Only after 7b succeeded, in one transaction: CAS disposition setup → published;
       status = awaiting_payment; progress = payment_initiated;
       emit checkout.payment.initiated; respond with the payment hand-off (§9.3).
       Then read the gateway status once: a success deferred while the disposition
       was setup (below) claims paid completion now
    Payment result (below) → dispatched on checkout_disposition → complete or compensate.
    An unknown or unavailable gateway status is not a failure: the disposition is kept
    and the next reader asks again (§12.1, unresolved outcomes).

 8. IF on_account (no gateway). Each sub-step is idempotent and records its checkpoint,
    so recovery resumes after the last one (§12.1). Every checkpoint is a conditional
    write pinned to the attempt, an eligible status and the expected prior checkpoint,
    and never moves backwards (§7.3, checkpoint writes):
    a. sales.orders.update({ id, statusEntryId of `confirmed`,
         expectedStatusEntryId of `draft` })                  (§7.3, transition fencing)
       ├─ transitioned → emits sales.order.confirmed; progress = order_confirmed
       ├─ 409 order_status_conflict, current `confirmed` → another caller confirmed it;
       │  progress = order_confirmed, continue
       └─ 409 order_status_conflict, current `canceled` → a compensation won; stop here,
          write nothing, convert nothing; the compensation owns the session, which ends
          failed with submit_recovery_failed; the submit answers that failure
       From here the confirmation boundary holds (§7.3): nothing cancels this order
    b. cartService.markConverted({ …, checkoutSessionId, salesOrderId, lineMap }). 200,
       including the cart's replay for this session and this order (alreadyConverted:
       true, cart §9.1, D-R5-CA12) → progress = cart_converted
       ├─ 404 (the lock was swept, or the cart is converted for another order) →
       │  conversion pending (§7.3)
       └─ any other error → retried 3 times in-process; still failing → conversion pending
    c. One transaction: CAS submitting → completed on the attempt, completed_at, and
       pending_events [checkout.session.completed]; deliver (§10, terminal events).
       Expected prior checkpoint: cart_converted, or order_confirmed under conversion
       pending. The credit reservation stands until a payment is settled through
       /adjust or settleCredit (D-R5-2).
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

**Document creation key (`sales`, additive, a cross-spec requirement, §16).** A lookup by `external_reference` followed by a create is a check-then-insert: a live submit can have its Sales create in flight while recovery's lookup misses, and recovery would then release the holds and reopen the session before the order commits. The lookup indexes (§14a rows 4, 5) speed the read and do not close that race. Creation and the decision to reopen are therefore made mutually exclusive where they commit, by a per-attempt key that `sales` enforces, modelled on the payment operation key below. `externalReference` keeps its current contract: optional and repeatable, and not what deduplicates.
- `orderCreateSchema` and `quoteCreateSchema` gain an optional `creationKey` (trimmed string, at most 191 characters). Omitted, both commands behave exactly as on `main` and write no ledger row.
- A new never-deleted ledger, `sales_document_creation_keys` (`id`, `tenant_id`, `organization_id`, `creation_key`, `document_kind` `order | quote`, `document_id` nullable, `state` `created | removed | retired`, `created_at`, `updated_at`), unique on `(tenant_id, organization_id, creation_key)`. A create with a key inserts the row (`created`, `document_id`) in the same transaction as the document. On a unique violation the create's transaction rolls back in full (no document, no event, no notification) and the command reads the row: `created` with the same kind → `{ id: <existing>, duplicate: true }`; `retired` → `409 document_creation_key_retired`; `removed` → `409 document_creation_key_retired`; another kind → `409 document_creation_key_conflict`, reported with `reportError`. A key is never reused. As for the payment ledger, the undo of a create and a document delete set the row to `removed` in the same transaction (keeping `document_id`), and redo of the create or undo of the delete restores the document and sets the key back to `created` in one transaction, only after locking the ledger row and verifying it is still `removed`. A `retired` row refuses restoration with `409 document_creation_key_retired`, rolling back every document write.
- A new command, `sales.documents.retire_creation_key({ tenantId, organizationId, creationKey, documentKind })`, inserts the row as `retired` with `document_id` null. On a unique violation it locks the existing row in a new transaction, verifies the document kind, and answers `{ retired: false, documentId }` for a `created` row. For `removed` it transitions the row to `retired`, preserving its document id for audit, and acknowledges `{ retired: true }` after commit. An already retired row answers the same way. Restoration and retirement serialize on this row. From a committed retirement on, no create or restoration with that key can commit.
- Two callers therefore serialize on one unique key: either the create commits first and the retirement returns its document, or the retirement commits first and the create is refused. Checkout passes `documentRef` as the key for every create (§7.2 step 5), and every recovery or compensation decision that releases an attempt's holds without an order retires the key first (§7.3, §12.1).

**Payment session identity (D-R5-CH1).** Provider creation must not run before checkout has a durable identity for it: if the provider accepts a session and the process dies before checkout records it, a retry without that identity would create a second intent and lose track of the first. The attempt's `CheckoutTransaction` is therefore committed first (step 7a.i), and every caller of the attempt (the submit, recovery's `finalized` row, a compensation that must reverse the intent) passes its id as `paymentId` and the deterministic `idempotencyKey` `'checkout:' + sessionId + ':' + attempt + ':payment-session'`. With an `idempotencyKey`, `paymentGatewayService.createPaymentSession` uses its existing session-initialization claim (`gateway-service.ts`): the operation key derives from the idempotency key, the `paymentId`, the provider and the scope; a completed initialization returns its recorded gateway transaction; a live claim is waited on; a stale claim is reclaimed and the adapter is called again with the same operation key as the provider's idempotency key. Without an `idempotencyKey` the service calls the adapter directly; checkout never does that. Phase A pay links already follow this order (the transaction first, then `createPaymentSession` with its id and the request's key). A gateway result for an intent whose reference is not yet on the session still reaches the right row, because the gateway transaction carries `paymentId` = the `CheckoutTransaction` id. A row whose intent is not recorded is resolved before anything reverses it: the caller re-sends step 7a.ii with the same identity, which returns the recorded session or creates it once, so a reversal always names the intent the provider accepted. A provider adapter that ignores the idempotency key can still create a second provider session on a stale reclaim; only the recorded one is ever published, and the other is never handed to the buyer and lapses at the provider (R39).

**Payment result (step 7).** The gateway's answer reaches the session through four paths, and all of them go through the same disposition claim, so exactly one caller completes or compensates an intent:
1. **Webhook.** The Phase A `gateway-payment-*` subscribers update the `CheckoutTransaction` as today; for a transaction with a `session_id`, they then run the disposition dispatch below (§3.2 item 2).
2. **Expiry.** `expire-awaiting-payment` reads the gateway status at `payment_expires_at` and runs the same dispatch (§12).
3. **Recovery.** `recover-stuck-submits` for a session in `awaiting_payment` with a settled transaction, and for a `completing` claim whose lease expired (§12.1).
4. **Publication.** Step 7c, which reads the gateway status once after `setup → published`.

**Gateway compensation claim.** For payment failure or expiry, atomically claim `published → compensating` and checkpoint the associated session at `compensating` with `failure_code = payment_failed` or `payment_expired`. The session write requires the same attempt, `awaiting_payment` and `payment_initiated`. Both writes must match one row or roll back together. A loser re-reads and follows the winner’s disposition. Call the gateway and Sales only after this transaction commits. Continue §7.3 from the persisted checkpoint without claiming it again. Order compensation resumes via §12.1 even if the claimant dies before either call, and the gateway reversal remains with `repair-order-compensation` until settled.

**Payment result disposition.** A payment result is decided by the `checkout_disposition` of the transaction it names, read and changed under the §4.4 conditional update. It is never decided by the session status alone, because the session leaves `awaiting_payment` both when it completes and when it is compensated.

| `checkout_disposition` | Captured or authorised | Failed, cancelled or expired |
|---|---|---|
| `setup` (7a.i committed, 7a.ii–7c unresolved: submit in flight, or crashed and awaiting recovery; the intent may not be recorded on the session yet) | **Deferred.** No confirm, no conversion, no refund. The result is acknowledged to the gateway and only the gateway status is recorded on the transaction (Phase A path). Whichever step resolves the setup reads that status afterwards: 7c, after its CAS to `published`, claims paid completion; the lost-lock path, after its CAS to `compensating`, refunds | Deferred the same way; 7c or reconciliation reads it |
| `published` (`awaiting_payment`) | CAS `published → completing` with a new claim token and lease; the winner runs paid completion (below) | Claim gateway compensation and checkpoint the session atomically (above); reverse the intent per lost-lock steps 2–4 (below: `failed`, `cancelled` or `expired` need no gateway call; a `pending` intent at expiry is cancelled under the operation contract so it cannot be paid later); compensate (§7.3); status `failed` with `payment_failed` or `payment_expired` and `pending_events [checkout.payment.failed]` in one write, then deliver (§10, terminal events); `compensating → compensated` only under the settlement predicate (§4.4). A reversal still in flight or failed keeps the disposition `compensating` for `repair-order-compensation` (§12) after the session has failed |
| `completing`, lease live | **Duplicate while the owner works.** Acknowledged; nothing else. The claim owner finishes | Not expected after a success; recorded on the transaction, operational notification, no automatic action |
| `completing`, lease expired | **Owner presumed dead.** CAS takeover (`completing → completing` on the old token and the expired lease, new token and lease); the winner resumes paid completion from its checkpoint | As the row above |
| `completed` | **Replay or concurrent poll.** Acknowledged, never refunded and never notified. The session is already `completed`: both are written in one transaction | As the row above |
| `compensating` / `compensated` | Reconciled, never confirmed, never `markConverted`. First `getPaymentStatus(transactionId, scope)`: `refunded`, `partially_refunded` after this intent's refund, `cancelled`, `failed` or `expired` → acknowledged, nothing to do. A refund already issued for this intent and still pending → acknowledged, the disposition stays `compensating` (operation contract, pending refunds). Otherwise a `compensated` intent is reopened (`compensated → compensating`), then `refundPayment` under the operation contract (below), and the operational notification | Acknowledged; nothing to reverse |

Only the caller whose conditional update wins acts. A webhook and a poll delivering the same success race on `published → completing`; the loser reads `completing` and acknowledges.

**Paid completion (single owner, checkpointed).** The holder of the `completing` claim runs these steps. Each records a `submit_progress` checkpoint when it commits, so a new owner resumes after the last one. The session stays `awaiting_payment` until step 4: completion is only ever claimed on a `published` intent, and the session is `awaiting_payment` from 7c on, so every checkpoint below is written in that status (§7.3, checkpoint writes):
1. Record the payment (below). Never blocks completion.
2. `sales.orders.update({ id, statusEntryId of confirmed, expectedStatusEntryId of draft })`, with no other field (§7.3, transition fencing). A transition, or `409 order_status_conflict` with `confirmed` (an earlier owner confirmed it), → checkpoint `order_confirmed`. A `409` with `canceled` cannot happen while the intent is `completing` (§4.4 has no `completing → compensating`); if it does, it is a defect: `reportError`, the ops notification, and the owner stops without converting or completing, leaving the claim for staff.
3. `cartService.markConverted({ …, checkoutSessionId, salesOrderId, lineMap })` (C18, D-R5-16), with `lineMap` rebuilt from the persisted order lines. A cart already converted by **this** session for **this** order answers the cart's conversion replay (`200`, `alreadyConverted: true`, cart §9.1, D-R5-CA12, landing with #9999), which counts as success. Checkpoint `cart_converted`.
4. One transaction: CAS `completing → completed` on the owner's claim token, session `status = completed` (from `awaiting_payment`, pinned to the attempt and to `cart_converted`, or `order_confirmed` under conversion pending, §7.3), `completed_at`, and `pending_events [checkout.payment.succeeded, checkout.session.completed]`. Then deliver them (§10, terminal events). Only the winner of this CAS writes them, so each is owed once.

**Fencing at the write boundary.** The claim and its lease decide who *starts* work; they do not stop work already in flight. An owner can stall inside another module's command, lose its lease, and have that command commit after a new owner took over. Correctness therefore never rests on the lease check: every irreversible effect is deduplicated where it commits, so two owners running the same step produce it once.

| Step | Irreversible effect | Fenced or deduplicated by |
|---|---|---|
| 1 | `sales` payment row | The opt-in `operationKey` of `sales.payments.create` (below, "Payment operation key"): a unique index `(order_id, operation_key) WHERE operation_key IS NOT NULL`, and the never-deleted ledger `sales_payment_operation_keys` unique on the same pair, refuse the second insert atomically, not a check-then-insert (cross-spec requirement on `sales`, §16). The loser's duplicate answer counts as recorded, and a key retired by an undo is never recorded again. `paymentReference` keeps its current contract and is not what deduplicates |
| 2 | Order status `confirmed`, `sales.order.confirmed` (C17), the deferred `sales.order.created` staff notification (D-R5-CH8) | `sales.orders.update` takes the order row lock (`lockOrderForTotalsWrite`, which runs `lockSalesDocumentRow`, `SELECT … FOR UPDATE` on `sales_orders`) and reads the previous status under it. Checkout passes `expectedStatusEntryId` of `draft` (§7.3, transition fencing): when the locked status differs, the command writes and emits nothing and answers `409 order_status_conflict`. So of two concurrent confirms exactly one transitions and emits; the other gets the conflict with `confirmed` and counts it as done. The deferred notification of `suppressStaffNotification` is sent only by the transitioning call, never from a separate unlocked read (a requirement on that new input, §14a row 3). A `completing` intent can never be compensated (§4.4 has no `completing → compensating`), and the fenced cancel of §7.3 covers every other path. Checkout never emits `sales.order.confirmed` itself and never re-emits it |
| 3 | Cart `converted`, `cart.cart.converted` | The cart's own conditional `locked → converted` for the holding `checkoutSessionId`; a second call gets the replay (`alreadyConverted: true`) and emits nothing (cart §9.1, D-R5-CA12) |
| Checkpoints | `submit_progress` | Written in one database transaction with the lease extension: first `UPDATE checkout_transactions SET completion_lease_expires_at = now() + 120 s WHERE id = :transactionId AND checkout_disposition = 'completing' AND completion_claim_token = :mine`, then the session checkpoint under the gateway predicate of §7.3 (`status = 'awaiting_payment'`, `submit_attempt = :attempt`, `submit_progress = :expectedPrior`). Both must update exactly one row, or the transaction rolls back. Zero rows on the transaction means the claim was taken over: the stale owner stops at once, calls no further module and writes nothing else. The transaction row is locked by that update, so a takeover (which updates the same row on the old token) serializes with the checkpoint. Zero rows on the session under a live claim is a defect: `reportError`, the ops notification, and the owner stops, leaving the claim for staff. A checkpoint never moves backwards. The on-account step 8 has no claim token; its checkpoints follow §7.3 "Checkpoint writes" (attempt, eligible status, expected prior checkpoint), and its terminal write is the CAS `submitting → completed`, so of a stalled submit and a recovery only one completes the session, and the order and cart effects stay fenced by rows 2 and 3 |
| 4 | Terminal state and its events | The CAS on the owner's claim token; `pending_events` is written in that transaction (§10, terminal events) |

Every step still re-checks the claim (its token, a live lease) before it calls another module and extends the lease when it does, so a stale owner rarely starts new work; that check is an optimisation, the table above is the guarantee. The lease is 120 s, the `recover-stuck-submits` threshold. A crash at any point leaves `completing` with an expiring lease. Nobody has to deliver another callback: `recover-stuck-submits` takes the claim over once the lease expires and resumes from the checkpoint (§12.1). A crash after `markConverted` committed but before its checkpoint, or before the final write, is resumed the same way: the repeated `markConverted` is the cart's replay, so the cart is converted once and the session still reaches `completed`. The intent becomes terminal (`completed`) in the same transaction as the session (`completed`). The order (`confirmed`) and the cart (`converted`) are terminal before that write. A crash after that write and before delivery leaves `pending_events` set; the terminal-event sweep delivers them (§10, §12).

`sales.order.confirmed` itself is emitted after `sales`' commit, as on `main` today. A process exit between that commit and the emit loses it; that is `sales`' delivery guarantee, shared by every confirm path, and this spec does not change it. Checkout's stock does not depend on it (the order reservation exists before the confirm, D-R5-8). A cancellation is different, because checkout's releases depend on `sales.order.cancelled`: the fenced cancel makes that event durable (§7.3, durable cancellation event).

`GET /sessions/current/result` only reads this state. The client polls it after the buyer returns to its `successUrl`.

**Lost lock after the intent (D-R5-SF4).** The intent exists, but this session no longer holds the basket it was priced for, so checkout never publishes `awaiting_payment` and never returns the hand-off. A live-lock extension is the precondition of `awaiting_payment` on the submit path and in recovery (§12.1). The reversal is requested before the order is cancelled, but the cancellation never waits for it to settle:
1. The conditional update `checkout_disposition setup → compensating` (§4.4) is written first. From then on this intent is durably marked for compensation, and a payment result for it can only be reconciled, never confirmed.
2. A row without a recorded intent is resolved first: the caller re-sends step 7a.ii with the same identity (payment session identity, above), which returns the recorded session or creates it once. This re-send can create a provider session only for it to be cancelled in step 3: the gateway service releases its claim on any adapter error, timeouts included, so no read-only probe can tell whether the provider accepted the first call. If the re-send fails, the disposition stays `compensating` and `repair-order-compensation` (§12) retries it. Then `paymentGatewayService.getPaymentStatus(transactionId, scope)` reads the provider state.
3. `pending` → `cancelPayment` cancels the intent. `authorized` → `cancelPayment` voids the authorization. `captured` or `partially_captured` → `refundPayment` refunds the captured amount. Each paid state raises an operational notification, because a payment on an unpublished hand-off is unexpected. `cancelled`, `failed` and `expired` need no gateway call. `unknown` is retried as a failed compensation (below).
4. The cancel or refund follows the operation contract below. The `CheckoutTransaction` records the outcome, and a `compensation` event names the intent.
5. Compensation per §7.3 runs whatever the reversal's outcome: it cancels the order and releases stock, credit and the pay-link slot. The session becomes `failed` (`cart_lock_lost` on the submit path, `submit_recovery_failed` in recovery), or stays `failed` with `submit_progress = compensating` while the order cancellation is outstanding. The cart is not unlocked: the session no longer holds it, so `unlock` answers `404`, and that answer is expected, not a compensation failure.
6. `checkout_disposition compensating → compensated` only under the settlement predicate (§4.4): the reversal has returned a settled result (or needed no gateway call) **and** §7.3 is done. A reversal still in flight or failed leaves the disposition `compensating` for `repair-order-compensation` (§12), independently of the session. Step 7b on the submit path, recovery, and the payment failure or expiry row above all end with this same step; none of them sets `compensated` directly.

**Cancel and refund operation contract.** Every caller that reverses this intent — the lost-lock path, a late success on a `compensating` or `compensated` intent, and the reconciliation retry — sends the **same request**, so `payment_gateways`' operation idempotency (`payment-operation-idempotency.ts`) collapses repeats into one provider call:
- `refundPayment(transactionId, amount: undefined, reason: 'checkout:compensation', scope, operationId: 'checkout:' + transactionId + ':refund')` and `cancelPayment(transactionId, reason: 'checkout:compensation', scope, operationId: 'checkout:' + transactionId + ':cancel')`. The reason names no cause, because the same request serves a lost lock, a late success after expiry and every retry; the cause is in the `compensation` event. `amount` is always omitted, so the provider refunds the whole captured amount. A caller never computes an amount and never varies the reason, so the operation's request hash is the same for every caller.
- **Recorded result** (the operation `succeeded` and the transaction's status is unchanged since): the repeat returns it. Recording a result does not settle the reversal; the status it carries does. `refunded`, `partially_refunded` after this intent's refund or `cancelled` → settled. `pending` (the Stripe adapter answers `pending` for any refund that has not yet `succeeded`, `resolveStripeRefundStatus`) → not settled (pending refunds, below).
- **Pending refunds.** The disposition stays `compensating`, so the intent stays in the `repair-order-compensation` scan, and a `compensation` event (`refund_pending`) names the intent. The refund keeps its identity: no caller sends another `refundPayment` for the intent while a refund is pending, and the repair job only reads `getPaymentStatus(transactionId, scope)`. The provider's refund webhook updates the gateway transaction as on `main`. Pending → succeeded: the status reads `refunded`, and the reversal is settled. Pending → failed: the status reads `captured` or `partially_captured` again with no refund. That is a failed compensation (below) with a `refund_failed` event and the ops notification. Checkout issues **no automatic second refund**: the original `operationId` is spent, and a new one is never minted. Staff refund the intent through the gateway admin, and the next repair run that reads `refunded` settles it. Every compensation path therefore issues at most one refund per intent.
- **Any other `409`**: either the replay of a finished operation after the transaction's status moved on (`executeManualOperation` refuses to replay then, e.g. after the provider's webhook moved a refund from pending to `refunded`), or the action not allowed in the current status (`assertManualActionAllowed`). The caller reads `getPaymentStatus(transactionId, scope)`. `refunded`, `partially_refunded` after this intent's refund, `cancelled`, `failed` or `expired` → the reversal is settled. Any other status is a failed compensation (below).
- **`409 payment_operation_in_progress`** (another caller's call is still within its operation lease): the reversal is **not** settled. The losing caller leaves the disposition `compensating`, records a `compensation` event (`refund_in_flight`), and returns. A webhook delivery is acknowledged. `repair-order-compensation` (§12) calls again with the same request. That call returns the recorded result once the first call has finished, or re-claims the operation after its lease expires. Only a returned result moves the disposition to `compensated`.
- **`409 payment_operation_conflict`** (the same `operationId` with a different request) cannot happen under this contract. If it does, it is a defect: reported with `reportError`, an operational notification, the disposition left `compensating`, and never retried under a new `operationId`, because a new id would issue a second refund.
- A provider failure is a failed compensation (§7.3): a `failure` event, `checkout.compensation.failed`, an operational notification, and a retry by `repair-order-compensation` with the same request. The disposition stays `compensating` until a result is returned.

**Payment recording (G4, #8423, #8821).** For every captured or authorised session payment, checkout executes `sales.payments.create({ orderId, amount, currencyCode, paymentMethodCode, paymentReference: <gateway transaction id>, operationKey: 'checkout:' + transactionId + ':payment', receivedAt })`. It is idempotent per `(order, operationKey)`: checkout first looks the key up (`findPaymentByOperationKey`; `live` counts as recorded, `removed` is handled like `payment_operation_key_retired` below), and `sales.payments.create` refuses a second payment with the same key on the same order atomically (below; the lookup alone is a check-then-insert and does not fence two owners, §7.2 "Fencing at the write boundary").

**Payment operation key (`sales`, additive, a cross-spec requirement, §16).** The existing `sales.payments.create` command and `POST /api/sales/payments` accept an optional `paymentReference` that may repeat on one order, and staff and integrations rely on that. The deduplication is therefore a new, opt-in key and never a change to `paymentReference`:
- `paymentCreateSchema` gains an optional `operationKey` (trimmed string, at most 191 characters). Omitted, the command behaves exactly as on `main`: no new check, no new error, repeated `paymentReference` values still accepted. `paymentUpdateSchema` does not accept it, so a key never changes after create.
- `sales_payments` gains a nullable `operation_key` column and a unique index `(order_id, operation_key) WHERE operation_key IS NOT NULL`. Every existing row has a null key, so the migration adds the column and builds the index without touching data and cannot fail on legacy repeated references. No data migration and no backfill are needed.
- **A key is reserved for life.** On `main`, undoing a create and `sales.payments.delete` both hard-delete the payment row (`tx.remove`), so the index alone would free the key. The key is therefore also written to a new ledger, `sales_payment_operation_keys` (`id`, `tenant_id`, `organization_id`, `order_id`, `operation_key`, `payment_id` nullable, `amount`, `currency_code`, `created_at`, `updated_at`), unique on `(order_id, operation_key)`. The ledger row is inserted in the same transaction as the payment and is never deleted. Removing the payment (undo of the create, or `sales.payments.delete`) sets the ledger's `payment_id` to null in the same transaction; restoring it (redo of the create, or undo of the delete) sets it back to the restored row's id. Reuse is never allowed: a retired key stays retired.
- With a key, the inserts themselves enforce it. On a unique violation (ledger or payment index) the command's transaction rolls back in full, so there is no second row, no order-totals recompute, no event and no notification. The command then reads the ledger row by key:
  - `payment_id` set, and its `amount` and `currencyCode` equal the request → `{ paymentId: <existing>, duplicate: true }`; the route answers with that id.
  - `payment_id` set, different amount or currency → `409 payment_operation_key_conflict`, reported with `reportError`.
  - `payment_id` null (the payment was recorded and then undone or deleted) → `409 payment_operation_key_retired`. No payment is created.
- **Undo, retries and redo.** Because no replacement row can ever be created under a retired key, redo always restores the original row under its original id and key, and never meets a replacement. Undo → repair retry → redo therefore ends with one payment, the original. Checkout keeps its marker consistent: `duplicate: true` and `payment_operation_key_retired` both mean the payment was recorded once. Checkout sets `checkout_transactions.payment_recorded_at` if it is still null, so `repair-gateway-payments` stops. After `payment_operation_key_retired` it also writes a `payment_result` session event (`payment_removed_after_record`) and raises the ops notification (§10.1), because the order shows less paid than the gateway captured. Checkout never re-records a payment that staff removed.
- On success checkout sets `checkout_transactions.payment_recorded_at`. A failure does not block completion: it is reported (`reportError`) and left for `repair-gateway-payments` (§12). Phase A pay-link transactions are not recorded on any order.

**Why commit precedes payment (D-R5-8).** The checkout hold becomes an `order` reservation that nothing expires, so a payment longer than the hold TTL cannot lose the stock. Because the order is created in `draft` and moves to `confirmed` only after commit, `sales.order.confirmed` never fires while a checkout hold still exists, and the `wms` auto-reservation finds the order's own reservation instead of reserving the same stock twice (C17; the Availability Contract §4.4 confirmed-first path remains only for integrators who confirm first).

### 7.3 Compensation

Reverse of acquisition, each action idempotent under the acquisition key and safe to re-run. Compensation is admitted only through the attempt-pinned checkpoint writes below (§7.4). It starts only once every issued operation it would contradict is settled through its durable identity: the document creation key, the payment session identity (§7.2, §12.1). An owner-only cart command answering `404` is a no-op for this compensation: the holder predicate includes the attempt (§6), so the `404` proves this attempt holds no lock.

| Failure at | Compensation |
|---|---|
| 1 (lock refused / price changed) | Nothing on refusal; release this attempt's lock (same session and attempt) if it was acquired before `price_changed` |
| 2 (snapshot self-check, delivery re-evaluation) | Unlock cart |
| 3 (stock shortfall) | `availability.release` (no-op if nothing held); unlock cart |
| 4 (credit refused) | Release stock; unlock cart |
| 5a/5b with no order (order creation failed) | First retire the attempt's document creation key (§7.2, document creation key); a create that failed with an error can still have committed. `{ retired: false, documentId }` → the order exists: continue at 5c, never release first. `{ retired: true }` → no order can exist for the attempt: release credit (`releaseCredit({ scope, reserveIdempotencyKey, reason })`), release stock and unlock the cart only as the winner of the reopen claim (`reopening`, pinned to the attempt, `submitting` and the expected checkpoint, §12.1). If the claim matches no row, recovery reopened the attempt first: the caller follows the step 5b refusal path (keyed releases, an unlock only with this attempt's pair, `409 submit_interrupted`) |
| Quote outcome, 5c mismatch | As above; the draft quote stays as an ordinary, visible quote. Checkout does not delete documents |
| 5c–8a, before the order is confirmed (order exists: totals mismatch, commit/link/code failure, intent failure, lock lost after the intent or at `finalized`, payment failure or expiry) | **Cancel the order**: `submit_progress = compensating`, with `failure_code` set to the failure being compensated and `sales_order_id` set to the order it cancels (one checkpoint write, below; at step 5c this is the first write that records the order id), then the fenced `sales.orders.update({ id, statusEntryId of canceled, expectedStatusEntryId of draft })` (transition fencing, below), emitting `sales.order.cancelled`. The fenced cancel answers only after the persistent queue accepted that event, and enqueues it again when it finds the order already `canceled` (durable cancellation event, below), so the event is never left to a fire-and-forget emit. That one event releases the order's stock hold (`wms`), the linked credit reservation (`customer_groups` subscriber, D-R5-2 via C6) and the promotion usage and code uses (`promotions` subscriber, C5; every use carries the `orderId`, so checkout calls no `revertCodeUse` itself). A rolled-back step 6c leaves zero promotion writes; after a committed 6c the subscriber reverses only the uses and usage of this order (§7.5). Checkout then releases credit by key if step 6b did not run, releases stock by key if step 6a did not run, releases the pay-link slot with the session's `failed` write (§4.3), and unlocks the cart. After `409 cart_lock_lost` the intent is reconciled first (§7.2, lost lock after the intent) and the unlock is skipped, because the session no longer holds the cart. Every release here follows a cancel that won, or one that found the order already `canceled` by an earlier caller of the same attempt (§7.3, stalled compensation); the releases are keyed, so repeating one that the earlier caller made is a no-op. A cancel that lost to a confirm releases nothing. The compensation ends with one conditional write (below): status `failed`, `submit_progress = compensated`, the pay-link slot release and the terminal `pending_events` |
| 8b–8c and paid completion after its step 2, the order confirmed (cart conversion failed, or the lock was lost) | **Never cancel.** Conversion pending, below |

Every compensation writes a `CheckoutSessionEvent` of kind `compensation` and emits `checkout.compensation.executed`.

**Confirmation boundary.** Once a confirm of the order has committed, checkout never cancels that order: not on the submit path, not in recovery (§12.1), not in `repair-order-compensation` (§12). The boundary does not rest on a read before the call. Recovery selects an attempt by age and takes no ownership from the live submitter, and the checkout checkpoint is written after the Sales write. A status read followed by a later command therefore leaves a window: recovery reads `draft` after the lock is lost, the live submit confirms, and the cancellation that follows would still commit. The decision is made under the order row lock instead.

**Transition fencing.** Checkout never confirms or cancels an order unconditionally. Every confirm (step 8a, paid completion step 2) and every cancel (§7.3 on the submit path, §12.1 recovery, `repair-order-compensation`) is `sales.orders.update({ id, statusEntryId, expectedStatusEntryId })` with `expectedStatusEntryId` = the `draft` entry. The input is new, additive and optional on `sales.orders.update` (§14a row 3). The command already takes the order row lock (`lockOrderForTotalsWrite`) and reads the previous status under it. When `expectedStatusEntryId` is present and the locked status differs, the command writes nothing, emits nothing (no lifecycle event, no notification) and answers `409 order_status_conflict` with the current status value. Two callers therefore serialize on the row and exactly one transition wins. Only the winner's side effects happen: `sales.order.confirmed` and the deferred notification for a confirm, `sales.order.cancelled` and the releases it drives for a cancel.
- **Confirm loses to a cancel** (current `canceled`): the confirming caller stops. It writes no checkpoint, converts nothing and completes nothing. The compensation owns the session.
- **Cancel loses to a confirm** (current `confirmed`): the cancelling caller releases nothing: no credit, stock, promotion or pay-link-slot release and no unlock. It moves the session from `compensating` to `order_confirmed` with a checkpoint write (below) that also clears `failure_code` and `failure_detail`, and leaves the session to the confirmed path. A `submitting` session continues by the §12.1 `order_confirmed` row. A `failed` session (a cancellation retried by `repair-order-compensation`) is promoted by the job in one conditional write: `WHERE status = 'failed' AND submit_attempt = :attempt AND submit_progress = 'compensating'`, which sets status `completed`, `submit_progress = order_confirmed`, `completed_at`, `pending_events [checkout.session.completed]`, and `failure_code = NULL`, `failure_detail = NULL`. Clearing the old failure fields in that same write puts the session in the conversion scan even if the worker dies right after the promotion. The job then delivers the event (§10, terminal events) and continues as conversion pending. The order the buyer was told had failed stands, so the ops notification is raised. For a gateway session this loss cannot happen (only a `completing` intent confirms, and it is never compensated, §4.4); if it does, it is a defect: `reportError`, the ops notification, and no automatic action.
- **The same transition twice** (current already equal to the target): a no-op for the caller, which continues. For a cancel, this is the resume of a compensation whose caller died after the Sales cancel committed: Sales writes nothing, enqueues `sales.order.cancelled` again (durable cancellation event, below), and the caller goes on with the keyed releases and the terminal write. Two callers that both reach step 8b are safe, because the conversion is replay-safe (D-R5-CA12) and the completion write is a CAS on `status`.

**Durable cancellation event (`sales`, additive, a cross-spec requirement, §16).** On `main`, `sales.orders.update` commits the status and then starts the lifecycle emit without awaiting it (`emitOrderLifecycleEventsForTransition`, `void emitOrderLifecycleEvent(…)`). A process that stops between the commit and the enqueue loses `sales.order.cancelled`; without a rule here, a resume would find the order already `canceled`, emit nothing, and complete the compensation while the order's committed stock (`wms`), linked credit (`customer_groups`) and promotion usage (`promotions`) stay held. The session's `compensating` checkpoint is the durable record of the owed event, as `pending_events` is for terminal events (§10), and the obligation is cleared only after the queue accepted the event:
- With `expectedStatusEntryId` present and the target `canceled`, a cancel that transitions awaits the persistent enqueue of `sales.order.cancelled` (the persistent lifecycle emit of step SA2a, enqueue-only as in §10) before it answers. A rejected enqueue answers `503 order_event_not_enqueued`; the status stays committed. The caller treats it as a failed cancel and retries.
- With `expectedStatusEntryId` present, the target `canceled` and the locked status still `canceled`, the command writes nothing, enqueues `sales.order.cancelled` for that order again while it holds the row lock's read, awaits acceptance, then answers `409 order_status_conflict` with `canceled`. A rejected enqueue answers `503 order_event_not_enqueued`. On `main` the emitter returns early when the previous and next status are equal, so the replay builds its payload explicitly: the order's current fields, `previousStatus` = the fenced expected status (`draft`), and the same `transitionId` as the original.
- **Transition identity.** Both the original and every replay of one cancellation carry `transitionId`. A transitioning cancel generates it and stores it in a new nullable column, `sales_orders.cancellation_transition_id`, in the same transaction as the status; the replay reads it under the row lock, so it survives note deletion and needs no derivation. A later cancel of a revived order writes a new id. A subscriber that must act once per cancellation (webhooks, notifications, workflow triggers) deduplicates on `(orderId, transitionId)`; a replay never mints a new identity.
- Checkout writes `compensated` only after one of those answers, so a crash at any point before acceptance leaves the session at `compensating` for the resume (stalled compensation, below) or `repair-order-compensation` (§12), and the resume's fenced cancel enqueues the event.
- Delivery is at least once. A replay after an event that had been accepted is a duplicate under the queue's ordinary redelivery contract. The three releasing subscribers are persistent and state-based, and each re-reads the order's current status before it releases, so a late delivery for an order that staff revived since releases nothing: `customer_groups` releases each reservation linked to the order once under its per-order lock and status read (§6.5 of its spec), and `promotions` reverts only while the order is cancelled and marks `reverted_at` (SPEC-055). `wms` releases only the order's active reservations (`releaseInventoryForCancelledOrder`) but does not re-read the status on `main`; it gains that check (`isSalesOrderCancelled`, already exported beside it), a cross-spec requirement on `wms` (§16). Every other subscriber of a persistent `sales.order.cancelled` must already tolerate redelivery after SA2a, and deduplicates on `transitionId` where it must act once.
- Without `expectedStatusEntryId`, and for every confirm, `sales.orders.update` behaves as on `main`. Only checkout sends the input, so no existing caller sees a new answer or a second event.

**Checkpoint writes.** Every `submit_progress` write on the submit path, in recovery and in the repair job is conditional. It is pinned to the attempt, an eligible status and the expected prior checkpoint: `UPDATE checkout_sessions SET submit_progress = :next … WHERE id = :sessionId AND submit_attempt = :attempt AND status IN (:eligible) AND submit_progress IN (:expectedPrior)`. Paid completion runs while the session is `awaiting_payment` and adds its claim token on the transaction row, in the same database transaction (§7.2, fencing at the write boundary). A step 8a replay, meaning a `409 order_status_conflict` with `confirmed`, writes through the same rule. The moves this section adds are:

| Write | Eligible status | Expected prior | Written by |
|---|---|---|---|
| `compensating` | `submitting`, `awaiting_payment` (payment failure or expiry, after `published → compensating`), `failed` | the checkpoint the caller read (`finalized` or earlier; `payment_initiated` for a payment failure or expiry) | the caller about to issue the fenced cancel; the same write sets `failure_code` to the failure being compensated and `sales_order_id` to the order it cancels (a write that finds it already set keeps it) |
| `order_confirmed` (on-account) | `submitting` | `finalized` or `compensating`; from `compensating` the write also clears `failure_code` and `failure_detail` | the caller whose confirm won, or that got `409 order_status_conflict` with `confirmed` |
| `order_confirmed` (paid completion) | `awaiting_payment` | `payment_initiated` | the claim owner whose confirm won, or that got `409 order_status_conflict` with `confirmed`, with its claim token (§7.2, fencing) |
| `order_confirmed` + status `completed` (the promotion) | `failed` | `compensating` | `repair-order-compensation` after its cancel got `409` with `confirmed` |
| `cart_converted` (on-account, conversion retry) | `submitting`, `completed` | `order_confirmed` | the caller whose `markConverted` answered 200 or the replay |
| status `completed` (8c) | `submitting` | `cart_converted`, or `order_confirmed` under conversion pending | the step 8c caller |
| `cart_converted` (paid completion) | `awaiting_payment` | `order_confirmed` | the claim owner whose `markConverted` answered 200 or the replay, with its claim token |
| status `completed` (paid completion step 4) | `awaiting_payment` | `cart_converted`, or `order_confirmed` under conversion pending | the claim owner, in the same transaction as the CAS `completing → completed` on its token |
| `compensated` + status `failed` | `submitting`, `awaiting_payment`, `failed` | `compensating` | the caller whose cancel transitioned or found the order already `canceled`, once the §7.3 releases are done |
| `reopening` | `submitting` | the checkpoint the caller read (null through `credit_reserved`) | the caller about to release an attempt without an order and return it to `open` (§12.1, reopen claim) |
| status `open` (reopen) | `submitting` | `reopening` | the reopen claim's winner, after the keyed releases and the unlock, with the pay-link slot release |
| status `failed`, `submit_progress` kept `compensating` | `submitting`, `awaiting_payment` | `compensating` | a caller whose cancel still fails after 3 in-process retries; `repair-order-compensation` continues |

A write that matches no row has lost. The caller re-reads the session and never overwrites the newer state. If it finds a later checkpoint (`order_confirmed`, `cart_converted`) or a terminal status, it keeps that state and continues from there or stops: it issues no cancel, no second conversion and no second completion. A stale recovery caller that read `finalized`, paused, and resumes after step 8c therefore loses its `compensating` write and stops. The session stays `completed` at `cart_converted`.

**Conversion pending.** When the order is confirmed and `markConverted` cannot complete (404, or another error after 3 in-process retries):
- The session completes in the same write as before: status `completed`, `pending_events [checkout.session.completed]` (paid completion adds `checkout.payment.succeeded`, and its write is still the CAS `completing → completed` on the claim token), and the submit answers the order outcome. `submit_progress` stays `order_confirmed`. After a 404, the same write also sets `failure_code = 'cart_conversion_lost'`, because the conversion can no longer succeed: recovery never re-locks. That value on a `completed` session marks a conversion that will not be retried. The order, the stock commit, the linked credit and the promotion uses all stand.
- A `failure` session event is written and the ops notification (§10.1) is raised with the order number, so staff can reconcile the cart against the order.
- **Retry.** `repair-order-compensation` (§12) retries `completed` sessions at `order_confirmed` whose `failure_code` is null. It reads no cart state first: the `markConverted({ checkoutSessionId, salesOrderId, lineMap })` call is the probe, as in §12.1. A 200, including the replay after a crash between a conversion and its checkpoint (`alreadyConverted: true`, no second `cart.cart.converted`), writes `cart_converted` conditionally on `order_confirmed`, which lifts the guard. A 404 writes `failure_code = 'cart_conversion_lost'`. That stops the retries, and the guard below stays.
- **No second purchase of the same basket.** While a cart has a `completed` session at `order_confirmed`, creating a session on that cart answers `409 cart_already_ordered`, and submit precondition 3 refuses with the same code (§7.1, §9.0, §9.2). The cart is not converted, and once its lock lapses it is `active` again. To buy again, the buyer starts a new cart. The guard is enforced by checkout on its own rows (the `(tenant_id, cart_id, status)` index), so it holds even when the cart's lock is gone.

**A compensation that itself fails** is written as a `failure` event, reported with `reportError`, emits `checkout.compensation.failed` and raises the ops notification (§10.1). It is never swallowed: a leaked stock or credit reservation is invisible inventory or invisible exposure, and both need a human. An order cancellation is retried three times in-process; if it still fails, the session stays `failed` with `submit_progress = compensating`, and `repair-order-compensation` (§12) retries it until it succeeds, then writes `compensated`.

**Stalled compensation.** A caller can die between its `compensating` checkpoint and the session's terminal write: before it calls Sales, after the cancel committed and before the releases, or after a confirm won the order and before the confirmer's `order_confirmed` checkpoint. The session is then still `submitting` (or `awaiting_payment`, for a payment failure or expiry) at `compensating`, and it may still hold stock, credit and a pay-link slot. No callback drives it: an `on_account` attempt has no intent, and a `compensating` intent only acknowledges results. `repair-order-compensation` selects `failed` sessions only. `recover-stuck-submits` therefore resumes it (§12.1, `compensating` row) once the session's `updated_at` is older than 120 s. The resume repeats the fenced cancel, and every outcome is a case above:
- Transitioned, or `409 order_status_conflict` with `canceled` (the same transition twice) → the keyed releases, the conditional unlock, then the terminal write: status `failed`, `submit_progress = compensated`, the `failure_code` recorded with the checkpoint (`submit_recovery_failed` when none is recorded), the pay-link slot release and `pending_events`.
- `409` with `confirmed` → release nothing. An `on_account` session moves to `order_confirmed` (clearing the failure fields) and continues as conversion pending or `cart_converted`. A gateway session cannot get here (only a `completing` intent confirms); if it does, it is a defect: `reportError`, the ops notification, and no automatic action.
- Still failing after 3 in-process retries → status `failed`, `submit_progress` kept `compensating`, and `repair-order-compensation` continues.

A caller that is only slow, not dead, is safe to overlap. The cancel is fenced, the releases are keyed, and the terminal write is conditional on `compensating`, so one caller writes it and the other matches no row, re-reads and stops. A gateway intent's reversal is not part of the resume: its disposition is already `compensating` when the session checkpoint commits, and `repair-order-compensation` re-sends it whatever the session status (§12).

Submit-step commands are not undoable (§11, D-R5-10); compensation is the only reversal, and the audit-log Undo cannot return a committed order hold to `checkout` or release stock under a live session.

### 7.4 Idempotency and concurrency

The buyer sends a fresh `Idempotency-Key` for each new attempt. After authorization and before the optimistic-lock test, the key is looked up in the scoped attempt record (§4.5). A repeat of the in-flight attempt's key returns `409 submit_in_progress`. The current attempt's key while `awaiting_payment` returns its payment hand-off (`200`). The key of a completed, failed or interrupted attempt replays that attempt's own stored response, even after a later attempt started. A new key while an attempt is in flight cannot start another attempt (`409 submit_in_progress`). A new key after a definitive failure starts a fresh attempt with the usual preconditions and fresh reservation keys, so its `documentRef` and creation key are fresh too. The one-live-session index (§4.1) and the attempt-scoped cart lock (§6) also exclude a cross-session submit.

**Fence continuation and compensation.** Every continuation writes only through a conditional update pinned to tenant, organization, session, `submit_attempt`, an eligible status and the expected prior checkpoint (§7.3, checkpoint writes). This covers submit, recovery, a result callback or poll, a retry and the expiry job. Paid completion also pins its claim token (§7.2). A write that matches no row has lost: the caller re-reads and never overwrites the newer state. Every independent effect is admitted only under a durable identity recorded before dispatch (§7.2, durable identity before dispatch). A successor reconciles that identity and never infers a rollback from a missing row while the call can still commit (§12.1, unresolved outcomes). A provider result callback is authenticated and matched to its scoped gateway transaction by the Phase A path before it can claim a disposition. An unmatched callback changes no checkout state. #9691's per-attempt-row `owner_generation` lease is not adopted: the lease would only decide who starts work. Correctness already rests on these write-boundary fences (§7.2, fencing at the write boundary).

Concurrency is enforced by the conditional update `status = 'open' → 'submitting'` (row-level CAS on `status` plus `updated_at`). Exactly one caller wins. This is the guard against the double-tap and the retried-request duplicate order. The document creation key (§7.2 step 5, document creation key) is the guard against a crash between document creation and the session write. The key lives in a `sales` ledger that is never deleted, so no later step can free it.

A repeat request gets the same response body as the original (§9.3, `SubmitResponse`). The payment hand-off of a repeat is read again from the gateway transaction; checkout never stores a `clientSecret`.

### 7.5 Promotion consumption and budget allocation (step 6c)

Carried forward from #9691 and adapted to the direct order (D-R5-CH1). Step 6c composes `promotions.usage.register` (`RegisterUsageInput { orderId, orderType, customerId, currency, appliedPromotions }`) and `promotions.code.use` (`UseCodeInput` with SPEC-055's additive `orderId`) in one outer transaction that also writes the `finalized` checkpoint under the attempt predicate (§7.3, checkpoint writes). Both handlers accept `ctx.transactionalEm`; the convenience facade builds its own context. Checkout therefore executes the commands on the outer transaction, preserves their authorization, and runs their audit, cache and event effects only after the outer commit. Proving that boundary is part of the CH4 gate.

Registration runs for the full locked price snapshot before any code is consumed. `ok: true` alone is insufficient: any `budgetExceeded` entry rolls back the whole transaction. The authoritative checks lock promotion rows in ascending id order and keep the existing budget currency and basis rules. Each distinct resolved code is consumed once, in ascending code id order, after every allocation is accepted. A code refusal rolls back the usage rows too. Either refusal leaves zero promotion writes; checkout then runs §7.3 and answers `409 promotion_unavailable` without starting payment or completing an on-account order.

Every code use and usage row carries the `orderId`, so the promotions subscriber on `sales.order.cancelled` reverses exactly this order's writes. Checkout never infers attribution from a cart-wide lookup. After an unknown commit outcome the owner re-reads the session: `finalized` means 6c committed and both commands are skipped; an earlier checkpoint means it rolled back, and 6c runs again under SPEC-055's `useCode` replay key `(codeId, cartId, orderId)`.

A local completion failure after a captured payment resumes from the last checkpoint (§7.2, paid completion). It never repeats promotion consumption and never treats the captured payment as failed.

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
- Quote creation takes no payment or credit and does not consume codes or budgets. Approval returns at quote acceptance (`subject_type: 'quote'`), outside Release 5: the merchant converts the quote. The current sales conversion handler has no promotion hook. Before a later conversion can commit a quoted discount, its sales-owned integration must revalidate it and use §7.5's atomic allocation and code consumption with a durable conversion checkpoint keyed by the scoped quote/order identity. A retry skips committed usage; a code or budget refusal leaves the quote unconverted. The expired-code and repricing policy for quote acceptance remains open (§18); quote creation does not promise that the original discount is still available.

---

## 9) API Contracts

Base `/api/checkout`. All bodies validated with zod in `data/validators.ts`; §9.3 gives each route's request and response schema. Mutating buyer routes take the session's expected `updatedAt` in the standard optimistic-lock header (`x-om-ext-optimistic-lock-expected-updated-at`); a stale value answers the standard optimistic-lock `409`.

**Mutation guards (R-2).** These are custom write routes, not `makeCrudRoute` routes. Every buyer `POST`/`PATCH` calls `runMutationGuards(...)` (`@open-mercato/shared/lib/crud/mutation-guard-registry`) before it executes its command, with the session's scope, the target entity `checkout:checkout_session` and `userFeatures: []` (a buyer holds no staff features). A guard refusal is returned unchanged. The reference wires no guards on these routes; the port must add them.

### 9.0 Buyer authentication and session transport (C4, C12, D-R5-21, D-R5-33)

**Token.** `POST /api/checkout/sessions` returns `{ token, session }`. The plaintext token is returned only there; the server stores `token_hash`. Every `/api/checkout/sessions/current/*` route takes it in the `X-Checkout-Session-Token` header, never in the path or query. A lost token is recovered by creating a new session.

**Creating a session.**
- *Buyer-initiated* (`{ source: 'cart' }`): requires `X-Cart-Token`. When the cart has `customer_user_id`, the request must also carry the matching customer session (`getCustomerAuthFromRequest`, cookie or Bearer customer JWT); otherwise `404` with the unknown-cart body (D-R5-21). For a storefront cart the store comes from `storeContextService.resolve(request, { fresh: true })` on the store's mapped host and must equal `cart.store_id` (§7.1 check 4).
- *Merchant-initiated* (`{ source: 'link', slug }`, B.2): the Phase A link checks and the access cookie apply; the cart is seeded per §4.3.
- **One live session per cart.** A new session on a cart cancels an earlier `open` or `awaiting_approval` session for it. If the earlier one is `submitting` or `awaiting_payment`, creation answers `409 submit_in_progress`. If a `completed` session on the cart is left at `order_confirmed` (a pending conversion, §7.3), creation answers `409 cart_already_ordered`.

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

Admin (staff auth): `GET /api/checkout/sessions` and `GET /api/checkout/sessions/:id` under `checkout.sessions.view` ship in B.1 (CH1b) as read-only routes. They return `CheckoutSessionView` (§9.3) and the event trail. `GET /sessions/:id` also returns `transactions[]`, the session's payments (§4.4), each without a `linkId`. PII fields only for a caller holding `checkout.viewPii`. The admin-forced actions (force-expire, force re-price) under `checkout.sessions.manage` and the viewer pages are B.6. The `current` segment is routed before `:id`.

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
| `submit_interrupted` | 409 | Submit | Recovery reopened a stalled attempt before its order was created; nothing is held for it; resubmit (§12.1, reopen fence) |
| `cart_already_ordered` | 409 | Create, submit | This cart already produced a confirmed order whose cart conversion is pending (§7.3); start a new cart |
| `approval_not_required` | 409 | Request-approval (passthrough from cart) | Below the threshold |
| — | 404 | All `/current/*` | Unknown token, binding mismatch (§9.0) or scope mismatch; one body for all |
| — | 429 | Rate-limited routes | §13 |
| — | 503 | Fail-closed rate-limited routes | The limiter is not registered or cannot decide (§3.2 item 1, §13) |

`session.failure_code` uses the codes above plus `approval_rejected`, `payment_failed`, `payment_expired`, `submit_recovery_failed` and `cart_conversion_lost`. The last one is set only on a `completed` session whose confirmed order stands while its cart can no longer be converted (`markConverted` answered 404, §7.3, conversion pending); it stops the conversion retries.

Five `sales` answers reach checkout and never reach the buyer: `409 order_status_conflict` (a fenced transition lost, §7.3), `503 order_event_not_enqueued` (a fenced cancel whose `sales.order.cancelled` was not accepted by the queue, §7.3), `409 payment_operation_key_retired` (§7.2, payment operation key), and `409 document_creation_key_retired` and `409 document_creation_key_conflict` (§7.2, document creation key). Checkout handles each as described there.

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

**Terminal events (durable delivery).** An event that follows a write making the session `completed` or `failed` (`checkout.session.completed`, `checkout.payment.succeeded`, `checkout.payment.failed`, `checkout.session.failed`) is not emitted from memory after the commit. It is written into `checkout_sessions.pending_events` (§4.1) **in the same transaction** as the terminal write, with its full payload, in emission order. A terminal event is only ever emitted persistent, and every subscriber that must not miss one (checkout's own, and the B.6 definitions of §5.1) declares `persistent: true` in its subscriber metadata.

*What acknowledges an entry.* The owed work is handed to the persistent event queue, not to the subscribers. An ordinary inline emit cannot acknowledge an entry: inline delivery logs a subscriber's failure and still resolves (`packages/events/src/bus.ts`), so clearing on its result would lose delivery to the subscriber that failed. Delivery therefore works on the head of the array, one entry at a time:
1. `eventBus.emit(eventId, payload, { persistent: true, deliverInline: false, tenantId, organizationId })`. This is enqueue-only: no subscriber runs on the caller's path, and `emit` resolves only after the queue's `enqueue` has accepted the job. An enqueue that throws rejects the emit.
2. Only after that resolves, the entry is removed with one conditional update: `pending_events` minus its first element (null when empty) `WHERE id = :sessionId AND pending_events->0->>'eventId' = :eventId`. A concurrent deliverer that already removed it matches no row, and the next head is read again.
3. A rejected emit leaves the entry, and every entry after it, pending. Delivery stops at the first failure, so the order is kept. The error is reported with `reportError`, and the terminal-event sweep of `recover-stuck-submits` (§12) retries from the head.

From then on, delivery to subscribers is the queue's guarantee: the events worker dispatches every persistent subscriber, with queue retry and dead-lettering on failure. The writer delivers right after its commit, and the sweep delivers whatever is left. A process exit at any point leaves the unacknowledged entries in the row, so no callback, expired claim or new request is needed. Callbacks for a `completed` or `compensated` intent still only acknowledge; they never emit. Delivery is at least once: a crash after the enqueue and before the removal enqueues that entry again. Every terminal payload carries `sessionId` (and `transactionId` for `checkout.payment.*`), and a session reaches each terminal state once, so subscribers deduplicate on `(eventId, sessionId)`. An enqueue-only event reaches persistent subscribers only, so a terminal event has no ephemeral subscriber and no `clientBroadcast`; Release 5 declares none. Non-terminal events keep the platform's ordinary emit-after-commit.

**Transaction and session events (carried forward from #9691).** Publish only from committed transitions and keep the existing repeat-delivery guards.

| Transaction | Emission contract |
|---|---|
| Link-backed Phase A pay link | Keep the existing `checkout.transaction.*` triggers, payload values and delivery behavior. A real non-null `linkId` and `slug` still identify the scoped link. The existing nullable payment fields, scope and amount fields keep their shapes. There is no session event. |
| Session transaction (always linkless, §4.4, including a session seeded from a link) | Publish only the applicable scoped `checkout.payment.*` and `checkout.session.*` events from the table above. Legacy link events, including `checkout.transaction.sessionStarted`, the terminal transaction events and `checkout.link.usageLimitReached`, are not emitted. Never synthesize a link id or slug. A link-seeded session's capacity is counted by the slot of §4.3, so Phase A link counters are not touched twice. |

The link-backed events keep `transactionId`, `linkId`, `templateId`, `slug`, `status`, `paymentStatus`, `amount`, `amountExact`, `currency`, `gatewayProvider`, `gatewayTransactionId`, `occurredAt`, `tenantId` and `organizationId` under their existing contracts. Existing subscribers can continue to resolve links and send Phase A notifications without changes.

Every event in the table is declared in `checkout/events.ts`, including `checkout.session.step_changed` and `checkout.cartTemplate.*`, which the reference does not declare; the port must add them. The payloads are exactly the table's: `checkout.session.submitted` carries `paymentMethodCode`, and `checkout.compensation.failed` carries one `action` per event.

### 10.1 Ops notification (G6)

| Field | Value |
|---|---|
| Type id | `checkout.session.attentionRequired`, declared in `checkout/notifications.ts` beside the Phase A types (additive, §14a row 20) |
| Recipients | Staff holding `checkout.sessions.view` in the session's organization (`buildFeatureNotificationFromType`, `requiredFeature: 'checkout.sessions.view'`; wildcard grants match) |
| Raised by | `checkout.compensation.failed` (after the in-process retries); `500 totals_mismatch` (both checks of §7.2); `availability.commit` returning `stock_lost`; `submit_recovery_failed`; a conversion pending (§7.3), including a `failed` session promoted to `completed` after its cancel lost to a confirm; a payment removed after it was recorded (`payment_operation_key_retired`, §7.2); a fenced transition answering a status that cannot happen on its path (§7.3); `pending_events` still set 15 min after the session's last update (§10, terminal events); a missing `draft`/`confirmed`/`canceled` status entry; `repair-gateway-payments` giving up on a transaction after 5 attempts |
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
| `recover-stuck-submits` | every minute | Sessions in `submitting` with `submit_started_at` older than 120 s, including a stalled reopen claim at `reopening` (§12.1); sessions at `submit_progress = compensating` in `submitting` or `awaiting_payment` whose `updated_at` is older than 120 s (a stalled compensation, §7.3); and session transactions in `completing` whose `completion_lease_expires_at` has passed: §12.1. **Terminal-event sweep:** sessions with `pending_events` set and `updated_at` older than 60 s (the partial index of §4.1): hand the remaining entries to the persistent queue head-first, removing each only after its enqueue was accepted and stopping at the first failure (§10, terminal events); ops notification when `pending_events` is still set 15 min after the session's last update |
| `expire-awaiting-payment` | every 5 min | `awaiting_payment` past `payment_expires_at`: read the gateway status; paid → claim completion through `published → completing` (§7.2 "Payment result disposition"); otherwise claim gateway compensation and checkpoint the session atomically (§7.2), reverse the intent (a `pending` intent is cancelled under the operation contract, §7.2), compensate (cancel the order) and fail with `payment_expired`; the disposition becomes `compensated` only under the settlement predicate (§4.4). An unknown or unavailable status changes nothing: the job asks again on its next run and raises the ops notification once the status has been unknown for 15 min (§12.1, unresolved outcomes). A webhook that won the CAS first leaves the job nothing to do. Runs before the extended cart lock can lapse (§6) |
| `repair-gateway-payments` | every 15 min | Session transactions that are `completed` with `payment_recorded_at` null (the §4.4 partial index): record the `sales` payment idempotently (§7.2 "Payment recording"), set `payment_repair_attempted_at`; ops notification after 5 failed attempts on one transaction |
| `repair-order-compensation` | every 10 min | Sessions `failed` with `submit_progress = compensating`: retry the fenced order cancellation (`expectedStatusEntryId` of `draft`, §7.3, transition fencing) and the remaining releases of §7.3 until they succeed, then write `compensated` conditionally on `failed` and `compensating`. A session at `compensating` that is not yet `failed` is resumed by `recover-stuck-submits` (§7.3, stalled compensation), never by this job. A `409 order_status_conflict` with `confirmed` means a confirm won: release nothing and promote the session to `completed` at `order_confirmed` in one conditional write that clears `failure_code` and `failure_detail` (§7.3), then continue as conversion pending. A `confirmed` order is never cancelled (§7.3, confirmation boundary). Sessions `completed` at `order_confirmed` with a null `failure_code`: `markConverted` is the probe (no cart read first); 200 or the replay → `cart_converted`; 404 → `failure_code = 'cart_conversion_lost'`, retries stop (§7.3, conversion pending). Session transactions in `compensating`: a row without a recorded intent first re-sends §7.2 step 7a.ii with the same identity (on failure it stays `compensating` for the next run); then re-send the intent's cancel or refund with the same request (§7.2, cancel and refund operation contract), or, for a refund that is already pending, only read `getPaymentStatus`, until it is settled, then `compensated` under the settlement predicate (§4.4), whatever the session status (`failed` included). Ops notification on the first failure of each session |

`repair-order-compensation` replaces v2.3's `retry-failed-compensations`: only an order cancellation and an intent reversal can be left half done, because every earlier compensation is a keyed release retried in-process.

**Schedules for every tenant (G5, #8822).** One helper, `ensureCheckoutSessionSchedules(ctx)`, registers the five schedules through `schedulerService` (skipped when it is not registered), next to Phase A's `ensureTransactionExpirySchedule`. Three callers use it: `setup.ts` `seedDefaults`, `onOrganizationCreated`, and a `configs` upgrade action `checkout.register-schedules` that an existing tenant runs once. `checkout` registers that action through the DI key `checkoutScheduleUpgradeRegistrar`, because `configs` lives in `@open-mercato/core` and must not import `checkout` (§14a row 21). The action runs at upgrade when `UPGRADE_ACTIONS_ENABLED` is set; UPGRADE_NOTES says so.

### 12.1 Recovery decision table (C24)

Recovery runs under `buildTrustedCommandContext({ tenantId, organizationId, actorType: 'system', reason: 'checkout.recovery:' + sessionId })` (`@open-mercato/shared/lib/commands/trusted-context`, D-R5-CH7) with the session's own scope. Recovery never takes a fresh cart lock and never calls `resolveForBuyer` (D-R5-SF4, SPEC-029 §6.3). It only unlocks, converts, or extends with `extendOnly: true` a cart this session still holds (cart §9.1). The extend-only call is the probe: it checks and extends the lock atomically, so a lock released by the cart's stale-lock sweeper between a check and an extend cannot turn into a fresh lock. Each probe reads by the attempt's key. Before the session records a document, the document probe is `sales.documents.retire_creation_key` with `documentRef` and the session outcome's `documentKind` (D-R5-CH1, §7.2 document creation key); a recorded document is read by its creation key (`findDocumentByCreationKey`).

| `submit_progress` | Probe | Action |
|---|---|---|
| null (crashed after step 0 committed, before step 1 recorded `locked`) | `link_slot_attempt`; no cart read | Retire the attempt's document creation key first (reopen fence, below), then claim the reopen (`reopening`, below). `cartService.unlock({ checkoutSessionId, checkoutAttempt: attempt })`, which is itself conditional on the holder (§6): a `404` means this session holds no lock (never taken, lapsed or swept) and is expected. Then, in one transaction conditional on `reopening`: release the pay-link slot when `link_slot_attempt = attempt` (§4.3) and set status `open`. The slot release never depends on the cart, so a crash between the slot increment and the cart lock leaves no slot counted |
| `locked` | Availability hold by `stock_reservation_key` | Retire the attempt's document creation key first (reopen fence, below), then claim the reopen (`reopening`, below). Hold exists → release it. Unlock (conditional on the holder, as above); release the pay-link slot and set status `open` in one transaction conditional on `reopening` (the buyer resubmits and re-confirms) |
| `stock_reserved` or `credit_reserved` (a crash in step 4 or 5, or a live submit still inside its Sales create) | `sales.documents.retire_creation_key({ creationKey: documentRef, documentKind })`; then the credit ledger by `credit_reservation_key` (on account). A lookup miss by `external_reference` is never the decision: a live submit can have its create in flight | **`{ retired: true }`** → no document exists and none can commit for this attempt (a live create is now refused with `409 document_creation_key_retired`, §7.2 step 5b): claim the reopen (`reopening`), release credit if reserved, release stock, unlock, `open` conditionally on `reopening`. **`{ retired: false, documentId }`** → the document is live and holds the attempt: write `sales_order_id`, set `document_created`, and resume forward from 5c (the totals check), never releasing anything first. Quote outcome: the same call with `documentKind: 'quote'`; retired → release stock, unlock, `open`; a quote returned → resume the quote branch |
| `document_created` | Hold status, credit entry `orderId`, promotion usage by `orderId` | Resume step 6 forward; each sub-step is idempotent under its key |
| `finalized`, gateway method | The attempt's `CheckoutTransaction` (unique by `order_id`), then the intent on the session | No row → `cart.lock({ extendOnly: true })`, then resume step 7 from 7a.i. A row with `checkout_disposition = setup` and no intent recorded on the session (a crash after 7a.i, possibly after the provider accepted the session) → `cart.lock({ extendOnly: true })`, then resume from 7a.ii with that row's id and the attempt's `idempotencyKey`, which returns the recorded session or creates it once (§7.2, payment session identity); never insert a second row and never call the provider under a new identity. Intent with `checkout_disposition = setup` (crash between 7a and 7c) → resume from 7b: `cart.lock({ extendOnly: true, lockTtlMs })` to the intent's expiry, and only then 7c (`setup → published`, status `awaiting_payment`, then the deferred-success read). Intent with `compensating` → resume reconciliation and §7.3. Either extend answering `409 cart_lock_lost` (the lock lapsed or was swept) → reconcile an existing intent (§7.2, lost lock after the intent), compensate per §7.3 and fail with `submit_recovery_failed`; never re-lock (D-R5-SF4) |
| `finalized`, `on_account` | The order by `documentRef`; then `cart.lock({ extendOnly: true })` | Never probes a gateway: an `on_account` attempt has no intent. Order already `confirmed` (a crash inside 8a, after the update and before the checkpoint) → write `order_confirmed` and continue as the next row; no extend is needed. Order not yet confirmed and the extend succeeds → resume step 8a (the fenced confirm). Order not yet confirmed and the extend answers `409 cart_lock_lost` → write `compensating` (expected prior `finalized`), then the fenced cancel (expected `draft`, §7.3); cancelling the order releases the linked credit, the stock and the promotion uses; fail with `submit_recovery_failed`; never re-lock (D-R5-SF4). The status read is only a routing hint, never the decision: a live submit may still be inside step 8a. If the `compensating` write matches no row, the live submit moved on: re-read and stop. If the cancel answers `409 order_status_conflict` with `confirmed`, the live submit confirmed first: release nothing and continue as the `order_confirmed` row |
| `order_confirmed`, `on_account` (session `submitting`) | `cartService.markConverted({ checkoutSessionId, salesOrderId, lineMap })` is the probe: conditional on the holder, with the same-session replay (§6, cart §9.1) | The confirmed order stands; recovery never compensates it (§7.3, confirmation boundary). Converted now, or the replay (`alreadyConverted: true`) → write `cart_converted` and continue as the next row. `404`, which covers a lost lock and a cart converted for a different order → conversion pending (§7.3): complete the session with `failure_code = 'cart_conversion_lost'`, write a `recovery` session event, raise the ops notification (§10.1); the `409 cart_already_ordered` guard applies. The cart read contract (§3.3) carries no conversion order id; the replay is the only identity check |
| `cart_converted`, `on_account` | — | Step 8c: the CAS `submitting → completed` with `pending_events [checkout.session.completed]`; deliver (§10, terminal events) |
| `payment_initiated` / `awaiting_payment` with a settled transaction | Gateway status | Run the "Payment result disposition" dispatch (§7.2) |
| `payment_initiated`, `order_confirmed` or `cart_converted`, gateway method (session `awaiting_payment`), transaction `completing` with an expired lease | The claim token and lease; the order status; the cart by `checkoutSessionId` | Take the claim over (§4.4), then resume paid completion after the last checkpoint (§7.2), writing each checkpoint under the gateway predicate with the new token (§7.3). A cart already converted by this session for this order is the cart's replay, so the step counts as done. Ends with `completing → completed` and session `completed` in one transaction |
| `compensating`, session `submitting` or `awaiting_payment`, `updated_at` older than 120 s (a stalled compensation, §7.3) | The fenced cancel itself: `sales.orders.update({ id: sales_order_id, statusEntryId of canceled, expectedStatusEntryId of draft })`; no status read first. `sales_order_id` is written with the `compensating` checkpoint (§7.3), so it is set even after a crash right after the step 5c checkpoint. If it is null, the order is resolved by `findDocumentByCreationKey(documentRef)` first: a `created` order is written to the session and cancelled; any other answer is a defect (`reportError`, ops notification, no automatic action) | Transitioned, or `409 order_status_conflict` with `canceled` (the dead caller's cancel had committed; the fenced replay enqueues `sales.order.cancelled` again, §7.3 durable cancellation event, so a cancel whose event was lost before enqueue still releases the order's stock, credit and promotion usage) → the remaining §7.3 releases by key (credit if 6b did not run, stock if 6a did not run; a release already made is a no-op) and the conditional unlock (`404` expected), then one conditional write pinned to the session's status, the attempt and `compensating`: status `failed`, `submit_progress = compensated`, the recorded `failure_code` (`submit_recovery_failed` when none), the pay-link slot release and `pending_events` (`checkout.payment.failed` for `payment_failed` or `payment_expired`, otherwise `checkout.session.failed`); deliver (§10). Then the settlement predicate (§4.4) for a gateway intent; its reversal stays with `repair-order-compensation`. `409` with `confirmed` (a confirm won and its caller died before `order_confirmed`) → release nothing; `on_account`: write `order_confirmed` from `compensating`, clearing the failure fields, and continue as the `order_confirmed`, `on_account` row; a gateway session: a defect (§7.3), `reportError`, ops notification, no automatic action. Cancel still failing after 3 in-process retries → the same conditional write with `submit_progress` kept `compensating`; `repair-order-compensation` continues. A write that matches no row means another caller finished: re-read and stop |
| `compensating`, session `failed` | — | Left to `repair-order-compensation` |
| `reopening`, session `submitting`, `updated_at` older than 120 s (a reopen claim whose winner may have stalled) | — | Repeat the reopen from the claim: the keyed releases (credit, stock), the conditional unlock, then the pay-link slot release and status `open` conditionally on `reopening`. The document creation key is already retired, so no order can appear for the attempt |
| any, gateway method, attempt older than the payment TTL without an intent | The attempt's `CheckoutTransaction` | No row → no provider call was ever started: compensate per §7.3 and fail with `submit_recovery_failed`; ops notification. A row without a recorded intent → re-send 7a.ii with the same identity first, so an intent the provider accepted is found and reversed (§7.2, lost lock after the intent) rather than lost; then compensate the same way. Never applied to `on_account`, which has no intent by design and resumes by the rows above |

**Payment-method branch.** Recovery branches on the session's `payment_method_code`. It cannot change while the session is `submitting` (`POST /sessions/current/payment` and every other buyer write require `open`, §7.1), and the order carries it too, as `paymentMethodCode` (§7.2 field mapping). A mismatch between the two is an internal error: compensate, fail with `submit_recovery_failed`, ops notification.

**Pay-link slot.** Every row that returns the session to `open` or fails it releases the pay-link slot in the same transaction as that status write, through the one conditional release of §4.3. A row that completes the session keeps the slot.

A recovery that resumes forward never creates a second document: every create carries `creationKey = documentRef`, which `sales` enforces atomically (C3, D-R5-CH1, §7.2 document creation key). A recovery never releases holds while an order for the attempt exists or can still be created; only a fenced cancellation of that order that wins releases them (§7.3).

**Reopen fence.** Every row that returns the session to `open` first retires the attempt's document creation key, with the session outcome's `documentKind` (the `null`, `locked`, `stock_reserved` and `credit_reserved` rows). **Reopen claim.** The caller then claims the reopen with one conditional checkpoint write, `submit_progress = 'reopening'`, pinned to the attempt, `submitting` and the checkpoint it read. Only the winner continues; a caller whose write matches no row re-reads and stops. The winner runs the keyed releases and the conditional unlock as ordinary commands, then writes status `open` (with the pay-link slot release, §4.3) conditionally on `reopening`. After the claim stalls, the original worker and recovery can both reach unlock. Both pass the original attempt into Cart’s atomic holder predicate (§6). An unlock that reaches Cart after a later attempt acquired the lock returns the holder mismatch `404` and leaves the later lock intact. Release keys and the final `open` write are also pinned to the original attempt, so repeated releases and stale terminal writes cannot affect a later submit. A live submit that is only slow, at any step before its create, then either loses its next checkpoint write (the session is `open`) or is refused at step 5b. In both cases it releases the holds it took by this attempt's keys, unlocks only with this attempt's own pair (a no-op unless it holds a stale lock, §6, stale acquisition), writes nothing else and answers `409 submit_interrupted`, so a reopened attempt never gets an order without holds.

**Unresolved outcomes (carried forward from #9691).** An absent order, quote or provider reference, an unavailable gateway, an unknown gateway status, an expired cart lock or stock hold and an elapsed deadline are not definitive failure. On that evidence recovery issues no operation under a new key, completes nothing, and cancels or releases nothing; it keeps the durable identity, asks again on its next run and reports to ops. Only the identities of §7.2 decide: a retired creation key, a missing `CheckoutTransaction` row (no provider call can have started, step 7a.i), or a status the provider reports. The unresolved attempt stays `submitting` or `awaiting_payment`, so the one-live-session index (§4.1) still refuses a second session or submit on the cart, even after its lock expired and the cart became editable.

**Gateway route activation (B.4, carried forward from #9691).** A session gateway method is disabled until its provider path passes the §16 settlement acceptance cases for every supported expiry outcome: late capture, a pending refund that later succeeds or fails, and unavailable provider status. The settlement contract it is tested against is §7.2 (payment result disposition, lost lock, cancel and refund operation contract). Store or link configuration alone cannot enable an unqualified path. A disabled method is absent from §5.5 discovery, and `/payment` and submit refuse it with the existing `422 payment_method_unavailable` before an attempt, reservation, Sales document or provider call. Submit re-checks eligibility (§7.1 check 7); a call already issued is resolved through its attempt identity. The gate applies only to the B.4 session gateway flow, never to Phase A pay links.

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
| 2 | DB schema (8) | New `checkout_sessions`, `checkout_session_attempts` (§4.5), `checkout_session_events`, `checkout_link_cart_templates`; nullable `session_id`/`quote_id`/`order_id`/`payment_recorded_at`/`payment_repair_attempted_at`/`checkout_disposition`/`completion_claim_token`/`completion_lease_expires_at` on `checkout_transactions`, nullable `pending_events` and `link_slot_attempt` on `checkout_sessions`, the `pending_events` partial index, index `(tenant_id, session_id)`, the unique index `(tenant_id, order_id) WHERE session_id IS NOT NULL` on `checkout_transactions`, the link-bound idempotency index made partial `WHERE link_id IS NOT NULL` with the session-scoped `(organization_id, tenant_id, session_id, idempotency_key)` unique index, the repair partial index (§4.4), and the partial unique one-live-session index on `checkout_sessions` (§4.1) | Additive; the partial idempotency index keeps the existing guarantee for every link-bound row | this spec |
| 3 | Signatures (3) | `sales.quotes.create` gains `externalReference` and `customerReference`. `sales.orders.create` gains the optional `suppressStaffNotification` (D-R5-CH8); omitted, behaviour is unchanged. `sales.orders.update` gains the optional `expectedStatusEntryId`, checked under the order row lock (`lockOrderForTotalsWrite`): on a mismatch the command writes and emits nothing and answers `409 order_status_conflict` with the current status; with it, a cancel awaits the persistent enqueue of `sales.order.cancelled` before answering and enqueues it again when the order is already `canceled`, answering `503 order_event_not_enqueued` when the queue refuses; omitted, behaviour is unchanged (§7.3, transition fencing and durable cancellation event). The shared line schemas (`linePricingSchema`, `lineSharedSchema`), used by order **and** quote lines, accept `null` wherever `SalesLineSnapshot` declares `\| null` | Warning (widening a validator); UPGRADE_NOTES entry listing every widened field | sales |
| 4 | DB schema (8) | Index `sales_quotes (tenant_id, external_reference)` | Additive, approved (D-R5-30) | sales migration |
| 5 | DB schema (8) | Index `sales_orders (tenant_id, external_reference)` | Additive, Ask First on `sales` approved (D-R5-CH1) | sales migration |
| 6 | DI keys / signatures / DB schema (9, 3, 8) | New `salesDocumentLookupService` (`resolveOrderStatusEntryId`, `findOrderByExternalReference`, `findQuoteByExternalReference`, `findPaymentByOperationKey`, §3.3); `paymentCreateSchema` gains the optional `operationKey`; nullable `sales_payments.operation_key` with the unique index `(order_id, operation_key) WHERE operation_key IS NOT NULL`; the new never-deleted ledger table `sales_payment_operation_keys` unique on `(order_id, operation_key)`, kept in step by create, delete, undo and redo; the new refusals `409 payment_operation_key_conflict` and `409 payment_operation_key_retired`, returned only to a caller that sent a key (§7.2, payment operation key). `paymentReference` is unchanged: still optional, still repeatable on one order | Additive. Without `operationKey`, `sales.payments.create`, `POST /api/sales/payments` and undo/redo/delete of an unkeyed payment behave as on `main` and write no ledger row; every existing row has a null key, so the index builds on any legacy data, the ledger starts empty, and no data migration is needed | sales |
| 7 | API routes (7) | New `/api/checkout/sessions`, `/sessions/current/*`, admin `GET /sessions` and `GET /sessions/:id` | Additive | this spec |
| 8 | Events (5) | New `checkout.session.*`, `checkout.payment.*`, `checkout.compensation.*`, `checkout.cartTemplate.*` | Additive | this spec |
| 9 | ACL (10) | `checkout.sessions.view`, `checkout.sessions.manage`; Phase A features unchanged | Additive; run `yarn mercato auth sync-role-acls` | this spec |
| 10 | Encryption map + data | `checkout:checkout_session` entry **and** a `buildEncryptionMapBackfillSql` migration for existing tenants (§13, R-1) | Additive | this spec |
| 11 | Signatures (3) | `cart.lock` gains `lockTtlMs`, `purpose`, the optional `checkoutAttempt` (§6), idempotent same-holder extend of a live lock, atomic `extendOnly` (`409 cart_lock_lost`); `unlock`/`markConverted` require `checkoutSessionId` and match `checkoutAttempt` when the lock carries one; `getCheckoutView` returns the holder's attempt; `markConverted` gains `salesOrderId`, `salesQuoteId`, `lineMap` and a same-session, same-document replay (`alreadyConverted: true`, pending #9999); storefront lock without context refused | Additive (C1, C2, K8, D-R5-16, D-R5-23, D-R5-26, D-R5-SF4, D-R5-CA12). Optional attempt-scoped inputs and nullable cart lock/conversion attempt storage (§6) | cart spec |
| 12 | Signatures (3) | `cartService.getCheckoutView` and `getSalesSnapshot` (§3.3); the snapshot's adjustment drafts are the exact drafts behind `Cart.totals`, metadata (`taxRate`) included | Additive (D-R5-CH5, G3) | cart spec §3.1a, `TC-CART-LOCK-06` |
| 13 | Signatures (3) | Trusted pay-link cart creation path, with `salesChannelId` | Additive, Ask First approved (D-R5-19) | cart spec §6a.4 |
| 14 | API routes (7), Phase A | Fail-closed routes (`POST /api/checkout/pay/[slug]/submit`, `/verify-password`, the session routes) answer `503` when no limiter is registered; reverses the skip tested by #5030 | Warning (behaviour change), approved 2026-11-19; UPGRADE_NOTES: configure the rate limiter | this spec |
| 15 | Types / DB (2, 8), Phase A | `checkout_transactions.link_id` drops NOT NULL; the entity property `CheckoutTransaction.linkId` becomes `string \| null`. The existing transaction routes (`GET /api/checkout/transactions`, `/:id`, `/by-gateway/:gatewayTransactionId`) filter `link_id IS NOT NULL`, so their responses keep `linkId: string` and list exactly today's rows; session payments are read only through admin `GET /api/checkout/sessions/:id` (§4.4) | API responses unchanged. Warning for code reading the entity type directly; UPGRADE_NOTES entry | this spec |
| 16 | Subscribers (Phase A) | The four `gateway-payment-*` subscribers rethrow retryable failures and resume session payments; `reportGatewayStatusSyncFailure` and its import path stay | Behaviour change, approved (D-R5-CH3) | this spec |
| 17 | Commands (Phase A) | `checkout.transaction.updateStatus` accepts a transaction without a link | Additive | this spec |
| 18 | DB schema (8), Phase A tables | `checkout_links` and `checkout_link_templates` gain nullable `sales_channel_id` and `flat_rate_shipping_*` columns (§4.3) | Additive | this spec |
| 19 | Signatures / events (3, 5) | `promotionsService.revertCodeUse?` **optional**; `UseCodeInput.orderId`; promotions subscriber on `sales.order.cancelled`; delivery promotions authorable; `registerUsage` and `useCode` composable on a caller transaction (§7.5) | Additive (C5, D-R5-17); checkout never depends on `revertCodeUse` | SPEC-055 |
| 20 | Notification type ids (11) | `checkout.session.attentionRequired` (§10.1) | Additive | this spec |
| 21 | DI keys (9) | `checkoutScheduleUpgradeRegistrar` and the `configs` upgrade action `checkout.register-schedules` (§12) | Additive | this spec |
| 22 | Signatures / DI (3, 9) | `customerCreditService.linkCreditReservationToOrder`; terms `allow_quote_requests`, `requires_po_number`, `terms_currency_code`, `approval_policy` | Additive (C6, D-R5-20, D-R5-28, D-R5-4, D-R5-1) | customer-groups spec |
| 23 | Signatures / types (3, 2) | `storeContextService.resolveForBuyer` with optional store; the store context exposes its default sales channel id; `EcommerceStoreSettings.shipping` is an **optional** key holding `flatRate` and `taxRate` | Additive (D-R5-22, D-R5-35) | SPEC-029 |
| 24 | DI keys (9) | `wmsWarehouseLookupService.getPrimaryWarehouseAddress` | Additive | wms |
| 25 | Imports (4) | `buildTrustedCommandContext({ tenantId, organizationId, actorType, actorId?, reason })` in `@open-mercato/shared/lib/commands/trusted-context`, re-exported by `@open-mercato/shared/lib/commands` | Additive (X10, D-R5-CH7) | shared |
| 26 | Signatures / commands / DB schema (3, 8) | `orderCreateSchema` and `quoteCreateSchema` gain the optional `creationKey`; the new never-deleted ledger `sales_document_creation_keys` unique on `(tenant_id, organization_id, creation_key)`; the `removed` state kept in step by undo, redo and delete; the new command `sales.documents.retire_creation_key` and lookup `findDocumentByCreationKey`; `transitionId` on `sales.order.cancelled` (additive payload field) stored in the new nullable `sales_orders.cancellation_transition_id`; the refusals `409 document_creation_key_retired` and `409 document_creation_key_conflict`, returned only to a caller that sent a key (§7.2, document creation key). `externalReference` is unchanged: still optional, still repeatable | Additive. Without `creationKey` both create commands behave as on `main` and write no ledger row; the ledger starts empty, so no data migration is needed | sales |

No row removes or renames a contract; no deprecation protocol applies.

**Legacy event payloads remain stable (§10).** Only link-backed transactions use the legacy event family. Session transactions publish the additive session-scoped events with their own payloads. Existing Phase A subscribers keep the real link id and slug.

**Phase A non-regression (C10).** A test boots an app with only `checkout` + `payment_gateways` and completes a pay link end to end. The existing Phase A tests run unchanged, including the `update-transaction-status` suite, except the #5030 rate-limit tests, which assert the new `503` (row 14).

**Upgrade steps.**
1. `yarn db:migrate`: new tables, nullable columns, the two `sales` `external_reference` indexes, `sales_payments.operation_key` with its unique index, the `sales_payment_operation_keys` ledger, the `sales_document_creation_keys` ledger, the `checkout_transactions` per-order unique index, the nullable `sales_orders.cancellation_transition_id`, and the `checkout:checkout_session` encryption-map backfill (a data migration).
2. `yarn mercato auth sync-role-acls` for the new grants.
3. Run the `checkout.register-schedules` upgrade action (automatic when `UPGRADE_ACTIONS_ENABLED` is set), so existing tenants get the five schedules.
4. Register a rate limiter (`RATE_LIMIT_*`) before upgrading: fail-closed routes answer `503` without one.
5. Configure the checkout origin (`APP_URL`, `NEXT_PUBLIC_APP_URL` or `CHECKOUT_ALLOWED_ORIGINS`) for session return URLs.

UPGRADE_NOTES carries one entry per Warning row (3, 14, 15) and one for step 3. Rows 6 and 26 are additive and need none.

---

## 15) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Payment captured without an order | **Critical** | Payment succeeds; the completion write fails; the buyer is charged and sees a failure. | The order is created and finalized **before** the intent (§7.2 steps 5–7), so a successful payment always has an order; the webhook resume, `expire-awaiting-payment` and recovery read the gateway status before compensating; the gateway subscribers rethrow retryable failures so the event is redelivered (D-R5-CH3) | Low |
| R2 | Duplicate order from double submit | **Critical** | Double-tap or a retried request creates two orders and two charges. | Conditional `open → submitting` admits exactly one caller; `Idempotency-Key` per attempt with its own replay record (§4.5, §7.4); one live session per cart (§4.1); the document creation key; concurrent-submit test is a merge gate | Low |
| R3 | Leaked stock or credit reservation | **High** | The process dies mid-submit; stock and credit stay reserved against a session that will never complete. | `recover-stuck-submits` with the §12.1 table; checkout holds have a 900 s TTL as a backstop until commit; after commit, cancellation releases through `sales.order.cancelled`; `checkout.compensation.failed` raises an ops notification | Low |
| R4 | Price changed between review and charge | **High** | A promotion expires or a delivery promotion changes during checkout; the buyer is charged more than the reviewed total. | `cart.lock` re-price and the submit-time delivery evaluation abort with `409 price_changed` before reservations, document creation or charging; an acquired lock is released (§6, §7.2 steps 1–2) | Low |
| R5 | Stale shipping rate | Medium | The buyer changes the address after selecting delivery; the merchant absorbs the difference. | An address change invalidates the quote (§5.2); the snapshot carries `quotedAt` and is re-validated at submit | Low |
| R6 | Cart stranded in `locked` | Medium | Submit crashes after locking. | Owner-scoped recovery and compensation follow §12.1. The cart sweeper uses the committed expiry as a backstop | Unresolved expiry gate |
| R7 | Credit overshoot via concurrent checkouts | **High** | Two on-account checkouts for one company jointly exceed the limit. | `reserveCredit` takes a `PESSIMISTIC_WRITE` row lock on the credit account (G1); the eligibility check is advisory and the reservation authoritative; N=20 parallel test | Low |
| R8 | Approval bypassed by a price change | Medium | A cart approved at 150 000 re-prices to 180 000 and is submitted against the stale approval. | `cart.lock` compares the re-priced total with the approved amount (K2, D-R5-3) and refuses with `409 cart_requires_approval` | Low |
| R9 | Compensation failure swallowed | **High** | A release call fails and is logged but not surfaced. | Never swallowed: `failure` event, `checkout.compensation.failed`, ops notification, retry job (§7.3) | Low |
| R10 | Rate-quote API abuse | Medium | Scripted `delivery-options` calls incur carrier cost. | 30/min per session; 5 min cache; flat-rate fallback on carrier failure (§5.3) | Low |
| R11 | Cart unlocked mid-payment (C1) | **Critical** | The 30 min cart lock lapses during a slow payment; the buyer edits or re-buys the basket while the first order completes. | Lock extended to the payment expiry + 15 min under the same session and attempt, verified before the hand-off; `unlock`/`markConverted` match the holder pair; `expire-awaiting-payment` resolves first (§6). An unresolved outcome keeps the attempt live, and a gateway path without passing expiry cases stays disabled (§12.1) | Low |
| R12 | Duplicate or orphan order after a crash (C3) | **Critical** | A crash after `sales.orders.create` and before the session write; recovery releases the holds of a live order, or creates a second one, and the buyer pays twice. | Every create carries `creationKey = documentRef`, enforced atomically by the `sales_document_creation_keys` ledger (D-R5-CH1, §7.2 document creation key); recovery retires the key before it releases anything and resumes forward when the key already holds a document, releasing nothing (§12.1); a kill test placed exactly after order creation | Low |
| R13 | Codes reused or budgets overrun (C5) | **High** | A single-use code is never consumed, or a budget overrun is found after capture. | `useCode` + `registerUsage` before payment; abort with `409 promotion_unavailable`; promotions-owned reversal on cancellation | Low |
| R14 | Visibility pass skipped at submit (C2) | **High** | A product that left the buyer's assortment is bought. | Storefront lock without a fresh context is refused by the cart; checkout always passes the request; recovery never fresh-locks (D-R5-SF4) | Low |
| R15 | Phase A regression (C10) | **High** | Hard `requires` stop pay-link-only apps from booting. | No new `requires`; soft peers; non-regression boot test | Low |
| R16 | Totals drift between cart, review and document (C7, D-R5-24) | Medium | The buyer accepts one amount and is invoiced another, or credit is reserved for a different amount; a percentage code with tax loses its tax reduction (#9389, #8425). | One draft source (the cart's exact snapshot, metadata included); a pre-document self-check against `Cart.totals`; payable computed by `sales` (D-R5-CH6); post-create equality of every persisted total for every payment method; `500 totals_mismatch` compensates and notifies ops | Low |
| R18 | Connection-pool exhaustion under parallel submits (#8414) | **High** | Nested commands each open a connection inside an open transaction; last-unit buyers get `500` and the N=20 test fails. | Nested commands run on the caller's transaction (`ctx.transactionalEm`); no step waits on another while holding a connection (§7.2); the N=20 test sized to the pool and run against real Postgres in CI (#9183) | Low |
| R19 | False `totals_mismatch` from rounding | Medium | Floats or 2 dp vs 4 dp comparisons refuse valid orders. | Exact decimal strings at the currency's decimal places; `sales` computes every figure; one comparison rule (§7.2 "Money") | Low |
| R20 | Subscribers or workers without a real container | Medium | A recovery or webhook resume dispatches commands that cannot resolve their peers; a promoted order ends cancelled. | Real container hand-off (`SubscriberContext.container`, `WorkerJobContainer`) as a B.4 prerequisite (§11) | Low |
| R21 | Payment captured but not recorded on the order (#8423, #8821) | **High** | The order shows nothing paid; the transaction stays `processing`. | `sales.payments.create` at every completion site, idempotent per `(order, operationKey)`; `repair-gateway-payments` sweep (§12) | Low |
| R22 | Lock lost between intent and extend (D-R5-SF4) | **High** | The lock lapses during the gateway call; the session publishes `awaiting_payment` on a released basket, the buyer pays, and `markConverted` refuses the conversion. | `awaiting_payment` only after a successful `extendOnly` extend; `409 cart_lock_lost` marks the intent `compensating`, cancels, voids or refunds it and cancels the order; a late success refunds only an intent durably marked for compensation (§7.2, §12.1) | Low |
| R23 | Paid order refunded by a replayed or early payment result (D-R5-SF4) | **Critical** | A replayed success webhook or a concurrent poll arrives after normal completion, or a success arrives while submit is still between 7a and 7c, and a status-based rule sends it to the refund path. | Results are dispatched on the intent's `checkout_disposition` under a conditional update (§4.4, §7.2 payment result disposition): `completing`/`completed` acknowledge, `setup` defers, only `compensating`/`compensated` refunds; every cancel and refund sends one fixed request under a per-intent `operationId`, and an in-flight answer is never taken as settled (§7.2, cancel and refund operation contract) | Low |
| R24 | Paid completion run twice, or stranded half done | **High** | A duplicate result runs the completion while the first handler is still confirming the order, or the process dies after the cart is converted and before the session is written; the order is confirmed twice, or the buyer has paid and the session never completes. | One `completing` claim with a token and a 120 s lease; checkpoints `order_confirmed` and `cart_converted`; `recover-stuck-submits` takes over an expired lease without waiting for a callback; the repeated `markConverted` is the cart's same-session replay (D-R5-CA12); intent and session become `completed` in one transaction (§7.2, paid completion) | Low |
| R25 | A stalled completion owner commits after takeover | **High** | The first owner stalls inside `sales.orders.update` (or `sales.payments.create`, or `markConverted`), its lease expires, `recover-stuck-submits` takes over and issues the same call, and the old call then commits; the order is confirmed twice, two payments are recorded, or `sales.order.confirmed` fires twice. | Every irreversible effect is deduplicated where it commits, not by the lease: the order row lock and `expectedStatusEntryId` let one confirmation transition and emit; the unique index on `(order_id, operation_key)` and the operation-key ledger record one payment; the cart's conditional conversion converts once; checkpoint writes are conditional on the claim token, so a stale owner stops at its next write (§7.2, "Fencing at the write boundary") | Low |
| R26 | Terminal event lost on a crash after commit | Medium | The process exits after the terminal write commits and before `checkout.session.completed` or `checkout.payment.succeeded` is emitted; recovery sees a terminal intent and callbacks only acknowledge, so the event is never delivered. | The events are written into `checkout_sessions.pending_events` in the terminal transaction; an entry is removed only after the persistent queue accepted it (enqueue-only emit), so a failing subscriber is retried by the events worker and a failed enqueue leaves the entry for the `recover-stuck-submits` sweep; subscribers are persistent and deduplicate on `(eventId, sessionId)` (§10, terminal events). `sales.order.confirmed` keeps `sales`' own emit-after-commit guarantee | Low |
| R27 | Reversal loses its retry owner after the session fails | **High** | The lost-lock or failure/expiry path sets `compensated` right after the order is cancelled while the refund or cancel is still in flight or failed; `repair-order-compensation` no longer scans the intent and the buyer's money is never returned. | One settlement predicate for every path (§4.4): `compensating → compensated` only when the reversal returned a settled result (or needed no call) and §7.3 is done; the repair worker scans `compensating` intents whatever the session status (§7.2, §12) | Low |
| R28 | Payment deduplication breaks existing `sales` callers | **High** | A global unique constraint on `(order_id, payment_reference)` fails the migration on legacy rows that repeat a reference, and existing API callers that legitimately repeat one start receiving duplicate errors. | Deduplication uses a new opt-in `operationKey` that only checkout sends; `paymentReference` keeps its contract; every legacy row has a null key, so the index cannot conflict; a test with repeated legacy references (§7.2, payment operation key; §14a row 6) | Low |
| R29 | Terminal event acknowledged before any subscriber can retry | **High** | The entry is cleared after an inline emit that logged a subscriber's failure and resolved, or after an enqueue that threw; that subscriber never receives `checkout.session.completed`. | Enqueue-only persistent emit; an entry is removed only after the queue accepted it, head-first with a conditional update; a failed enqueue leaves it pending for the sweep; subscriber failures are retried and dead-lettered by the events worker (§10, terminal events) | Low |
| R30 | Pay-link slot leaked by a crash before the cart lock | **High** | The process dies after the slot increment commits and before step 1 locks the cart; recovery sees no lock and reopens the session with the slot still counted, so a link with one remaining completion refuses the retry. | The increment and `link_slot_attempt` commit in one transaction (§7.2 step 0); the release is one conditional write on the session row, in the same transaction as the status write that ends the attempt, independent of the cart lock (§4.3, §12.1); a kill test between the increment and the lock. #9998 carries this as its R22 | Low |
| R31 | Finalized on-account order sent to gateway recovery | **High** | The process dies after `finalized` or after the order confirmation, before the session completes; recovery probes for a gateway intent, finds none, and creates one for an on-account order, or lets the attempt time out and cancels an order whose credit is reserved. | Recovery branches on `payment_method_code`; `on_account` resumes step 8 from the checkpoints `order_confirmed` and `cart_converted`, probing the lock with `extendOnly` and the conversion with `markConverted`'s replay; the payment-TTL row applies only to gateway methods; a confirmed order is never compensated by recovery (§12.1); kill tests after `finalized` and after the confirmation. #9998 carries this as its R23 | Low |
| R32 | Confirmed order cancelled, or its basket bought twice, after a failed conversion | **High** | The lock sweeper wins just before step 8b, or `markConverted` throws after the confirmation; compensation cancels a confirmed on-account order, or the cart returns to `active` and a second checkout buys the same basket. | Confirmation boundary: no path cancels a `confirmed` order, and the decision is made by the fenced transition under the order row lock, not by a prior read (§7.3); conversion pending completes the session with the order standing, notifies ops, retries the conversion while the lock lasts, stops durably with `cart_conversion_lost` after a 404, and refuses a new session or submit on that cart with `409 cart_already_ordered`; the conversion identity is the cart's same-session, same-order replay (D-R5-CA12). #9998 carries this as R32 | Low |
| R33 | A cancellation and a confirmation of the same order race | **High** | Recovery picks up a slow on-account submit after 120 s and reads `draft` after the lock is lost. The live submit then confirms, and recovery's cancellation still commits, because `sales.orders.update` checks shipments and payments but not the prior status. The order stands and is cancelled at once, and its stock, credit and promotion usage are released under a confirmed order. Or a repair run converts the cart and dies before its checkpoint, so the session stays behind the guard. | Every checkout confirm and cancel passes `expectedStatusEntryId` of `draft`, checked under the order row lock; exactly one transition wins, only the winner's side effects happen, and the loser's outcome is defined (§7.3, transition fencing); every checkpoint write is pinned to the attempt, the status and the expected prior checkpoint, so a stale caller stops; the repair job uses `markConverted` as its probe, so the replay clears the checkpoint; a paused-submit test in both commit orders. #9998 carries this as R33 | Low |
| R34 | A payment operation key freed by undo | **Medium** | Staff undo checkout's recorded payment, which hard-deletes the row. A `repair-gateway-payments` run whose marker write had failed then records a new payment under the freed key, and redo of the original fails on the unique index or restores a second payment for one capture. | The key is reserved for life in the never-deleted `sales_payment_operation_keys` ledger; undo and delete only null its `payment_id`, redo restores the original under the same key; a create on a retired key answers `409 payment_operation_key_retired`, which checkout counts as recorded and reports to ops (§7.2, payment operation key); the undo → repair retry → redo test | Low |
| R35 | A compensation stalls before the session's terminal write | **High** | The worker dies after `submit_progress = compensating`: before the Sales cancel, after it commits and before the releases, or after a confirm won the order and before `order_confirmed`. The session stays `submitting` (or `awaiting_payment`) forever, `repair-order-compensation` only selects `failed` sessions, an `on_account` attempt has no intent to drive recovery, and stock, credit and a pay-link slot stay held. | `recover-stuck-submits` resumes `submitting` and `awaiting_payment` sessions at `compensating` after 120 s (§7.3, stalled compensation; §12.1): the fenced cancel repeated, `canceled` treated as the same transition, keyed releases, a terminal write conditional on `compensating` that writes `compensated`; a confirm that won hands the session to the confirmed path. Crash tests on both sides of the Sales commit (§16) | Low |
| R36 | Paid-completion checkpoints match no row | **High** | Paid completion runs while the session is `awaiting_payment`, but its checkpoint predicates require `submitting`: the owner confirms the order and its next checkpoint updates zero rows, so it stops as if taken over and completion is left to a lease takeover that fails the same way. | Gateway rows in the §7.3 checkpoint table: `order_confirmed` and `cart_converted` eligible in `awaiting_payment`, the final write `awaiting_payment → completed`; each written in one database transaction with the claim-token lease extension on the transaction row (§7.2, fencing). Tests for an ordinary paid completion and a takeover after confirmation (§16) | Low |
| R37 | Order cancelled but its holds kept, after a crash before the event enqueue | **High** | The fenced cancel commits, and the process stops before `sales.order.cancelled` is enqueued (`sales` starts the emit without awaiting it). The resume finds the order `canceled`, emits nothing, and writes `compensated`; the committed stock, the linked credit and the promotion usage stay held against a cancelled order. | The fenced cancel answers only after the persistent queue accepted the event, and the fenced replay on an already-cancelled order enqueues it again; checkout writes `compensated` only after one of those answers, so its `compensating` checkpoint records the owed event (§7.3, durable cancellation event); the releasing subscribers are persistent and state-based; a kill test between the Sales commit and the enqueue | Low: a replay after an accepted event is a duplicate under the queue's at-least-once contract |
| R38 | Holds released and the attempt reopened while its order is still being created | **High** | Recovery picks up a slow submit after 120 s while its `sales.orders.create` is in flight, misses the order by `external_reference`, releases stock and credit and reopens the session; the order then commits with no holds. | Creation and reopening serialize on the attempt's document creation key: recovery retires it first, and a create after a retirement is refused (`409 document_creation_key_retired`), so the live submit releases its own holds by key and answers `409 submit_interrupted`; a create that committed first makes the retirement return the order, and recovery resumes forward (§7.2, §12.1 reopen fence) | Low: a straggler that dies between the refused create and its keyed releases leaves a checkout stock hold that expires with its TTL and a credit reservation that needs staff, both after a stall longer than 120 s; a straggler still inside step 1 can re-lock the cart after the reopen (the lock is per session), and that lock lapses with its TTL or is extended by the buyer's next attempt |
| R39 | A provider session created and then lost before checkout records it | **High** | The provider accepts the session and the process stops before checkout stores the result; recovery creates a second intent and loses track of the first, which the buyer may still pay. | The attempt's `CheckoutTransaction` commits before any provider call, and every caller reuses its id as `paymentId` and the deterministic `idempotencyKey`, so `payment_gateways`' session-initialization claim returns the recorded session or re-creates it under the same provider idempotency key (§7.2, payment session identity); a row without a recorded intent is resolved before any reversal | Low: an adapter that ignores the idempotency key can create an unpublished second provider session, which is never handed to the buyer and lapses at the provider |
| R40 | Draft order stranded by a crash at the step 5c compensation checkpoint | **High** | A persisted-total mismatch at 5c starts compensation before 5e records `sales_order_id`. The worker dies after the `compensating` checkpoint and before the Sales cancel. Recovery's fenced cancel has no order id, so the draft order and its holds and pay-link slot stay held. | The `compensating` checkpoint writes `sales_order_id` in the same conditional write; recovery falls back to the creation-key ledger (§7.3, §12.1); crash test in §16 | Low |
| R41 | A pending refund dropped from repair, or refunded twice | **High** | Stripe answers `pending` for an accepted refund, and the gateway service records that result. If a recorded result counted as settled, the intent would become `compensated` and leave the repair scan before the provider confirmed the refund. A failed refund would never be retried, or a retry under a new id would refund twice. | Settlement only by a terminal provider status; a pending refund keeps its identity and is only read; a failed refund raises a failed compensation for staff and is never re-issued automatically (§4.4, §7.2 operation contract) | Low; a refund that fails at the provider needs a staff action |
| R17 | Session token replay by a third party | Medium | A leaked session token on an identified cart is replayed. | Binding to the customer session (§9.0); `404` on mismatch; token never in URLs or logs | Low (guest sessions remain token-only by design) |

---

## 16) Integration Coverage

Integration tests are self-contained: each creates its tenant, store, products, stock, groups, terms, credit accounts, promotions and carts through API fixtures and cleans up in teardown. A second-tenant fixture exists for every public route.

**API paths (every new route):**
- `POST /api/checkout/sessions` — from a cart token (guest, identified with matching customer session, identified without it → 404, identified with another buyer's session → 404); from a link (B.2); token returned once and only its hash stored; second session on the same cart supersedes an `open` one and is refused while `submitting`; refused with `409 cart_already_ordered` while a `completed` session on the cart is at `order_confirmed`; `503 checkout_sessions_unavailable` with `cart` disabled.
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
- Admin `GET /api/checkout/sessions` and `/sessions/:id` — `checkout.sessions.view` required; PII only with `checkout.viewPii`; another tenant's session is `404`; `/sessions/:id` lists the session's transactions.
- Existing `GET /api/checkout/transactions`, `/transactions/:id` and `/transactions/by-gateway/:gatewayTransactionId` with a session-backed transaction present: the list returns only link-backed rows, each with a string `linkId`, and the response schema is unchanged; both detail routes answer `404` for the session row; the backend transactions page renders unchanged (§4.4, §14a row 15).
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

**Promotion and submit recovery implementation gates:**
- Kill checkout after step 6c commits but before the next step. Replay with the original attempt and verify one use per code, one usage row per promotion and one successfully completed paid checkout. Kill before the 6c commit and verify no usage or counter change survives rollback. Simulate a lost commit response and reconcile from the checkpoint.
- Race two checkouts for the final same-currency budget. Include a second promotion that the losing checkout could register successfully. The winner alone starts payment; the loser gets 409 without payment, order completion, surviving partial budget allocation, or code use.
- Exercise the future discounted quote-conversion hook by killing the converter at the checkpoint boundary and replaying. Assert one conversion and one set of promotion effects; on budget refusal, the quote stays unconverted. This is a gate for that hook.
- Pause a submitter inside the composed step 6c transaction past 120 s while recovery reads the session: recovery sees `document_created`, its own 6c waits on the promotion row locks or replays under the `useCode` key, and exactly one set of usage and code rows commits. A rollback of the paused transaction leaves no `finalized` checkpoint and no promotion write.
- Pause an independent sales or gateway call after its issued checkpoint, including before physical dispatch. Race recovery with callback/poll and expiry. Absence does not permit compensation or a second dispatch under a fresh key. Exercise both definitive settlement and unknown settlement at expiry. An unknown outcome follows §12.1 (unresolved outcomes): nothing is compensated, completed or re-issued, and the one-live-session index still refuses a second submit.
- Replay keys across two organizations and tenants and create competing sessions over the same cart. Verify scoped reads/writes, one active session, previous-attempt result replay, and the existing same-key payment hand-off.

**Compensation and recovery (C26):**
- `availability.commit` returning `stock_lost` (expiry sweep forced to win before step 6a, stock taken by another order): the order is cancelled, no payment intent is created, submit answers `409 stock_shortfall` (D-R5-8).
- Injected failure at each of steps 1, 2, 3, 4, 5a, 5b, 5c, 6a, 6b, 6c, 7 (intent) and payment failure: no stock held, no credit reserved, codes and usage reverted, the order (if any) cancelled, and the cart unlocked.
- A process killed after each of steps 1–7 is reconciled by `recover-stuck-submits` per §12.1 **without a duplicate quote or order** (C3, C24).
- **On-account kill after `finalized` (R31):** recovery makes no gateway call and creates no intent; with the lock held (the `extendOnly` probe succeeds) it confirms the order, converts the cart and completes the session; with the lock gone (`409 cart_lock_lost`) it cancels the order, the linked credit reservation is released, and the session fails with `submit_recovery_failed`.
- **On-account kill after the order confirmation, before the session completes (R31):** recovery does not confirm twice (one `sales.order.confirmed`), converts the cart once (the replay counts as done), completes the session and keeps the credit reservation; an attempt older than the payment TTL is not compensated. With the lock lost before conversion, the session completes at `order_confirmed` with `failure_code = 'cart_conversion_lost'`, the cart is not converted, the ops notification is raised, and a new session or submit on that cart answers `409 cart_already_ordered`.
- **Lock swept after the confirmation, live submit (R32):** a test hook lets `release-stale-locks` release the cart between step 8a and 8b. `markConverted` answers 404 and the order stays `confirmed` (no `sales.order.cancelled`), with the credit reservation standing. The session ends `completed` at `order_confirmed` with `cart_conversion_lost`, the ops notification is raised once, and a new `POST /sessions` or a submit on that cart answers `409 cart_already_ordered`.
- **Conversion throws after the confirmation (R32):** `markConverted` fails 3 times in-process. The order is not cancelled and the session completes at `order_confirmed` with a null `failure_code`. `repair-order-compensation` then converts the cart while the lock lasts, writes `cart_converted` and lifts the guard.
- **Confirm and cancel race (R33), both commit orders, with the real `sales` command:** a test hook pauses the live on-account submit around step 8a while recovery, with the lock swept, takes the lost-lock branch of the `finalized` row. (a) Confirm commits first: the cancel answers `409 order_status_conflict`; no `sales.order.cancelled` and no credit, stock, promotion or pay-link-slot release; the session ends `completed` at `order_confirmed` (conversion pending) or `cart_converted`. (b) Cancel commits first: the confirm answers `409 order_status_conflict`; no `sales.order.confirmed` and no staff notification; the live submit writes no checkpoint and converts nothing; the session ends `failed` with `submit_recovery_failed`. In both orders exactly one lifecycle event is emitted. Without `expectedStatusEntryId` the same test reproduces the double transition, so it guards the fence itself.
- **Stale recovery resumes after completion (R33):** recovery reads `finalized`, and a test hook pauses it before its `compensating` write. The live submit runs 8a–8c and the session reaches `completed` at `cart_converted`. When recovery resumes, its `compensating` write matches no row; it re-reads the session and stops. It issues no cancel, so there is no `sales.order.cancelled` and no `409`. A late step 8a replay with `order_confirmed` from the same attempt also leaves `cart_converted` in place.
- **Failed session promoted, worker killed (R33):** a session `failed` at `compensating`, with `failure_code = submit_recovery_failed`, has a confirmed order. `repair-order-compensation` gets `409 order_status_conflict` with `confirmed`, promotes the session to `completed` at `order_confirmed`, and the worker is killed before `markConverted`. The promotion has cleared `failure_code` and `failure_detail`. The next run picks the session up, converts the cart and writes `cart_converted`; `checkout.session.completed` is delivered once.
- **Repair crash between the conversion and the checkpoint (R33):** on a session already `completed` at `order_confirmed`, the repair job's `markConverted` commits and the worker is killed before `cart_converted`. The next run reads no cart state and calls `markConverted`. It gets the replay (`alreadyConverted: true`), emits no second `cart.cart.converted`, writes `cart_converted` and lifts the `cart_already_ordered` guard. A 404 on a later session sets `cart_conversion_lost`, and that session is not retried again.
- **Committed conversion with a missing checkpoint (R32):** killed after `markConverted` commits and before `cart_converted` is written, recovery's `markConverted` gets the replay (`alreadyConverted: true`), emits no second `cart.cart.converted`, writes `cart_converted` and completes. **Replay for a different order:** a `markConverted` on that converted cart with another `salesOrderId` answers 404, and the conversion is never counted as done.
- **Stalled compensation (R35), with the real `sales` command and a test hook that kills the worker:**
  - Killed after the `compensating` write, before the Sales cancel (an `on_account` submit whose step 6c refused a code): within one `recover-stuck-submits` run after 120 s the order is cancelled once (one `sales.order.cancelled`), the linked credit and the stock are released, the pay-link slot is released, and the session is `failed` at `compensated` with `promotion_unavailable`; `checkout.session.failed` is delivered once.
  - Killed after the Sales cancel commits, before the releases and the `failed` write: the resume's cancel answers `409 order_status_conflict` with `canceled` and enqueues `sales.order.cancelled` again (§7.3, durable cancellation event; the order's status is not written twice), the keyed releases and the state-based subscribers leave no hold and no double release, and the session ends `failed` at `compensated`.
  - Confirm won: recovery's lost-lock branch writes `compensating` while the live on-account submit's confirm commits first, and the submit is killed before `order_confirmed`. The resume gets `409` with `confirmed`, releases nothing, writes `order_confirmed` with the failure fields cleared, converts the cart (or completes as conversion pending) and completes the session; the order stays `confirmed`.
  - Gateway claim crash: kill the worker immediately after the atomic failure or expiry claim and before any gateway or Sales call. With no new callback, the session sweep cancels the draft order and releases its holds and slot, and the gateway repair job settles the reversal. The session ends `failed` at `compensated` with the original failure code and one `checkout.payment.failed` event.
  - Gateway: a payment failure on `awaiting_payment`, killed before the cancel and, separately, after it. The session ends `failed` at `compensated` with `payment_failed` and one `checkout.payment.failed`; the intent becomes `compensated` only once its reversal is settled.
  - Cancel keeps failing: the resume fails the session at `compensating`; once Sales recovers, `repair-order-compensation` cancels the order and writes `compensated`.
  - A slow live caller overlapping the resume: exactly one terminal write wins; the other matches no row and stops.
- **Cancellation event lost before enqueue (R37), with the real `sales` command and resources already linked:** an `on_account` attempt past 6a and 6b (committed stock, linked credit, a used code) is compensated; a test hook stops the worker after the Sales cancel commits and before `sales.order.cancelled` is enqueued. The resume's fenced cancel answers `409 order_status_conflict` with `canceled` after enqueuing the event; the `wms`, `customer_groups` and `promotions` subscribers then leave no active order reservation, no unreleased credit reservation and no consumed code or usage; the session ends `failed` at `compensated`. A second variant lets the first enqueue succeed before the kill: the replay is a duplicate, and nothing is released twice. A third makes the enqueue reject: the cancel answers `503 order_event_not_enqueued` and the session stays at `compensating`. Every replay carries the original `transitionId` and `previousStatus: draft`; a replay delivered after staff revived the order releases no stock, credit or usage.
- **Create in flight overlapping the sweeper (R38), with the real `sales` command:** a test hook pauses a live submit inside `sales.orders.create`, before its commit, for longer than 120 s. (a) Recovery's retirement commits first: the create is refused with `409 document_creation_key_retired`, no order exists for the attempt, the live submit releases its holds by key, its unlock with the attempt's pair is a no-op (`404`), and answers `409 submit_interrupted`; the session is `open` with no stock or credit held. (b) The create commits first: the retirement answers `{ retired: false, documentId }`, recovery releases nothing and resumes from 5c, and exactly one order exists. Both orders also for a quote. A create without `creationKey` still accepts a repeated `externalReference` (unchanged contract), and an unrelated order planted with the same `externalReference` is never reused (step 5a reads the ledger). An undone create sets the key to `removed`: a retry is refused and recovery's retirement answers `{ retired: true }`. A slow submit compensating its own failed create after recovery reopened the session (and the buyer started a new attempt) loses the reopen claim, unlocks nothing and leaves the new attempt's cart lock in place. A reopen claim whose winner is killed after the claim is finished by the next `recover-stuck-submits` run.
- **Stale reopen worker:** pause the winner just before its Cart unlock, let recovery finish the reopen, and acquire the cart for the next submit attempt of the same session. Resume the winner. Assert the later lock and its expiry are intact and the stale checkout write has no effect.
- **Stale acquisition after reopen (§6):** pause an attempt before its step 1 Cart call; let recovery reopen the attempt (its unlock answers `404`, no lock). Resume: the lock is acquired for the old attempt, its `locked` checkpoint matches no row, it unlocks with its own pair and answers `409 submit_interrupted`; the cart is `active`. A variant kills the worker right after the lock commits: the buyer's next `GET /sessions/current`, `POST /sessions` or submit sees the stale holder through `getCheckoutView`, releases it with the old pair, and the new attempt locks at once; a lock held by a live attempt is never released by that cleanup.
- **Crash after the step 5c compensation checkpoint (R40):** force a persisted-total mismatch and kill the worker right after the `compensating` checkpoint, before the Sales cancel. The checkpoint holds `sales_order_id`. The next `recover-stuck-submits` run cancels that draft order once, the order's holds, credit and pay-link slot are released, and the session ends `failed` at `compensated` with `totals_mismatch`. A variant clears `sales_order_id` on the row: recovery resolves the order by `findDocumentByCreationKey(documentRef)` and cancels the same order.
- **Pending refund (R41), with the Stripe adapter's `pending` refund status:** a late capture on a `compensated` intent is reopened and refunded; the refund returns `pending`. The disposition stays `compensating` and `repair-order-compensation` keeps reading `getPaymentStatus` without a new refund request. Pending → succeeded (`refunded`): `compensated`, one provider refund in total. Pending → failed (status back to `captured`): no second refund, the disposition stays `compensating`, a `refund_failed` compensation event and the ops notification; after a staff refund the status reads `refunded` and the disposition becomes `compensated`.
- **Document restoration vs. retirement:** for both an order and a quote, race retirement of a removed creation key with restoration through redo or undo-delete. If retirement wins, restoration rolls back and the key stays retired. If restoration wins, retirement returns the live document and recovery keeps the holds.
- **Provider accepted, linkage lost (R39):** a test hook stops the submit after the gateway adapter accepted the session and before step 7a.iii. Recovery's `finalized` row finds the row without an intent, re-sends 7a.ii with the same `paymentId` and `idempotencyKey`, gets the recorded session back (one provider call in total, one gateway transaction), records it and publishes. A variant with the lock swept reverses that same intent. **Overlapping submit and sweep:** a slow submit and recovery both reach 7a for one attempt; one `CheckoutTransaction` row exists (the unique index), one provider session is created, and both callers see the same intent.
- **Kill right after `sales.orders.create`, before the session write (G1):** recovery's retirement answers `{ retired: false, documentId }`, recovery releases nothing, and completes or compensates that order; a second submit by the buyer creates no second order.
- A payment recording failure is repaired by `repair-gateway-payments` exactly once (G4); an order cancellation that fails three times is finished by `repair-order-compensation`.
- A gateway subscriber whose command fails with a `5xx` rethrows and the event is redelivered; a terminal `409` is reported and swallowed (D-R5-CH3).
- A failing compensation raises the notification and is retried (R9).
- Credit released by `customer_groups` when the order is cancelled (C6).
- Code reuse refused; code returned on payment failure; budget overrun aborts with `409 promotion_unavailable` before payment (C5).

**Link-backed and linkless transaction events:**
- Run the existing Phase A link-backed success and failure fixtures with the post-commit event assertions. Assert exactly one event per applicable transition under callback/poll redelivery, real scoped link id and slug, the unchanged legacy payload (§10), and the existing link counter and subscriber behavior. Exercise a link-backed B.4 session separately to verify it emits its session events in addition to the legacy payloads.
- Run a B.4 linkless session through intent creation, definitive success and definitive failure. Its transaction and session results commit without loading or updating a link. Assert scoped payment/session events with the proper ids, no legacy link-bound events, and no duplicate terminal emission on redelivery.

**Lock and payment (C1, C2):**
- A qualifying payment can outlast the 30 min default. Verify the owner extends the lock within the cart bound, confirms the expiry covers the intent and margin before returning the hand-off, and retains it until the committed deadline. At that deadline, the cart sweeper may release it even if the outcome is unknown. Assert no conflicting compensation or second submit on the unresolved attempt.
- Configure a session method whose late-settlement case lacks approved acceptance coverage. Verify it is absent from discovery, and direct selection and submit get `422 payment_method_unavailable`. Assert no attempt, lock, holds, sales document, or gateway call. The Phase A pay-link fixture still works. Before enabling a qualified B.4 path, pass its approved late-capture and provider-unavailable acceptance cases. Until the policy is approved, test the disabled path and leave the late-settlement outcome case blocked.
- `unlock`/`markConverted` with another session id → 404.
- A storefront cart locked without a context is refused; checkout always supplies one.
- **Lost lock at `finalized` (D-R5-SF4).** For a storefront cart and for a pay-link cart each: a session stuck at `finalized` with no `CheckoutTransaction` row, and separately one whose row has no recorded intent (recovery re-sends 7a.ii with the same identity first and reverses what it returns), whose cart lock lapsed or was cleared by `release-stale-locks` before recovery ran, is compensated (order cancelled, stock and credit released) and fails with `submit_recovery_failed`. The cart is `active` and not re-locked, no re-price runs, and the storefront cart produces no `400 assortment_scope_required_for_storefront_channel`. With the lock still live, recovery extends it and creates the intent.
- **Lost lock after the intent (D-R5-SF4).** For a storefront cart and for a pay-link cart each, the lock is forced to expire (and, in a second variant, swept by `release-stale-locks`) between `createPaymentSession` and the step 7b extend:
  - On the submit path, submit answers `409 cart_lock_lost`, the session never enters `awaiting_payment`, and no hand-off is returned. The intent is cancelled through `cancelPayment`, the order is cancelled, stock, credit and code uses are released, and the cart is not re-locked.
  - In recovery, a session crashed between 7a and 7c with the lock since lapsed is reconciled the same way and fails with `submit_recovery_failed`. With the lock still live, recovery extends it and only then sets `awaiting_payment`.
  - A gateway stub reporting the intent authorized gets `cancelPayment`; one reporting it captured gets `refundPayment`. Both raise the operational notification.
  - A `success` webhook delivered afterwards for that transaction neither confirms the order nor converts the cart. The disposition is `compensating` or `compensated`, so it refunds under the intent's refund contract and raises the operational notification.
- **Refund retry against the real operation layer (§7.2, cancel and refund operation contract).** These run through the real `paymentGatewayService` and `payment-operation-idempotency.ts` with a test adapter, never a stub that deduplicates by key. The adapter's `refund` blocks until the test releases it.
  - Overlap: a late success and a `repair-order-compensation` run refund the same `compensating` intent at once. The second call gets `409 payment_operation_in_progress`, is not treated as settled, and leaves the disposition `compensating`. After the adapter is released with a succeeded refund, the next repair run returns the recorded `refunded` result and moves the disposition to `compensated`. The adapter received one refund, and there is one `gateway_payment_operations` row for `checkout:<transactionId>:refund`.
  - Sequence: a reconciliation retry after a late success has already refunded returns the recorded result and issues no second adapter call. In a second variant the provider's webhook moves the transaction to `refunded` before the retry, so the replay answers a `409`; the retry reads `refunded`, settles, and issues no second adapter call.
  - Late success after compensation: an intent `compensated` on payment expiry (cancelled) later reports captured. The result reopens it to `compensating` and refunds it once. With the refund first answering `payment_operation_in_progress`, the disposition stays `compensating` and `repair-order-compensation` finishes it. A captured result for an intent already `refunded` is acknowledged and does not reopen it.
  - Lost lock with a refund in flight: the order is still cancelled and stock and credit released while the refund is pending; the session is `failed`; the disposition becomes `compensated` only once the provider reports the intent `refunded` (a recorded `pending` refund keeps it `compensating`, R41).
  - Same request: the lost-lock path, the late-success path and the repair worker send the same `amount` (omitted) and `reason`, so none of them gets `payment_operation_conflict`. A forced payload drift in a unit test raises `payment_operation_conflict`, the operational notification, no retry under another `operationId`, and the disposition stays `compensating`.
- **Payment result disposition (R23).**
  - Replay after normal completion: a session completes through a `success` webhook; the same webhook is delivered again and a poll reports success concurrently. Both are acknowledged, the order stays `confirmed`, the cart stays converted, and no `refundPayment`, `cancelPayment` or operational notification is issued.
  - Concurrent first delivery: a webhook and a poll deliver the same success at once; exactly one wins `published → completing`, the order is confirmed once and `markConverted` runs once.
  - Callback before publication: a gateway stub delivers `success` after 7a and before 7c. Nothing is confirmed, converted or refunded while the disposition is `setup`. When 7b succeeds, 7c publishes and then claims completion from the recorded status. When 7b answers `409 cart_lock_lost` instead, the intent is refunded once and the order cancelled. Both variants also run with the process killed before 7c, resolved by recovery.
- **Paid completion (R24).**
  - Duplicate before the first handler finishes: the completion owner is paused after `sales.orders.update` (confirmed) and before `markConverted`. A second `success` delivery and an `expire-awaiting-payment` run both read `completing` with a live lease and only acknowledge. The order is confirmed once, the cart converted once, one `checkout.session.completed` is emitted, and nothing is refunded.
  - Crash after conversion, before the final session write: the owner is killed after `markConverted` commits. No further callback is delivered. Once the lease expires, `recover-stuck-submits` takes the claim over, its `markConverted` gets `alreadyConverted: true`, and the intent and the session reach `completed` in one transaction. One `cart.cart.converted` and one `checkout.session.completed` exist. The same test runs with the kill before the `cart_converted` checkpoint.
  - Crash after confirmation, before conversion: recovery's fenced confirm answers `409 order_status_conflict` with `confirmed`, emits nothing, and recovery converts the cart.
- **Fencing after takeover (R25).** Each runs against the real `sales` and `cart` commands; the old owner is paused by a test hook, never simulated.
  - Takeover while the confirm is in flight: the first owner is paused inside `sales.orders.update` after it is called and before its transaction commits. Its lease expires, `recover-stuck-submits` takes the claim over, reads the order as `draft` and issues the same update. Then both owners are resumed, in each order (old commit first, new commit first). The order is `confirmed`; exactly one `sales.order.confirmed` and one `sales.order.created` staff notification exist; one `sales` payment is recorded; the cart is converted once; one `checkout.session.completed` is delivered. The old owner's next checkpoint write updates zero rows, it calls neither `markConverted` nor the final CAS, and the session is completed by the new owner's token.
  - The same test with the old owner paused inside `sales.payments.create`, and again inside `markConverted`: one payment row (the second create is refused by the unique index and counts as recorded) and one conversion (the second call is the replay).
  - The unique index itself: two concurrent `sales.payments.create` calls with the same `(order, operationKey)` produce one row and one order-totals recompute; the loser gets `duplicate: true` with the first row's id. The same key with a different amount answers `409 payment_operation_key_conflict`.
- **Paid-completion checkpoints (R36).** Against the real `sales` and `cart` commands.
  - Ordinary paid completion: a `success` webhook on an `awaiting_payment` session. Each of `order_confirmed`, `cart_converted` and the final `completed` write updates exactly one session row (asserted on the update counts) while the session is `awaiting_payment`, and the lease is extended with each checkpoint. The order is confirmed, the cart converted, and the intent and the session reach `completed` in one transaction.
  - Takeover after confirmation: the owner is killed right after its `order_confirmed` checkpoint. Once the lease expires, `recover-stuck-submits` takes the claim over, does not confirm again (no second `sales.order.confirmed`), converts the cart, writes `cart_converted` with its own token and completes the session. A paused variant of the old owner resumes afterwards: its next checkpoint updates zero rows on the transaction, and it calls nothing further.
- **Payment operation key compatibility (R28).** Against the real `sales` commands and migration:
  - Legacy repeated references: a database seeded with two payments on one order sharing a `paymentReference` (and no key) migrates cleanly; the index exists afterwards.
  - Existing callers: `POST /api/sales/payments` without `operationKey` twice on one order with the same `paymentReference` creates two payments, as on `main`.
  - Concurrent opt-in creates: N=10 parallel `sales.payments.create` calls with the same `operationKey` on one order create one row; every caller receives that row's id. The same key on another order is independent.
  - Undo of a keyed create keeps the key retired: the ledger row stays with a null `payment_id`, and a create with that key answers `409 payment_operation_key_retired`; redo restores the original row under its original id and key and sets the ledger's `payment_id` back. The same for `sales.payments.delete` and its undo.
  - **Undo → repair retry → redo (R34):** checkout records the payment, its `payment_recorded_at` write is forced to fail, and staff undo the payment. `repair-gateway-payments` then retries: it gets `payment_operation_key_retired`, creates no payment, sets `payment_recorded_at`, writes the `payment_removed_after_record` event and raises one ops notification. Redo then restores the original payment. One payment row has ever existed for the key, the order's paid total matches the capture again, and later repair runs do nothing.
  - Unkeyed payments write no ledger row, and their undo, redo and delete behave as on `main`.
- **Terminal-event delivery (R26).**
  - Crash after commit, before delivery: the process is killed after the `completing → completed` transaction commits and before the first emit. No callback is delivered. The session is `completed` with both entries in `pending_events`; the next `recover-stuck-submits` run emits `checkout.payment.succeeded` and `checkout.session.completed` once each and clears `pending_events`. The same test kills the process between the two emits: only the second is delivered by the sweep (the first is re-delivered only when the kill falls after its emit and before the clear, and the test subscriber deduplicates it on `(eventId, sessionId)`).
  - The same crash for the `on_account` completion (step 8), the quote outcome (step 5c) and a payment failure (`checkout.payment.failed`).
  - A replayed success webhook for that `completed` session while `pending_events` is still set acknowledges and emits nothing; only the sweep delivers.
- **Terminal-event acknowledgement (R29).** With the real event bus and a persistent test queue:
  - Enqueue failure, then a successful sweep: the queue's `enqueue` is made to throw for the first `checkout.payment.succeeded`. The completion still commits; both entries stay in `pending_events` and nothing is enqueued for `checkout.session.completed`. Once the queue is restored, the next sweep enqueues both in order and clears them, and the persistent test subscriber receives each once.
  - Crash between the two completion events: the process is killed after `checkout.payment.succeeded` is enqueued and removed, and before `checkout.session.completed` is enqueued. Only `checkout.session.completed` remains pending; the sweep delivers it. In a second variant the kill falls after the first enqueue and before its removal; the sweep enqueues it again and the subscriber deduplicates on `(eventId, sessionId)`.
  - Subscriber failure: a persistent subscriber throws on its first delivery. The entry was already removed after the enqueue; the events worker retries the job and the subscriber receives the event. An inline emit is never used for a terminal event (asserted by spying on `emit` options).
  - A writer and a sweep delivering the same session at once remove each entry once (the conditional head removal) and keep the order.
- **One settlement predicate (R27).**
  - Lost lock with the cancel in flight: step 7b answers `cart_lock_lost` and `cancelPayment` answers `payment_operation_in_progress`. The session is `failed`, the order cancelled, and the disposition stays `compensating`; the next `repair-order-compensation` run gets the recorded result and only then sets `compensated`. With the cancel failing instead, the disposition stays `compensating` and the repair worker retries it with the same request.
  - Payment expiry while `pending`: `expire-awaiting-payment` reads `pending`, cancels the intent and fails the session with `payment_expired`. With the cancel in flight or failing, the session is `failed` and the disposition stays `compensating` until the repair worker settles it. With the gateway reporting `expired`, no gateway call is made and the disposition becomes `compensated` once §7.3 is done.
  - A unit test asserts that every code path writing `compensated` goes through the single settlement-predicate helper.

**Price, delivery and consistency:**
- When a promotion expires mid-checkout, submit returns `409 price_changed`, releases any acquired cart lock and starts no reservation, document or payment (R4).
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
- **Kill between the slot increment and the cart lock (R30):** on a link at `maxCompletions − 1`, a process killed after step 0 commits and before `cart.lock` leaves `link_slot_attempt` set and the cart unlocked; `recover-stuck-submits` reopens the session and releases the slot in one write (`completion_count` back to `maxCompletions − 1`); the buyer's retry completes. Running recovery twice decrements once.
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
| `cart` (cart spec §9.1) | **Attempt fence, a CH4 prerequisite.** The Cart spec must specify, and Cart must ship, the §6 attempt-scoped lock before checkout relies on it. That covers the optional `checkoutAttempt` input on `lock`, `extendOnly`, `getSalesSnapshot`, `unlock` and `markConverted`; a nullable lock-attempt column written and cleared with the holder session under the cart row lock (an additive migration); every holder predicate matching the `(checkoutSessionId, checkoutAttempt)` pair in the conditional write; legacy callers that omit the attempt keep today's session-only behavior on an unversioned lock, and never match an attempt-scoped one; the attempt persisted with the conversion identity, so the same-document replay matches it after the lock fields are cleared; and `getCheckoutView` returning the holder's attempt. The Cart release gate needs a real-Cart regression for each predicate: an old attempt's unlock, extend, snapshot read and conversion against the next attempt's live lock all answer the holder mismatch and leave that lock intact. A replay of the same attempt still converts once. The text lands in the Cart spec on #9999 (session-only today) and not in this PR, which does not edit the Cart spec. Also: lock contract of §6 ( `lockTtlMs`, `purpose`, same-session extend of a live lock, atomic `extendOnly` answering `409 cart_lock_lost`, `checkoutSessionId` on `unlock`/`markConverted`, `lineMap`; on a lapsed lock `markConverted` and `getSalesSnapshot` answer the uniform `404`, D-R5-CA11, pending #9999); `markConverted` replay for the same session and document returning `alreadyConverted: true` (D-R5-CA12, pending #9999), relied on by paid completion (§7.2); trusted pay-link creation with `salesChannelId` | CH1a, CH3, CH4, CH5a, CH5b |
| `sales` | `sales.orders.update` accepts `expectedStatusEntryId`: on a mismatch under the row lock (`lockOrderForTotalsWrite`) it writes and emits nothing and answers `409 order_status_conflict` with the current status (§7.3, transition fencing); `salesDocumentLookupService` (§3.3); index `sales_orders (tenant_id, external_reference)` (D-R5-CH1); index `sales_quotes (tenant_id, external_reference)` (D-R5-30); `quoteCreateSchema` gains `externalReference`/`customerReference`; `orderCreateSchema` gains `suppressStaffNotification?: boolean`, and an order created with it sends its `sales.order.created` staff notification at first confirmation instead of at create, decided by the same locked previous-status read that emits `sales.order.confirmed` (D-R5-CH8, §7.2 "Fencing at the write boundary"); the shared line schemas accept snapshot `null`s for order and quote lines; `sales.payments.create` gains the opt-in `operationKey`, enforced atomically by the unique index `(order_id, operation_key) WHERE operation_key IS NOT NULL` and answered with `duplicate: true`, reserved for life by the `sales_payment_operation_keys` ledger that undo, redo and delete keep in step (`409 payment_operation_key_retired` after an undo or delete), `paymentReference` unchanged (§7.2, payment operation key); `sales.order.cancelled` emitted on every cancellation path, including an undo that re-cancels (#8404, #8406); with `expectedStatusEntryId`, a cancel awaits the persistent enqueue of `sales.order.cancelled` (step SA2a) and the fenced replay on an already-cancelled order enqueues it again, `503 order_event_not_enqueued` when the queue refuses (§7.3, durable cancellation event); `orderCreateSchema` and `quoteCreateSchema` gain the opt-in `creationKey`, enforced by the never-deleted `sales_document_creation_keys` ledger and answered with `duplicate: true`, kept in step by undo, redo and delete (`removed`), the command `sales.documents.retire_creation_key` and `salesDocumentLookupService.findDocumentByCreationKey` (§7.2, document creation key), `externalReference` unchanged; every `sales.order.cancelled` and its fenced replay carry `transitionId` | CH4, CH5a, CH5b |
| `promotions` (SPEC-055) | `UseCodeInput.orderId`; the `sales.order.cancelled` subscriber running `revertUsage`/`revertCodeUse` by `orderId`; `revertCodeUse?` optional; delivery promotions authorable | CH2b, CH4 |
| `customer_groups` (customer-groups spec) | `linkCreditReservationToOrder`, the row-locked `reserveCredit`, approval service and events, the new terms | CH6a, CH6b |
| `ecommerce` (SPEC-029) | `resolveForBuyer` with optional store; the store context's default sales channel id; `EcommerceStoreSettings.shipping` optional with `flatRate` and `taxRate` | CH1a, CH2a, CH3 |
| `wms` | `wmsWarehouseLookupService.getPrimaryWarehouseAddress` | CH2a |
| `wms` | `releaseInventoryForCancelledOrder` re-reads the order's status (`isSalesOrderCancelled`) and releases nothing for an order that is no longer cancelled, so a replayed or late `sales.order.cancelled` cannot release a revived order's stock (§7.3, durable cancellation event) | CH4 |
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

**Merge gate with #9998 (review of #10000).** #9998 also revises this spec and runs on the same names. Its confirmation boundary and transition fencing, its conversion pending, its repair probe and its conditional checkpoints are ported here unchanged in name and meaning; this PR's lock protocol (atomic `extendOnly`, lost lock after the intent, the paid-completion claim), its payment deduplication and its terminal-event delivery are the ones #9998 adopts. Whichever PR merges into `main` first, the other one MUST keep every rule below when it merges after it, and no checkout step from CH4 onward starts until `main` contains all of them:
- **Schema.** §4.1 `link_slot_attempt`; `submit_progress` values `order_confirmed` and `cart_converted`, with a `completed` session at `order_confirmed` meaning a pending conversion; `failure_code = 'cart_conversion_lost'` allowed on a `completed` session.
- **Confirmation boundary and transition fencing (§7.3).** Once a confirm has committed, no path cancels the order. Every checkout confirm (step 8a, paid completion step 2) and every cancel (submit path, §12.1 recovery, `repair-order-compensation`) passes the new optional `expectedStatusEntryId` of `draft` on `sales.orders.update`. It is checked under `lockOrderForTotalsWrite`; on a mismatch the command writes and emits nothing and answers `409 order_status_conflict` with the current status. The losing-caller outcomes: a confirm that loses stops, writing no checkpoint; a cancel that loses releases nothing and moves the session to `order_confirmed`; a `failed` session is promoted `failed → completed` in one conditional write that clears `failure_code` and `failure_detail`.
- **Checkpoint writes (§7.3).** Every `submit_progress` write is pinned to the attempt, an eligible status and the expected prior checkpoint, per the §7.3 table; a write that matches no row has lost, and the caller re-reads and never overwrites newer state.
- **Conversion pending (§7.3).** A confirmed order whose `markConverted` answers 404, or fails after 3 in-process retries, completes the session at `order_confirmed`. A 404 adds `cart_conversion_lost`, which is written only after a 404. `409 cart_already_ordered` on session create and submit (§7.1 precondition 3, §9.0, §9.2) while such a session exists. `repair-order-compensation` uses `markConverted` as its probe, reading no cart state first.
- **Lock, payment and events (this PR).** `extendOnly` for every extend and as the recovery probe (it replaces #9998's "cart status and lock holder" probe in the `finalized` rows); the `checkout_disposition` dispatch and the paid-completion claim; payment deduplication by the opt-in `sales.payments.create` `operationKey` (`checkout:<transactionId>:payment`) with the unique index `(order_id, operation_key) WHERE operation_key IS NOT NULL`, `duplicate: true` and `409 payment_operation_key_conflict`, never a rule on `(order, paymentReference)`; the `sales_payment_operation_keys` ledger and `409 payment_operation_key_retired`; terminal events emitted enqueue-only (`persistent: true, deliverInline: false`), with a `pending_events` entry removed only after its enqueue resolved.
- **Recovery (§12.1).** The rows for null, `locked`, `finalized` with a gateway method, `finalized` with `on_account`, `order_confirmed`, `cart_converted`; the payment-TTL row for gateway methods only; the payment-method branch and the pay-link slot paragraph.
- **Tests and risks.** R30–R34 with the same numbers in both specs (#9998 carries R30–R33 and adopts R34 with the ledger), and the §16 kill cases: between the slot increment and the cart lock, after `finalized` (`on_account`), after the confirmation, lock swept after the confirmation, conversion failure, conversion replay with a missing checkpoint or for a different order, the confirm/cancel race in both commit orders, the repair crash between conversion and checkpoint, the stale recovery resuming after completion, the failed session promoted and then killed, and undo → repair retry → redo.
- **Dependency.** Both PRs rely on the cart's same-session, same-order conversion replay (`alreadyConverted: true`, D-R5-CA12) and on its extend-only lock (`cart.lock({ extendOnly: true })`, `409 cart_lock_lost`, D-R5-CA11), which land with #9999; CH5a and CH5b do not start before they are on `main`. The cart spec text is #9999's alone: this PR does not edit `2026-08-14-cart-module.md`.
- **Stalled compensation and gateway checkpoints (this PR, v2.4.5).** The `compensated` checkpoint and the `failure_code` recorded with `compensating`; `recover-stuck-submits` resuming a `submitting` or `awaiting_payment` session at `compensating` (§7.3, stalled compensation; §12.1 `compensating` row), with `repair-order-compensation` kept to `failed` sessions; the paid-completion rows of the §7.3 checkpoint table (eligible status `awaiting_payment`, the claim token on the transaction row in the same database transaction); the atomic published-intent compensation claim and session checkpoint, R35 and R36 and their §16 tests.

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
**Prerequisites:** CH1b; the cart's trusted pay-link path (D-R5-19); `resolveForBuyer` with optional store (D-R5-22); `buildTrustedCommandContext` (shared, D-R5-CH7). **Gate:** a template line without an override prices per buyer; the guest fallback for no customer session, no `storeContextService`, a service without `resolveForBuyer` and a refused call each seed a guest cart with no stored buyer identifiers that prices at the template's channel prices; mixed-currency templates rejected through the command; the request body cannot add lines; a tokenless create consumes no slot.

### CH4 — Submit saga I: direct order creation and compensation
The §7.2 steps 0–6 as commands: the pay-link slot reservation with `link_slot_attempt` and its conditional release (§4.3), lock, snapshot self-check and `sales`-computed payable, stock reserve, document creation with `sales.orders.create` and the field mapping (D-R5-CH1), the persisted-totals check, commit, code use with `orderId`, usage registration; the §7.3 compensation with `compensating`, the fenced cancel and the conditional checkpoint writes; the ops notification type (§10.1). Exact decimals; nested commands on the caller's transaction.
**Prerequisites:** CH2b; availability Phase 3 (`reserve`/`release`/`commit`, D-R5-8…10); the Cart attempt fence of §16 (cross-module requirements), shipped with its real-Cart cross-attempt and replay regressions, before any CH4 code relies on `checkoutAttempt`; the cart lock contract and `getSalesSnapshot` with metadata; `salesDocumentLookupService`, both `sales` indexes, the line-schema widening, the quote-create fields and `sales.orders.update` `expectedStatusEntryId` with the durable cancellation event (which needs step SA2a's persistent `sales.order.cancelled`); the `creationKey` and its ledger with `sales.documents.retire_creation_key`; promotions `UseCodeInput.orderId` and the cancellation subscriber; the container hand-off (shared). **Gate:** the percentage-code-with-tax case for every payment method; the full field mapping on the order; no quote notification; an injected failure at each of steps 1–6 compensates completely; the step 6c transaction boundary of §7.5 proven with the real promotions handlers; the crash right after the step 5c compensation checkpoint (R40); stale acquisition after a reopen (§6).

### CH5a — Submit route, replay, return URLs, payment recording
`POST /sessions/current/submit` and `GET /sessions/current/result` with the §9.3 schemas; `Idempotency-Key` replay (§7.4); step 7 (the attempt's `CheckoutTransaction` before the provider call, the intent with the attempt's `paymentId` and `idempotencyKey`, `extendOnly` lock extension, publication, hand-off); the `checkout_disposition` dispatch, the paid-completion claim and the cancel and refund operation contract (§7.2); the return-URL rule; the `checkout_transactions` columns, nullable `link_id` and the link-less `updateStatus` branch (§14a rows 15, 17); the session resume in the gateway subscribers; payment recording with `sales.payments.create`; submit rate limits. `/result` is new work.
**Prerequisites:** CH0b, CH4; the `sales.payments.create` `operationKey` and the `sales_payment_operation_keys` ledger (§7.2, payment operation key); the cart's conversion replay (#9999). **Gate:** the B2C happy path end to end with a recorded payment; the payment operation-key compatibility cases (R28) and undo → repair retry → redo (R34); concurrent double submit creates one order; same-key replay returns the same body, including an earlier attempt's key after a later attempt started (§4.5); unsafe return URLs refused. Each B.4 gateway path stays disabled until its settlement and expiry cases in §16 pass, including the pending refund cases (R41). Discovery, `/payment` and direct submit fail closed with `422 payment_method_unavailable` while they are missing (§12.1).

### CH5b — Recovery and repair workers
`recover-stuck-submits` (§12.1, order-level probe), `expire-awaiting-payment`, `repair-gateway-payments`, `repair-order-compensation`, all registered by `ensureCheckoutSessionSchedules`; reads with `findWithDecryption`, errors with `isCrudHttpError` and `reportError`.
**Prerequisites:** CH5a; the container hand-off for workers. **Gate:** a process killed after each step, including right after order creation, is reconciled without a duplicate order and without releasing a live order's holds; a payment-recording failure and a failed cancellation are each repaired; the lost-lock, refund-retry and paid-completion cases of §16 pass, including the crash after conversion with no further callback; the fencing-after-takeover, terminal-event-delivery and settlement-predicate cases of §16 pass (R25–R27); the terminal-event acknowledgement cases pass (R29); a kill between the pay-link slot increment and the cart lock releases the slot once (R30); the conversion-pending, repair-probe and promotion cases pass (R32, R33); the lost-cancellation-event, create-in-flight and provider-accepted-before-linkage cases pass (R37–R39).

### CH6a — On-account credit, PO number, minimum order, quote requests
`on_account` and `request_quote` in `/payment-methods`; credit reserve, link and release (§8.3); PO required and format checks (§8.4); `min_order_value` (§8.5); the quote branch with `sales.quotes.create` (§8.6).
**Prerequisites:** CH5b; customer-groups Phases 3–4 (row-locked credit service, new terms); the cart's `purpose: 'quote'` (D-R5-23). **Gate:** the N=20 parallel on-account test on real Postgres; the PO number on the order; the quote outcome with a quote `lineMap`; on-account kills after `finalized` and after the order confirmation resume step 8 without a gateway call (§12.1, R31); the confirm/cancel race passes in both commit orders, and the stale recovery stops (R33).

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
5. **Outstanding operations at expiry** — approve the supported sales and gateway reconciliation and the late-capture/buyer outcome when holds have expired (§12.1). This blocks enabling B.4 for that scenario.
6. **Discounted quote acceptance** — determine what the merchant/buyer must do when a previously quoted code or discount can no longer be honored. The sales hook must refuse conversion without allocating the entire discount (§8.6).

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
  - AC: the cart rejects mutation while locked with `423 cart_locked` and the session id. After the bounded expiry the cart may be editable, but an unresolved checkout attempt prevents another submit (§12.1).
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

**R1** (payment without an order), **R3** (leaked reservation), **R7** (credit overshoot), **R10** (rate-quote abuse), **R12** (duplicate document) and **R13** (codes and budgets) have no buyer-facing or admin-facing state of their own. They are mitigated by the conditional status update, the idempotency keys and the document creation key, the credit row lock, the pre-payment usage registration and rate limiting — mechanisms, not screens.

---

## 21) Changelog

### 2026-11-21 — v2.4.8 (reconciled with #9691; review 6002336743)

Merge of `main` after #9691 (`2d4778b127`, "close the checkout submit path and the cart lock contract") and the re-review of #10000 (@haxiorz, 2026-11-21 02:42, [review](https://github.com/open-mercato/open-mercato/pull/10000#pullrequestreview-6002336743)).

- **Reconciliation with #9691.** This revision keeps v2.4's direct order (D-R5-CH1), the write-boundary fencing, the payment disposition and recovery without a fresh lock (D-R5-SF4). From #9691 it carries forward: per-attempt result replay (new §4.5 `checkout_session_attempts`, as the replay record only); the partial unique one-live-session index (§4.1); the partial link-bound idempotency index and the session-scoped one (§4.4); atomic promotion allocation and code consumption at step 6c (new §7.5); releasing an acquired lock on `price_changed`; the gateway activation gate and the rule that unresolved outcomes, including an expired lock, are not failure (§12.1); the link-backed event contract (§10); and the discounted quote conversion gate (§8.6). Not adopted: #9691's quote-then-convert order path (replaced by D-R5-CH1), `owner_generation`/`claimed_until` ownership on the attempt row (the session's attempt-pinned checkpoints and the Sales/gateway identities fence instead), and rebuilding a recovery cart context through `resolveForBuyer` (D-R5-SF4). The trusted-context path stays `commands/trusted-context` (D-R5-CH7).
- **§4.4, §14a row 15 (blocker).** The existing transaction list and detail routes stay link-backed (`link_id IS NOT NULL`), so `linkId` stays a string in every existing response. Session payments are read through admin `GET /api/checkout/sessions/:id`.
- **§7.3, §12.1, §16, R40.** The first compensation checkpoint stores `sales_order_id`, so a crash between the step 5c checkpoint and the Sales cancel cannot strand the draft order. Recovery falls back to the creation-key ledger.
- **§7.2 operation contract, §12, §16, R41.** A refund is settled only by a terminal provider status, never by a recorded `pending` result. A pending refund keeps the intent in the repair scan under the same identity. A failed refund issues no automatic second refund.
- **§6, §16 cross-module requirements, CH4.** The Cart attempt fence (migration, holder predicates, the legacy optional input, the replay identity) is an explicit CH4 prerequisite, with a real Cart regression. Stale acquisition after a reopen is cleaned up by the attempt's own pair.
- **§4.3, CH3.** Pay-link seeding falls back to a guest cart when the service or method is absent or the call is refused (SPEC-029 §6.3).

### 2026-11-20 — v2.4.7 (attempt-scoped cart locks and permanent key retirement)

- §§6, 12.1, 14a and 16 require a Cart holder match on the session and submit attempt, including stale reopen recovery.
- §§7.2 and 16 serialize restoration and retirement of removed Sales creation keys and cover both commit orders.

### 2026-11-20 — v2.4.6 (durable cancellation event, document creation key, payment session identity)

Re-review of #10000 (@haxiorz, 2026-11-20 21:15, [review](https://github.com/open-mercato/open-mercato/pull/10000#pullrequestreview-5999515107)).

- §7.2 (cancel note), §7.3 (5c–8a row, "the same transition twice", new "Durable cancellation event"), §9.2, §12.1 `compensating` row, §14a row 3, §15 R37, §16, §17 CH4 (finding 1, high): `sales` starts the lifecycle emit after the status commit without awaiting it, so a crash before the enqueue lost `sales.order.cancelled` and the resume completed the compensation with the order's stock, credit and promotion usage still held. With `expectedStatusEntryId`, a cancel now awaits the persistent enqueue (step SA2a) before answering, the fenced replay on an already-cancelled order enqueues the event again, and a refused enqueue answers `503 order_event_not_enqueued`. Checkout writes `compensated` only after one of those answers, so the `compensating` checkpoint records the owed event. The releasing subscribers are persistent and state-based, so a replay is an at-least-once duplicate. Callers without the input and every confirm are unchanged. Test: a kill between the Sales commit and the enqueue with resources already linked.
- §7.2 step 5 and new "Document creation key", §7.3 5a/5b row, §9.2 `submit_interrupted`, §12.1 (`null`, `locked`, `stock_reserved`/`credit_reserved` rows, new "Reopen fence"), §14a row 26 and upgrade step 1, §15 R12 and R38, §16, §17 (finding 2, high): a lookup miss by `external_reference` no longer decides that no document exists. Every create carries the opt-in `creationKey = documentRef`, enforced by the never-deleted `sales_document_creation_keys` ledger, and recovery calls `sales.documents.retire_creation_key` before it releases anything or reopens the session. The two serialize on the key: a create after a retirement is refused (`409 document_creation_key_retired`), and the live submit releases its own holds by key and answers `409 submit_interrupted`; a create that committed first makes the retirement return the document, and recovery resumes forward. `externalReference` keeps its contract, and callers without a key are unchanged. Tests: a submit paused inside its Sales create overlapping the sweeper, in both commit orders, for orders and quotes.
- §4.4, §7.2 step 7a and new "Payment session identity", disposition table `setup` row, §12.1 `finalized` gateway and payment-TTL rows, §14a row 2, §15 R39, §16, §17 CH5a (finding 3, high): the attempt's `CheckoutTransaction` commits before any provider call (unique per order, so one row per attempt), and the submit and recovery both call `createPaymentSession` with that row's id as `paymentId` and the deterministic `idempotencyKey`, reusing `payment_gateways`' existing session-initialization claim. A row without a recorded intent is resolved by re-sending the same creation before anything reverses it. Tests: a crash after provider acceptance and before linkage, and an overlapping submit and sweep.
- Same revision, independent consistency pass: a reopen is claimed by a conditional `reopening` checkpoint and its winner releases, unlocks and writes `open`, with attempt-scoped Cart guards for a stale takeover (v2.4.7) and no nested command announces a release that rolls back; the creation-key ledger keeps a `removed` state through undo, redo and delete, and step 5a and the totals read-back go through `findDocumentByCreationKey`, never a repeatable `externalReference`; a replayed `sales.order.cancelled` carries the original `transitionId` and `previousStatus: draft`, and `wms` re-reads the order status before releasing (new `wms` requirement); a `compensating` row without a recorded intent is resolved by the same identity in the lost-lock path and in `repair-order-compensation`. §7.4, the §12.1 intro, the TLDR, §16 G1 and lost-lock tests and the story-map risk note no longer describe the `external_reference` lookup as the guard.

### 2026-11-20 — cart text left to #9999

- This PR no longer edits `2026-08-14-cart-module.md`. Its earlier rev 10.1 cart hunk (the extend-only mode, `cart_lock_lost`, and a test numbered `TC-CART-LOCK-07`) is superseded by #9999 (cart rev 10.1, D-R5-CA10, D-R5-CA11), which owns the cart spec. On a lapsed lock, a same-session `lock` without `extendOnly` is a fresh lock and never an extend. The extend-only test is `TC-CART-LOCK-09`. `markConverted` and `getSalesSnapshot` answer the uniform `404`, which checkout already reads as "this session no longer holds the cart" (§7.3 conversion pending, §12.1). `409 cart_lock_lost` is the `extendOnly` answer only. §16 cross-module requirements and the §17 dependency now name #9999 for the extend-only lock.

### 2026-11-20 — Gateway compensation claim recovery

- §7.2, §12 and §16: publish the gateway compensation claim and session recovery checkpoint atomically before calling the gateway or Sales. Cover a crash immediately after the claim.

### 2026-11-20 — v2.4.5 (stalled compensation resumed, paid-completion checkpoints in the gateway session state)

Re-review of #10000 (@pkarw, 2026-11-20 14:45, [review](https://github.com/open-mercato/open-mercato/pull/10000#pullrequestreview-5994473853)).

- §4.1, §4.4, §7.3 (5c–8a row, transition fencing, checkpoint table, new "Stalled compensation"), §12, §12.1 `compensating` rows, §16, R35, §17 merge gate (finding 1, high): a compensation interrupted between its `compensating` checkpoint and the session's terminal write is resumed. `recover-stuck-submits` selects `submitting` and `awaiting_payment` sessions at `compensating` after 120 s and repeats the fenced cancel: transitioned or already `canceled` → keyed releases and one terminal write conditional on `compensating`; `confirmed` → release nothing and continue on the confirmed path (`on_account`), a defect for a gateway session; still failing → `failed` at `compensating` for `repair-order-compensation`. The cause is recorded in `failure_code` with the `compensating` checkpoint, so the resumer fails the session with the same code. A new `compensated` checkpoint marks the finished compensation, and the settlement predicate reads it. `repair-order-compensation` writes `compensated` when it finishes. Crash tests on both sides of the Sales commit, the confirm-won case, the gateway variant and an overlapping slow caller.
- §4.1, §7.2 paid completion and fencing "Checkpoints" row, §7.3 checkpoint table, §12.1 takeover row, §16, R36 (finding 2, high): paid completion writes its checkpoints in the session's real state. New table rows: `order_confirmed` from `payment_initiated` and `cart_converted` from `order_confirmed`, both eligible in `awaiting_payment`, and the final `awaiting_payment → completed` from `cart_converted` (or `order_confirmed` under conversion pending). Each is written in one database transaction with the lease extension on the transaction row (`checkout_disposition = 'completing'` and the claim token), and both updates must match one row. The `compensating` checkpoint is also eligible in `awaiting_payment`, for payment failure and expiry. Tests: an ordinary paid completion asserting one row per checkpoint, and a takeover after confirmation. Supersedes v2.4.4's `payment_initiated` prior on the `submitting`-only `order_confirmed` row.

### 2026-11-20 — v2.4.4 (fenced confirm and cancel, conversion pending, a durable payment operation key, merge gate with #9998)

Re-review of #10000 (@pkarw, 2026-11-20 13:57, [review](https://github.com/open-mercato/open-mercato/pull/10000#pullrequestreview-5993808752)), and convergence with sibling PR #9998 (`cbbb03ebd0`, its §17 "Merge gate with #10000").

- §7.2 step 8 and paid completion step 2, §7.2 fencing rows 2 and "Checkpoints", §7.3, §12, §12.1 `finalized`/`on_account` and `order_confirmed` rows, §14a row 3, §16, R33 (finding 1, high): on-account confirmation and recovery cancellation are mutually exclusive at the write boundary. Every checkout confirm and cancel passes the new optional `expectedStatusEntryId` of `draft` on `sales.orders.update`, checked under `lockOrderForTotalsWrite`; a mismatch writes and emits nothing and answers `409 order_status_conflict`. The loser is defined: a losing confirm stops and writes no checkpoint; a losing cancel releases nothing and hands the session to the confirmed path; a `failed` session is promoted `failed → completed` in one conditional write that clears the failure fields. Every `submit_progress` write is pinned to the attempt, an eligible status and the expected prior checkpoint. Test: a paused submit overlapping the lost-lock recovery branch in both commit orders. Supersedes v2.4.3's "read the order, then confirm" step 8a and the unfenced cancel.
- §3.3, §7.2 "Payment operation key" and "Payment recording", fencing row 1, §9.2, §10.1, §14a row 6 and upgrade step 1, §16, R25, R34 (finding 2, medium): the operation key is reserved for life. On `main` undo of a create and `sales.payments.delete` hard-delete the row, so the key is also kept in a never-deleted ledger, `sales_payment_operation_keys`, unique on `(order_id, operation_key)`. Undo and delete null its `payment_id`; redo and undo-of-delete set it back. Reuse is never allowed: a create with a retired key answers `409 payment_operation_key_retired`. Redo therefore always restores the original row and never meets a replacement. Checkout counts a retired key as recorded, sets `payment_recorded_at`, and notifies ops. Test: undo → repair retry → redo. Supersedes v2.4.3's "undoing a create frees the key".
- Ported from #9998 (same names): the confirmation boundary; transition fencing; conversion pending with `409 cart_already_ordered` (§7.1 precondition 3, §9.0, §9.2) and `cart_conversion_lost`, written only after a 404; `markConverted` as the repair-job probe; the conditional checkpoint table; R32 and R33 with #9998's numbers. Replaces v2.4.3's "complete without converting" outcome of the `order_confirmed` row. #10000's `extendOnly` probe stays in the `finalized` rows, as #9998's merge gate states.
- §17: a "Merge gate with #9998" section mirroring #9998's "Merge gate with #10000", so both specs carry the same rules whichever merges first; the #9999 conversion replay is named as a dependency of CH5a and CH5b. CH4, CH5a, CH5b and CH6a gates updated.

### 2026-11-20 — v2.4.3 (opt-in payment operation key, terminal-event acknowledgement, pay-link slot and on-account recovery)

Re-review of #10000 (@pkarw, 2026-11-20 13:30, [review](https://github.com/open-mercato/open-mercato/pull/10000#pullrequestreview-5993446937)), plus two recovery gaps found on sibling PR #9998 (`c25147c899`).

- §3.3, §7.2 fencing row 1 and "Payment operation key", §14a row 6 and upgrade steps, §16 cross-module requirements, CH5a, R21, R25, R28 (finding 1, high): payment deduplication no longer changes the `paymentReference` contract. `sales.payments.create` gains an opt-in `operationKey`, which only checkout sends (`'checkout:' + transactionId + ':payment'`). The unique index is `(order_id, operation_key) WHERE operation_key IS NOT NULL`, so legacy rows (all null) cannot block the migration and existing callers see no new error. A duplicate rolls the insert back and returns `duplicate: true` with the existing id; a mismatched amount answers `409 payment_operation_key_conflict`. `findPaymentByReference` becomes `findPaymentByOperationKey`. Supersedes v2.4.2's partial unique index on `(order_id, payment_reference)` and its Warning row.
- §4.1 `pending_events`, §10 "Terminal events", §10.1, §12 terminal-event sweep, R26, R29 (finding 2, medium): an entry is acknowledged by persistent-queue acceptance, never by an inline emit. Terminal events are emitted enqueue-only (`persistent: true, deliverInline: false`); each entry is removed head-first by a conditional update only after `enqueue` resolved; a failed enqueue leaves it and the rest pending for the sweep; subscriber failures are retried by the events worker. Terminal-event subscribers are persistent. Supersedes v2.4.2's "emits each entry in order, then clears the delivered entries".
- Ported from #9998 (same names, so the two PRs converge): §4.1 `link_slot_attempt` and the on-account use of the checkpoints `order_confirmed` and `cart_converted`; §4.3 and §7.2 step 0, where the slot increment commits with the `open → submitting` CAS and `link_slot_attempt = attempt`, and the release is one conditional write on the session row independent of the cart lock; §7.2 step 8 split into idempotent 8a–8c; §12.1 null and `locked` rows release the slot whatever the cart holds; `finalized` branches on `payment_method_code`; new `on_account` rows `finalized`, `order_confirmed` and `cart_converted`; the payment-TTL row applies to gateway methods only. Unlike #9998, the rows do not read the cart status and lock holder. The null and `locked` rows use the holder-conditional `unlock`, `finalized` (`on_account`) probes with `cart.lock({ extendOnly: true })`, and `order_confirmed` probes with `markConverted`'s same-session replay. #9998's R22 and R23 are R30 and R31 here, because R22 and R23 were already taken.
- §16: the operation-key compatibility cases (legacy repeated references, existing callers, concurrent opt-in creates, undo/redo); the acknowledgement cases (enqueue failure then sweep, crash between the two completion events, subscriber failure, concurrent deliverers); the slot kill test; on-account kills after `finalized` and after the confirmation. CH4, CH5a, CH5b and CH6a gates updated.

### 2026-11-20 — v2.4.2 (write-boundary fencing, durable terminal events, one settlement predicate)

Re-review of #10000 (@pkarw, 2026-11-20, [review](https://github.com/open-mercato/open-mercato/pull/10000#pullrequestreview-5989910980)).

- §7.2 "Fencing at the write boundary", §7.2 payment recording, §14a row 6, §16 cross-module requirements, R25 (finding 1, high): the completion lease no longer carries correctness. Each irreversible step is deduplicated where it commits: the order confirm by `sales`' row lock and locked previous-status read (one `sales.order.confirmed`, one deferred staff notification); the payment by a partial unique index on `(order_id, payment_reference)`; the cart conversion by the cart's conditional transition and replay; checkpoint writes conditional on the claim token, so a stale owner stops at its next write. The lease check stays as an optimisation. Checkout never emits or re-emits `sales.order.confirmed`.
- §4.1 `pending_events`, §7.2 steps 5c, 8 and paid completion step 4, §10 "Terminal events", §12 `recover-stuck-submits`, R26 (finding 2, medium): terminal events are written into `checkout_sessions.pending_events` in the terminal transaction and delivered by the writer, then by a sweep. Delivery is at least once; subscribers deduplicate on `(eventId, sessionId)`. Supersedes v2.4.1's "then emit … once, because only the winner of this CAS emits".
- §4.4 settlement predicate, §7.2 step 7b, the `published` failure/expiry row, lost-lock step 6, §12 `expire-awaiting-payment` and `repair-order-compensation`, R27 (finding 3, medium): every path that compensates an intent sets `compensated` only when the reversal is settled and §7.3 is done. A `pending` intent at expiry is cancelled. A reversal in flight or failed keeps `compensating` and its retry owner after the session has failed. Supersedes v2.4.1's "compensate (§7.3, cancel order); disposition = compensated" in step 7b and the `published` row.
- §16: takeover with the old command in flight (confirm, payment, conversion; both resume orders); the payment unique index; a crash after commit before delivery, for the paid, `on_account`, quote and failure paths; a lost lock and an expiry with the reversal in flight or failing. CH5b gate extended.

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

### 2026-11-20 — transaction event compatibility and payment activation (#9691, carried forward in v2.4.8)

- **§4.4/§10/§16.** Preserve the existing link-backed event payloads, link counters and subscriber behavior. Linkless sessions use scoped payment and session events. Cover both paths and callback/poll replay.
- **§5.5/§6/§12.1/§16/§17.** Make the lock deadline explicit and keep B.4 gateway paths disabled until their approved expiry cases pass. Cover direct submit and method-selection refusal with the existing error.

### 2026-11-20 — submit and cart reconciliation (#9691, partly superseded by v2.4.8)

- Carry forward per-attempt result replay, the active-session constraint and the nullable transaction link from the submit-path amendment. Keep Release 5's header-authenticated routes, same-key payment hand-off, cart TTL extension and quote/order branches.
- Keep D-R5-8 stock commit and C5 promotion allocation before payment. Require atomic promotion ledger writes and a replay checkpoint, with rollback of partial budget registration and future paid-checkout, budget-race and quote-conversion tests.
- Fence recovery with atomic ownership and durable operation checkpoints. Keep the unresolved operation/expiry and discounted quote acceptance decisions as explicit implementation gates. The storefront submit protocol remains unbuilt.

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
