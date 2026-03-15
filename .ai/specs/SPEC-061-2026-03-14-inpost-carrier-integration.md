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
- **Locker Standard** (`locker_standard`) — parcel locker (Paczkomat) standard delivery
- **Locker Economy** (`locker_economy`) — parcel locker (Paczkomat) economy delivery
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
7. Provides Polish, English, German, and Spanish i18n translations

---

## Architecture

### Package Layout

```
packages/carrier-inpost/
├── package.json                                  # @open-mercato/carrier-inpost
├── tsconfig.json
├── build.mjs                                     # esbuild build script
├── jest.config.cjs
├── postman_collection/                           # Reference API spec (read-only)
│   ├── API ShipX 1.1.postman_collection.json
│   ├── Production environment.postman_environment.json
│   └── Sandbox environment.postman_environment.json
└── src/
    ├── index.ts                                  # barrel export
    └── modules/
        └── carrier_inpost/
            ├── index.ts                          # module metadata
            ├── integration.ts                    # IntegrationDefinition
            ├── acl.ts                            # RBAC feature declarations
            ├── setup.ts                          # env preset + defaultRoleFeatures
            ├── di.ts                             # registerShippingAdapter + health check DI
            ├── webhook-guide.ts                  # webhook help content for credentials UI
            ├── lib/
            │   ├── client.ts                     # InPost HTTP client
            │   ├── errors.ts                     # centralised error factory (inpostErrors)
            │   ├── status-map.ts                 # InPost status → UnifiedShipmentStatus + isLockerService
            │   ├── health.ts                     # HealthCheckable (GET /v1/organizations/{id})
            │   ├── preset.ts                     # env-backed preconfiguration
            │   ├── webhook-handler.ts            # HMAC-SHA256 webhook verification
            │   └── adapters/
            │       └── v1.ts                     # ShippingAdapter implementation
            ├── widgets/
            │   ├── injection-table.ts
            │   └── injection/
            │       ├── inpost-config/
            │       │   ├── widget.ts
            │       │   └── widget.client.tsx
            │       └── inpost-tracking/
            │           ├── widget.ts
            │           └── widget.client.tsx
            ├── i18n/
            │   ├── en.json
            │   ├── pl.json
            │   ├── de.json
            │   └── es.json
            ├── backend/
            │   └── carrier-inpost/demo/
            │       ├── page.tsx                  # 6-section demo page
            │       └── page.meta.ts
            └── __tests__/
                ├── adapter-v1.test.ts
                ├── client.test.ts
                ├── health.test.ts
                ├── status-map.test.ts
                ├── webhook-handler.test.ts
                └── preset.test.ts
```

### InPost ShipX API

- **Reference collection**: `postman_collection/API ShipX 1.1.postman_collection.json`
- **Documentation**: [API ShipX ENG Documentation](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153476/API+ShipX+ENG+Documentation)
- **Production base URL**: `https://api-shipx-pl.easypack24.net`
- **Sandbox base URL**: `https://sandbox-api-shipx-pl.easypack24.net`
- **Auth**: `Authorization: Bearer <apiToken>`
- **Version**: v1
- **Org-scoped**: Most endpoints require `/v1/organizations/{organizationId}/...`

Key endpoints used:

| Operation | Method | Path |
|-----------|--------|------|
| Create shipment (step 1) | POST | `/v1/organizations/{orgId}/shipments` |
| Buy shipment (step 2) | POST | `/v1/shipments/{shipmentId}/buy` |
| Get tracking | GET | `/v1/tracking/{trackingNumber}` |
| Health check | GET | `/v1/organizations/{orgId}` |

> **No cancel endpoint**: The ShipX API has no `DELETE /shipments/{id}` endpoint. `cancelShipment()` throws immediately with a "not supported via API" error; the cancel route returns 502. Users must cancel via the InPost merchant portal.

