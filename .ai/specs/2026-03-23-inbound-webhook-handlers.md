# Inbound Webhook Handlers — Module-Level Consumption System

**Status**: Phase 1 in progress
**Author**: AI-assisted
**Created**: 2026-03-23
**Related**: SPEC-057 (Webhooks Module), SPEC-045 (Integration Marketplace)
**Extends**: SPEC-057 Phase 3 (Inbound Webhooks)
**Pre-implement analysis**: `.ai/specs/analysis/ANALYSIS-2026-03-23-inbound-webhook-handlers.md` (applied 2026-06-17)

> **Analysis remediation applied (2026-06-17).** The route **unifies** on the existing
> `POST /api/webhooks/inbound/[endpointId]` receiver rather than introducing a colliding
> `:sourceKey` route (see §3.1, §5.1, §14). The Phase 4 `inbox_ops` baseline was corrected
> (it already has encrypted per-tenant secrets + Svix). Credential storage reuses the
> integrations `credentials` encryption map; `WebhookIngestion.payload`/`headers` are
> encrypted via the webhooks module encryption map. See the changelog.

---

## TLDR

Extend the webhooks module with a **module-level inbound webhook handler** pattern that mirrors event subscribers. Modules export auto-discovered `webhook-handlers/*.ts` files with metadata declaring what inbound webhook types they handle. A single platform-wide inbound endpoint (`POST /api/webhooks/inbound`) receives all external webhook calls, verifies signatures, and dispatches to matching handlers — just like the event bus dispatches domain events to subscribers.

---

## 1. Problem Statement

Open Mercato's webhooks module (SPEC-057) covers **outbound** webhook delivery comprehensively. Phase 3 introduced a basic inbound receiver with `WebhookEndpointAdapter`, but the current design:

1. **Requires per-provider endpoint registration** — each integration must register an adapter in DI, tightly coupling inbound handling to the integration marketplace
2. **Lacks module-level ownership** — there's no convention for modules to declare "I handle Stripe `payment_intent.succeeded` webhooks" in the same way they declare event subscribers
3. **No auto-discovery** — webhook handlers aren't discovered like subscribers, workers, or pages
4. **No unified routing** — each provider adapter owns its own verification and processing logic without a shared dispatch pattern

External services (Stripe, PayPal, DHL, SendGrid, Shopify, etc.) all send webhooks. Today, each integration provider would need custom glue code. We need a pattern where:

- Any module (core or third-party) can declare webhook handlers
- A single inbound endpoint receives all webhooks and routes them
- Handlers follow the same ergonomic pattern as event subscribers
- Signature verification is pluggable per source
- The platform emits domain events from processed webhooks, closing the loop with the event bus

---

## 2. Proposed Solution

### 2.1 Design Principles

1. **Mirror the subscriber pattern** — same DX: export `metadata` + default handler function
2. **Single entry point** — one URL per tenant, source identification via path segment or header
3. **Pluggable verification** — each source registers its own signature verification strategy
4. **Encrypted credentials** — all webhook signing secrets and API keys stored encrypted at rest via `IntegrationCredentials` (same as integration handlers), never in env vars at runtime
5. **Fire domain events** — handlers process raw webhook payloads and emit typed domain events
6. **Idempotent by default** — built-in deduplication via webhook message IDs
7. **Module-owned** — each module owns its handlers; no central switch statement

### 2.2 Core Concepts

| Concept | Description |
|---------|-------------|
| **Webhook Source** | An external system that sends webhooks (e.g., `stripe`, `paypal`, `dhl`). Registered via `webhook-sources.ts`. |
| **Webhook Handler** | A handler entry (`{ meta, handler }`) declared in a module's root `webhook-handlers.ts` barrel; the implementation lives under `webhook-handlers/`. Auto-discovered via the `webhooks.handlers` generator plugin. |
| **Inbound Endpoint** | `POST /api/webhooks/inbound/[endpointId]` — the existing single entry point. The path segment is resolved against the source registry first, then the legacy adapter registry (see §3.1, §5.1). |
| **Source Verifier** | A pluggable function that validates the authenticity of an inbound webhook (HMAC, asymmetric signature, IP allowlist, etc.). |
| **Webhook Ingestion Log** | Persisted record of every inbound webhook received, for audit and replay. |

---

## 3. Architecture

### 3.1 Inbound Flow

> **Route unification.** There is no new route file. The shipped
> `packages/webhooks/src/modules/webhooks/api/inbound/[endpointId]/route.ts` is extended so the
> `[endpointId]` segment resolves against the new `webhookSourceRegistry` first (source-based flow
> below). If no source matches, it falls back to `getWebhookEndpointAdapter(endpointId)` and the
> legacy adapter path runs unchanged. So `…/inbound/stripe` means "source key `stripe`" when a
> source is registered, and "adapter provider key `stripe`" otherwise.

```
  ┌──────────────┐  POST /api/webhooks/inbound/stripe   ┌─────────────────────┐
  │ Stripe        ├────────────────────────────────────>│ Inbound Route        │
  │               │                                      │                      │
  └──────────────┘                                      │ 1. Resolve source    │
                                                        │ 2. Verify signature  │
  ┌──────────────┐  POST /api/webhooks/inbound/dhl      │ 3. Parse event type  │
  │ DHL           ├────────────────────────────────────>│ 4. Log ingestion     │
  │               │                                      │ 5. Enqueue dispatch  │
  └──────────────┘                                      │ 6. Return 200        │
                                                        └──────────┬───────────┘
                                                                   │
                                                          webhook-inbound-dispatch
                                                               queue
                                                                   │
                                                                   ▼
                                                        ┌──────────────────────┐
                                                        │ Dispatch Worker       │
                                                        │                       │
                                                        │ 1. Load handlers for  │
                                                        │    source + event     │
                                                        │ 2. Execute each       │
                                                        │    matching handler   │
                                                        │ 3. Handlers emit      │
                                                        │    domain events      │
                                                        └──────────────────────┘
```

### 3.2 Handler Auto-Discovery

