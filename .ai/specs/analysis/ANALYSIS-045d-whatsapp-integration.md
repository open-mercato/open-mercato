# SPEC-045d Analysis — WhatsApp Cloud API Integration Feasibility

| Field | Value |
|-------|-------|
| **Parent Spec** | [SPEC-045d — Communication & Notification Hubs](../SPEC-045d-communication-notification-hubs.md) |
| **Date** | 2026-02-24 |
| **Scope** | WhatsApp Business Cloud API vs. Open Mercato `channel_whatsapp` module |

---

## Executive Summary

The `ChannelAdapter` contract defined in SPEC-045d covers the **core happy path** of WhatsApp integration well: sending messages, receiving webhooks, tracking delivery status, and listing sender phone numbers. However, the WhatsApp Cloud API is significantly richer than what the current adapter contract accommodates. Several high-value WhatsApp features — template management, interactive messages, commerce/catalog, Flows, media handling, and compliance tooling — either fall outside the adapter contract or require non-trivial extensions to implement properly.

**Verdict**: ~60% of WhatsApp's value is achievable with the current spec. Reaching ~90% requires expanding the adapter contract and adding WhatsApp-specific backend pages. The remaining ~10% (payments, group chat, Status/Stories) is either geo-restricted, severely limited by Meta, or not exposed via the API at all.

---

## 1. Capability Coverage Matrix

### Fully Covered by SPEC-045d

| WhatsApp Feature | Adapter Method | Notes |
|---|---|---|
| Send text messages | `sendMessage()` | `content.type: 'text'` maps directly |
| Send template messages | `sendMessage()` | `content.type: 'template'` with `templateId` + `templateParams` |
| Send media messages | `sendMessage()` | `content.type: 'media'` with `mediaUrl` |
| Receive inbound messages | `verifyWebhook()` | Returns `InboundMessage` |
| Track delivery status | `getStatus()` | Returns `sent / delivered / read / failed` |
| List phone numbers | `listSenders()` | Optional method, returns `SenderInfo[]` |
| Credential management | `integration.ts` | 5 fields: accessToken, phoneNumberId, businessAccountId, webhookVerifyToken, appSecret |
| Operation logging | `IntegrationLog` | Shared logging infrastructure from SPEC-045a |
| Enable/disable per tenant | `IntegrationState` | Standard integration marketplace mechanism |

### Partially Covered (Needs Extension)

| WhatsApp Feature | Gap | Effort |
|---|---|---|
| **Interactive messages** (reply buttons, list messages) | `MessageContent.buttons` exists but `type: 'interactive'` needs sub-types (reply_button vs list vs CTA_url vs call_button). List messages need `sections` with options. Max 3 reply buttons, max 10 list items. | Medium |
| **Media upload/download** | `mediaUrl` assumes a URL, but WhatsApp uses a media upload API that returns a `media_id`. Inbound media arrives as `media_id` requiring a separate download call. Need upload-before-send and download-on-receive flows. | Medium |
| **Webhook payload richness** | `InboundMessage` is generic. WhatsApp webhooks carry message type, media IDs, interactive response selections, location data, contact cards, reactions, order data. The return type needs to be extensible or WhatsApp-specific data must be stored in a metadata bag. | Medium |
| **Message status granularity** | `MessageStatus` covers `sent/delivered/read/failed` which matches WhatsApp. However, WhatsApp also has `accepted` and `held_for_quality_assessment`. These need mapping or the enum needs extending. | Low |

### Not Covered (Missing from Spec)

