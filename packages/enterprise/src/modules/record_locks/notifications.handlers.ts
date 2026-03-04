import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

export const RECORD_LOCKS_LOCK_CONTENDED_EVENT = 'om:record_locks:lock-contended'
export const RECORD_LOCKS_RECORD_DELETED_EVENT = 'om:record_locks:record-deleted'
export const RECORD_LOCKS_INCOMING_CHANGES_EVENT = 'om:record_locks:incoming-changes'
export const RECORD_LOCKS_FORCE_RELEASED_EVENT = 'om:record_locks:force-released'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'record_locks.lock-contended-event',
    notificationType: 'record_locks.lock.contended',
    features: ['record_locks.view'],
    priority: 100,
    handle(notification, context) {
      context.emitEvent(RECORD_LOCKS_LOCK_CONTENDED_EVENT, {
        notificationId: notification.id,
        sourceEntityId: notification.sourceEntityId ?? null,
        resourceKind: notification.bodyVariables?.resourceKind ?? null,
      })
    },
  },
  {
    id: 'record_locks.record-deleted-event',
    notificationType: 'record_locks.record.deleted',
    features: ['record_locks.view'],
    priority: 100,
    handle(notification, context) {
      context.emitEvent(RECORD_LOCKS_RECORD_DELETED_EVENT, {
        notificationId: notification.id,
        resourceId: notification.sourceEntityId ?? null,
        resourceKind: notification.bodyVariables?.resourceKind ?? null,
      })
    },
  },
  {
    id: 'record_locks.incoming-changes-event',
    notificationType: 'record_locks.incoming_changes.available',
    features: ['record_locks.view'],
    priority: 90,
    handle(notification, context) {
      context.emitEvent(RECORD_LOCKS_INCOMING_CHANGES_EVENT, {
        notificationId: notification.id,
        sourceEntityId: notification.sourceEntityId ?? null,
        resourceId: notification.bodyVariables?.resourceId ?? null,
        resourceKind: notification.bodyVariables?.resourceKind ?? null,
      })
    },
  },
  {
    id: 'record_locks.force-released-toast',
    notificationType: 'record_locks.lock.force_released',
    features: ['record_locks.view'],
    priority: 110,
    handle(notification, context) {
      context.toast({
        title: notification.title,
        body: notification.body ?? undefined,
        severity: 'warning',
      })
      context.emitEvent(RECORD_LOCKS_FORCE_RELEASED_EVENT, {
        notificationId: notification.id,
        sourceEntityId: notification.sourceEntityId ?? null,
        resourceId: notification.bodyVariables?.resourceId ?? null,
        resourceKind: notification.bodyVariables?.resourceKind ?? null,
      })
    },
  },
]

export default notificationHandlers
