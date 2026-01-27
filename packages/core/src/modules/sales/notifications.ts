import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'sales.order.created',
    module: 'sales',
    titleKey: 'sales.notifications.order.created.title',
    bodyKey: 'sales.notifications.order.created.body',
    icon: 'shopping-cart',
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
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'sales.quote.created',
    module: 'sales',
    titleKey: 'sales.notifications.quote.created.title',
    bodyKey: 'sales.notifications.quote.created.body',
    icon: 'file-text',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/quotes/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/quotes/{sourceEntityId}',
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'sales.payment.received',
    module: 'sales',
    titleKey: 'sales.notifications.payment.received.title',
    bodyKey: 'sales.notifications.payment.received.body',
    icon: 'credit-card',
    severity: 'success',
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
    expiresAfterHours: 168, // 7 days
  },
  {
    type: 'sales.quote.expiring',
    module: 'sales',
    titleKey: 'sales.notifications.quote.expiring.title',
    bodyKey: 'sales.notifications.quote.expiring.body',
    icon: 'clock',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/quotes/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/quotes/{sourceEntityId}',
    expiresAfterHours: 72, // 3 days
  },
]

export default notificationTypes
