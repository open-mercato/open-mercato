import type { EntityManager } from '@mikro-orm/postgresql'
import { emitSubscriptionsEvent } from '../events'
import {
  loadSubscription,
  parseEventTimestamp,
  type GatewaySubscriptionEventPayload,
} from './shared'
import { mapProviderStatusToAccessState } from '../lib/access-state'

export const metadata = {
  event: 'payment_gateways.subscription.cancelled',
  persistent: true,
  id: 'subscriptions.on-gateway-subscription-cancelled',
}

type Ctx = {
  resolve?: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

function getResolver(ctx: Ctx | undefined): (<T>(name: string) => T) | null {
  if (!ctx) return null
  if (typeof ctx.resolve === 'function') return ctx.resolve as <T>(name: string) => T
  if (ctx.container && typeof ctx.container.resolve === 'function') return ctx.container.resolve.bind(ctx.container) as <T>(name: string) => T
  return null
}

export default async function handler(payload: GatewaySubscriptionEventPayload, ctx: Ctx): Promise<void> {
  const resolve = getResolver(ctx)
  if (!resolve) return
  const em = resolve<EntityManager>('em')

  const subscription = await loadSubscription(em, payload)
  if (!subscription) return

  const eventTime = parseEventTimestamp(payload)
  if (eventTime && subscription.lastProviderEventAt && eventTime.getTime() < subscription.lastProviderEventAt.getTime()) {
    return
  }
  const previous = subscription.accessState
  subscription.providerStatus = 'canceled'
  subscription.cancelAtPeriodEnd = false
  subscription.cancelledAt = eventTime ?? new Date()
  subscription.accessState = mapProviderStatusToAccessState('canceled')
  if (eventTime) subscription.lastProviderEventAt = eventTime
  await em.flush()

  if (previous !== subscription.accessState) {
    await emitSubscriptionsEvent(
      'subscriptions.access.changed',
      {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
        subscriptionId: subscription.id,
        externalAccountId: subscription.externalAccountId,
        accessState: subscription.accessState,
        previousAccessState: previous,
        providerStatus: subscription.providerStatus,
      },
    )
  }
}
