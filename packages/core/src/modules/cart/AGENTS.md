# Cart Module — Agent Guidelines

Use `cart` for channel-agnostic basket state (storefront/POS/pay-link/agent/API), re-pricing, promotion application, merge and lock. This module ships Release 4 Phases 1-3 of `.ai/specs/2026-08-14-cart-module.md`; Phase 4 (B2B approvals, bulk lines, admin cart list, the proposal seam §7a) is spec-only — do not build it without a fresh plan/approval. Read `packages/core/AGENTS.md` first for the generic command/migration/ACL/`withAtomicFlush` contract; this file only covers what's specific to `cart`.

## Always

1. **MUST `container.register({ auth: asValue(auth) })` before resolving `promotionsService`** — `promotionsService.evaluate`/`.evaluateForProduct`/code/usage methods read `container.resolve('auth')` for tenant/org scope (no ambient auth context exists anywhere in this codebase) and fail closed with `400` when it's missing. `cart.reprice` (`commands/cart.ts`) is the reference call site: it registers `{ tenantId, orgId }` derived from the `Cart` row itself, inside the command, not at a route edge.
2. **MUST route every cart status check through `assertCartNotLocked` (`lib/lockGuard.ts`)** when adding a new mutation path — a locked cart returns a distinguishable `423 cart_locked` with `checkoutSessionId`, deliberately NOT folded into the generic no-enumeration-oracle 404 every other non-active status gets.
3. **MUST exclude flagged (`flagState != null`) and gift (`origin === 'promotion'`) lines from the catalog unit-price re-resolution phase** in `lib/reprice.ts`'s `buildCartLineRepricePhases`, and MUST evaluate that exclusion at execution time inside the per-line closure, not eagerly when the phase list is built — a line flagged by an earlier phase in the same `withAtomicFlush` cycle must still be excluded from its own re-pricing that cycle.
4. **MUST skip catalog unit-price re-resolution entirely for `promotion_applied`/`promotion_removed` triggers (trigger 6)** — those triggers re-run promotion effects only; §5.2's own contract is "effects only, not unit prices."
5. **MUST run the §6a.2 whole-cart re-visibility pass (`buildWholeCartRevisibilityPhase`, `lib/visibility.ts`) for every `cart.reprice` trigger that can change buyer-visible scope** — currently gated on `trigger === 'buyer_context_changed' || trigger === 'merge' || trigger === 'lock'`. Extend this gate's condition, never bypass it, if a future trigger also changes scope.
6. **MUST run the separate §6a.5 merge-time re-visibility pass in `buildMergeOutcome` (`commands/merge.ts`) for every incoming source line, before match/sum logic** — a failing line is rejected (`disposition: 'rejected'`, `targetLineId: null`), disclosed in `mergeSummary`/`CartMergeLog.outcome`, and kept in `source_snapshot`. Never silently drop a rejected line.
7. **MUST reject a cross-store or cross-currency `cart.merge`** with `400 cart_merge_scope_mismatch` before any line processing — the "same store and currency only" scope rule.
8. **MUST use `evaluateCartVisibility` (`lib/visibility.ts`)** — the only sanctioned caller of the shared `matchesScope` — for every per-write visibility check on `cart.lines.add`/`.update`/`.bulkAdd`; never call `matchesScope` directly from a new call site.
9. **MUST keep `CartLine.discountTotalNet` as the resolved effect's undivided net total** — never `|amount| / lineQuantity`. That per-unit division is the exact rev-8 bug the spec calls out by name; `lib/__tests__/totalsEquivalence.property.test.ts` (TC-CART-TOT-03/04) guards against reintroducing it.

## Ask First

- Ask before building any Phase 4 surface (B2B approvals, bulk lines, admin cart list at `/api/cart/carts*`, the proposal seam) — `acl.ts`'s `cart.carts.manage`/`cart.proposals.*` features already anticipate it, but nothing calls them yet; building ahead of the gate risks shipping a surface the spec hasn't finished specifying.
- Ask before fixing the currency/locale-digest-coupling gap (`Cart.currencyCode`/`.locale` never sync on a real currency/locale drift) as a side effect of unrelated work — it's an open item with a documented root cause (see Gotchas below); fix it as its own change with its own regression test, not folded into something else.
- Ask before adding a public HTTP route for `cart.lock`/`.unlock`/`.markConverted` — they are deliberately DI/command-only in this release, reserved for a future `checkout` module.
- Ask before changing the re-pricing trigger precedence (buyer identity > currency > locale > staleness) in `lib/triggers.ts` — downstream disclosure (`priceChanges`, `cart.price.changed`) and the Step 5.5 currency/locale findings below depend on this exact order.

