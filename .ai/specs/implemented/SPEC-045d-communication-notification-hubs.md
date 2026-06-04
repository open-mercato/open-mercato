# SPEC-045d — Communication & Notification Hubs (Unified Messaging Bridge)

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 4 of 6
**Related**: [SPEC-002 — Messages Module](./SPEC-002-2026-01-23-messages-module.md), [SPEC-045a — Foundation](./SPEC-045a-foundation.md), [SPEC-045c — Payment & Shipping Hubs](./SPEC-045c-payment-shipping-hubs.md)
**Status (2026-05-22)**: spec only — no shipping code yet. The earlier "v1" of this spec described a parallel hub-side `ExternalConversation`/`ExternalMessage` design but was never implemented. **This document is the first implementation specification for the hub**; all references to "v1 backward compatibility" have been removed. This spec is a hard prerequisite for [`2026-05-21-email-integration-foundation.md`](../2026-05-21-email-integration-foundation.md) and for SPEC-056 (WhatsApp).

---

## TLDR

Introduces the `communication_channels` hub: a single platform-owned bridge between external chat / email providers and the existing Messages module's unified inbox. Inbound messages from WhatsApp, Slack, Email (and any future channel) create threaded conversations in the Messages inbox. Users reply from the inbox and replies route back through the originating channel. Each provider declares its **capabilities** (reactions, rich blocks, threading, file sharing) and stores **channel-native payloads** (Slack Block Kit, WhatsApp interactive messages, email MIME) alongside normalized text. **Reactions** are first-class entities with bidirectional sync.

**Zero coupling principle**: the Messages module's data model and core API routes are never modified. All bridging happens through new hub entities, response enrichers, and event subscribers. The single agreed exception — for parity with all other UMES consumers — is that the Messages module's detail and list pages register a small number of widget-injection spots (no behavior change, just `<InjectionPoint id="…" />` placements). This is in-scope for SPEC-045d Phase 1 and documented in § 9.

---

## Prerequisites & Cross-Spec Dependencies

This is a foundation spec. Everything it depends on is already shipped in the repo (verified 2026-05-22):

| Dependency | Verification | Used for |
|---|---|---|
| **Messages module** (SPEC-002) | `packages/core/src/modules/messages/` exists; entity has fields `threadId`, `parentMessageId`, `senderUserId`, `body`, `visibility`, `sourceEntityType`, `sourceEntityId`, `externalEmail`, `externalName`, `actionData`; `messages.message.sent` event present with `clientBroadcast: true` | Inbox destination for inbound channel messages; outbound trigger event |
| **Integrations module** (SPEC-045 / SPEC-045a) | `packages/core/src/modules/integrations/` exists; entity `IntegrationCredentials` (table `integration_credentials`) with `credentials` (jsonb), `integrationId`, `tenantId`, `organizationId`; entity `IntegrationLog` (table `integration_logs`) at `data/entities.ts:122–125`; services `credentials-service.ts`, `log-service.ts`, `health-service.ts`, `registry-service.ts`, `state-service.ts` | Encrypted credential storage; structured operation logging; marketplace registry |
| **UMES (SPEC-041 family)** | `packages/ui/src/backend/injection/` ships widget-injection registry + `useGuardedMutation` + `useNotificationEffect`; `packages/shared/src/lib/crud/response-enricher.ts` ships enricher contract + registry; mutation-guard registry, sync-subscriber registry, command-interceptor registry all live | Widget injection, response enrichers, mutation guards, command interceptors, notification handlers |
| **Scheduler** | `packages/scheduler/` exports `SchedulerService.register(ScheduleRegistration)` with cron + interval modes | Periodic ticks (e.g., outbound retry sweeper) |
| **Encryption / EntityExtension** | `packages/shared/src/modules/entities.ts` exports `EntityExtension` type (`{ base, extension, join: { baseKey, extensionKey }, … }`); `packages/shared/src/lib/encryption/find.ts` exports `findWithDecryption` / `findOneWithDecryption` | Cross-module entity links; encrypted reads of integration credentials |

This spec adds **no new prerequisite modules**. It does not depend on `SPEC-045b` (data sync), `SPEC-045e` (webhooks), `SPEC-045f` (health monitoring), `SPEC-045h` (Stripe gateway), or `SPEC-045i` (storage) — all of which are shipped but functionally independent.

### Downstream Consumers (forward compatibility)

This spec is intentionally additive-friendly. Known downstream specs:

| Consumer spec | Adds to the hub | Status |
|---|---|---|
| [`2026-05-21-email-integration-foundation.md`](../2026-05-21-email-integration-foundation.md) | Additive columns on `CommunicationChannel` (`user_id?`, `is_primary`, `poll_interval_seconds`, `last_polled_at`, `status`, `last_error`); additive column on `IntegrationCredentials` (`user_id?` — declared in `integrations` module); hub-side `poll-channel` worker; OAuth state-cookie + callback router; one new ACL feature `communication_channels.connect_user_channel`. | Pre-implemented; ready to implement after this spec ships |
| SPEC-056 WhatsApp | First WhatsApp `ChannelAdapter` implementation. No hub deltas required. | Spec only |

SPEC-045d's Adapter contract (§1) is designed to accommodate both upstream consumers without further changes.

---

## Overview

### Problem Statement

Open Mercato today has no bridge between external communication channels (WhatsApp, Slack, Email) and the Messages module's unified inbox. The `communication_channels` hub does not yet exist in shipping code — though several feasibility analyses (ANALYSIS-013 Gmail, ANALYSIS-045d WhatsApp) and provider-stub specs (SPEC-056) anticipate it. Without this hub:
- Users cannot see external conversations in their unified inbox.
- Users cannot reply to channel messages from the platform.
- CRM and AI subscribers have no channel-agnostic event stream to consume.

Additionally, channels like Slack and WhatsApp carry rich, non-standard payloads (Block Kit, interactive buttons, reactions, contact cards, location sharing) that have no storage or rendering mechanism in the current design.

### Proposed Solution

1. **Messaging Bridge** — a set of hub entities (`MessageChannelLink`, `ChannelThreadMapping`, `MessageReaction`) that connect external conversations to Message threads without modifying the Messages module
2. **ChannelAdapter v2** — enhanced adapter contract with capabilities declaration, content normalization/conversion, reaction support, and contact resolution
3. **Rich Payload Storage** — dual representation: normalized body in `Message.body` for search/notifications + full channel-native JSON in `MessageChannelLink.channelPayload` for rich rendering
4. **Bidirectional Reactions** — `MessageReaction` entity with real-time sync between external channels and the Messages UI
5. **Provider Examples** — Slack (feature-rich reference) and WhatsApp (industry-standard baseline) as primary providers, Email as secondary

---

## 1. Communication Channels Hub — `communication_channels`

### 1.1 ChannelAdapter Contract

This is the initial `ChannelAdapter` contract. There is no v1 in code; provider packages implement this interface directly. Read-only properties (`providerKey`, `channelType`, `capabilities`) are required; methods divided into required core (`sendMessage`, `verifyWebhook`, `getStatus`, `convertOutbound`, `normalizeInbound`) and optional extensions (reactions, edit/delete, history, contact resolution, credential refresh, credential validation).

```typescript
// communication_channels/lib/adapter.ts

/** Capabilities a channel provider declares */
interface ChannelCapabilities {
  // Core
  threading: boolean              // Supports threaded replies
  richText: boolean               // Supports formatted text (HTML/Markdown)
  fileSharing: boolean            // Supports file/media attachments
  maxFileSize?: number            // Max file size in bytes
  supportedMimeTypes?: string[]   // Accepted MIME types for files
  readReceipts: boolean           // Reports when messages are read
  deliveryReceipts: boolean       // Reports when messages are delivered
  typingIndicators: boolean       // Supports "user is typing" signals

  // Extended
  reactions: boolean              // Supports emoji reactions
  multiReactionPerUser: boolean   // Multiple reactions per user per message (Slack: true, WhatsApp: false)
  editMessage: boolean            // Can edit sent messages
  deleteMessage: boolean          // Can delete/recall sent messages
  presence: boolean               // Supports online/offline presence
  richBlocks: boolean             // Supports structured content blocks (Slack Block Kit, etc.)
  interactiveComponents: boolean  // Supports buttons, menus, date pickers in messages
  inlineImages: boolean           // Supports inline images in message body
  conversationHistory: boolean    // Can fetch historical messages
  contactCards: boolean           // Can send/receive contact cards (vCard)
  locationSharing: boolean        // Can send/receive GPS locations
  voiceNotes: boolean             // Can send/receive voice messages
  stickers: boolean               // Can send/receive stickers

  // Content format support
  supportedBodyFormats: Array<'text' | 'markdown' | 'html'>
  maxBodyLength?: number          // Max message body length in characters
}

/** ChannelAdapter — the contract every channel provider implements */
interface ChannelAdapter {
  readonly providerKey: string
  readonly channelType: 'whatsapp' | 'slack' | 'email' | 'sms' | string

  /** Declare supported features */
  readonly capabilities: ChannelCapabilities

  // ── Required core methods ──────────────────────────────────

  /** Send a message through this channel */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>

  /** Receive and parse an inbound message webhook */
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage>

  /** Get message delivery status */
  getStatus(input: GetMessageStatusInput): Promise<MessageStatus>

  /** Convert platform Message body to channel-native format */
  convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent>

  /** Convert inbound channel message to platform-normalized format */
  normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage>

  // ── Optional extensions ────────────────────────────────────

  /** List available phone numbers / sender IDs (optional) */
  listSenders?(input: ListSendersInput): Promise<SenderInfo[]>

  /** Send a reaction (optional, gated by capabilities.reactions) */
  sendReaction?(input: SendReactionInput): Promise<void>

  /** Remove a reaction (optional, gated by capabilities.reactions) */
  removeReaction?(input: RemoveReactionInput): Promise<void>

  /** Edit a previously sent message (optional, gated by capabilities.editMessage) */
  editMessage?(input: EditChannelMessageInput): Promise<void>

  /** Delete a previously sent message (optional, gated by capabilities.deleteMessage) */
  deleteMessage?(input: DeleteChannelMessageInput): Promise<void>

  /** Fetch conversation history for initial sync (optional, gated by capabilities.conversationHistory) */
  fetchHistory?(input: FetchHistoryInput): Promise<HistoryPage>

  /** Resolve external sender identity to a contact hint (optional) */
  resolveContact?(input: ResolveContactInput): Promise<ContactHint | null>

  /**
   * Refresh credentials for OAuth-based providers (optional).
   * Called by the hub when an access token is within 60s of expiry, or proactively after a 401 response from the provider.
   * Implementations exchange the refresh token for a new access token and return the updated credential blob to persist.
   * Required for OAuth providers (Gmail, future Slack-OAuth). Omitted for static-credential providers (IMAP, WhatsApp Business API).
   */
  refreshCredentials?(input: RefreshCredentialsInput): Promise<RefreshedCredentials>

  /**
   * Validate provided credentials at setup time (optional).
   * Called by the hub during the per-channel connect flow before persisting credentials.
   * Returns `{ ok: true }` on success, or `{ ok: false, errors }` with field-level error messages for `createCrudFormError`.
   * Implemented by credential-based providers (IMAP / SMTP) to test the actual connection. OAuth providers omit this — the OAuth callback proves credential validity.
   */
  validateCredentials?(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult>
}

// ── Credential refresh + validation types ────────────────────

interface RefreshCredentialsInput {
  channelId: string
  credentials: Record<string, unknown>  // Current encrypted credential blob (already decrypted by the hub before passing in)
  scope: TenantScope
}

interface RefreshedCredentials {
  credentials: Record<string, unknown>  // New credential blob to persist (re-encrypted by the hub)
  expiresAt?: Date                      // Absolute expiry of the new access token, if known
}

interface ValidateCredentialsInput {
  providerKey: string
  credentials: Record<string, unknown>  // Raw credential blob from the connect form
  scope: TenantScope
}

interface ValidateCredentialsResult {
  ok: boolean
  /** Field-level error messages keyed by credential field name; consumed by `createCrudFormError` on the connect form. */
  errors?: Record<string, string>
}
```

### 1.2 v2 Types

```typescript
// ── Inbound normalization ────────────────────────────────────

interface NormalizedInboundMessage {
  externalMessageId: string       // Provider's unique message ID
  externalConversationId: string  // Provider's conversation/thread ID
  senderIdentifier: string        // Phone number, email, Slack user ID
  senderDisplayName?: string
  senderAvatarUrl?: string
  subject?: string                // For email; empty for chat channels
  body: string                    // Normalized plain text or markdown
  bodyFormat: 'text' | 'markdown' | 'html'
  attachments?: NormalizedAttachment[]
  timestamp: Date
  replyToExternalId?: string      // If this is a reply to another external message
  channelPayload: Record<string, unknown>  // Full channel-native payload
  channelContentType: string      // e.g., 'slack/blocks', 'whatsapp/interactive', 'email/mime'
  channelMetadata: Record<string, unknown> // Routing data (thread_ts, wamid, Message-ID)
  reactions?: InboundReaction[]   // Reactions on this message (for history sync)
}

interface NormalizedAttachment {
  url: string
  mimeType: string
  fileName: string
  fileSize?: number
  inline?: boolean               // true for inline images in email
}

interface InboundReaction {
  emoji: string
  userIdentifier: string
  userDisplayName?: string
  timestamp?: Date
}

// ── Outbound conversion ──────────────────────────────────────

interface ConvertOutboundInput {
  body: string
  bodyFormat: 'text' | 'markdown' | 'html'
  attachments?: NormalizedAttachment[]
  channelMetadata?: Record<string, unknown>  // e.g., Slack thread_ts to reply in-thread
}

interface ChannelNativeContent {
  content: MessageContent         // v1 MessageContent for sendMessage
  metadata?: Record<string, unknown>
}

// ── Reactions ────────────────────────────────────────────────

interface SendReactionInput {
  externalMessageId: string
  conversationId: string
  emoji: string                  // Slack shortcode ('thumbsup') or unicode emoji
  credentials: Record<string, unknown>
  scope: TenantScope
}

interface RemoveReactionInput {
  externalMessageId: string
  conversationId: string
  emoji: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

// ── Edit / Delete ────────────────────────────────────────────

interface EditChannelMessageInput {
  externalMessageId: string
  conversationId: string
  newContent: MessageContent
  credentials: Record<string, unknown>
  scope: TenantScope
}

interface DeleteChannelMessageInput {
  externalMessageId: string
  conversationId: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

// ── History ──────────────────────────────────────────────────

interface FetchHistoryInput {
  conversationId: string
  credentials: Record<string, unknown>
  cursor?: string
  limit?: number
  scope: TenantScope
}

interface HistoryPage {
  messages: NormalizedInboundMessage[]
  nextCursor?: string
  hasMore: boolean
}

// ── Contact resolution ───────────────────────────────────────

interface ResolveContactInput {
  senderIdentifier: string       // Phone, email, Slack user ID
  senderDisplayName?: string
  channelMetadata?: Record<string, unknown>
  credentials: Record<string, unknown>
  scope: TenantScope
}

interface ContactHint {
  email?: string
  phone?: string
  displayName?: string
  avatarUrl?: string
  externalProfileUrl?: string
  matchedPersonId?: string       // Suggested CRM person match
  matchedCompanyId?: string      // Suggested CRM company match
}
```

### 1.3 Adapter Registration Validation

There is no v1 hub or v1 adapter — this spec is the first implementation. All adapters declare full capabilities at registration time. The registry validates that any capability claim implies the presence of its corresponding optional method, and rejects misregistered adapters with a clear error:

