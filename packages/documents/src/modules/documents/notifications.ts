import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'documents.comment.mentioned',
    module: 'documents',
    titleKey: 'documents.notifications.comment.mentioned.title',
    bodyKey: 'documents.notifications.comment.mentioned.body',
    icon: 'at-sign',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/documents/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/documents/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
