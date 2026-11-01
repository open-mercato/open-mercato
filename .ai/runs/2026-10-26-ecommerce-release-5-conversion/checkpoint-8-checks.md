# Checkpoint 8 — Step 3.5 (closes Phase 3)

**Range:** Step 3.5 (`5bcf30e047`) — single Step, phase-close trigger (Phase 3 has 5 Steps, ≥3)
**Date:** 2026-10-27 (UTC)
**Runner:** local (no Docker `app` container running in this environment)

## Touched areas

- `packages/checkout/src/modules/checkout/` — `CheckoutLinkCartTemplate` entity + migration,
  trusted pay-link cart seeding (D-R5-19), reusable C9 store/channel/currency guard
- `packages/core/src/modules/cart/` — small, pre-approved (D-R5-19 Ask-First) additions: a
  `systemActor` bypass in `requireChannelFeature` for `pay_link` only, trusted `tenantId` fallback
  for a system actor with no `ctx.auth`

## Phase 3 summary (all 5 Steps)

Phase 3 (wave 3) is complete: `cart`'s approval gate (K1–K5) and entire §7a proposal seam
(commands + routes + sweepers + undo-merge refusal); `checkout` B.2 cart-backed links with
trusted pay-link seeding and the C9 consistency guard, ready for Step 4.1 to reuse at submit.
One fix-forward Step (`3.1-fix`) landed mid-phase for a genuine typecheck regression from Phase 2;
already verified at Checkpoint 7.

## Checks run

| Check | Scope | Result |
|---|---|---|
| `rm tsconfig.tsbuildinfo` (all packages) + `yarn typecheck --force` | full monorepo (40 packages) | ✅ pass — `40 successful, 40 total`, `0 cached` |
| `jest --config packages/core/jest.config.cjs src/modules/{cart,customer_groups,ecommerce}` | every `core` module touched across Phase 3 | ✅ pass — 142/144 suites, 1792/1800 tests (2 expected Postgres-gated skips) |
| `jest --config packages/checkout/jest.config.cjs` (full package) | all of `checkout`'s Phase 2+3 work | ✅ pass — 49/49 suites, 353/353 tests |

The C10 Phase-A-non-regression test (a pay-link-only app with no `cart` still completes a pay
link end to end) is included in the checkout suite above and re-verified explicitly by Step 3.5's
own executor before committing — this remains the single most load-bearing regression guard in
the whole `checkout` track and has now survived three consecutive Steps touching the module.

No UI touched in this window. The UI-verification debt (credit panel, cart admin pages) is
unchanged from Checkpoint 6 — unresolved, still committed to the next UI-touching Step or Step
6.1 at the latest. Two new, explicitly non-blocking gaps logged by Step 3.5: no admin write route
for `CheckoutLinkCartTemplate` yet, and link-template lines are catalog-product-only (no
freeform/non-catalog line support) — neither blocks Phase 4's submit work, which reads existing
templates rather than authoring them.

Step review: skipped — no `engine.stepReview` configured.

## Outcome

Checkpoint **passes**. Phase 3 is complete, full retrospective sweep green. Proceeding to Phase 4,
Step 4.1 (checkout B.4 submit, part 1).