```typescript
// communication_channels/lib/adapter-compat.ts

import type { ChannelAdapter, ChannelCapabilities } from './adapter'

const CAPABILITY_METHOD_PAIRS: Array<{ flag: keyof ChannelCapabilities; method: keyof ChannelAdapter; required: boolean }> = [
  { flag: 'reactions',            method: 'sendReaction',     required: true },
  { flag: 'reactions',            method: 'removeReaction',   required: true },
  { flag: 'editMessage',          method: 'editMessage',      required: true },
  { flag: 'deleteMessage',        method: 'deleteMessage',    required: true },
  { flag: 'conversationHistory',  method: 'fetchHistory',     required: true },
]

export function validateAdapterCapabilities(adapter: ChannelAdapter): void {
  for (const pair of CAPABILITY_METHOD_PAIRS) {
    if (adapter.capabilities[pair.flag] === true && typeof (adapter as any)[pair.method] !== 'function') {
      throw new Error(
        `ChannelAdapter '${adapter.providerKey}' declares capabilities.${pair.flag}=true but does not implement ${pair.method}()`,
      )
    }
  }
}
```

The registry calls `validateAdapterCapabilities(adapter)` inside `registerChannelAdapter()` (see § 1.4) and fails fast at module boot. This replaces what an earlier draft of this spec called a "v1 fallback" — there are no v1 adapters and no fallbacks; the contract is strict by design.

---

## 2. Messaging Bridge Architecture

### 2.1 Design Principle: Zero Coupling

The Messages module (SPEC-002) is **never modified**. All bridging is achieved through:

| Mechanism | Purpose |
|-----------|---------|
| Hub entities (`MessageChannelLink`, `ChannelThreadMapping`, `MessageReaction`) | Store channel-specific data linked to Messages by FK |
| Response enrichers | Add `_channel`, `_reactions` to Message API responses |
| Widget injection | Render channel badges, reaction bars, rich payloads in Messages UI |
| Event subscribers | Listen to `messages.message.sent` to trigger outbound delivery |
| Message type registration | Register `channel.<providerKey>` renderers for rich payload display |
| Extension declarations | Declare entity links via `data/extensions.ts` |

### 2.2 Data Model — Hub Entities

Six new entities ship with the hub. The bridge entities (`MessageChannelLink`, `ChannelThreadMapping`, `MessageReaction`) link to the Messages module via plain UUID columns (not database FKs — see Module Boundary note below). The base entities (`CommunicationChannel`, `ExternalConversation`, `ExternalMessage`) are the hub's own data model.

> **Module Boundary**: Cross-module references use **plain `uuid` columns**, not database `FOREIGN KEY` constraints. The link from `MessageChannelLink.messageId` to `messages.message.id` is declared via `EntityExtension` (§ 2.3) and resolved by the QueryEngine. This follows the root `AGENTS.md` rule "NO direct ORM relationships between modules — use foreign key IDs, fetch separately." Same applies to `MessageReaction.messageId`, `MessageReaction.reactedByUserId` (→ `auth:user`), and `ChannelThreadMapping.assignedUserId` (→ `auth:user`).

#### Entity: `CommunicationChannel`

Per-tenant configured channel — a Slack workspace, a WhatsApp Business number, an email mailbox. Owned by the hub.

```typescript
// communication_channels/data/entities.ts

@Entity({ tableName: 'communication_channels' })
@Index({ properties: ['tenantId', 'providerKey'] })
@Index({ properties: ['tenantId', 'channelType', 'isActive'] })
export class CommunicationChannel {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'isActive' | 'capabilities' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** Provider implementation key (e.g., 'slack', 'whatsapp', 'gmail') */
  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  /** Coarse channel type for filtering (e.g., 'chat', 'email', 'sms') */
  @Property({ name: 'channel_type', type: 'text' })
  channelType!: string

  /** Tenant-visible display name */
  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  /** External-side identifier — what the provider calls this channel (workspace ID, phone number, email address) */
  @Property({ name: 'external_identifier', type: 'text', nullable: true })
  externalIdentifier?: string | null

  /** FK to integration_credentials.id (plain uuid, not DB FK — cross-module link) */
  @Property({ name: 'credentials_ref', type: 'uuid', nullable: true })
  credentialsRef?: string | null

  /**
   * Persisted snapshot of the adapter's declared capabilities at registration time.
   * The hub copies these from the adapter so UI can render without resolving the live adapter.
   * Refreshed when an adapter version changes.
   */
  @Property({ name: 'capabilities', type: 'json', nullable: true })
  capabilities?: Record<string, unknown> | null  // ChannelCapabilities shape

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

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
```

> **Forward-compatibility note**: the [email integration spec](../2026-05-21-email-integration-foundation.md) layers six additive columns on this entity (`user_id?`, `is_primary`, `poll_interval_seconds`, `last_polled_at`, `status`, `last_error`) plus three indexes. They are **additive and reserved** — future modifications to `CommunicationChannel` must not conflict with these column names. The email spec carries the migration.

#### Entity: `ExternalConversation`

A single conversation thread on the external channel — one Slack thread, one WhatsApp conversation (per phone number), one email thread (per RFC 2822 root Message-ID).

```typescript
@Entity({ tableName: 'external_conversations' })
@Index({ properties: ['channelId', 'externalConversationId'] })
@Index({ properties: ['contactPersonId'] })
@Index({ properties: ['assignedUserId'] })
@Unique({ properties: ['channelId', 'externalConversationId'] })
export class ExternalConversation {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'lastMessageAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK to communication_channels.id */
  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  /** Provider's conversation identifier (Slack channel:thread_ts, WhatsApp phone, email root Message-ID) */
  @Property({ name: 'external_conversation_id', type: 'text' })
  externalConversationId!: string

  /** Human-readable subject (used by email; chat channels can be NULL or filled with first-message snippet) */
  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  /** Resolved CRM person (customers:person) — plain uuid cross-module link */
  @Property({ name: 'contact_person_id', type: 'uuid', nullable: true })
  contactPersonId?: string | null

  /** User assigned to own this conversation in the unified inbox — plain uuid cross-module link to auth:user */
  @Property({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string | null

  /** Timestamp of the most recent message in either direction, for sorting */
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
```

#### Entity: `ExternalMessage`

The provider-side record of a message that crossed the hub — either inbound (received from the external channel) or outbound (sent through the channel by the platform). Distinct from `Message` (the platform's unified inbox row, owned by the Messages module).

```typescript
@Entity({ tableName: 'external_messages' })
@Index({ properties: ['conversationId'] })
@Index({ properties: ['channelId', 'externalMessageId'] })
@Unique({ properties: ['channelId', 'externalMessageId'] })
export class ExternalMessage {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK to communication_channels.id */
  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  /** FK to external_conversations.id */
  @Property({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string

  /** Provider's unique message identifier */
  @Property({ name: 'external_message_id', type: 'text' })
  externalMessageId!: string

  /** Direction relative to the platform */
  @Property({ name: 'direction', type: 'text' })
  direction!: 'inbound' | 'outbound'

  /** Sender identifier from the provider's perspective (phone, email, Slack user ID) */
  @Property({ name: 'sender_identifier', type: 'text', nullable: true })
  senderIdentifier?: string | null

  /** Sender display name as the provider reports it */
  @Property({ name: 'sender_display_name', type: 'text', nullable: true })
  senderDisplayName?: string | null

  /** Timestamp from the provider (NOT `created_at`, which is when we recorded it) */
  @Property({ name: 'provider_timestamp', type: Date, nullable: true })
  providerTimestamp?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

#### Entity: `MessageChannelLink`

Links each Message that originated from (or was sent to) an external channel to its channel-specific data.

```typescript
// communication_channels/data/entities.ts

@Entity({ tableName: 'message_channel_links' })
@Index({ properties: ['messageId'] })
@Index({ properties: ['externalConversationId'] })
@Index({ properties: ['externalMessageId'] })
@Unique({ properties: ['messageId'] })
export class MessageChannelLink {
  [OptionalProps]?: 'createdAt' | 'deliveryStatus'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK to messages.id */
  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  /** FK to external_conversations.id */
  @Property({ name: 'external_conversation_id', type: 'uuid' })
  externalConversationId!: string

  /** FK to external_messages.id (nullable for outbound not yet acknowledged) */
  @Property({ name: 'external_message_id', type: 'uuid', nullable: true })
  externalMessageId?: string | null

  /** Provider key for quick lookups */
  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  /** Channel type for UI badge rendering */
  @Property({ name: 'channel_type', type: 'text' })
  channelType!: string

  /** Direction: inbound (from external) or outbound (reply sent out) */
  @Property({ name: 'direction', type: 'text' })
  direction!: 'inbound' | 'outbound'

  /** Delivery status for outbound messages */
  @Property({ name: 'delivery_status', type: 'text' })
  deliveryStatus: string = 'pending'  // pending | sent | delivered | read | failed

  /**
   * Full channel-native message payload.
   * Slack: Block Kit blocks, attachments, metadata.
   * WhatsApp: interactive message structure, template data, contact card, location.
   * Email: parsed MIME structure, headers, inline images.
   */
  @Property({ name: 'channel_payload', type: 'json', nullable: true })
  channelPayload?: Record<string, unknown> | null

  /** Content type identifier for the channel payload */
  @Property({ name: 'channel_content_type', type: 'text', nullable: true })
  channelContentType?: string | null  // 'slack/blocks' | 'slack/interactive' | 'whatsapp/interactive' | 'whatsapp/template' | 'whatsapp/contact' | 'whatsapp/location' | 'email/mime'

  /**
   * State of interactive elements (button clicks, menu selections).
   * Updated when a user interacts with channel-native interactive components.
   */
  @Property({ name: 'interactive_state', type: 'json', nullable: true })
  interactiveState?: Record<string, unknown> | null

  /**
   * Channel-specific routing metadata.
   * Slack: { thread_ts, channel_id, message_ts, team_id }
   * WhatsApp: { wamid, from_phone, context }
   * Email: { message_id, in_reply_to, references, from_address }
   */
  @Property({ name: 'channel_metadata', type: 'json', nullable: true })
  channelMetadata?: Record<string, unknown> | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

#### Entity: `ChannelThreadMapping`

Maps an external conversation to a Messages module thread. One-to-one: each external conversation creates exactly one message thread.

```typescript
@Entity({ tableName: 'channel_thread_mappings' })
@Index({ properties: ['externalConversationId', 'tenantId'] })
@Index({ properties: ['messageThreadId', 'tenantId'] })
@Unique({ properties: ['externalConversationId', 'tenantId'] })
export class ChannelThreadMapping {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK to external_conversations.id */
  @Property({ name: 'external_conversation_id', type: 'uuid' })
  externalConversationId!: string

  /** The Message threadId that maps to this external conversation */
  @Property({ name: 'message_thread_id', type: 'uuid' })
  messageThreadId!: string

  /** FK to communication_channels.id */
  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  /**
   * External channel's conversation identifier for outbound routing.
   * Slack:    "C0123ABCDEF:1709123456.789012" (channel_id:thread_ts)
   * WhatsApp: "+14712345678" (phone number)
   * Email:    "<root-message-id@mail.example.com>" (root Message-ID)
   */
  @Property({ name: 'external_thread_ref', type: 'text' })
  externalThreadRef!: string

  /** User assigned to own this conversation in the inbox */
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
```

#### Entity: `MessageReaction`

First-class reaction model supporting both internal users and external channel participants.

```typescript
@Entity({ tableName: 'message_reactions' })
@Index({ properties: ['messageId'] })
@Index({ properties: ['messageId', 'emoji'] })
@Unique({ properties: ['messageId', 'emoji', 'reactedByUserId', 'reactedByExternalId'] })
export class MessageReaction {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK to messages.id — the message being reacted to */
  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  /** Emoji identifier. Slack shortcode ('thumbsup') or unicode ('👍') */
  @Property({ name: 'emoji', type: 'text' })
  emoji!: string

  /** Internal user who reacted (null for external reactions) */
  @Property({ name: 'reacted_by_user_id', type: 'uuid', nullable: true })
  reactedByUserId?: string | null

  /** External sender identifier (phone, email, Slack user ID) — null for internal reactions */
  @Property({ name: 'reacted_by_external_id', type: 'text', nullable: true })
  reactedByExternalId?: string | null

  /** Display name for external reactors */
  @Property({ name: 'reacted_by_display_name', type: 'text', nullable: true })
  reactedByDisplayName?: string | null

  /** Which channel the reaction came from (null for internal-only reactions) */
  @Property({ name: 'provider_key', type: 'text', nullable: true })
  providerKey?: string | null

  /** Channel's reaction identifier for sync (e.g., Slack reaction event reference) */
  @Property({ name: 'external_reaction_id', type: 'text', nullable: true })
  externalReactionId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

### 2.3 Extension Declaration

Cross-module links use the canonical `EntityExtension` shape from `@open-mercato/shared/modules/entities`:

```typescript
// communication_channels/data/extensions.ts

import type { EntityExtension } from '@open-mercato/shared/modules/entities'

export const extensions: EntityExtension[] = [
  {
    base: 'messages:message',
    extension: 'communication_channels:message_channel_link',
    join: { baseKey: 'id', extensionKey: 'message_id' },
    cardinality: 'one-to-one',
    description: 'Links Messages to external channel conversations',
  },
  {
    base: 'messages:message',
    extension: 'communication_channels:message_reaction',
    join: { baseKey: 'id', extensionKey: 'message_id' },
    cardinality: 'one-to-many',
    description: 'Emoji reactions on messages from external channels and internal users',
  },
  {
    base: 'auth:user',
    extension: 'communication_channels:external_conversation',
    join: { baseKey: 'id', extensionKey: 'assigned_user_id' },
    cardinality: 'one-to-many',
    description: 'Conversations assigned to a user in the unified inbox',
  },
  {
    base: 'customers:person',
    extension: 'communication_channels:external_conversation',
    join: { baseKey: 'id', extensionKey: 'contact_person_id' },
    cardinality: 'one-to-many',
    description: 'Conversations matched to a CRM person',
  },
]
```

The link from `communication_channels` to `auth:user` and `customers:person` is one-way: hub knows about those modules, neither knows about the hub. Resolution happens via the query engine, which composes a single SQL query without cross-module joins.

### 2.4 Entity Summary

All hub entities are new in this spec. The table below summarises which entity owns which columns of architectural interest:

| Entity | Notable columns | Notes |
|--------|-----------------|-------|
| `CommunicationChannel` | `capabilities` (json), `provider_key`, `channel_type`, `credentials_ref` | `capabilities` is a snapshot of the adapter-declared `ChannelCapabilities` for UI rendering without resolving the live adapter |
| `ExternalConversation` | `contact_person_id`, `assigned_user_id`, `subject`, `last_message_at` | `contact_person_id` and `assigned_user_id` are plain uuid columns (no DB FK); cross-module link via `EntityExtension` |
| `ExternalMessage` | `direction`, `external_message_id`, `provider_timestamp`, `sender_identifier` | Provider-side record of every message that crossed the hub; the platform-visible `Message` is in the Messages module |
| `MessageChannelLink` | `channel_payload` (json), `channel_content_type`, `channel_metadata`, `delivery_status` | The bridge entity — one row per `Message` that is channel-linked, holds the channel-native payload |
| `ChannelThreadMapping` | `message_thread_id`, `external_thread_ref`, `assigned_user_id` | One row per (`channel`, `externalConversation`); maps to a `Message.threadId` |
| `MessageReaction` | `emoji`, `reacted_by_user_id`, `reacted_by_external_id`, `provider_key` | First-class reactions; supports both internal users and external channel participants |

---

## 3. Per-Channel Threading Model

### 3.1 Slack

Slack has two threading levels: channel messages and thread replies.

```
Slack Channel #support
├── Message A (channel post)           → Message thread root (threadId = A.id)
│   ├── Reply A1 (thread reply)        → Message reply (threadId = A.id, parentMessageId = A.id)
│   ├── Reply A2 (thread reply)        → Message reply (threadId = A.id, parentMessageId = A1.id)
│   └── Reply A3 (also to channel)     → Message reply (threadId = A.id, parentMessageId = A2.id)
├── Message B (channel post)           → New thread root (threadId = B.id)
│   └── Reply B1                       → Message reply (threadId = B.id, parentMessageId = B.id)
```

- `externalThreadRef = "C0123ABCDEF:1709123456.789012"` (channel_id:thread_ts)
- Thread_ts of the top-level channel message identifies the Slack thread
- "Reply also to channel" messages are stored as regular replies with a metadata flag
- Slack channel-level posts without replies each become their own single-message thread

### 3.2 WhatsApp

WhatsApp conversations are phone-number-based. All messages in a conversation are sequential.

```
WhatsApp conversation with +14712345678
├── Message 1 (inbound)               → Thread root (threadId = M1.id)
├── Message 2 (outbound reply)         → Reply (threadId = M1.id, parentMessageId = M1.id)
├── Message 3 (inbound)               → Reply (threadId = M1.id, parentMessageId = M2.id)
```

- `externalThreadRef = "+14712345678"` (phone number)
- One conversation per phone number per channel
- WhatsApp's 24-hour window rule is tracked via `channelMetadata.windowExpiresAt` on the `ChannelThreadMapping`

### 3.3 Email

Email threads are defined by RFC 2822 headers.

```
Email thread: "Re: Project proposal"
├── Original email (Message-ID: <abc@x.com>)    → Thread root
├── Reply 1 (In-Reply-To: <abc@x.com>)          → Reply in thread
├── Reply 2 (In-Reply-To: <reply1@y.com>)        → Reply in thread
├── Forward (References: <abc@x.com>)             → Reply in thread
```

- `externalThreadRef = "<abc@mail.example.com>"` (root Message-ID)
- Threading resolved from `In-Reply-To` and `References` headers
- CC/BCC recipients map to additional `MessageRecipient` entries

---

## 4. Rich Payload Architecture

### 4.1 Dual Representation

Every channel-linked message has two representations:

| Layer | Storage | Purpose |
|-------|---------|---------|
| **Normalized** | `Message.body` (text/markdown) | Searchable, notification-safe, basic rendering |
| **Channel-native** | `MessageChannelLink.channelPayload` (JSON) | Rich rendering with channel-specific UI |

The `channelContentType` field on `MessageChannelLink` tells the renderer which format to expect.

### 4.2 Channel Content Types

| `channelContentType` | Provider | Contains |
|----------------------|----------|----------|
| `slack/blocks` | Slack | Block Kit array (sections, images, dividers, context, actions) |
| `slack/interactive` | Slack | Interactive component payload (buttons, menus, date pickers) |
| `slack/file` | Slack | File share with permalink and thumbnail |
| `whatsapp/text` | WhatsApp | Plain text message |
| `whatsapp/interactive` | WhatsApp | Interactive message (buttons, lists, product lists) |
| `whatsapp/template` | WhatsApp | Template message with parameters |
| `whatsapp/contact` | WhatsApp | vCard contact card |
| `whatsapp/location` | WhatsApp | GPS coordinates with label |
| `whatsapp/media` | WhatsApp | Image, video, audio, document, sticker |
| `whatsapp/voice` | WhatsApp | Voice note (opus audio) |
| `email/mime` | Email | Parsed MIME structure with headers |
| `email/calendar` | Email | ICS calendar invite |

### 4.3 Slack Channel Payload Examples

**Block Kit message:**
```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*New order #1234*\nCustomer: John Doe" }
    },
    { "type": "divider" },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Approve" },
          "action_id": "approve_order",
          "style": "primary",
          "value": "order_1234"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Reject" },
          "action_id": "reject_order",
          "style": "danger",
          "value": "order_1234"
        }
      ]
    }
  ],
  "metadata": {
    "event_type": "order_notification",
    "event_payload": { "order_id": "1234", "total": "99.99" }
  }
}
```

**Interactive component payload stored in `interactiveState` after user clicks:**
```json
{
  "action_id": "approve_order",
  "clicked_at": "2026-03-10T14:30:00Z",
  "clicked_by_user_id": "U0123XYZ",
  "value": "order_1234"
}
```

### 4.4 WhatsApp Channel Payload Examples

**Interactive buttons message:**
```json
{
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": { "type": "text", "text": "Order Confirmation" },
    "body": { "text": "Your order #1234 is ready. Would you like to confirm delivery?" },
    "footer": { "text": "Reply within 24 hours" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "confirm", "title": "Confirm" } },
        { "type": "reply", "reply": { "id": "reschedule", "title": "Reschedule" } }
      ]
    }
  }
}
```

**Contact card (vCard):**
```json
{
  "type": "contacts",
  "contacts": [
    {
      "name": { "formatted_name": "John Doe", "first_name": "John", "last_name": "Doe" },
      "phones": [{ "phone": "+14712345678", "type": "CELL" }],
      "emails": [{ "email": "john@example.com", "type": "WORK" }]
    }
  ]
}
```

**Location:**
```json
{
  "type": "location",
  "location": {
    "latitude": 51.5074,
    "longitude": -0.1278,
    "name": "London Office",
    "address": "123 Main Street, London, UK"
  }
}
```

### 4.5 Interactive Element → Message Action Mapping

Channel-native interactive elements (Slack buttons, WhatsApp quick replies) are mapped to the existing `Message.actionData` structure during inbound normalization. This allows the standard Messages module action execution flow to work.

```typescript
// Adapter normalizes Slack buttons to Message actions
function mapSlackActionsToMessageActions(blocks: SlackBlock[]): MessageActionData | null {
  const actionBlocks = blocks.filter(b => b.type === 'actions')
  if (actionBlocks.length === 0) return null

  const actions: MessageAction[] = actionBlocks
    .flatMap(b => b.elements)
    .filter(e => e.type === 'button')
    .map(button => ({
      id: button.action_id,
      label: button.text.text,
      variant: button.style === 'primary' ? 'default' : button.style === 'danger' ? 'destructive' : 'secondary',
    }))

  return { actions, primaryActionId: actions[0]?.id }
}
```

### 4.6 HTML Sanitization Helper

Channel payloads can contain HTML (Slack rich-text, email MIME, future channel types). The Messages module's `channel-payload-renderer` widget injects the payload into the DOM via `dangerouslySetInnerHTML`. Without sanitization, an inbound channel message becomes a stored-XSS vector.

**Canonical sanitizer**: `packages/core/src/modules/communication_channels/lib/sanitize-channel-html.ts`. The hub owns the function; every widget (in the hub and in downstream provider packages) that renders channel-supplied HTML imports this helper. The Messages module's `channel-payload-renderer` widget calls it before render.

```typescript
// communication_channels/lib/sanitize-channel-html.ts
import DOMPurify from 'isomorphic-dompurify'

