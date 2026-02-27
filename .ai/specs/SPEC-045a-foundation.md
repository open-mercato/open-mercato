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

  /** External API versions this integration supports (omit for unversioned integrations) */
  apiVersions?: ApiVersionDefinition[]
}

/** Declares one supported external API version for an integration */
interface ApiVersionDefinition {
  /** Version identifier — matches the external API version (e.g., '2024-12-18', 'v2', '3.1') */
  id: string
  /** Human-readable label shown in the admin UI (e.g., 'v2024-12-18 (latest)') */
  label: string
  /** Lifecycle status: stable = production ready, deprecated = still works but will be removed, experimental = opt-in preview */
  status: 'stable' | 'deprecated' | 'experimental'
  /** If true, this is the default version for new tenants. Exactly one must be default. */
  default?: boolean
  /** Short description of what changed in this version */
  changelog?: string
  /** ISO date when this version was deprecated (required when status = 'deprecated') */
  deprecatedAt?: string
  /** ISO date after which this version will be removed (required when status = 'deprecated') */
  sunsetAt?: string
  /** URL to migration guide from this version to the next stable (only for deprecated versions) */
  migrationGuide?: string
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

### 1.3 API Versioning

External APIs evolve — Stripe releases dated API versions, PayU moves from v2_1 to v3, MedusaJS ships v2 with a different schema. A single integration module can ship **multiple adapter implementations**, one per external API version. Tenants pick which version to use — they upgrade on their own schedule, not when the module author pushes an update.

#### Design Goals

| Goal | How |
|------|-----|
| **Zero overhead for simple integrations** | `apiVersions` is optional. Omit it → unversioned, no version picker in UI |
| **Easy for developers** | One adapter file per version. Share common logic in `lib/shared.ts` |
| **Easy for admins** | Dropdown on the integration detail page. Deprecation warnings with sunset dates |
| **Safe upgrades** | Admin changes version explicitly. No auto-upgrade. Rollback by selecting the previous version |
| **Transparent resolution** | Hub adapter registries resolve the tenant's version automatically |

#### Developer DX — Declaring Versions

Add `apiVersions` to `integration.ts`. Each version maps to a separate adapter implementation:

```typescript
// gateway_stripe/integration.ts

export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  apiVersions: [
    {
      id: '2024-12-18',
      label: 'v2024-12-18 (latest)',
      status: 'stable',
      default: true,
      changelog: 'Payment Intents v2, improved error codes, enhanced refund metadata',
    },
    {
      id: '2023-10-16',
      label: 'v2023-10-16',
      status: 'deprecated',
      deprecatedAt: '2025-06-01',
      sunsetAt: '2026-12-01',
      migrationGuide: 'https://docs.stripe.com/upgrades#2024-12-18',
      changelog: 'Legacy Payment Intents API',
    },
  ],
  credentials: { /* ... */ },
}
```

The module registers one adapter per version during setup:

```typescript
// gateway_stripe/setup.ts

import { stripeAdapterV20241218 } from './lib/adapters/v2024-12-18'
import { stripeAdapterV20231016 } from './lib/adapters/v2023-10-16'

export const setup: ModuleSetupConfig = {
  async onTenantCreated() {
    // Register versioned adapters — the registry indexes by providerKey + version
    registerGatewayAdapter(stripeAdapterV20241218, { version: '2024-12-18' })
    registerGatewayAdapter(stripeAdapterV20231016, { version: '2023-10-16' })

    registerPaymentProvider({ key: 'stripe', label: 'Stripe', /* ... */ })
  },
}
```

Module file structure with versioned adapters:

```
gateway_stripe/
├── integration.ts              # Declares apiVersions
├── setup.ts                    # Registers adapters per version
├── lib/
│   ├── shared.ts               # Common logic across versions (status maps, helpers)
│   └── adapters/
│       ├── v2024-12-18.ts      # GatewayAdapter for Stripe API 2024-12-18
│       └── v2023-10-16.ts      # GatewayAdapter for Stripe API 2023-10-16
└── i18n/
    ├── en.ts
    └── pl.ts
```

Shared logic (status maps, response parsing, credential loading) lives in `lib/shared.ts` so versioned adapters stay thin — they only override what changed between API versions.

#### Version-Aware Adapter Registration

Hub adapter registries (e.g., `payment_gateways/lib/adapter-registry.ts`) support an optional `version` parameter. The framework provides this as a shared pattern:

```typescript
// Shared pattern used by all hub adapter registries

type AdapterMap<T> = Map<string, T>  // key = 'providerKey' or 'providerKey:version'

function registerAdapter<T extends { providerKey: string }>(
  adapters: AdapterMap<T>,
  adapter: T,
  options?: { version?: string },
): void {
  if (options?.version) {
    adapters.set(`${adapter.providerKey}:${options.version}`, adapter)
  }
  // Always register as the unversioned fallback if no unversioned entry exists,
  // or if this is the default version
  if (!options?.version || isDefaultVersion(adapter.providerKey, options.version)) {
    adapters.set(adapter.providerKey, adapter)
  }
}

function getAdapter<T>(
  adapters: AdapterMap<T>,
  providerKey: string,
  version?: string,
): T | undefined {
  if (version) {
    return adapters.get(`${providerKey}:${version}`) ?? adapters.get(providerKey)
  }
  return adapters.get(providerKey)
}
```

When a hub resolves an adapter, it reads the tenant's selected version from `IntegrationState.apiVersion` and passes it to `getAdapter()`. If the tenant hasn't selected a version (null), the default (unversioned) entry is returned.

#### Version Selection — Per Tenant

The tenant's selected API version is stored in `IntegrationState.apiVersion`. The state service resolves it:

```typescript
// integrations/lib/state-service.ts (addition)

async resolveApiVersion(integrationId: string, scope: TenantScope): Promise<string | undefined> {
  const state = await findOneWithDecryption(em, 'IntegrationState', {
    integrationId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  // Return the explicitly selected version, or undefined (= use default)
  return state?.apiVersion ?? undefined
}
```

Hub services resolve the version transparently:

```typescript
// payment_gateways/lib/gateway-service.ts (version-aware resolution)

async createPaymentSession(input) {
  const method = await loadPaymentMethod(input.paymentMethodId)
  const version = await integrationState.resolveApiVersion(
    `gateway_${method.providerKey}`,
    { organizationId: input.organizationId, tenantId: input.tenantId },
  )
  const adapter = getGatewayAdapter(method.providerKey, version)
  // ... rest of the flow
}
```

#### Admin UI — Version Picker

For integrations with `apiVersions`, the detail page shows a **Version** tab:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                             │
│                                                                     │
│  [Stripe Icon]  Stripe                           [Enabled ●]       │
│                                                                     │
│  [Credentials] [Version] [Health] [Logs]                            │
│                                                                     │
│  ── API Version ─────────────────────────────────────────────────── │
│                                                                     │
│  Select which Stripe API version to use for this tenant.            │
│  Changing the version takes effect immediately for new operations.  │
│  In-flight payments continue using the version they started with.   │
│                                                                     │
│  Current: [v2024-12-18 (latest) ▾]                                 │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ● v2024-12-18 (latest)              Stable                │    │
│  │    Payment Intents v2, improved error codes                 │    │
│  │                                                             │    │
│  │  ○ v2023-10-16                       ⚠ Deprecated          │    │
│  │    Legacy Payment Intents API                               │    │
│  │    Sunset: Dec 2026 · Migration guide ↗                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│                                                    [Save Version]   │
└─────────────────────────────────────────────────────────────────────┘
```

**Behavior rules:**
- Integrations **without** `apiVersions` → no Version tab is shown
- Selecting a deprecated version shows an inline warning
- The "experimental" status shows a "Preview — may change without notice" badge
- "Save Version" calls `PUT /api/integrations/:id/version` and emits `integrations.version.changed`
- The marketplace list page shows a deprecation badge next to integrations where the tenant is on a deprecated version

#### Version API

```
PUT /api/integrations/gateway_stripe/version
Authorization: Bearer <token>

{ "apiVersion": "2024-12-18" }

→ 200: { "apiVersion": "2024-12-18", "previousVersion": "2023-10-16" }
```

Validates that the version ID exists in the integration's `apiVersions` array. Rejects unknown version IDs with 422.

#### Deprecation Notifications

When the system detects a tenant using a deprecated version approaching its sunset date, it can emit a notification (via the notifications module) to prompt the admin to upgrade. The check runs as part of the health check worker:

```typescript
// Inline in health check worker — no separate scheduled job

const definition = getIntegration(integrationId)
const state = await getIntegrationState(integrationId, scope)
if (definition?.apiVersions && state?.apiVersion) {
  const versionDef = definition.apiVersions.find(v => v.id === state.apiVersion)
  if (versionDef?.status === 'deprecated' && versionDef.sunsetAt) {
    const daysUntilSunset = daysBetween(new Date(), new Date(versionDef.sunsetAt))
    if (daysUntilSunset <= 90) {
      // Emit notification to admins
      await emitEvent('integrations.version.sunset_approaching', {
        integrationId,
        version: state.apiVersion,
        sunsetAt: versionDef.sunsetAt,
        daysRemaining: daysUntilSunset,
        migrationGuide: versionDef.migrationGuide,
      })
    }
  }
}
```

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
│  [Credentials] [Version] [Health] [Logs]                             │
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

  /** Selected external API version (null = default version from integration definition) */
  @Property({ nullable: true, length: 50 })
  apiVersion?: string

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
│   ├── get/integrations/[id].ts       # Detail + state + health + version info
│   ├── put/integrations/[id]/state.ts # Enable/disable
│   ├── put/integrations/[id]/version.ts # Select API version (§1.3)
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

### 6.2 Get Integration Detail (includes version info)

```
GET /api/integrations/gateway_stripe

→ 200: {
  id: 'gateway_stripe',
  title: 'Stripe',
  category: 'payment',
  apiVersions: [
    { id: '2024-12-18', label: 'v2024-12-18 (latest)', status: 'stable', default: true, changelog: '...' },
    { id: '2023-10-16', label: 'v2023-10-16', status: 'deprecated', sunsetAt: '2026-12-01', migrationGuide: '...' },
  ],
  state: {
    isEnabled: true,
    apiVersion: '2024-12-18',  // Tenant's selected version (null if using default)
  },
  ...
}
```

### 6.3 Change API Version

```
PUT /api/integrations/gateway_stripe/version
Authorization: Bearer <token>

{ "apiVersion": "2024-12-18" }

→ 200: { "apiVersion": "2024-12-18", "previousVersion": "2023-10-16" }
→ 422: { "error": "Unknown API version '2025-01-01'" }
```

### 6.4 Query Logs

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
  { id: 'integrations.version.changed', label: 'API Version Changed', entity: 'version', category: 'lifecycle' },
  { id: 'integrations.version.sunset_approaching', label: 'API Version Sunset Approaching', entity: 'version', category: 'system' },
] as const)
```

---

## 8. OAuth 2.0 Credential Type — Third-Party App Authentication

### 8.1 Problem

Many integrations (Google Workspace, Microsoft 365, GitHub, Slack, Shopify) require OAuth 2.0 authorization — the admin grants access via a consent screen, the platform receives tokens, and those tokens must be stored, refreshed, and monitored. The current credential fields (`text`, `secret`, `select`, `boolean`, `url`) only cover static API keys. There is no flow for:

- Redirecting the admin to an OAuth consent screen
- Exchanging an authorization code for tokens
- Storing access + refresh tokens (encrypted, per-tenant, per-integration)
- Background token renewal before expiry
- Re-authentication when refresh tokens expire or are revoked
- Scope management (incremental consent)

### 8.2 Solution — `oauth` Credential Field Type

Extend the credential field schema with a new `type: 'oauth'` field. When the admin panel renders this field, it shows a "Connect" button instead of a text input. Clicking it starts the OAuth authorization code flow.

#### Extended Credential Field Types

```typescript
// @open-mercato/shared/modules/integrations/types.ts (additions)

interface CredentialFieldOAuth {
  key: string
  label: string
  type: 'oauth'
  required: true
  oauth: OAuthConfig
}

interface OAuthConfig {
  /** OAuth provider identifier — used for callback routing */
  provider: string  // e.g., 'google', 'microsoft', 'github', 'slack'

  /** Authorization endpoint URL — string or template function that receives other credential field values.
   *  Use a function when the URL contains tenant-specific parts (e.g., BambooHR: `{company}.bamboohr.com`).
   *  Example: `(fields) => \`https://${fields.subdomain}.bamboohr.com/authorize.php\``
   */
  authorizationUrl: string | ((fields: Record<string, string>) => string)

