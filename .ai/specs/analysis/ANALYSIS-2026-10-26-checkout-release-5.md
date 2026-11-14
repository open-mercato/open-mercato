# Pre-Implementation Analysis: Checkout — Unified Funnel, Phases B.1–B.5 (eComm Release 5)

> **Spec**: `.ai/specs/2026-03-19-checkout-simple-checkout.md` (v2.1). Phase A (pay links) is implemented; **B.6 is out of scope**.
> **Verified against**: branch `feat/release-5-conversion` @ `71dcf9641b`. Every claim about the code cites the file it was read from.
> **Inputs**:
> - analyses G (customer groups), A (availability), K (cart), S (assisted selling);
> - decisions D-R5-1…16;
> - Release 4 decisions D-R4-24 (checkout obligations) and D-R4-26 (promotions usage API).
>
> **Release invariant**: the platform sells through the API and pay links, without a storefront of its own.
> **Issue prefix**: C.

## Executive Summary

The funnel design holds:
- the cart is locked only during submit;
- exactly one authoritative moment;
- ordered, idempotent compensation;
- a fixed state machine instead of a workflow.

Checked against the code that now exists, the submit sequence of §7.2 has five Critical defects:

1. **The cart unlocks during payment.** The cart lock times out at 30 min and a sweeper releases it while payment is still pending. Under D-R5-8 (commit at document creation) the session then completes on a cart the buyer can buy again (C1).
2. **Visibility is skipped.** `cart.lock` silently skips the assortment pass when it gets no route context, and checkout has no sanctioned way to build one (C2).
3. **Duplicate documents.** Document creation has no idempotency key, so the "killed process" path creates a second order (C3).
4. **Token in the URL.** The session token sits in the URL path and is stored in plaintext, contrary to the spec's own §13 and D-R4-6/18 (C4).
5. **Codes and budgets.** Promotion code consumption is missing from the sequence and is not reversible anywhere. Budget enforcement happens after the money is taken (C5, D-R4-26).

D-R4-24 is only half satisfied by the existing cart code:
- the visibility re-check runs only if checkout supplies the context (C2);
- delivery re-evaluation and newly eligible promotions have no home (C8);
- the channel/store mismatch check falls entirely to checkout (C9).

**Recommendation: needs spec updates first.**

## Code baseline (what exists on the branch)

| Surface | State | Source |
|---|---|---|
| `@open-mercato/checkout` | Phase A only: links, templates, transactions, `/pay/[slug]` public flow, 9 subscribers, 2 workers. No `CheckoutSession`, no session route, no `requires` in `index.ts`. | `packages/checkout/src/modules/checkout/**` |
| ACL | 6 flat Phase A features (`checkout.view/create/edit/delete/viewPii/export`) | `checkout/acl.ts` |
| Encryption map | link template, link, transaction; no session | `checkout/encryption.ts` |
| Rate limiting | `enforceCheckoutRateLimit` over `readEndpointRateLimitConfig`, fail-open/fail-closed posture, already used by the public pay routes | `checkout/lib/rateLimiter.ts`; `api/pay/[slug]/route.ts:32-40` |
| Payment | `paymentGatewayService.createPaymentSession` | `api/pay/[slug]/submit/route.ts:341,494-496` |
| `cartService` (DI) | `lock({ cartId, tenantId, organizationId, checkoutSessionId, routeContext? })` returns `{ cart, priceChanges, warnings? }`; `unlock({ cartId, tenantId, organizationId })`; `markConverted({ cartId, tenantId, organizationId })` | `cart/di.ts`; `cart/lib/cartService.ts:27-90`; `cart/commands/lock.ts:68-92,206-212,269-275` |
| Lock semantics | Reprices in a separate transaction, then locks: `active → locked`, `lockExpiresAt = now + resolveCartLockTimeoutMs()` (default 30 min). Re-lock of a locked cart gives 423; any other status gives 404. `unlock`/`markConverted` do **not** check `checkoutSessionId`. | `cart/commands/lock.ts:100-200,227,294` |
| Visibility at lock | The whole-cart re-visibility pass runs only when `assortmentScope !== undefined`, i.e. only when `routeContext` is passed | `cart/commands/cart.ts:713-715`; `lock.ts:75-85` |
| Approval at lock | Not checked (K2) | `cart/commands/lock.ts` |
| Store/channel check at lock | None | `cart/commands/lock.ts` (no `storeId` comparison) |
| `sales.quotes.create` | No caller-supplied id, no idempotency key; `SalesQuote` has `external_reference` and `customer_reference` | `sales/commands/documents.ts:5007`; `sales/data/entities.ts:848-851` |
| `sales.quotes.convert_to_order` | Returns `{ orderId }`; copies quote **status** to the order and each quote line's **`metadata`** to its order line | `documents.ts:6704,6823-6824,6947,7072` |
| Promotions | `promotionsService.useCode({ codeId, codeString, cartId, customerId, type })`, `registerUsage({ orderId, orderType, customerId, currency, appliedPromotions })` returning `{ budgetExceeded[] }`, `revertUsage({ orderId })`. **No revert for `CodeUsage`.** No subscriber anywhere calls `revertUsage`. | `promotions/lib/promotions-service.ts:355-420`; `lib/types.ts:100`; `data/validators.ts:986-998`; grep |
| Shipping | `shippingCarrierService.calculateRates({ providerKey, origin, destination, packages[{weightKg,lengthCm,widthCm,heightCm}], … })` | `shipping_carriers/di.ts`; `lib/shipping-service.ts:93-118` |
| `evaluateCartVisibility` | A `cart/lib` function, not a DI service | `cart/lib/visibility.ts:124` |