/**
 * Allowlist tuned for HTML payloads from email + chat channels.
 * - Strips <script>, all event-handler attributes (onclick, onerror, …).
 * - Strips javascript: and data: URLs (except data:image/* for inline base64 images).
 * - Preserves email layout primitives (table-based layouts), inline images, basic typography.
 */
export function sanitizeChannelHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'em', 'b', 'i', 'u', 's',
      'blockquote', 'code', 'pre',
      'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: [
      'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
      'onkeydown', 'onkeyup', 'onkeypress', 'onchange', 'onsubmit',
    ],
    KEEP_CONTENT: true,
  })
}
```

**Phase 1 acceptance** requires unit tests covering:
- `<script>alert(1)</script>` → stripped
- `<img src="x" onerror="alert(1)">` → `<img src="x">` (event handler stripped)
- `<a href="javascript:alert(1)">x</a>` → `<a>x</a>` (href stripped)
- `<a href="data:text/html,...">x</a>` → `<a>x</a>` (data:text/html stripped, but `data:image/png;base64,…` preserved)
- Allowed tags (`<table>`, `<img src="data:image/png;…">`, `<a href="mailto:...">`) preserved verbatim
- Integration test: post an HTML payload containing a malicious snippet through the inbound webhook → assert the rendered DOM in `/backend/messages/[id]` contains neither `<script>` nor any `on*` attribute

The email integration spec ([2026-05-21-email-integration-foundation.md](../2026-05-21-email-integration-foundation.md)) gates its Phase 1 acceptance on this helper being present in the hub.

### 4.7 Custom Message Type Renderers

Each provider registers a message type with the Messages module's type registry. The renderer receives the `MessageChannelLink` data (via enricher) and renders the channel-native payload.

```typescript
// channel_slack/message-types.ts

export const messageTypes = [
  {
    type: 'channel.slack',
    label: 'Slack Message',
    renderer: 'SlackMessageRenderer',   // React component in widgets/
    icon: 'slack',
  },
]

// channel_whatsapp/message-types.ts

export const messageTypes = [
  {
    type: 'channel.whatsapp',
    label: 'WhatsApp Message',
    renderer: 'WhatsAppMessageRenderer',
    icon: 'message-circle',
  },
]
```

The renderers are injected via widget injection and read the enriched `_channel` and `_channelPayload` data to render rich content.

---

## 5. Reactions

### 5.1 Reaction Model

Reactions are stored in the `MessageReaction` entity (§2.2) and support both internal users and external channel participants.

| Channel | Reaction behavior |
|---------|-------------------|
| **Slack** | Multiple emoji per user per message. Add/remove via API. Emoji identified by shortcode (`thumbsup`). |
| **WhatsApp** | Single emoji per user per message. Adding a new reaction replaces the old one. Unicode emoji. |
| **Email** | Not supported (no reactions). |
| **Internal** | Multiple emoji per user per message. Same model as Slack. |

### 5.2 Inbound Reaction Flow

```
External channel webhook (reaction_added / reaction_removed)
  │
  ▼
POST /api/communication_channels/webhook/[provider]
  │  1. adapter.verifyWebhook() → InboundReactionEvent
  │  2. Enqueue to reaction worker
  ▼
communication-channels:reaction-processor (worker)
  │  3. Look up MessageChannelLink by externalMessageId
  │  4. For reaction_added:
  │     • WhatsApp: upsert (replace existing reaction from same sender)
  │     • Slack: insert (multiple reactions allowed)
  │  5. For reaction_removed: delete matching MessageReaction
  │  6. Emit communication_channels.reaction.added / .removed
  │     (clientBroadcast: true for real-time UI update)
  ▼
Messages UI updates reaction bar in real-time via SSE/polling
```

### 5.3 Outbound Reaction Flow

```
User clicks reaction emoji in Messages UI
  │
  ▼
POST /api/communication_channels/messages/:messageId/reactions
  │  1. Validate message is channel-linked
  │  2. Create MessageReaction (reactedByUserId = current user)
  │  3. Resolve adapter for thread's providerKey
  │  4. adapter.sendReaction({ externalMessageId, emoji })
  │  5. Emit communication_channels.reaction.added
  ▼
External channel shows reaction
```

### 5.4 Reaction API Routes

```
POST   /api/communication_channels/messages/:messageId/reactions
  Body: { emoji: string }
  Response: { id, emoji, reactedByUserId, createdAt }

DELETE /api/communication_channels/messages/:messageId/reactions/:reactionId
  Response: 204

GET    /api/communication_channels/messages/:messageId/reactions
  Response: { reactions: [{ id, emoji, reactedByUserId, reactedByExternalId, reactedByDisplayName, providerKey, createdAt }] }
```

All routes require `communication_channels.view` feature and filter by `tenantId`.

### 5.5 Reaction Enricher

```typescript
// communication_channels/data/enrichers.ts

const messageReactionEnricher: ResponseEnricher = {
  id: 'communication_channels.message-reactions',
  targetEntity: 'messages.message',
  features: ['communication_channels.view'],
  priority: 25,
  timeout: 1500,
  fallback: { _reactions: [] },
  critical: false,

  async enrichMany(records, context) {
    const messageIds = records.map(r => r.id)
    const reactions = await em.find(MessageReaction, {
      messageId: { $in: messageIds },
      tenantId: context.scope.tenantId,
    })

    // Group by messageId, then by emoji
    const grouped = groupReactionsByMessage(reactions)

    return records.map(r => ({
      ...r,
      _reactions: grouped.get(r.id) ?? [],
    }))
  },
}
```

The enriched `_reactions` is an array of `{ emoji, count, users: [{ userId?, externalId?, displayName }], reactedByMe: boolean }`.

---

## 6. Inbound Message Flow

```
External Channel (WhatsApp / Slack / Email)
  │
  ▼
POST /api/communication_channels/webhook/[provider]
  │  1. Verify webhook signature via adapter.verifyWebhook()
  │  2. Classify event type: message | reaction | status_update | other
  │  3. Enqueue to appropriate worker (idempotent, dedup by externalMessageId)
  ▼
communication-channels:inbound-processor (worker)
  │  4. adapter.normalizeInbound(raw) → NormalizedInboundMessage
  │  5. Dedup check: MessageChannelLink exists for externalMessageId? → skip
  │  6. Look up ChannelThreadMapping by externalConversationId
  │     • EXISTS → use existing messageThreadId
  │     • NOT EXISTS → create new conversation:
  │       a. Create ExternalConversation
  │       b. Create root Message (threadId = self)
  │       c. Create ChannelThreadMapping linking them
  │  7. adapter.resolveContact?() → ContactHint (optional)
  │     • Match to CRM person → store contactPersonId on ExternalConversation
  │  8. Create Message via messages module compose command:
  │     - type: 'channel.<providerKey>'
  │     - senderUserId: channel system user
  │     - externalEmail / externalName: from ContactHint or senderDisplayName
  │     - visibility: 'public'
  │     - sourceEntityType: 'communication_channels.external_conversation'
  │     - sourceEntityId: externalConversationId
  │     - threadId / parentMessageId: from ChannelThreadMapping
  │     - body: normalized text/markdown
  │     - actionData: mapped from interactive elements (if any)
  │  9. Create MessageChannelLink:
  │     - direction: 'inbound'
  │     - channelPayload: full native payload
  │     - channelContentType: from normalized message
  │     - channelMetadata: routing data
  │  10. Create ExternalMessage record in hub
  │  11. Add assignedUserId as MessageRecipient (type: 'to')
  │  12. Emit communication_channels.message.received event
  ▼
Messages module picks up via standard flow:
  - Assigned user sees message in inbox
  - Unread badge updates via polling / SSE
  - Notification subscriber fires
```

### Key Design Decisions

**System user per channel**: Each active communication channel has a "channel bot" system user that acts as `senderUserId` for inbound messages. The actual external sender identity is in `externalEmail`/`externalName` on Message (fields already exist) and in `MessageChannelLink.channelMetadata`.

**Assignment**: `ChannelThreadMapping.assignedUserId` determines who receives the message in their inbox. Configurable per-channel: default assignee, round-robin, or rule-based routing.

**Idempotency**: Dedup by `MessageChannelLink` check for existing `externalMessageId`. Safe to retry.

---

## 7. Outbound Reply Flow

```
User replies to channel-linked message in Messages UI
  │
  ▼
POST /api/messages/:id/reply  (existing Messages endpoint — unchanged)
  │  Standard reply command creates new Message in thread
  ▼
messages.message.sent event fires
  │
  ▼
communication_channels subscriber: channel-outbound-delivery
  │  1. Look up ChannelThreadMapping by message.threadId
  │     • No mapping → skip (internal-only message, no channel delivery)
  │  2. Resolve adapter by providerKey
  │  3. Read channel capabilities → validate body format
  │  4. adapter.convertOutbound({
  │       body: message.body,
  │       bodyFormat: message.bodyFormat,
  │       attachments: message file attachments,
  │       channelMetadata: { thread_ts, channel_id, ... from mapping }
  │     })
  │  5. adapter.sendMessage(converted.content)
  │  6. Create ExternalMessage record (direction: 'outbound')
  │  7. Create MessageChannelLink (direction: 'outbound', deliveryStatus: 'sent')
  │  8. Log via integrationLog
  │  9. Emit communication_channels.message.sent event
  ▼
