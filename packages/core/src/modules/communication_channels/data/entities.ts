import { OptionalProps } from '@mikro-orm/core'
import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * Hub entities for the Communication Channels module.
 *
 * Cross-module references (e.g. `MessageChannelLink.messageId → messages.message.id`)
 * use plain `uuid` columns, NOT MikroORM `@ManyToOne` decorators. Project rule:
 * "No direct ORM relationships between modules — use foreign key IDs, fetch separately."
 * Cross-module links are declared in `data/extensions.ts` via `EntityExtension`.
 *
 * See SPEC-045d §2.2.
 */

// ── CommunicationChannel ──────────────────────────────────────

/**
 * Per-channel lifecycle status. Set by the polling worker / outbound subscriber
 * + the `markChannelRequiresReauth` command. Existing `isActive` remains for the
 * coarse admin enable/disable toggle; `status` is the finer-grained operational
 * state used by per-user reconnect flows.
 *
 * Email integration spec § Hub Deltas → Delta 2.
 */
export type CommunicationChannelStatus =
  | 'connected'
  | 'requires_reauth'
  | 'error'
  | 'disconnected'

@Entity({ tableName: 'communication_channels' })
@Index({ name: 'communication_channels_tenant_provider_idx', properties: ['tenantId', 'providerKey'] })
// Provider-push webhooks (Gmail Pub/Sub) resolve channels by (provider_key,
// external_identifier) WITHOUT a tenant_id — they only know the mailbox address.
// Without this index that lookup is a full scan over every channel of the
// provider, which a (signature-verified) push or replay repeats on every hit.
@Index({
  name: 'communication_channels_provider_external_idx',
  expression:
    `create index "communication_channels_provider_external_idx" on "communication_channels" ("provider_key", "external_identifier") where "deleted_at" is null`,
})
@Index({ name: 'communication_channels_tenant_type_active_idx', properties: ['tenantId', 'channelType', 'isActive'] })
@Index({
  name: 'communication_channels_user_lookup_idx',
  properties: ['userId', 'channelType', 'deletedAt'],
})
@Index({
  name: 'communication_channels_poll_due_idx',
  expression:
    `create index "communication_channels_poll_due_idx" on "communication_channels" ("is_active", "last_polled_at") where "deleted_at" is null`,
})
@Index({
  name: 'communication_channels_one_primary_per_user_uq',
  expression:
    `create unique index "communication_channels_one_primary_per_user_uq" on "communication_channels" ("user_id") where "is_primary" and "user_id" is not null and "deleted_at" is null`,
})
// One channel per (tenant, user, provider, mailbox): a reconnect heals the
// existing row in place (see `createConnectedChannelRow`) instead of inserting a
// duplicate that would stay polled + keep its own push subscription. Partial so
// tenant-wide channels (null user_id) and identifier-less rows are exempt.
@Index({
  name: 'communication_channels_user_provider_external_uq',
  expression:
    `create unique index "communication_channels_user_provider_external_uq" on "communication_channels" ("tenant_id", "user_id", "provider_key", "external_identifier") where "deleted_at" is null and "user_id" is not null and "external_identifier" is not null`,
})
export class CommunicationChannel {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'isActive'
    | 'capabilities'
    | 'deletedAt'
    | 'externalIdentifier'
    | 'credentialsRef'
    | 'organizationId'
    | 'userId'
    | 'isPrimary'
    | 'pollIntervalSeconds'
    | 'lastPolledAt'
    | 'status'
    | 'lastError'
    | 'channelState'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'channel_type', type: 'text' })
  channelType!: string

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ name: 'external_identifier', type: 'text', nullable: true })
  externalIdentifier?: string | null

  @Property({ name: 'credentials_ref', type: 'uuid', nullable: true })
  credentialsRef?: string | null

  @Property({ name: 'capabilities', type: 'json', nullable: true })
  capabilities?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  /**
   * Per-user channel owner. NULL = tenant-scoped (existing behaviour, e.g. WhatsApp Business).
   * Set = user-scoped (e.g. Jane's personal Gmail). Visible only to the owning user
   * and to admins with `communication_channels.admin`. Linked to `auth:user` via
   * `EntityExtension` in `data/extensions.ts` — never a raw DB FK.
   */
  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  /**
   * Per-user "primary" flag. Only meaningful when `userId IS NOT NULL`; ignored
   * for tenant-scoped channels. Enforced as one-primary-per-user by the partial
   * unique index `communication_channels_one_primary_per_user_uq`.
   */
  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  /**
   * Polling cadence in seconds. NULL means "this channel does not poll" — i.e. it
   * is push-only (webhook) or its provider opted out via
   * `ChannelCapabilities.realtimePush !== false`. Set means hub-managed polling
   * at that interval via the `poll-tick` scheduler entry.
   */
  @Property({ name: 'poll_interval_seconds', type: 'int', nullable: true })
  pollIntervalSeconds?: number | null

  /** Last successful poll timestamp; the scheduler enumerates by this column. */
  @Property({ name: 'last_polled_at', type: Date, nullable: true })
  lastPolledAt?: Date | null

  /**
   * Per-channel lifecycle status. See {@link CommunicationChannelStatus}.
   * Migration sets `status = 'connected'` for all existing active channels (default value).
   */
  @Property({ name: 'status', type: 'text', default: 'connected' })
  status: CommunicationChannelStatus = 'connected'

  /** Most recent classified error message for diagnostics. */
  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  /**
   * Provider-specific resumption state, opaque to the hub. Polling adapters
   * encode their incremental cursor here (Gmail historyId, IMAP
   * UIDVALIDITY+UIDNEXT). The polling worker reads it before each
   * `fetchHistory` call and writes the adapter's returned `nextCursor` back
   * after a successful poll. Empty / NULL means "bootstrap on next poll".
   */
  @Property({ name: 'channel_state', type: 'json', nullable: true })
  channelState?: Record<string, unknown> | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ── ExternalConversation ──────────────────────────────────────