## D-R4-24 and D-R4-26: obligation by obligation

| Obligation | State in code | Gap | Finding |
|---|---|---|---|
| D-R4-24 (1) same `evaluateCartVisibility` at submit | `cart.lock` runs it, but only with a `routeContext` | Checkout cannot build `ResolvedCartRouteContext` (cart-internal) | C2 |
| D-R4-24 (2) re-evaluate delivery effects | `DELIVERY_DISCOUNT` excluded from cart totals (D-R4-14); no evaluation with delivery context anywhere | No step, no mapping | C8 |
| D-R4-24 (3) disclose newly appearing promotions | Cart discloses `promotion_newly_eligible` via `priceChanges` only for its own re-price | Checkout-stage evaluation has no comparison or abort rule | C8 |
| D-R4-24 (4) refuse channel/store mismatch | Not checked by `cart.lock` | Checkout must check at session creation and at submit | C9 |
| D-R4-26 `useCode` | Implemented, never called by §7.2 | Code consumption absent from submit; no reversal API | C5 |
| D-R4-26 `registerUsage` | Implemented; §7.2 calls it **after** payment | A budget overrun is found after charging | C5 |
| D-R4-26 `revertUsage` | Implemented; §3.3 says `sales` calls it on cancellation, but `sales` cannot depend on `promotions` and nothing subscribes | Usage never reverted | C5 |

## Backward Compatibility

All 13 surfaces were checked. The checkout additions are new, but several of them change other modules' contracts additively. One spec choice would break Phase A deployments.

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| C10 | 1 Module metadata / 13 generated | §16 states hard `requires: cart, sales, promotions, availability, customer_groups`. `checkout` declares none today (`index.ts`), and Phase A pay links run without any of them. Adding hard `requires` stops every app that enables `checkout` for pay links only from booting. | Critical (BC) | Keep `checkout`'s `requires` unchanged. Session features soft-resolve their peers (`tryResolve`) and the session routes answer `503 checkout_sessions_unavailable` when `cart` is absent. Ask First. |
| C4 | 7 Routes | `/api/checkout/sessions/:token/*` puts a bearer token in the path, which §13 itself forbids | Critical (spec) | `/api/checkout/sessions/current/*` with an `X-Checkout-Session-Token` header, mirroring the cart (D-R4-6) |
| C1 | 3 Signatures (cart) | `cart.lock` gains `lockTtlMs` and an idempotent re-lock/extend for the same `checkoutSessionId`; `unlock`/`markConverted` gain a `checkoutSessionId` match | Additive | Cart change in the same revision pass |
| C2 | 3 Signatures / 9 DI (cart) | `cartService` gains a route-context resolver or `lock(…, { request })` | Additive | Same |
| C5 | 3 Signatures / 5 Events (promotions) | Additive `revertCodeUse`; a promotions subscriber on `sales.order.cancelled` | Additive | SPEC-055 amendment |
| C6 | 3 Signatures (customer_groups) | Additive `linkCreditReservationToOrder` | Additive | G contract |
| K8 / C18 | 3 Signatures (cart) | `markConverted` gains `salesOrderId`, `lineMap` | Additive | D-R5-16 |
| — | 8 DB | `CheckoutTransaction` gains nullable `session_id`/`quote_id`/`order_id` (§4.4), additive | OK | — |
| — | 10 ACL | New `checkout.sessions.view/manage`, additive; Phase A features unchanged | OK | Add to `setup.ts` |
| — | 2, 4, 6, 11, 12 | No change | OK | — |

