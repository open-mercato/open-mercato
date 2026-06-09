> Auto-generated cache-performance Feature Request — candidate 1 of 9
> Endpoint: `GET /api/catalog/categories` · ROI 86 · Verdict: strong-quick-win
> Source: `packages/core/src/modules/catalog/api/categories/route.ts`

## Summary

`GET /api/catalog/categories` is served by a **custom `export async function GET`** handler (not the `makeCrudRoute` GET), so it completely bypasses the generic CRUD list cache gated behind `ENABLE_CRUD_API_CACHE`. On every call it loads the full category set for the org, recomputes the entire hierarchy (`computeHierarchyForCategories` — a recursive ancestor/descendant/path walk), and for the `manage` view additionally runs a per-record custom-field aggregation (`loadCustomFieldValues`) over the paged rows. This data changes on the order of weeks but is read on nearly every product form load and category browse. Add a manual tenant-scoped get-then-set cache (mirroring `domainMappingService.ts`) with tag-based invalidation fired from the existing `catalog.category.{created,updated,deleted}` event subscribers.

## Why (impact)

- **Hotness (high):** The category picker is rendered on every product create/edit form, the category browse/tree page, and dashboard category widgets. High read:write ratio — categories are mutated rarely (weeks), read constantly.
- **Cost (medium-high):** Per request the handler does: 1 `em.find` over all org categories (`route.ts:173`), a full recursive hierarchy computation (`computeHierarchyForCategories`, `categoryHierarchy.ts:40`) building ancestor/descendant/path-label maps, tree-node assembly for `view=tree`, and for `view=manage` a custom-field-values aggregation `loadCustomFieldValues` over the paged record ids (`route.ts:238-247`). That is 2 queries + an O(N) graph walk + a CFV EAV aggregation on each hit.
- **Est. win:** Near-elimination of the hierarchy recompute and the CFV aggregation on cache hits. For a tenant whose categories are stable, virtually every request after the first becomes a single cache `get`. Expect the dominant per-request cost (graph walk + CFV load) to drop to ~0 on hits within the TTL/convergence window.

## Current behavior

File: `packages/core/src/modules/catalog/api/categories/route.ts`

- `GET` is a fully custom handler (`route.ts:131`), distinct from `crud.POST/PUT/DELETE` (`route.ts:285-287`). The CRUD list cache in `packages/shared/src/lib/crud/cache.ts` is therefore **never** consulted for this read — even if `ENABLE_CRUD_API_CACHE` were on, only factory GETs are covered.
- `route.ts:173-177` — `em.find(CatalogProductCategory, { organizationId, tenantId, deletedAt: null }, { orderBy: { name: 'ASC' } })`.
- `route.ts:179` — `computeHierarchyForCategories(categories)` (recursive walk in `packages/core/src/modules/catalog/lib/categoryHierarchy.ts:40-166`).
- `route.ts:181-205` — `view=tree`: builds nested `TreeNode` roots.
- `route.ts:207-271` — `view=manage`: status/search/ids filtering, pagination, then `loadCustomFieldValues(...)` (`route.ts:238-247`) and row assembly merging category scalars + CFV.
- Response is deterministic for a given `(tenantId, organizationId, categories snapshot, custom-field values, query params)`. No clock-sensitivity, no per-user secrets — the only auth-scoped axis is `(tenantId, organizationId)`, which is already the cache tenant/key boundary.

## Proposed cache

Manual get-then-set inside the `GET` handler, scoped with `runWithCacheTenant(tenantId, …)`. Key includes the org plus the full query shape (view/page/pageSize/search/status/ids) so distinct views/pages cache independently.

