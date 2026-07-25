> Auto-generated cache-performance Feature Request — candidate 3 of 9
> Endpoint: `GET /api/notifications/unread-count` · ROI 82 · Verdict: good
> Source: `packages/core/src/modules/notifications/api/unread-count/route.ts`
> Revised 2026-06-09: simplified to a **TTL-only v1** — notification writes do not go through the command bus, so there is no existing flushed tag to connect to, and the previously proposed 10+ bespoke invalidation call sites are exactly the complexity this backlog now avoids. A 10 s TTL alone keeps the badge fresh within one poll cycle.

## Summary

Add a short-TTL cache to the unread notification count so the per-user `COUNT(*)` query stops running on every poll tick. The count is rendered by the notification bell badge on every backoffice page and is **polled every 5 seconds** (`useNotificationsPoll.ts`, `POLL_INTERVAL = 5000`).

**v1 is TTL-only (10 s), no invalidation wiring.** Rationale: the notifications module has **no `commands/` directory** — all writes flow through `createNotificationService` + `eventBus`, so the command bus never flushes any `crud:*` tag for notifications, and there is no existing module tag to reuse. Wiring per-user `deleteByTags` into ~10 service write sites (the original proposal) buys at most ~5 s of extra freshness over a 10 s TTL on a UI badge — not worth the wiring. The SSE path (`useNotificationsSse.ts`) already pushes real-time updates where SSE is enabled.

**v2 (optional, deferred):** a single `invalidateUnreadCount(cache, tenantId, userId)` helper called from the one service chokepoint (`createNotificationService`) if sub-TTL badge freshness is ever required.

## Why (impact)

- **Hotness — very high.** `packages/ui/src/backend/notifications/useNotificationsPoll.ts:60` calls `apiCall('/api/notifications/unread-count')` inside a `setInterval(..., 5000)` loop (line 149). The SSE variant also hits it on (re)connect/refresh. Every authenticated session issues ~12 COUNT queries/minute purely for the badge.
- **Cost — low per call, high in aggregate.** Each request runs `em.count(Notification, { recipientUserId, tenantId, status: 'unread' })` (`route.ts:14-18`). The request volume makes the cumulative DB load the real cost.
- **Est. win.** With a 10 s TTL, steady-state COUNT queries drop from ~12/min to ~6/min per idle session, and far more under multi-tab usage. No new infra, ~15 lines of code.

## Current behavior

`packages/core/src/modules/notifications/api/unread-count/route.ts`:

- `route.ts:10-11` — `resolveNotificationContext(req)` yields `scope = { tenantId, organizationId, userId }`.
- `route.ts:14-18` — `em.count(Notification, { recipientUserId: scope.userId, tenantId: scope.tenantId, status: 'unread' })`. **The filter is user + tenant only — `organizationId` is NOT part of the count**, so the key must not include the org (or org-switching users would see inconsistent badges).
- No existing cache on this path; not `makeCrudRoute`, so the generic CRUD cache does not cover it. All notification writes flow through `createNotificationService` (`lib/notificationService.ts`) — **not** through the command bus.

## Proposed cache

```ts
// route.ts GET
const UNREAD_COUNT_TTL_MS = 10_000

const { scope, ctx } = await resolveNotificationContext(req)
const em = ctx.container.resolve('em') as EntityManager
const cache = (() => { try { return ctx.container.resolve('cache') } catch { return null } })()
const cacheKey = `notifications:unread-count:user:${scope.userId}`

if (cache && scope.userId) {
  const cached = await cache.get(cacheKey)
  if (typeof cached === 'number') return Response.json({ unreadCount: cached })
}
const count = await em.count(Notification, { recipientUserId: scope.userId, tenantId: scope.tenantId, status: 'unread' })
if (cache && scope.userId) {
  try { await cache.set(cacheKey, count, { ttl: UNREAD_COUNT_TTL_MS }) } catch {}
}
return Response.json({ unreadCount: count })
```

Tenant scoping is automatic: the API dispatcher wraps the handler in `runWithCacheTenant(auth.tenantId, …)` (`apps/mercato/src/app/api/[...slug]/route.ts:382`), so the key is tenant-namespaced without carrying the tenant literal.

## Cache tags

None in v1 — freshness is carried entirely by the 10 s TTL. (If v2 chokepoint invalidation is ever added, tag with `notifications:unread-count:user:<userId>` and flush from `createNotificationService` post-commit.)

## Invalidation

| Trigger | Where | Effect |
|---|---|---|
| Any notification write (create/read/dismiss/action) | none — **TTL-only** | badge converges within ≤10 s (≤2 poll ticks) |
| SSE-enabled clients | existing `useNotificationsSse` push | near-real-time regardless of this cache |

## Safety / non-invalidation risks (double-checked)

- **Worst-case staleness = TTL = 10 s**, deterministic and unconditional — there is no missed-invalidation failure mode because there is no invalidation to miss. This is the safest possible cache shape.
- **Badge-only data**: not money/stock/auth. A ≤10 s stale unread count is a UI affordance lag, identical in magnitude to the poll interval users already experience.
- **Per-user key**: `userId` is in the key; tenant isolation via the dispatcher namespace. One user can never read another's badge.
- **Org-agnostic by design**: the underlying count ignores `organizationId`, so the key deliberately omits it — org switching never shows a wrong-org badge because there is no org axis.
- **No-op without cache service**: defensive resolution preserves today's behavior exactly.
- **Do not pick a TTL above the poll interval × 2** (10 s): larger values visibly delay the badge after "mark all read".

## Implementation steps

- [ ] Add the get-then-set block to `api/unread-count/route.ts` (sketch above) — ~15 lines, no new files.
- [ ] Do NOT cache when `scope.userId` is empty.
- [ ] `yarn workspace @open-mercato/core build && yarn workspace @open-mercato/core test`.

## Acceptance criteria / tests

- [ ] Two back-to-back GETs run `em.count` once; the second is served from cache.
- [ ] After the TTL elapses, the next GET re-counts.
- [ ] Marking a notification read is reflected in the badge within ≤10 s (integration: poll until converged, assert ≤ 2 poll ticks).
- [ ] Tenant isolation: a second tenant's identical user id never sees the first tenant's count.
- [ ] With cache unavailable, behavior is byte-identical to today.

## Labels

`feature`, `performance`, `priority-low`
