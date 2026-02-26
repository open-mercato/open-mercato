# ANALYSIS-009 — Magento 2 / Adobe Commerce Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Related Spec** | SPEC-045 (Integration Marketplace), SPEC-045b (Data Sync Hub) |
| **Target Platform** | Magento 2 Open Source (CE) + Adobe Commerce (EE) |
| **Verdict** | **Feasible with caveats** — ~85% entity coverage, real-time sync requires custom Magento module or Adobe Commerce |

---

## Executive Summary

Open Mercato's Integration Marketplace (SPEC-045) and Data Sync Hub (SPEC-045b) provide a solid framework for building a Magento 2 connector bundle (`@open-mercato/sync-magento2`). The `DataSyncAdapter` contract — with delta streaming, cursor-based resumability, field mapping, and queue-based processing — maps well onto Magento 2's REST API capabilities.

**What works well:**
- Products, categories, customers, orders, invoices, shipments, credit memos all have full REST CRUD APIs
- Magento supports `updated_at` filtering for delta sync on all major entities
- The bundle pattern (one package, many sync adapters) fits naturally
- Bulk/async APIs available for high-volume writes
- Field mapping UI handles the schema differences between platforms

**What's difficult or missing:**
- No native webhooks in open-source Magento 2 (real-time sync requires custom module or Adobe Commerce)
- Open Mercato lacks a dedicated inventory module — Magento's MSI has no direct counterpart
- Magento's EAV attribute system is fundamentally different from Open Mercato's custom fields
- Configurable products require multiple API calls (parent + children + options)
- Magento's multi-website/store/store-view hierarchy doesn't map 1:1 to Open Mercato's channel model
- Deletion detection impossible via REST API polling — requires full reconciliation or webhooks

---

## 1. Entity Mapping Matrix

### 1.1 Catalog

| Magento 2 Entity | Open Mercato Entity | Sync Direction | Feasibility | Notes |
|-------------------|---------------------|----------------|-------------|-------|
| Simple Product | `CatalogProduct` + `CatalogProductVariant` (single default variant) | Bidirectional | HIGH | Direct mapping. SKU, name, description, weight, status all map cleanly. |
| Configurable Product | `CatalogProduct` (isConfigurable=true) + child `CatalogProductVariant`s | Bidirectional | MEDIUM | Requires 3 API calls per product: parent, children, options. `optionValues` JSONB maps to Magento's configurable attributes. Child simple products become variants. |
| Grouped Product | `CatalogProductVariant` with `CatalogProductVariantRelation` (relationType=grouped) | Import only initially | MEDIUM | Open Mercato has variant relations with `parentVariant`/`childVariant`/`childProduct` links. Min/max quantity supported. |
| Bundle Product | `CatalogProductVariant` with `CatalogProductVariantRelation` | Import only initially | LOW | Magento bundles have option groups with selections, pricing modes (fixed/dynamic), required/optional. Open Mercato's variant relation model is simpler — would need `metadata` JSONB for bundle-specific config. |
| Virtual Product | `CatalogProduct` (no weight/shipping) | Bidirectional | HIGH | Map as product with zero weight. No structural difference. |
| Downloadable Product | `CatalogProduct` + custom metadata | Import only | LOW | No Open Mercato equivalent for download links/samples. Would store in `metadata` JSONB but lose structured access. |
| Category | `CatalogProductCategory` | Bidirectional | HIGH | Both use hierarchical tree with parent references. Magento `parent_id` maps to `parentId`. `name`, `is_active`, `position` all map directly. |
| Category Assignment | `CatalogProductCategoryAssignment` | Bidirectional | HIGH | Direct mapping. Position supported. |
| Product Image | No dedicated media entity | Import only | MEDIUM | Open Mercato has `defaultMediaId`/`defaultMediaUrl` on product/variant but no full media gallery entity. First image maps; gallery requires extension or custom fields. |
| Product Tag | `CatalogProductTag` + `CatalogProductTagAssignment` | Import only | MEDIUM | Magento doesn't have native tags — would map from custom attributes or labels. |
| Tier Price | `CatalogProductPrice` with `minQuantity`/`maxQuantity` | Bidirectional | HIGH | Open Mercato's multi-tier pricing model is richer than Magento's. `minQuantity`/`maxQuantity` + `customerGroupId` map directly. |
| Special Price | `CatalogProductPrice` with `startsAt`/`endsAt` | Bidirectional | HIGH | Time-bounded prices map to Open Mercato's temporal price entries. |
| Product Attribute | Custom Fields (`ce.ts`) | Import only | LOW | See section 2.1 for detailed analysis. Magento's EAV is fundamentally different. |
| Attribute Set | `CatalogOptionSchemaTemplate` | Import only | LOW | Conceptually similar but structurally different. Magento attribute sets group attributes; Open Mercato templates define option schemas. |

