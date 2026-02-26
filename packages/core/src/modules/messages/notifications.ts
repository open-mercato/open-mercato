import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'messages.new',
    module: 'messages',
    titleKey: 'messages.notifications.new.title',
    bodyKey: 'messages.notifications.new.body',
    icon: 'mail',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/messages/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/messages/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
