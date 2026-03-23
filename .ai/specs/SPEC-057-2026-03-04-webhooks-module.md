# SPEC-057 — Webhooks Module (Standard Webhooks)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-03-04 |
| **Related** | SPEC-045 (Integration Marketplace), SPEC-045e (Webhook Endpoints Hub), SPEC-041 (UMES), 2026-03-19-checkout-pay-links, Issue #257 |

## TLDR

Build a **webhooks module** (`packages/core/src/modules/webhooks/`) that provides both outbound (platform-to-external) and inbound (external-to-platform) webhook delivery, fully compliant with the [Standard Webhooks](https://www.standardwebhooks.com/) specification. The module binds to the existing typed event system via a wildcard persistent subscriber, delivers outbound webhooks through a dedicated queue worker with retry and exponential backoff, and serves as the `webhook_endpoints` hub for SPEC-045 Integration Marketplace. Shared webhook primitives (signing, verification, secret management) are extracted into `packages/shared/src/lib/webhooks/` for reuse by any module.

---

## 1. Problem Statement

Open Mercato emits rich domain events internally (orders created, customers updated, deals closed) but has no generic mechanism to push those events to external systems. The only existing webhook handler is the `inbox_ops` inbound email receiver, which is purpose-built and not reusable. External integrations (Zapier, n8n, custom automation, partner systems) need a standardized, secure, reliable way to:

1. **Receive outbound notifications** when domain events fire (push model)
2. **Send inbound webhooks** that trigger platform actions (receive model)

The Standard Webhooks specification provides an industry-standard contract for signing, verification, retry, and key rotation. Implementing it positions Open Mercato as a first-class integration target.

---

## 2. Architecture Overview

```
                                      OUTBOUND FLOW
                                      =============

  ┌─────────────┐    emit()    ┌──────────────────┐  persistent   ┌─────────────┐
  │ Any Module   ├────────────>│   Event Bus       ├──────────────>│  Events      │
  │ (events.ts)  │             │ (wildcard: *)     │  queue        │  Queue       │
  └─────────────┘             └──────────────────┘               └──────┬──────┘
                                                                        │
                                                              events.worker.ts
                                                                        │
                                                                        ▼
                                                        ┌──────────────────────────┐
                                                        │ webhook-dispatcher       │
                                                        │ (subscriber)             │
                                                        │                          │
                                                        │ 1. Load active webhooks  │
                                                        │ 2. Match event patterns  │
                                                        │ 3. Enqueue delivery jobs │
                                                        └───────────┬──────────────┘
                                                                    │
                                                            webhook-deliveries
                                                                queue
                                                                    │
                                                                    ▼
                                                        ┌──────────────────────────┐
                                                        │ delivery.worker.ts       │
                                                        │                          │
                                                        │ 1. Sign payload (StdWH)  │
                                                        │ 2. HTTP POST to URL      │
                                                        │ 3. Record result         │
                                                        │ 4. Retry on failure      │
                                                        └──────────────────────────┘


                                      INBOUND FLOW
                                      ============

  ┌──────────────┐  POST /api/webhooks/inbound/{endpointId}  ┌────────────────────┐
  │ External      ├─────────────────────────────────────────>│ inbound route       │
  │ System        │                                           │                     │
  └──────────────┘                                           │ 1. Verify signature │
                                                             │ 2. Rate limit       │
                                                             │ 3. Deduplicate      │
                                                             │ 4. Emit event       │
                                                             │ 5. Return 200       │
                                                             └─────────┬──────────┘
                                                                       │
                                                              webhooks.inbound.received
                                                                       │
                                                                       ▼
                                                             ┌─────────────────────┐
                                                             │ Subscriber /        │
                                                             │ WebhookEndpoint-    │
                                                             │ Adapter.process-    │
                                                             │ Inbound()           │
                                                             └─────────────────────┘


                              INTEGRATION WITH SPEC-045
                              =========================

  ┌───────────────────────────────────────────────────────────────────────────┐
  │  integrations module (SPEC-045a)                                         │
  │  ┌─────────────────┐  ┌───────────────────┐  ┌──────────────────────┐   │
  │  │ IntegrationState │  │ Integration-       │  │ IntegrationLog      │   │
  │  │ (enable/disable) │  │ Credentials        │  │ (delivery logs)     │   │
  │  │                  │  │ (webhook secrets)   │  │                     │   │
  │  └────────┬─────────┘  └────────┬───────────┘  └────────┬────────────┘   │
  └───────────┼─────────────────────┼────────────────────────┼───────────────┘
              │                     │                        │
              ▼                     ▼                        ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │  webhooks module (THIS SPEC)                                              │
  │  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐    │
  │  │ Webhook entity     │  │ WebhookDelivery    │  │ WebhookEndpoint- │    │
  │  │ (endpoint config)  │  │ (delivery log)     │  │ Adapter registry │    │
  │  └────────────────────┘  └────────────────────┘  └──────────────────┘    │
  └───────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Shared Webhook Primitives

### 3.1 Location

`packages/shared/src/lib/webhooks/`

This directory contains pure utility functions with zero domain dependencies, usable by any module (the webhooks module, `inbox_ops`, third-party integrations).

### 3.2 Files

```
packages/shared/src/lib/webhooks/
  index.ts              -- re-exports
  sign.ts               -- Standard Webhooks signature generation
  verify.ts             -- Standard Webhooks signature verification
  secrets.ts            -- Secret generation, parsing, rotation helpers
  types.ts              -- Shared type definitions
  __tests__/
    sign.test.ts
    verify.test.ts
    secrets.test.ts
```

### 3.3 Type Definitions (`types.ts`)

```typescript
/** Standard Webhooks headers */
export interface StandardWebhookHeaders {
  'webhook-id': string
  'webhook-timestamp': string
  'webhook-signature': string
}

/** Signing key with optional rotation context */
export interface WebhookSigningKey {
  /** Base64 secret without whsec_ prefix */
  secret: string
  /** Whether this is a rotation key (previous key kept for dual-signing) */
  isRotation?: boolean
}

/** Result of signature verification */
export interface WebhookVerifyResult {
  valid: boolean
  /** Which key was used for verification (index in the keys array) */
  keyIndex?: number
}

/** Configuration for signature operations */
export interface WebhookSignConfig {
  /** Maximum age of webhook-timestamp before replay rejection (ms). Default: 300000 (5min) */
  timestampToleranceMs?: number
}

/** Webhook delivery target */
export interface WebhookDeliveryTarget {
  url: string
  method?: 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
}
```

### 3.4 Signature Generation (`sign.ts`)

```typescript
import { createHmac } from 'node:crypto'

export function signPayload(
  messageId: string,
  timestamp: number,
  body: string,
  secretBase64: string,
): string {
  const toSign = `${messageId}.${timestamp}.${body}`
  const secretBytes = Buffer.from(secretBase64, 'base64')
  const signature = createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64')
  return `v1,${signature}`
}

export function buildStandardHeaders(
  messageId: string,
  body: string,
  keys: WebhookSigningKey[],
): StandardWebhookHeaders {
  const timestamp = Math.floor(Date.now() / 1000)
  const signatures = keys
    .map(k => signPayload(messageId, timestamp, body, k.secret))
    .join(' ')
  return {
    'webhook-id': messageId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signatures,
  }
}
```

### 3.5 Signature Verification (`verify.ts`)

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { WebhookVerifyResult, WebhookSignConfig } from './types'

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000 // 5 minutes

export function verifyStandardWebhook(
  headers: { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string },
  body: string,
  secretsBase64: string[],
  config?: WebhookSignConfig,
): WebhookVerifyResult {
  const toleranceMs = config?.timestampToleranceMs ?? DEFAULT_TOLERANCE_MS
  const messageId = headers['webhook-id']
  const timestampStr = headers['webhook-timestamp']
  const signatureHeader = headers['webhook-signature']

  if (!messageId || !timestampStr || !signatureHeader) {
    return { valid: false }
  }

  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp)) return { valid: false }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestamp) * 1000 > toleranceMs) {
    return { valid: false } // replay attack
  }

  const toSign = `${messageId}.${timestamp}.${body}`
  const receivedSignatures = signatureHeader.split(' ')

  for (const [keyIndex, secretBase64] of secretsBase64.entries()) {
    const secretBytes = Buffer.from(secretBase64, 'base64')
    const expected = createHmac('sha256', secretBytes).update(toSign).digest()

    for (const sig of receivedSignatures) {
      if (!sig.startsWith('v1,')) continue
      const receivedBase64 = sig.slice(3)
      try {
        const received = Buffer.from(receivedBase64, 'base64')
        if (received.length === expected.length && timingSafeEqual(received, expected)) {
          return { valid: true, keyIndex }
        }
      } catch { /* invalid base64, try next */ }
    }
  }

  return { valid: false }
}
```

### 3.6 Secret Management (`secrets.ts`)

```typescript
import { randomBytes } from 'node:crypto'

const WHSEC_PREFIX = 'whsec_'

export function generateWebhookSecret(): string {
  const bytes = randomBytes(24) // 192 bits
  return `${WHSEC_PREFIX}${bytes.toString('base64')}`
}

export function parseWebhookSecret(secret: string): string {
  if (secret.startsWith(WHSEC_PREFIX)) {
    return secret.slice(WHSEC_PREFIX.length)
  }
  return secret // assume raw base64
}

export function isValidWebhookSecret(secret: string): boolean {
  const base64 = parseWebhookSecret(secret)
  try {
    const bytes = Buffer.from(base64, 'base64')
    return bytes.length >= 24 && bytes.length <= 64
  } catch {
    return false
  }
}
```

---

## 4. Webhooks Module

### 4.1 Module Path

`packages/core/src/modules/webhooks/`

### 4.2 Module File Structure

```
packages/core/src/modules/webhooks/
  index.ts                              -- module metadata
  acl.ts                                -- RBAC feature declarations
  setup.ts                              -- tenant init, default role features
  di.ts                                 -- DI registrar (Awilix)
  events.ts                             -- typed event declarations
  integration.ts                        -- Integration Marketplace registration (webhook hub)
  data/
    entities.ts                         -- Webhook, WebhookDelivery entities
    validators.ts                       -- Zod validation schemas
  api/
    openapi.ts                          -- createCrudOpenApiFactory
    webhooks/
      route.ts                          -- CRUD for webhook endpoints
    webhooks/[id]/
      route.ts                          -- GET/PUT/DELETE single webhook
    webhooks/[id]/rotate-secret/
      route.ts                          -- POST rotate signing secret
    webhooks/[id]/test/
      route.ts                          -- POST send test delivery
    deliveries/
      route.ts                          -- GET list deliveries (with filters)
    deliveries/[id]/
      route.ts                          -- GET single delivery detail
    deliveries/[id]/retry/
      route.ts                          -- POST retry a failed delivery
    inbound/[endpointId]/
      route.ts                          -- POST generic inbound receiver
    events/
      route.ts                          -- GET list available event types for subscription
  subscribers/
    webhook-dispatcher.ts               -- wildcard (*) subscriber: match & enqueue
  workers/
    delivery.worker.ts                  -- process delivery queue with retry
  lib/
    delivery.ts                         -- HTTP delivery with retry logic
    retry.ts                            -- retry schedule calculation
    event-matcher.ts                    -- wildcard event pattern matching
    adapter-registry.ts                 -- WebhookEndpointAdapter registry
  backend/
    webhooks/
      page.meta.ts
      page.tsx                          -- webhook list page
      create/
        page.meta.ts
        page.tsx                        -- create webhook form
      [id]/
        page.meta.ts
        page.tsx                        -- webhook detail + delivery logs
  migrations/
    (auto-generated)
```

### 4.3 Entity Definitions

#### 4.3.1 Webhook Entity

```typescript
// data/entities.ts

@Entity({ tableName: 'webhooks' })
@Index({ properties: ['organizationId', 'tenantId', 'isActive'] })
@Index({ properties: ['organizationId', 'tenantId', 'deletedAt'] })
export class Webhook {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** Human-readable label */
  @Property({ name: 'name', type: 'text' })
  name!: string

  /** Optional description */
  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  /** Target URL for delivery */
  @Property({ name: 'url', type: 'text' })
  url!: string

  /** Signing secret (whsec_ prefixed, encrypted at rest) */
  @Property({ name: 'secret', type: 'text' })
  secret!: string

  /** Previous signing secret for dual-signing during rotation (encrypted at rest) */
  @Property({ name: 'previous_secret', type: 'text', nullable: true })
  previousSecret?: string | null

  /** When the previous secret was set (cleared after rotation period) */
  @Property({ name: 'previous_secret_set_at', type: Date, nullable: true })
  previousSecretSetAt?: Date | null

  /** Subscribed event patterns (supports wildcards: *, customers.*, sales.order.*) */
  @Property({ name: 'subscribed_events', type: 'json' })
  subscribedEvents!: string[]

  /** HTTP method for delivery */
  @Property({ name: 'http_method', type: 'text', default: 'POST' })
  httpMethod: 'POST' | 'PUT' | 'PATCH' = 'POST'

  /** Custom headers to include with deliveries */
  @Property({ name: 'custom_headers', type: 'json', nullable: true })
  customHeaders?: Record<string, string> | null

  /** Whether this webhook is active */
  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  /** Delivery strategy: http (default), sqs, sns */
  @Property({ name: 'delivery_strategy', type: 'text', default: 'http' })
  deliveryStrategy: 'http' | 'sqs' | 'sns' = 'http'

  /** Strategy-specific configuration (e.g., SQS queue URL) */
  @Property({ name: 'strategy_config', type: 'json', nullable: true })
  strategyConfig?: Record<string, unknown> | null

  /** Maximum retry attempts (default: 10) */
  @Property({ name: 'max_retries', type: 'int', default: 10 })
  maxRetries: number = 10

  /** Timeout for delivery requests in milliseconds (default: 15000) */
  @Property({ name: 'timeout_ms', type: 'int', default: 15000 })
  timeoutMs: number = 15000

  /** Rate limit: max deliveries per minute (0 = unlimited) */
  @Property({ name: 'rate_limit_per_minute', type: 'int', default: 0 })
  rateLimitPerMinute: number = 0

  /** Count of consecutive failures (for auto-disable) */
  @Property({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number = 0

  /** Auto-disable after N consecutive failures (0 = never auto-disable) */
  @Property({ name: 'auto_disable_threshold', type: 'int', default: 100 })
  autoDisableThreshold: number = 100

  /** Last successful delivery timestamp */
  @Property({ name: 'last_success_at', type: Date, nullable: true })
  lastSuccessAt?: Date | null

  /** Last failure timestamp */
  @Property({ name: 'last_failure_at', type: Date, nullable: true })
  lastFailureAt?: Date | null

  /** Optional integration ID (links to SPEC-045 integrations) */
  @Property({ name: 'integration_id', type: 'text', nullable: true })
  integrationId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

#### 4.3.2 WebhookDelivery Entity

```typescript
@Entity({ tableName: 'webhook_deliveries' })
@Index({ properties: ['webhookId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'createdAt'] })
@Index({ properties: ['webhookId', 'createdAt'] })
@Index({ properties: ['eventType', 'organizationId'] })
export class WebhookDelivery {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK to Webhook (no ORM relation — cross-entity by ID) */
  @Property({ name: 'webhook_id', type: 'uuid' })
  webhookId!: string

  /** Event type that triggered this delivery */
  @Property({ name: 'event_type', type: 'text' })
  eventType!: string

  /** Standard Webhooks message ID (webhook-id header value) */
  @Property({ name: 'message_id', type: 'text' })
  messageId!: string

  /** Serialized payload body (JSON) */
  @Property({ name: 'payload', type: 'json' })
  payload!: Record<string, unknown>

  /** Delivery status */
  @Property({ name: 'status', type: 'text', default: 'pending' })
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'expired' = 'pending'

  /** HTTP status code from last attempt */
  @Property({ name: 'response_status', type: 'int', nullable: true })
  responseStatus?: number | null

  /** Response body snippet from last attempt (max 4KB) */
  @Property({ name: 'response_body', type: 'text', nullable: true })
  responseBody?: string | null

  /** Response headers from last attempt */
  @Property({ name: 'response_headers', type: 'json', nullable: true })
  responseHeaders?: Record<string, string> | null

  /** Error message from last attempt */
  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  /** Current attempt number (1-based) */
  @Property({ name: 'attempt_number', type: 'int', default: 0 })
  attemptNumber: number = 0

  /** Maximum attempts (copied from webhook at enqueue time) */
  @Property({ name: 'max_attempts', type: 'int', default: 10 })
  maxAttempts: number = 10

  /** When to attempt the next retry */
  @Property({ name: 'next_retry_at', type: Date, nullable: true })
  nextRetryAt?: Date | null

  /** Total delivery latency in ms (from enqueue to final response) */
  @Property({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null

  /** Target URL at time of delivery (snapshot, as webhook URL may change) */
  @Property({ name: 'target_url', type: 'text' })
  targetUrl!: string

  /** Timestamp when first enqueued */
  @Property({ name: 'enqueued_at', type: Date })
  enqueuedAt: Date = new Date()

  /** Timestamp of last delivery attempt */
  @Property({ name: 'last_attempt_at', type: Date, nullable: true })
  lastAttemptAt?: Date | null

  /** Timestamp when delivery succeeded */
  @Property({ name: 'delivered_at', type: Date, nullable: true })
  deliveredAt?: Date | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

#### 4.3.3 SQL DDL (PostgreSQL)

```sql
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  previous_secret TEXT,
  previous_secret_set_at TIMESTAMPTZ,
  subscribed_events JSONB NOT NULL DEFAULT '[]',
  http_method TEXT NOT NULL DEFAULT 'POST',
  custom_headers JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  delivery_strategy TEXT NOT NULL DEFAULT 'http',
  strategy_config JSONB,
  max_retries INTEGER NOT NULL DEFAULT 10,
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  auto_disable_threshold INTEGER NOT NULL DEFAULT 100,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  integration_id TEXT,
  organization_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_webhooks_org_tenant_active
  ON webhooks (organization_id, tenant_id, is_active);
CREATE INDEX idx_webhooks_org_tenant_deleted
  ON webhooks (organization_id, tenant_id, deleted_at);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_status INTEGER,
  response_body TEXT,
  response_headers JSONB,
  error_message TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  next_retry_at TIMESTAMPTZ,
  duration_ms INTEGER,
  target_url TEXT NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  organization_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_wh_status
  ON webhook_deliveries (webhook_id, status);
CREATE INDEX idx_webhook_deliveries_org_tenant_created
  ON webhook_deliveries (organization_id, tenant_id, created_at);
CREATE INDEX idx_webhook_deliveries_wh_created
  ON webhook_deliveries (webhook_id, created_at);
CREATE INDEX idx_webhook_deliveries_event
  ON webhook_deliveries (event_type, organization_id);
```

### 4.4 Validation Schemas (`data/validators.ts`)

```typescript
import { z } from 'zod'

export const webhookCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  url: z.string().url(),
  subscribedEvents: z.array(z.string().min(1)).min(1),
  httpMethod: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  customHeaders: z.record(z.string()).optional(),
  deliveryStrategy: z.enum(['http', 'sqs', 'sns']).default('http'),
  strategyConfig: z.record(z.unknown()).optional(),
  maxRetries: z.number().int().min(0).max(30).default(10),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  rateLimitPerMinute: z.number().int().min(0).max(10000).default(0),
  autoDisableThreshold: z.number().int().min(0).max(1000).default(100),
  integrationId: z.string().optional(),
})

export const webhookUpdateSchema = webhookCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const webhookDeliveryQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  webhookId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  status: z.enum(['pending', 'sending', 'delivered', 'failed', 'expired']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})
```

### 4.5 Event Declarations (`events.ts`)

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'webhooks.webhook.created', label: 'Webhook Created', entity: 'webhook', category: 'crud' },
  { id: 'webhooks.webhook.updated', label: 'Webhook Updated', entity: 'webhook', category: 'crud' },
  { id: 'webhooks.webhook.deleted', label: 'Webhook Deleted', entity: 'webhook', category: 'crud' },
  { id: 'webhooks.delivery.enqueued', label: 'Delivery Enqueued', entity: 'delivery', category: 'lifecycle' },
  { id: 'webhooks.delivery.succeeded', label: 'Delivery Succeeded', entity: 'delivery', category: 'lifecycle', clientBroadcast: true },
  { id: 'webhooks.delivery.failed', label: 'Delivery Failed', entity: 'delivery', category: 'lifecycle', clientBroadcast: true },
  { id: 'webhooks.delivery.exhausted', label: 'Delivery Retries Exhausted', entity: 'delivery', category: 'lifecycle', clientBroadcast: true },
  { id: 'webhooks.webhook.disabled', label: 'Webhook Auto-Disabled', entity: 'webhook', category: 'lifecycle', clientBroadcast: true },
  { id: 'webhooks.inbound.received', label: 'Inbound Webhook Received', entity: 'inbound', category: 'custom' },
  { id: 'webhooks.secret.rotated', label: 'Secret Rotated', entity: 'webhook', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'webhooks', events })
export const emitWebhooksEvent = eventsConfig.emit
export type WebhooksEventId = typeof events[number]['id']
export default eventsConfig
```

### 4.6 Access Control (`acl.ts`)

```typescript
export const features = [
  { id: 'webhooks.view', title: 'View webhooks and delivery logs', module: 'webhooks' },
  { id: 'webhooks.manage', title: 'Create, edit, and delete webhooks', module: 'webhooks' },
  { id: 'webhooks.secrets', title: 'View and rotate webhook secrets', module: 'webhooks' },
  { id: 'webhooks.test', title: 'Send test webhook deliveries', module: 'webhooks' },
]
```

### 4.7 Module Setup (`setup.ts`)

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['webhooks.view', 'webhooks.manage', 'webhooks.secrets', 'webhooks.test'],
    admin: ['webhooks.view', 'webhooks.manage', 'webhooks.secrets', 'webhooks.test'],
    employee: ['webhooks.view'],
  },
}

export default setup
```

---

## 5. API Endpoint Definitions

### 5.1 Webhook CRUD

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/webhooks` | `webhooks.view` | List all webhooks for the tenant |
| POST | `/api/webhooks` | `webhooks.manage` | Create a new webhook endpoint |
| GET | `/api/webhooks/:id` | `webhooks.view` | Get webhook details |
| PUT | `/api/webhooks/:id` | `webhooks.manage` | Update a webhook |
| DELETE | `/api/webhooks/:id` | `webhooks.manage` | Soft-delete a webhook |
| POST | `/api/webhooks/:id/rotate-secret` | `webhooks.secrets` | Rotate signing secret (dual-sign period) |
| POST | `/api/webhooks/:id/test` | `webhooks.test` | Send a test delivery with sample payload |

### 5.2 Delivery Logs

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/webhooks/deliveries` | `webhooks.view` | List deliveries with filtering |
| GET | `/api/webhooks/deliveries/:id` | `webhooks.view` | Get delivery detail (request + response) |
| POST | `/api/webhooks/deliveries/:id/retry` | `webhooks.manage` | Manually retry a failed delivery |

### 5.3 Available Events

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/webhooks/events` | `webhooks.view` | List all available event types for subscription |

### 5.4 Inbound Receiver

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhooks/inbound/:endpointId` | None (signature verified) | Generic inbound webhook receiver |

### 5.5 Key API Behaviors

**POST /api/webhooks (Create)**:
- Auto-generates a `whsec_`-prefixed secret using `generateWebhookSecret()`
- Returns the secret in the response body (only time it is returned in plaintext)
- Validates that `subscribedEvents` contains at least one event pattern
- Validates URL is HTTPS in production (configurable)

**POST /api/webhooks/:id/rotate-secret**:
- Generates a new secret
- Moves current secret to `previousSecret` with `previousSecretSetAt = now()`
- During rotation period (configurable, default: 24h), outbound deliveries dual-sign with both keys
- After rotation period, a scheduled cleanup removes the previous secret
- Returns new secret in plaintext (only time)

**POST /api/webhooks/:id/test**:
- Constructs a synthetic `webhooks.test.ping` event payload
- Delivers immediately (bypass queue) with full Standard Webhooks signing
- Returns delivery result synchronously (status, latency, response snippet)

**GET /api/webhooks/events**:
- Uses `getDeclaredEvents()` from `@open-mercato/shared/modules/events` to list all registered event types
- Returns event IDs grouped by module, with labels and categories
- Excludes events with `excludeFromTriggers: true`

**Alignment note: Checkout Pay Links automation**
- outbound webhooks must support checkout pay-link lifecycle automation without any checkout-specific branching inside the webhooks module
- the pay-links module is expected to expose stable post-commit events suitable for external system calls:
  - `checkout.transaction.customerDataCaptured`
  - `checkout.transaction.sessionStarted`
  - `checkout.transaction.completed`
  - `checkout.transaction.failed`
- this allows operators to trigger external CRM, ERP, fulfillment, fraud, or notification workflows when customer data is acquired, the payment session starts, or the payment succeeds/fails
- the webhooks module treats these like any other typed event; the required work is event-contract discipline in the source module, not custom dispatch logic here

---

## 6. Outbound Delivery Flow

### 6.1 Webhook Dispatcher Subscriber

```typescript
// subscribers/webhook-dispatcher.ts

export const metadata = {
  event: '*',          // wildcard: subscribe to ALL events
  persistent: true,    // survive restarts, retried on failure
  id: 'webhooks:dispatcher',
}

export default async function handle(payload: EventPayload, ctx: SubscriberContext) {
  const eventName = ctx.eventName
  if (!eventName) return

  // Skip webhook-internal events to prevent loops
  if (eventName.startsWith('webhooks.')) return

  const em = (ctx.resolve('em') as EntityManager).fork()

  // Load active webhooks for this tenant
  const tenantId = (payload as Record<string, unknown>).tenantId as string | undefined
  const organizationId = (payload as Record<string, unknown>).organizationId as string | undefined
  if (!tenantId || !organizationId) return

  const webhooks = await findWithDecryption(em, Webhook, {
    organizationId,
    tenantId,
    isActive: true,
    deletedAt: null,
  })

  // Match event against each webhook's subscribed patterns
  for (const webhook of webhooks) {
    const matches = webhook.subscribedEvents.some(pattern =>
      matchEventPattern(eventName, pattern)
    )
    if (!matches) continue

    // Create delivery record
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`
    const delivery = em.create(WebhookDelivery, {
      webhookId: webhook.id,
      eventType: eventName,
      messageId,
      payload: buildOutboundPayload(eventName, payload),
      status: 'pending',
      maxAttempts: webhook.maxRetries + 1,
      targetUrl: webhook.url,
      enqueuedAt: new Date(),
      organizationId,
      tenantId,
    })
    em.persist(delivery)

    // Enqueue delivery job
    const queue = ctx.resolve<Queue>('webhookDeliveryQueue')
    await queue.enqueue({
      deliveryId: delivery.id,
      webhookId: webhook.id,
      organizationId,
      tenantId,
    })
  }

  await em.flush()
}

function buildOutboundPayload(eventType: string, eventPayload: EventPayload): Record<string, unknown> {
  return {
    type: eventType,
    timestamp: new Date().toISOString(),
    data: eventPayload,
  }
}
```

### 6.1A Event-Contract Requirements for Webhook-Facing Modules

Modules that expect external automation through outbound webhooks MUST emit events that are safe and deterministic for delivery outside the platform.

Requirements:
- emit webhook-facing lifecycle events only after the relevant database state is committed
- include stable identifiers and current state snapshots in the event payload so receivers do not need to race a follow-up read
- never include secrets, provider credentials, embedded-form tokens, or raw mutable client input that was not persisted
- if customer data is included, it must come from the validated persisted snapshot, not from transient request body data
- payloads should be idempotency-friendly: external consumers must be able to reconcile on domain identifiers such as `transactionId`, `orderId`, or `customerId`
- modules must assume at-least-once delivery and best-effort ordering; event payloads therefore need enough status/context to be self-reconciling

Checkout Pay Links is the reference use case for this rule set:
- `checkout.transaction.customerDataCaptured` fires after encrypted customer data is persisted
- `checkout.transaction.sessionStarted` fires after gateway session creation data is persisted
- `checkout.transaction.completed` / `checkout.transaction.failed` fire after the terminal state commit
- these events are intended to drive external system calls smoothly through generic webhook subscriptions such as `checkout.transaction.**`

### 6.2 Event Pattern Matching

Reuse the existing `matchEventPattern()` from `packages/events/src/bus.ts`. The function already supports:
- Global wildcard: `*` matches all events
- Segment wildcard: `customers.*` matches `customers.people` but not `customers.people.created`
- Exact match: `sales.order.created`

For webhook subscriptions, extend with multi-segment wildcards to support patterns like `customers.**` matching all events under the `customers` namespace. This is achieved by adding a `**` pattern that matches one or more segments.

### 6.3 Delivery Worker

```typescript
// workers/delivery.worker.ts

export const metadata: WorkerMeta = {
  queue: 'webhook-deliveries',
  id: 'webhooks:delivery-worker',
  concurrency: 10,  // I/O-bound: network calls
}

type DeliveryJobPayload = {
  deliveryId: string
  webhookId: string
  organizationId: string
  tenantId: string
}

export default async function handle(
  job: QueuedJob<DeliveryJobPayload>,
  ctx: JobContext & { resolve: <T>(name: string) => T }
): Promise<void> {
  const { deliveryId, webhookId, organizationId, tenantId } = job.payload
  const em = (ctx.resolve('em') as EntityManager).fork()

  const delivery = await findOneWithDecryption(em, WebhookDelivery, { id: deliveryId })
  if (!delivery || delivery.status === 'delivered' || delivery.status === 'expired') return

  const webhook = await findOneWithDecryption(em, Webhook, {
    id: webhookId,
    organizationId,
    tenantId,
  })
  if (!webhook || !webhook.isActive) {
    delivery.status = 'expired'
    delivery.errorMessage = 'Webhook disabled or deleted'
    await em.flush()
    return
  }

  // Increment attempt
  delivery.attemptNumber += 1
  delivery.status = 'sending'
  delivery.lastAttemptAt = new Date()
  await em.flush()

  // Build Standard Webhooks headers
  const bodyStr = JSON.stringify(delivery.payload)
  const signingKeys: WebhookSigningKey[] = [
    { secret: parseWebhookSecret(webhook.secret) },
  ]
  if (webhook.previousSecret) {
    signingKeys.push({ secret: parseWebhookSecret(webhook.previousSecret), isRotation: true })
  }
  const headers = buildStandardHeaders(delivery.messageId, bodyStr, signingKeys)

  // Merge custom headers
  const allHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
    ...(webhook.customHeaders || {}),
  }

  const startTime = Date.now()
  try {
    const response = await fetch(webhook.url, {
      method: webhook.httpMethod,
      headers: allHeaders,
      body: bodyStr,
      signal: AbortSignal.timeout(webhook.timeoutMs),
    })

    delivery.durationMs = Date.now() - startTime
    delivery.responseStatus = response.status
    delivery.responseBody = (await response.text()).slice(0, 4096)

    if (response.ok) {
      // Success
      delivery.status = 'delivered'
      delivery.deliveredAt = new Date()
      webhook.consecutiveFailures = 0
      webhook.lastSuccessAt = new Date()
      await em.flush()

      await emitWebhooksEvent('webhooks.delivery.succeeded', {
        deliveryId, webhookId, eventType: delivery.eventType,
        tenantId, organizationId,
      })
      return
    }

    // Non-2xx response
    delivery.errorMessage = `HTTP ${response.status}`

    // 410 Gone: consumer wants to unsubscribe
    if (response.status === 410) {
      webhook.isActive = false
      delivery.status = 'expired'
      await em.flush()

      await emitWebhooksEvent('webhooks.webhook.disabled', {
        webhookId, reason: 'HTTP 410 Gone',
        tenantId, organizationId,
      })
      return
    }

    // 4xx (except 408, 429): do not retry
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      delivery.status = 'failed'
      await em.flush()

      await emitWebhooksEvent('webhooks.delivery.failed', {
        deliveryId, webhookId, eventType: delivery.eventType,
        responseStatus: response.status,
        tenantId, organizationId,
      })
      return
    }

    // Retryable failure
    await handleRetry(delivery, webhook, em, ctx)
  } catch (error) {
    delivery.durationMs = Date.now() - startTime
    delivery.errorMessage = error instanceof Error ? error.message : String(error)

    await handleRetry(delivery, webhook, em, ctx)
  }
}
```

### 6.4 Retry Schedule

Per Standard Webhooks specification, retry follows exponential backoff with jitter:

```
Attempt 1: immediate
Attempt 2: ~5 seconds
Attempt 3: ~5 minutes
Attempt 4: ~30 minutes
Attempt 5: ~2 hours
Attempt 6: ~5 hours
Attempt 7: ~10 hours
Attempt 8: ~14 hours
Attempt 9: ~20 hours
Attempt 10: ~24 hours
```

```typescript
// lib/retry.ts

const RETRY_DELAYS_MS = [
  0,           // attempt 1: immediate
  5_000,       // attempt 2: 5s
  300_000,     // attempt 3: 5min
  1_800_000,   // attempt 4: 30min
  7_200_000,   // attempt 5: 2h
  18_000_000,  // attempt 6: 5h
  36_000_000,  // attempt 7: 10h
  50_400_000,  // attempt 8: 14h
  72_000_000,  // attempt 9: 20h
  86_400_000,  // attempt 10: 24h
]

export function getRetryDelayMs(attemptNumber: number): number {
  const baseDelay = RETRY_DELAYS_MS[Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)]
  // Add jitter: +/- 20%
  const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(baseDelay + jitter))
}
```

### 6.5 Delivery Strategy Pattern

```typescript
// lib/delivery.ts