### 1.2 Sales

| Magento 2 Entity | Open Mercato Entity | Sync Direction | Feasibility | Notes |
|-------------------|---------------------|----------------|-------------|-------|
| Order | `SalesOrder` | Bidirectional | HIGH | Rich mapping. Order number, status, customer, addresses, totals, currency all have direct equivalents. Magento's `grand_total` = `grandTotalGrossAmount`. |
| Order Item | `SalesOrderLine` | Bidirectional | HIGH | `quantity`, `sku`, `name`, `price`, `tax_amount`, `discount_amount` all map directly. `kind` defaults to "product". |
| Invoice | `SalesInvoice` + `SalesInvoiceLine` | Bidirectional | HIGH | Direct mapping. Invoice number, dates, line items, totals. |
| Shipment | `SalesShipment` + `SalesShipmentItem` | Bidirectional | HIGH | Tracking numbers (array), carrier, quantities all map. |
| Credit Memo | `SalesCreditMemo` + `SalesCreditMemoLine` | Bidirectional | HIGH | Direct mapping with refund amounts and line items. |
| Payment | `SalesPayment` | Import | MEDIUM | Magento payment info is embedded in order. Map `payment.method` to `paymentMethod`, amounts to `SalesPayment`. |
| Order Status History | `SalesNote` | Import | HIGH | Magento's status history comments map to `SalesNote` with `contextType=order`. |
| Order Address | `SalesDocumentAddress` | Bidirectional | HIGH | Both store billing/shipping addresses per document. Field-level mapping is straightforward. |
| Quote/Cart | `SalesQuote` + `SalesQuoteLine` | Import | MEDIUM | Magento's cart/quote maps conceptually but the lifecycle differs. Magento quotes are ephemeral shopping carts; Open Mercato quotes are formal business documents. Only import completed/submitted quotes. |
| Store View | `SalesChannel` | Import | MEDIUM | Magento's website > store > store view hierarchy flattens to Open Mercato's flat channel model. See section 2.3. |
| Shipping Method | `SalesShippingMethod` | Import | HIGH | `carrier_code` + `method_code` map to `carrierCode` + `code`. |
| Payment Method | `SalesPaymentMethod` | Import | HIGH | `method_code` maps to `code`. |
| Tax Rate | `SalesTaxRate` | Import | HIGH | Magento's tax rates with country/region/postcode map to Open Mercato's scoped `SalesTaxRate`. |

### 1.3 Customers

| Magento 2 Entity | Open Mercato Entity | Sync Direction | Feasibility | Notes |
|-------------------|---------------------|----------------|-------------|-------|
| Customer | `CustomerEntity` (kind=person) + `CustomerPersonProfile` | Bidirectional | HIGH | `firstname`/`lastname` → `firstName`/`lastName`. Email, dates, status all map. |
| Customer Address | `CustomerAddress` | Bidirectional | HIGH | Street, city, region, postcode, country, telephone all map. `default_billing`/`default_shipping` → `isPrimary` + `purpose`. |
| Customer Group | Dictionary entry or custom entity | Import | MEDIUM | Magento customer groups (General, Wholesale, Retailer) have no direct equivalent. Map to `CustomerDictionaryEntry` with kind="customer_group" or use custom fields. |

