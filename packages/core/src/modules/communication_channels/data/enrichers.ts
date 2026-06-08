import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
  MessageReaction,
} from './entities'

/**
 * Resolve channels by `id` (not `providerKey`) — multi-user channels share the
 * same `providerKey` (e.g. two users with Gmail), so a providerKey-keyed Map
 * collapses them and returns the wrong owner's capabilities snapshot. The hop
 * goes `MessageChannelLink → ExternalConversation → CommunicationChannel`.
 *
 * Returns a Map keyed by the platform Message id so enrichers can read
 * `channelByMessageId.get(record.id)` without further joins.
 */
async function resolveChannelsByMessageId(
  em: EntityManager,
  links: MessageChannelLink[],
  tenantId: string,
  organizationId: string | null,
): Promise<Map<string, CommunicationChannel>> {
  if (links.length === 0) return new Map()
  const conversationIds = Array.from(
    new Set(
      links.map((l) => (l as { externalConversationId?: string }).externalConversationId).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  )
  if (conversationIds.length === 0) return new Map()
  const dscope = { tenantId, organizationId }
  const conversations = await findWithDecryption(
    em,
    ExternalConversation,
    { id: { $in: conversationIds }, tenantId, organizationId },
    undefined,
    dscope,
  )
  const channelIdByConversation = new Map<string, string>()
  for (const conv of conversations) {
    channelIdByConversation.set(conv.id, conv.channelId)
  }
  const channelIds = Array.from(new Set(Array.from(channelIdByConversation.values())))
  if (channelIds.length === 0) return new Map()
  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    { id: { $in: channelIds }, tenantId, organizationId, deletedAt: null },
    undefined,
    dscope,
  )
  const channelsById = new Map<string, CommunicationChannel>(
    channels.map((c) => [c.id, c]),
  )
  const result = new Map<string, CommunicationChannel>()
  for (const link of links) {
    const channelId = link.externalConversationId
      ? channelIdByConversation.get(link.externalConversationId)
      : undefined
    const channel = channelId ? channelsById.get(channelId) : undefined
    if (channel) result.set(link.messageId, channel)
  }
  return result
}

/**
 * Response enrichers for the messages.message entity.
 *
 * The hub declares 4 enrichers; downstream hosts (Messages module's `/api/messages`
 * CRUD route + future provider routes) opt in via `makeCrudRoute({ enrichers: { entityId: 'messages.message' } })`.
 *
 *   - `_channel`           → channel metadata + capabilities snapshot
 *   - `_channelPayload`    → channel-native payload (Block Kit / interactive / email MIME / …)
 *   - `_reactions`         → grouped emoji counts + users + reactedByMe
 *   - `_channelContact`    → CRM person preview (email + display name)
 *
 * Per `packages/shared/lib/crud/response-enricher` rules:
 *   - `enrichMany` is implemented for every enricher (N+1 prevention).
 *   - Enriched fields are namespaced with `_channel*` / `_reactions` prefixes.
 *   - Enrichers are read-only; no writes via the EntityManager.
 *   - Each enricher is feature-gated by `communication_channels.view`.
 */

type MessageRecord = Record<string, unknown> & {
  id: string
  threadId?: string | null
}

type ResolvedCtx = EnricherContext & {
  em: EntityManager
}

function ctxEm(ctx: EnricherContext): EntityManager {
  return ctx.em as EntityManager
}

// ── _channel ────────────────────────────────────────────────────────────────

