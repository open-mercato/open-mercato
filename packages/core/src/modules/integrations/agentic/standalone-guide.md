# Integrations Module — Standalone App Guide

The integrations module provides the foundation for all external connectors (payment gateways, shipping carriers, data sync providers, etc.). It offers three shared mechanisms: **Integration Registry**, **Credentials API**, and **Operation Logs**.

## Creating an Integration Provider

Create a new module in your app for each provider:

1. Create `src/modules/<provider_id>/` with standard module files
2. Add `integration.ts` at the module root exporting an `IntegrationDefinition`:

```typescript
import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'my_provider',
  name: 'My Provider',
  description: 'Integration with My Provider',
  category: 'payment',
  credentials: {
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'] },
    ],
  },
  healthCheck: { service: 'myProviderHealthCheck' },  // optional
  apiVersions: ['v1', 'v2'],                          // optional
}
```

3. Register the health check service in `di.ts` (if declared)
4. Run `yarn generate` to auto-discover the integration

## Key Services (DI)

| Service | Purpose |
|---------|---------|
| `integrationCredentialsService` | Encrypted credential CRUD with bundle fallthrough |
| `integrationStateService` | Enable/disable, API version, reauth, health state |
| `integrationLogService` | Structured logging with scoped loggers |
| `integrationHealthService` | Resolves and runs provider health checks |

## Credential Resolution

1. Direct credentials for the integration ID
2. If `bundleId` is set, fallback to bundle's credentials
3. Returns `null` if neither exists

## Bundle Integrations

For platform connectors with multiple integrations (e.g., an ERP with products + orders sync):

```typescript
export const bundle: IntegrationBundle = {
  id: 'my_erp',
  name: 'My ERP',
  integrations: ['my_erp_products', 'my_erp_orders'],
}
```

- Set `bundleId` on each child integration
- Bundle credentials are shared via fallthrough

## Events

| Event | When |
|-------|------|
| `integrations.credentials.updated` | Credentials saved |
| `integrations.state.updated` | Integration enabled/disabled |
| `integrations.version.changed` | API version changed |
| `integrations.log.created` | Log entry written |

## Extending the Integration Detail Page

Provider modules can add tabs, cards, or sections to the integration detail page:

```typescript
// integration.ts
import { buildIntegrationDetailWidgetSpotId } from '@open-mercato/shared/modules/integrations/types'

export const integration = {
  id: 'my_provider',
  detailPage: {
    widgetSpotId: buildIntegrationDetailWidgetSpotId('my_provider'),
  },
} satisfies IntegrationDefinition
```

Register widgets for that spot in `widgets/injection-table.ts`. Use `placement.kind: 'tab'` for additional tabs, `'group'` for card panels, `'stack'` for inline sections.

## UMES Extension Points

Integration providers can leverage the full extension system:

| Extension | Use Case |
|-----------|----------|
| **Widget Injection** | Inject status badges, config panels into other modules |
| **Event Subscribers** | React to integration events for side-effects |
| **Entity Extensions** | Link provider data to core entities (e.g., external IDs) |
| **Response Enrichers** | Attach provider data to API responses |
| **API Interceptors** | Intercept routes with before/after hooks |
| **Notifications** | In-app alerts on integration events |
| **DOM Event Bridge** | Real-time updates via SSE (`clientBroadcast: true`) |

## Provider-Owned Env Preconfiguration

If your provider needs credentials or settings after a fresh install:

- Read env vars in a provider-local helper (e.g., `lib/preset.ts`)
- Apply from your module's `setup.ts` for automatic tenant bootstrap
- Expose a CLI command for rerunning the bootstrap
- Use provider-prefixed env names (e.g., `OM_INTEGRATION_MYPROVIDER_*`)
- Persist through normal integration services — never special-case in core
