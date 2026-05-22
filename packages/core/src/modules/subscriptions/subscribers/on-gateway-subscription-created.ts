import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import { emitSubscriptionsEvent } from '../events'
import {
  ensureSubscriptionFromSnapshot,
  fetchSnapshotForPayload,
  linkMappingToSubscription,
  loadMappingForEvent,
  loadSubscription,
  type GatewaySubscriptionEventPayload,
} from './shared'

export const metadata = {
  event: 'payment_gateways.subscription.created',
  persistent: true,
  id: 'subscriptions.on-gateway-subscription-created',
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
  const credentialsService = resolve<CredentialsService>('integrationCredentialsService')

  const mapping = await loadMappingForEvent(em, payload)
  if (!mapping && !payload.subscriptionId) return

  const snapshot = await fetchSnapshotForPayload({ credentialsService }, payload)
  if (!snapshot) return

  const ensured = await ensureSubscriptionFromSnapshot(
    { em, credentialsService },
    {
      ...payload,
      externalAccountId: payload.externalAccountId ?? mapping?.externalAccountId ?? null,
    },
    snapshot,
  )
  if (!ensured) return
  await linkMappingToSubscription(em, payload, ensured)

  await emitSubscriptionsEvent(
    'subscriptions.access.changed',
    {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      subscriptionId: ensured.id,
      externalAccountId: ensured.externalAccountId,
      accessState: ensured.accessState,
      previousAccessState: null,
      providerStatus: ensured.providerStatus,
    },
  )
}
