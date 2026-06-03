import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ChannelAdapterRegistry } from '../lib/registry'
import type { InboundMessage, NormalizedInboundMessage } from '../lib/adapter'
import {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
  type IngestInboundMessageResult,
} from '../commands/ingest-inbound-message'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'

/**
 * Job payload enqueued by the webhook route after successful signature verification.
 *
 * The route does the cheap signature-verification step synchronously and immediately
 * returns 200. Normalization (`adapter.normalizeInbound`) + DB writes run here, in
 * the worker, so a slow database or a long contact-resolution path can't time-out
 * the provider's webhook.
 */
export type InboundProcessorPayload = {
  providerKey: string
  channelId: string
  channelType: string
  raw: InboundMessage
  scope: {
    tenantId: string
    organizationId: string | null
  }
}

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.inbound,
  id: 'communication_channels:inbound-processor',
  concurrency: 10,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Inbound channel message processor.
 *
 * Per SPEC-045d §6:
 *   - Resolves the channel adapter for the inbound providerKey.
 *   - Calls `adapter.normalizeInbound(raw)` to produce a `NormalizedInboundMessage`.
 *   - Hands off to the `communication_channels.message.ingest_inbound` command,
 *     which idempotently creates ExternalConversation, ChannelThreadMapping,
 *     ExternalMessage, MessageChannelLink, and composes the platform Message.
 *
 * Idempotency: handled by the command (dedup on `(channel_id, external_message_id)`).
 * The worker can safely retry on transient failures.
 */
export default async function handle(
  job: QueuedJob<InboundProcessorPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const { providerKey, channelId, channelType, raw, scope } = job.payload

  const adapterRegistry = ctx.resolve<ChannelAdapterRegistry>('channelAdapterRegistry')
  const adapter = adapterRegistry?.get(providerKey)
  if (!adapter) {
    throw new Error(
      `No ChannelAdapter registered for providerKey '${providerKey}' (worker job ${job.id}). ` +
        'Check that the provider package is enabled in modules.ts.',
    )
  }

  // Normalize the raw inbound payload into the hub's canonical shape.
  const normalized: NormalizedInboundMessage = await adapter.normalizeInbound(raw)
  if (!normalized?.externalMessageId || !normalized?.externalConversationId) {
    throw new Error(
      `Adapter '${providerKey}' returned a normalized message missing required fields ` +
        `(externalMessageId, externalConversationId) for worker job ${job.id}`,
    )
  }

  const commandBus = ctx.resolve<CommandBus>('commandBus')

  // The worker's JobContext exposes `.resolve(name)` — duck-type-compatible with the
  // shape CommandBus uses (`container.resolve(...)`). We cast to AwilixContainer because
  // CommandRuntimeContext requires that exact type; in practice CommandBus only touches
  // `.resolve`, mirroring the pattern in `inbox_ops/lib/messagesIntegration.ts:148`.
  const containerProxy = { resolve: ctx.resolve.bind(ctx) }
  const commandCtx = {
    container: containerProxy as never,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId ?? null,
    organizationIds: scope.organizationId ? [scope.organizationId] : null,
  }

  const input: IngestInboundMessageInput = {
    channelId,
    providerKey,
    channelType,
    scope,
    message: normalized,
  }

  const { result } = await commandBus.execute<IngestInboundMessageInput, IngestInboundMessageResult>(
    COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
    {
      input,
      ctx: commandCtx as never,
    },
  )

  if (result.status === 'duplicate') {
    // Idempotent skip — provider sent the same webhook twice (common with at-least-once
    // delivery semantics). Nothing to do; we already ingested this message earlier.
    return
  }
}
