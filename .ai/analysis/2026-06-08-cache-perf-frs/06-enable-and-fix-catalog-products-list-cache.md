> Auto-generated cache-performance Feature Request — candidate 6 of 9
> Endpoint: `GET /api/catalog/products` · ROI 78 · Verdict: good
> Source: `packages/core/src/modules/catalog/api/products/route.ts`
> Revised 2026-06-09: this FR is the **keystone of the whole backlog** — `invalidateCrudCache` no-ops while `ENABLE_CRUD_API_CACHE` is off (`packages/shared/src/lib/crud/cache.ts:180`), so every other FR that piggybacks on `crud:*` tags (01, 09, 10, 12, 13, 14) depends on this flag being enabled. Roll this out first. Scope extended to also alias `catalog.offer` (absorbing rescoped FR 08).

## Summary

`GET /api/catalog/products` is the hottest, most expensive read in the catalog module. It is built with `makeCrudRoute` (`packages/core/src/modules/catalog/api/products/route.ts:759`), so it is **already covered by the generic CRUD list cache** in `packages/shared/src/lib/crud/factory.ts` — but that cache is gated OFF behind `ENABLE_CRUD_API_CACHE` (`packages/shared/src/lib/crud/cache.ts:12-16`).

The fix here is therefore **not net-new caching code**. It is two coordinated pieces:

1. Enable + verify the generic CRUD list cache for this route.
2. **Close a real invalidation gap**: the route's `afterList` decorator (`decorateProductsAfterList`, `route.ts:351-741`) embeds offers, channels, categories, tags, variants and resolved prices into each cached product row. Those related entities are written by their **own** commands (`catalog.prices.*`, `catalog.offers.*`, `catalog.categories.*`, variants, tag assignments) whose command-bus invalidation only clears their own resource tags (`catalog.price`, `catalog.offer`, `catalog.category`, …) — **never `catalog.product`**. With the cache naively enabled, a price/offer/category change would leave a stale embedded payload in the cached product list, bounded only by TTL.

This FR enables the cache and makes the related-entity writes also invalidate the `catalog.product` collection tag (via cross-resource `cacheAliases`), so the cached list stays correct.

## Why (impact)

- **Hotness**: highest-traffic catalog read — product list page, product pickers in sales order/quote forms, dashboard product widgets, inventory screens, and the merchandising AI assistant selection. High read:write ratio (products and their prices/offers change far less often than they are listed).
- **Cost**: the `afterList` decorator (`route.ts:351-741`) is heavy: per page it runs parallel `findWithDecryption` lookups for offers, sales channels, category assignments (+ parent categories, populated), tag assignments (populated), variants, and prices (populated `offer`/`variant`/`product`/`priceKind`), unit conversions, then a full `catalogPricingService.resolvePriceMany(...)` resolution (`route.ts:693`). That is ~8-10 DB round-trips plus the pricing pipeline on every list call, on top of the base query-engine list query.
- **Est. win**: a cache hit collapses the entire base list query + the decorator's 8-10 queries + pricing resolution into a single cache `get`. For repeated navigation/pagination/picker reuse within the TTL window this is the dominant latency and DB-load reduction in the module.

## Current behavior

- Route is `makeCrudRoute(...)` — `packages/core/src/modules/catalog/api/products/route.ts:759`, with `hooks.afterList: decorateProductsAfterList` (`route.ts:844`).
- `decorateProductsAfterList` (`route.ts:351-741`) loads and embeds, per product: `offers[]` + channel name/code, `categories[]` (+ parentName), `tags[]`, `pricing{}` from `resolvePriceMany` (`route.ts:693-726`). It also re-sorts by search relevance.
- Generic CRUD cache flow in `factory.ts`:
  - Miss path: base query → `transformItem` → custom fields → **`afterList` runs (`factory.ts:1798`)** → interceptors → **`enrichAndStorePayload` stores the payload (`factory.ts:1818`)**. So the cached payload **already contains the decorated offers/categories/tags/pricing** — good for hit latency, but it means the cache entry's correctness depends on invalidation covering every related entity the decorator reads.
  - Hit path (`factory.ts:1521-1591`): cached payload is cloned and `afterList` is **re-run on the hit** (`factory.ts:1556`). (For this route that means the decorator re-runs anyway on a hit — partial win — unless the cached decorated fields are trusted; either way the base list query + custom-field decoration are saved.)