| WhatsApp Feature | Why It Matters | Implementation Difficulty |
|---|---|---|
| **Template management** (CRUD, approval status tracking) | Businesses need to create, submit for approval, and monitor template status. Without this, admins must use Meta Business Manager separately — a major UX gap for a "marketplace" integration. | **High** |
| **24-hour conversation window tracking** | Determines whether free-form messages or templates are required. Without tracking, the system may try to send session messages outside the window and fail silently. | **High** |
| **Contact opt-in/consent management** | WhatsApp requires explicit opt-in before business-initiated messaging. GDPR and Meta policies demand auditable consent. No entity or workflow exists for this. | **High** |
| **WhatsApp Flows** (structured forms) | Powerful for lead qualification, surveys, appointment booking. Requires Flow creation API, endpoint for dynamic data exchange, and response parsing. | **High** |
| **Commerce / Catalog integration** | Product catalog messages, cart handling, order webhooks. Ties into the `catalog` module but needs a bridge to Meta Commerce Manager. | **High** |
| **Location messages** | Send and receive GPS coordinates with name/address. Not represented in `MessageContent.type`. | **Low** |
| **Contact card messages** | Send structured contact information (vCard format). Not represented in `MessageContent.type`. | **Low** |
| **Reaction messages** | Send emoji reactions to specific messages by message ID. Not represented in `MessageContent.type`. | **Low** |
| **Business profile management** | Update about text, address, description, profile picture, websites via API. No admin UI planned for this. | **Medium** |
| **Quality rating monitoring** | Phone number quality (Green/Yellow/Red) affects messaging limits. Webhook events for quality changes exist but no handler or dashboard planned. | **Medium** |
| **Multi-number routing** | WABA supports up to 20 numbers. Current spec assumes a single `phoneNumberId` in credentials. Multi-number needs a number registry and routing logic. | **Medium** |
| **Rate limit / tier awareness** | Messaging limits (250/1K/10K/100K/unlimited unique conversations per 24h). No throttling or tier tracking in the adapter. | **Medium** |
| **Sticker messages** | Session-only, WEBP format, 512x512px. Niche but expected by users. | **Low** |
| **Payments** | Only available in India and Brazil. Geo-restricted, not worth implementing initially. | **Skip** |
| **Status/Stories** | No API support at all. Cannot be implemented. | **Impossible** |
| **Voice/Video calls** | Not available via Cloud API. | **Impossible** |
| **Group chat** | Requires 100K+ monthly conversations; max 8 members; no interactive elements. Too restricted for general use. | **Skip** |
| **Message editing** | Not available via API. | **Impossible** |
| **Polls** | Not available via API. | **Impossible** |
| **Channels/Newsletters** | Not available via Business API. | **Impossible** |

---

## 2. Detailed Gap Analysis

### 2.1 Template Management — HIGH Priority, HIGH Effort

**Why it's critical**: WhatsApp requires pre-approved templates for any business-initiated message outside the 24-hour customer service window. Without template management, the integration is essentially limited to reactive messaging only.

**What's needed**:
- CRUD API for templates (create, list, update, delete via WhatsApp Business Management API)
- Template approval status tracking (pending, approved, rejected, disabled)
- Webhook handler for template status change events
- Admin UI: template editor with header (text/media), body (with variable placeholders `{{1}}`), footer, buttons (reply/CTA URL/call)
- Template category selection (marketing, utility, authentication) — affects pricing
- Template preview and variable mapping when sending
- Max 250 templates per WABA — show usage

**ChannelAdapter impact**: New optional method `manageTemplates()` or a separate `TemplateManager` service. This is WhatsApp-specific enough that it probably doesn't belong in the generic `ChannelAdapter` interface.

**Recommendation**: Add a `channel_whatsapp`-specific backend page at `/backend/integrations/whatsapp/templates` for template management. Keep the generic adapter contract clean.

### 2.2 Conversation Window Tracking — HIGH Priority, HIGH Effort

**Why it's critical**: The 24-hour customer service window fundamentally changes what message types are allowed. Sending a non-template message outside the window results in a `failed` status and wastes API calls.

**What's needed**:
- Track last customer message timestamp per conversation/contact
- Before `sendMessage()`, check if within 24h window
- If outside window: require template message type, reject free-form attempts with clear error
- UI indicator showing window status (open/closed, time remaining)
- Handle window reopening when customer sends a new message

**ChannelAdapter impact**: The adapter's `sendMessage()` should validate or the hub should enforce window rules before delegating to the adapter.

