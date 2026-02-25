# SPEC-048: Migrate Notifications from Polling to SSE

**Status**: Feature Request
**Created**: 2026-02-25
**Priority**: Medium (performance + UX improvement)
**Depends on**: SPEC-041c (Events & DOM Bridge — SSE infrastructure)

---

## Problem

The notification system polls the server every **5 seconds** with two HTTP requests:

1. `GET /api/notifications?pageSize=50` — full notification list
2. `GET /api/notifications/unread-count` — unread badge count

This generates **~17,280 requests/user/day**, most returning unchanged data. The worst-case notification latency is 5 seconds. Each open browser tab polls independently, multiplying server load.

**Current flow** (`useNotificationsPoll.ts`):
```
setInterval(5s) → GET /api/notifications → setState → render
                → GET /api/notifications/unread-count → setState → render badge
```

## Proposed Solution

Leverage the existing SSE DOM Event Bridge (SPEC-041c) to push notification events to the browser in real-time, replacing periodic polling with event-driven updates.

**New flow**:
```
Server creates notification → emits notifications.notification.created (clientBroadcast: true)
                            → SSE bridge delivers to browser
                            → useAppEvent handler updates local state
                            → No HTTP request needed
```

### What Changes

| Concern | Current (Polling) | Proposed (SSE) |
|---------|-------------------|----------------|
| New notification detection | Poll every 5s | Instant via SSE |
| Unread count update | Poll every 5s | Computed client-side from local state |
| Initial load | REST GET on mount | REST GET on mount (unchanged) |
| Notification list | Full re-fetch every 5s | Incremental: new items prepended via SSE |
| Mark read/dismiss/action | REST API call | REST API call (unchanged) |
| Multi-tab sync | Independent polling per tab | SSE delivers to all tabs simultaneously |
| Reconnect recovery | N/A (polling always works) | Full re-fetch on SSE reconnect |
| Server load | O(users × 2 requests × 12/min) | O(notifications created) |

### What Stays the Same

- All REST endpoints remain (mark read, dismiss, action, batch create, etc.)
- `NotificationPanel`, `NotificationBell`, `NotificationItem` UI components
- `NotificationDto` type contract
- Custom renderers per notification type
- Database schema and notification service

---

## Implementation Steps

### Step 1: Add Notification Events with `clientBroadcast`

**File**: `packages/core/src/modules/notifications/events.ts` (NEW or modify existing)

```ts
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'notifications.notification.created',
    label: 'Notification Created',
    entity: 'notification',
    category: 'system',
    clientBroadcast: true,
  },
  {
    id: 'notifications.notification.batch_created',
    label: 'Notifications Batch Created',
    entity: 'notification',
    category: 'system',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'notifications',
  events,
})
```

Run `yarn generate` to include in `events.generated.ts`.

### Step 2: Emit Events from Notification Service

**File**: `packages/core/src/modules/notifications/service/notificationService.ts` (MODIFY)

After creating a notification, emit the event with the full `NotificationDto` in the payload:

```ts
// In create() method, after DB insert:
const eventBus = this.container.resolve('eventBus')
await eventBus.emitEvent('notifications.notification.created', {
  tenantId: notification.tenantId,
  organizationId: notification.organizationId,
  recipientUserId: notification.recipientUserId,
  notification: toNotificationDto(notification),
}, { persistent: false }) // Ephemeral — no need for persistent queue

// In createBatch() method:
await eventBus.emitEvent('notifications.notification.batch_created', {
  tenantId,
  organizationId,
  recipientUserIds,
  count: notifications.length,
}, { persistent: false })
```

**Important**: The SSE payload includes `recipientUserId` for audience filtering and client context. Delivery filtering is enforced server-side.

### Step 3: Create `useNotificationsSse` Hook

**File**: `packages/ui/src/backend/notifications/useNotificationsSse.ts` (NEW)

Replace the polling hook with an SSE-driven hook that maintains the same public API:

```ts
import { useAppEvent } from '../injection/useAppEvent'

export function useNotificationsSse() {
  const [notifications, setNotifications] = useState<NotificationDto[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [hasNew, setHasNew] = useState(false)

  // Initial load (REST — same as before)
  useEffect(() => {
    fetchNotifications().then(data => {
      setNotifications(data.items)
      setUnreadCount(data.unreadCount)
    })
  }, [])

  // SSE: new notification arrives
  useAppEvent('notifications.notification.*', (event) => {
    const payload = event.payload as NotificationEventPayload
    // Only process if addressed to current user
    if (payload.recipientUserId !== currentUserId) return

    if (payload.notification) {
      setNotifications(prev => [payload.notification, ...prev])
      setUnreadCount(prev => prev + 1)
      setHasNew(true)
      setTimeout(() => setHasNew(false), 3000)
    } else {
      // Batch created — do a full refresh
      refresh()
    }
  })

  // Reconciliation: re-fetch on window focus (catch missed events)
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // SSE reconnect: re-fetch to catch events missed during disconnect
  useAppEvent('om:bridge:reconnected', () => refresh())

  // Actions (unchanged from polling version)
  const markAsRead = async (id: string) => { /* same */ }
  const markAllRead = async () => { /* same */ }
  const dismiss = async (id: string) => { /* same */ }

  return { notifications, unreadCount, hasNew, markAsRead, markAllRead, dismiss, refresh }
}
```

### Step 4: Add Reconnect Event to Event Bridge

**File**: `packages/ui/src/backend/injection/eventBridge.ts` (MODIFY)

When the SSE connection reconnects after a disconnect, dispatch a special event so hooks can refresh:

```ts
source.onopen = () => {
  reconnectAttempts.current = 0
  resetHeartbeatTimer()
  // Notify hooks that SSE reconnected (may have missed events)
  if (wasDisconnected) {
    window.dispatchEvent(
      new CustomEvent(APP_EVENT_DOM_NAME, {
        detail: { id: 'om:bridge:reconnected', payload: {}, timestamp: Date.now(), organizationId: '' },
      }),
    )
  }
}
```

### Step 5: Swap Hook in NotificationBell

**File**: `packages/ui/src/backend/notifications/NotificationBell.tsx` (MODIFY)

```diff
- import { useNotificationsPoll } from './useNotificationsPoll'
+ import { useNotificationsSse } from './useNotificationsSse'

  export function NotificationBell() {
-   const { notifications, unreadCount, hasNew, ... } = useNotificationsPoll()
+   const { notifications, unreadCount, hasNew, ... } = useNotificationsSse()
```

### Step 6: SSE Payload Security — Recipient Filtering

**Critical**: Notifications are private. Server-side filtering is mandatory.

**Required implementation**
- Track `userId`, `roleIds`, `tenantId`, and `organizationId` in each `SseConnection`.
- Filter in SSE bus handler before send:
1. Tenant must match `tenantId`.
2. If event has `organizationId`, connection organization must match.
3. If event has `recipientUserId` or `recipientUserIds`, connection user must match.
4. If event has `recipientRoleId` or `recipientRoleIds`, connection roles must intersect.
- If any configured audience filter fails, do not send event to that connection.

**Client-side filtering status**
- Client checks remain optional defense-in-depth.
- Client checks are not considered access control and do not satisfy privacy requirements.

### Step 6a: Bridge Safeguard Implementation (2026-02-25)

Implemented in `packages/events/src/modules/events/api/stream/route.ts`:
- Connection context now stores `tenantId`, `organizationId`, `userId`, and `roleIds`.
- Event payload audience supports:
  - `organizationId` / `organizationIds`
  - `recipientUserId` / `recipientUserIds`
  - `recipientRoleId` / `recipientRoleIds`
- Events with missing `tenantId` are dropped.
- Audience dimensions are AND-combined before delivery.

Integration coverage added in `apps/mercato/src/modules/example/__integration__/TC-UMES-003.spec.ts`:
- `TC-UMES-E12` user recipient isolation
- `TC-UMES-E13` role recipient isolation
- `TC-UMES-E14` organization boundary isolation

### Step 7: Keep Polling as Fallback

Don't delete `useNotificationsPoll.ts`. Keep it as a fallback for environments where SSE isn't available (e.g., behind certain proxies/load balancers that buffer SSE):

```ts
const hook = typeof EventSource !== 'undefined'
  ? useNotificationsSse
  : useNotificationsPoll
```

### Step 8: Remove 5-Second Polling Interval

