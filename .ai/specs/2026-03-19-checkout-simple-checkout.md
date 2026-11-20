# Checkout Module — Unified Checkout Funnel

| Field | Value |
|-------|-------|
| **Status** | Specification (v2.3 — Release 5 spec revision 2026-10-26; Phases B.1–B.5 in eComm Release 5, B.6 out except the security minimum moved into B.1/B.3) |
| **Author** | Piotr Karwatka (v1), rescoped for the ecommerce suite (v2) |
| **Created** | 2026-03-19 |
| **Rescoped** | 2026-08-14 |
| **Revised** | 2026-10-26 (Release 5: [pre-implementation analysis](./analysis/ANALYSIS-2026-10-26-checkout-release-5.md) C1–C26, [owner decisions](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md) D-R5-1…36, [cross-spec review](./analysis/ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md) X1–X20) |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 7, Phase 3 |
| **Package** | `@open-mercato/checkout` |
| **Related** | [Phase A — Pay Links](./implemented/2026-03-19-checkout-pay-links.md) *(implemented)*, [Cart Module](./2026-08-14-cart-module.md), [Availability Contract](./2026-08-14-availability-contract.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), SPEC-055 Promotions (C5, D-R5-17 amendments), SPEC-029 (`storeContextService.resolveForBuyer`, D-R5-22), [SPEC-041 UMES](./implemented/SPEC-041-2026-02-24-universal-module-extension-system.md), [SPEC-044 Payment Gateways](./implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md) |

