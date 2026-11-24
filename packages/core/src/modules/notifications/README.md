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

## Legacy command-action cleanup

After upgrading the notification action authorization fix, operators can review and expire old command actions that cannot be distinguished from API-created copies. Choose the timestamp when every app/worker was upgraded and run a preview for one tenant:

```bash
yarn mercato notifications cleanup-legacy-commands --tenant <tenant-uuid> --before <upgrade-ISO-timestamp>
```

Add `--org <organization-uuid>` to restrict the cleanup to one organization. Without it, the command includes every organization and tenant-global rows in the selected tenant. The cutoff must be in the past; rows created exactly at the cutoff are excluded. The preview reports the size of the next batch and makes no changes.

After reviewing the scope and cutoff, add `--apply` to expire that batch and remove its command-backed buttons. `--limit 1-100` controls the batch size (default 100); rerun until zero rows match. Link-only buttons and other metadata are preserved. Already claimed/executed actions are skipped. Dismissed rows are included because they can be restored, and restoring a cleaned notification cannot restore its removed commands. Legitimate and API-created command buttons are indistinguishable, so this intentionally removes both kinds of historical commands in the selected scope.

The command is optional and has no undo. It never runs automatically at startup or during an upgrade. The existing `cleanup-expired` command remains unchanged. Use the query in the [security specification](../../../../../../.ai/specs/2026-10-20-notification-action-command-authorization.md) to inspect pending historical rows before applying cleanup.
