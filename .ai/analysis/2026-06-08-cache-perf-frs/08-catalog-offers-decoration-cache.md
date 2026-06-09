> Auto-generated cache-performance Feature Request — candidate 8 of 9
> Endpoint: `GET /api/catalog/offers` · ROI 72 · Verdict: good
> Source: `packages/core/src/modules/catalog/api/offers/route.ts`

## Summary

`GET /api/catalog/offers` is built with `makeCrudRoute`, but its expensive work lives in the `afterList` hook (`decorateOffersWithDetails`, `packages/core/src/modules/catalog/api/offers/route.ts:84-337`), which fires **8+ queries per page** (products fetch, two `findWithDecryption` price queries with `priceKind` populate, default-variant fetch, plus fallback-price priority scoring).

The generic CRUD list cache (`ENABLE_CRUD_API_CACHE`, gated off by default) caches only the **base list payload** built by the query engine — and re-runs `afterList` on **both** the cache-hit and cache-miss paths (`packages/shared/src/lib/crud/factory.ts:1556`). So even with the env flag enabled, the costly product/price decoration runs on **every** request. The base-list cache alone does not remove the hot cost here.

This FR proposes a **dedicated decoration cache** inside `decorateOffersWithDetails` (manual get-then-set, tenant-scoped) so the product/price/fallback-price computation is reused across requests, with explicit cross-entity tag invalidation (offers, prices, products) since price writes go through a *different* route that does not invalidate any offer cache today.

## Why (impact)

- **Hotness — high.** The offers list backs channel/offer admin lists, sales-channel context switching, and offer pickers in channel-scoped workflows. High read:write ratio (browse-heavy; offers and their prices change far less often than they are listed).
- **Cost — high.** `decorateOffersWithDetails` runs `Promise.all` of three queries (`packages/core/src/modules/catalog/api/offers/route.ts:111-137`) then a second `findWithDecryption` for fallback prices with `priceKind` populate (`route.ts:238-260`), followed by the `assignFallbackPrice` channel/variant priority scoring (`route.ts:210-319`). Two of these are decryption-aware price queries (SKU/price fields encrypted at rest), which are the most expensive in the set.
- **Est. win.** On warm cache, the decoration queries collapse from 8+ DB round-trips (2 of them decryption-aware) to a single cache `get` per page. For a page of 50 offers this removes the per-request product+price fan-out — the dominant latency in this handler.

## Current behavior

- `route.ts:339-435` — `makeCrudRoute` config. List query runs through the query engine; the per-item shape is produced by `transformItem` (`route.ts:373-392`).
- `route.ts:428-434` — `hooks.afterList` calls `decorateOffersWithDetails(items, ctx)` for every non-empty page.
- `route.ts:84-337` — `decorateOffersWithDetails`:
  - Collects `offerIds` and `productIds` from the page (`route.ts:89-94`).
  - `Promise.all` of: products fetch (`route.ts:113-120`), offer prices via `findWithDecryption` with `populate: ['priceKind']` (`route.ts:121-129`), default variants (`route.ts:130-136`).
  - A second `findWithDecryption` for offer-less fallback prices filtered by channel set (`route.ts:238-260`).
  - Builds `productMap`, `priceMap`, `productChannelPriceMap` with priority scoring (`route.ts:210-223`), then writes `item.product`, `item.prices`, `item.productChannelPrice`, `item.productDefaultPrices` (`route.ts:320-336`).
- Factory cache interaction (`packages/shared/src/lib/crud/factory.ts:1521-1588`): on a cache **hit** the stored base payload is cloned and `afterList` is invoked again (`factory.ts:1556`) — confirming the decoration is **not** covered by the base list cache.

**makeCrudRoute write invalidation already wired** for the offer entity itself: `factory.ts:2266` (created), `factory.ts:2597` (updated), `factory.ts:2882` (deleted) call `invalidateCrudCache(ctx.container, resourceKind, …)` with `resourceKind = catalog.offer`. The **gap**: prices are written by a separate route/command (`catalog.product_price`, `packages/core/src/modules/catalog/commands/prices.ts:409`) using `emitCrudSideEffects` with `entityId: E.catalog.catalog_product_price` — that path invalidates the `catalog.price` resource, **never** `catalog.offer`. So a price edit changes the decorated `productChannelPrice`/`productDefaultPrices` output but invalidates nothing on the offers side.

## Proposed cache

Cache the **decoration result keyed by the exact inputs that produce it**: the set of offer ids + product ids + channel ids on the page. Do the get-then-set inside `decorateOffersWithDetails`, tenant-scoped via `runWithCacheTenant`. There is no `getOrSet` — do manual get → compute → set, mirroring `packages/core/src/modules/customer_accounts/services/domainMappingService.ts`.

