# Cross-Spec Consistency Review — eComm Release 5

> **Inputs**: the five Release 5 pre-implementation analyses read together:
> - `ANALYSIS-2026-10-26-customer-groups-release-5.md` (G1–G26);
> - `ANALYSIS-2026-10-26-availability-release-5.md` (A1–A21);
> - `ANALYSIS-2026-10-26-cart-module-release-5.md` (K1–K17);
> - `ANALYSIS-2026-10-26-assisted-selling-release-5.md` (S1–S25);
> - `ANALYSIS-2026-10-26-checkout-release-5.md` (C1–C26).
>
> Checked against owner decisions D-R5-1…20 (`ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md`) and the code on `feat/release-5-conversion` @ `78237116ea`.
> **Issue prefix**: X. Decisions taken in this pass: D-R5-21…36.

## Executive Summary

The five analyses agree on the main seams:
- the cart is the one approval subject;
- `lineMap` flows from checkout through `cart.markConverted` to assisted selling;
- the order "stock, then credit" holds;
- every compensation after document creation is "cancel order".

Read together, they leave four contradictions or holes that no single analysis could see:

1. **The D-R5-13 binding can be bypassed** through the cart's own identity rewrite (X1). Closed by D-R5-21.
2. **Carts outside the storefront channel have no full buyer identity**, so credit, approval and terms resolve against the person instead of the company. In addition, `resolveForBuyer` requires a store that pay links do not have (X2). Closed by D-R5-22.
3. **The approval gate in `cart.lock` cannot tell a quote request from an order** (X3). Closed by D-R5-23.
4. **The amount of the credit reservation is undefined**: credit is reserved before `sales` adds the shipping charge (X4). Closed by D-R5-24.

The remaining findings are consistency fixes (X5–X20), closed by D-R5-25…36 or written straight into the spec revision pass. The assisted-selling phase scope of D-R5-15/16 is confirmed unchanged. The final implementation order is at the end of this document.

## Contradictions and missing seams

### X1: the cart's identity rewrite defeats D-R5-13

- *Problem.* D-R5-13 binds the proposal routes to the customer session only while the target basket has `customer_user_id`. Today any `/api/cart/current*` request presenting the token re-identifies the basket to the requester, anonymous included: `applyCartRepriceTriggerFields` writes `customerUserId = input.customerUserId ?? null` on trigger 2 (`cart/commands/cart.ts:603-608`). One anonymous `GET /api/cart/current` turns an identified basket into a guest basket, after which the proposal routes accept the token alone.
- *How likely.* The most likely path is accidental: a storefront keeps the cart token after the buyer logs out (shared workstation, kiosk). Logged headers and XSS on an integrator's storefront are the other paths. Impact: disclosure of B2B contract prices and proposals, acceptance or rejection of a rep's proposal, and the basket re-priced to list prices.
- *Prior art.* Sylius API v2 lets a token alone reach only guest carts; carts of registered customers answer 404 to anyone else (`VisitorBasedExtension`). The one route that missed the check was published as CVE-2026-31821.
- *Closed by* **D-R5-21**: identified baskets require the matching customer session on every `/api/cart/current/*` route.

### X2: one trusted buyer-identity seam for every channel

- *Problem.*
  - Carts created through the trusted path (`pay_link`, `api`, `agent`, `pos`) store `customerIds = [customerId]`, `customerGroupIds = []` and `priceKindId = null` (`cart/commands/cart.ts:236-258`). The company entity, group memberships and price kind are never resolved.
  - K2 resolves terms over `cart.customerIds`, and G11 resolves credit and approvals to the company. For a pay-link cart of a B2B buyer, both resolve against the person: `no_account`, and the default group's threshold.
  - D-R5-19 promises buyer pricing for pay-link carts, but names no source for the buyer's price kind.
  - S1 specifies `resolveForBuyer` with a mandatory `storeId`, and checkout links have no store.
  - C2 makes `cart.lock` build its context from the buyer's `request`, while C1/C24 resume through a recovery job that has no request.
- *Closed by* **D-R5-22**: `resolveForBuyer` becomes the one trusted identity seam, with `storeId` optional.

### X3: quote requests and the approval gate

- *Problem.* K2 puts the approval gate in `cart.lock`. D-R5-20 adds `request_quote`, which creates no order and spends nothing, but submit still locks the cart. As specified, every quote request above the threshold would need a manager's approval first.
- *Closed by* **D-R5-23**.

### X4: the credit reservation amount

- *Problem.* C19 reserves credit at step 4, before document creation at step 5. D-R5-17 states that the shipping charge (and the delivery discount on it) is computed by `sales` when the document is created. No analysis states the reserved amount. K1's goods-only basis is the approval basis and must not be reused for credit.
- *Prior art.* Sylius computes shipping into the order total before completion (cart and order are one entity); Adobe Commerce "Payment on Account" checks the full grand total at place-order.
- *Closed by* **D-R5-24**.

