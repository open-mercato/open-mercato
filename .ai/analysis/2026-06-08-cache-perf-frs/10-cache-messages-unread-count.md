> Cache-performance Feature Request — round-2 candidate 10
> Endpoint: `GET /api/messages/unread-count` · Verdict: strong-quick-win
> Source: `packages/core/src/modules/messages/api/unread-count/route.ts`
> Added 2026-06-09 (round 2): verified non-cached; invalidation piggybacks on existing `crud:messages.message:*` tags.

## Summary

The messages unread badge is **polled every 5 seconds** by `packages/ui/src/backend/messages/useMessagesPoll.ts` (`POLL_INTERVAL = 5000`) from the app shell. Every tick runs a Kysely `COUNT(*)` joining `message_recipients` × `messages` with 7 filter conditions (`route.ts:20-38`). Cache the count per `(userId, organizationId)` with a 10 s TTL, tagged with the **already-flushed** `crud:messages.message:tenant:<T>:org:<O>:collection` tag so any message command (send, mark read/unread, archive, delete — all log `resourceKind: 'messages.message'`, see FR 09) invalidates it immediately via the command bus. Zero new flush wiring.

## Why (impact)

- **Hotness — extreme.** ~12 requests/min per open session, multiplied by tabs and users, independent of activity.
- **Cost** — one indexed COUNT per call; cheap individually, dominant in aggregate (same profile as FR 03).
- **Est. win** — steady-state COUNTs drop ~50%+ from TTL alone; after the tag flush, the badge updates on the next poll tick (≤5 s) following any real message activity.

## Current behavior

`route.ts:15-41` — `resolveMessageContext`, then a single Kysely count: `message_recipients r JOIN messages m` filtered by `r.recipient_user_id = userId`, `r.status='unread'`, `r.deleted_at/archived_at IS NULL`, `m.tenant_id`, `m.organization_id` (or `IS NULL`), `m.deleted_at IS NULL`. **Note: unlike the notifications badge, this count IS org-scoped** — the key must include the org axis. No cache anywhere in the module.

## Proposed cache

```ts
import { buildCollectionTags, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const UNREAD_TTL_MS = 10_000

const cacheEnabled = isCrudCacheEnabled()
const cache = cacheEnabled ? (() => { try { return ctx.container.resolve('cache') } catch { return null } })() : null
const cacheKey = `messages:unread-count:u=${scope.userId}:org=${scope.organizationId ?? 'null'}`

if (cache) {
  const cached = await cache.get(cacheKey)
  if (typeof cached === 'number') return Response.json({ unreadCount: cached })
}
const count = /* existing Kysely count */
if (cache) {
  try {
    await cache.set(cacheKey, count, {
      ttl: UNREAD_TTL_MS,
      tags: buildCollectionTags('messages.message', scope.tenantId, [scope.organizationId ?? null]),
    })
  } catch {}
}
return Response.json({ unreadCount: count })
```

Tenant namespace comes from the API dispatcher wrapper (`apps/mercato/src/app/api/[...slug]/route.ts:382`) — the same namespace `invalidateCrudCache` flushes into.

## Cache tags

- `crud:messages.message:tenant:<T>:org:<O>:collection` — **reused**, flushed post-commit by the command bus after every message command execute/undo (`command-bus.ts:610/642`). Built with the shared `buildCollectionTags` helper.

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| Send / mark read / mark unread / archive / delete / action (all `messages.*` commands, resourceKind `messages.message`) | command bus — existing | `crud:messages.message:…:collection` |
| Undo/redo | command bus — existing | same |

**Nothing to add on the write side.**

## Safety / non-invalidation risks (double-checked)

- **Gate:** the tag flush no-ops while `ENABLE_CRUD_API_CACHE` is off (`cache.ts:180`) — the cache is gated on `isCrudCacheEnabled()`; flag off ⇒ uncached, today's behavior. (Optionally fall back to a tags-free 5 s TTL-only cache when the flag is off — safe because there is then no invalidation to miss.)
- **Per-user + per-org key** — the count is user- and org-scoped; both axes are in the key. No cross-user/cross-org bleed.
- **Coarse flush** — any org member's message activity flushes everyone's badge entry; costs one recount on the next poll, never staleness.
- **Worst-case staleness = 10 s TTL** (e.g. out-of-band write) — equal to two poll ticks; badge-only data.
- **No-op without cache service.**

## Implementation steps

- [ ] Add the gated get-then-set to `api/unread-count/route.ts` (~15 lines, no new files).
- [ ] Unit test: key includes user + org; tags match `buildCollectionTags('messages.message', …)`; no caching when flag off.
- [ ] Integration: send a message to user → badge converges on next read after the command flush (no TTL wait); mark-read converges likewise.
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-low`
