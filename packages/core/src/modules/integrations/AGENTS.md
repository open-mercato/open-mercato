# Integrations Module — Agent Guide

The `integrations` module is the foundation layer for all external connectors (payment gateways, shipping carriers, communication channels, data sync providers, etc.). It provides three shared mechanisms: **Integration Registry**, **Credentials API**, and **Operation Logs**.

**Spec**: `.ai/specs/SPEC-045-2026-02-24-integration-marketplace.md` + `.ai/specs/SPEC-045a-foundation.md`

---

## Module Structure

```
packages/core/src/modules/integrations/
├── index.ts                     # Module metadata
├── di.ts                        # DI registrations (4 services)
├── acl.ts                       # Features: view, manage, credentials.manage
├── setup.ts                     # Default role features
├── events.ts                    # 4 typed events
├── data/
│   ├── entities.ts              # IntegrationCredentials, IntegrationState, IntegrationLog, SyncExternalIdMapping
│   ├── validators.ts            # Zod schemas for all API inputs
│   └── enrichers.ts             # External ID response enricher
├── lib/
│   ├── registry-service.ts      # Read-only access to in-memory integration registry
│   ├── credentials-service.ts   # Encrypted CRUD + bundle credential fallthrough
│   ├── state-service.ts         # Enable/disable + API version + reauth + health state
│   ├── log-service.ts           # Structured logging with scoped loggers + pruning
│   └── health-service.ts        # Resolves and runs provider health checks via DI
├── api/
│   ├── route.ts                 # GET /api/integrations — list all
│   ├── logs/route.ts            # GET /api/integrations/logs — query logs
│   └── [id]/
│       ├── route.ts             # GET /api/integrations/:id — detail
│       ├── state/route.ts       # PUT — enable/disable
│       ├── credentials/route.ts # GET/PUT — read/save credentials
│       ├── version/route.ts     # PUT — change API version
│       └── health/route.ts      # POST — trigger health check
├── workers/
│   └── log-pruner.ts            # Scheduled log retention cleanup
├── backend/
│   └── integrations/
│       ├── page.tsx             # Marketplace listing page
│       ├── page.meta.ts
│       ├── [id]/
│       │   ├── page.tsx         # Integration detail (tabs: credentials/version/health/logs)
│       │   └── page.meta.ts
│       └── bundle/[id]/
│           ├── page.tsx         # Bundle config (shared credentials + per-integration toggles)
│           └── page.meta.ts
├── widgets/
│   ├── injection-table.ts
│   └── injection/external-ids/
│       └── widget.client.tsx    # External ID display for any entity detail page
└── i18n/
    ├── en.json
    └── pl.json
```

## Key Services (DI)

| Service Name | Factory | Purpose |
|---|---|---|
| `integrationCredentialsService` | `createCredentialsService(em)` | Encrypted credential CRUD with bundle fallthrough |
| `integrationStateService` | `createIntegrationStateService(em)` | Upsert integration state (enabled, version, health, reauth) |
| `integrationLogService` | `createIntegrationLogService(em)` | Structured logging: write, query, prune, scoped logger |
| `integrationHealthService` | `createHealthService(container, stateService, logService)` | Resolves named health check service from DI, runs check, updates state |

## Adding a New Integration Provider

1. Create a new module (e.g., `packages/core/src/modules/gateway_stripe/`)
2. Add `integration.ts` at the module root exporting `IntegrationDefinition`
3. Declare `credentials.fields` for the admin UI to render a dynamic form
4. Optionally declare `healthCheck.service` (register the service in your `di.ts`)
5. Optionally declare `apiVersions` for versioned external APIs
6. Add provider-owned env preconfiguration when the integration can be deployment-managed: read env vars in the provider package, apply them from `setup.ts`, and expose a rerunnable provider CLI command when practical
7. Document the provider env vars in public docs or package docs
8. Run `yarn generate` to auto-discover the integration

### Provider-Owned Env Preconfiguration

If the provider needs credentials, default mappings, or enabled state after a fresh install, implement that in the provider package, not in `integrations`:

- Read env vars in a provider-local helper such as `lib/preset.ts`
- Apply the preset from the provider module's `setup.ts` so tenant bootstrap can configure the integration automatically
- Expose a provider-local CLI command (for example `configure-from-env`) so operators can rerun the same bootstrap logic later
- Keep env names stable and provider-prefixed (for example `OM_INTEGRATION_AKENEO_*`)
- Persist through the normal integration services (`integrationCredentialsService`, mapping APIs, state service); never special-case providers in core

### Bundle Integrations

For platform connectors with multiple integrations (e.g., MedusaJS):
- Export `bundle: IntegrationBundle` and `integrations: IntegrationDefinition[]`
- Set `bundleId` on each child integration
- Bundle credentials are shared via fallthrough: child reads own credentials first, then bundle's

## Credential Resolution Order

1. Direct credentials for the integration ID
2. If `bundleId` is set, fallback to bundle's credentials
3. Return `null` if neither exists

## Events

