# ANALYSIS-007 — Akeneo PIM Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Author** | AI Analysis |
| **Related Specs** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub) |
| **Subject** | Akeneo PIM (Community Edition + Enterprise Edition) |

---

## Executive Summary

Akeneo PIM integration with Open Mercato is **highly feasible (~85% coverage)**. The Open Mercato integration framework (SPEC-045 / SPEC-045b) provides all the primitives needed — `DataSyncAdapter`, delta streaming with cursor persistence, field mapping, OAuth 2.0 credentials, bidirectional ID mapping — and Akeneo's REST API is well-designed for exactly this use case: product data syndication. Akeneo explicitly supports `updated` timestamp filtering for delta sync, cursor-based pagination (`search_after`), bulk PATCH operations (100 items/batch), and OAuth 2.0 authentication — all aligning directly with the `DataSyncAdapter` contract.

The primary challenges are: (1) Akeneo's flexible attribute model (unlimited, family-scoped attributes) vs Open Mercato's structured product model (fixed fields + option schemas + custom fields), which requires a sophisticated mapping layer; (2) media files require download-and-rehost since Akeneo media URLs are authenticated, not CDN-served; (3) Enterprise-only features (Reference Entities, Asset Manager, Event Platform) split the integration into two tiers.

**Verdict**: Build as an integration bundle (`@open-mercato/sync-akeneo`) with 4-6 entity sync adapters. Expect the initial implementation (Community Edition scope) to take **4-6 weeks**. Enterprise Edition features add **2-3 weeks**. This is comparable in complexity to the MedusaJS reference bundle, with the attribute mapping layer being the primary additional effort.

---

## 1. Entity Mapping Analysis

### 1.1 Direct Mappings (High Confidence)

These entities have clear counterparts between the two systems.

| Akeneo Entity | Open Mercato Entity | Sync Direction | Complexity | Notes |
|---------------|---------------------|----------------|------------|-------|
| **Products** (simple) | `CatalogProduct` + `CatalogProductVariant` (default) | Bidirectional | Medium | Core mapping. Akeneo product `values` must be flattened to Open Mercato's fixed fields (`title`, `description`, `sku`, `weight`, `dimensions`) + custom fields for extra attributes. Akeneo `identifier`/`uuid` maps to `externalId`. |
| **Product Models** + variant products | `CatalogProduct` (configurable) + `CatalogProductVariant[]` | Import-primary | High | Akeneo's 2-level variant hierarchy (model → sub-model → variant) must collapse to Open Mercato's flat product-variants relationship. Variant axes map to `CatalogOptionSchemaTemplate`. |
| **Categories** | `CatalogProductCategory` | Bidirectional | Low | Near-1:1. Both support hierarchical trees. Akeneo `code` maps to `slug`. Akeneo `labels` (multilingual) maps via Translation Manager. Parent-child structure aligns. |
| **Category-Product links** | `CatalogProductCategoryAssignment` | Bidirectional | Low | Akeneo product `categories[]` array maps directly to assignment junction table. |
| **Families** | `CatalogOptionSchemaTemplate` | Import | Medium | Akeneo families define which attributes a product uses. Closest Mercato concept is option schema templates, but the mapping is lossy — families carry completeness requirements which have no Mercato equivalent. Best mapped as metadata on the product or a custom entity. |
| **Attributes** (select/multi-select) | `CatalogOptionSchemaTemplate.schema.options` | Import | Medium | Akeneo select attributes with options map to option schema choices. Free-text/number attributes map to custom fields. |
| **Channels** | Sales channels (via `CatalogOffer.channelId`) | Import | Low | Akeneo channels define which attributes/locales are relevant per scope. Maps to Open Mercato's channel-scoped offers. |
| **Prices** (`pim_catalog_price_collection`) | `CatalogProductPrice` | Import | Medium | Akeneo prices are multi-currency attribute values. Map to `CatalogProductPrice` with appropriate `currencyCode` and `priceKindId`. Akeneo lacks tier pricing — only one price per currency per scope. |
| **Associations** (cross-sell, up-sell) | `CatalogProductVariantRelation` | Import | Medium | Akeneo association types (CROSS_SELL, UPSELL, PACK) map to variant relations with `relationType`. Quantified associations (v5.0+) map to `minQuantity`/`maxQuantity`. |
| **Media files** | `attachments` module + `CatalogProduct.defaultMediaId` | Import | High | Akeneo media files require authenticated download, binary transfer, and re-upload to Open Mercato's attachment/storage system. Not a simple URL copy. |