### 1.4 Inventory

| Magento 2 Entity | Open Mercato Entity | Sync Direction | Feasibility | Notes |
|-------------------|---------------------|----------------|-------------|-------|
| MSI Source | **No equivalent** | N/A | BLOCKED | Open Mercato has no inventory module. See section 2.2. |
| MSI Stock | **No equivalent** | N/A | BLOCKED | |
| MSI Source Item | **No equivalent** | N/A | BLOCKED | |
| Salable Quantity | **No equivalent** | N/A | BLOCKED | |

### 1.5 Other Entities

| Magento 2 Entity | Open Mercato Entity | Sync Direction | Feasibility | Notes |
|-------------------|---------------------|----------------|-------------|-------|
| CMS Page | Content pages (`packages/content`) | Import | LOW | Different structural models. Magento uses HTML content blocks; Open Mercato content pages are static markdown/structured. |
| Cart Price Rule | **No equivalent** | N/A | BLOCKED | Open Mercato has `SalesOrderAdjustment` for applied discounts but no promotion rules engine. |
| Catalog Price Rule | **No equivalent** | N/A | BLOCKED | Same as above. |
| Coupon | **No equivalent** | N/A | BLOCKED | |

---

## 2. Key Challenges & Gap Analysis

### 2.1 EAV Attributes vs Custom Fields — HARD

**The problem:** Magento's Entity-Attribute-Value (EAV) system is the backbone of its product catalog. Every product can have hundreds of attributes organized into attribute sets and groups. Open Mercato uses a custom fields system (`ce.ts`) with `customFieldsetCode` references and JSONB `metadata` storage.

**What this means for sync:**
- Magento's `custom_attributes` array (which can contain 100+ entries) must be mapped field-by-field
- Attribute types (text, textarea, select, multiselect, date, price, media_image, boolean) must map to Open Mercato custom field types
- Select/multiselect attribute options (with admin/store labels) need to be synced as dictionary entries or option values
- Attribute sets determine which attributes a product has — this maps loosely to `CatalogOptionSchemaTemplate`

**Recommended approach:**
1. During initial setup, fetch all Magento product attributes via `/V1/products/attributes`
2. Auto-generate a field mapping proposal showing each Magento attribute → Open Mercato field
3. Core attributes (name, sku, price, weight, status) map to entity fields
4. Extended attributes map to custom fields via the `metadata` JSONB or dedicated custom field sets
5. Provide a "Create Custom Fields" wizard that auto-creates Open Mercato custom field definitions from Magento attribute metadata

**Effort estimate:** HIGH — This is the single most complex mapping challenge. The field mapping UI from SPEC-045b helps, but the initial attribute discovery and custom field provisioning requires significant adapter logic.

### 2.2 Missing Inventory Module — BLOCKED (requires new module)

**The problem:** Magento 2.3+ uses Multi-Source Inventory (MSI) with sources, stocks, source items, and salable quantity calculations. Open Mercato has **no inventory module**.

**Impact:**
- Cannot sync stock levels, warehouse locations, or availability
- Product sync will work but inventory state will be lost
- Order fulfillment workflows that depend on stock reservation cannot be replicated

**Recommendation:** This is a platform gap, not an integration gap. Options:
1. **Defer inventory sync** — sync products/orders/customers first, add inventory when an Open Mercato inventory module exists
2. **Store in metadata** — write Magento stock quantities into product variant `metadata` JSONB as a read-only reference (no business logic)
3. **Build inventory module first** — scope out a lightweight inventory module (`packages/core/src/modules/inventory/`) before the Magento connector

**Verdict:** Option 1 is pragmatic. The Magento connector ships without inventory sync and adds it in a later version when the platform supports it.

### 2.3 Multi-Store Hierarchy vs Channels — MEDIUM

