# SPEC-045d — Communication & Notification Hubs

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 4 of 6

---

## Goal

Align PR #674 (external_channels) as the `communication_channels` hub and build the `notification_providers` hub for external notification delivery (email, SMS, push).

---

## 1. Communication Channels Hub — `communication_channels`

### 1.1 ChannelAdapter Contract

Aligned with PR #674 (WhatsApp/External Channels):

```typescript
// communication_channels/lib/adapter.ts

interface ChannelAdapter {
  readonly providerKey: string
  readonly channelType: 'whatsapp' | 'sms' | 'email' | string

  /** Send a message through this channel */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>

  /** Receive and parse an inbound message webhook */
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage>

  /** Get message delivery status */
  getStatus(input: GetMessageStatusInput): Promise<MessageStatus>

  /** List available phone numbers / sender IDs (if applicable) */
  listSenders?(input: ListSendersInput): Promise<SenderInfo[]>
}

interface SendMessageInput {
  channelId: string
  recipientId: string         // Phone number, email, user ID
  content: MessageContent
  conversationId?: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

interface MessageContent {
  type: 'text' | 'template' | 'media' | 'interactive'
  text?: string
  templateId?: string
  templateParams?: Record<string, string>
  mediaUrl?: string
  buttons?: MessageButton[]
}

type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'
```

### 1.2 Refactoring from PR #674

The `external_channels` module from PR #674 becomes the hub. WhatsApp becomes the first spoke:

| PR #674 Component | New Location |
|-------------------|-------------|
| `CommunicationChannel` entity | `communication_channels/data/entities.ts` (hub) |
| `ExternalConversation` entity | `communication_channels/data/entities.ts` (hub) |
| `ExternalMessage` entity | `communication_channels/data/entities.ts` (hub) |
| WhatsApp webhook handler | `channel_whatsapp/lib/adapter.ts` (spoke) |
| WhatsApp API client | `channel_whatsapp/lib/client.ts` (spoke) |
| AI summary/classification | `communication_channels/lib/ai-service.ts` (hub) |

### 1.3 First Provider — `channel_whatsapp`

```
packages/core/src/modules/channel_whatsapp/
├── index.ts
├── integration.ts       # category: 'communication', hub: 'communication_channels'
├── setup.ts             # registerChannelAdapter(whatsappAdapter)
├── lib/
│   ├── adapter.ts       # ChannelAdapter implementation
│   └── client.ts        # WhatsApp Cloud API client
└── i18n/
    ├── en.ts
    └── pl.ts
```

Credentials in `integration.ts`:
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

---

## 2. Notification Providers Hub — `notification_providers`

### 2.1 NotificationTransportAdapter Contract

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
  deviceToken?: string  // For push notifications
  userId?: string
}

interface SendNotificationResult {
  externalId: string       // Provider's message ID
  status: 'sent' | 'queued' | 'failed'
  error?: string
}
```

### 2.2 First Provider — `notifier_sendgrid`

```
packages/core/src/modules/notifier_sendgrid/
├── index.ts
├── integration.ts
├── setup.ts
├── lib/
│   └── adapter.ts
└── i18n/
```

---

## 3. Implementation Steps

### Communication Channels Hub
1. Refactor `external_channels` → `communication_channels` hub module
2. Extract WhatsApp code into `channel_whatsapp` spoke module
3. Add `integration.ts` to WhatsApp module
4. Migrate WhatsApp credentials to `IntegrationCredentials`
5. Add `integrationLog` usage for message send/receive logging
6. Integration tests for message sending, webhook verification

### Notification Providers Hub
1. Create `notification_providers` hub module
2. Define `NotificationTransportAdapter` contract
3. Create `notifier_sendgrid` as first provider
4. Wire hub into existing notification system (subscribers dispatch via transport adapter)
5. Integration tests for notification delivery, delivery receipts
