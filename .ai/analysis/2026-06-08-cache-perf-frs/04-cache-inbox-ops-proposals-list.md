> Auto-generated cache-performance Feature Request — candidate 4 of 9
> Endpoint: `GET /api/inbox_ops/proposals` · ROI 82 · Verdict: good
> Source: `packages/core/src/modules/inbox_ops/api/proposals/route.ts`
> Revised 2026-06-09: the list cache now carries the **existing** `inbox_ops:counts:<tenantId>` tag that all 9 mutation sites already flush — the previously proposed parallel `invalidateProposalsListCache` calls at every site are dropped. Only the `reprocess` route (which flushes nothing today) gains one call.

## Summary

Add a tenant-scoped, tag-invalidated read cache to the custom (non-`makeCrudRoute`) handler `GET /api/inbox_ops/proposals`. The handler runs a decrypted `findAndCountWithDecryption` plus three parallel `findWithDecryption` joins (emails, actions, discrepancies) and an in-memory enrichment loop on every page load and poll of the proposals table.

**Key simplification:** the sibling badge endpoint `GET /api/inbox_ops/proposals/counts` is already cached and **every mutation that changes the list also changes the counts** — all 9 mutating sites already call `invalidateCountsCache(cache, tenantId)`, which flushes the tag `inbox_ops:counts:<tenantId>` (`lib/cache.ts`). Tag the new list entries with **that same tag** and the entire existing flush wiring invalidates the list for free. Zero new flush calls — except the `reprocess` route, which today invalidates *neither* cache and gets the one missing `invalidateCountsCache` call (fixing the counts cache too).

## Why (impact)

- **Hotness — high.** Primary intake/triage workflow surface. Loaded on the proposals page and re-fetched on filter/tab/pagination changes.
- **Cost — high.** Per request: `findAndCountWithDecryption(InboxProposal, …)` (route.ts:52-62), `Promise.all` of three more decrypted queries (route.ts:68-78), and an enrichment loop (route.ts:82-96). 4 decrypted round-trips + O(rows × actions) in-memory work, identical across repeated reads between writes.
- **Est. win.** A 30 s TTL cache (matching the counts endpoint) collapses the "load page → switch tab → page back" burst to a single DB hit per (tenant, filter, page) per window, with zero decryption work on hits.

## Current behavior

`packages/core/src/modules/inbox_ops/api/proposals/route.ts`: parses `status`/`category`/`search`/`page`/`pageSize` (route.ts:18-24), `resolveRequestContext` (route.ts:26), the four decrypted queries and enrichment (route.ts:52-96), returns `{ items, total, page, pageSize, totalPages }`. No caching today; not `makeCrudRoute`.

Existing infrastructure to reuse (`lib/cache.ts`):
- `createCountsCacheTag(tenantId)` → literal `inbox_ops:counts:<tenantId>` (key and tag share the value intentionally).
- `invalidateCountsCache(cache, tenantId)` — already called, post-commit, at **9 sites**: `accept-all`, `reject`, `categorize`, action `PUT/PATCH`, action `accept`, action `reject`, action `complete` routes, `subscribers/extractionWorker.ts:541`, and `ai-tools.ts:355-358` (the worker/AI sites wrap in `runWithCacheTenant(tenantId, …)`).
- `api/proposals/counts/route.ts:24-83` — the get-then-set pattern to copy.

## Proposed cache

```ts
// lib/cache.ts (additions)
export const PROPOSALS_LIST_CACHE_TTL_MS = 30 * 1000 // mirror COUNTS_CACHE_TTL_MS

export function createProposalsListCacheKey(
  tenantId: string,
  organizationId: string,
  params: { status?: string; category?: string; search?: string; page: number; pageSize: number },
): string {
  const parts = [organizationId, params.status ?? '', params.category ?? '', params.search ?? '', String(params.page), String(params.pageSize)].join('|')
  return `inbox_ops:proposals:list:${tenantId}:${parts}`
}
```

Handler (`route.ts`), mirroring the counts route exactly:

```ts
const cache = resolveCache(ctx.container)
const cacheKey = createProposalsListCacheKey(ctx.tenantId, ctx.organizationId, query)

if (cache) {
  const cached = await runWithCacheTenant(ctx.tenantId, () => cache.get(cacheKey))
  if (cached) return NextResponse.json(cached)
}
// ... existing find + enrichment → responseBody ...
if (cache) {
  try {
    await runWithCacheTenant(ctx.tenantId, () =>
      cache.set(cacheKey, responseBody, {
        ttl: PROPOSALS_LIST_CACHE_TTL_MS,
        tags: [createCountsCacheTag(ctx.tenantId)], // REUSE the already-flushed tag
      }),
    )
  } catch (err) { console.warn('[inbox_ops:proposals] Failed to set list cache', err) }
}
return NextResponse.json(responseBody)
```

