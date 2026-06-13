import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'wms.inventory.reservation_shortfall',
  persistent: true,
  id: 'wms:reservation-shortfall-notification',
}

type ShortfallLine = {
  catalogVariantId: string
  requiredQuantity: number
  reservedQuantity: number
  shortfallQuantity: number
}

type ShortfallPayload = {
  orderId: string
  orderNumber?: string | null
  shortfalls: ShortfallLine[]
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: ShortfallPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'wms.inventory.reservation_shortfall')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'wms.view',
      bodyVariables: {
        orderNumber: payload.orderNumber ?? payload.orderId,
        shortfallCount: String(payload.shortfalls.length),
      },
      sourceEntityType: 'wms:inventory_reservation',
      sourceEntityId: payload.orderId,
      linkHref: '/backend/wms/reservations',
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    console.error('[wms:reservation-shortfall-notification] Failed to create notification:', error)
  }
}