> **Convention (chosen at implementation, 2026-06-17).** Auto-discovery is implemented via the
> platform's sanctioned **`generators.ts` plugin** mechanism (single-file-per-module aggregation +
> `bootstrapRegistration`), NOT a core-CLI scanner fork. A module therefore declares its handlers in
> a module-root **`webhook-handlers.ts`** barrel that exports `webhookHandlers: WebhookHandlerRegistryEntry[]`,
> each `{ meta, handler: () => import('./webhook-handlers/<file>') }`. Handler **implementations** still
> live as individual files under `webhook-handlers/`; the barrel lazily references them. This avoids
> editing the two parallel core generators (string + AST paths) and auto-wires bootstrap registration
> with zero `bootstrap.ts`/template edits. Rationale: lower blast-radius, single sanctioned code path.

```
src/modules/<module>/
  ├── webhook-handlers.ts            # barrel: export const webhookHandlers = [ { meta, handler }, ... ]
  └── webhook-handlers/
      ├── stripe-payment-succeeded.ts   # default export: the handler fn
      ├── stripe-refund-created.ts
      └── dhl-tracking-update.ts
```

`webhook-handlers.ts` (barrel):

```typescript
import type { WebhookHandlerRegistryEntry } from '@open-mercato/shared/lib/webhooks'

export const webhookHandlers: WebhookHandlerRegistryEntry[] = [
  {
    meta: { source: 'stripe', event: 'payment_intent.succeeded', id: 'payments:stripe-payment-succeeded' },
    handler: () => import('./webhook-handlers/stripe-payment-succeeded'),
  },
]
```

Each handler implementation file under `webhook-handlers/` exports:

```typescript
export const metadata: WebhookHandlerMeta = {
  source: 'stripe',                          // Which external source
  event: 'payment_intent.succeeded',         // Event type from the source (supports wildcards)
  id: 'payments:stripe-payment-succeeded',   // Unique handler ID
}

export default async function handle(
  payload: WebhookHandlerPayload,
  ctx: WebhookHandlerContext
): Promise<void> {
  const { data, eventType, sourceKey, headers, ingestionId } = payload
  const em = (ctx.resolve('em') as EntityManager).fork()

  // Process the webhook — e.g., update order payment status
  const paymentIntent = data as StripePaymentIntent
  // ... business logic ...

  // Emit domain event to close the loop with the event bus
  const eventBus = ctx.resolve<EventBus>('eventBus')
  await eventBus.emitEvent('payments.payment.confirmed', {
    orderId,
    amount: paymentIntent.amount,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
}
```

### 3.3 Source Registration

Integration provider packages register webhook sources in their module's `webhook-sources.ts`:

```typescript
// packages/gateway-stripe/src/modules/gateway_stripe/webhook-sources.ts

import type { WebhookSourceConfig } from '@open-mercato/shared/modules/webhooks'

export const webhookSources: WebhookSourceConfig[] = [
  {
    key: 'stripe',
    label: 'Stripe',
    verifier: async (request, credentials) => {
      // Stripe uses a specific HMAC-SHA256 scheme
      const signature = request.headers['stripe-signature']
      const endpointSecret = credentials.webhookSigningSecret
      return verifyStripeSignature(request.body, signature, endpointSecret)
    },
    eventTypeExtractor: (body) => {
      // Stripe sends event type in the body
      return body.type  // e.g., 'payment_intent.succeeded'
    },
    messageIdExtractor: (body, headers) => {
      // Stripe sends idempotency key in the body
      return body.id  // e.g., 'evt_1234'
    },
  },
]
```

### 3.4 Encrypted Credential Resolution

All webhook signing secrets and API keys are stored **encrypted at rest** using the integrations module's `CredentialsService` — the same AES-GCM encryption with per-tenant Data Encryption Keys (DEK) used by integration handlers. No secrets in environment variables at runtime.

When an inbound webhook arrives:

1. Resolve the `WebhookSourceConfig` by `sourceKey` path param
2. Resolve `integrationCredentialsService` from DI
3. Look up `IntegrationCredentials` for this source + tenant — credentials are transparently decrypted via `findOneWithDecryption`
4. Pass decrypted credentials to the source `verifier`
5. If no credentials found and source requires verification → 401
6. For multi-tenant disambiguation: iterate tenant credential candidates, verify against each — the one that validates identifies the tenant

**Credential storage flow** (admin configures a source):

```typescript
// When admin sets up a webhook source (e.g., connects Stripe)
const credentialsService = container.resolve('integrationCredentialsService')
await credentialsService.save(
  `webhook_source_${sourceKey}`,  // integrationId convention
  {
    webhookSigningSecret: 'whsec_...',
    apiKey: 'sk_live_...',           // Optional, for sources that need API access
  },
  { organizationId, tenantId }
)
```

**Credential retrieval flow** (inbound webhook arrives):

```typescript
const credentialsService = container.resolve('integrationCredentialsService')
const credentials = await credentialsService.resolve(
  `webhook_source_${sourceKey}`,
  { organizationId, tenantId }
)
// credentials is now decrypted { webhookSigningSecret, apiKey, ... }
const isValid = await sourceConfig.verifier(request, credentials)
```

This ensures:
- Secrets never stored in plaintext in the database
- Per-tenant encryption keys (no shared secrets across tenants)
- Consistent with how payment gateway and integration credentials are stored
- Admin can rotate secrets via the UI without touching env vars

---

## 4. Data Models

### 4.1 WebhookIngestion Entity

Persisted log of every inbound webhook received. Lives in the webhooks module.

