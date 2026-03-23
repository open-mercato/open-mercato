import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'checkout.link.usageLimitReached',
  persistent: true,
  id: 'checkout:usage-limit-reached-notify',
}

type UsageLimitPayload = {
  id: string
  slug?: string | null
  tenantId: string
  organizationId: string
}

export default async function handle(payload: UsageLimitPayload) {
  if (!payload.id || !payload.tenantId || !payload.organizationId) return

  try {
    const container = await createRequestContainer()
    const notificationService = resolveNotificationService(container)
    const typeDef = notificationTypes.find((n) => n.type === 'checkout.link.usageLimitReached')
    if (!typeDef) return

    const input = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'checkout.edit',
      bodyVariables: {
        linkName: payload.slug ?? payload.id,
      },
      sourceEntityType: 'checkout:checkout_link',
      sourceEntityId: payload.id,
      linkHref: `/backend/checkout/pay-links/${payload.id}`,
    })
    await notificationService.createForFeature(input, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
  } catch (err) {
    console.error('[checkout:usage-limit-reached-notify] notification failed:', err)
  }
}