  /** Token endpoint URL — string or template function (same pattern as authorizationUrl) */
  tokenUrl: string | ((fields: Record<string, string>) => string)

  /** Scopes to request during authorization */
  scopes: string[]

  /** Optional: additional authorization parameters */
  authParams?: Record<string, string>

  /** Whether to use PKCE (recommended for all public clients, optional for confidential) */
  usePkce?: boolean

  /** Token refresh strategy */
  refreshStrategy: 'background' | 'on-demand'

  /** Minutes before expiry to trigger background refresh (default: 5) */
  refreshBeforeExpiryMinutes?: number
}

/** Stored after OAuth flow completes — inside IntegrationCredentials.values */
interface OAuthTokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt?: string       // ISO 8601 timestamp
  tokenType: string        // 'Bearer'
  scope?: string           // Granted scopes (may differ from requested)
  idToken?: string         // OIDC id_token (if applicable)
  rawResponse?: Record<string, unknown>  // Full token response for provider-specific fields
}

type CredentialField =
  | { key: string; label: string; type: 'text' | 'url'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'secret'; required?: boolean }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; type: 'boolean' }
  | CredentialFieldOAuth
```

#### Per-Integration OAuth Client Configuration

Each tenant configures their **own** OAuth app credentials (Client ID + Client Secret) per integration. This is critical: the platform does NOT ship pre-configured OAuth apps. The admin must:

1. Create an OAuth app in the provider's developer console (e.g., Google Cloud Console, Microsoft Entra, GitHub Developer Settings)
2. Enter the Client ID and Client Secret in the integration credential form
3. Click "Connect" to start the OAuth flow using their own OAuth app

This means every integration that uses OAuth declares **three** credential fields:

```typescript
credentials: {
  fields: [
    { key: 'clientId', label: 'OAuth Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'OAuth Client Secret', type: 'secret', required: true },
    {
      key: 'oauthTokens',
      label: 'Google Account',
      type: 'oauth',
      required: true,
      oauth: {
        provider: 'google',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        usePkce: true,
        refreshStrategy: 'background',
        refreshBeforeExpiryMinutes: 5,
        authParams: { access_type: 'offline', prompt: 'consent' },
      },
    },
  ],
}
```

### 8.3 OAuth Authorization Flow

```
Admin Panel                        Platform API                      Provider (e.g., Google)
────────────                       ────────────                      ──────────────────────
1. Admin enters Client ID +
   Client Secret, clicks Save
   → saves to IntegrationCredentials

2. Admin clicks "Connect"
   on the OAuth field
   ──────────────────────────────►
                                   3. Generate state + PKCE verifier
                                      Store in session:
                                      { integrationId, fieldKey,
                                        codeVerifier, tenantScope }
                                   4. Build authorization URL:
                                      authorizationUrl
                                      + client_id (from saved creds)
                                      + redirect_uri (platform callback)
                                      + scope
                                      + state
                                      + code_challenge (PKCE)
                                      + auth_params (access_type, prompt)
                                   ◄──────────────────────────────────
   5. Redirect to provider consent
   ────────────────────────────────────────────────────────────────────►

                                                                     6. Admin grants consent
                                                                     7. Redirect back with code + state
   ◄────────────────────────────────────────────────────────────────────

                                   8. Validate state, recover session
                                   9. Exchange code + code_verifier
                                      for tokens using tokenUrl
                                      + client_id + client_secret
                                      (from IntegrationCredentials)
                                   ────────────────────────────────────►
                                   ◄────────────────────────────────────
                                   10. Receive access_token,
                                       refresh_token, expires_in
                                   11. Store OAuthTokenSet in
                                       IntegrationCredentials.values
                                       under fieldKey ('oauthTokens')
                                       — encrypted at rest
                                   12. Log: 'oauth.connected'
   ◄──────────────────────────────
   13. Redirect to integration
       detail page with success
       flash message
```

### 8.4 OAuth Callback API Route

```typescript
// integrations/api/get/integrations/oauth/callback.ts

export const openApi = {
  summary: 'OAuth callback — receives authorization code from provider',
  tags: ['integrations'],
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const { state, code, error } = req.query

  // 1. Validate state and recover session data
  const session = await recoverOAuthSession(state as string)
  if (!session) return res.status(400).json({ error: 'Invalid or expired OAuth state' })

  if (error) {
    await logService.log({
      integrationId: session.integrationId,
      level: 'error',
      operation: 'oauth.callback_error',
      message: `OAuth denied: ${error}`,
      scope: session.tenantScope,
    })
    return res.redirect(`/backend/integrations/${session.integrationId}?oauth=error`)
  }

  // 2. Load client credentials from IntegrationCredentials
  const credentials = await credentialsService.resolve(session.integrationId, session.tenantScope)
  const oauthField = getOAuthFieldConfig(session.integrationId, session.fieldKey)

  // 3. Exchange code for tokens
  const tokenResponse = await exchangeCodeForTokens({
    tokenUrl: oauthField.oauth.tokenUrl,
    code: code as string,
    clientId: credentials.clientId as string,
    clientSecret: credentials.clientSecret as string,
    redirectUri: buildCallbackUrl(),
    codeVerifier: session.codeVerifier,
  })

  // 4. Store tokens in IntegrationCredentials
  const tokenSet: OAuthTokenSet = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined,
    tokenType: tokenResponse.token_type ?? 'Bearer',
    scope: tokenResponse.scope,
    idToken: tokenResponse.id_token,
    rawResponse: tokenResponse,
  }

  await credentialsService.saveField(
    session.integrationId,
    session.fieldKey,
    tokenSet,
    session.tenantScope,
  )

  // 5. Log success
  await logService.log({
    integrationId: session.integrationId,
    level: 'info',
    operation: 'oauth.connected',
    message: `OAuth connected via ${oauthField.oauth.provider}`,
    details: { scope: tokenResponse.scope, provider: oauthField.oauth.provider },
    scope: session.tenantScope,
  })

  // 6. Redirect back to integration page
  return res.redirect(`/backend/integrations/${session.integrationId}?oauth=success`)
}
```

### 8.5 Token Refresh — Background Worker

A scheduled worker checks all OAuth tokens and refreshes them before they expire. This ensures integrations continue working in the background without admin intervention.

```typescript
// integrations/workers/oauth-token-refresh.ts

