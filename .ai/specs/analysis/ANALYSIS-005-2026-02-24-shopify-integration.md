# ANALYSIS-001 — Shopify Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Related Specs** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub), SPEC-044 (Payment Gateways), SPEC-041 (UMES) |
| **Integration** | Shopify Admin API (GraphQL + REST) |

---

## Executive Summary

A Shopify integration is **highly feasible** within the Open Mercato integration framework. The SPEC-045 bundle architecture is specifically designed for platform connectors like Shopify — one npm package registering multiple data sync integrations under shared credentials. Approximately **80% of the integration surface maps cleanly** to existing Open Mercato entities and the `DataSyncAdapter` contract. The remaining 20% involves gaps in inventory management, multi-currency/markets, and Shopify-specific concepts (collections, metafields) that require either new entities or creative mapping.

**Overall Verdict: GO** — with specific gaps identified below.

---

## 1. Integration Architecture

The Shopify connector would follow the `sync_medusa` bundle pattern from SPEC-045:

```
packages/core/src/modules/sync_shopify/
├── index.ts
├── integration.ts          # Bundle + 6 integration definitions
├── setup.ts                # Register adapters + provider
├── di.ts                   # Shopify GraphQL client, health check
├── lib/
│   ├── client.ts           # Shopify GraphQL client (with rate limit tracking)
│   ├── bulk-operations.ts  # Shopify Bulk Operations API wrapper
│   ├── status-map.ts       # Bidirectional order status mapping
│   ├── adapters/
│   │   ├── products.ts     # DataSyncAdapter — products + variants
│   │   ├── customers.ts    # DataSyncAdapter — customers
│   │   ├── orders.ts       # DataSyncAdapter — orders
│   │   ├── inventory.ts    # DataSyncAdapter — inventory levels
│   │   ├── collections.ts  # DataSyncAdapter — collections → categories
│   │   └── metafields.ts   # DataSyncAdapter — metafields → custom fields
│   ├── webhooks/
│   │   └── adapter.ts      # WebhookEndpointAdapter for Shopify webhooks
│   ├── transforms.ts       # Shopify-specific field transforms
│   └── health.ts           # HealthCheckable (calls shop.json)
├── subscribers/            # Outbound: OM events → Shopify API
├── workers/
│   ├── outbound-push.ts    # Async push to Shopify
│   └── bulk-poll.ts        # Poll bulk operation completion
└── i18n/
    ├── en.ts
    └── pl.ts
```

### Bundle Definition

```typescript
export const bundle: IntegrationBundle = {
  id: 'sync_shopify',
  title: 'Shopify',
  description: 'Bidirectional sync with Shopify — products, customers, orders, inventory, and collections.',
  icon: 'shopify',
  package: '@open-mercato/sync-shopify',
  credentials: {
    fields: [
      { key: 'shopDomain', label: 'Shop Domain', type: 'url', required: true, placeholder: 'mystore.myshopify.com' },
      { key: 'accessToken', label: 'Admin API Access Token', type: 'secret', required: true },
      { key: 'apiVersion', label: 'API Version', type: 'select', options: [
        { value: '2026-01', label: '2026-01 (latest)' },
        { value: '2025-10', label: '2025-10' },
        { value: '2025-07', label: '2025-07' },
      ]},
      { key: 'webhookSecret', label: 'Webhook HMAC Secret', type: 'secret' },
    ],
  },
  healthCheck: { service: 'shopifyHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [
  { id: 'sync_shopify_products', title: 'Shopify — Products', category: 'data_sync', hub: 'data_sync', providerKey: 'shopify_products', bundleId: 'sync_shopify', ... },
  { id: 'sync_shopify_customers', title: 'Shopify — Customers', category: 'data_sync', hub: 'data_sync', providerKey: 'shopify_customers', bundleId: 'sync_shopify', ... },
  { id: 'sync_shopify_orders', title: 'Shopify — Orders', category: 'data_sync', hub: 'data_sync', providerKey: 'shopify_orders', bundleId: 'sync_shopify', ... },
  { id: 'sync_shopify_inventory', title: 'Shopify — Inventory', category: 'data_sync', hub: 'data_sync', providerKey: 'shopify_inventory', bundleId: 'sync_shopify', ... },
  { id: 'sync_shopify_collections', title: 'Shopify — Collections', category: 'data_sync', hub: 'data_sync', providerKey: 'shopify_collections', bundleId: 'sync_shopify', ... },
  { id: 'sync_shopify_webhooks', title: 'Shopify — Webhooks', category: 'webhook', hub: 'webhook_endpoints', providerKey: 'shopify_webhooks', bundleId: 'sync_shopify', ... },
]
```

