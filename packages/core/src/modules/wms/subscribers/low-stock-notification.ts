import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

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
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[wms:low-stock-notification] Failed to create notification:', err)
  }
}
