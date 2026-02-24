# SPEC-045 — Integration Marketplace & Connector Framework

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Related** | SPEC-041 (UMES), SPEC-044 (Payment Gateways), Issue #676, PR #674 (WhatsApp/External Channels) |

## TLDR

Define a **centralized integration framework** where every external connector (payment gateway, shipping carrier, communication channel, notification provider, storage backend, import/export pipeline, webhook endpoint) is delivered as an **npm-installable Open Mercato module** that self-registers into a **unified Integration Registry**. A single admin panel at `/backend/integrations` lets operators discover, enable/disable, and configure all integrations across categories. Secrets are stored via a **coherent credentials API** and operations are tracked via a **shared logging mechanism** — both rendered in the admin panel for any connector. Like a Zapier marketplace but self-hosted.

The framework introduces **three shared mechanisms** managed by the `integrations` core module:
1. **Credentials API** — encrypted per-tenant secret store with dynamic form rendering
2. **Operation Logs** — structured logging per integration with admin UI timeline
3. **Integration Registry** — auto-discovered from `integration.ts` convention files, supports bundles

Everything else — pages, API routes, widgets, subscribers — uses the standard module system. No new extension points beyond UMES, events, workers, and DI.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Core: integrations module                                              │
│  • Integration Registry (auto-discovers integration.ts + bundles)       │
│  • IntegrationCredentials (encrypted per-tenant) + bundle fallthrough   │
│  • IntegrationLog (shared operation logging for all integrations)       │
│  • IntegrationState (enabled/disabled per tenant)                       │
│  • Admin panel: /backend/integrations (marketplace-style)               │
│  • Health check infrastructure                                          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
        ┌───────────┬───────────┬───┴────┬──────────┬──────────┬──────────┐
        ▼           ▼           ▼        ▼          ▼          ▼          ▼
   payment    shipping    comms     notif.    storage    data       webhk.
   gateways   carriers    channels  provdrs   provdrs   sync       endpts
    (hub)      (hub)      (hub)     (hub)     (hub)     (hub)      (hub)
      │          │          │         │         │         │          │
   stripe     dhl       whatsapp  sendgrid    s3      medusa*    custom
   payu       ups       twilio    mailgun    minio    shopify*   zapier
   p24        inpost    ...       ...        ...      csv        ...

   * = bundles (one npm package → multiple data_sync integrations)
