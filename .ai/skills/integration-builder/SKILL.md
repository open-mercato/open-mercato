---
name: integration-builder
description: Build integration provider packages for the Open Mercato Integration Marketplace. Use when creating new external integrations (payment gateways, shipping carriers, data sync connectors, communication channels, storage providers, webhook endpoints). Handles npm package scaffolding, adapter implementation, credentials, widget injection, webhook processing, health checks, i18n, and tests. Triggers on "build integration", "create integration", "add provider", "new connector", "integrate with", "add stripe/paypal/dhl/sendgrid" etc.
---

# Integration Builder

Build integration provider packages for the Open Mercato Integration Marketplace (SPEC-045). Every external integration MUST live in its own npm workspace package under `packages/<provider-package>/`.

## Table of Contents

1. [Pre-Flight](#1-pre-flight)
2. [Determine Integration Category](#2-determine-integration-category)
3. [Scaffold Package](#3-scaffold-package)
4. [Implement Core Files](#4-implement-core-files)
5. [Implement Adapter](#5-implement-adapter)
6. [Add Webhook Processing](#6-add-webhook-processing)
7. [Add Health Check](#7-add-health-check)
8. [Add Widget Injection](#8-add-widget-injection)
9. [Add i18n](#9-add-i18n)
10. [Add Tests](#10-add-tests)
11. [Wire Into App](#11-wire-into-app)
12. [Verification](#12-verification)

---

## 1. Pre-Flight

Before writing any code:

1. **Identify the external service** (Stripe, DHL, SendGrid, S3, etc.)
2. **Read the hub's adapter contract** — load the reference file from `references/adapter-contracts.md`
3. **Read the reference implementation** — `packages/gateway-stripe/` is the canonical example
4. **Check existing integrations** — `ls packages/gateway-* packages/carrier-* packages/sync-* packages/channel-* packages/storage-*`
5. **Read the external service's API docs** — understand auth, endpoints, webhooks, status models
6. **Check for an SDK** — prefer official SDKs over raw HTTP (`stripe`, `@aws-sdk/client-s3`, etc.)

---

## 2. Determine Integration Category

Match the external service to ONE hub category:

| Category | Hub Module | Adapter Contract | Package Prefix | Example |
|----------|-----------|-----------------|----------------|---------|
| `payment` | `payment_gateways` | `GatewayAdapter` | `gateway-` | `gateway-stripe`, `gateway-paypal` |
| `shipping` | `shipping_carriers` | `ShippingAdapter` | `carrier-` | `carrier-dhl`, `carrier-inpost` |
| `data_sync` | `data_sync` | `DataSyncAdapter` | `sync-` | `sync-medusa`, `sync-shopify` |
| `communication` | `communication_channels` | `ChannelAdapter` | `channel-` | `channel-whatsapp`, `channel-twilio` |
| `storage` | `storage_providers` | `StorageAdapter` | `storage-` | `storage-s3`, `storage-gcs` |
| `webhook` | `webhook_endpoints` | `WebhookEndpointAdapter` | `webhook-` | `webhook-zapier` |

**Package naming**: `@open-mercato/<prefix><provider>` (e.g., `@open-mercato/gateway-stripe`)
**Module naming**: `<prefix>_<provider>` in snake_case (e.g., `gateway_stripe`)

If the service spans multiple categories (e.g., MedusaJS does products + customers + orders), use an **Integration Bundle** — see [Section 4.2](#42-bundle-integration).

---

## 3. Scaffold Package

### 3.1 Create Package Directory

```
packages/<prefix><provider>/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                          # barrel export
│   └── modules/<module_id>/
│       ├── index.ts                      # module metadata
│       ├── integration.ts                # Integration Marketplace registration
│       ├── acl.ts                        # RBAC features
│       ├── setup.ts                      # tenant init, default role features
│       ├── di.ts                         # DI registrar (Awilix)
│       ├── data/
│       │   └── validators.ts             # Zod schemas
│       ├── lib/
│       │   ├── client.ts                 # SDK/HTTP client factory
│       │   ├── shared.ts                 # shared helpers, status maps
│       │   ├── health.ts                 # health check implementation
│       │   ├── status-map.ts             # provider status → unified status
│       │   ├── webhook-handler.ts        # webhook signature verification
│       │   └── adapters/                 # versioned adapter implementations
│       │       └── v<version>.ts
│       ├── workers/
│       │   └── webhook-processor.ts      # async webhook processing worker
│       ├── widgets/
│       │   ├── injection-table.ts        # widget-to-slot mappings
│       │   └── injection/<widget-name>/
│       │       ├── widget.ts             # widget metadata
│       │       └── widget.client.tsx      # React component
│       ├── i18n/
│       │   ├── en.ts                     # English translations (code)
│       │   ├── en.json                   # English translations (data)
│       │   └── ...                       # other locales
│       └── __tests__/
│           └── *.test.ts
```

### 3.2 package.json

```json
{
  "name": "@open-mercato/<prefix><provider>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts",
    "./**/*": "./src/**/*.ts",
    "./**/**/*": "./src/**/**/*.ts",
    "./**/**/**/*": "./src/**/**/**/*.ts",
    "./**/**/**/**/*": "./src/**/**/**/**/*.ts"
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@open-mercato/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

Add the external SDK as a dependency (e.g., `"stripe": "^17.0.0"`, `"@aws-sdk/client-s3": "^3.x"`).

### 3.3 tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### 3.4 src/index.ts

```typescript
export * from './modules/<module_id>/index'
```

---

## 4. Implement Core Files

### 4.1 integration.ts (CRITICAL — marketplace registration)

This is the most important file. It registers the integration into the marketplace.

```typescript
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const integration: IntegrationDefinition = {
  id: '<module_id>',                          // e.g., 'gateway_stripe'
  title: '<Provider Display Name>',           // e.g., 'Stripe'
  description: '<one-line description>',
  category: '<category>',                     // payment | shipping | data_sync | communication | webhook | storage
  hub: '<hub_module>',                        // payment_gateways | shipping_carriers | data_sync | ...
  providerKey: '<provider_key>',              // e.g., 'stripe', 'dhl', 'sendgrid'
  icon: '<icon_id>',                          // icon identifier for UI
  package: '@open-mercato/<package-name>',
  version: '1.0.0',
  tags: ['<tag1>', '<tag2>'],
  credentials: {
    fields: [
      // Define ALL credentials needed to connect to the external service
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'secret', required: true,
        helpDetails: {
          kind: 'webhook_setup',
          title: 'Webhook Configuration',
          summary: 'Configure webhooks in the provider dashboard.',
          endpointPath: '/api/<hub>/webhook/<providerKey>',
          dashboardPathLabel: 'Provider Dashboard > Webhooks',
          steps: ['Go to provider dashboard', 'Add webhook URL', 'Copy signing secret'],
        }
      },
    ],
  },
  // Optional: versioned API adapters
  apiVersions: [
    { id: '2025-01-01', label: 'v2025-01-01 (latest)', status: 'stable', default: true },
  ],
  healthCheck: { service: '<providerKey>HealthCheck' },
}
```

**Credential field types**: `text`, `secret`, `url`, `select`, `boolean`, `oauth`, `ssh_keypair`

**Conditional visibility**: Use `visibleWhen` to show/hide fields based on other field values:
```typescript
{ key: 'endpoint', label: 'Custom Endpoint', type: 'url',
  visibleWhen: { field: 'useCustomEndpoint', equals: true } }
```

### 4.2 Bundle Integration

For multi-integration providers (one npm package → many integrations sharing credentials):

```typescript
import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations'

export const bundle: IntegrationBundle = {
  id: 'sync_medusa',
  title: 'MedusaJS',
  description: 'Sync products, customers, and orders with MedusaJS',
  credentials: { fields: [
    { key: 'apiUrl', label: 'MedusaJS API URL', type: 'url', required: true },
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
  ]},
  healthCheck: { service: 'medusaHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [
  { id: 'sync_medusa_products', title: 'MedusaJS Products', category: 'data_sync', hub: 'data_sync', providerKey: 'medusa_products', bundleId: 'sync_medusa' },
  { id: 'sync_medusa_customers', title: 'MedusaJS Customers', category: 'data_sync', hub: 'data_sync', providerKey: 'medusa_customers', bundleId: 'sync_medusa' },
  { id: 'sync_medusa_orders', title: 'MedusaJS Orders', category: 'data_sync', hub: 'data_sync', providerKey: 'medusa_orders', bundleId: 'sync_medusa' },
]
```

### 4.3 index.ts (module metadata)

```typescript
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
export const metadata: ModuleInfo = {
  name: '<module_id>',
  title: '<Provider> Integration',
  version: '0.1.0',
  description: '<what this integration does>',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}
export { features } from './acl'
```

### 4.4 acl.ts

```typescript
export const features = [
  { id: '<module_id>.view', title: 'View <Provider> configuration', module: '<module_id>' },
  { id: '<module_id>.configure', title: 'Configure <Provider> settings', module: '<module_id>' },
]
```

### 4.5 setup.ts

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['<module_id>.view', '<module_id>.configure'],
    admin: ['<module_id>.view', '<module_id>.configure'],
  },
}
export default setup
```

### 4.5a Provider-Owned Env Preconfiguration (REQUIRED PATTERN)

New integrations MUST support provider-owned env preconfiguration when credentials, mappings, channels, locales, or enabled state are likely to be managed by deployment automation.

Implement the pattern inside the provider package:

1. Add a provider-local helper such as `lib/preset.ts` that reads env vars and builds the persisted provider settings.
2. Apply the preset from `setup.ts` so a fresh tenant can come up already configured when env vars are present.
3. Add a provider-local CLI command (for example `configure-from-env`) so operators can rerun the same logic later without touching core.
4. Persist through the normal services for that hub (credentials service, mapping APIs, state service, etc.).
5. Name env vars with the primary pattern `OM_INTEGRATION_<PROVIDER>_*` (for example `OM_INTEGRATION_AKENEO_API_URL`, `OM_INTEGRATION_STRIPE_SECRET_KEY`).
6. Legacy aliases may be accepted for backward compatibility, but docs and examples must show `OM_INTEGRATION_<PROVIDER>_*` as the canonical names.
7. Document the env vars in public docs or package docs using those canonical names.

Do not add provider-specific bootstrap logic to `packages/core/`.

Example shape:

```typescript
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { createIntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyMyProviderEnvPreset } from './lib/preset'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['<module_id>.view', '<module_id>.configure'],
    admin: ['<module_id>.view', '<module_id>.configure'],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    await applyMyProviderEnvPreset({
      credentialsService: createCredentialsService(em),
      stateService: createIntegrationStateService(em),
      scope: { tenantId, organizationId },
    })
  },
}

export default setup
```

### 4.6 di.ts

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer): void {
  // Register adapter(s) — see Section 5 for category-specific registration
  // Register health check — see Section 7
  // Register webhook handler — see Section 6
}
```

---

## 5. Implement Adapter

Read `references/adapter-contracts.md` for the full type definitions per category.

### 5.1 Payment Gateway (`GatewayAdapter`)

```typescript
// lib/adapters/v<version>.ts
import type { GatewayAdapter, CreateSessionInput, CreateSessionResult, ... } from '@open-mercato/shared/modules/payment_gateways/types'
import { createClient } from '../client'

export class MyGatewayAdapter implements GatewayAdapter {
  readonly providerKey = '<provider>'

  async createSession(input: CreateSessionInput): Promise<CreateSessionResult> { ... }
  async capture(input: CaptureInput): Promise<CaptureResult> { ... }
  async refund(input: RefundInput): Promise<RefundResult> { ... }
  async cancel(input: CancelInput): Promise<CancelResult> { ... }
  async getStatus(input: GetStatusInput): Promise<GatewayPaymentStatus> { ... }
  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> { ... }
  mapStatus(providerStatus: string, eventType?: string): UnifiedPaymentStatus { ... }
}
```

**DI registration** (in `di.ts`):
```typescript
import { registerGatewayAdapter, registerWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { MyGatewayAdapter } from './lib/adapters/v2025'

export function register(container: AppContainer): void {
  const adapter = new MyGatewayAdapter()
  registerGatewayAdapter(adapter, { version: '2025-01-01' })
  registerWebhookHandler('<provider>', (input) => adapter.verifyWebhook(input), { queue: '<provider>-webhook' })
}
```

### 5.2 Shipping Carrier (`ShippingAdapter`)

```typescript
// lib/adapters/v<version>.ts
import type { ShippingAdapter } from '<path>/shipping_carriers/lib/adapter'

export class MyShippingAdapter implements ShippingAdapter {
  readonly providerKey = '<provider>'

  async calculateRates(input): Promise<ShippingRate[]> { ... }
  async createShipment(input): Promise<CreateShipmentResult> { ... }
  async getTracking(input): Promise<TrackingResult> { ... }
  async cancelShipment(input): Promise<{ status: UnifiedShipmentStatus }> { ... }
  async verifyWebhook(input): Promise<ShippingWebhookEvent> { ... }
  mapStatus(carrierStatus: string): UnifiedShipmentStatus { ... }
}
```

### 5.3 Data Sync (`DataSyncAdapter`)

```typescript
// lib/adapters/v<version>.ts
import type { DataSyncAdapter, StreamImportInput, ImportBatch } from '<path>/data_sync/lib/adapter'

export class MySyncAdapter implements DataSyncAdapter {
  readonly providerKey = '<provider>'
  readonly direction = 'import' // or 'export' | 'bidirectional'
  readonly supportedEntities = ['products', 'customers']

  async *streamImport(input: StreamImportInput): AsyncIterable<ImportBatch> {
    let cursor = input.cursor
    let hasMore = true
    let batchIndex = 0
    while (hasMore) {
      const page = await this.fetchPage(input.entityType, cursor, input.credentials)
      yield { items: page.items, cursor: page.nextCursor, hasMore: page.hasMore, batchIndex }
      cursor = page.nextCursor
      hasMore = page.hasMore
      batchIndex++
    }
  }

  async getMapping(input): Promise<DataMapping> { ... }
  async validateConnection(input): Promise<ValidationResult> { ... }
}
```

### 5.4 Status Mapping

Every adapter MUST implement bidirectional status mapping:

```typescript
// lib/status-map.ts

const STATUS_MAP: Record<string, UnifiedPaymentStatus> = {
  'provider_pending': 'pending',
  'provider_paid': 'captured',
  'provider_refunded': 'refunded',
  // ... map ALL provider statuses
}

export function mapProviderStatus(providerStatus: string): UnifiedPaymentStatus {
  return STATUS_MAP[providerStatus] ?? 'unknown'
}
```

### 5.5 Client Factory

```typescript
// lib/client.ts

export function createClient(credentials: Record<string, unknown>) {
  const apiKey = credentials.secretKey as string
  if (!apiKey) throw new Error('Missing secretKey credential')
  return new ProviderSDK(apiKey)
}
```

**MUST**: Never store credentials — resolve them fresh from `credentials` parameter on every call.

---

## 6. Add Webhook Processing

If the external service sends webhooks (most do):

### 6.1 Webhook Handler

```typescript
// lib/webhook-handler.ts

export async function verifyProviderWebhook(input: VerifyWebhookInput): Promise<WebhookEvent> {
  const { rawBody, headers, credentials } = input
  const secret = credentials.webhookSecret as string
  // Use provider SDK for signature verification when available
  // Return normalized WebhookEvent
  return {
    eventType: '<provider>.<entity>.<action>',
    eventId: '<provider-event-id>',
    data: parsedPayload,
    idempotencyKey: `<provider>:${eventId}`,
    timestamp: new Date(parsedPayload.created),
  }
}
```

### 6.2 Webhook Worker

```typescript
// workers/webhook-processor.ts

export const metadata = {
  queue: '<provider>-webhook',
  id: '<module_id>:webhook-processor',
  concurrency: 5,  // I/O-bound
}

export default async function handle(job: QueuedJob, ctx: JobContext) {
  // 1. Parse webhook event
  // 2. Resolve credentials via integrationCredentials service
  // 3. Process event (update local state, emit events)
  // 4. Log result via integrationLog service
}
```

### 6.3 Webhook Guide (for admin UI)

```typescript
// webhook-guide.ts

import type { IntegrationCredentialWebhookHelp } from '@open-mercato/shared/modules/integrations'

export const webhookSetupGuide: IntegrationCredentialWebhookHelp = {
  kind: 'webhook_setup',
  title: '<Provider> Webhook Configuration',
  summary: 'Configure <Provider> to send webhook events to Open Mercato.',
  endpointPath: '/api/<hub>/webhook/<providerKey>',
  dashboardPathLabel: '<Provider> Dashboard > Developers > Webhooks',
  steps: [
    'Log in to your <Provider> dashboard',
    'Navigate to Developers > Webhooks',
    'Click "Add endpoint"',
    'Paste the webhook URL shown below',
    'Select the events you want to receive',
    'Copy the signing secret and paste it above',
  ],
  events: ['payment_intent.succeeded', 'charge.refunded'],
  localDevelopment: {
    tunnelCommand: 'npx localtunnel --port 3000',
    publicUrlExample: 'https://xxx.loca.lt/api/<hub>/webhook/<providerKey>',
    note: 'Use a tunnel for local webhook testing',
  },
}
```

---

## 7. Add Health Check

```typescript
// lib/health.ts

import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function createHealthCheck(container: AppContainer) {
  return {
    async check(credentials: Record<string, unknown>): Promise<{
      healthy: boolean
      details?: Record<string, unknown>
      message?: string
    }> {
      try {
        const client = createClient(credentials)
        const result = await client.someValidationEndpoint()
        return { healthy: true, details: { accountId: result.id } }
      } catch (error) {
        return {
          healthy: false,
          message: error instanceof Error ? error.message : 'Connection failed',
        }
      }
    },
  }
}
```

**DI registration** (add to `di.ts`):
```typescript
import { asFunction } from 'awilix'
container.register({
  '<providerKey>HealthCheck': asFunction(createHealthCheck).singleton(),
})
```

The `service` name MUST match `integration.ts` → `healthCheck.service`.

---

## 8. Add Widget Injection

Inject configuration UI into the integration detail page:

### 8.1 Widget Metadata

```typescript
// widgets/injection/<widget-name>/widget.ts

import type { WidgetDefinition } from '@open-mercato/shared/modules/widgets'

export const widget: WidgetDefinition = {
  id: '<module_id>:config',
  type: 'injection',
  label: '<Provider> Configuration',
  component: () => import('./widget.client'),
}
```

### 8.2 Widget Component

```typescript
// widgets/injection/<widget-name>/widget.client.tsx
'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ProviderConfigWidget({ context }: { context: Record<string, unknown> }) {
  const t = useT()
  // Render provider-specific configuration UI
  // context contains: integrationId, credentials (masked), isEnabled, scope
  return <div>...</div>
}
```

### 8.3 Injection Table

```typescript
// widgets/injection-table.ts

export const widgetInjections = [
  {
    widgetId: '<module_id>:config',
    spotId: 'integrations.detail:tabs',
    position: 'append',
    metadata: { tab: { label: 'Configuration', icon: 'settings' } },
  },
]
```

**Available injection spots for integrations**:
- `integrations.detail:tabs` — tab on integration detail page
- `integrations.detail:settings` — settings section
- `integrations.bundle:tabs` — tab on bundle detail page

---

## 9. Add i18n

### 9.1 English Translations

```typescript
// i18n/en.ts

export default {
  '<module_id>': {
    title: '<Provider>',
    description: '<one-line description>',
    credentials: {
      apiKey: 'API Key',
      webhookSecret: 'Webhook Signing Secret',
    },
    status: {
      connected: 'Connected',
      disconnected: 'Disconnected',
    },
    errors: {
      invalidCredentials: 'Invalid credentials',
      connectionFailed: 'Connection to <Provider> failed',
    },
  },
}
```

**MUST**: Never hard-code user-facing strings. Use `useT()` client-side, `resolveTranslations()` server-side.

---

## 10. Add Tests

### 10.1 Unit Tests

```typescript
// __tests__/status-map.test.ts

import { describe, it, expect } from 'vitest'
import { mapProviderStatus } from '../lib/status-map'

describe('status-map', () => {
  it('maps known statuses', () => {
    expect(mapProviderStatus('provider_paid')).toBe('captured')
  })
  it('returns unknown for unmapped statuses', () => {
    expect(mapProviderStatus('something_new')).toBe('unknown')
  })
})
```

**MUST test**:
- Status mapping (all provider statuses → unified statuses)
- Webhook signature verification (valid, invalid, expired)
- Client factory (missing credentials throw)
- Adapter methods (mock SDK calls)

### 10.2 Integration Tests

Place in `__integration__/` directory following the integration-tests skill pattern:

| Test Case | Description |
|-----------|-------------|
| Create session / rate / sync | Happy path for primary adapter method |
| Webhook verification (valid) | Valid signature accepted |
| Webhook verification (invalid) | Invalid signature rejected |
| Health check (healthy) | Valid credentials return healthy |
| Health check (unhealthy) | Invalid credentials return unhealthy |
| Credential validation | Missing required fields rejected |
| Status mapping completeness | All known provider statuses mapped |

---

## 11. Wire Into App

### 11.1 Add to App Modules

Add the package to `apps/mercato/src/modules.ts`:

```typescript
import '@open-mercato/<prefix><provider>'
```

### 11.2 Add Workspace Dependency

In `apps/mercato/package.json`:
```json
"@open-mercato/<prefix><provider>": "workspace:*"
```

### 11.3 Run Generators

```bash
yarn install                  # link workspace package
npm run modules:prepare       # discover integration.ts, widgets, workers
yarn generate                 # update generated files
```

### 11.4 Document the Env Preset

If the provider supports env-backed preconfiguration, update the relevant docs in the same change:

- add the env variable list
- explain which values are required vs optional
- explain that the provider auto-applies them from `setup.ts`
- document the rerunnable provider CLI command
- note any JSON override envs separately from simple scalar envs

---

## 12. Verification

After completing the implementation:

1. **Build**: `yarn build:packages` — must pass
2. **Lint**: `yarn lint` — must pass
3. **Tests**: `yarn test --filter <package-name>` — must pass
4. **Module prepare**: `npm run modules:prepare` — integration discovered
5. **Dev server**: `yarn dev` — integration visible in `/backend/integrations`
6. **Health check**: Test via admin panel
7. **Credential save**: Save test credentials via admin panel

### Self-Review Checklist

- [ ] `integration.ts` exports valid `IntegrationDefinition` with all required fields
- [ ] `credentials.fields` covers all secrets needed; secret fields use `type: 'secret'`
- [ ] Adapter implements ALL methods of the hub contract (no partial implementations)
- [ ] Status mapping covers ALL known provider statuses with `'unknown'` fallback
- [ ] Webhook signature verification uses provider SDK or timing-safe comparison
- [ ] Health check validates real connectivity (not just credential format)
- [ ] No credentials stored in memory or logged — resolve fresh from `credentials` param
- [ ] i18n: all user-facing strings in locale files, no hardcoded strings
- [ ] ACL features declared and assigned in `setup.ts` `defaultRoleFeatures`
- [ ] Provider-owned env preconfiguration implemented when the integration is deployment-managed
- [ ] Provider env vars documented with canonical `OM_INTEGRATION_<PROVIDER>_*` names
- [ ] Provider CLI can rerun env preconfiguration without core changes
- [ ] Workers export `metadata` with `{ queue, id, concurrency }`
- [ ] Widget injection table maps widgets to correct spots
- [ ] Package has unit tests for status mapping, webhook verification, client factory
- [ ] No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- [ ] Package-level imports (`@open-mercato/<pkg>/...`) for cross-module references

---

## Rules

- **MUST** place every integration in its own npm workspace package under `packages/`
- **MUST NOT** add provider code inside `packages/core/src/modules/`
- **MUST** export `integration.ts` at module root for marketplace discovery
- **MUST** implement the FULL adapter contract for the chosen hub category
- **MUST** encrypt credentials at rest — never store raw secrets; use `IntegrationCredentials` service
- **MUST** use provider SDK for webhook signature verification when available
- **MUST** map ALL known provider statuses to unified statuses with `'unknown'` fallback
- **MUST** add health check that validates real connectivity
- **MUST** use timing-safe comparison for any manual HMAC verification
- **MUST** add webhook setup guide (`helpDetails`) on webhook secret credential fields
- **MUST** add i18n translations — no hardcoded user-facing strings
- **MUST** run `npm run modules:prepare` after creating/modifying module files
- **MUST NOT** modify any files in `packages/core/`, `packages/ui/`, or `packages/shared/`
- **MUST** follow the gateway-stripe reference implementation patterns exactly
- **MUST** declare ACL features and wire them in `setup.ts` `defaultRoleFeatures`
- **MUST** add provider-owned env preconfiguration for new integrations when deployment automation can supply credentials or defaults
- **MUST** keep env preset logic and documentation inside the provider package/docs; do not add provider-specific preset handling to core
- **MUST** use `OM_INTEGRATION_<PROVIDER>_*` as the primary env naming convention for new integration presets
