import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'
import { pushRenew } from '../commands/push-renew'
import { emitCommunicationChannelsEvent } from '../events'

/**
 * Spec C § Phase C4 — Every-2-hours cron that renews Microsoft Graph
 * subscriptions before their `subscriptionExpiresAt` deadline.
 *
 * Microsoft subscriptions on `/me/messages` plain notifications expire after
 * ~70 hours; we renew with a lead time of
 * `OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS` (default 4h).
 *
 * Renewal calls `pushRenew` → `pushRegister`, which creates a NEW
 * subscription (different `subscriptionId`). The old subscription would
 * normally need an explicit `DELETE /subscriptions/{old-id}`, but Microsoft
 * Graph auto-expires subscriptions after their `expirationDateTime`, so
 * skipping the explicit delete is acceptable for v1 — the old subscription
 * goes silent within ~70h. A tighter implementation could call
 * `adapter.unregisterPush` first, but that complicates the failure model
 * (failure between unregister + register leaves the channel push-less).
 *
 * Scoped to `job.payload.scope` (the cron is registered per-org in
 * `setup.ts`); each per-org cron tick only walks channels for its own
 * `(tenantId, organizationId)`. A missing scope falls back to the legacy
 * global sweep to support operator-triggered ad-hoc backfills.
 */
export type MicrosoftRenewSubscriptionsPayload = {
  scope?: { tenantId: string; organizationId: string | null }
}

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.microsoftRenewSubscriptions,
  id: 'communication_channels:microsoft-renew-subscriptions',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

const LEAD_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS ?? '4', 10) || 4,
)

export default async function handle(
  job: QueuedJob<MicrosoftRenewSubscriptionsPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const cutoff = new Date(Date.now() + LEAD_HOURS * 60 * 60 * 1000)
  const scope = job?.payload?.scope ?? null

  const where: Record<string, unknown> = {
    providerKey: 'microsoft',
    isActive: true,
    deletedAt: null,
  }
  if (scope?.tenantId) where.tenantId = scope.tenantId
  if (scope?.organizationId) where.organizationId = scope.organizationId
  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    where,
    undefined,
    scope ? { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null } : undefined,
  )

  const containerProxy = (ctx as unknown as { container?: unknown }).container
  let renewed = 0
  let failed = 0
  for (const channel of channels) {
    const state =
      (channel.channelState as { subscriptionExpiresAt?: string; subscriptionId?: string; pushStatus?: string } | null) ??
      null
    if (!state || state.pushStatus !== 'active') continue
    if (!state.subscriptionExpiresAt || !state.subscriptionId) continue
    const expiresAt = new Date(state.subscriptionExpiresAt)
    if (!Number.isFinite(expiresAt.getTime())) continue
    if (expiresAt.getTime() > cutoff.getTime()) continue

    const organizationId = channel.organizationId
    if (!organizationId) {
      console.warn(
        `[microsoft-renew-subscriptions] skipping channel ${channel.id} — no organizationId on row`,
      )
      continue
    }

    try {
      const container = resolveContainer(containerProxy, ctx)
      const result = await pushRenew({
        container,
        scope: {
          tenantId: channel.tenantId,
          organizationId,
          userId: channel.userId ?? null,
        },
        input: { channelId: channel.id },
      })
      if (result.pushStatus === 'active') {
        renewed += 1
        await emitCommunicationChannelsEvent(
          'communication_channels.push.renewed',
          {
            channelId: channel.id,
            providerKey: channel.providerKey,
            tenantId: channel.tenantId,
            organizationId,
          },
          { persistent: false },
        )
      } else {
        failed += 1
      }
    } catch (err) {
      failed += 1
      console.warn(
        `[microsoft-renew-subscriptions] failed to renew channel ${channel.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
  if (renewed > 0 || failed > 0) {
    console.info(`[microsoft-renew-subscriptions] renewed=${renewed} failed=${failed}`)
  }
}

function resolveContainer(
  containerProxy: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): import('awilix').AwilixContainer {
  if (containerProxy && typeof containerProxy === 'object' && 'resolve' in containerProxy) {
    return containerProxy as import('awilix').AwilixContainer
  }
  return { resolve: ctx.resolve.bind(ctx) } as unknown as import('awilix').AwilixContainer
}
