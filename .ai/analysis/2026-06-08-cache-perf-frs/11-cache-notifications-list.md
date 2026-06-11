> Cache-performance Feature Request — round-2 candidate 11
> Endpoint: `GET /api/notifications` (list) · Verdict: good
> Source: `packages/core/src/modules/notifications/api/route.ts`
> Added 2026-06-09 (round 2): verified non-cached; **TTL-only v1** (same rationale as FR 03 — notifications have no command-bus writes, so no existing tag to connect to).

## Summary

The notifications dropdown/panel list is fetched by the same 5-second poll loop as the unread badge (`packages/ui/src/backend/notifications/useNotificationsPoll.ts`, `POLL_INTERVAL = 5000`) and on every panel open. Each call runs `em.find(Notification, …)` + `em.count(Notification, …)` (`route.ts:56-63`) filtered by `recipientUserId`/status/type/severity. Cache the assembled page per `(userId, filter-signature)` with a short **TTL-only** cache (10 s) — the same shape and rationale as FR 03: the notifications module has no `commands/` directory, all writes flow through `createNotificationService`, so there is no already-flushed tag to ride and bespoke per-write invalidation across ~10 service sites is not worth ≤10 s of badge-panel freshness. SSE-enabled clients get pushes regardless.

## Why (impact)

- **Hotness — extreme**: same 5 s poll cadence as the badge; the panel list payload is bigger than the count (two queries + row mapping per tick).
- **Cost** — `em.find` + `em.count` (two round-trips) every 5 s per session.
- **Est. win** — halves steady-state list queries (10 s TTL vs 5 s poll); more under multi-tab.

## Current behavior

`packages/core/src/modules/notifications/api/route.ts:22-74` — `resolveNotificationContext`, parse filters (status/type/severity/source), then `Promise.all([em.find(Notification, where, { orderBy, limit, offset }), em.count(Notification, where)])`, row mapping, `{ items, total, … }`. Not `makeCrudRoute`; no module cache; writes via `createNotificationService` + eventBus only (no command bus → no `crud:*` flushes exist for notifications).

## Proposed cache

```ts
const NOTIFICATIONS_LIST_TTL_MS = 10_000

const cache = (() => { try { return ctx.container.resolve('cache') } catch { return null } })()
const filterSignature = JSON.stringify(Object.fromEntries(Object.entries(parsedQuery).sort(([a], [b]) => a.localeCompare(b))))
const cacheKey = `notifications:list:u=${scope.userId}:${filterSignature}`

if (cache && scope.userId) {
  const cached = await cache.get(cacheKey)
  if (cached) return Response.json(cached)
}
// ... existing find + count + mapping → payload ...
if (cache && scope.userId) {
  try { await cache.set(cacheKey, payload, { ttl: NOTIFICATIONS_LIST_TTL_MS }) } catch {}
}
return Response.json(payload)
```

Tenant namespace via the API dispatcher wrapper. Match the key's user/org axes to the underlying query's filter dimensions exactly (user + tenant; include org in the key only if the query filters by it).

## Cache tags

None in v1 — TTL-only. (v2, if ever needed: a `notifications:user:<userId>` tag flushed from the single `createNotificationService` chokepoint, post-commit.)

## Invalidation

| Trigger | Where | Effect |
|---|---|---|
| Any notification write | none — TTL-only | list converges within ≤10 s (≤2 poll ticks) |
| SSE-enabled clients | existing SSE push | near-real-time regardless |

## Safety / non-invalidation risks (double-checked)

- **Deterministic staleness**: worst case = TTL = 10 s, unconditional; there is no invalidation that can be missed. Safest cache shape.
- **Mark-read echo**: after the user marks a notification read, the cached page may show it unread for ≤10 s. Mitigate in v1 by having the mark-read/dismiss UI paths delete the user's entries (`cache.delete(...)` from the mutating route, which is module-local and runs in-request) — or accept the ≤10 s echo; either is safe. Recommend the simple accept-the-echo v1 since the panel updates optimistically client-side anyway.
- **Per-user key** mandatory (`u=<userId>`): the payload is the recipient's private notification list.
- **TTL must stay ≤ 2× poll interval** to keep the panel feeling live.
- **No-op without cache service.**

## Implementation steps

- [ ] Add the get-then-set to `api/route.ts` GET (~15 lines).
- [ ] Decide v1 echo handling (accept vs in-route `cache.delete` on mark-read/dismiss/mark-all-read in the same module's mutating routes — no cross-module wiring either way).
- [ ] Unit test: per-user key isolation; distinct filter signatures → distinct keys.
- [ ] Integration: poll convergence ≤ 2 ticks after create/mark-read; cross-user isolation.
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-low`
