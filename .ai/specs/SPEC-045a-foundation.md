# SPEC-045a — Foundation: Registry, Credentials, Operation Logs & Admin Panel

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 1 of 6

---

## Goal

Build the `integrations` core module — the foundation layer that all integration categories and providers depend on. Delivers three shared mechanisms (registry, credentials, operation logs) and the marketplace admin panel.

---

## 1. Integration Registry

### 1.1 The `integration.ts` Convention File

Every module that is an integration declares `integration.ts` at its root. Auto-discovered during `yarn generate`.

```typescript
// Example: gateway_stripe/integration.ts

import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  description: 'Accept card payments, Apple Pay, and Google Pay via Stripe Checkout.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  icon: 'stripe',
  docsUrl: 'https://docs.stripe.com',
  package: '@open-mercato/gateway-stripe',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  tags: ['cards', 'apple-pay', 'google-pay', 'checkout'],
  credentials: {
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', type: 'text', required: true },
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'secret', required: true },
      { key: 'captureMethod', label: 'Capture Method', type: 'select', options: [
        { value: 'automatic', label: 'Automatic' },
        { value: 'manual', label: 'Manual (authorize then capture)' },
      ]},
      { key: 'enableApplePay', label: 'Enable Apple Pay', type: 'boolean' },
    ],
  },
  healthCheck: { service: 'stripeHealthCheck' },
}
```

### 1.2 Integration Bundles

A single npm package can contribute **multiple integrations** across different categories. This is the "one-click installer" pattern for platform connectors like MedusaJS, Shopify, or Magento.

#### How It Works

A bundle is a regular Open Mercato module that declares **multiple** `IntegrationDefinition` entries via a `integration.ts` that exports an array:

```typescript
// sync_medusa/integration.ts — BUNDLE MODULE

import type { IntegrationDefinition, IntegrationBundle } from '@open-mercato/shared/modules/integrations'

export const bundle: IntegrationBundle = {
  id: 'sync_medusa',
  title: 'MedusaJS',
  description: 'Full bidirectional sync with MedusaJS — products, customers, orders, and inventory.',
  icon: 'medusa',
  package: '@open-mercato/sync-medusa',
  version: '1.0.0',
  author: 'Open Mercato Team',

  /** Shared credentials — one API key/URL configures the whole bundle */
  credentials: {
    fields: [
      { key: 'medusaApiUrl', label: 'Medusa API URL', type: 'url', required: true, placeholder: 'https://api.mystore.com' },
      { key: 'medusaApiKey', label: 'API Key', type: 'secret', required: true },
      { key: 'medusaWebhookSecret', label: 'Webhook Secret', type: 'secret', required: true },
    ],
  },

  healthCheck: { service: 'medusaHealthCheck' },
}

/** Individual integrations within the bundle */
export const integrations: IntegrationDefinition[] = [
  {
    id: 'sync_medusa_products',
    title: 'MedusaJS — Products',
    description: 'Sync products, variants, and pricing from MedusaJS.',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'medusa_products',
    bundleId: 'sync_medusa',  // ← Links to parent bundle
    tags: ['products', 'catalog', 'variants', 'pricing'],
    credentials: { fields: [] },  // Inherits from bundle
  },
  {
    id: 'sync_medusa_customers',
    title: 'MedusaJS — Customers',
    description: 'Sync customer accounts and addresses from MedusaJS.',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'medusa_customers',
    bundleId: 'sync_medusa',
    tags: ['customers', 'addresses', 'accounts'],
    credentials: { fields: [] },
  },
  {
    id: 'sync_medusa_orders',
    title: 'MedusaJS — Orders',
    description: 'Import orders from MedusaJS and export order status updates back.',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'medusa_orders',
    bundleId: 'sync_medusa',
    tags: ['orders', 'fulfillment', 'status-sync'],
    credentials: { fields: [] },
  },
  {
    id: 'sync_medusa_inventory',
    title: 'MedusaJS — Inventory',
    description: 'Bidirectional inventory level synchronization with MedusaJS.',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'medusa_inventory',
    bundleId: 'sync_medusa',
    tags: ['inventory', 'stock', 'warehouses'],
    credentials: { fields: [] },
  },
  {
    id: 'sync_medusa_webhooks',
    title: 'MedusaJS — Webhooks',
    description: 'Receive real-time updates from MedusaJS via webhooks.',
    category: 'webhook',
    hub: 'webhook_endpoints',
    providerKey: 'medusa_webhooks',
    bundleId: 'sync_medusa',
    tags: ['webhooks', 'real-time', 'events'],
    credentials: { fields: [] },
  },
]
```

