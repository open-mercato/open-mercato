import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

export const REFERENCE_TASK_REFRESH_EVENT = 'om:reference_module:tasks-refresh'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'reference_module.tasks-refresh',
    notificationType: [
      'reference_module.reference_task.status_changed',
      'reference_module.import.completed',
    ],
    features: ['reference_module.view'],
    priority: 100,
    debounceMs: 250,
    handle(notification, context) {
      context.emitEvent(REFERENCE_TASK_REFRESH_EVENT, {
        notificationId: notification.id,
        taskId: notification.sourceEntityId ?? null,
      })
      context.refreshNotifications()
    },
  },
]

export default notificationHandlers