> **Note**: `calculateRates()` calls the real InPost `/v1/organizations/{orgId}/shipments/calculate` endpoint once per service using `Promise.allSettled`. Services that return errors (e.g. missing contract, unsupported service) are silently skipped; only services with a valid `calculated_charge_amount` appear in the result. Amounts are returned in minor units (grosz). Locker services include a placeholder `target_point` (`KRA010`) and `custom_attributes` required by the calculate endpoint; courier_c2c includes `custom_attributes.sending_method = 'dispatch_order'`.

> **Note**: The ShipX API does not expose a dedicated cancel-shipment endpoint. The `cancelShipment` adapter method issues a best-effort DELETE; the API may respond with 404 or 405. Cancellations are typically handled via InPost customer service or Dispatch Order management.

### Webhook Verification

InPost signs webhooks with HMAC-SHA256. The signature is delivered in the `X-Inpost-Signature` header as a hex-encoded string. Verification uses Node.js `crypto.timingSafeEqual` against the `webhookSecret` credential.

---

## Data Models

No new database entities. Shipment persistence is handled by `CarrierShipment` in `shipping_carriers` (already exists).

---

## API Contracts

All adapter method signatures follow `ShippingAdapter` exactly.

### calculateRates

Calls `/v1/organizations/{orgId}/shipments/calculate` once per service using `Promise.allSettled`. Services that return errors (missing contract, unsupported service) are silently skipped. Only services with a valid `calculated_charge_amount` appear in the result. Amounts are returned in minor units (grosz). Locker services include a placeholder `target_point` (`KRA010`) and `custom_attributes`; `courier_c2c` includes `custom_attributes.sending_method = 'dispatch_order'`.

### createShipment

Two-step offer flow:

1. `POST /v1/organizations/{orgId}/shipments` — returns `status: 'offer_selected'` with an `offers` array; tracking number not yet assigned.
2. `POST /v1/shipments/{shipmentId}/buy` with `{ "offer_id": <id> }` — confirms the shipment; tracking number available on `bought.tracking_number` or `bought.parcels[0].tracking_number`.

If the create response contains no offer (legacy non-offer mode), the buy step is skipped and the tracking number is read directly from the create response.

Tracking number resolution priority: `bought.tracking_number` → `bought.parcels[0].tracking_number` → `shipment.tracking_number` → fallback to `shipmentId`. Empty strings are treated the same as null.

Maps `serviceCode` to InPost `service` field.

#### Service code mapping

```
locker_standard  → 'inpost_locker_standard'
locker_economy   → 'inpost_locker_economy'
courier_standard → 'inpost_courier_standard'
courier_c2c      → 'inpost_courier_c2c'
```

#### Request body shape

```json
{
  "service": "inpost_locker_standard",
  "reference": "<orderId>",
  "sender": {
    "company_name": "<credentials.senderCompanyName>",
    "first_name":   "<credentials.senderFirstName>",
    "last_name":    "<credentials.senderLastName>",
    "email":        "<credentials.senderEmail>",
    "phone":        "<credentials.senderPhone>",
    "address": {
      "street":          "<origin.line1>",
      "building_number": "<origin.line2>",
      "city":            "<origin.city>",
      "post_code":       "<origin.postalCode>",
      "country_code":    "<origin.countryCode>"
    }
  },
  "receiver": {
    "company_name": "<credentials.receiverCompanyName>",
    "first_name":   "<credentials.receiverFirstName>",
    "last_name":    "<credentials.receiverLastName>",
    "email":        "<credentials.receiverEmail>",
    "phone":        "<credentials.receiverPhone>",
    "address": {
      "street":          "<destination.line1>",
      "building_number": "<destination.line2>",
      "city":            "<destination.city>",
      "post_code":       "<destination.postalCode>",
      "country_code":    "<destination.countryCode>"
    }
  },
  "parcels": [
    // Locker service (no packages): { "template": "small" }
    // Locker service (with packages): { "template": "small" }
    // Courier service: {
    //   "dimensions": { "length": "<mm>", "width": "<mm>", "height": "<mm>", "unit": "mm" },
    //   "weight":     { "amount": "<kg>", "unit": "kg" }
    // }
  ],
  "custom_attributes": {
    "target_point": "<credentials.targetPoint>"  // locker machine ID; only sent when present
  }
}
```