### 1.2 Partial Mappings (Medium Confidence)

| Akeneo Entity | Open Mercato Entity | Direction | Complexity | Gap Description |
|---------------|---------------------|-----------|------------|-----------------|
| **Attribute Options** | `CatalogOptionSchemaTemplate.schema.options[].choices` | Import | Medium | Akeneo attribute options (color: red/blue/green) map to option schema choices. But Akeneo allows unlimited options per attribute while Open Mercato caps at 200 choices per option and 64 options per schema. Large catalogs may hit limits. |
| **Attribute Groups** | No direct equivalent | Import | Low | Akeneo groups attributes for UI organization. Could be stored as metadata on custom field sets. Not critical for data sync. |
| **Family Variants** | `CatalogOptionSchemaTemplate` (variant axes) | Import | High | Family variants define how attributes distribute across the variant hierarchy (common vs variant-level). This logic must be encoded into how the adapter splits Akeneo product model values between `CatalogProduct` and `CatalogProductVariant` records. |
| **Locales** | Translation Manager | Import | Medium | Akeneo attributes can be localizable (per-locale values). Open Mercato supports translations for `title`, `subtitle`, `description` via Translation Manager. Additional localizable attributes require custom field translations — which may not exist yet. |
| **Measurement families** | `CatalogProduct.weightUnit`, `defaultUnit` | Import | Low | Akeneo metric attributes store value + unit. Maps to weight/dimensions fields. Custom metrics need custom fields. |
| **Completeness** | No equivalent | N/A | N/A | Akeneo completeness tracks enrichment progress per channel/locale. Open Mercato has no equivalent concept. Can be stored as metadata for display purposes only. |
| **Quality Scores** | No equivalent | N/A | N/A | Akeneo v5.0+ quality scoring. Informational only — store as metadata if desired. |

### 1.3 No Mapping (Akeneo entities with no Mercato equivalent)

| Akeneo Entity | Reason | Recommendation |
|---------------|--------|----------------|
| **Reference Entities** (Enterprise) | Custom master data structures (brands, materials). No generic equivalent in Mercato. | Map to `dictionaries` module entries or custom entities. Requires per-tenant configuration. |
| **Asset Manager** (Enterprise) | Full DAM with families, transformations, auto-tagging. | Out of scope for initial integration. Media files from assets can be imported as attachments, but transformations/rules have no equivalent. |
| **Published Products** (Enterprise, deprecated) | Frozen product versions for approval workflows. | Ignore — deprecated even in Akeneo. |
| **Rules Engine** (Enterprise) | Automated data enrichment rules. | Server-side only; not API-manageable. Ignore. |
| **Workflow/Approval** (Enterprise) | Product approval status. | Can import `metadata.workflow_status` as product metadata for informational display. No action possible. |

---

## 2. Technical Compatibility

### 2.1 Authentication

| Aspect | Akeneo PIM | Open Mercato Framework | Compatible? |
|--------|-----------|----------------------|-------------|
| Protocol | OAuth 2.0 (password grant) | OAuth 2.0 credential type (SPEC-045a) | Partial |
| Grant type | Password grant (client_id + secret + username + password) | Authorization Code + PKCE, Client Credentials | **Mismatch** |
| Token lifetime | 1 hour (access), 14 days (refresh) | Background refresh worker handles renewal | Yes |
| Token storage | N/A (consumer) | Encrypted per-tenant (`IntegrationCredentials`) | Yes |

**Key Issue**: Akeneo uses the OAuth 2.0 **password grant** (deprecated in OAuth 2.1), not Authorization Code or Client Credentials. The adapter must:
1. Store `client_id`, `secret`, `username`, and `password` as credential fields (all four required)
2. Implement token acquisition via `POST /api/oauth/v1/token` with `grant_type=password`
3. Handle token refresh via refresh_token (same endpoint, `grant_type=refresh_token`)

The SPEC-045a OAuth 2.0 credential type (Authorization Code + PKCE) does not directly cover password grant. **Solution**: Use the standard `text`/`secret` credential fields (not the `oauth` type) and implement token management in the adapter's `validateConnection()` and a helper service. This is simpler than the full OAuth flow anyway.

