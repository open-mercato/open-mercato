> Auto-generated cache-performance Feature Request — candidate 3 of 9
> Endpoint: `GET /api/notifications/unread-count` · ROI 82 · Verdict: good
> Source: `packages/core/src/modules/notifications/api/unread-count/route.ts`

## Summary

Add a short-TTL, tag-invalidated cache to the unread notification count so the per-user `COUNT(*)` query stops running on every poll tick. The count is rendered by the notification bell badge on every backoffice page and is **polled every 5 seconds** (`useNotificationsPoll.ts`, `POLL_INTERVAL = 5000`). Caching it with a small TTL plus per-user tag invalidation eliminates the vast majority of these COUNT queries while keeping the badge effectively real-time (every mutation that changes the count invalidates the cache immediately).

This is NOT a `makeCrudRoute` endpoint — it is a custom GET handler that bypasses the generic CRUD list cache (`ENABLE_CRUD_API_CACHE` in `packages/shared/src/lib/crud/factory.ts`), so it needs a small, explicit manual cache following the reference pattern in `packages/core/src/modules/customer_accounts/services/domainMappingService.ts`.

## Why (impact)

- **Hotness — very high.** `packages/ui/src/backend/notifications/useNotificationsPoll.ts:60` calls `apiCall('/api/notifications/unread-count')` inside a `setInterval(fetchNotifications, 5000)` loop (line 149). The SSE variant `useNotificationsSse.ts:70` also hits it on (re)connect/refresh. With the bell mounted in the app shell, every authenticated session issues ~12 COUNT queries/minute purely for the badge, independent of any real activity.
- **Cost — low per call, high in aggregate.** Each request runs `em.count(Notification, { recipientUserId, tenantId, status: 'unread' })` (`route.ts:14-18`). The query is cheap individually, but the request volume (10s–100s per user per session, multiplied by concurrent users) makes the cumulative DB load and request-handling overhead the real cost. Caching collapses the steady-state to ~1 DB COUNT per user per TTL window.
- **Est. win.** With a 10s TTL and immediate invalidation on writes, steady-state COUNT queries for an idle user drop from ~1 every 5s to ~1 every 10s, and a high-traffic deployment with many simultaneously-open dashboards sees the unread-count DB load drop by roughly 50–90% (higher with a larger TTL). No new infra — uses the existing DI `cache` service.

## Current behavior

`packages/core/src/modules/notifications/api/unread-count/route.ts`:

- `route.ts:10-11` — `GET` resolves notification context via `resolveNotificationContext(req)` (`lib/routeHelpers.ts:53`), which yields `scope = { tenantId, organizationId, userId }`.
- `route.ts:12` — resolves `em` from the DI container.
- `route.ts:14-18` — `await em.count(Notification, { recipientUserId: scope.userId, tenantId: scope.tenantId, status: 'unread' })`. **Note the filter dimensions: `recipientUserId` + `tenantId` + `status` only — `organizationId` is NOT part of the count.** The cache key and tags must mirror exactly these dimensions (user-scoped, tenant-scoped, not org-scoped).
- `route.ts:20` — returns `Response.json({ unreadCount: count })`.

The same count is computed by `NotificationService.getUnreadCount` (`lib/notificationService.ts:506-513`) and inside `getPollData` (`lib/notificationService.ts:531-535`); both use the identical filter. All notification writes flow through `createNotificationService` in `lib/notificationService.ts`, so it is the single correct place to invalidate.

There is no existing cache on this path; it is not wired through `makeCrudRoute`, so the gated generic CRUD cache does not cover it.

## Proposed cache

Add a tiny cache helper in `packages/core/src/modules/notifications/lib/` (e.g. `unreadCountCache.ts`) and use it from both the route and the service. Tenant scoping uses `runWithCacheTenant` so the cache layer auto-prefixes keys+tags per tenant; the user id is carried in the key/tags because the count is per-recipient.

```ts
// packages/core/src/modules/notifications/lib/unreadCountCache.ts
import { runWithCacheTenant } from '@open-mercato/cache'

const UNREAD_COUNT_TAG = 'notifications:unread-count'
const UNREAD_COUNT_TTL_MS = 10_000 // 10s backstop; invalidation is the primary freshness mechanism

type CacheService = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

const keyFor = (userId: string) => `${UNREAD_COUNT_TAG}:user:${userId}`
const tagsFor = (userId: string) => [UNREAD_COUNT_TAG, `${UNREAD_COUNT_TAG}:user:${userId}`]

export async function getCachedUnreadCount(
  cache: CacheService | null,
  tenantId: string,
  userId: string,
  compute: () => Promise<number>,
): Promise<number> {
  if (!cache || !userId) return compute()
  return runWithCacheTenant(tenantId, async () => {
    const cached = (await cache.get(keyFor(userId))) as number | null | undefined
    if (typeof cached === 'number') return cached
    const value = await compute()
    await cache.set(keyFor(userId), value, { ttl: UNREAD_COUNT_TTL_MS, tags: tagsFor(userId) })
    return value
  })
}

export async function invalidateUnreadCount(
  cache: CacheService | null,
  tenantId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!cache || !userId) return
  try {
    await runWithCacheTenant(tenantId, () => cache.deleteByTags([`${UNREAD_COUNT_TAG}:user:${userId}`]))
  } catch {
    // best-effort; TTL is the backstop
  }
}
```

