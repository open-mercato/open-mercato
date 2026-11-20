import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'messages.new',
    // Ships without push — operators re-enable it per type from the Notification Delivery settings.
    channels: ['in_app', 'email'],
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
  {
    type: 'messages.delivery_failed',
    channels: ['in_app', 'email'],
    module: 'messages',
    titleKey: 'messages.notifications.deliveryFailed.title',
    bodyKey: 'messages.notifications.deliveryFailed.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'messages.actions.resendFailed',
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
