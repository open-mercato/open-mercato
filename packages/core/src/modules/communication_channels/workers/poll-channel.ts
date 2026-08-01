import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
} from '../commands/ingest-inbound-message'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import { preservePushState } from '../lib/push-state'
import { writeIngestDeadLetter } from '../lib/dead-letter'
import { classifyOutboundError, computeBackoffMs, isReauthError } from '../lib/error-classification'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { emitCommunicationChannelsEvent } from '../events'
import type { ChannelAdapterRegistry } from '../lib/registry'
import type { NormalizedInboundMessage } from '../lib/adapter'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'poll-channel' })

/**
 * Job payload for the `communication-channels-poll` queue.
 *
 * One job per channel per scheduler tick. The poll-tick worker (sibling file)
 * enumerates due channels and enqueues these jobs.
 */
export type PollChannelJobPayload = {
  channelId: string
  scope: {
    tenantId: string
    organizationId: string | null
  }
  /** Attempt count, 1-based; used for retry-backoff decisions. */
  attempt?: number
  /** Self-re-enqueue drain counter (bounds the multi-page `hasMore` drain loop). */
  drainPage?: number
}

export const POLL_CHANNEL_MAX_ATTEMPTS = 3

/**
 * Hard cap on `hasMore` self-re-enqueue drain pages — guards against an adapter
 * that returns `hasMore: true` with a non-advancing (pinned) cursor, which would
 * otherwise spin a tight, unthrottled re-enqueue loop. Mirrors the same guard in
 * `gmail-history-sync`.
 */
const MAX_DRAIN_PAGES = 100

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.poll,
  id: 'communication_channels:poll-channel',
  concurrency: 10,
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

/**
 * Poll a single channel for inbound messages.
 *
 * Per SPEC-045d § 6 (with email-spec § Hub Deltas → Delta 6 polling extensions):
 *   1. Load the channel; skip when `is_active === false` or `status !== 'connected'`.
 *   2. Skip when the adapter declares `realtimePush !== false` (it doesn't want polling).
 *   3. Refresh credentials if OAuth and within the expiry window.
 *   4. Call `adapter.fetchHistory({ channelId, credentials, since: lastPolledAt })`.
 *   5. For each normalized message, dispatch `ingest_inbound_message` (idempotent on
 *      `(channel_id, external_message_id)`).
 *   6. Update `channel.lastPolledAt = NOW()` on success.
 *   7. On error: classify, set `channel.status` accordingly, set `last_error`, emit
 *      `channel.requires_reauth` on 401, retry transient failures up to MAX.
 *
 * The hub doesn't drain a remote mailbox indefinitely — `fetchHistory` returns a
 * single page (provider decides the size). If the provider has more, the next tick
 * picks it up after the configured `poll_interval_seconds`.
 */
