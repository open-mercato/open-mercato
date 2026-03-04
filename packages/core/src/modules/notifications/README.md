# Notifications Module

The notifications module provides in-app notifications and reactive client-side handling.

## SSE Delivery

Notification delivery to the UI is SSE-driven:

- Server emits `notifications.notification.created` with `clientBroadcast: true`
- Server emits `notifications.notification.batch_created` for fan-out operations (`createBatch`, `createForRole`, `createForFeature`)
- Payload includes scoped audience fields (`tenantId`, `organizationId`, `recipientUserId`) and the full `NotificationDto`
- UI consumes the stream through `useNotifications` (SSE-first strategy hook) and updates panel state immediately
- Notification handlers from `notifications.handlers.ts` (SPEC-043) are dispatched on arrival without polling

Legacy internal notification events (`notifications.created`, `notifications.read`, etc.) remain unchanged for subscribers and backward compatibility.

## Client Hooks

- `useNotifications` is the default notification state hook for `NotificationBell` and inbox pages
- `useNotifications` resolves to `useNotificationsSse` when `EventSource` is available
- `useNotificationsPoll` remains as an automatic fallback path when SSE is unavailable