```typescript
@Entity({ tableName: 'webhook_ingestions' })
export class WebhookIngestion {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID()

  @Property()
  sourceKey!: string                  // e.g., 'stripe', 'paypal'

  @Property()
  eventType!: string                  // e.g., 'payment_intent.succeeded'

  @Property({ nullable: true })
  externalMessageId?: string          // Deduplication key from source

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>   // Raw webhook body

  @Property({ type: 'jsonb', nullable: true })
  headers?: Record<string, string>    // Selected request headers

  @Enum(() => IngestionStatus)
  status!: IngestionStatus            // received | processing | processed | failed | duplicate

  @Property({ nullable: true })
  errorMessage?: string

  @Property({ nullable: true })
  processedAt?: Date

  @Property({ type: 'int', default: 0 })
  handlerCount!: number               // How many handlers were invoked

  @Property({ type: 'jsonb', nullable: true })
  handlerResults?: WebhookHandlerResult[]  // Per-handler execution details

  @Property({ type: 'int', nullable: true })
  durationMs?: number                 // Total processing duration

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Property()
  createdAt: Date = new Date()

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export enum IngestionStatus {
  RECEIVED = 'received',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
  DUPLICATE = 'duplicate',
}

export interface WebhookHandlerResult {
  handlerId: string           // e.g., 'payments:stripe-payment-succeeded'
  module: string              // e.g., 'gateway_stripe'
  status: 'success' | 'failed'
  errorMessage?: string
  durationMs: number
  startedAt: string           // ISO timestamp
}
```

### 4.2 Types

```typescript
// packages/shared/src/modules/webhooks/inbound-types.ts

export interface WebhookSourceConfig {
  /** Unique source identifier, e.g., 'stripe', 'paypal' */
  key: string
  /** Human-readable label */
  label: string
  /**
   * Verify the authenticity of an inbound webhook.
   * Return true if valid, false to reject with 401.
   * Throw to reject with 500 (unexpected verification error).
   */
  verifier: (
    request: InboundWebhookRequest,
    credentials: Record<string, string>
  ) => Promise<boolean>
  /**
   * Extract the event type from the webhook body/headers.
   * Different providers use different fields (body.type, body.event, headers['x-event-type']).
   */
  eventTypeExtractor: (
    body: Record<string, unknown>,
    headers: Record<string, string>
  ) => string
  /**
   * Extract a unique message ID for deduplication.
   * Return undefined if the source doesn't provide one.
   */
  messageIdExtractor?: (
    body: Record<string, unknown>,
    headers: Record<string, string>
  ) => string | undefined
  /**
   * Optional: extract tenantId/organizationId from the payload.
   * If not provided, resolved from the inbound endpoint configuration.
   */
  scopeExtractor?: (
    body: Record<string, unknown>,
    headers: Record<string, string>
  ) => { tenantId?: string; organizationId?: string }
  /**
   * Optional descriptor of the credential fields this source needs, used by the
   * source-credential admin UI (§11.4) to render the form. `webhook_source_*` keys
   * are not registered integration providers, so `integrationCredentialsService.getSchema()`
   * returns nothing for them — this descriptor is the schema source instead.
   */
  credentialFields?: Array<{
    key: string
    label: string
    secret?: boolean
    required?: boolean
  }>
}

export interface WebhookHandlerMeta {
  /** Source key this handler listens to, e.g., 'stripe' */
  source: string
  /** Event type pattern (supports wildcards: '*', 'payment_intent.*') */
  event: string
  /** Unique handler ID, e.g., 'payments:stripe-payment-succeeded' */
  id: string
  /** If true, handler is persistent/queue-backed (default: true) */
  persistent?: boolean
}

export interface WebhookHandlerPayload {
  /** Parsed webhook body */
  data: Record<string, unknown>
  /** Extracted event type */
  eventType: string
  /** Source key */
  sourceKey: string
  /** Selected request headers */
  headers: Record<string, string>
  /** WebhookIngestion record ID */
  ingestionId: string
  /** Tenant scope */
  tenantId: string
  organizationId: string
}

export interface WebhookHandlerContext {
  resolve: <T>(name: string) => T
}

export interface InboundWebhookRequest {
  body: string               // Raw request body (for signature verification)
  headers: Record<string, string>
  parsedBody: Record<string, unknown>
}
```

---

## 5. API Contracts

### 5.1 Inbound Receiver

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhooks/inbound/[endpointId]` | None (source-verified) | Receive inbound webhook. `[endpointId]` resolves to a registered source key first, else a legacy adapter provider key. |

**Request**: Raw body from external source (JSON or form-encoded depending on source).

**Response**:

| Status | Body | When |
|--------|------|------|
| 200 | `{ "received": true }` | Webhook accepted (processing async) |
| 400 | `{ "error": "Unknown source" }` | `sourceKey` not registered |
| 401 | `{ "error": "Signature verification failed" }` | Verifier returned false |
| 409 | `{ "received": true, "duplicate": true }` | Duplicate message ID (idempotent) |
| 429 | `{ "error": "Rate limit exceeded" }` | Too many requests from source |
| 500 | `{ "error": "Internal error" }` | Unexpected failure |

**Behavior**:
1. Resolve `WebhookSourceConfig` by `sourceKey`
2. Read raw body for signature verification
3. Call `verifier(request, credentials)` — reject if false
4. Call `eventTypeExtractor(body, headers)` — extract event type
5. Call `messageIdExtractor(body, headers)` — check deduplication cache
6. Resolve tenant scope (from config, payload, or header)
7. Create `WebhookIngestion` record with status `received`
8. Enqueue dispatch job to `webhook-inbound-dispatch` queue
9. Return 200 immediately (async processing)

### 5.2 Ingestion Log API

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/webhooks/ingestions` | `webhooks.view` | List inbound webhook ingestions |
| GET | `/api/webhooks/ingestions/:id` | `webhooks.view` | Get ingestion detail |
| POST | `/api/webhooks/ingestions/:id/replay` | `webhooks.manage` | Replay a webhook (re-dispatch to handlers) |