```typescript
credentials: {
  fields: [
    { key: 'apiUrl', label: 'Akeneo PIM URL', type: 'url', required: true, placeholder: 'https://your-pim.cloud.akeneo.com' },
    { key: 'clientId', label: 'Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
    { key: 'username', label: 'API Username', type: 'text', required: true },
    { key: 'password', label: 'API Password', type: 'secret', required: true },
  ],
}
```

**Effort**: Low. Token management is straightforward — acquire, cache, refresh on 401.

### 2.2 API Protocol

| Aspect | Akeneo PIM | Open Mercato DataSync | Impact |
|--------|-----------|----------------------|--------|
| Protocol | REST (standard JSON) | Generic REST (adapter handles serialization) | Low — clean JSON responses |
| Response format | Standard JSON (not JSON:API) | Adapter normalizes to `Record<string, unknown>` | Low — straightforward parsing |
| Pagination | Search-after (cursor) + offset (page) | Cursor-based (`DataSyncAdapter` uses string cursors) | **Excellent match** |
| Filtering | `search={"field":[{"operator":"..","value":".."}]}` | N/A (adapter-internal) | Fine — adapter constructs filters |
| Bulk operations | PATCH collection (JSONL, 100 items/batch) | N/A (adapter handles batching) | Useful for export |

**Assessment**: Excellent protocol compatibility. Akeneo's `search_after` pagination is a cursor-based approach that maps directly to the `DataSyncAdapter` cursor contract. The adapter receives `_links.next.href` from each response and uses it as the cursor string. No synthetic cursor encoding needed (unlike OroCRM).

### 2.3 Delta Detection (Change Tracking)

| Method | Akeneo Support | Feasibility |
|--------|---------------|-------------|
| `updated` timestamp filtering | **Yes** — `search={"updated":[{"operator":">","value":"..."}]}` | **Primary strategy** |
| Search-after pagination | **Yes** — native cursor-based iteration | **Ideal for streaming** |
| Webhooks (Event Platform) | Enterprise only (HTTPS, Pub/Sub, SQS) | Optional enhancement |
| Relative date filtering | **Yes** — `SINCE LAST N DAYS` operator | Useful for scheduled sync |
| ETag / If-Modified-Since | Not supported | N/A |

**Assessment**: Delta detection is **well-supported**. The adapter stores the last sync timestamp as the cursor and queries with `updated > cursor`. Combined with `search_after` pagination, this maps perfectly to the `DataSyncAdapter.streamImport()` contract — each batch yields items, a cursor (the `search_after` token or the max `updated` timestamp), and a `hasMore` flag.

**Limitation**: Categories and attribute options do **not** support `updated` filtering. These entities require full re-import on each sync. Since they're typically small (hundreds, not millions), this is acceptable.

**Deletion detection**: Akeneo does not push deletion events (Community Edition). The adapter must handle this via periodic reconciliation — compare known `externalId` mappings against current Akeneo IDs. Enterprise Edition's Event Platform can push product deletion events.

### 2.4 Rate Limits

| Metric | Akeneo PIM | Impact |
|--------|-----------|--------|
| General rate limit | 100 requests/second | **Very generous** — not a bottleneck |
| Attribute options | 3 requests/second | Significant for initial schema import |
| Concurrent per connection | 4 | Must limit parallel requests |
| Concurrent per PIM instance | 10 | Shared across all integrations |
| Batch size (bulk PATCH) | 100 items/request | Matches DataSyncAdapter batch size |
| Pagination limit | 100 items/page | Matches DataSyncAdapter default batch size |
| Retry strategy | 429 + `Retry-After` header | Use `rate-limiter.ts` token bucket |

**Impact Analysis**:

| Scenario | Records | API Calls | Time Estimate |
|----------|---------|-----------|---------------|
| Initial full sync: 10K products | 10,000 | ~100 pages | ~2 seconds |
| Initial full sync: 100K products | 100,000 | ~1,000 pages | ~15 seconds |
| Initial full sync: 1M products | 1,000,000 | ~10,000 pages | ~2.5 minutes |
| Delta sync: 500 changed products | 500 | ~5 pages | < 1 second |
| Full category tree: 5K categories | 5,000 | ~50 pages | < 1 second |
| All attributes + options: 200 attrs | 200 | ~200 + 200 option calls | ~70 seconds (options throttled) |

**Assessment**: Akeneo's rate limits are **very generous** compared to most PIM/CRM systems. The 100 req/s general limit means even million-product catalogs can be fully synced in minutes. The only bottleneck is attribute options at 3 req/s — mitigated by caching attribute schemas since they rarely change.