**Recommendation**: Add a `conversation_window_expires_at` column to `ExternalConversation` entity. Update on every inbound message. The hub layer validates before calling `adapter.sendMessage()`.

### 2.3 Opt-In / Consent Management — HIGH Priority, HIGH Effort

**Why it's critical**: Meta requires explicit opt-in before business-initiated messaging. GDPR mandates auditable consent records. Violating opt-in rules leads to account restrictions or bans.

**What's needed**:
- Consent entity: who opted in, when, via what channel, consent text shown
- Double opt-in flow support (recommended / required in many jurisdictions)
- Opt-out handling (parse "STOP" replies, update consent status)
- Integration with `customers` module (link consent to contact records)
- Consent audit log for GDPR compliance
- UI for viewing/managing consent status per contact

**ChannelAdapter impact**: This is a hub-level concern, not adapter-specific. The `communication_channels` hub should own consent tracking since it applies to all channels (WhatsApp, SMS, etc.).

**Recommendation**: Add consent entities to the `communication_channels` hub module. Block `sendMessage()` calls to contacts without active consent.

### 2.4 WhatsApp Flows — MEDIUM Priority, HIGH Effort

**Why it matters**: Flows enable structured data collection (lead forms, appointment booking, surveys) natively inside WhatsApp — a significant competitive differentiator.

**What's needed**:
- Flow builder or import UI in admin panel
- Flow API client (create, update, publish, deprecate)
- Dynamic Flow endpoint for real-time data exchange
- Response parsing and storage (map Flow responses to CRM fields)
- Published Flows are immutable — version management required

**ChannelAdapter impact**: Flows don't fit into `sendMessage()`. They need a separate API surface.

**Recommendation**: Defer to Phase 2 of WhatsApp integration. Build as a separate `channel_whatsapp` feature, not part of the generic adapter.

### 2.5 Commerce / Catalog Bridge — MEDIUM Priority, HIGH Effort

**Why it matters**: WhatsApp supports product catalog messages, in-chat carts, and order submissions. Bridging the Open Mercato `catalog` module with Meta Commerce Manager creates a seamless sales channel.

**What's needed**:
- Sync products from Open Mercato `catalog` → Meta Commerce Manager (data sync adapter?)
- Send single-product and multi-product messages via `sendMessage()`
- Handle order webhooks (customer submits cart → create sales order)
- Catalog visibility toggle per phone number

**ChannelAdapter impact**: Extends `MessageContent.type` with `'product'` and `'multi_product'`. Order webhooks need a new event type.

**Recommendation**: Leverage the `data_sync` hub (SPEC-045b) for catalog sync to Meta Commerce Manager. Build order webhook handling as a subscriber in `channel_whatsapp`. Implement after core messaging works.

### 2.6 Media Upload/Download Pipeline — MEDIUM Priority, MEDIUM Effort

**Why it matters**: WhatsApp's media handling uses a two-step process (upload → get media_id → reference in message). Inbound media arrives as media_id requiring a separate download API call. The current `mediaUrl` field in `MessageContent` doesn't capture this.

**What's needed**:
- Upload service: accept file → upload to WhatsApp API → return `media_id`
- Download service: receive `media_id` from webhook → download → store locally
- Media expiration awareness (WhatsApp deletes after 30 days)
- Format/size validation before upload (image: 5MB, video: 16MB, doc: 100MB, sticker: 512x512 WEBP)
- Integration with existing attachments module for local storage

**ChannelAdapter impact**: `sendMessage()` needs to accept either `mediaUrl` or `mediaId`. The adapter handles the upload if given a URL. The hub handles download on inbound media.

**Recommendation**: Add a `WhatsAppMediaService` in `channel_whatsapp/lib/media.ts`. The adapter calls it internally — no changes to the generic contract needed.

### 2.7 Multi-Number Support — LOW Priority, MEDIUM Effort

**Why it matters**: Businesses with multiple departments, regions, or brands may use multiple WhatsApp numbers. Current spec stores a single `phoneNumberId` in credentials.