@Entity({ tableName: 'external_conversations' })
@Index({ name: 'external_conversations_channel_idx', properties: ['channelId', 'externalConversationId'] })
@Index({ name: 'external_conversations_contact_person_idx', properties: ['contactPersonId'] })
@Index({ name: 'external_conversations_assigned_user_idx', properties: ['assignedUserId'] })
@Unique({ name: 'external_conversations_channel_external_uq', properties: ['channelId', 'externalConversationId'] })
export class ExternalConversation {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'lastMessageAt' | 'subject' | 'contactPersonId' | 'assignedUserId' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ name: 'external_conversation_id', type: 'text' })
  externalConversationId!: string

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'contact_person_id', type: 'uuid', nullable: true })
  contactPersonId?: string | null

  @Property({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string | null

  @Property({ name: 'last_message_at', type: Date, nullable: true })
  lastMessageAt?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ── ExternalMessage ───────────────────────────────────────────

@Entity({ tableName: 'external_messages' })
@Index({ name: 'external_messages_conversation_idx', properties: ['conversationId'] })
@Index({ name: 'external_messages_channel_external_idx', properties: ['channelId', 'externalMessageId'] })
@Unique({ name: 'external_messages_channel_external_uq', properties: ['channelId', 'externalMessageId'] })
export class ExternalMessage {
  [OptionalProps]?: 'createdAt' | 'senderIdentifier' | 'senderDisplayName' | 'providerTimestamp' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  @Property({ name: 'external_message_id', type: 'text' })
  externalMessageId!: string

  @Property({ name: 'direction', type: 'text' })
  direction!: 'inbound' | 'outbound'

  @Property({ name: 'sender_identifier', type: 'text', nullable: true })
  senderIdentifier?: string | null

  @Property({ name: 'sender_display_name', type: 'text', nullable: true })
  senderDisplayName?: string | null

  @Property({ name: 'provider_timestamp', type: Date, nullable: true })
  providerTimestamp?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// ── MessageChannelLink ────────────────────────────────────────

@Entity({ tableName: 'message_channel_links' })
@Index({ name: 'message_channel_links_message_idx', properties: ['messageId'] })
@Index({ name: 'message_channel_links_ext_conv_idx', properties: ['externalConversationId'] })
@Index({ name: 'message_channel_links_ext_msg_idx', properties: ['externalMessageId'] })
@Unique({ name: 'message_channel_links_message_uq', properties: ['messageId'] })
export class MessageChannelLink {
  [OptionalProps]?: 'createdAt' | 'deliveryStatus' | 'externalMessageId' | 'channelPayload' | 'channelContentType' | 'interactiveState' | 'channelMetadata' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** Logical link to messages.message.id (no DB FK — cross-module via EntityExtension). */
  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  /** FK to external_conversations.id (intra-module — DB FK acceptable but kept as plain uuid for symmetry). */
  @Property({ name: 'external_conversation_id', type: 'uuid' })
  externalConversationId!: string

  @Property({ name: 'external_message_id', type: 'uuid', nullable: true })
  externalMessageId?: string | null

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'channel_type', type: 'text' })
  channelType!: string

  @Property({ name: 'direction', type: 'text' })
  direction!: 'inbound' | 'outbound'

  @Property({ name: 'delivery_status', type: 'text' })
  deliveryStatus: string = 'pending'

  @Property({ name: 'channel_payload', type: 'json', nullable: true })
  channelPayload?: Record<string, unknown> | null

  @Property({ name: 'channel_content_type', type: 'text', nullable: true })
  channelContentType?: string | null

  @Property({ name: 'interactive_state', type: 'json', nullable: true })
  interactiveState?: Record<string, unknown> | null

  @Property({ name: 'channel_metadata', type: 'json', nullable: true })
  channelMetadata?: Record<string, unknown> | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// ── ChannelThreadMapping ──────────────────────────────────────

@Entity({ tableName: 'channel_thread_mappings' })
@Index({ name: 'channel_thread_mappings_ext_conv_idx', properties: ['externalConversationId', 'tenantId'] })
@Index({ name: 'channel_thread_mappings_thread_idx', properties: ['messageThreadId', 'tenantId'] })
@Unique({ name: 'channel_thread_mappings_ext_conv_uq', properties: ['externalConversationId', 'tenantId'] })
export class ChannelThreadMapping {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'assignedUserId' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'external_conversation_id', type: 'uuid' })
  externalConversationId!: string

  /** Logical link to messages.message.thread_id (no DB FK — cross-module). */
  @Property({ name: 'message_thread_id', type: 'uuid' })
  messageThreadId!: string

  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'external_thread_ref', type: 'text' })
  externalThreadRef!: string

  /** Logical link to auth.user.id (no DB FK — cross-module). */
  @Property({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ── MessageReaction ───────────────────────────────────────────

@Entity({ tableName: 'message_reactions' })
@Index({ name: 'message_reactions_message_idx', properties: ['messageId'] })
@Index({ name: 'message_reactions_message_emoji_idx', properties: ['messageId', 'emoji'] })
@Index({
  name: 'message_reactions_internal_actor_uq',
  expression:
    `create unique index "message_reactions_internal_actor_uq" on "message_reactions" ("tenant_id", "message_id", "emoji", "reacted_by_user_id") where "reacted_by_user_id" is not null`,
})
@Index({
  name: 'message_reactions_external_actor_uq',
  expression:
    `create unique index "message_reactions_external_actor_uq" on "message_reactions" ("tenant_id", "message_id", "emoji", "reacted_by_external_id") where "reacted_by_external_id" is not null`,
})
@Check({
  name: 'message_reactions_exactly_one_actor_chk',
  expression: `("reacted_by_user_id" is null) <> ("reacted_by_external_id" is null)`,
})
export class MessageReaction {
  [OptionalProps]?: 'createdAt' | 'reactedByUserId' | 'reactedByExternalId' | 'reactedByDisplayName' | 'providerKey' | 'externalReactionId' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** Logical link to messages.message.id (no DB FK — cross-module). */
  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  @Property({ name: 'emoji', type: 'text' })
  emoji!: string

  /** Logical link to auth.user.id (no DB FK — cross-module). NULL for external reactions. */
  @Property({ name: 'reacted_by_user_id', type: 'uuid', nullable: true })
  reactedByUserId?: string | null

  @Property({ name: 'reacted_by_external_id', type: 'text', nullable: true })
  reactedByExternalId?: string | null

  @Property({ name: 'reacted_by_display_name', type: 'text', nullable: true })
  reactedByDisplayName?: string | null

  @Property({ name: 'provider_key', type: 'text', nullable: true })
  providerKey?: string | null

  @Property({ name: 'external_reaction_id', type: 'text', nullable: true })
  externalReactionId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// ── ChannelThreadToken ────────────────────────────────────────

/**
 * Per-thread HMAC-signed opaque token used by the layered thread-matcher to
 * reliably attach inbound replies to the originating Open Mercato message
 * thread, even when the recipient's mail client strips RFC 5322 headers.
 *
 * Created lazily on the first outbound message in a thread by the
 * `outbound-bridge` subscriber. The token is injected into:
 *   1. The MIME `References:` header as `<om_TOKEN@open-mercato.invalid>` —
 *      invisible to the recipient and survives most reply clients.
 *   2. A hidden HTML body span `<span style="display:none">[OM:om_TOKEN]</span>` —
 *      survives when References is stripped (e.g. some mobile clients).
 *   3. A plain-text trailer `[OM:om_TOKEN]` — survives plain-text-only replies.
 *
 * The unique constraint is `(tenantId, token)` — tenant isolation by
 * construction. HMAC verification (via `lib/thread-token.ts`) defends against
 * forged inbound messages: tokens that don't HMAC-verify never reach the DB
 * lookup.
 *
 * See `.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`.
 */
@Entity({ tableName: 'channel_thread_tokens' })
// One token row per (tenant, thread): the matcher resolves every reply to the
// same thread regardless of which outbound send minted the token. The unique
// constraint also makes `getOrCreateThreadToken` race-safe (insert-on-conflict).
@Unique({ name: 'channel_thread_tokens_thread_uq', properties: ['tenantId', 'messageThreadId'] })
@Unique({ name: 'channel_thread_tokens_token_uq', properties: ['tenantId', 'token'] })
export class ChannelThreadToken {
  [OptionalProps]?: 'createdAt' | 'lastSeenAt' | 'organizationId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  /** Logical link to messages.message.thread_id (no DB FK — cross-module). */
  @Property({ name: 'message_thread_id', type: 'uuid' })
  messageThreadId!: string

  /**
   * HMAC-signed opaque token, format: `om_<22b64url>_<11b64url>` (16 random
   * bytes + 8 HMAC bytes, each base64url-encoded without padding), ~37 chars.
   */
  @Property({ name: 'token', type: 'text' })
  token!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  /**
   * Updated whenever a thread-matcher token-based strategy resolves to this
   * row. Used for future GC: tokens with `last_seen_at < now() - 90 days`
   * are pruning candidates.
   */
  @Property({ name: 'last_seen_at', type: Date, nullable: true })
  lastSeenAt?: Date | null
}

// ── ChannelIngestDeadLetter ───────────────────────────────────

/**
 * Inbound messages that fail permanently during ingest land here so an
 * operator can replay them after fixing parsers / schemas. Transient
 * failures (DB blip, network timeout) DO NOT write here — those abort the
 * poll loop without advancing the cursor so the message is re-fetched on
 * the next tick.
 *
 * `raw_body` is encrypted at rest via the module's `encryption.ts`
 * `defaultEncryptionMaps` entry (MIME bodies may contain PII).
 *
 * See `.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`
 * (§ 3 Data Model).
 */
@Entity({ tableName: 'channel_ingest_dead_letters' })
@Index({ name: 'channel_ingest_dead_letters_channel_idx', properties: ['channelId', 'tenantId'] })
@Index({ name: 'channel_ingest_dead_letters_created_idx', properties: ['tenantId', 'createdAt'] })
export class ChannelIngestDeadLetter {
  [OptionalProps]?:
    | 'createdAt'
    | 'organizationId'
    | 'externalMessageId'
    | 'externalUid'
    | 'rawBody'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  /** External UID / sequence-number for the provider (e.g. IMAP UID, Gmail messageId). */
  @Property({ name: 'external_uid', type: 'text', nullable: true })
  externalUid?: string | null

  @Property({ name: 'external_message_id', type: 'text', nullable: true })
  externalMessageId?: string | null

  @Property({ name: 'error_class', type: 'text' })
  errorClass!: string

  @Property({ name: 'error_message', type: 'text' })
  errorMessage!: string

  /** Truncated source — first N bytes of the raw MIME / payload (encrypted at rest). */
  @Property({ name: 'raw_body', type: 'text', nullable: true })
  rawBody?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