### 2.5 Data Write-Back (Export to Akeneo)

| Operation | Akeneo API Support | Complexity |
|-----------|--------------------|------------|
| Create product | `POST /api/rest/v1/products-uuid` | Low |
| Update product | `PATCH /api/rest/v1/products-uuid/{uuid}` | Low |
| Bulk create/update | `PATCH /api/rest/v1/products-uuid` (JSONL) | Low — 100/batch |
| Create category | `POST /api/rest/v1/categories` | Low |
| Upload media | `POST /api/rest/v1/media-files` (multipart) | Medium — must link to product |
| Create attribute | `POST /api/rest/v1/attributes` | Medium — schema design |
| Create attribute option | `POST /api/rest/v1/attributes/{code}/options` | Low |
| Delete product | `DELETE /api/rest/v1/products-uuid/{uuid}` | Low — opt-in only |
| Upsert (via bulk PATCH) | Implicitly — 201 for new, 204 for existing | Low — natural fit |

**Assessment**: Export is well-supported. The bulk PATCH endpoint with JSONL format (100 items/batch) is ideal for the `streamExport()` contract. Individual line-level response codes (201/204/422) map directly to `ExportItemResult.status`. The `create_missing_options` query parameter is a bonus — it auto-creates select option values during product import, reducing setup steps.

---

## 3. What Works Well (Low Risk)

| Capability | Why It Works |
|------------|-------------|
| **Product import (simple products)** | Clean mapping: Akeneo product → CatalogProduct. Standard fields (SKU, name/title, description) map directly. Custom attributes → custom fields. |
| **Category sync** | Near-identical tree structure. Both support hierarchical categories with parent-child relationships. |
| **Delta sync via timestamps** | Akeneo's `updated` filter + search_after pagination = perfect match for `DataSyncAdapter.streamImport()` cursor contract. |
| **Bulk operations** | Akeneo's 100-item JSONL batch PATCH maps perfectly to `streamExport()` batch size. |
| **Credential management** | Standard text/secret fields. Token management via adapter helper — simpler than full OAuth flow. |
| **Rate limiting** | 100 req/s is generous. Token-bucket rate limiter in `data_sync/lib/rate-limiter.ts` handles 429 responses. |
| **Operation logging** | `IntegrationLog` captures all API interactions. Akeneo's per-line error responses in bulk operations map to item-level error logging. |
| **ID mapping** | `SyncExternalIdMapping` handles Akeneo UUID ↔ Mercato UUID bidirectional resolution. Match by `sku` also supported. |
| **Scheduled sync** | Scheduler widget (SPEC-045b) for periodic delta imports. 5-minute intervals feasible given generous rate limits. |
| **Multi-currency pricing** | Akeneo price attributes store amounts per currency. Maps to `CatalogProductPrice` records with matching `currencyCode`. |
| **API versioning** | Akeneo has a single API version (v1). No version management complexity — `apiVersions` in `integration.ts` can be omitted. |

---

## 4. What's Difficult (High Risk / High Effort)

### 4.1 Attribute Model Mismatch — The Core Challenge

**Problem**: Akeneo's product data model is fundamentally attribute-based — a product is a bag of key-value pairs where the attributes are defined by the product's family. Open Mercato has a structured product model with fixed fields (`title`, `description`, `sku`, `weight`, `dimensions`) plus optional custom fields.

**Akeneo**: 200+ attribute types, unlimited attributes per family, localizable + scopable per attribute.
**Open Mercato**: ~15 fixed product fields + custom fields (via `ce.ts`) + option schemas (for variant axes).

**Impact**:
- Standard attributes (`name`, `description`, `sku`, `weight`) map cleanly to fixed fields
- Custom Akeneo attributes (e.g., `material`, `care_instructions`, `brand`) must map to custom fields
- Localizable attributes beyond `title`/`subtitle`/`description` require custom field translations (which may need framework enhancement)
- Scopable attributes (per-channel values) partially map to `CatalogOffer` channel-scoped fields, but only for `title`/`description` — other scopable attributes need per-channel custom fields

**Workaround**:
1. Define a default field mapping that covers standard product fields
2. Use the `SyncMapping` admin UI to let admins map additional Akeneo attributes to Open Mercato custom fields
3. Auto-detect Akeneo families and suggest field mappings based on attribute types
4. Store unmapped attributes in `CatalogProduct.metadata` JSONB as a fallback

