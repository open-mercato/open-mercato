import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import { resolveContact } from '../lib/contact-resolver'
import type { ChannelAdapterRegistry } from '../lib/registry'
import type { NormalizedInboundMessage } from '../lib/adapter'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  ExternalMessage,
  MessageChannelLink,
} from '../data/entities'
import { normalizedInboundMessageSchema } from '../data/validators'
import { resolveCommunicationChannelsSystemUserId } from '../lib/system-user'

const ingestInputSchema = z.object({
  channelId: z.string().uuid(),
  providerKey: z.string().min(1),
  channelType: z.string().min(1),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
  message: normalizedInboundMessageSchema,
})

export type IngestInboundMessageInput = z.infer<typeof ingestInputSchema>

export type IngestInboundMessageResult = {
  status: 'created' | 'duplicate'
  messageId?: string
  externalConversationId?: string
  externalMessageId?: string
  channelLinkId?: string
  threadMappingId?: string
  contactPersonId?: string | null
}

export const COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID = 'communication_channels.ingest_inbound_message'

/**
 * Idempotently ingest a normalized inbound channel message.
 *
 * Steps (per SPEC-045d §6):
 *   1. Dedup by `(channel_id, external_message_id)` — if a MessageChannelLink already
 *      exists for that pair, return `{ status: 'duplicate' }` without side effects.
 *   2. Create or load `ExternalConversation` by `(channel_id, external_conversation_id)`.
 *   3. Create or load `ChannelThreadMapping` (1:1 with ExternalConversation).
 *   4. Resolve CRM contact via adapter + QueryEngine (best-effort).
 *   5. Compose the platform `Message` via `messages.messages.compose` (separate transaction).
 *   6. Create `ExternalMessage` + `MessageChannelLink`.
 *   7. Emit `communication_channels.message.received` (and `.conversation.created` / `.contact.resolved` when applicable).
 *
 * The two-transaction model (compose-message-then-record-link) is acceptable for v1;
 * the link's unique-on-message-id constraint is the safety net against orphans. See
 * the pre-implementation analysis for a discussion of single-transaction alternatives.
 */