#### Bundle Types

```typescript
// @open-mercato/shared/modules/integrations/types.ts (additions)

interface IntegrationBundle {
  id: string
  title: string
  description: string
  icon?: string
  package?: string
  version?: string
  author?: string
  credentials: IntegrationCredentialsSchema
  healthCheck?: IntegrationHealthCheckConfig
}

interface IntegrationDefinition {
  // ... existing fields ...

  /** If this integration belongs to a bundle, the bundle ID */
  bundleId?: string
}
```

#### Bundle UX in Admin Panel

Bundles appear as **grouped cards** in the marketplace:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Integrations                                          [Search...] │
│                                                                     │
│  Categories: [All] [Payment] [Shipping] [Data Sync] [...]          │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  [MedusaJS Icon]  MedusaJS                   [Enable All]     │ │
│  │  Full bidirectional sync — 5 integrations                     │ │
│  │  @open-mercato/sync-medusa v1.0.0                             │ │
│  │                                                                │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │ │
│  │  │ Products    │ │ Customers   │ │ Orders      │             │ │
│  │  │ ● Enabled   │ │ ● Enabled   │ │ ○ Disabled  │             │ │
│  │  │ Data Sync   │ │ Data Sync   │ │ Data Sync   │             │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘             │ │
│  │  ┌─────────────┐ ┌─────────────┐                             │ │
│  │  │ Inventory   │ │ Webhooks    │                             │ │
│  │  │ ● Enabled   │ │ ● Enabled   │                             │ │
│  │  │ Data Sync   │ │ Webhook     │                             │ │
│  │  └─────────────┘ └─────────────┘                             │ │
│  │                                                                │ │
│  │  [Configure Bundle]                                           │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐                               │
│  │  [Stripe]    │  │  [DHL]       │     ← standalone integrations │
│  │  Payment     │  │  Shipping    │                               │
│  └──────────────┘  └──────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Bundle detail page** at `/backend/integrations/bundle/sync_medusa`:
- Single credentials form (shared across all integrations in the bundle)
- Per-integration enable/disable toggles
- "Enable All" / "Disable All" bulk actions
- Health check runs against the shared credentials
- Links to individual integration detail pages for sync configuration

#### Auto-Discovery for Bundles

The `yarn generate` scanner detects both export shapes:

```typescript
// Generated — integrations.ts
import { integration as gatewayStripe } from '.../gateway_stripe/integration'
import { bundle as syncMedusaBundle, integrations as syncMedusaIntegrations } from '.../sync_medusa/integration'

export const integrations = [gatewayStripe, ...syncMedusaIntegrations] as const
export const bundles = [syncMedusaBundle] as const
```

The registry indexes both standalone integrations and bundles. When a bundled integration's credentials are requested, the credentials service falls through to the bundle's credentials.

---

## 2. Credentials API

### 2.1 IntegrationCredentials Entity