## Never

- Never give `cart` its own arithmetic — unit prices come from `catalogBuyerPricingService.resolveLinePrice`, discounts from `promotionsService`, totals from `salesCalculationService.calculateDocumentTotals`. Re-implementing any of these breaks the quote/order totals-equivalence invariant this module exists to guarantee.
- Never accept `assortmentScope`, `channel`, or `storeId` as literal fields on a public request body — every `/api/cart/current/*` schema is `.strict()` and these are resolved server-side via `storeContextService`/`resolveCartRouteContext`. Adding one back reopens the exact Critical hole Release 4 closed.
- Never put a cart token in a URL path or query string — `X-Cart-Token` is the only credential; it is never logged via a referrer-prone surface.
- Never add `ce.ts`, `translations.ts`, `search.ts`, `notifications.ts`, or widget-injection files to this module — none exist today, by the spec's own non-goals for Phases 1-3.
- Never bypass `storeContext.buyer.*` for buyer-identity fields — `StoreContext` nests `assortmentScope`/`customerId`/`customerIds`/`customerGroupIds` one level under `.buyer`, not at the top level the spec's own §6a.1a pseudocode shows. Read through `lib/routeContext.ts`'s `resolveCartRouteContext`, not `StoreContext` directly.

## Validation Commands

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
yarn jest src/modules/cart
```

`cart/__integration__/*.spec.ts` (Playwright) need a live dev server + disposable Postgres — see `.ai/qa/AGENTS.md`. This app's dev server serves packages from built `dist/` output: rebuild (`yarn workspace @open-mercato/core build`) after every source edit, before any live/Playwright check.

## Commands

| Command id | File | When to use |
|---|---|---|
| `cart.create`, `cart.get` | `commands/cart.ts` | Create/resolve a cart by header token; `cart.create` forces the storefront channel unless the caller holds a `cart.channel.*` feature. |
| `cart.reprice` | `commands/cart.ts` | Not undoable, no `buildLog`. Triggers 2-6 (buyer/currency/locale/staleness/lock/promotion) live here via `lib/reprice.ts`/`lib/triggers.ts`/`lib/visibility.ts`/`lib/promotionContext.ts` phases, all inside one `withAtomicFlush`. |
| `cart.lines.add/.update/.remove/.bulkAdd` | `commands/lines.ts` | Line CRUD. `.update`'s tier-crossing re-price is trigger 1 — it lives here, not in `cart.reprice`, because it's a per-line event. `.bulkAdd` caps at 100 lines. |
| `cart.merge`, `cart.mergeUndo` | `commands/merge.ts` | Five login-time merge situations (adopt/keep_target/union/sum/conflict); 15-minute undo window (`409 merge_undo_window_expired` past it) via the single `restoreCartMerge` function. |
| `cart.promotions.apply/.remove` | `commands/promotions.ts` | Code application/reservation lifecycle. Resolves which promotion a code unlocks via a direct `Rule`/`Promotion` read — `Code.promotionId` does not exist as a column; the link is `Rule.config.codeId` on a `ruleType: 'code'` rule. |
| `cart.lock/.unlock/.markConverted` | `commands/lock.ts` | DI-only via `cartService` (`di.ts`'s one registered service, a thin facade mirroring `promotionsService`'s shape) — no public route exists for any of the three in this release. |

## Key Entities (`data/entities.ts`)

- **`Cart`** — `tokenHash` (unique; plaintext token shown once at creation, never persisted), `channel` (`storefront`/`pos`/`payLink`/`agent`/`api` — non-storefront channels are exempt from assortment-scope enforcement), `status` (`active`/`locked`/`converted`/`abandoned`/`expired`), `buyerDigest`/`assortmentScopeHash` (drive trigger 2 and the merge-scope-mismatch guard), `totals`/`totalsComputedAt` (never re-rounded on read). Since Step 8.2 (QA F12), `cart.lines.add`/`.update`/`.remove`/`.bulkAdd` recompute `totals` on every accepted write too — not only `cart.reprice` — by reusing `cart.reprice`'s own promotions-effects + totals phases inside their own `withAtomicFlush`; the only remaining staleness window is a `GET` with no re-price trigger (buyer/currency/locale drift or staleness timeout), which still returns whatever `totals` the last write left, per §5.2's own read-side design. `lockedAt`/`lockExpiresAt`/`checkoutSessionId`, `resolvedAt` (purge retention keys off this, not `expiresAt`). MUST keep `kind`/`proposedToCartId`/`mergedIntoCartId` (Phase 4 seam columns) even though Phase 4 isn't built — they already shipped in the Phase 1 migration.
- **`CartLine`** — `flagState` (nullable; `product_unavailable` when restricted, never deletes the line), `origin` (`customer`/`promotion`), `promotionId` (non-null only on a gift line), `discountTotalNet` (see Always #9). Unique index includes `promotionId` with `NULLS NOT DISTINCT` so two gift lines of the same product can coexist.
- **`CartPromotionApplication`** — MUST survive a re-price cycle when it carries a non-null `codeId` and its promotion currently doesn't match the cart (effect zeroed, not deleted); removed only by an explicit `cart.promotions.remove` or the reservation lapsing. A codeless (automatic) promotion's row IS pruned on absence. Keyed on `(promotionId, cartLineId)`.
- **`CartMergeLog`** — `outcome` jsonb extends the spec-frozen `CartMergeOutcomeEntry[]` shape with an additive `previousTargetQuantity` field so `cart.mergeUndo` can reverse a `summed`/`capped` disposition exactly; `sourceSnapshot` also carries `survivorBuyerContextBefore` for an adopt merge.
- **`CartIdempotencyKey`** — `cartId` FK is non-nullable, so idempotency structurally cannot cover `cart.create`; only `cart.lines.add`/`.bulkAdd` are covered.

## Gotchas (read before touching re-pricing, merge, or promotions code)

- **CONC-05, fixed**: `cart.lines.add`/`.bulkAdd`'s merge-by-quantity path is serialized by a per-cart `pg_advisory_xact_lock` held for the whole `withAtomicFlush({transaction:true})` block (commit `dd0747db83`), closing the race where 20 concurrent adds of the same product used to either 500 on the `cart_lines_unique_line_key` unique index or silently lose quantity. `TC-CART-CONC-05` in `cart/__integration__/TC-CART-CONC-01-05-concurrency-idempotency.spec.ts` is un-skipped and asserts exactly 1 line at quantity 20 after 20 concurrent adds.
- **Currency/locale digest coupling, open, not fixed**: a real currency/locale change through the storefront route always also changes `buyerDigest` (`ecommerce/lib/buyerContext.ts`'s digest formula embeds both), so `buyer_context_changed` always wins precedence over `currency_changed`/`locale_changed` in practice, and `applyCartRepriceTriggerFields` (`commands/cart.ts`) then never syncs `Cart.currencyCode`/`Cart.locale` because it only writes the fields belonging to the specific winning reason. The lines DO get re-priced with the new values; the cart's own `currencyCode`/`locale` columns just don't update. See `cart/__integration__/TC-CART-PRICE-01-02-reprice-triggers.spec.ts`'s header comment.
- **`catalogBuyerPricingService` has no page-batch/shared-cache mode** — `ecommerce/lib/storefrontPricing.ts` was deliberately NOT repointed onto it (attempted, reverted: it regressed the Storefront Public API's O(1)-query-budget invariant). Do not assume `ecommerce` and `cart` share one pricing code path; they don't yet.
- Trigger 7 (operator-forced reprice from an admin cart view) is deliberately deferred — no admin cart list/view exists in this module. Do not wire a new route to `cart.reprice` under a `/api/cart/carts*` path without first confirming Phase 4 is actually in scope for that change.
