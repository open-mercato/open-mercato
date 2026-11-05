import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'example.umes.actionable-toast',
    notificationType: 'example.umes.actionable',
    features: ['example.todos.manage'],
    priority: 100,
    handle(notification, context) {
      context.toast({
        title: notification.title,
        body: notification.body ?? undefined,
        severity: 'info',
      })
      context.emitEvent('om:example:notification-handled', {
        notificationId: notification.id,
        type: notification.type,
      })
    },
  },
]

export default notificationHandlers