**What's needed**:
- Support multiple phone number configurations per tenant
- Number selection when sending messages (auto-route or manual)
- Inbound routing: webhook identifies receiving number via `metadata.phone_number_id`
- Per-number quality tracking and messaging limits

**Recommendation**: Model as multiple `IntegrationState` entries (one per number) under the same `channel_whatsapp` integration. Or add a `PhoneNumber` entity in the WhatsApp module. Defer to post-MVP.

---

## 3. ChannelAdapter Contract Assessment

### Current Contract Strengths
- Clean, minimal interface — easy for other channel providers (Twilio, SMS) to implement
- `sendMessage()` covers the core sending use case
- `verifyWebhook()` properly separates webhook parsing from business logic
- `getStatus()` covers delivery tracking
- `listSenders()` handles phone number discovery

### Current Contract Weaknesses

| Issue | Impact | Suggested Fix |
|---|---|---|
| `MessageContent.type` too narrow | Cannot represent location, contacts, reactions, stickers, products, Flows | Add types: `'location'`, `'contacts'`, `'reaction'`, `'sticker'`, `'product'`, `'flow'`. Use union types with type-specific payloads. |
| No conversation/session context | Cannot enforce 24h window rules | Add `conversationState?: { windowExpiresAt?: Date }` to `SendMessageInput` or validate at hub level |
| `InboundMessage` return type underspecified | Cannot parse interactive responses, media IDs, order data | Define `InboundMessage` as a discriminated union by message type with type-specific fields |
| No batch/broadcast support | Must call `sendMessage()` N times for bulk sends | Add optional `sendBatch()` method with rate limiting (80 msg/sec per number) |
| No template lifecycle | Can't create/manage templates through the adapter | Keep out of adapter — add as provider-specific feature |
| No webhook subscription management | Cloud API webhook URL is configured in Meta dashboard, not via API | Document as manual setup step. Consider adding `getWebhookUrl()` helper for the setup guide. |

### Recommended Contract Extensions

```typescript
// Extended MessageContent (backward-compatible — new optional types)
interface MessageContent {
  type: 'text' | 'template' | 'media' | 'interactive' | 'location' | 'contacts' | 'reaction' | 'sticker' | 'product'
  // ... existing fields ...
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  contacts?: ContactCard[]
  reaction?: { messageId: string; emoji: string }
  interactive?: InteractiveContent
}

interface InteractiveContent {
  subType: 'reply_buttons' | 'list' | 'cta_url' | 'call_button' | 'product' | 'multi_product' | 'flow'
  header?: { type: 'text' | 'image' | 'video' | 'document'; content: string }
  body: string
  footer?: string
  buttons?: Array<{ id: string; title: string; url?: string; phoneNumber?: string }>
  sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
  flowId?: string
  flowAction?: string
  catalogId?: string
  productIds?: string[]
}

// Extended InboundMessage
interface InboundMessage {
  messageId: string
  from: string
  timestamp: Date
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contacts' | 'interactive_response' | 'order' | 'reaction' | 'system'
  text?: string
  mediaId?: string
  mimeType?: string
  location?: { latitude: number; longitude: number; name?: string }
  contacts?: ContactCard[]
  interactiveResponse?: { type: string; buttonId?: string; listRowId?: string; flowResponse?: Record<string, unknown> }
  order?: { catalogId: string; items: Array<{ productId: string; quantity: number; price: number }> }
  reaction?: { messageId: string; emoji: string }
  metadata?: Record<string, unknown>
}
```

---

## 4. Integration with Existing Modules

### Messages Module (SPEC-002) — Bridge Needed

The internal `messages` module handles user-to-user messaging within Open Mercato. WhatsApp messages are external customer-to-business communications. These are fundamentally different systems but need a bridge:

| Concern | Messages Module | WhatsApp |
|---|---|---|
| Participants | Internal users (employees) | External contacts (customers) |
| Threading | Message threads by `threadId` | Conversations by phone number |
| Storage | `Message` entity | `ExternalMessage` entity (hub) |
| Notifications | In-app + email | WhatsApp delivery status |
| Actions | Approve/Reject buttons | Interactive reply buttons |