Route usage (resolve `cache` defensively — it may not be registered in every context, mirroring how the service resolves `commandBus`):

```ts
// route.ts GET
const { scope, ctx } = await resolveNotificationContext(req)
const em = ctx.container.resolve('em') as EntityManager
let cache: CacheService | null = null
try { cache = ctx.container.resolve('cache') as CacheService } catch { cache = null }

const count = await getCachedUnreadCount(cache, scope.tenantId, scope.userId ?? '', () =>
  em.count(Notification, {
    recipientUserId: scope.userId,
    tenantId: scope.tenantId,
    status: 'unread',
  }),
)
return Response.json({ unreadCount: count })
```

Wire the same `getCachedUnreadCount` into `NotificationService.getUnreadCount` (`lib/notificationService.ts:506`) so the count is consistent regardless of caller, and (optionally) into the `getPollData` count.

## Cache tags

- `notifications:unread-count` — coarse tag covering every cached unread-count entry in the tenant. Used for blanket invalidation (e.g. `cleanupExpired`, where the affected recipient set is not cheaply known).
- `notifications:unread-count:user:<userId>` — per-recipient tag. The precise invalidation target for any write that changes a single user's unread set (mark read, dismiss, restore-to-unread, action, single create). Tenant namespacing is applied automatically by `runWithCacheTenant`, so `<userId>` alone is sufficient within the tenant scope.

Cache key: `notifications:unread-count:user:<userId>` (tenant-prefixed internally). One entry per recipient per tenant.

## Invalidation

All notification writes are centralized in `createNotificationService` (`packages/core/src/modules/notifications/lib/notificationService.ts`). Resolve `cache` in `resolveNotificationService` (alongside `em`/`eventBus`/`commandBus`) and call `invalidateUnreadCount` **after** the transaction/`flush()` commits (post-commit, never inside `transactional`/`withAtomicFlush`), right next to the existing `eventBus.emit(...)` calls.

| Trigger (route / command / event) | Where to call `deleteByTags` | Tags invalidated |
|---|---|---|
| `create` — `POST /api/notifications/batch` & internal single create (`notificationService.ts:214-232`) | after `eventBus.emit(NOTIFICATION_SSE_EVENTS.CREATED, ...)` | `notifications:unread-count:user:<recipientUserId>` |
| `createBatch` — `POST /api/notifications/batch` (`notificationService.ts:234-252`) | after `emitNotificationSseEvents(...)` | `notifications:unread-count:user:<id>` for each distinct `recipientUserId` |
| `createForRole` — `POST /api/notifications/role` (`notificationService.ts:254-280`) | after `emitNotificationSseEvents(...)` | per-user tag for each `uniqueRecipientUserIds` |
| `createForFeature` — `POST /api/notifications/feature` (`notificationService.ts:282-311`) | after `emitNotificationSseEvents(...)` | per-user tag for each `uniqueRecipientUserIds` |
| `markAsRead` — `PUT /api/notifications/[id]/read` (`notificationService.ts:313-330`) | after `eventBus.emit(NOTIFICATION_EVENTS.READ, ...)`; only needed when status actually changed from `unread` | `notifications:unread-count:user:<ctx.userId>` |
| `markAllAsRead` — `PUT /api/notifications/mark-all-read` (`notificationService.ts:332-391`) | after the per-notification emit loop, when `result > 0` | `notifications:unread-count:user:<ctx.userId>` |
| `dismiss` — `PUT /api/notifications/[id]/dismiss` (`notificationService.ts:393-408`) | after `eventBus.emit(NOTIFICATION_EVENTS.DISMISSED, ...)` (dismissing an unread item lowers the count) | `notifications:unread-count:user:<ctx.userId>` |
| `restoreDismissed` (`notificationService.ts:410-438`) | after `eventBus.emit(NOTIFICATION_EVENTS.RESTORED, ...)`, when restored to `unread` (or always, cheaply) | `notifications:unread-count:user:<ctx.userId>` |
| `executeAction` — `PUT /api/notifications/[id]/...` action (`notificationService.ts:440-504`) | after `eventBus.emit(NOTIFICATION_EVENTS.ACTIONED, ...)` (an unread item becomes `actioned`) | `notifications:unread-count:user:<ctx.userId>` |
| `cleanupExpired` (`notificationService.ts:549-564`, scheduled) | after the bulk update returns | coarse `notifications:unread-count` (recipient set not enumerated; blanket clear is acceptable for a maintenance job) |
| `deleteBySource` (`notificationService.ts:566-578`) | after the delete; if recipient ids are not loaded, use coarse `notifications:unread-count` | coarse `notifications:unread-count` (or per-user if you select affected `recipient_user_id`s first) |

