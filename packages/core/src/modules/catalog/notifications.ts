import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'catalog.product.low_stock',
    module: 'catalog',
    titleKey: 'catalog.notifications.product.lowStock.title',
    bodyKey: 'catalog.notifications.product.lowStock.body',
    icon: 'package-x',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/products/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/catalog/products/{sourceEntityId}',
    expiresAfterHours: 72, // 3 days
  },
]

export default notificationTypes