### 5.3 Source Registry API

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/webhooks/sources` | `webhooks.view` | List registered webhook sources and their event types |

---

## 6. Auto-Discovery & Generator Integration

> **Implemented via `generators.ts` plugins (2026-06-17), not a core-CLI scanner change.** The webhooks
> module ships `webhooks/generators.ts` declaring two `GeneratorPlugin`s (`webhooks.sources`,
> `webhooks.handlers`) that aggregate each module's root `webhook-sources.ts` / `webhook-handlers.ts`
> exports and contribute `bootstrapRegistration` calls. The existing `runBootstrapRegistrations()` in
> both `apps/mercato/src/bootstrap.ts` and the create-app template wires them automatically.

### 6.1 New Auto-Discovery Convention

Two module-root convention files, aggregated by the plugins on `yarn generate`:

```
src/modules/<module>/webhook-sources.ts    → export const webhookSources: WebhookSourceConfig[]
src/modules/<module>/webhook-handlers.ts    → export const webhookHandlers: WebhookHandlerRegistryEntry[]
```

Each `WebhookHandlerRegistryEntry` is `{ meta: WebhookHandlerMeta, handler: () => import('./webhook-handlers/<file>') }`.
The handler implementation file's `default` export is the `(payload, ctx) => Promise<void>` function.

### 6.2 New Module Files

| File | Export | Purpose |
|------|--------|---------|
| `webhook-sources.ts` | `webhookSources` | Webhook source configurations (verifier, extractors) |
| `webhook-handlers.ts` | `webhookHandlers` | Barrel of `{ meta, handler }` entries; impl files live under `webhook-handlers/` |

### 6.3 Generated Output

The plugins produce (gitignored, under the app's `.mercato/generated/`):

```typescript
// webhook-sources.generated.ts
export const webhookSourceEntries: Array<{ moduleId: string; sources: WebhookSourceConfig[] }> = [ /* aggregated */ ]

// webhook-handlers.generated.ts
export const webhookHandlerEntries: Array<{ moduleId: string; handlers: WebhookHandlerRegistryEntry[] }> = [ /* aggregated */ ]

// bootstrap-registrations.generated.ts (auto-wired)
//   registerWebhookSourceEntries(webhookSourceEntries)
//   registerWebhookHandlerEntries(webhookHandlerEntries)
```

`registerWebhookSourceEntries` / `registerWebhookHandlerEntries` (in
`webhooks/lib/module-webhook-registry.ts`) flatten the per-module entries into the runtime
`setWebhookSources` / `setWebhookHandlers` registries used by the inbound route + dispatcher.

---

## 7. Dispatch Worker

```typescript
// packages/core/src/modules/webhooks/workers/inbound-dispatch.worker.ts

export const metadata: WorkerMeta = {
  queue: 'webhook-inbound-dispatch',
  id: 'webhooks:inbound-dispatch-worker',
  concurrency: 5,  // I/O-bound but with DB writes
}

type JobPayload = {
  ingestionId: string
  sourceKey: string
  eventType: string
  data: Record<string, unknown>
  headers: Record<string, string>
  tenantId: string
  organizationId: string
}

export default async function handle(
  job: QueuedJob<JobPayload>,
  ctx: JobContext & { resolve: <T>(name: string) => T }
): Promise<void> {
  const { ingestionId, sourceKey, eventType, data, headers, tenantId, organizationId } = job.payload
  const em = (ctx.resolve('em') as EntityManager).fork()

  // Load ingestion record
  const ingestion = await em.findOne(WebhookIngestion, { id: ingestionId })
  if (!ingestion || ingestion.status === 'processed') return // Idempotent

  ingestion.status = IngestionStatus.PROCESSING
  await em.flush()

  // Resolve matching handlers from registry
  const handlers = resolveHandlers(sourceKey, eventType)

  const payload: WebhookHandlerPayload = {
    data, eventType, sourceKey, headers, ingestionId, tenantId, organizationId,
  }

  let failedCount = 0
  for (const entry of handlers) {
    try {
      const mod = await entry.handler()
      await mod.default(payload, ctx)
    } catch (error) {
      failedCount++
      logger.error(`Webhook handler ${entry.meta.id} failed`, { error, ingestionId })
    }
  }

  // Update ingestion status
  ingestion.handlerCount = handlers.length
  ingestion.status = failedCount > 0 ? IngestionStatus.FAILED : IngestionStatus.PROCESSED
  ingestion.processedAt = new Date()
  if (failedCount > 0) {
    ingestion.errorMessage = `${failedCount}/${handlers.length} handlers failed`
  }
  await em.flush()

  // Emit event for observability
  await emitWebhooksEvent('webhooks.inbound.processed', {
    ingestionId, sourceKey, eventType,
    handlerCount: handlers.length, failedCount,
    tenantId, organizationId,
  })
}
```

### 7.1 Handler Resolution

```typescript
function resolveHandlers(sourceKey: string, eventType: string): WebhookHandlerRegistryEntry[] {
  return webhookHandlerRegistry.filter(entry => {
    if (entry.meta.source !== sourceKey) return false
    return matchEventPattern(eventType, entry.meta.event)
  })
}
```

Uses the same `matchEventPattern` from the outbound webhook dispatcher (wildcard support: `*`, `payment_intent.*`).

---

## 8. Tenant Scope Resolution

Inbound webhooks arrive without authentication. Tenant scope must be resolved via one of:

1. **Endpoint configuration** — admin configures a source endpoint with a specific tenant/org (most common). Stored in an `InboundEndpointConfig` entity or integration state.
2. **Payload extraction** — source's `scopeExtractor` derives scope from webhook metadata (e.g., Stripe metadata field).
3. **Credential lookup** — signing secret is unique per tenant; the verification step identifies the tenant.

Priority: credential-based (most secure) → endpoint config → payload extraction.

### 8.1 InboundEndpointConfig Entity

```typescript
@Entity({ tableName: 'webhook_inbound_configs' })
export class InboundEndpointConfig {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID()

  @Property()
  sourceKey!: string             // e.g., 'stripe'

  @Property()
  isActive: boolean = true