- **Cache key** already partitions by the full query string — `query:${serializeSearchParams(url.searchParams)}` (`factory.ts:903`), plus tenant, `selectedOrg`, and org scope (`factory.ts:895-904`). This means the pricing-context params (`offerId`, `customerId`, `customerGroupId`, `userId`, `userGroupId`, `quantity`, `quantityUnit`, `channelId`, `priceDate`) are part of the key — different pricing contexts get distinct entries, so embedded prices are not cross-served between contexts. This removes the main correctness worry about caching resolved prices.
- **Tags** are built by `buildCollectionTags` / `buildRecordTag` (`packages/shared/src/lib/crud/cache.ts:63-90`) and stored on `cache.set(...)` (`factory.ts:1456`).
- **Write path**: products are written via commands (`actions.create/update/delete` → `catalog.products.create|update|delete`, `route.ts:848/869/887`). In the command path the factory returns **without** calling `invalidateCrudCache` (`factory.ts:2120-2125`); invalidation is done by the command bus in `invalidateCacheAfterExecute` (`command-bus.ts:556-625`) from `metadata.resourceKind` + `deriveResourceFromCommandId`. The product commands set `resourceKind: 'catalog.product'` (`commands/products.ts:1408/1765/1972`), so product writes correctly clear the `catalog.product` collection + record tags.
- **The gap**: the related-entity commands set their own resourceKind only:
  - `commands/prices.ts:432/734/874` → `catalog.price`
  - `commands/offers.ts:193/358/482` → `catalog.offer`
  - `commands/categories.ts:228/393/538` → `catalog.category`
  - variants and tag assignments similarly scoped to their own resource.
  None of them invalidate `catalog.product`, yet all of them change what `decorateProductsAfterList` embeds into the cached product rows. (Offers and tag assignments don't even declare events in `events.ts`, so an event-subscriber-only invalidation strategy can't cover them — see Invalidation.)

## Proposed cache

No new cache key/TTL code is required for the list itself — reuse the generic CRUD list cache. The only new code is cross-resource invalidation (below). For reference, the existing behavior this FR relies on:

Key shape (already implemented, `factory.ts:884-916`, tenant-scoped + query-scoped):

```
crud|catalog.product|GET|/api/catalog/products|tenant:<tenantId>|selectedOrg:<orgId>|scope:<orgIds>|query:<serialized search params>
```

The cache service is resolved and tenant-scoped exactly as the reference pattern (`packages/core/src/modules/customer_accounts/services/domainMappingService.ts`) and the factory do:

```ts
import { runWithCacheTenant } from '@open-mercato/cache'
const cache = container.resolve('cache')
// read
const hit = await runWithCacheTenant(tenantId, () => cache.get(key))
// write with tags + ttl backstop
await runWithCacheTenant(tenantId, () => cache.set(key, value, { ttl, tags }))
// invalidate
await runWithCacheTenant(tenantId, () => cache.deleteByTags(tags))
```

TTL: set the generic CRUD list TTL to **120s** for this route (backstop only; tag invalidation is the primary mechanism). Justification: product/offer/category/price data is read-mostly and non-financial at read time (this list feeds quotation/exploration UI, not settlement), so a worst-case 120s convergence window if a tag invalidation is missed is acceptable. Keep it ≤120s so even fully-missed invalidations self-heal quickly.

Tenant scoping: enforced automatically — `buildCrudCacheKey` namespaces by `tenant:<tenantId>` and `invalidateCrudCache` wraps `deleteByTags` in `runWithCacheTenant(tenantId, …)` (`cache.ts:210`). No cross-tenant read is possible.

## Cache tags

For tenant `T`, org `O`, product id `P` (literal shapes from `buildCollectionTags` / `buildRecordTag`, `cache.ts:63-90`):

