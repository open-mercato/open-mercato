# Notifications Module

The notifications module provides in-app notifications and reactive client-side handling.

## SSE Delivery

Notification delivery to the UI is SSE-driven:

- Server emits `notifications.notification.created` with `clientBroadcast: true`
- Payload includes scoped audience fields (`tenantId`, `organizationId`, `recipientUserId`) and the full `NotificationDto`
- UI consumes the stream through `useNotificationsSse` and updates panel state immediately
- Notification handlers from `notifications.handlers.ts` (SPEC-043) are dispatched on arrival without polling

Legacy internal notification events (`notifications.created`, `notifications.read`, etc.) remain unchanged for subscribers and backward compatibility.

## Client Hooks

- `useNotificationsSse` is the default notification state hook for `NotificationBell`
- `useNotificationsPoll` is retained as a legacy fallback implementation but is no longer the default path
