# Integration Feasibility Analysis — Gmail

## Overview
- Gmail API via Google Workspace APIs
- Multiple integration patterns for different hubs
- Module IDs: `notifier_gmail` (send-only), `channel_gmail` (bidirectional)
- Overall Feasibility: **Full for send-only, Partial for bidirectional**

## Integration Patterns

### Pattern A — Send-Only Notification (Recommended First)
- Hub: `notification_providers` (NotificationTransportAdapter)
- Module ID: `notifier_gmail`
- Send transactional emails from admin's Gmail account
- `gmail.users.messages.send` with base64url-encoded RFC 2822 MIME
- Auth: OAuth 2.0 with `gmail.send` scope — compatible with SPEC-045a §8

### Pattern B — Bidirectional Communication Channel
- Hub: `communication_channels` (ChannelAdapter)
- **BLOCKER**: Receiving requires Google Cloud Pub/Sub push notifications
- Gmail API `users.watch` pushes to Cloud Pub/Sub topic → HTTPS endpoint
- Introduces GCP dependency not in framework

### Pattern C — Email Data Import
- Hub: `data_sync` (DataSyncAdapter)
- Import email threads as CRM activity records

## NotificationTransportAdapter Mapping (Pattern A)
| Method | Gmail API | Feasibility |
|--------|----------|-------------|
| send | gmail.users.messages.send (MIME) | Full |
| getDeliveryStatus | Not available | Gap — Gmail doesn't expose delivery status |
| verifyWebhook | N/A for send-only | N/A |

## OAuth 2.0 Scopes
- `gmail.send` — send only (least privilege, Pattern A)
- `gmail.readonly` — read (Pattern B/C)
- `gmail.modify` — read + modify (Pattern B)
- Shared via `sync_google_workspace` bundle credentials

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Send transactional emails | 5 / Excellent | Clean API |
| Send with attachments | 4 / Good | MIME multipart encoding |
| HTML email | 5 / Excellent | Full HTML in MIME body |
| Receive emails (real-time) | 2 / Difficult | Requires GCP Pub/Sub |
| Receive emails (polling) | 3 / Moderate | High API quota usage |
| Email delivery status | 1 / Infeasible | Gmail doesn't expose this |
| Thread management | 4 / Good | threadId for threading |

## Key Challenges
1. **GCP Pub/Sub for real-time receive**: Not standard HTTP webhooks. Adds GCP dependency
2. **No delivery status**: Gmail doesn't expose delivered/bounced/read status
3. **Google OAuth app verification**: `gmail.send` scope requires app verification (weeks)
4. **MIME construction**: Use `nodemailer` for reliable RFC 2822 generation
5. **Rate limits**: Consumer: 100/day. Workspace: 2000/day. API: 100 req/sec/user
6. **Shared credentials**: Reuse OAuth from `sync_google_workspace` bundle

## Recommended Approach
1. **Phase 1**: `notifier_gmail` — send-only. Minimal scope. Ship in google workspace bundle
2. **Phase 2**: Email import as data_sync (polling-based CRM activities)
3. **Phase 3** (deferred): Bidirectional — only if GCP Pub/Sub built

## Gaps Summary
- No delivery status from Gmail API
- Bidirectional requires GCP Pub/Sub
- Google OAuth verification lengthy
- Estimated effort: **2-3 weeks** (send-only), **6-8 weeks** (bidirectional)