There is no Migration & BC section; §14 covers the withdrawn v1 items only. Add §14a listing every additive contract above, the Phase A non-regression (C10), and the sync-role-acls step.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Revised §7.2 under D-R5-8…10 and D-R4-26 | The written sequence commits stock after payment, never consumes codes, and registers usage after charging | Rewrite (see C19) |
| Recovery decision table (§12 `recover-stuck-submits`) | "Determine the true outcome" is unspecified; with no document idempotency it duplicates orders (C3) | Per-step probe → action table (C24) |
| Buyer authentication and session transport | API-only selling has no rule for who may create or drive a session (C4, C12) | §9.0 |
| Delivery pricing inputs | `calculateRates` needs origin and packages that nothing supplies (C13) | §5.3 |
| Error-code catalogue | `price_changed`, `stock_shortfall`, `credit_refused`, `submit_in_progress` and the new ones in this report are scattered | §9.2 |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §4.1 `token` | Plaintext; D-R4-18 stores only a hash | `token_hash`, plaintext returned once (C4) |
| §6 lock protocol | No lock lifetime across `awaiting_payment` (C1) | Extend rule |
| §8.2 approval gate | Driven by workflows (B.6, out) | Event-driven resume (C11) |
| §8.3 credit | "serializable", "until invoicing settles it" | Row lock (G1); settlement per D-R5-2; order linkage (C6) |
| §8.4 PO | "when the group's terms require it": no terms field exists | C15 |
| §13 security | Rate limits and encryption listed, but phased into B.6 | Move the minimum into B.1/B.3 (C14) |
| §16 coverage | No test for the killed process at each step, store mismatch, code reversal or the totals invariant | C26 |

## AGENTS.md Compliance

