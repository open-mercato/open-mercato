import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel } from '@open-mercato/core/modules/communication_channels/data/entities'
import {
  COMMUNICATION_CHANNELS_QUEUES,
  getCommunicationChannelsQueue,
} from '@open-mercato/core/modules/communication_channels/lib/queue'
import { emitCommunicationChannelsEvent } from '@open-mercato/core/modules/communication_channels/events'
import { parseDiscordCredentialsOrThrow, discordChannelStateSchema } from '../lib/credentials'
import {
  getDiscordGatewayClient,
  type DiscordGatewayHandle,
  type GatewayResumeState,
} from '../lib/discord-gateway-client'
import {
  persistDiscordChannelState,
  type DiscordChannelScope,
  type DiscordChannelStatePatch,
} from '../lib/channel-state-store'
import { buildInboundMessageJob, buildReactionJob, type GatewayChannelScope } from '../lib/gateway-bridge'

const logger = createLogger('channel_discord').child({ component: 'gateway-worker' })

/**
 * Long-running Discord Gateway bridge worker (SPEC 2026-06-19 § Gateway worker).
 *
 * This is a *provider-owned* long-running worker — a novel pattern relative to
 * the email providers (which are poll/push-driven by the hub). A worker file
 * under `workers/` is auto-discovered, so shipping one from a provider package is
 * allowed by the framework. `concurrency: 1` enforces the single-identify-per-bot
 * discipline Discord requires.
 *
 * The job opens one Gateway WebSocket per active `discord` channel and bridges
 * `MESSAGE_CREATE` / reaction events into the hub's existing queues (inbound +
 * reactions) — the same jobs the webhook route enqueues, so the hub stays
 * unchanged. Events the bot authored are dropped (feedback-loop guard); the hub
 * dedups the rest.
 *
 * Set `OM_CHANNEL_DISCORD_GATEWAY_DISABLED=1` to skip opening sockets (CI /
 * send-only deployments).
 */
/** Queue that the gateway bridge consumes. Shared with `cli.ts` (start-gateway). */
export const CHANNEL_DISCORD_GATEWAY_QUEUE = 'channel_discord_gateway'