```

### Integration Bundles

A single npm package can contribute **multiple integrations** across categories. Example: `@open-mercato/sync-medusa` installs one package and registers 5 integrations (products, customers, orders, inventory, webhooks) that share one set of credentials. Admin sees a grouped card with "Enable All" and per-integration toggles.

See [SPEC-045a §1.2](./SPEC-045a-foundation.md#12-integration-bundles) for the full bundle design and MedusaJS example.

---

## Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Integrations are modules** — installed via npm, use standard auto-discovery | Reuses all existing infrastructure |
| 2 | **Three shared mechanisms** — credentials, operation logs, registry | Admin panel renders consistent UI for ANY integration |
| 3 | **Hub + spoke per category** — hub defines adapter contract, spokes implement it | Providers are interchangeable; hub owns category logic |
| 4 | **Bundles for platform connectors** — one npm package → many integrations sharing credentials | One-click MedusaJS/Shopify/Magento installer |
| 5 | **No new extension points** — UMES slots, events, workers, DI for everything | Flat learning curve |
| 6 | **Runtime enable/disable** — per tenant without code changes | `IntegrationState` entity |
| 7 | **Versioned adapters** — one integration ships multiple API versions; tenants pick which to use | External APIs evolve; tenants upgrade at their own pace |
| 8 | **Zero core module modifications** — integrations extend via UMES, events, DI | Community can contribute independently |

---

## Integration Categories

| Category ID | Hub Module | Adapter Contract | Phase | Example Providers |
|-------------|-----------|-----------------|-------|-------------------|
| `payment` | `payment_gateways` (SPEC-044) | `GatewayAdapter` | 3 | Stripe, PayU, P24 |
| `shipping` | `shipping_carriers` | `ShippingAdapter` | 3 | DHL, UPS, InPost |
| `communication` | `communication_channels` | `ChannelAdapter` | 4 | WhatsApp, Twilio |
| `notification` | `notification_providers` | `NotificationTransportAdapter` | 4 | SendGrid, Mailgun |
| `storage` | `storage_providers` | `StorageAdapter` | 5 | S3, MinIO, local |
| `data_sync` | `data_sync` | `DataSyncAdapter` | 2 | MedusaJS, CSV, Shopify |
| `webhook` | `webhook_endpoints` | `WebhookEndpointAdapter` | 5 | Custom, Zapier |

### Future Categories (Not in Scope)

- `ai` — LLM providers (OpenAI, Anthropic)
- `analytics` — tracking/reporting
- `tax` — TaxJar, Avalara
- `search` — Algolia, Typesense

---

## Phase Specifications

The full spec is split into focused phase documents:

| Phase | Spec | Goal |
|-------|------|------|
| **1** | [SPEC-045a — Foundation](./SPEC-045a-foundation.md) | `integrations` core module: registry, credentials API, operation logs, state management, admin panel, bundles |
| **2** | [SPEC-045b — Data Sync Hub](./SPEC-045b-data-sync-hub.md) | `data_sync` hub with delta-based streaming, queue processing, resumable imports, progress tracking, error logging. MedusaJS bundle as reference implementation |
| **3** | [SPEC-045c — Payment & Shipping Hubs](./SPEC-045c-payment-shipping-hubs.md) | Align SPEC-044 with marketplace + build `shipping_carriers` hub |
| **4** | [SPEC-045d — Communication & Notification Hubs](./SPEC-045d-communication-notification-hubs.md) | `communication_channels` hub (align PR #674) + `notification_providers` hub |
| **5** | [SPEC-045e — Storage & Webhook Hubs](./SPEC-045e-storage-webhook-hubs.md) | `storage_providers` hub + `webhook_endpoints` hub |
| **6** | [SPEC-045f — Health Monitoring](./SPEC-045f-health-monitoring.md) | Scheduled health checks, marketplace search/filtering, usage analytics |

### Provider-Specific Specifications

| Spec | Provider | Goal |
|------|----------|------|
| [SPEC-045g — Google Workspace](./SPEC-045g-google-workspace.md) | Google | Spreadsheet product import with field mapping, Google OAuth, step-by-step setup guide |

---

## Key Concepts

### `integration.ts` Convention File

Every integration module declares an `integration.ts` at its root — auto-discovered during `yarn generate`:

```typescript
export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  apiVersions: [
    { id: '2024-12-18', label: 'v2024-12-18 (latest)', status: 'stable', default: true },
    { id: '2023-10-16', label: 'v2023-10-16', status: 'deprecated', sunsetAt: '2026-12-01' },
  ],
  credentials: { fields: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
  ]},
}
```

Integrations without `apiVersions` are treated as single-version (unversioned) — no version picker is shown. Bundles export both `bundle` and `integrations` (array). See [SPEC-045a §1](./SPEC-045a-foundation.md).

### Credentials API

Unified encrypted per-tenant store. Bundle integrations inherit bundle credentials via fallthrough. Secret fields masked on read (`'••••••••'`). Supports **OAuth 2.0 credential type** for third-party app authentication (Google, Microsoft, GitHub, Slack) — admin creates their own OAuth app, connects via consent screen, tokens stored encrypted with background renewal. See [SPEC-045a §2](./SPEC-045a-foundation.md#2-credentials-api) and [SPEC-045a §8](./SPEC-045a-foundation.md#8-oauth-20-credential-type--third-party-app-authentication).

### Operation Logs

Shared `IntegrationLog` entity + scoped logger via DI. Every integration uses the same logging API. Admin panel renders timeline per integration with level filtering. See [SPEC-045a §3](./SPEC-045a-foundation.md#3-operation-logs--shared-logging-mechanism).

### API Versioning

External APIs change frequently. A single integration module can ship **multiple adapter versions**, one per external API version. Each tenant picks which version to use — no forced upgrades.

- **Developer side**: Declare `apiVersions` in `integration.ts`. Register one adapter per version. Share common logic in `lib/shared.ts`.
- **User side**: Version picker on the integration detail page. Deprecation warnings with sunset dates and migration guides.
- **Framework side**: Adapter registries resolve the tenant's selected version transparently. Defaults to the version marked `default: true`.
- **Lifecycle**: `stable` → `deprecated` (with sunset date) → removed in a future release. The admin panel highlights deprecated versions and links to migration guides.

Integrations that don't need versioning simply omit `apiVersions` — zero overhead. See [SPEC-045a §1.3](./SPEC-045a-foundation.md#13-api-versioning).

### Data Sync — Delta Streaming

Import/export via `AsyncIterable<ImportBatch>` — streaming, resumable, queue-based. Cursor persisted after each batch. Real-time progress API. Item-level errors logged without stopping the sync. See [SPEC-045b](./SPEC-045b-data-sync-hub.md).

---

## Data Models Summary

| Entity | Table | Owner | Purpose |
|--------|-------|-------|---------|
| `IntegrationCredentials` | `integration_credentials` | `integrations` | Encrypted per-tenant secrets |
| `IntegrationState` | `integration_states` | `integrations` | Enable/disable + health state + selected API version |
| `IntegrationLog` | `integration_logs` | `integrations` | Structured operation logs |
| `SyncRun` | `sync_runs` | `data_sync` | Import/export run with progress |
| `SyncCursor` | `sync_cursors` | `data_sync` | Last delta cursor per entity type |
| `SyncExternalIdMapping` | `sync_external_id_mappings` | `data_sync` | Local ↔ external entity ID mapping for bidirectional sync |
| `SyncMapping` | `sync_mappings` | `data_sync` | Persisted field mapping configuration per integration + entity type |
| `GatewayTransaction` | `gateway_transactions` | `payment_gateways` | Payment gateway state (SPEC-044) |
| `CarrierShipment` | `carrier_shipments` | `shipping_carriers` | Shipping carrier state |

No existing entities are modified.

---

## Relationship with Existing Specs

### SPEC-044 (Payment Gateways) → First Hub Module

Provider modules declare `integration.ts`, read secrets from `IntegrationCredentials`, use `integrationLog` for webhook processing. `providerSettings` continues for per-method config. See [SPEC-045c](./SPEC-045c-payment-shipping-hubs.md).

### SPEC-041 (UMES) → Extension Mechanism

All hub modules use UMES for UI extensions. No changes to SPEC-041 required.

### PR #674 (WhatsApp/External Channels) → Communication Hub

Becomes `communication_channels` hub. WhatsApp becomes first spoke. See [SPEC-045d](./SPEC-045d-communication-notification-hubs.md).

---

## Security & Compliance

- **Credentials**: Encrypted at rest, masked on API read, hard-deleted, never logged
- **Operation Logs**: Never contain secrets (log service strips `type:'secret'` fields from details)
- **Access Control**: `integrations.view`, `.manage`, `.credentials` features
- **Tenant Isolation**: All entities scoped by `organizationId` + `tenantId`
- **Webhooks**: Verification delegated to each hub's adapter (provider-specific signature schemes)

---

## Risks & Impact Review

### Critical Risks

#### Cross-Tenant Credential Leak
- **Scenario**: Bug in credential service returns another tenant's secrets
- **Mitigation**: `findOneWithDecryption` scopes by `organizationId` + `tenantId`. Unique constraint on `(integrationId, organizationId, tenantId)`. Scope derived from session, never from request body.
- **Residual risk**: Code-level bug; mitigated by integration tests.

### High Risks

#### Data Sync Failure Mid-Import
- **Scenario**: Network error at batch 345 of a 500-batch import
- **Mitigation**: Cursor persisted after each batch. Resume from batch 345, not from zero. Item-level errors don't stop the sync. See [SPEC-045b §4.9](./SPEC-045b-data-sync-hub.md#49-retry--resume).
- **Residual risk**: External API state may have changed between failure and retry.

#### Credential Encryption Key Loss
- **Scenario**: Tenant encryption key is lost
- **Mitigation**: Transaction wraps credential save; documented in ops runbook. Admin re-enters credentials.
- **Residual risk**: Downtime for affected integrations until re-configured.

### Medium Risks

#### Health Check Timeout
- **Scenario**: External service slow; health check blocks admin panel
- **Mitigation**: Async via worker, 10s timeout, cached last result.

#### Bundle Credential Sharing
- **Scenario**: Admin expects per-integration credentials but bundle shares them
- **Mitigation**: UI clearly shows "Shared credentials (from MedusaJS bundle)" label. Override possible by saving integration-level credentials.

### Low Risks

#### Hub Module Not Installed
- **Mitigation**: Integration detail page warns "Hub module required". Enable button disabled.

#### New Tables Only (Migration)
- **Mitigation**: Additive-only migration, zero-downtime safe.

---

## Final Compliance Report — 2026-02-24

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root | No direct ORM relationships between modules | Compliant | All cross-module links use FK IDs |
| root | Filter by `organization_id` | Compliant | All entities scoped |
| root | Validate inputs with Zod | Compliant | `data/validators.ts` for all APIs |
| root | Use `findWithDecryption` | Compliant | Credentials service |
| root | API routes export `openApi` | Compliant | All routes |
| root | DI (Awilix) for services | Compliant | All services via `di.ts` |
| root | Modules plural, snake_case | Compliant | `integrations`, `data_sync`, etc. |
| root | Event IDs `module.entity.action` | Compliant | Singular entity, past tense action |
| root | Use `apiCall` for backend pages | Compliant | All admin pages |
| root | i18n: `useT()` client-side | Compliant | All strings via locale files |
| core | Convention file auto-discovery | Compliant | `integration.ts` added to scanner |
| core | Workers declare metadata | Compliant | All workers have queue, id, concurrency |
| backward | No existing entity changes | Compliant | Only new entities |
| backward | No existing API changes | Compliant | Only new routes |

### Verdict

**Fully compliant** — Approved for implementation.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft |
| 2026-02-24 | Added Integration Bundles concept with MedusaJS example |
| 2026-02-24 | Added shared Operation Logs mechanism (IntegrationLog + scoped logger) |
| 2026-02-24 | Redesigned DataSyncAdapter with delta streaming, queue processing, resumability, progress tracking |
| 2026-02-24 | Split into 6 phase files (SPEC-045a through SPEC-045f) |
| 2026-02-24 | Consistency audit: added missing `SyncExternalIdMapping` and `SyncMapping` entities to data models table, fixed §4 subsection numbering in SPEC-045b, added `id-mapping.ts` and `rate-limiter.ts` to module structure, added 3 missing integration tests |
| 2026-02-24 | Added API Versioning: integrations can declare multiple API versions (`apiVersions` array); tenants select version via admin UI; adapter registries resolve version-aware adapters; deprecated version warnings with sunset dates |
| 2026-02-24 | Added OAuth 2.0 credential type (SPEC-045a §8): per-integration OAuth apps, authorization code + PKCE flow, encrypted token storage, background refresh worker, re-auth detection |
| 2026-02-24 | Added SSH key credential type (SPEC-045a §10): key-pair generation, public key display, private key encrypted storage, fingerprint tracking |
| 2026-02-24 | Added SPEC-045g — Google Workspace provider spec: end-to-end OAuth + Sheets product import with field mapping |
