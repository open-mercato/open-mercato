# Handoff — 2026-10-14-ecommerce-release-4-write-side

**Last updated:** 2026-10-15T00:30:00Z (Phase 1, 2 CLOSED; Phase 3 functionally closed — one open item for the owner)
**Branch:** feat/release-4-write-side
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/15 (draft, base `develop` on the fork)
**Current phase/step:** Phases 1-2 fully done. Phase 3 (Steps 3.1-3.4) done except Step 3.4's Part A, a real open item for the PR owner (see below — does not block Phase 4). Resume at Phase 4, Step 4.1.
**Last commit:** see `git log` on `feat/release-4-write-side` — the Step 3.4 Parts B+C commit is the most recent

## OPEN ITEM for the PR owner (read this before Phase 7)
Step 3.4's Part A (repointing `ecommerce/lib/storefrontPricing.ts` onto the new `catalogBuyerPricingService.resolveLinePrice`, Step 3.1) was attempted and reverted — it regressed the Storefront Public API's own documented O(1)-query-budget invariant (measured: listing query-budget tests 15→21 queries, detail 7-11→16-34, the explicit "does not grow with variant count" test 9→28). `catalogBuyerPricingService.resolveLinePrice` is built per-line with no shared-cache/batch mode across multiple products/variants, so calling it once per target (the natural integration point) turns a page's dedup'd tax-rate/tier lookups into N independent ones. Needs a decision: (a) extend `catalogBuyerPricingService` with a page-batch/shared-cache mode (a Step 3.1 follow-up), or (b) treat `storefrontPricing.ts` as intentionally exempt from this repoint. Not a blocker for Phase 4 (cart's core entities) — only relevant once Phase 7 wires cart to `promotions`/`catalogBuyerPricingService` directly. Full detail in NOTIFY.md's `2026-10-15T00:30:00Z` entry and PLAN.md's Step 3.4 row.

## What happened before (Phases 1-2, unchanged from the prior entry)
Phase 2 (the promotions evaluation engine, SPEC-055 Phase 2) is fully closed. Built bottom-up across 8 steps, each independently verified against the dispatched agent's actual diff (never just its self-report) via a personal re-run of build/typecheck/the full `src/modules/promotions` jest suite after every step, plus the repo-wide `yarn typecheck --force`/`yarn lint --force` gate:

- **2.1** `lib/types.ts` (public contract + internal shapes) + `lib/evaluation-engine.ts` (orchestration loop). Pass 1/3 shipped as throwing stubs.
- **2.2** `lib/rule-evaluators.ts` — all eleven Release-4 rule types + AND/OR composition. Added `EnrichedEvaluateItem`/`EvaluationInput` (category/attribute enrichment) and `excludeFlags` to the internal type surface.
- **2.3** (split 2.3a/2.3b) `lib/unit-selection.ts` + `lib/effect-resolvers.ts` — all five benefit types, `max_discount` capping, half-up rounding. Reproduces `TC-PROM-014`/`TC-PROM-065` exactly. `resolveEffects` gained a third `promotionId` parameter.
- **2.4** Already satisfied by Step 2.1 (ordering/cumulativity/tag-exclusion logic already lived there) — added the missing end-to-end proof against real matches.
- **2.5** `services/promotion-cache.ts` — builds `NormalizedPromotion[]` from the DB (one batch query pass), separate per-promotion usage-counter cache key, eight ephemeral invalidation subscribers.
- **2.6** `lib/promotions-service.ts` — `promotionsService.evaluate`/`.evaluateForProduct`. **Found and closed a real gap**: no DI-resolvable "current auth" context exists anywhere in this codebase, yet `evaluate`'s signature is frozen with no scope parameter — resolved by having the service read `container.resolve('auth')`, documented as a new requirement for any in-process caller (flagged forward to Phase 7's cart integration in PLAN.md's Step 7.1).
- **2.7** Four cart-facing routes (`evaluate`, `product-page`, `dynamic-labels`, `free-products`) — new `lib/buyer-visibility.ts` resolves buyer-scope visibility via `customer_groups.CustomerGroupsService.resolveAssortmentScope`. `api/evaluate/route.ts` is the route that actually registers `auth` onto the request container, closing the loop Step 2.6 opened.
- **2.8** Closed Phase 2: `TC-PROM-081` (cross-tenant isolation for the four new routes — no leak found) and the 200×50-line performance benchmark (measured P95 = 5.085ms, far under the 150ms budget).

Current count: 125 promotions-module jest tests + 21 Playwright `__integration__` specs (`TC-PROM-001` through `TC-PROM-081`), all green. The evaluation engine is now a complete, working pipeline from DB-backed cache through HTTP, with every piece independently verified.

**Judgment calls made across Phase 2** (all flagged inline in code comments): plain `Number()` comparisons everywhere (no bignum library); net price as the default basis wherever the spec doesn't specify one; `basis` always `'net'`; a `fixed` discount is the full configured amount for `cart_discount` but per-unit for line-targeted benefits; `max_discount` across multiple `LINE_DISCOUNT` effects scales every line down by the identical ratio; `free_product`'s `categoryId`-only config emits no effect (no catalog lookup available); `product-page`/`dynamic-labels` resolve against an anonymous/default-group assortment scope since their wire contracts carry no buyer identity; all three visibility-filtered routes fail closed to empty results if scope resolution genuinely fails.

## Next concrete action
Phase 4 — Cart Phase 1 (core cart with visibility built in), Step 4.1. Read PLAN.md's Phase 4 section fresh and `.ai/specs/2026-08-14-cart-module.md` (rev 9, rewritten in Step 0.1) before dispatching — this is the first step of the `cart` module itself, a module that does not exist yet in this worktree. Do NOT wait on Step 3.4 Part A's open item before starting — it does not block Phase 4 (see "OPEN ITEM" note above).

**A PR checkpoint comment covering Steps 3.1-3.4 is due** before or at the start of Phase 4 — the last one posted covered through Step 2.8 (Phase 2's close).

## Blockers / open questions
None blocking. Phases 1 and 2 are both complete and green.

## Environment caveats
- **This app's dev server serves packages from built `dist/` output, not live TypeScript source.** Rebuild (`yarn workspace @open-mercato/<pkg> build`) after every source edit, before any browser/Playwright check.
- The Step 1.9/1.10 live test stack (dev server on :3000, disposable Postgres `om_qa_prom19`, queue worker, scheduler) was still running and actively used through the end of Phase 2 (Step 2.7/2.8's own Playwright specs ran against it). Check `ps aux`/`psql -l` before assuming it's still warm when Phase 3 starts; re-provision per `.ai/qa/AGENTS.md` if not.
- Node 24 via `export PATH="/opt/homebrew/bin:$PATH"`. `TMPDIR=/tmp` export needed before any `tsx`-based script.
- No `timeout` binary on this Mac (zsh) — use a `while kill -0 $PID; do sleep N; done` loop with the Bash tool's own `run_in_background: true` instead.
- Fork repository: `adeptofvoltron/open-mercato`. Pass `-R adeptofvoltron/open-mercato` on every `gh` call. Upstream `open-mercato/open-mercato` must never be touched; issues are disabled on the fork.
- **Re-check `git fetch fork feat/release-4-write-side` before every push.**
- **New cross-module convention from Step 2.6/2.7**: `cart` (Phase 7) must `container.register({ auth: asValue(auth) })` on its own request container before resolving `promotionsService`, or every `evaluate`/`evaluateForProduct` call fails closed with a 400. Already flagged forward in PLAN.md's Step 7.1 note.

## Worktree
- Path: this cezar run's own worktree (`.ai/cezar/worktrees/e12a1916-0f76-40d7-a20f-3395d9ab0856`), checked out at `feat/release-4-write-side`, tracking `fork/feat/release-4-write-side`.
