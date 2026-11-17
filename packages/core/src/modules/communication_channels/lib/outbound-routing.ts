import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Message } from '../../messages/data/entities'
import {
  EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
  SEND_AS_USER_SOURCE_ENTITY_TYPE,
} from '../../messages/lib/messageSourceEntityTypes'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../data/entities'

const logger = createLogger('communication_channels').child({ component: 'outbound-routing' })

type RoutingInput = {
  message: Pick<Message, 'id' | 'threadId' | 'parentMessageId' | 'sourceEntityType' | 'sourceEntityId'>
  link: MessageChannelLink | null
  scope: { tenantId: string; organizationId: string | null }
}

export async function resolveOutboundRouting(
  em: EntityManager,
  { message, link, scope }: RoutingInput,
): Promise<{ mapping: ChannelThreadMapping; channel: CommunicationChannel } | null> {
  const refuse = (reason: string) => {
    logger.warn('outbound routing refused', { messageId: message.id, reason, ...scope })
    return null
  }
  if (!message.threadId) return null
  let conversationId = link?.externalConversationId
  let sourceChannelId: string | null | undefined
  let provenanceLink = link
  if (link) {
    if (link.direction !== 'outbound' || !conversationId) return refuse('invalid_outbound_link')
  } else {
    if (message.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) {
      if (!message.sourceEntityId) return refuse('missing_source_conversation')
      conversationId = message.sourceEntityId
    }
    if (message.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE) {
      if (!message.sourceEntityId) return refuse('missing_source_channel')
      sourceChannelId = message.sourceEntityId
    }
    if (message.parentMessageId) {
      const parent = await findOneWithDecryption(
        em, Message, { id: message.parentMessageId, threadId: message.threadId, deletedAt: null, ...scope },
        undefined, scope,
      )
      if (!parent) return refuse('parent_not_in_thread_scope')
      const parentLink = await findOneWithDecryption(
        em, MessageChannelLink, { messageId: parent.id, ...scope }, undefined, scope,
      )
      if (!parentLink && parent.sourceEntityType === SEND_AS_USER_SOURCE_ENTITY_TYPE) {
        if (!parent.sourceEntityId) return refuse('missing_parent_channel')
        if (sourceChannelId && sourceChannelId !== parent.sourceEntityId) return refuse('conflicting_channel_provenance')
        sourceChannelId = parent.sourceEntityId
      }
      const parentConversationId = parentLink?.externalConversationId
        ?? (parent.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE ? parent.sourceEntityId : null)
      if (parentConversationId) {
        if (conversationId && conversationId !== parentConversationId) return refuse('conflicting_conversation_provenance')
        conversationId = parentConversationId
        provenanceLink = parentLink
      } else if (parentLink || parent.sourceEntityType === EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) {
        return refuse('missing_parent_conversation')
      }
    }
  }
  let mapping: ChannelThreadMapping | null
  if (conversationId) {
    mapping = await findOneWithDecryption(
      em, ChannelThreadMapping,
      { externalConversationId: conversationId, messageThreadId: message.threadId, ...scope }, undefined, scope,
    )
    if (!mapping) return refuse('conversation_not_mapped_to_thread')
  } else {
    const mappings = await findWithDecryption(
      em, ChannelThreadMapping, { messageThreadId: message.threadId, ...scope }, { limit: 2 }, scope,
    )
    if (mappings.length === 0) return null
    if (mappings.length !== 1) return refuse('ambiguous_thread_mappings')
    mapping = mappings[0]
  }
  if (sourceChannelId && mapping.channelId !== sourceChannelId) return refuse('conflicting_channel_provenance')
  const conversation = await findOneWithDecryption(
    em, ExternalConversation, { id: mapping.externalConversationId, channelId: mapping.channelId, ...scope },
    undefined, scope,
  )
  if (!conversation) return refuse('conversation_channel_mismatch')
  if (!mapping.externalThreadRef || conversation.externalConversationId !== mapping.externalThreadRef) {
    return refuse('conversation_thread_ref_mismatch')
  }
  const channel = await findOneWithDecryption(
    em, CommunicationChannel, { id: mapping.channelId, deletedAt: null, ...scope }, undefined, scope,
  )
  if (!channel || channel.providerKey !== mapping.providerKey) return refuse('mapping_channel_mismatch')
  if (provenanceLink && (
    provenanceLink.providerKey !== channel.providerKey || provenanceLink.channelType !== channel.channelType
  )) return refuse('link_channel_mismatch')
  return { mapping, channel }
}
