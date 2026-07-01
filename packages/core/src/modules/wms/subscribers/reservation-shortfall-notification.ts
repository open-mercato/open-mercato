import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
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

async function resolveShortfallSku(
  ctx: ResolverContext,
  catalogVariantId: string,
  organizationId: string | null | undefined,
  tenantId: string,
): Promise<string> {
  try {
    const queryEngine = ctx.resolve<QueryEngine>('queryEngine')
    const result = await queryEngine.query(E.catalog.catalog_product_variant, {
      tenantId,
      organizationId: organizationId ?? undefined,
      filters: { id: { $eq: catalogVariantId } },
      fields: ['id', 'sku', 'name'],
      page: { page: 1, pageSize: 1 },
    })
    const row = result.items?.[0] as { sku?: string | null; name?: string | null } | undefined
    const sku = typeof row?.sku === 'string' ? row.sku.trim() : ''
    if (sku) return sku
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (name) return name
  } catch {
    // fall through to variant id
  }
  return catalogVariantId
}

export default async function handle(payload: ShortfallPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'wms.inventory.reservation_shortfall')
    if (!typeDef) return

    const primaryShortfall = payload.shortfalls[0]
    const shortfallSku = primaryShortfall
      ? await resolveShortfallSku(
          ctx,
          primaryShortfall.catalogVariantId,
          payload.organizationId,
          payload.tenantId,
        )
      : ''
    const shortfallQuantity = primaryShortfall ? String(primaryShortfall.shortfallQuantity) : '0'
    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'wms.view',
      bodyVariables: {
        orderNumber: payload.orderNumber ?? payload.orderId,
        shortfallCount: String(payload.shortfalls.length),
        shortfallSku,
        shortfallQuantity,
        shortfallVariantId: primaryShortfall?.catalogVariantId ?? '',
      },
      sourceEntityType: 'sales:order',
      sourceEntityId: payload.orderId,
      linkHref: `/backend/sales/orders/${encodeURIComponent(payload.orderId)}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    console.error('[wms:reservation-shortfall-notification] Failed to create notification:', error)
  }
}