const ingestInboundMessageCommand: CommandHandler<IngestInboundMessageInput, IngestInboundMessageResult> = {
  id: COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = ingestInputSchema.parse(rawInput) as IngestInboundMessageInput

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const adapterRegistry = ctx.container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

    // (1) Dedup: short-circuit if we've already processed this provider message.
    // The unique constraint is on `messageId`, not (channel, externalMessageId).
    // We must dedup by joining against ExternalMessage which IS uniquely indexed by
    // (channel_id, external_message_id). Hub-side dedup is the authoritative gate.
    const existingExternal = await findOneWithDecryption(
      em,
      ExternalMessage,
      {
        channelId: input.channelId,
        externalMessageId: input.message.externalMessageId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any,
      undefined,
      dscope,
    )
    if (existingExternal) {
      return {
        status: 'duplicate',
        externalConversationId: existingExternal.conversationId,
        externalMessageId: existingExternal.id,
      }
    }

    // Channel + adapter lookup (the channel must exist + be active).
    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: input.channelId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      } as any,
      undefined,
      dscope,
    )
    if (!channel) {
      throw new Error(
        `Channel ${input.channelId} not found for tenant ${input.scope.tenantId} (or has been deleted)`,
      )
    }
    if (!channel.isActive) {
      throw new Error(`Channel ${input.channelId} is inactive; refusing to ingest`)
    }

    const adapter = adapterRegistry.get(input.providerKey)
    if (!adapter) {
      throw new Error(
        `No ChannelAdapter registered for providerKey '${input.providerKey}'. ` +
          'Check that the provider package is enabled in modules.ts.',
      )
    }

    // (2) ExternalConversation upsert by (channel_id, externalConversationId).
    const m = input.message
    let conversation = await findOneWithDecryption(
      em,
      ExternalConversation,
      {
        channelId: input.channelId,
        externalConversationId: m.externalConversationId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any,
      undefined,
      dscope,
    )
    let conversationCreated = false
    if (!conversation) {
      conversation = em.create(ExternalConversation, {
        channelId: input.channelId,
        externalConversationId: m.externalConversationId,
        subject: m.subject ?? null,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        lastMessageAt: m.timestamp ?? new Date(),
      } as any)
      em.persist(conversation)
      conversationCreated = true
    } else if (m.timestamp && (!conversation.lastMessageAt || m.timestamp > conversation.lastMessageAt)) {
      conversation.lastMessageAt = m.timestamp
    }

    // (3) ChannelThreadMapping upsert (1:1 with ExternalConversation per tenant).
    let mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        externalConversationId: conversation.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any,
      undefined,
      dscope,
    )
    // We'll fill `messageThreadId` after composing the platform Message (since the
    // first inbound message becomes the thread root in the messages module).
    await em.flush()

    // (4) Contact resolution (best-effort, advisory).
    let contactHint: {
      matchedPersonId?: string | null
      email?: string
      displayName?: string
    } | null = null
    try {
      contactHint = await resolveContact(
        {
          adapter,
          senderIdentifier: m.senderIdentifier,
          senderDisplayName: m.senderDisplayName,
          channelMetadata: m.channelMetadata,
          credentials: {}, // credentials decrypted at the webhook route; resolver doesn't re-fetch
          scope: {
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId ?? input.scope.tenantId,
          },
        },
        { container: ctx.container },
      )
    } catch {
      contactHint = null
    }
    const matchedPersonId = contactHint?.matchedPersonId ?? null
    if (matchedPersonId && conversation.contactPersonId !== matchedPersonId) {
      conversation.contactPersonId = matchedPersonId
    }

    // (5) Compose the platform Message via the messages module command.
    const composeInput = {
      type: `channel.${input.providerKey}`,
      visibility: 'public' as const,
      sourceEntityType: 'communication_channels.external_conversation',
      sourceEntityId: conversation.id,
      externalEmail: contactHint?.email ?? undefined,
      externalName: contactHint?.displayName ?? m.senderDisplayName,
      recipients: mapping?.assignedUserId
        ? [{ userId: mapping.assignedUserId, type: 'to' as const }]
        : [],
      subject: m.subject ?? '',
      body: m.body ?? '',
      bodyFormat: (m.bodyFormat === 'html' ? 'text' : m.bodyFormat) as 'text' | 'markdown',
      priority: 'normal' as const,
      sendViaEmail: false,
      parentMessageId: mapping?.messageThreadId, // resolves to threadId server-side
      isDraft: false,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      userId: await resolveCommunicationChannelsSystemUserId(
        em,
        input.scope.tenantId,
        mapping?.assignedUserId ?? null,
      ),
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const composeResult = await commandBus.execute<typeof composeInput, { id: string; threadId: string | null }>(
      'messages.messages.compose',
      {
        input: composeInput,
        ctx: passthroughCommandCtx(ctx, input.scope),
      },
    )
    const message = composeResult.result
    if (!message?.id) {
      throw new Error('messages.messages.compose did not return a message id')
    }

    // (3 continued) Create or update ChannelThreadMapping now that we have a threadId.
    if (!mapping) {
      mapping = em.create(ChannelThreadMapping, {
        externalConversationId: conversation.id,
        messageThreadId: message.threadId ?? message.id,
        channelId: input.channelId,
        providerKey: input.providerKey,
        externalThreadRef: m.externalConversationId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      } as any)
      em.persist(mapping)
    }

    // (6) Create ExternalMessage + MessageChannelLink (hub-side records).
    const externalMessage = em.create(ExternalMessage, {
      channelId: input.channelId,
      conversationId: conversation.id,
      externalMessageId: m.externalMessageId,
      direction: 'inbound',
      senderIdentifier: m.senderIdentifier,
      senderDisplayName: m.senderDisplayName ?? null,
      providerTimestamp: m.timestamp,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    } as any)
    em.persist(externalMessage)

    const channelLink = em.create(MessageChannelLink, {
      messageId: message.id,
      externalConversationId: conversation.id,
      externalMessageId: externalMessage.id,
      providerKey: input.providerKey,
      channelType: input.channelType,
      direction: 'inbound',
      deliveryStatus: 'received',
      channelPayload: m.channelPayload,
      channelContentType: m.channelContentType,
      channelMetadata: m.channelMetadata,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    } as any)
    em.persist(channelLink)

    await em.flush()

    // (7) Emit events — order matters for downstream subscribers.
    if (conversationCreated) {
      await emitCommunicationChannelsEvent(
        'communication_channels.conversation.created',
        {
          conversationId: conversation.id,
          channelId: input.channelId,
          providerKey: input.providerKey,
          channelType: input.channelType,
          externalConversationId: m.externalConversationId,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )
    }
    if (matchedPersonId) {
      await emitCommunicationChannelsEvent(
        'communication_channels.contact.resolved',
        {
          conversationId: conversation.id,
          contactPersonId: matchedPersonId,
          providerKey: input.providerKey,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )
    }
    await emitCommunicationChannelsEvent(
      'communication_channels.message.received',
      {
        messageId: message.id,
        externalMessageId: externalMessage.id,
        channelLinkId: channelLink.id,
        conversationId: conversation.id,
        channelId: input.channelId,
        providerKey: input.providerKey,
        channelType: input.channelType,
        direction: 'inbound',
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      { persistent: true },
    )

    return {
      status: 'created',
      messageId: message.id,
      externalConversationId: conversation.id,
      externalMessageId: externalMessage.id,
      channelLinkId: channelLink.id,
      threadMappingId: mapping.id,
      contactPersonId: matchedPersonId,
    }
  },
}

/**
 * Build a runtime context for the nested `messages.messages.compose` call.
 *
 * The compose command expects a `CommandRuntimeContext`. For inbound webhook
 * processing there is no platform user; we pass `auth: null` and use the tenant
 * scope from our input.
 */
function passthroughCommandCtx(
  parent: CommandRuntimeContext,
  scope: IngestInboundMessageInput['scope'],
): CommandRuntimeContext {
  return {
    container: parent.container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId ?? null,
    organizationIds: scope.organizationId ? [scope.organizationId] : null,
  }
}

registerCommand(ingestInboundMessageCommand as unknown as CommandHandler)

export default ingestInboundMessageCommand
