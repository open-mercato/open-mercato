import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'
import { pushRenew } from '../commands/push-renew'
import { emitCommunicationChannelsEvent } from '../events'

/**
 * Spec C § Phase C4 — Daily cron that re-issues `gmail.users.watch` for
 * channels whose `watchExpirationMs` is within the renewal lead window.
 *
 * Gmail watch expires after ~7 days. We renew with a lead time of
 * `OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS` (default 24h) so a missed cron tick
 * doesn't drop us into the polling fallback.
 *
 * The actual renewal is delegated to `pushRenew` (which in turn calls
 * `pushRegister`) — Gmail's `users.watch` is idempotent, so re-calling it
 * just returns a fresh `historyId` + `expiration` and persists them.
 *
 * Scoped to `job.payload.scope` (the cron is registered per-org in
 * `setup.ts`); each per-org cron tick only walks channels for its own
 * `(tenantId, organizationId)`. A missing scope means the legacy global
 * sweep variant — supported for backwards compatibility, but new
 * registrations always carry a scope.
 */
export type GmailRenewWatchPayload = {
  scope?: { tenantId: string; organizationId: string | null }
}

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.gmailRenewWatch,
  id: 'communication_channels:gmail-renew-watch',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

const LEAD_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS ?? '24', 10) || 24,
)

export default async function handle(
  job: QueuedJob<GmailRenewWatchPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const cutoffMs = Date.now() + LEAD_HOURS * 60 * 60 * 1000
  const scope = job?.payload?.scope ?? null

  // Per-org cron: filter by the scope embedded in the payload. The unscoped
  // fallback is preserved so a deploy that hand-enqueues a renewal sweep
  // (e.g. an operator-triggered backfill) still works.
  const where: Record<string, unknown> = {
    providerKey: 'gmail',
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
      (channel.channelState as { watchExpirationMs?: number; pushStatus?: string } | null) ?? null
    if (!state || state.pushStatus !== 'active') continue
    if (typeof state.watchExpirationMs !== 'number') continue
    if (state.watchExpirationMs > cutoffMs) continue

    const organizationId = channel.organizationId
    if (!organizationId) {
      console.warn(
        `[gmail-renew-watch] skipping channel ${channel.id} — no organizationId on row`,
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
        `[gmail-renew-watch] failed to renew channel ${channel.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
  if (renewed > 0 || failed > 0) {
    console.info(`[gmail-renew-watch] renewed=${renewed} failed=${failed}`)
  }
}

function resolveContainer(
  containerProxy: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): import('awilix').AwilixContainer {
  // The queue runtime exposes container access via `ctx.container` in
  // dedicated worker harnesses, but the bare-worker contract only provides
  // `ctx.resolve(name)`. Both shapes appear in production (test harness,
  // AUTO_SPAWN_WORKERS) so we accept either.
  if (containerProxy && typeof containerProxy === 'object' && 'resolve' in containerProxy) {
    return containerProxy as import('awilix').AwilixContainer
  }
  // Synthesize a minimal container shape from `resolve`.
  return { resolve: ctx.resolve.bind(ctx) } as unknown as import('awilix').AwilixContainer
}
