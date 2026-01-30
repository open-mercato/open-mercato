import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'workflows.task.assigned',
    module: 'workflows',
    titleKey: 'workflows.notifications.task.assigned.title',
    bodyKey: 'workflows.notifications.task.assigned.body',
    icon: 'clipboard-list',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/workflows/tasks/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/workflows/tasks/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
]

export default notificationTypes