export const metadata: WorkerMeta = {
  queue: 'oauth-token-refresh',
  id: 'oauth-token-refresh-worker',
  concurrency: 1,
  schedule: '*/5 * * * *',  // Every 5 minutes
}

export default async function handler(job: Job, ctx: WorkerContext) {
  // 1. Find all IntegrationCredentials with OAuth token sets
  const allCredentials = await findAllWithDecryption(ctx.em, 'IntegrationCredentials', {})

  for (const cred of allCredentials) {
    for (const [fieldKey, fieldValue] of Object.entries(cred.values)) {
      if (!isOAuthTokenSet(fieldValue)) continue

      const tokenSet = fieldValue as OAuthTokenSet
      if (!tokenSet.refreshToken || !tokenSet.expiresAt) continue

      const expiresAt = new Date(tokenSet.expiresAt)
      const oauthConfig = getOAuthFieldConfig(cred.integrationId, fieldKey)
      const refreshBeforeMs = (oauthConfig?.oauth.refreshBeforeExpiryMinutes ?? 5) * 60 * 1000

      // 2. Check if token is about to expire
      if (expiresAt.getTime() - Date.now() > refreshBeforeMs) continue

      const scope = { organizationId: cred.organizationId, tenantId: cred.tenantId }
      const log = ctx.integrationLog.scoped(cred.integrationId, `refresh-${fieldKey}`, scope)

      try {
        // 3. Load client credentials
        const clientId = cred.values.clientId as string
        const clientSecret = cred.values.clientSecret as string

        // 4. Call token endpoint with refresh_token grant
        const refreshed = await refreshAccessToken({
          tokenUrl: oauthConfig.oauth.tokenUrl,
          refreshToken: tokenSet.refreshToken,
          clientId,
          clientSecret,
        })

        // 5. Update stored tokens
        const newTokenSet: OAuthTokenSet = {
          ...tokenSet,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? tokenSet.refreshToken,  // Some providers rotate
          expiresAt: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
            : tokenSet.expiresAt,
          scope: refreshed.scope ?? tokenSet.scope,
        }

        await ctx.credentialsService.saveField(cred.integrationId, fieldKey, newTokenSet, scope)
        await log.info('oauth.token_refreshed', `Access token refreshed for ${oauthConfig.oauth.provider}`)

      } catch (err) {
        await log.error('oauth.refresh_failed', `Token refresh failed: ${err.message}`, {
          error: err.message,
          provider: oauthConfig?.oauth.provider,
          fieldKey,
        })

        // 6. If refresh token is invalid/revoked, mark integration as needing re-auth
        if (isRefreshTokenRevoked(err)) {
          await ctx.stateService.setReauthRequired(cred.integrationId, scope, {
            fieldKey,
            reason: 'Refresh token revoked or expired. Admin must re-connect.',
          })

          await log.warning('oauth.reauth_required', 'Re-authentication required — refresh token revoked', {
            provider: oauthConfig?.oauth.provider,
          })
        }
      }
    }
  }
}
```

### 8.6 IntegrationState Extension — Re-Auth Required

```typescript
// Extended IntegrationState (additive — new nullable column)

