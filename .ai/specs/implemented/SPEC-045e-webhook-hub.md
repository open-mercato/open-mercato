# SPEC-045e — Webhook Endpoints Hub

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 5b (Webhooks) of 6

> **Full implementation**: [SPEC-057 — Webhooks Module](./SPEC-057-2026-03-04-webhooks-module.md) provides the complete specification for the webhooks module, including Standard Webhooks compliance, outbound/inbound flows, delivery strategies, retry logic, and backend UI.

---

## Goal

Build the `webhook_endpoints` hub for the Integration Marketplace, providing both outbound (platform-to-external) and inbound (external-to-platform) webhook integrations. The `WebhookEndpointAdapter` contract defined here is implemented by the `webhooks` core module (`packages/core/src/modules/webhooks/`).

---

## 1. WebhookEndpointAdapter Contract

For custom inbound/outbound webhook integrations (e.g., Zapier triggers, n8n, custom automation):

```typescript
// webhook_endpoints/lib/adapter.ts

interface WebhookEndpointAdapter {
  readonly providerKey: string

  /** Which Open Mercato events trigger outbound webhooks */
  readonly subscribedEvents: string[]

  /** Format an outbound payload for a given event */
  formatPayload(event: EventPayload): Promise<WebhookPayload>

  /** Verify an inbound webhook signature */
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundWebhookEvent>

  /** Process an inbound webhook event */
  processInbound(event: InboundWebhookEvent): Promise<void>
}

interface WebhookPayload {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  method: 'POST' | 'PUT' | 'PATCH'
}
```

## 2. Outbound Webhook Flow

1. Platform event fires (e.g., `sales.order.created`)
2. Webhook hub subscriber checks if any enabled webhook endpoint subscribes to this event
3. Calls `adapter.formatPayload(event)` to build the payload
4. Enqueues delivery via worker (retry with exponential backoff)
5. Logs delivery result via `integrationLog`

## 3. Custom Webhook Configuration

Admin can configure custom webhook endpoints without code — a generic `webhook_custom` provider:

```typescript
credentials: {
  fields: [
    { key: 'targetUrl', label: 'Target URL', type: 'url', required: true },
    { key: 'secret', label: 'Signing Secret', type: 'secret', description: 'For HMAC signature verification' },
    { key: 'headers', label: 'Custom Headers', type: 'json', description: 'Additional headers to send' },
    { key: 'events', label: 'Subscribed Events', type: 'json', description: 'Array of event IDs to send' },
  ],
}
```

## 4. Implementation

See [SPEC-057 — Webhooks Module](./SPEC-057-2026-03-04-webhooks-module.md) for detailed implementation phases:
- Phase 1: Core outbound (entities, CRUD, dispatcher subscriber, delivery worker, basic UI)
- Phase 2: Advanced delivery (key rotation, test delivery, SQS/SNS, auto-disable)
- Phase 3: Inbound webhooks (adapter registry, generic receiver, rate limiting)
- Phase 4: Integration marketplace alignment
- Phase 5: Advanced UI and analytics

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-02-24 | Piotr Karwatka | Initial draft (combined with storage as SPEC-045e) |
| 2026-03-10 | Claude | Split from SPEC-045e — storage section moved to [SPEC-045i](./SPEC-045i-storage-hub.md); this file now covers webhooks only |
