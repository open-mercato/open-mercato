# SPEC-045c — Payment & Shipping Hubs Alignment

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 3 of 6

---

## Goal

Align the existing `payment_gateways` hub (SPEC-044) with the integration framework and build the `shipping_carriers` hub module.

---

## 1. Payment Gateways — Marketplace Alignment

**Reference implementation**: [SPEC-045h — Stripe Payment Gateway](./SPEC-045h-stripe-payment-gateway.md) — full end-to-end example with versioned adapters, webhook processing, widget injection for config, and integration tests.

See SPEC-044 §17 for full details. Summary of changes:

1. Provider modules (`gateway_stripe`, `gateway_payu`, `gateway_przelewy24`) declare `integration.ts`
2. API keys move from `SalesPaymentMethod.providerSettings` to `IntegrationCredentials`
3. Per-method config (capture mode, payment types) stays in `providerSettings`
4. `registerPaymentProvider()` kept for backward compatibility
5. Health checks implemented per provider (Stripe: `stripe.accounts.retrieve()`)
6. Provider adapters use `integrationLog` for webhook processing and error logging
7. Integration detail page links to payment methods page

---

## 2. Shipping Carriers Hub — `shipping_carriers`

### 2.1 ShippingAdapter Contract

```typescript
// shipping_carriers/lib/adapter.ts

interface ShippingAdapter {
  readonly providerKey: string

  /** Calculate shipping rates for given items + destination */
  calculateRates(input: CalculateRatesInput): Promise<ShippingRate[]>

  /** Create a shipment / generate label */
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>

  /** Get tracking info */
  getTracking(input: GetTrackingInput): Promise<TrackingResult>

  /** Cancel a shipment */
  cancelShipment(input: CancelShipmentInput): Promise<CancelShipmentResult>

  /** Verify webhook from carrier (tracking updates) */
  verifyWebhook(input: VerifyWebhookInput): Promise<ShippingWebhookEvent>

  /** Map carrier status to unified shipment status */
  mapStatus(carrierStatus: string): UnifiedShipmentStatus
}

type UnifiedShipmentStatus =
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed_delivery'
  | 'returned'
  | 'cancelled'
  | 'unknown'

interface CalculateRatesInput {
  origin: Address
  destination: Address
  packages: PackageInfo[]
  credentials: Record<string, unknown>
}

interface ShippingRate {
  serviceCode: string
  serviceName: string
  amount: number
  currencyCode: string
  estimatedDays?: number
  guaranteedDelivery?: boolean
}

interface CreateShipmentInput {
  orderId: string
  origin: Address
  destination: Address
  packages: PackageInfo[]
  serviceCode: string
  credentials: Record<string, unknown>
  labelFormat?: 'pdf' | 'zpl' | 'png'
}

interface CreateShipmentResult {
  shipmentId: string     // Carrier's shipment ID
  trackingNumber: string
  labelUrl?: string      // URL to download label
  labelData?: string     // Base64-encoded label
  estimatedDelivery?: Date
}
```

### 2.2 Module Structure

```
packages/core/src/modules/shipping_carriers/
├── index.ts
├── acl.ts
├── di.ts                        # Shipping service + adapter registry
├── events.ts
├── setup.ts
├── lib/
│   ├── adapter.ts               # ShippingAdapter interface + types
│   ├── adapter-registry.ts
│   ├── shipping-service.ts      # High-level service (calculate, create, track, cancel)
│   ├── status-sync.ts           # Carrier status → SalesShipment update
│   └── webhook-utils.ts
├── data/
│   ├── entities.ts              # CarrierShipment (parallel to GatewayTransaction)
│   └── validators.ts
├── api/
│   ├── post/shipping-carriers/rates.ts      # Calculate rates
│   ├── post/shipping-carriers/shipments.ts  # Create shipment
│   ├── get/shipping-carriers/tracking.ts    # Get tracking
│   ├── post/shipping-carriers/cancel.ts     # Cancel shipment
│   └── webhook/[provider]/route.ts          # Dynamic webhook routing
├── workers/
│   ├── webhook-processor.ts
│   └── tracking-poller.ts       # Fallback tracking poll
├── widgets/
│   ├── injection-table.ts
│   └── injection/
│       ├── create-shipment-button/
│       ├── tracking-status-badge/
│       └── tracking-column/
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 2.3 UMES Integration Points

Same pattern as SPEC-044:
- **Widget injection**: "Create Shipment" button on order detail, tracking badge on shipment list
- **Response enricher**: Carrier tracking data enriched on `SalesShipment`
- **API interceptor**: Validate carrier config before shipment creation
- **Column injection**: Tracking status column on shipments table

### 2.4 First Provider Example — `carrier_inpost`

```
packages/core/src/modules/carrier_inpost/
├── index.ts
├── integration.ts       # category: 'shipping', hub: 'shipping_carriers'
├── setup.ts             # registerShippingAdapter(inpostAdapter)
├── lib/
│   └── adapter.ts       # ShippingAdapter implementation
└── i18n/
    ├── en.ts
    └── pl.ts
