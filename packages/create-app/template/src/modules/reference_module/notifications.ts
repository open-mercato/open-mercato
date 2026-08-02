import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'reference_module.reference_task.status_changed',
    module: 'reference_module',
    titleKey: 'reference_module.notifications.taskStatus.title',
    bodyKey: 'reference_module.notifications.taskStatus.body',
    icon: 'list-checks',
    severity: 'info',
    actions: [{
      id: 'view',
      labelKey: 'common.view',
      variant: 'outline',
      href: '/backend/reference_module/tasks/{sourceEntityId}',
      icon: 'external-link',
    }],
    primaryActionId: 'view',
    linkHref: '/backend/reference_module/tasks/{sourceEntityId}',
    expiresAfterHours: 72,
  },
  {
    type: 'reference_module.import.completed',
    module: 'reference_module',
    titleKey: 'reference_module.notifications.importCompleted.title',
    bodyKey: 'reference_module.notifications.importCompleted.body',
    icon: 'file-check',
    severity: 'success',
    actions: [{ id: 'view', labelKey: 'common.view', variant: 'outline', href: '/backend/reference_module/tasks' }],
    primaryActionId: 'view',
    linkHref: '/backend/reference_module/tasks',
    expiresAfterHours: 24,
  },
]

export default notificationTypes
