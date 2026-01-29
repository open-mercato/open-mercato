import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'catalog.product.stock_low',
  persistent: true,
  id: 'catalog:low-stock-notification',
}

type LowStockPayload = {
  productId: string
  productName: string
  sku?: string | null
  currentStock: number
  threshold: number
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: LowStockPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'catalog.product.low_stock')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'catalog.products.manage',
      bodyVariables: {
        productName: payload.productName,
        sku: payload.sku ?? '',
        currentStock: String(payload.currentStock),
        threshold: String(payload.threshold),
      },
      sourceEntityType: 'catalog:product',
      sourceEntityId: payload.productId,
      linkHref: `/backend/catalog/products/${payload.productId}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[catalog:low-stock-notification] Failed to create notification:', err)
  }
}