```ts
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'

const CATEGORY_LIST_TAG = 'catalog.categories.list'
const CATEGORY_LIST_TTL_MS = 10 * 60_000 // 10 min backstop; tags carry correctness

function categoryListCacheKey(organizationId: string, q: QueryShape): string {
  return [
    'catalog:categories:list',
    organizationId,
    q.view,
    `p${q.page}`,
    `s${q.pageSize}`,
    `st:${q.status ?? 'all'}`,
    `q:${sanitizeSearch(q.search ?? null)}`,
    `ids:${(parseIds(q.ids) ?? []).join(',')}`,
  ].join('|')
}

// inside GET, after organizationId/tenantId are resolved:
const cache = (() => { try { return container.resolve('cache') as CacheStrategy } catch { return null } })()
const cacheKey = categoryListCacheKey(organizationId, query)

if (cache) {
  const hit = await runWithCacheTenant(tenantId, () => cache.get(cacheKey))
  if (hit !== undefined && hit !== null) {
    return NextResponse.json(hit)
  }
}

// ... existing compute → build `payload` (the exact object passed to NextResponse.json today) ...

if (cache) {
  await runWithCacheTenant(tenantId, () =>
    cache.set(cacheKey, payload, {
      ttl: CATEGORY_LIST_TTL_MS,
      tags: [
        CATEGORY_LIST_TAG,
        `${CATEGORY_LIST_TAG}:org:${organizationId}`,
      ],
    }),
  )
}
```

Tenant scoping: `runWithCacheTenant(tenantId, …)` auto-prefixes/namespaces keys and tags per tenant, so org-A can never read org-B's entry even though the literal key only carries `organizationId`. Always wrap both the `get` and the `set` (and the invalidation `deleteByTags`) in `runWithCacheTenant(tenantId, …)`.

TTL justification: 10 minutes is a pure backstop against missed invalidations (e.g. an out-of-band SQL edit or a failed best-effort `deleteByTags`). Correctness comes from the event-driven tag invalidation; category data tolerates a multi-minute convergence window comfortably since it changes on the order of weeks.

## Cache tags

- `catalog.categories.list` — broad tag on every cached category-list entry for the tenant. Lets a single `deleteByTags(['catalog.categories.list'])` flush all views/pages/filters for the tenant on any category mutation. (Tenant-namespaced internally, so it only clears the writing tenant.)
- `catalog.categories.list:org:<organizationId>` — narrows invalidation to one organization within the tenant. Use when the mutation's org is known (it always is, from the event payload) to avoid clearing sibling orgs' caches.

(Both literal strings are written under `runWithCacheTenant(tenantId, …)`, which prepends the tenant namespace — so the effective tag is tenant-scoped.)

## Invalidation

Add one ephemeral subscriber per category event (or one subscriber handling all three). Invalidation MUST run on the event, which is emitted **post-commit** by `emitCrudSideEffects` (outside `withAtomicFlush`) in `packages/core/src/modules/catalog/commands/categories.ts` — so it is already after the DB commit. A single category write rebuilds the hierarchy for the whole org (`rebuildCategoryHierarchyForOrganization`), so every mutation must clear the org-scoped tag, not just one record.

| Trigger (route/command/event) | Where to call deleteByTags | Tags invalidated |
|---|---|---|
| `catalog.category.created` (emitted by command `catalog.categories.create`, `commands/categories.ts:205`) | New subscriber `subscribers/category-cache-invalidate.ts`; `runWithCacheTenant(payload.tenantId, () => cache.deleteByTags([...]))` | `catalog.categories.list:org:<payload.organizationId>` (and/or `catalog.categories.list` as a coarse fallback) |
| `catalog.category.updated` (command `catalog.categories.update`, `commands/categories.ts:369`) | same subscriber | `catalog.categories.list:org:<payload.organizationId>` |
| `catalog.category.deleted` (command `catalog.categories.delete`, `commands/categories.ts:519`) | same subscriber | `catalog.categories.list:org:<payload.organizationId>` |
| Category **custom-field** edit (also flows through `catalog.categories.update` → `setCustomFieldsIfAny` then `emitCrudSideEffects`, `commands/categories.ts:360-379`) | same subscriber via `catalog.category.updated` | `catalog.categories.list:org:<payload.organizationId>` — covers the CFV columns merged into `manage` rows |
| Command **undo/redo** (re-emit the same `catalog.category.*` events) | same subscriber | same as above |

Subscriber sketch (`packages/core/src/modules/catalog/subscribers/category-cache-invalidate.ts`):

