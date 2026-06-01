import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID,
  type ProcessInboundReactionInput,
  type ProcessInboundReactionResult,
} from '../commands/process-inbound-reaction'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import { classifyOutboundError, computeBackoffMs } from '../lib/error-classification'
import { CommunicationChannel } from '../data/entities'
import {
  REACTION_PROCESSOR_MAX_ATTEMPTS,
  type ReactionInboundJob,
  type ReactionOutboundRemoveJob,
  type ReactionOutboundSendJob,
  type ReactionProcessorPayload,
} from '../lib/reaction-processor-types'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import type { ChannelAdapterRegistry } from '../lib/registry'

export type { ReactionProcessorPayload }

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.reactions,
  id: 'communication_channels:reaction-processor',
  concurrency: 10,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Unified reaction worker — handles inbound, outbound-send, and outbound-remove
 * jobs from the `communication-channels-reactions` queue via a discriminated payload.
 *
 *   - `inbound` — dispatches the `process_inbound_reaction` command which
 *     applies provider semantics and emits `.reaction.added/.removed`.
 *   - `outbound_send` — calls `adapter.sendReaction?(...)`. The local
 *     `MessageReaction` row was already created by the API/command layer
 *     for UX responsiveness; this worker just notifies the provider.
 *   - `outbound_remove` — calls `adapter.removeReaction?(...)`. The local
 *     row was already deleted by the API/command layer.
 *
 * Retry: transient failures re-enqueue with exponential backoff up to
 * `REACTION_PROCESSOR_MAX_ATTEMPTS = 3`. Permanent failures stop. Reactions
 * are inherently low-stakes (a missed reaction is annoying, not data loss),
 * so we do not surface failures via a dedicated event; provider errors are
 * logged through `integrationLogService` when available.
 */