**Effort**: High (2-3 weeks). This is the single largest piece of work — building a robust attribute-to-field mapping engine that handles type conversion, localization, and scopability.

### 4.2 Variant Hierarchy Flattening

**Problem**: Akeneo supports a 2-level variant hierarchy:
```
Product Model (level 1) — common attributes (brand, collection)
  └─ Product Model (level 2) — mid-level attributes (color)
       └─ Variant Product — leaf attributes (size)
```

Open Mercato has a flat hierarchy:
```
CatalogProduct (configurable) — all common attributes
  └─ CatalogProductVariant — variant-specific option values
```

**Impact**:
- 2-level Akeneo hierarchies must collapse to 1-level Open Mercato structure
- The adapter must merge level-1 and level-2 model attributes into the `CatalogProduct`
- Variant axes from family variants must be converted to `CatalogOptionSchemaTemplate`
- Akeneo allows up to 5 variant axes per level (10 total across 2 levels); Open Mercato has no documented axis limit but option schemas cap at 64 options

**Workaround**:
1. Treat the top-level product model as the `CatalogProduct`
2. Merge all model-level attributes (level 1 + level 2) into the product
3. Create `CatalogProductVariant` records only for leaf-level variant products
4. Generate `CatalogOptionSchemaTemplate` from family variant axis definitions
5. Store the original Akeneo hierarchy in variant `metadata` for reference

**Effort**: High (1-2 weeks). The flattening logic is complex but well-defined.

### 4.3 Media File Transfer

**Problem**: Akeneo media file URLs require authentication — they are not publicly accessible CDN URLs. The download endpoint (`GET /api/rest/v1/media-files/{code}/download`) returns the binary file with Bearer authentication.

**Impact**:
- Cannot simply copy Akeneo media URLs to `CatalogProduct.defaultMediaUrl`
- Must download each media file from Akeneo, then upload to Open Mercato's storage/attachment system
- For large catalogs with many images (5-10 per product), media transfer dominates sync time
- A 100K product catalog with 5 images each = 500K media files to transfer