@Property({ type: 'jsonb', nullable: true })
reauthRequired?: {
  fieldKey: string     // Which OAuth field needs re-auth
  reason: string       // Human-readable reason
  detectedAt: string   // ISO timestamp
}
```

When `reauthRequired` is set, the admin panel shows a warning banner:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Re-authentication Required                                      │
│  The Google account connection has expired. Click "Re-connect"       │
│  to authorize again.                                                 │
│                                                      [Re-connect]    │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking "Re-connect" starts the same OAuth flow (§8.3). On successful token exchange, `reauthRequired` is cleared.

### 8.7 Credential Field Rendering — OAuth Type

The admin UI renders OAuth fields differently based on connection state:

```
BEFORE CONNECT (no oauthTokens stored):
┌─────────────────────────────────────────────────────────────────────┐
│  Google Account                                   [Connect]         │
│  Not connected                                                       │
└─────────────────────────────────────────────────────────────────────┘

AFTER CONNECT (oauthTokens stored):
┌─────────────────────────────────────────────────────────────────────┐
│  Google Account                                   [Disconnect]      │
│  ✅ Connected — Token expires 2026-03-01 14:00                       │
│  Scopes: spreadsheets.readonly, drive.readonly                       │
│                                             [Re-connect]             │
└─────────────────────────────────────────────────────────────────────┘
```

"Disconnect" removes the `oauthTokens` from credentials and logs `oauth.disconnected`. "Re-connect" starts a fresh OAuth flow (forces `prompt: consent`).

### 8.8 OAuth Utility Functions

```typescript
// integrations/lib/oauth-utils.ts