| Event ID | Emitted When |
|---|---|
| `integrations.credentials.updated` | Credentials saved |
| `integrations.state.updated` | Integration enabled/disabled or reauth flag changed |
| `integrations.version.changed` | API version changed |
| `integrations.log.created` | Log entry written (excluded from triggers) |

## ACL Features

- `integrations.view` — view marketplace, detail, logs
- `integrations.manage` — enable/disable, change version, run health checks
- `integrations.credentials.manage` — read/save credentials

## UMES Extensibility

Integration provider modules can leverage the full **Unified Module Extension System (UMES)** — see `.ai/specs/SPEC-041-2026-02-24-universal-module-extension-system.md` for details.

### Available Extension Points for Providers

| Extension Mechanism | Use Case | Files |
|---|---|---|
| **Widget Injection** | Inject UI tabs, cards, or status badges into other modules' pages | `widgets/injection/`, `widgets/injection-table.ts` |
| **Event Subscribers** | React to integration events (`integrations.state.updated`, etc.) for side-effects | `subscribers/*.ts` |
| **Entity Extensions** | Link provider data to core entities (e.g., external IDs on orders) | `data/extensions.ts` |
| **Response Enrichers** | Attach provider-specific data to other modules' API responses | `data/enrichers.ts` |
| **API Interceptors** | Intercept other modules' API routes (before/after hooks) | `api/interceptors.ts` |
| **Component Replacement** | Override or wrap UI components from other modules | `widgets/components.ts` |
| **Menu Injection** | Add sidebar/settings menu items | via `useInjectedMenuItems` |
| **Notifications** | Emit in-app notifications on integration events | `notifications.ts`, `subscribers/` |
| **DOM Event Bridge** | Push real-time events to browser (SSE) | Set `clientBroadcast: true` in event definitions |

### Integration Detail Page Widget Spot

Provider modules can opt into a provider-scoped integration detail extension surface directly from `integration.ts`:

```typescript
import { buildIntegrationDetailWidgetSpotId } from '@open-mercato/shared/modules/integrations/types'

export const integration = {
  id: 'gateway_example',
  detailPage: {
    widgetSpotId: buildIntegrationDetailWidgetSpotId('gateway_example'),
  },
} satisfies IntegrationDefinition
```

- Register React widgets for that spot in `widgets/injection-table.ts`
- Use `placement.kind: 'tab'` to create additional detail tabs
- Use `placement.kind: 'group'` for card-style panels and `placement.kind: 'stack'` for inline sections
- Integration detail page writes run through `useGuardedMutation` with that same spot, so widget `onBeforeSave` / `onAfterSave` handlers apply to built-in credentials/state/version/health actions too
- Backward compatibility: legacy `integrations.detail:tabs` still works as the fallback when `detailPage.widgetSpotId` is omitted

### Marketplace API UMES Hooks

The integrations marketplace read routes now support a safe subset of UMES:

- `GET /api/integrations` and `GET /api/integrations/:id` support response enrichers targeting `integrations.integration`
- `GET /api/integrations/logs` supports response enrichers targeting `integrations.log`
- These read routes also execute API interceptors for their route IDs (`integrations`, `integrations/detail`, `integrations/logs`)
- Safety rule: integrations read routes preserve built-in response keys and only accept additive fields from enrichers/interceptor-after hooks
- Write routes (`credentials`, `state`, `version`) already support mutation guards and events; they are not yet wired into the generic API interceptor/enricher pipeline

### Key UMES Imports for Providers

```typescript
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
```

### Example: External ID Widget

The integrations module itself uses UMES to inject external ID displays on any entity detail page via `widgets/injection/external-ids/widget.client.tsx`, mapped through `widgets/injection-table.ts`. Follow this pattern for provider-specific widgets.

## Progress Delivery Contract

- `ProgressTopBar` uses `progress.job.*` SSE updates for live progress.
- SSE DOM bridge forwards only events with `clientBroadcast: true`.
- `progress.job.*` events are marked `clientBroadcast: true` and must be bridged across worker and web processes.

## Integration Test Expectations

- Module-local integration tests go under `__integration__/`
- Use helpers from `@open-mercato/core/modules/core/__integration__/helpers/*`
- Tests must create prerequisites via API and clean up in `finally`

## MUST Rules

- **Never import from provider modules** — integrations module is generic; providers import from integrations, not vice versa
- **Always scope by organizationId + tenantId** — every entity query and service call
- **Use `findWithDecryption`/`findOneWithDecryption`** for credential reads
- **New providers MUST support provider-owned env preconfiguration** when credentials/settings are deployment-managed; implement it in the provider package, not in core
- **Never log credential values** — log service strips secret fields from payload
- **Health check services** must be registered in DI by the provider module, not by integrations
- **API routes must export `openApi`** for documentation generation
- **All user-facing strings** via i18n keys in `i18n/en.json`
- **Keep ACL default export shape** consistent: `export const features = [...]; export default features`
- **Registry/type contracts** live in `@open-mercato/shared/modules/integrations/types`
