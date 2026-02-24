# ANALYSIS-001 — Amazon.de (SP-API) Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Author** | Claude (AI-assisted analysis) |
| **Related Specs** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub), SPEC-045c (Payment & Shipping Hubs), SPEC-045h (Stripe reference) |
| **Amazon API** | Selling Partner API (SP-API) |
| **Target Marketplace** | Amazon.de (EU region, marketplace ID `A1PA6795UKMFR9`) |

---

## Executive Summary

Amazon.de integration via SP-API is **feasible within the SPEC-045 framework** but represents one of the most complex integrations due to Amazon's authentication model, rate limiting, notification infrastructure requirements, and Germany-specific regulatory compliance. The integration maps naturally to a **bundle** (`sync_amazon`) contributing 6-8 integrations across `data_sync`, `webhook`, and potentially `shipping` categories. However, several areas require framework-level extensions or workarounds that go beyond what SPEC-045 currently defines.

**Overall Verdict: Feasible with significant effort — 70% coverage out-of-the-box, 30% requires new work.**

---

## 1. Authentication — Major Challenge

### What Amazon Requires

SP-API uses a **dual-layer authentication** model unlike any provider currently planned:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **OAuth 2.0 (LWA)** | Login with Amazon — client_id + client_secret + refresh_token | Identity of the selling partner |
| **AWS SigV4** | IAM access key + secret key, request signing | Request-level integrity verification |
| **RDT** | Restricted Data Tokens (short-lived, per-request) | Access to PII (buyer names, addresses) |

### How It Maps to SPEC-045

| Amazon Requirement | SPEC-045 Capability | Gap? |
|--------------------|---------------------|------|
| LWA OAuth 2.0 (refresh token flow) | SPEC-045a §8 — OAuth 2.0 credential type with background token refresh | Partial fit — LWA is standard OAuth but Amazon also requires the selling partner to go through a consent flow in Seller Central, not a generic OAuth screen |
| AWS IAM credentials (access key + secret) | Credentials API — `type: 'secret'` fields | Covered — store as secret fields |
| AWS SigV4 request signing | Not covered | **GAP** — requires a custom HTTP client wrapper that signs every request with SigV4. No existing mechanism in the framework for request-level signing |
| Restricted Data Tokens | Not covered | **GAP** — requires an extra token exchange step before accessing PII. Must be implemented in the adapter layer |
| App registration in Seller Central | Out of scope (manual step) | Documented in setup guide |

### Assessment

- **OAuth token refresh**: Covered by SPEC-045a §8 background renewal worker.
- **AWS SigV4 signing**: Requires a dedicated `lib/sigv4-signer.ts` utility inside the Amazon adapter module. This is adapter-internal — no framework change needed, but it adds significant complexity.
- **RDT tokens**: Must be fetched on-demand before accessing order buyer info. Can be handled in adapter methods — no framework change needed but adds latency to order sync.

**Difficulty: HIGH** — The dual-layer auth is unique to Amazon and will require 300-500 lines of signing/token management code.

---

## 2. Product Sync (Catalog) — Moderate Challenge

### Amazon → Open Mercato (Import)

| Amazon Entity | Open Mercato Entity | Mapping Complexity |
|---------------|--------------------|--------------------|
| Catalog Item (ASIN) | `CatalogProduct` | Moderate — ASIN maps to product, SKU preserved |
| Listing (SKU) | `CatalogProductVariant` | Moderate — Amazon's listing = seller's SKU offering for an ASIN |
| Product Type Definitions | Option schemas | **HIGH** — Amazon's JSON schemas are massive, deeply nested, and marketplace-specific |
| Product images | Media (extension) | Simple — URL mapping |
| Categories (Browse Nodes) | `CatalogProductCategory` | Moderate — Amazon's category tree is flat IDs, not hierarchical slugs |
| Pricing (listing price) | `CatalogProductPrice` | Moderate — needs channel-scoped pricing (Amazon.de channel) |

### Open Mercato → Amazon (Export / Listing)

| Open Mercato Entity | Amazon API | Difficulty |
|---------------------|-----------|------------|
| `CatalogProduct` + variants | Listings Items API (`putListingsItem`) | **HIGH** — must conform to Product Type Definition JSON schemas; schemas vary by product type and marketplace |
| Pricing | Listings Items API (`patchListingsItem`) | Moderate — price update via partial patch |
| Product images | Feeds API (image feed) | Moderate |
| Categories | Automatic via Product Type | N/A — Amazon assigns browse nodes based on product type |