/** Exchange authorization code for tokens */
async function exchangeCodeForTokens(params: {
  tokenUrl: string
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  codeVerifier?: string
}): Promise<TokenEndpointResponse>

/** Refresh an access token using a refresh token */
async function refreshAccessToken(params: {
  tokenUrl: string
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<TokenEndpointResponse>

/** Build the full authorization URL with state, PKCE, and custom params */
function buildAuthorizationUrl(params: {
  authorizationUrl: string
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  codeChallenge?: string
  authParams?: Record<string, string>
}): string

/** Generate PKCE code_verifier and code_challenge */
function generatePkce(): { codeVerifier: string; codeChallenge: string }

/** Check if a token set is expired or about to expire */
function isTokenExpired(tokenSet: OAuthTokenSet, bufferMinutes?: number): boolean

/** Check if an error indicates a revoked refresh token */
function isRefreshTokenRevoked(error: unknown): boolean

/** Resolve a valid access token — refreshes on-demand if expired */
async function resolveAccessToken(
  integrationId: string,
  fieldKey: string,
  scope: TenantScope,
  deps: { credentialsService: CredentialsService; em: EntityManager },
): Promise<string>
```

Provider modules call `resolveAccessToken()` to get a valid access token. If the token is expired and the `refreshStrategy` is `'on-demand'`, it refreshes inline. If the refresh token is revoked, it throws and sets `reauthRequired`.

### 8.9 Updated Module Structure

```
packages/core/src/modules/integrations/
├── ...existing files...
├── lib/
│   ├── ...existing files...
│   ├── oauth-utils.ts             # OAuth utility functions (§8.8)
│   └── oauth-session.ts           # OAuth state + PKCE session storage
├── api/
│   ├── ...existing routes...
│   ├── post/integrations/[id]/oauth/start.ts   # Start OAuth flow → redirect
│   └── get/integrations/oauth/callback.ts      # OAuth callback (§8.4)
├── workers/
│   ├── ...existing workers...
│   └── oauth-token-refresh.ts     # Background token renewal (§8.5)
```

### 8.10 Updated Events

```typescript
// Additional events for OAuth lifecycle
{ id: 'integrations.oauth.connected', label: 'OAuth Connected', entity: 'oauth', category: 'lifecycle' },
{ id: 'integrations.oauth.disconnected', label: 'OAuth Disconnected', entity: 'oauth', category: 'lifecycle' },
{ id: 'integrations.oauth.token_refreshed', label: 'OAuth Token Refreshed', entity: 'oauth', category: 'system' },
{ id: 'integrations.oauth.reauth_required', label: 'OAuth Re-Auth Required', entity: 'oauth', category: 'lifecycle' },
```

### 8.11 Security Considerations

- **State parameter**: Cryptographically random, stored server-side, expires after 10 minutes — prevents CSRF
- **PKCE**: Used for all OAuth flows — prevents authorization code interception
- **Tokens encrypted at rest**: Stored inside `IntegrationCredentials.values` which is encrypted via tenant DEK
- **Refresh token rotation**: When a provider returns a new refresh token, the old one is overwritten (not accumulated)
- **Token never exposed**: OAuth tokens are never returned via API reads (masked like all `type: 'secret'` fields)
- **Client Secret per-tenant**: Each tenant brings their own OAuth app — no shared platform OAuth app. This means token revocation by one tenant doesn't affect others
- **Callback URL validation**: The OAuth callback route validates `state` before processing — rejects unknown states

### 8.12 Integration Test Coverage (OAuth)

| Test | Method | Assert |
|------|--------|--------|
| Start OAuth flow | POST `/api/integrations/:id/oauth/start` | Redirects to authorization URL with correct params |
| OAuth callback success | GET `/api/integrations/oauth/callback?code=...&state=...` | Tokens stored in credentials, redirects to integration page |
| OAuth callback error | GET `/api/integrations/oauth/callback?error=access_denied&state=...` | Error logged, redirect with error param |
| Invalid state rejection | GET `/api/integrations/oauth/callback?code=...&state=invalid` | 400 error, no tokens stored |
| Token refresh worker | Worker | Refreshes tokens expiring within 5 minutes |
| Revoked refresh token | Worker with 401 response | Sets `reauthRequired` on IntegrationState |
| Disconnect OAuth | DELETE credential field | Tokens removed, `oauth.disconnected` logged |
| Re-connect flow | Start OAuth after disconnect | New tokens stored, `reauthRequired` cleared |
| Cross-tenant isolation | OAuth flow | Tokens stored under correct tenant scope |

---

## 10. SSH Key Credential Type

### 10.1 Problem

Some integrations require SSH-based authentication — Git repositories, SFTP data sources, server-to-server connections. These need:

- Key-pair generation (Ed25519 or RSA)
- Displaying the public key for the admin to register in the external service (e.g., GitHub Deploy Keys)
- Encrypted private key storage (never exposed via API)
- Fingerprint tracking for key management

### 10.2 Solution — `ssh_keypair` Credential Field Type

```typescript
interface CredentialFieldSshKeypair {
  key: string
  label: string
  type: 'ssh_keypair'
  required?: boolean
  ssh: SshKeypairConfig
}

interface SshKeypairConfig {
  /** Key algorithm */
  algorithm: 'ed25519' | 'rsa-4096'

  /** Label to include in the public key comment (helps identify the key in remote services) */
  keyComment?: string  // Default: 'open-mercato-{integrationId}-{tenantId}'
}

/** Stored after key generation — inside IntegrationCredentials.values */
interface SshKeypairSet {
  publicKey: string       // Full public key string (safe to display)
  privateKey: string      // PEM-encoded private key (encrypted at rest, never exposed via API)
  fingerprint: string     // SHA-256 fingerprint (e.g., 'SHA256:...')
  algorithm: string       // 'ed25519' or 'rsa-4096'
  generatedAt: string     // ISO 8601 timestamp
}
```

Extended `CredentialField` union (full):

```typescript
/** Conditional visibility for credential fields — show/hide based on other field values */
interface CredentialFieldVisibility {
  field: string           // key of another credential field
  operator: 'eq' | 'neq' | 'in' | 'notIn' | 'truthy' | 'falsy'
  value?: unknown         // required for eq, neq, in, notIn
}

type CredentialField =
  | { key: string; label: string; type: 'text' | 'url'; required?: boolean; placeholder?: string; visibleWhen?: CredentialFieldVisibility }
  | { key: string; label: string; type: 'secret'; required?: boolean; visibleWhen?: CredentialFieldVisibility }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; visibleWhen?: CredentialFieldVisibility }
  | { key: string; label: string; type: 'boolean'; visibleWhen?: CredentialFieldVisibility }
  | CredentialFieldOAuth
  | CredentialFieldSshKeypair
```

### 10.3 Integration Example — GitHub Deploy Key

```typescript
credentials: {
  fields: [
    { key: 'repositoryUrl', label: 'Repository URL', type: 'url', required: true, placeholder: 'git@github.com:org/repo.git' },
    {
      key: 'sshKey',
      label: 'Deploy Key',
      type: 'ssh_keypair',
      required: true,
      ssh: { algorithm: 'ed25519', keyComment: 'open-mercato-deploy' },
    },
  ],
}
```

### 10.4 Key Lifecycle

```
Admin Panel                          Platform API
────────────                         ────────────
1. Admin clicks "Generate Key Pair"
   ────────────────────────────────►
                                     2. Generate Ed25519 key pair
                                     3. Store SshKeypairSet (encrypted)
                                     4. Log: 'ssh.key_generated'
   ◄────────────────────────────────
   5. Display public key + fingerprint
   6. Admin copies public key → registers
      in external service (e.g., GitHub
      → Settings → Deploy Keys → Add)
   7. Admin clicks "Verify Connection"
   ────────────────────────────────►
                                     8. Attempt SSH connection
                                     9. Log result
   ◄────────────────────────────────
   10. Show success/failure status
```

### 10.5 Credential Field Rendering — SSH Type

```
BEFORE GENERATION:
┌─────────────────────────────────────────────────────────────────────┐
│  Deploy Key                                  [Generate Key Pair]    │
│  No key generated                                                    │
└─────────────────────────────────────────────────────────────────────┘

AFTER GENERATION:
┌─────────────────────────────────────────────────────────────────────┐
│  Deploy Key                                                          │
│  Algorithm: Ed25519                                                  │
│  Fingerprint: SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw...       │
│  Generated: 2026-02-24 14:00                                         │
│                                                                      │
│  Public Key:                                              [Copy]     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... open-mercato-deploy│    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Copy this key and add it to your service's SSH settings.            │
│                                                                      │
│  [Regenerate Key]  [Verify Connection]                               │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.6 Security Considerations

- **Private key never exposed**: Encrypted at rest, masked on API read. Only public key + fingerprint returned
- **Ed25519 preferred**: Shorter keys, faster operations. RSA-4096 for legacy compatibility
- **Key rotation**: "Regenerate" overwrites old key. Admin must update external service
- **No passphrase**: Platform encryption layer provides at-rest protection

### 10.7 API Routes and Utilities

```
POST /api/integrations/:id/ssh/generate   — Generate key pair
POST /api/integrations/:id/ssh/verify     — Verify SSH connection
```

Utilities in `integrations/lib/ssh-utils.ts`: `generateSshKeypair()`, `computeSshFingerprint()`, `verifySshConnection()`.

---

## 9. Credential Field Enhancements (Integration-Driven)

### 9.1 Conditional Field Visibility (`visibleWhen`)

Credential forms often have fields that should only appear based on other field values. For example:
- Show OAuth fields only when `authMethod` is `'oauth2'`
- Show subdomain field only when `provider` is `'bamboohr'`
- Show sandbox URL only when `environment` is `'sandbox'`

Every `CredentialField` type (except `oauth` and `ssh_keypair`) supports an optional `visibleWhen` condition:

```typescript
credentials: {
  fields: [
    { key: 'environment', label: 'Environment', type: 'select', options: [
      { value: 'production', label: 'Production' },
      { value: 'sandbox', label: 'Sandbox' },
    ]},
    { key: 'sandboxUrl', label: 'Sandbox API URL', type: 'url', required: true,
      visibleWhen: { field: 'environment', operator: 'eq', value: 'sandbox' },
    },
    { key: 'productionUrl', label: 'Production API URL', type: 'url', required: true,
      visibleWhen: { field: 'environment', operator: 'eq', value: 'production' },
    },
  ],
}
```

Hidden fields are not validated (even if `required: true`). The UI evaluates visibility reactively — changing the controlling field immediately shows/hides dependent fields.

### 9.2 Dynamic OAuth URL Templates

Some providers have tenant-specific OAuth endpoints (BambooHR: `{company}.bamboohr.com`, Shopify: `{shop}.myshopify.com`). The `authorizationUrl` and `tokenUrl` fields accept either a static string or a function that receives all other credential field values:

```typescript
credentials: {
  fields: [
    { key: 'companySubdomain', label: 'Company Subdomain', type: 'text', required: true,
      placeholder: 'your-company',
    },
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'oauthTokens',
      label: 'BambooHR Account',
      type: 'oauth',
      required: true,
      oauth: {
        provider: 'bamboohr',
        authorizationUrl: (fields) => `https://${fields.companySubdomain}.bamboohr.com/authorize.php`,
        tokenUrl: (fields) => `https://${fields.companySubdomain}.bamboohr.com/token.php`,
        scopes: ['read', 'write'],
        usePkce: true,
        refreshStrategy: 'background',
      },
    },
  ],
}
```

The OAuth start endpoint resolves the URL function at redirect time using the tenant's saved credential values. If the referenced credential fields are empty, the OAuth flow returns a 422 error asking the admin to fill in the required fields first.

---

## 10. Widget Injection for Integration Configuration

### 9.1 Problem

The credential fields (`text`, `secret`, `select`, `boolean`, `oauth`, `ssh_keypair`) handle authentication. But many integrations need **custom configuration UI** beyond credentials — field mapping for data sync, scheduler setup for periodic imports, payment capture mode selectors, shipping service pickers, etc.

Hard-coding configuration UIs in the integrations module would couple it to every category. Instead, each provider module **injects** a React configuration widget into the integration detail page via the standard **widget injection** system.

### 9.2 Solution — Injection Spots on Integration Detail Page

The integration detail page (`/backend/integrations/[id]`) exposes widget injection spots. Provider modules inject their configuration widgets using `injection-table.ts`. The host page renders them as **tabs** on the integration detail page.

#### Spot ID Convention

```
integrations.detail:settings          # General settings section (all integrations)
integrations.detail:tabs              # Additional tabs on the detail page
integrations.detail.[category]:settings  # Category-specific (e.g., integrations.detail.data_sync:settings)
```

The host page passes an `IntegrationDetailContext` to all injected widgets:

```typescript
interface IntegrationDetailContext {
  integrationId: string       // e.g., 'sync_medusa_products'
  bundleId?: string           // e.g., 'sync_medusa' (if part of a bundle)
  category: string            // e.g., 'data_sync', 'payment', 'shipping'
  hub: string                 // e.g., 'data_sync', 'payment_gateways'
  providerKey: string         // e.g., 'medusa_products', 'stripe'
  isEnabled: boolean
  credentials: Record<string, unknown>  // Masked credentials (secrets replaced with ••••)
  organizationId: string
  tenantId: string
}
```

### 9.3 Integration Detail Page — Tab Layout with Injected Widgets

The detail page renders fixed tabs (Credentials, Version, Health, Logs) plus **injected tabs** from provider modules:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Integrations                                             │
│                                                                     │
│  [Medusa Icon]  MedusaJS — Products             [Enabled ●]        │
│                                                                     │
│  [Credentials] [Settings] [Scheduler] [Version] [Health] [Logs]    │
│                  ▲           ▲                                      │
│                  │           └── Injected by data_sync hub          │
│                  └── Injected by sync_medusa provider               │
│                                                                     │
│  ── Settings (injected widget) ─────────────────────────────────── │
│  [Provider-specific configuration UI rendered here]                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.4 Widget Injection Examples by Category

**Data Sync providers** inject:
- **Mapping widget** — field mapping editor (source fields → local fields, transforms)
- **Scheduler widget** — cron schedule configuration for periodic syncs (see SPEC-045b)

**Payment providers** inject:
- **Capture mode** — automatic vs manual capture selector
- **Payment types** — which payment methods to accept (cards, wallets, bank transfers)

**Shipping providers** inject:
- **Service picker** — which shipping services to enable (express, standard, etc.)
- **Label format** — PDF vs ZPL vs PNG preference
- **Warehouse addresses** — pickup locations

**Storage providers** inject:
- **Bucket config** — bucket name, region, path prefix
- **Upload limits** — max file size, allowed MIME types

### 9.5 Example — Data Sync Provider Injection Table

```typescript
// sync_medusa/widgets/injection-table.ts

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail:tabs': [
    {
      widgetId: 'sync_medusa.injection.mapping-config',
      kind: 'tab',
      groupLabel: 'integrations.tabs.settings',
      priority: 100,
    },
  ],
}
```

```typescript
// sync_medusa/widgets/injection/mapping-config/widget.ts

