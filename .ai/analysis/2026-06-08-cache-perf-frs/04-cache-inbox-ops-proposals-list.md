> Auto-generated cache-performance Feature Request — candidate 4 of 9
> Endpoint: `GET /api/inbox_ops/proposals` · ROI 82 · Verdict: good
> Source: `packages/core/src/modules/inbox_ops/api/proposals/route.ts`

## Summary

Add a tenant-scoped, tag-invalidated read cache to the custom (non-`makeCrudRoute`) handler `GET /api/inbox_ops/proposals` (`packages/core/src/modules/inbox_ops/api/proposals/route.ts`). The handler runs a decrypted `findAndCountWithDecryption` plus three parallel `findWithDecryption` joins (emails, actions, discrepancies) and an in-memory enrichment loop on every page load and every poll of the proposals table.

This is a **reuse-the-existing-infrastructure** change, not new infrastructure. The sibling badge endpoint `GET /api/inbox_ops/proposals/counts` is **already cached** with the canonical pattern (`runWithCacheTenant` + `cache.get`/`cache.set` with `ttl` + `tags`, helper module `lib/cache.ts`), and invalidation is **already wired into 8 mutating call sites** via `invalidateCountsCache`. We extend that same `lib/cache.ts` module with a list-cache key/tag/TTL + `invalidateProposalsListCache`, cache the list response in the handler, and add one `invalidateProposalsListCache(...)` call next to each existing `invalidateCountsCache(...)` call (and fix the `reprocess` route, which currently invalidates neither cache).

## Why (impact)

- **Hotness — high.** Primary intake/triage workflow surface. Loaded on the proposals page and re-fetched on filter/tab/pagination changes; the page already polls `/proposals/counts` for badges (which is why that endpoint was cached first). The list itself is the most-read endpoint of the module.
- **Cost — high.** Per request the handler executes (route.ts):
  - `findAndCountWithDecryption(InboxProposal, …)` — paginated list **with decryption overhead** (lines 52-62).
  - `Promise.all` of three more decrypted queries: `InboxEmail` by id-set, `InboxProposalAction` by proposal-id-set, `InboxDiscrepancy` (unresolved) by proposal-id-set (lines 68-78).
  - An enrichment loop that maps relationships and computes `actionCount` / `pendingActionCount` / `discrepancyCount` / email subject/from/receivedAt per row (lines 82-96).
  That is 4 decrypted round-trips + O(rows × actions) in-memory filtering per request, all of it identical across repeated reads between writes.
- **Est. win.** Read:write ratio is high (proposals are read-mostly until a triage action). A 30s TTL cache (matching the counts endpoint) collapses the common "load page → switch tab → page back" burst and the poll cadence to a single DB hit per (tenant, filter, page) per TTL window. Expect the large majority of list reads served from cache with zero decryption work.

## Current behavior

`packages/core/src/modules/inbox_ops/api/proposals/route.ts`:
- `route.ts:18-24` — parses `status`, `category`, `search`, `page`, `pageSize` (schema `proposalListQuerySchema`, `data/validators.ts:267-273`; `pageSize` max 100, default 25).
- `route.ts:26` — `resolveRequestContext(req)` yields `ctx.tenantId`, `ctx.organizationId`, `ctx.scope`, forked `ctx.em`, `ctx.container`.
- `route.ts:52-62` — `findAndCountWithDecryption(ctx.em, InboxProposal, where, { limit, offset, orderBy }, ctx.scope)`.
- `route.ts:68-78` — three parallel `findWithDecryption` calls (emails / actions / discrepancies).
- `route.ts:82-96` — enrichment loop producing `actionCount`, `pendingActionCount`, `discrepancyCount`, `emailSubject`, `emailFrom`, `receivedAt`.
- `route.ts:98-104` — returns `{ items, total, page, pageSize, totalPages }`.

No caching today. Not a `makeCrudRoute` route, so the generic `ENABLE_CRUD_API_CACHE` list cache does **not** apply — manual cache is the correct fix.

Existing infrastructure to reuse:
- `packages/core/src/modules/inbox_ops/lib/cache.ts` — `resolveCache(container)`, `createCountsCacheKey/Tag`, `invalidateCountsCache`, TTL constants. We add list-cache equivalents here.
- `packages/core/src/modules/inbox_ops/api/proposals/counts/route.ts:24-83` — the exact get-then-set-with-tenant-scope pattern to copy.

## Proposed cache

**Key** — tenant-scoped via `runWithCacheTenant` (which already prefixes/namespaces per tenant), plus the query params that change the result set. Keep the key stable/short by hashing the param tuple:

```ts
// lib/cache.ts (additions)
const PROPOSALS_LIST_CACHE_PREFIX = 'inbox_ops:proposals:list'
export const PROPOSALS_LIST_CACHE_TTL_MS = 30 * 1000 // mirror COUNTS_CACHE_TTL_MS

export function createProposalsListCacheKey(
  tenantId: string,
  organizationId: string,
  params: { status?: string; category?: string; search?: string; page: number; pageSize: number },
): string {
  const parts = [
    organizationId,
    params.status ?? '',
    params.category ?? '',
    params.search ?? '',
    String(params.page),
    String(params.pageSize),
  ].join('|')
  return `${PROPOSALS_LIST_CACHE_PREFIX}:${tenantId}:${parts}`
}

export function createProposalsListCacheTag(tenantId: string): string {
  return `${PROPOSALS_LIST_CACHE_PREFIX}:${tenantId}`
}

export async function invalidateProposalsListCache(
  cache: CacheStrategy | null | undefined,
  tenantId: string,
): Promise<void> {
  if (!cache?.deleteByTags) return
  try {
    await cache.deleteByTags([createProposalsListCacheTag(tenantId)])
  } catch (err) {
    console.warn('[inbox_ops:cache] Failed to invalidate proposals list cache', err)
  }
}
```

**Handler** — wrap get-then-set in `runWithCacheTenant`, identical structure to the counts route:

```ts
// route.ts, after parsing query + resolveRequestContext
const cache = resolveCache(ctx.container)
const cacheKey = createProposalsListCacheKey(ctx.tenantId, ctx.organizationId, query)

if (cache) {
  const cached = await runWithCacheTenant(ctx.tenantId, () => cache.get(cacheKey))
  if (cached) return NextResponse.json(cached)
}

// ... existing find + enrichment ...
const responseBody = { items: enrichedItems, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }

if (cache) {
  try {
    await runWithCacheTenant(ctx.tenantId, () =>
      cache.set(cacheKey, responseBody, {
        ttl: PROPOSALS_LIST_CACHE_TTL_MS,
        tags: [createProposalsListCacheTag(ctx.tenantId)],
      }),
    )
  } catch (err) {
    console.warn('[inbox_ops:proposals] Failed to set list cache', err)
  }
}
return NextResponse.json(responseBody)
```

**Tenant scoping.** `organizationId` is folded into the key (an org switch produces a different key); `tenantId` drives `runWithCacheTenant` so one tenant can never read another's entry, matching the counts endpoint's contract. `cache` resolution is best-effort (`resolveCache` returns `null` if DI has no `cache`), so the route degrades to today's behavior when caching is unavailable.

## Cache tags

- `inbox_ops:proposals:list:<tenantId>` — single coarse tag covering **all** list entries for a tenant (every status/category/search/page variant). One `deleteByTags` call clears the whole tenant's list cache on any write that can change list contents or the per-row counts. This intentionally mirrors the counts cache's 1:1 tenant tag (`inbox_ops:counts:<tenantId>`); the result set is small per tenant and a 30s TTL backstops anything missed, so per-status/per-page tag granularity is unnecessary and riskier.

## Invalidation

Every site that today calls `invalidateCountsCache(cache, tenantId)` also changes the list (status transitions, action accept/reject/complete/edit, categorization, accept-all) and must additionally call `invalidateProposalsListCache(cache, tenantId)` in the same `runWithCacheTenant` block, **post-commit** (these routes already place the call after the domain write returns). The `reprocess` route currently invalidates **neither** cache and must invalidate both.