| Rule | Location | Fix |
|---|---|---|
| PII encrypted via `encryption.ts` | `checkout:checkout_session` map is planned but sits in B.6 | Ship with B.1 (C14) |
| Rate-limit public mutation routes | B.6 | Ship with B.1/B.3 using the Phase A helper (C14) |
| Bearer credentials never in URLs; only hashes at rest | §9 path token, §4.1 plaintext | C4 |
| Cross-module coupling through DI/events, upstream never depends on downstream | §3.3 "`revertUsage()` called by `sales`" | Promotions-side subscriber (C5) |
| Optional peers soft-resolved, never a hard `requires` on an optional module | §16 hard `requires` | C10 |
| Optimistic locking on new user-editable entities | `CheckoutLinkCartTemplate` rows | Guarded by the parent `CheckoutLink.updatedAt` (sub-resource exemption) or their own `updated_at`; state which (C20) |
| Command pattern | §11 lists submit steps as commands with no-op undo | Keep, consistent with D-R5-10 |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **C1** Cart unlocks mid-payment | `release-stale-locks` unlocks at 30 min. The buyer edits the cart, `markConverted` 404s, the session completes and the cart stays `active` and buyable again: a second order from the same basket. | Lock TTL extension tied to the session (C1) |
| **C3** Duplicate document after a crash | Each `commandBus.execute` commits on its own. A crash after `sales.quotes.create` and before the session write lets recovery or a retry create another quote and order. | `external_reference` marker and lookup-before-create |
| **C5** Codes consumed and budgets enforced wrongly | A single-use code is never consumed, so it can be reused across orders. If consumed, it can never be returned after a failed payment. A budget overrun is detected after capture. | `useCode` + `registerUsage` before payment; `revertCodeUse`/`revertUsage` on cancellation |
| **C2** Visibility pass skipped | A product that left the buyer's assortment is bought at submit (R11 through checkout) | Lock refuses a storefront cart without a fresh context |
| **C6** Credit reservation orphaned on cancellation | D-R5-2's automatic release on `sales.order.cancelled` cannot find a reservation sourced to the session, so exposure leaks | Link the reservation to the order |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **C7** Totals drift between cart and order | The buyer accepts one amount and is invoiced another (cart R1 reached through checkout) | One draft source plus a post-create equality check |
| **C8** Delivery-stage promotions undefined | Free-shipping promotions are unusable, or applied without disclosure | Evaluation at delivery selection and at submit; abort on change |
| **C10** Phase A regression | Pay-link-only apps fail to boot | Soft peers |
| **C13** Rate quoting impossible | `delivery` step has no packages and no origin | Defaults + flat-rate fallback |
| **C17** `sales.order.confirmed` before commit | The wms automation reserves the same stock as the checkout hold (A8) | Quote/order created in a non-confirmed status |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Session token rate limiting fail-open | Abuse during a limiter outage | Fail-closed posture on submit, fail-open on reads (existing helper) |
| Approval resume without workflows | No stalled-instance monitor needed | Event-driven resume (C11) |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **C1: tie the cart lock to the session and keep it through payment.**
  - `cart.lock` accepts `lockTtlMs` (bounded).
  - A second `lock` with the **same** `checkoutSessionId` on a locked cart is an idempotent extend that returns the cart, instead of today's 423.
  - `unlock` and `markConverted` require the matching `checkoutSessionId`; a mismatch is a uniform 404.
  - Checkout extends the lock on entering `awaiting_payment` to the intent TTL, and `expire-awaiting-payment` (§12) compensates before the lock can lapse.
  - Recovery uses the idempotent re-lock to resume.
- **C2: fresh route context at lock.**
  - `cartService.lock` takes the buyer's `request` (or `cartService.resolveRouteContext(request, { fresh: true })` is exposed) and builds the fresh `ResolvedCartRouteContext` itself.
  - `cart.lock` on a `storefront` cart without a context throws `400 assortment_scope_required_for_storefront_channel`. This adds the assertion `lock.ts:75-85` deferred "until a real caller exists".
  - This satisfies D-R4-24 (1) with the cart's own `evaluateCartVisibility`; checkout imports nothing from `cart/lib`.
- **C3: idempotent document creation.**
  - Checkout sets `SalesQuote.external_reference = 'checkout:' + sessionId + ':' + attempt` (`entities.ts:848`).
  - Before `sales.quotes.create`, recovery and retries look the quote up by that reference in the session's tenant and organization.
  - `convert_to_order` runs only if the quote is not already converted.
  - Writing `sales_quote_id`/`sales_order_id` on the session follows each step and is itself idempotent.
  - Add an index on `(tenant_id, external_reference)` if `sales` has none (additive; Ask First on `sales`).
- **C4: session token transport.**
  - `/api/checkout/sessions/current/*` with `X-Checkout-Session-Token`.
  - `token_hash` stored; plaintext returned once by `POST /sessions`.
  - Rate limited per token and per IP.
  - Admin keeps `/api/checkout/sessions` and `/sessions/[id]` (no collision, the same split as the cart, D-R4-6).
- **C5: codes and promotion usage in the sequence.**
  - *Inside submit.*
    - After document creation, checkout calls `useCode` for every applied code (key `cartId`) and `registerUsage({ orderId, … })` **before** payment.
    - A refused code or a non-empty `budgetExceeded` compensates and aborts with `409 promotion_unavailable`. The next lock re-prices the cart without that promotion.
  - *Reversal (promotions, additive).*
    - `revertCodeUse({ cartId | orderId })`.
    - A promotions-owned subscriber on `sales.order.cancelled` runs `revertUsage` + `revertCodeUse`, idempotently.
  - *Consequence.* Checkout compensation (cancel order) and a later merchant cancellation both reverse usage through one path, and §3.3's "`sales` calls `revertUsage`" is withdrawn.