Contact fields (`company_name`, `first_name`, `last_name`, `email`, `phone`) and `building_number` are omitted from the payload when not present in credentials / address. `custom_attributes` is omitted entirely when `targetPoint` is not set.

### getTracking

GETs `/v1/tracking/{trackingNumber}`. Maps `status` field through `status-map.ts`. No auth header is required by the ShipX tracking endpoint.

### cancelShipment

Not supported via API. The adapter throws `inpostErrors.cancelNotSupported()` immediately without making any HTTP request. The cancel route catches the thrown `Error` and returns 502 with an explanatory message. Users must cancel shipments through the InPost merchant portal.

---

## Credentials Schema

```typescript
credentials: {
  fields: [
    { key: 'apiToken',           label: 'API Token (Bearer)', type: 'secret', required: true,
      helpText: 'Organization API token from InPost Manager (Manager → API → Tokens).' },
    { key: 'organizationId',     label: 'Organization ID',    type: 'text',   required: true,
      helpText: 'Your InPost organization numeric ID (integer, e.g. 6183). Use GET /v1/organizations to discover it — do NOT use the JWT account UUID.' },
    { key: 'apiBaseUrl',         label: 'API Base URL',       type: 'url',    required: false,
      placeholder: 'https://api-shipx-pl.easypack24.net',
      helpText: 'Leave empty for production. Sandbox: https://sandbox-api-shipx-pl.easypack24.net' },
    { key: 'webhookSecret',      label: 'Webhook Secret',     type: 'secret', required: false,
      helpDetails: inpostWebhookSetupGuide },
    { key: 'targetPoint',        label: 'Default Target Locker (Paczkomat ID)', type: 'text', required: false,
      helpText: 'Default locker machine ID (e.g. WAW478M) sent as custom_attributes.target_point.' },
    { key: 'senderCompanyName',  label: 'Sender Company Name',  type: 'text',   required: false },
    { key: 'senderFirstName',    label: 'Sender First Name',    type: 'text',   required: false },
    { key: 'senderLastName',     label: 'Sender Last Name',     type: 'text',   required: false },
    { key: 'senderEmail',        label: 'Sender Email',         type: 'text',   required: false },
    { key: 'senderPhone',        label: 'Sender Phone',         type: 'text',   required: false },
    { key: 'receiverCompanyName',label: 'Receiver Company Name',type: 'text',   required: false },
    { key: 'receiverFirstName',  label: 'Receiver First Name',  type: 'text',   required: false },
    { key: 'receiverLastName',   label: 'Receiver Last Name',   type: 'text',   required: false },
    { key: 'receiverEmail',      label: 'Receiver Email',       type: 'text',   required: false },
    { key: 'receiverPhone',      label: 'Receiver Phone',       type: 'text',   required: false },
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
| `OM_INTEGRATION_INPOST_ORGANIZATION_ID` | Organization numeric ID (integer, e.g. `6183`) — use `GET /v1/organizations` to discover; do NOT use the JWT account UUID |
| `OM_INTEGRATION_INPOST_API_BASE_URL` | Override base URL (optional) |
| `OM_INTEGRATION_INPOST_WEBHOOK_SECRET` | Webhook HMAC secret (optional) |
| `OM_INTEGRATION_INPOST_ENABLED` | `true`/`false` (default: `true`) |
| `OM_INTEGRATION_INPOST_FORCE_PRECONFIGURE` | Overwrite existing credentials (default: `false`) |

---

## Widget Injection

| Spot | Widget | Purpose |
|------|--------|---------|
| Integration detail page (dynamic spot) | `carrier_inpost.injection.config` | InPost-specific configuration info tab |
| `data-table:sales.orders:row-actions` | `shipping_carriers.injection.create-shipment-button` | "Create shipment" row action navigates to wizard |
| `detail:sales.order:shipping` | `carrier_inpost.injection.tracking` | Live InPost tracking panel on order detail shipments tab |

The `detail:sales.order:shipping` injection spot is declared in `SalesDocumentDetailPage` (`packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx`) immediately after `<SalesShipmentsSection />` in the shipments tab render path. The tracking widget fetches sales shipments for the order, finds the InPost carrier shipment via `_carrier.providerKey === 'inpost'`, then calls `GET /api/shipping-carriers/tracking` to display status and events timeline.

---

## Sales / Shipments Hub Integration

When a user clicks **Create shipment** on a sales order row, they are taken to a 3-step wizard page in the `shipping_carriers` module:

### Route
`GET /backend/shipping-carriers/create?orderId=<uuid>`

Protected by `requireAuth` + `requireFeatures: ['shipping_carriers.manage']`.

### Wizard Steps

| Step | Path component | Purpose |
|------|---------------|---------|
| 1 — Select carrier | `provider` | Loads `GET /api/shipping-carriers/providers`, shows clickable provider cards |
| 2 — Configure shipment | `configure` | Origin address (blank, merchant fills), destination pre-filled from order's `shipping`/`delivery` document address; package dimensions editor; label format selector (PDF/ZPL/PNG) |
| 3 — Select service & confirm | `confirm` | Calls `POST /api/shipping-carriers/rates`, shows selectable rate cards with price and estimated days badges; summary panel; submits to `POST /api/shipping-carriers/shipments`, redirects to order detail page on success |

### New API Route

`GET /api/shipping-carriers/providers` — lists all adapters registered via `registerShippingAdapter`. Returns `{ providers: [{ providerKey: string }] }`. Guarded by `shipping_carriers.manage`.

### Files Added / Modified

| File | Description |
|------|-------------|
| `packages/core/src/modules/shipping_carriers/api/providers/route.ts` | New GET endpoint |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/page.tsx` | 3-step wizard orchestrator; uses `ts-pattern` `match().with().exhaustive()` to dispatch step rendering |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/page.meta.ts` | Page auth guard metadata |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/types.ts` | Domain types shared across wizard files |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/components/AddressFields.tsx` | Reusable address form fragment |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/components/PackageEditor.tsx` | Package dimensions editor |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/components/WizardNav.tsx` | Step breadcrumb nav; uses `ts-pattern` `match()` instead of a nested ternary to compute per-step CSS class |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/components/ProviderStep.tsx` | Carrier selection step; uses `ts-pattern` `match(props)` with `P.string` / empty-array patterns to dispatch over the four mutually exclusive render states (loading / error / empty / loaded) |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/components/ConfigureStep.tsx` | Shipment configuration step |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/components/ConfirmStep.tsx` | Rate selection and submit step |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/hooks/shipmentApi.ts` | Pure async API functions extracted from the hook; uses `ts-pattern` `match(call).with({ ok: true, result: P.not(P.nullish) }, ...).otherwise(...)` for discriminated-union result handling across all four API calls |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/hooks/useShipmentWizard.ts` | React hook — state + orchestration only; calls `shipmentApi` functions, no direct `apiCall` usage |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/__tests__/shipmentApi.test.ts` | 17 unit tests for `shipmentApi` (success + error paths, URL/method/body assertions); uses `chance` for all data |
| `packages/core/src/modules/shipping_carriers/backend/shipping-carriers/create/__tests__/useShipmentWizard.test.tsx` | 18 unit tests for `useShipmentWizard` (mount load, address prefill, step transitions, rate fetch, submit success/error); uses `@testing-library/react` `renderHook` with `@jest-environment jsdom` docblock |
| `packages/core/src/modules/shipping_carriers/i18n/en.json` | ~50 new wizard i18n keys |
| `packages/core/src/modules/shipping_carriers/i18n/pl.json` | Same keys in Polish |

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|-----------|
| InPost API rate limits during rate calculation | Low | Static rate table avoids live API calls for rates |
| Webhook signature missing `X-Inpost-Signature` | Medium | Return `ShippingWebhookEvent` with `eventType: 'inpost.webhook.unverified'` when secret not configured; require signature when secret is set |
| InPost returns non-standard HTTP errors | Medium | Wrap all API calls in `inpostErrors.apiError(status, text)`; never expose raw HTTP bodies |
| Missing InPost status in status-map | Low | Default to `'unknown'` |
| `cancelShipment` has no supported API endpoint | Medium | Adapter throws `cancelNotSupported()` immediately; cancel route returns 502; UI must surface the error and direct users to the InPost merchant portal |
| Locker shipment missing `target_point` | Medium | Caller must set `credentials.targetPoint`; ShipX API will reject the request without it |

---

## Integration Test Coverage

| Test | Assert |
|------|--------|
| `calculateRates` returns 4 services in PLN | Rate list has `locker_standard`, `locker_economy`, `courier_standard`, `courier_c2c` |
| `calculateRates` does not include deprecated `locker_express` | `locker_express` absent from rate list |
| `createShipment` nests address under `address` key | `sender.address.post_code` and `receiver.address.post_code` present |
| `createShipment` maps serviceCode correctly | Request body `service` equals `inpost_locker_standard` |
| `createShipment` locker → `{ template: 'small' }` parcel | Parcel shape is `{ template: 'small' }` |
| `createShipment` courier → dimensions/weight parcel | Parcel has `dimensions` (mm) and `weight` (kg) |
| `createShipment` sends `custom_attributes.target_point` from credentials | `target_point` present when `credentials.targetPoint` is set |
| `createShipment` omits `custom_attributes` when targetPoint absent | `custom_attributes` undefined |
| `createShipment` includes contact fields from credentials | `sender.first_name`, `sender.email`, etc. present |
| `getTracking` maps all 19 statuses | Each InPost status → correct unified status |
| `cancelShipment` calls DELETE endpoint | Correct URL called; status = `cancelled` |
| `verifyWebhook` valid HMAC | Returns normalized `ShippingWebhookEvent` |
| `verifyWebhook` invalid HMAC | Throws |
| Health check success | Returns `status: 'healthy'` |
| Health check auth failure | Returns `status: 'unhealthy'` |
| Env preset — all vars set | Credentials saved, state enabled |
| Env preset — no vars | Returns `{ status: 'skipped' }` |
| Status map covers all known statuses | All 19 statuses map correctly; unknown falls back |
| `isLockerService` returns true for locker codes | `locker_standard`, `inpost_locker_allegro`, etc. → `true` |
| `isLockerService` returns false for courier codes | `courier_standard`, `inpost_courier_standard` → `false` |
| `GET /api/shipping-carriers/providers` returns array | Response has `providers` array; each entry has `providerKey` string |
| `GET /api/shipping-carriers/providers` returns 401 unauthenticated | Unauthenticated request → 401 |
| TC-INPOST-001: InPost appears in provider list | `GET /api/shipping-carriers/providers` response includes `{ providerKey: 'inpost' }` |
| TC-INPOST-002: Rates return 4 services in PLN | `POST /api/shipping-carriers/rates` returns `locker_standard`, `locker_economy`, `courier_standard`, `courier_c2c` with PLN amounts |
| `cancelShipment` throws immediately (no HTTP call) | `inpostErrors.cancelNotSupported()` thrown; `cancelShipment` mock never called |
| `TC-INPOST-003`: Cancel InPost shipment returns 502 not-supported | `POST /api/shipping-carriers/cancel` → 502; body `error` contains "InPost does not support shipment cancellation via API" |
| `TC-INPOST-004`: Repeated cancel attempts consistently return 502 | Both first and second cancel calls return 502 with same error message |

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
| Status mapping covers all known statuses + unknown fallback | Compliant | 19 statuses mapped |
| Env preconfiguration with canonical `OM_INTEGRATION_INPOST_*` | Compliant | `lib/preset.ts` implements pattern |
| ACL features + `setup.ts` `defaultRoleFeatures` | Compliant | Both declared |
| No hardcoded user-facing strings | Compliant | All strings in `i18n/*.json` |
| No `any` types | Compliant | Explicit types used throughout |
| Health check validates real connectivity | Compliant | `GET /v1/organizations/{orgId}` |
| API spec included in package | Compliant | `postman_collection/` contains ShipX Postman collection |

### Verdict

**Implemented.**

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-14 | Initial spec created for issue #915 |
| 2026-03-14 | Audit against ShipX Postman collection: fixed address shape (nested `address` key, `post_code`), parcel shape (courier dimensions/weight, locker lowercase template), replaced `locker_express` with `locker_economy`, added `custom_attributes.target_point`, added contact fields from credentials, noted cancelShipment has no official API endpoint, added `isLockerService` helper, added `errors.ts` to layout, renamed `api_spec/` to `postman_collection/`, added `de.json`/`es.json` to i18n list |
| 2026-03-14 | Introduced `chance@1.1.13` as devDependency; refactored all 6 test files to use randomised test data via factory helpers (`makeCredentials`, `makeAddress`, `makePackage`, `makeShipmentInput`, `makeScope`, `makeWebhookBody`, `makeOkFetch`) — eliminates hardcoded strings/IDs/values, test count grows to 86 |
| 2026-03-15 | Added Sales/Shipments Hub integration: 3-step wizard page (`/backend/shipping-carriers/create`), `GET /api/shipping-carriers/providers` endpoint, i18n keys (EN + PL), integration test TC-SHIP-008; fixed destination-only prefill from order addresses (billing address no longer used as origin) |
| 2026-03-15 | Wizard refactored into colocated component and hook files; API calls extracted from `useShipmentWizard` into standalone `shipmentApi.ts` (pure async functions, no React); `ts-pattern` `match()` applied in three places: step dispatch in `page.tsx` (exhaustive), render-state dispatch in `ProviderStep.tsx` (loading/error/empty/loaded with `P.string` and empty-array patterns), per-step CSS class in `WizardNav.tsx` (replaces nested ternary), and `ok`/`result` result handling across all four functions in `shipmentApi.ts` (`P.not(P.nullish)` guard); 35 unit tests added (17 for `shipmentApi`, 18 for `useShipmentWizard`) |
| 2026-03-15 | AC6: Added `ShipmentCancelNotAllowedError` to `shipping_carriers/lib/status-sync.ts`; `cancelShipment` in `shipping-service.ts` now checks `isValidShippingTransition` before calling adapter and throws `ShipmentCancelNotAllowedError` for terminal statuses; cancel route returns 422 for this error; 7 unit tests added in `shipping-service-cancel.test.ts`; `cancelNotAllowed` error variant added to `carrier-inpost/lib/errors.ts` |
| 2026-03-15 | AC9: Demo page created at `packages/carrier-inpost/src/modules/carrier_inpost/backend/carrier-inpost/demo/` with 6 sections (provider check, rate calculator, create shipment, track shipment, cancel shipment, webhook log); `ts-pattern` used throughout; `~30` i18n keys added to `en.json` and `pl.json` |
| 2026-03-15 | AC11: Integration tests added under `packages/carrier-inpost/src/modules/carrier_inpost/__integration__/`: `meta.ts`, `TC-INPOST-001.spec.ts` (provider list), `TC-INPOST-002.spec.ts` (rates 4 services PLN), `TC-INPOST-003.spec.ts` (cancel label_created → 200), `TC-INPOST-004.spec.ts` (cancel cancelled → 422) |
| 2026-03-15 | Tracking widget: declared `detail:sales.order:shipping` injection spot in `SalesDocumentDetailPage` after `SalesShipmentsSection`; created `widgets/injection/inpost-tracking/widget.ts` + `widget.client.tsx` — fetches sales shipments by orderId, finds InPost shipment via `_carrier.providerKey`, calls tracking API, renders status badge + events timeline using `ts-pattern`; registered in `widgets/injection-table.ts`; 9 i18n keys added for tracking to `en.json` and `pl.json` |
| 2026-03-15 | End-to-end demo page fixes and ShipX API conformance: `calculateRatesSchema` extended with `receiverPhone`/`receiverEmail`; `createShipmentSchema` extended with `senderPhone`, `senderEmail`, `receiverPhone`, `receiverEmail`, `targetPoint`; `shippingCarrierService.calculateRates()` and `createShipment()` accept and merge per-request contact/targetPoint overrides on top of stored credentials; adapter `buildContactAddress` now always emits `building_number` (`addr.line2 ?? '1'`); removed hardcoded phone/email fallbacks from adapter `calculateRates`; demo page updated with receiver/sender contact fieldsets, locker point ID field, fixed `DEMO_ORDER_ID` to valid Zod v4 UUID, corrected `ShipmentRecord` interface (`id`→`shipmentId`, `unifiedStatus`→`status`); adapter fallback test updated to assert `undefined` contact; DB migration run to create `carrier_shipments` table |
| 2026-03-15 | Live sandbox testing against InPost ShipX API revealed two critical behaviours: (1) `createShipment` uses an offer-based two-step flow — `POST /shipments` returns `offer_selected` status with an `offers` array; must then call `POST /shipments/{id}/buy` with `{ offer_id }` to confirm; tracking number is on `bought.tracking_number` or `bought.parcels[0].tracking_number`. Adapter updated with buy step; tracking number resolution priority chain added; buy step skipped when no offer present. (2) `cancelShipment` DELETE endpoint does not exist in the ShipX API (confirmed via Postman collection); adapter now throws `inpostErrors.cancelNotSupported()` immediately; cancel route returns 502 with error message; `cancelNotSupported()` error factory added to `errors.ts`; spec API contracts table, cancelShipment section, risks table, and credentials helpText all updated to reflect live findings. Org ID is a numeric integer (not a UUID) — `OM_INTEGRATION_INPOST_ORGANIZATION_ID` must store the integer org ID; use `GET /v1/organizations` to discover it. |
| 2026-03-15 | Wizard contact fields: `ContactInfo` and `ContactFieldsProps` types added to `types.ts`; `receiverPhone`/`receiverEmail` on `FetchRatesParams`; all 5 contact/locker fields on `CreateShipmentParams`; `useShipmentWizard` state + setters for `senderContact`, `receiverContact`, `targetPoint`; `ConfigureStep` sender/receiver contact cards + locker point card; `ConfirmStep` contact + targetPoint in summary; `page.tsx` props wired; `i18n/en.json` + `pl.json` new wizard keys; 11 new tests in `shipmentApi.test.ts`, 9 new in `useShipmentWizard.test.tsx` |
| 2026-03-15 | Integration tests TC-INPOST-003 and TC-INPOST-004 rewritten to match cancel-not-supported behaviour: TC-INPOST-003 now asserts 502 + "InPost does not support shipment cancellation via API" error; TC-INPOST-004 now asserts both first and second cancel calls return 502 consistently (no state mutation) |
| 2026-03-15 | `i18n/de.json` and `i18n/es.json` completed: all 47 keys from `en.json` now present in both German and Spanish, including `carrier_inpost.demo.*` (demo page) and `carrier_inpost.tracking.*` (tracking widget) sections |
| 2026-03-15 | `shipping_carriers` module audit: `shipping-service-cancel.test.ts` extended with two new tests in "adapter error propagation" describe block — (1) adapter-throws re-throws to caller, (2) `em.flush` and `emitShippingEvent` are NOT called when adapter throws (unifiedStatus stays unchanged); `emitShippingEvent` import added for assertion use |