> **v2 rescope notice.** v1 specified `CheckoutCartItem`, a merchant-defined item list on a link. Per [ADR-3](./2026-08-14-ecommerce-suite-roadmap.md#adr-3--checkout-is-one-funnel-owned-by-open-mercatocheckout), `@open-mercato/checkout` is now the **single checkout funnel for every channel** and consumes a [`cart`](./2026-08-14-cart-module.md) rather than owning line items. `CheckoutCartItem` is withdrawn (§14). SPEC-029 §19's competing workflow-driven session is withdrawn in its own document. Phase A pay links are unchanged and remain in production.

> **Release 5 notice (v2.3).** Phases B.1–B.5 ship in eComm Release 5. The platform sells through the API and pay links, with no storefront of its own, so every buyer route is specified as a public API contract (§9.0). B.6 (admin session viewer, the four seeded workflow definitions of §5.1) stays out; its security minimum (rate limits, session encryption map, event redaction, token hash, cross-tenant check) moves into B.1/B.3 (C14).

---

## TLDR

**Key Points:**
- One funnel, two entry modes. A **merchant-initiated** checkout (simple checkout link) seeds a cart from link-defined lines through a trusted in-process context (D-R5-19); a **buyer-initiated** checkout (storefront API client, POS, agent) arrives with an existing cart token. From the moment a `CheckoutSession` exists, both are the same code path.
- `CheckoutSession` holds `cart_id`, addresses, delivery selection, payment method and the resulting quote or order. It never holds lines (the cart does) and never holds an approval (the cart is the approval subject, D-R5-3).
- The session is addressed as `/api/checkout/sessions/current/*` with an `X-Checkout-Session-Token` header. Only a hash of the token is stored. A session on an identified cart also needs the buyer's own customer session on every route, otherwise `404` (D-R5-21, D-R5-33).
- **The funnel core is a fixed state machine, not a workflow.** No workflow runs in Release 5. Approval resumes are event-driven from `customer_groups` (C11).
- Submit is the only authoritative moment. In order:
  1. lock and re-price the cart (with a fresh visibility pass);
  2. re-evaluate delivery promotions;
  3. reserve stock;
  4. reserve credit for the full payable amount;
  5. create the document, idempotently, and check its totals;
  6. commit stock, link the credit reservation and consume promotion codes and budgets;
  7. only then take payment.

  After the document exists, every failure is compensated by **cancelling the order** (§7.3).
- B2B branches at submit: on account creates an **order** against reserved credit; the `request_quote` payment method creates a **quote** for the merchant to convert (D-R5-20).
- `checkout` declares no new `requires`. Session features soft-resolve their peers, and Phase A pay links keep working with none of them installed (D-R5-18).

**Scope:**
- `CheckoutSession`, `CheckoutSessionEvent`; `CheckoutTransaction` extended with `session_id`, `quote_id`, `order_id`
- Cart lock/extend/unlock protocol across payment; the submit sequence and its compensation; the recovery decision table
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

Phase A pay links keep their existing path end to end. They create a `CheckoutTransaction` with no `session_id` and no cart, exactly as today. This spec adds nothing to them and removes nothing from them; a test boots an app with only `checkout` + `payment_gateways` and completes a pay link (D-R5-18).

### 3.3 Cross-module integration

| Direction | Mechanism |
|---|---|
| → `cart` | DI `cartService`: `lock` (with `checkoutSessionId`, `lockTtlMs`, `purpose`, route context), `unlock`, `markConverted` (with `salesOrderId`/`salesQuoteId` and `lineMap`), the exact sales snapshot read (`SalesLineSnapshot[]` + adjustments, C7). Command `cart.approval.request` for `request-approval`. Commands `cart.create` and the line adds for link seeding (D-R5-19). |
| → `availability` | `commandBus`: `availability.reserve`, `availability.release`, `availability.commit`, every input scoped by `{ tenantId, organizationId }` and keyed by `stock_reservation_key` |
| → `customer_groups` | DI `customerGroupsService.resolveTerms` (terms incl. `approval_required_above`, `min_order_value`, `terms_currency_code`, `allow_purchase_on_account`, `allow_quote_requests`, `requires_po_number`). DI `customerCreditService`: `checkCredit`, `reserveCredit`, `releaseCredit`, `linkCreditReservationToOrder`. DI `customerPurchaseApprovalService`: `getApproval`, `getActiveApprovalForSubject` (read only; checkout creates no approval, D-R5-3). Subscribes to `customer_groups.approval.*` (§8.2). |
| → `ecommerce` (SPEC-029) | DI `storeContextService.resolve(request, { fresh: true })` at the edge; `storeContextService.resolveForBuyer(...)` for pay-link buyer identity and recovery (D-R5-22) |
| → `promotions` | DI `promotionsService`: `evaluate` with delivery context (D-R5-17), `useCode`, `registerUsage` before payment (C5, D-R4-26), `revertCodeUse({ cartId })` in compensation before the order links the use. Reversal after cancellation is **promotions-owned**: a promotions subscriber on `sales.order.cancelled` runs `revertUsage({ orderId })` and `revertCodeUse({ orderId })` idempotently (SPEC-055 amendment, C5). `sales` never calls promotions. |
| → `shipping_carriers` | DI `shippingCarrierService.calculateRates` (§5.3); selected method snapshotted onto the session |
| → `payment_gateways` | `paymentGatewayService.createPaymentSession` and status read, the Phase A surface, unchanged |
| → `sales` | `commandBus`: `sales.quotes.create`, `sales.quotes.convert_to_order`, `sales.orders.update` (status `confirmed` at completion, `cancelled` in compensation). Lookup of a quote by `external_reference` (§7.2, D-R5-30). |
| ← `sales` | UMES widget: "Created from checkout" badge when `metadata.sourceModule = 'checkout'` |
| → `workflows` | **None in Release 5.** The four post-conversion definitions of §5.1 are B.6. Checkout emits its events (§10) either way, so a later definition subscribes without a checkout change. |

The quote→order path through the command bus is retained from v1 and reused for both entry modes.

### 3.4 Soft dependencies (D-R5-18)

`checkout/index.ts` declares no new `requires` (C10). Session features resolve every peer through `container.tryResolve` at the call site.

| Peer absent | Effect |
|---|---|
| `cart` (`cartService`) | Every `/api/checkout/sessions*` buyer route answers `503 checkout_sessions_unavailable`. Pay links unaffected. |
| `sales` | Same as `cart`: no document can be created, so sessions are unavailable (`503 checkout_sessions_unavailable`). |
| `customer_groups` (`customerCreditService`, `customerPurchaseApprovalService`) | `on_account` and `request_quote` are not offered; no approval gate beyond what `cart.lock` itself enforces; `min_order_value` and PO checks skipped (no terms). |
| `availability` | Stock step skipped; every line reports `not_tracked` (D-R5-9). |
| `promotions` | No delivery promotions, no code consumption or usage registration (the cart itself carries no promotions without it). |
| `shipping_carriers` | Rates come only from the flat-rate fallback (§5.3); with no fallback configured, physical carts cannot pass `delivery` (`422 delivery_unavailable`). |
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
| `customer_id` / `customer_user_id` | uuid, nullable | Copied from the cart at creation. A non-null `customer_user_id` binds every buyer route to that customer session (§9.0) |
| `shipping_address` | jsonb, nullable | Encrypted at rest |
| `billing_address` | jsonb, nullable | Encrypted at rest |
| `billing_same_as_shipping` | boolean | |
| `shipping_method` | jsonb, nullable | Snapshot: `providerKey`, service, `deliveryMethodCode`, price, ETA, `quotedAt`, `source: 'carrier' \| 'flat_rate'` |
| `quoted_totals` | jsonb, nullable | The totals the buyer saw at review: `{ goodsGross, deliveryCost, deliveryDiscount, payableGross, currencyCode, appliedPromotionIds, cartUpdatedAt, evaluatedAt }`. Compared at submit (§7.2 step 2) |
| `delivery_window_id` | uuid, nullable | `sales.SalesDeliveryWindow.id` |
| `payment_method_code` | text, nullable | A gateway method, `on_account` or `request_quote` (D-R5-20) |
| `payment_intent_ref` | text, nullable | Gateway reference |
| `payment_expires_at` | timestamptz, nullable | Gateway session expiry; drives the lock extension and `expire-awaiting-payment` (§6, §12) |
| `purchase_order_number` | text, nullable | B2B; written to `SalesQuote.customer_reference` |
| `credit_reservation_key` | text, nullable | Idempotency key used with `reserveCredit`; fresh per attempt |
| `stock_reservation_key` | text, nullable | Idempotency key used with `availability.reserve`; fresh per attempt |
| `submit_idempotency_key` | text, nullable | Client-supplied `Idempotency-Key` of the current attempt; the duplicate-submit guard |
| `submit_attempt` | integer | Starts at 0, incremented when an attempt begins. Part of the document's `external_reference` (§7.2) |
| `submit_progress` | text, nullable | Last completed submit step: `locked \| stock_reserved \| credit_reserved \| document_created \| finalized \| payment_initiated`. Read by recovery (§12.1) |
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
| `unit_price_override` | numeric(12,2), nullable | Null → resolve from catalog for the buyer |
| `currency_code` | text | |
| `image_url` | text, nullable | |
| `is_quantity_editable` | boolean | Default `false` |
| `sort_order` | integer | |

Currency rules from v1 are retained: one currency per link; mixed-currency templates rejected at admin write; the currency must be supported by the link's gateway descriptor.

`unit_price_override` matters: with a real cart behind it, a template line without an override resolves the buyer's own price, so a simple checkout link sent to a wholesale customer prices at their contract rate.

**Optimistic locking (C20).** Template rows are a sub-resource edited inside the link's `CrudForm` and saved with it. They are guarded by the parent `CheckoutLink.updatedAt` (the AGENTS.md sub-resource exemption); they carry the standard `updated_at` but no header of their own.

**Seeding a cart from a template (B.2, D-R5-19, D-R5-22).**
1. The Phase A link checks pass first: active, not expired, usage limit, and the password access cookie (`readCheckoutAccessCookie`) where the link has a password.
2. Checkout builds a context with `buildTrustedCommandContext({ tenantId: link.tenantId, organizationId: link.organizationId, actor: { type: 'system' }, reason: 'checkout.link.seed:' + link.id })`. The scope comes only from the link row, never from request input, and the audit entry is marked system-initiated.
3. Buyer identity: when a customer session is present (`getCustomerAuthFromRequest`) and its tenant and organization equal the link's, checkout resolves `storeContextService.resolveForBuyer({ tenantId, organizationId, customerUserId })` with **no store**. It passes the resulting identity (`customerId`, `customerIds` with the company, `customerGroupIds`, `priceKindId`) to `cart.create` (channel `pay_link`), so template lines without an override price at the buyer's own rate and credit, approval and terms resolve to the company. Without a customer session, the cart is a guest cart.
4. Lines are added through the cart's line-add command, only from the template. The request body never contributes lines.

### 4.4 `CheckoutTransaction` (extended, additive)

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid, nullable | Null for Phase A pay links. Index `(tenant_id, session_id)` |
| `quote_id` | uuid, nullable | New, additive. The real `CheckoutTransaction` entity has no such column today |
| `order_id` | uuid, nullable | New, additive. Same as above |

A session-backed gateway payment creates one `CheckoutTransaction` per attempt at §7.2 step 7, with `session_id`, `order_id` and `quote_id` set. Additive nullable columns only; Phase A rows keep all three null and Phase A behaviour is untouched.

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

Steps are skippable by configuration: a digital-only cart skips `delivery`; a known logged-in buyer with one address skips `contact` and `addresses`; `on_account` and `request_quote` skip gateway selection in `payment` but not the step (the PO number is captured there, §8.4).

Backward navigation is always allowed before submit. Changing an address after selecting delivery **invalidates the rate quote** and returns the buyer to `delivery` with the reason stated — a stale rate is a shipping cost the merchant absorbs. Any cart change after review (the cart's `updatedAt` differs from `quoted_totals.cartUpdatedAt` on the next session read) clears `quoted_totals`, so `review` re-evaluates before submit is offered. When a tax provider is configured, tax can depend on the shipping address as well (`2026-10-03-tax-providers-roadmap.md`, ADR-3); under the default state `product-rate` (its ADR-5) nothing changes. That the lock's re-price (§6) computes with that address the figure the buyer confirms, and whether the funnel shows a tax estimate at the address step, are proposed to the owners of this spec in that roadmap (amendment 6a, §14 Q16) and are not decided here; the Release 5 lock input carries no address.

### 5.3 Delivery rate quoting (C13, D-R5-35)

`GET /api/checkout/sessions/current/delivery-options` calls `shippingCarrierService.calculateRates({ providerKey, origin, destination, packages, … })` for each configured provider:

| Input | Source |
|---|---|
| `providerKey` | The providers enabled in the store settings (storefront carts) or the link settings (link carts); API/agent carts without a store use the tenant's enabled providers |
| `origin` | The store's address; else the primary warehouse's address; else the tenant's default address |
| `destination` | `shipping_address` |
| `packages` | One parcel per cart, weight and dimensions summed from catalog product weight and dimensions; lines without data contribute a configured default (single-parcel default: 1 kg, 30×20×10 cm) |

- Quotes are cached 5 min per `(address hash, cart hash)` (R10) and re-validated at submit (R5).
- **Flat-rate fallback (D-R5-35).** When a carrier call fails or no provider is configured, the flat rates from the **store settings** (storefront carts) or the **link settings** (link carts) are offered instead, marked `source: 'flat_rate'`. Without a fallback configured, a carrier failure answers `422 delivery_unavailable`.
- Selecting a method (`POST …/current/delivery`) snapshots it into `shipping_method`.

### 5.4 Delivery promotions (D-R5-17, D-R4-24 (2)(3))

The `delivery_method` rule and the `DELIVERY_DISCOUNT` effect are authorable in Release 5 (SPEC-055 amendment); checkout is their source.
- **At delivery selection** and again on entering `review`, checkout calls `promotionsService.evaluate` with the cart's buyer context plus `deliveryMethodCode` and `deliveryCost`, and stores the result in `quoted_totals`.
- **At submit**, after the lock, it evaluates again (§7.2 step 2). A different delivery discount or a newly applicable promotion aborts with `409 price_changed`, reason `delivery_changed` or `promotion_newly_eligible` (the cart's vocabulary).
- The delivery discount reaches the document as an adjustment on the shipping charge computed by `sales`, never by checkout arithmetic. Its budget is registered before payment (§7.2 step 6). Cart-stage totals still exclude delivery.

### 5.5 Payment methods

`GET /api/checkout/sessions/current/payment-methods` returns, server-side:
- the gateway methods from the store or link configuration whose descriptor supports the session currency;
- `on_account` when the cart is identified (OQ1), the resolved terms have `allow_purchase_on_account`, and `customerCreditService.checkCredit` returns an account in the cart currency that is not on hold (D-R5-5). The response carries the `checkCredit` reason when it is not offered (`no_account`, `on_hold`, `not_permitted`), so the client can explain it;
- `request_quote` when the resolved terms have `allow_quote_requests = true` (tenant default `false`, D-R5-20).

`POST …/current/payment` stores the choice (and the PO number). A method that the list does not offer is refused with `422 payment_method_unavailable`; entitlement is never trusted from the client. The gateway intent is **not** created here: it is created by submit after the document exists (§7.2 step 7).

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
- `checkoutSessionId` is the session id. A second `lock` with the **same** `checkoutSessionId` on a locked cart is an idempotent extend: it returns the cart and sets the new expiry, with no re-price and no visibility pass (X15). A different session gets `423 cart_locked`.
- `purpose` is `'quote'` when `payment_method_code = 'request_quote'`, else `'order'`. `'quote'` skips the approval gate and `min_order_value`; the visibility pass, store/channel checks and re-price still run (D-R5-23).
- `routeContext`: for a `storefront` cart checkout passes the buyer's request so the cart builds a fresh `ResolvedCartRouteContext` itself (C2); checkout imports nothing from `cart/lib`. A storefront cart without a context is refused by the cart with `400 assortment_scope_required_for_storefront_channel`; checkout never sends one without. For recovery (no request), the context is built from the cart's stored identity through `storeContextService.resolveForBuyer({ tenantId, organizationId, storeId: cart.storeId, customerUserId | customerId })` (D-R5-22).
- `lockTtlMs`: the cart default (30 min) at step 1; at step 7 checkout extends to `payment_expires_at − now + 15 min`, within the cart's bound.

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
5. Required steps complete for the effective configuration (`422 steps_incomplete`); terms accepted where required.
6. Payment method still offered (§5.5), otherwise `422 payment_method_unavailable`.
7. **Approval (order purpose only).** Advisory read of the cart's approval state: if the cart requires approval (cart K1 basis: goods gross after promotions, excluding delivery, in the cart currency; a currency other than `terms_currency_code` always requires it, D-R5-4) and `Cart.approvalId` is not `approved` for at least the current total, answer `409 cart_requires_approval` with `request-approval` as the next action. A guest cart above the threshold answers `409 approval_requires_identified_buyer` (D-R5-12). `cart.lock` re-checks both authoritatively (K2).
8. **`min_order_value` (order purpose only, D-R5-4).** Compared with the goods gross after promotions when the cart currency equals `terms_currency_code`; not checked otherwise. Below it: `409 below_min_order_value`.
9. **PO number** present when the resolved `requires_po_number` is true (D-R5-28): otherwise `422 purchase_order_number_required`.
10. `quoted_totals` present and computed for the current cart version (§5.2).

### 7.2 Sequence

Each step is a separate transaction (every `commandBus.execute()` commits its own), idempotent under its key, and records `submit_progress` plus a `CheckoutSessionEvent` when it completes. `attempt = submit_attempt` after the `open → submitting` CAS increments it. `stock_reservation_key = 'checkout:' + sessionId + ':' + attempt + ':stock'` and `credit_reservation_key = 'checkout:' + sessionId + ':' + attempt + ':credit'`.

```
 0. CAS open → submitting; submit_attempt += 1; fresh keys; emit checkout.session.submitted

 1. cartService.lock({ cartId, tenantId, organizationId, checkoutSessionId: sessionId,
                       purpose: 'order' | 'quote', routeContext })                 [§6]
    ├─ priceChanges non-empty → ABORT 409 price_changed (nothing else taken)
    ├─ cart refusal (409/423, §6)  → ABORT, code passed through
    └─ progress = locked

 2. Delivery re-evaluation (D-R5-17): re-validate the shipping rate if older than its
    validity; promotionsService.evaluate with deliveryMethodCode/deliveryCost;
    compute payable = goods gross after promotions + delivery cost − delivery discount
    └─ differs from quoted_totals → unlock; ABORT 409 price_changed
                                    (delivery_changed | promotion_newly_eligible)

 3. availability.reserve({ tenantId, organizationId, items, sourceType: 'checkout',
      sourceId: sessionId, idempotencyKey: stock_reservation_key, ttlSeconds: 900 })
    Per-line outcome: held | not_tracked | preorder | backorder | shortfall (D-R5-9)
    ├─ any shortfall line → release; unlock; ABORT 409 stock_shortfall (shortfall lines only)
    └─ progress = stock_reserved   (skipped when availability is absent: all not_tracked)

 4. IF payment_method = on_account:
      customerCreditService.reserveCredit({ scope, customerId: <company per cart identity>,
        currencyCode, amount: payable, idempotencyKey: credit_reservation_key })   (D-R5-24)
      ├─ refused → release stock; unlock; ABORT 402 credit_refused (reason)
      └─ progress = credit_reserved

 5. Document (idempotent, C3):
    a. Look up SalesQuote by (tenantId, organizationId,
       external_reference = 'checkout:' + sessionId + ':' + attempt). Found → reuse.
       Not found → sales.quotes.create with:
         external_reference, non-confirmed status (C17), customer_reference = PO number,
         lines from cartService's exact SalesLineSnapshot[] + adjustments (C7),
         metadata.cartLineId on every line incl. gift lines (C18),
         shipping method + cost, DELIVERY_DISCOUNT as adjustment on the shipping charge,
         metadata.sourceModule = 'checkout', metadata.checkoutSessionId
    b. Totals invariant (C7, D-R5-24): quote goods totals = locked cart totals (4 dp per key,
       D-R4-9) AND quote grand total gross = payable
       └─ mismatch → compensate (§7.3); ABORT 500 totals_mismatch + ops notification
    c. Order outcome: if the quote is not yet converted → sales.quotes.convert_to_order
       (the order inherits the non-confirmed status and each line's metadata)
    d. Write sales_quote_id / sales_order_id; progress = document_created

    QUOTE OUTCOME (request_quote) — after 5a/5b:
       availability.release(stock_reservation_key, reason 'quote')   (C16, A9)
       cartService.markConverted({ …, checkoutSessionId, salesQuoteId,
                                    lineMap: [{ cartLineId, salesQuoteLineId }] })   (D-R5-26)
       status = completed; emit checkout.session.completed. DONE (no payment, no credit)

 6. ORDER OUTCOME — finalize before payment:
    a. availability.commit({ tenantId, organizationId, idempotencyKey: stock_reservation_key,
       orderId })                                                     (D-R5-8)
       └─ result 'stock_lost' (sweep won and the fresh reserve fell short; availability
          raises its ops notification) → compensate (§7.3, cancel order);
          ABORT 409 stock_shortfall. No payment is ever started on a stock_lost order.
    b. IF on_account: customerCreditService.linkCreditReservationToOrder({ scope,
       idempotencyKey: credit_reservation_key, orderId })             (C6)
    c. promotionsService.useCode({ codeId, codeString, cartId, customerId, type }) per applied
       code; promotionsService.registerUsage({ orderId, orderType: 'order', customerId,
       currency, appliedPromotions })                                 (C5, D-R4-26)
       └─ refused code or non-empty budgetExceeded → compensate (§7.3);
          ABORT 409 promotion_unavailable (the next lock re-prices without it)
    d. progress = finalized

 7. IF gateway:
       paymentGatewayService.createPaymentSession(...); CheckoutTransaction with session_id,
       order_id; payment_intent_ref, payment_expires_at (provider expiry, default 60 min);
       cartService.lock(same checkoutSessionId,
                        lockTtlMs = payment_expires_at − now + 15 min)          (C1 extend)
       status = awaiting_payment;
       progress = payment_initiated; emit checkout.payment.initiated
       └─ intent creation fails → compensate (§7.3); ABORT 502 payment_unavailable
    Payment result (webhook or polling, Phase A path):
       success → sales.orders.update(status confirmed)  → emits sales.order.confirmed (C17)
                 cartService.markConverted({ …, checkoutSessionId, salesOrderId,
                   lineMap: [{ cartLineId, salesOrderLineId }] })     (C18, D-R5-16)
                 status = completed; emit checkout.payment.succeeded, checkout.session.completed
       failure → compensate (§7.3); status = failed; emit checkout.payment.failed

 8. IF on_account (no gateway):
       sales.orders.update(status confirmed); markConverted with salesOrderId + lineMap;
       status = completed. The credit reservation stands until a payment is settled through
       /adjust or settleCredit (D-R5-2).
```

**`lineMap` (C18).** `convert_to_order` copies each quote line's `metadata` onto its order line, so after conversion checkout reads the order's lines and builds `lineMap` from `metadata.cartLineId`. For the quote outcome it reads the quote's lines. No `sales` change is needed.

**Why commit precedes payment (D-R5-8).** The checkout hold becomes an `order` reservation that nothing expires, so a payment longer than the hold TTL cannot lose the stock. Because the order is created non-confirmed and moves to `confirmed` only after commit, `sales.order.confirmed` never fires while a checkout hold still exists, and the `wms` auto-reservation finds the order's own reservation instead of reserving the same stock twice (C17; the Availability Contract §4.4 confirmed-first path remains only for integrators who confirm first).

### 7.3 Compensation

Reverse of acquisition, each action idempotent under the acquisition key and safe to re-run.

| Failure at | Compensation |
|---|---|
| 1 (lock refused / price changed) | Nothing |
| 2 (delivery re-evaluation) | Unlock cart |
| 3 (stock shortfall) | `availability.release` (no-op if nothing held); unlock cart |
| 4 (credit refused) | Release stock; unlock cart |
| 5a/5b before conversion (quote created, totals mismatch or conversion failure) | Release credit (`releaseCredit({ scope, reserveIdempotencyKey, reason })`); release stock; unlock cart. The created quote is left in place as an ordinary, visible unconverted quote; checkout does not delete documents |
| 5c–8 (order exists: totals mismatch after conversion, commit/link/code failure, intent failure, payment failure or expiry) | **Cancel the order** (`sales.orders.update` → `cancelled`, emitting `sales.order.cancelled`). That one event releases the order's stock hold (`wms`), the linked credit reservation (`customer_groups` subscriber, D-R5-2 via C6) and the promotion usage and code uses (`promotions` subscriber, C5). Checkout then calls `revertCodeUse({ cartId })` for code uses consumed before `registerUsage` linked them to the order, releases credit by key if step 6b did not run, releases stock by key if step 6a did not run, and unlocks the cart |

Every compensation writes a `CheckoutSessionEvent` of kind `compensation` and emits `checkout.compensation.executed`.

**A compensation that itself fails** is written as a `failure` event, emits `checkout.compensation.failed`, raises an operational notification, and enqueues `retry-failed-compensations`. It is never swallowed: a leaked stock or credit reservation is invisible inventory or invisible exposure, and both need a human.

Submit-step commands are not undoable (§11, D-R5-10); compensation is the only reversal, and the audit-log Undo cannot return a committed order hold to `checkout` or release stock under a live session.

### 7.4 Idempotency and concurrency

`Idempotency-Key` is client-generated and sent on every submit attempt; it is stored as `submit_idempotency_key`.

- First call proceeds.
- A repeat while the attempt is in flight (`submitting`) returns `409 submit_in_progress`; it does not queue behind it.
- A repeat after success returns the original result, including `sales_order_id` or `sales_quote_id`, with `200`.
- A repeat with the same key while `awaiting_payment` returns the current payment hand-off (`200`).
- A new key after failure starts a fresh attempt with fresh reservation keys and a new `submit_attempt`, so the document's `external_reference` is fresh as well.

Concurrency is enforced by the conditional update `status = 'open' → 'submitting'` (row-level CAS on `status` plus `updated_at`). Exactly one caller wins. This is the guard against the double-tap and the retried-request duplicate order; the `external_reference` lookup-before-create (§7.2 step 5a) is the guard against a crash between document creation and the session write.

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
4. **The approval outlives the session (X6).** A session that expires in `awaiting_approval` leaves the approval on the cart. A new session on that cart starts in `awaiting_approval` when `customerPurchaseApprovalService.getActiveApprovalForSubject({ scope, subjectType: 'cart', subjectId: cartId })` returns a pending approval, and in `open` when the cart's approval is approved.
5. **Price rise (R8, D-R5-3).** Approval is consent up to an amount in a currency. Line changes at the same or a lower total keep it. At submit, `cart.lock` (K2) compares the re-priced total with the approved amount; a higher total refuses with `409 cart_requires_approval`, and the buyer re-requests. Nothing is silently honoured.

The engine-driven approval sub-flow, its stalled-instance monitor and `workflow_instance_id` are withdrawn from Release 5 (§14).

### 8.3 Credit (D-R5-2, D-R5-24, C6, C23)

- Reserved at submit step 4 via `customerCreditService.reserveCredit`, for the **full payable amount**: goods gross after promotions + the selected delivery cost − the delivery discount, from the submit-time evaluation. The approval basis stays goods-only (K1).
- Concurrency is a `PESSIMISTIC_WRITE` row lock on `CustomerCreditAccount` inside `withAtomicFlush(…, { transaction: true })` (customer-groups §6, G1); no serializable transaction.
- The credit is resolved for the company in every channel: storefront carts through the buyer's store context, link and API carts through `resolveForBuyer` identity (D-R5-22).
- After the order exists, checkout links the reservation to it with `linkCreditReservationToOrder` (step 6b). If the order is later cancelled, by compensation or by the merchant, `customer_groups` releases the order's unsettled reservation automatically on `sales.order.cancelled` (D-R5-2).
- The reservation is **not** released on completion. It stands as exposure until a payment is settled through `/adjust` or by an integration calling `settleCredit` (D-R5-2). Without an integration, exposure after payment is settled manually.
- No account in the cart currency → `checkCredit` returns `no_account`; `on_account` is not offered (§5.5).

### 8.4 PO number (D-R5-28)

Captured at the `payment` step. Required when the resolved `requires_po_number` term is true (nullable, inherited, tenant default `false`); validated for format if the tenant configures one; written to `SalesQuote.customer_reference`, which `convert_to_order` carries to the order. A B2B invoice without the buyer's PO number will not be paid.

### 8.5 `min_order_value` (D-R5-4, D-R5-23)

Checked by checkout as precondition 8 (§7.1), on the K1 basis (goods gross after promotions), in `terms_currency_code`. A cart in another currency is not checked. A `request_quote` submit skips it.

### 8.6 Quote branch (D-R5-20, D-R5-23, D-R5-26, C16, C17)

- Offered as the `request_quote` payment method only when `allow_quote_requests` resolves true.
- Lock with `purpose: 'quote'`; the stock reservation still surfaces shortfalls and is released right after the quote exists (a quote is non-binding; stock is taken when the merchant converts and confirms, through the existing automation).
- The quote is created in a non-confirmed status with `metadata.cartLineId` on every line; the cart is converted with `salesQuoteId` and a quote `lineMap`.
- No payment, no credit, no promotion code consumption or usage registration. Approval returns at quote acceptance (`subject_type: 'quote'`), which is outside Release 5: the merchant converts the quote.

---

## 9) API Contracts

Base `/api/checkout`. All bodies validated with zod in `data/validators.ts`. Mutating buyer routes take the expected `updatedAt` (standard optimistic-lock header).

### 9.0 Buyer authentication and session transport (C4, C12, D-R5-21, D-R5-33)

**Token.** `POST /api/checkout/sessions` returns `{ token, session }`. The plaintext token is returned only there; the server stores `token_hash`. Every `/api/checkout/sessions/current/*` route takes it in the `X-Checkout-Session-Token` header, never in the path or query. A lost token is recovered by creating a new session.

**Creating a session.**
- *Buyer-initiated* (`{ source: 'cart' }`): requires `X-Cart-Token`. When the cart has `customer_user_id`, the request must also carry the matching customer session (`getCustomerAuthFromRequest`, cookie or Bearer customer JWT); otherwise `404` with the unknown-cart body (D-R5-21). For a storefront cart the store comes from `storeContextService.resolve(request, { fresh: true })` on the store's mapped host and must equal `cart.store_id` (§7.1 check 4).
- *Merchant-initiated* (`{ source: 'link', slug }`, B.2): the Phase A link checks and the access cookie apply; the cart is seeded per §4.3.
- **One live session per cart.** A new session on a cart cancels an earlier `open` or `awaiting_approval` session for it. If the earlier one is `submitting` or `awaiting_payment`, creation answers `409 submit_in_progress`.

**Binding on every route (D-R5-33).** When the session has `customer_user_id`, every `/api/checkout/sessions/current/*` route requires the customer session whose `customerUserId` equals it; otherwise `404` with the same body as an unknown token. Guest sessions are token-only.

**Scope on every route (C21).** Session, cart, link, store, customer and approval resolve to one tenant and organization; any disagreement is answered as `404` (unknown token).

**Route resolution.** The literal segment `current` is routed before `:id`, so the buyer routes and the admin `GET /api/checkout/sessions/:id` never collide (the cart's D-R4-6 split).

| Method | Path | Purpose | Phase |
|---|---|---|---|
| POST | `/sessions` | Create from a cart token or a link; returns the plaintext token once | B.1 (cart), B.2 (link) |
| GET | `/sessions/current` | Current state, step, available transitions, `quoted_totals` | B.1 |
| PATCH | `/sessions/current` | Contact, addresses, consent, terms acceptance | B.1 |
| POST | `/sessions/current/step` | Navigate; validates the step being left | B.1 |
| POST | `/sessions/current/cancel` | Cancel an `open` or `awaiting_approval` session (nothing reserved; the cart's approval is kept, X6) | B.1 |
| GET | `/sessions/current/delivery-options` | Rate quote for the current address and cart (§5.3); evaluates delivery promotions | B.3 |
| POST | `/sessions/current/delivery` | Select a method; snapshots the rate and the evaluation | B.3 |
| GET | `/sessions/current/payment-methods` | Gateway methods, `on_account` and `request_quote` eligibility (§5.5) | B.3 (gateway), B.5 (`on_account`, `request_quote`) |
| POST | `/sessions/current/payment` | Select a method; PO number | B.3 / B.5 |
| POST | `/sessions/current/submit` | §7. Requires `Idempotency-Key` | B.4 |
| GET | `/sessions/current/result` | Post-submit outcome: `outcome_kind`, document ids and numbers, per-line stock outcomes, payment hand-off | B.4 |
| POST | `/sessions/current/request-approval` | Delegates to `cart.approval.request` (§8.2) | B.5 |

Admin (staff auth): `GET /api/checkout/sessions` and `GET /api/checkout/sessions/:id` under `checkout.sessions.view`, including the event trail; the admin-forced actions (force-expire, force re-price) under `checkout.sessions.manage`. The ACL features ship in B.1 (§9.1); the viewer routes and pages are B.6.

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

Grants in `setup.ts` `defaultRoleFeatures`: `admin` gets both (covered by `checkout.*`); `employee` gets `checkout.sessions.view` only; `checkout.sessions.manage` stays with `admin` or is granted by hand (least privilege, D-R5-34). Existing tenants run `yarn mercato auth sync-role-acls`. Buyer routes are not ACL-gated; they are token-bound (§9.0).

### 9.2 Error codes

Every refusal body is `{ error: <code>, message, details? }`, with a translated `message`. The client branches on `error`.

| Code | HTTP | Raised by | Meaning / next action |
|---|---|---|---|
| `checkout_sessions_unavailable` | 503 | All session routes | `cart` or `sales` absent, or a storefront cart without `storeContextService` (§3.4) |
| `cart_store_mismatch` | 409 | Create, submit | Tenant, organization, channel, currency or (when the cart has one) store differ (C9, X13) |
| `session_not_open` | 409 | Mutations, submit | Session is not `open` |
| `steps_incomplete` | 422 | Submit | Required step missing; `details.steps` |
| `delivery_unavailable` | 422 | Delivery | No carrier rate and no flat-rate fallback (§5.3) |
| `payment_method_unavailable` | 422 | Payment, submit | Method not offered to this buyer (§5.5) |
| `purchase_order_number_required` | 422 | Submit | `requires_po_number` term (§8.4) |
| `below_min_order_value` | 409 | Submit | §8.5; `details.minOrderValue`, `currencyCode` |
| `cart_requires_approval` | 409 | Submit (passthrough from cart) | Request approval |
| `approval_requires_identified_buyer` | 409 | Submit (passthrough from cart) | Guest above threshold; sign in (D-R5-12) |
| `cart_has_unavailable_lines` | 409 | Submit (passthrough from cart) | A line left the buyer's assortment; remove it (US-B4) |
| `cart_not_active` | 409 | Create, submit (passthrough) | Cart merged, converted or abandoned; start from the current cart |
| `cart_locked` | 423 | Create, submit (passthrough) | Another session holds the cart |
| `price_changed` | 409 | Submit | `details.reasons` incl. cart reasons, `delivery_changed`, `promotion_newly_eligible`; `details.priceChanges`; re-confirm |
| `stock_shortfall` | 409 | Submit | `details.lines` with the `shortfall` lines only |
| `credit_refused` | 402 | Submit | `details.reason`: `no_account \| on_hold \| limit_exceeded \| not_permitted`; offered prepayment or `request_quote` |
| `promotion_unavailable` | 409 | Submit | A code was refused or a budget is exhausted; the next lock re-prices without it |
| `totals_mismatch` | 500 | Submit | Document totals differ from the cart or the payable; compensated; ops notified |
| `payment_unavailable` | 502 | Submit | Gateway intent creation failed; compensated |
| `submit_in_progress` | 409 | Submit, create | An attempt is in flight (§7.4) |
| `approval_not_required` | 409 | Request-approval (passthrough from cart) | Below the threshold |
| — | 404 | All `/current/*` | Unknown token, binding mismatch (§9.0) or scope mismatch; one body for all |
| — | 429 | Rate-limited routes | §13 |

---

## 10) Events

Declared with `createModuleEvents`. These are state signals: no checkout event sends a notification to a buyer or approver (D-R5-32), except `checkout.compensation.failed`, which raises the operational notification. Every payload carries `tenantId` and `organizationId`, carries ids and statuses only, and never PII (C22).

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

Session commands are registered with `isUndoable: false`, consistently with `availability.reserve/release/commit` and `wms.inventory.reserve/release` (D-R5-10). They exist so that every session write passes the same mutation guards, interceptors and audit trail as any other domain write. Reversal is the explicit compensation of §7.3, never an audit-log Undo. Template commands are admin mutations and stay undoable.

`checkout.transaction.updateStatus` enforces a strict transition state machine (`VALID_CHECKOUT_TRANSITIONS`) plus an atomic compare-and-swap via `tx.nativeUpdate` with the previous status pinned in the `WHERE` clause, returning `409` on a lost race between the submit route and the gateway webhook. The `open → submitting` guard on `CheckoutSession.status` (§7.4) is the same CAS pattern applied to the new entity.

---

## 12) Background Jobs

All via the `queue` worker contract.

| Job | Cadence | Purpose |
|---|---|---|
| `expire-checkout-sessions` | every 5 min | Expire `open` and `awaiting_approval` sessions past TTL. Nothing is reserved in either state, so nothing is released; the cart's approval is kept (X6) |
| `recover-stuck-submits` | every minute | Sessions in `submitting` with `submit_started_at` older than 120 s: §12.1 |
| `retry-failed-compensations` | every 5 min | Re-run failed compensations with backoff; ops notification after 5 attempts |
| `expire-awaiting-payment` | every 5 min | `awaiting_payment` past `payment_expires_at`: read the gateway status; paid → complete (§7.2 step 7 success); otherwise compensate (cancel the order) and fail with `payment_expired`. Runs before the extended cart lock can lapse (§6) |

### 12.1 Recovery decision table (C24)

Recovery runs under `buildTrustedCommandContext({ tenantId, organizationId, actor: { type: 'system' }, reason: 'checkout.recovery:' + sessionId })` with the session's own scope. Where it must re-lock, it builds the cart context through `resolveForBuyer` from the cart's stored identity (D-R5-22). Each probe reads by the attempt's key.

| `submit_progress` | Probe | Action |
|---|---|---|
| null (crashed inside step 1) | Cart status and lock holder | Locked by this session → unlock; status `open`. Not locked → status `open` |
| `locked` | Availability hold by `stock_reservation_key` | Hold exists → release it. Unlock; status `open` (the buyer resubmits and re-confirms) |
| `stock_reserved` | Credit ledger by `credit_reservation_key` (on account) | Release credit if reserved; release stock; unlock; status `open` |
| `credit_reserved` or crash in step 5 | Quote by `external_reference` | Quote absent → release credit, release stock, unlock, `open`. Quote present, not converted, order outcome → resume forward from 5b (idempotent). Quote outcome → resume 5b and the quote branch |
| `document_created` | Hold status, credit entry `orderId`, promotion usage by `orderId` | Resume step 6 forward; each sub-step is idempotent under its key |
| `finalized` | Gateway transaction by session | No intent → resume step 7 (extend lock, create intent). Intent exists → status `awaiting_payment` |
| any, attempt older than the payment TTL without an intent | — | Compensate per §7.3 and fail with `submit_recovery_failed` |

A recovery that resumes forward never creates a second document: the quote lookup by `external_reference` and the `convert_to_order` check guarantee it (C3, D-R5-30).

---

## 13) Security

Everything in this section ships with the phase that introduces the route (C14); none of it waits for B.6.

- **Token.** CSPRNG, carried only in `X-Checkout-Session-Token`, never in a URL path or query, never logged; stored as `token_hash` only (C4, D-R4-18). Not rotated (the session is short-lived).
- **Buyer binding.** A session on an identified cart requires the matching customer session on every buyer route (§9.0). Creating a session requires proof of cart access: `X-Cart-Token` plus, for an identified cart, the matching customer session; or the link checks.
- **Encryption (B.1).** `checkout/encryption.ts`'s `defaultEncryptionMaps` gains `{ entityId: 'checkout:checkout_session', fields: [{ field: 'email' }, { field: 'phone' }, { field: 'shipping_address' }, { field: 'billing_address' }] }`; reads go through `findWithDecryption`.
- **Redaction (B.1).** `CheckoutSessionEvent.payload` is redacted at write time: never card data, addresses, e-mail, phone or gateway secrets.
- **Rate limits** through the Phase A helper `enforceCheckoutRateLimit` (`readEndpointRateLimitConfig`):

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
- **Trusted contexts.** Link seeding and recovery build their context with `buildTrustedCommandContext` from stored rows (link, session), never from request input; audit entries are marked system-initiated (D-R5-19, X10).

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

Phase A is untouched: `CheckoutLinkTemplate`, `CheckoutLink` and `CheckoutTransaction` keep their behaviour, and the pay-link flow does not pass through `CheckoutSession`.

---

## 14a) Migration & Backward Compatibility

All checkout changes are new or additive. The contract changes in other modules are additive and specified in their own specs in the same revision pass.

| # | Surface (BACKWARD_COMPATIBILITY.md) | Change | Classification | Owner spec |
|---|---|---|---|---|
| 1 | Module metadata / generated (1, 13) | `checkout/index.ts` `requires` **unchanged** (C10, D-R5-18) | No change | this spec |
| 2 | DB schema (8) | New `checkout_sessions`, `checkout_session_events`, `checkout_link_cart_templates`; nullable `session_id`/`quote_id`/`order_id` on `checkout_transactions` | Additive | this spec |
| 3 | DB schema (8) | Index `sales_quotes (tenant_id, external_reference)` | Additive, approved (D-R5-30) | sales migration |
| 4 | API routes (7) | New `/api/checkout/sessions`, `/sessions/current/*`, admin `/sessions/:id` | Additive | this spec |
| 5 | Events (5) | New `checkout.session.*`, `checkout.payment.*`, `checkout.compensation.*`, `checkout.cartTemplate.*` | Additive | this spec |
| 6 | ACL (10) | `checkout.sessions.view`, `checkout.sessions.manage`; Phase A features unchanged | Additive; run `yarn mercato auth sync-role-acls` | this spec |
| 7 | Encryption map | `checkout:checkout_session` entry | Additive | this spec |
| 8 | Signatures (3) | `cart.lock` gains `lockTtlMs`, `purpose`, idempotent same-session extend; `unlock`/`markConverted` require `checkoutSessionId`; `markConverted` gains `salesOrderId`, `salesQuoteId`, `lineMap`; storefront lock without context refused | Additive (C1, C2, K8, D-R5-16, D-R5-23, D-R5-26) | cart spec |
| 9 | Signatures (3) | Trusted pay-link cart creation path | Additive, Ask First approved (D-R5-19) | cart spec §6a.4 |
| 10 | Signatures / events (3, 5) | `promotionsService.revertCodeUse`; promotions subscriber on `sales.order.cancelled`; delivery promotions authorable | Additive (C5, D-R5-17) | SPEC-055 |
| 11 | Signatures / DI (3, 9) | `customerCreditService.linkCreditReservationToOrder`; terms `allow_quote_requests`, `requires_po_number`, `terms_currency_code`, `approval_policy` | Additive (C6, D-R5-20, D-R5-28, D-R5-4, D-R5-1) | customer-groups spec |
| 12 | Signatures (3) | `storeContextService.resolveForBuyer` with optional store | Additive (D-R5-22) | SPEC-029 |
| 13 | Imports (4) | `buildTrustedCommandContext` in `@open-mercato/shared/lib/commands/trustedContext` | Additive (X10) | shared |

**Phase A non-regression (C10).** A test boots an app with only `checkout` + `payment_gateways` and completes a pay link end to end; existing Phase A tests run unchanged.

**Upgrade steps.** `yarn db:migrate` (new tables, nullable columns, sales index); `yarn mercato auth sync-role-acls` for the new grants. No data migration; no deprecation protocol applies.

---

## 15) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Payment captured without an order | **Critical** | Payment succeeds; the completion write fails; the buyer is charged and sees a failure. | The order is created and finalized **before** the intent (§7.2 steps 5–7), so a successful payment always has an order; `expire-awaiting-payment` and recovery read the gateway status before compensating | Low |
| R2 | Duplicate order from double submit | **Critical** | Double-tap or a retried request creates two orders and two charges. | Conditional `open → submitting` admits exactly one caller; `Idempotency-Key` per attempt; a repeat returns the original result (§7.4); concurrent-submit test is a merge gate | Low |
| R3 | Leaked stock or credit reservation | **High** | The process dies mid-submit; stock and credit stay reserved against a session that will never complete. | `recover-stuck-submits` with the §12.1 table; checkout holds have a 900 s TTL as a backstop until commit; after commit, cancellation releases through `sales.order.cancelled`; `checkout.compensation.failed` raises an ops notification | Low |
| R4 | Price changed between review and charge | **High** | A promotion expires or a delivery promotion changes during checkout; the buyer is charged more than the reviewed total. | `cart.lock` re-price and the submit-time delivery evaluation abort with `409 price_changed` before any side effect (§6, §7.2 step 3) | Low |
| R5 | Stale shipping rate | Medium | The buyer changes the address after selecting delivery; the merchant absorbs the difference. | An address change invalidates the quote (§5.2); the snapshot carries `quotedAt` and is re-validated at submit | Low |
| R6 | Cart stranded in `locked` | Medium | Submit crashes after locking. | Recovery unlocks (§12.1); every compensation unlocks; the cart's `release-stale-locks` sweeper remains the backstop | Low |
| R7 | Credit overshoot via concurrent checkouts | **High** | Two on-account checkouts for one company jointly exceed the limit. | `reserveCredit` takes a `PESSIMISTIC_WRITE` row lock on the credit account (G1); the eligibility check is advisory and the reservation authoritative; N=20 parallel test | Low |
| R8 | Approval bypassed by a price change | Medium | A cart approved at 150 000 re-prices to 180 000 and is submitted against the stale approval. | `cart.lock` compares the re-priced total with the approved amount (K2, D-R5-3) and refuses with `409 cart_requires_approval` | Low |
| R9 | Compensation failure swallowed | **High** | A release call fails and is logged but not surfaced. | Never swallowed: `failure` event, `checkout.compensation.failed`, ops notification, retry job (§7.3) | Low |
| R10 | Rate-quote API abuse | Medium | Scripted `delivery-options` calls incur carrier cost. | 30/min per session; 5 min cache; flat-rate fallback on carrier failure (§5.3) | Low |
| R11 | Cart unlocked mid-payment (C1) | **Critical** | The 30 min cart lock lapses during a slow payment; the buyer edits or re-buys the basket while the first order completes. | Lock extended to the payment expiry + 15 min under the same session id; `unlock`/`markConverted` require the session id; `expire-awaiting-payment` resolves first (§6) | Low |
| R12 | Duplicate document after a crash (C3) | **Critical** | A crash after `sales.quotes.create` and before the session write; recovery creates a second quote and order. | `external_reference` lookup-before-create, indexed (D-R5-30); `convert_to_order` only if not converted | Low |
| R13 | Codes reused or budgets overrun (C5) | **High** | A single-use code is never consumed, or a budget overrun is found after capture. | `useCode` + `registerUsage` before payment; abort with `409 promotion_unavailable`; promotions-owned reversal on cancellation | Low |
| R14 | Visibility pass skipped at submit (C2) | **High** | A product that left the buyer's assortment is bought. | Storefront lock without a fresh context is refused by the cart; checkout always passes the request (or the `resolveForBuyer` context in recovery) | Low |
| R15 | Phase A regression (C10) | **High** | Hard `requires` stop pay-link-only apps from booting. | No new `requires`; soft peers; non-regression boot test | Low |
| R16 | Totals drift between cart, review and document (C7, D-R5-24) | Medium | The buyer accepts one amount and is invoiced another, or credit is reserved for a different amount. | One draft source (the cart's exact snapshot); post-create equality on goods and payable; `500 totals_mismatch` compensates and notifies ops | Low |
| R17 | Session token replay by a third party | Medium | A leaked session token on an identified cart is replayed. | Binding to the customer session (§9.0); `404` on mismatch; token never in URLs or logs | Low (guest sessions remain token-only by design) |

---

## 16) Integration Coverage

Integration tests are self-contained: each creates its tenant, store, products, stock, groups, terms, credit accounts, promotions and carts through API fixtures and cleans up in teardown. A second-tenant fixture exists for every public route.

**API paths (every new route):**
- `POST /api/checkout/sessions` — from a cart token (guest, identified with matching customer session, identified without it → 404, identified with another buyer's session → 404); from a link (B.2); token returned once and only its hash stored; second session on the same cart supersedes an `open` one and is refused while `submitting`; `503 checkout_sessions_unavailable` with `cart` disabled.
- `GET /api/checkout/sessions/current` — token in header works; token in path or query is not accepted; unknown token, binding mismatch and other-tenant token answer the same 404.
- `PATCH /api/checkout/sessions/current` — contact and addresses saved and encrypted at rest; stale `updatedAt` → 409; binding 404.
- `POST /api/checkout/sessions/current/step` — transition table exhaustively; binding 404.
- `POST /api/checkout/sessions/current/cancel` — `open` and `awaiting_approval` canceled; the cart's approval survives; binding 404.
- `GET /api/checkout/sessions/current/delivery-options` — carrier rate with origin and package defaults; carrier failure → flat rate from store settings (storefront cart) and from link settings (link cart); no fallback → `422 delivery_unavailable`; delivery promotion evaluated; rate limit 30/min; binding 404.
- `POST /api/checkout/sessions/current/delivery` — snapshot and `quoted_totals` written; binding 404.
- `GET /api/checkout/sessions/current/payment-methods` — `on_account` offered only with entitlement and an account in the currency (reasons `no_account`, `on_hold`); `request_quote` only with `allow_quote_requests`; binding 404.
- `POST /api/checkout/sessions/current/payment` — unoffered method → `422 payment_method_unavailable`; PO stored; binding 404.
- `POST /api/checkout/sessions/current/submit` — the submit cases below; binding 404.
- `GET /api/checkout/sessions/current/result` — order and quote outcomes, per-line stock outcomes; binding 404.
- `POST /api/checkout/sessions/current/request-approval` — session parks in `awaiting_approval`, `Cart.approvalId` set, no session approval id; below threshold → `409 approval_not_required`; binding 404.
- Admin ACL: `checkout.sessions.view` granted to `employee` and `admin`; `checkout.sessions.manage` to `admin` only (asserted on the role grants; the viewer routes are B.6).

**Submit correctness:**
- Happy-path B2C: order created non-confirmed, stock committed before the intent, codes consumed and usage registered before the intent, payment captured, order `confirmed` only after commit, cart converted with `salesOrderId` and a `lineMap` covering every cart line incl. gifts (C17, C18).
- Happy-path B2B on account: credit reserved for goods + delivery − delivery discount (D-R5-24), linked to the order, standing after completion; no gateway call.
- Quote outcome (`request_quote`): quote created with PO in `customer_reference`; no payment, no credit, stock released; cart converted with `salesQuoteId` and a quote `lineMap`; approval and `min_order_value` not applied (D-R5-23).
- Concurrent double submit creates exactly one order (R2); repeat after success returns the original ids; repeat in flight → `409 submit_in_progress`; new key after failure → fresh keys and a fresh `external_reference`.
- Goods totals and payable equality; a forced mismatch compensates with `500 totals_mismatch` and the ops notification (C7).
- Backorder line holds `min(requested, sellable)` and does not abort; a shortfall line aborts with only the shortfall lines listed; `not_tracked` with `availability` disabled (D-R5-9).

**Compensation and recovery (C26):**
- `availability.commit` returning `stock_lost` (expiry sweep forced to win before step 6a, stock taken by another order): the order is cancelled, no payment intent is created, submit answers `409 stock_shortfall` (D-R5-8).
- Injected failure at each of steps 1, 2, 3, 4, 5a, 5b, 5c, 6a, 6b, 6c, 7 (intent) and payment failure: no stock held, no credit reserved, codes and usage reverted, the order (if any) cancelled, and the cart unlocked.
- A process killed after each of steps 1–7 is reconciled by `recover-stuck-submits` per §12.1 **without a duplicate quote or order** (C3, C24).
- A failing compensation raises the notification and is retried (R9).
- Credit released by `customer_groups` when the order is cancelled (C6).
- Code reuse refused; code returned on payment failure; budget overrun aborts with `409 promotion_unavailable` before payment (C5).

**Lock and payment (C1, C2):**
- Lock held through a payment longer than 30 min; the cart sweeper does not release it; `expire-awaiting-payment` compensates at the payment expiry.
- `unlock`/`markConverted` with another session id → 404.
- A storefront cart locked without a context is refused; checkout always supplies one.

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
- N=20 parallel on-account submits respect the limit exactly (R7).
- `requires_po_number` blocks submit without a PO and the PO reaches the order.
- Below `min_order_value` blocked; another currency not checked.

**Entry modes:**
- Phase A pay link unaffected with `cart` disabled, in an app with only `checkout` + `payment_gateways` (C10, D-R5-18).
- A simple checkout link seeds a `pay_link` cart through the trusted context; a template line without `unit_price_override` prices at a logged-in buyer's own rate and credit resolves to the company (D-R5-19, D-R5-22); the request body cannot add lines.
- `is_quantity_editable = false` rejects a quantity change.

**Security:**
- Cross-tenant session/cart/link/store/approval combinations rejected on every public route (C21).
- `checkout:checkout_session` fields encrypted at rest; event payloads redacted (C14).
- Rate limits on `POST /sessions`, `/current` mutations, submit and `delivery-options` enforced (C14).

---

## 17) Implementation Plan

Release 5 order (cross-spec review, final implementation order): B.1 and B.3 in wave 2, B.2 in wave 3, B.4 in wave 4, B.5 in wave 5.

### Phase B.1 — Session and step machine
`CheckoutSession` (with `token_hash`), `CheckoutSessionEvent`, `POST /sessions` from a cart token, `GET`/`PATCH /sessions/current`, `/step`, `/cancel`, the §9.0 transport, binding and scope checks, the step machine, optimistic locking, `expire-checkout-sessions`, soft peer resolution and `503 checkout_sessions_unavailable`. **Security minimum (C14):** token hash, session encryption map, payload redaction, rate limits on `POST /sessions` and `/current` mutations, cross-tenant check. ACL features and grants.

**Depends on:** nothing new in other modules.
**Gate:** transition table exhaustively tested; binding and cross-tenant 404s; Phase A non-regression boot test.

### Phase B.2 — Cart-backed links
`CheckoutLinkCartTemplate`, `checkout.cartTemplate.*` commands, admin `CrudForm` group, currency and gateway-descriptor validation, `POST /sessions` from a link with trusted seeding (§4.3).

**Depends on:** cart trusted pay-link path (D-R5-19), `resolveForBuyer` with optional store (D-R5-22), `buildTrustedCommandContext` (X10).
**Gate:** a template line without an override prices per buyer; mixed-currency templates rejected; request body cannot add lines.

### Phase B.3 — Delivery and payment
`delivery-options` with rate inputs, caching and the flat-rate fallback (§5.3), delivery promotion evaluation and `quoted_totals` (§5.4), method selection and snapshotting, gateway payment-method resolution (§5.5), `delivery-options` rate limit.

**Depends on:** SPEC-055 delivery promotions un-hidden (D-R5-17).
**Gate:** stale-rate invalidation; carrier failure degrades to the flat rate.

### Phase B.4 — Submit
The §7 sequence for the gateway outcome, compensation, idempotency, concurrency guard, `recover-stuck-submits` with §12.1, `retry-failed-compensations`, `expire-awaiting-payment`, `/result`, submit rate limits, `CheckoutTransaction` columns.

**Depends on:** availability Phase 3 (`reserve`/`release`/`commit`, per-line outcomes, D-R5-8…10); cart lock contract (C1, C2, `markConverted` inputs K8/D-R5-16/D-R5-26); promotions `revertCodeUse` and the cancellation subscriber (C5); the `sales_quotes` index (D-R5-30).
**Gate:** every submit-correctness and compensation test passes, including a killed process at each step without duplicates.

### Phase B.5 — B2B
`on_account` with `customerCreditService` (reserve, link, release), approval request and the event-driven resume (§8.2), PO capture, `min_order_value`, `request_quote` and the quote branch (§8.6).

**Depends on:** B.4; customer-groups Phases 3–4 (credit service with the row lock, approval service and events, new terms); cart approval gate K1–K5 with `purpose` (D-R5-23).
**Gate:** the N=20 parallel on-account test; re-approval on a price increase; quote outcome with a quote `lineMap`.

### Phase B.6 — Admin viewer and workflows (not Release 5)
Admin session viewer with the event trail and the `checkout.sessions.manage` actions; the four seeded workflow definitions of §5.1. The security minimum already shipped in B.1/B.3/B.4.

---

## 18) Open Questions

1. **Guest checkout for on-account** — assumed impossible: purchase on account requires an authenticated `CustomerUser` linked to a company. Confirm no tenant needs a magic-link variant.
2. **Partial fulfilment of non-backorder lines at submit** — narrowed by D-R5-9: backorder-enabled lines already hold what is sellable and admit the rest. What remains open is a split for lines **without** backorder (ship what is available, cancel or defer the rest), which needs its own design.
3. **Saved payment methods** — repeat B2B buyers will want stored instruments. Belongs to `payment_gateways` plus spec 9, not here.
4. **Multi-currency on account** — a credit account is per currency. A buyer checking out in a currency with no account is not offered `on_account` (`no_account`); whether that should fall back to prepayment automatically is a merchandising decision.

---

## 19) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | All references are FK ids; peers reached via DI (`tryResolve`) or `commandBus` |
| No reimplemented arithmetic | Goods totals come from the cart's exact snapshot; the shipping charge and delivery discount are computed by `sales`; checkout only compares (§7.2 step 5b) |
| Tenant/organization scoping | Session, cart, link, store, customer and approval agree on every request; recovery and seeding use the stored scope (§13) |
| Optimistic locking | `CheckoutSession.updatedAt` via `enforceCommandOptimisticLockWithGuards`; `open → submitting` CAS; template rows guarded by `CheckoutLink.updatedAt`; event rows append-only (C20) |
| Encryption | Email, phone and both addresses via the `checkout:checkout_session` map in B.1; `findWithDecryption`; payloads redacted (C14) |
| Bearer credentials | Session token only in a header, only its hash at rest (C4) |
| Rate limiting | Public mutation routes rate-limited from the phase that introduces them (C14) |
| Zod validation | All routes; `z.infer` types |
| No `any` | State machine, session and payload contracts fully typed |
| Mutation guards / commands | Session transitions are command-routed and not undoable (D-R5-10); admin template mutations undoable (§11) |
| i18n | Step labels, error codes and validation messages translated |
| Queue usage | All four jobs via the `queue` worker contract |
| ACL | Phase A features reused; `checkout.sessions.view` (employee, admin) and `.manage` (admin) new; sync-role-acls documented (D-R5-34) |
| Module dependencies (`requires`) | Unchanged from Phase A. `cart`, `sales`, `availability`, `customer_groups`, `promotions`, `shipping_carriers`, `payment_gateways`, `ecommerce` are soft peers (§3.4, D-R5-18). No `workflows` use in Release 5 |
| Cross-module coupling | Upstream never depends on downstream: promotions and customer groups react to `sales.order.cancelled` themselves; `sales` calls neither (C5, D-R5-2) |
| Events | Every payload carries `tenantId`/`organizationId`; state signals only; approval notifications owned by `customer_groups` (D-R5-32) |
| Backward compatibility | §14a; Phase A non-regression test |
| Integration coverage | §16, every new API path, shipping in the same change as each phase |

---

## 20) User Story Map (Prototype Input)

Added 2026-09-16 to support the `om-mockup-prototype` click-through; revised 2026-10-26 for Release 5. Derived from §5.2's step machine, §6's lock protocol, §7's submit sequence, §8's B2B rules and §15's risk register. The actor is a buyer in the funnel unless stated. In Release 5 the "screen" is the integrator's client over the public API; the acceptance criteria are stated against the API response.

### Epic A — Completing a checkout

- **US-A1** — As a buyer, I want to move through contact, addresses, delivery, payment and review, so that I can complete an order without losing what I have already entered.
  - AC: steps the effective configuration does not need are skipped, not shown disabled — a digital-only cart has no `delivery` step, a known buyer with one address skips `contact` and `addresses` (§5.2).
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
  - AC: a `failure` event, `checkout.compensation.failed`, an operational notification and a retry — never swallowed.

### Cross-cutting rules

- No refusal is a bare status code: each names what happened and what the buyer can do next.
- Nothing is reserved before it is needed. Before the order exists, everything taken is released in reverse order; after it exists, the order is cancelled and its cancellation releases the rest (§7.3).
- Server-decided sets — the step list, the payment methods, the available outcomes — are returned by the session, never hard-coded in the client.

### Risks without a screen

**R1** (payment without an order), **R3** (leaked reservation), **R7** (credit overshoot), **R10** (rate-quote abuse), **R12** (duplicate document) and **R13** (codes and budgets) have no buyer-facing or admin-facing state of their own. They are mitigated by the conditional status update, the idempotency keys and `external_reference`, the credit row lock, the pre-payment usage registration and rate limiting — mechanisms, not screens.

---

## 21) Changelog

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