### Important Gaps (Should Address)

- **C6: credit reservation linkage.**
  - After document creation, checkout calls `customerCreditService.linkCreditReservationToOrder({ scope, idempotencyKey: credit_reservation_key, orderId })` (additive to the G contract).
  - This writes the order id on the reservation entry, so D-R5-2's `sales.order.cancelled` subscriber releases it.
  - The credit reservation follows G1 (row lock) and G2 (scope). §8.3's "serializable" and "invoicing settles" wording is replaced per G1 and D-R5-2.
- **C7: totals invariant at submit.**
  - *Restated.* The order's **goods** totals equal the locked cart's totals (4 dp per key, D-R4-9). Delivery is added by `sales` as a shipping charge, never by checkout arithmetic.
  - *Single source.* `cartService` exposes the cart's exact `SalesLineSnapshot[]` + adjustments (from `cart/lib/toSalesSnapshots`), so checkout never re-maps lines.
  - *Equality check.* After `sales.quotes.create`, the quote's goods totals are compared with the lock result. A mismatch compensates, aborts `500 totals_mismatch` and raises an ops notification.
- **C8: delivery effects and newly eligible promotions (D-R4-24 (2)(3), owner decision on the promotions UI).**
  - *Evaluation points.* At delivery selection and again after the lock at submit, checkout calls `promotionsService.evaluate` with `deliveryMethodCode`/`deliveryCost`.
  - *Mapping.* `DELIVERY_DISCOUNT` is mapped onto the shipping charge's adjustment through `sales`.
  - *Disclosure.* If the submit-time result differs from what the review step showed, checkout aborts with `409 price_changed`, reasons `delivery_changed` or `promotion_newly_eligible` (cart vocabulary).
  - *Decision.* D-R4-14 hid the `delivery_method` rule and `DELIVERY_DISCOUNT` until a source existed. Checkout is that source, so the owner decides whether Release 5 un-hides them (recommended) or keeps delivery promotions off.
- **C9: channel/store/currency consistency (D-R4-24 (4)).** Session creation and submit refuse with `409 cart_store_mismatch` when any of these differ:
  - `cart.store_id` vs the store resolved from the request;
  - `cart.channel` vs the session channel;
  - currency vs the session's;
  - tenant or organization.
- **C11: approval in Release 5 without workflows.**
  - `/sessions/current/request-approval` delegates to `cart.approval.request`, with the cart as subject (D-R5-3) and the K1 amount basis.
  - The session parks in `awaiting_approval` with the cart unlocked (K5: not abandoned).
  - A checkout subscriber on `customer_groups.approval.approved|rejected|expired|withdrawn` returns the session to `open` or `failed`.
  - The next submit's lock re-checks the approved amount (K2, D-R5-3). Re-approval on a price rise is therefore the `409 cart_requires_approval` path.
  - The B.6 workflow, the stalled-instance monitor and `workflow_instance_id` stay out.
- **C12: buyer authentication, API-only (owner decision for the pay-link cart).**
  - *Buyer-initiated.*
    - `POST /sessions` requires `X-Cart-Token`, plus the customer session for an identified cart, the same rule as D-R5-13.
    - The store comes from `storeContextService.resolve(request, { fresh: true })` on the store's mapped host, as for the Storefront Public API.
  - *Merchant-initiated (B.2).*
    - The public `/pay/[slug]` flow seeds a `pay_link` cart.
    - Cart §6a.4 lets only an authenticated principal holding `cart.channel.payLink` create one, and a public route has none.
    - Option (a): an in-process trusted context minted by checkout from the link's own tenant and organization, never from request input.
    - Option (b): a cart command variant for link seeding.
    - Recommend (a). It is an Ask First on the cart contract.