**The problem:** Magento uses a 3-level hierarchy:
```
Website → Store (Group) → Store View
```
- **Website**: Defines base URL, payment/shipping, tax settings, pricing scope
- **Store (Group)**: Groups store views, defines root category
- **Store View**: Language/locale-specific frontend, per-view product data

Open Mercato uses a flat **channel** model (`SalesChannel`) — a single entity with code, name, and configuration.

**Mapping strategy:**
- Map each Magento **store view** to one `SalesChannel` (most granular level that affects product data and pricing)
- Store the parent website/store group IDs in channel `metadata` JSONB
- When syncing products, use store-view-scoped API calls (`/rest/{store_code}/V1/products`) to get localized data
- Map per-store-view product data to Open Mercato's translation system (`translations.ts`)

**Complexity:** MEDIUM — The adapter must make N API calls per entity (one per store view) to get complete multilingual data. This multiplies API calls and sync time.

### 2.4 Real-Time Sync — HARD (open-source), MEDIUM (Adobe Commerce)

**The problem:** Open-source Magento 2 has no native webhook/event system for external consumers. SPEC-045b's `DataSyncAdapter` is pull-based (polling with `updated_at` cursors), which works, but real-time sync requires push.

**Open-source Magento 2:**
- Polling via `updated_at` filtering works for delta sync on schedule (every 5-15 minutes)
- No way to detect deletions without full reconciliation
- Custom Magento module needed for real-time push (observer → HTTP webhook)

**Adobe Commerce:**
- Native webhooks (synchronous) and Adobe I/O Events (asynchronous) available
- Can push events to an Open Mercato webhook endpoint
- Would use the `webhook_endpoints` hub (SPEC-045e) to receive

**Recommendation:**
1. **Phase 1:** Implement polling-based delta sync using `updated_at` + cursor persistence (works with all Magento editions)
2. **Phase 2:** Add optional webhook receiver for Adobe Commerce / custom Magento webhook modules
3. **Phase 3:** Add periodic full reconciliation job to detect deletions (compare external IDs vs Magento API)

### 2.5 Deletion Detection — HARD

**The problem:** Magento's REST API does not return deleted records. Filtering by `updated_at` only returns records that still exist. When a product or customer is deleted in Magento, the delta sync won't notice.

**Approaches:**
1. **Full reconciliation** — periodically fetch all IDs from Magento, compare with `SyncExternalIdMapping`, mark missing as deleted. Expensive for large catalogs (100K+ products).
2. **Soft-delete detection** — Magento products have a `status` field (enabled/disabled). Some merchants disable rather than delete. The adapter can detect status changes.
3. **Webhook-based** — if using Adobe Commerce or custom webhooks, capture `catalog_product_delete_after` events.
4. **Changelog table** — custom Magento module that logs deletions to a separate table queryable via REST.

**Recommendation:** Implement option 1 (full reconciliation) as a scheduled job with configurable frequency (daily by default). Add option 3 as an enhancement for Adobe Commerce users.

### 2.6 Configurable Product Complexity — MEDIUM

**The problem:** Syncing a single Magento configurable product requires:
1. `GET /V1/products/:sku` — parent product data
2. `GET /V1/configurable-products/:sku/children` — all child simple products (variants)
3. `GET /V1/configurable-products/:sku/options/all` — configurable attributes and their values

This means 3N API calls for N configurable products, plus the children are full product objects that also appear in product listings (duplicates to filter).

**Mapping to Open Mercato:**
- Parent → `CatalogProduct` with `isConfigurable=true`, `productType='configurable'`
- Children → `CatalogProductVariant` entries linked to parent
- Configurable attributes → `optionValues` JSONB on each variant
- Option schema → `CatalogOptionSchemaTemplate` derived from configurable attributes

**Mitigation:**
- Use `fields` parameter to reduce payload size
- Batch variant fetching where possible
- Cache parent-child relationships in `SyncExternalIdMapping`
- Consider using the bulk API for exports

### 2.7 Rate Limiting & Input Limits — MEDIUM