**Bridge opportunity**: When a WhatsApp message arrives, optionally create an internal `Message` linked to the `ExternalConversation` so that internal users can discuss the customer inquiry within the Open Mercato messaging system before responding via WhatsApp.

**Recommendation**: Build as an event subscriber (`communication_channels.message.received` → create linked internal message). Not part of MVP.

### Customers Module — Natural Integration

- Link `ExternalConversation` to a `Customer` record via phone number matching
- Auto-create customer contact when new WhatsApp conversation starts
- Show WhatsApp conversation history on customer detail page (UMES widget injection)
- Consent management ties to customer contact data

### Sales Module — Commerce Bridge

- WhatsApp order webhooks → create draft sales order
- Send order confirmations as template messages
- Send shipping updates as utility templates

### Notifications Module (SPEC-003) — Delivery Channel

The `notification_providers` hub (SPEC-045d §2) can use WhatsApp as a notification delivery transport. A notification subscriber could dispatch via WhatsApp template message instead of (or in addition to) email.

---

## 5. Technical Risks & Challenges

### 5.1 Webhook Reliability — HIGH Risk

- WhatsApp requires 200 OK response within **5 seconds** or marks delivery as failed
- Webhooks are delivered **at-least-once** — handlers must be idempotent
- Webhook payload signing uses `X-Hub-Signature-256` (HMAC-SHA256 with app secret)

**Mitigation**: The current `verifyWebhook()` adapter method handles parsing. Ensure the API route responds immediately (200 OK) and queues processing via worker. Add deduplication by `messageId`.

### 5.2 Rate Limiting — MEDIUM Risk

- 80 messages/second per phone number (default)
- Messaging tier limits on unique new conversations (250/1K/10K/100K/unlimited)
- Quality rating drops can cause tier downgrades

**Mitigation**: Add a rate limiter in `WhatsAppClient`. Track messaging tier in `IntegrationState` metadata. Monitor quality rating via webhooks.

### 5.3 Credential Complexity — MEDIUM Risk

WhatsApp requires 5 credential fields plus:
- Access tokens can expire (if using system user tokens, they last 60 days)
- Webhook verify token must match the token configured in Meta dashboard
- App secret is used for webhook signature verification

**Mitigation**: Add token refresh logic or document long-lived token generation. The `IntegrationCredentials` encrypted store handles storage. Add health check that validates token.

### 5.4 Meta API Versioning — MEDIUM Risk

- Meta deprecates API versions regularly (typically ~2 year lifecycle)
- Breaking changes between versions are common
- SPEC-045's `apiVersions` mechanism handles this well

**Mitigation**: Ship with current stable version. Use `apiVersions` to add new versions when Meta releases them. Sunset dates from Meta map to `sunsetAt` field.

### 5.5 Policy Compliance — HIGH Risk

- General-purpose AI chatbot ban (Oct 2025) — affects AI-powered auto-responses
- Opt-in requirements — must be enforced programmatically
- Template rejection — content policies are strict and sometimes opaque

**Mitigation**: Document policies clearly in integration setup guide. Add guardrails in the hub layer (consent check, template-only outside window). AI summary/classification from PR #674 should be limited to internal use, not auto-response.

---

## 6. Phased Implementation Recommendation

### Phase 1 — Core Messaging (MVP)

| Feature | Effort | Notes |
|---|---|---|
| `ChannelAdapter` implementation (send text, template, media) | 3-5 days | Core adapter with WhatsApp Cloud API client |
| Webhook handler (inbound messages, status updates) | 2-3 days | Idempotent processing via worker queue |
| `ExternalConversation` + `ExternalMessage` entities | 1-2 days | Already designed in SPEC-045d |
| Admin UI: conversation list, message thread view | 3-5 days | Backend pages in `communication_channels` |
| Credential setup (5 fields) | 1 day | Standard `integration.ts` pattern |
| Integration with `IntegrationLog` for operation tracking | 1 day | Standard SPEC-045a pattern |
| **Subtotal** | **~2 weeks** | |