export default async function handle(
  job: QueuedJob<PollChannelJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const { channelId, scope, attempt = 1, drainPage = 0 } = job.payload
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
    logger.warn('channel not found (skipping)', { channelId })
    return
  }
  if (!channel.isActive) return
  // Allow `connected` (normal poll) and `error` (Spec B § B5 auto-recovery
  // sweep enqueues these intentionally — on a successful poll below we
  // flip them back to `connected`). `requires_reauth` and `disconnected`
  // are owned by the credential-refresh and disconnect flows.
  if (channel.status !== 'connected' && channel.status !== 'error') return

  const adapter = adapterRegistry?.get(channel.providerKey)
  if (!adapter) {
    logger.warn('no adapter for provider', { providerKey: channel.providerKey, channelId })
    return
  }
  // Adapter opted out of polling — webhook providers.
  const capabilities = (channel.capabilities as { realtimePush?: boolean } | null) ?? null
  if (capabilities?.realtimePush !== false) {
    // realtimePush is `true` (default for back-compat) — don't poll push providers.
    return
  }
  if (typeof adapter.fetchHistory !== 'function') {
    // Adapter doesn't implement history fetching — nothing we can do.
    return
  }

  // Credentials.
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = ctx.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }
  // Per-user credentials scope: pass `channel.userId` so the credentials
  // service returns this user's row, not whoever connected the provider last.
  // See review R2-C1 / N1 (2026-05-26).
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
    {
      adapter,
      channelId: channel.id,
      credentials,
      scope: credentialsScope,
    },
    { credentialsService },
  )
  credentials = refreshed.credentials

  // Fetch a single page of history.
  // `channelState` is the provider-specific resumption cursor — Gmail historyId,
  // IMAP UIDVALIDITY+UIDNEXT, etc. We persist it across
  // ticks on `channel.channelState` so each poll resumes from the prior one
  // instead of running a full mailbox resync. Empty / NULL = "first poll;
  // bootstrap the cursor from the provider".
  let normalized: NormalizedInboundMessage[] = []
  let nextCursor: string | undefined
  let hasMore = false
  try {
    const result = await adapter.fetchHistory({
      conversationId: channel.externalIdentifier ?? channel.id,
      credentials,
      cursor: channel.lastPolledAt ? channel.lastPolledAt.toISOString() : undefined,
      channelState: (channel.channelState as Record<string, unknown> | null) ?? undefined,
      scope: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId ?? scope.tenantId,
      },
      // `contactFilter.sinceDays` is a hint to provider adapters about how far
      // back to look on first-poll bootstrap. For UID-incremental polls (every
      // tick after the first), adapters ignore this and just fetch new mail
      // since the persisted cursor.
      contactFilter: { addresses: [], sinceDays: 7 },
    })
    normalized = Array.isArray(result?.messages) ? result.messages : []
    nextCursor = result?.nextCursor
    hasMore = result?.hasMore === true
  } catch (err) {
    await handlePollError(err, em, channel, scope, attempt, job.payload)
    return
  }

  // Dispatch ingest commands for each message.
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const containerProxy = { resolve: ctx.resolve.bind(ctx) }
  const commandCtx = {
    container: containerProxy as never,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId ?? null,
    organizationIds: scope.organizationId ? [scope.organizationId] : null,
  }
  // Spec B § Per-message commit + dead-letter:
  //   - Permanent failure (malformed MIME, schema, contract violation):
  //     write to channel_ingest_dead_letter, log, advance cursor anyway so
  //     the bad blob never stalls the channel again.
  //   - Transient failure (DB drop, network blip): abort the loop without
  //     advancing the cursor. The next tick re-fetches the same page;
  //     idempotency via the (channel_id, external_message_id) unique
  //     constraint means already-ingested messages no-op on the retry.
  let transientIngestAbort = false
  for (const message of normalized) {
    try {
      const input: IngestInboundMessageInput = {
        channelId: channel.id,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        scope: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId ?? null,
        },
        message,
      }
      await commandBus.execute(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID, {
        input,
        ctx: commandCtx as never,
      })
    } catch (err) {
      const classification = classifyOutboundError(err)
      if (classification.transient) {
        logger.warn('transient ingest failure; aborting page so cursor is not advanced', { channelId: channel.id, reason: classification.message })
        transientIngestAbort = true
        break
      }
      // Permanent — write to dead-letter so an operator can replay later.
      // The shared helper is best-effort (never throws) and idempotent on
      // `(channelId, externalMessageId)`, so a replayed page that fails the
      // same message again does not insert a duplicate row.
      await writeIngestDeadLetter({
        em,
        scope,
        channel,
        message,
        err,
        errorMessage: classification.message,
      })
      logger.warn('permanent ingest failure; recorded in dead-letter and advancing cursor', { channelId: channel.id, externalMessageId: message.externalMessageId, reason: classification.message })
    }
  }

  // Transient abort: keep prior cursor + lastPolledAt so the next tick
  // re-fetches the same page (idempotent at the DB layer).
  if (transientIngestAbort) {
    channel.lastError = 'transient_ingest_failure'
    await em.flush()
    return
  }

  // Update poll cursor + clear any stale error state.
  channel.lastPolledAt = new Date()
  if (channel.lastError) channel.lastError = null
  // Recover the channel from any prior non-fatal error state. The previous
  // poll(s) may have set status='error' after exhausting transient-retry
  // attempts, but a fresh successful poll means the upstream is healthy
  // again — flip it back to 'connected' so the scheduler keeps it in
  // rotation and the user doesn't have to manually reconnect.
  // We DON'T touch 'requires_reauth' here (that lifecycle state is owned
  // by the credential-refresh / OAuth flow) or 'disconnected' (owned by
  // the cascade-on-user-delete subscriber).
  if (channel.status === 'error') {
    channel.status = 'connected'
  }
  // Providers encode their cursor as base64-encoded JSON in `nextCursor`; we
  // decode it back to an object so the next tick can pass it straight into
  // `fetchHistory` as `channelState`. Decode failures fall back to the prior
  // state (next tick bootstraps from there).
  //
  // Push-delivery state (Spec C) — watch/subscription identifiers and expiry — is
  // owned by the push register/renew commands, not the sync cursor. A provider's
  // `fetchHistory` returns only sync-cursor fields, so persisting the decoded
  // cursor as a full replace would silently wipe push state and stop
  // `gmail-renew-watch` from renewing it. Carry
  // the hub-owned push keys forward whenever the new cursor omits them.
  if (typeof nextCursor === 'string' && nextCursor.length > 0) {
    const decoded = decodeChannelStateCursor(nextCursor)
    if (decoded) {
      channel.channelState = preservePushState(channel.channelState, decoded)
    }
  }
  await em.flush()

  // Drain contract (review H1, 2026-05-26): adapters that have additional
  // pages beyond this tick's batch (large mailboxes, mid-deltaLink walks,
  // UID overflows) signal `hasMore: true`. The persisted `channelState`
  // already encodes the mid-drain resumption token (Gmail `pendingHistoryPageToken`,
  // IMAP non-terminal `uidNext`). Re-enqueue with
  // a small delay so we keep draining without overrunning rate limits.
  if (hasMore) {
    // Bound the drain: an adapter that returns `hasMore: true` with a
    // non-advancing cursor (e.g. a persistently-failing message that pins the
    // Gmail cursor via `hardFailed`) must not spin an unthrottled loop. Stop
    // at MAX_DRAIN_PAGES; the next scheduled poll tick re-checks the channel.
    if (drainPage < MAX_DRAIN_PAGES) {
      const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll)
      await queue.enqueue(
        { channelId: channel.id, scope, attempt: 1, drainPage: drainPage + 1 } as unknown as Record<string, unknown>,
        { delayMs: 250 },
      )
    } else {
      logger.warn('drain page cap reached; stopping re-enqueue until the next scheduled tick', { maxDrainPages: MAX_DRAIN_PAGES, channelId: channel.id })
    }
  }
}