### X5: K6 and K12 are stale after D-R5-11

- K6 limits the admin list's `kind` filter to `basket` "while the seam is deferred".
- K12 pins the seam as inert.

The seam ships (D-R5-11), so the admin list defaults to `kind = basket` and accepts `proposal`; K12 is replaced by the K15 sweeper tests and the S16 API-level proposal gate.

### X6: approval subject and checkout columns

D-R5-3 makes the cart the canonical subject. G3 still mentions `CheckoutSession.approval_id` and `/sessions/:token/request-approval`. The session stores no approval id: `/api/checkout/sessions/current/request-approval` (C4 path) delegates to `cart.approval.request`, and the session reads `Cart.approvalId`. An approval outlives the session: when a session expires in `awaiting_approval`, the next session reuses the cart's approval, and the C11 subscriber ignores a session that no longer exists.

### X7: requester actor type in Release 5

D-R5-1 adds `requested_by_actor_type: customer_user | staff_user` because a rep can author a cart. In Release 5 only a buyer requests approval: proposals are never locked, the merge source's approval is withdrawn (K3), K4 requires `customerUserId`, and the admin cannot edit lines. `staff_user` stays in the enum, reserved and unused, and no Release 5 route accepts it.

### X8: undo-merge of an accepted proposal

Acceptance is a merge (cart §7a), so `/current/undo-merge` would reverse it, leaving `assisted_selling` with an `accepted` proposal whose lines are gone and an attribution with no basis. Closed by **D-R5-25**.

### X9: `lineMap` for the quote outcome

D-R5-16 makes `lineMap` mandatory, but the quote outcome (D-R5-20) creates no order. Closed by **D-R5-26**.

### X10: one trusted command context

D-R5-14 (re-author as the original author), D-R5-19 (pay-link cart seeding as system) and X2 (`resolveForBuyer` from a stored identity) each build a context that is not derived from the request. Specify one shared helper (inputs: tenant, organization, actor `system | user`, reason) used by all three. Its audit entries are marked system-initiated in one place. The spec revision pass names where that marker is stored, after checking what the audit log supports.

### X11: event scope and notification ownership

- S3 adds `tenantId`/`organizationId` to `cart.cart.merged`/`.adopted`, K9 to `cart.cart.abandoned`; G18 and A13 define new payloads with scope. The rule is general: **every new or extended event payload in Release 5 carries `tenantId` and `organizationId`**.
- One approval fact produces three events: `customer_groups.approval.requested`, `cart.approval.requested` (K7) and `checkout.session.approval_requested` (C22). Closed by **D-R5-32**: only `customer_groups` notifies (in-app, e-mail); the cart and checkout events are state signals.

### X12: the D-R5-5 wording

D-R5-5 says that without an account checkout "offers prepayment or a quote". D-R5-20 offers the quote only where `allow_quote_requests` is true. The revision pass uses the D-R5-20 wording in customer-groups §5.4 and checkout §8.3.

### X13: store comparison for carts without a store

C9 compares `cart.store_id` with the store resolved from the request. Link and API carts have `store_id = null` (`cart/data/entities.ts:97-98`). The comparison applies only when the cart has a store; channel, currency, tenant and organization are always compared.

### X14: `awaiting_approval_since`

K5 adds `Cart.awaiting_approval_since`, while the K BC table says "no new columns for approval". Add the column to the cart §16a BC list (additive, nullable).

### X15: lock extension and recovery

C1's idempotent extend (same `checkoutSessionId` on a locked cart) re-runs neither the re-price nor the visibility pass, so it needs no route context. A recovery that must re-lock an unlocked cart builds the context through `resolveForBuyer` from the cart's stored identity (D-R5-22), never from a request.

### X16–X20: smaller open points

| Id | Open point | Closed by |
|---|---|---|
| X16 | Approval request expiry has no default (`expiresAt?`) | D-R5-27 |
| X17 | PO number: no term exists (C15) | D-R5-28 |
| X18 | Approval gate on pay-link and API carts | D-R5-29 |
| X19 | Ask First on a `sales` index (C3) and `locationIds` meaning (A2) | D-R5-30, D-R5-31 |
| X20 | Checkout session binding, grants, delivery fallback, module registration | D-R5-33…36 |

## Duplicated mechanisms (resolved)