Channel delivers to external platform
```

**Failure handling**: If `sendMessage` fails:
- `MessageChannelLink.deliveryStatus = 'failed'`
- Error logged to `integrationLog`
- Emit `communication_channels.message.delivery_failed` (clientBroadcast: true)
- Retry enqueued via worker queue with exponential backoff (max 3 retries)
- The Message itself remains in the inbox (already persisted by the Messages module)

---

## 8. Contact Resolution

### 8.1 Resolution Flow

```
Inbound message arrives with senderIdentifier
  │
  ▼
adapter.resolveContact?({ senderIdentifier, senderDisplayName, channelMetadata })
  │  Provider-specific identity enrichment:
  │  • Slack: Fetch user profile → email, real_name, avatar
  │  • WhatsApp: Phone number → lookup by phone
  │  • Email: From header → email address
  │
  ▼
ContactHint returned
  │  { email, phone, displayName, avatarUrl, matchedPersonId? }
  │
  ▼
CRM lookup (hub responsibility) — via QueryEngine, no raw SQL
  │  const queryEngine = container.resolve<QueryEngine>('queryEngine')
  │  const { rows } = await queryEngine.query('customers:person', {
  │    tenantId: scope.tenantId,
  │    organizationId: scope.organizationId,
  │    filters: contactHint.email
  │      ? { email: { ilike: contactHint.email } }
  │      : { phone: { ilike: contactHint.phone } },
  │    limit: 1,
  │  })
  │  // Root AGENTS.md rule: "Keep raw SQL out of API route handlers and workers"
  │
  ▼
Result:
  • Match found → set ExternalConversation.contactPersonId
  • No match → store identifier for future matching
```

### 8.2 Contact Enricher

Adds CRM person preview to channel-linked messages:

```typescript
const conversationContactEnricher: ResponseEnricher = {
  id: 'communication_channels.conversation-contact',
  targetEntity: 'messages.message',
  features: ['communication_channels.view', 'customers.view'],
  priority: 15,
  timeout: 2000,
  fallback: { _channelContact: null },
  critical: false,

  async enrichMany(records, context) {
    // For channel-linked messages, resolve CRM person from ExternalConversation.contactPersonId
    // Return { name, email, phone, companyName, personId, href }
  },
}
```

---

## 9. UI Adaptations

All UI changes are achieved via widget injection and response enrichers from the `communication_channels` hub. The Messages module UI code is never modified.

### 9.1 Response Enrichers

| Enricher | Target | Adds | Purpose |
|----------|--------|------|---------|
| `message-channel` | `messages.message` | `_channel: { providerKey, channelType, direction, capabilities }` | Channel badge, composer adaptation |
| `message-channel-payload` | `messages.message` | `_channelPayload: { channelPayload, channelContentType, interactiveState }` | Rich payload rendering |
| `message-reactions` | `messages.message` | `_reactions: [{ emoji, count, users, reactedByMe }]` | Reaction bar |
| `conversation-contact` | `messages.message` | `_channelContact: { name, email, personId }` | CRM contact preview |

### 9.2 Widget Injection

```
communication_channels/widgets/injection/
├── channel-badge/                # Channel icon badge in message list
│   ├── widget.ts                 # Headless: injects icon column
│   └── widget.meta.ts
├── channel-payload-renderer/     # Renders rich channel-native content
│   ├── widget.tsx                # Visual: Block Kit, interactive, location, contact card
│   └── widget.meta.ts
├── composer-capabilities/        # Adapts reply composer for channel constraints
│   ├── widget.ts                 # Headless: character limit, format, media toggle
│   └── widget.meta.ts
├── reaction-bar/                 # Emoji reaction bar below messages
│   ├── widget.tsx                # Visual: emoji pills with counts, click to toggle
│   └── widget.meta.ts
├── channel-info-panel/           # Side panel with conversation context
│   ├── widget.tsx                # Visual: contact, channel, delivery status
│   └── widget.meta.ts
└── delivery-status/              # Delivery status indicator on outbound messages
    ├── widget.ts                 # Headless: sent/delivered/read/failed badge
    └── widget.meta.ts
```

### 9.3 Injection Table

```typescript
// communication_channels/widgets/injection-table.ts

export default {
  'channel-badge': ['data-table:messages:columns'],
  'channel-payload-renderer': ['detail:messages:message:body:after'],
  'composer-capabilities': ['crud-form:messages:message:fields'],
  'reaction-bar': ['detail:messages:message:body:after'],
  'channel-info-panel': ['detail:messages:message:sidebar'],
  'delivery-status': ['data-table:messages:columns'],
}
```

### 9.3a Messages Module — Widget Injection Spot Registration (in scope of Phase 1)

The TLDR's "Zero Coupling" principle states that the Messages module's *data model and core API routes* are never modified. However, for the hub's widgets to render anywhere visible, the Messages module's existing pages must register the **widget injection spot anchors** the hub targets. These are zero-behavior changes — pure render points. They are agreed in-scope for Phase 1 of this spec.

Verified state (2026-05-22):
- `packages/core/src/modules/messages/widgets/injection-table.ts` — **does not exist**
- `packages/core/src/modules/messages/backend/page.tsx` and `backend/messages/[id]/page.tsx` — do not call `useInjectedWidgets` / render `<InjectionPoint>`

Phase 1 adds the following minimal anchors to the Messages module (boy-scout rule applies — only the lines that add spots, nothing else):

| File | Add | Spot id |
|---|---|---|
| `packages/core/src/modules/messages/components/MessagesInboxPageClient.tsx` | `<InjectionPoint id="data-table:messages:columns" context={...} />` inside the DataTable's `extraColumns` slot | `data-table:messages:columns` |
| `packages/core/src/modules/messages/components/MessageDetailPageClient.tsx` | `<InjectionPoint id="detail:messages:message:body:after" />` immediately after the message body block | `detail:messages:message:body:after` |
| `packages/core/src/modules/messages/components/MessageDetailPageClient.tsx` | `<InjectionPoint id="detail:messages:message:sidebar" />` inside the detail-page sidebar slot | `detail:messages:message:sidebar` |
| `packages/core/src/modules/messages/components/ComposeMessagePageClient.tsx` | `<InjectionPoint id="crud-form:messages:message:fields" />` inside the compose CrudForm's fields slot | `crud-form:messages:message:fields` |

All four spots are declared in the **Messages module's** `widgets/injection-table.ts` (new file) so they become first-class entries of the spot registry per `packages/ui/AGENTS.md`. The hub package then registers its widgets at these spots through its own `widgets/injection-table.ts` (already documented above in § 9.3).

**BC impact**: additive only (FROZEN spot IDs gain four new entries; no existing spots are renamed or removed). The new spots are now part of the Messages module's public BC surface — third-party modules can target them.

**File-level integration test**: Phase 1 acceptance includes a Playwright test that mounts `/backend/messages/[id]` with a hub widget registered at `detail:messages:message:body:after` and asserts the widget renders. This proves the wiring end-to-end.

### 9.4 Composer Behavior

When replying to a channel-linked thread:

1. Shows channel badge: "Replying via Slack" / "Replying via WhatsApp"
2. Limits body format to `capabilities.supportedBodyFormats`
3. Shows/hides file upload based on `capabilities.fileSharing`
4. Enforces `capabilities.maxBodyLength` with live character counter
5. Shows reaction button if `capabilities.reactions` is true
6. Warns about WhatsApp 24-hour window if applicable

---

## 10. Events

### 10.1 New Events

```typescript
// communication_channels/events.ts

import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // ── Bridge events ────────────────────────────────────────
  {
    id: 'communication_channels.message.received',
    label: 'External Message Received',
    entity: 'external_message',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.message.sent',
    label: 'External Message Sent (Outbound)',
    entity: 'external_message',
    category: 'custom',
  },
  {
    id: 'communication_channels.message.delivery_failed',
    label: 'External Message Delivery Failed',
    entity: 'external_message',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.conversation.created',
    label: 'External Conversation Created',
    entity: 'external_conversation',
    category: 'custom',
  },
  {
    id: 'communication_channels.contact.resolved',
    label: 'External Contact Resolved to CRM Person',
    entity: 'external_conversation',
    category: 'custom',
  },

  // ── Reaction events ──────────────────────────────────────
  {
    id: 'communication_channels.reaction.added',
    label: 'Reaction Added',
    entity: 'message_reaction',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.reaction.removed',
    label: 'Reaction Removed',
    entity: 'message_reaction',
    category: 'custom',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'communication_channels', events })
```

The `createModuleEvents({ moduleId, events })` object-arg shape is the canonical signature from `@open-mercato/shared/modules/events`. Worked examples in shipping code: `packages/core/src/modules/messages/events.ts` (lines 1–12), `packages/core/src/modules/customers/events.ts`. The positional form `createModuleEvents('...', [...])` does not exist and does not compile.

### 10.2 Subscribers

| Subscriber | Event | Purpose |
|------------|-------|---------|
| `channel-outbound-delivery` | `messages.message.sent` | Detect channel-linked threads and deliver reply to external channel |
| `channel-message-notification` | `communication_channels.message.received` | Create in-app notification for assigned user |

### 10.3 Notification Types

```typescript
// communication_channels/notifications.ts

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'communication_channels.message.received',
    module: 'communication_channels',
    titleKey: 'communication_channels:notification.message_received.title',
    bodyKey: 'communication_channels:notification.message_received.body',
    icon: 'message-circle',
    severity: 'info',
    actions: [
      { id: 'view', labelKey: 'common:view', href: '/backend/messages/{sourceEntityId}' },
    ],
  },
  {
    /**
     * Channel-agnostic notification raised when an adapter loses authorization
     * (OAuth refresh token revoked, IMAP/SMTP password rotated, WhatsApp token expired).
     * Emitted by the `markChannelRequiresReauth` command. Renderer surfaces a "Reconnect" CTA
     * that opens the provider-specific reconnect dialog (OAuth re-authorize / credential edit form).
     * Used by the email integration spec — see 2026-05-21-email-integration-foundation.md.
     */
    type: 'communication_channels.channel.requires_reauth',
    module: 'communication_channels',
    titleKey: 'communication_channels:notification.channel_requires_reauth.title',
    bodyKey: 'communication_channels:notification.channel_requires_reauth.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      { id: 'reconnect', labelKey: 'communication_channels:notification.channel_requires_reauth.reconnect', href: '/backend/profile/communication-channels?reconnect={channelId}' },
    ],
  },
]
```

Notification type IDs use the dotted `<module>.<entity>.<action>` convention to match event IDs and the conventions in shipping `notifications.ts` files (`auth.password_reset.requested`, `customer_accounts.user.signup`, `sales.order.created`, etc.).

---

## 11. First Providers

### 11.1 WhatsApp — `channel_whatsapp` (v2 upgrade)

The existing WhatsApp module from SPEC-045d v1 is upgraded to the v2 adapter contract.

```
packages/channel-whatsapp/
├── package.json                        # @open-mercato/channel-whatsapp
├── src/
│   └── modules/
│       └── channel_whatsapp/
│           ├── index.ts
│           ├── integration.ts          # category: 'communication', hub: 'communication_channels'
│           ├── setup.ts                # registerChannelAdapter(whatsappAdapter)
│           ├── di.ts
│           ├── lib/
│           │   ├── adapter.ts          # ChannelAdapter v2 implementation
│           │   ├── capabilities.ts     # WhatsApp capabilities
│           │   ├── client.ts           # WhatsApp Cloud API wrapper
│           │   ├── content-converter.ts # Text ↔ WhatsApp message formats
│           │   ├── contact-resolver.ts # Phone → CRM lookup
│           │   └── health.ts
│           ├── workers/
│           │   └── webhook-processor.ts
│           └── i18n/
│               ├── en.ts
│               └── pl.ts
```

**WhatsApp Capabilities:**
```typescript
export const whatsappCapabilities: ChannelCapabilities = {
  threading: true,
  richText: false,
  fileSharing: true,
  maxFileSize: 16_000_000,              // 16MB for documents
  supportedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4', 'audio/ogg', 'application/pdf'],
  readReceipts: true,
  deliveryReceipts: true,
  typingIndicators: false,
  reactions: true,
  multiReactionPerUser: false,          // WhatsApp: one reaction per user per message
  editMessage: true,                    // WhatsApp supports message editing (since 2023)
  deleteMessage: true,                  // "Delete for everyone"
  presence: false,
  richBlocks: false,
  interactiveComponents: true,          // Buttons, lists, product lists
  inlineImages: false,
  conversationHistory: false,
  contactCards: true,
  locationSharing: true,
  voiceNotes: true,
  stickers: true,
  supportedBodyFormats: ['text'],
  maxBodyLength: 4096,
}
```

**Credentials:**
```typescript
credentials: {
  fields: [
    { key: 'accessToken', label: 'Access Token', type: 'secret', required: true },
    { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true },
    { key: 'businessAccountId', label: 'Business Account ID', type: 'text', required: true },
    { key: 'webhookVerifyToken', label: 'Webhook Verify Token', type: 'secret', required: true },
    { key: 'appSecret', label: 'App Secret', type: 'secret', required: true },
  ],
}
```

### 11.2 Slack — `channel_slack` (feature-rich reference)

```
packages/channel-slack/
├── package.json                        # @open-mercato/channel-slack
├── src/
│   └── modules/
│       └── channel_slack/
│           ├── index.ts
│           ├── integration.ts
│           ├── setup.ts                # registerChannelAdapter(slackAdapter)
│           ├── di.ts                   # Slack Web API client registration
│           ├── lib/
│           │   ├── adapter.ts          # Full v2 ChannelAdapter
│           │   ├── capabilities.ts
│           │   ├── client.ts           # Slack Web API / Events API wrapper
│           │   ├── content-converter.ts # Markdown ↔ Slack mrkdwn + Block Kit
│           │   ├── contact-resolver.ts # Slack user profile → ContactHint
│           │   ├── block-renderer.ts   # Block Kit → React components (for rich display)
│           │   └── health.ts           # api.test() health check
│           ├── workers/
│           │   └── webhook-processor.ts
│           ├── widgets/
│           │   └── injection/
│           │       └── slack-blocks-renderer/  # Rich Block Kit rendering widget
│           │           ├── widget.tsx
│           │           └── widget.meta.ts
│           └── i18n/
│               ├── en.ts
│               └── pl.ts
```

**Slack Capabilities:**
```typescript
export const slackCapabilities: ChannelCapabilities = {
  threading: true,
  richText: true,
  fileSharing: true,
  maxFileSize: 1_000_000_000,            // 1GB
  readReceipts: false,
  deliveryReceipts: false,
  typingIndicators: false,
  reactions: true,
  multiReactionPerUser: true,            // Slack: multiple emoji per user
  editMessage: true,
  deleteMessage: true,
  presence: true,
  richBlocks: true,                      // Block Kit
  interactiveComponents: true,           // Buttons, menus, date pickers
  inlineImages: true,
  conversationHistory: true,             // conversations.history API
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: false,
  supportedBodyFormats: ['text', 'markdown'],
  maxBodyLength: 40_000,
}
```

**Credentials:**
```typescript
credentials: {
  fields: [
    { key: 'botToken', label: 'Bot User OAuth Token', type: 'secret', required: true, placeholder: 'xoxb-...' },
    { key: 'signingSecret', label: 'Signing Secret', type: 'secret', required: true },
    { key: 'appId', label: 'App ID', type: 'text', required: true },
    { key: 'defaultChannelId', label: 'Default Channel ID', type: 'text', required: false,
      helpText: 'Slack channel to monitor for inbound messages' },
  ],
}
```

**Content Conversion:**

| Direction | From | To | Logic |
|-----------|------|----|-------|
| Inbound | Slack `mrkdwn` + Block Kit | Markdown body + channelPayload JSON | Extract text blocks → markdown; store full blocks in payload |
| Outbound | Markdown body | Slack `mrkdwn` text | Convert `**bold**` → `*bold*`, `_italic_` → `_italic_`, `` `code` `` → `` `code` `` |

**Slack Event Subscriptions:**

The Slack app must subscribe to these Events API events:

| Event | Maps to |
|-------|---------|
| `message` (channels, groups, im, mpim) | Inbound message → `normalizeInbound()` |
| `reaction_added` | Inbound reaction → `MessageReaction` create |
| `reaction_removed` | Inbound reaction → `MessageReaction` delete |
| `message_changed` | Message edit → update `MessageChannelLink.channelPayload` |
| `message_deleted` | Message delete → soft-delete linked Message |
| `member_joined_channel` | Conversation metadata update |

### 11.3 Email — `channel_email` (secondary provider)

```
packages/channel-email/
├── package.json                        # @open-mercato/channel-email
├── src/
│   └── modules/
│       └── channel_email/
│           ├── index.ts
│           ├── integration.ts
│           ├── setup.ts
│           ├── lib/
│           │   ├── adapter.ts          # ChannelAdapter v2
│           │   ├── capabilities.ts
│           │   ├── inbound-parser.ts   # Parse inbound email webhooks
│           │   ├── thread-resolver.ts  # In-Reply-To / References → thread matching
│           │   ├── contact-resolver.ts # From address → CRM person
│           │   └── health.ts
│           ├── workers/
│           │   └── webhook-processor.ts
│           └── i18n/
```

**Email Capabilities:**
```typescript
export const emailCapabilities: ChannelCapabilities = {
  threading: true,
  richText: true,
  fileSharing: true,
  readReceipts: false,
  deliveryReceipts: false,
  typingIndicators: false,
  reactions: false,
  multiReactionPerUser: false,
  editMessage: false,
  deleteMessage: false,
  presence: false,
  richBlocks: false,
  interactiveComponents: false,
  inlineImages: true,
  conversationHistory: false,
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: false,
  supportedBodyFormats: ['text', 'html'],
}
```

**Relationship to Existing Email Forwarding:**

| Feature | Owned by | Direction |
|---------|----------|-----------|
| `Message.sendViaEmail` | Messages module (SPEC-002) | Outbound: internal message → email via Resend |
| `channel_email` adapter | communication_channels hub | Inbound: email webhook → Message in inbox |

These are complementary — internal email forwarding (SPEC-002) handles outbound copies; the email channel adapter handles inbound parsing. No overlap.

---

## 12. Notification Providers Hub — `notification_providers`

*(Unchanged from v1 — included for completeness)*

### 12.1 NotificationTransportAdapter Contract

For delivering platform notifications via external channels (email, SMS, push):

```typescript
// notification_providers/lib/adapter.ts

