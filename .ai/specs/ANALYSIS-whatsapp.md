# Integration Feasibility Analysis — WhatsApp Business

## Overview
- WhatsApp Business Platform (Cloud API via Meta)
- Hub: `communication_channels` (ChannelAdapter per SPEC-045d)
- Module ID: `channel_whatsapp`
- Already specced as reference implementation in SPEC-045d
- Overall Feasibility: **Full** — well-documented, high e-commerce demand

## API Analysis
- Cloud API v18+: `POST /v18.0/{phone_number_id}/messages`
- Auth: Long-lived System User Access Token (Meta Business Manager). Static secret, not OAuth 2.0
- Rate limits: Tier-based messaging limits (1K/day → 100K/day based on quality score)
- Pricing: Conversation-based (each 24h window = one conversation)
- Webhooks: Meta Webhooks API with HMAC-SHA256 via `X-Hub-Signature-256`

## ChannelAdapter Mapping
| Method | WhatsApp API | Feasibility |
|--------|-------------|-------------|
| sendMessage (text) | POST messages with type: text | Full |
| sendMessage (template) | POST messages with type: template | Full — required outside 24h window |
| sendMessage (interactive) | POST messages with type: interactive | Full — buttons, lists |
| verifyWebhook | Validate X-Hub-Signature-256 (HMAC-SHA256) | Full |
| getStatus | Push-only — status webhooks (delivered, read) | Partial — serve from stored logs |
| listSenders | GET /{business_id}/phone_numbers | Full |

## 24-Hour Messaging Window
- After last customer message: 24h for free-form messages
- Outside window: MUST use pre-approved template messages (24-72h Meta review)
- Conversation-based pricing: each 24h window is one billable conversation

## Webhook Events
- `messages` — incoming customer messages (text, image, document, location)
- `statuses` — delivery status (sent, delivered, read, failed)
- GET verification challenge on initial setup

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Send text messages | 5 / Excellent | Direct API mapping |
| Send template messages | 4 / Good | Position-based parameter format |
| Interactive (buttons/lists) | 4 / Good | Maps to MessageButton[] |
| Receive messages | 5 / Excellent | Webhook-based, reliable |
| Delivery status | 4 / Good | Push-only, no polling API |
| Media messages | 4 / Good | Upload media first, then reference |
| Group messaging | 2 / Difficult | Business API focused on 1:1 |

## Key Challenges
1. **Template message approval**: Templates must be pre-approved by Meta. Cannot send arbitrary messages outside 24h
2. **getStatus is push-only**: No polling API. Serve from stored webhook events
3. **Template parameter format**: Position-based `{{1}}`, `{{2}}` not named `{{key}}`
4. **Media handling**: Upload to WhatsApp first, get media ID, then reference in message
5. **Phone number verification**: Must be verified via Meta Business Manager
6. **Conversation pricing**: Each 24h window = billable conversation

## Gaps Summary
- getStatus relies on webhook event storage
- Template parameter position-based mapping needed
- Already specced in SPEC-045d — implementation ready
- Estimated effort: **3-4 weeks**
