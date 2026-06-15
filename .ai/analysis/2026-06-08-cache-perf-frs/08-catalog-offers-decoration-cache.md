> Auto-generated cache-performance Feature Request — candidate 8 of 9
> Endpoint: `GET /api/catalog/offers` · ROI 72 → re-audited · Verdict: **rescoped — fold into FR 06's `cacheAliases` mechanism; defer the decoration cache**
> Source: `packages/core/src/modules/catalog/api/offers/route.ts`
> Revised 2026-06-09: the originally proposed dedicated decoration cache (snapshot store + apply-cached-decoration path + a 4-event-family subscriber + price→product mapping) is exactly the bespoke invalidation complexity this backlog now avoids. v1 keeps only the part that connects to existing infrastructure.

## Summary (revised scope)

`GET /api/catalog/offers` is built with `makeCrudRoute`; its expensive work lives in the `afterList` hook (`decorateOffersWithDetails`, `route.ts:84-337` — 8+ queries per page, two of them decryption-aware price queries).

The original FR proposed a dedicated decoration cache with its own snapshot format and a new cross-entity invalidation subscriber. **Rescoped v1** does neither. Instead:

1. **Base-list caching comes from FR 06** — enabling `ENABLE_CRUD_API_CACHE` covers this route's base list payload (query-engine query + custom-field decoration) with zero new code, invalidated by the existing `crud:catalog.offer:*` tags the factory and command bus already flush.
2. **Cross-resource correctness comes from one metadata line** — add `'catalog.offer'` to the `cacheAliases` of the price commands (and variant commands where they affect offer-channel fallback pricing), exactly the mechanism FR 06 already introduces for `catalog.product`. The command bus (`command-bus.ts:604-617`) then flushes `crud:catalog.offer:tenant:<T>:org:<O>:collection` on every price/variant write — closing the gap where a price edit changes the decorated output but invalidates nothing on the offers side. **This work item is merged into FR 06's implementation table** (see `06-enable-and-fix-catalog-products-list-cache.md`).
3. **The decoration itself intentionally re-runs on every request** — the factory re-runs `afterList` on cache hits (`factory.ts:1556`) by design, which is also what keeps the embedded prices fresh without bespoke machinery. The remaining per-request cost is the decoration fan-out only (the base query + CF decoration are saved on hits).

## What was deferred, and why

The dedicated decoration cache would additionally save the ~8-query decoration fan-out on warm pages. It required:
- a snapshot/apply format for per-offer decoration output,
- per-offer + per-product record tags maintained by hand,
- a new ephemeral subscriber over `catalog.offer.*`, `catalog.price.*`, `catalog.product.updated`, `catalog.variant.*`,
- a price→product and variant→product mapping inside that subscriber to target the right tags.

That is four new failure surfaces for one endpoint, duplicating freshness machinery the command bus already provides at the list level. Per the revised invalidation doctrine (README → "Invalidation doctrine"), this is deferred until profiling of the post-FR-06 state shows the decoration fan-out is still a top cost. The original full design is preserved in git history (PR #2905, commit `3616b2071`) and can be revived as a follow-up FR with that evidence.

## Remaining work in this FR (small)

- [ ] (With FR 06) Add `'catalog.offer'` to `context.cacheAliases` on price commands (`commands/prices.ts:432/734/874`) and variant commands where variant changes affect offer fallback pricing.
- [ ] Integration test under `packages/core/src/modules/catalog/__integration__/`: with `ENABLE_CRUD_API_CACHE=on`, list offers (warm the cache) → edit a price for a listed product → next `GET /api/catalog/offers` is a cache **miss** and returns updated `productChannelPrice`/`productDefaultPrices` (proves the alias flush). This test FAILS before the alias is added.
- [ ] Verify offer create/update/delete already invalidates correctly via the factory path (`factory.ts:2266/2597/2882`, resourceKind `catalog.offer`) — expected no-op, assert in the same test.

## Safety / non-invalidation risks (double-checked)

- **No new staleness surface is introduced by v1**: the base-list cache entry carries the factory's own `crud:catalog.offer:*` tags; price/variant writes flush them via the alias; the decoration re-runs on every request, so decorated prices are always live-computed.
- **Gate dependency**: everything here is inert until `ENABLE_CRUD_API_CACHE=on` (FR 06 rollout). The alias metadata is harmless when the flag is off (`invalidateCrudCache` no-ops, `cache.ts:180`).
- **Checkout pricing is unaffected** either way — checkout uses `selectBestPrice`/`catalogPricingService`, never this browse projection.

## Labels

`feature`, `performance`, `priority-low` (was priority-medium; the substantive work now ships with FR 06 / #2911)