**The problem:** Magento 2.4.3+ introduced:
- Sync request rate limit: 20 requests per window (default, disabled by default)
- Array input limit: 20 items per request (default)
- Page size limit: 300 items

**Impact on sync:**
- The `rate-limiter.ts` token-bucket implementation in SPEC-045b addresses this
- Batch sizes must respect the 300-item page size limit
- Bulk API writes must chunk at 20 items per request (or use async bulk endpoints)

**Recommendation:** The adapter should:
1. Auto-detect rate limits via response headers (429 status codes)
2. Default to conservative batch sizes (100 items for reads, 20 for writes)
3. Use the async bulk API (`/async/bulk/V1/...`) for large exports to Magento
4. Make rate limit thresholds configurable per-integration in credentials UI

### 2.8 Price Model Differences — MEDIUM

**The problem:** Magento and Open Mercato have different pricing architectures:

| Aspect | Magento 2 | Open Mercato |
|--------|-----------|--------------|
| Base price | Single `price` attribute per product | `CatalogProductPrice` per variant/offer/channel |
| Tax handling | Tax included/excluded per website config | `unitPriceNet` + `unitPriceGross` always stored |
| Tier pricing | By customer group + quantity | By customer/group + quantity + channel + time |
| Special price | Single special price + dates | Any number of promotional prices with date ranges |
| Currency | Price per website (single currency) | `CatalogPriceKind` with `currencyCode` per price entry |
| Catalog rules | Rule engine applies dynamic discounts | No equivalent rule engine |

**Mapping strategy:**
- Magento `price` → `CatalogProductPrice` with matching `CatalogPriceKind`
- Magento `special_price` + `special_from_date`/`special_to_date` → separate `CatalogProductPrice` with `startsAt`/`endsAt`
- Magento tier prices → `CatalogProductPrice` with `minQuantity` + `customerGroupId`
- Tax: determine from Magento website config whether prices include tax; set `unitPriceNet`/`unitPriceGross` accordingly
- Multi-currency: if Magento has multiple websites with different currencies, create prices per `CatalogPriceKind` (one per currency)

---

## 3. Proposed Bundle Structure

```
@open-mercato/sync-magento2
├── integration.ts          # Bundle definition + individual integration definitions
├── di.ts                   # DI registration for all adapters + services
├── lib/
│   ├── magento-client.ts   # REST API client with auth, pagination, rate limiting
│   ├── magento-auth.ts     # Token-based auth (admin token + refresh)
│   ├── shared-types.ts     # Magento REST API response types
│   └── store-view-resolver.ts  # Map store views to channels
├── adapters/
│   ├── products/
│   │   ├── adapter.ts      # DataSyncAdapter for products + variants
│   │   ├── mapping.ts      # Default field mapping
│   │   ├── transforms.ts   # Magento-specific transforms (EAV → flat)
│   │   └── configurable.ts # Configurable product handling
│   ├── categories/
│   │   ├── adapter.ts
│   │   └── mapping.ts
│   ├── customers/
│   │   ├── adapter.ts
│   │   └── mapping.ts
│   ├── orders/
│   │   ├── adapter.ts
│   │   └── mapping.ts
│   ├── invoices/
│   │   ├── adapter.ts
│   │   └── mapping.ts
│   ├── shipments/
│   │   ├── adapter.ts
│   │   └── mapping.ts
│   └── credit-memos/
│       ├── adapter.ts
│       └── mapping.ts
├── api/                    # Optional: Magento webhook receiver
│   └── post/magento2/webhook.ts
├── workers/
│   └── magento-reconciliation.ts  # Full reconciliation for deletion detection
├── i18n/
│   ├── en.ts
│   └── pl.ts
└── data/
    └── validators.ts       # Credential validation schemas
```

### Bundle Integration Definitions

