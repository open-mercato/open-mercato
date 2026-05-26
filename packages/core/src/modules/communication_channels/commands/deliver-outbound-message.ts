import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import { refreshCredentialsIfNeeded } from '../lib/credential-refresh'
import { classifyOutboundError } from '../lib/error-classification'
import type { ChannelAdapterRegistry } from '../lib/registry'
import { Message } from '../../messages/data/entities'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalMessage,
  MessageChannelLink,
} from '../data/entities'

/**
 * Sentinel — `Message.threadId` of an internal-only (no channel link) message
 * has no matching `ChannelThreadMapping`. In that case outbound delivery is a no-op.
 */
const NO_THREAD_MAPPING_RESULT = { status: 'no_channel_link' as const }

const deliverInputSchema = z.object({
  messageId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
  /**
   * If true, force a credential refresh before sending — used by retry attempts
   * after a 401 from the provider.
   */
  forceCredentialRefresh: z.boolean().optional(),
})

export type DeliverOutboundMessageInput = z.infer<typeof deliverInputSchema>

export type DeliverOutboundMessageResult =
  | { status: 'no_channel_link' }
  | { status: 'already_delivered'; messageId: string; channelLinkId: string }
  | {
      status: 'delivered'
      messageId: string
      channelLinkId: string
      externalMessageId: string
      providerKey: string
    }
  | {
      status: 'failed'
      messageId: string
      channelLinkId: string
      providerKey: string
      error: string
      transient: boolean
    }

export const COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID =
  'communication_channels.deliver_outbound_message'

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

type IntegrationLogLike = {
  log?: (entry: Record<string, unknown>) => Promise<void> | void
  warn?: (entry: Record<string, unknown>) => Promise<void> | void
  error?: (entry: Record<string, unknown>) => Promise<void> | void
}

/**
 * Outbound delivery command. Called from the outbound worker.
 *
 * Steps (SPEC-045d §7):
 *   1. Re-fetch the Message by ID. Bail if internal-only (no ChannelThreadMapping).
 *   2. Resolve channel + adapter + credentials.
 *   3. Idempotently upsert a 'pending' MessageChannelLink (unique on `messageId`).
 *      Skip if a 'sent'/'delivered' link already exists.
 *   4. Refresh credentials when OAuth + near expiry (or when caller forces it).
 *   5. Call `adapter.convertOutbound(...)` → channel-native content.
 *   6. Call `adapter.sendMessage(...)`.
 *   7. On success: persist ExternalMessage + flip link to 'sent', emit `.message.sent`.
 *   8. On failure: flip link to 'failed' + classify error, log to integrationLog,
 *      emit `.delivery_failed`. The worker decides whether to retry based on
 *      `result.transient`.
 *
 * Idempotency: the unique constraint on `message_channel_links.message_id`
 * prevents the same Message being sent twice through the channel even if the
 * subscriber fires repeatedly. Combined with the link's lifecycle state
 * (pending → sent | failed), we get safe retries.
 */
const deliverOutboundMessageCommand: CommandHandler<
  DeliverOutboundMessageInput,
  DeliverOutboundMessageResult