- `crud:catalog.product:tenant:<T>:org:<O>:collection` — the product **list** cache entry for tenant `T`, org `O`. This is the tag every product-list cache entry carries and the one that MUST be invalidated whenever any data embedded into the list changes.
- `crud:catalog.product:tenant:<T>:org:null:collection` — null-org variant (cross-org / unscoped listing).
- `crud:catalog.product:tenant:<T>:record:<P>` — per-record tag for product `P` (used by detail caches / single-record invalidation).

## Invalidation

All invalidation fires **post-commit** via the command bus (`invalidateCacheAfterExecute`, `command-bus.ts:556-625`), which runs after `commandBus.execute(...)` — i.e. after the domain write commits and outside `withAtomicFlush`. The fix is to make the related commands include `catalog.product` in `context.cacheAliases` so the same post-commit hook also clears the product collection tag.

| Trigger (route/command/event) | Where to call deleteByTags | Tags invalidated |
|---|---|---|
| `catalog.products.create` / `.update` / `.delete` (`route.ts:848/869/887`) | Already handled by command bus from `resourceKind: 'catalog.product'` (`commands/products.ts:1408/1765/1972`) → `invalidateCrudCache` (`command-bus.ts:610`) | `crud:catalog.product:tenant:<T>:org:<O>:collection`, `crud:catalog.product:tenant:<T>:record:<P>` |
| `catalog.prices.create/update/delete` (`commands/prices.ts:432/734/874`, resourceKind `catalog.price`) | Add `context: { cacheAliases: ['catalog.product', 'catalog.offer'] }` to each price command's log metadata so `extractAliasList` (`command-bus.ts:182-194`) adds both aliases; invalidation runs in `invalidateCacheAfterExecute`. (The `catalog.offer` alias keeps the offers list cache correct too — absorbed from rescoped FR 08.) | `crud:catalog.price:...` (own) **+** `crud:catalog.product:tenant:<T>:org:<O>:collection` **+** `crud:catalog.offer:...:collection` |
| `catalog.offers.create/update/delete` (`commands/offers.ts:193/358/482`, resourceKind `catalog.offer`) | Add `context: { cacheAliases: ['catalog.product'] }` to offer command metadata | `crud:catalog.offer:...` **+** `crud:catalog.product:...:collection` |
| `catalog.categories.*` + category **assignment** writes (`commands/categories.ts:228/393/538`) | Add `cacheAliases: ['catalog.product']` to the category-**assignment** command(s) (assignment is what changes a product's embedded `categories[]`); plain category rename also affects embedded `name`, so include it there too | `crud:catalog.category:...` **+** `crud:catalog.product:...:collection` |
| Tag-assignment writes (`CatalogProductTagAssignment`) | Add `cacheAliases: ['catalog.product']` to the tag-assignment command metadata. NOTE: tags have **no declared event** in `events.ts`, so an event-subscriber hook is NOT available — `cacheAliases` is the correct mechanism | `crud:catalog.product:...:collection` |
| `catalog.variant.created/updated/deleted` (variant commands) | Add `cacheAliases: ['catalog.product']` (variants change pricing rows that resolve into `pricing{}`) | `crud:catalog.variant:...` **+** `crud:catalog.product:...:collection` |
| Unit-conversion writes (`catalog.product_unit_conversion.*`) | Add `cacheAliases: ['catalog.product']` (conversions affect normalized pricing quantity) | `crud:catalog.product:...:collection` |

Event-subscriber alternative (only viable where an event id exists): a single ephemeral subscriber on `catalog.price.updated` / `catalog.category.updated` / `catalog.variant.updated` could call `invalidateCrudCache(container, 'catalog.product', …)`. **Reject this as the primary mechanism** because offers and tag assignments emit no events — use `cacheAliases` uniformly so coverage is complete, and keep TTL as the backstop.

## Implementation steps

- [ ] Set `ENABLE_CRUD_API_CACHE=on` in the target environment(s) and confirm `isCrudCacheEnabled()` (`cache.ts:12`) returns true; verify the route emits `x-om-cache: hit|miss` headers (`factory.ts:1516`).
- [ ] Configure / confirm the generic CRUD list TTL is 120s for this route (or globally acceptable).
- [ ] Add `context: { cacheAliases: ['catalog.product'] }` to the log metadata of every related command that feeds `decorateProductsAfterList`: prices (`commands/prices.ts`), offers (`commands/offers.ts`), category + category-assignment (`commands/categories.ts`), variant commands, tag-assignment command, and unit-conversion command. Mirror the existing `context: { cacheAliases: resourceTargets }` shape used by the factory (`factory.ts:2084/2386/2715`).
- [ ] Verify `deriveResourceFromCommandId` + `extractAliasList` produce both the own-resource tag and `catalog.product` for each (`command-bus.ts:604-617`).
- [ ] Confirm invalidation is post-commit (command bus calls it after `execute`, outside `withAtomicFlush`) — no change needed, just verify no command moved invalidation inside the flush.
- [ ] Confirm the cache key already varies by pricing context params; no key change needed (`factory.ts:903`).
- [ ] Add/extend integration tests (below) in `packages/core/src/modules/catalog/__integration__/`.

## Risks & staleness window

- **Convergence window**: up to the TTL (120s) only if a tag invalidation is missed; normal path is immediate post-commit invalidation. Non-financial read surface (quotation/exploration), so acceptable.
- **Embedded resolved prices**: safe to cache because the key partitions by pricing-context query params (`offerId`, `customerId`, `customerGroupId`, `userId`, `userGroupId`, `quantity`, `quantityUnit`, `channelId`, `priceDate`) — no cross-context price leakage.
- **Tenant isolation**: enforced by `runWithCacheTenant` + tenant-segmented keys/tags; no cross-tenant exposure.
- **Hit-path re-run of `afterList`**: the factory re-runs `afterList` on hits (`factory.ts:1556`), so even with a missed invalidation the decorated fields can be refreshed on read for the part the decorator recomputes; the cached portion is the base list. This further reduces staleness blast radius.
- **Cross-resource alias correctness**: the main risk is forgetting one related command (e.g. a future new entity embedded into the decorator). Mitigate by listing the dependency set in a code comment on `decorateProductsAfterList` and asserting it in tests.
- **Org-axis flush mismatch (double-checked)**: `invalidateCrudCache` flushes the collection tag for the org recorded in the command metadata (`cache.ts:191-198`). A command whose metadata lacks `organizationId` flushes only `org:null`, leaving org-scoped entries until TTL. Verify each aliased command (prices/offers/variants/tag-assignments/unit-conversions) records `organizationId` in its log metadata; the 120 s TTL backstops any that cannot.
- **Tenant-namespace matching (double-checked)**: the factory's `cache.set` inherits the request namespace from the API dispatcher (`apps/mercato/src/app/api/[...slug]/route.ts:382`); `invalidateCrudCache` wraps its flush in `runWithCacheTenant(tenantId, …)` with the write's tenant — these match. Any future flush from a queue worker must wrap explicitly or it lands in the `global` namespace and silently misses.

## Acceptance criteria / tests

- [ ] With cache enabled, two identical `GET /api/catalog/products` requests in the same tenant/org/query return the same payload and the second carries `x-om-cache: hit`.
- [ ] After `catalog.products.update` on a listed product, the next list request is a `miss` and reflects the change.
- [ ] After a **price** write (`catalog.prices.update`) on a listed product, the next list request reflects the new `pricing{}` (proves `cacheAliases: ['catalog.product']` invalidation) — this test FAILS before the fix and PASSES after.
- [ ] After an **offer** write, the next list reflects updated `offers[]`/`channelIds` (FAILS before fix).
- [ ] After a **category-assignment** and a **tag-assignment** write, the next list reflects updated `categories[]` / `tags[]` (tag test specifically proves the no-event path is covered by `cacheAliases`).
- [ ] Cross-tenant test: a write in tenant A never invalidates and never serves tenant B's cached list.
- [ ] Different pricing-context query params produce distinct cache entries (no price cross-serving).
- [ ] Tests are self-contained: create products/prices/offers/categories/tags via API fixtures in setup, clean up in teardown; no reliance on seeded data. Place under `packages/core/src/modules/catalog/__integration__/`.

## Labels

- `feature`
- `performance`
- `priority-medium`

