import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('wms')

export const metadata = {
  event: 'wms.inventory.low_stock',
  persistent: true,
  id: 'wms:low-stock-notification',
}

type LowStockPayload = {
  catalogVariantId: string
  availableQuantity: number
  reorderPoint: number
  safetyStock: number
  state: 'below_safety_stock' | 'below_reorder_point'
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: LowStockPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'wms.inventory.low_stock')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'wms.view',
      bodyVariables: {
        availableQuantity: String(payload.availableQuantity),
        reorderPoint: String(payload.reorderPoint),
        safetyStock: String(payload.safetyStock),
        state: payload.state,
      },
      sourceEntityType: 'wms:inventory_balance',
      sourceEntityId: payload.catalogVariantId,
      linkHref: `/backend/wms/sku/${encodeURIComponent(payload.catalogVariantId)}`,
      // Dedupe repeated low-stock events for the same variant/state: as long as a prior
      // notification with this groupKey is still active, it gets refreshed in place
      // instead of piling up a new row per inventory operation.
      groupKey: `wms.inventory.low_stock:${payload.catalogVariantId}:${payload.state}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    logger.error('Failed to create notification', { subscriber: 'low-stock-notification', err })
  }
}