---

## 2. Entity Mapping Analysis

### 2.1 Products — FULLY SUPPORTED

| Shopify Field | Open Mercato Entity/Field | Mapping | Notes |
|---------------|--------------------------|---------|-------|
| `product.title` | `CatalogProduct.title` | Direct | |
| `product.bodyHtml` | `CatalogProduct.description` | Direct | HTML content |
| `product.vendor` | Custom field or tag | Extension | No direct vendor field |
| `product.productType` | `CatalogProduct.productType` | Transform | Shopify has free-text type |
| `product.handle` | `CatalogProduct.handle` | Direct | URL slug |
| `product.status` | `CatalogProduct.isActive` | Transform | active/draft/archived → boolean |
| `product.tags` | Tag system | Direct | OM has tag system |
| `product.images` | Media system | Direct | Via media module |
| `variant.sku` | `CatalogProductVariant.sku` | Direct | |
| `variant.barcode` | `CatalogProductVariant.barcode` | Direct | |
| `variant.price` | `CatalogProductPrice.unitPriceGross` | Transform | Shopify stores as string; OM uses numeric |
| `variant.compareAtPrice` | `CatalogProductPrice` (promotion kind) | Transform | Maps to promotional pricing |
| `variant.weight` | `CatalogProductVariant.weightValue` | Direct | Need unit conversion |
| `variant.option1/2/3` | `CatalogProductVariant.optionValues` | Transform | Shopify max 3 options → OM JSON map |
| `variant.inventoryQuantity` | No direct entity | **GAP** | See Inventory section |
| `product.metafields` | Custom fields (`ce.ts`) | Extension | Via custom field sets |

**Difficulty: LOW** — Clean 1:1 mapping for most fields.

**Challenges:**
- Shopify's new product model (GraphQL-only) has up to 2,000 variants; OM has no documented variant limit but performance should be validated
- Shopify `product.vendor` has no direct OM equivalent — use custom field or tag
- Shopify product status `archived` has no OM equivalent beyond `isActive: false`

### 2.2 Customers — FULLY SUPPORTED

| Shopify Field | Open Mercato Entity/Field | Mapping | Notes |
|---------------|--------------------------|---------|-------|
| `customer.firstName` | `CustomerPersonProfile.firstName` | Direct | |
| `customer.lastName` | `CustomerPersonProfile.lastName` | Direct | |
| `customer.email` | `CustomerEntity.primaryEmail` | Direct | |
| `customer.phone` | `CustomerEntity.primaryPhone` | Direct | |
| `customer.addresses[]` | `CustomerAddress` (1:N) | Direct | Full address mapping |
| `customer.defaultAddress` | `CustomerAddress.isPrimary` | Transform | Mark as primary |
| `customer.tags` | Tag system | Direct | |
| `customer.note` | `CustomerComment` | Direct | As comment |
| `customer.state` | `CustomerEntity.status` | Transform | enabled/disabled/invited → dictionary |
| `customer.metafields` | Custom fields | Extension | |

**Difficulty: LOW** — Almost perfect mapping.

**Challenges:**
- Shopify `customer.acceptsMarketing` → needs custom field or extension
- Shopify customer segments/saved searches have no OM equivalent

### 2.3 Orders — FULLY SUPPORTED (with complexity)