const widget: InjectionWidgetModule<IntegrationDetailContext> = {
  metadata: {
    id: 'sync_medusa.injection.mapping-config',
    title: 'Medusa Sync Settings',
    features: ['data_sync.configure'],
    priority: 100,
  },
  Widget: MedusaMappingConfigWidget,
  eventHandlers: {
    onBeforeSave: async (data, context) => {
      // Validate mapping configuration
      if (!data.fields?.length) {
        return { ok: false, message: 'At least one field mapping is required' }
      }
      return { ok: true }
    },
    onSave: async (data, context) => {
      // Save mapping via PUT /api/data-sync/mappings/:id
    },
  },
}
```

### 9.6 Bundle-Level vs Integration-Level Settings

For **bundles**, there are two levels of widget injection:

1. **Bundle detail page** (`/backend/integrations/bundle/[id]`) — widgets injected here apply to the whole bundle (e.g., shared API settings)
2. **Per-integration detail page** — widgets injected here apply to a single integration within the bundle (e.g., product-specific mapping)

The spot IDs distinguish them:
```
integrations.bundle:tabs              # Bundle-level tabs
integrations.detail:tabs              # Integration-level tabs
```

---

## 12. Implementation Steps

1. Create `@open-mercato/shared/modules/integrations/types.ts` — all shared types including `IntegrationBundle`, `ApiVersionDefinition`, `CredentialFieldOAuth`, `CredentialFieldSshKeypair`
2. Add `integration.ts` to CLI module auto-discovery scanner (support both single `export const integration` and array `export const integrations` + `export const bundle`)
3. Create `integrations` module skeleton: `index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `events.ts`
4. Create entities: `IntegrationCredentials`, `IntegrationState` (with `apiVersion` + `reauthRequired`), `IntegrationLog`
5. Implement `registry.ts` with bundle resolution and version-aware adapter lookup
6. Implement `credentials-service.ts` with bundle credential fallthrough + `saveField` method
7. Implement `state-service.ts` with `resolveApiVersion()`, `setReauthRequired()`
8. Implement `log-service.ts` with scoped logger pattern
9. Implement `oauth-utils.ts` — PKCE, code exchange, token refresh, `resolveAccessToken`
10. Implement `oauth-session.ts` — state + PKCE session storage
11. Implement `ssh-utils.ts` — key generation, fingerprint, SSH connection verification
12. Create all API routes (logs, version, OAuth start/callback, SSH generate/verify)
13. Build marketplace admin page at `/backend/integrations` with bundle grouping and deprecation badges
14. Build integration detail page with Credentials / Version / Health / Logs tabs, OAuth connect/disconnect UX, SSH key display
15. Build bundle detail page with per-integration toggles
16. Build version picker component (radio group with status badges, changelog, migration guide links)
17. Create `log-pruner` scheduled worker
18. Create `oauth-token-refresh` scheduled worker
19. Add deprecation sunset check to health check worker
20. Run `yarn db:generate` for migrations
21. Integration tests: credentials CRUD, bundle fallthrough, state toggle, OAuth flow, SSH key generation, version selection, logs query, log pruning, API security, cross-tenant isolation
