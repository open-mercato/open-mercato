# SPEC-045c — Payment & Shipping Hubs Alignment

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 3 of 6

---

## Goal

Align the existing `payment_gateways` hub (SPEC-044) with the integration framework and build the `shipping_carriers` hub module.

---

## 1. Payment Gateways — Marketplace Alignment

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
