import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'ecommerce.store.channel_binding_missing',
    channels: ['in_app'],
    module: 'ecommerce',
    titleKey: 'ecommerce.notifications.store.channelBindingMissing.title',
    bodyKey: 'ecommerce.notifications.store.channelBindingMissing.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/config/ecommerce/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/config/ecommerce/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'ecommerce.store.assortment_empty',
    channels: ['in_app'],
    module: 'ecommerce',
    titleKey: 'ecommerce.notifications.store.assortmentEmpty.title',
    bodyKey: 'ecommerce.notifications.store.assortmentEmpty.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/config/ecommerce/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/config/ecommerce/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