| Trigger (route / command / event) | Where to call `deleteByTags` (via `invalidateProposalsListCache`) | Tags invalidated |
|---|---|---|
| `POST /proposals/[id]/accept-all` (`api/proposals/[id]/accept-all/route.ts:35`) | next to existing `invalidateCountsCache`, post-commit | `inbox_ops:proposals:list:<tenantId>` |
| `POST /proposals/[id]/reject` (`api/proposals/[id]/reject/route.ts:27`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| `POST /proposals/[id]/categorize` (`api/proposals/[id]/categorize/route.ts:35`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| `PUT/PATCH /proposals/[id]/actions/[actionId]` (`api/proposals/[id]/actions/[actionId]/route.ts:46`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| `POST /proposals/[id]/actions/[actionId]/accept` (`.../accept/route.ts:55`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| `POST /proposals/[id]/actions/[actionId]/reject` (`.../reject/route.ts:31`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| `POST /proposals/[id]/actions/[actionId]/complete` (`.../complete/route.ts:84`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| Extraction worker creates proposals/discrepancies (`subscribers/extractionWorker.ts:541`) | next to existing `invalidateCountsCache`, after flush | `inbox_ops:proposals:list:<tenantId>` |
| AI tool mutation (`ai-tools.ts:355-358`) | next to existing `invalidateCountsCache` | `inbox_ops:proposals:list:<tenantId>` |
| `POST /emails/[id]/reprocess` (`api/emails/[id]/reprocess/route.ts`) — supersedes proposals, voids actions, deletes discrepancies; **currently invalidates nothing** | add post-commit `invalidateCountsCache` **and** `invalidateProposalsListCache` (resolve `cache` via `resolveCache(ctx.container)`) | `inbox_ops:proposals:list:<tenantId>` (+ `inbox_ops:counts:<tenantId>`) |

No event-subscriber hook is required: the module invalidates inline at the write sites (its established pattern). The 30s TTL is the backstop for the `reprocess` async path if a worker-side write lands outside these sites.

## Implementation steps

- [ ] Extend `packages/core/src/modules/inbox_ops/lib/cache.ts` with `PROPOSALS_LIST_CACHE_TTL_MS` (30s), `createProposalsListCacheKey(tenantId, organizationId, params)`, `createProposalsListCacheTag(tenantId)`, and `invalidateProposalsListCache(cache, tenantId)` — mirroring the existing counts helpers.
- [ ] In `api/proposals/route.ts`: import the new helpers + `resolveCache` + `runWithCacheTenant`; build the key from the parsed `query`; add the cache-get short-circuit before the DB work and the cache-set after building `responseBody`, both inside `runWithCacheTenant(ctx.tenantId, …)`, with best-effort try/catch on the set.
- [ ] Add `invalidateProposalsListCache(cache, ctx.tenantId)` alongside each of the 9 existing `invalidateCountsCache` call sites (7 routes + extraction worker + ai-tools), within the same `runWithCacheTenant` block, post-commit.
- [ ] Fix `api/emails/[id]/reprocess/route.ts`: resolve `cache`, and after the supersede/void/flush completes (post-commit) call both `invalidateCountsCache` and `invalidateProposalsListCache`.
- [ ] Confirm `category` filter splitting (route.ts:38-45) and `search` are captured verbatim in the key (raw `query.category` / `query.search` strings, pre-split) so distinct filters get distinct entries.
- [ ] Run `yarn workspace @open-mercato/core test` and `yarn typecheck`.

## Risks & staleness window

- **Staleness window:** up to the 30s TTL only if an invalidation site is missed; all known mutation paths invalidate explicitly, so the practical window after a write is near-zero (next read repopulates). Matches the already-shipped counts cache exactly — no new staleness contract.
- **Low-risk data:** proposals list is read-mostly triage data; `actionCount` / `pendingActionCount` / `discrepancyCount` tolerate a brief convergence window. **No money, stock, auth tokens, or per-write-exact values** are involved.
- **Tenant isolation:** enforced by `runWithCacheTenant(tenantId, …)` + `organizationId` in the key; cannot leak across tenants/orgs.
- **Search/filter cardinality:** free-text `search` (max 200 chars) could create many distinct keys; the coarse tenant tag invalidates them all at once and the 30s TTL bounds their lifetime, so memory growth is naturally capped.
- **Invalidation is best-effort** (try/catch + warn), with TTL as backstop — never blocks the write path. Cache set/get is wrapped so a cache outage degrades to current behavior.

## Acceptance criteria / tests

- [ ] Unit: `createProposalsListCacheKey` produces distinct keys for differing `status` / `category` / `search` / `page` / `pageSize` / `organizationId`, and a stable key for identical params.
- [ ] Integration (`packages/core/src/modules/inbox_ops/__integration__/`): two identical `GET /api/inbox_ops/proposals?status=pending` requests return identical bodies and the second is served from cache (assert single DB population, e.g. via spy/profile or a controlled fixture mutation between calls being invisible until invalidation).
- [ ] Integration: after `POST /proposals/[id]/reject` (and after `POST /emails/[id]/reprocess`), a subsequent list request reflects the change immediately (invalidation fired), not after TTL.
- [ ] Integration: tenant A's list write does not evict or expose tenant B's cached list (cross-tenant isolation).
- [ ] No behavior change when `cache` is unavailable (`resolveCache` returns `null`): handler returns the same payload as today.
- [ ] `yarn workspace @open-mercato/core test` and `yarn typecheck` pass.

## Labels

- `feature`
- `performance`
- `priority-low` (opportunistic quick win; the hottest sub-surface — badge counts — is already cached, so this is incremental)

