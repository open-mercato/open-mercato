import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  AiChatConversation,
  AiChatMessage,
} from '../data/entities'
import {
  AiChatConversationAccessError,
  AiChatConversationDuplicateParticipantError,
  AiChatConversationOrgNotFoundError,
  AiChatParticipantNotFoundError,
  AiChatConversationRepository,
  type AiChatConversationContext,
} from '../data/repositories/AiChatConversationRepository'

/**
 * Thin service-layer wrapper that resolves the entity manager from the
 * Awilix container and exposes a typed API on top of
 * `AiChatConversationRepository`. The REST routes for the conversation APIs
 * call into this surface; the future chat dispatcher write path will reuse
 * the same helpers so persistence stays consistent across entry points.
 *
 * Spec: `2026-05-05-ai-chat-server-side-conversation-storage` §"Commands".
 *
 * Re-exports the access error so route handlers can map it to a 404 without
 * importing the repository directly.
 */
export {
  AiChatConversationAccessError,
  AiChatConversationDuplicateParticipantError,
  AiChatConversationOrgNotFoundError,
  AiChatParticipantNotFoundError,
}
export type { AiChatConversationContext }

export function createConversationStorage(
  container: AwilixContainer,
): AiChatConversationRepository {
  const em = container.resolve<EntityManager>('em')
  return new AiChatConversationRepository(em)
}

export interface SerializedAiChatConversation {
  conversationId: string
  agentId: string
  title: string | null
  status: 'open' | 'closed'
  visibility: 'private' | 'shared' | 'organization'
  pageContext: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
  importedFromLocalAt: string | null
  participantCount: number
  isOwner: boolean | null
}

export interface AiChatConversationSerializeEnrich {
  callerUserId?: string | null
  participantCount?: number
}

export interface SerializedAiChatMessage {
  id: string
  clientMessageId: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  uiParts: unknown[]
  attachmentIds: string[]
  files: Array<Record<string, unknown>>
  model: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  senderUserId: string | null
}

export function serializeAiChatConversation(
  row: AiChatConversation,
  enrich: AiChatConversationSerializeEnrich = {},
): SerializedAiChatConversation {
  return {
    conversationId: row.conversationId,
    agentId: row.agentId,
    title: row.title ?? null,
    status: row.status,
    visibility: row.visibility,
    pageContext: row.pageContext ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    importedFromLocalAt: row.importedFromLocalAt
      ? row.importedFromLocalAt.toISOString()
      : null,
    participantCount: enrich.participantCount ?? 0,
    isOwner:
      enrich.callerUserId != null ? row.ownerUserId === enrich.callerUserId : null,
  }
}

export function serializeAiChatMessage(row: AiChatMessage): SerializedAiChatMessage {
  return {
    id: row.id,
    clientMessageId: row.clientMessageId ?? null,
    role: row.role,
    content: row.content,
    uiParts: Array.isArray(row.uiParts) ? row.uiParts : [],
    attachmentIds: Array.isArray(row.attachmentIds) ? row.attachmentIds : [],
    files: Array.isArray(row.filesMetadata) ? row.filesMetadata : [],
    model: row.model ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
    senderUserId: row.createdByUserId ?? null,
  }
}
