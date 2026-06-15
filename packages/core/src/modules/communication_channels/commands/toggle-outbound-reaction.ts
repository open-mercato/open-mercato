import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import { Message } from '../../messages/data/entities'
import {
  CommunicationChannel,
  ChannelThreadMapping,
  MessageChannelLink,
  MessageReaction,
} from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import type { ReactionProcessorPayload } from '../lib/reaction-processor-types'
import {
  allowsMultipleReactionsPerUser,
} from '../lib/reaction-semantics'
import type { ChannelCapabilities } from '../lib/adapter'
import { isUniqueViolation } from '../lib/pg-errors'

const toggleOutboundReactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(64),
  action: z.enum(['add', 'remove']),
  /** Reaction id (required for remove only). */
  reactionId: z.string().uuid().optional(),
  reactedByUserId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type ToggleOutboundReactionInput = z.infer<typeof toggleOutboundReactionSchema>

export type ToggleOutboundReactionResult =
  | { status: 'no_channel_link'; reason: string }
  | { status: 'not_owner'; reason: string }
  | {
      status: 'added'
      reactionId: string
      messageId: string
      emoji: string
      enqueued: boolean
      replaced: number
    }
  | {
      status: 'removed'
      messageId: string
      emoji: string
      enqueued: boolean
      deleted: number
    }
  | { status: 'noop'; reason: string }

export const COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID =
  'communication_channels.reaction.toggle_outbound'

/**
 * Combined outbound add/remove command.
 *
 * For UX responsiveness, the local mutation (insert/delete `MessageReaction`)
 * happens synchronously and is what the API handler returns. The provider-side
 * effect (calling `adapter.sendReaction?` / `removeReaction?`) is enqueued to
 * the reactions queue and processed asynchronously by the reaction worker.
 *
 * For `add`:
 *   - Validates the message is channel-linked (otherwise returns `no_channel_link`).
 *   - Applies single-vs-multi semantics:
 *     - WhatsApp-style (multiReactionPerUser=false): deletes prior reactions
 *       from the same internal user on the same message, then inserts the new one.
 *     - Slack-style (multiReactionPerUser=true): inserts; duplicates blocked
 *       by the unique constraint.
 *   - Enqueues an `outbound_send` job carrying the new reaction id.
 *   - Emits `communication_channels.reaction.added` synchronously (optimistic).
 *
 * For `remove`:
 *   - Looks up the `MessageReaction` row (validates ownership: reactedByUserId
 *     must match).
 *   - Deletes the row locally.
 *   - Enqueues an `outbound_remove` job carrying the emoji + (if known) the
 *     external reaction id.
 *   - Emits `communication_channels.reaction.removed`.
 */
const toggleOutboundReactionCommand: CommandHandler<
  ToggleOutboundReactionInput,
  ToggleOutboundReactionResult
