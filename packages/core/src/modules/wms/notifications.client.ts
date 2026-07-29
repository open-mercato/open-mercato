'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes } from './notifications'
import { WmsLowStockRenderer } from './widgets/notifications/WmsLowStockRenderer'
import { WmsReservationShortfallRenderer } from './widgets/notifications/WmsReservationShortfallRenderer'

const rendererMap: Record<string, NotificationTypeDefinition['Renderer']> = {
  'wms.inventory.low_stock': WmsLowStockRenderer,
  'wms.inventory.reservation_shortfall': WmsReservationShortfallRenderer,
}

export const wmsNotificationTypes: NotificationTypeDefinition[] = notificationTypes.map((type) => ({
  ...type,
  Renderer: rendererMap[type.type],
}))

export default wmsNotificationTypes
