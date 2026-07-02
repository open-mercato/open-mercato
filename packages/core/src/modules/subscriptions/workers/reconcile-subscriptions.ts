import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Subscription } from '../data/entities'
import { GatewaySubscriptionMapping } from '../../payment_gateways/data/entities'

type Payload = {
  tenantId: string
  organizationId: string
  staleAfterMinutes?: number
  abandonedMappingHours?: number
}

type Ctx = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: 'subscriptions-reconcile',
  id: 'subscriptions:reconcile-subscriptions',
  concurrency: 1,
}

function buildAuth(tenantId: string, organizationId: string): AuthContext {
  return {
    sub: 'system',
    tenantId,
    orgId: organizationId,
    roles: ['superadmin'],
    isSuperAdmin: true,
  } as AuthContext
}

export default async function handler(job: QueuedJob<Payload>, ctx: Ctx): Promise<void> {
  const payload = job.payload ?? ({} as Payload)
  const tenantId = payload.tenantId
  const organizationId = payload.organizationId
  if (!tenantId || !organizationId) return

  const em = ctx.resolve<EntityManager>('em')
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const container = ctx.resolve<{ resolve: <T = unknown>(name: string) => T }>('container')
    ?? ((ctx as unknown) as { container?: { resolve: <T = unknown>(name: string) => T } }).container
    ?? null

  const staleAfter = payload.staleAfterMinutes ?? 20
  const staleThreshold = new Date(Date.now() - staleAfter * 60 * 1000)
  const candidates = await findWithDecryption(
    em,
    Subscription,
    {
      tenantId,
      organizationId,
      deletedAt: null,
      updatedAt: { $lt: staleThreshold },
    },
    { limit: 200 },
    { tenantId, organizationId },
  )

  for (const subscription of candidates) {
    if (!subscription.providerSubscriptionId) continue
    if (['canceled', 'incomplete_expired'].includes(subscription.providerStatus.toLowerCase())) continue
    try {
      await commandBus.execute('subscriptions.subscription.refresh', {
        input: { subscriptionId: subscription.id },
        ctx: {
          container: container as Parameters<CommandBus['execute']>[1]['ctx']['container'],
          auth: buildAuth(tenantId, organizationId),
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: [organizationId],
        },
      })
    } catch (error) {
      console.warn('[subscriptions.reconcile] failed', subscription.id, error)
    }
  }

  const abandonedHours = payload.abandonedMappingHours ?? 24
  const abandonedThreshold = new Date(Date.now() - abandonedHours * 60 * 60 * 1000)
  const abandoned = await findWithDecryption(
    em,
    GatewaySubscriptionMapping,
    {
      tenantId,
      organizationId,
      providerSubscriptionId: null,
      createdAt: { $lt: abandonedThreshold },
    },
    { limit: 200 },
    { tenantId, organizationId },
  )
  for (const mapping of abandoned) {
    em.remove(mapping)
  }
  if (abandoned.length) await em.flush()
}
