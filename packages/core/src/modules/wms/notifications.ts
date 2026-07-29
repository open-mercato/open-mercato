import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'wms.inventory.low_stock',
    module: 'wms',
    titleKey: 'wms.notifications.lowStock.title',
    bodyKey: 'wms.notifications.lowStock.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'wms.notifications.lowStock.renderer.viewInventory',
        variant: 'outline',
        href: '/backend/wms/inventory',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/wms/inventory',
    expiresAfterHours: 72,
  },
  {
    type: 'wms.inventory.reservation_shortfall',
    module: 'wms',
    titleKey: 'wms.notifications.reservationShortfall.title',
    bodyKey: 'wms.notifications.reservationShortfall.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view-order',
        labelKey: 'wms.notifications.reservationShortfall.renderer.viewOrder',
        variant: 'outline',
        href: '/backend/sales/orders/{sourceEntityId}',
        icon: 'external-link',
      },
      {
        id: 'view-inventory',
        labelKey: 'wms.notifications.reservationShortfall.renderer.viewInventory',
        variant: 'outline',
        href: '/backend/wms/inventory',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/orders/{sourceEntityId}',
    expiresAfterHours: 72,
  },
]

export default notificationTypes
