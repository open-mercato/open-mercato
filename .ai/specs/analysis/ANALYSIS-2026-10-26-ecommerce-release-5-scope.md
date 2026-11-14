# eComm Release 5 — Conversion (fork) — Scope and Status

> **Release scope**: Customer Groups & B2B Terms Phases 3–4 · Availability Contract Phase 3 · Cart module Phase 4 (with the §7a proposal seam) · Assisted selling (Phases 1, 2 partial, 4) · Checkout (unified funnel) Phases B.1–B.5 · additive SPEC-029 and SPEC-055 amendments.
> **Base**: `develop` @ `fc5f8d04ca` (2026-10-26), which already contains the storefront read side (#7142) and the Release 4 write side (#7592: cart Phases 1–3, promotions Phases 1–3, buyer-scoped visibility Phase 3).
> **Delivery**: one branch `feat/release-5-conversion`, one PR on the `adeptofvoltron/open-mercato` fork (base: fork `develop`), then proposed upstream.

## Release invariant

The platform sells through the API and pay links, with no storefront of its own. Every buyer-facing step of this release (cart B2B, checkout session, submit, B2B approval and credit) is reachable through the public API and through checkout links; no first-party storefront UI ships, and none is required to exercise any gate.

Phase A pay links keep their existing path end to end (checkout spec §2): a `CheckoutTransaction` with no `session_id` and no cart. This release adds nothing to that path and removes nothing from it.

## Specs in scope

| Spec | Phases | Pre-implementation analysis |
|---|---|---|
| `2026-08-14-customer-groups-and-b2b-terms.md` | 3 Credit (`CustomerCreditAccount`, ledger, `checkCredit`/`reserveCredit`/`releaseCredit`/`settleCredit`, admin credit UI, exposure audit) · 4 Approvals (`CustomerPurchaseApproval`, request/decision flow, approver resolution via `CustomerEntityRole`, notifications). Phases 1–2 shipped in #6709; Phase 5 is out of scope. | `ANALYSIS-2026-10-26-customer-groups-release-5.md` (G1–G26) |
| `2026-08-14-availability-contract.md` | 3 Reservations (`'checkout'` source type, `reserve`/`release`/`commit`, expiry and reconciliation jobs, shortfall events). Phases 1–2 shipped 2026-09-22. | `ANALYSIS-2026-10-26-availability-release-5.md` (A1–A21) |
| `2026-08-14-cart-module.md` (rev 10) | 4 B2B and admin: approval routing, bulk lines, admin cart list, abandonment events, the proposal seam (§7a). Phases 1–3 shipped in #7592. | `ANALYSIS-2026-10-26-cart-module-release-5.md` (K1–K17) |
| `2026-09-22-assisted-selling.md` (rev 6) | Added by D-R5-11; scope **decided** by D-R5-15/16: Phase 1 (with `mode` limited to `rep \| off`, no AI entities); Phase 2 items 1, 2 (server side), 3 and 5; Phase 4 with `lineMap` mandatory from checkout B.4. Phase 2 item 4, Phase 3 and Phase 5 are out. Prerequisite: SPEC-029 `storeContextService.resolveForBuyer`. | `ANALYSIS-2026-10-26-assisted-selling-release-5.md` (S1–S25) |
| `SPEC-029-2026-02-17-ecommerce-storefront-module.md` (v4.10) | Additive only: `storeContextService.resolveForBuyer` with `storeId` optional (D-R5-22), the one trusted buyer-identity seam for assisted selling, pay-link and API carts and checkout recovery. | `ANALYSIS-2026-10-26-assisted-selling-release-5.md` (S1) + cross-spec X2 |
| `SPEC-055-2026-02-23-promotions-module.md` | Additive only: `revertCodeUse` and a `sales.order.cancelled` subscriber (C5); delivery promotions un-hidden (D-R5-17). | `ANALYSIS-2026-10-26-checkout-release-5.md` (C5, C8) |
| `2026-03-19-checkout-simple-checkout.md` (v2.3) | B.1 Session and step machine · B.2 Cart-backed links · B.3 Delivery and payment · B.4 Submit · B.5 B2B. **B.6 Hardening is out of scope**, except the minimum C14 moves forward (rate limits, session encryption, payload redaction, token hash). Phase A pay links are implemented and unchanged. | `ANALYSIS-2026-10-26-checkout-release-5.md` (C1–C26) |

## Assisted-selling phase scope (confirmed by the cross-spec pass)

| Phase / item | Release 5 |
|---|---|
| Phase 1: `mode` limited to `rep \| off`, no AI entities, store-context `mode` exposure deferred | In |
| Phase 2 item 1: buyer thread routes, with D-R5-21 binding | In |
| Phase 2 item 2: `/thread/events`, server side only | In |
| Phase 2 item 3: full rep console | In |
| Phase 2 item 5: retention and erasure | In |
| Phase 4: attribution, order lines (D-R5-16) and quote lines (D-R5-26) | In |
| Phase 2 item 4 (storefront tray), Phase 3 (AI actor), Phase 5 (live transport) | Out |

## Implementation order (final)

Confirmed by the cross-spec pass; the wave table with dependencies is in `ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md` → Final implementation order.

0. Spec revision pass over every spec in scope at once (D-R4-29 discipline).
1. Foundations, in parallel:
   - the trusted-context helper and event scope fields (X10, X11);
   - `resolveForBuyer` (D-R5-22);
   - availability step 0 and the `wms` service (A1, A2);
   - customer-groups Phase 3 credit, row lock first (G1);
   - promotions C5 and the delivery un-hide (D-R5-17).
2. Second wave, in parallel:
   - availability reservations and jobs;
   - customer-groups Phase 4 approvals;
   - cart lock contract (C1, C2, D-R5-21), `markConverted` inputs, admin list, K9, K11 and the trusted pay-link path;
   - checkout B.1 and B.3.
3. Third wave:
   - cart approval gate (K1–K5, D-R5-23, D-R5-29);
   - cart §7a proposal seam;
   - checkout B.2.
4. Fourth wave:
   - checkout B.4 submit (D-R5-24, D-R5-30);
   - assisted-selling Phase 1 with Phase 2 items 1, 2 and 5.
5. Fifth wave:
   - checkout B.5 B2B;
   - assisted-selling console (Phase 2 item 3) and Phase 4 attribution.
6. Full gate, integration coverage and `UPGRADE_NOTES.md` (D-R5-21 behaviour change, A16, G26).

## Ordering constraints (original, now superseded by the order above)

- Availability Phase 3 (reservations) and customer-groups Phases 3–4 (credit, approvals) land before checkout B.4 (submit) and B.5 (B2B), which call `reserve`/`commit`, `reserveCredit`/`settleCredit` and the approval flow.
- Customer-groups Phase 4 (approvals) lands before cart Phase 4 approval routing: an over-threshold cart cannot lock until approved.
- Cart Phase 4 §7a (the proposal seam) and SPEC-029 `resolveForBuyer` land before assisted-selling Phase 1 (D-R5-11).
- Checkout B.1–B.3 depend only on the Release 4 cart and may proceed in parallel with the three prerequisites above.
- Checkout B.4 passes `salesOrderId` + `lineMap` to `cart.markConverted` (D-R5-16), which assisted-selling Phase 4 attribution depends on.
- Checkout carries the obligations recorded in Release 4 decision **D-R4-24** (`ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md`): at submit it calls the same `evaluateCartVisibility` as the cart, re-evaluates delivery effects, discloses newly appearing promotions, and refuses a channel/store mismatch. **D-R4-26** also applies: checkout is the first production caller of promotions `useCode`/`registerUsage`/`revertUsage`, so budgets and per-customer limits become enforced from B.4.

## Out of scope

- Checkout B.6 Hardening (rate limits, encryption, redaction, admin session viewer, the four seeded workflow definitions, stalled-instance monitor).
- Customer-groups Phase 5 (per-customer assortment overrides) and buyer-scoped visibility Phase 4.
- Any first-party storefront UI.

## Status

| Step | State |
|---|---|
| Branch and fork PR | done |
| Pre-implement analysis: customer groups F3–F4 | done (2026-10-26) — `ANALYSIS-2026-10-26-customer-groups-release-5.md` (G1–G26); owner decisions D-R5-1…7 in `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` |
| Pre-implement analysis: availability F3 | done (2026-10-26) — `ANALYSIS-2026-10-26-availability-release-5.md` (A1–A21); owner decisions D-R5-8…10 in `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` |
| Pre-implement analysis: cart F4 | done (2026-10-26) — `ANALYSIS-2026-10-26-cart-module-release-5.md` (K1–K17); owner decisions D-R5-11 (seam stays in Release 5, with assisted-selling Phase 1 added) and D-R5-12 |
| Pre-implement analysis: assisted selling (+ `resolveForBuyer`) | done (2026-10-26) — `ANALYSIS-2026-10-26-assisted-selling-release-5.md` (S1–S25); owner decisions D-R5-13…16 |
| Pre-implement analysis: checkout B.1–B.5 | done (2026-10-26) — `ANALYSIS-2026-10-26-checkout-release-5.md` (C1–C26); owner decisions D-R5-17…20; C14 moves the rate-limit/encryption minimum from B.6 into B.1/B.3 |
| Cross-spec consistency pass and decisions | done (2026-10-26) — `ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md` (X1–X20); owner decisions D-R5-21…36; assisted-selling phase scope confirmed; final implementation order set |
| Spec revision pass | done (2026-10-26) — every D-R5 decision and the G/A/K/S/C/X fixes applied to customer groups (Phases 3–4), availability (Phase 3), cart (rev 10), assisted selling (rev 6), checkout (v2.3), the roadmap ADRs (ADR-3, -4, -6, -7, -10, R5, R6) and SPEC-029 (v4.10, `resolveForBuyer`). **The specs are now the source of truth**; the decisions register is the audit trail. Not revised in this pass: SPEC-055 (C5 `revertCodeUse`, D-R5-17 un-hide), which follows with the promotions work in wave 1 |
| Implementation | pending |
