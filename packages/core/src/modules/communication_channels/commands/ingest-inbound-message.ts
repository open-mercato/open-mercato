import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCommunicationChannelsEvent } from '../events'
import { resolveContact } from '../lib/contact-resolver'
import type { ChannelAdapterRegistry } from '../lib/registry'
import type { NormalizedInboundMessage } from '../lib/adapter'
import { matchThread, type ThreadMatch } from '../lib/thread-matcher'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  ExternalMessage,
  MessageChannelLink,
} from '../data/entities'
import { normalizedInboundMessageSchema } from '../data/validators'
import { resolveCommunicationChannelsSystemUserId } from '../lib/system-user'
import { isUniqueViolation } from '../lib/pg-errors'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'ingest-inbound-message' })

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

export const COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID = 'communication_channels.message.ingest_inbound'

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
      },
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

    // (1b) Spec B § Sent-folder dedup.
    //
    // When an outbound message lands in the user's IMAP Sent folder (or
    // when Gmail's "send and archive" deposits it in All Mail), the next
    // poll will re-fetch it from INBOX as if it were inbound. Skip it
    // here using the RFC 5322 `Message-ID` header — we recorded it on the
    // outbound `MessageChannelLink.channelMetadata.messageId` at send time.
    //
    // We dedup ONLY on outbound links (direction='outbound') for the same
    // channel — that way an inbound copy of someone ELSE's email that
    // happens to share a Message-ID is still ingested normally.
    const incomingMessageId = (() => {
      const fromMeta = (input.message.channelMetadata as Record<string, unknown> | undefined)?.messageId
      if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
      return null
    })()
    if (incomingMessageId) {
      // MikroORM v7 dropped the Knex builder in favour of Kysely/raw SQL.
      // We use a positional-placeholder raw query for the JSONB
      // `channel_metadata->>messageId` comparison.
      try {
        const sentFolderHit = await em.getConnection().execute<Array<{ id: string }>>(
          `SELECT link.id FROM message_channel_links AS link
             INNER JOIN external_conversations AS conv
               ON conv.id = link.external_conversation_id
            WHERE link.tenant_id = ?
              AND ((?::uuid IS NULL AND link.organization_id IS NULL) OR link.organization_id = ?::uuid)
              AND conv.tenant_id = ?
              AND ((?::uuid IS NULL AND conv.organization_id IS NULL) OR conv.organization_id = ?::uuid)
              AND conv.channel_id = ?
              AND link.direction = 'outbound'
              AND link.channel_metadata->>'messageId' = ?
            LIMIT 1`,
          [
            input.scope.tenantId,
            input.scope.organizationId ?? null,
            input.scope.organizationId ?? null,
            input.scope.tenantId,
            input.scope.organizationId ?? null,
            input.scope.organizationId ?? null,
            input.channelId,
            incomingMessageId,
          ],
        )
        if (Array.isArray(sentFolderHit) && sentFolderHit.length > 0) {
          return {
            status: 'duplicate',
            externalConversationId: input.message.externalConversationId,
            externalMessageId: input.message.externalMessageId,
          }
        }
      } catch (dedupErr) {
        // Sent-folder dedup is best-effort — a failure here must not abort
        // ingest (better a possible duplicate than a lost inbound message).
        logger.warn('sent-folder dedup query failed, continuing', { err: dedupErr })
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
      },
      undefined,
      dscope,
    )
    if (!channel) {
      throw new Error(
        `[internal] Channel ${input.channelId} not found for tenant ${input.scope.tenantId} (or has been deleted)`,
      )
    }
    if (!channel.isActive) {
      throw new Error(`[internal] Channel ${input.channelId} is inactive; refusing to ingest`)
    }

    const adapter = adapterRegistry.get(input.providerKey)
    if (!adapter) {
      throw new Error(
        `[internal] No ChannelAdapter registered for providerKey '${input.providerKey}'. ` +
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
      },
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
      })
      em.persist(conversation)
      conversationCreated = true
    }

    // (3) ChannelThreadMapping upsert (1:1 with ExternalConversation per tenant).
    let mapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        externalConversationId: conversation.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId ?? null,
      },
      undefined,
      dscope,
    )

    // Last-activity bump on an existing conversation. Applied AFTER the mapping
    // lookup, immediately before the flush, so the scalar mutation and its flush
    // stay adjacent with no query in between (core flush-ordering rule — a query
    // between a scalar mutation and `em.flush()` can drop the change under some
    // flush modes / subscriber configurations).
    if (
      !conversationCreated &&
      m.timestamp &&
      (!conversation.lastMessageAt || m.timestamp > conversation.lastMessageAt)
    ) {
      conversation.lastMessageAt = m.timestamp
    }
    // We'll fill `messageThreadId` after composing the platform Message (since the
    // first inbound message becomes the thread root in the messages module).
    await em.flush()

    // (3b) Spec B — layered thread match.
    //
    // Resolve the inbound message to an existing platform thread using
    // (in priority order):
    //   1. Crypto token in References / In-Reply-To header (high confidence)
    //   2. Crypto token in body hidden span or plain-text marker (high)
    //   3. JWZ on Message-Id ↔ stored `MessageChannelLink.channelMetadata.messageId` (medium)
    //   4. Subject + participants in last 30 days, same channel (low)
    //
    // The matcher returns `null` when nothing hits — in that case we fall
    // back to the existing `ChannelThreadMapping`-by-conversation-id lookup
    // (which also returns null on first-ever inbound, in which case the
    // compose command opens a new thread).
    const metaForMatcher = (m.channelMetadata ?? {}) as Record<string, unknown>
    let threadMatch: ThreadMatch | null = null
    try {
      threadMatch = await matchThread(
        {
          channelId: input.channelId,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? null,
          messageId: extractStringFromMeta(metaForMatcher, 'messageId') ?? m.externalMessageId,
          inReplyTo:
            m.replyToExternalId ?? extractStringFromMeta(metaForMatcher, 'inReplyTo'),
          references: extractStringArrayFromMeta(metaForMatcher, 'references'),
          subject: m.subject ?? '',
          fromAddress:
            extractStringFromMeta(metaForMatcher, 'from') ?? m.senderIdentifier,
          toAddresses: extractStringArrayFromMeta(metaForMatcher, 'to'),
          ccAddresses: extractStringArrayFromMeta(metaForMatcher, 'cc'),
          bodyPlain: m.bodyFormat === 'html' ? null : m.body ?? null,
          bodyHtml: m.bodyFormat === 'html' ? m.body ?? null : null,
          receivedAt: m.timestamp ?? new Date(),
        },
        { em },
      )
    } catch (matcherErr) {
      // Matcher failure must not block ingest — fall back to the existing
      // conversation-based thread mapping so the message still lands.
      logger.warn('thread matcher failed, falling back to conversation mapping', { err: matcherErr })
    }

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
    } catch (contactErr) {
      // Best-effort: contact resolution is advisory and must not abort ingest.
      // Log like the sibling dedup/matcher catches so a misbehaving resolver is
      // visible in operator logs instead of failing silently.
      logger.warn('contact resolution failed, continuing without a CRM match', { err: contactErr })
      contactHint = null
    }
    const matchedPersonId = contactHint?.matchedPersonId ?? null
    if (matchedPersonId && conversation.contactPersonId !== matchedPersonId) {
      conversation.contactPersonId = matchedPersonId
      // Flush this scalar mutation before the system-user lookup below queries the
      // same EntityManager. SPEC-018: a query between a scalar mutation and its
      // flush can silently discard the pending UPDATE (mirrors the lastMessageAt
      // bump above).
      await em.flush()
    }

    // (5) Compose the platform Message via the messages module command.
    //
    // Sanitize against the `messages` module's validators (max 50_000 char body
    // + non-empty subject) so real-world emails don't get rejected mid-ingest:
    //   - HTML emails routinely exceed 50k (Gmail signatures, marketing
    //     templates, RFC 5322 multipart). Truncate with a marker rather than
    //     drop the whole message — the full raw body is still in
    //     ExternalMessage.rawPayload if needed for forensic / forward use.
    //   - Some legitimate messages have no subject (notifications, bounce
    //     digests). Substitute a placeholder instead of failing ingest.
    const MAX_COMPOSE_BODY = 50_000
    const TRUNCATE_MARKER =
      '\n\n[…message truncated by Open Mercato — full body preserved in ExternalMessage.rawPayload]'
    const rawBody = m.body ?? ''
    const truncatedBody =
      rawBody.length > MAX_COMPOSE_BODY
        ? rawBody.slice(0, MAX_COMPOSE_BODY - TRUNCATE_MARKER.length) + TRUNCATE_MARKER
        : rawBody
    const safeSubject = (m.subject ?? '').trim() || '(no subject)'

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
      subject: safeSubject,
      body: truncatedBody,
      bodyFormat: (m.bodyFormat === 'html' ? 'text' : m.bodyFormat) as 'text' | 'markdown',
      priority: 'normal' as const,
      sendViaEmail: false,
      // Spec B: matcher-resolved thread id takes priority over the existing
      // conversation-based mapping. Falls through to `mapping?.messageThreadId`
      // when the matcher returned null (no token / JWZ / subject hit).
      parentMessageId: threadMatch?.messageThreadId ?? mapping?.messageThreadId,
      isDraft: false,
      // Stable dedup key so a retried ingest (after a transient failure between
      // compose and the ExternalMessage anchor insert) reuses the message
      // composed by the first attempt instead of duplicating it. Mirrors the
      // (channel, externalMessageId) ExternalMessage anchor's natural key.
      idempotencyKey: m.externalMessageId
        ? `cc:${input.channelId}:${m.externalMessageId}`
        : undefined,
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
      })
      em.persist(mapping)
    }

    // (6) Create ExternalMessage + MessageChannelLink (hub-side records).
    //
    // The PrimaryKey for both uses `defaultRaw: 'gen_random_uuid()'` — a
    // Postgres-side default that doesn't populate the entity's `id` field
    // until after the INSERT returns. If we let MikroORM generate both, then
    // `em.create(MessageChannelLink, { externalMessageId: externalMessage.id })`
    // reads `undefined` for `externalMessage.id` (it hasn't been flushed yet)
    // and writes NULL to `message_channel_links.external_message_id`,
    // breaking the FK and causing downstream joins to silently return 0 rows.
    //
    // Pre-generating both UUIDs client-side fixes the cross-row reference
    // problem and keeps the single-transaction flush semantics intact.
    const externalMessageRowId = randomUUID()
    const channelLinkRowId = randomUUID()
    const externalMessage = em.create(ExternalMessage, {
      id: externalMessageRowId,
      channelId: input.channelId,
      conversationId: conversation.id,
      externalMessageId: m.externalMessageId,
      direction: 'inbound',
      senderIdentifier: m.senderIdentifier,
      senderDisplayName: m.senderDisplayName ?? null,
      providerTimestamp: m.timestamp,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    })
    em.persist(externalMessage)

    // Spec B: annotate the link with which thread-matcher strategy resolved
    // this message (or `'new-thread'` when matcher returned null and we
    // opened a fresh thread). Surfaced to observability + future UI ("this
    // thread match is low-confidence — confirm or move").
    const matcherAnnotatedMetadata: Record<string, unknown> = {
      ...((m.channelMetadata as Record<string, unknown> | undefined) ?? {}),
      threadMatchStrategy: threadMatch?.matchedBy ?? 'new-thread',
      threadMatchConfidence: threadMatch?.confidence ?? 'low',
    }

    const channelLink = em.create(MessageChannelLink, {
      id: channelLinkRowId,
      messageId: message.id,
      externalConversationId: conversation.id,
      externalMessageId: externalMessageRowId,
      providerKey: input.providerKey,
      channelType: input.channelType,
      direction: 'inbound',
      deliveryStatus: 'received',
      channelPayload: m.channelPayload,
      channelContentType: m.channelContentType,
      channelMetadata: matcherAnnotatedMetadata,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    })
    em.persist(channelLink)

    try {
      await em.flush()
    } catch (flushErr) {
      // Concurrency guard: the pre-check at (1) is not atomic with this insert,
      // so a poll re-fetch racing a push notification (or two push deliveries)
      // can both pass the check and reach here. The `(channel_id,
      // external_message_id)` unique index rejects the loser with a 23505. Treat
      // that as a duplicate — returning here (instead of throwing) prevents the
      // message from being dead-lettered and retried forever. The winning job
      // already recorded the message + link.
      if (isUniqueViolation(flushErr)) {
        return {
          status: 'duplicate',
          externalConversationId: conversation.id,
          externalMessageId: m.externalMessageId,
        }
      }
      throw flushErr
    }

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

/**
 * Pull a string value from the provider's `channelMetadata` map. Returns
 * `null` (not `undefined`) when the key is absent or the value isn't a
 * string — keeps the matcher's input shape predictable.
 */
function extractStringFromMeta(
  meta: Record<string, unknown>,
  key: string,
): string | null {
  const value = meta[key]
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * Pull a string[] value from the provider's `channelMetadata` map.
 * Filters out non-string entries defensively. Returns an empty array
 * when the key is absent or the value isn't an array.
 */
function extractStringArrayFromMeta(
  meta: Record<string, unknown>,
  key: string,
): string[] {
  const value = meta[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

registerCommand(ingestInboundMessageCommand)

export default ingestInboundMessageCommand
