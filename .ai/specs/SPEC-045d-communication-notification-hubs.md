# SPEC-045d — Communication & Notification Hubs (v2: Unified Messaging Bridge)

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 4 of 6
**Related**: [SPEC-002 — Messages Module](./SPEC-002-2026-01-23-messages-module.md), [SPEC-045a — Foundation](./SPEC-045a-foundation.md), [SPEC-045c — Payment & Shipping Hubs](./SPEC-045c-payment-shipping-hubs.md)

---

## TLDR

Extends the `communication_channels` hub with a **bidirectional messaging bridge** to the Messages module. Inbound messages from WhatsApp, Slack, Email (and any future channel) create threaded conversations in the unified Messages inbox. Users reply from the inbox and replies route back through the originating channel. Each provider declares its **capabilities** (reactions, rich blocks, threading, file sharing) and stores **channel-native payloads** (Slack Block Kit, WhatsApp interactive messages, email MIME) alongside normalized text. **Reactions** are first-class entities with bidirectional sync. Zero coupling — the Messages module is never modified; all bridging happens through hub entities, enrichers, widget injection, and event subscribers.

---

## Overview

### Problem Statement

The current SPEC-045d defines outbound `sendMessage()` and basic `verifyWebhook()` for inbound webhooks, but the data flows into `ExternalConversation`/`ExternalMessage` entities that are completely disconnected from the Messages module (SPEC-002). Users cannot see external conversations in their inbox, cannot reply to WhatsApp messages from the platform, and have no unified view of communication across channels.

Additionally, channels like Slack and WhatsApp carry rich, non-standard payloads (Block Kit, interactive buttons, reactions, contact cards, location sharing) that have no storage or rendering mechanism in the current design.

### Proposed Solution

1. **Messaging Bridge** — a set of hub entities (`MessageChannelLink`, `ChannelThreadMapping`, `MessageReaction`) that connect external conversations to Message threads without modifying the Messages module
2. **ChannelAdapter v2** — enhanced adapter contract with capabilities declaration, content normalization/conversion, reaction support, and contact resolution
3. **Rich Payload Storage** — dual representation: normalized body in `Message.body` for search/notifications + full channel-native JSON in `MessageChannelLink.channelPayload` for rich rendering
4. **Bidirectional Reactions** — `MessageReaction` entity with real-time sync between external channels and the Messages UI
5. **Provider Examples** — Slack (feature-rich reference) and WhatsApp (industry-standard baseline) as primary providers, Email as secondary

---

## 1. Communication Channels Hub — `communication_channels`

### 1.1 ChannelAdapter v2 Contract

All v1 methods remain unchanged for backward compatibility. v2 additions are new readonly properties and optional methods.

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

/** Enhanced ChannelAdapter v2 */
interface ChannelAdapter {
  readonly providerKey: string
  readonly channelType: 'whatsapp' | 'slack' | 'email' | 'sms' | string

  /** Declare supported features (new in v2) */
  readonly capabilities: ChannelCapabilities

  // ── v1 methods (unchanged) ─────────────────────────────────

  /** Send a message through this channel */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>

  /** Receive and parse an inbound message webhook */
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage>

  /** Get message delivery status */
  getStatus(input: GetMessageStatusInput): Promise<MessageStatus>

  /** List available phone numbers / sender IDs (optional) */
  listSenders?(input: ListSendersInput): Promise<SenderInfo[]>

  // ── v2 additions ───────────────────────────────────────────

  /** Convert platform Message body to channel-native format */
  convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent>

