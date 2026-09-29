import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
} from '@open-mercato/core/modules/communication_channels/data/entities'
import type { Message } from '@open-mercato/core/modules/messages/data/entities'
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from './ai-proposal-contract'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../message-types'

const logger = createLogger('channel_discord').child({ component: 'ai-proposal' })

export type DiscordProposalScope = { tenantId: string; organizationId: string | null }

export type FileDiscordProposalResult = {
  proposalMessageId: string
  /** `'assigned'` went to a human with approve/dismiss actions; `'stored'` is a draft nobody was notified about. */
  outcome: 'assigned' | 'stored'
  reviewerUserId: string | null
}

const MAX_SUBJECT_LENGTH = 200
const MAX_SUMMARY_LENGTH = 500

/**
 * Find the human who should review a proposal for this conversation.
 *
 * Order mirrors what the hub itself does when it decides who an INBOUND channel
 * message is addressed to (`ingest-inbound-message.ts` uses the thread mapping's
 * assignee), then widens to the two other owners a Discord channel can have. It
 * deliberately does not fan out to "everyone with the feature": a proposal is a
 * task for the person who owns the conversation, not a broadcast.
 */
export async function resolveDiscordProposalReviewer(params: {
  em: EntityManager
  scope: DiscordProposalScope
  channelId: string
  messageThreadId: string | null
  externalConversationId: string | null
}): Promise<string | null> {
  const { em, scope, channelId, messageThreadId, externalConversationId } = params

  if (messageThreadId) {
    const mapping = await em.findOne(ChannelThreadMapping, {
      messageThreadId,
      tenantId: scope.tenantId,
    })
    if (mapping?.assignedUserId) return mapping.assignedUserId
  }

  if (externalConversationId) {
    const conversation = await em.findOne(ExternalConversation, {
      id: externalConversationId,
      tenantId: scope.tenantId,
    })
    if (conversation?.assignedUserId) return conversation.assignedUserId
  }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id: channelId, tenantId: scope.tenantId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId ?? scope.tenantId },
  )
  return channel?.userId ?? null
}

/**
 * File the `complex`-tier proposal (SPEC 2026-06-19 § AI bot wiring step 5,
 * issue #4778). This is what replaced "log a line and return".
 *
 * Two shapes, one helper:
 *
 * - A reviewer resolves → an INTERNAL message addressed to them, carrying the
 *   drafted reply as its body and the approve/dismiss actions declared by
 *   `message-types.ts`. Approving dispatches
 *   `channel_discord.ai_reply_proposal.approve`, which composes the public reply
 *   through the same hub path the easy tier uses.
 * - No reviewer resolves (an unassigned tenant-scoped channel — the same case
 *   where the hub files the inbound message with no recipient either) → the
 *   proposal is stored as a DRAFT so the text is not lost, and the fact that
 *   nobody was notified is logged. Assigning the conversation is the operator
 *   action that turns future proposals into approval cards.
 *
 * Neither shape can reach Discord on its own: a draft emits no
 * `messages.message.sent`, and the internal message is `visibility: 'internal'`,
 * which the hub's outbound bridge does not deliver. Only the approve command
 * sends, and only a human can call it.
 */
export async function fileDiscordReplyProposal(params: {
  em: EntityManager
  commandBus: CommandBus
  containerCtx: unknown
  scope: DiscordProposalScope
  channelId: string
  inboundMessage: Pick<Message, 'id' | 'type' | 'subject' | 'threadId'>
  externalConversationId: string | null
  botUserId: string
  proposedReply: string
  summary: string
  reason: string
}): Promise<FileDiscordProposalResult> {
  const {
    em,
    commandBus,
    containerCtx,
    scope,
    channelId,
    inboundMessage,
    externalConversationId,
    botUserId,
    proposedReply,
    summary,
    reason,
  } = params

  const reviewerUserId = await resolveDiscordProposalReviewer({
    em,
    scope,
    channelId,
    messageThreadId: inboundMessage.threadId ?? inboundMessage.id,
    externalConversationId,
  })

  const subject = summary.trim().slice(0, MAX_SUBJECT_LENGTH) || 'Proposed Discord reply'

  const composeInput = {
    type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
    visibility: 'internal' as const,
    sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
    sourceEntityId: inboundMessage.id,
    recipients: reviewerUserId ? [{ userId: reviewerUserId, type: 'to' as const }] : [],
    subject,
    body: proposedReply,
    bodyFormat: 'markdown' as const,
    priority: 'normal' as const,
    sendViaEmail: false,
    // A draft when there is nobody to address it to — the compose validator only
    // requires a recipient for a message that is actually being delivered.
    isDraft: !reviewerUserId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: botUserId,
  }

  const composeResult = await commandBus.execute<typeof composeInput, { id: string }>(
    'messages.messages.compose',
    {
      input: composeInput,
      ctx: containerCtx as never,
    },
  )

  const outcome: FileDiscordProposalResult['outcome'] = reviewerUserId ? 'assigned' : 'stored'
  if (outcome === 'stored') {
    logger.info(
      'Filed a Discord AI reply proposal with no reviewer — assign the conversation to get approval cards',
      { channelId, reason, proposalMessageId: composeResult.result.id },
    )
  } else {
    logger.info('Filed a Discord AI reply proposal for review', {
      channelId,
      reason,
      proposalMessageId: composeResult.result.id,
    })
  }

  return {
    proposalMessageId: composeResult.result.id,
    outcome,
    reviewerUserId,
  }
}

export { MAX_SUMMARY_LENGTH }
