'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { WmsLowStockRenderer } from './widgets/notifications/WmsLowStockRenderer'
import { WmsReservationShortfallRenderer } from './widgets/notifications/WmsReservationShortfallRenderer'

export const wmsNotificationTypes: NotificationTypeDefinition[] = [
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
    Renderer: WmsLowStockRenderer,
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
        id: 'view',
        labelKey: 'wms.notifications.reservationShortfall.renderer.viewReservations',
        variant: 'outline',
        href: '/backend/wms/reservations',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/wms/reservations',
    Renderer: WmsReservationShortfallRenderer,
    expiresAfterHours: 72,
  },
]

export default wmsNotificationTypes
