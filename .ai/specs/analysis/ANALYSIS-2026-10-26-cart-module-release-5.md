# Pre-Implementation Analysis: Cart Module — Phase 4 (B2B and admin), eComm Release 5

> **Spec**: `.ai/specs/2026-08-14-cart-module.md` (rev 9; Phases 1–3 implemented in #7592).
> **Scope of this analysis**: Phase 4 only (spec §15): approval routing, bulk lines, the admin cart list, abandonment events, and the proposal seam of §7a (the `manual` strategy, `cart.proposal.*`, five routes, events, sweeper exemptions, `cart.cart.adopted`/`.purged`).
> **Verified against**: branch `feat/release-5-conversion` @ `1642142a3b`, i.e. the code Release 4 shipped, not the Release 4 plan. Every claim about the code cites the file it was read from.
> **Cross-checked with**:
> - D-R4-1…29 (`ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md`);
> - the 2026-09-21 assisted-selling seam decision (cart §7a, rev 7/8; `2026-09-22-assisted-selling.md` rev 5);
> - D-R5-1…10 (`ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md`);
> - findings G1–G26 (customer groups) and A1–A21 (availability).
>
> **Issue prefix**: K.

## The separate question: must the proposal seam ship in Release 5?

**No. It can be split out without harming checkout, and splitting it is the better choice.**

1. **Checkout B.1–B.5 does not touch proposals.** Checkout needs four things from the cart:
   - `lock` / `unlock` / `markConverted` (shipped in Release 4, `commands/lock.ts`);
   - the forced re-price and the visibility pass at lock (shipped);
   - the approval gate (K1–K4 below);
   - the conversion payload (K8).

   None of these reads `kind`, `proposed_to_cart_id`, `CartMergeLog.proposal_cart_id` or the `manual` strategy. A proposal is never locked (`lib/sweepers.ts` `releaseStaleCartLocks` notes this), and checkout's `cart.lock()` loads `kind: 'basket'` only (`commands/lock.ts:58`).
2. **Release 4 left the seam inert.** The seam columns exist (D-R4-19). Every command that loads a cart filters `kind: 'basket'`:
   - `commands/lines.ts:535`, `commands/promotions.ts:64`, `commands/lock.ts:58`;
   - `commands/cart.ts:474-479,638`;
   - `lib/cartActivity.ts:18-19`.

   The merge strategy is chosen by the server and never by the caller (`commands/merge.ts:495-538`; `cartMergeRequestSchema` is `{ sourceToken }.strict()`, `data/validators.ts:201-205`). So no path can create, reach or merge a proposal today. Deferring changes nothing for buyers or for checkout.
3. **The seam has no consumer in Release 5.** Its only author is `assisted_selling` (rep console, AI drafting, buyer review), which is spec-only (rev 5) and not in the release scope. Shipping the five routes and the `cart.proposal.*` behaviour now freezes them as STABLE (§16a "Contract freeze") before the one module that calls them has validated the shape. The ids already declared in `events.ts:27-31` are unaffected: declaring an id freezes the id, not behaviour nobody emits.
4. **Release 5 does not need it.** The release invariant (selling through the API and pay links, without a storefront of our own) holds without proposals. A rep-assisted sale before assisted selling exists goes through a pay link or an `api`-channel cart.

**What to keep in Release 5 even after splitting:**
- a regression test that pins the inert state (K12);
- the admin list's `kind = 'basket'` filter (K6).

The rest of §7a ships with the first phase of `assisted_selling`, as its own release item, together with that spec's pre-implementation analysis. If the owner wants the seam in Release 5 anyway, the gaps are listed under K13–K16 so it can be built without surprises.

## Executive Summary

Two of the four non-seam items are mostly done by Release 4:
- **bulk lines:** `/current/lines/bulk`, 100-entry cap, batched reads, one promotions-and-totals phase (`commands/lines.ts:103,1425-1470,765`);
- **abandonment:** `mark-abandoned-carts` and `cart.cart.abandoned` (`lib/sweepers.ts:49-110`).

What remains for them is a gate test and an event payload. Approval routing is the real Phase 4 work, and it is not ready:
- nothing computes `requiresApproval` (always `false`, `commands/cart.ts:297`);
- `lock` does not check approval (`commands/lock.ts`);
- the threshold is not in the cart's route context (`lib/routeContext.ts:70-100`) and not in the buyer digest (`ecommerce/lib/buyerContext.ts:400-407`);
- the spec never states the amount basis, the currency rule, guest handling or how an approval interacts with merge and abandonment.

Two Critical issues (K1, K2) and four High (K3–K5, K8) need the spec revision.

**Recommendation: needs spec updates first.** Split the proposal seam to its own release.

## Code baseline (what exists on the branch)

| Surface | State | Source |
|---|---|---|
| Routes | `/api/cart/current`, `/current/lines`, `/current/lines/[lineId]`, `/current/lines/bulk`, `/current/promotions`, `/current/promotions/[id]`, `/current/merge`, `/current/undo-merge`. **No** `/current/request-approval`, no `/proposals/*`, no admin `/carts`, no backend pages. | `cart/api/current/**` |
| ACL | All five §10.3 features plus four `cart.channel.*`; `employee` gets `cart.carts.view` | `cart/acl.ts`, `cart/setup.ts` |
| Events | All §11 ids are declared, including `cart.approval.requested`, `cart.proposal.*`, `cart.cart.adopted/.purged`. Emitted: `abandoned`, `expired`, `purged` (sweepers), `adopted`, `merged` (merge), `converted` (lock). **Never emitted:** `cart.approval.requested`, every `cart.proposal.*`. | `cart/events.ts:4-31`; grep of emit sites |
| `cart.cart.abandoned` payload | `{ cartId }` only | `lib/sweepers.ts:97-103` |
| `cart.cart.converted` payload | `{ cartId, tenantId, organizationId }`; `markConverted` takes no `salesOrderId` or `lineMap` | `commands/lock.ts:317-321` |
| Approval | `Cart.requiresApproval` (always written `false`) and `Cart.approvalId`; no command; `lock` ignores both | `data/entities.ts:180-185`; `commands/cart.ts:297`; `commands/lock.ts` |
| Threshold source | `BuyerContext.approvalRequiredAbove` exists in `ecommerce`, but `ResolvedCartRouteContext` does not carry it and the digest excludes it | `ecommerce/lib/buyerContext.ts:269-337,400-407`; `cart/lib/routeContext.ts:70-100` |
| Bulk | `cart.lines.bulkAdd` with `MAX_BULK_ADD_ENTRIES = 100`, batched visibility/product/variant/line reads, the shared `buildCartPromotionsAndTotalsPhases`, and a per-cart `pg_advisory_xact_lock` (CONC-05) | `commands/lines.ts:103,705-770,943,1425-1470` |
| Sweepers | `mark-abandoned` and `expire` filter `kind: 'basket'`; `purge` filters `kind: 'basket'` and excludes carts still referenced by `CartMergeLog`. `expire` does **not** release promotion code reservations (deferred in a code comment); there is a promotions-side reservation TTL sweeper. | `lib/sweepers.ts:49-200`; `promotions/workers/code-reservation-sweep.worker.ts` |
| Proposal guard | Structural (the `kind: 'basket'` filter gives a not-found). `409 proposal_cart_immutable` and the `501 not_supported` for `manual` (D-R4-19) are **not** implemented as error codes. | grep: no occurrences |
| Undocumented error codes | `cart_merge_scope_mismatch`, `merge_undo_window_expired` emitted but not in §15a (changelog 2026-10-15) | spec §18 |

## Backward Compatibility

All 13 surfaces were checked. Phase 4 is additive.

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| K9 | 5 Events | `cart.cart.abandoned` payload grows (K9), and `cart.cart.converted` gains `salesOrderId` + `lineMap` (K8). Both are additive fields on already-shipped ids. | OK (additive) | Document the payloads in §11; never remove fields |
| K8 | 3 Signatures | `cart.markConverted` input gains optional `salesOrderId`, `lineMap` | OK (additive) | Optional now; checkout always sends them |
| — | 7 Routes | New `/current/request-approval`, admin `/carts`, `/carts/[id]`, `/carts/[id]/reprice`; paths free per D-R4-6 | OK | — |
| — | 10 ACL | No new features needed; the existing ones cover admin. Proposal features are already declared. | OK | — |
| — | 8 DB | No new columns for approval: `requires_approval` and `approval_id` exist. A partial index for the admin list filter (K6) is additive. | OK | — |
| K10 | 15a error codes | Four codes are documented but not emitted, or emitted but not documented. `proposal_cart_immutable` and `501 not_supported` are specified, while the code answers not-found. `cart_merge_scope_mismatch` and `merge_undo_window_expired` are emitted but missing from §15a. | Warning | Align §15a with the code (the structural not-found is the better behaviour: no oracle); add the two emitted codes |
| — | 1, 2, 4, 6, 9, 11, 12, 13 | No changes | OK | — |

§16a exists. Add the Phase 4 additions: the event payload growth and the `markConverted` input.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Approval computation (§5 / §9) | Cart F4 cannot be built: no amount basis, currency, guest rule, recompute points (K1, K2, K4) | New §9a "Approval gate" |
| Approval × cart lifecycle | Merge, abandonment, expiry, conversion and re-request each leave an approval in an undefined state (K3, K5) | Transition table in §9a |
| Admin API contract (§10.2) | Fields, filters, sort, detail shape, decryption and the forced-reprice action are unspecified (K6) | Route table + response schema |
| Abandonment event payload | Recovery flows cannot be built on `{ cartId }` (K9) | Payload in §11 |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §10 `/current/request-approval` | No body, response, idempotency, requester rule or errors (K4) | Specify |
| §11 `cart.approval.requested` | No payload, and it duplicates `customer_groups.approval.requested` (K7) | Define or drop |
| §12 Jobs | Abandonment of a cart awaiting approval (K5); code-reservation release on expire/abandon is still undone (K11) | Amend |
| §14 Phase 4 gate | "Bulk evaluates promotions once" has no test; there are no approval tests beyond `TC-CART-B2B-03` (K17) | Extend |
| §15 Phase 4 | Bundles the seam with B2B (see the separate question) | Split |

## AGENTS.md Compliance

| Rule | Location | Fix |
|---|---|---|
| Public bodies `.strict()`; scope from the route edge (D-R4-1) | `/current/request-approval` is unspecified | `.strict()` empty body; amount and currency from the server-side totals, never the body (also G3) |
| Lists: `DataTable` with `entityId` + `extensionTableId`, `pageSize ≤ 100`; encrypted fields read via the decryption helpers | Admin list (§10.2) | K6 |
| Non-CrudForm writes wrapped in `useGuardedMutation`; optimistic lock header | Admin forced re-price | K6 |
| i18n for every warning and error | New codes `cart_requires_approval`, `approval_requires_identified_buyer` | Add `cart.warnings.*`/`cart.errors.*` keys in 5 locales |
| Cross-module coupling through DI/events, `customer_groups` already a hard `requires` | Approval calls | Use `customerPurchaseApprovalService` (G3) by DI; no import of `customer_groups` entities |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **K1** Approval basis differs between cart and checkout | The cart's gross excludes delivery (D-R4-14), while checkout's total includes it. Under D-R5-3 "only a higher total invalidates", every approved cart would need re-approval at checkout as soon as shipping is added. | One stated basis: goods gross after promotions, excluding delivery, in the cart's currency, used by cart, approval and checkout alike |
| **K2** Lock ignores approval | An over-threshold cart reaches checkout submit without approval. Checkout's precondition 6 is then the only control, and it has no data to read. | `cart.lock` refuses with `409 cart_requires_approval` unless a qualifying approved approval exists |
| **K3** Approval survives a content-changing merge or a conversion | An approval granted for cart A covers lines merged in from a guest cart, or is reused after the cart converted | Re-evaluate on every totals change; withdraw or close on merge source, expiry and conversion |
| **K5** Abandonment fires while the buyer waits for approval | Approval takes days (D-R5-1, checkout §8.2: the cart stays unlocked). At 24 h of inactivity the cart becomes `abandoned` and recovery flows nag a buyer who is waiting on their own manager. | `mark-abandoned-carts` skips carts with a pending approval |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **K4** Guest cart over a default-group threshold | `requiresApproval` is true, but a guest cannot request approval: a dead end at lock | Owner decision (K4) |
| **K8** `markConverted` lacks `salesOrderId`/`lineMap` | §11's commission-attribution obligation cannot be met; downstream degrades to order level | Additive inputs; checkout supplies them |
| **K11** Code reservations not released by the cart's own expiry/abandon path | Single-use codes are held until the promotions-side TTL instead of at cart end (R8) | Wire `codeService.releaseCode` by `cartId` in `expire` and `mark-abandoned` |
| **K6** Admin list over encrypted `email`/`note` with a free-text search | `$ilike` on ciphertext returns nothing silently | Search tokens or no email search; decrypt through the query engine |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Threshold change in group terms does not change the digest | `requiresApproval` stays stale until the next totals change | Recompute at lock from fresh terms (K2) regardless of the digest |
| Re-request leaves the old approved approval pointing at the cart | Two approvals for one cart | `Cart.approvalId` is authoritative; the cart and checkout read only it (K3) |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **K1: one amount basis for approval.**
  - State the basis as `totals.grandTotalGrossAmount` of the cart, which is goods after promotions and excludes delivery, per D-R4-14. Cart, `CustomerPurchaseApproval.amount_gross` and checkout precondition 6 all use it.
  - Under D-R5-3 a higher total re-requests approval, so checkout must compare the cart's goods total, not the session's delivery-inclusive total.
  - Currency follows D-R5-4: the threshold is compared only when the cart's currency equals `terms_currency_code`, otherwise `requiresApproval = true`.
- **K2: compute `requiresApproval` and gate `lock` on it.**
  - *Problem.* Nothing computes `requiresApproval` (`commands/cart.ts:297`); `ResolvedCartRouteContext` lacks the threshold (`lib/routeContext.ts`); non-storefront carts have no route context at all.
  - *Fix.*
    1. The cart resolves terms itself through `customerGroupsService.resolveTerms({ customerIds: cart.customerIds, tenantId })` inside the totals phase, so every channel is covered.
    2. It sets `requiresApproval` whenever totals change, and recomputes it from fresh terms at `lock`. The threshold is deliberately not in the digest (`buyerContext.ts:400-407`).
    3. `cart.lock` refuses with `409 cart_requires_approval` unless `Cart.approvalId` names an approval that is:
       - `approved`;
       - in the cart's currency;
       - with `amount_gross ≥` the current goods gross (K1);

       read live through `customerPurchaseApprovalService.getApproval` (G3).
    4. The refusal sits beside `cart_has_unavailable_lines` in §9 and §15a.
    5. Approval policy (`buyer`/`merchant`/`both`, D-R5-1) is opaque to the cart; it reads only the final status.

### Important Gaps (Should Address)

- **K3: approval × lifecycle table.** Two rules frame it:
  - The cart never denormalises approval status; `CartView.approval` reads it live.
  - Any change to the goods gross recomputes `requiresApproval`. An approval whose amount no longer covers the total stays on the cart but no longer qualifies, so the buyer re-requests and `approvalId` moves to the new one (D-R5-3).

  | Cart event | Effect on its approval |
  |---|---|
  | Totals rise above the approved amount | Approval stays, no longer qualifies; the buyer re-requests |
  | Cart merged into another (source side) | `withdrawApproval` on the source's pending approval |
  | Expired or purged | `withdrawApproval` if pending |
  | Converted | Approval left `approved`; the cart is terminal, so it cannot be reused |
  | Undo of a merge | Target recomputes; approvals are not restored automatically |

  The withdrawals are calls to the approval service from cart commands and sweepers, which `customer_groups` permits (the cart depends on `customer_groups`; the reverse dependency is what is forbidden).
- **K4: guest carts (owner decision).**
  - *Problem.* A tenant's default group can carry a threshold, and an anonymous cart cannot request approval (no `CustomerUser`, D-R5-1).
  - *Options.*
    - **(a)** `requiresApproval` is evaluated only for identified buyers; guest carts never require approval.
    - **(b)** Guest carts over the threshold are refused at lock with `409 approval_requires_identified_buyer` (fail-closed, like D-R5-4).
  - Recommend (b) for consistency with D-R5-4.
  - `/current/request-approval` requires `routeContext.customerUserId`; the requester is that `CustomerUser`, written from auth, never the body.
  - The route is idempotent per cart while an approval is pending (G8). Responses: `200` with the cart envelope and `approval`; `409 approval_not_required` when the cart does not need one; `409 cart_not_active`; `423 cart_locked`.
- **K5: no abandonment while awaiting approval.**
  - `mark-abandoned-carts` skips carts whose `approvalId` names a `pending` approval.
  - Checking per row is an N+1 against `customer_groups`. Instead the cart keeps `awaiting_approval_since` (one additive column), set by `request-approval` and cleared by the decision event.
  - A persistent subscriber on `customer_groups.approval.approved|rejected|expired|withdrawn`, filtered on `subjectType = 'cart'`, maintains that column and emits nothing else.
- **K6: admin list and detail contract.**
  - `GET /api/cart/carts`: `makeCrudRoute`, `indexer: { entityType: E.cart.cart }`, filters `status`, `channel`, `storeId`, `customerId`, `lastActivity` range, `kind` (default `basket`, the only accepted value while the seam is deferred), `requiresApproval`; sort by `lastActivityAt` or `totals.grandTotalGrossAmount`; `pageSize ≤ 100`; `cart.carts.view`.
  - `GET /api/cart/carts/[id]`: detail with lines, warnings, approval (live) and merge-log entries.
  - `POST /api/cart/carts/[id]/reprice`: trigger 7, `cart.carts.manage`, mutation guard plus optimistic-lock header, response `versionBumpReason: 'repricing'`.
  - `email`/`note` are decrypted through the query engine. No free-text email search (ciphertext); search by customer id instead.
  - Backend pages: a `DataTable` (`extensionTableId: 'cart.carts'`) and a read-only detail, i18n in 5 locales.
  - The route-enumeration test that no admin route mutates lines (§14) ships with them.
- **K7: `cart.approval.requested`.** Either give it a payload `{ cartId, approvalId, tenantId, organizationId, amountGross, currencyCode }` and emit it from `request-approval`, or drop it from §11 in favour of `customer_groups.approval.requested`. Recommend keeping it: a cart-side consumer should not need `customer_groups` events to follow a cart.
- **K8: conversion payload.** `cart.markConverted` takes `salesOrderId` and `lineMap: Array<{ cartLineId, salesOrderLineId }>` and emits them on `cart.cart.converted` (§11 rev 7 obligation). Record it as a checkout B.4 call-site requirement.
- **K9: abandonment payload.** `cart.cart.abandoned` carries `{ cartId, tenantId, organizationId, storeId, channel, customerId, customerUserId, hasEmail, currencyCode, grandTotalGrossAmount, lineCount, lastActivityAt }`. There is no email and no line detail; recovery re-reads through the API. Recovery flows themselves stay out of scope (checkout B.6 / workflows).
- **K10:** align §15a with the code (see the BC table).
- **K11:** release code reservations by `cartId` from `expire` and `mark-abandoned` (`codeService.releaseCode`), closing the Release 4 deferral noted in `lib/sweepers.ts:116-118` (R8).

### Nice-to-Have Gaps

- **K12: pin the inert seam while it is deferred.** Add a test that:
  - a `kind = 'proposal'` row inserted by fixture is unreachable from every `/current/*` route and command;
  - is never abandoned or expired by the basket sweepers;
  - never appears in the admin list.
- **K17: Phase 4 gate tests.**
  - `TC-CART-B2B-05`: 100-line bulk add calls `promotionsService.evaluate` exactly once (spy).
  - `TC-CART-APR-01…08`:
    1. threshold crossing sets `requiresApproval` on every totals change;
    2. lock refused without approval;
    3. lock allowed with a qualifying approval;
    4. a total above the approved amount refuses the lock;
    5. currency mismatch is fail-closed (D-R5-4);
    6. guest per K4;
    7. no abandonment while pending;
    8. withdrawal on merge source and on expiry.
  - The admin list with tenant and organization isolation, and the forced re-price conflict.

### If the seam stays in Release 5 (K13–K16)

- **K13:** `cart.line.visibility_rejected.triggeredBy` needs a `proposal_create` value. Accept already goes through `merge`.
- **K14:** `cart.proposal.reject` must release code reservations (§7a.5). Same wiring as K11.
- **K15:** `mark-abandoned`/`expire`/`purge` need the proposal branches of §12 and D-R4-20: proposal TTL from the store (72 h), `cart.proposal.expired`, purge from `resolved_at`. Today they filter `kind: 'basket'` and would never retire a proposal.
- **K16:** with no author UI in scope, every proposal test drives `POST /proposals` with an API principal. The five routes freeze before `assisted_selling` validates them (see the separate question).

## Remediation Plan

### Before Implementation (Must Do)

1. **Owner decisions, taken 2026-10-26 (`ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md`): D-R5-11, the seam stays in Release 5 (build §7a plus K13–K16; assisted-selling Phase 1 added to scope); D-R5-12, option (b) plus an admin warning on the default group:**
   - split the proposal seam out of Release 5 (recommended);
   - K4: guest carts over the threshold, (a) or (b).
2. **Spec revision of cart:**
   - new §9a Approval gate (K1–K5);
   - §10 request-approval and admin contract (K4, K6);
   - §11 payloads (K7–K9);
   - §12 sweeper changes (K5, K11);
   - §15a alignment (K10);
   - §14 Phase 4 gate (K12, K17);
   - §15 Phase 4 re-cut: B2B and admin in Release 5, §7a in its own release with `assisted_selling`.
3. **Consumer updates in the same pass:**
   - checkout §7.1 precondition 6 and §8.2 (approval basis = cart goods gross, cart is the subject, D-R5-3);
   - checkout B.4 `markConverted` inputs (K8).

### During Implementation

1. Order: customer-groups Phase 4 (approval service, G3) first, then cart K2–K5, then admin K6, then the K9/K11 sweeper items.
2. The approval read in `lock` and `CartView` is one batched service call per request.

### Post-Implementation (Follow Up)

1. The proposal seam with `assisted_selling` Phase 1.
2. Abandoned-cart recovery flows (checkout B.6 / workflows) on top of K9.

## Recommendation

**Needs spec updates first.**
- Approval routing is the substantive Phase 4 work, and the K1–K5 rules must be written before code.
- Bulk lines and abandonment need only a test and a payload.
- The admin list needs its contract.
- The proposal seam should leave Release 5. Checkout does not depend on it, Release 4 left it inert behind a structural guard, and shipping it now would freeze routes and behaviour before their only consumer exists.