```ts
export const metadata = { event: 'catalog.category.updated', persistent: false, id: 'category-cache-invalidate-updated' }
export default async function handler(payload, ctx) {
  const cache = ctx.resolve?.('cache') ?? ctx.container?.resolve('cache')
  if (!cache?.deleteByTags) return
  const orgTag = `catalog.categories.list:org:${payload.organizationId}`
  try {
    await runWithCacheTenant(payload.tenantId, () => cache.deleteByTags([orgTag, 'catalog.categories.list']))
  } catch { /* best-effort; TTL is the backstop */ }
}
```

(Repeat the export for `.created` and `.deleted`, or register one file per event id per the subscriber auto-discovery contract. The event payloads already carry `{ id, organizationId, tenantId }` per `buildPayload` in `commands/categories.ts:27-31`.)

## Implementation steps

- [ ] Refactor the tail of `GET` so the response object is assembled into a single `payload` variable before `NextResponse.json(payload)` (both `tree` and `manage` branches), so caching wraps one value.
- [ ] Add `categoryListCacheKey()` + the get-then-set block in `route.ts` using `container.resolve('cache')` guarded by try/catch (cache optional), wrapping `get`/`set` in `runWithCacheTenant(tenantId, …)`.
- [ ] Do NOT cache the `401`/`400` early-return branches — only cache the successful computed payload.
- [ ] Add `subscribers/category-cache-invalidate*.ts` for `catalog.category.created|updated|deleted` (ephemeral, `persistent: false`), each calling `runWithCacheTenant(payload.tenantId, () => cache.deleteByTags([...]))`.
- [ ] Run `yarn generate` so the new subscribers are discovered.
- [ ] Add tags `catalog.categories.list` and `catalog.categories.list:org:<org>` on `set`.
- [ ] Verify nothing relies on the response being uncached/clock-fresh (it does not — no timestamps computed at request time beyond `updatedAt` which comes from the row).
- [ ] `yarn workspace @open-mercato/core build` + `yarn workspace @open-mercato/core test`.

## Risks & staleness window

- **Staleness window:** Between a category write committing and the best-effort `deleteByTags` completing, concurrent reads may briefly see the pre-write hierarchy. Bounded by the 10-minute TTL even if invalidation fails. Acceptable: category structure is non-financial, non-stock, read-mostly, and changes on a weeks cadence.
- **Cross-tenant safety:** Enforced by `runWithCacheTenant(tenantId, …)` on every `get`/`set`/`deleteByTags`. The literal key carries only `organizationId`; tenant isolation is the namespace, never the key.
- **Org-scope correctness:** A single category mutation rebuilds the whole org hierarchy, so the invalidation clears the org-scoped tag (covering all views/pages/filters), not a single record tag — matching the blast radius of `rebuildCategoryHierarchyForOrganization`.
- **Custom-field edits:** Covered because CF writes route through `catalog.categories.update` → `catalog.category.updated`; the `manage` view's merged CFV columns are invalidated alongside.
- **Cache absence:** All paths are guarded — if `cache` does not resolve, behavior is identical to today.
- **Not the CRUD list cache:** This is deliberately a manual cache, because the read is a custom handler the factory cache cannot reach. Enabling `ENABLE_CRUD_API_CACHE` would NOT cache this endpoint.

## Acceptance criteria / tests

- [ ] Unit/integration: two successive identical `GET /api/catalog/categories?view=manage` calls for the same tenant/org — the second is a cache hit (assert via cache spy or `[crud][cache]`-style debug, or by asserting the hierarchy compute path is not re-entered).
- [ ] Creating a category (`POST`) then re-fetching the list returns the new category (tag invalidation fired on `catalog.category.created`).
- [ ] Updating a category's `name`/`parentId` then re-fetching reflects the change and the recomputed `pathLabel`/`depth`.
- [ ] Editing a category **custom field** then re-fetching `view=manage` returns the new CFV values (proves `catalog.category.updated` clears the manage cache).
- [ ] Deleting a category then re-fetching omits it.
- [ ] Tenant isolation: org-B writes do not invalidate or read org-A's cached entry; two tenants with identical org ids never collide (namespace test).
- [ ] `view=tree` and `view=manage` are cached independently (different keys); pagination/search/status/ids variants do not bleed into each other.
- [ ] With cache unavailable (DI throws), the endpoint still returns correct data.

## Labels

`feature`, `performance`, `priority-medium`

