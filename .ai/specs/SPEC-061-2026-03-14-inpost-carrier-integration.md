# SPEC-061 — InPost Shipping Carrier Integration

**Parent**: [SPEC-045c — Payment & Shipping Hubs Alignment](./SPEC-045c-payment-shipping-hubs.md)
**Issue**: [#915 — feat: create the Inpost integration](https://github.com/open-mercato/open-mercato/issues/915)
**Package**: `@open-mercato/carrier-inpost`
**Module**: `carrier_inpost`

---

## TLDR

Create the InPost shipping carrier integration as a standalone npm workspace package (`packages/carrier-inpost`). It implements the `ShippingAdapter` contract from `packages/core/src/modules/shipping_carriers/lib/adapter.ts`, registers with the Shipping Carriers Hub (`shipping_carriers`), and appears in the Integration Marketplace under the "Shipping" category.

---

## Overview

InPost is a leading Polish courier and locker-based delivery service (Paczkomat). This integration exposes four main delivery services:
- **Locker Standard** (`locker_standard`) — parcel locker (Paczkomat) delivery
- **Locker Express** (`locker_express`) — next-day locker delivery
- **Courier Standard** (`courier_standard`) — home delivery
- **Courier C2C** (`courier_c2c`) — consumer-to-consumer courier

The package follows the exact patterns established by `packages/gateway-stripe` (reference implementation) adapted to the `ShippingAdapter` contract.

---

## Problem Statement

The Shipping Carriers Hub exists and has a functional adapter contract, but no real carrier provider is wired up. Users cannot create actual shipments or calculate real rates through the platform. InPost is the most requested carrier in the primary target market (Poland/CEE).

---

## Proposed Solution

Build `packages/carrier-inpost` as a self-contained npm workspace package that:

1. Implements all `ShippingAdapter` methods against the InPost ShipX API v1
2. Registers itself via `registerShippingAdapter` on module load (via `di.ts`)
3. Appears in the marketplace via `integration.ts`
4. Supports env-backed preconfiguration via `lib/preset.ts` + `setup.ts`
5. Verifies incoming webhooks using HMAC-SHA256
6. Maps all known InPost statuses to `UnifiedShipmentStatus`
7. Provides Polish and English i18n translations

---

## Architecture

### Package Layout

```
packages/carrier-inpost/
├── package.json                                  # @open-mercato/carrier-inpost
├── tsconfig.json
├── build.mjs                                     # esbuild build script (copied from gateway-stripe)
├── jest.config.cjs
├── src/
│   ├── index.ts                                  # barrel export
│   └── modules/
│       └── carrier_inpost/
│           ├── index.ts                          # module metadata
│           ├── integration.ts                    # IntegrationDefinition
│           ├── acl.ts                            # RBAC feature declarations
│           ├── setup.ts                          # env preset + defaultRoleFeatures
│           ├── di.ts                             # registerShippingAdapter + health check DI
│           ├── webhook-guide.ts                  # webhook help content for credentials UI
│           ├── lib/
│           │   ├── client.ts                     # InPost HTTP client factory
│           │   ├── status-map.ts                 # InPost status → UnifiedShipmentStatus
│           │   ├── health.ts                     # HealthCheckable (GET /v1/organizations/{id})
│           │   ├── preset.ts                     # env-backed preconfiguration
│           │   └── adapters/
│           │       └── v1.ts                     # ShippingAdapter implementation
│           ├── workers/
│           │   └── webhook-processor.ts          # queue: 'inpost-webhook'
│           ├── widgets/
│           │   ├── injection-table.ts
│           │   └── injection/
│           │       └── inpost-config/
│           │           ├── widget.ts
│           │           └── widget.client.tsx
│           ├── i18n/
│           │   ├── en.json
│           │   └── pl.json
│           └── __tests__/
│               ├── status-map.test.ts
│               ├── webhook-handler.test.ts
│               └── preset.test.ts
```

### InPost ShipX API

- **Documentation**: [API ShipX ENG Documentation](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153476/API+ShipX+ENG+Documentation)
- **Base URL**: `https://api-shipx-pl.easypack24.net` (production)
- **Auth**: `Authorization: Bearer <apiToken>`
- **Version**: v1
- **Org-scoped**: Most endpoints require `/v1/organizations/{organizationId}/...`

Key endpoints used:

| Operation | Method | Path |
|-----------|--------|------|
| Calculate rates | GET | `/v1/organizations/{orgId}/dispatch_orders` (price list) |
| Create shipment | POST | `/v1/organizations/{orgId}/shipments` |
| Get tracking | GET | `/v1/tracking/{trackingNumber}` |
| Cancel shipment | DELETE | `/v1/organizations/{orgId}/shipments/{shipmentId}` |
| Health check | GET | `/v1/organizations/{orgId}` |

> **Note**: InPost does not provide a true rate-calculation endpoint. `calculateRates()` returns pre-defined service options with static PLN pricing that reflects typical InPost pricing. Real pricing can be overridden via integration configuration.

### Webhook Verification

InPost signs webhooks with HMAC-SHA256. The signature is delivered in the `X-Inpost-Signature` header as a hex-encoded string. Verification uses Node.js `crypto.timingSafeEqual` against the `webhookSecret` credential.

---

## Data Models

No new database entities. Shipment persistence is handled by `CarrierShipment` in `shipping_carriers` (already exists).

---

## API Contracts

All adapter method signatures follow `ShippingAdapter` exactly:

### calculateRates

Returns InPost service options with estimated PLN prices. Since ShipX does not expose a public pricing API, this returns a pre-configured rate table (configurable via integration settings).

```typescript
// Input
{ origin: Address, destination: Address, packages: PackageInfo[], credentials }

// Output: ShippingRate[]
[
  { serviceCode: 'locker_standard', serviceName: 'InPost Locker Standard', amount: 12.99, currencyCode: 'PLN', estimatedDays: 1 },
  { serviceCode: 'locker_express',  serviceName: 'InPost Locker Express',  amount: 19.99, currencyCode: 'PLN', estimatedDays: 1 },
  { serviceCode: 'courier_standard',serviceName: 'InPost Courier Standard',amount: 14.99, currencyCode: 'PLN', estimatedDays: 2 },
  { serviceCode: 'courier_c2c',     serviceName: 'InPost Courier C2C',     amount: 9.99,  currencyCode: 'PLN', estimatedDays: 3 },
]
```

### createShipment

POSTs to `/v1/organizations/{orgId}/shipments`. Maps `serviceCode` to InPost `service.name`.

```typescript
// ServiceCode → InPost service.name mapping
locker_standard  → 'inpost_locker_standard'
locker_express   → 'inpost_locker_express'
courier_standard → 'inpost_courier_standard'
courier_c2c      → 'inpost_courier_c2c'
```

### getTracking

GETs `/v1/tracking/{trackingNumber}`. Maps `status` field through `status-map.ts`.

### cancelShipment

DELETEs `/v1/organizations/{orgId}/shipments/{shipmentId}`.

---

## Credentials Schema

```typescript
credentials: {
  fields: [
    { key: 'apiToken',        label: 'API Token (Bearer)', type: 'secret',  required: true,
      helpText: 'Organization API token from InPost Manager (Manager → API → Tokens).' },
    { key: 'organizationId',  label: 'Organization ID',    type: 'text',    required: true,
      helpText: 'Your InPost organization UUID (visible in the InPost Manager URL).' },
    { key: 'apiBaseUrl',      label: 'API Base URL',       type: 'url',     required: false,
      placeholder: 'https://api-shipx-pl.easypack24.net',
      helpText: 'Leave empty for production. Use the sandbox URL for testing.' },
    { key: 'webhookSecret',   label: 'Webhook Secret',     type: 'secret',  required: false,
      helpDetails: inpostWebhookSetupGuide },
  ],
}
```

---

## Status Mapping

| InPost Status | `UnifiedShipmentStatus` |
|---------------|------------------------|
| `created` | `label_created` |
| `offers_prepared` | `label_created` |
| `offer_selected` | `label_created` |
| `confirmed` | `label_created` |
| `dispatched_by_sender` | `picked_up` |
| `collected_from_sender` | `picked_up` |
| `taken_by_courier` | `in_transit` |
| `adopted_at_source_branch` | `in_transit` |
| `sent_from_source_branch` | `in_transit` |
| `adopted_at_sorting_center` | `in_transit` |
| `sent_from_sorting_center` | `in_transit` |
| `out_for_delivery` | `out_for_delivery` |
| `ready_to_pickup` | `out_for_delivery` |
| `stack_in_box_machine` | `out_for_delivery` |
| `delivered` | `delivered` |
| `pickup_time_expired` | `failed_delivery` |
| `avizo` | `failed_delivery` |
| `returned_to_sender` | `returned` |
| `canceled` | `cancelled` |
| _(anything else)_ | `unknown` |

---

## Env Preconfiguration

Canonical env var names (`OM_INTEGRATION_<PROVIDER>_*`):

| Env Variable | Description |
|---|---|
| `OM_INTEGRATION_INPOST_API_TOKEN` | Bearer token |
| `OM_INTEGRATION_INPOST_ORGANIZATION_ID` | Organization UUID |
| `OM_INTEGRATION_INPOST_API_BASE_URL` | Override base URL (optional) |
| `OM_INTEGRATION_INPOST_WEBHOOK_SECRET` | Webhook HMAC secret (optional) |
| `OM_INTEGRATION_INPOST_ENABLED` | `true`/`false` (default: `true`) |
| `OM_INTEGRATION_INPOST_FORCE_PRECONFIGURE` | Overwrite existing credentials (default: `false`) |

Legacy aliases accepted (but not documented):
- `INPOST_API_TOKEN`, `INPOST_ORGANIZATION_ID`, `INPOST_WEBHOOK_SECRET`

---

## Widget Injection

| Spot | Widget | Purpose |
|------|--------|---------|
| Integration detail page (dynamic spot) | `carrier_inpost.injection.config` | InPost-specific configuration info tab |

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|-----------|
| InPost API rate limits during rate calculation | Low | Static rate table avoids live API calls for rates |
| Webhook signature missing `X-Inpost-Signature` | Medium | Return `ShippingWebhookEvent` with `eventType: 'inpost.webhook.unverified'` when secret not configured; require signature when secret is set |
| InPost returns non-standard HTTP errors | Medium | Wrap all API calls in try/catch, map HTTP 4xx to domain errors |
| Missing InPost status in status-map | Low | Default to `'unknown'`, log warning |

---

## Integration Test Coverage

| Test | Assert |
|------|--------|
| `calculateRates` returns 4 services in PLN | Rate list has locker_standard, locker_express, courier_standard, courier_c2c |
| `createShipment` maps serviceCode correctly | Request body contains correct `service.name` |
| `getTracking` maps all 20 statuses | Each InPost status → correct unified status |
| `cancelShipment` calls DELETE endpoint | Correct URL called; status = `cancelled` |
| `verifyWebhook` valid HMAC | Returns normalized `ShippingWebhookEvent` |
| `verifyWebhook` invalid HMAC | Throws |
| Health check success | Returns `status: 'healthy'` |
| Health check auth failure | Returns `status: 'unhealthy'` |
| Env preset — all vars set | Credentials saved, state enabled |
| Env preset — no vars | Returns `{ status: 'skipped' }` |
| Status map covers all known statuses | All 20 statuses map correctly; unknown falls back |

---

## Migration & Backward Compatibility

- Additive change only: new package, no changes to existing modules.
- `ShippingAdapter` contract already stable; this is a new implementor.
- No schema changes — uses existing `carrier_shipments` table.

---

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/skills/integration-builder/SKILL.md`
- `SPEC-045c-payment-shipping-hubs.md`

### Compliance Matrix

| Rule | Status | Notes |
|------|--------|-------|
| Provider in own package, not core | Compliant | `packages/carrier-inpost/` is separate workspace |
| Full `ShippingAdapter` contract | Compliant | All 6 methods implemented |
| Credentials via `IntegrationCredentials` service | Compliant | Resolved via `integrationCredentialsService` in shipping service |
| Webhook HMAC with timing-safe comparison | Compliant | `crypto.timingSafeEqual` used |
| Status mapping covers all known statuses + unknown fallback | Compliant | 20 statuses mapped |
| Env preconfiguration with canonical `OM_INTEGRATION_INPOST_*` | Compliant | `lib/preset.ts` implements pattern |
| ACL features + `setup.ts` `defaultRoleFeatures` | Compliant | Both declared |
| No hardcoded user-facing strings | Compliant | All strings in `i18n/*.json` |
| No `any` types | Compliant | Zod schemas or explicit types used |
| Health check validates real connectivity | Compliant | `GET /v1/organizations/{orgId}` |

### Verdict

**Ready for implementation.**

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-14 | Initial spec created for issue #915 |