export default async function handle(
  job: QueuedJob<ReactionProcessorPayload>,
  ctx: HandlerContext,
): Promise<void> {
  switch (job.payload.kind) {
    case 'inbound':
      await handleInbound(job.payload, ctx)
      return
    case 'outbound_send':
      await handleOutboundSend(job.payload, ctx)
      return
    case 'outbound_remove':
      await handleOutboundRemove(job.payload, ctx)
      return
    default: {
      // exhaustiveness check
      const exhaustive: never = job.payload
      throw new Error(`Unknown reaction job kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

async function handleInbound(payload: ReactionInboundJob, ctx: HandlerContext): Promise<void> {
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const containerProxy = { resolve: ctx.resolve.bind(ctx) }
  const commandCtx = {
    container: containerProxy as never,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: payload.scope.organizationId ?? null,
    organizationIds: payload.scope.organizationId ? [payload.scope.organizationId] : null,
  }
  const input: ProcessInboundReactionInput = {
    channelId: payload.channelId,
    providerKey: payload.providerKey,
    channelType: payload.channelType,
    scope: payload.scope,
    event: payload.event,
  }
  await commandBus.execute<ProcessInboundReactionInput, ProcessInboundReactionResult>(
    COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID,
    { input, ctx: commandCtx as never },
  )
}

async function handleOutboundSend(payload: ReactionOutboundSendJob, ctx: HandlerContext): Promise<void> {
  const result = await callAdapterOutbound(payload, ctx, 'send')
  await maybeRetry(result, payload, ctx)
}

async function handleOutboundRemove(
  payload: ReactionOutboundRemoveJob,
  ctx: HandlerContext,
): Promise<void> {
  const result = await callAdapterOutbound(payload, ctx, 'remove')
  await maybeRetry(result, payload, ctx)
}

type AdapterCallResult =
  | { status: 'ok' }
  | { status: 'no_adapter'; message: string }
  | { status: 'channel_inactive'; message: string }
  | { status: 'failed'; transient: boolean; message: string }

async function callAdapterOutbound(
  payload: ReactionOutboundSendJob | ReactionOutboundRemoveJob,
  ctx: HandlerContext,
  action: 'send' | 'remove',
): Promise<AdapterCallResult> {
  const adapterRegistry = ctx.resolve<ChannelAdapterRegistry>('channelAdapterRegistry')
  const adapter = adapterRegistry?.get(payload.providerKey)
  if (!adapter) {
    return { status: 'no_adapter', message: `No adapter for provider '${payload.providerKey}'` }
  }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: payload.channelId,
      tenantId: payload.scope.tenantId,
      organizationId: payload.scope.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    payload.scope,
  )
  if (!channel) {
    return { status: 'no_adapter', message: `Channel ${payload.channelId} not found` }
  }
  if (!channel.isActive) {
    return { status: 'channel_inactive', message: `Channel ${payload.channelId} is inactive` }
  }

  // Credentials. Per-user scoping via `channel.userId` (review R2-C1 / N1).
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
  let credentials: Record<string, unknown> = {}
  let credentialsService: CredentialsServiceLike | null = null
  try {
    credentialsService = ctx.resolve<CredentialsServiceLike>('integrationCredentialsService')
  } catch {
    credentialsService = null
  }
  const credentialsScope = {
    tenantId: payload.scope.tenantId,
    organizationId: payload.scope.organizationId ?? payload.scope.tenantId,
    userId: channel.userId ?? null,
  }
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

  try {
    if (action === 'send') {
      if (typeof adapter.sendReaction !== 'function') {
        return { status: 'no_adapter', message: `Adapter '${adapter.providerKey}' has no sendReaction` }
      }
      const sendPayload = payload as ReactionOutboundSendJob
      await adapter.sendReaction({
        externalMessageId: sendPayload.messageId, // platform message id; the adapter maps to provider id via its own channel-link lookup if needed
        conversationId: sendPayload.conversationId ?? '',
        emoji: sendPayload.emoji,
        credentials,
        scope: {
          tenantId: payload.scope.tenantId,
          organizationId: payload.scope.organizationId ?? payload.scope.tenantId,
        },
      })
    } else {
      if (typeof adapter.removeReaction !== 'function') {
        return { status: 'no_adapter', message: `Adapter '${adapter.providerKey}' has no removeReaction` }
      }
      const removePayload = payload as ReactionOutboundRemoveJob
      await adapter.removeReaction({
        externalMessageId: removePayload.externalReactionId ?? removePayload.messageId,
        conversationId: removePayload.conversationId ?? '',
        emoji: removePayload.emoji,
        credentials,
        scope: {
          tenantId: payload.scope.tenantId,
          organizationId: payload.scope.organizationId ?? payload.scope.tenantId,
        },
      })
    }
    return { status: 'ok' }
  } catch (err) {
    const classification = classifyOutboundError(err)
    return {
      status: 'failed',
      transient: classification.transient,
      message: classification.message,
    }
  }
}

async function maybeRetry(
  result: AdapterCallResult,
  payload: ReactionProcessorPayload,
  ctx: HandlerContext,
): Promise<void> {
  if (result.status === 'ok') return
  if (result.status === 'no_adapter' || result.status === 'channel_inactive') {
    // Permanent — log and stop.
    console.error(
      `[communication_channels:reaction-processor] ${result.status}: ${result.message}`,
    )
    return
  }
  if (!result.transient) {
    console.error(
      `[communication_channels:reaction-processor] permanent failure: ${result.message}`,
    )
    return
  }
  const attempt = payload.attempt ?? 1
  if (attempt >= REACTION_PROCESSOR_MAX_ATTEMPTS) {
    console.error(
      `[communication_channels:reaction-processor] giving up after attempt ${attempt}: ${result.message}`,
    )
    return
  }
  const next: ReactionProcessorPayload = { ...payload, attempt: attempt + 1 }
  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.reactions)
  await queue.enqueue(next as unknown as Record<string, unknown>, {
    delayMs: computeBackoffMs(attempt),
  })
}
