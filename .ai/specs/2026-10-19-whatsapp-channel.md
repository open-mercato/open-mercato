# WhatsApp Business Cloud API channel

**Status:** Implemented (adapter, webhook handshake, CRM phone linking; live credentials are operator-supplied)
**Created:** 2026-10-19
**Module:** `packages/channel-whatsapp` + `communication_channels` hub + `customers` subscriber

## TLDR

A first-party `@open-mercato/channel-whatsapp` package plugs the Meta WhatsApp Business Cloud API into the Communications Hub. Outbound text, media-link and template messages go through the Graph API; inbound messages and delivery statuses arrive on the hub's signed webhook; the customers subscriber now falls back from email addresses to the sender's phone number so a WhatsApp conversation lands on the matching person's CRM timeline.

## Decisions

1. **Cloud API, not on-prem.** The adapter targets `graph.facebook.com/{version}/{phoneNumberId}/messages` with a bearer token. WhatsApp Web/business-app automation is explicitly out of scope.
2. **Tenant-scoped channel.** `channelScope: 'tenant'` because one business number serves the tenant; credentials live in the integration credentials store encrypted at rest.
3. **Webhook verification is fail-closed.** Every POST must carry a valid `X-Hub-Signature-256` HMAC computed with the app secret. A candidate channel whose signature does not verify is skipped; if none verifies the hub returns 401. A channel without an app secret cannot receive inbound traffic.
4. **GET subscription handshake lives in the hub.** Meta requires the same callback URL to answer `hub.mode=subscribe` with the challenge. The `ChannelAdapter` gained an optional `verifyWebhookSubscription` method and the generic webhook route answers GET by iterating candidate channels — no WhatsApp-specific duplicate route.
5. **Phone matching in CRM.** The customers link subscriber reads the hub Message's `senderIdentifier` when no email addresses resolve, normalizes to digits, compares against decrypted `primary_phone` values in the tenant/org (bounded scan, same pattern as the email fallback), and creates a `message` interaction instead of `email` for chat providers.
6. **Media is link-based.** Outbound attachments use Meta's `link` form; inbound media is stored as a `whatsapp-media://{id}` placeholder because downloading requires a second authenticated Graph call. Downloading and storing media is a follow-up.
7. **No status lookup.** The Cloud API has no per-message status endpoint; `getStatus` mirrors the Discord/Resend/SES placeholder. Truthful delivery states arrive through webhook status updates.

## Data surfaces

- `packages/channel-whatsapp/src/modules/channel_whatsapp/integration.ts` — credential fields (`accessToken`, `phoneNumberId`, `verifyToken`, `appSecret`, `defaultRecipient`, `apiVersion`) and the health check.
- `lib/adapter.ts` — send, verify, normalize, validate credentials.
- `lib/webhook-signature.ts` — constant-time HMAC comparison.
- `lib/normalize-inbound.ts` — text, media, button/interactive replies and status updates.
- `communication_channels/lib/adapter.ts` + `api/post/webhook/[provider]/route.ts` — optional subscription handshake and GET handling.
- `customers/lib/link-channel-message-handler.ts` — phone fallback and `message` interaction type for chat providers.

## Testing

- `packages/channel-whatsapp/.../__tests__/adapter.test.ts` — signatures, text/media normalization, text/template sends, 401 reauth, missing recipient.
- `communication_channels/.../webhook/__tests__/route.test.ts` — GET handshake success, 401 on no match, 404/405.
- `customers/__integration__/TC-CRM-WA-001.spec.ts` — a phone-only inbound sender creates one `message` interaction on the person (env-gated test-seed).

## Out of scope

- Live credential provisioning/embedded signup.
- Downloading inbound media into attachments storage.
- Interactive button/list outbound messages.
- WhatsApp Business profile management, message templates management, and per-template approval APIs.
- Voice/video calls.