**Workaround**:
1. Implement a dedicated media transfer step in the adapter's `streamImport()`
2. Use content hashing to detect changed media (avoid re-downloading unchanged images)
3. Process media in parallel (up to 4 concurrent connections per Akeneo's limit)
4. Support configurable media quality/size (download original vs specific size)
5. Make media sync optional — admin can toggle "sync media files" in the configuration

**Effort**: Medium-High (1-2 weeks). The transfer pipeline is straightforward but the volume and error handling (partial failures, retries, storage limits) add complexity.

### 4.4 Localizable + Scopable Attribute Combinations

**Problem**: Akeneo attributes can be both localizable (per-locale) AND scopable (per-channel) simultaneously. A single attribute can have N * M values (N locales x M channels).

**Open Mercato support**:
- **Localizable**: Translation Manager supports `title`, `subtitle`, `description` translations. Custom fields don't have built-in translation support.
- **Scopable**: `CatalogOffer` supports channel-scoped `title`/`description`. Other fields are not channel-scoped.
- **Localizable + Scopable**: No combined support for arbitrary attributes.

**Impact**:
- Standard fields (`title`, `description`) in the default locale/channel map cleanly
- Translations for standard fields work via Translation Manager
- Channel-scoped overrides for `title`/`description` work via `CatalogOffer`
- Arbitrary localizable-scopable attributes (e.g., `marketing_copy` localized per channel) have no clean mapping

**Workaround**:
1. Import the "primary" locale/channel values as the main product fields
2. Import additional locale values as translations (for supported fields)
3. Import additional channel values as `CatalogOffer` overrides (for title/description)
4. Store remaining localizable-scopable combinations in `metadata` JSONB
5. Document the limitation: not all Akeneo locale x channel combinations will be preserved in bidirectional sync

**Effort**: Medium. The core mapping works; edge cases require metadata fallback.

### 4.5 Deletion Detection (Community Edition)

**Problem**: Akeneo Community Edition has no webhook/event system. When a product is deleted in Akeneo, there is no push notification. The `updated` timestamp filter only catches creates and updates.

**Impact**: Products deleted in Akeneo will remain as active products in Open Mercato until explicitly detected.

**Workaround**:
1. Periodic reconciliation job: fetch all Akeneo product UUIDs, compare against `SyncExternalIdMapping`, soft-delete missing products
2. Make reconciliation configurable: daily/weekly, with dry-run mode
3. Enterprise Edition: use Event Platform for real-time deletion events

**Effort**: Medium. Reconciliation logic is standard but must be efficient for large catalogs (set-difference on UUID lists).

---

## 5. What's Missing (Framework Gaps)

### 5.1 Password Grant OAuth Support

**Gap**: SPEC-045a's OAuth 2.0 credential type supports Authorization Code + PKCE but not password grant.

**Impact**: Cannot use the built-in OAuth token management for Akeneo.

**Solution**: Implement token management in the adapter itself using standard text/secret credential fields. This is actually simpler than the full OAuth flow — no redirect URLs, no consent screens, just a POST request.

**Effort**: Low. Not a real gap — just a different approach.

### 5.2 Custom Field Translations

**Gap**: Open Mercato's Translation Manager supports translations for predefined entity fields (`title`, `subtitle`, `description`). Custom fields (from `ce.ts`) do not appear to have translation support.

**Impact**: Akeneo attributes mapped to custom fields lose their localizable property. A product with `marketing_copy` in 5 languages will only retain one language version when mapped to a custom field.

**Solution**: Either (a) extend the Translation Manager to support custom field translations (framework change), or (b) store all locale variants in the custom field value as a JSON object (`{"en_US": "...", "fr_FR": "..."}`).

**Effort**: Medium (option b) or High (option a — framework change).

### 5.3 Completeness / Enrichment Tracking

**Gap**: Open Mercato has no concept of product data completeness. Akeneo's completeness percentage (per channel/locale) tracks how "done" a product's data is.

**Impact**: Admins who rely on Akeneo completeness as a publishing gate lose this signal in Open Mercato.

**Solution**: Store completeness as product metadata (`metadata.akeneo_completeness`). Optionally build a widget that displays it on the product detail page. Not critical for MVP.

**Effort**: Low. Informational only.

### 5.4 Measurement Unit Conversion

**Gap**: Akeneo metric attributes store value + unit (e.g., `{"amount": "10.5", "unit": "KILOGRAM"}`). Open Mercato stores weight as `weightValue` + `weightUnit` but has no unit conversion system.

**Impact**: If Akeneo products use mixed units (some in kg, some in lbs), Open Mercato stores them as-is without conversion capability.

**Solution**: Add unit normalization transforms in the field mapping configuration (`transforms.ts` in data_sync). The adapter can register transforms like `convertWeight('KILOGRAM', 'kg')`.

**Effort**: Low. Built-in transform functions handle this.

---

## 6. Implementation Architecture

### 6.1 Module Structure

```
packages/core/src/modules/sync_akeneo/
├── index.ts                        # Module metadata
├── integration.ts                  # Bundle: registers multiple sync integrations
├── di.ts                          # Akeneo API client service
├── setup.ts                       # Register adapters
├── lib/
│   ├── akeneo-client.ts           # HTTP client with auth, pagination, rate limiting
│   ├── token-manager.ts           # OAuth password grant token lifecycle
│   ├── attribute-mapper.ts        # Akeneo attributes → Mercato fields
│   ├── variant-flattener.ts       # 2-level hierarchy → flat product/variants
│   ├── media-transfer.ts          # Download from Akeneo, upload to Mercato storage
│   ├── transforms.ts              # Akeneo-specific field transforms
│   └── adapters/
│       ├── products.ts            # DataSyncAdapter for products + variants
│       ├── categories.ts          # DataSyncAdapter for categories
│       ├── families.ts            # DataSyncAdapter for families → option schemas
│       ├── prices.ts              # DataSyncAdapter for price attributes
│       └── associations.ts        # DataSyncAdapter for product associations
├── data/
│   └── validators.ts              # Akeneo-specific validation schemas
├── widgets/
│   └── injection/
│       └── attribute-mapping/
│           ├── widget.ts          # Attribute mapping configuration widget
│           └── widget.client.tsx   # Visual attribute mapper UI
├── backend/
│   └── sync-akeneo/
│       └── page.tsx               # Akeneo-specific configuration page
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 6.2 Integration Bundle Declaration

```typescript
// integration.ts
export const bundle: IntegrationBundle = {
  id: 'sync_akeneo',
  title: 'Akeneo PIM',
  description: 'Sync products, categories, and pricing from Akeneo PIM',
  icon: 'akeneo',
  category: 'data_sync',
  hub: 'data_sync',
  credentials: {
    fields: [
      { key: 'apiUrl', label: 'Akeneo PIM URL', type: 'url', required: true },
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
      { key: 'username', label: 'API Username', type: 'text', required: true },
      { key: 'password', label: 'API Password', type: 'secret', required: true },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [
  { id: 'sync_akeneo_products', title: 'Products', category: 'data_sync', hub: 'data_sync', providerKey: 'akeneo_products', bundleId: 'sync_akeneo' },
  { id: 'sync_akeneo_categories', title: 'Categories', category: 'data_sync', hub: 'data_sync', providerKey: 'akeneo_categories', bundleId: 'sync_akeneo' },
  { id: 'sync_akeneo_families', title: 'Families', category: 'data_sync', hub: 'data_sync', providerKey: 'akeneo_families', bundleId: 'sync_akeneo' },
  { id: 'sync_akeneo_prices', title: 'Prices', category: 'data_sync', hub: 'data_sync', providerKey: 'akeneo_prices', bundleId: 'sync_akeneo' },
  { id: 'sync_akeneo_associations', title: 'Associations', category: 'data_sync', hub: 'data_sync', providerKey: 'akeneo_associations', bundleId: 'sync_akeneo' },
]
```

### 6.3 Sync Order (Dependencies)

Entity sync must follow dependency order:

```
1. Families + Attributes  → creates option schema templates
2. Categories              → creates category tree
3. Products (simple)       → creates products with category/family assignments
4. Products (configurable) → creates configurable products + variants
5. Prices                  → creates price records linked to products/variants
6. Associations            → creates variant relations linked to products
7. Media (parallel)        → downloads and re-hosts product images
```

### 6.4 Default Field Mapping

| Akeneo Attribute | Open Mercato Field | Transform |
|------------------|--------------------|-----------|
| `values.name` (or family-configured title attribute) | `CatalogProduct.title` | Locale-aware extraction |
| `values.description` | `CatalogProduct.description` | Locale-aware, HTML strip optional |
| `identifier` / `values.sku` | `CatalogProduct.sku` | Direct |
| `uuid` | `SyncExternalIdMapping.externalId` | Direct |
| `values.weight` (metric) | `CatalogProduct.weightValue` + `weightUnit` | Metric split |
| `values.length/width/height` (metric) | `CatalogProduct.dimensions` | Metric to JSONB |
| `enabled` | `CatalogProduct.isActive` | Boolean |
| `family` | `CatalogProduct.optionSchemaTemplate` (FK lookup) | Code-to-ID resolution |
| `categories[]` | `CatalogProductCategoryAssignment[]` | Code-to-ID resolution |
| `values.price` (price_collection) | `CatalogProductPrice[]` | Multi-currency split |
| `values.{image_attr}` (media) | `CatalogProduct.defaultMediaId` | Media transfer |
| `associations.{type}` | `CatalogProductVariantRelation[]` | Type mapping |

---

## 7. Community vs Enterprise Feature Matrix

| Feature | Community | Enterprise | Integration Impact |
|---------|-----------|------------|-------------------|
| Products/Categories/Families | Full API | Full API | Core sync works on both |
| Attributes/Options | Full API | Full API | Full support |
| Media files | Full API | Full API | Download + re-host required |
| Bulk PATCH (100/batch) | Yes | Yes | Export works on both |
| Delta sync (updated filter) | Yes | Yes | Core delta works on both |
| Search-after pagination | Yes | Yes | Cursor pagination works on both |
| **Reference Entities** | **No** | Yes | Enterprise-only adapter needed |
| **Asset Manager** | **No** | Yes | Enterprise-only media pipeline |
| **Event Platform (webhooks)** | **No** | Yes | Enterprise enables real-time sync |
| **Workflow/Approval status** | **No** | Yes | Metadata-only import |
| **GraphQL API** | **No** | SaaS only | Alternative query interface; optional |

**Recommendation**: Build the Community Edition integration first (products, categories, families, prices, associations). Add Enterprise-only features (reference entities, asset manager, event platform) as optional adapters in phase 2.

---

## 8. Effort Estimates

### Phase 1: Core Integration (Community Edition)

| Component | Effort | Notes |
|-----------|--------|-------|
| Akeneo API client + token manager | 2-3 days | HTTP client, auth, pagination, rate limiting |
| Product adapter (simple products) | 3-4 days | Field mapping, custom field handling |
| Product adapter (configurable + variants) | 4-5 days | Variant hierarchy flattening, option schema generation |
| Category adapter | 1-2 days | Near-1:1 mapping |
| Family/attribute schema import | 2-3 days | Attribute-to-option-schema conversion |
| Price adapter | 2-3 days | Multi-currency, price kind mapping |
| Association adapter | 1-2 days | Type mapping, quantity handling |
| Media transfer pipeline | 3-4 days | Download, re-host, hash-based dedup |
| Attribute mapping widget UI | 3-4 days | Visual mapper for Akeneo attributes → Mercato fields |
| Deletion reconciliation | 1-2 days | Full-scan ID comparison |
| Integration tests | 3-4 days | Mock Akeneo API, end-to-end sync tests |
| **Total Phase 1** | **25-36 days (5-7 weeks)** | |

### Phase 2: Enterprise Features (Optional)

| Component | Effort | Notes |
|-----------|--------|-------|
| Reference entity adapter | 3-4 days | Maps to dictionaries or custom entities |
| Asset manager integration | 3-4 days | Extended media pipeline with transformations |
| Event Platform webhook receiver | 2-3 days | Real-time sync via HTTPS endpoint |
| **Total Phase 2** | **8-11 days (2-3 weeks)** | |

### Prerequisites (Must Be Complete First)

| Dependency | Status | Spec |
|------------|--------|------|
| `integrations` core module | Not built | SPEC-045a |
| `data_sync` hub module | Not built | SPEC-045b |
| `DataSyncAdapter` contract | Not built | SPEC-045b |
| Scheduler service | Built | packages/scheduler |
| Progress module | Built | SPEC-004 |

---

## 9. Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Attribute model mismatch causes data loss on bidirectional sync | High | High | Default to import-only for MVP; export only standard fields |
| Media transfer bottleneck on large catalogs (500K+ images) | Medium | High | Parallel download, hash-based skip, configurable media sync toggle |
| Variant hierarchy flattening loses Akeneo enrichment levels | Medium | Medium | Store original hierarchy in metadata; document limitation |
| Akeneo API changes break adapter (new attributes, changed responses) | Low | Low | Single API version (v1); Akeneo is conservative about breaking changes |
| Custom field translations not supported in Open Mercato | Medium | High | Store as JSONB in metadata; propose framework enhancement |
| Deletion reconciliation timeout on million-product catalogs | Low | Medium | Paginated ID comparison; background worker with progress tracking |
| Rate limit exceeded during attribute options import (3 req/s) | Low | Medium | Cache attribute schemas; batch option imports |

---

## 10. Verdict & Recommendations

### Overall Feasibility: Highly Feasible (~85% Coverage)

Akeneo PIM is one of the **best-fitting external systems** for the Open Mercato integration framework. The API is well-designed, rate limits are generous, delta sync is natively supported, and bulk operations align with the `DataSyncAdapter` batch model. The primary challenge — attribute model mismatch — is inherent to any PIM-to-commerce integration and is well-mitigated by the field mapping UI.

### Recommended Approach

1. **Start import-only** — Akeneo is the source of truth for product data. Build `streamImport()` first.
2. **Attribute mapping UI is critical** — Invest in a good visual mapper. This is where admins spend their time.
3. **Make media sync optional and incremental** — Large catalogs can skip media on initial sync, then backfill.
4. **Community Edition first** — Covers 80% of Akeneo installations. Enterprise features are additive.
5. **Defer bidirectional sync** — Export to Akeneo is technically feasible but the attribute model mismatch makes it lossy. Build import first, add export as a follow-up.

### What Will NOT Work

| Feature | Reason |
|---------|--------|
| Full bidirectional attribute sync | Open Mercato's fixed schema cannot represent arbitrary Akeneo attributes without data loss |
| Real-time sync (Community Edition) | No webhook/event system; polling only |
| Akeneo completeness enforcement | No equivalent concept in Open Mercato |
| Asset Manager transformations | No image processing pipeline in Open Mercato |
| Akeneo Rules Engine mirroring | Server-side only; not API-accessible |
| Published Products workflow | Deprecated in Akeneo; no equivalent in Open Mercato |

### What Requires Framework Enhancement

| Enhancement | Effort | Priority |
|-------------|--------|----------|
| Custom field translations (Translation Manager) | High | Medium — needed for full localization support |
| Password grant OAuth support in SPEC-045a | Low | Low — adapter workaround is simpler |
| Completeness tracking widget | Low | Low — informational only |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial analysis |