## Cache tags

- `inbox_ops:counts:<tenantId>` — **reused.** Every write that can change the list (status transition, action accept/reject/complete/edit, categorization, accept-all, extraction) already flushes this tag because it also changes the badge counts. Tagging the list entries with it gives the list the exact same freshness contract as the already-shipped counts cache, with zero new flush wiring. (Semantically the tag now means "inbox_ops proposal state changed"; optionally alias it as `PROPOSALS_STATE_TAG = createCountsCacheTag` in `lib/cache.ts` for readability.)

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| `accept-all` / `reject` / `categorize` / action `PUT/PATCH` / action `accept` / action `reject` / action `complete` routes | existing `invalidateCountsCache` calls, post-commit | `inbox_ops:counts:<T>` |
| Extraction worker creates proposals/discrepancies (`subscribers/extractionWorker.ts:541`) | existing call (already wrapped in `runWithCacheTenant`) | `inbox_ops:counts:<T>` |
| AI tool mutation (`ai-tools.ts:355-358`) | existing call (already wrapped) | `inbox_ops:counts:<T>` |
| `POST /emails/[id]/reprocess` — **currently flushes nothing** (pre-existing gap that already affects the counts cache) | **add one post-commit `invalidateCountsCache(cache, ctx.tenantId)` call** (inside `runWithCacheTenant`) | `inbox_ops:counts:<T>` |

## Safety / non-invalidation risks (double-checked)

- **Tenant-namespace matching:** the route handler's get/set inherit the request namespace (dispatcher wrapper) and additionally wrap in `runWithCacheTenant(ctx.tenantId, …)` exactly like the counts route; the worker/AI flush sites already wrap explicitly. Route-level `invalidateCountsCache` calls run inside the mutating request (same tenant) — namespaces match everywhere.
- **Blast radius:** one tag flushes every cached list variant for the tenant on any proposal write. That is intentionally coarse (matches the counts cache) — proposal mutations are triage actions, not high-frequency writes, and recomputing a 25-row page is cheap.
- **Staleness window:** ≤30 s TTL only if a flush is missed; all known mutation paths already flush. The `reprocess` async tail is additionally TTL-bounded.
- **Per-org correctness:** `organizationId` is in the key, so an org switch produces a different key; the tenant-wide tag still flushes all org variants together.
- **Search/filter key cardinality:** free-text `search` creates many keys; the shared tag flushes them all and the 30 s TTL caps memory.
- **Low-risk data:** read-mostly triage rows; no money/stock/auth. Best-effort flush + TTL backstop, never blocking the write path.

## Implementation steps

- [ ] Extend `lib/cache.ts` with `PROPOSALS_LIST_CACHE_TTL_MS` and `createProposalsListCacheKey(...)` (no new tag helpers — reuse `createCountsCacheTag`).
- [ ] In `api/proposals/route.ts`: add the cache-get short-circuit and the cache-set with `tags: [createCountsCacheTag(ctx.tenantId)]`, both inside `runWithCacheTenant(ctx.tenantId, …)`.
- [ ] Fix `api/emails/[id]/reprocess/route.ts`: resolve `cache`, and after the supersede/void/flush completes call `invalidateCountsCache` post-commit.
- [ ] Confirm `category`/`search` are captured verbatim in the key so distinct filters get distinct entries.
- [ ] `yarn workspace @open-mercato/core test` and `yarn typecheck`.

## Acceptance criteria / tests

- [ ] Unit: `createProposalsListCacheKey` produces distinct keys for differing params and a stable key for identical params.
- [ ] Integration (`packages/core/src/modules/inbox_ops/__integration__/`): two identical `GET /api/inbox_ops/proposals?status=pending` calls — the second served from cache.
- [ ] After `POST /proposals/[id]/reject`, a subsequent list reflects the change immediately (existing counts-tag flush, not TTL).
- [ ] After `POST /emails/[id]/reprocess`, both the counts badge and the list reflect the supersede immediately (new flush call).
- [ ] Tenant A's writes do not evict or expose tenant B's cached list.
- [ ] No behavior change when `cache` is unavailable.

## Labels

- `feature`
- `performance`
- `priority-low` (the hottest sub-surface — badge counts — is already cached; this is incremental)