```typescript
export const bundle: IntegrationBundle = {
  id: 'sync_magento2',
  title: 'Magento 2 / Adobe Commerce',
  description: 'Bidirectional sync with Magento 2 — products, categories, customers, orders, and documents.',
  icon: 'magento',
  package: '@open-mercato/sync-magento2',
  credentials: {
    fields: [
      { key: 'baseUrl', label: 'Magento Base URL', type: 'url', required: true, placeholder: 'https://mystore.com' },
      { key: 'authMethod', label: 'Authentication', type: 'select', options: [
        { value: 'token', label: 'Admin Token (username/password)' },
        { value: 'integration', label: 'Integration Token (OAuth)' },
      ]},
      { key: 'username', label: 'Admin Username', type: 'text', dependsOn: { authMethod: 'token' } },
      { key: 'password', label: 'Admin Password', type: 'secret', dependsOn: { authMethod: 'token' } },
      { key: 'accessToken', label: 'Access Token', type: 'secret', dependsOn: { authMethod: 'integration' } },
      { key: 'defaultStoreView', label: 'Default Store View', type: 'text', placeholder: 'default' },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [
  { id: 'sync_magento2_products', title: 'Magento 2 — Products', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_products', bundleId: 'sync_magento2' },
  { id: 'sync_magento2_categories', title: 'Magento 2 — Categories', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_categories', bundleId: 'sync_magento2' },
  { id: 'sync_magento2_customers', title: 'Magento 2 — Customers', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_customers', bundleId: 'sync_magento2' },
  { id: 'sync_magento2_orders', title: 'Magento 2 — Orders', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_orders', bundleId: 'sync_magento2' },
  { id: 'sync_magento2_invoices', title: 'Magento 2 — Invoices', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_invoices', bundleId: 'sync_magento2' },
  { id: 'sync_magento2_shipments', title: 'Magento 2 — Shipments', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_shipments', bundleId: 'sync_magento2' },
  { id: 'sync_magento2_credit_memos', title: 'Magento 2 — Credit Memos', category: 'data_sync', hub: 'data_sync', providerKey: 'magento2_credit_memos', bundleId: 'sync_magento2' },
]
```

---

## 4. Delta Sync Strategy

### 4.1 Cursor Design

Magento supports `updated_at` filtering on all major entities. The cursor format:

```
{entityType}:{lastUpdatedAt}:{lastPageProcessed}
```

Example: `catalog.product:2026-02-24T10:30:00Z:1`

### 4.2 Import Flow (Magento → Open Mercato)

```
1. Adapter receives StreamImportInput with cursor (or null for full sync)
2. Parse cursor → extract lastUpdatedAt timestamp
3. Build searchCriteria:
   - filter: updated_at >= lastUpdatedAt
   - sort: updated_at ASC, entity_id ASC
   - pageSize: 100 (configurable)
4. For each page:
   a. Fetch page from Magento REST API
   b. For configurable products: fetch children + options (parallel requests)
   c. Apply field mapping transforms
   d. Yield ImportBatch with items + cursor
   e. cursor = max(updated_at) from batch + page number
5. When total_count exhausted → hasMore = false
```

### 4.3 Export Flow (Open Mercato → Magento)

```
1. Query Open Mercato entities modified since last export cursor
2. For each batch:
   a. Transform to Magento REST API payload format
   b. Use async bulk API: POST /async/bulk/V1/products
   c. Poll bulk status until complete
   d. Map response IDs back to SyncExternalIdMapping
   e. Yield ExportBatch with results
```

### 4.4 Reconciliation (Deletion Detection)

```
1. Scheduled job (daily by default, configurable)
2. Fetch all entity IDs from Magento (paginated, fields=items[entity_id])
3. Load all SyncExternalIdMapping entries for this integration
4. Diff: mappings with no corresponding Magento ID → mark as "deleted externally"
5. Emit event: data_sync.entity.deleted_externally
6. Optionally soft-delete or flag the local entity (configurable per-mapping)
```

---

## 5. Risk Assessment

