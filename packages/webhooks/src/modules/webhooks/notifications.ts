import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'webhooks.delivery.failed',
    module: 'webhooks',
    labelKey: 'webhooks.notifications.delivery.failed.label',
    titleKey: 'webhooks.notifications.delivery.failed.title',
    bodyKey: 'webhooks.notifications.delivery.failed.body',
    icon: 'webhook',
    severity: 'error',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/webhooks/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/webhooks/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