### Key Challenges

1. **Product Type Definitions**: Amazon's schemas are massive (hundreds of required/optional fields per product type). The `DataMapping` system in SPEC-045b supports field-level mapping, but the sheer size and variability of Amazon schemas would overwhelm a simple mapping UI. **Needs a specialized product type selector + schema-aware mapping builder.**

2. **ASIN matching**: When listing a product that already exists on Amazon (same UPC/EAN), you match to an existing ASIN. When creating a brand-new product, you create a new ASIN. The `matchStrategy` in SPEC-045b supports `sku` and `custom`, which covers this, but the adapter must handle both flows.

3. **Listing restrictions**: Some products/categories require approval (gated categories). The `Listings Restrictions API` must be checked before attempting to list. This is adapter-specific logic.

4. **Feed processing is async**: Bulk listing via JSON_LISTINGS_FEED is fire-and-forget with polling for results. SPEC-045b's async queue model handles this well.

**Difficulty: HIGH** for export (listing on Amazon), MODERATE for import.

---

## 3. Order Sync — Good Fit

### Amazon → Open Mercato (Import)

| Amazon Field | Open Mercato Field | Notes |
|--------------|-------------------|-------|
| AmazonOrderId | `SalesOrder.externalReference` | Direct map |
| OrderStatus | `SalesOrder.status` | Status mapping needed (Pending/Unshipped/Shipped/Canceled → OM workflow states) |
| OrderTotal | `SalesOrder.grandTotalGrossAmount` | Currency conversion if needed |
| OrderItems[].ASIN + SellerSKU | `SalesOrderLine.productId` + `productVariantId` | Lookup via `SyncExternalIdMapping` |
| OrderItems[].QuantityOrdered | `SalesOrderLine.quantity` | Direct map |
| OrderItems[].ItemPrice | `SalesOrderLine.unitPriceGross` | Direct map |
| ShippingAddress | `SalesOrder.shippingAddressSnapshot` | Requires RDT for PII access |
| BuyerInfo | `SalesOrder.customerSnapshot` | Requires RDT for PII access |
| FulfillmentChannel (AFN/MFN) | Custom field or tag | No native field; use custom fields or metadata |
| MarketplaceId | `SalesOrder.channel_id` | Map Amazon.de marketplace to a SalesChannel |

### Open Mercato → Amazon (Export)

| Action | Amazon API | Notes |
|--------|-----------|-------|
| Confirm shipment (FBM) | Orders API `confirmShipment` | Tracking number + carrier required |
| Cancel order | Not directly via API | Amazon handles cancellation; seller can only request |
| Refund | Not via Orders API | Handled via Seller Central or separate flow |

### Assessment

- **Import**: Excellent fit with SPEC-045b's delta streaming. `getOrders` supports `LastUpdatedAfter` for cursor-based delta sync. The `ORDER_CHANGE` notification (SQS) enables near-real-time sync.
- **Export**: Limited — mainly shipment confirmation for FBM orders. Fits the `ShippingAdapter` pattern from SPEC-045c.
- **PII access**: Every order import that needs buyer name/address requires an RDT token exchange, adding ~1 API call per order batch.

**Difficulty: MODERATE** — Good conceptual fit, PII handling adds complexity.

---

## 4. Inventory Sync — Gap in Open Mercato

### The Problem

**Open Mercato has no dedicated inventory module.** Stock tracking is only implied through `SalesOrderLine` quantity fields (`quantity`, `reservedQuantity`, `fulfilledQuantity`). Amazon requires explicit stock level management:

| Amazon Direction | What's Needed | Open Mercato Support |
|-----------------|---------------|---------------------|
| FBA inventory → OM | Read stock levels from Amazon fulfillment centers | **No entity to store it** |
| OM → FBM inventory | Push stock counts to Amazon for merchant-fulfilled items | **No source of truth for stock** |
| FBA notifications | React to `FBA_INVENTORY_AVAILABILITY_CHANGES` | Framework supports it, but no target entity |

### Workarounds

