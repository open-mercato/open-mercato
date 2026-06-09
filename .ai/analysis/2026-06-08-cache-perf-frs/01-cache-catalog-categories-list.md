> Auto-generated cache-performance Feature Request — candidate 1 of 9
> Endpoint: `GET /api/catalog/categories` · ROI 86 · Verdict: strong-quick-win
> Source: `packages/core/src/modules/catalog/api/categories/route.ts`
> Revised 2026-06-09: invalidation now piggybacks on the **already-flushed** `crud:catalog.category:*` tags from the command bus — the previously proposed subscriber + bespoke tags are dropped.

## Summary

`GET /api/catalog/categories` is served by a **custom `export async function GET`** handler (not the `makeCrudRoute` GET), so it completely bypasses the generic CRUD list cache gated behind `ENABLE_CRUD_API_CACHE`. On every call it loads the full category set for the org, recomputes the entire hierarchy (`computeHierarchyForCategories` — a recursive ancestor/descendant/path walk), and for the `manage` view additionally runs a per-record custom-field aggregation (`loadCustomFieldValues`) over the paged rows. This data changes on the order of weeks but is read on nearly every product form load and category browse.

Add a manual tenant-scoped get-then-set cache **tagged with the same `crud:catalog.category:…:collection` tags the command bus already flushes** on every category command (`packages/shared/src/lib/commands/command-bus.ts:610`). Zero new invalidation wiring: no subscribers, no new tags, no per-write `deleteByTags` calls.

## Why (impact)

- **Hotness (high):** The category picker is rendered on every product create/edit form, the category browse/tree page, and dashboard category widgets. High read:write ratio — categories are mutated rarely (weeks), read constantly.
- **Cost (medium-high):** Per request: 1 `em.find` over all org categories (`route.ts:173`), a full recursive hierarchy computation (`computeHierarchyForCategories`, `categoryHierarchy.ts:40`), tree-node assembly for `view=tree`, and for `view=manage` a custom-field-values aggregation `loadCustomFieldValues` over the paged record ids (`route.ts:238-247`).
- **Est. win:** Near-elimination of the hierarchy recompute and the CFV aggregation on cache hits — virtually every request after the first becomes a single cache `get` within the TTL/invalidation window.

## Current behavior

File: `packages/core/src/modules/catalog/api/categories/route.ts`

- `GET` is a fully custom handler (`route.ts:131`), distinct from `crud.POST/PUT/DELETE` (`route.ts:285-287`). The CRUD list cache is **never** consulted for this read.
- `route.ts:173-177` — `em.find(CatalogProductCategory, { organizationId, tenantId, deletedAt: null })`; `route.ts:179` — `computeHierarchyForCategories(categories)`; `route.ts:207-271` — `view=manage` filtering/pagination + `loadCustomFieldValues`.
- **All category writes flow through commands** with `resourceKind: 'catalog.category'` (`commands/categories.ts:228/393/538`). After every execute/undo the command bus calls `invalidateCrudCache` (`command-bus.ts:610/642`), which flushes — post-commit, inside `runWithCacheTenant(tenantId, …)` — exactly these tags:
  - `crud:catalog.category:tenant:<T>:org:<O>:collection`
  - `crud:catalog.category:tenant:<T>:record:<id>`
- Custom-field edits also route through `catalog.categories.update` → same flush. The response is deterministic for `(tenantId, organizationId, categories snapshot, CFV, query params)`.

## Proposed cache

Manual get-then-set inside the `GET` handler. The API dispatcher already wraps the handler in `runWithCacheTenant(auth.tenantId, …)` (`apps/mercato/src/app/api/[...slug]/route.ts:382`), so `get`/`set` land in the correct tenant namespace automatically — the same namespace `invalidateCrudCache` flushes into.

```ts
import { buildCollectionTags, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const CATEGORY_LIST_TTL_MS = 10 * 60_000 // backstop; the crud:* tag flush carries correctness

function categoryListCacheKey(organizationId: string, q: QueryShape): string {
  return [
    'catalog:categories:list', organizationId, q.view,
    `p${q.page}`, `s${q.pageSize}`, `st:${q.status ?? 'all'}`,
    `q:${sanitizeSearch(q.search ?? null)}`, `ids:${(parseIds(q.ids) ?? []).join(',')}`,
  ].join('|')
}

// inside GET, after organizationId/tenantId are resolved:
const cacheEnabled = isCrudCacheEnabled() // MUST gate on the same flag the flush path checks
const cache = cacheEnabled ? (() => { try { return container.resolve('cache') } catch { return null } })() : null
const cacheKey = categoryListCacheKey(organizationId, query)

if (cache) {
  const hit = await cache.get(cacheKey)
  if (hit !== undefined && hit !== null) return NextResponse.json(hit)
}

// ... existing compute → build `payload` (the exact object passed to NextResponse.json today) ...

if (cache) {
  await cache.set(cacheKey, payload, {
    ttl: CATEGORY_LIST_TTL_MS,
    tags: buildCollectionTags('catalog.category', tenantId, [organizationId]),
  })
}
```