- **C13: rate quoting inputs.**
  - Origin from the store's (or primary warehouse's) address.
  - Packages from catalog product weight and dimensions, with a single-parcel default when absent.
  - `providerKey` and a flat-rate fallback from store or link settings, used when the carrier fails (R10).
  - Quotes cached 5 min per address + cart hash, and re-validated at submit (R5).
- **C14: B.6 items that cannot wait.** B.1–B.5 expose public, token-bound mutation endpoints, so five items ship with the phase that introduces the route:
  - rate limits on `POST /sessions`, every `PATCH`/`POST` under `/current`, submit (10/min per session, 60/min per IP, fail-closed), and `delivery-options` (30/min per session);
  - the session encryption map (`email`, `phone`, `shipping_address`, `billing_address`);
  - `CheckoutSessionEvent.payload` redaction at write time;
  - the token hash (C4);
  - the cross-tenant check on every request.

  All reuse Phase A infrastructure (`enforceCheckoutRateLimit`, `defaultEncryptionMaps`). The admin session viewer, the four seeded workflows, the stalled-instance monitor and the remaining hardening stay in B.6.
- **C15: B.5 specifics (owner decision on the quote trigger).**
  - **PO number.** No `requires_po_number` exists in `CustomerGroupTerms`. Add it, nullable and inherited like the other terms (additive, G), or as a store setting. The PO is written to `SalesQuote.customer_reference`.
  - **`min_order_value`.** Same basis as K1 (goods gross), in `terms_currency_code` (D-R5-4); other currency means not checked.
  - **`on_account` eligibility.** Server-side: `allowPurchaseOnAccount` and an existing credit account in the cart currency (D-R5-5), not on hold.
  - **Quote branch.** "Requesting terms" has no trigger. Options:
    - (a) a payment method `request_quote` offered when terms allow;
    - (b) automatic quote whenever `on_account` is refused for lack of credit;
    - (c) merchant-configured per link.

    Recommend (a).
- **C16:** quote outcome releases the stock hold immediately (A9) and never reserves credit.
- **C17:** the quote is created in a non-confirmed status, so the converted order inherits it (`documents.ts:6823-6824`). `sales.order.confirmed` fires only when checkout moves the order to `confirmed` at completion, after `availability.commit` (D-R5-8 removes the A8 path).
- **C18: `lineMap` is feasible without a `sales` change (D-R5-16).** `convert_to_order` copies each quote line's `metadata` onto its order line (`documents.ts:6947`).
  1. Checkout writes `metadata.cartLineId` on every quote line, gift lines included.
  2. After conversion it reads the order's lines.
  3. It builds `lineMap: Array<{ cartLineId, salesOrderLineId }>` and passes it with `salesOrderId` to `markConverted`, which emits both on `cart.cart.converted` (K8).

### Nice-to-Have Gaps

- **C19: the revised submit sequence.** Each step is idempotent and keyed, and each a separate transaction (lesson `a-self-request-needs-data-committed-outside-the-callers`).
  1. Preconditions: C9; K1/K2 approval; D-R5-12 guest; C15 PO and `min_order_value`.
  2. `cart.lock` (fresh context, C2; session id, C1); any `priceChanges` aborts with 409.
  3. `availability.reserve` (`sourceType: 'checkout'`, per-line outcomes, D-R5-9); a shortfall line aborts with `409 stock_shortfall`.
  4. On account: `reserveCredit` (G1/G2); refused aborts with `402 credit_refused`.
  5. Document: `sales.quotes.create` (`external_reference`, non-confirmed status, PO in `customer_reference`, `metadata.cartLineId`), then the C7 equality check, then `convert_to_order` (order outcome).
  6. Order outcome only: `availability.commit` (D-R5-8), `linkCreditReservationToOrder` (C6), `useCode` + `registerUsage` (C5). Quote outcome: release stock (C16), completed.
  7. Gateway: lock extend (C1), `createPaymentSession`, `awaiting_payment`. Success: order `confirmed`, `markConverted` with `lineMap` (C18), `checkout.session.completed`. Failure: compensate.
  8. On account: order `confirmed`, `markConverted`, completed; credit stands until settlement (D-R5-2).

  Compensation after step 6 is "cancel order". That releases the stock (wms), the credit (D-R5-2 subscriber via C6) and the promotions (C5 subscriber). Then checkout unlocks the cart. Before step 6, compensation is the explicit release of what was taken, in reverse order.