1. **Custom extension entity**: Create an `AmazonInventory` extension entity via `data/extensions.ts` that tracks stock levels per variant per fulfillment channel. This is adapter-specific, not a core module.
2. **Metadata fields**: Store Amazon inventory data in `CatalogProductVariant.metadata` — quick but not queryable/reportable.
3. **Future inventory module**: The `catalog.product.stock_low` event and low-stock notification subscriber suggest inventory is planned but not yet built.

### Assessment

**This is the single biggest gap.** A real Amazon integration needs a proper inventory source of truth. Without it:
- FBA inventory can be displayed (read-only) via a custom widget but not managed
- FBM inventory sync is one-directional at best (Amazon → display only)
- Stock reservation/allocation across channels (web + Amazon) is impossible

**Difficulty: HIGH** — Requires either a core inventory module (significant scope) or a limited adapter-specific workaround.

---

## 5. Pricing Sync — Good Fit with Caveats

### Amazon → Open Mercato

| Amazon Data | Open Mercato Mapping | Notes |
|-------------|---------------------|-------|
| Listing price | `CatalogProductPrice` (channel-scoped to Amazon.de) | Good fit — channel pricing |
| Competitive pricing (Buy Box) | No direct entity | Store in metadata or custom extension |
| Promotional pricing | `CatalogOffer` with date range | Partial fit — Amazon promotions are more complex |

### Open Mercato → Amazon

| Action | Amazon API | Notes |
|--------|-----------|-------|
| Update listing price | Listings Items API `patchListingsItem` | Works well |
| Competitive repricing | Product Pricing API + `ANY_OFFER_CHANGED` notification | Requires real-time notification processing |

### Assessment

- Channel-scoped pricing in Open Mercato maps well to Amazon marketplace pricing.
- Competitive pricing / repricing is a specialized use case that requires high-frequency polling or EventBridge notifications — feasible but complex.
- The `selectBestPrice` resolver pattern means Amazon prices can coexist with other channel prices cleanly.

**Difficulty: MODERATE**

---

## 6. Notifications & Real-Time Events — Significant Challenge

### Amazon's Notification Model

Amazon pushes notifications via **two AWS-specific mechanisms**:

| Mechanism | Supported Event Types | Open Mercato Compatibility |
|-----------|----------------------|---------------------------|
| **Amazon SQS** | ORDER_CHANGE, ANY_OFFER_CHANGED (2-3 types only) | **GAP** — requires polling an AWS SQS queue. No SQS consumer in the framework |
| **Amazon EventBridge** | All other types (30+ types including listings, inventory, feeds) | **GAP** — requires AWS EventBridge → webhook bridge. No native EventBridge consumer |

### The Problem

SPEC-045's webhook infrastructure expects **HTTP POST webhooks** from providers. Amazon does NOT send HTTP webhooks — it pushes to AWS infrastructure (SQS queues or EventBridge event buses). This is fundamentally different from Stripe/PayU/WhatsApp webhooks.

### Workarounds

1. **EventBridge → Lambda → HTTP webhook**: Deploy an AWS Lambda that receives EventBridge events and forwards them as HTTP POSTs to Open Mercato's webhook endpoint. This is the standard pattern but requires AWS infrastructure outside Open Mercato.

2. **SQS polling worker**: Create a dedicated worker that polls an SQS queue. This fits the `packages/queue` worker pattern but requires the AWS SDK and a new polling mechanism.

3. **Polling fallback**: For order sync, fall back to periodic `getOrders` polling (every 5-15 min). This is simpler but less real-time. The SPEC-045b scheduler integration handles this natively.

### Assessment

**This is a major architectural mismatch.** Every other integration in SPEC-045 assumes HTTP webhooks. Amazon is the first provider that requires AWS infrastructure as a notification bridge. The recommended approach is:
- Use **polling** for order/inventory sync (simpler, fits SPEC-045b scheduler)
- Document the **EventBridge → Lambda → webhook** bridge as an optional setup for real-time events
- Do NOT try to build SQS/EventBridge consumers into core — keep it adapter-specific

**Difficulty: HIGH** for real-time; MODERATE for polling-based approach.

---

## 7. Fulfillment (FBA/FBM) — Partial Fit

### FBM (Fulfilled by Merchant)

| Capability | SPEC-045c Coverage | Notes |
|-----------|-------------------|-------|
| Shipment confirmation | `ShippingAdapter.createShipment` → Orders API `confirmShipment` | Good fit |
| Tracking | `ShippingAdapter.getTracking` | Tracking is in the order, not a separate carrier API |
| Label generation | Not applicable | Amazon doesn't provide labels for FBM (use your own carrier) |
| Rate calculation | Not applicable | Shipping rates set by seller in Seller Central |

