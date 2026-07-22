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
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'gmail-history-sync' })

/**
 * Spec C § Phase C2 — Gmail Pub/Sub push delivery worker.
 *
 * One job per verified webhook notification. Calls
 * `adapter.applyPushNotification(...)` to walk `users.history.list` from the
 * channel's stored `historyId`, then dispatches each message through
 * `ingest-inbound-message` (same path as the polling worker).
 *
 * Concurrency: bounded by the queue's default (10). Per-channel ordering is
 * NOT guaranteed across notifications — but the ingest command is idempotent
 * on `(channel_id, external_message_id)`, and Gmail's history cursor advances
 * monotonically per channel, so out-of-order replay is safe.
 */
export type GmailHistorySyncJobPayload = {
  channelId: string
  scope: { tenantId: string; organizationId: string | null }
  notification: { emailAddress: string; historyId: string }
  /** Self-re-enqueue drain counter (bounds the multi-page drain loop). */
  drainPage?: number
}

/** Hard cap on self-re-enqueue drain pages — guards against an adapter that
 *  returns `hasMore` with a non-advancing cursor (a tight, unbounded loop). */
const MAX_DRAIN_PAGES = 100

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.gmailHistorySync,
  id: 'communication_channels:gmail-history-sync',
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
  job: QueuedJob<GmailHistorySyncJobPayload>,
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
  if (!channel) {
    logger.warn('channel not found (skip)', { channelId })
    return
  }
  if (!channel.isActive || channel.status !== 'connected') return

  const adapter = adapterRegistry?.get(channel.providerKey)
  if (!adapter || typeof adapter.applyPushNotification !== 'function') {
    logger.warn('adapter does not support applyPushNotification', { providerKey: channel.providerKey })
    return
  }

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
    logger.warn('permanent failure applying push for channel', { channelId: channel.id, reason: classification.message })
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
        if (classification.transient) {
          // Per-message commit semantics from Spec B: re-throw so queue
          // retry re-runs from a safe point.
          throw err
        }
        logger.warn('permanent ingest failure for channel', { channelId: channel.id, reason: classification.message })
        await writeIngestDeadLetter({ em, scope, channel, message, err, errorMessage: classification.message })
      }
    }
  }

  // Persist the adapter's advanced cursor (encoded in nextCursor) back to
  // channel.channelState. fetchHistory's nextCursor is a base64-JSON blob
  // mirroring the new GmailChannelState — same as the polling worker writes.
  if (page?.nextCursor) {
    try {
      const decoded = JSON.parse(Buffer.from(page.nextCursor, 'base64').toString('utf-8')) as Record<string, unknown>
      // Carry the push keys forward via preservePushState rather than spreading
      // the decoded cursor wholesale: a blind spread would retain a stale
      // `pendingHistoryPageToken` after a completed drain and mis-route the next
      // push notification.
      channel.channelState = preservePushState(channel.channelState, decoded)
      channel.lastPolledAt = new Date()
      await em.flush()
    } catch (err) {
      logger.warn('failed to persist next cursor for channel', { channelId: channel.id, err })
    }
  }

  if (page?.hasMore && page?.nextCursor) {
    // Re-enqueue self so the drain continues. The Pub/Sub notification fired
    // once, but `history.list` may need multiple pages on a busy mailbox.
    // Bound the drain and add a small delay so an adapter that returns
    // `hasMore: true` with a non-advancing cursor cannot spin a tight,
    // unthrottled re-enqueue loop against the provider/queue.
    const drainPage = job.payload.drainPage ?? 0
    if (drainPage < MAX_DRAIN_PAGES) {
      const queue = (await import('../lib/queue')).getCommunicationChannelsQueue(
        COMMUNICATION_CHANNELS_QUEUES.gmailHistorySync,
      )
      await queue.enqueue(
        { ...job.payload, drainPage: drainPage + 1 } as unknown as Record<string, unknown>,
        { delayMs: 250 },
      )
    } else {
      logger.warn('drain page cap reached; stopping re-enqueue', { maxDrainPages: MAX_DRAIN_PAGES, channelId })
    }
  }
}