## Cache tags

- `crud:catalog.category:tenant:<T>:org:<O>:collection` — **reused, already flushed** by the command bus on every `catalog.categories.create|update|delete` execute and undo, post-commit. Built with the shared helper `buildCollectionTags('catalog.category', tenantId, [organizationId])` so the literal shape can never drift from the flusher's.

No new tags. No subscribers.

## Invalidation

| Trigger (route/command/event) | Where the flush already happens | Tags invalidated |
|---|---|---|
| `catalog.categories.create` (`commands/categories.ts:205`) | command bus `invalidateCacheAfterExecute` (`command-bus.ts:610`) — existing | `crud:catalog.category:tenant:<T>:org:<O>:collection` + record tag |
| `catalog.categories.update` (incl. custom-field edits, `commands/categories.ts:360-379`) | same — existing | same |
| `catalog.categories.delete` (`commands/categories.ts:519`) | same — existing | same |
| Command undo/redo | command bus `invalidateCacheAfterUndo` (`command-bus.ts:642`) — existing | same |

**Nothing to add on the write side.**

## Safety / non-invalidation risks (double-checked)

- **`ENABLE_CRUD_API_CACHE` gate:** `invalidateCrudCache` no-ops when the flag is off (`packages/shared/lib/crud/cache.ts:180`). The read-side cache is therefore gated on `isCrudCacheEnabled()` — flag off ⇒ no caching ⇒ behavior identical to today. Never ship this cache ungated.
- **Org-axis mismatch:** the command-bus flush targets the org recorded in the command metadata. If a category command ever logged a null `organizationId`, only the `org:null` collection tag would flush and an org-scoped entry would persist until TTL. The 10-min TTL is the backstop; `buildPayload` for categories always carries the org (`buildPayload`, `commands/categories.ts:27-31`), so this is theoretical.
- **Tenant namespace:** read-side set happens inside the dispatcher's `runWithCacheTenant(auth.tenantId)`; the flush wraps in `runWithCacheTenant(tenantId)` with the write's tenant — same namespace for same-tenant writes. Cross-tenant superadmin writes resolve `tenantId` from the record, still matching.
- **Out-of-band SQL edits / missed flushes:** bounded by the 10-min TTL. Category data is non-financial, read-mostly.
- **Never cache the `401`/`400` early-return branches** — only the successful computed payload.
- **Cache absence:** all paths guarded; if `cache` does not resolve, behavior is identical to today.

## Implementation steps

- [ ] Refactor the tail of `GET` so the response object is assembled into a single `payload` variable before `NextResponse.json(payload)` (both `tree` and `manage` branches).
- [ ] Add `categoryListCacheKey()` + the get-then-set block gated on `isCrudCacheEnabled()`, with tags from `buildCollectionTags('catalog.category', tenantId, [organizationId])`.
- [ ] Do NOT cache the `401`/`400` early-return branches.
- [ ] Verify nothing relies on the response being uncached/clock-fresh (it does not).
- [ ] `yarn workspace @open-mercato/core build` + `yarn workspace @open-mercato/core test`.

## Acceptance criteria / tests

- [ ] With `ENABLE_CRUD_API_CACHE=on`: two successive identical `GET /api/catalog/categories?view=manage` calls — the second is a cache hit (hierarchy compute not re-entered).
- [ ] Creating/updating/deleting a category then re-fetching reflects the change immediately (command-bus tag flush, no TTL wait).
- [ ] Editing a category **custom field** then re-fetching `view=manage` returns the new CFV values.
- [ ] With `ENABLE_CRUD_API_CACHE` off: no cache get/set occurs; behavior byte-identical to today.
- [ ] Tenant isolation: two tenants with identical org ids never collide; org-B writes do not affect org-A entries.
- [ ] `view=tree` / `view=manage` / pagination / search / status / ids variants cache independently.
- [ ] With cache unavailable (DI throws), the endpoint still returns correct data.

## Labels

`feature`, `performance`, `priority-medium`