| Shopify Field | Open Mercato Entity/Field | Mapping | Notes |
|---------------|--------------------------|---------|-------|
| `order.name` (#1001) | `SalesOrder.orderNumber` | Direct | |
| `order.email` | Customer link | Transform | Lookup customer by email |
| `order.lineItems[]` | `SalesOrderLine` (1:N) | Direct | |
| `lineItem.sku` | `SalesOrderLine.productVariantId` | Lookup | Match variant by SKU |
| `lineItem.price` | `SalesOrderLine.unitPriceGross` | Direct | |
| `lineItem.quantity` | `SalesOrderLine.quantity` | Direct | |
| `lineItem.discount` | `SalesOrderAdjustment` | Transform | As line-level discount |
| `order.totalPrice` | `SalesOrder.grandTotalGrossAmount` | Direct | |
| `order.subtotalPrice` | `SalesOrder.subtotalGrossAmount` | Direct | |
| `order.totalTax` | `SalesOrder.taxTotalAmount` | Direct | |
| `order.totalDiscounts` | `SalesOrder.discountTotalAmount` | Direct | |
| `order.shippingLines[]` | Shipping method + amount | Transform | Map to OM shipping |
| `order.billingAddress` | `SalesDocumentAddress` (billing) | Direct | Full address |
| `order.shippingAddress` | `SalesDocumentAddress` (shipping) | Direct | Full address |
| `order.fulfillments[]` | `SalesShipment` | Transform | Via Fulfillment Orders API |
| `order.transactions[]` | `SalesPayment` | Transform | Payment records |
| `order.refunds[]` | `SalesPayment` (refund) | Transform | As refund payments |
| `order.note` | `SalesNote` | Direct | |
| `order.tags` | `SalesDocumentTag` | Direct | |
| `order.cancelledAt` | Status transition | Transform | |

**Difficulty: MEDIUM** — Mapping works but order lifecycle complexity is high.

**Challenges:**
- Shopify discount model is complex (automatic discounts, discount codes, line-level vs order-level) — mapping to `SalesOrderAdjustment` requires careful transform logic
- Shopify fulfillment status is per-line-item via Fulfillment Orders API — OM tracks `fulfilledQuantity` per line
- Shopify `financialStatus` (pending, authorized, partially_paid, paid, partially_refunded, refunded, voided) maps to OM payment status but needs careful bidirectional mapping
- Shopify `fulfillmentStatus` (fulfilled, partial, unfulfilled, restocked) maps to OM shipment tracking but granularity differs

### 2.4 Inventory — PARTIAL SUPPORT (significant gap)

| Shopify Concept | Open Mercato Equivalent | Status |
|-----------------|------------------------|--------|
| Inventory Item | No dedicated entity | **GAP** |
| Inventory Level (per location) | No multi-location inventory | **GAP** |
| Location | No location entity | **GAP** |
| Quantity states (available, committed, incoming, damaged) | Only `reservedQuantity`/`fulfilledQuantity` on order lines | **GAP** |
| Inventory adjustments | No adjustment tracking | **GAP** |
| Stock low events | `catalog.product.stock_low` event exists | Partial |

**Difficulty: HIGH** — This is the largest gap.

**What's missing in Open Mercato:**
1. No dedicated `Inventory` or `InventoryLevel` entity
2. No multi-location support (Shopify stores per-location quantities)
3. No quantity state machine (available, committed, incoming, damaged, safety_stock)
4. Inventory is currently embedded in catalog/order modules, not a standalone concern

**Mitigation options:**
- **Option A (Minimal):** Sync only `available` quantity as a product-level custom field. Ignore multi-location. Works for simple stores.
- **Option B (Extension):** Create `data/extensions.ts` linking inventory data to `CatalogProductVariant` via entity extension. Single location, single quantity.
- **Option C (Full):** Build an `inventory` module (new spec) with `InventoryItem`, `InventoryLevel`, `InventoryLocation` entities. This is the proper solution for any serious commerce platform.

**Recommendation:** Option C (new module) for production use. Option A as a quick-start for MVP.

### 2.5 Collections — PARTIAL SUPPORT

| Shopify Concept | Open Mercato Equivalent | Status |
|-----------------|------------------------|--------|
| Custom Collection | `CatalogProductCategory` | Mapped | Manual product assignment |
| Smart Collection | No equivalent | **GAP** | Rule-based auto-assignment |
| Collection handle/slug | `CatalogProductCategory.slug` | Direct | |
| Collection image | Category media | Depends | If category supports media |
| Collection sort order | No equivalent | **GAP** | OM categories have `treePath` ordering |
| Collection SEO | No equivalent | Extension | Needs custom fields |

**Difficulty: MEDIUM**

**Challenges:**
- Shopify Smart Collections (rule-based) have no OM equivalent — would sync as static categories with a note that rules are not preserved
- Shopify allows products in multiple collections; OM supports many-to-many category assignment via `CatalogProductCategoryAssignment` — this works
- Collection hierarchy: Shopify collections are flat; OM categories are hierarchical. No conflict, but no hierarchy benefit from Shopify data

### 2.6 Metafields — SUPPORTED via Custom Fields

| Shopify Concept | Open Mercato Equivalent | Status |
|-----------------|------------------------|--------|
| Product metafields | Custom field sets (`ce.ts`) | Mapped | Via custom field values |
| Customer metafields | Custom field sets | Mapped | |
| Order metafields | Custom field sets or metadata | Mapped | |
| Metafield definitions | Custom entity definitions | Mapped | Auto-create definitions |
| Metaobjects | No direct equivalent | **GAP** | Would need custom entities |

**Difficulty: MEDIUM** — The mapping is possible but requires dynamic custom field set creation during sync setup.

---

## 3. Authentication & Credentials

### Shopify OAuth vs Custom App Tokens

| Auth Method | Framework Support | Notes |
|-------------|-------------------|-------|
| Custom App Access Token | Fully supported | Static `secret` credential field. Simplest approach. |
| OAuth 2.0 (public app) | Fully supported (SPEC-045a ss8) | `type: 'oauth'` credential field with PKCE. Full flow supported. |

**Recommendation:** Support both:
1. **Custom App Token** — for single-store integrations (simpler setup)
2. **OAuth** — for multi-store / app-store distribution (future)

The `IntegrationCredentials` system handles both patterns. OAuth token refresh is handled by the `oauth-token-refresh` worker (SPEC-045a ss8.5).

**Shopify-specific concern:** Custom app tokens cannot be rotated — must delete and recreate the app. The integration should warn about this in the setup UI.

---

## 4. Data Sync Strategy

### 4.1 Initial Sync — Bulk Operations API

For stores with large catalogs (10K+ products), Shopify's Bulk Operations API is the only practical approach:

```
Admin clicks "Full Sync" for products
  → POST /api/data-sync/run { integrationId: 'sync_shopify_products', fullSync: true }
  → Worker submits GraphQL bulk query to Shopify
  → Poll for completion (via bulk-poll worker)
  → Download JSONL result file
  → Stream JSONL as AsyncIterable<ImportBatch>
  → Standard sync engine processes batches with progress tracking
```

**Framework fit:** The `DataSyncAdapter.streamImport()` contract returns `AsyncIterable<ImportBatch>` — the Shopify adapter would internally:
1. Submit bulk query mutation
2. Poll for completion (or listen for `bulk_operations/finish` webhook)
3. Download JSONL file
4. Parse JSONL into batches and yield them

This fits perfectly within the streaming contract. The adapter handles Shopify-specific complexity internally.

### 4.2 Delta Sync — Cursor-Based

Shopify supports `updated_at_min` filtering on most resources. The `SyncCursor` entity stores the last sync timestamp.

```
Scheduled delta sync (every 15 min)
  → Load cursor: '2026-02-24T13:45:00Z'
  → Query Shopify: products(query: "updated_at:>'2026-02-24T13:45:00Z'")
  → Stream results as ImportBatch with new cursor
  → Persist cursor after each batch
```

**Framework fit:** Perfect match with `SyncCursor` and delta streaming design.

### 4.3 Real-Time Sync — Webhooks

| Shopify Event | Direction | Action |
|---------------|-----------|--------|
| `products/create` | Inbound | Create `CatalogProduct` |
| `products/update` | Inbound | Update `CatalogProduct` |
| `products/delete` | Inbound | Soft-delete `CatalogProduct` |
| `orders/create` | Inbound | Create `SalesOrder` |
| `orders/updated` | Inbound | Update order status/amounts |
| `orders/paid` | Inbound | Update payment status |
| `orders/fulfilled` | Inbound | Create `SalesShipment` |
| `orders/cancelled` | Inbound | Cancel order |
| `customers/create` | Inbound | Create `CustomerEntity` |
| `customers/update` | Inbound | Update customer |
| `inventory_levels/update` | Inbound | Update stock (if inventory module exists) |
| `refunds/create` | Inbound | Create refund payment |

**Framework fit:** Uses `WebhookEndpointAdapter` (SPEC-045e) with HMAC-SHA256 verification. Shopify webhooks deliver via HTTPS — standard pattern.

**Outbound sync** (OM events → Shopify):
- `catalog.product.updated` → subscriber → worker → Shopify mutation
- `sales.order.status_changed` → subscriber → worker → Shopify update
- `sales.shipment.created` → subscriber → worker → Shopify fulfillment

**Framework fit:** Standard subscriber + worker pattern from `sync_medusa` reference.

---

## 5. Rate Limiting

Shopify enforces strict rate limits that the integration must respect:

| API | Limit (Standard) | Limit (Plus) |
|-----|-------------------|--------------|
| REST | 2 req/s (bucket: 40) | 20 req/s |
| GraphQL | 50 pts/s (bucket: 1,000) | 500 pts/s |

**Framework support:** SPEC-045b includes `rate-limiter.ts` (token-bucket) in the data_sync hub. The Shopify adapter would configure:

```typescript
const rateLimiter = createTokenBucketLimiter({
  maxTokens: 1000,     // Shopify GraphQL bucket size
  refillRate: 50,      // 50 points per second
  refillInterval: 1000, // Refill every second
})
```

Each GraphQL query's cost is returned in the response `extensions.cost` field. The adapter must track actual cost, not just request count.

**Challenge:** GraphQL query cost is variable and not known before execution. The adapter should:
1. Use `throttleStatus.currentlyAvailable` from each response to track remaining budget
2. Implement exponential backoff on 429 responses
3. Use Bulk Operations for large reads (exempt from point-based rate limiting)

---

## 6. Difficulty Assessment

### What's Easy (fully supported by framework)

| Area | Difficulty | Reason |
|------|-----------|--------|
| Product sync (basic fields, variants, pricing) | LOW | Clean entity mapping |
| Customer sync | LOW | Near-perfect field match |
| Order import (read from Shopify) | LOW-MEDIUM | Good field mapping, some transform logic |
| Collection → Category mapping | LOW | Many-to-many assignment works |
| Authentication (both custom app + OAuth) | LOW | SPEC-045a credentials system handles both |
| Webhook inbound processing | LOW | Standard HMAC-SHA256 + WebhookEndpointAdapter |
| Progress tracking & resumability | LOW | Built into sync engine |
| Credential management | LOW | IntegrationCredentials with encrypted storage |
| Health check | LOW | Call `GET /admin/api/{version}/shop.json` |
| Operation logging | LOW | IntegrationLog via DI |

### What's Medium (requires careful implementation)

| Area | Difficulty | Reason |
|------|-----------|--------|
| Bulk Operations API for initial sync | MEDIUM | Async poll/download pattern inside `streamImport()` |
| Rate limit management | MEDIUM | Variable GraphQL cost tracking |
| Order discount mapping | MEDIUM | Shopify discount model is complex |
| Bidirectional order status sync | MEDIUM | Different status vocabularies |
| Fulfillment Orders API integration | MEDIUM | Request-based flow, not direct create |
| Shopify API versioning management | MEDIUM | Quarterly versions, must track deprecations |
| Multi-variant products (2,000 variants) | MEDIUM | Performance validation needed |
| Metafield → custom field mapping | MEDIUM | Dynamic field set creation |

### What's Hard (gaps in Open Mercato)

| Area | Difficulty | Gap | Mitigation |
|------|-----------|-----|------------|
| **Multi-location inventory** | HIGH | No inventory module, no location entity | Build inventory module (new SPEC) or sync single-location only |
| **Shopify Markets (multi-currency pricing)** | HIGH | OM has multi-currency pricing but no "market" concept | Map to channel-scoped pricing; lose market-level configuration |
| **Smart Collections** | MEDIUM-HIGH | No rule-based auto-categorization | Sync as static categories; document limitation |
| **Metaobjects** | MEDIUM-HIGH | No standalone custom data objects | Ignore or map to custom entities (requires per-metaobject-type setup) |
| **Payment gateway sync** | BLOCKED | Shopify Payments API requires partner approval | Read-only transaction import only; cannot process payments |
| **Shopify POS integration** | HIGH | OM has no POS module (yet) | Import POS orders as regular orders with POS channel tag |
| **Draft orders / quotes** | MEDIUM | OM has `SalesQuote` but lifecycle differs | Map draft orders to quotes; handle conversion |
| **Shopify Functions (discounts, shipping, payment)** | BLOCKED | Server-side Shopify customizations | Cannot sync; Shopify-only runtime |
| **Shopify Flow automations** | BLOCKED | Proprietary automation engine | Cannot sync; use OM workflows instead |

---

## 7. Missing Platform Capabilities

### 7.1 Inventory Module (Critical Gap)

**Impact:** Without a dedicated inventory module, the Shopify integration cannot properly sync:
- Stock levels per product/variant
- Multi-location inventory
- Inventory adjustments and transfers
- Reserved/committed quantities

**Recommendation:** Create `SPEC-046 — Inventory Management Module` as a prerequisite for production Shopify integration. Minimum viable scope:
- `InventoryItem` entity (linked to variant)
- `InventoryLevel` entity (quantity per location)
- `InventoryLocation` entity
- Adjustment tracking
- Low-stock events (already exists as `catalog.product.stock_low`)

### 7.2 Markets / Multi-Storefront Concept (Medium Gap)

**Impact:** Shopify Markets allow different pricing, content, and availability per region. OM has channel-scoped pricing (`CatalogProductPrice.channelId`) which partially covers this — each Shopify market could map to an OM channel. However:
- OM channels don't carry currency/region metadata natively
- Market-specific product availability rules are not modeled

**Recommendation:** Map each Shopify market to an OM `SalesChannel`. Document that market-level configuration (duties, taxes, domain routing) is not synced.

### 7.3 Product Media Management (Minor Gap)

**Impact:** Shopify has rich media management (images, videos, 3D models) with CDN URLs. OM has media attachment support but the integration needs to:
- Download and re-host images (or store Shopify CDN URLs)
- Handle image alt text
- Maintain image ordering

**Recommendation:** Store Shopify CDN URLs directly via `CatalogProduct.defaultMediaUrl` and attachment system. Full media re-hosting is optional.

---

## 8. Shopify API Version Strategy

Shopify releases quarterly API versions. The integration should:

1. **Pin to a specific version** in the bundle credentials (user selects `apiVersion`)
2. **Use `apiVersions` on the integration definition** to track which Shopify API versions are supported
3. **Test against release candidates** before each quarterly release
4. **Target 2-3 concurrent versions** (current + previous + next RC)

The framework's `apiVersions` mechanism (SPEC-045a ss1.3) maps perfectly to Shopify's versioning scheme. Each Shopify API version would correspond to an adapter version.

However, given that Shopify API changes between quarterly versions are usually incremental, a single adapter with a version parameter is likely sufficient (unlike Stripe where different API versions have fundamentally different request/response shapes).

---

## 9. Implementation Phases

### Phase 1 — MVP (Products + Customers)
- Custom app token authentication
- Product import/export (basic fields, variants, pricing)
- Customer import/export
- Collection → Category mapping
- Webhook inbound for products and customers
- Health check

**Prerequisites:** SPEC-045a (Foundation), SPEC-045b (Data Sync Hub)

### Phase 2 — Orders
- Order import (read from Shopify)
- Bidirectional order status sync
- Payment record import (read-only)
- Shipment/fulfillment sync
- Webhook inbound for orders

**Prerequisites:** Phase 1

### Phase 3 — Inventory
- Single-location inventory sync
- Stock level import/export
- Inventory webhook processing

**Prerequisites:** Inventory module (SPEC-046 or equivalent)

### Phase 4 — Advanced
- Multi-location inventory
- Shopify Markets → Channel mapping
- Metafield ↔ Custom field sync
- Bulk Operations API for initial sync
- OAuth authentication for multi-store
- Scheduled sync via scheduler integration

**Prerequisites:** Inventory module with multi-location, Phase 3

---

## 10. Comparison with MedusaJS Reference Implementation

| Aspect | MedusaJS (Reference) | Shopify | Notes |
|--------|---------------------|---------|-------|
| API style | REST | GraphQL (primary) + REST (legacy) | Shopify adapter needs GraphQL client |
| Authentication | API key | Custom app token or OAuth | More complex auth options |
| Rate limiting | Simple (standard HTTP) | Cost-based (GraphQL points) | Shopify needs cost-aware rate limiter |
| Bulk data | Paginated REST | Bulk Operations API (JSONL) | Shopify needs async bulk handler |
| Webhooks | Standard HTTP + HMAC | Standard HTTP + HMAC-SHA256 | Same pattern |
| Product model | Similar to OM | More constrained (max 3 options, flat collections) | Simpler mapping for Shopify |
| Order model | Similar to OM | More complex (discount codes, fulfillment orders) | More transform logic |
| Inventory | Basic | Multi-location with quantity states | Larger gap |
| API versioning | v2 | Quarterly date-based | More frequent version management |

---

## 11. Risk Assessment

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| Inventory module not built before Shopify integration | High | Medium | MVP without inventory; add later |
| Shopify GraphQL query cost exceeds rate limit during bulk sync | Medium | High | Use Bulk Operations API for large datasets |
| Shopify API deprecation breaks adapter | Medium | Medium | Pin version, test against RC, support 2 versions |
| Order discount mapping produces incorrect totals | High | Medium | Comprehensive test suite with real Shopify discount scenarios |
| Webhook delivery delays cause data inconsistency | Medium | Medium | Delta sync as reconciliation fallback |
| Shopify REST API fully deprecated before connector ships | Low | Low | Build on GraphQL from day one |
| Multi-location inventory sync causes conflicts | High | Medium | Implement conflict resolution strategy; log conflicts |
| OAuth token expiry during long bulk operation | Medium | Medium | Use offline access tokens; background refresh worker |

---

## 12. Effort Estimate

| Phase | Scope | Relative Effort |
|-------|-------|----------------|
| Phase 1 (Products + Customers) | 6 sync adapters, auth, health, webhooks | Large |
| Phase 2 (Orders) | Order adapter, status mapping, fulfillment | Large |
| Phase 3 (Inventory) | Inventory module + Shopify adapter | Very Large (new module) |
| Phase 4 (Advanced) | Multi-location, markets, metafields, OAuth, bulk ops | Very Large |

**Total estimated complexity:** Comparable to the `sync_medusa` reference implementation for Phase 1-2. Phases 3-4 require new platform capabilities (inventory module).

---

## 13. Conclusion

The Open Mercato integration framework (SPEC-045) is well-designed for a Shopify connector. The bundle pattern, DataSyncAdapter contract, credential management, webhook handling, and progress tracking all fit the Shopify use case directly.

**What works out of the box:**
- Product and variant sync (including pricing)
- Customer sync
- Order import
- Collection/category mapping
- Authentication (custom app + OAuth)
- Webhook processing
- Rate limiting infrastructure
- Progress tracking and resumability

**What needs new platform work:**
- Inventory management module (critical for production use)
- Multi-location support
- Market/multi-storefront concept

**What cannot be done:**
- Shopify payment processing (requires partner approval)
- Shopify Functions/Flow sync (proprietary runtime)
- Smart Collection rules (server-side logic)

**Recommendation:** Proceed with Phase 1-2 immediately using existing framework. Prioritize SPEC-046 (Inventory Module) to unblock Phase 3-4.
