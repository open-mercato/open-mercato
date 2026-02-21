import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'ecommerce.order.storefront.created',
    module: 'ecommerce',
    titleKey: 'ecommerce.notifications.storefront_order.created.title',
    bodyKey: 'ecommerce.notifications.storefront_order.created.body',
    icon: 'shopping-bag',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/orders/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/orders/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