  @Property({ nullable: true })
  integrationId?: string         // Link to SPEC-045 integration

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Property()
  createdAt: Date = new Date()

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

The inbound route resolves tenant by:
1. Finding `InboundEndpointConfig` for the `sourceKey`
2. If multiple tenants use the same source, the verifier disambiguates by checking which tenant's credentials validate the signature

---

## 9. Events

New events added to the webhooks module:

```typescript
{ id: 'webhooks.inbound.processed', label: 'Inbound Webhook Processed', entity: 'inbound', category: 'lifecycle' },
{ id: 'webhooks.inbound.handler_failed', label: 'Inbound Handler Failed', entity: 'inbound', category: 'lifecycle', clientBroadcast: true },
```

The existing `webhooks.inbound.received` event (from SPEC-057) fires when the HTTP request is accepted. The new `webhooks.inbound.processed` fires after all handlers complete.

---

## 10. Security

### 10.1 Encrypted Credential Storage

All webhook source credentials (signing secrets, API keys) MUST be stored encrypted at rest using the integrations module's `CredentialsService`:

- **Encryption**: AES-256-GCM with per-tenant Data Encryption Keys (DEK)
- **Key derivation**: DEK derived from tenant ID + master secret via SHA-256
- **Storage**: Encrypted blob in `integration_credentials` table under key `webhook_source_{sourceKey}`
- **Retrieval**: Transparent decryption via `findOneWithDecryption` / `credentialsService.resolve()`
- **No plaintext secrets**: Signing secrets, API keys, and any sensitive credential fields are never stored in plaintext in the database
- **No runtime env vars**: After initial provisioning, secrets are resolved from encrypted storage, not from `process.env`
- **EncryptionMap**: Credentials are stored in the integrations `integration_credentials.credentials` JSON column, which is **already** declared in the `integrations` module `defaultEncryptionMaps` — no new per-source map is needed for credentials. Separately, `WebhookIngestion.payload` and `WebhookIngestion.headers` (which can carry PII) are declared in the **webhooks** module `encryption.ts` and read via `findOneWithDecryption`.
- **Rotation**: Credential rotation updates the encrypted blob; previous credentials kept during dual-verification window

### 10.2 Signature Verification

Every source MUST provide a `verifier`. Sources without verification are rejected at registration time. Supported schemes:

| Scheme | Examples |
|--------|----------|
| HMAC-SHA256 | Stripe, GitHub, Shopify |
| Standard Webhooks | Any provider following the spec |
| Asymmetric (RSA/ECDSA) | PayPal, Twilio |
| IP allowlist + shared secret | Legacy systems |

### 10.2 Rate Limiting

Per-source, per-tenant rate limiting using `RateLimiterService`:

```typescript
const rateKey = `webhook:inbound:${sourceKey}:${tenantId}`
const rateResult = await rateLimiter.consume(rateKey, {
  points: 120,     // 120 requests per minute per source per tenant
  duration: 60,
  keyPrefix: 'webhooks:inbound',
})
```

### 10.3 Deduplication

Cache-backed deduplication using `externalMessageId`:

```typescript
const dedupeKey = `webhook:dedup:${sourceKey}:${externalMessageId}`
const isDuplicate = await cache.get(dedupeKey)
if (isDuplicate) {
  return NextResponse.json({ received: true, duplicate: true }, { status: 409 })
}
await cache.set(dedupeKey, '1', { ttl: 86_400_000 }) // 24h TTL — cache TTL is in milliseconds
```

**Durable source of truth.** The cache check above is a fast-path only. The authoritative
deduplication remains the existing `webhook_inbound_receipts` unique constraint on
`(endpointId, messageId)` — a duplicate that survives cache eviction is still caught at insert
time (Postgres `23505`) and returns the idempotent duplicate response. Phase 1 reuses that
constraint; the cache fast-path is optional and additive.

### 10.4 Replay Protection

Timestamp-based replay protection (optional, per source):
- If the source provides a timestamp, reject webhooks older than 5 minutes (configurable)

---

## 11. Backend UI

### 11.1 Ingestion Log Page

`backend/webhooks/ingestions/page.tsx`

DataTable showing all inbound webhook ingestions with full delivery log visibility:

- **Columns**: Source (with icon/badge), Event Type, Status (color-coded badge), Handler Count, Duration (ms), External Message ID, Received At
- **Filters**: source (dropdown from registered sources), status (multi-select: received/processing/processed/failed/duplicate), date range, event type (text search)
- **Sorting**: by received date (default desc), status, source, duration
- **Row actions**: View detail, Replay (requires `webhooks.manage`)
- **Bulk actions**: Replay selected (for failed ingestions)
- **Status indicators**: color-coded — green (processed), red (failed), yellow (processing), gray (received/duplicate)
- **Auto-refresh**: poll every 10s when any ingestion is in `received` or `processing` status (via `useAppEvent` on `webhooks.inbound.processed`)

### 11.2 Ingestion Detail Page

`backend/webhooks/ingestions/[id]/page.tsx`

Full detail view for inspecting and debugging inbound webhook processing:

- **Header**: Source badge, event type, status badge, received timestamp, processing duration
- **Tabs**:
  - **Payload**: Syntax-highlighted JSON viewer with collapsible sections, copy-to-clipboard button. Shows the full raw webhook body as received from the external source.
  - **Headers**: Key-value table of selected request headers (filtered to exclude noise like `host`, `content-length`). Useful for debugging signature issues.
  - **Handler Results**: Table of each handler that was invoked — handler ID, module, execution status (success/failed), error message if failed, duration per handler. Shows "No handlers matched" if zero handlers found for this source + event combination.
  - **Timeline**: Chronological event log — received → verified → enqueued → dispatched → handler 1 started → handler 1 completed → ... → processed/failed. Each step with timestamp and duration delta.
- **Actions**:
  - **Replay**: Re-dispatch to all matching handlers (creates new dispatch job, does not create new ingestion record). Confirms via dialog.
  - **Copy webhook URL**: Copy the inbound endpoint URL for this source (for configuring the external system).
  - **View source config**: Link to the source configuration page.

### 11.3 Sources Page

`backend/webhooks/sources/page.tsx`

Dashboard of all registered webhook sources with health and configuration status:

- **Cards layout** (one card per source):
  - Source key, label, icon
  - Number of registered handlers (with list on hover)
  - Credential status: configured (green) / missing (red) / expired (yellow)
  - Health: last successful ingestion timestamp, failure rate (last 24h)
  - Inbound endpoint URL (copyable): `POST /api/webhooks/inbound/{sourceKey}`
- **Row actions**: Configure credentials, View handlers, View ingestion log (filtered to this source)
- **Empty state**: Instructions for how to register a new webhook source (link to docs)

### 11.4 Source Credential Configuration

`backend/webhooks/sources/[sourceKey]/page.tsx`

Form for configuring encrypted credentials for a webhook source:

- **Fields**: Dynamic based on source's credential schema (e.g., `webhookSigningSecret`, `apiKey`)
- **Encryption indicator**: Visual confirmation that credentials are stored encrypted (lock icon)
- **Test verification**: Button to paste a sample webhook payload + headers and test if signature verification passes with the configured credentials
- **Rotation support**: "Rotate secret" action that stores the new secret while keeping the previous one active during a transition period

---

## 12. Integration Test Coverage

| Test Case | Path | Description |
|-----------|------|-------------|
| TC-WH-IN-001 | `__integration__/TC-WH-IN-001.spec.ts` | Inbound webhook: valid signature accepted, handler executed, domain event emitted |
| TC-WH-IN-002 | `__integration__/TC-WH-IN-002.spec.ts` | Inbound webhook: invalid signature → 401 |
| TC-WH-IN-003 | `__integration__/TC-WH-IN-003.spec.ts` | Inbound webhook: unknown source → 400 |
| TC-WH-IN-004 | `__integration__/TC-WH-IN-004.spec.ts` | Inbound webhook: duplicate message ID → 409 (idempotent) |
| TC-WH-IN-005 | `__integration__/TC-WH-IN-005.spec.ts` | Inbound webhook: rate limiting → 429 |
| TC-WH-IN-006 | `__integration__/TC-WH-IN-006.spec.ts` | Inbound webhook: multiple handlers for same event all execute |
| TC-WH-IN-007 | `__integration__/TC-WH-IN-007.spec.ts` | Inbound webhook: wildcard handler matches |
| TC-WH-IN-008 | `__integration__/TC-WH-IN-008.spec.ts` | Inbound webhook: handler failure doesn't block other handlers |
| TC-WH-IN-009 | `__integration__/TC-WH-IN-009.spec.ts` | Inbound webhook: replay re-dispatches to handlers |
| TC-WH-IN-010 | `__integration__/TC-WH-IN-010.spec.ts` | Ingestion log API: list, filter, detail |
| TC-WH-IN-011 | `__integration__/TC-WH-IN-011.spec.ts` | Credential encryption: secrets stored encrypted, decrypted for verification |
| TC-WH-IN-012 | `__integration__/TC-WH-IN-012.spec.ts` | Ingestion detail page: payload, headers, handler results visible |

### Phase 4 Tests (Inbox Ops Refactoring)

| Test Case | Path | Description |
|-----------|------|-------------|
| TC-WH-IN-020 | `__integration__/TC-WH-IN-020.spec.ts` | Resend inbound email: webhook received via new endpoint, email processed identically to old flow |
| TC-WH-IN-021 | `__integration__/TC-WH-IN-021.spec.ts` | Resend inbound email: old webhook URL (`/api/inbox_ops/webhook/inbound`) still works via redirect |
| TC-WH-IN-022 | `__integration__/TC-WH-IN-022.spec.ts` | Resend credentials: env vars migrated to encrypted storage on tenant setup |
| TC-WH-IN-023 | `__integration__/TC-WH-IN-023.spec.ts` | Resend credentials: signature verification uses encrypted credentials, not env vars |

---

## 13. Implementation Phases

### Phase 1: Core Infrastructure (Target: 1 week)

**Goal**: Auto-discovery, dispatch worker, single inbound endpoint.

**Deliverables**:
1. `WebhookSourceConfig` and `WebhookHandlerMeta` types in `@open-mercato/shared`
2. `WebhookIngestion` entity + migration
3. `InboundEndpointConfig` entity + migration
4. Generator plugin for `webhook-sources.ts` and `webhook-handlers/*.ts` auto-discovery
5. `POST /api/webhooks/inbound/:sourceKey` route with verification, deduplication, rate limiting
6. `inbound-dispatch.worker.ts` — queue-backed handler dispatch
7. New events: `webhooks.inbound.processed`, `webhooks.inbound.handler_failed`
8. Unit tests for handler resolution, event pattern matching

### Phase 2: Admin UI & Observability (Target: 3 days)

**Goal**: Visibility into inbound webhook activity.

**Deliverables**:
1. Ingestion log page (list + detail)
2. Sources page with health indicators
3. Replay functionality (`POST /api/webhooks/ingestions/:id/replay`)
4. Ingestion log API routes
5. Sources API route

### Phase 3: Reference Implementation (Target: 3 days)

**Goal**: At least one real-world webhook handler to validate the pattern.

**Deliverables**:
1. Stripe webhook source registration (in `gateway-stripe` provider package)
2. Stripe `payment_intent.succeeded` handler
3. Stripe `charge.refunded` handler
4. End-to-end integration test with Stripe test mode

### Phase 4: Inbox Ops Refactoring — Resend Inbound Webhooks (Target: 1 week)

**Goal**: Refactor `inbox_ops` to use the inbound webhook handler system for Resend inbound email webhooks. The existing `inbox_ops` webhook endpoint (`api/webhook/inbound.ts`) is replaced by the generic inbound system, with **100% backward compatibility** — no behavior changes, no data loss, no URL changes.

**Current state** (verified 2026-06-17 — corrected from the original draft):
- `inbox_ops/api/webhook/inbound.ts` (URL `POST /api/inbox_ops/webhook/inbound`) verifies with **both** a custom HMAC-SHA256 scheme (`x-webhook-signature` + `x-webhook-timestamp`, 5-minute replay window, timing-safe compare) **and** Svix (`svix-*` headers, via the `svix` package). Verification is selected per request and embedded inline.
- Tenant scoping **already exists**: `InboxSettings.webhookSecret` is an **encrypted per-tenant column**; the route resolves a per-tenant secret and falls back to env (`INBOX_OPS_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SIGNING_SECRET`) only when no per-tenant secret is set. `RESEND_API_KEY` is read by `fetchResendEmail()`.
- `fetchResendEmail()` builds a Resend client from `RESEND_API_KEY` and calls `resend.emails.receiving.get(emailId)`.
- Events emitted today: `inbox_ops.email.received`, `inbox_ops.email.deduplicated` (plus `…processed/failed/reprocessed` declared).
- `setup.ts` has `onTenantCreated` (seeds default `InboxSettings`) and a no-op `seedDefaults`.

So Phase 4 is **"env fallback → encrypted credentials store"**, NOT "global → tenant-scoped" — per-tenant scoping is already in place. Both HMAC and Svix paths and the existing event IDs MUST be preserved.

**Target state**:
- Resend webhook source registered via `webhook-sources.ts` in the `inbox_ops` module
- Credentials (signing secrets + API key) stored encrypted via `IntegrationCredentials`
- Webhook handlers in `inbox_ops/webhook-handlers/` process Resend events
- `inbox_ops/setup.ts` programmatically configures the inbound webhook endpoint and migrates env-based secrets to encrypted credentials on tenant setup

**Deliverables**:

1. **Resend webhook source** (`inbox_ops/webhook-sources.ts`):
   ```typescript
   export const webhookSources: WebhookSourceConfig[] = [
     {
       key: 'resend',
       label: 'Resend',
       verifier: async (request, credentials) => {
         // Try Svix verification first (Resend's native), fallback to custom HMAC
         if (credentials.resendWebhookSigningSecret) {
           return verifySvixSignature(request, credentials.resendWebhookSigningSecret)
         }
         return verifyHmacSignature(request, credentials.inboxOpsWebhookSecret)
       },
       eventTypeExtractor: (body) => body.type as string,  // e.g., 'email.received'
       messageIdExtractor: (body) => body.data?.email_id as string,
     },
   ]
   ```

2. **Webhook handlers** (`inbox_ops/webhook-handlers/`):
   - `resend-email-received.ts` — handles `email.received` event (core inbound email processing, extracted from current `POST` handler)
   - `resend-email-bounced.ts` — handles `email.bounced` event (if applicable)

3. **Credential migration in `setup.ts`**:
   ```typescript
   // inbox_ops/setup.ts — onTenantCreated or seedDefaults
   async onTenantCreated({ em, tenantId, organizationId, container }) {
     const credentialsService = container.resolve('integrationCredentialsService')

     // Migrate env-based secrets to encrypted credentials (one-time, idempotent)
     const existing = await credentialsService.resolve(
       'webhook_source_resend', { organizationId, tenantId }
     )
     if (!existing) {
       const envSecret = process.env.INBOX_OPS_WEBHOOK_SECRET
       const envSvixSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET
       const envApiKey = process.env.RESEND_API_KEY
       if (envSecret || envSvixSecret || envApiKey) {
         await credentialsService.save('webhook_source_resend', {
           ...(envSecret && { inboxOpsWebhookSecret: envSecret }),
           ...(envSvixSecret && { resendWebhookSigningSecret: envSvixSecret }),
           ...(envApiKey && { resendApiKey: envApiKey }),
         }, { organizationId, tenantId })
       }
     }

     // Register inbound endpoint config
     const configRepo = em.getRepository(InboundEndpointConfig)
     const existingConfig = await configRepo.findOne({ sourceKey: 'resend', organizationId, tenantId })
     if (!existingConfig) {
       configRepo.create({
         sourceKey: 'resend',
         isActive: true,
         organizationId,
         tenantId,
       })
       await em.flush()
     }
   }
   ```

4. **URL backward compatibility**:
   - The old URL (`POST /api/inbox_ops/webhook/inbound`) MUST continue to work
   - Add a **redirect route** in `inbox_ops/api/webhook/inbound.ts` that proxies to `POST /api/webhooks/inbound/resend` — or keep the old route as a thin adapter that delegates to the new inbound system
   - The new canonical URL is `POST /api/webhooks/inbound/resend`
   - Add `@deprecated` comment to the old route with migration notice
   - Old route can be removed after 1 minor version

5. **Env var backward compatibility**:
   - During transition, `setup.ts` reads env vars and persists them as encrypted credentials
   - Once credentials exist in the database, env vars are ignored
   - Document the migration: "Set credentials via admin UI or run `yarn inbox-ops:migrate-credentials`"
   - Env vars remain supported for initial provisioning (first-run) but are not read at webhook verification time

6. **Verification**:
   - All existing `inbox_ops` webhook tests pass without modification (or with minimal route-level changes)
   - New integration tests verify the Resend → inbound handler → email processing flow
   - Existing Resend email processing logic (fetching email, parsing, storing) is extracted from the old route into the webhook handler — zero behavior change

**Backward compatibility contract**:

| Aspect | Guarantee |
|--------|-----------|
| Old webhook URL | Works via redirect/adapter for ≥1 minor version |
| Email processing behavior | Identical — same fetch, parse, store logic |
| Env var provisioning | Still works for first-run setup |
| Webhook signature verification | Same HMAC + Svix verification, now via source verifier |
| Resend API access | Same `fetchResendEmail` logic, API key from encrypted credentials |
| Event emissions | Same `inbox_ops.email.*` events emitted |

---

## 14. Backward Compatibility

### New Contract Surfaces

| Surface | Classification | Notes |
|---------|---------------|-------|
| `webhook-handlers.ts` barrel auto-discovery | FROZEN once released | Module-root file + `webhookHandlers` export (via `webhooks.handlers` generator plugin) |
| `webhook-sources.ts` auto-discovery | FROZEN once released | Module-root file + `webhookSources` export (via `webhooks.sources` generator plugin) |
| `WebhookHandlerMeta` interface | STABLE | Additive-only after release |
| `WebhookHandlerPayload` interface | STABLE | Additive-only after release |
| `WebhookSourceConfig` interface | STABLE | Additive-only after release |
| `POST /api/webhooks/inbound/:sourceKey` | STABLE | Cannot rename/remove |
| `WebhookIngestion` schema | ADDITIVE-ONLY | New columns with defaults OK |

### Route unification (BC#1 — resolved)

The inbound endpoint is **not** a new route. `POST /api/webhooks/inbound/[endpointId]`
(`api/inbound/[endpointId]/route.ts`) is the single, shipped entry point and its URL is
preserved. The handler resolves the path segment in this order:

1. `getWebhookSource(endpointId)` from the new source registry → run the source/handler flow
   (verify via the source `verifier` + decrypted credentials, extract event type + message id,
   record a `WebhookIngestion`, enqueue `webhook-inbound-dispatch`, emit
   `webhooks.inbound.received` for continuity, return `{ ok: true }`).
2. Otherwise `getWebhookEndpointAdapter(endpointId)` → the **legacy adapter path runs exactly as
   before** (verify, receipt dedup, emit `webhooks.inbound.received`).
3. Otherwise `404`.

This keeps every existing adapter working with zero behavior change and avoids a colliding route file.

### Migration from SPEC-057 Phase 3 (`WebhookEndpointAdapter` deprecation bridge)

The `WebhookEndpointAdapter` interface and its registry (`registerWebhookEndpointAdapter`,
`getWebhookEndpointAdapter`, `listWebhookEndpointAdapters`, `clearWebhookEndpointAdapters` in
`lib/adapter-registry.ts`) are **public contract surfaces (types + functions)** and are superseded
by `WebhookSourceConfig` + the handler convention. They MUST follow the deprecation protocol:

- **Keep them exported and functional for ≥1 minor version.** The unified route's step (2) above is
  the live bridge — registered adapters keep receiving inbound traffic.
- Add `@deprecated` JSDoc on the interface and the four registry functions, pointing to
  `webhook-sources.ts` + `webhook-handlers/*.ts`.
- Provide an optional adapter→`WebhookSourceConfig` wrapper helper so providers can migrate
  incrementally (a registered source for `key` shadows an adapter with the same `providerKey`).
- Document the deprecation + removal target in `RELEASE_NOTES.md`.
- Removal happens only after the bridge minor, in a follow-up spec.

---

## 15. Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Handler failure blocks other handlers for same event | Medium | Each handler executes independently; failures are caught and logged, not propagated |
| Tenant resolution ambiguity (multi-tenant, same source) | Medium | Credential-based disambiguation; fail-closed if ambiguous |
| Replay attack on inbound endpoint | Low | Deduplication cache + optional timestamp-based replay protection |
| Handler causes infinite event loop (handler emits event → triggers outbound webhook → external system sends webhook back) | High | Built-in loop detection: tag emitted events with `_inboundIngestionId`, skip outbound dispatch for tagged events. Rate limiting provides secondary protection |
| Large payload DoS | Medium | Request body size limit (1MB default, configurable per source) |
| Source verifier is slow/hangs | Medium | Verification timeout (5s default); async dispatch means receiver returns quickly |
| Credential DEK unavailable (KMS outage) | Medium | Fallback key chain: KMS -> dedicated `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`; auth/session secrets are not data-encryption fallbacks. Webhook verification fails gracefully with 500 if no key available |
| Env-to-encrypted migration fails (inbox_ops) | Medium | Migration is idempotent — retries on next tenant setup. Env vars remain readable as fallback during transition. CLI command for manual re-run |
| Inbox_ops old URL removal breaks external Resend config | High | Old URL kept as redirect for ≥1 minor version. Resend dashboard config updated in docs. Admin notification when old URL is hit |
| Handler results JSON grows unbounded | Low | Cap `handlerResults` array to 50 entries per ingestion. Truncate error messages to 1KB |

---

## 16. Comparison: Event Subscribers vs Webhook Handlers

| Aspect | Event Subscriber | Webhook Handler |
|--------|-----------------|-----------------|
| Location | `subscribers/*.ts` | `webhook-handlers/*.ts` |
| Trigger | Internal domain event | External HTTP webhook |
| Metadata | `{ event, persistent, id }` | `{ source, event, id, persistent? }` |
| Handler signature | `(payload, ctx)` | `(payload, ctx)` — same pattern |
| Dispatch | Event bus | Inbound dispatch worker |
| Verification | N/A (trusted internal) | Source-specific signature verification |
| Scope | Implicit (event carries tenantId) | Resolved from config/credentials/payload |
| Idempotency | Developer responsibility | Built-in deduplication + developer responsibility |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-23 | Initial draft |
| 2026-06-17 | Applied pre-implement analysis remediation: unify inbound on the existing `[endpointId]` route (resolves BC#1 route collision); add a concrete `WebhookEndpointAdapter` deprecation-bridge subsection (§14); correct the Phase 4 `inbox_ops` baseline (encrypted per-tenant secret + Svix already exist); fix dedup cache TTL to milliseconds and clarify the receipt-table durable dedup source of truth (§10.3); add optional `credentialFields` to `WebhookSourceConfig` for the admin UI; clarify credential encryption reuses the integrations map and `WebhookIngestion.payload`/`headers` are encrypted via the webhooks map (§10.1). Phase 1 implementation started. |
| 2026-06-17 | Phase 1 progress: shared inbound types; `WebhookIngestion`/`InboundEndpointConfig` entities + migration + encryption map; `inbound.processed`/`handler_failed` events; globalThis-backed source/handler registries + wildcard resolution; queue-backed `webhook-inbound-dispatch` worker. **Auto-discovery convention chosen:** implemented via the sanctioned `generators.ts` plugin mechanism (`webhooks/generators.ts`: `webhooks.sources` + `webhooks.handlers` plugins with `bootstrapRegistration`) rather than forking the two core generators. Consequently handlers are declared in a module-root **`webhook-handlers.ts`** barrel (impl files under `webhook-handlers/`) instead of a pure `webhook-handlers/*.ts` folder scan — lower blast-radius, zero `bootstrap.ts`/template edits (§3.2, §6). |

---

## Final Compliance Report

| Check | Status |
|-------|--------|
| TLDR present | Yes |
| Problem Statement | Yes |
| Architecture diagram | Yes |
| Data Models with entity definitions | Yes |
| API Contracts with all routes | Yes |
| Auto-discovery paths documented | Yes |
| Backward Compatibility assessment | Yes |
| Risks & Impact Review with mitigations | Yes |
| Integration test coverage | Yes |
| Implementation phases | Yes |
| Changelog | Yes |