function decodeChannelStateCursor(cursor: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

async function handlePollError(
  err: unknown,
  em: EntityManager,
  channel: CommunicationChannel,
  scope: PollChannelJobPayload['scope'],
  attempt: number,
  payload: PollChannelJobPayload,
): Promise<void> {
  const classification = classifyOutboundError(err)
  channel.lastError = classification.message

  if (isReauthError(classification)) {
    channel.status = 'requires_reauth'
    await em.flush()
    await emitCommunicationChannelsEvent(
      'communication_channels.channel.requires_reauth',
      {
        channelId: channel.id,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        reason: classification.message,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId ?? null,
      },
      { persistent: true },
    )
    return
  }

  if (classification.transient && attempt < POLL_CHANNEL_MAX_ATTEMPTS) {
    // Transient error — re-enqueue with backoff. Channel status stays
    // `connected` so the scheduler keeps it in rotation.
    await em.flush()
    const next: PollChannelJobPayload = { ...payload, attempt: attempt + 1 }
    const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.poll)
    await queue.enqueue(next as unknown as Record<string, unknown>, {
      delayMs: computeBackoffMs(attempt),
    })
    return
  }

  // Permanent or attempts exhausted — mark channel as error and stop the loop.
  channel.status = 'error'
  await em.flush()
}