### Critical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Magento API token expiration mid-sync | Sync fails, must retry from cursor | MEDIUM | Auto-refresh admin token (4h default). Use integration tokens (no expiry) when possible. Wrap all API calls with token-refresh retry. |
| Large catalog (100K+ products) overwhelms sync | Hours-long imports, memory pressure | HIGH for enterprise | Streaming via `AsyncIterable` already handles this. Rate limiter prevents API overload. Configurable batch size. |

### High Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| EAV attribute mapping errors | Products imported with missing/wrong data | HIGH | Validation step before sync (`validateConnection`). Preview mode showing sample records with mapped fields. |
| Configurable product child deduplication | Same simple product imported twice (as standalone + as variant) | MEDIUM | Track `parent_id` relationships. Filter children from standalone product listing. |
| Multi-store-view data conflicts | Same product has different names/descriptions per store view | MEDIUM | Sync per-store-view data into Open Mercato translations. Designate one store view as "primary". |

### Medium Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Rate limiting blocks sync | Sync pauses/fails | LOW (disabled by default) | Token-bucket rate limiter in adapter. Exponential backoff on 429 responses. |
| Magento version differences (2.3 vs 2.4 vs 2.4.8) | API behavior variations | MEDIUM | Test against multiple versions. Version detection via `/V1/store/storeConfigs`. |
| Bulk API input limit (20 items) | Export throughput limited | LOW | Chunk exports to respect limits. Use `/async/bulk/` for larger batches. |

### Low Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Image sync bandwidth | Slow sync for media-heavy catalogs | LOW | Defer image sync to separate adapter. Use URL references instead of base64 download. |
| Tax model mismatch | Incorrect tax amounts on imported orders | LOW | Preserve original Magento tax amounts in snapshot. Don't recalculate. |

---

## 6. Coverage Summary

### Fully Supported (HIGH feasibility)

| Entity | Import | Export | Delta Sync | Notes |
|--------|--------|--------|------------|-------|
| Simple Products | YES | YES | YES (`updated_at`) | Direct mapping |
| Categories | YES | YES | YES (`updated_at`) | Hierarchical tree preserved |
| Customers | YES | YES | YES (`updated_at`) | Person profiles |
| Customer Addresses | YES | YES | YES | Via customer API |
| Orders | YES | YES | YES (`updated_at`) | Full document with lines |
| Invoices | YES | YES | YES (`updated_at`) | With line items |
| Shipments | YES | YES | YES (`updated_at`) | With tracking numbers |
| Credit Memos | YES | YES | YES (`updated_at`) | With line items |
| Tier Prices | YES | YES | YES | Via dedicated API |
| Special Prices | YES | YES | YES | Via dedicated API |
| Tax Rates | YES | NO | YES | Read-only import |
| Shipping Methods | YES | NO | YES | Configuration import |
| Payment Methods | YES | NO | YES | Configuration import |

### Partially Supported (MEDIUM feasibility)

| Entity | Import | Export | Limitation |
|--------|--------|--------|------------|
| Configurable Products | YES | YES | 3x API calls per product; complex variant mapping |
| Grouped Products | YES | NO | Relation model approximation via variant relations |
| Product Images | YES (first only) | NO | No media gallery entity in Open Mercato |
| Order Payments | YES | NO | Embedded in order; limited payment entity mapping |
| Store Views → Channels | YES | NO | Hierarchy flattening; manual review recommended |
| Customer Groups | YES | NO | Maps to dictionary entries, not first-class entity |
| Quotes/Carts | YES | NO | Conceptual mismatch (ephemeral vs formal) |

### Not Supported (BLOCKED or LOW)

| Entity | Reason | Workaround |
|--------|--------|------------|
| Inventory (MSI) | No Open Mercato inventory module | Defer; store in metadata as reference |
| Bundle Products | Complex option/selection model exceeds variant relations | Store bundle config in metadata JSONB |
| Downloadable Products | No digital delivery entity | Store download links in metadata |
| Cart/Catalog Price Rules | No promotion rules engine | Import applied discounts on orders only |
| Coupons | No coupon entity | N/A |
| CMS Pages/Blocks | Structural model mismatch | Import as content pages (lossy) |
| Product Attributes (EAV) | Fundamental architectural difference | Custom field provisioning wizard |
| Attribute Sets | Different concept than option templates | Approximate mapping |
| Real-time Webhooks (CE) | Not available in open-source Magento | Custom Magento module or Adobe Commerce |

