# Step 2 — Core module files

Implement the module's core files under `src/modules/<module_id>/`.

## 2.1 integration.ts (CRITICAL — marketplace registration)

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
  package: '<module_id>',                     // module id (standalone) or npm package name if published
  version: '1.0.0',
  tags: ['<tag1>', '<tag2>'],
  credentials: {
    fields: [
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
  apiVersions: [
    { id: '2025-01-01', label: 'v2025-01-01 (latest)', status: 'stable', default: true },
  ],
  healthCheck: { service: '<providerKey>HealthCheck' },
}
```

**Credential field types**: `text`, `secret`, `url`, `select`, `boolean`, `oauth`, `ssh_keypair`.

**Conditional visibility** — show/hide fields based on other field values:

```typescript
{ key: 'endpoint', label: 'Custom Endpoint', type: 'url',
  visibleWhen: { field: 'useCustomEndpoint', equals: true } }
```

## 2.2 Bundle (multi-integration providers)

For one module → many integrations sharing credentials (e.g. MedusaJS products + customers + orders):

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

## 2.3 index.ts (module metadata)

```typescript
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
export const metadata: ModuleInfo = {
  name: '<module_id>',
  title: '<Provider> Integration',
  version: '0.1.0',
  description: '<what this integration does>',
  author: '<your team>',
  license: 'MIT',
  ejectable: true,
}
export { features } from './acl'
```

## 2.4 acl.ts

```typescript
export const features = [
  { id: '<module_id>.view', title: 'View <Provider> configuration', module: '<module_id>' },
  { id: '<module_id>.configure', title: 'Configure <Provider> settings', module: '<module_id>' },
]
```

## 2.5 setup.ts

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

## 2.6 di.ts

```typescript
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer): void {
  // Register adapter(s)      — see step-3-adapter-and-credentials.md
  // Register health check    — see step-4-webhooks-health-widgets.md
  // Register webhook handler — see step-4-webhooks-health-widgets.md
}
```

Proceed to `step-3-adapter-and-credentials.md`.
