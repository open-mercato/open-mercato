import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { notificationTypes } from '../notifications'
import { loadSubscription, type GatewaySubscriptionEventPayload } from './shared'

export const metadata = {
  event: 'payment_gateways.subscription.trial_will_end',
  persistent: true,
  id: 'subscriptions.on-gateway-trial-will-end',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

function readTrialEndsAt(payload: GatewaySubscriptionEventPayload): string {
  const trialEnd = payload.data?.trial_end
  if (typeof trialEnd === 'number' && Number.isFinite(trialEnd) && trialEnd > 0) {
    return new Date(trialEnd * 1000).toISOString()
  }
  return ''
}

export default async function handler(payload: GatewaySubscriptionEventPayload, ctx: ResolverContext): Promise<void> {
  const subscription = await loadSubscription(ctx.resolve('em'), payload)
  if (!subscription) return

  const typeDef = notificationTypes.find((entry) => entry.type === 'subscriptions.subscription.trial_will_end')
  if (!typeDef) return

  const notificationService = resolveNotificationService(ctx)
  const input = buildFeatureNotificationFromType(typeDef, {
    requiredFeature: 'subscriptions.admin',
    bodyVariables: {
      externalAccountId: subscription.externalAccountId,
      trialEndsAt: readTrialEndsAt(payload),
    },
    sourceEntityType: 'subscriptions:subscription',
    sourceEntityId: subscription.id,
    linkHref: `/backend/subscriptions/${subscription.id}`,
    groupKey: `subscriptions.trial_will_end:${subscription.id}`,
  })

  await notificationService.createForFeature(input, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
}
