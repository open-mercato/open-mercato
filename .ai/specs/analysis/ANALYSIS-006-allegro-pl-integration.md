# ANALYSIS-006 — Allegro.pl Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Platform** | [Allegro.pl](https://allegro.pl) — largest Polish e-commerce marketplace |
| **API Docs** | [developer.allegro.pl](https://developer.allegro.pl/documentation) |
| **Framework Spec** | [SPEC-045 — Integration Marketplace](../SPEC-045-2026-02-24-integration-marketplace.md) |
| **Verdict** | **Feasible with workarounds** — 80% coverage using existing framework; polling gap and category complexity are the main challenges |

---

## 1. Executive Summary

Allegro.pl is a Polish marketplace with a mature REST API covering offers, orders, shipments, payments, returns, and messaging. The Open Mercato Integration Marketplace framework (SPEC-045) can support an Allegro integration as an **integration bundle** (`sync_allegro`) delivering multiple data sync adapters plus a shipping adapter. The majority of functionality maps cleanly to existing adapter contracts. Two significant gaps exist: **no webhook support** (Allegro uses polling-only events) and **complex category/parameter requirements** that go beyond our current catalog model.

---

## 2. Allegro API Overview

| Aspect | Details |
|--------|---------|
| **API Style** | RESTful, JSON, OpenAPI 3.0 |
| **Base URL** | `https://api.allegro.pl` |
| **Sandbox** | `https://api.allegro.pl.allegrosandbox.pl` |
| **Authentication** | OAuth 2.0 (Authorization Code + PKCE, Device Flow, Client Credentials) |
| **Token Lifetime** | 12 hours access token, refresh tokens available |
| **Versioning** | Media type: `application/vnd.allegro.public.v1+json` (no URL versioning) |
| **Rate Limits** | 9,000 req/min per Client ID + per-endpoint limits |
| **Webhooks** | **Not available** — polling only |
| **Locales** | pl-PL, en-US, uk-UA, sk-SK, cs-CZ, hu-HU |

### 2.1 API Domains

| Domain | Key Endpoints | Relevance |
|--------|--------------|-----------|
| **Offer Management** | `/sale/product-offers`, `/sale/offers`, batch price/quantity commands | Core — maps to `catalog.product` export |
| **Products & Categories** | `/sale/products`, `/sale/categories` | Core — product matching, category tree |
| **Orders** | `/order/checkout-forms`, `/order/events` | Core — maps to `sales.order` import |
| **Shipment Management** | `/shipment-management/shipments`, labels, pickups | Core — maps to `shipping_carriers` hub |
| **Payments & Billing** | `/payments/refunds`, `/billing/billing-entries` | Important — refund processing, commission tracking |
| **Customer Communication** | `/sale/issues` (discussions, complaints) | Nice-to-have — maps to future messaging module |
| **Returns** | `/order/customer-returns`, `/order/refund-claims` | Important — return management |
| **Promotions** | `/sale/badge-campaigns`, `/sale/badges` | Nice-to-have — Allegro-specific badges |
| **One Fulfillment** | ASN, stock tracking, removal | Optional — Allegro's FBA equivalent |

---

## 3. Integration Architecture

### 3.1 Proposed Bundle Structure

The integration would be delivered as an **integration bundle** (one npm package, multiple integrations):

```
packages/core/src/modules/sync_allegro/
├── integration.ts          # Bundle + 6 integration definitions
├── index.ts
├── di.ts
├── acl.ts
├── setup.ts
├── lib/
│   ├── allegro-client.ts       # HTTP client with rate limiting + auth
│   ├── auth.ts                 # OAuth 2.0 token management
│   ├── category-mapper.ts      # Allegro category → OM category mapping
│   ├── offer-builder.ts        # OM product → Allegro offer builder
│   ├── order-mapper.ts         # Allegro order → OM sales order
│   ├── polling-engine.ts       # Event polling for orders + offers
│   └── shared.ts               # Common types, helpers
├── adapters/
│   ├── products-export.ts      # DataSyncAdapter — export products as Allegro offers
│   ├── orders-import.ts        # DataSyncAdapter — import orders from Allegro
│   ├── inventory-sync.ts       # DataSyncAdapter — bidirectional stock sync
│   ├── returns-import.ts       # DataSyncAdapter — import customer returns
│   ├── billing-import.ts       # DataSyncAdapter — import billing/commission data
│   └── shipping.ts             # ShippingAdapter — Allegro shipment management
├── workers/
│   ├── order-poller.ts         # Polls /order/events on schedule
│   └── offer-poller.ts         # Polls /sale/offer-events on schedule
├── data/
│   ├── entities.ts             # AllegroOfferMapping, AllegroCategoryCache
│   └── validators.ts
├── backend/
│   └── allegro/
│       ├── categories/page.tsx # Category mapping UI
│       └── settings/page.tsx   # Connection settings
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 3.2 Integration Definitions

```typescript
// sync_allegro/integration.ts

export const bundle: IntegrationBundle = {
  id: 'sync_allegro',
  title: 'Allegro.pl',
  description: 'Sell on Allegro.pl — sync products, orders, inventory, and shipments.',
  icon: 'allegro',
  package: '@open-mercato/sync-allegro',
  credentials: {
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
      // OAuth tokens managed automatically via OAuth 2.0 credential type (SPEC-045a §8)
    ],
  },
}

