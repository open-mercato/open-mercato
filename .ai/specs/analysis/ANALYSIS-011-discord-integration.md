# Integration Feasibility Analysis — Discord

## Overview
- Discord is a communication platform for communities
- REST API + Gateway WebSocket (for real-time events)
- Hub: `notification_providers` (NotificationTransportAdapter) — primary
- Module ID: `notifier_discord`
- Overall Feasibility: **Full for notifications, Infeasible for bidirectional**

## Critical Architecture Issue: Gateway WebSocket
**Discord's real-time event system uses a persistent WebSocket connection** requiring:
- Heartbeat every ~41.25 seconds
- Reconnection with session resume
- IDENTIFY, RESUME, HEARTBEAT_ACK opcodes
- Gateway intents for event filtering

**Fundamentally incompatible with the framework's stateless worker model.** ChannelAdapter expects HTTP-based webhook delivery. Discord has NO HTTP-based event push system.

## Integration Patterns

### Pattern A — Incoming Webhooks (Recommended)
- Send-only notifications via webhook URLs
- `POST https://discord.com/api/webhooks/{id}/{token}`
- No bot account, no OAuth, no Gateway
- Credential: webhook URL as `secret` type
- Perfect `NotificationTransportAdapter` fit

### Pattern B — Bot REST API (limited)
- Bot token for REST API calls
- `POST /channels/{id}/messages` for sending
- Receiving REQUIRES Gateway WebSocket — NOT compatible

## NotificationTransportAdapter Mapping
| Method | Discord API | Feasibility |
|--------|-----------|-------------|
| send | POST /webhooks/{id}/{token} with content/embeds | Full |
| getDeliveryStatus | Not available | Gap |
| verifyWebhook | N/A (outbound only) | N/A |

## Discord Features
- **Embeds**: Rich formatted messages with fields, color, thumbnail, footer
- **Username/avatar override**: Per-message customization
- **@mentions**: Role/user mentions in content
- **File attachments**: Multipart upload with message

## Rate Limits
- Webhook: 5 requests per 2 seconds per webhook
- Bot API: 5-10/sec per endpoint
- Global: 50 req/sec per bot

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Send notifications (webhook) | 5 / Excellent | Trivial, no auth complexity |
| Rich formatting (embeds) | 5 / Excellent | Maps to notification templates |
| File attachments | 4 / Good | Multipart upload |
| Receive messages | 1 / Infeasible | Requires Gateway WebSocket |
| Interactive (buttons) | 2 / Difficult | Requires bot + Gateway |
| Delivery status | 1 / Infeasible | No API |

## Key Challenges
1. **Gateway WebSocket incompatibility**: Receiving messages needs persistent WebSocket. Cannot implement as module worker
2. **No HTTP webhook delivery**: Unlike Slack Events API, Discord has no HTTP push system
3. **Webhook URL as credential**: Contains secret token. Must encrypt. Leak = anyone can post
4. **Rate limit**: 5 req/2s per webhook is low for burst scenarios. Must queue and throttle

## Recommended Approach
- Implement `notifier_discord` using Incoming Webhooks only
- Skip bidirectional `ChannelAdapter` — architecture incompatible
- If ever needed, requires dedicated WebSocket daemon outside module system

## Gaps Summary
- Bidirectional fundamentally incompatible (Gateway WebSocket)
- No delivery status API
- Limited to send-only
- Estimated effort: **1-2 weeks** (notification-only)