```typescript
@Entity({ tableName: 'integration_credentials' })
export class IntegrationCredentials extends BaseEntity {
  @Property()
  integrationId!: string  // Integration or bundle ID

  @Property({ type: 'jsonb' })
  values!: Record<string, unknown>  // Encrypted at rest

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

### 2.2 Credentials Service

```typescript
export function createCredentialsService({ em }: Dependencies) {
  return {
    async resolve(integrationId: string, scope: TenantScope): Promise<Record<string, unknown>> {
      // 1. Try integration-level credentials first
      let record = await findOneWithDecryption(em, 'IntegrationCredentials', {
        integrationId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

      // 2. Fall through to bundle credentials if this integration has a bundleId
      if (!record) {
        const definition = getIntegration(integrationId)
        if (definition?.bundleId) {
          record = await findOneWithDecryption(em, 'IntegrationCredentials', {
            integrationId: definition.bundleId,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
          })
        }
      }

      return record?.values ?? {}
    },

    async save(integrationId: string, values: Record<string, unknown>, scope: TenantScope): Promise<void> {
      // Upsert pattern — validate against field schema, encrypt, persist
    },

    async readMasked(integrationId: string, scope: TenantScope): Promise<Record<string, unknown>> {
      // Returns values with type:'secret' fields replaced by '••••••••'
    },

    async remove(integrationId: string, scope: TenantScope): Promise<void> {
      // Hard delete
    },
  }
}
```

### 2.3 Credential Fallthrough for Bundles

When `sync_medusa_products` adapter calls `integrationCredentials.resolve('sync_medusa_products', scope)`:

1. Looks for `IntegrationCredentials` where `integrationId = 'sync_medusa_products'` — not found (credentials are on the bundle)
2. Checks `IntegrationDefinition.bundleId = 'sync_medusa'`
3. Looks for `IntegrationCredentials` where `integrationId = 'sync_medusa'` — found, returns decrypted values

This means: **one credential form on the bundle → all child integrations share it**.

---

## 3. Operation Logs — Shared Logging Mechanism

### 3.1 Problem

Every integration needs to log operations: sync runs, webhook deliveries, API call errors, import/export progress. Without a shared mechanism, each hub module invents its own logging table and UI, creating inconsistency and duplicated effort.

### 3.2 Design

The `integrations` core module provides a shared `IntegrationLog` entity and a `logService` available via DI. Any integration can write structured log entries. The admin panel renders logs per-integration in a consistent timeline view.

### 3.3 IntegrationLog Entity

```typescript
@Entity({ tableName: 'integration_logs' })
export class IntegrationLog extends BaseEntity {
  @Property()
  integrationId!: string  // e.g., 'sync_medusa_products', 'gateway_stripe'

  @Property({ length: 50 })
  level!: 'info' | 'warning' | 'error' | 'debug'

  @Property({ length: 100 })
  operation!: string  // e.g., 'sync.import', 'webhook.received', 'health.check', 'session.created'

  @Property()
  message!: string  // Human-readable summary

  @Property({ type: 'jsonb', nullable: true })
  details?: Record<string, unknown>  // Structured context (request IDs, entity counts, error stacks)

  @Property({ nullable: true })
  correlationId?: string  // Groups related log entries (e.g., a single sync run)

  @Property({ nullable: true })
  entityType?: string  // e.g., 'catalog.product', 'customers.person'

  @Property({ nullable: true })
  entityId?: string  // Affected entity ID

  @Property({ nullable: true })
  durationMs?: number  // Operation duration

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string
}
```

### 3.4 Log Service (DI)

```typescript
// integrations/lib/log-service.ts

export function createIntegrationLogService({ em }: Dependencies) {
  return {
    /** Write a single log entry */
    async log(entry: {
      integrationId: string
      level: 'info' | 'warning' | 'error' | 'debug'
      operation: string
      message: string
      details?: Record<string, unknown>
      correlationId?: string
      entityType?: string
      entityId?: string
      durationMs?: number
      scope: TenantScope
    }): Promise<void> {
      em.create(IntegrationLog, {
        integrationId: entry.integrationId,
        level: entry.level,
        operation: entry.operation,
        message: entry.message,
        details: entry.details,
        correlationId: entry.correlationId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        durationMs: entry.durationMs,
        organizationId: entry.scope.organizationId,
        tenantId: entry.scope.tenantId,
      })
      await em.flush()
    },

    /** Create a scoped logger for a specific integration + correlation */
    scoped(integrationId: string, correlationId: string, scope: TenantScope) {
      return {
        info: (operation: string, message: string, details?: Record<string, unknown>) =>
          this.log({ integrationId, level: 'info', operation, message, details, correlationId, scope }),
        warning: (operation: string, message: string, details?: Record<string, unknown>) =>
          this.log({ integrationId, level: 'warning', operation, message, details, correlationId, scope }),
        error: (operation: string, message: string, details?: Record<string, unknown>) =>
          this.log({ integrationId, level: 'error', operation, message, details, correlationId, scope }),
        debug: (operation: string, message: string, details?: Record<string, unknown>) =>
          this.log({ integrationId, level: 'debug', operation, message, details, correlationId, scope }),
      }
    },

    /** Query logs for an integration (paginated, filterable) */
    async query(filters: {
      integrationId: string
      scope: TenantScope
      level?: string
      operation?: string
      correlationId?: string
      since?: Date
      limit?: number
      offset?: number
    }): Promise<{ items: IntegrationLog[]; total: number }> {
      // Builds MikroORM query with filters, ordered by createdAt DESC
    },

    /** Cleanup old logs (retention policy) */
    async prune(integrationId: string, scope: TenantScope, olderThan: Date): Promise<number> {
      // Deletes logs older than retention period, returns count
    },
  }
}
```

### 3.5 Usage Example — Payment Gateway Webhook

```typescript
// payment_gateways/workers/webhook-processor.ts

export default async function handler(job: Job, ctx: WorkerContext) {
  const { providerKey, event, tenantContext } = job.data
  const log = ctx.integrationLog.scoped(`gateway_${providerKey}`, event.idempotencyKey, tenantContext)

  await log.info('webhook.received', `Received ${event.eventType} from ${providerKey}`)

  try {
    const newStatus = adapter.mapStatus(event.data.status, event.eventType)
    await syncPaymentStatus(transaction.paymentId, newStatus, ...)
    await log.info('webhook.processed', `Payment ${transaction.paymentId} → ${newStatus}`, {
      paymentId: transaction.paymentId,
      previousStatus: transaction.unifiedStatus,
      newStatus,
    })
  } catch (err) {
    await log.error('webhook.failed', `Failed to process ${event.eventType}: ${err.message}`, {
      error: err.message,
      stack: err.stack,
      eventData: event.data,
    })
    throw err  // Let worker retry
  }
}
```

### 3.6 Usage Example — Data Sync Import

```typescript
// sync_medusa/workers/product-import.ts

export default async function handler(job: Job, ctx: WorkerContext) {
  const { syncRunId, cursor } = job.data
  const log = ctx.integrationLog.scoped('sync_medusa_products', syncRunId, tenantContext)

  await log.info('sync.import.started', 'Starting product import from MedusaJS', { cursor })

  let imported = 0, skipped = 0, failed = 0

  for await (const batch of streamProducts(credentials, cursor)) {
    for (const product of batch.items) {
      try {
        await upsertProduct(product, ctx)
        imported++
      } catch (err) {
        failed++
        await log.error('sync.import.item_failed', `Failed to import product ${product.id}`, {
          productId: product.id,
          error: err.message,
          entityType: 'catalog.product',
          entityId: product.id,
        })
      }
    }
    await log.info('sync.import.batch', `Processed batch: ${imported} imported, ${skipped} skipped, ${failed} failed`, {
      imported, skipped, failed, cursor: batch.nextCursor,
    })
  }

  await log.info('sync.import.completed', `Import complete: ${imported} imported, ${failed} failed`, {
    imported, skipped, failed, durationMs: Date.now() - startedAt,
  })
}
```

### 3.7 Log UI in Admin Panel

The integration detail page includes a **Logs** tab:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                             │
│                                                                     │
│  [Stripe Icon]  Stripe                           [Enabled ●]       │
│                                                                     │
│  [Credentials] [Health] [Logs]                                      │
│                                                                     │
│  ── Logs ─────────────────────────────────── [Level: All ▾] [🔍]  │
│                                                                     │
│  ❌ 14:23:05  webhook.failed                                       │
│     Failed to process payment_intent.succeeded: Timeout             │
│     Correlation: evt_1234  •  Duration: 5200ms                     │
│     ▸ Details                                                       │
│                                                                     │
│  ✅ 14:22:58  webhook.processed                                    │
│     Payment pay_abc → captured                                      │
│     Correlation: evt_1233  •  Duration: 340ms                      │
│                                                                     │
│  ✅ 14:22:55  webhook.received                                     │
│     Received payment_intent.succeeded from stripe                  │
│     Correlation: evt_1233                                          │
│                                                                     │
│  ── Showing 25 of 1,240 entries ────── [← Prev] [Next →]          │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.8 Log Retention

- Default retention: 30 days (configurable per tenant via settings)
- Pruning runs as a scheduled worker (`integration-log-pruner`)
- Error-level logs retained longer (90 days) for debugging
- Logs are NOT encrypted (they must not contain secrets — the log service strips any field matching `type: 'secret'` from details)

---

## 4. IntegrationState Entity

```typescript
@Entity({ tableName: 'integration_states' })
export class IntegrationState extends BaseEntity {
  @Property()
  integrationId!: string

  @Property({ default: false })
  isEnabled!: boolean

  @Property({ type: 'jsonb', nullable: true })
  lastHealthCheck?: HealthCheckResult

  @Property({ nullable: true })
  lastHealthCheckAt?: Date

  @Property({ nullable: true })
  enabledAt?: Date

  @Property({ nullable: true })
  enabledBy?: string  // User ID

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

---

## 5. Core Module Structure

```
packages/core/src/modules/integrations/
├── index.ts                           # Module metadata
├── acl.ts                             # integrations.view, .manage, .credentials
├── di.ts                              # Registry, credentials, state, log, health services
├── events.ts                          # Lifecycle events
├── setup.ts                           # Default role features
├── lib/
│   ├── registry.ts                    # Reads generated integrations + bundles
│   ├── credentials-service.ts         # CRUD + encryption + bundle fallthrough
│   ├── state-service.ts               # Enable/disable per tenant
│   ├── log-service.ts                 # Structured operation logging
│   └── health-service.ts              # Health check orchestration
├── data/
│   ├── entities.ts                    # IntegrationCredentials, IntegrationState, IntegrationLog
│   └── validators.ts                  # Zod schemas
├── api/
│   ├── get/integrations.ts            # List integrations + bundles
│   ├── get/integrations/[id].ts       # Detail + state + health
│   ├── put/integrations/[id]/state.ts # Enable/disable
│   ├── get/integrations/[id]/credentials.ts
│   ├── put/integrations/[id]/credentials.ts
│   ├── post/integrations/[id]/health.ts
│   ├── delete/integrations/[id]/credentials.ts
│   └── get/integrations/[id]/logs.ts  # Query operation logs
├── workers/
│   └── log-pruner.ts                  # Scheduled retention cleanup
├── backend/
│   ├── page.tsx                       # /backend/integrations — marketplace
│   └── integrations/
│       ├── [id]/page.tsx              # Detail/config page
│       └── bundle/[id]/page.tsx       # Bundle config page
└── i18n/
    ├── en.ts
    └── pl.ts
```

---

## 6. API Contracts

### 6.1 List Integrations

```
GET /api/integrations?category=data_sync&search=medusa&bundleId=sync_medusa

→ 200: {
  items: [...],
  bundles: [
    { id: 'sync_medusa', title: 'MedusaJS', integrationCount: 5, enabledCount: 4, ... }
  ]
}
```

### 6.2 Query Logs

```
GET /api/integrations/gateway_stripe/logs?level=error&since=2026-02-24T00:00:00Z&limit=50

→ 200: {
  items: [
    { id: '...', level: 'error', operation: 'webhook.failed', message: '...', createdAt: '...', ... }
  ],
  total: 42,
}
```

All other API contracts remain as defined in the main SPEC-045.

---

## 7. Events

```typescript
export const eventsConfig = createModuleEvents('integrations', [
  { id: 'integrations.integration.enabled', label: 'Integration Enabled', entity: 'integration', category: 'lifecycle' },
  { id: 'integrations.integration.disabled', label: 'Integration Disabled', entity: 'integration', category: 'lifecycle' },
  { id: 'integrations.credentials.updated', label: 'Credentials Updated', entity: 'credential', category: 'lifecycle' },
  { id: 'integrations.credentials.removed', label: 'Credentials Removed', entity: 'credential', category: 'lifecycle' },
  { id: 'integrations.health.checked', label: 'Health Check Completed', entity: 'health', category: 'system' },
  { id: 'integrations.bundle.enabled', label: 'Bundle Enabled', entity: 'bundle', category: 'lifecycle' },
  { id: 'integrations.bundle.disabled', label: 'Bundle Disabled', entity: 'bundle', category: 'lifecycle' },
] as const)
```

---

## 8. Implementation Steps

1. Create `@open-mercato/shared/modules/integrations/types.ts` — all shared types including `IntegrationBundle`
2. Add `integration.ts` to CLI module auto-discovery scanner (support both single `export const integration` and array `export const integrations` + `export const bundle`)
3. Create `integrations` module skeleton: `index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `events.ts`
4. Create entities: `IntegrationCredentials`, `IntegrationState`, `IntegrationLog`
5. Implement `registry.ts` with bundle resolution
6. Implement `credentials-service.ts` with bundle credential fallthrough
7. Implement `state-service.ts`
8. Implement `log-service.ts` with scoped logger pattern
9. Create all API routes (including logs query endpoint)
10. Build marketplace admin page at `/backend/integrations` with bundle grouping
11. Build integration detail page with Credentials / Health / Logs tabs
12. Build bundle detail page with per-integration toggles
13. Create `log-pruner` scheduled worker
14. Run `yarn db:generate` for migrations
15. Integration tests: credentials CRUD, bundle fallthrough, state toggle, logs query, log pruning, API security, cross-tenant isolation
