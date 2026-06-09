> Cache-performance Feature Request — round-2 candidate 13
> Endpoint: `GET /api/currencies/options` · Verdict: good
> Source: `packages/core/src/modules/currencies/api/currencies/options/route.ts`
> Added 2026-06-09 (round 2): verified non-cached; invalidation piggybacks on existing `crud:currencies.currency:*` tags.

## Summary

Currency option lists back the currency selects in pricing, sales-document, and product forms. The endpoint is a custom GET running an org-scoped `em.find(Currency, …)` with an optional `$or` ILIKE search filter and response mapping on every form open. Currencies are near-static reference data (writes are rare admin actions) — a textbook cache case.

Currency writes go through **commands** with `resourceKind: 'currencies.currency'` (`commands/currencies.ts:170/301`, plus delete), so the command bus already flushes `crud:currencies.currency:tenant:<T>:org:<O>:collection` post-commit. Tag the cached options with that tag — zero new flush wiring.

## Why (impact)

- **Hotness — medium-high**: every form with a money field loads options; sessions doing order/price entry hit it repeatedly.
- **Cost** — one filtered/sorted `find` + mapping per call; ILIKE search variants multiply it.
- **Est. win** — options become a cache `get` for the 5-minute window; reference data hit rate is near 100 %.

## Current behavior

`api/currencies/options/route.ts` (~line 70-73): `em.find(Currency, { tenantId, organizationId, deletedAt: null, isActive?, $or: [code ILIKE, name ILIKE]? }, { orderBy: { code: 'ASC' }, limit })` → option DTO mapping. Custom handler; no module cache. Writes: `currencies.currencies.create/update/delete` commands (resourceKind `currencies.currency`); exchange-rate writes are a different resource (`currencies.exchange_rate`) and do not affect this payload.

## Proposed cache

```ts
import { buildCollectionTags, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const CURRENCY_OPTIONS_TTL_MS = 5 * 60_000

const cacheEnabled = isCrudCacheEnabled()
const cache = cacheEnabled ? (() => { try { return container.resolve('cache') } catch { return null } })() : null
const cacheKey = `currencies:options:org=${orgId ?? 'null'}:active=${activeFlag ?? 'all'}:q=${searchTerm ?? ''}:limit=${limit}`

if (cache) {
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)
}
// ... existing find + mapping → payload ...
if (cache) {
  try {
    await cache.set(cacheKey, payload, {
      ttl: CURRENCY_OPTIONS_TTL_MS,
      tags: buildCollectionTags('currencies.currency', tenantId, [orgId ?? null]),
    })
  } catch {}
}
return NextResponse.json(payload)
```

## Cache tags

- `crud:currencies.currency:tenant:<T>:org:<O>:collection` — **reused**, flushed post-commit by the command bus on every currency command execute/undo. Zero new wiring.

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| Currency create/update/delete (commands, resourceKind `currencies.currency`) | command bus — existing | `crud:currencies.currency:…:collection` |
| Undo/redo | command bus — existing | same |
| Exchange-rate writes | n/a — not in this payload | none needed |

**Nothing to add on the write side.**

## Safety / non-invalidation risks (double-checked)

- **Gate:** flush no-ops while `ENABLE_CRUD_API_CACHE` is off — cache gated on `isCrudCacheEnabled()`.
- **This is option metadata, not rates:** the payload is code/name/symbol option rows. Money amounts and conversion rates are computed elsewhere; a stale option list cannot mis-price anything.
- **Search-variant cardinality:** ILIKE search creates a key per term; the collection tag flushes them all and the 5-min TTL caps memory. (Optionally skip caching when `searchTerm` is set — the non-search bootstrap call is the hot one.)
- **Org axis** in key and tags; tenant namespace via the dispatcher wrapper.
- **No-op without cache service; never cache 401/400 branches.**

## Implementation steps

- [ ] Add the gated get-then-set to `api/currencies/options/route.ts` (consider skipping cache when `searchTerm` is present).
- [ ] Unit tests: key axes; tags match command-bus shape; flag-off ⇒ no caching.
- [ ] Integration: create/deactivate a currency → options reflect it immediately (command flush).
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-low`