export interface DeliveryStrategy {
  readonly strategyType: string
  deliver(target: WebhookDeliveryTarget, body: string, headers: Record<string, string>, timeoutMs: number): Promise<DeliveryResult>
}

export interface DeliveryResult {
  success: boolean
  statusCode?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  errorMessage?: string
  durationMs: number
}
```

Phase 1 implements `HttpDeliveryStrategy`. Phase 2 adds `SqsDeliveryStrategy` and `SnsDeliveryStrategy`.

---

## 7. Inbound Webhook Flow

### 7.1 Generic Receiver Endpoint

`POST /api/webhooks/inbound/:endpointId`

This endpoint receives webhooks from external systems. The `endpointId` resolves to a configured inbound endpoint (registered via `WebhookEndpointAdapter`).

```typescript
// api/inbound/[endpointId]/route.ts

export const metadata = {
  POST: { requireAuth: false }, // signature-verified
}

export async function POST(req: Request, { params }: { params: { endpointId: string } }) {
  const { endpointId } = params
  const container = await createRequestContainer()

  // Rate limit
  const rateLimiter = container.resolve<RateLimiterService>('rateLimiterService')
  const rateResult = await rateLimiter.consume(`webhook:inbound:${endpointId}`, {
    points: 60, duration: 60, keyPrefix: 'webhooks:inbound',
  })
  if (!rateResult.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(rateResult.msBeforeNext / 1000)) },
    })
  }

  // Resolve adapter
  const adapterRegistry = container.resolve<WebhookAdapterRegistry>('webhookAdapterRegistry')
  const adapter = adapterRegistry.get(endpointId)
  if (!adapter) {
    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 404 })
  }

  // Read and verify
  const rawBody = await req.text()
  const headerMap = Object.fromEntries(req.headers.entries())

  try {
    const verified = await adapter.verifyWebhook({
      headers: headerMap,
      body: rawBody,
      method: req.method,
    })

    // Fire-and-forget: return 200 immediately, process async
    await emitWebhooksEvent('webhooks.inbound.received', {
      endpointId,
      providerKey: adapter.providerKey,
      event: verified,
      tenantId: verified.tenantId,
      organizationId: verified.organizationId,
    }, { persistent: true })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
  }
}
```

---

## 8. Integration with SPEC-045 (Integration Marketplace)

### 8.1 Integration Definition

```typescript
// integration.ts