```

---

## 3. Implementation Steps

### Payment Gateway Alignment
1. Add `integration.ts` to `gateway_stripe`, `gateway_payu`, `gateway_przelewy24`
2. Refactor credential resolution to use `integrationCredentials` DI service
3. Add `integrationLog` usage to webhook processor and status poller workers
4. Implement `HealthCheckable` for Stripe
5. Keep `registerPaymentProvider()` for backward compatibility

### Shipping Carriers Hub
1. Create `shipping_carriers` hub module with adapter contract
2. Create `CarrierShipment` entity
3. Implement shipping service, adapter registry, status sync
4. Create dynamic webhook routing endpoint
5. UMES extensions (button, badge, column, enricher)
6. Create `carrier_inpost` as first provider module
7. Integration tests for rate calculation, shipment creation, webhook processing, tracking poll

---

## 4. API Contracts

All endpoints below MUST export `openApi` and enforce tenant scope (`organizationId`, `tenantId`) from auth context.

### 4.1 Shipping Rates

`POST /api/shipping-carriers/rates`

Request:

```json
{
  "providerKey": "inpost",
  "origin": { "countryCode": "PL", "postalCode": "00-001", "city": "Warsaw", "line1": "Street 1" },
  "destination": { "countryCode": "PL", "postalCode": "30-001", "city": "Krakow", "line1": "Street 2" },
  "packages": [{ "weightKg": 1.2, "lengthCm": 20, "widthCm": 12, "heightCm": 8 }]
}
```

Response `200`:

```json
{
  "rates": [
    {
      "serviceCode": "locker_standard",
      "serviceName": "InPost Locker Standard",
      "amount": 12.5,
      "currencyCode": "PLN",
      "estimatedDays": 1
    }
  ]
}
```

### 4.2 Create Shipment

`POST /api/shipping-carriers/shipments`

Request:

```json
{
  "providerKey": "inpost",
  "orderId": "uuid",
  "serviceCode": "locker_standard",
  "labelFormat": "pdf"
}
```

Response `201`:

```json
{
  "shipmentId": "uuid",
  "trackingNumber": "INP123456789",
  "status": "label_created"
}
```

### 4.3 Tracking Lookup

`GET /api/shipping-carriers/tracking?providerKey=inpost&trackingNumber=INP123456789`

Response `200`:

```json
{
  "trackingNumber": "INP123456789",
  "status": "in_transit",
  "events": [
    { "status": "picked_up", "occurredAt": "2026-03-04T09:00:00Z", "location": "Warsaw" }
  ]
}
```

### 4.4 Cancel Shipment

`POST /api/shipping-carriers/cancel`

Request:

```json
{
  "providerKey": "inpost",
  "shipmentId": "uuid",
  "reason": "customer_request"
}
```

Response `200`:

```json
{ "status": "cancelled" }
```

### 4.5 Carrier Webhooks

`POST /api/shipping-carriers/webhook/[provider]`

Behavior:
- Verify provider signature
- Enqueue normalized webhook event to worker
- Return `202` when accepted
- Return `401/403` for signature mismatch

### 4.6 Error Contract

Common error codes:
- `422`: validation failed / unsupported provider / unsupported service
- `409`: duplicate shipment creation request (idempotency collision)
- `502`: provider upstream error

Payment alignment endpoints continue to use SPEC-044 contracts; only credential resolution source is changed by migration bridge.

---

## 5. Risks & Impact Review

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Payment credential migration breaks live methods | Failed payment authorization/capture | Dual-read/dual-write bridge for one minor version, migration job, rollback flag |
| Webhook replay/duplication | Duplicate shipment/payment state transitions | Idempotency keys per provider event id + processed-event dedup store |
| Signature verification misconfiguration | Rejected legitimate updates or accepted forged requests | Per-provider verification tests + strict clock skew window + explicit error telemetry |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Carrier polling/webhook status race | Flapping shipment status in UI | Monotonic status transition rules + timestamp precedence |
| Provider API latency spikes | Timeout during shipment/rates calls | Retry policy with bounded backoff + circuit breaker health state |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Missing i18n strings for new shipping widgets | UI fallback copy visible | Add locale keys in same PR and include smoke tests |

---

## 6. Integration Test Coverage

| Test | Method | Assert |
|------|--------|--------|
| Payment provider reads new credentials first | Payment flow | Uses `IntegrationCredentials` when present |
| Payment provider falls back to legacy settings | Payment flow | Uses `providerSettings` when new credentials missing |
| Payment config dual-write bridge | API/UI | Save updates both credential stores during migration window |
| Shipping rates happy path | POST `/api/shipping-carriers/rates` | Returns normalized rate list |
| Shipping rates invalid input | POST `/api/shipping-carriers/rates` | Returns 422 with field errors |
| Shipment create happy path | POST `/api/shipping-carriers/shipments` | Creates `CarrierShipment` + tracking number |
| Shipment create idempotency | POST repeated with same idempotency key | Returns same shipment result, no duplicate |
| Tracking lookup | GET `/api/shipping-carriers/tracking` | Returns mapped unified status/events |
| Shipment cancel | POST `/api/shipping-carriers/cancel` | Updates shipment status to `cancelled` |
| Webhook signature verification | POST webhook invalid signature | Rejects with 401/403 |
| Webhook processing | Worker | Maps provider status and updates linked `SalesShipment` |
| Tenant isolation | All shipping/payment routes | Cross-tenant access denied |
| UMES shipment widgets visible | UI integration | Button/badge/column render with expected context |

All integration tests MUST be self-contained (create fixtures in setup and clean up created records).

---

## 7. Migration & Backward Compatibility

1. **Payment credentials bridge**  
   Provider adapters resolve credentials in order:
   - `IntegrationCredentials` (new)
   - `SalesPaymentMethod.providerSettings` (legacy fallback)  
   Write path updates both during bridge period.

2. **`registerPaymentProvider()` stability**  
   Existing registration API remains unchanged. Marketplace metadata is additive via `integration.ts`.

3. **No route removals**  
   Existing payment routes from SPEC-044 remain stable. Shipping routes are additive.

4. **Schema strategy**  
   Add new `carrier_shipments` table and related indices only. No renames/removals in sales/payment schemas.

5. **Deprecation timeline**  
   Legacy `providerSettings` secret storage deprecation is announced in `RELEASE_NOTES.md`; removal not earlier than one minor release after dual-write rollout.

---

## 8. Final Compliance Report — 2026-03-04

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| backward | API/feature compatibility bridge | Compliant | Payment credentials dual-read/dual-write defined |
| core | API routes with `openApi` + guards | Compliant | Required for all new shipping routes |
| core | Command pattern for writes | Compliant | Shipment create/cancel and payment write flows implemented via commands |
| core | Tenant isolation | Compliant | Scope from auth context, never request body |
| events/queue | Idempotent webhook and worker processing | Compliant | Dedup + retry-safe worker behavior required |

### Verdict

**Ready for implementation after bridge-first rollout is followed.**

---

## 9. Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial phase draft for payment/shipping alignment |
| 2026-03-04 | Added API contract details, risk matrix, integration test matrix, and migration/BC bridge plan |