  /** Convert inbound channel message to platform-normalized format */
  normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage>

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

### 1.3 Backward Compatibility with v1 Adapters

```typescript
// communication_channels/lib/adapter-compat.ts

function resolveCapabilities(adapter: ChannelAdapter): ChannelCapabilities {
  if (adapter.capabilities) return adapter.capabilities
  // v1 fallback: minimal capabilities
  return {
    threading: false, richText: false, fileSharing: false,
    readReceipts: false, deliveryReceipts: true, typingIndicators: false,
    reactions: false, multiReactionPerUser: false,
    editMessage: false, deleteMessage: false,
    presence: false, richBlocks: false, interactiveComponents: false,
    inlineImages: false, conversationHistory: false,
    contactCards: false, locationSharing: false,
    voiceNotes: false, stickers: false,
    supportedBodyFormats: ['text'],
  }
}
```

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

### 2.2 Data Model — Bridge Entities

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

```typescript
// communication_channels/data/extensions.ts

import type { EntityExtension } from '@open-mercato/shared/modules/extensions'

export const extensions: EntityExtension[] = [
  {
    sourceModule: 'communication_channels',
    sourceEntity: 'message_channel_link',
    targetModule: 'messages',
    targetEntity: 'message',
    linkField: 'messageId',
    description: 'Links Messages to external channel conversations',
  },
  {
    sourceModule: 'communication_channels',
    sourceEntity: 'message_reaction',
    targetModule: 'messages',
    targetEntity: 'message',
    linkField: 'messageId',
    description: 'Emoji reactions on messages from external channels and internal users',
  },
]
```

### 2.4 Additive Changes to Existing Hub Entities

| Entity | Column | Type | Purpose |
|--------|--------|------|---------|
| `CommunicationChannel` | `capabilities` | `json`, nullable | Persisted adapter capabilities for UI |
| `ExternalConversation` | `contact_person_id` | `uuid`, nullable | Resolved CRM person FK |
| `ExternalConversation` | `assigned_user_id` | `uuid`, nullable | User owning this conversation |

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

### 4.6 Custom Message Type Renderers

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
POST /api/communication-channels/webhook/[provider]
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
POST /api/communication-channels/messages/:messageId/reactions
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
POST   /api/communication-channels/messages/:messageId/reactions
  Body: { emoji: string }
  Response: { id, emoji, reactedByUserId, createdAt }

DELETE /api/communication-channels/messages/:messageId/reactions/:reactionId
  Response: 204

GET    /api/communication-channels/messages/:messageId/reactions
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
POST /api/communication-channels/webhook/[provider]
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
CRM lookup (hub responsibility)
  │  Search customers.person by email or phone:
  │  SELECT * FROM query_index
  │    WHERE entity_type = 'customers:person'
  │    AND (doc->>'email' ILIKE :email OR doc->>'phone' ILIKE :phone)
  │    AND tenant_id = :tenantId
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

export const eventsConfig = createModuleEvents('communication_channels', [
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
] as const)
```

### 10.2 Subscribers

| Subscriber | Event | Purpose |
|------------|-------|---------|
| `channel-outbound-delivery` | `messages.message.sent` | Detect channel-linked threads and deliver reply to external channel |
| `channel-message-notification` | `communication_channels.message.received` | Create in-app notification for assigned user |

### 10.3 Notification Types

```typescript
// communication_channels/notifications.ts

export const notificationTypes = [
  {
    type: 'communication_channels.message_received',
    titleKey: 'communication_channels:notification.message_received.title',
    bodyKey: 'communication_channels:notification.message_received.body',
    icon: 'message-circle',
    actions: [
      { id: 'view', labelKey: 'common:view', href: '/backend/messages/{sourceEntityId}' },
    ],
  },
]
```

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
GET    /api/communication-channels                    # List configured channels
POST   /api/communication-channels                    # Configure a new channel
GET    /api/communication-channels/:id                # Channel details + capabilities
PUT    /api/communication-channels/:id                # Update channel config
DELETE /api/communication-channels/:id                # Remove channel
POST   /api/communication-channels/webhook/[provider] # Inbound webhook endpoint

# ── Bridge API (v2, new) ──────────────────────────────────────
GET    /api/communication-channels/threads            # List channel-linked threads
GET    /api/communication-channels/threads/:threadId  # Thread details with channel context
PUT    /api/communication-channels/threads/:threadId/assign  # Reassign conversation owner

# ── Reactions API (v2, new) ───────────────────────────────────
GET    /api/communication-channels/messages/:messageId/reactions     # List reactions
POST   /api/communication-channels/messages/:messageId/reactions     # Add reaction
DELETE /api/communication-channels/messages/:messageId/reactions/:id # Remove reaction
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
| TC-045D-009 | Capabilities exposed in channel API response | GET `/api/communication-channels/:id` | `capabilities` field present |
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

## 18. Migration & Backward Compatibility

1. **ChannelAdapter v1 stability**: All v1 methods unchanged. v2 methods are optional. Existing WhatsApp adapter works without changes until Phase 7 upgrade.

2. **Messages module untouched**: Zero modifications to Message entity, API routes, or UI. All bridging is additive via hub entities, enrichers, and subscribers.

3. **New tables only**: `message_channel_links`, `channel_thread_mappings`, `message_reactions` are new tables. No existing table modifications beyond additive nullable columns (`capabilities` on `CommunicationChannel`, `contact_person_id` and `assigned_user_id` on `ExternalConversation`).

4. **Event IDs**: New events follow `communication_channels.*` pattern. No existing events renamed or removed.

5. **Widget injection spots**: All new spots are additive. No existing spot IDs modified.

6. **Provider packages**: Slack, WhatsApp, Email are separate npm packages, not modifications to `packages/core`.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | v1: Initial spec — ChannelAdapter contract, WhatsApp provider, NotificationTransportAdapter |
| 2026-03-11 | v2: Unified Messaging Bridge — bidirectional message/reaction sync with Messages module, ChannelAdapter v2 with capabilities, rich payload storage (Slack Block Kit, WhatsApp interactive, email MIME), MessageChannelLink/ChannelThreadMapping/MessageReaction entities, per-channel threading models (Slack/WhatsApp/Email), contact resolution, UI adaptation via enrichers and widget injection, Slack provider as feature-rich reference, email inbound provider, 7 implementation phases |