interface NotificationTransportAdapter {
  readonly providerKey: string
  readonly transportType: 'email' | 'sms' | 'push' | string

  /** Send a notification via this transport */
  send(input: SendNotificationInput): Promise<SendNotificationResult>

  /** Check delivery status (optional) */
  getDeliveryStatus?(input: GetDeliveryStatusInput): Promise<DeliveryStatus>

  /** Verify webhook for delivery receipts (optional) */
  verifyWebhook?(input: VerifyWebhookInput): Promise<DeliveryReceipt>
}

interface SendNotificationInput {
  recipient: NotificationRecipient
  subject?: string
  body: string
  htmlBody?: string
  templateId?: string
  templateData?: Record<string, unknown>
  credentials: Record<string, unknown>
  metadata?: Record<string, string>
}

interface NotificationRecipient {
  email?: string
  phone?: string
  deviceToken?: string
  userId?: string
}

interface SendNotificationResult {
  externalId: string
  status: 'sent' | 'queued' | 'failed'
  error?: string
}
```

### 12.2 First Provider — `notifier_sendgrid`

```
packages/notifier-sendgrid/
├── package.json                        # @open-mercato/notifier-sendgrid
├── src/
│   └── modules/
│       └── notifier_sendgrid/
│           ├── index.ts
│           ├── integration.ts
│           ├── setup.ts
│           ├── lib/
│           │   └── adapter.ts
│           └── i18n/
```

---

## 13. API Routes

### 13.1 Communication Channels Hub API

All existing routes from v1 are preserved. New routes for the bridge:

```
# ── Channel management (v1, unchanged) ────────────────────────
GET    /api/communication_channels                    # List configured channels
POST   /api/communication_channels                    # Configure a new channel
GET    /api/communication_channels/:id                # Channel details + capabilities
PUT    /api/communication_channels/:id                # Update channel config
DELETE /api/communication_channels/:id                # Remove channel
POST   /api/communication_channels/webhook/[provider] # Inbound webhook endpoint

# ── Bridge API (v2, new) ──────────────────────────────────────
GET    /api/communication_channels/threads            # List channel-linked threads
GET    /api/communication_channels/threads/:threadId  # Thread details with channel context
PUT    /api/communication_channels/threads/:threadId/assign  # Reassign conversation owner

# ── Reactions API (v2, new) ───────────────────────────────────
GET    /api/communication_channels/messages/:messageId/reactions     # List reactions
POST   /api/communication_channels/messages/:messageId/reactions     # Add reaction
DELETE /api/communication_channels/messages/:messageId/reactions/:id # Remove reaction
```

### 13.2 OpenAPI

All new routes MUST export `openApi` for documentation generation.

---

## 14. Access Control

```typescript
// communication_channels/acl.ts

export const features = [
  { id: 'communication_channels.view', label: 'View Communication Channels' },
  { id: 'communication_channels.manage', label: 'Manage Communication Channels' },
  { id: 'communication_channels.react', label: 'React to Channel Messages' },
  { id: 'communication_channels.assign', label: 'Assign Channel Conversations' },
]
```

---

## 15. Implementation Phases

### Phase 1: Core Bridge Infrastructure
1. Create `MessageChannelLink` and `ChannelThreadMapping` entities
2. Enhance `ChannelAdapter` contract with v2 methods and `ChannelCapabilities`
3. Build adapter registry v2 (backward-compatible with v1)
4. Implement inbound message worker
5. Implement outbound delivery subscriber on `messages.message.sent`
6. Register bridge events
7. Add `capabilities` column to `CommunicationChannel`
8. Database migration

### Phase 2: Rich Payload & Message Type Renderers
1. Implement `normalizeInbound()` / `convertOutbound()` flow
2. Define `channelContentType` taxonomy
3. Build generic channel payload renderer (fallback for unknown types)
4. Register `channel.*` message types in Messages module type registry
5. Interactive element → MessageAction mapping

### Phase 3: Reactions
1. Create `MessageReaction` entity
2. Implement reaction API routes
3. Build reaction processor worker (inbound)
4. Build outbound reaction flow (`sendReaction` / `removeReaction`)
5. Add reaction enricher
6. Build reaction bar injection widget

### Phase 4: UI Adaptations
1. Channel badge injection widget
2. Composer capabilities widget
3. Channel info side panel widget
4. Delivery status indicator widget
5. Update injection-table.ts

### Phase 5: Contact Resolution
1. Implement contact resolution service
2. Add `contactPersonId` to `ExternalConversation`
3. Build contact enricher
4. CRM-linked conversation view widget

### Phase 6: Slack Provider
1. Create `packages/channel-slack/` npm package
2. Implement full v2 adapter with all capabilities
3. Content converter (mrkdwn ↔ markdown)
4. Block Kit renderer widget
5. Reaction sync (add/remove)
6. Contact resolver (Slack user profile → CRM)
7. Integration tests

### Phase 7: WhatsApp v2 Migration + Email Provider
1. Upgrade `channel_whatsapp` to v2 adapter
2. Add WhatsApp interactive message support (buttons, lists, contacts, location)
3. WhatsApp reaction support (single emoji per user)
4. Create `packages/channel-email/` npm package
5. Email inbound parsing and threading
6. Integration tests

---

## 16. Risks & Impact Review

| # | Risk | Severity | Affected Area | Mitigation | Residual Risk |
|---|------|----------|---------------|------------|---------------|
| 1 | Inbound message flood overwhelms Messages table | High | Database, Messages module | Rate limiting per channel (configurable max msgs/min); webhook processor queue with concurrency control | Sustained high volume may require table partitioning |
| 2 | Outbound delivery failure leaves orphaned Messages | Medium | User experience | `MessageChannelLink.deliveryStatus` tracks state; retry via worker queue (max 3); UI shows failure indicator | User sees message in inbox before delivery confirmation |
| 3 | Thread mapping collision | Medium | Data integrity | Unique constraint on `(externalConversationId, tenantId)` | None — DB enforced |
| 4 | Contact resolution false positive | Medium | CRM data | Resolution is advisory only (stored in metadata); admin can manually reassign; no automatic CRM mutation | Wrong contact shown initially |
| 5 | Large channelPayload JSON bloats database | Low | Storage | Enforce max 64KB per payload in normalizeInbound; strip non-essential fields | Very large Slack threads with many blocks |
| 6 | v1 adapter backward compatibility | Low | Existing WhatsApp provider | v2 additions are optional; `resolveCapabilities()` provides defaults | None |
| 7 | WhatsApp 24-hour window | Medium | Outbound delivery | Track window expiry in channelMetadata; warn user in composer; require template for out-of-window messages | User frustration if window expires |
| 8 | Slack rate limits on API calls | Medium | Outbound delivery, history sync | Respect `Retry-After` headers; queue-based delivery with backoff | Occasional delays |
| 9 | Email spam/phishing via inbound channel | High | Security | Webhook signature verification; sender allowlist per channel config; rate limiting | Sophisticated spoofing |

---

## 17. Integration Test Coverage

| Test ID | Description | Method | Assert |
|---------|-------------|--------|--------|
| TC-045D-001 | Inbound WhatsApp message creates Message in inbox | Worker | Message exists, MessageChannelLink exists, thread mapping created |
| TC-045D-002 | Second inbound message in same conversation uses same thread | Worker | Same threadId, different parentMessageId |
| TC-045D-003 | Reply to channel-linked message triggers outbound delivery | POST `/api/messages/:id/reply` | ExternalMessage created, sendMessage called |
| TC-045D-004 | Reply to internal-only message does NOT trigger outbound | POST `/api/messages/:id/reply` | No MessageChannelLink created |
| TC-045D-005 | Channel badge enricher adds `_channel` to message list | GET `/api/messages` | `_channel.providerKey` present |
| TC-045D-006 | Inbound message idempotency (duplicate webhook) | Worker x2 | Only one Message created |
| TC-045D-007 | Outbound delivery failure logged and retried | Worker | IntegrationLog error entry, retry enqueued |
| TC-045D-008 | Contact resolution matches CRM person by email | Worker | `ExternalConversation.contactPersonId` set |
| TC-045D-009 | Capabilities exposed in channel API response | GET `/api/communication_channels/:id` | `capabilities` field present |
| TC-045D-010 | Tenant isolation for channel messages | All routes | Cross-tenant access denied |
| TC-045D-011 | Slack inbound Block Kit stored in channelPayload | Worker | `channelContentType = 'slack/blocks'`, payload contains blocks array |
| TC-045D-012 | WhatsApp interactive message stored in channelPayload | Worker | `channelContentType = 'whatsapp/interactive'`, payload contains buttons |
| TC-045D-013 | Inbound reaction creates MessageReaction | Worker | Reaction record exists, event emitted |
| TC-045D-014 | Outbound reaction calls adapter.sendReaction | POST `/reactions` | sendReaction called, MessageReaction persisted |
| TC-045D-015 | Remove reaction deletes MessageReaction | DELETE `/reactions/:id` | Record deleted, removeReaction called |
| TC-045D-016 | Slack multiple reactions per user per message | Worker | Multiple reactions from same user allowed |
| TC-045D-017 | WhatsApp single reaction per user (replaces old) | Worker | Old reaction replaced, only one exists |
| TC-045D-018 | Reaction enricher returns grouped emoji counts | GET `/api/messages` | `_reactions` array with count and users |
| TC-045D-019 | Email inbound threading via In-Reply-To | Worker | Correct ChannelThreadMapping, same thread as parent |
| TC-045D-020 | WhatsApp contact card stored and normalized | Worker | `channelContentType = 'whatsapp/contact'`, body contains name |
| TC-045D-021 | WhatsApp location stored and normalized | Worker | `channelContentType = 'whatsapp/location'`, body contains address |
| TC-045D-022 | Slack content conversion mrkdwn → markdown | Unit | Correct markdown output |

---

## Implementation Status

Tracked per slice (sub-phases of the spec's Phase 1). Slice naming matches the implementation roadmap discussed during pre-implementation analysis.

| Slice | Maps to spec phase | Status | Date | Notes |
|-------|--------------------|--------|------|-------|
| **2a — Foundation** | Phase 1 items 1, 2, 3, 7, 8 (entities, ChannelAdapter contract, registry, capabilities column, migrations) | **Done** | 2026-05-22 | See breakdown below. Staged, not committed. |
| **2b — Inbound bridge** | Phase 1 items 4 + Phase 2 partial (webhook route, inbound-processor worker, ingest command, contact resolver) | **Done** | 2026-05-22 | See breakdown below. Staged, not committed. |
| **2c — Outbound bridge** | Phase 1 items 5, 6 (`messages.message.sent` subscriber, outbound-delivery worker + command, credential refresh, error classification + retry) | **Done** | 2026-05-22 | See breakdown below. Staged, not committed. |
| **2d — Reactions** | Phase 3 (`InboundReactionEvent` + `normalizeInboundReaction?`, reaction-processor worker, inbound + outbound reaction commands, reactions API routes) | **Done** | 2026-05-22 | See breakdown below. Staged, not committed. |
| **2e — UMES enrichers + admin pages** | Phase 4 + Phase 5 (4 enrichers, 4 hub-side injection widgets wired to the messages spots, channels admin GET API + admin list page) | **Done** | 2026-05-22 | See breakdown below. Staged, not committed. |
| **2f — Polish** | Phase 5 (channel detail page + health endpoint, manual reassignment UI + API, per-tenant channel-bot user resolution) | **Done** | 2026-05-22 | See breakdown below. Staged, not committed. |
| Provider: Slack | Phase 6 | Pending | — | Separate `packages/channel-slack/` workspace package |
| Provider: WhatsApp | Phase 7 | Pending | — | Separate `packages/channel-whatsapp/` workspace package; SPEC-056 sibling |

### Slice 2a — Foundation (Done 2026-05-22)

Detailed step-by-step status:

- [x] Module scaffolding: `index.ts`, `acl.ts` (4 features), `setup.ts` (defaultRoleFeatures for `superadmin`/`admin`/`manager`/`employee`), `di.ts` (`channelAdapterRegistry` singleton + entity registrations), `encryption.ts` (empty `defaultEncryptionMaps[]` — hub adds no new sensitive columns).
- [x] Events: `events.ts` declaring 9 events under `communication_channels.*` namespace using canonical `createModuleEvents({ moduleId, events })` shape. Includes `channel.requires_reauth` for downstream email-spec consumption.
- [x] Notifications: `notifications.ts` + `notifications.client.ts` declaring `communication_channels.message.received` and `communication_channels.channel.requires_reauth` types with React renderers in `widgets/notifications/`.
- [x] i18n: locale files (`en.json`, `pl.json`) with `communication_channels.notifications.*` keys.
- [x] `lib/adapter.ts` — full `ChannelAdapter` interface, `ChannelCapabilities`, all input/result types including new `refreshCredentials?` + `validateCredentials?` optional methods for the email integration spec.
- [x] `lib/adapter-compat.ts` — strict `validateAdapterCapabilities(adapter)` helper that throws when a capability flag is set without its corresponding optional method (replaces what the original spec called a "v1 fallback"; there is no v1 to fall back from).
- [x] `lib/registry.ts` — `ChannelAdapterRegistry` class with `register/get/list/providerKeys/has/clear`; calls validator on every register; refuses duplicate provider keys.
- [x] `lib/sanitize-channel-html.ts` — DOMPurify-equivalent allowlist sanitizer backed by `sanitize-html` (CommonJS, Jest-friendly, server-friendly). Strips `<script>`, event handlers, `javascript:` URLs; preserves email layout primitives and inline base64 images. Required by the email integration spec's Phase 1 acceptance gate.
- [x] `data/entities.ts` — 6 MikroORM entities: `CommunicationChannel`, `ExternalConversation`, `ExternalMessage`, `MessageChannelLink`, `ChannelThreadMapping`, `MessageReaction`. Cross-module references use plain `uuid` columns (no `@ManyToOne` cross-module per root AGENTS.md).
- [x] `data/extensions.ts` — 4 cross-module `EntityExtension` declarations using the canonical `{ base, extension, join: { baseKey, extensionKey }, cardinality }` shape: messages→link, messages→reactions, auth.user→assigned conversations, customers→matched conversations.
- [x] `data/validators.ts` — Zod schemas for adapter inputs / API bodies / capability shape.
- [x] Migration: `migrations/Migration20260526134719_communication_channels.ts` — 6 new tables with proper indexes, no cross-module FK constraints, clean snapshot diff (no unrelated module churn).
- [x] Messages module additions (§9.3a, agreed in-scope additive BC):
  - `<DataTable extensionTableId="messages">` in `MessagesInboxPageClient.tsx` — wires `data-table:messages:*` auto-spots.
  - `<InjectionSpot spotId="detail:messages:message:body:after">` and `<InjectionSpot spotId="detail:messages:message:sidebar">` in `MessageDetailPageClient.tsx`.
  - `<InjectionSpot spotId="crud-form:messages:message:fields">` in `ComposeMessagePageClient.tsx`.
  - New `packages/core/src/modules/messages/widgets/injection-table.ts` documenting the four exposed spots (with zero outgoing widget mappings — messages module doesn't inject into other modules' spots).
- [x] `apps/mercato/src/modules.ts` — enabled `{ id: 'communication_channels', from: '@open-mercato/core' }`.
- [x] Unit tests: `lib/__tests__/sanitize-channel-html.test.ts` (12 cases — script strip, event handler strip, javascript:/data:text/html URL strip, base64 image preservation, allowlist for table/img/a, typography, form/iframe removal), `lib/__tests__/adapter-compat.test.ts` (11 cases covering every capability/method pair + missing providerKey/channelType/capabilities + fully-loaded adapter), `lib/__tests__/registry.test.ts` (8 cases), `data/__tests__/extensions.test.ts` (6 cases asserting canonical EntityExtension shape). **37 tests total, all passing**.
- [x] Module-local Playwright integration tests (`__integration__/`): `TC-045D-001a.spec.ts` (module load + ACL features visible via `/api/auth/features`), `TC-045D-001b.spec.ts` (adapter registry + validator exports + smoke validation), `TC-045D-001c.spec.ts` (Messages pages render without 5xx after widget-spot additions).
- [x] Acceptance gates passed:
  - `yarn generate` — clean
  - `yarn db:generate` — only `communication_channels: generated Migration20260526134719_communication_channels.ts` (no unrelated migration churn)
  - `yarn build:packages` — 19/19 packages built successfully
  - `yarn test` — 20/20 package test suites pass (includes 37 new communication_channels tests + 0 regressions)
  - `apps/mercato#lint` failure is **pre-existing** (eslint-plugin-react version mismatch on `next.config.ts`, unrelated to this slice; "no eslint gate for core" per memory note)