export const integrations: IntegrationDefinition[] = [
  { id: 'allegro_products', category: 'data_sync', hub: 'data_sync', ... },
  { id: 'allegro_orders', category: 'data_sync', hub: 'data_sync', ... },
  { id: 'allegro_inventory', category: 'data_sync', hub: 'data_sync', ... },
  { id: 'allegro_returns', category: 'data_sync', hub: 'data_sync', ... },
  { id: 'allegro_billing', category: 'data_sync', hub: 'data_sync', ... },
  { id: 'allegro_shipping', category: 'shipping', hub: 'shipping_carriers', ... },
]
```

---

## 4. Feature-by-Feature Feasibility Matrix

### Legend
- **Full** — maps directly to existing framework contracts, no workarounds needed
- **Partial** — feasible but requires extra work, workarounds, or custom entities
- **Gap** — cannot be done with current framework; requires new capabilities or is an Allegro limitation
- **N/A** — not applicable or out of scope

### 4.1 Authentication & Credentials

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| OAuth 2.0 Authorization Code + PKCE | **Full** | SPEC-045a §8 OAuth credential type handles this exactly — consent screen, token storage, background refresh |
| Token refresh (12h lifetime) | **Full** | OAuth credential worker handles automatic renewal |
| Client Credentials flow | **Full** | Standard credential fields |
| Sandbox vs Production toggle | **Full** | Add a `environment` credential field (`select: sandbox/production`) that switches base URL |
| 10-second auth code window | **Partial** | Tight window; our OAuth flow must exchange immediately. Framework supports this but needs careful implementation |

### 4.2 Product/Offer Management (Export)

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Create offers from OM products | **Partial** | Allegro uses "product-linked offers" model — must match OM product to Allegro product catalog first, then create offer. Requires `category-mapper.ts` |
| Batch price updates | **Full** | `/sale/offer-price-change-commands` maps to `streamExport` batches |
| Batch quantity updates | **Full** | `/sale/offer-quantity-change-commands` maps to `streamExport` batches |
| Activate/deactivate offers | **Full** | `/sale/offer-publication-commands` (up to 1,000 per call) |
| Allegro category mapping | **Partial** | See [Section 5.1 — Category Complexity](#51-category--parameter-complexity-high) |
| Required category parameters | **Gap** | Allegro requires category-specific parameters (e.g., RAM, screen size for laptops). OM has no equivalent structured attribute system. Must build custom parameter mapping UI |
| Product images upload | **Full** | Standard image upload API |
| Offer descriptions (HTML) | **Full** | Maps to OM product description field |
| Multi-variant offers | **Partial** | Allegro has its own variant model (color/size parameters). Mapping from OM `CatalogProductVariant` requires translation layer |
| Draft offer limit (20,000) | **Full** | Rate limiter handles this; sync engine tracks counts |

### 4.3 Order Management (Import)

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Import orders | **Full** | `/order/checkout-forms` → `SalesOrder` + `SalesOrderLine` mapping is straightforward |
| Order event polling | **Partial** | No webhooks — must use `/order/events` polling. See [Section 5.2 — No Webhooks](#52-no-webhook-support-high) |
| Customer data extraction | **Full** | Allegro provides buyer info in checkout forms → maps to `CustomerEntity` + `CustomerPersonProfile` |
| Shipping address import | **Full** | Direct field mapping to `SalesDocumentAddress` |
| Order status updates (export) | **Full** | `PUT /order/checkout-forms/{id}/fulfillment` — update fulfillment status from OM |
| Payment status tracking | **Full** | Payment data in checkout form → `SalesPayment` |
| Multiple currencies (PLN focus) | **Full** | OM currencies module handles multi-currency; Allegro is primarily PLN |
| Order line items with pricing | **Full** | Direct mapping: quantity, unit price, tax, discounts → `SalesOrderLine` |

### 4.4 Shipment Management

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Create shipments | **Full** | Maps to `ShippingAdapter.createShipment()` |
| Generate shipping labels | **Full** | `/shipment-management/label` → label download |
| Schedule pickups | **Full** | `/shipment-management/pickups/create-commands` |
| Tracking number sync | **Full** | `POST /order/checkout-forms/{id}/shipments` — send tracking from OM → Allegro |
| Available delivery services | **Full** | `/shipment-management/delivery-services` maps to `calculateRates()` |
| Cancel shipments | **Full** | Maps to `cancelShipment()` |
| Carrier status mapping | **Full** | Allegro statuses → `UnifiedShipmentStatus` enum |
| Webhook for tracking updates | **Gap** | No Allegro webhooks — must poll for tracking status changes |

### 4.5 Returns & Refunds

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Import customer returns | **Partial** | `/order/customer-returns` — OM doesn't have a dedicated returns module yet; would need to map to order status + credit memos |
| Process refunds | **Partial** | `/payments/refunds` + `/order/refund-claims` — maps to `SalesCreditMemo` but requires payment gateway coordination |
| Return reason tracking | **Partial** | Allegro provides return reasons; OM would store in metadata |

### 4.6 Communication & Disputes

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Customer messaging (issues) | **Partial** | `/sale/issues` — would need SPEC-045d communication hub or custom backend pages. No existing OM messaging module for marketplace disputes |
| Attachment handling | **Partial** | Allegro supports attachments on issues; needs storage integration |
| Complaint management | **Gap** | Allegro-specific complaint flow (quality, delivery, description mismatch) has no OM equivalent |

### 4.7 Billing & Analytics

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Commission/fee tracking | **Partial** | `/billing/billing-entries` — importable via data sync but OM has no billing/fee entity. Would store as custom metadata or extend financial module |
| Sales analytics from Allegro | **Partial** | Limited analytics in API; mostly retrievable via offer events |

### 4.8 Promotions & Campaigns

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Badge campaigns | **Gap** | Allegro-specific promotional badges. No OM equivalent. Would need custom UI |
| Promotion packages | **Gap** | Allegro-specific offer promotion system. Not mappable to OM |

### 4.9 One Fulfillment (Allegro FBA)

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| Advance Ship Notices | **Gap** | Allegro-specific fulfillment; OM has no warehouse management module |
| Inventory in Allegro warehouses | **Gap** | Would require deep warehouse integration |
| Removal orders | **Gap** | Not applicable without full One Fulfillment support |

---

## 5. Key Challenges & Risks

### 5.1 Category & Parameter Complexity (HIGH)

**Problem**: Allegro requires sellers to assign offers to specific categories from a ~30,000-node category tree, and each category has **mandatory parameters** (e.g., RAM capacity for laptops, fabric type for clothing). These parameters are not free-form — they have predefined values that change per category.

**Impact on OM**: Our `CatalogProductCategory` is a simple name/slug/tree structure. We have no concept of "required category parameters with enumerated values." This means:

1. **Category mapping UI** — Need a dedicated admin page where the user maps OM categories → Allegro categories. Must cache the Allegro category tree locally (it's large).
2. **Parameter filling** — For each mapped category, the user must define how to fill Allegro's required parameters. Options:
   - Manual: user fills parameters per-product in a custom UI
   - Automatic: map OM custom fields → Allegro parameters (if custom fields exist)
   - Default: set default parameter values per category mapping
3. **Category tree caching** — Allegro's category API is slow for full tree traversal. Need a local `AllegroCategoryCache` entity that syncs periodically.

**Mitigation**:
- Build a `category-mapper.ts` with admin UI at `/backend/allegro/categories/`
- Store mappings in a new `AllegroOfferMapping` entity
- Use OM custom fields (`ce.ts`) to let users add Allegro-specific attributes to products
- Cache category tree with daily refresh via scheduler

**Effort**: High — this is the most complex part of the integration, estimated at 40% of total development time.

### 5.2 No Webhook Support (HIGH)

**Problem**: Allegro does **not** support webhooks. All event-driven data (new orders, offer status changes) must be retrieved via polling endpoints:
- `/order/events` — order lifecycle events
- `/sale/offer-events` — offer changes (last 24 hours only)

**Impact on OM**: Our framework is designed around webhooks (SPEC-045e webhook hub) and event-driven subscribers. A polling-based integration requires:

1. **Polling workers** — Dedicated workers that run on a schedule (e.g., every 2 minutes for orders, every 5 minutes for offers)
2. **Cursor management** — Must persist the last event ID from each polling endpoint to avoid reprocessing
3. **24-hour event window** — Offer events are only available for 24 hours. If polling fails for >24h, events are lost. Need alerting and a fallback full-sync mechanism.
4. **Latency** — Orders won't appear in OM instantly; there's a 2-5 minute delay depending on poll interval.

**Mitigation**:
- Use `packages/scheduler` (`schedulerService.register()`) with 2-minute cron for order polling and 5-minute for offer polling
- Persist poll cursor in `SyncCursor` entity
- Implement a "catch-up" full sync if cursor is >20 hours old
- Add health monitoring alert if poll gap exceeds threshold
- Log poll results via `integrationLog` for debugging

**Effort**: Medium — the `data_sync` hub already supports cursor-based delta sync; polling is just another trigger mechanism.

### 5.3 Rate Limiting (MEDIUM)

**Problem**: Allegro enforces 9,000 requests/minute globally, with per-endpoint limits using a leaky bucket algorithm. Bulk operations have additional caps (250,000 offer changes/hour).

**Impact on OM**: The `rate-limiter.ts` token bucket in SPEC-045b covers this, but needs Allegro-specific configuration.

**Mitigation**:
- Configure `rate-limiter.ts` with Allegro's limits: 150 req/sec (safe margin below 9,000/min)
- Handle HTTP 429 responses with exponential backoff
- Batch operations where possible (price/quantity change commands support bulk)

**Effort**: Low — existing rate limiter infrastructure handles this.

### 5.4 OAuth Token Lifecycle (MEDIUM)

**Problem**: Access tokens expire after 12 hours. Authorization codes are valid for only 10 seconds — extremely tight window.

**Impact on OM**: The OAuth credential type (SPEC-045a §8) handles token refresh automatically. The 10-second auth code window requires the exchange to happen server-side immediately upon redirect callback.

**Mitigation**:
- Our OAuth flow already exchanges auth codes in the callback handler — should work within 10s
- Token refresh worker runs well before 12h expiry
- Implement refresh token rotation (Allegro may rotate refresh tokens)

**Effort**: Low — covered by existing OAuth infrastructure.

### 5.5 Sandbox Limitations (LOW)

**Problem**: Allegro sandbox has quarterly data purges, 7-day image persistence, and some order features may not work identically to production.

**Impact on OM**: Integration tests must account for sandbox instability. Cannot rely on persistent test fixtures.

**Mitigation**:
- Integration tests create fresh fixtures on each run
- Document sandbox limitations in admin setup guide
- Add environment toggle (sandbox/production) in credentials

### 5.6 No Returns Module in OM (MEDIUM)

**Problem**: Allegro has a full returns management flow (`/order/customer-returns`). OM currently has no dedicated returns/RMA module — only `SalesCreditMemo` for financial handling.

**Mitigation**:
- Phase 1: Import returns as order status updates + create credit memos for refunds
- Phase 2: If OM gets a returns module, wire up full bidirectional return sync

---

## 6. Field Mapping Analysis

### 6.1 Product → Allegro Offer

| OM Field (`CatalogProduct` / `CatalogProductVariant`) | Allegro Offer Field | Mapping Notes |
|-------------------------------------------------------|---------------------|---------------|
| `title` | `name` | Direct |
| `description` | `description.sections[].items[]` | Allegro uses structured description sections; needs HTML → section converter |
| `sku` | `external.id` | Used for matching |
| `defaultMediaUrl` | `images[].url` | Direct; must upload to Allegro first |
| `variants[].prices[].unitPriceGross` | `sellingMode.price.amount` | Currency conversion may apply |
| `variants[].prices[].unitPriceNet` | Calculated from gross + tax | Allegro is gross-price oriented |
| `variants[].barcode` | `ean` | Direct |
| Category assignment | `category.id` | Via category mapper |
| — | `parameters[]` | **No OM equivalent** — must be filled from custom fields or defaults |
| `weightValue` / `weightUnit` | `sizeTable`, shipping params | Partial mapping |
| `variants[].optionValues` | `parameters[]` (variant-level) | Requires translation |
| `isActive` | Publication status | `true` → activate, `false` → end offer |
| `metadata` | — | Not synced to Allegro |

### 6.2 Allegro Order → OM Sales Order

| Allegro Checkout Form Field | OM Field (`SalesOrder` / `SalesOrderLine`) | Mapping Notes |
|-----------------------------|---------------------------------------------|---------------|
| `id` | `externalReference` | Stored for bidirectional link |
| `buyer.login` | Customer lookup/creation | Create `CustomerEntity` if not exists |
| `buyer.email` | `CustomerPersonProfile.primaryEmail` (encrypted) | Via customer module |
| `buyer.address` | `SalesDocumentAddress` (shipping) | Direct field mapping |
| `invoice.address` | `SalesDocumentAddress` (billing) | Direct field mapping |
| `lineItems[].id` | `SalesOrderLine.metadata.allegroLineItemId` | For reference |
| `lineItems[].offer.name` | `SalesOrderLine.name` | Direct |
| `lineItems[].quantity` | `SalesOrderLine.quantity` | Direct |
| `lineItems[].price.amount` | `SalesOrderLine.unitPriceGross` | Allegro prices are gross |
| `lineItems[].offer.id` | `SalesOrderLine.productId` | Via `SyncExternalIdMapping` lookup |
| `payment.type` | `SalesPaymentMethod.code` | Map to OM payment method |
| `payment.paidAmount` | `SalesPayment.amount` | Direct |
| `delivery.method.name` | `SalesShippingMethod.name` | Map or create |
| `delivery.cost.amount` | `SalesOrder.shippingGrossAmount` | Direct |
| `summary.totalToPay.amount` | `SalesOrder.grandTotalGrossAmount` | Direct |
| `status` | `SalesOrder.status` | Map: `READY_FOR_PROCESSING` → active, etc. |
| `updatedAt` | Cursor for delta sync | ISO timestamp |

### 6.3 Shipping

| Allegro Shipment Field | OM ShippingAdapter | Mapping Notes |
|-----------------------|--------------------|---------------|
| Delivery services list | `calculateRates()` | Maps service codes + names |
| Create shipment result | `createShipment()` → `CreateShipmentResult` | `shipmentId`, `trackingNumber`, `labelUrl` all map directly |
| Cancel shipment | `cancelShipment()` | Direct |
| Tracking status | `getTracking()` → `TrackingResult` | Status mapping needed |
| Label PDF | `labelFormat: 'pdf'` in `CreateShipmentInput` | Direct |

---

## 7. Implementation Phases

### Phase 1: Foundation (2-3 weeks)
- OAuth 2.0 connection setup (using SPEC-045a §8 OAuth credential type)
- Allegro HTTP client with rate limiting
- Category tree caching and basic category mapper
- Admin settings page with sandbox/production toggle
- Health check (validate credentials against Allegro API)

### Phase 2: Product Export (3-4 weeks)
- Category mapping admin UI (biggest effort)
- Product → Allegro offer builder with parameter filling
- `DataSyncAdapter` for product export (create/update offers)
- Batch price and quantity update commands
- Image upload pipeline
- Offer activation/deactivation sync

### Phase 3: Order Import (2-3 weeks)
- Order polling worker (scheduler-based, 2-min interval)
- Allegro checkout form → `SalesOrder` mapper
- Customer creation/matching from buyer data
- Payment and shipping data extraction
- Order status export (fulfillment updates back to Allegro)
- Delta sync with cursor persistence

### Phase 4: Shipping (1-2 weeks)
- `ShippingAdapter` implementation for Allegro shipment management
- Label generation and download
- Tracking number sync (OM → Allegro)
- Delivery service listing

### Phase 5: Inventory & Returns (2 weeks)
- Bidirectional inventory/stock sync
- Offer event polling for stock change detection
- Customer return import (to credit memos)
- Refund processing

### Phase 6: Polish & Monitoring (1 week)
- Health monitoring integration (SPEC-045f)
- Admin dashboard widgets (sales stats, sync status)
- Error handling refinements
- Integration tests
- Documentation

**Total estimate**: 11-15 weeks for full implementation.

---

## 8. What Will Be Missing or Very Difficult

### 8.1 Cannot Implement (Allegro Limitations)

| Feature | Reason |
|---------|--------|
| Real-time order notifications | Allegro has no webhooks; 2-5 min delay unavoidable |
| Offer events older than 24h | Allegro purges events after 24 hours; if polling gaps, events are permanently lost |
| Delete shipping rate definitions | Allegro API has no DELETE endpoint for shipping rates |
| Auction-style listings | OM is not designed for auction/bidding mechanics |

### 8.2 Difficult but Possible (High Effort)

| Feature | Difficulty | Why |
|---------|-----------|-----|
| Category parameter mapping | Very High | ~30,000 categories with unique required parameters; needs full UI for mapping + per-product parameter editing |
| Structured offer descriptions | High | Allegro uses a specific description section format, not plain HTML. Needs a converter or custom editor |
| Multi-variant offers | High | Allegro's variant model (based on parameters) differs from OM's `CatalogProductVariant` with `optionValues` |
| Allegro promotions/badges | High | Entirely Allegro-specific; no OM equivalent data model |
| Buyer messaging/disputes | High | Needs communication hub (SPEC-045d) or custom pages |
| Commission tracking | Medium | OM financial module would need extension for marketplace fee tracking |
| One Fulfillment (FBA) | Very High | Full warehouse management integration; OM has no WMS module |

### 8.3 Missing OM Capabilities Needed

| Capability | Impact | Resolution |
|------------|--------|------------|
| Product attribute/parameter system | Cannot fill Allegro required parameters without it | Use custom fields (`ce.ts`) as workaround; long-term: build structured attributes |
| Returns/RMA module | Cannot fully manage Allegro returns | Map to credit memos for now |
| Marketplace fee tracking | Cannot track Allegro commissions properly | Extend financial module or use metadata |
| Dispute/complaint management | Cannot handle Allegro buyer complaints | Defer to Phase 2 with communication hub |

---

## 9. Framework Fit Assessment

| Framework Component | Allegro Fit | Score |
|--------------------|-------------|-------|
| **Integration Bundles** (SPEC-045) | Perfect — one package, multiple integrations sharing OAuth credentials | 10/10 |
| **OAuth 2.0 Credentials** (SPEC-045a §8) | Perfect — Authorization Code + PKCE, token refresh, all supported | 10/10 |
| **DataSyncAdapter** (SPEC-045b) | Good — `streamImport`/`streamExport` work for orders/products. Polling requires scheduler + custom workers | 8/10 |
| **Rate Limiter** (SPEC-045b) | Good — token bucket covers Allegro's leaky bucket model | 9/10 |
| **SyncCursor** delta tracking | Good — order events have cursors; offer events have IDs | 9/10 |
| **ShippingAdapter** (SPEC-045c) | Good — label, tracking, cancel all map directly | 9/10 |
| **Operation Logs** (SPEC-045a §3) | Perfect — structured logging for all sync operations | 10/10 |
| **Progress Module** (SPEC-004) | Perfect — progress bar during product export/import | 10/10 |
| **Scheduler** | Perfect — replaces missing webhooks with polling schedule | 10/10 |
| **Health Monitoring** (SPEC-045f) | Good — credential validation + API reachability | 9/10 |
| **Webhook Hub** (SPEC-045e) | N/A — Allegro has no webhooks; this hub is irrelevant | N/A |

**Overall Framework Score: 8.5/10** — The framework covers Allegro integration well. The main gap is that `DataSyncAdapter` assumes the external system pushes data or that we fetch on-demand, whereas Allegro requires continuous polling. The scheduler fills this gap adequately.

---

## 10. Recommendations

1. **Start with Order Import** — highest business value; polling pattern will inform other adapters
2. **Build category mapper early** — it's the hardest part and blocks product export
3. **Use scheduler for polling** — 2-min for orders, 5-min for offers, with health alerts for gaps >20min
4. **Implement in phases** — don't try to cover all Allegro features at once
5. **Consider structured product attributes** — if more marketplaces are planned (Amazon, eBay), invest in a proper attribute system now rather than hacking with custom fields
6. **Test against sandbox extensively** — but account for quarterly data purges and feature differences
7. **Monitor Allegro's webhook roadmap** — the community has been requesting webhooks for years; if/when added, refactor polling to webhooks

---

## 11. Comparison: Allegro vs Other Planned Integrations

| Aspect | Allegro.pl | MedusaJS (reference) | Shopify |
|--------|-----------|---------------------|---------|
| Authentication | OAuth 2.0 | API Key | OAuth 2.0 |
| Real-time events | Polling only | Webhooks | Webhooks |
| Product model | Offer-based (linked to catalog products) | Standard product/variant | Standard product/variant |
| Category complexity | Very high (30K categories, mandatory params) | None (flat tags) | Low (simple categories) |
| Rate limits | 9,000/min | Typically none | 2 req/sec (REST) |
| Integration difficulty | **High** | **Low** (reference impl) | **Medium** |
| Framework fit | 8.5/10 | 10/10 | 9/10 |

---

## 12. Conclusion

An Allegro.pl integration is **feasible** using the Open Mercato Integration Marketplace framework. The framework's bundle architecture, OAuth support, data sync engine, shipping adapter, and scheduler cover ~80% of what's needed out of the box.

The two hardest problems are:
1. **Category/parameter mapping** — Allegro's deep category tree with required parameters is a UX and data modeling challenge that will consume significant development effort
2. **Polling architecture** — no webhooks means building reliable polling workers with gap detection and catch-up mechanisms

Neither is a blocker. Both have clear mitigation paths within the existing framework. The integration would be a strong showcase of the framework's extensibility for marketplace connectors.
