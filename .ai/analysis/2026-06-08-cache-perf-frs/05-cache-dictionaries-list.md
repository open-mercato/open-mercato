> Auto-generated cache-performance Feature Request — candidate 5 of 9
> Endpoint: `GET /api/dictionaries` · ROI 82 · Verdict: good
> Source: `packages/core/src/modules/dictionaries/api/route.ts`

## Summary

Add a manual, tenant-scoped, tag-invalidated cache to the custom `GET /api/dictionaries` list handler in `packages/core/src/modules/dictionaries/api/route.ts`. This endpoint is a hand-rolled handler (NOT `makeCrudRoute`), so it bypasses the generic CRUD list cache in `packages/shared/src/lib/crud/factory.ts` entirely. It is read-mostly (dictionary definitions are admin-managed) and is hit on nearly every form/filter that references a dictionary, making it a clean hotness × cost × low-risk win.

Copy the get-then-set + `deleteByTags` pattern from `packages/core/src/modules/customer_accounts/services/domainMappingService.ts`, scoping every cache op with `runWithCacheTenant` from `@open-mercato/cache`.

## Why (impact)

- **Hotness**: The dictionary list is loaded whenever a form or filter that references a dictionary opens (entry-select controls, filter bars, the dictionaries manager page). Multiple calls per user session during data-entry workflows; high read:write ratio.
- **Cost**: The handler runs `resolveDictionariesRouteContext` (which itself does an `Organization` lookup to expand the readable-org inheritance set — `context.ts:68-86`) and then an org-scoped `em.find(Dictionary, …)` over the inheritance set with `orderBy: { name: 'asc' }` and a per-row response mapping (`route.ts:35-61`). Every request re-resolves the org ancestor set and re-queries.
- **Est. win**: Eliminates two DB round-trips (org-ancestor resolution + dictionary scan) per cache hit. For workflows that open many dictionary-backed selects, this turns a per-open query into an in-process/Redis read. Writes are rare (admin CRUD), so hit rate is very high.

## Current behavior

`packages/core/src/modules/dictionaries/api/route.ts`:
- `route.ts:25` `GET(req)` — custom handler, no `makeCrudRoute`, so the generic CRUD cache (`ENABLE_CRUD_API_CACHE`) does NOT apply here.
- `route.ts:27` resolves `resolveDictionariesRouteContext(req)`, which at `context.ts:68-86` queries `Organization` to compute `readableOrganizationIds` (the org + its `ancestorIds`).
- `route.ts:29` reads `includeInactive` from query.
- `route.ts:31-44` builds `organizationFilter` over `readableOrganizationIds` and runs `em.find(Dictionary, { organizationId $in, tenantId, deletedAt: null, isActive? }, { orderBy: name asc })`.
- `route.ts:46-61` maps each row to a DTO (adds computed `isInherited` and `entrySortMode`).
- Returns ONLY dictionary **definitions** — it does NOT read dictionary **entries**. Entry mutations (`dictionaries.entry.*` events) therefore do not affect this payload and must NOT trigger invalidation of this cache.

Writes that DO affect this list (all plain `em.flush()`, no command, no domain event for the dictionary aggregate):
- `route.ts:90-104` `POST` create.
- `packages/core/src/modules/dictionaries/api/[dictionaryId]/route.ts:107-173` `PATCH` update (name/key/description/isActive/entrySortMode; isActive=false also soft-deletes).
- `packages/core/src/modules/dictionaries/api/[dictionaryId]/route.ts:199-211` `DELETE` soft-delete.

## Proposed cache

The result set depends on `tenantId`, the caller's `readableOrganizationIds` set, and `includeInactive`. Build the key from a stable, sorted hash of the readable-org set plus the `includeInactive` flag; tenant scoping is handled by `runWithCacheTenant`.

- **TTL**: `5 * 60_000` ms (5 min), matching the reference `RESOLVE_TTL_MS` backstop in `domainMappingService.ts:18`. Dictionaries change rarely; tag invalidation is the primary freshness mechanism and TTL is only the backstop.
- **Tenant scoping**: wrap get/set/deleteByTags in `runWithCacheTenant(context.tenantId, …)` so keys/tags are auto-namespaced per tenant — never serve one tenant's list to another.

Code sketch (inside `GET`, after `resolveDictionariesRouteContext` and computing `includeInactive`):

```typescript
import { runWithCacheTenant } from '@open-mercato/cache'
import { DICTIONARIES_LIST_TAG, buildDictionariesListKey } from '@open-mercato/core/modules/dictionaries/lib/cache'

const cache = context.container.resolve('cache') as {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, opts?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

const cacheKey = buildDictionariesListKey(context.readableOrganizationIds, includeInactive)

const cached = await runWithCacheTenant(context.tenantId, () => cache.get(cacheKey)) as
  { items: unknown[] } | null | undefined
if (cached) return NextResponse.json(cached)

const items = await context.em.find(Dictionary, { /* unchanged */ }, { orderBy: { name: 'asc' } })
const body = { items: items.map((dictionary) => ({ /* unchanged mapping */ })) }

await runWithCacheTenant(context.tenantId, () =>
  cache.set(cacheKey, body, { ttl: 5 * 60_000, tags: [DICTIONARIES_LIST_TAG] }))

return NextResponse.json(body)
```

`buildDictionariesListKey` (new helper in `packages/core/src/modules/dictionaries/lib/cache.ts`) should sort + join the readable-org ids and append the `includeInactive` flag, e.g. `dictionaries:list:${includeInactive ? 'all' : 'active'}:${[...ids].sort().join(',')}`. The cache layer hashes + tenant-namespaces internally, so a long org list is fine.