### Phase 2 — Business Essentials

| Feature | Effort | Notes |
|---|---|---|
| Template management (CRUD + approval tracking) | 5-7 days | WhatsApp-specific backend pages |
| 24h conversation window tracking | 2-3 days | Hub-level validation |
| Consent/opt-in management | 3-5 days | Hub-level entities + UI |
| Interactive messages (buttons, lists) | 2-3 days | Extend `MessageContent` types |
| Media upload/download pipeline | 2-3 days | WhatsApp-specific media service |
| Customer module integration (contact linking) | 2-3 days | Event subscriber + UMES widget |
| Quality rating monitoring dashboard | 1-2 days | Webhook handler + admin widget |
| **Subtotal** | **~3-4 weeks** | |

### Phase 3 — Advanced Features

| Feature | Effort | Notes |
|---|---|---|
| WhatsApp Flows (form builder + response handling) | 2-3 weeks | Complex; new UI for Flow design |
| Commerce/Catalog bridge | 1-2 weeks | Depends on data_sync hub maturity |
| Multi-number support | 3-5 days | Credential model extension |
| Notifications module bridge (WhatsApp as delivery transport) | 2-3 days | Notification transport adapter |
| Internal messages bridge | 2-3 days | Event subscriber |
| **Subtotal** | **~4-6 weeks** | |

### Not Planned (API Limitations)

| Feature | Reason |
|---|---|
| Status/Stories | No API support |
| Voice/Video calls | Not available via Cloud API |
| Group messaging | Too restricted (100K+ conversations required, max 8 members) |
| Message editing | Not available via API |
| Polls | Not available via API |
| Channels/Newsletters | Not available via Business API |
| Payments | Geo-restricted (India, Brazil only) |

---

## 7. Impact on ChannelAdapter Contract

The analysis reveals a tension between keeping the `ChannelAdapter` generic (for reuse with Twilio, SMS, email channels) and accommodating WhatsApp's rich feature set.

**Recommendation — Two-Layer Architecture**:

```
┌───────────────────────────────────────────────┐
│  ChannelAdapter (Generic)                     │
│  sendMessage(), verifyWebhook(), getStatus()  │
│  → Covers core messaging for ALL channels     │
└───────────────────┬───────────────────────────┘
                    │ extends
┌───────────────────▼───────────────────────────┐
│  WhatsAppExtendedAdapter (WhatsApp-specific)  │
│  manageTemplates(), uploadMedia(),            │
│  getConversationWindow(), getQualityRating(), │
│  sendFlowMessage(), getCatalogProducts()      │
│  → WhatsApp-only features                     │
└───────────────────────────────────────────────┘
```

The generic `ChannelAdapter` stays clean. WhatsApp-specific capabilities are exposed via an extended interface that the `channel_whatsapp` module implements and that WhatsApp-specific UI pages consume directly.

---

## 8. Conclusion

| Dimension | Assessment |
|---|---|
| **Core messaging** | Fully achievable with current spec |
| **Template management** | Critical gap — must be addressed for production use |
| **Conversation windows** | Critical gap — required to avoid send failures |
| **Consent management** | Critical gap — required for GDPR/Meta compliance |
| **Interactive messages** | Achievable with minor contract extension |
| **Media handling** | Achievable with adapter-internal implementation |
| **Flows** | Feasible but high effort — defer to Phase 3 |
| **Commerce bridge** | Feasible but depends on catalog sync maturity |
| **Multi-number** | Feasible — defer to Phase 3 |
| **Payments, Calls, Stories** | Not possible via API — accept as platform limitation |

The Open Mercato integration framework (SPEC-045) provides a solid foundation. The `ChannelAdapter` contract handles the happy path well. The main work is in **WhatsApp-specific features** (templates, windows, consent) that should be built as provider-specific extensions rather than forcing them into the generic adapter contract.
