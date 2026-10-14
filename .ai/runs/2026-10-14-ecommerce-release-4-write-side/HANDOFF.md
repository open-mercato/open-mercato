# Handoff — 2026-10-14-ecommerce-release-4-write-side

**Last updated:** 2026-10-14T22:30:00Z (Phase 1 CLOSED; Phase 2 Steps 2.1-2.4 done)
**Branch:** feat/release-4-write-side
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/15 (draft, base `develop` on the fork)
**Current phase/step:** Phase 1 (Steps 1.1-1.10) fully done. Phase 2 Steps 2.1-2.4 done; resume at Step 2.5.
**Last commit:** see `git log` on `feat/release-4-write-side` — the Step 2.4 test-coverage commit is the most recent

## What just happened
- Phase 1 closed last session (see prior entries in this file's history / NOTIFY.md for 1.1-1.10 detail — not repeated here).
- Phase 2 (SPEC-055 Phase 2, the promotions evaluation engine) Steps 2.1-2.4 landed this session, each independently verified against the dispatched agent's actual diff (not the self-report) via a personal re-run of build/typecheck/the full promotions jest suite, plus the repo-wide `yarn typecheck --force`/`yarn lint --force` gate after every step:
  - **2.1** `lib/types.ts` (public contract + internal Normalized*/EvaluationContext shapes) + `lib/evaluation-engine.ts` (the pure orchestration loop — date window, excluded tags, currency eligibility, optimistic budget pre-check, Pass 1/2/3 call-outs). Pass 1/3 shipped as one-line throwing stubs, intentionally reserved for 2.2/2.3.
  - **2.2** `lib/rule-evaluators.ts` — all eleven Release-4 rule types, real AND/OR group composition. Needed two additive internal-type amendments: `EnrichedEvaluateItem`/`EvaluationInput` (category/attribute enrichment the public contract must never carry) and `excludeFlags` on `EvaluationContext` (D-R4-16).
  - **2.3** (split into 2.3a/2.3b given its size) `lib/unit-selection.ts` (selector ordering + cart-wide cap budget spending, §Amendment 2026-09-07 B.1-B.4) and `lib/effect-resolvers.ts` (all five shipped benefit types, `max_discount` capping, half-up rounding at the currency's minor units, D-R4-10). Reproduces `TC-PROM-014` and both halves of `TC-PROM-065` exactly. `resolveEffects` gained a third `promotionId` parameter (internal-only; `ADD_FREE_ITEM`'s D-R4-7 marker needs it).
  - **2.4** turned out to be **already satisfied by Step 2.1** (ordering/cumulativity/tag-exclusion logic already lived in `evaluation-engine.ts`) — same plan/reality overlap pattern as the Step 1.2/6.1 case in Phase 1. Its real remaining value — end-to-end tests proving these three properties against genuine matching promotions, which Step 2.1's own tests couldn't do while Pass 1/3 were still stubs — is now in `lib/__tests__/evaluation-engine.test.ts`.
- Current count: 106 promotions-module jest tests, all green. The evaluation engine's pure pipeline is now functionally complete end-to-end (types → orchestration → rules → unit selection → effects), missing only the DB-touching cache layer (Step 2.5) and the public service facade (Step 2.6) that wire it to real data.
- Judgment calls made across these steps (all flagged inline in code comments, continuing this module's own established culture of flagging unresolved spec ambiguities rather than silently picking one): plain `Number()` comparisons everywhere (no bignum library); net price as the default basis wherever the spec doesn't specify (no `taxInclusive`-equivalent field outside `order_value`); `basis` always `'net'` on every effect; a `fixed` discount is the full configured amount for `cart_discount` but a per-unit amount for line-targeted benefits; `max_discount` across multiple `LINE_DISCOUNT` effects from one invocation scales every line down by the identical ratio; `free_product`'s `categoryId`-only config (no catalog lookup available) emits no effect.

## Next concrete action
- Step 2.5: `services/promotion-cache.ts` — builds `NormalizedPromotion[]` from the ORM (every `active = true` promotion regardless of date window, per §Cache Build Contract), normalizes/denormalizes/flattens polymorphic rule-group trees, resolves `totalDiscountGranted` from a separate counters key, deep-freezes outside production. This is the first Phase 2 step that touches the database — needs a live dev DB the way Step 1.9/1.10 did. Read `.ai/qa/AGENTS.md` and consider whether the Step 1.9/1.10 live environment is still usable or needs re-provisioning (see Environment caveats below).
- Step 2.6: `promotionsService.evaluate`/`.evaluateForProduct` in a new `lib/promotions-service.ts` — the DI facade (§Amendment A.2) that does the batch context enrichment (category/tag/attribute resolution from `productId`/`variantId`, D-R4-21/C11) the pure engine has been assuming exists since Step 2.2, resolves `currencyFractionDigits` from the `currencies` module (assumed default-2 by Step 2.3b), and calls `evaluatePromotions`. This step is where the `EnrichedEvaluateItem`-building and `currencyFractionDigits`-resolving logic the pure `lib/*` files have been deferring to "a later step" finally gets written for real — read back through Steps 2.2/2.3b's code comments for the exact contract each deferred piece expects.
- Steps 2.7-2.8 follow per PLAN.md (API routes, then Phase 2's comprehensive test pass + the 200-promotion×50-line P95≤150ms benchmark).
- **A PR checkpoint comment covering Steps 1.7-2.4 is overdue** — the last one posted only covered through Step 1.6. Post one before or at the start of Step 2.5.

## Blockers / open questions
- None blocking. Phase 1 is complete; Phase 2 Steps 2.1-2.4 are complete and green.

## Environment caveats
- **This app's dev server serves packages from built `dist/` output, not live TypeScript source.** Any `packages/**/src` edit needs `yarn workspace @open-mercato/<pkg> build` before a running dev server/Playwright will see it. Not relevant to Steps 2.1-2.4 (pure jest-only, no browser/dev-server involvement) but will matter again once Step 2.7's API routes need browser/integration testing.
- The Step 1.9/1.10 live test stack (dev server, disposable Postgres `om_qa_prom19`, queue worker, scheduler) may or may not still be running by the time Step 2.5 starts — check `ps aux`/`psql -l` before assuming it's warm; re-provision per `.ai/qa/AGENTS.md` if not.
- Node 24 via `export PATH="/opt/homebrew/bin:$PATH"`. `TMPDIR=/tmp` export needed before any `tsx`-based script.
- No `timeout` binary on this Mac (zsh) — use a `while kill -0 $PID; do sleep N; done` loop with the Bash tool's own `run_in_background: true` instead.
- Fork repository: `adeptofvoltron/open-mercato`. Pass `-R adeptofvoltron/open-mercato` on every `gh` call. Upstream `open-mercato/open-mercato` must never be touched; issues are disabled on the fork.
- **Re-check `git fetch fork feat/release-4-write-side` before every push.**

## Worktree
- Path: this cezar run's own worktree (`.ai/cezar/worktrees/e12a1916-0f76-40d7-a20f-3395d9ab0856`), checked out at `feat/release-4-write-side`, tracking `fork/feat/release-4-write-side`.
