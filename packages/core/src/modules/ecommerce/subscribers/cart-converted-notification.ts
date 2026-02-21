import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'ecommerce.cart.converted',
  persistent: true,
  id: 'ecommerce:cart-converted-notification',
}

type CartConvertedPayload = {
  id: string
  organizationId: string
  tenantId: string
  orderId: string
  storeId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: CartConvertedPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((t) => t.type === 'ecommerce.order.storefront.created')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'sales.orders.manage',
      bodyVariables: {
        orderId: payload.orderId,
        storeId: payload.storeId,
      },
      sourceEntityType: 'sales:order',
      sourceEntityId: payload.orderId,
      linkHref: `/backend/sales/orders/${payload.orderId}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[ecommerce:cart-converted-notification] Failed to create notification:', err)
  }
}
