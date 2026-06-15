import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import {
  CommunicationChannel,
  ExternalMessage,
  MessageChannelLink,
  MessageReaction,
} from '../data/entities'
import { inboundReactionEventSchema } from '../data/validators'
import {
  allowsMultipleReactionsPerUser,
  resolveInboundAddMutation,
} from '../lib/reaction-semantics'
import type { ChannelCapabilities } from '../lib/adapter'
import { isUniqueViolation } from '../lib/pg-errors'

const processInboundReactionInputSchema = z.object({
  channelId: z.string().uuid(),
  providerKey: z.string().min(1),
  channelType: z.string().min(1),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
  event: inboundReactionEventSchema,
})

export type ProcessInboundReactionInput = z.infer<typeof processInboundReactionInputSchema>

export type ProcessInboundReactionResult =
  | { status: 'no_message_link' }
  | {
      status: 'added'
      reactionId: string
      messageId: string
      emoji: string
      replaced: number
    }
  | {
      status: 'removed'
      messageId: string
      emoji: string
      deleted: number
    }
  | { status: 'noop' }

export const COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID =
  'communication_channels.reaction.process_inbound'

/**
 * Inbound reaction processor command.
 *
 * Per SPEC-045d §5.2:
 *   1. Look up `MessageChannelLink` by `(channelId, externalMessageId)` via the
 *      `ExternalMessage` row (which has the unique constraint on that pair).
 *   2. For `added`: apply per-provider semantics
 *      - `multiReactionPerUser=true` (Slack): insert; existing reactions from the
 *        same reactor are preserved.
 *      - `multiReactionPerUser=false` (WhatsApp): delete all existing reactions
 *        from the same reactor for the same message, then insert the new one.
 *   3. For `removed`: delete matching `MessageReaction` rows for
 *      `(messageId, emoji, reactedByExternalId)`. If `externalReactionId` is
 *      provided, prefer that as the lookup key.
 *   4. Emit `communication_channels.reaction.added` or `.removed`.
 *
 * The command is idempotent: re-running it for the same `externalReactionId` will
 * be a no-op for `added` (unique constraint blocks duplicates) and harmless for
 * `removed` (delete-where-not-found returns 0).
 */
const processInboundReactionCommand: CommandHandler<
  ProcessInboundReactionInput,
  ProcessInboundReactionResult
> = {
  id: COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = processInboundReactionInputSchema.parse(rawInput) as ProcessInboundReactionInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

    // (1) Find the platform Message via ExternalMessage → MessageChannelLink.
    const externalMessage = await findOneWithDecryption(
      em,
      ExternalMessage,
      {
        channelId: input.channelId,
        externalMessageId: input.event.externalMessageId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!externalMessage) {
      // The reaction targets a message we never ingested (e.g., reaction to a
      // history-only message we skipped). Skip silently.
      return { status: 'no_message_link' }
    }

    const channelLink = await findOneWithDecryption(
      em,
      MessageChannelLink,
      {
        externalMessageId: externalMessage.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!channelLink) {
      return { status: 'no_message_link' }
    }

    const messageId = channelLink.messageId

    // (2) Resolve channel capabilities for semantics decision.
    const channel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: input.channelId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    const capabilities = (channel?.capabilities as ChannelCapabilities | null) ?? null

    if (input.event.action === 'added') {
      const mutation = resolveInboundAddMutation(capabilities)
      let replaced = 0

      if (mutation === 'replace') {
        // WhatsApp-style: delete prior reactions from the same reactor.
        const existing = await findWithDecryption(
          em,
          MessageReaction,
          {
            messageId,
            reactedByExternalId: input.event.userIdentifier,
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId ?? null,
          },
          undefined,
          dscope,
        )
        replaced = existing.length
        for (const row of existing) em.remove(row)
        await em.flush()
      }

      // Insert the new reaction. On a partial actor unique-index conflict,
      // treat as no-op — provider sent the same reaction twice.
      let reaction: MessageReaction
      try {
        reaction = em.create(MessageReaction, {
          messageId,
          emoji: input.event.emoji,
          reactedByUserId: null,
          reactedByExternalId: input.event.userIdentifier,
          reactedByDisplayName: input.event.userDisplayName ?? null,
          providerKey: input.providerKey,
          externalReactionId: input.event.externalReactionId ?? null,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        })
        em.persist(reaction)
        await em.flush()
      } catch (err) {
        // Unique constraint violation → idempotent skip.
        if (isUniqueViolation(err)) {
          return { status: 'noop' }
        }
        throw err
      }

      await emitCommunicationChannelsEvent(
        'communication_channels.reaction.added',
        {
          reactionId: reaction.id,
          messageId,
          channelLinkId: channelLink.id,
          channelId: input.channelId,
          providerKey: input.providerKey,
          channelType: input.channelType,
          emoji: input.event.emoji,
          reactedByExternalId: input.event.userIdentifier,
          reactedByDisplayName: input.event.userDisplayName ?? null,
          allowsMultiplePerUser: allowsMultipleReactionsPerUser(capabilities),
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )

      return {
        status: 'added',
        reactionId: reaction.id,
        messageId,
        emoji: input.event.emoji,
        replaced,
      }
    }

    // input.event.action === 'removed'
    const filter: Record<string, unknown> = {
      messageId,
      reactedByExternalId: input.event.userIdentifier,
      emoji: input.event.emoji,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }
    if (input.event.externalReactionId) {
      filter.externalReactionId = input.event.externalReactionId
    }
    const toDelete = await findWithDecryption(
      em,
      MessageReaction,
      filter,
      undefined,
      dscope,
    )
    for (const row of toDelete) em.remove(row)
    await em.flush()

    if (toDelete.length > 0) {
      await emitCommunicationChannelsEvent(
        'communication_channels.reaction.removed',
        {
          messageId,
          channelLinkId: channelLink.id,
          channelId: input.channelId,
          providerKey: input.providerKey,
          channelType: input.channelType,
          emoji: input.event.emoji,
          reactedByExternalId: input.event.userIdentifier,
          deletedCount: toDelete.length,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )
    }

    return {
      status: 'removed',
      messageId,
      emoji: input.event.emoji,
      deleted: toDelete.length,
    }
  },
}

registerCommand(processInboundReactionCommand)

export default processInboundReactionCommand