import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const integration: IntegrationDefinition = {
  id: 'webhook_endpoints',
  title: 'Webhook Endpoints',
  description: 'Send and receive webhooks using the Standard Webhooks specification.',
  category: 'webhook',
  hub: 'webhook_endpoints',
  providerKey: 'webhook_custom',
  icon: 'webhook',
  tags: ['webhooks', 'automation', 'events', 'standard-webhooks'],
  credentials: { fields: [] }, // Webhook secrets managed per-endpoint, not per-integration
}
```

### 8.2 WebhookEndpointAdapter Contract

The webhooks module serves as the hub for the `webhook_endpoints` integration category. Third-party modules can register adapters for specific external services.

```typescript
// lib/adapter-registry.ts

export interface WebhookEndpointAdapter {
  readonly providerKey: string
  readonly subscribedEvents: string[]

  formatPayload(event: { type: string; data: unknown }): Promise<{
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
    method: 'POST' | 'PUT' | 'PATCH'
  }>

  verifyWebhook(input: {
    headers: Record<string, string>
    body: string
    method: string
  }): Promise<{
    eventType: string
    payload: Record<string, unknown>
    tenantId?: string
    organizationId?: string
  }>

  processInbound(event: {
    eventType: string
    payload: Record<string, unknown>
    tenantId?: string
    organizationId?: string
  }): Promise<void>
}
```

### 8.3 Default Provider: `webhook_custom`

The `webhook_custom` provider enables admin-configurable webhooks without code. This is the default — admins configure target URL, events, and the system handles Standard Webhooks signing automatically. No adapter code is needed because the core outbound flow handles it.

---

## 9. Backend UI

### 9.1 Webhook List Page (`/backend/webhooks`)

- **DataTable** with columns: Name, URL (truncated), Status (active/disabled badge), Events (count badge), Last Delivery (relative time + status icon), Created At
- **Filters**: Status (all/active/disabled), search by name/URL
- **Row Actions**: Edit, Toggle Active, View Deliveries, Delete
- **Header Actions**: "Create Webhook" button
- **Feature guard**: `webhooks.view`

### 9.2 Create/Edit Webhook Form (`/backend/webhooks/create`, `/backend/webhooks/:id`)

- **CrudForm** with sections:
  - **Basic**: Name, Description, URL, HTTP Method (select: POST/PUT/PATCH)
  - **Events**: Multi-select from available event types (loaded from `/api/webhooks/events`), with search and grouping by module. Supports typing wildcard patterns directly.
  - **Delivery**: Max Retries (slider 0-30), Timeout (slider 1-60s), Rate Limit per Minute (0=unlimited), Auto-Disable Threshold
  - **Advanced**: Custom Headers (key-value editor), Delivery Strategy (select), Strategy Config (JSON editor, hidden unless SQS/SNS)
- **Secret display**: On create success, show the secret once with copy button and warning "This is the only time you can see this secret"
- **Feature guard**: `webhooks.manage`

### 9.3 Webhook Detail Page (`/backend/webhooks/:id`)

- **Header**: Name, URL, Status badge, "Edit" / "Rotate Secret" / "Test" / "Delete" buttons
- **Tabs**:
  - **Overview**: Configuration summary, last success/failure, consecutive failures count
  - **Deliveries**: DataTable of `WebhookDelivery` filtered by this webhook. Columns: Event Type, Status (badge), Attempt #, Response Status, Duration, Created At. Row click opens delivery detail.
  - **Delivery Detail** (slide-out panel): Full request (headers, body), full response (status, headers, body snippet), retry timeline
- **Test Panel**: Button that sends a test ping, shows result inline
- **Feature guard**: `webhooks.view` for viewing, `webhooks.secrets` for secret rotation, `webhooks.test` for test delivery

---

## 10. Implementation Phases

### Phase 1: Core Outbound (Target: 2 weeks)

**Goal**: End-to-end outbound webhook delivery with basic UI.

**Deliverables**:
1. `packages/shared/src/lib/webhooks/` -- sign, verify, secrets utilities + tests
2. `packages/core/src/modules/webhooks/` -- module scaffold (index, acl, setup, di, events)
3. `Webhook` and `WebhookDelivery` entities + migration
4. CRUD API routes for webhooks (create, list, get, update, delete)
5. Deliveries API (list, get)
6. `webhook-dispatcher` subscriber (wildcard `*`, match events, enqueue)
7. `delivery.worker.ts` with HTTP strategy and Standard Webhooks signing
8. Retry logic with exponential backoff
9. Backend UI: list page, create form, detail page with delivery tab
10. Available events API (`GET /api/webhooks/events`)

**Dependencies**: Event system (`packages/events`), Queue system (`packages/queue`), shared encryption

### Phase 2: Advanced Delivery (Target: 1 week)

**Goal**: Key rotation, test delivery, manual retry, auto-disable.

**Deliverables**:
1. `POST /api/webhooks/:id/rotate-secret` with dual-signing period
2. `POST /api/webhooks/:id/test` with synchronous test delivery
3. `POST /api/webhooks/deliveries/:id/retry` for manual retry
4. Auto-disable logic: disable webhook after N consecutive failures
5. Delivery strategies: `SqsDeliveryStrategy`, `SnsDeliveryStrategy`
6. Delivery log cleanup: scheduled worker to purge deliveries older than configurable retention period (default: 30 days)

**Dependencies**: Phase 1

### Phase 3: Inbound Webhooks (Target: 1 week)

**Goal**: Generic inbound webhook receiver with adapter pattern.

**Deliverables**:
1. `WebhookEndpointAdapter` contract and adapter registry (DI)
2. `POST /api/webhooks/inbound/:endpointId` route
3. Rate limiting (using shared `RateLimiterService` from `packages/shared/src/lib/ratelimit/`)
4. Deduplication (messageId-based, cache-backed)
5. Inbound event emission for async processing

**Dependencies**: Phase 1, `packages/shared/src/lib/ratelimit/`

### Phase 4: Integration Marketplace Alignment (Target: 1 week)

**Goal**: Wire the webhooks module as the `webhook_endpoints` hub for SPEC-045.

**Deliverables**:
1. `integration.ts` convention file for hub registration
2. Align delivery logs with `IntegrationLog` from SPEC-045a (dual-write or bridge)
3. Webhook secret storage via `IntegrationCredentials` for marketplace-managed webhooks
4. Marketplace UI integration: webhook endpoints appear in the integrations marketplace

**Dependencies**: Phase 3, SPEC-045a Foundation (must be implemented)

### Phase 5: Advanced UI and Analytics (Target: 1 week)

**Goal**: Polished admin experience with testing, analytics, and MCP tools.

**Deliverables**:
1. Test interface: interactive test panel with event picker and response viewer
2. Analytics dashboard widget: delivery success rate, latency percentiles, failure breakdown
3. MCP AI tools (`ai-tools.ts`): list webhooks, check delivery status, send test
4. Notification types: alert on webhook auto-disabled, alert on delivery exhaustion
5. Search configuration (`search.ts`): fulltext search over webhook names and URLs

**Dependencies**: Phase 2, Phase 3

---

## 11. Integration Test Coverage

### Phase 1 Tests

| Test Case | Path | Description |
|-----------|------|-------------|
| TC-WH-001 | `__integration__/TC-WH-001.spec.ts` | Create webhook via API, verify secret returned, list shows it |
| TC-WH-002 | `__integration__/TC-WH-002.spec.ts` | Emit a domain event, verify delivery record created with correct payload |
| TC-WH-003 | `__integration__/TC-WH-003.spec.ts` | Delivery to healthy endpoint: status=delivered, Standard Webhooks headers present |
| TC-WH-004 | `__integration__/TC-WH-004.spec.ts` | Delivery to failing endpoint: retry attempts increment, backoff applied |
| TC-WH-005 | `__integration__/TC-WH-005.spec.ts` | Wildcard event subscription: `customers.*` receives `customers.people.created` |
| TC-WH-006 | `__integration__/TC-WH-006.spec.ts` | Inactive webhook: events are not dispatched |
| TC-WH-007 | `__integration__/TC-WH-007.spec.ts` | Tenant isolation: webhook from tenant A does not receive events from tenant B |

### Phase 2 Tests

| Test Case | Path | Description |
|-----------|------|-------------|
| TC-WH-008 | `__integration__/TC-WH-008.spec.ts` | Secret rotation: dual-sign during rotation window, old secret still verifies |
| TC-WH-009 | `__integration__/TC-WH-009.spec.ts` | Test delivery: synchronous delivery returns response |
| TC-WH-010 | `__integration__/TC-WH-010.spec.ts` | Manual retry: requeues a failed delivery |
| TC-WH-011 | `__integration__/TC-WH-011.spec.ts` | Auto-disable: webhook disabled after N consecutive failures |
| TC-WH-012 | `__integration__/TC-WH-012.spec.ts` | HTTP 410 response: webhook auto-disabled |
| TC-WH-013 | `__integration__/TC-WH-013.spec.ts` | HTTP 4xx (non-retryable): delivery fails immediately, no retry |

### Phase 3 Tests

| Test Case | Path | Description |
|-----------|------|-------------|
| TC-WH-014 | `__integration__/TC-WH-014.spec.ts` | Inbound webhook: valid signature accepted, event emitted |
| TC-WH-015 | `__integration__/TC-WH-015.spec.ts` | Inbound webhook: invalid signature rejected (400) |
| TC-WH-016 | `__integration__/TC-WH-016.spec.ts` | Inbound webhook: rate limiting (429 after threshold) |
| TC-WH-017 | `__integration__/TC-WH-017.spec.ts` | Inbound webhook: deduplication (same messageId returns 200, no double-emit) |

### Shared Library Tests (Unit)

| Test Case | Path | Description |
|-----------|------|-------------|
| UT-WH-001 | `packages/shared/src/lib/webhooks/__tests__/sign.test.ts` | Signature generation matches Standard Webhooks reference vectors |
| UT-WH-002 | `packages/shared/src/lib/webhooks/__tests__/verify.test.ts` | Signature verification: valid, invalid, expired timestamp, wrong key |
| UT-WH-003 | `packages/shared/src/lib/webhooks/__tests__/secrets.test.ts` | Secret generation, parsing, validation |
| UT-WH-004 | `packages/shared/src/lib/webhooks/__tests__/verify.test.ts` | Dual-key verification: both current and rotated key accepted |

---

## 12. Backward Compatibility Considerations

### No Existing Contracts Modified

This spec introduces only new code:
- New module: `packages/core/src/modules/webhooks/` (no existing module modified)
- New shared library: `packages/shared/src/lib/webhooks/` (no existing library modified)
- New database tables: `webhooks`, `webhook_deliveries` (no existing table modified)
- New event IDs: `webhooks.*` namespace (no existing event modified)
- New API routes: `/api/webhooks/*` (no existing route modified)
- New ACL features: `webhooks.*` (no existing feature modified)

### Event System Compatibility

The wildcard subscriber (`*`) is already supported by the event bus (`matchEventPattern` in `packages/events/src/bus.ts`). No changes to the event bus are required. The subscriber uses the existing persistent event flow.

### Queue System Compatibility

The delivery worker uses the existing `packages/queue` infrastructure. A new queue name (`webhook-deliveries`) is added but does not conflict with existing queues (`events`).

### Integration Marketplace Alignment

The `webhook_endpoints` hub referenced in SPEC-045e is implemented by this module. The `WebhookEndpointAdapter` contract from SPEC-045e is implemented exactly as specified, with no changes to the contract interface.

### SPEC-045e Extraction

The `inbox_ops` module's webhook handler (`packages/core/src/modules/inbox_ops/api/webhook/inbound.ts`) is NOT modified. It continues to function independently. The shared primitives in `packages/shared/src/lib/webhooks/` are offered as an alternative that `inbox_ops` can optionally migrate to in a future PR. No forced migration.

---

## 13. Specs Requiring Updates

| Spec | Section | Change Required |
|------|---------|-----------------|
| **SPEC-045** | Integration Categories table (row: `webhook`) | Add reference to SPEC-057 as the implementation spec |
| **SPEC-045e** | Section 2 (Webhook Endpoints Hub) | Add note: "Full implementation specified in SPEC-057. The `WebhookEndpointAdapter` contract defined here is implemented by the `webhooks` core module." |
| **SPEC-045e** | Section 3 (Implementation Steps / Webhook Endpoints Hub) | Replace with reference to SPEC-057 phases |
| **2026-03-19-checkout-pay-links** | Events / gateway integration / tests | Cross-reference outbound webhook automation for pay-link lifecycle events |

No existing spec contracts are broken. The updates are additive cross-references only.

---

## 14. Risks and Impact Review

### Critical Risks

#### Cross-Tenant Webhook Leakage
- **Scenario**: A bug in the dispatcher causes events from tenant A to be delivered to tenant B's webhook
- **Mitigation**: The dispatcher subscriber filters webhooks by `organizationId` + `tenantId` extracted from the event payload. Webhooks are always queried with tenant scope. Integration tests (TC-WH-007) verify isolation.
- **Residual risk**: Code-level bug; mitigated by integration tests and code review.

### High Risks

#### Webhook Secret Exposure
- **Scenario**: Secret is logged, cached, or returned in API responses beyond creation/rotation
- **Mitigation**: Secrets are encrypted at rest using `findWithDecryption`. API responses mask secrets (`'••••••••'`). Secrets are only returned in plaintext on create and rotate-secret responses. Log service strips secret fields. Never expose via `GET /api/webhooks/:id`.
- **Residual risk**: Developer error logging the raw secret; mitigated by code review conventions.

#### Queue Backpressure from High-Volume Events
- **Scenario**: A tenant subscribes to `*` (all events) with a slow endpoint, causing delivery queue buildup
- **Mitigation**: Per-webhook rate limiting (`rateLimitPerMinute`), auto-disable after consecutive failures, delivery worker concurrency limits, queue monitoring.
- **Residual risk**: Temporary queue buildup before auto-disable kicks in.

### Medium Risks

#### Outbound SSRF
- **Scenario**: Admin configures a webhook URL pointing to internal infrastructure
- **Mitigation**: Phase 2 adds URL validation (block private IPs, loopback, link-local). Delivery worker runs with network egress filtering when deployed in production. Configurable URL allowlist/blocklist.
- **Residual risk**: Internal IPs not covered by standard private range filters.

#### Delivery Log Storage Growth
- **Scenario**: High-volume webhooks generate millions of delivery records
- **Mitigation**: Phase 2 adds a cleanup worker that purges deliveries older than configurable retention (default: 30 days). Indices on `(webhook_id, created_at)` keep queries fast.
- **Residual risk**: Storage spike between cleanup cycles.

### Low Risks

#### Event Bus Performance Impact
- **Scenario**: Wildcard subscriber adds latency to every event emission
- **Mitigation**: The subscriber is persistent, so it runs asynchronously via the queue worker, not inline. The only inline cost is the event bus matching the `*` pattern, which is O(1).

---

## 15. Changelog

| Date | Change |
|------|--------|
| 2026-03-04 | Initial draft |
| 2026-03-18 | Phase 1 implemented: core outbound webhooks |
| 2026-03-18 | Packaging, queue dispatch, retries, migration, inbound/events/test/retry APIs, and locale coverage completed for shippable rollout |
| 2026-03-19 | Added pay-links alignment note: outbound webhooks must support checkout lifecycle automation through stable post-commit events |

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Core Outbound | Done | 2026-03-18 | Export/build packaging, queue-backed retries, migration, i18n, and detail API/UI are now shippable |
| Phase 2 — Advanced Delivery | Partial | 2026-03-18 | Secret rotation, test delivery, and manual retry implemented; non-HTTP strategies remain deferred |
| Phase 3 — Inbound Webhooks | Partial | 2026-03-18 | Adapter registry and generic inbound receiver implemented; provider-specific adapters remain pending |
| Phase 4 — Integration Marketplace | Partial | 2026-03-18 | `webhook_endpoints` hub registration added; deeper marketplace credential flows remain pending |
| Phase 5 — Advanced UI & Analytics | Not Started | — | Analytics, MCP tools, notifications |

### Phase 1 — Detailed Progress
- [x] Step 1: Shared webhook primitives (`packages/shared/src/lib/webhooks/`) — sign, verify, secrets + 18 unit tests
- [x] Step 2: Package scaffold (`packages/webhooks/`) — npm workspace package with build config
- [x] Step 3: Module foundation — index.ts, acl.ts, setup.ts, events.ts
- [x] Step 4: MikroORM entities — `WebhookEntity`, `WebhookDeliveryEntity` with indexes
- [x] Step 5: Zod validators — create, update, list query, delivery query schemas
- [x] Step 6: CRUD API routes — webhooks (GET/POST/PUT/DELETE) + deliveries (GET) with OpenAPI
- [x] Step 7: Wildcard event subscriber — persistent `*` subscriber with event pattern matching
- [x] Step 8: Delivery queue worker — HTTP delivery with Standard Webhooks headers, exponential backoff, auto-disable
- [x] Step 9: i18n locale files — English translations with baseline `pl`/`es`/`de` coverage
- [x] Step 10: Backend UI — list page, create form (CrudForm), detail page with delivery log DataTable
- [x] Step 11: Available events API (`GET /api/webhooks/events`)
- [x] Step 12: Database migration — scoped migration committed for `webhooks` and `webhook_deliveries`

### Implementation Notes
- Module lives in `packages/webhooks/` (dedicated npm workspace package) rather than `packages/core/src/modules/webhooks/` per the integration package convention
- Enabled in `apps/mercato/src/modules.ts` as `{ id: 'webhooks', from: '@open-mercato/webhooks' }`
- Delivery strategy limited to `http` in Phase 1; `sqs`/`sns` deferred to Phase 2