export const metadata: WorkerMeta = {
  queue: CHANNEL_DISCORD_GATEWAY_QUEUE,
  id: 'channel_discord:gateway',
  concurrency: 1,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

type GatewayJobPayload = {
  /** Optional tenant filter; when absent, all active discord channels connect. */
  tenantId?: string
  organizationId?: string | null
}

export interface GatewayConnectionEntry {
  handle: DiscordGatewayHandle
  tenantId: string
}

// Module-level registry so a re-run replaces an existing connection instead of
// opening a second socket for the same channel (single-identify discipline).
// Keyed by channel id; carries tenantId so a per-tenant reconciliation never
// tears down another tenant's sockets.
const activeConnections = new Map<string, GatewayConnectionEntry>()

// Serializes resume-state writes per channel. The socket callbacks that produce
// them (READY on every (re)connect) fire independently of the job loop, so
// without a chain two callbacks for the same channel could interleave their
// read-modify-write and lose the fresher one.
const pendingStateWrites = new Map<string, Promise<unknown>>()

/**
 * Whether a registry entry still holds a running session. A session that is
 * merely reconnecting with backoff after a resumable close reports `true` — it
 * heals itself and MUST NOT be torn down and replaced by the refresh job.
 */
export function isConnectionLive(entry: GatewayConnectionEntry | undefined): boolean {
  if (!entry) return false
  try {
    return entry.handle.isActive()
  } catch {
    return false
  }
}

/**
 * Close + drop any live connection whose channel is no longer in the active set
 * (deactivated / soft-deleted / re-scoped). Without this the socket + heartbeat
 * timer would leak forever after a channel is disconnected. When `tenantFilter`
 * is set, only that tenant's connections are eligible for teardown (a scoped
 * refresh must not touch other tenants' sockets). Returns the ids reconciled
 * away. Pure over its arguments so it is unit-testable.
 */
export function reconcileGatewayConnections(
  activeChannelIds: Set<string>,
  connections: Map<string, GatewayConnectionEntry> = activeConnections,
  tenantFilter?: string,
): string[] {
  const removed: string[] = []
  for (const [channelId, entry] of connections) {
    if (activeChannelIds.has(channelId)) continue
    if (tenantFilter && entry.tenantId !== tenantFilter) continue
    try {
      entry.handle.close()
    } catch {
      /* best-effort close */
    }
    connections.delete(channelId)
    removed.push(channelId)
  }
  return removed
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
}

export default async function handle(job: QueuedJob<GatewayJobPayload>, ctx: HandlerContext): Promise<void> {
  if (parseBooleanWithDefault(process.env.OM_CHANNEL_DISCORD_GATEWAY_DISABLED, false)) {
    logger.info('gateway disabled via OM_CHANNEL_DISCORD_GATEWAY_DISABLED — skipping connect')
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = ctx.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }
  if (!credentialsService) {
    logger.warn('integrationCredentialsService unavailable — cannot resolve bot tokens')
    return
  }

  const filter: Record<string, unknown> = { providerKey: 'discord', isActive: true, deletedAt: null }
  if (job.payload?.tenantId) filter.tenantId = job.payload.tenantId

  const channels = (await findWithDecryption(em, CommunicationChannel, filter)) as CommunicationChannel[]

  // The refresh job is a *reconciler*, not a re-connector: a channel whose
  // session is still running is left alone. Restarting it (the previous
  // behaviour) tore down healthy sockets on every tick of the CLI's 60s refresh
  // and forced a fresh IDENTIFY each time, which burns Discord's session-start
  // budget and drops the dispatches in flight.
  let started = 0
  let kept = 0
  for (const channel of channels) {
    if (isConnectionLive(activeConnections.get(channel.id))) {
      kept += 1
      continue
    }
    await startChannelConnection(channel, credentialsService, em)
    started += 1
  }

  // Full reconciliation: close sockets for channels that dropped out of the
  // active set since the last run (deactivated / soft-deleted). A scoped run
  // (tenant filter) only reconciles within that tenant so a per-tenant refresh
  // never tears down another tenant's live sockets.
  const activeIds = new Set(channels.map((channel) => channel.id))
  const removed = reconcileGatewayConnections(activeIds, activeConnections, job.payload?.tenantId)
  if (removed.length > 0) {
    logger.info('reconciled away stale discord gateway connections', { channelIds: removed })
  }
  logger.debug('discord gateway reconciliation finished', { started, kept, removed: removed.length })
}

async function startChannelConnection(
  channel: CommunicationChannel,
  credentialsService: CredentialsServiceLike,
  em: EntityManager,
): Promise<void> {
  const scope: GatewayChannelScope = {
    channelId: channel.id,
    channelType: channel.channelType,
    tenantId: channel.tenantId,
    organizationId: channel.organizationId ?? null,
  }

  let credentials: Record<string, unknown> | null = null
  try {
    credentials = await credentialsService.resolve('channel_discord', {
      tenantId: channel.tenantId,
      organizationId: channel.organizationId ?? channel.tenantId,
      userId: channel.userId ?? null,
    })
  } catch (err) {
    logger.warn('failed to resolve discord credentials for channel', { channelId: channel.id, err })
    return
  }
  if (!credentials) return

  let botToken: string
  try {
    botToken = parseDiscordCredentialsOrThrow(credentials).botToken
  } catch (err) {
    logger.warn('invalid discord credentials for channel', { channelId: channel.id, err })
    return
  }

  const channelState = discordChannelStateSchema.parse(channel.channelState ?? {})
  const resumeState: GatewayResumeState = {
    sessionId: channelState.sessionId,
    sequence: channelState.sequence ?? null,
    resumeGatewayUrl: channelState.resumeGatewayUrl,
  }

  // Only reached for a channel with no live session (see `handle`): drop the
  // dead handle, if any, before opening its replacement.
  const stale = activeConnections.get(channel.id)
  if (stale) {
    try {
      stale.handle.close()
    } catch {
      /* best-effort close of an already-dead session */
    }
    activeConnections.delete(channel.id)
  }

  const stateScope: DiscordChannelScope = {
    tenantId: channel.tenantId,
    organizationId: channel.organizationId ?? null,
  }

  const inboundQueue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.inbound)
  const reactionsQueue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.reactions)
  let botUserId: string | undefined = channelState.botUserId

  const handle = getDiscordGatewayClient().connect({
    botToken,
    resumeState,
    onMessage: async (message) => {
      const jobPayload = buildInboundMessageJob({ message, channel: scope, botUserId })
      if (!jobPayload) return
      await inboundQueue.enqueue(jobPayload as unknown as Record<string, unknown>)
    },
    onReaction: async (reaction, action) => {
      const reactionJob = await buildReactionJob({ reaction, action, channel: scope, botUserId })
      if (!reactionJob) return
      await reactionsQueue.enqueue(reactionJob as unknown as Record<string, unknown>)
    },
    onReady: async ({ botUserId: readyBotUserId, resumeState: freshResumeState }) => {
      botUserId = readyBotUserId || botUserId
      await persistChannelState(em, channel.id, stateScope, { ...freshResumeState, botUserId })
      logger.info('discord gateway ready', { channelId: channel.id })
    },
    onRequiresReauth: async ({ code }) => {
      logger.warn('discord gateway fatal close — flagging requires_reauth', { channelId: channel.id, code })
      await emitCommunicationChannelsEvent(
        'communication_channels.channel.requires_reauth',
        {
          channelId: channel.id,
          providerKey: 'discord',
          channelType: channel.channelType,
          reason: `gateway_close_${code}`,
          tenantId: channel.tenantId,
          organizationId: channel.organizationId ?? null,
        },
        { persistent: true },
      )
      activeConnections.delete(channel.id)
    },
  })
  activeConnections.set(channel.id, { handle, tenantId: channel.tenantId })
}

/**
 * Persist gateway resume state for one channel, tenant-scoped and serialized.
 *
 * The write is queued behind any write already in flight for the same channel so
 * two socket callbacks cannot interleave their read-modify-write, and it runs
 * through `persistDiscordChannelState`, which filters by `tenant_id` /
 * `organization_id` and only merges the gateway-owned keys.
 */
async function persistChannelState(
  em: EntityManager,
  channelId: string,
  scope: DiscordChannelScope,
  patch: DiscordChannelStatePatch,
): Promise<void> {
  const previous = pendingStateWrites.get(channelId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        const result = await persistDiscordChannelState({ em, channelId, scope, patch })
        if (result === 'not_found') {
          logger.warn('discord channel not found in scope while persisting resume state', { channelId })
        }
      } catch (err) {
        // Resume-state persistence is best-effort — a failure just means the next
        // connect re-identifies fresh instead of resuming.
        logger.warn('failed to persist discord gateway resume state', { channelId, err })
      }
    })
  pendingStateWrites.set(channelId, next)
  await next
  if (pendingStateWrites.get(channelId) === next) pendingStateWrites.delete(channelId)
}