### FBA (Fulfilled by Amazon)

| Capability | SPEC-045c Coverage | Notes |
|-----------|-------------------|-------|
| Inbound shipment creation | Not covered | FBA Inbound API is unique — plan, prep, ship to Amazon warehouses |
| Inbound tracking | Not covered | Tracking status of shipments TO Amazon |
| Multi-Channel Fulfillment | Not covered | Using FBA to fulfill non-Amazon orders |
| Returns processing | Not covered | Amazon handles FBA returns |

### Assessment

- **FBM**: The `shipping_carriers` hub from SPEC-045c partially fits, but Amazon FBM doesn't use a traditional carrier API — it uses the Orders API `confirmShipment`. A thin adapter mapping is needed.
- **FBA**: This is an entirely different paradigm. FBA inbound (sending stock TO Amazon) has no equivalent in the current framework. It would require a dedicated hub or a specialized data_sync integration.
- **MCF (Multi-Channel Fulfillment)**: Using Amazon FBA to ship orders from Open Mercato's web store. This is a powerful feature but requires its own adapter — it maps partially to `ShippingAdapter` (create shipment, track) but the flow is different.

**Difficulty: LOW for FBM confirmation, HIGH for FBA inbound, MODERATE for MCF**

---

## 8. Germany/EU Regulatory Compliance — Adapter-External

| Requirement | API Support | Open Mercato Impact |
|------------|------------|---------------------|
| **LUCID (Packaging Register)** | Registration via Seller Central (not API) | Documentation only — no code needed |
| **WEEE/ElektroG (Electronics)** | Registration via Seller Central (not API) | Documentation only |
| **BattG (Batteries)** | Registration via Seller Central (not API) | Documentation only |
| **VAT** | VAT Transaction Reports via Reports API | Can import VAT reports as data_sync |
| **Invoices** | Invoices API for EU invoicing | Maps to `SalesInvoice` — moderate fit |
| **Single-Use Plastics (2025+)** | Seller Central registration | Documentation only |

### Assessment

Most Germany-specific compliance is handled outside the API (Seller Central registrations). The integration should:
- **Document** all registration requirements in the setup guide
- **Import VAT reports** via the Reports API (data_sync)
- **Validate** that required registrations exist before enabling the integration (health check)

**Difficulty: LOW** — mostly documentation, not code.

---

## 9. Rate Limiting — Good Fit

| Amazon Mechanism | SPEC-045b Mechanism | Fit |
|-----------------|---------------------|-----|
| Token bucket per operation | `rate-limiter.ts` — token-bucket rate limiter | Direct match |
| HTTP 429 + `x-amzn-RateLimit-Limit` header | Exponential backoff in adapter | Standard pattern |
| Operation-specific limits | Per-entity-type rate config | Needs per-operation granularity |

### Assessment

SPEC-045b already includes a token-bucket rate limiter for external API throttling. Amazon's per-operation limits mean the adapter needs to maintain separate buckets for different API operations (e.g., `getOrders` vs `getOrderItems` vs `getListingsItem`). This is adapter-internal complexity but well-supported by the framework.

**Difficulty: LOW** — framework already supports this pattern.

---

## 10. API Versioning — Good Fit

Amazon versions APIs per-section (e.g., Orders v0, Catalog Items v2022-04-01). SPEC-045a's `apiVersions` concept maps well:

```typescript
// Example: sync_amazon/integration.ts
export const bundle: IntegrationBundle = {
  id: 'sync_amazon',
  title: 'Amazon SP-API',
  // ...
}

export const integrations: IntegrationDefinition[] = [
  {
    id: 'sync_amazon_orders',
    title: 'Amazon — Orders',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'amazon_orders',
    bundleId: 'sync_amazon',
    apiVersions: [
      { id: 'v0', label: 'Orders API v0 (current)', status: 'stable', default: true },
    ],
    credentials: { fields: [] },
  },
  // ... products, inventory, pricing integrations
]
```

**Difficulty: LOW** — natural fit.

---

## 11. Sandbox / Testing — Limited