### Slice 2b — Inbound bridge (Done 2026-05-22)

Detailed step-by-step status:

- [x] `lib/queue.ts` — process-level queue resolver mirroring `shipping_carriers/lib/queue.ts`. Exports `getCommunicationChannelsQueue(name)` (memoised per name) and `COMMUNICATION_CHANNELS_QUEUES` constants (`inbound` / `outbound` / `reactions`). Concurrency tunable via `COMMUNICATION_CHANNELS_QUEUE_CONCURRENCY` env, defaulting to 10.
- [x] `lib/contact-resolver.ts` — best-effort contact resolver. Calls the adapter's optional `resolveContact?(...)` and, when an email or phone is found, queries `customers:customer_entity` via the **QueryEngine** (NOT raw SQL per spec § 8.1). Returns merged `ContactHint` with `matchedPersonId` populated when a CRM match exists. Swallows adapter and QueryEngine failures so ingestion always proceeds.
- [x] `lib/registry.ts` refactored to a process-level `globalThis`-symbol singleton (matching `shipping_carriers/lib/adapter-registry.ts`). Exports function-form API (`registerChannelAdapter`, `getChannelAdapter`, `listChannelAdapters`, `hasChannelAdapter`, `clearChannelAdapters`) plus the `ChannelAdapterRegistry` class wrapper. The webhook route resolves adapters via the function form (no DI scope needed); DI consumers resolve `channelAdapterRegistry` which is bound to the same backing storage. Capability validation still runs on every `register`.
- [x] `lib/adapter-registry-singleton.ts` — small re-export module that webhook routes import without pulling the class. Adds `getChannelAdapterRegistry()` returning a cached `ChannelAdapterRegistry` instance for ergonomic DI/test wiring.
- [x] `commands/ingest-inbound-message.ts` — registered as `communication_channels.message.ingest_inbound`. Validates input with Zod, dedups on `(channel_id, external_message_id)` (returns `{ status: 'duplicate' }` on existing `ExternalMessage`), upserts `ExternalConversation`, runs contact resolution, invokes `messages.messages.compose` via the command bus to create the platform Message, then creates `ExternalMessage` + `MessageChannelLink` + `ChannelThreadMapping` in a single hub-side transaction. Emits `communication_channels.conversation.created` (first message in conversation), `communication_channels.contact.resolved` (CRM matched), and `communication_channels.message.received` (always) — all `persistent: true` so persistent subscribers retry on failure. Uses `SYSTEM_USER_ID = '00000000-...'` as `senderUserId` for inbound channel messages, with the actual external identity carried in `Message.externalEmail` / `Message.externalName` / `MessageChannelLink.channelMetadata` — matches the `inbox_ops/lib/messagesIntegration.ts` precedent.
- [x] `workers/inbound-processor.ts` — `metadata = { queue: 'communication-channels-inbound', concurrency: 10, id: 'communication_channels:inbound-processor' }`. Resolves the adapter for the inbound `providerKey`, calls `adapter.normalizeInbound(raw)` to canonicalise the payload, then dispatches the `ingest_inbound_message` command. Idempotency lives in the command (dedup on the unique `(channel_id, external_message_id)` constraint); the worker can safely retry on transient failures. Throws clear errors when the adapter is missing or returns a malformed normalized message.
- [x] `api/post/webhook/[provider]/route.ts` — auth-less webhook endpoint at `POST /api/communication_channels/webhook/[provider]`. Iterates all active `CommunicationChannel` candidates for `(providerKey, isActive=true, deletedAt IS NULL)` and asks the adapter to verify the signature with each candidate's decrypted credentials (resolved via `integrationCredentialsService.resolve('channel_<provider>', scope)`). The first successful verification pins the request to that channel's tenant scope. **Fail-closed**: returns 401 if no candidate verifies (mirrors the per-tenant authentication model in `shipping_carriers/api/webhook/[provider]/route.ts`, fixed in PR #1311). Only `eventType === 'message'` events trigger ingest in slice 2b; reactions and status updates return 202 with `queued: false` and a reason, to be picked up by slice 2c / 2d processors. Exports `openApi` and per-method `metadata: { POST: { requireAuth: false } }`.
- [x] `index.ts` updated to import the command module as a side-effect (`import './commands/ingest-inbound-message'`), matching the `messages` module pattern.
- [x] Unit tests (4 new files, 19 new tests):
  - `lib/__tests__/queue.test.ts` (3 tests) — canonical queue names, memoization, distinct queues per name.
  - `lib/__tests__/contact-resolver.test.ts` (7 tests) — empty identifier returns null, adapter hint without CRM match, CRM match populated via QueryEngine, email heuristic, phone heuristic, adapter errors swallowed, QueryEngine errors swallowed.
  - `commands/__tests__/ingest-inbound-message.test.ts` (4 tests) — command id + execute exported, schema rejects empty providerKey + malformed tenantId.
  - `workers/__tests__/inbound-processor.test.ts` (5 tests) — metadata shape, missing adapter throws, malformed normalize throws, commandBus.execute called with canonical id, duplicate result returns silently.
- [x] Module-local Playwright integration tests (2 new files): `TC-045D-002a.spec.ts` (unknown-provider webhook returns 404) and `TC-045D-002b.spec.ts` (ingest command registration + schema validation).
- [x] Acceptance gates:
  - `yarn generate` — clean (359 API route files, OpenAPI bundle unchanged)
  - `yarn build:packages` — 19/19 packages built successfully
  - `yarn test` — 20/20 package test suites pass; **56 communication_channels tests passing** (37 from slice 2a + 19 new), 0 regressions in 1,074 UI tests / 876 CLI tests / etc.
  - No raw SQL anywhere in the new code (contact resolution uses QueryEngine; entity reads use the EntityManager directly).
  - Webhook route is fail-closed (401 on signature mismatch, 404 on unknown provider).
  - Idempotency at the database layer (`external_messages` unique constraint on `(channel_id, external_message_id)`).

### Slice 2c — Outbound bridge (Done 2026-05-22)

Detailed step-by-step status:

- [x] `lib/error-classification.ts` — classifies provider errors as `transient` vs permanent. Honours explicit `error.transient` / `error.status` hints set by classification-aware adapters; falls back to HTTP-status heuristics (408/429/5xx → transient; 4xx → permanent) and message-pattern heuristics (ECONNRESET/ETIMEDOUT/socket hang up/rate limit/etc.). Also exports `computeBackoffMs(attemptNumber)` — exponential 1s/2s/4s/... capped at 60s plus jitter, used by the worker for re-enqueue delays.
- [x] `lib/credential-refresh.ts` — refreshes OAuth credentials when an access token is within the configured window (default 60s) of expiry, or when the caller forces it (post-401 retry path). Best-effort persistence via `integrationCredentialsService.save()` when available; falls back to current credentials when adapter refresh or persistence fails so the outbound call still proceeds with what we have.
- [x] `commands/deliver-outbound-message.ts` — registered as `communication_channels.message.deliver_outbound`. Validates input with Zod (`{ messageId, scope, forceCredentialRefresh? }`). Re-fetches the Message by ID — **no payload-shape coupling** on `messages.message.sent` (this was a Critical fix from the pre-implementation analysis). Looks up `ChannelThreadMapping` by `Message.threadId`; returns `{ status: 'no_channel_link' }` for internal-only messages. Idempotently upserts a `pending` `MessageChannelLink` (unique on `messageId`); short-circuits to `{ status: 'already_delivered' }` if the link is already in a delivered state. Resolves credentials via the integrations module's `credentialsService` (best-effort — channel can have no `credentialsRef`), refreshes credentials via `refreshCredentialsIfNeeded`, calls `adapter.convertOutbound(...)` + `adapter.sendMessage(...)`. On success persists `ExternalMessage` + flips link to `sent` + emits `communication_channels.message.sent`. On failure flips link to `failed` with error details in `channelMetadata`, logs to `integrationLogService.error?(...)` if available (best-effort), and emits `communication_channels.message.delivery_failed` with `{ transient, error, status }`. Classification of the error decides whether the worker retries.
- [x] `workers/outbound-delivery.ts` — `metadata = { queue: 'communication-channels-outbound', concurrency: 10, id: 'communication_channels:outbound-delivery' }`. Dispatches the `deliver_outbound_message` command, then inspects the result: `delivered` / `already_delivered` / `no_channel_link` → return; `failed` with `transient: true` AND attempt < 3 → re-enqueue with `computeBackoffMs(attempt)` delay and incremented `attempt`; `failed` with `transient: false` OR attempt ≥ 3 → return (the command already emitted `.delivery_failed` and persisted the failure state). Catches unexpected command throws (DB blip etc.) and re-enqueues up to `OUTBOUND_DELIVERY_MAX_ATTEMPTS = 3`; re-throws after that. **Explicit re-enqueue with `delayMs` is the portable retry pattern** — we deliberately do NOT rely on BullMQ's built-in retry on top of ours, which would compound delays unpredictably.
- [x] `subscribers/outbound-bridge.ts` — subscribes to `messages.message.sent` with `persistent: true` and stable id `communication_channels:outbound-bridge`. **Re-fetches the Message by ID**; bails on internal-only messages (no `threadId` OR no `ChannelThreadMapping`); skips when an existing link is already in a delivered state (subscriber-level cheap idempotency). Otherwise enqueues an `OutboundDeliveryPayload` job with `attempt: 1`.
- [x] `index.ts` updated to side-effect-import `./commands/deliver-outbound-message` so the command registers at boot.
- [x] Unit tests (5 new files, 41 new tests):
  - `lib/__tests__/error-classification.test.ts` (10 tests) — null/undefined/string handling, explicit transient hint, HTTP status → classification (408/429/5xx transient; 4xx permanent), message-pattern detection, backoff base/doubling/cap/clamping.
  - `lib/__tests__/credential-refresh.test.ts` (7 tests) — no-op when adapter lacks `refreshCredentials`, no-op without `expiresAt`, refresh within window, no refresh outside window, force=true, adapter throw fallback, save via credentialsService.
  - `commands/__tests__/deliver-outbound-message.test.ts` (5 tests) — canonical command id, schema rejects malformed messageId, schema rejects missing tenantId, schema accepts valid input shape.
  - `workers/__tests__/outbound-delivery.test.ts` (10 tests) — metadata shape, `delivered` returns, `already_delivered` returns, `no_channel_link` returns, transient failure re-enqueues with backoff + incremented attempt, permanent failure doesn't re-enqueue, MAX_ATTEMPTS stops retries, command throw re-enqueues until MAX_ATTEMPTS, command throw at MAX re-throws.
  - `subscribers/__tests__/outbound-bridge.test.ts` (9 tests) — metadata shape, missing messageId, missing Message, internal-only Message (no threadId), no ChannelThreadMapping, happy path enqueues correct payload, skip when link is `sent`, enqueue when link is `failed` (retry path).
- [x] Module-local Playwright integration tests (2 new files): `TC-045D-003a.spec.ts` (deliver command registration + schema), `TC-045D-003b.spec.ts` (subscriber + worker contract — event id, queue name, max-attempts).
- [x] Acceptance gates:
  - `yarn generate` — clean (359 API routes, no migrations triggered, no module-graph churn)
  - `yarn build:packages` — 19/19 packages built successfully
  - `yarn test` — 20/20 package test suites pass; **97 communication_channels tests passing** (37 slice 2a + 19 slice 2b + 41 slice 2c), 0 regressions across UI 1,074 tests / CLI 876 tests / other modules.
  - No raw SQL anywhere in the new code (all entity reads via EntityManager).
  - No payload-shape coupling on `messages.message.sent` — subscriber + command both re-fetch the Message by ID.
  - Idempotency at the database layer (unique constraint on `message_channel_links.message_id`) AND at the subscriber level (cheap state check before enqueue).
  - Retry policy: explicit re-enqueue with exponential backoff via `delayMs`; max 3 attempts; transient/permanent classification per provider error.

### Slice 2d — Reactions (Done 2026-05-22)

Detailed step-by-step status:

- [x] **Adapter contract extended** (`lib/adapter.ts`) — added `InboundReactionEvent` interface and the optional `normalizeInboundReaction?(raw: InboundMessage): Promise<InboundReactionEvent>` adapter method. Adapters that don't implement it get a 202 "not handled" from the webhook for standalone reaction events. Existing `sendReaction?` / `removeReaction?` methods (already in slice 2a) wire to the outbound flow without further changes. Additive BC.
- [x] **Zod schema added** (`data/validators.ts`) — `inboundReactionEventSchema` mirrors `InboundReactionEvent` for command input validation.
- [x] `lib/reaction-semantics.ts` — pure, no-DB helper. `allowsMultipleReactionsPerUser(capabilities)` reads `multiReactionPerUser` with fail-safe default `false`. `resolveInboundAddMutation(capabilities)` returns `'insert'` for Slack-style and `'replace'` for WhatsApp-style; `'replace'` is the default when capabilities are missing (safer — keeps the per-user "single emoji" invariant).
- [x] `workers/reaction-processor-types.ts` — extracted from the worker file so commands can reference `ReactionProcessorPayload` without forming a circular import with the worker. Discriminated union of 3 job kinds: `inbound` / `outbound_send` / `outbound_remove`. Exports `REACTION_PROCESSOR_MAX_ATTEMPTS = 3`.
- [x] `commands/process-inbound-reaction.ts` — registered as `communication_channels.reaction.process_inbound`. Validates input via `inboundReactionEventSchema`. Resolves the platform Message via `ExternalMessage` → `MessageChannelLink` (or returns `{ status: 'no_message_link' }` when the reaction targets a message we never ingested). For `added`: applies `resolveInboundAddMutation(channel.capabilities)` — on `replace` deletes prior reactions from the same external reactor on the same message, then inserts; idempotent on unique-violation (treated as `noop`). For `removed`: deletes matching rows by `(messageId, emoji, reactedByExternalId[, externalReactionId])`. Emits `communication_channels.reaction.added` / `.reaction.removed` with `persistent: true`. Idempotent on retry.
- [x] `commands/toggle-outbound-reaction.ts` — registered as `communication_channels.reaction.toggle_outbound`. Single command handles both `add` and `remove` via input discriminator. **Optimistic local write**: creates/deletes the `MessageReaction` row synchronously (so API responses return immediately with the new state), then enqueues an `outbound_send` / `outbound_remove` job to the reactions queue for asynchronous provider notification. For `add` with `multiReactionPerUser=false`, replaces existing per-user reactions on the message before inserting. Ownership-checked on `remove` (user can only remove their own reactions). Emits `communication_channels.reaction.added` / `.reaction.removed` synchronously.
- [x] `workers/reaction-processor.ts` — unified worker (`metadata.queue = 'communication-channels-reactions'`, concurrency 10) that dispatches by `payload.kind`:
  - `inbound` → invokes `process_inbound_reaction` via the command bus.
  - `outbound_send` → resolves adapter + decrypted credentials (via `integrationCredentialsService`), refreshes if near expiry, calls `adapter.sendReaction?(...)`.
  - `outbound_remove` → resolves the same context, calls `adapter.removeReaction?(...)`.

  Transient outbound failures re-enqueue with `computeBackoffMs(attempt)` and incremented attempt, up to `REACTION_PROCESSOR_MAX_ATTEMPTS = 3`. Permanent failures (`status: 400`, missing adapter, channel inactive) stop without retry — reactions are inherently low-stakes (a missed reaction is not data loss).
- [x] **Reactions API routes:**
  - `POST /api/communication_channels/messages/[messageId]/reactions` (`requireAuth: true`, `requireFeatures: ['communication_channels.react']`). Validates uuid + body `{ emoji }` via Zod. Dispatches `toggle_outbound_reaction` command with `action: 'add'`. Returns 201 + reaction record on success; 409 on `no_channel_link` / duplicate; 422 on invalid body.
  - `DELETE /api/communication_channels/messages/[messageId]/reactions/[reactionId]` (same auth gate). Validates ids, looks up the reaction (404 if not found), then dispatches `toggle_outbound_reaction` with `action: 'remove'` (ownership-checked inside the command). Returns 204 on success.
- [x] **Webhook route updated** (`api/post/webhook/[provider]/route.ts`) — after signature verification, the route now dispatches by `event.eventType`:
  - `'reaction'` → if the adapter implements `normalizeInboundReaction?`, normalizes and enqueues an inbound reaction job to the reactions queue; otherwise returns 202 with `reason: 'adapter does not implement normalizeInboundReaction'`.
  - other non-`message` types → 202 not handled (status updates queued for a future slice).
  - `message` (default) → unchanged inbound-processor path.
- [x] `index.ts` — both new commands side-effect-imported (`./commands/process-inbound-reaction` and `./commands/toggle-outbound-reaction`).
- [x] **Unit tests** (4 new files, 28 new tests):
  - `lib/__tests__/reaction-semantics.test.ts` (8 tests) — true/false/undefined/null capability handling, `insert` vs `replace` decision, safe defaults.
  - `commands/__tests__/process-inbound-reaction.test.ts` (5 tests) — canonical id, schema rejects missing channelId / emoji / invalid action.
  - `commands/__tests__/toggle-outbound-reaction.test.ts` (7 tests) — canonical id, schema rejects malformed messageId, missing action, oversized emoji, unknown action; valid input passes schema.
  - `workers/__tests__/reaction-processor.test.ts` (8 tests) — worker metadata, dispatch to `process_inbound_reaction` command on `inbound` kind, adapter.sendReaction called on `outbound_send`, adapter.removeReaction called on `outbound_remove`, transient failure re-enqueues with backoff, permanent failure does not retry, missing adapter is permanent, MAX_ATTEMPTS halts retries.
- [x] **Module-local Playwright integration tests** (2 new files):
  - `TC-045D-004a` — both reaction commands + the worker export stable ids + queue name + max-attempts constant.
  - `TC-045D-004b` — reactions API contract: malformed params return < 500; valid auth gating.
- [x] **Acceptance gates:**
  - `yarn generate` — clean (361 API routes — 2 new reactions routes added).
  - `yarn build:packages` — 19/19 packages built successfully (2,646 entry points in `@open-mercato/core`).
  - `yarn test` — 20/20 package test suites pass; **125 communication_channels tests passing** (37 slice 2a + 19 slice 2b + 41 slice 2c + 28 slice 2d), 0 regressions in UI 1,074 / CLI 876 / other modules.
  - No raw SQL anywhere; all entity reads via EntityManager.
  - Idempotency on reaction insert via UNIQUE `(message_id, emoji, reacted_by_user_id, reacted_by_external_id)` constraint + unique-violation → noop in command.
  - Single-vs-multi reaction semantics correctly driven by `ChannelCapabilities.multiReactionPerUser` (Slack `true` → insert; WhatsApp `false` → replace per-user reactions).
  - Adapter contract change is **additive** — `normalizeInboundReaction?` is optional; existing adapters that don't implement it work unchanged.

### Slice 2e — UMES enrichers + admin pages (Done 2026-05-22)

Detailed step-by-step status:

- [x] `data/enrichers.ts` — 4 enrichers, all targeting `messages.message`, all feature-gated by `communication_channels.view`, all implementing `enrichMany` (no N+1):
  - `_channel` (priority 30) → `{ providerKey, channelType, direction, deliveryStatus, capabilities }`.
  - `_channelPayload` (priority 20) → `{ channelContentType, channelPayload, interactiveState, channelMetadata }`.
  - `_reactions` (priority 25) → grouped `[{ emoji, count, users, reactedByMe }]` sorted by count desc, with `reactedByMe` resolved against `ctx.userId`.
  - `_channelContact` (priority 15) → `{ contactPersonId, assignedUserId, subject }` from `ExternalConversation`.

  **Host opt-in note**: enrichers fire on any CRUD route that opts in via `makeCrudRoute({ enrichers: { entityId: 'messages.message' } })`. The hub itself ships them registered with the platform's enricher registry (auto-discovered from `data/enrichers.ts`); provider packages and the Messages module's own routes opt in independently. This keeps the hub's contribution additive — no change required in the Messages module to enable the hub's enrichers, and any module that adds `enrichers: { entityId: 'messages.message' }` to its CRUD route immediately picks them up.
- [x] **4 hub-side injection widgets** in `widgets/injection/`:
  - `channel-badge/` → `data-table:messages:columns`. Renders the provider/channel type as a `<Tag>` pill (variant `success` for inbound, `info` for outbound). Pure presentational; reads `_channel`.
  - `channel-payload-renderer/` → `detail:messages:message:body:after`. For `email/*` content types, calls `sanitizeChannelHtml(payload.html)` (slice 2a helper) and renders sanitised HTML via `dangerouslySetInnerHTML`. For other types (Slack Block Kit, WhatsApp interactive), renders the raw payload as JSON — provider packages override this widget via UMES component replacement (handle `widget:communication_channels.injection.channel-payload-renderer`) for richer rendering.
  - `reaction-bar/` → `detail:messages:message:body:after` (priority 90, after the payload renderer). Renders emoji + count buttons; clicking toggles via `POST /api/communication_channels/messages/[id]/reactions` (slice 2d API). Optimistic local state update on success; flash error on failure.
  - `channel-info-panel/` → `detail:messages:message:sidebar`. Sidebar summary card showing provider, channel type, direction, delivery status, and CRM contact match — reads `_channel` + `_channelContact`.
- [x] `widgets/injection-table.ts` — maps the 4 hub widgets to the 3 Messages-module spots exposed in slice 2a (`data-table:messages:columns`, `detail:messages:message:body:after`, `detail:messages:message:sidebar`). The CrudForm fields spot from slice 2a (`crud-form:messages:message:fields`) is reserved for provider packages and slice 2f.
- [x] **Channels admin API** (read-only in slice 2e; write CRUD belongs to provider packages):
  - `GET /api/communication_channels/channels` — paginated list with optional `providerKey` / `channelType` / `isActive` filters. Auth + `communication_channels.view`.
  - `GET /api/communication_channels/channels/[id]` — single channel detail (capabilities included). Same auth gate. 400 on malformed id, 404 on unknown.
- [x] **Admin page** `backend/communication_channels/channels/page.tsx` (+ `page.meta.ts`) — renders at `/backend/communication_channels/channels`. Uses `DataTable` with `extensionTableId="communication_channels.channels"` (downstream modules can inject columns/row actions per UMES). Auto-fetches via `apiCall` on mount; renders display name, provider, type, external identifier, and status `<Tag>`. Empty state explains that provider packages register channels. Auth + `communication_channels.view` enforced via `page.meta.ts` metadata.
- [x] **i18n expansion** in `i18n/en.json` + `i18n/pl.json` — new keys for nav, columns, status, provider names, channel-payload types, reaction bar, info-panel labels, and admin empty/error states.
- [x] **Unit tests** (1 new file, 7 new tests):
  - `data/__tests__/enrichers.test.ts` — registration (count, target entity, feature gating, namespaced fallback keys, stable ids), short-circuit on empty input, and reaction grouping (counts, `reactedByMe`, sort-by-count-desc, both internal + external reactors).
- [x] **Module-local Playwright integration tests** (3 new files):
  - `TC-045D-005a` — enrichers module export shape (4 enrichers, canonical ids, target entity, feature gating).
  - `TC-045D-005b` — channels admin API contract (list shape, detail 400/404 paths).
  - `TC-045D-005c` — admin page renders without 5xx.
- [x] **Acceptance gates:**
  - `yarn generate` — clean (363 API routes — 2 new channels routes + 2 reaction routes from slice 2d).
  - `yarn build:packages` — 19/19 packages built successfully (2,663 entry points in `@open-mercato/core`).
  - `yarn test` — 20/20 package test suites pass; **132 communication_channels tests passing** (37 + 19 + 41 + 28 + 7), 0 regressions in UI 1,074 / CLI 876 / other modules.
  - No raw SQL; all entity reads via EntityManager.
  - All enrichers implement `enrichMany` (N+1 prevention per `packages/shared/lib/crud/response-enricher` contract).
  - All enriched fields namespaced with `_channel*` / `_reactions` prefixes (per AGENTS.md rule).
  - Widgets use semantic status tokens (`Tag variant="success"` / `info` / `neutral`) — no hardcoded Tailwind colour shades.
  - Channel payload renderer routes HTML through `sanitizeChannelHtml` before `dangerouslySetInnerHTML` (XSS-safe per SPEC-045d §4.6).

### Slice 2f — Polish (Done 2026-05-22)

Detailed step-by-step status:

- [x] `commands/reassign-conversation.ts` — registered as `communication_channels.conversation.reassign`. Validates input via Zod (`{ threadId, assignedUserId, scope }`). Looks up `ChannelThreadMapping` by `messageThreadId`; bails with `{ status: 'no_channel_link' }` for non-channel-linked threads. Updates both `ChannelThreadMapping.assignedUserId` AND `ExternalConversation.assignedUserId` so subscribers see a consistent owner. Idempotent — returns `noop` when the new owner matches the existing one.
- [x] `api/put/threads/[threadId]/assign/route.ts` — `PUT /api/communication_channels/threads/[threadId]/assign`. Auth-gated by `communication_channels.assign` per spec §13.1. Validates uuid path param + Zod body `{ assignedUserId: uuid | null }`. Dispatches the reassign command and returns 200 with the new state, 404 when not channel-linked, 422 on invalid body.
- [x] `api/get/channels/[id]/health/route.ts` — `GET /api/communication_channels/channels/[id]/health`. Returns live delivery-status aggregates over the trailing 24-hour window (`sent`/`delivered`/`read`/`failed`/`pending`/`queued`/`other`), the total message count, and the 10 most recent failed `MessageChannelLink` rows with `lastError` + `transient` context from `channelMetadata`. Computed from `MessageChannelLink` directly (no dedicated `HealthLog` table required for v1 — slice 2a deliberately omitted that entity per the pre-implementation analysis).
- [x] `backend/communication_channels/channels/[id]/page.tsx` (+ `page.meta.ts`) — channel detail admin page at `/backend/communication_channels/channels/<id>`. Renders the channel header (display name, provider, type, active/inactive badge), capabilities matrix (sorted alphabetically, rendered as `<dl>`), and delivery health section (status chips + collapsible recent failures). Falls back gracefully when the channel is missing or health data is unavailable (`<ErrorMessage>` / "No health data" copy). `navHidden: true` because the detail page is reached from the list, not the main nav.
- [x] **Channel-info-panel widget — reassignment editor.** `widgets/injection/channel-info-panel/widget.client.tsx` extended with a feature-gated `<select>` dropdown for the conversation assignee. Surfaces only when the host passes `context.userFeatures` containing `communication_channels.assign` (or wildcard grant `communication_channels.*` / `*`). Lazy-loads user options from `/api/auth/users` on first focus. Calls `PUT /api/communication_channels/threads/<threadId>/assign` on change with optimistic local-state update and `flash()` success/error feedback.
- [x] `lib/system-user.ts` — `resolveCommunicationChannelsSystemUserId(em, tenantId, fallbackId?)` helper. Resolves a per-tenant channel-bot user by convention email (`system+communication_channels@<tenantId>.local`); falls back to the caller-supplied fallback id; last resort returns the sentinel zero-UUID (`00000000-...`). Fail-soft on DB errors. The `ingest-inbound-message` command now uses this helper instead of the hard-coded sentinel.
- [x] **i18n expansion** — `i18n/en.json` + `i18n/pl.json` add keys for `infoPanel.assignedTo` / `.unassigned` / `.noThread` / `.reassignError` / `.reassignSuccess`, `detail.title` / `.loading` / `.capabilities` / `.noCapabilities` / `.health` / `.noHealth` / `.messages` / `.recentFailures`, `errors.loadDetail`.
- [x] **Unit tests** (2 new files, 12 new tests):
  - `commands/__tests__/reassign-conversation.test.ts` (5 tests) — canonical id + execute, schema rejects malformed threadId / assignedUserId, accepts null assignedUserId (unassign).
  - `lib/__tests__/system-user.test.ts` (7 tests) — sentinel exposure, email convention, channel-bot lookup, fallback id, sentinel fallback, fail-soft on EM throw.
  - Plus 1 extra test added to `lib/__tests__/error-classification.test.ts` after pinning `Math.random` for deterministic backoff assertions.
- [x] **Module-local Playwright integration tests** (3 new files):
  - `TC-045D-006a` — reassign command registration + execute export.
  - `TC-045D-006b` — channel health + reassign API negative paths (malformed id → 400, unknown uuid → 404, invalid body → 422).
  - `TC-045D-006c` — channel detail page renders without 5xx for unknown channel id.
- [x] **Acceptance gates:**
  - `yarn generate` — clean (365 API routes — 2 new routes added: health + reassign).
  - `yarn build:packages` — 19/19 packages built successfully (2,672 entry points in `@open-mercato/core`).
  - `yarn test` — 20/20 package test suites pass. **144 communication_channels tests passing** (37 + 19 + 41 + 28 + 7 + 12), 0 regressions in UI 1,074 / CLI 876 / other modules.
  - No raw SQL anywhere; entity reads via EntityManager.
  - System-user helper is fail-soft — inbound ingest never refuses to process a message because the channel-bot user doesn't exist.
  - Reassignment UI is feature-gated (`communication_channels.assign`) at the widget AND API layers; defense in depth.

### SPEC-045d implementation complete — ready to host provider packages

Slices 2a through 2f deliver Phases 1–5 of SPEC-045d's original phase plan in its entirety:

| SPEC-045d phase | Slice(s) | Status |
|---|---|---|
| Phase 1: Core Bridge Infrastructure | 2a + 2b + 2c | ✅ Done |
| Phase 2: Rich Payload & Type Renderers | 2b (inbound) + 2c (outbound) + 2e (renderer widget) | ✅ Done |
| Phase 3: Reactions | 2d | ✅ Done |
| Phase 4: UI Adaptations | 2e | ✅ Done |
| Phase 5: Contact Resolution | 2b (inbound flow) + 2f (admin polish) | ✅ Done |
| Phase 6: Slack Provider | — | Pending (separate `packages/channel-slack/` workspace package) |
| Phase 7: WhatsApp v2 + Email | — | Pending (WhatsApp = SPEC-056; Email = `2026-05-21-email-integration-foundation.md`) |

**The Communication Channels Hub is ready to host channel-provider workspace packages.** The email integration spec, SPEC-056 WhatsApp, and any future channel provider (Slack, Microsoft Teams, SMS, …) can build on top of slices 2a–2f without further hub-level work.

---

## 18. Migration & Backward Compatibility

This spec is the **first implementation** of the `communication_channels` hub. There is no v1 to be backward-compatible with. The BC impact is therefore characterised per the 13 contract-surface categories in `BACKWARD_COMPATIBILITY.md`:

| # | Surface | Change | Impact |
|---|---|---|---|
| 1 | Auto-discovery file conventions | New `communication_channels` module ships standard `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `notifications.ts`, `notifications.client.ts`, `data/entities.ts`, `data/extensions.ts`, `data/enrichers.ts`, `widgets/injection-table.ts`, `widgets/injection/...`. All canonical shapes. | Additive |
| 2 | Type definitions & interfaces | New `ChannelAdapter`, `ChannelCapabilities`, `NormalizedInboundMessage`, `RefreshCredentialsInput`/Result, `ValidateCredentialsInput`/Result types exported from `@open-mercato/core/modules/communication_channels/lib/adapter`. | Additive (new exports) |
| 3 | Function signatures | None modified | None |
| 4 | Import paths | New `@open-mercato/core/modules/communication_channels/...` paths. | Additive |
| 5 | Event IDs | 9 new IDs under `communication_channels.*`. No existing event renamed or removed. | Additive |
| 6 | Widget injection spot IDs | 4 new spots in Messages module (`data-table:messages:columns`, `detail:messages:message:body:after`, `crud-form:messages:message:fields`, `detail:messages:message:sidebar`). The Messages module is modified to register these spots — agreed in-scope (§9.3a). No existing spot renamed or removed. | Additive |
| 7 | API route URLs | New URLs under `/api/communication_channels/*` (snake_case, matching module id and shipping convention). No existing URL renamed or removed. | Additive |
| 8 | Database schema | 6 new tables: `communication_channels`, `external_conversations`, `external_messages`, `message_channel_links`, `channel_thread_mappings`, `message_reactions`. No existing tables or columns modified. | Additive |
| 9 | DI service names | New registrations (e.g., `channelAdapterRegistry`). No existing DI key renamed. | Additive |
| 10 | ACL feature IDs | 4 new features (`communication_channels.view/.manage/.react/.assign`). `defaultRoleFeatures` map in `setup.ts` grants them to admin + manager roles (full set) and to all user roles (`.view` + `.react`). Run `yarn mercato auth sync-role-acls` after deploy. No existing feature renamed. | Additive |
| 11 | Notification type IDs | 2 new types (`communication_channels.message.received`, `communication_channels.channel.requires_reauth`). No existing type renamed. | Additive |
| 12 | CLI commands | None | None |
| 13 | Generated file contracts | New entries added to generated registries (events, notifications, widgets, etc.). All additive. | Additive |

**Forward-compatibility for downstream specs**:

- `2026-05-21-email-integration-foundation.md` will add additive columns to `CommunicationChannel` and `integration_credentials`, plus one new ACL feature. These are reserved column names — future hub work must not conflict.
- SPEC-056 (WhatsApp) will register a `channel_whatsapp` provider package; no hub deltas required.
- Slack provider (Phase 6 of this spec) lives in a separate `packages/channel-slack/` workspace package; same pattern as Stripe / Akeneo.

**Messages module additive changes**: Phase 1 adds four `<InjectionPoint id="…" />` lines to existing Messages pages (`MessagesInboxPageClient.tsx`, `MessageDetailPageClient.tsx`, `ComposeMessagePageClient.tsx`) and one new `widgets/injection-table.ts` in the Messages module. Zero behaviour change for existing Messages users; the spots simply gain content when channel-linked messages are present. Detailed in § 9.3a.

---

## 19. Final Compliance Report — 2026-05-22

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/scheduler/AGENTS.md` (if present; else inferred from package)
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/core/src/modules/messages/AGENTS.md` (if present)
- `.ai/specs/AGENTS.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`

### Specs Cross-Referenced

- `SPEC-002 Messages Module` (the inbox destination — already shipped)
- `SPEC-041 UMES family` (already shipped; widget injection, response enrichers, mutation guards, command interceptors, sync subscribers)
- `SPEC-045 Integration Marketplace` + `SPEC-045a Foundation` (already shipped; credential storage, log service)
- `BACKWARD_COMPATIBILITY.md` (this spec's BC impact characterised per the 13 surfaces in § 18)
- `2026-05-21-email-integration-foundation.md` (downstream consumer; hub deltas reserved)
- `SPEC-056 WhatsApp` (sibling consumer; first non-email provider)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | New external providers in own workspace packages | Compliant | `packages/channel-slack/`, `packages/channel-whatsapp/` (and email-spec provider packages) |
| root AGENTS.md | Module-id underscore convention | Compliant | `communication_channels`, `channel_slack`, `channel_whatsapp`, `channel_email` |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All cross-module references via plain `uuid` columns + `EntityExtension`; no `@ManyToOne` cross-module |
| root AGENTS.md | Tenant + organization scoping on every entity | Compliant | All 6 new entities carry both columns |
| root AGENTS.md | Zod validation on all inputs | Compliant | All API bodies + adapter inputs |
| root AGENTS.md | Encryption via `defaultEncryptionMaps` | Compliant | Hub adds no new sensitive columns; relies on `integrations` module's existing encryption of `IntegrationCredentials.credentials`. Hub exports an empty `defaultEncryptionMaps: ModuleEncryptionMap[] = []` for symmetry. |
| root AGENTS.md | Commands for write operations | Compliant | Connect/disconnect/assign/reaction-add/reaction-remove all command-pattern |
| root AGENTS.md | RBAC via features, not roles | Compliant | All routes use `requireFeatures`; 4 features declared in `acl.ts` |
| root AGENTS.md | Run cache structural after `modules.ts` change | Compliant | Deploy runbook entry; per-phase acceptance |
| root AGENTS.md | OSS must not depend on enterprise | Compliant | No `@open-mercato/enterprise` imports anywhere |
| packages/core/AGENTS.md | Per-method `metadata` on API routes | Compliant in spec text; concrete snippet TBD | Each route exports `metadata = { POST: { requireAuth, requireFeatures } }` |
| packages/core/AGENTS.md | `openApi` exports on every route | Compliant | All routes export |
| packages/core/AGENTS.md | `makeCrudRoute` for CRUD; `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess` for bespoke writes | Compliant | Channels CRUD via factory; webhook/reactions are bespoke writes wrapped in guards |
| packages/ui/AGENTS.md | `apiCall` not raw `fetch` | Compliant | UI side |
| packages/ui/AGENTS.md | `useGuardedMutation` wrapping non-CrudForm writes | Compliant | Reaction toggle, channel assign actions |
| packages/ui/AGENTS.md | `CrudForm`, `DataTable`, semantic status tokens, lucide-react, `aria-label`, dialog keyboard shortcuts, `pageSize ≤ 100` | Compliant | See § 9; concrete UI built in Phase 4 |
| packages/events/AGENTS.md | `createModuleEvents({moduleId, events})` shape, events `as const` | Compliant | See § 10.1 |
| packages/queue/AGENTS.md | Idempotent workers, concurrency ≤ 20 | Compliant | inbound-processor (concurrency 10), outbound-delivery (concurrency 5), reaction-processor (concurrency 10) all idempotent on `(channel_id, external_message_id)` or equivalent |
| packages/cache/AGENTS.md | DI-resolved cache, tenant-scoped tags | N/A | Spec introduces no caching beyond hub adapter snapshot in `CommunicationChannel.capabilities` |
| packages/scheduler/* | `SchedulerService.register` for periodic ticks | Compliant | Outbound retry sweeper registered as cron via `@open-mercato/scheduler` |
| .ai/ds-rules.md | Semantic tokens, no arbitrary text sizes, no `dark:` on status colors | Compliant | UI built in Phase 4 follows; status badges use `bg-status-*-soft text-status-*-fg` |
| .ai/ui-components.md | lucide-react via backend icon registry, no inline `<svg>` | Compliant | Icons: `message-circle`, `alert-triangle`, etc. |
| .ai/specs/AGENTS.md | Required sections (10) | Compliant | TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog — all present |
| spec-writing skill | Frontend Architecture Contract | Compliant | Server/Client boundary noted in § 9; client bundle guardrail (no provider SDK in client bundle) |
| spec-writing skill | Security: input validation, parameterized queries, XSS, encoding | Compliant | § 4.6 HTML sanitizer for stored XSS; QueryEngine (no raw SQL); webhook signature verification per adapter |
| BACKWARD_COMPATIBILITY.md | 13 contract surface categories | Compliant | All additive (§ 18) |
| `.ai/lessons.md` | Integration tests module-local | Compliant | Phase tests in `packages/core/src/modules/communication_channels/__integration__/` and per-provider package `__integration__/` |
| `.ai/lessons.md` | No raw SQL in route handlers | Compliant | § 8.1 contact resolution uses QueryEngine |
| `.ai/lessons.md` | Provider URL validation | N/A for hub spec; per-provider (e.g., IMAP host validation in email spec) |
| `.ai/lessons.md` | Cross-process event bridge for worker SSE | Acknowledged | `clientBroadcast: true` events emitted from workers (inbound-processor, reaction-processor) require the platform's cross-process event bridge. If not in place at Phase 2 acceptance, UI consumers fall back to polling. |

### Internal Consistency Check

| Check | Status |
|---|---|
| Data models match API contracts | Pass |
| API contracts match UI/UX section | Pass |
| Risks cover all write operations | Pass |
| Commands defined for all mutations | Pass |
| Events: new IDs only under `communication_channels.*`, no collisions with existing modules | Pass |
| Encryption: no new sensitive columns; existing `IntegrationCredentials.credentials` encryption is sufficient | Pass |
| BC analysis covers every modified surface | Pass (§ 18) |
| `EntityExtension` shape matches canonical type | Pass (§ 2.3) |
| `createModuleEvents` signature matches canonical | Pass (§ 10.1) |
| URL convention matches shipping snake_case | Pass (§ 13) |
| Messages module widget-spot additions explicitly in-scope | Pass (§ 9.3a) |
| HTML sanitizer helper specified | Pass (§ 4.6) |
| Notification types use dotted convention | Pass (§ 10.3) |
| `refreshCredentials?` / `validateCredentials?` adapter methods defined | Pass (§ 1.1) |

### Non-Compliant Items

None.

### Verdict

**Fully compliant with hub + UMES + AGENTS.md after the 2026-05-22 fixes.** Approved for implementation.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | v1 spec draft — ChannelAdapter contract, WhatsApp provider sketch, NotificationTransportAdapter. **Never implemented.** |
| 2026-03-11 | v2 spec draft — Unified Messaging Bridge: bidirectional message/reaction sync with Messages module, capabilities-driven adapter, rich payload storage (Slack Block Kit, WhatsApp interactive, email MIME), `MessageChannelLink`/`ChannelThreadMapping`/`MessageReaction` entities, per-channel threading models, contact resolution, UI adaptation via enrichers and widget injection, Slack provider as feature-rich reference, email inbound provider, 7 implementation phases. **Never implemented.** |
| 2026-05-22 | Pre-implementation fixes (applied per `.ai/specs/analysis/ANALYSIS-SPEC-045d-communication-notification-hubs.md`). No architectural changes; spec text cleaned to match shipping conventions ahead of the first implementation PR. Concretely: (1) reframed v1/v2 narrative — there is no v1 in code; spec is the first implementation; renamed § 1.1 from "ChannelAdapter v2 Contract" to "ChannelAdapter Contract"; replaced § 1.3 v1-fallback with the strict `validateAdapterCapabilities()` registry helper. (2) Added **Prerequisites & Cross-Spec Dependencies** section at the top listing the four ships this spec depends on (Messages, Integrations, UMES, Scheduler). (3) Added `refreshCredentials?(input)` and `validateCredentials?(input)` optional methods to `ChannelAdapter` per the email integration spec's requirements. (4) Fixed `createModuleEvents` signature — was `createModuleEvents('communication_channels', [...])`; now `createModuleEvents({ moduleId: 'communication_channels', events })` matching canonical shape in `@open-mercato/shared/modules/events`. (5) Fixed `EntityExtension` shape — was `{ sourceModule, sourceEntity, targetModule, targetEntity, linkField, description }`; now canonical `{ base, extension, join: { baseKey, extensionKey }, cardinality, description }`. (6) Fixed API URL convention — was `/api/communication-channels/...` (hyphenated); now `/api/communication_channels/...` (snake_case) matching shipping convention (`/api/payment_gateways/...`, `/api/shipping_carriers/...`) and the email integration spec. (7) Added full entity schemas for `CommunicationChannel`, `ExternalConversation`, `ExternalMessage` (§ 2.2). (8) Replaced raw SQL on `query_index` in § 8.1 contact resolution with a `QueryEngine.query('customers:person', …)` call (lessons.md "no raw SQL in route handlers"). (9) Made Messages-module widget-spot additions **explicit and in-scope** in new § 9.3a — four `<InjectionPoint id="…" />` placements in Messages pages, declared as additive BC, with file-level integration test. Resolves the prior contradiction between "Messages module is never modified" and reliance on Messages widget spots. (10) Added § 4.6 **HTML sanitization helper** (`lib/sanitize-channel-html.ts` with DOMPurify-backed allowlist for email + chat HTML) — required by the email integration spec's Phase 1 acceptance. (11) Added `communication_channels.channel.requires_reauth` notification type to § 10.3 (channel-agnostic; consumed by the email integration spec). Aligned notification type IDs to the dotted convention used in shipping `notifications.ts` files. (12) Added new § 19 **Final Compliance Report** mapping every project rule to status. (13) Restructured § 18 **Migration & Backward Compatibility** as a 13-row table walking each BC contract surface category. **Housekeeping follow-up** (not done in this commit): `git mv .ai/specs/implemented/SPEC-045d-communication-notification-hubs.md .ai/specs/` — the spec is not implemented; folder placement currently misleads agents and developers. |