Once SSE is stable, disable the polling interval. The `useNotificationsPoll` remains but is only used as fallback. The default path uses SSE.

---

## Event Payload Shape

```ts
// notifications.notification.created
{
  tenantId: string
  organizationId: string | null
  recipientUserId: string
  notification: NotificationDto // Full notification for immediate render
}

// notifications.notification.batch_created
{
  tenantId: string
  organizationId: string | null
  recipientUserIds: string[]
  count: number
  // No individual notifications — client does a full refresh
}
```

**Payload size**: A single `NotificationDto` is ~300-500 bytes JSON. Well within the 4KB SSE limit.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| SSE connection not established yet | Initial REST fetch covers it; SSE events supplement |
| SSE disconnects temporarily | Event bridge auto-reconnects; fires `om:bridge:reconnected`; hook re-fetches |
| Browser doesn't support EventSource | Falls back to `useNotificationsPoll` (5s polling) |
| Multiple notifications created rapidly | Each arrives as separate SSE event; state updates are batched by React |
| Notification addressed to different user | Server-side filter drops event before delivery |
| Batch notification (100 users) | Single `batch_created` event; each client does one REST fetch |
| Group key deduplication | Server handles via advisory lock; client receives final notification state |
| Notification dismissed in tab A | REST call updates server; no SSE event needed (local state handles it) |
| User opens new tab | Initial REST fetch loads current state; SSE handles future updates |

---

## Migration Phases

### Phase 1: Add SSE events (no client changes)
- Add `events.ts` with `clientBroadcast: true`
- Emit events from notification service
- Existing polling still works — zero risk
- **Verification**: Check Network tab for SSE events when creating notifications

### Phase 2: Create SSE hook + swap in NotificationBell
- Build `useNotificationsSse` with same API as polling hook
- Swap in `NotificationBell`
- Keep polling hook as fallback
- **Verification**: Notification appears instantly without waiting for poll cycle

### Phase 3: Remove polling default
- Make SSE the default path
- Polling only activates if `EventSource` unavailable
- Remove 5s interval for SSE users
- **Verification**: Network tab shows zero polling requests after initial load

---

## Performance Impact

| Metric | Before (Polling) | After (SSE) |
|--------|-------------------|-------------|
| HTTP requests/user/day | ~17,280 | ~100 (initial loads + actions) |
| Notification latency | 0-5s (avg 2.5s) | <100ms |
| Server DB queries/min | 12 per user | On-demand only |
| Bandwidth/user/day | ~50MB (mostly unchanged responses) | ~50KB (only actual notifications) |
| Multi-tab overhead | Linear (each tab polls) | Minimal (SSE shared per tab) |

---

## Files Summary

### NEW Files (2)
1. `packages/core/src/modules/notifications/events.ts` — Event definitions with `clientBroadcast`
2. `packages/ui/src/backend/notifications/useNotificationsSse.ts` — SSE-driven hook

### MODIFIED Files (3)
1. `packages/core/src/modules/notifications/service/notificationService.ts` — Emit events on create
2. `packages/ui/src/backend/injection/eventBridge.ts` — Dispatch reconnect event
3. `packages/ui/src/backend/notifications/NotificationBell.tsx` — Swap hook

### KEPT Files (1)
1. `packages/ui/src/backend/notifications/useNotificationsPoll.ts` — Fallback for non-SSE environments

---

## Estimated Effort

- Step 1-2 (server events): ~1 hour
- Step 3 (SSE hook): ~2 hours
- Step 4-5 (bridge + swap): ~30 minutes
- Step 6 (filtering): Included in Step 3
- Step 7-8 (fallback + cleanup): ~30 minutes
- Testing: ~1 hour
- **Total**: ~5 hours

## Success Criteria

1. Creating a notification shows it in the bell **instantly** (no 5s delay)
2. Network tab shows **zero polling requests** after initial page load (SSE path)
3. Multi-tab: notification appears in all tabs simultaneously
4. SSE disconnect + reconnect: notifications catch up within 1s of reconnection
5. Fallback: if `EventSource` unavailable, polling activates automatically
6. A user never receives notification SSE payloads targeted to another user/role/organization

## Changelog

- 2026-02-25: Security model updated from client-side recipient filtering guidance to mandatory server-side audience filtering, with explicit implementation notes and integration coverage references.