| Concern | Status |
|---------|--------|
| Static sandbox available | Returns canned responses — useful for basic flow testing |
| Dynamic sandbox | Only for select APIs (Fulfillment Outbound) |
| End-to-end testing | Requires production account with test SKUs |
| Integration test coverage | Can mock SP-API responses for CI/CD |

### Assessment

Integration tests for the Amazon adapter should mock SP-API responses (as done in SPEC-045h for Stripe). Real end-to-end testing requires an Amazon Seller Central account with test data. The sandbox is too limited for comprehensive testing.

**Difficulty: MODERATE** — mocking is straightforward, but real testing needs a seller account.

---

## Gap Summary

### Framework Gaps (require SPEC-045 extensions)

| # | Gap | Severity | Recommendation |
|---|-----|----------|----------------|
| G1 | **No inventory module** — no entity to store/manage stock levels | Critical | Build a lightweight `inventory` core module (stock levels per variant per location/channel) or defer to adapter-specific extension entity |
| G2 | **AWS SQS/EventBridge notification delivery** — framework assumes HTTP webhooks | High | Use polling-based sync (SPEC-045b scheduler) as primary; document EventBridge→Lambda→webhook bridge for real-time |
| G3 | **AWS SigV4 request signing** — no HTTP-level request signing mechanism | Medium | Implement in adapter module (`lib/sigv4-signer.ts`); consider adding a `requestSigner` hook to the Credentials API for future AWS-based integrations |
| G4 | **Complex field mapping UI** — Amazon Product Type Definitions have hundreds of fields | Medium | Extend SPEC-045b mapping UI with a "schema-aware" mode that loads external JSON schemas and presents required/optional fields |

### Adapter-Specific Challenges (no framework change needed)

| # | Challenge | Difficulty | Notes |
|---|-----------|------------|-------|
| A1 | Dual-layer auth (LWA + SigV4 + RDT) | High | 300-500 lines of auth code |
| A2 | Product Type Definition schema handling | High | Dynamic schema loading, validation, marketplace-specific variations |
| A3 | FBA inbound shipment management | High | Unique workflow with no framework equivalent |
| A4 | Amazon fee calculation / settlement reconciliation | Medium | Reports API import |
| A5 | Listing restrictions (gated categories) | Medium | Pre-check before listing |
| A6 | Multi-marketplace support (expand beyond .de) | Medium | Same bundle, different marketplace IDs |
| A7 | Amazon-specific order statuses | Low | Status mapping table |
| A8 | Germany EPR compliance documentation | Low | Setup guide content |

---

## Proposed Bundle Structure

```
packages/core/src/modules/sync_amazon/
├── index.ts
├── integration.ts              # Bundle + 6 integrations
├── setup.ts
├── di.ts
├── lib/
│   ├── sp-api-client.ts        # HTTP client with SigV4 signing + LWA token mgmt
│   ├── sigv4-signer.ts         # AWS Signature V4 implementation
│   ├── rdt-manager.ts          # Restricted Data Token lifecycle
│   ├── throttle-config.ts      # Per-operation rate limit buckets
│   ├── status-mapping.ts       # Amazon ↔ Open Mercato status maps
│   └── product-type-schema.ts  # Product Type Definition loader/cache
├── adapters/
│   ├── products.ts             # DataSyncAdapter — catalog sync
│   ├── orders.ts               # DataSyncAdapter — order import
│   ├── inventory-fba.ts        # DataSyncAdapter — FBA inventory read
│   ├── inventory-fbm.ts        # DataSyncAdapter — FBM inventory push
│   ├── pricing.ts              # DataSyncAdapter — price sync
│   └── reports.ts              # DataSyncAdapter — report import (VAT, settlement)
├── workers/
│   └── notification-poller.ts  # Optional SQS polling worker
├── widgets/
│   ├── injection-table.ts
│   └── injection/
│       ├── marketplace-selector/   # Widget to pick marketplace(s)
│       └── product-type-mapper/    # Schema-aware field mapping
├── backend/
│   ├── setup-guide.tsx             # Step-by-step Amazon setup wizard
│   └── fba-inventory.tsx           # FBA inventory dashboard
└── i18n/
    ├── en.ts
    └── pl.ts
```

### Bundle Integrations

