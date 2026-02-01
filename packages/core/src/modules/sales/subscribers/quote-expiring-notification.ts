import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'sales.quote.expiring',
  persistent: true,
  id: 'sales:quote-expiring-notification',
}

type QuoteExpiringPayload = {
  quoteId: string
  quoteNumber: string
  expiresAt: string
  daysUntilExpiry: number
  customerName?: string | null
  totalAmount?: string | null
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: QuoteExpiringPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'sales.quote.expiring')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'sales.quotes.manage',
      bodyVariables: {
        quoteNumber: payload.quoteNumber,
        expiresAt: payload.expiresAt,
        daysUntilExpiry: String(payload.daysUntilExpiry),
        customerName: payload.customerName ?? '',
      },
      sourceEntityType: 'sales:quote',
      sourceEntityId: payload.quoteId,
      linkHref: `/backend/sales/quotes/${payload.quoteId}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[sales:quote-expiring-notification] Failed to create notification:', err)
  }
}