Note: invalidation is keyed only by `userId` (+ tenant), matching the count's filter dimensions — do **not** add `organizationId` to the tag, or org-switching users will see a stale badge because the count itself is org-agnostic.

## Implementation steps

- [ ] Add `packages/core/src/modules/notifications/lib/unreadCountCache.ts` with `getCachedUnreadCount`, `invalidateUnreadCount`, the `UNREAD_COUNT_TAG`/`UNREAD_COUNT_TTL_MS` constants, and `keyFor`/`tagsFor` helpers (per the sketch above). Use `runWithCacheTenant` from `@open-mercato/cache`.
- [ ] Update `api/unread-count/route.ts` to resolve `cache` defensively from `ctx.container` and wrap the `em.count(...)` in `getCachedUnreadCount`.
- [ ] Add `cache` resolution to `resolveNotificationService` (`notificationService.ts:586-602`) using the same try/catch pattern as `commandBus`, and thread it into `createNotificationService` deps.
- [ ] Route `getUnreadCount` (`notificationService.ts:506`) through `getCachedUnreadCount` so service callers share the cache. Optionally cache the `getPollData` count too (same key/tags).
- [ ] Add post-commit `invalidateUnreadCount(...)` calls at every write site in the table above, immediately after the existing `eventBus.emit(...)`/`emitNotificationSseEvents(...)` calls — never inside a `transactional`/`flush` block.
- [ ] Confirm there is no `OM_*` gating requirement; this is module-local manual caching, on by default but a no-op when no `cache` service is registered.
- [ ] `yarn workspace @open-mercato/core build && yarn workspace @open-mercato/core test`.

## Risks & staleness window

- **Staleness window ≤ TTL (10s), but normally near-zero.** Every mutation that changes a user's unread set invalidates that user's tag post-commit, so the badge updates on the next poll (≤5s) after any read/dismiss/action/create that goes through the service. The TTL only bounds the window for paths that bypass per-user invalidation (e.g. a future direct-SQL writer, or the coarse `cleanupExpired`/`deleteBySource` clears).
- **Read-mostly, non-financial.** Unread count is a UI affordance, not money/stock/auth — a brief convergence window is acceptable per the cache-safety guidance (invalidate after commit, TTL as backstop).
- **Best-effort invalidation.** `deleteByTags` failures are swallowed; the 10s TTL guarantees eventual convergence even if a single invalidation call throws.
- **Tenant isolation.** `runWithCacheTenant(scope.tenantId, ...)` namespaces keys+tags so no tenant can read another's count. The key/tag also include `userId`, so one user can never read another user's badge.
- **No-op when `cache` is unregistered.** The defensive `try/catch` resolution means the route degrades to today's direct `em.count` if no cache service is present.

## Acceptance criteria / tests

- [ ] Unit: `getCachedUnreadCount` returns the computed value on a cache miss, persists it with `ttl: 10_000` and tags `['notifications:unread-count', 'notifications:unread-count:user:<userId>']`, and returns the cached value on a subsequent hit without calling `compute` again.
- [ ] Unit: `invalidateUnreadCount` calls `deleteByTags(['notifications:unread-count:user:<userId>'])` within `runWithCacheTenant(tenantId, ...)`, and is a no-op when `cache` is null or `userId` is empty.
- [ ] Unit/service: `markAsRead`, `markAllAsRead`, `dismiss`, `executeAction`, `restoreDismissed`, and each `create*` variant call `invalidateUnreadCount` for the correct recipient(s) **after** flush.
- [ ] Integration (colocate in `packages/core/src/modules/notifications/__integration__/`): create a notification for a user → `GET /api/notifications/unread-count` returns N → mark it read → next `GET` returns N-1 within one poll interval (proves invalidation), and two back-to-back GETs with no writes in between are served identically (proves the cache is engaged). Tenant-isolation assertion: a second tenant's identical user id never sees the first tenant's count.
- [ ] Verify the bell badge in a browser updates promptly after marking a notification read (no >TTL lag).

## Labels

`feature`, `performance`, `priority-low`