- **C20:** optimistic locking.
  - `CheckoutSession.updatedAt` + the `open → submitting` CAS.
  - `CheckoutLinkCartTemplate` rows are a sub-resource edited inside the link's `CrudForm`, guarded by `CheckoutLink.updatedAt` (AGENTS.md exemption); state it.
  - `CheckoutSessionEvent` is append-only and exempt.
- **C21:** cross-tenant. Session, cart, link, store, customer and approval all resolve to one tenant and organization on every request; a second-tenant fixture covers every public route.
- **C22:** event payloads for `checkout.session.*` and `checkout.payment.*`: ids and status only, no PII. `approval_requested|approved|rejected` are emitted by the C11 subscriber.
- **C23:** align wording with G1 (row lock, not serializable) and D-R5-2 (settlement), and the availability TTL with D-R5-8.
- **C24: recovery decision table for `recover-stuck-submits`.**
  - Per step, the probe and the action: lock (by session id), stock (availability hold by key), credit (ledger by key), document (quote by `external_reference`), commit (hold status), codes/usage (by cart/order), payment (gateway status).
  - Actions: resume forward when the next step is idempotent; compensate when payment failed or never started past the intent TTL.
- **C25:** `checkout.sessions.view/manage` added to `acl.ts` and `setup.ts` (admin; `employee` view), then sync-role-acls. The admin routes themselves (viewer) are B.6.
- **C26: integration coverage to add:**
  - a killed process at each step 2–7, recovered without duplicates (C3, C24);
  - lock held through a payment longer than 30 min (C1);
  - a storefront lock without context refused (C2);
  - store, channel and currency mismatch (C9);
  - code reuse refused, code returned on payment failure, budget overrun aborting before payment (C5);
  - credit released on cancellation (C6);
  - goods totals equality (C7);
  - a delivery promotion changing at submit (C8);
  - `lineMap` present on conversion (C18);
  - Phase A pay link unaffected with `cart` disabled (C10);
  - rate limits and session-field encryption (C14).

## Remediation Plan

### Before Implementation (Must Do)

1. **Owner decisions, taken 2026-10-26 (D-R5-17…20): C8 = un-hide delivery promotions; C10 = soft dependencies; C12 = trusted in-process context for pay-link carts; C15 = `request_quote` payment method gated by a new `allow_quote_requests` term:**
   - C8: un-hide delivery promotions in Release 5;
   - C12: trusted context for pay-link cart seeding;
   - C15: quote trigger;
   - C10: soft peers instead of hard `requires`.
2. **Spec revision of checkout:** §4.1, §6, §7.2–7.4, §8, §9, §12, §13, §14a, §16, and §17 re-cut so that C14 moves into B.1/B.3.
3. **Contract amendments in the same pass:**
   - cart: C1, C2, K8/C18;
   - promotions (SPEC-055): C5;
   - customer groups: C6, C15 PO term;
   - sales, if an index is needed: C3.

### During Implementation (order)

1. B.1 session, step machine, C4, C14.
2. B.2 cart-backed links (C12).
3. B.3 delivery and payment (C13, C8).
4. B.4 submit, after availability Phase 3, customer-groups Phases 3–4 and cart C1/C2 land (scope ordering).
5. B.5 B2B (C11, C15, C16).

### Post-Implementation (Follow Up)

1. B.6: admin session viewer, the four seeded workflows, the stalled monitor.
2. Tax with the shipping address at lock (tax-providers roadmap, amendment 6a).

## Recommendation

**Needs spec updates first.** Fix C1–C5 in checkout and in the cart and promotions contracts, record the four owner decisions, and move the C14 minimum out of B.6. The rest follows from decisions already taken: D-R5-2, D-R5-3, D-R5-8…10, D-R5-12, D-R5-13, D-R5-16.
