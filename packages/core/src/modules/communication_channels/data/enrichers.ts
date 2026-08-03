import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  applyMessageParticipantScope,
  type MessagesParticipantScopeDatabase,
} from '../../messages/lib/participantScope'
import { sanitizeChannelHtml } from '../lib/sanitize-channel-html'
import {
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
  MessageReaction,
} from './entities'

/**
 * Response enrichers for the messages.message entity.
 *
 * The hub declares 2 enrichers; downstream hosts (Messages module's `/api/messages`
 * CRUD route + future provider routes) opt in via `makeCrudRoute({ enrichers: { entityId: 'messages.message' } })`.
 *
 *   - `messageChannelEnricher` → `_channel`, `_channelPayload`, `_channelContact`
 *   - `messageReactionsEnricher` → `_reactions`
 *
 * The channel/payload/contact enrichments were three separate enrichers, each
 * independently issuing its own `MessageChannelLink` `$in` query (and two of them
 * an `ExternalConversation` query) for the same message page. Because the shared
 * enricher runner executes active enrichers sequentially with no per-pass shared
 * context, those lookups were repeated for every page (#3183). They are merged
 * into one batched enricher so the link batch (and the conversation batch) is
 * loaded once per pass, while preserving the public enriched field names:
 *
 *   - `_channel`           → channel metadata + capabilities snapshot
 *   - `_channelPayload`    → channel-native payload (Block Kit / interactive / email MIME / …)
 *   - `_channelContact`    → CRM person preview (email + display name)
 *   - `_reactions`         → grouped emoji counts + users + reactedByMe
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

export type ChannelEnrichment = {
  providerKey: string
  channelType: string
  direction: 'inbound' | 'outbound' | string
  deliveryStatus: string | null
  capabilities: Record<string, unknown> | null
}

export type ChannelPayloadEnrichment = {
  channelContentType: string | null
  channelPayload: Record<string, unknown> | null
  interactiveState: Record<string, unknown> | null
  channelMetadata: Record<string, unknown> | null
  /**
   * Server-sanitized email HTML, safe for `dangerouslySetInnerHTML`. Populated
   * for `email/*` payloads that carry an html body, `null` otherwise. Sanitizing
   * here keeps `sanitize-html` off the client render path.
   */
  sanitizedHtml: string | null
}

export type ChannelContactEnrichment = {
  contactPersonId: string | null
  assignedUserId: string | null
  subject: string | null
}

/**
 * Sanitize channel-supplied email HTML on the server so the client widget never
 * has to pull `sanitize-html` into the browser bundle or run sanitization on the
 * render path. Returns the sanitized HTML for `email/*` payloads that carry an
 * html body, and `null` otherwise. The raw `channelPayload` is left untouched so
 * provider-package widget overrides keep their existing data contract.
 */
function sanitizeEmailPayloadHtml(
  contentType: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!contentType || !contentType.startsWith('email/')) return null
  const html = payload?.html
  if (typeof html !== 'string' || html.length === 0) return null
  return sanitizeChannelHtml(html)
}

// ── _channel + _channelPayload + _channelContact ──────────────────────────────

const messageChannelEnricher: ResponseEnricher<
  MessageRecord,
  {
    _channel?: ChannelEnrichment | null
    _channelPayload?: ChannelPayloadEnrichment | null
    _channelContact?: ChannelContactEnrichment | null
  }