| Integration ID | Category | Hub | Direction | Priority |
|---------------|----------|-----|-----------|----------|
| `sync_amazon_products` | data_sync | data_sync | bidirectional | P1 |
| `sync_amazon_orders` | data_sync | data_sync | import | P1 |
| `sync_amazon_inventory_fba` | data_sync | data_sync | import | P2 |
| `sync_amazon_inventory_fbm` | data_sync | data_sync | export | P2 |
| `sync_amazon_pricing` | data_sync | data_sync | bidirectional | P2 |
| `sync_amazon_reports` | data_sync | data_sync | import | P3 |

---

## Effort Estimate

| Phase | Scope | Relative Size |
|-------|-------|---------------|
| **Phase 1** — Auth + Client | SigV4 signer, LWA token manager, RDT manager, base SP-API client | Large |
| **Phase 2** — Product Import | Catalog Items API → CatalogProduct/Variant mapping, category mapping | Large |
| **Phase 3** — Order Import | Orders API → SalesOrder mapping, RDT for PII, status mapping | Medium |
| **Phase 4** — Inventory (FBA read) | FBA Inventory API → display widget (no core inventory module) | Medium |
| **Phase 5** — Product Export (Listing) | Product Type Definitions + Listings Items API, schema-aware mapping UI | Very Large |
| **Phase 6** — Pricing Sync | Price import/export, optional competitive pricing | Medium |
| **Phase 7** — FBM Inventory Push | Push stock to Amazon via Listings Items API | Small (if inventory module exists) / Blocked (if not) |
| **Phase 8** — Reports & Settlement | Reports API for VAT, settlement, analytics | Medium |
| **Phase 9** — Real-time (optional) | SQS poller or EventBridge→webhook bridge | Large |

---

## Recommendations

### Must-Have Before Starting

1. **SPEC-045a (Foundation)** and **SPEC-045b (Data Sync Hub)** must be implemented first — Amazon is a data_sync bundle.
2. **Inventory module decision**: Either build a lightweight core inventory module or accept that inventory sync will be limited to read-only display.
3. **AWS SDK dependency**: The `@aws-sdk/signature-v4` package (or manual implementation) is needed. Decide whether to add AWS SDK as a dependency or implement SigV4 manually (~200 lines).

### Start With

- **Order import** (Phase 3) — highest business value, moderate difficulty, good fit with SPEC-045b.
- **Product import** (Phase 2) — second highest value, builds the `SyncExternalIdMapping` foundation.

### Defer

- **Product export/listing** (Phase 5) — most complex piece due to Product Type Definitions; defer until import is stable.
- **Real-time notifications** (Phase 9) — polling via scheduler is sufficient initially.

### Consider Skipping

- **FBA inbound** — very specialized, most sellers manage this via Seller Central.
- **Competitive repricing** — specialized use case, can be a separate module later.

---

## Comparison: Amazon vs. Reference Implementations

| Dimension | Stripe (SPEC-045h) | MedusaJS (SPEC-045b) | Amazon SP-API |
|-----------|--------------------|--------------------|---------------|
| Auth complexity | API key + webhook secret | API key | LWA OAuth + AWS SigV4 + RDT (3 layers) |
| Webhook model | HTTP POST | HTTP POST | AWS SQS / EventBridge (no HTTP) |
| Data volume | Low (event-driven) | Medium (batch sync) | High (100K+ products, millions of orders) |
| API rate limits | Generous | Varies | Strict, per-operation token buckets |
| Schema complexity | Fixed, simple | Fixed, medium | Dynamic Product Type Definitions (massive) |
| Sandbox quality | Excellent | N/A (self-hosted) | Limited (mostly static responses) |
| Versioning | Date-based, stable | N/A | Per-section, frequent deprecations |
| Framework fit | Excellent | Excellent | Moderate — needs auth + notification workarounds |
| Estimated adapter LOC | ~500 | ~1,500 | ~4,000-6,000 |

---

## Conclusion

Amazon.de integration is **achievable** within the SPEC-045 framework but is significantly more complex than the reference implementations (Stripe, MedusaJS). The framework's data sync hub, credentials API, operation logs, and scheduler cover ~70% of requirements. The remaining 30% — AWS authentication, notification delivery, inventory management, and Product Type Definition complexity — requires adapter-specific engineering and potentially one framework extension (inventory module).

**Recommended approach**: Start with a polling-based, import-focused bundle (orders + products), expand to bidirectional sync and FBA features in later phases. Do not attempt real-time EventBridge integration in v1.