> = {
  id: COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = deliverInputSchema.parse(rawInput) as DeliverOutboundMessageInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

    // (1) Re-fetch Message by ID — never trust the event payload shape.
    const message = await findOneWithDecryption(
      em,
      Message,
      {
        id: input.messageId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      } as any,
      undefined,
      dscope,
    )
    if (!message) {
      // Message was deleted before we got to deliver. Treat as no-op.
      return NO_THREAD_MAPPING_RESULT
    }
    if (!message.threadId) {
      // Message has no thread → no channel routing.
      return NO_THREAD_MAPPING_RESULT
    }

    // (1 cont.) Look up the channel link via ChannelThreadMapping.threadId.
    const mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        messageThreadId: message.threadId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any,
      undefined,
      dscope,
    )
    if (!mapping) {
      // Internal-only message — no channel delivery needed.
      return NO_THREAD_MAPPING_RESULT
    }

    // (2) Channel + adapter.
    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: mapping.channelId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      } as any,
      undefined,
      dscope,
    )
    if (!channel) {
      throw new Error(
        `Channel ${mapping.channelId} not found for tenant ${input.scope.tenantId} (or has been deleted)`,
      )
    }
    if (!channel.isActive) {
      throw new Error(`Channel ${mapping.channelId} is inactive; refusing to deliver outbound`)
    }

    const adapterRegistry = ctx.container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
    const adapter = adapterRegistry.get(channel.providerKey)
    if (!adapter) {
      throw new Error(
        `No ChannelAdapter registered for providerKey '${channel.providerKey}'. ` +
          'Check that the provider package is enabled in modules.ts.',
      )
    }

    // (3) Idempotently upsert a 'pending' MessageChannelLink.
    let link = await findOneWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: message.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any,
      undefined,
      dscope,
    )
    if (link && (link.deliveryStatus === 'sent' || link.deliveryStatus === 'delivered' || link.deliveryStatus === 'read')) {
      // Already sent — short-circuit.
      return {
        status: 'already_delivered',
        messageId: message.id,
        channelLinkId: link.id,
      }
    }
    if (!link) {
      link = em.create(MessageChannelLink, {
        messageId: message.id,
        externalConversationId: mapping.externalConversationId,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        direction: 'outbound',
        deliveryStatus: 'pending',
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any)
      em.persist(link)
      await em.flush()
    }

    // (2 cont.) Decrypted credentials via the integrations module (if available).
    let credentialsService: CredentialsServiceLike | null = null
    try {
      credentialsService = ctx.container.resolve(
        'integrationCredentialsService',
      ) as CredentialsServiceLike
    } catch {
      credentialsService = null
    }
    // Per-user credentials scope: pass `channel.userId` so the credentials
    // service returns this user's row, not whoever connected last. See
    // review R2-C1 / N1 (2026-05-26).
    const credentialsScope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? input.scope.tenantId,
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

    // (4) Credential refresh if OAuth + near expiry, or forced by retry.
    let integrationLog: IntegrationLogLike | null = null
    try {
      integrationLog = ctx.container.resolve('integrationLogService') as IntegrationLogLike
    } catch {
      integrationLog = null
    }
    const refreshResult = await refreshCredentialsIfNeeded(
      {
        adapter,
        channelId: channel.id,
        credentials,
        scope: credentialsScope,
        force: Boolean(input.forceCredentialRefresh),
      },
      {
        credentialsService,
        logger: (...args) => console.warn(...args),
      },
    )
    credentials = refreshResult.credentials

    // (5) + (6) Convert + send.
    try {
      const outboundPayload = (link.channelPayload as Record<string, unknown> | null) ?? {}
      const outboundHtml = typeof outboundPayload.html === 'string' ? outboundPayload.html : null
      const outboundText = typeof outboundPayload.text === 'string' ? outboundPayload.text : null
      const outboundBody = outboundHtml ?? outboundText ?? message.body ?? ''
      const outboundBodyFormat = outboundHtml
        ? 'html'
        : ((message.bodyFormat as 'text' | 'markdown' | 'html') ?? 'text')
      const converted = await adapter.convertOutbound({
        body: outboundBody,
        bodyFormat: outboundBodyFormat,
        channelMetadata: {
          thread_id: mapping.externalThreadRef,
          ...((link.channelMetadata as Record<string, unknown> | undefined) ?? {}),
        },
      })

      const sendResult = await adapter.sendMessage({
        conversationId: mapping.externalThreadRef,
        content: converted.content,
        credentials,
        scope: {
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? input.scope.tenantId,
        },
        metadata: converted.metadata,
      })

      if (sendResult.status === 'failed') {
        throw new Error(sendResult.error ?? `Adapter '${adapter.providerKey}' reported send failure`)
      }

      // (7) Persist success records.
      const externalMessage = em.create(ExternalMessage, {
        channelId: channel.id,
        conversationId: mapping.externalConversationId,
        externalMessageId: sendResult.externalMessageId,
        direction: 'outbound',
        senderIdentifier: null,
        senderDisplayName: null,
        providerTimestamp: new Date(),
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any)
      em.persist(externalMessage)

      link.deliveryStatus = sendResult.status === 'sent' ? 'sent' : 'queued'
      link.externalMessageId = externalMessage.id
      link.channelMetadata = {
        ...((link.channelMetadata as Record<string, unknown> | undefined) ?? {}),
        ...(converted.metadata ?? {}),
        externalMessageId: sendResult.externalMessageId,
      }
      await em.flush()

      await emitCommunicationChannelsEvent(
        'communication_channels.message.sent',
        {
          messageId: message.id,
          externalMessageId: externalMessage.id,
          channelLinkId: link.id,
          conversationId: mapping.externalConversationId,
          channelId: channel.id,
          providerKey: channel.providerKey,
          channelType: channel.channelType,
          direction: 'outbound',
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )

      return {
        status: 'delivered',
        messageId: message.id,
        channelLinkId: link.id,
        externalMessageId: externalMessage.id,
        providerKey: channel.providerKey,
      }
    } catch (sendErr) {
      // (8) Failure path — classify, persist, emit, return.
      const classification = classifyOutboundError(sendErr)
      link.deliveryStatus = 'failed'
      link.channelMetadata = {
        ...((link.channelMetadata as Record<string, unknown> | undefined) ?? {}),
        lastError: classification.message,
        lastErrorAt: new Date().toISOString(),
        transient: classification.transient,
      }
      await em.flush()

      try {
        await integrationLog?.error?.({
          integrationId: `channel_${channel.providerKey}`,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
          channelId: channel.id,
          messageId: message.id,
          status: classification.status ?? null,
          transient: classification.transient,
          message: classification.message,
        })
      } catch {
        // best-effort logging
      }

      await emitCommunicationChannelsEvent(
        'communication_channels.message.delivery_failed',
        {
          messageId: message.id,
          channelLinkId: link.id,
          conversationId: mapping.externalConversationId,
          channelId: channel.id,
          providerKey: channel.providerKey,
          channelType: channel.channelType,
          transient: classification.transient,
          error: classification.message,
          status: classification.status ?? null,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )

      return {
        status: 'failed',
        messageId: message.id,
        channelLinkId: link.id,
        providerKey: channel.providerKey,
        error: classification.message,
        transient: classification.transient,
      }
    }
  },
}

registerCommand(deliverOutboundMessageCommand as unknown as CommandHandler)

export default deliverOutboundMessageCommand