```typescript
// inside decorateOffersWithDetails, after computing offerIds/productIds/channel ids
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createHash } from 'node:crypto'

const cache = (() => {
  try { return ctx.container.resolve('cache') as CacheStrategy } catch { return null }
})()

// Deterministic key fragment from the inputs the decoration depends on.
const sortedOfferIds = [...offerIds].sort()
const sortedProductIds = [...productIds].sort()
const channelKeyIds = Array.from(new Set(
  items.map((i) => (typeof i?.channelId === 'string' ? i.channelId
    : typeof i?.channel_id === 'string' ? i.channel_id : null))
)).filter((v): v is string => !!v).sort()
const orgKey = scopeOrgIds.length ? [...scopeOrgIds].sort().join(',') : 'null'
const inputHash = createHash('sha1')
  .update(JSON.stringify({ orgKey, sortedOfferIds, sortedProductIds, channelKeyIds }))
  .digest('hex')
const cacheKey = `catalog:offers:decoration:${inputHash}`

// Tags: offer-collection + per-product + per-price-channel surfaces.
const tags = [
  `catalog:offers:decoration:tenant:${scopeTenantId}`,
  ...sortedProductIds.map((pid) => `catalog:product:tenant:${scopeTenantId}:record:${pid}`),
  ...sortedOfferIds.map((oid) => `catalog:offer:tenant:${scopeTenantId}:record:${oid}`),
]

if (cache) {
  const cached = await runWithCacheTenant(scopeTenantId, () => cache.get(cacheKey)) as
    | { productMapEntries: [string, unknown][]; perOffer: Record<string, unknown> }
    | undefined
  if (cached) {
    // apply cached decoration to items, then return early
    applyCachedDecoration(items, cached)
    return
  }
}

// ... existing compute path (the three Promise.all queries + fallback query + scoring) ...

if (cache) {
  const snapshot = buildDecorationSnapshot(items) // product/prices/productChannelPrice/productDefaultPrices per id
  await runWithCacheTenant(scopeTenantId, () =>
    cache.set(cacheKey, snapshot, { ttl: 300, tags })
  )
}
```

Tenant scoping: `runWithCacheTenant(scopeTenantId, …)` hashes + namespaces keys and tags per tenant — `scopeTenantId` is already required and asserted at `route.ts:97-100`. This is mandatory because SKU/price fields are encryption-at-rest and must never cross tenants.

TTL: **300s (5 min)** as a backstop. Justification: offers and prices are browse-mostly; promotional offer prices update on the order of hours; a 5-minute convergence window on a *browse list* is acceptable and matches the read-mostly profile. Tag invalidation (below) handles correctness on real writes; TTL only bounds drift from writes we did not tag.

## Cache tags

Literal tag strings (before tenant-namespacing applied internally by `runWithCacheTenant`):

- `catalog:offers:decoration:tenant:<tenantId>` — the whole decorated-offers surface for the tenant. Invalidate on any offer create/update/delete and any price create/update/delete in the tenant (coarse backstop).
- `catalog:offer:tenant:<tenantId>:record:<offerId>` — one decorated offer row. Invalidate when that offer is created/updated/deleted.
- `catalog:product:tenant:<tenantId>:record:<productId>` — product-derived fields (`item.product`, and product-scoped fallback prices). Invalidate when the product or any of its prices/variants change.

## Invalidation

| Trigger (route/command/event) | Where to call `deleteByTags` | Tags invalidated |
|---|---|---|
| Offer create/update/delete via `crud.POST/PUT/DELETE` (`packages/core/src/modules/catalog/api/offers/route.ts:437-440`) — already calls `invalidateCrudCache` at `factory.ts:2266/2597/2882` | Add a post-commit `deleteByTags` in the offer commands `execute`/`undo` AFTER `em.flush()` (e.g. `packages/core/src/modules/catalog/commands/offers.ts:174` create, and the update/delete equivalents), OR subscribe to `catalog.offer.created/updated/deleted` | `catalog:offers:decoration:tenant:<tenantId>`, `catalog:offer:tenant:<tenantId>:record:<offerId>` |
| Price create/update/delete (`packages/core/src/modules/catalog/commands/prices.ts:409/710/855`, `emitCrudSideEffects` with `entityId: catalog_product_price`) — **today invalidates only `catalog.price`, never offers** | Add post-commit `deleteByTags` keyed by the price's `productId`/channel (after the `emitCrudSideEffects` call, post-commit), OR add a subscriber on `catalog.price.created/updated/deleted` | `catalog:offers:decoration:tenant:<tenantId>`, `catalog:product:tenant:<tenantId>:record:<productId>` |
| Product update (title/media/sku) via `catalog.products.update` (`packages/core/src/modules/catalog/commands/products.ts:275`) | Subscriber on `catalog.product.updated` calling `deleteByTags` | `catalog:product:tenant:<tenantId>:record:<productId>` |
| Default-variant change via `catalog.variants.*` (`packages/core/src/modules/catalog/commands/variants.ts`) — affects fallback price routing through `variantToProductMap` (`route.ts:194-206`) | Subscriber on `catalog.variant.updated/created/deleted` calling `deleteByTags` on the owning product | `catalog:product:tenant:<tenantId>:record:<productId>`, `catalog:offers:decoration:tenant:<tenantId>` |

