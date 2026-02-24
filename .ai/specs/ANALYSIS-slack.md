# Integration Feasibility Analysis — Slack

## Overview
- Slack is a team communication platform
- Web API (REST) + Events API (HTTP-based, NOT WebSocket)
- Hub: `communication_channels` (ChannelAdapter) + `notification_providers` (NotificationTransportAdapter)
- Module IDs: `channel_slack` (bidirectional), `notifier_slack` (notifications)
- Overall Feasibility: **Full** — most framework-compatible communication platform

## Critical Advantage: Events API is HTTP-based
Unlike Discord's Gateway WebSocket, Slack's Events API uses **standard HTTP POST** with HMAC-SHA256. No persistent connection needed. Full `ChannelAdapter` compatibility.

## API Analysis
- Web API: `chat.postMessage`, `conversations.list`, `files.upload`
- Events API: HTTP POST signed with `X-Slack-Signature` (HMAC-SHA256)
- Incoming Webhooks: Per-channel webhook URLs. One-way POST
- Slash Commands: POST when user types `/command`
- Auth: Bot Token (`xoxb-`) via OAuth 2.0 workspace install, or Incoming Webhook URL
- Rate limits: `chat.postMessage` Tier 3 (50 req/min). Generous

## ChannelAdapter Mapping
| Method | Slack API | Feasibility |
|--------|----------|-------------|
| sendMessage (text) | chat.postMessage { channel, text } | Full |
| sendMessage (interactive) | chat.postMessage with Block Kit { blocks } | Full |
| sendMessage (thread) | chat.postMessage { thread_ts } | Full |
| verifyWebhook | X-Slack-Signature HMAC-SHA256 | Full |
| getStatus | No delivery status API. Return 'sent' on success | Partial |
| listSenders | conversations.list → channels bot is in | Full |

## NotificationTransportAdapter (Incoming Webhooks)
| Method | Slack API | Feasibility |
|--------|----------|-------------|
| send | POST to webhook URL with { text } or { blocks } | Full — trivial |
| getDeliveryStatus | Not available | Gap |

## Advanced Features
- **Block Kit**: JSON UI components — sections, buttons, select menus, date pickers
- **Slash Commands**: `/mercato order 123` → POST to platform. Signed same as Events API
- **Scheduled messages**: `chat.scheduleMessage` with `post_at`
- **File uploads**: Two-step upload API (v2)
- **Interactive Components**: Button clicks, modal submissions

## Events API Details
- URL verification challenge: `{ type: 'url_verification', challenge }` — return challenge (one-time)
- Event types: `message.channels`, `message.im`, `app_mention`
- Must respond 200 OK within 3 seconds, process async
- Timestamp within 5 minutes prevents replay

## OAuth 2.0 Workspace Installation
- Standard OAuth 2.0 authorization code flow
- Produces Bot Token scoped to workspace
- **Bot Tokens DO NOT expire** (valid until revoked/uninstalled)
- Background refresh worker correctly skips non-expiring tokens

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Send notifications (webhook) | 5 / Excellent | Trivial |
| Send messages (bot) | 5 / Excellent | Well-documented, generous rate limit |
| Receive messages (Events API) | 5 / Excellent | HTTP-based, no WebSocket |
| Interactive components | 5 / Excellent | Block Kit maps to MessageButton[] |
| Slash commands | 4 / Good | response_url needs special handling |
| File attachments | 4 / Good | Two-step upload |
| Thread management | 5 / Excellent | thread_ts as conversationId |
| Block Kit rich formatting | 4 / Good | Adapter bridges gap to MessageContent |
| Modal interactions | 2 / Difficult | trigger_id expires in 3 seconds |

## Key Challenges
1. **Events API URL setup**: Admin must configure in Slack App settings + specify events + reinstall
2. **Event volume**: `message.channels` delivers ALL messages in all bot channels. Filter in verifyWebhook
3. **Rate limits for bursts**: 50 req/min. Spike of 200 alerts exceeds. Use rate-limiter.ts
4. **Workspace vs org tokens**: Enterprise Grid org-wide tokens. Standard per-workspace. Model as one instance per workspace
5. **Block Kit complexity**: More expressive than MessageContent. Support both generic + raw JSON passthrough

## Recommended Dual-Hub Implementation
1. **`notifier_slack`** (notification_providers): Incoming Webhooks, `secret` credential. Ship first
2. **`channel_slack`** (communication_channels): Bot + Events API, `oauth` credential. Ship second

## Gaps Summary
- No delivery status API
- Modal interactions time-sensitive (3s)
- Events API URL needs admin setup
- Estimated effort: **2-3 weeks** (notification), **4-5 weeks** (bidirectional)