> = {
  id: COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = toggleOutboundReactionSchema.parse(rawInput) as ToggleOutboundReactionInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dscope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    }

    // (a) Resolve the platform Message + channel link.
    const message = await findOneWithDecryption(
      em,
      Message,
      {
        id: input.messageId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    if (!message) {
      return { status: 'no_channel_link', reason: 'message not found' }
    }
    const channelLink = await findOneWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: message.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!channelLink) {
      return { status: 'no_channel_link', reason: 'message is not channel-linked' }
    }
    // Resolve the channel deterministically from the thread→channel mapping.
    // We MUST NOT fall back to an arbitrary channel matching only
    // (tenant, org, providerKey): for a tenant with several same-provider
    // mailboxes owned by different users that would react from the wrong
    // user's account.
    const mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        messageThreadId: message.threadId ?? message.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!mapping) {
      return { status: 'no_channel_link', reason: 'no thread mapping for channel resolution' }
    }
    const resolvedChannel = await findOneWithDecryption(
      em,
      CommunicationChannel,
      {
        id: mapping.channelId,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
        deletedAt: null,
      },
      undefined,
      dscope,
    )
    if (!resolvedChannel) {
      return { status: 'no_channel_link', reason: 'channel not resolved' }
    }
    // Per-user ownership gate. The reaction is delivered to the provider using
    // the RESOLVED CHANNEL OWNER's credentials (workers/reaction-processor.ts),
    // so a non-owner reacting would post a reaction FROM someone else's connected
    // account (impersonation). Only the channel owner may react from a per-user
    // channel; tenant-wide channels (userId == null — shared WhatsApp/Slack) stay
    // reactable by any authorized caller. Mirrors set-primary-channel's not_owner
    // guard. Applies to both add and remove.
    if (resolvedChannel.userId != null && resolvedChannel.userId !== input.reactedByUserId) {
      return { status: 'not_owner', reason: 'channel is owned by another user' }
    }
    const capabilities = (resolvedChannel.capabilities as ChannelCapabilities | null) ?? null

    if (input.action === 'add') {
      let replaced = 0
      if (!allowsMultipleReactionsPerUser(capabilities)) {
        const prior = await findWithDecryption(
          em,
          MessageReaction,
          {
            messageId: message.id,
            reactedByUserId: input.reactedByUserId,
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId ?? null,
          },
          undefined,
          dscope,
        )
        replaced = prior.length
        for (const row of prior) em.remove(row)
        if (replaced > 0) await em.flush()
      }

      let reaction: MessageReaction
      try {
        reaction = em.create(MessageReaction, {
          messageId: message.id,
          emoji: input.emoji,
          reactedByUserId: input.reactedByUserId,
          reactedByExternalId: null,
          providerKey: channelLink.providerKey,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        })
        em.persist(reaction)
        await em.flush()
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { status: 'noop', reason: 'duplicate reaction from same user with same emoji' }
        }
        throw err
      }

      // Enqueue outbound job.
      let enqueued = false
      if (typeof resolvedChannel.id === 'string') {
        const job: ReactionProcessorPayload = {
          kind: 'outbound_send',
          providerKey: channelLink.providerKey,
          channelId: resolvedChannel.id,
          messageId: message.id,
          reactionId: reaction.id,
          emoji: input.emoji,
          conversationId:
            (channelLink.channelMetadata as Record<string, unknown> | null)?.['thread_id'] as
              | string
              | undefined,
          scope: {
            tenantId: input.scope.tenantId,
            organizationId: input.scope.organizationId,
          },
          attempt: 1,
        }
        const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.reactions)
        await queue.enqueue(job as unknown as Record<string, unknown>)
        enqueued = true
      }

      await emitCommunicationChannelsEvent(
        'communication_channels.reaction.added',
        {
          reactionId: reaction.id,
          messageId: message.id,
          channelLinkId: channelLink.id,
          channelId: resolvedChannel.id,
          providerKey: channelLink.providerKey,
          channelType: channelLink.channelType,
          emoji: input.emoji,
          reactedByUserId: input.reactedByUserId,
          allowsMultiplePerUser: allowsMultipleReactionsPerUser(capabilities),
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
        },
        { persistent: true },
      )

      return {
        status: 'added',
        reactionId: reaction.id,
        messageId: message.id,
        emoji: input.emoji,
        enqueued,
        replaced,
      }
    }

    // input.action === 'remove'
    if (!input.reactionId) {
      return { status: 'noop', reason: 'reactionId required for remove' }
    }
    const reaction = await findOneWithDecryption(
      em,
      MessageReaction,
      {
        id: input.reactionId,
        messageId: message.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    if (!reaction) {
      return { status: 'noop', reason: 'reaction not found' }
    }
    if (reaction.reactedByUserId !== input.reactedByUserId) {
      return { status: 'noop', reason: 'reaction not owned by current user' }
    }
    const externalReactionId = reaction.externalReactionId ?? null
    em.remove(reaction)
    await em.flush()

    let enqueued = false
    if (typeof resolvedChannel.id === 'string') {
      const job: ReactionProcessorPayload = {
        kind: 'outbound_remove',
        providerKey: channelLink.providerKey,
        channelId: resolvedChannel.id,
        messageId: message.id,
        emoji: input.emoji,
        externalReactionId,
        conversationId:
          (channelLink.channelMetadata as Record<string, unknown> | null)?.['thread_id'] as
            | string
            | undefined,
        scope: {
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
        },
        attempt: 1,
      }
      const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.reactions)
      await queue.enqueue(job as unknown as Record<string, unknown>)
      enqueued = true
    }

    await emitCommunicationChannelsEvent(
      'communication_channels.reaction.removed',
      {
        messageId: message.id,
        channelLinkId: channelLink.id,
        channelId: resolvedChannel.id,
        providerKey: channelLink.providerKey,
        channelType: channelLink.channelType,
        emoji: input.emoji,
        reactedByUserId: input.reactedByUserId,
        deletedCount: 1,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      { persistent: true },
    )

    return {
      status: 'removed',
      messageId: message.id,
      emoji: input.emoji,
      enqueued,
      deleted: 1,
    }
  },
}

registerCommand(toggleOutboundReactionCommand)

export default toggleOutboundReactionCommand