> = {
  id: 'communication_channels.message-channel',
  targetEntity: 'messages.message',
  features: ['communication_channels.view'],
  priority: 30,
  timeout: 2000,
  fallback: { _channel: null, _channelPayload: null, _channelContact: null },
  critical: false,

  async enrichOne(record, ctx) {
    const [out] = await this.enrichMany!([record], ctx)
    return out
  },

  async enrichMany(records, ctx) {
    if (records.length === 0) return records
    const messageIds = records.map((r) => r.id)
    const em = ctxEm(ctx)
    const tenantId = ctx.tenantId as string
    const organizationId = ctx.organizationId ?? null
    const dscope = { tenantId, organizationId }

    const userId = typeof ctx.userId === 'string' ? ctx.userId : null
    if (!userId) {
      return records.map((record) => ({
        ...record,
        _channel: null,
        _channelPayload: null,
        _channelContact: null,
      }))
    }

    const db = em.getKysely<MessagesParticipantScopeDatabase>()
    let participantQuery = applyMessageParticipantScope(db.selectFrom('messages as m'), userId)
      .select('m.id')
      .distinct()
      .where('m.id', 'in', messageIds)
      .where('m.tenant_id', '=', tenantId)
      .where('m.deleted_at', 'is', null)

    participantQuery = organizationId !== null
      ? participantQuery.where('m.organization_id', '=', organizationId)
      : participantQuery.where('m.organization_id', 'is', null)

    const participantRows = await participantQuery.execute()
    const participantMessageIds = participantRows.map((row) => row.id)
    const participantMessageIdSet = new Set(participantMessageIds)

    // 1) MessageChannelLink — one bounded `$in` query for the whole page, shared by
    // all three enrichments (channel metadata, channel payload, conversation
    // contact). The result set is already bounded by the `messageId $in messageIds`
    // filter (the host list endpoint caps the page at 100), so no separate row
    // limit is needed.
    const links = await findWithDecryption(
      em,
      MessageChannelLink,
      {
        messageId: { $in: participantMessageIds },
        tenantId,
        organizationId,
      },
      undefined,
      dscope,
    )
    const linksByMessage = new Map<string, MessageChannelLink>()
    for (const link of links) linksByMessage.set(link.messageId, link)

    // 2) ExternalConversation — one query, shared by the channel-capabilities hop and
    // the conversation-contact enrichment.
    const conversationIds = Array.from(
      new Set(
        links
          .map((l) => l.externalConversationId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    const conversationsById = new Map<string, ExternalConversation>()
    if (conversationIds.length > 0) {
      const conversations = await findWithDecryption(
        em,
        ExternalConversation,
        { id: { $in: conversationIds }, tenantId, organizationId },
        undefined,
        dscope,
      )
      for (const conversation of conversations) {
        conversationsById.set(conversation.id, conversation)
      }
    }

    // 3) CommunicationChannel — capabilities snapshot. Resolve by `id` (not
    // `providerKey`): multi-user channels share the same `providerKey` (e.g. two
    // users with Gmail), so a providerKey-keyed map collapses them and returns the
    // wrong owner's capabilities. The hop is `link → ExternalConversation → CommunicationChannel`.
    const channelIds = Array.from(
      new Set(
        Array.from(conversationsById.values())
          .map((conversation) => conversation.channelId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    const channelsById = new Map<string, CommunicationChannel>()
    if (channelIds.length > 0) {
      const channels = await findWithDecryption(
        em,
        CommunicationChannel,
        { id: { $in: channelIds }, tenantId, organizationId, deletedAt: null },
        undefined,
        dscope,
      )
      for (const channel of channels) channelsById.set(channel.id, channel)
    }

    const channelByMessageId = new Map<string, CommunicationChannel>()
    for (const link of links) {
      if (!link.externalConversationId) continue
      const conversation = conversationsById.get(link.externalConversationId)
      if (!conversation) continue
      const channel = conversation.channelId ? channelsById.get(conversation.channelId) : undefined
      if (channel) channelByMessageId.set(link.messageId, channel)
    }

    return records.map((r) => {
      if (!participantMessageIdSet.has(r.id)) {
        return { ...r, _channel: null, _channelPayload: null, _channelContact: null }
      }

      const link = linksByMessage.get(r.id)
      if (!link) {
        return { ...r, _channel: null, _channelPayload: null, _channelContact: null }
      }

      const channel = channelByMessageId.get(r.id)
      const channelEnrichment: ChannelEnrichment = {
        providerKey: link.providerKey,
        channelType: link.channelType,
        direction: link.direction,
        deliveryStatus: link.deliveryStatus ?? null,
        capabilities: (channel?.capabilities as Record<string, unknown> | null) ?? null,
      }

      const payloadEnrichment: ChannelPayloadEnrichment = {
        channelContentType: link.channelContentType ?? null,
        channelPayload: link.channelPayload ?? null,
        interactiveState: link.interactiveState ?? null,
        channelMetadata: link.channelMetadata ?? null,
        sanitizedHtml: sanitizeEmailPayloadHtml(link.channelContentType, link.channelPayload),
      }

      const conversation = link.externalConversationId
        ? conversationsById.get(link.externalConversationId)
        : undefined
      const contactEnrichment: ChannelContactEnrichment | null = conversation
        ? {
            contactPersonId: conversation.contactPersonId ?? null,
            assignedUserId: conversation.assignedUserId ?? null,
            subject: conversation.subject ?? null,
          }
        : null

      return {
        ...r,
        _channel: channelEnrichment,
        _channelPayload: payloadEnrichment,
        _channelContact: contactEnrichment,
      }
    })
  },
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

// ── Export ──────────────────────────────────────────────────────────────────

export const enrichers: ResponseEnricher[] = [
  messageChannelEnricher as unknown as ResponseEnricher,
  messageReactionsEnricher as unknown as ResponseEnricher,
]

export default enrichers