const messageChannelEnricher: ResponseEnricher<MessageRecord, { _channel?: ChannelEnrichment | null }> = {
  id: 'communication_channels.message-channel',
  targetEntity: 'messages.message',
  features: ['communication_channels.view'],
  priority: 30,
  timeout: 1500,
  fallback: { _channel: null },
  critical: false,

  async enrichOne(record, ctx) {
    const [out] = await this.enrichMany!([record], ctx)
    return out
  },

  async enrichMany(records, ctx) {
    if (records.length === 0) return records
    const messageIds = records.map((r) => r.id)
    const em = ctxEm(ctx)
    const dscope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId ?? null }
    const links = await findWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: { $in: messageIds },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      },
      // Result set is already bounded by the `messageId $in messageIds` filter
      // (the host list endpoint caps the page at 100), matching the other
      // enrichers — no separate row limit needed.
      undefined,
      dscope,
    )

    // Resolve channels via the `link → ExternalConversation → CommunicationChannel`
    // path. Keys are platform Message ids — direct mapping per row.
    const channelByMessageId = await resolveChannelsByMessageId(
      em,
      links,
      ctx.tenantId as string,
      ctx.organizationId ?? null,
    )

    const linksByMessage = new Map<string, MessageChannelLink>()
    for (const link of links) linksByMessage.set(link.messageId, link)

    return records.map((r) => {
      const link = linksByMessage.get(r.id)
      if (!link) return { ...r, _channel: null }
      const channel = channelByMessageId.get(r.id)
      const enrichment: ChannelEnrichment = {
        providerKey: link.providerKey,
        channelType: link.channelType,
        direction: link.direction,
        deliveryStatus: link.deliveryStatus ?? null,
        capabilities: (channel?.capabilities as Record<string, unknown> | null) ?? null,
      }
      return { ...r, _channel: enrichment }
    })
  },
}

export type ChannelEnrichment = {
  providerKey: string
  channelType: string
  direction: 'inbound' | 'outbound' | string
  deliveryStatus: string | null
  capabilities: Record<string, unknown> | null
}

// ── _channelPayload ─────────────────────────────────────────────────────────

const messageChannelPayloadEnricher: ResponseEnricher<
  MessageRecord,
  { _channelPayload?: ChannelPayloadEnrichment | null }
> = {
  id: 'communication_channels.message-channel-payload',
  targetEntity: 'messages.message',
  features: ['communication_channels.view'],
  priority: 20,
  timeout: 1500,
  fallback: { _channelPayload: null },
  critical: false,

  async enrichOne(record, ctx) {
    const [out] = await this.enrichMany!([record], ctx)
    return out
  },

  async enrichMany(records, ctx) {
    if (records.length === 0) return records
    const messageIds = records.map((r) => r.id)
    const em = ctxEm(ctx)
    const dscope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId ?? null }
    const links = await findWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: { $in: messageIds },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    const byMessage = new Map<string, MessageChannelLink>()
    for (const link of links) byMessage.set(link.messageId, link)

    return records.map((r) => {
      const link = byMessage.get(r.id)
      if (!link) return { ...r, _channelPayload: null }
      const enrichment: ChannelPayloadEnrichment = {
        channelContentType: link.channelContentType ?? null,
        channelPayload: link.channelPayload ?? null,
        interactiveState: link.interactiveState ?? null,
        channelMetadata: link.channelMetadata ?? null,
      }
      return { ...r, _channelPayload: enrichment }
    })
  },
}

export type ChannelPayloadEnrichment = {
  channelContentType: string | null
  channelPayload: Record<string, unknown> | null
  interactiveState: Record<string, unknown> | null
  channelMetadata: Record<string, unknown> | null
}

// ── _reactions ──────────────────────────────────────────────────────────────

const messageReactionsEnricher: ResponseEnricher<
  MessageRecord,
  { _reactions?: ReactionGroup[] }
> = {
  id: 'communication_channels.message-reactions',
  targetEntity: 'messages.message',
  features: ['communication_channels.view'],
  priority: 25,
  timeout: 1500,
  fallback: { _reactions: [] },
  critical: false,

  async enrichOne(record, ctx) {
    const [out] = await this.enrichMany!([record], ctx)
    return out
  },

  async enrichMany(records, ctx) {
    if (records.length === 0) return records
    const messageIds = records.map((r) => r.id)
    const em = ctxEm(ctx)
    const dscope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId ?? null }
    const reactions = await findWithDecryption(
      em,
      MessageReaction,
      {
        messageId: { $in: messageIds },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      },
      undefined,
      dscope,
    )

    const byMessage = new Map<string, MessageReaction[]>()
    for (const reaction of reactions) {
      const existing = byMessage.get(reaction.messageId) ?? []
      existing.push(reaction)
      byMessage.set(reaction.messageId, existing)
    }

    return records.map((r) => {
      const rows = byMessage.get(r.id) ?? []
      const grouped = groupReactions(rows, ctx.userId)
      return { ...r, _reactions: grouped }
    })
  },
}

