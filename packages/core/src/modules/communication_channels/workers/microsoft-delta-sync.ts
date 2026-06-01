import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
} from '../commands/ingest-inbound-message'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'
import { preservePushState } from '../lib/push-state'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { classifyOutboundError } from '../lib/error-classification'
import { writeIngestDeadLetter } from '../lib/dead-letter'
import type { ChannelAdapterRegistry } from '../lib/registry'

/**
 * Spec C § Phase C3 — Microsoft Graph delta-sync worker.
 *
 * Mirrors gmail-history-sync: one job per verified Graph change notification
 * (or lifecycle `missed` event), calls `adapter.applyPushNotification` which
 * delegates to `/me/messages/delta`, ingests each message through the
 * `ingest-inbound-message` command.
 */
export type MicrosoftDeltaSyncJobPayload = {
  channelId: string
  scope: { tenantId: string; organizationId: string | null }
  notification: { subscriptionId: string; changeType: string; resource: string }
  /** Self-re-enqueue drain counter (bounds the multi-page delta drain loop). */
  drainPage?: number
}

/** Hard cap on self-re-enqueue drain pages — guards against an adapter that
 *  returns `hasMore` with a non-advancing cursor (a tight, unbounded loop). */
const MAX_DRAIN_PAGES = 100

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.microsoftDeltaSync,
  id: 'communication_channels:microsoft-delta-sync',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

export default async function handle(
  job: QueuedJob<MicrosoftDeltaSyncJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const { channelId, scope } = job.payload
  const em = (ctx.resolve('em') as EntityManager).fork()
  const adapterRegistry = ctx.resolve<ChannelAdapterRegistry>('channelAdapterRegistry')

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: channelId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!channel) return
  if (!channel.isActive || channel.status !== 'connected') return

  const adapter = adapterRegistry?.get(channel.providerKey)
  if (!adapter || typeof adapter.applyPushNotification !== 'function') return

  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = ctx.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }
  const credentialsScope = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? scope.tenantId,
    userId: channel.userId ?? null,
  }
  let credentials: Record<string, unknown> = {}
  if (channel.credentialsRef && credentialsService) {
    try {
      credentials =
        (await credentialsService.resolve(`channel_${channel.providerKey}`, credentialsScope)) ?? {}
    } catch {
      credentials = {}
    }
  }
  const refreshed = await refreshCredentialsIfNeeded(
    { adapter, channelId: channel.id, credentials, scope: credentialsScope },
    { credentialsService },
  )
  credentials = refreshed.credentials

  let page
  try {
    page = await adapter.applyPushNotification({
      credentials,
      scope: { tenantId: scope.tenantId, organizationId: scope.organizationId ?? scope.tenantId },
      channelState: (channel.channelState as Record<string, unknown> | null) ?? {},
      notification: job.payload.notification as unknown as Record<string, unknown>,
    })
  } catch (err) {
    const classification = classifyOutboundError(err)
    if (classification.transient) throw err
    console.warn(
      `[microsoft-delta-sync] permanent failure for channel ${channel.id}: ${classification.message}`,
    )
    return
  }

  const messages = Array.isArray(page?.messages) ? page.messages : []
  if (messages.length > 0) {
    const commandBus = ctx.resolve<CommandBus>('commandBus')
    const containerProxy = { resolve: ctx.resolve.bind(ctx) }
    const commandCtx = {
      container: containerProxy as never,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: scope.organizationId ?? null,
      organizationIds: scope.organizationId ? [scope.organizationId] : null,
    }
    for (const message of messages) {
      try {
        const input: IngestInboundMessageInput = {
          channelId: channel.id,
          providerKey: channel.providerKey,
          channelType: channel.channelType,
          scope: { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
          message,
        }
        await commandBus.execute(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID, {
          input,
          ctx: commandCtx as never,
        })
      } catch (err) {
        const classification = classifyOutboundError(err)
        if (classification.transient) throw err
        console.warn(
          `[microsoft-delta-sync] permanent ingest failure for channel ${channel.id}: ${classification.message}`,
        )
        await writeIngestDeadLetter({ em, scope, channel, message, err, errorMessage: classification.message })
      }
    }
  }

  if (page?.nextCursor) {
    try {
      const decoded = JSON.parse(Buffer.from(page.nextCursor, 'base64').toString('utf-8')) as Record<string, unknown>
      // Full replace (carrying push keys forward) — see preservePushState: a spread
      // would retain a stale `pendingNextLink` after a completed drain and mis-route
      // the next change notification.
      channel.channelState = preservePushState(channel.channelState, decoded)
      channel.lastPolledAt = new Date()
      await em.flush()
    } catch (err) {
      console.warn(
        `[microsoft-delta-sync] failed to persist next cursor for channel ${channel.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  if (page?.hasMore && page?.nextCursor) {
    // Bound the drain and add a small delay so an adapter that returns
    // `hasMore: true` with a non-advancing cursor cannot spin a tight,
    // unthrottled re-enqueue loop against the provider/queue.
    const drainPage = job.payload.drainPage ?? 0
    if (drainPage < MAX_DRAIN_PAGES) {
      const queue = (await import('../lib/queue')).getCommunicationChannelsQueue(
        COMMUNICATION_CHANNELS_QUEUES.microsoftDeltaSync,
      )
      await queue.enqueue(
        { ...job.payload, drainPage: drainPage + 1 } as unknown as Record<string, unknown>,
        { delayMs: 250 },
      )
    } else {
      console.warn(
        `[microsoft-delta-sync] drain page cap (${MAX_DRAIN_PAGES}) reached for channel ${channelId}; stopping re-enqueue`,
      )
    }
  }
}