---

## 7. Implementation Phasing

### Phase 1 — Core Sync (MVP)
- Products (simple + configurable) import with field mapping
- Categories import with tree preservation
- Customers import with addresses
- Orders import with lines, addresses, payments
- Delta sync via `updated_at` polling
- Admin UI: credential config, mapping review, sync dashboard

### Phase 2 — Full Document Flow
- Invoices, shipments, credit memos import
- Bidirectional product sync (export to Magento)
- Bidirectional order status sync
- Tier prices and special prices
- Scheduled sync via SPEC-045b scheduler

### Phase 3 — Advanced Features
- Grouped/bundle product support
- Multi-store-view → multilingual sync
- Product image gallery (if media entity added)
- Reconciliation job for deletion detection
- Adobe Commerce webhook receiver
- Customer group mapping

### Phase 4 — Inventory (requires platform work)
- Inventory module development in Open Mercato
- MSI source/stock/source-item sync
- Salable quantity calculation

---

## 8. Estimated Effort

| Phase | Scope | Effort |
|-------|-------|--------|
| Phase 1 | Core sync (products, categories, customers, orders) | 3-4 weeks |
| Phase 2 | Full document flow + bidirectional + scheduling | 2-3 weeks |
| Phase 3 | Advanced features + webhooks + reconciliation | 2-3 weeks |
| Phase 4 | Inventory module + MSI sync | 4-6 weeks (includes platform work) |

**Total:** 11-16 weeks for full coverage (phases 1-4)

---

## 9. Comparison with MedusaJS Reference Implementation

The MedusaJS bundle (SPEC-045b reference implementation) benefits from a much simpler data model. Magento 2 introduces significantly more complexity:

| Dimension | MedusaJS | Magento 2 |
|-----------|----------|-----------|
| Product model | Flat with variants | EAV + 6 product types + attribute sets |
| API style | Modern REST/GraphQL | Legacy REST with searchCriteria |
| Auth | Simple API key | Token-based (expiring) or OAuth 1.0a |
| Webhooks | Built-in | None (CE) / Adobe I/O Events (EE) |
| Multi-store | Single store | Website > Store > Store View hierarchy |
| Inventory | Simple stock per variant | Multi-Source Inventory (MSI) |
| Pricing | Single price per variant | EAV-based with tier/special/group prices |
| Bulk operations | Not needed (modern API) | Required for performance at scale |
| Pagination | Cursor-based | Page-number-based |

**Conclusion:** The Magento 2 adapter is approximately 2-3x more complex than the MedusaJS reference implementation, primarily due to the EAV attribute system, configurable product handling, multi-store hierarchy, and lack of webhooks in the open-source edition.

---

## 10. Verdict & Recommendations

**Overall: FEASIBLE with caveats.**

The SPEC-045 framework provides all the building blocks needed. The `DataSyncAdapter` contract, delta streaming, field mapping, credential management, and bundle pattern all map well to Magento 2's API capabilities. The main gaps are on the Open Mercato platform side (missing inventory module, no promotion rules engine) rather than limitations of the integration framework itself.

**Key recommendations:**
1. Start with Phase 1 (core sync) to validate the adapter pattern with real Magento instances
2. Use integration tokens (no expiry) instead of admin tokens for production deployments
3. Build the EAV attribute mapping wizard early — it's the highest user-friction point
4. Plan inventory module development in parallel if Magento merchants are a primary target
5. Test with Magento 2.4.6+ (latest stable) and Adobe Commerce 2.4.7+ for best API support
6. Consider Magento's GraphQL API as a future alternative for storefront-focused sync (product catalog reads)
