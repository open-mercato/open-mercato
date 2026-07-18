import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications.js'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('production')

/**
 * Task 5.2 — turns an accepted `buy` MRP suggestion into a notification for
 * `production.mrp.manage` users (spec decision d, purchasing seam). `make`/
 * `reschedule`/`cancel` acceptances also emit
 * `production.mrp_suggestion.accepted` but only `buy` needs a
 * human-actionable purchasing nudge here.
 */
export const metadata = {
  event: 'production.mrp_suggestion.accepted',
  persistent: true,
  id: 'production:mrp-suggestion-accepted-notification',
}

type MrpSuggestionAcceptedPayload = {
  id: string
  suggestionType: 'make' | 'buy' | 'reschedule' | 'cancel'
  productId: string
  variantId?: string | null
  qty: string
  uom: string
  dueDate: string
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: MrpSuggestionAcceptedPayload, ctx: ResolverContext) {
  if (payload?.suggestionType !== 'buy') return

  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'production.mrp.buy_suggestion_accepted')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'production.mrp.manage',
      bodyVariables: {
        productId: payload.productId,
        qty: String(payload.qty),
        uom: payload.uom,
        dueDate: payload.dueDate,
      },
      sourceEntityType: 'production:mrp_suggestion',
      sourceEntityId: payload.id,
      linkHref: '/backend/production/mrp',
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    logger.error('production.mrp-suggestion-accepted-notification Failed to create notification', { err })
  }
}
