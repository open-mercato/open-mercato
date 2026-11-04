# eComm Release 4 — Write Side (fork) — Scope and Status

> **Release scope**: Cart module Phases 1–3 · Promotions (SPEC-055) Phases 1–3 · Buyer-Scoped Catalog Visibility Phase 3.
> **Base**: `develop` @ `28ca93ed97` (2026-10-14), which already contains the storefront read side (#7142).
> **Delivery**: implemented first on the `adeptofvoltron/open-mercato` fork (PR against fork `develop`), then proposed upstream.

## Release invariant

Cart totals are byte-for-byte equal to the totals of the order the cart becomes (cart-module ADR-2: the cart performs no arithmetic of its own).

Visibility Phase 3 ships in this release, not later: without it a product hidden in browsing can still be bought through the cart API (R1/R7 in the visibility spec). **No storefront add-to-cart may ship before it.**

## Specs in scope

| Spec | Phases | Pre-implementation analysis |
|---|---|---|
| `2026-08-14-cart-module.md` (rev 9, D-R4 decisions applied 2026-10-14) | 1 Core cart · 2 Pricing behaviour · 3 Promotions and merge (incl. §6a.5 merge-time re-visibility, lock/convert surface). Phase 4 (B2B, admin, proposal seam) is out of scope. | `ANALYSIS-2026-10-14-cart-module-release-4.md` |
| `SPEC-055-2026-02-23-promotions-module.md` | 1 Domain model and core admin · 2 Evaluation engine and cart API · 3 Codes system. Phases 4–5 are out of scope. | `ANALYSIS-2026-10-14-spec-055-promotions-release-4.md` |
| `2026-08-21-buyer-scoped-catalog-visibility.md` | 3 Cart write-path enforcement. Phases 1–2 shipped in #6709/#7142; Phase 4 is out of scope. | `ANALYSIS-2026-10-14-buyer-scoped-catalog-visibility-phase-3.md` |

## Ordering constraints (to be confirmed by the analyses)

- Promotions Phase 2 (evaluate API) must exist before cart Phase 3 can call `promotionsService`.
- Visibility Phase 3 amends `cart.lines.add/.update/.bulkAdd`, so it lands after cart Phase 1 and before the release is declared complete; its R1/R7 regression suite is the release gate for the write side.

## Status

| Step | State |
|---|---|
| Branch and fork PR | done |
| Pre-implement analysis: cart | done (2026-10-14) |
| Pre-implement analysis: promotions | done (2026-10-14) |
| Pre-implement analysis: visibility Phase 3 | done (2026-10-14) |
| Cross-spec consistency pass and decisions | done — see `ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md` (D-R4-1…29) |
| Spec revision pass | done (2026-10-14) — cart-module.md rev 9, SPEC-055 v2.2.0, buyer-scoped-catalog-visibility Phase 3 folded into cart, roadmap ADR-2/ADR-7 updated. PLAN.md Phase 0 (`.ai/runs/2026-10-14-ecommerce-release-4-write-side/`) |
| Implementation via `om-auto-continue-pr-loop` | pending — PLAN.md Phases 1–7 |