Preferred wiring: a single ephemeral subscriber (`persistent: false`) in `packages/core/src/modules/catalog/subscribers/` listening to `catalog.offer.*`, `catalog.price.*`, `catalog.product.updated`, and `catalog.variant.*`, resolving `cache` from DI and calling `runWithCacheTenant(tenantId, () => cache.deleteByTags(tags))` post-commit. This keeps invalidation out of the hot read path and centralizes the cross-entity mapping (price → product, variant → product). All invalidation must fire AFTER the domain write commits — never inside `withAtomicFlush`.

## Implementation steps

- [ ] In `decorateOffersWithDetails` (`route.ts:84`), resolve `cache` defensively from `ctx.container` (tolerate absence — return to plain compute).
- [ ] Build the deterministic `cacheKey` from sorted `offerIds` + `productIds` + page channel ids + org scope; build the `tags` array (decoration-tenant + per-offer + per-product).
- [ ] Gate the whole thing behind a feature flag env (e.g. `ENABLE_CATALOG_OFFERS_DECORATION_CACHE`, default off) so it can ship dark and be enabled per environment, consistent with `ENABLE_CRUD_API_CACHE`.
- [ ] On cache hit, apply the stored per-id decoration to `items` and return early (skip the queries).
- [ ] On miss, run the existing compute path, then `cache.set(key, snapshot, { ttl: 300, tags })` inside `runWithCacheTenant`.
- [ ] Add a `catalog/subscribers/offers-decoration-cache-invalidate.ts` ephemeral subscriber mapping `catalog.offer.*`, `catalog.price.*`, `catalog.product.updated`, `catalog.variant.*` to `deleteByTags` (price/variant → resolve owning `productId`). Run `yarn generate` after adding it.
- [ ] Verify the price command already emits `catalog.price.*` events the subscriber can hook (check `priceCrudEvents` in `commands/prices.ts`); if a needed event id is missing, add it to `catalog/events.ts` and `yarn generate`.
- [ ] Add unit tests for key/tag derivation and the hit/miss branch; add an integration test under `packages/core/src/modules/catalog/__integration__/` covering: list → edit a price → list again returns updated `productChannelPrice` (proves cross-entity invalidation), and offer update → list reflects change.

## Risks & staleness window

- **Staleness window:** up to the 5-min TTL only for writes not covered by a tag (defense-in-depth). All real offer/price/product/variant writes invalidate immediately via the subscriber, so the practical window is the brief convergence between post-commit invalidation and the next read.
- **Not financial-exact:** this caches a *browse* projection (`productChannelPrice`, `productDefaultPrices`). It is never the source of truth for checkout pricing — checkout uses `selectBestPrice`/`catalogPricingService` (`packages/core/src/modules/catalog/AGENTS.md`), which is unaffected. So a short browse-list staleness window carries no money-correctness risk.
- **Encryption / tenant isolation:** SKU and price fields are encrypted at rest; `runWithCacheTenant(scopeTenantId, …)` namespaces keys+tags per tenant and the key includes org scope — no cross-tenant or cross-org read. `scopeTenantId` is already asserted non-null (`route.ts:97-100`).
- **Cross-entity invalidation completeness is the main risk.** The price/variant→product mapping in the subscriber must be correct or a price edit could leave a stale decorated row until TTL. Mitigated by the coarse `catalog:offers:decoration:tenant:<tenantId>` tag on every price/variant write and bounded by TTL.

## Acceptance criteria / tests

- [ ] With the flag on, a second identical `GET /api/catalog/offers` for the same page performs zero decoration DB queries (verify via `OM_PROFILE=catalog.*` / `[crud:profile]` showing no product/price fan-out on the warm path).
- [ ] Editing a price for a product on the page (`catalog.product_price` write) invalidates and the next list returns the updated `productChannelPrice`/`productDefaultPrices` within one request (integration test).
- [ ] Updating/deleting an offer invalidates its decorated row immediately (integration test).
- [ ] Two tenants listing offers never read each other's decoration entry (key/tag tenant-isolation unit test).
- [ ] With the flag off, behavior is byte-for-byte identical to today (no cache get/set).
- [ ] `yarn workspace @open-mercato/core test` and the new catalog integration test pass.

## Labels

`feature`, `performance`, `priority-medium`