| Mechanism | Where it was duplicated | Resolution |
|---|---|---|
| Buyer-context building | `storeContextService.resolve(request)`, `resolveForBuyer` (S1), cart `resolveCartRouteContext(request)` (C2), trusted path with no context (`cart.ts:246`) | `resolveForBuyer` is the trusted builder; the request path stays for the storefront edge only (D-R5-22) |
| Acting on someone's behalf | D-R5-14, D-R5-19 | One helper (X10) |
| Approval-state signals | three events per transition | `customer_groups` owns notifications (D-R5-32) |
| Identity binding | proposals (D-R5-13), assisted-selling buyer routes, checkout sessions (C12) | One rule on every buyer route: an identified basket or session needs the matching customer session (D-R5-21, D-R5-33) |
| Admin cart reads | K6 admin detail and the console's own cart read (S9) | The console reads the buyer's basket through the K6 admin detail (`cart.carts.view`, organization-scoped) |

## Assisted-selling phase scope (confirmed)

D-R5-15 and D-R5-16 stand. No finding in the other four analyses changes them.

| Phase / item | Release 5 |
|---|---|
| Phase 1, with `mode` limited to `rep \| off`, no AI entities, store-context `mode` exposure deferred | In |
| Phase 2 item 1, buyer thread routes (with D-R5-21 binding) | In |
| Phase 2 item 2, `/thread/events` server side | In |
| Phase 2 item 3, full rep console | In |
| Phase 2 item 5, retention and erasure | In |
| Phase 4, attribution (order lines per D-R5-16, quote lines per D-R5-26) | In |
| Phase 2 item 4, Phase 3, Phase 5 | Out |

Prerequisites: SPEC-029 `resolveForBuyer` with optional store (D-R5-22) and the cart §7a seam.

## Final implementation order

All work ships on `feat/release-5-conversion` (fork PR #16). The spec revision pass comes first and covers every spec at once, the D-R4-29 discipline. Within a wave, tracks are independent.

| Wave | Track | Content | Depends on |
|---|---|---|---|
| 0 | Specs | Revision pass: customer groups, availability, cart, assisted selling, checkout, SPEC-029 (`resolveForBuyer`), SPEC-055 (C5, D-R5-17), roadmap R5 (A10) | All decisions |
| 1 | Shared | Trusted-context helper (X10); event scope fields (X11, S3) | 0 |
| 1 | `ecommerce` | `resolveForBuyer` with optional store (D-R5-22) | 0 |
| 1 | `availability` + `wms` | Step 0 Phase 2 alignment (A2), `wmsReservationService` extraction (A1) | 0 |
| 1 | `customer_groups` | Phase 3 credit: row-lock path first with the N=20 and nested-transaction tests (G1), then ledger, admin UI, audit | 0 |
| 1 | `promotions` | `revertCodeUse`, `sales.order.cancelled` subscriber (C5); un-hide delivery promotions (D-R5-17) | 0 |
| 2 | `availability` | Hold entity, `reserve`/`release`/`commit`, jobs (A3–A21, D-R5-8…10) | 1 |
| 2 | `customer_groups` | Phase 4 approvals: service, portal routes, notifications, grants (D-R5-1, -6, -7, -27, -28) | 1 |
| 2 | `cart` | Lock contract (C1, C2/X15, D-R5-21 binding), `markConverted` inputs (K8, D-R5-26), admin list (K6), K9, K11, bulk gate test, trusted pay-link path (D-R5-19, D-R5-22) | 1 |
| 2 | `checkout` | B.1 session and step machine with the C14 minimum; B.3 delivery and payment | 1 (B.3 needs promotions) |
| 3 | `cart` | Approval gate K1–K5 (with D-R5-23 `purpose`, D-R5-29) | Wave 2 approvals |
| 3 | `cart` | §7a proposal seam with K13–K16 and S3/S5/S13–S15, undo refusal (D-R5-25) | `resolveForBuyer` |
| 3 | `checkout` | B.2 cart-backed links | Cart trusted path |
| 4 | `checkout` | B.4 submit (C19 sequence with D-R5-24, C3 with the `sales` index) | Availability, credit, cart lock, promotions |
| 4 | `assisted_selling` | Phase 1 + Phase 2 items 1, 2, 5 | Cart seam |
| 5 | `checkout` | B.5 B2B (C11, C15, C16, D-R5-20, D-R5-23, D-R5-28) | B.4, cart approval gate |
| 5 | `assisted_selling` | Phase 2 item 3 (console), Phase 4 attribution | Phase 1, checkout B.4 |
| 6 | All | Full gate, integration coverage per the five analyses, UPGRADE_NOTES (D-R5-21 behaviour change, A16, G26) | 5 |

## Open questions remaining

None blocking. Deferred on purpose:
- per-approver authority limits and approval chains (G24);
- cross-currency aggregate credit cap (customer groups Open Question 3);
- store-to-warehouse allocation (availability Open Question 2);
- re-linking quote-line attribution after a quote converts to an order (D-R5-26);
- checkout Open Question 2, narrowed by D-R5-9 to non-backorder partial fulfilment.