export type ReactionGroup = {
  emoji: string
  count: number
  users: Array<{
    userId?: string | null
    externalId?: string | null
    displayName?: string | null
    providerKey?: string | null
  }>
  reactedByMe: boolean
  /**
   * MessageReaction.id of the current user's reaction row, if any. Exposed so
   * the reaction-bar UI can issue
   *   `DELETE /api/communication_channels/messages/{messageId}/reactions/{myReactionId}`
   * when the user toggles their own reaction off. Null when `reactedByMe` is
   * false or the row was added by an external participant (provider-side).
   */
  myReactionId: string | null
}

function groupReactions(rows: MessageReaction[], currentUserId: string): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>()
  for (const row of rows) {
    const key = row.emoji
    if (!map.has(key)) {
      map.set(key, { emoji: key, count: 0, users: [], reactedByMe: false, myReactionId: null })
    }
    const group = map.get(key)!
    group.count += 1
    group.users.push({
      userId: row.reactedByUserId ?? null,
      externalId: row.reactedByExternalId ?? null,
      displayName: row.reactedByDisplayName ?? null,
      providerKey: row.providerKey ?? null,
    })
    if (row.reactedByUserId && row.reactedByUserId === currentUserId) {
      group.reactedByMe = true
      if (!group.myReactionId) group.myReactionId = row.id ?? null
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

// ── _channelContact ─────────────────────────────────────────────────────────

const conversationContactEnricher: ResponseEnricher<
  MessageRecord,
  { _channelContact?: ChannelContactEnrichment | null }
> = {
  id: 'communication_channels.conversation-contact',
  targetEntity: 'messages.message',
  features: ['communication_channels.view'],
  priority: 15,
  timeout: 2000,
  fallback: { _channelContact: null },
  critical: false,

  async enrichOne(record, ctx) {
    const [out] = await this.enrichMany!([record], ctx)
    return out
  },

  async enrichMany(records, ctx) {
    if (records.length === 0) return records
    const messageIds = records.map((r) => r.id)
    const em = ctxEm(ctx)
    const dscope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId ?? null }
    const links = await findWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: { $in: messageIds },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
      },
      undefined,
      dscope,
    )
    const conversationIds = Array.from(
      new Set(links.map((l) => l.externalConversationId).filter(Boolean)),
    )
    let conversationsById = new Map<string, ExternalConversation>()
    if (conversationIds.length > 0) {
      const conversations = await findWithDecryption(
        em,
        ExternalConversation,
        {
          id: { $in: conversationIds },
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId ?? null,
        },
        undefined,
        dscope,
      )
      conversationsById = new Map(conversations.map((c) => [c.id, c]))
    }

    const linksByMessage = new Map<string, MessageChannelLink>()
    for (const link of links) linksByMessage.set(link.messageId, link)

    return records.map((r) => {
      const link = linksByMessage.get(r.id)
      if (!link) return { ...r, _channelContact: null }
      const conversation = conversationsById.get(link.externalConversationId)
      if (!conversation) return { ...r, _channelContact: null }
      const enrichment: ChannelContactEnrichment = {
        contactPersonId: conversation.contactPersonId ?? null,
        assignedUserId: conversation.assignedUserId ?? null,
        subject: conversation.subject ?? null,
      }
      return { ...r, _channelContact: enrichment }
    })
  },
}

export type ChannelContactEnrichment = {
  contactPersonId: string | null
  assignedUserId: string | null
  subject: string | null
}

// ── Export ──────────────────────────────────────────────────────────────────

export const enrichers: ResponseEnricher[] = [
  messageChannelEnricher as unknown as ResponseEnricher,
  messageChannelPayloadEnricher as unknown as ResponseEnricher,
  messageReactionsEnricher as unknown as ResponseEnricher,
  conversationContactEnricher as unknown as ResponseEnricher,
]

export default enrichers