Note: `isInherited` in the mapping is derived from `context.organizationId` (the selected org), which can differ between two callers who share the same `readableOrganizationIds` set. Include `context.organizationId` in the key as well (e.g. as a `sel:<orgId>` segment) so the `isInherited` flag is never served stale across selected-org contexts.

## Cache tags

- `dictionaries:list` — tenant-wide collection tag (literal: `DICTIONARIES_LIST_TAG = 'dictionaries:list'`). Represents "any variant of the dictionary definitions list for this tenant." Because dictionary writes are rare and any create/update/delete can shift the list across org-inheritance variants, a single tenant-wide tag (busting all key variants on any write) is the correct, simplest choice — `runWithCacheTenant` namespaces it per tenant so cross-tenant invalidation never happens.

## Invalidation

All invalidation fires AFTER `em.flush()` commits (post-commit, best-effort; TTL is the backstop). Entry-level events are intentionally excluded — the list payload contains no entry data.

| Trigger (route/command/event) | Where to call deleteByTags | Tags invalidated |
|---|---|---|
| `POST /api/dictionaries` create — `packages/core/src/modules/dictionaries/api/route.ts:104` | Immediately after `await context.em.flush()` (line 104), before building the 201 response | `['dictionaries:list']` |
| `PATCH /api/dictionaries/:id` update — `packages/core/src/modules/dictionaries/api/[dictionaryId]/route.ts:173` | After `await context.em.flush()` (line 173), before the response | `['dictionaries:list']` |
| `DELETE /api/dictionaries/:id` soft-delete — `packages/core/src/modules/dictionaries/api/[dictionaryId]/route.ts:211` | After `await context.em.flush()` (line 211), before `{ ok: true }` | `['dictionaries:list']` |
| `dictionaries.entry.created/updated/deleted` events | NOT invalidated — list contains no entry data | (none) |

Each invalidation call:

```typescript
await runWithCacheTenant(context.tenantId, () =>
  (context.container.resolve('cache') as { deleteByTags(t: string[]): Promise<number> })
    .deleteByTags([DICTIONARIES_LIST_TAG]))
```

Wrap in a `try/catch` that logs and swallows (best-effort) so a cache outage never fails the write.

## Implementation steps

1. Add `packages/core/src/modules/dictionaries/lib/cache.ts` exporting `DICTIONARIES_LIST_TAG = 'dictionaries:list'` and `buildDictionariesListKey(readableOrganizationIds: string[], includeInactive: boolean, selectedOrganizationId: string | null): string` (sorted org ids + flags + selected-org segment).
2. In `api/route.ts` `GET`: resolve `cache` from `context.container`, attempt `cache.get` (tenant-scoped) before the `em.find`, return the cached body on hit, otherwise compute and `cache.set` with `ttl: 5 * 60_000` and `tags: [DICTIONARIES_LIST_TAG]`.
3. In `api/route.ts` `POST`: after `em.flush()` (line 104), `deleteByTags([DICTIONARIES_LIST_TAG])` tenant-scoped, in a swallow-on-error block.
4. In `api/[dictionaryId]/route.ts` `PATCH` (after line 173) and `DELETE` (after line 211): same post-commit `deleteByTags`.
5. Add a unit test asserting (a) second identical GET hits cache (mock `em.find` called once), (b) POST/PATCH/DELETE each call `deleteByTags(['dictionaries:list'])` post-flush, (c) keys differ across `includeInactive` and across `readableOrganizationIds`/selected-org.
6. Confirm `runWithCacheTenant` import resolves from `@open-mercato/cache` and `cache` is registered in the request container (it is — used by `domainMappingService`).
7. Run `yarn workspace @open-mercato/core test` and `yarn workspace @open-mercato/core build`.

## Risks & staleness window

- **Staleness**: After a dictionary create/update/delete, other cached key variants (different org-inheritance sets) for the same tenant are all busted by the shared `dictionaries:list` tag, so no stale-after-write window for the editing tenant beyond the best-effort invalidation latency. If a `deleteByTags` call is dropped (cache outage), the 5-min TTL bounds staleness. Dictionary definitions are admin-managed and non-financial — a brief convergence window is acceptable (explicitly in-scope per the cache guidance: not money/stock/auth).
- **Cross-tenant safety**: `runWithCacheTenant(context.tenantId, …)` namespaces keys/tags; one tenant can never read or invalidate another's entries.
- **isInherited correctness**: handled by including `context.organizationId` in the key (see Proposed cache) so the per-caller `isInherited` flag is never served from a different selected-org context.
- **No entry coupling**: entry mutations don't touch this payload, so excluding them from invalidation is correct and avoids needless cache churn.

## Acceptance criteria / tests

- [ ] Two identical `GET /api/dictionaries` requests in the same tenant/org scope execute `em.find(Dictionary, …)` only once (second served from cache).
- [ ] `GET` with `?includeInactive=true` uses a distinct cache key from the default (active-only) request.
- [ ] Distinct `readableOrganizationIds` sets or distinct selected `organizationId` produce distinct cache keys.
- [ ] `POST`, `PATCH`, and `DELETE` each invoke `deleteByTags(['dictionaries:list'])` (tenant-scoped) AFTER `em.flush()`.
- [ ] A subsequent `GET` after any write returns the updated list (cache miss → recompute).
- [ ] Cache get/set/deleteByTags failures are swallowed and never fail the request (best-effort).
- [ ] No cross-tenant read: a second tenant's GET never returns the first tenant's cached body.
- [ ] `yarn workspace @open-mercato/core test` and `build` pass.

## Labels

- `feature`
- `performance`
- `priority-low`

