# Magento 2.4 Integration

## TLDR

**Key Points:**
- Provider package `@open-mercato/sync-magento` — an **official module** shipped in the [`open-mercato/official-modules`](https://github.com/open-mercato/official-modules) repository; activated in a host app via `official-modules.json`. An Integration Bundle for Magento 2.4 (REST API v1) using a permanent admin Integration Access Token.
- **Export path**: OM products → Magento (base data, images, categories, prices, special prices per store view/currency); automatic provisioning of Magento attribute sets and attributes from OM custom field definitions; configurable products from OM product+variants.
- **Fast price path**: dedicated `sync_magento_prices` child uses Magento bulk price APIs (`/products/base-prices`, `/products/special-prices`) — 100 SKU per call, event-driven with debounce. 10k price changes ≈ **5 seconds** vs ~30 min via full product PUT.
- **Fast stock path**: event-driven batch push via MSI bulk API (`/inventory/source-items`, 500 SKU/call) with 30s debounce window. Both fast paths operate only on products already in `SyncExternalIdMapping` — no existence checks needed.
- **Inventory path**: OM stock levels → Magento MSI/legacy stock, per admin-configured channel→stock-source mapping.
- **Import path**: Magento orders (with customer data, addresses, line items) → OM sales orders.
- Incremental sync via `updated_at` cursor (modified records only); full re-sync available on demand.

**Scope:**
- Bundle `sync_magento` with **four** child integrations: `sync_magento_products`, `sync_magento_prices`, `sync_magento_inventory`, `sync_magento_orders`
- `sync_magento_prices`: bulk-only price+special-price export, event-driven + scheduled; independent of full product sync
- OM variants → Magento configurable products (configurable attributes from OM option schema fields, regular attributes from OM custom fields)
- Per-channel stock level push via admin-configured OM channel → Magento stock source mapping
- Order import only (Magento → OM); no status push-back in scope
- Polling-only delta sync (no webhook triggers)

**Concerns:**
- Magento configurable attribute provisioning requires strict separation from regular product attributes (scope, `is_configurable` flag, `frontend_input: select`)
- `select`/`multiselect` `custom_attributes` values must be Magento option IDs (integers), not label strings — requires option ID cache from provisioning
- Special price per store view requires a `Store` HTTP header on each update call
- Image re-upload avoidance requires tracking Magento media entry IDs via `SyncExternalIdMapping`
- Products must be assigned to Magento website(s) to appear on storefront; child simples must have `visibility: 1`
- SKU sanitization required (Magento forbids `/`, `\` and other chars)
- Order line items for configurable products appear twice in Magento response — parent must be filtered out
- Inventory MSI vs legacy detection must probe at runtime (`GET /rest/V1/inventory/sources`)
- Order amounts: use `base_*` fields (store base currency), not `order_*` fields (customer currency)

---

## Overview

Magento 2.4 is a widely deployed eCommerce platform. Merchants using Open Mercato as their PIM/OMS backend need a reliable, automated path to push product catalog and inventory to Magento and receive orders back into OM for fulfillment.

**Pre-implementation analysis**: `.ai/specs/analysis/ANALYSIS-009-magento2-integration.md` — feasibility study covering entity mapping matrix (products/sales/customers/inventory), key challenge gaps (EAV, MSI, multi-store, deletion detection, rate limiting), and the phasing rationale this spec was built on.

**Market Reference: Akeneo Connector for Magento (AKENEO-MAGENTO)**
- Adopted: cursor-based export with `updated_at` filter, attribute set auto-provisioning from attribute group definitions, configurable-product child linking via SKU, image gallery sync with existing media detection.
- Adapted: OM uses its own DataSyncAdapter streaming contract instead of Akeneo's event-queue model.
- Rejected: Akeneo's bidirectional product sync back from Magento (out of scope for v1), Magento search indexer rebuild trigger (Magento handles this automatically).

---

## Problem Statement

Merchants managing products in OM need to publish them to a Magento storefront automatically without manual re-entry. Key gaps today:

1. No automated product export from OM to Magento — operators maintain two catalogs manually.
2. No stock level synchronization — Magento inventory diverges from OM warehouse state.
3. No order import — Magento orders must be copy-pasted into OM for fulfillment.
4. No attribute governance — Magento attribute sets drift from OM field definitions over time.

---

## Proposed Solution

An Integration Bundle (`sync_magento`) with four specialized child adapters, each implementing the `DataSyncAdapter` contract registered in the `data_sync` hub.

```
OM Catalog ──────export──────▶ sync_magento_products ──REST──▶ Magento Products
OM Prices ───────export──────▶ sync_magento_prices ────REST──▶ Magento Bulk Price API
OM Inventory ────export──────▶ sync_magento_inventory ─REST──▶ Magento MSI Sources
Magento Orders ──import──────▶ sync_magento_orders ────REST──▶ OM Sales Orders
```

Each child uses the existing `data_sync` run/cursor/progress infrastructure. Attribute set provisioning runs as a pre-flight step before the product export batch — it is idempotent and skipped if attributes are already present.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Permanent Integration Access Token (not session token) | Session tokens expire after 4 hours; integration tokens persist until revoked. Suitable for unattended scheduled sync. |
| Configurable attributes from OM option schema | OM variant axes (color, size) map directly to Magento's configurable attribute concept. Regular custom fields are standard attributes. Provisioning logic must be separate for each class. |
| Admin-configured channel→stock source mapping | Magento stock sources are named by the merchant; auto-detection by name is fragile. Explicit mapping via UI is safer and immediately transparent. |
| `SyncExternalIdMapping` for images | Tracking OM attachment ID → Magento media entry ID avoids re-uploading unchanged images on every incremental run. |
| `updated_at` cursor per entity type | Magento REST supports `filter_groups` on `updated_at`; polling is simpler, more reliable, and requires no Magento webhook configuration. |
| Order import only (no status push-back) | Bidirectional order sync requires Magento status-code mapping and introduces conflict resolution complexity. Deferred to a future phase. |
| Attribute prefix is optional (default `"om"`) | Merchants mapping to existing Magento attributes need empty prefix. Default `"om"` protects greenfield installs from collisions with native Magento attrs. |
| Async Bulk API for product data | `POST /rest/async/bulk/V1/products` batches 100–500 products per HTTP call vs 1 call/product; reduces product-data phase from ~30 min to ~2 min for 10k products. Images cannot use the bulk API and remain the bottleneck. |
| Image sync as a separable phase | Image uploads are slow (Base64, sequential per product). Decoupling image sync from product data sync lets merchants onboard fast and sync images in a lower-priority background pass. |

---

## User Stories / Use Cases

- **Admin** wants to push all OM products to Magento so the storefront stays in sync with the PIM.
- **Admin** wants only changed products synced on each run so sync runs are fast and non-disruptive.
- **Admin** wants stock levels from the "Web Store" OM channel pushed to the Magento "default" stock source automatically.
- **Admin** wants Magento orders imported into OM daily so the fulfillment team works in a single system.
- **Admin** wants Magento attribute sets created automatically when new OM product field sets are defined, avoiding manual Magento admin work.
- **Admin** wants product images synced without re-uploading unchanged images.

---

## Architecture

### Component Layout

> **Note:** All paths below are relative to the **`open-mercato/official-modules`** repository root (`https://github.com/open-mercato/official-modules`). Locally they are accessible via the `external/official-modules/` git submodule. No code from this integration lives inside the main `open-mercato` monorepo.

```
packages/sync-magento/
└── src/modules/sync_magento/
    ├── integration.ts                    # Bundle + 4 children
    ├── index.ts                          # Module metadata
    ├── acl.ts                            # Features
    ├── setup.ts                          # Tenant init + env preset
    ├── di.ts                             # Adapter + service registrations
    ├── events.ts                         # Typed events
    ├── data/
    │   ├── entities.ts                   # MagentoSyncSettings
    │   └── validators.ts                 # Zod schemas
    ├── lib/
    │   ├── client.ts                     # Magento REST client factory
    │   ├── health.ts                     # Health check via storeViews endpoint
    │   ├── attribute-service.ts          # Attribute + attribute set provisioning
    │   ├── category-service.ts           # Category tree sync
    │   ├── image-service.ts              # Image export + media entry tracking
    │   ├── price-service.ts              # Price + special price per store view
    │   ├── product-mapper.ts             # OM product → Magento REST payload
    │   ├── order-mapper.ts               # Magento order → OM order payload
    │   └── preset.ts                     # Env var preset reader
    ├── adapters/
    │   ├── products.ts                   # DataSyncAdapter: OM → Magento products (full)
    │   ├── prices.ts                     # DataSyncAdapter: OM → Magento prices (fast bulk)
    │   ├── inventory.ts                  # DataSyncAdapter: OM → Magento stock
    │   └── orders.ts                     # DataSyncAdapter: Magento → OM orders
    ├── workers/
    │   ├── inventory-push.ts             # Event-driven stock push (debounced batch)
    │   └── price-push.ts                 # Event-driven price push (debounced batch)
    ├── subscribers/
    │   ├── product-stock-changed.ts      # catalog.product.updated → enqueue stock batch
    │   └── product-price-changed.ts      # catalog.product.updated → enqueue price batch
    ├── backend/
    │   └── sync-magento/
    │       ├── settings/
    │       │   ├── page.tsx              # Settings: channel mappings, order config
    │       │   └── page.meta.ts
    ├── widgets/
    │   ├── injection-table.ts
    │   └── injection/settings-tab/
    │       ├── widget.ts
    │       └── widget.client.tsx         # Settings tab on integration detail page
    └── i18n/
        ├── en.json
        └── pl.json
```

### Repository & Activation

The Magento integration is an **official module** — it lives in the public [`open-mercato/official-modules`](https://github.com/open-mercato/official-modules) repository, not inside the main `open-mercato` monorepo.

#### Development workflow

```
# Register the submodule locally (one-time per dev environment)
yarn official-modules add @open-mercato/sync-magento

# Work on code inside the submodule's git tree
cd external/official-modules
git checkout -b feat/sync-magento
# ... make changes, commit ...
yarn changeset    # bump version inside official-modules
git push origin feat/sync-magento
# Open PR against open-mercato/official-modules (not open-mercato/open-mercato)
```

#### Activation in a host app

Add the module to `official-modules.json` in the host application:

```json
{
  "sync_magento": "activated"
}
```

The `postinstall` worker (`scripts/official-modules-setup.mjs`) regenerates `apps/mercato/src/official-modules.generated.ts`, which `modules.ts` spreads into `enabledModules`. **Do not** add `@open-mercato/sync-magento` to `apps/mercato/package.json` or `src/modules.ts` manually.

After activation run:
```bash
yarn mercato configs cache structural --all-tenants
# If Turbopack serves a stale chunk:
yarn dev:reset
```

#### Cross-cutting changes

This integration only **consumes** existing platform contracts (`DataSyncAdapter`, `externalIdMappingService`, `sales.order.create`); it does not modify any core module. Therefore **no coordinated two-repo PR is required** — all changes go in a single PR to `open-mercato/official-modules`.

If a future change requires a core API extension, follow the two-PR protocol from root `AGENTS.md`: core PR in `open-mercato` first → (prerelease) publish → `official-modules` bumps the peer dep.

---

### Integration Bundle Structure

```typescript
// integration.ts
export const bundle: IntegrationBundle = {
  id: 'sync_magento',
  title: 'Magento 2.4',
  description: 'Sync products, inventory, and orders with Magento 2.4',
  credentials: {
    fields: [
      { key: 'baseUrl', label: 'Magento Store URL', type: 'url', required: true },
      { key: 'accessToken', label: 'Integration Access Token', type: 'secret', required: true,
        helpDetails: {
          kind: 'webhook_setup',
          title: 'Magento Integration Token',
          summary: 'Generate a permanent Integration Access Token in Magento admin.',
          dashboardPathLabel: 'Magento Admin → System → Integrations → Add Integration',
          steps: [
            'Go to System > Integrations > Add Integration',
            'Name it "Open Mercato", set resource access to "All" or specific resources',
            'Save and activate — copy the Access Token',
          ],
        }
      },
    ],
  },
  healthCheck: { service: 'magentoHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [
  { id: 'sync_magento_products', title: 'Magento Products', category: 'data_sync',
    hub: 'data_sync', providerKey: 'magento_products', bundleId: 'sync_magento',
    description: 'Export products, images, categories, and attributes to Magento' },
  { id: 'sync_magento_prices', title: 'Magento Prices', category: 'data_sync',
    hub: 'data_sync', providerKey: 'magento_prices', bundleId: 'sync_magento',
    description: 'Bulk push base prices and special prices to Magento (fast path, independent of product sync)' },
  { id: 'sync_magento_inventory', title: 'Magento Inventory', category: 'data_sync',
    hub: 'data_sync', providerKey: 'magento_inventory', bundleId: 'sync_magento',
    description: 'Push stock levels per OM channel to Magento stock sources' },
  { id: 'sync_magento_orders', title: 'Magento Orders', category: 'data_sync',
    hub: 'data_sync', providerKey: 'magento_orders', bundleId: 'sync_magento',
    description: 'Import Magento orders with customer data and addresses' },
]
```

### Attribute Class Distinction — Critical

Magento has two fundamentally different classes of product attributes relevant to this integration:

**Class A: Regular Product Attributes** (from OM custom fields)
- Source: OM custom field definitions on the product entity (declared in `ce.ts`)
- Magento requirements: standard `attribute_code`, scoped to `store` or `global`, `frontend_input` from type mapping table
- Usage in Magento: appear on product edit form as simple metadata fields

**Class B: Configurable Attributes** (from OM option schema fields)
- Source: OM variant option schema fields (e.g. color, size — the axes that distinguish variants)
- Magento requirements: `scope: global`, `frontend_input: select`, `is_configurable: true` (set via attribute option management)
- Usage in Magento: used in `PUT /rest/V1/configurable-products/{sku}/options` to declare which attributes make a product configurable
- Child simple products must have a value for each configurable attribute

The attribute provisioning service (`attribute-service.ts`) handles both classes but uses separate provisioning paths.

#### OM Field Type → Magento Attribute Type Mapping

| OM Field Type | Magento `backend_type` | Magento `frontend_input` | Notes |
|---|---|---|---|
| `text` | `varchar` | `text` | — |
| `textarea` | `text` | `textarea` | — |
| `number` | `decimal` | `text` | — |
| `select` (single) | `int` | `select` | Options provisioned on first export |
| `multiselect` | `varchar` | `multiselect` | — |
| `boolean` | `int` | `boolean` | — |
| `date` | `datetime` | `date` | — |
| `url` | `varchar` | `text` | — |
| **option schema field** | `int` | `select` | Configurable attribute: `scope=global`, select options from OM option values |

#### `attribute_code` Sanitization Rules

Magento `attribute_code` must: be lowercase, contain only `[a-z0-9_]`, start with a letter, be ≤ 60 characters. OM field names may contain spaces, mixed case, or special characters.

Sanitization function (in `attribute-service.ts`):
1. Lowercase
2. Replace any non-`[a-z0-9]` character with `_`
3. Collapse consecutive `_` into one
4. Trim leading/trailing `_`
5. If first character is a digit: prepend `_`
6. Truncate to `60 - prefix.length - 1` chars (to fit `<prefix>_<name>`)

Example: `"Rok produkcji"` + prefix `"om"` → `"om_rok_produkcji"`

Two different OM field names that sanitize to the same code are a collision. The provisioning service detects collisions at provisioning time and logs an error; the operator must rename one field or change the prefix. The sync run is not aborted, but affected attributes are skipped.

#### Select / Option Schema Attribute: Value → Option ID Lookup

Magento `custom_attributes` entries for `select`/`multiselect`/configurable attributes require the **integer option ID**, not the label string. The attribute provisioning service builds and caches a per-run `Map<attributeCode, Map<labelNormalized, optionId>>` after provisioning each select-type attribute. `product-mapper.ts` and `order-mapper.ts` use this cache for every `custom_attributes` value that targets a select-type attribute. Missing option IDs (option not yet provisioned) are logged as item-level warnings; the attribute value is omitted rather than sending an invalid ID.

### Sync Flow: Product Export

```
DataSyncAdapter.streamExport('products', cursor, config)
│
├── Pre-flight: AttributeService.provisionAll(fieldSets, optionSchemas)
│   ├── For each OM custom field set → ensure Magento attribute set exists (create if missing)
│   ├── For each OM custom field → ensure regular Magento attribute exists (Class A)
│   └── For each OM option schema field → ensure configurable Magento attribute exists (Class B)
│
├── Fetch OM products where updated_at > cursor, in batches of 50 (OM DB page size — distinct from the Magento async-bulk batch size of 150 configured via `input.batchSize`)
│
└── For each product:
    ├── CategoryService.ensureCategoryTree(product.categoryIds)
    │   └── Create missing categories; store OM→Magento IDs via externalIdMappingService
    │
    ├── Sanitize SKU: replace forbidden chars, validate length ≤ 64
    │
    ├── Check type_id mismatch (Step 3.1a) → delete+recreate if needed
    │
    ├── If product has variants:
    │   ├── Create/update Magento configurable product
    │   │   └── visibility: 4 (Catalog + Search), status: is_active ? 1 : 2
    │   ├── For each variant:
    │   │   ├── Create/update Magento child simple product (SKU = variant.sku)
    │   │   │   └── visibility: 1 (Not Visible Individually), status: 1
    │   │   └── Link child to parent via PUT /configurable-products/{sku}/child
    │   └── Set configurable options via PUT /configurable-products/{sku}/options
    │
    ├── Else:
    │   └── Create/update Magento simple product
    │       └── visibility: 4 (Catalog + Search), status: is_active ? 1 : 2
    │
    ├── Assign product to website(s): PUT /rest/V1/products/{sku} with
    │   extension_attributes.website_ids from channelStoreMapping config
    │
    ├── PriceService.setPrices(product, storeMappings)
    │   ├── Set base price (product's default currency)
    │   └── For each channel→store mapping: set special price with Store header
    │
    └── ImageService.syncImages(product, magentoSku)
        ├── Fetch existing Magento media entries
        ├── For each OM attachment: externalIdMappingService.lookupExternalId → if null: upload + store
        ├── For changed attachments (updated_at > last sync): re-upload + update mapping
        └── Set image roles: first image = image/small_image/thumbnail
```

### Sync Flow: Fast Price Push (event-driven)

Key constraint: this path runs **only for products already in `SyncExternalIdMapping`** — no Magento existence check needed, no attribute pre-flight, no image handling.

```
Event: catalog.product.updated
    └── Subscriber product-price-changed.ts:
        ├── externalIdMappingService.lookupExternalId('sync_magento','catalog.product',productId,scope)
        │   → null = not yet exported → skip silently
        └── Write row to sync_magento_pending_push (entity_type:'price', product_id)
            + enqueue 'magento-price-push' with delayMs:30_000

Worker: price-push.ts (queue: 'magento-price-push', concurrency: 5)
├── Read + delete pending rows: SELECT … WHERE entity_type='price' AND tenant_id=… FOR UPDATE SKIP LOCKED
├── Fetch current OM prices for all product_ids at execution time
├── Resolve sanitized SKUs via externalIdMappingService.lookupExternalId per product
├── Split into Magento bulk batches of 100 SKUs
│
├── Base prices:
│   POST /rest/V1/products/base-prices
│   body: { prices: [{ sku, price, store_id: 0 }] }   ← store_id=0 = all store views
│
├── Special prices per store view:
│   For each channelStoreMapping with a configured special price:
│   POST /rest/V1/products/special-prices
│   body: { prices: [{ sku, price, store_id, price_from?, price_to? }] }
│
│   To remove a special price (OM price no longer has special):
│   POST /rest/V1/products/special-prices-delete
│   body: { prices: [{ sku, store_id }] }
│
└── Log summary via integrationLogService: { updated, skipped, failed }
```

**Throughput**: 10 000 products changed → `ceil(10000/100)` = 100 calls for base prices + 100/store-view for special prices. At ~50ms/call: **~5–10 seconds total** for all prices.

### Sync Flow: Fast Stock Push (event-driven)

```
Event: catalog.product.updated
    └── Subscriber product-stock-changed.ts:
        ├── externalIdMappingService.lookupExternalId('sync_magento','catalog.product',productId,scope)
        │   → null = not yet exported → skip silently
        └── Write row to sync_magento_pending_push (entity_type:'inventory', product_id, channel_id)
            + enqueue 'magento-inventory-push' with delayMs:30_000

Worker: inventory-push.ts (queue: 'magento-inventory-push', concurrency: 5)
├── Read + delete pending rows: SELECT … WHERE entity_type='inventory' AND tenant_id=… FOR UPDATE SKIP LOCKED
├── Detect MSI: read msi_mode_detected from MagentoSyncSettings (cached in DB; probe only if null)
├── Fetch CURRENT OM stock quantities for all product_ids at execution time
├── Resolve sanitized SKUs via externalIdMappingService.lookupExternalId per product
│
├── MSI mode:
│   PUT /rest/V1/inventory/source-items
│   body: { sourceItems: [{ sku, source_code, quantity, status }] }  ← batch ≤500
│
└── Legacy mode:
    One PUT /rest/V1/stockItems/{sku} per SKU (sequential, 10ms delay between calls)
```

**Throughput MSI**: 5 000 stock changes → `ceil(5000/500)` = 10 calls. At ~100ms/call: **~1 second**.

### Sync Flow: Order Import

```
DataSyncAdapter.streamImport('orders', cursor, config)
├── GET /rest/V1/orders?filter[updated_at][gt]=cursor&pageSize=100
└── For each Magento order:
    ├── Dedup: externalIdMappingService.lookupLocalId('sync_magento','sales.order',increment_id,scope) → if found → action:'skip'
    │
    ├── Filter order items: discard items where product_type='configurable'
    │   (configurable parent appears alongside child simple; keep only child)
    │
    ├── Resolve or create OM customer by email (per customerStrategy)
    │   └── Guest orders (customer_id=0/null): always go through create_or_link flow
    │
    ├── Map billing/shipping address to OM format
    │   └── firstname + lastname → name (concatenate with space)
    │
    ├── Map order lines: SKU lookup →
    │   1. externalIdMappingService.lookupLocalId('sync_magento','catalog.product',sanitizedSku,scope)
    │   2. Fallback: em.findOne(CatalogProduct,{sku:item.sku,organizationId,tenantId})
    │   3. If still not found: store as unresolved line with raw SKU + name from Magento
    │
    ├── Use base_grand_total / base_subtotal / base_tax_amount / base_shipping_amount
    │   (store's base currency) as OM order amounts; attach order_currency_code as metadata
    │
    ├── Create OM sales order via sales.order.create command (no quote required — confirmed)
    └── externalIdMappingService.storeExternalIdMapping('sync_magento','sales.order',omOrderId,increment_id,scope)
```

### Special Price Per Store View

Magento stores special prices at store-view scope. Each update call must include the `Store` header:

```typescript
// client.ts — store-scoped update
async setStoreViewPrice(sku: string, storeViewCode: string, specialPrice: number | null, fromDate?: string, toDate?: string): Promise<void> {
  await this.httpClient.put(
    `/rest/V1/products/${sku}`,
    { product: { custom_attributes: [{ attribute_code: 'special_price', value: specialPrice }] } },
    { headers: { Store: storeViewCode } }
  )
}
```

The client factory accepts an optional `storeViewCode` parameter that sets the `Store` header for all calls on that client instance.

---

## Data Models

### `MagentoSyncSettings`

```typescript
@Entity({ tableName: 'sync_magento_settings' })
@Unique({ properties: ['tenant_id', 'organization_id'] })
class MagentoSyncSettings {
  @PrimaryKey({ type: 'uuid' })
  id: string

  @Property({ columnType: 'uuid' })
  tenant_id: string

  @Property({ columnType: 'uuid' })
  organization_id: string

  // [{channelId: string, stockSource: string}]
  @Property({ type: 'json', nullable: true })
  channel_stock_mappings: ChannelStockMapping[] | null

  // [{channelId: string, storeViewCode: string, currencyCode: string}]
  @Property({ type: 'json', nullable: true })
  channel_store_mappings: ChannelStoreMapping[] | null

  // Magento order statuses to import; null = all
  @Property({ type: 'json', nullable: true })
  order_import_statuses: string[] | null

  @Property({ columnType: 'uuid', nullable: true })
  default_order_channel_id: string | null

  @Property({ default: 'create_or_link' })
  customer_strategy: 'create_or_link' | 'create_only' | 'skip'

  // Prefix for auto-created Magento attributes. Default: 'om'. Set to '' to disable prefix.
  // WARNING: empty prefix risks collision with native Magento attributes (color, size, weight, etc.)
  @Property({ default: 'om' })
  attribute_set_prefix: string

  // Optional per-field attribute code override: [{omFieldName: string, magentoAttributeCode: string}]
  // When set, bypasses auto-provisioning for that field and uses the existing Magento attribute directly.
  @Property({ type: 'json', nullable: true })
  attribute_code_overrides: AttributeCodeOverride[] | null

  // Image sync options
  // When false: images are skipped in product sync entirely (use for onboarding or catalogs managed directly in Magento)
  @Property({ default: true })
  image_sync_enabled: boolean

  // Max concurrent product batches for async bulk product export (1–10, default 3)
  @Property({ default: 3 })
  product_export_concurrency: number

  // Max image upload concurrency across products (1–10, default 5)
  @Property({ default: 5 })
  image_upload_concurrency: number

  // Max image dimension (px) before resize; 0 = no resize. Default: 2000
  @Property({ default: 2000 })
  image_max_dimension: number

  // Cache result of MSI probe across processes (null = not yet probed)
  @Property({ nullable: true })
  msi_mode_detected: boolean | null

  @Property({ onCreate: () => new Date() })
  created_at: Date

  @Property({ onUpdate: () => new Date() })
  updated_at: Date

  @Property({ nullable: true })
  deleted_at: Date | null
}
```

### Zod Validators (`data/validators.ts`)

```typescript
export const channelStockMappingSchema = z.object({
  channelId: z.string().uuid(),
  stockSource: z.string().min(1).max(255),
})

export const channelStoreMappingSchema = z.object({
  channelId: z.string().uuid(),
  storeViewCode: z.string().min(1).max(255),
  currencyCode: z.string().length(3),
})

export const attributeCodeOverrideSchema = z.object({
  omFieldName: z.string().min(1),
  magentoAttributeCode: z.string().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
})

export const syncSettingsSchema = z.object({
  channelStockMappings: z.array(channelStockMappingSchema).nullable().optional(),
  channelStoreMappings: z.array(channelStoreMappingSchema).nullable().optional(),
  orderImportStatuses: z.array(z.string()).nullable().optional(),
  defaultOrderChannelId: z.string().uuid().nullable().optional(),
  customerStrategy: z.enum(['create_or_link', 'create_only', 'skip']).optional(),
  // Empty string allowed = no prefix (risk of native attr collision, documented)
  attributeSetPrefix: z.string().max(32).optional(),
  attributeCodeOverrides: z.array(attributeCodeOverrideSchema).nullable().optional(),
  imageSyncEnabled: z.boolean().optional(),
  productExportConcurrency: z.number().int().min(1).max(10).optional(),
  imageUploadConcurrency: z.number().int().min(1).max(10).optional(),
  imageMaxDimension: z.number().int().min(0).max(10000).optional(),
})
```

### `MagentoPendingPush` (new entity for debounce accumulator)

```typescript
// Ephemeral accumulator: rows are consumed and deleted atomically by the worker.
// No updated_at/deleted_at columns are needed — this is intentional, not an oversight.
@Entity({ tableName: 'sync_magento_pending_push' })
@Index({ properties: ['tenant_id', 'organization_id', 'entity_type', 'product_id'], options: { unique: true } })
class MagentoPendingPush {
  @PrimaryKey({ type: 'uuid' })
  id: string

  @Property({ columnType: 'uuid' })
  tenant_id: string

  @Property({ columnType: 'uuid' })
  organization_id: string

  @Property({ type: 'text' })
  entity_type: 'price' | 'inventory'

  @Property({ columnType: 'uuid' })
  product_id: string

  @Property({ columnType: 'uuid', nullable: true })
  channel_id: string | null

  @Property({ onCreate: () => new Date() })
  queued_at: Date
}
```

Unique constraint on `(tenant_id, organization_id, entity_type, product_id)` ensures each product appears at most once in the pending queue per type. New subscriber writes use `INSERT ... ON CONFLICT DO NOTHING` semantics — idempotent.

---

### `SyncExternalIdMapping` (re-used from `integrations` module)

The existing `SyncExternalIdMapping` entity from `packages/core/src/modules/integrations/data/entities.ts` is used for all cross-system ID tracking. **Actual field names** (verified from entity source): `integrationId`, `internalEntityType`, `internalEntityId`, `externalId`. Every lookup and create call must scope by `integrationId: 'sync_magento'`.

| `integrationId` | `internalEntityType` | `internalEntityId` | `externalId` | Notes |
|---|---|---|---|---|
| `sync_magento` | `catalog.product` | OM product UUID | Magento sanitized SKU | Used as the lookup key for all SKU-keyed bulk calls (prices, inventory, order line resolution) |
| `sync_magento` | `catalog.category` | OM category UUID | Magento category ID | — |
| `sync_magento` | `catalog.attachment` | OM attachment UUID | Magento media entry ID | Image re-upload avoidance |
| `sync_magento` | `sales.order` | OM order UUID | Magento `increment_id` | Order deduplication |
| `sync_magento` | `customers.person` | OM customer UUID | Magento customer ID | Customer linking |

Use `externalIdMappingService` (resolved from DI as `container.resolve('externalIdMappingService')` — registered in `data_sync/di.ts`) for all lookups and creates. **Actual API** (verified from `data_sync/lib/id-mapping.ts`):

```typescript
// Lookup Magento ID by OM local ID
lookupExternalId(integrationId, internalEntityType, localId, { organizationId, tenantId }): Promise<string | null>

// Lookup OM local ID by Magento external ID
lookupLocalId(integrationId, internalEntityType, externalId, { organizationId, tenantId }): Promise<string | null>

// Store or update a mapping
storeExternalIdMapping(integrationId, internalEntityType, localId, externalId, { organizationId, tenantId }): Promise<SyncExternalIdMapping>
```

The service now also exposes delete methods (implemented in `packages/core/src/modules/data_sync/lib/id-mapping.ts`, merged prior to Phase 2):

```typescript
// Soft-delete a single mapping by local ID; returns true if found and deleted
deleteExternalIdMapping(integrationId, internalEntityType, localId, scope): Promise<boolean>

// Batch soft-delete; returns count of deleted rows; short-circuits on empty localIds
deleteExternalIdMappings(integrationId, internalEntityType, localIds, scope): Promise<number>
```

All three deletion sites in this spec (Step 3.1a `type_id` mismatch handler, Phase 7 delete worker, Phase 7 attachment cleanup) route through these service methods — using raw `em.nativeDelete(SyncExternalIdMapping, ...)` directly from `sync_magento` would violate module isolation (Root AGENTS: "NO direct ORM relationships between modules").

---

## API Contracts

### `GET /api/data_sync/runs` (existing, unchanged)

Used by admin UI to monitor sync runs.

### `POST /api/data_sync/run` (existing, extended)

Existing endpoint — actual required schema (verified from `data_sync/data/validators.ts`):

```json
{
  "integrationId": "sync_magento_products",
  "entityType": "products",
  "direction": "export",
  "fullSync": false,
  "batchSize": 150
}
```

**Adapter entityType / direction registry:**

| Integration ID | `entityType` | `direction` |
|---|---|---|
| `sync_magento_products` | `"products"` | `"export"` |
| `sync_magento_prices` | `"prices"` | `"export"` |
| `sync_magento_inventory` | `"inventory"` | `"export"` |
| `sync_magento_orders` | `"orders"` | `"import"` |

When `fullSync: true`, the engine passes `cursor: null` to the adapter — adapter skips `updated_at` filter and fetches all records. `batchSize` defaults to `100` when omitted.

### `GET /api/sync-magento/settings`

Returns current sync settings for the tenant.

**Response (200):**
```json
{
  "channelStockMappings": [{ "channelId": "uuid", "stockSource": "default" }],
  "channelStoreMappings": [{ "channelId": "uuid", "storeViewCode": "en_US", "currencyCode": "USD" }],
  "orderImportStatuses": ["pending", "processing"],
  "defaultOrderChannelId": "uuid",
  "customerStrategy": "create_or_link",
  "attributeSetPrefix": "om"
}
```

**ACL:** `sync_magento.configure`
**OpenAPI:** Exported.

### `PUT /api/sync-magento/settings`

Save sync settings.

**Request:**
```json
{
  "channelStockMappings": [{ "channelId": "uuid", "stockSource": "default" }],
  "channelStoreMappings": [{ "channelId": "uuid", "storeViewCode": "en_US", "currencyCode": "USD" }],
  "orderImportStatuses": ["pending"],
  "defaultOrderChannelId": "uuid",
  "customerStrategy": "create_or_link",
  "attributeSetPrefix": "om"
}
```

**Response (200):** Updated settings.
**Mutation guard:** This custom write route (not using `makeCrudRoute`) MUST call `validateCrudMutationGuard` before the mutation and `runCrudMutationGuardAfterSuccess` after success.
**ACL:** `sync_magento.configure`
**OpenAPI:** Exported.

### `POST /api/sync-magento/validate`

Test Magento connection (calls `GET /rest/V1/store/storeViews` with configured credentials).

**Response (200):**
```json
{
  "valid": true,
  "storeViews": [{ "code": "default", "name": "Default Store View" }],
  "stockSources": [{ "source_code": "default", "name": "Default Source" }]
}
```

> **UX note**: The settings UI MAY render the `stockSource` field as a dropdown populated from `stockSources` instead of free-text input. This is an implementation-time decision; both are valid as long as Zod validation runs on save.

**ACL:** `sync_magento.configure`
**OpenAPI:** Exported.

---

## Events

### Declared in `events.ts`

| Event ID | Category | `clientBroadcast` | Payload |
|---|---|---|---|
| `sync_magento.product.exported` | crud | `true` | `{ productId, magentoSku, action: 'created'\|'updated', runId }` |
| `sync_magento.order.imported` | crud | `true` | `{ magentoIncrementId, omOrderId, runId }` |
| `sync_magento.inventory.pushed` | lifecycle | `true` | `{ channelId, stockSource, itemCount, runId }` |
| `sync_magento.attribute_set.provisioned` | lifecycle | `false` | `{ name, magentoId, action: 'created'\|'existing' }` |
| `sync_magento.sync.started` | lifecycle | `true` | `{ runId, entityType, direction, mode: 'incremental'\|'full' }` |
| `sync_magento.sync.completed` | lifecycle | `true` | `{ runId, stats: { created, updated, skipped, failed } }` |
| `sync_magento.sync.failed` | lifecycle | `true` | `{ runId, error }` |
| `sync_magento.product.deleted` | lifecycle | `true` | `{ productId, magentoSku }` |
| `sync_magento.product.deleted_externally` | lifecycle | `true` | `{ magentoSku, productId }` |

---

## Internationalization (i18n)

Keys required in `i18n/en.json`:

- `sync_magento.title`, `sync_magento.description`
- `sync_magento.settings.*` — settings form labels
- `sync_magento.settings.channelStockMappings.*`, `sync_magento.settings.channelStoreMappings.*`
- `sync_magento.settings.customerStrategy.*` — strategy option labels
- `sync_magento.errors.*` — connection errors, missing config
- `sync_magento.notifications.*` — sync complete/failed notification text

---

## UI/UX

### Settings Tab (injected on integration bundle detail page)

```
┌─────────────────────────────────────────────────────────┐
│  Magento 2.4                                  [Back]    │
│                                                         │
│  ┌──────────────┬─────────────┬──────────┬──────────┐   │
│  │ Credentials  │  Settings   │  Health  │  Logs    │   │
│  └──────────────┴─────────────┴──────────┴──────────┘   │
│                                                         │
│  [Settings tab active]                                  │
│                                                         │
│  ── Inventory: Channel → Stock Source Mapping ─────────│
│  ┌────────────────────────────────────────────────┐     │
│  │ OM Channel         │ Magento Stock Source       │     │
│  ├────────────────────┼────────────────────────────│     │
│  │ [▼ Web Store     ] │ [default              ]    │     │
│  │ [▼ Mobile Store  ] │ [warehouse_east        ]   │     │
│  │                    │                  [+ Add]   │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ── Pricing: Channel → Store View Mapping ─────────────│
│  ┌──────────────────────────────────────────────────┐   │
│  │ OM Channel       │ Store View     │ Currency      │  │
│  ├──────────────────┼────────────────┼───────────────│  │
│  │ [▼ Web Store   ] │ [en_US       ] │ [USD]         │  │
│  │ [▼ EU Store    ] │ [de_DE       ] │ [EUR]         │  │
│  │                  │                │  [+ Add]       │  │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ── Orders ─────────────────────────────────────────── │
│  Import statuses: ☑ pending  ☑ processing  ☐ complete  │
│  Default channel: [▼ Web Store                       ] │
│  Customer strategy: [▼ Create or link by email       ] │
│                                                         │
│  ── Advanced ───────────────────────────────────────── │
│  Attribute prefix: [om__________] (empty = no prefix)  │
│  Attribute overrides: [+ Add field→attribute mapping]  │
│                                                         │
│  ── Performance ────────────────────────────────────── │
│  ☑ Sync product images                                 │
│  Image resize: max [2000] px  (0 = disabled)          │
│  Product export concurrency: [3] (1–10)               │
│  Image upload concurrency:   [5] (1–10)               │
│                                                         │
│                                    [Cancel] [⌘+Enter Save] │
└─────────────────────────────────────────────────────────┘
```

- Settings form uses `<CrudForm>` via `createCrud` / `updateCrud`
- Channel dropdowns populated from `GET /api/sales/channels`
- Store view list populated from `POST /api/sync-magento/validate` (live fetch from Magento)
- All dialogs support `Cmd/Ctrl+Enter` submit and `Escape` cancel

---

## Configuration

### Environment Variables (Provider-Owned Preset)

| Variable | Required | Description |
|---|---|---|
| `OM_INTEGRATION_MAGENTO_BASE_URL` | No | Magento store URL (e.g. `https://mystore.com`) |
| `OM_INTEGRATION_MAGENTO_ACCESS_TOKEN` | No | Permanent integration access token |
| `OM_INTEGRATION_MAGENTO_DEFAULT_CHANNEL_ID` | No | Default OM channel ID for order import |
| `OM_INTEGRATION_MAGENTO_STOCK_SOURCE` | No | Default stock source code (e.g. `default`) |

When present, `setup.ts` / `onTenantCreated` applies these via the credentials service and creates initial settings. A rerunnable CLI command `configure-from-env` is provided.

---

## Performance Considerations

### Throughput Estimates

| Scenario | Volume | Estimated duration |
|---|---|---|
| Full product sync — data only (async bulk) | 10 000 products | ~2–4 min |
| Full product sync — data + images (concurrent + resize) | 10 000 × 3 images | ~60–90 min |
| Full product sync — no optimizations (baseline) | 10 000 × 3 images | ~4–6 h |
| Incremental product sync — changed products | 200 changed | ~3–8 min |
| **Fast price push — bulk API** | **10 000 SKUs** | **~5–10 s** |
| **Fast stock push — MSI bulk** | **5 000 SKUs** | **~1–2 s** |
| Fast stock push — legacy (no MSI) | 5 000 SKUs | ~50 s |
| Order import | 5 000 orders | ~5–10 min |

### Strategy 1: Async Bulk API for Product Data

> **Why not synchronous batching?** Magento 2.4.3+ introduced a global array input limit of 20 items per synchronous REST request. Any synchronous endpoint that accepts an array payload is bounded to 20 items/call by the framework. The async bulk endpoint (`/rest/async/bulk/V1/products`) is not subject to this constraint. Dedicated bulk-by-design endpoints (`/products/base-prices`, `/products/special-prices`, `/inventory/source-items`) accept larger arrays — their limits are governed by Magento's `webapi.xml` configuration, not the global 20-item framework limit — which is why 100-SKU batches for prices and 500-item batches for MSI are safe.

Magento 2.4 exposes `POST /rest/async/bulk/V1/products` that accepts an array of product payloads in a single HTTP request and processes them asynchronously server-side. This replaces the 1-call-per-product pattern for product data (but NOT for images, which have no bulk API equivalent).

**Flow:**
1. Build batches of 100–200 product payloads (after attribute pre-flight)
2. `POST /rest/async/bulk/V1/products` → returns `{ bulk_uuid, request_items[{ id, status }] }`
3. Poll `GET /rest/V1/bulk/{bulk_uuid}/status` every 5 seconds until all items are `complete` or `failed`
4. Log failed items per `request_items[].status === 'failed'`; re-process on next run
5. Proceed to image sync for products whose bulk status is `complete`

**Configurable batch size**: `product_export_concurrency` controls how many bulk batches are in-flight simultaneously (default 3). Each batch is 100–200 products. Total API call count: `ceil(10000 / 150) = 67` calls instead of 10 000.

**Limitation**: Async bulk API is not available for configurable product child-linking (`PUT /configurable-products/{sku}/child`) or configurable options (`PUT /configurable-products/{sku}/options`) — these remain synchronous per-product calls. For catalogs with many configurable products, this phase remains the bottleneck.

### Strategy 2: Parallel Image Upload

Images cannot use the bulk API. Mitigation via controlled parallelism:

- **Inter-product concurrency**: `image_upload_concurrency` products processed in parallel (default 5, max 10). Use `p-limit` or equivalent.
- **Intra-product**: images within a single product uploaded sequentially (Magento uses upload order for gallery position assignment).
- **Skip unchanged**: `SyncExternalIdMapping` for `catalog.attachment` ensures already-uploaded images are never re-sent.

**Effect**: 10 000 products / 5 concurrency = 2 000 rounds × (3 images × 500ms per product) = **~50 min** (vs 4h sequential). Consistent with the performance table estimate of ~60–90 min total (data + images).

### Strategy 3: Decoupled Image Sync Phase

When `image_sync_enabled: false` (default `true`), the `sync_magento_products` adapter skips image upload entirely. A dedicated `sync_magento_images` child integration (future phase, not in current scope) handles image sync as a separate, lower-priority run.

**Use cases:**
- Initial onboarding: push product data first (fast), schedule image sync overnight
- Catalogs where images rarely change: run image sync weekly; product data sync daily
- Merchants who manage images directly in Magento: disable image sync entirely

Setting `image_sync_enabled: false` in settings UI disables image upload for the current run only if passed as a run-time flag, or persistently if saved in `MagentoSyncSettings`.

### Strategy 4: Image Resize Before Upload

Large source images (e.g. 20 MB RAW at 5000×5000px) dramatically slow Base64 encoding and REST upload. `image_max_dimension: 2000` (default) resizes the longest dimension to ≤ 2000px using `sharp` before Base64 encoding. Set to `0` to disable.

**Effect**: 20 MB → ~2 MB after resize. Upload time: ~2 000ms → ~200ms per image.

**Implementation**: `lib/image-service.ts` uses `sharp` (add as dependency) for in-memory resize before Base64. Format stays original (JPEG stays JPEG, PNG stays PNG). Only images exceeding `image_max_dimension` are resized.

### Attribute Prefix: Optional

`attribute_set_prefix` (default `"om"`) is now fully optional. When set to `""` (empty string):
- Auto-created attributes use the bare sanitized field name (e.g. `color` instead of `om_color`)
- **Risk**: collision with Magento native attributes. Common native attributes: `color`, `size`, `weight`, `manufacturer`, `description`, `short_description`, `name`, `price`, `sku`, `status`, `visibility`. If a collision is detected (existing attribute has incompatible type), the provisioning service logs an error and falls back to a suffixed name `<fieldName>_om`.

**Per-field override** (`attribute_code_overrides`): explicit mapping from OM field name to existing Magento attribute code. When an override is defined for a field, the provisioning service skips auto-creation for that field and uses the existing Magento attribute directly. This is the correct approach for merchants who want to map OM fields to pre-existing Magento attributes without renaming.

```json
// Example: map OM field "material" to existing Magento attribute "fabric"
{ "attributeCodeOverrides": [{ "omFieldName": "material", "magentoAttributeCode": "fabric" }] }
```

---

## Migration & Compatibility

### Database Migrations

- New table: `sync_magento_settings` (one row per tenant/org)
- No changes to core module schemas
- Migration generated via `yarn db:generate` in the provider package; snapshot updated in `packages/sync-magento/migrations/`

### Backward Compatibility

All changes are additive:
- New integration bundle and children registered via `integration.ts` auto-discovery
- New DI services (`magentoHealthCheck`, `magentoSyncSettingsService`) are provider-local
- New events in `sync_magento.*` namespace — no existing events changed
- New API routes under `/api/sync-magento/` — no existing routes modified
- `data_sync` module: adapter registered additively via `registerDataSyncAdapter()`

---

## Implementation Plan

### Phase 1: Package Scaffold, Credentials & Health Check

**Goal:** Package exists, authenticates, health check passes, bundle visible in integration marketplace.

#### Step 1.1: Package Structure
- Create `packages/sync-magento/` workspace with `package.json`, `tsconfig.json`, `src/index.ts`
- Add `"sharp": "^0.33.0"` as `optionalDependency`; add `"p-limit": "^6.0.0"` as regular dependency
- Create module scaffolding: `index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `events.ts`, `integration.ts`
- Define bundle + 4 child integrations in `integration.ts`
- `acl.ts` must declare both features:
  ```typescript
  export const features = [
    { id: 'sync_magento.view', title: 'View Magento sync status', module: 'sync_magento' },
    { id: 'sync_magento.configure', title: 'Configure Magento sync settings', module: 'sync_magento' },
  ]
  ```
- `setup.ts` `defaultRoleFeatures`:
  ```typescript
  defaultRoleFeatures: {
    superadmin: ['sync_magento.view', 'sync_magento.configure'],
    admin: ['sync_magento.view', 'sync_magento.configure'],
    employee: ['sync_magento.view'],
  }
  ```
- Initialize the official-modules submodule: `yarn official-modules add @open-mercato/sync-magento`
- Set `"sync_magento": "activated"` in `official-modules.json` in the host app
- Run `yarn install && yarn generate` then `yarn mercato configs cache structural --all-tenants`

**Testable:** Package builds. Bundle and all four children appear in `/backend/integrations`.

#### Step 1.2: Magento REST Client
- `lib/client.ts` — factory accepting `{ baseUrl, accessToken, storeViewCode? }`
- HTTP client wrapper (native fetch with typed helper) — no raw `fetch` in page components
- `storeViewCode` sets `Store` header on all calls when provided
- `lib/health.ts` — calls `GET /rest/V1/store/storeViews`, returns `{ healthy: boolean, storeViews: StoreView[] }`
- Register `magentoHealthCheck` in DI

**Testable:** Health check returns store view list with valid credentials.

#### Step 1.3: `MagentoSyncSettings` Entity + API Routes
- Define entity in `data/entities.ts`, validators in `data/validators.ts`
- API routes: `GET/PUT /api/sync-magento/settings`, `POST /api/sync-magento/validate`
- All routes export `openApi`, declare `requireFeatures: ['sync_magento.configure']`
- Run `yarn db:generate`, review migration SQL

**Testable:** Settings save/load round-trip. Validate endpoint returns store views.

#### Step 1.4: Settings UI Widget
- Inject "Settings" tab on bundle detail page via `widgets/injection/settings-tab/`
- `<CrudForm>` with channel→stock mapping table, channel→store mapping table, order config, attribute prefix
- Channel dropdowns from `GET /api/sales/channels`; store view list from validate endpoint
- i18n keys added to `i18n/en.json`

**Testable:** Settings tab renders, saves, and reloads values.

#### Step 1.5: Env Preset & CLI Command
- `lib/preset.ts` reads `OM_INTEGRATION_MAGENTO_*` env vars
- `setup.ts` `onTenantCreated` applies preset when env vars present
- CLI command `configure-from-env` re-applies preset outside of tenant creation

**Testable:** With env vars set, fresh tenant gets pre-populated credentials and settings.

---

### Phase 2: Attribute & Category Provisioning

**Goal:** Magento attribute sets and attributes created from OM definitions before any product export.

#### Step 2.1: Regular Attribute Provisioning (Class A)
- `lib/attribute-service.ts` — `provisionProductAttributes(fieldSet, prefix)`:
  - Sanitize `attribute_code`: lowercase, `[a-z0-9_]` only, starts with letter, ≤ 60 chars (sanitization utility function, tested independently)
  - **Per-field override**: if `attribute_code_overrides` contains an entry for the field → skip auto-provisioning; use the specified existing Magento attribute code directly (no prefix, no creation). Validate that the existing attribute has a compatible type; log warning if incompatible.
  - Prefix is optional: if `attribute_set_prefix` is `""` → bare sanitized field name used. Collision with native Magento attrs detected at provisioning time; if colliding type is incompatible → append `_om` suffix as last-resort fallback and log warning.
  - Detect sanitization collisions (two OM fields → same code after sanitization): log error and skip the later field; do NOT abort the run
  - `GET /rest/V1/products/attributes?searchCriteria[filterGroups][0][filters][0][field]=attribute_code&...` — check if attribute exists
  - If missing: `POST /rest/V1/products/attributes` with type-mapped `backend_type` / `frontend_input`
  - If exists with incompatible type: log warning, skip creation (never overwrite existing attributes)
  - For `select`/`multiselect` attributes: also provision option values via `POST /rest/V1/products/attributes/{code}/options`; build `Map<attributeCode, Map<labelNormalized, optionId>>` cache after provisioning
  - Cache all attribute metadata (code → id + option map) in-memory per sync run
- Attribute set creation: `POST /rest/V1/eav/attribute-sets` with `attribute_set_name: <prefix>_<fieldSetName>`
- **Fallback for products without a field set**: retrieve Magento's "Default" attribute set ID via `GET /rest/V1/eav/attribute-sets/list` (name = "Default") and cache; use as `attribute_set_id` for products with no OM field set assigned
- Assign attributes to attribute set: `POST /rest/V1/products/attribute-sets/attributes`

**Testable:** Attribute set + regular attributes created in Magento with correct types. Sanitization collisions logged and skipped. Option ID cache populated for select-type attributes.

#### Step 2.2: Configurable Attribute Provisioning (Class B)
- Separate path in `attribute-service.ts` — `provisionConfigurableAttributes(optionSchema, prefix)`:
  - Same `attribute_code` sanitization + existence check as Step 2.1
  - Magento attribute created with: `scope: 'global'`, `frontend_input: 'select'`, `is_configurable: true`
  - Option values (OM option entries) provisioned via `POST /rest/V1/products/attributes/{code}/options`
  - Only diff-provision: new option values added, existing ones not removed (safe additive approach)
  - Add to the shared `Map<attributeCode, Map<labelNormalized, optionId>>` cache (same as Class A select cache)

**Testable:** Color/size-style attributes created with correct Magento type. New option values appended. Option ID cache populated for all configurable attributes.

#### Step 2.3: Category Service
- `lib/category-service.ts` — `ensureCategoryPath(omCategoryIds, credentials)`:
  - **Root category detection**: `GET /rest/V1/store/storeGroups` → take `root_category_id` for the configured default store group; if no store view mapping configured, use Magento's default root (ID 2). Cache root ID per sync run.
  - Fetch Magento category tree (`GET /rest/V1/categories`), build lookup by `name` under the correct root
  - For each OM category: check `externalIdMappingService` for `{ integrationId: 'sync_magento', internalEntityType: 'catalog.category', internalEntityId: categoryId }` — if not found, create in Magento and store mapping
  - Respect parent-child hierarchy (create parent before child)
  - Cache tree per sync run

**Testable:** OM category hierarchy mirrored in Magento under correct root. Subsequent runs skip existing categories.

---

### Phase 3: Product Export (Simple + Configurable)

**Goal:** OM products (with variants) exported to Magento as simple or configurable products.

#### Step 3.1: `DataSyncAdapter` for `sync_magento_products`
- `adapters/products.ts` implements `DataSyncAdapter`:
  - `providerKey: 'magento_products'`
  - `direction: 'export'`
  - `supportedEntities: ['products']`
  - **`getMapping()` (required)**: returns minimal `DataMapping` — sync engine calls this before every run:
    ```typescript
    async getMapping(input) {
      return { entityType: input.entityType, fields: [], matchStrategy: 'externalId' }
    }
    ```
  - **`getInitialCursor()`**: returns `null` (start from beginning on first run)
  - `streamExport(input: StreamExportInput)`: yields `ExportBatch` objects — each batch wraps product results in the required contract shape:
    ```typescript
    yield {
      results: products.map(p => ({
        localId: p.id,
        externalId: sanitizedSku(p.sku),
        status: 'success' | 'error' | 'skipped',
        error?: string,
      })),
      cursor: lastProductUpdatedAt,
      hasMore: fetchedCount === batchSize,
      batchIndex,
    }
    ```
  - Pre-flight: call `attributeService.provisionAll()` once per run
  - **Async Bulk API** (`POST /rest/async/bulk/V1/products`) for product data; batch size from `input.batchSize` (default 150)
  - **Non-blocking bulk polling**: after submitting a bulk batch, do NOT poll in a loop inside the worker. Instead enqueue a deferred poll job:
    ```
    POST /rest/async/bulk/V1/products → { bulk_uuid }
        └── enqueue 'magento-bulk-poll' job: { bulk_uuid, batchIndex, cursor, attempt: 0 }
            with delayMs: 5000
    
    Worker magento-bulk-poll.ts:
    ├── GET /rest/V1/bulk/{bulk_uuid}/status
    ├── All complete → proceed with image sync + advance cursor
    ├── Still running + attempt < 60 → re-enqueue with delayMs: 5000, attempt+1
    └── attempt ≥ 60 (5 min timeout) → log error, skip batch, continue
    ```
  - Configurable async fallback: if bulk endpoint returns 404 → fall back to synchronous `PUT /rest/V1/products` per product; log one-time warning
  - After bulk completes: run synchronous calls for configurable product options and child-linking (no bulk equivalent)
  - Image sync runs after product data, respecting `image_sync_enabled` and `image_upload_concurrency`
- Cursor: OM product `updated_at` timestamp; advances only after bulk status confirmed complete

**Testable:** `getMapping()` returns valid `DataMapping`. `streamExport` yields `ExportBatch` with correct shape. Async bulk poll job enqueued, not blocking. Fallback to sync on 404. Cursor advances only after completion confirmed. Image step skipped when `image_sync_enabled: false`.

#### Step 3.1a: `type_id` Immutability Handling
Magento's `type_id` (`simple` vs `configurable`) is **immutable after creation**. If an OM product gains variants after its initial export as a simple product, the mapper must:
1. Check existing Magento product `type_id` via `GET /rest/V1/products/{sku}`
2. If `type_id` mismatch (e.g. existing is `simple`, expected is `configurable`): log a warning to `integrationLogService`, delete the Magento product (`DELETE /rest/V1/products/{sku}`), remove the stale mapping via `externalIdMappingService.deleteExternalIdMapping('sync_magento', 'catalog.product', productId, { organizationId, tenantId })` (see data-model note — this method must be added to the service before implementation), then proceed with fresh creation as configurable
3. Note: deletion also removes associated images and Magento-side metadata — document this trade-off for operators

This check runs as part of `product-mapper.ts` before any upsert call.

#### Step 3.2: Simple Product Mapping
- `lib/product-mapper.ts` — `mapToMagentoSimple(product, attributeSetId)`:
  - **SKU sanitization** (`sanitizeSku` utility): replace `/`, `\`, and other forbidden chars with `-`; max 64 chars; log a warning if the original SKU was modified. Store sanitized SKU as `externalId` in `externalIdMappingService.storeExternalIdMapping(...)` so all subsequent lookups use the correct Magento SKU.
  - Maps: `name`, sanitized SKU, `description`, `short_description`
  - `status`: `product.is_active ? 1 : 2` (1=enabled, 2=disabled)
  - `visibility`: `4` (Catalog + Search)
  - Maps custom fields to `custom_attributes` array using `<prefix>_<fieldName>` codes; for select-type fields use option ID from provisioning cache
  - Category IDs from `externalIdMappingService` lookups by `internalEntityType: 'catalog.category'`
  - `extension_attributes.website_ids`: derive from `channelStoreMapping` (take `website_id` for each mapped store view code via `GET /rest/V1/store/websites`)
- `PUT /rest/V1/products` (upsert by SKU)

**Testable:** Simple product created/updated with correct status, visibility, website assignment, and sanitized SKU.

#### Step 3.3: Configurable Product Mapping
- `lib/product-mapper.ts` — `mapToMagentoConfigurable(product, variantOptionSchema, attributeSetId)`:
  - Create configurable parent product (`type_id: 'configurable'`)
  - `visibility: 4` (Catalog + Search), `status: is_active ? 1 : 2`
  - `extension_attributes.website_ids`: same logic as Step 3.2
  - `PUT /rest/V1/configurable-products/{sku}/options` — declare configurable axes (with `position` field set per option index)
  - For each variant:
    - Create/update Magento child simple product with sanitized SKU
    - `visibility: 1` (Not Visible Individually) — children must NOT appear standalone in catalog
    - `status: 1` (always enabled on child level; parent status controls storefront visibility)
    - Set configurable attribute values using option IDs from provisioning cache
    - `PUT /rest/V1/configurable-products/{sku}/child` — link child SKU to parent

**Testable:** Configurable product with variant children created. Children have `visibility: 1`. Children linked to parent. `position` field set on configurable options.

#### Step 3.4: Image Sync
- `lib/image-service.ts` — `syncImages(product, magentoSku, credentials)`:
  - Fetch existing Magento media entries: `GET /rest/V1/products/{sku}/media`
  - For each OM attachment with `type: 'image'`:
    - Check `externalIdMappingService` for `{ integrationId: 'sync_magento', internalEntityType: 'catalog.attachment', internalEntityId: attachmentId }` → `externalId` is the Magento media entry ID
    - If not found → upload: `POST /rest/V1/products/{sku}/media` with Base64 content; store mapping
    - If found but attachment `updated_at` > last sync → re-upload, update mapping externalId
    - If mapped and not changed → skip
  - Set image roles: first image gets `["image", "small_image", "thumbnail"]`
  - **Image format validation**: check MIME type before encoding. Supported: `jpg/jpeg`, `png`, `gif`, `bmp`, `tiff`. Unsupported (WebP, AVIF, SVG): log item-level warning and skip — do NOT abort product export.
  - **Image resize**: if `image_max_dimension > 0` and image dimensions exceed it → resize in-memory via `sharp` (`optionalDependency`) before Base64 encoding. If `sharp` is not installed (e.g. Alpine container without native build): skip resize, log one-time warning, upload original. Never hard-fail on missing `sharp`. Format preserved on resize.
  - **Upload concurrency**: `image_upload_concurrency` products processed in parallel (default 5). Per-product images remain sequential to preserve gallery position order.
  - Entire image sync step is skipped when `image_sync_enabled: false` in settings.

**Testable:** Images uploaded once. Unchanged images skipped. Changed images re-uploaded. Unsupported format logged and skipped. Resize applied when dimension exceeds limit. Concurrent uploads bounded by `image_upload_concurrency`. Image step skipped when `image_sync_enabled: false`.

#### Step 3.5: Price Export
- `lib/price-service.ts` — `setPrices(product, channelStoreMappings, credentials)`:
  - Base price (product's primary currency): set on product via default store scope
  - Special price with date range: set on product's special_price field (default scope)
  - For each `channelStoreMapping`: fetch channel-specific price from OM, call store-view-scoped update with `Store: storeViewCode` header
  - Variant-specific prices: set on child simple product SKU

**Testable:** Base price set. Special price set with date range. Multi-currency prices set per store view.

---

### Phase 3.6: Fast Price Sync (`sync_magento_prices`)

**Goal:** Prices and special prices pushed to Magento via bulk API independently of full product sync. Operates only on products already mapped in `SyncExternalIdMapping`.

#### Step 3.6.1: `DataSyncAdapter` for `sync_magento_prices`
- `adapters/prices.ts` implements `DataSyncAdapter`:
  - `providerKey: 'magento_prices'`
  - `direction: 'export'`
  - `supportedEntities: ['prices']`
  - **`getMapping()` (required)**:
    ```typescript
    async getMapping(input) {
      return { entityType: input.entityType, fields: [], matchStrategy: 'externalId' }
    }
    ```
  - **`getInitialCursor()`**: returns `null`
  - `streamExport(input: StreamExportInput)`: yields `ExportBatch` objects:
    - Fetch OM products where `updated_at > cursor` AND have an `externalIdMappingService` entry with `integrationId: 'sync_magento'`, `internalEntityType: 'catalog.product'`
    - Skip products not in mapping — no product creation, no attribute pre-flight
    - Yield batches of 100 SKUs wrapped in `ExportBatch` shape
  - For each batch:
    - Build `base-prices` payload: `[{ sku, price, store_id: 0 }]`
    - Build `special-prices` payload per store view: `[{ sku, price, store_id, price_from?, price_to? }]`
    - Build `special-prices-delete` payload for SKUs where special price was removed
    - `POST /rest/V1/products/base-prices`
    - `POST /rest/V1/products/special-prices` (per store view group)
    - `POST /rest/V1/products/special-prices-delete` (if any)
  - Cursor: product `updated_at`; advances only after all batch calls complete

**Testable:** `getMapping()` returns valid DataMapping. 100-SKU batch sent as single API call. Special price removal sent as delete call. Cursor advances. Products not in mapping skipped.

#### Step 3.6.2: Event-Driven Price Batcher
- `subscribers/product-price-changed.ts` — subscribes to `catalog.product.updated` (persistent):
  - Does NOT attempt to detect which field changed (CRUD event payload does not expose reliable field-level diffs). Enqueues on every product update.
  - Check `externalIdMappingService`: if product has no mapping with `integrationId: 'sync_magento'`, `internalEntityType: 'catalog.product'` → skip silently (product not yet exported)
  - If mapped → enqueue `price-push` job with `{ productId, tenantId, organizationId }`
- `workers/price-push.ts`:
  - Queue: `magento-price-push`, concurrency: 5
  - **Debounce via DB accumulator** (`packages/queue` `EnqueueOptions` does NOT expose `jobId` — verified from source):
    - Subscriber writes `{ tenantId, organizationId, productId, queued_at: now() }` to a `sync_magento_pending_push` table (new entity, columns: `id`, `tenant_id`, `organization_id`, `entity_type` ('price'|'inventory'), `product_id`, `queued_at`, `channel_id nullable`)
    - Subscriber also schedules a single delayed job: `enqueueJob('magento-price-push', { tenantId }, { delayMs: 30_000 })` — this job fires even if more events arrive
    - Worker fires after 30s, reads ALL pending rows for `entity_type='price'` and `tenantId`, batches into 100-item groups, pushes, then deletes processed rows
    - Flush cap: if pending rows ≥ 100 at enqueue time, enqueue immediately (`delayMs: 0`) in addition to the delayed job
  - Fetch current OM prices at execution time (not from enqueued payload)
  - Dispatch to same bulk API calls as adapter

**Testable:** Price event subscriber skips unmapped products. Subscriber enqueues without field-change detection. Worker fetches current prices at execution time. DB accumulator unique constraint prevents duplicate pending rows for the same product.

#### Step 3.6.3: Special Price Deletion
- When OM product has no special price (or special price expired), send `POST /rest/V1/products/special-prices-delete` per store view
- Track previous special price state in `SyncExternalIdMapping` metadata OR check Magento current state before delete
- Simpler approach: always send delete for all store views for a SKU, then re-send only active special prices — idempotent and collision-free

**Testable:** Expired/removed special price deleted from Magento. Base price unaffected.

---

### Phase 4: Inventory Push

**Goal:** OM stock levels pushed to Magento MSI sources per channel mapping.

#### Step 4.1: `DataSyncAdapter` for `sync_magento_inventory`
- `adapters/inventory.ts` implements `DataSyncAdapter`:
  - `providerKey: 'magento_inventory'`
  - `direction: 'export'`
  - `supportedEntities: ['inventory']`
  - **`getMapping()` (required)**:
    ```typescript
    async getMapping(input) {
      return { entityType: input.entityType, fields: [], matchStrategy: 'externalId' }
    }
    ```
  - **`getInitialCursor()`**: returns `null`
  - **MSI detection**: on first run, probe `GET /rest/V1/inventory/sources`. Store result in `MagentoSyncSettings.msi_mode_detected` (DB column) so all processes (web + worker) share the same value. If `msi_mode_detected` is already set, skip probe.
    - HTTP 200 → `msi_mode_detected: true`
    - HTTP 404 or error → `msi_mode_detected: false`
  - `streamExport(input: StreamExportInput)`: fetch OM stock levels for all products in each mapped channel; yields `ExportBatch` objects with `localId` = product UUID, `externalId` = sanitized SKU
  - MSI mode: `PUT /rest/V1/inventory/source-items` (batch ≤500 items per call)
  - Legacy mode: `PUT /rest/V1/stockItems/{sku}` — sequential with 10ms delay
  - Before each push: verify SKU exists via `externalIdMappingService` lookup; skip + log if missing

**Testable:** `getMapping()` returns valid DataMapping. MSI probe stored in DB, not re-probed per run. Stock quantities pushed via correct endpoint. Missing SKUs skipped without aborting. `ExportBatch` shape correct.

#### Step 4.2: Event-Driven Stock Batcher
- `subscribers/product-stock-changed.ts` — subscribes to `catalog.product.updated` (persistent):
  - Does NOT attempt to detect stock field change specifically. Enqueues on every product update.
  - Check `externalIdMappingService`: if product has no mapping with `integrationId: 'sync_magento'` → skip silently
  - If mapped → enqueue `inventory-push` job with `{ productId, tenantId, organizationId }`
- `workers/inventory-push.ts`:
  - Queue: `magento-inventory-push`, concurrency: 5
  - **Debounce via DB accumulator** (same pattern as price-push):
    - Subscriber writes row to `sync_magento_pending_push` (`entity_type: 'inventory'`, `channel_id`)
    - Schedules delayed job `delayMs: 30_000`; flush cap ≥ 500 rows → enqueue immediately
  - Fetch CURRENT OM stock at execution time for all products modified since last inventory cursor
  - Resolve sanitized SKUs from `externalIdMappingService` (no Magento API call — local lookup only)
  - MSI mode: `PUT /rest/V1/inventory/source-items` batch ≤500
  - Legacy mode: sequential `PUT /rest/V1/stockItems/{sku}` per SKU, 10ms delay

**Testable:** Subscriber enqueues without field-change detection. Mapped product check uses `externalIdMappingService`. Worker fetches current stock at execution time. DB accumulator unique constraint prevents duplicate pending rows for the same product.

---

### Phase 5: Order Import

**Goal:** Magento orders imported into OM as sales orders with customer and address data.

#### Step 5.1: `DataSyncAdapter` for `sync_magento_orders`
- `adapters/orders.ts` implements `DataSyncAdapter`:
  - `providerKey: 'magento_orders'`
  - `direction: 'import'`
  - `supportedEntities: ['orders']`
  - **`getMapping()` (required)** — declares the key fields used for deduplication:
    ```typescript
    async getMapping(input) {
      return {
        entityType: input.entityType,
        fields: [
          { externalField: 'increment_id', localField: 'externalReference', mappingKind: 'core', dedupeRole: 'primary' },
          { externalField: 'customer_email', localField: 'customerEmail', mappingKind: 'core' },
        ],
        matchStrategy: 'externalId',
        matchField: 'increment_id',
      }
    }
    ```
  - **`getInitialCursor()`**: returns `null`
  - `streamImport(input: StreamImportInput)`: yields `ImportBatch` objects:
    ```typescript
    yield {
      items: orders.map(o => ({
        externalId: o.increment_id,
        data: o,                    // raw Magento order object
        action: alreadyImported ? 'skip' : 'create',
        hash: o.updated_at,         // cursor field
      })),
      cursor: lastOrderUpdatedAt,
      hasMore: fetchedCount === pageSize,
      batchIndex,
    }
    ```
  - `GET /rest/V1/orders?searchCriteria...` with `updated_at` filter + status filter + pageSize 100
  - Dedup check (before setting `action`): `externalIdMappingService` lookup by `integrationId: 'sync_magento'`, `internalEntityType: 'sales.order'`, `externalId: increment_id` → if found, `action: 'skip'`

**Testable:** `getMapping()` returns valid DataMapping. `streamImport` yields `ImportBatch` with correct shape. Duplicate orders get `action: 'skip'`. Cursor advances. Status filter applied.

#### Step 5.2: Order Mapper
- `lib/order-mapper.ts` — `mapMagentoOrderToOm(magentoOrder, omProductMap, settings)`:
  - **Configurable item filtering**: discard items where `product_type === 'configurable'`. In Magento order items the configurable parent has `parent_item_id === null` and carries no usable SKU/quantity; child simples have `parent_item_id` set and carry the actual SKU and quantity. Filter only by `product_type === 'configurable'` — filtering on `parent_item_id !== null` would drop the children (the opposite of the intent).
  - **Guest orders**: `customer_id === 0` or `null` → always use create-or-link flow by `customer_email`
  - Customer: resolve by email (case-insensitive) via customers API; create if `create_or_link` or `create_only`; skip order with warning if `skip` strategy and customer not found
  - Addresses: map `billing_address` / `shipping_address`; `firstname + ' ' + lastname` → OM `name` field; map all address fields (street array → join with newline, region → state)
  - Lines: SKU lookup (for each filtered item):
    1. `externalIdMappingService` lookup: `{ integrationId: 'sync_magento', internalEntityType: 'catalog.product', externalId: sanitizedSku }`
    2. Fallback: `catalogProductService.findBySku(item.sku, { organizationId, tenantId })` — catches products in OM not yet exported to Magento. **Note**: accessing `CatalogProduct` via raw `em.findOne` from `sync_magento` violates module isolation; the catalog module must expose a service method for cross-module SKU lookups before Phase 5 can be implemented.
    3. If still not found: store as unresolved line with raw `sku`, `name`, `price` from Magento — never drop the line
  - **Amounts**: use `base_grand_total`, `base_subtotal`, `base_tax_amount`, `base_shipping_amount` (store base currency). Store `order_currency_code` and `grand_total` as order metadata for reference.
  - Channel: `default_order_channel_id` from settings

**`OrderCreateInput` field mapping** (verified from `sales/data/validators.ts` `orderCreateSchema`):

| Magento order field | `OrderCreateInput` field | Notes |
|---|---|---|
| `base_currency_code` | `currencyCode` | Required |
| `increment_id` | `externalReference` | For dedup reference |
| `base_grand_total` | `totalGrossAmount` | Final total incl. tax, shipping, discounts |
| `base_grand_total - base_tax_amount` | `totalNetAmount` | Derived; assumes tax-exclusive Magento pricing (default) |
| `base_subtotal` | `subtotalNetAmount` | Pre-tax product subtotal after discounts |
| `base_subtotal + base_tax_amount` | `subtotalGrossAmount` | Approximation — item subtotal gross |
| `base_shipping_amount` | `shippingNetAmount` | Shipping before tax |
| `base_tax_amount` | `taxAmount` | Total order tax |
| resolved customer UUID | `customerEntityId` | From email lookup |
| `billing_address` JSON | `billingAddressSnapshot` | Full JSON snapshot (not address ID) |
| `shipping_address` JSON | `shippingAddressSnapshot` | Full JSON snapshot |
| filtered `items[]` | `lines[]` | After configurable parent filter |
| `default_order_channel_id` | `channelId` | From settings |
| `created_at` | `placedAt` | ISO date |
| `{ order_currency_code, grand_total }` | `metadata` | For reference |
| `organizationId`, `tenantId` | scope fields | Required on command |

**Tax mode assumption**: Magento stores `base_subtotal` as a pre-tax amount in its default configuration (tax-exclusive pricing). The net/gross derivations above use this assumption. A future `tax_mode: 'exclusive' | 'inclusive'` setting in `MagentoSyncSettings` should be added if merchants with tax-inclusive storefronts require accurate gross subtotals.

**Customer PII** (name, email, billing/shipping addresses) written to the sales module is covered by the sales module's existing `defaultEncryptionMaps` — no separate `encryption.ts` entry is needed in `sync_magento`.

**Testable:** Configurable parent items filtered out (filter is `product_type === 'configurable'` only, not `parent_item_id`). Guest order handled. Address `firstname+lastname` concatenated. SKU fallback via `catalogProductService.findBySku` finds unsynced products. Base currency amounts used. Unresolved lines preserved. `OrderCreateInput` scope fields populated.

#### Step 5.3: Order Deduplication & Command
- Dedup is handled in `streamImport` via `action: 'skip'` (Step 5.1) — orders already in `externalIdMappingService` produce `action: 'skip'` items and are not passed to the mapper
- For items with `action: 'create'`:
  - **Crash-recovery pre-check** (atomicity guard): before calling the create command, query `salesOrderService.findByExternalReference(magentoOrder.increment_id, { organizationId, tenantId })`. If an order already exists (created in a previous run that crashed before `storeExternalIdMapping` was called), skip the command and call `storeExternalIdMapping` directly with the recovered ID. This prevents the non-atomic create+map sequence from producing duplicates on retry.
  - Call `sales.orders.create` command with mapped payload (including `organizationId`, `tenantId` scope)
  - After successful creation: store mapping via `externalIdMappingService.storeExternalIdMapping('sync_magento', 'sales.order', omOrderId, magentoOrder.increment_id, { organizationId, tenantId })`
  - **Note**: `salesOrderService.findByExternalReference` is a cross-module call — the sales module must expose this method before Phase 5 can be implemented.

**Testable:** Re-running import does not create duplicate orders. Crash-recovery: if an order with the same `externalReference` exists before the create command fires, the command is skipped and the mapping is stored directly. Idempotent. Mapping stored after creation.

---

### Phase 6: Full Re-Sync Support

**Goal:** Admin can trigger a full re-sync that ignores cursors and re-exports/re-imports all records.

#### Step 6.1: Full Sync Flag
- `POST /api/data_sync/run` with `{ fullSync: true }` — adapter receives `cursor: null`
- Adapter: when `cursor` is null, fetches all records (no `updated_at` filter)
- Products: all active OM products regardless of last sync time
- Orders: all Magento orders matching status filter from beginning of time

**Testable:** Full sync exports all products including ones not changed since last run.

#### Step 6.2: Full Sync UI Trigger
- DataSync runs page gains a "Full Re-sync" button per integration
- `useConfirmDialog()` before triggering — warns user this may take a long time

**Testable:** Full re-sync dialog shown and confirmed before run starts.

---

### Phase 7: Deletion Detection

**Goal:** Handle records deleted on either side — event-driven OM→Magento push (immediate) and scheduled Magento→OM reconciliation scan (daily, opt-in).

#### Step 7.1: OM → Magento Deletion Push

- Add `subscribers/product-deleted.ts` — persistent subscriber for `catalog.product.deleted`:
  - Check `externalIdMappingService.lookupExternalId('sync_magento', 'catalog.product', productId, scope)` → if null: skip silently (product was never exported to Magento)
  - If mapped: enqueue `magento-product-delete` job with `{ magentoSku: externalId, productId, tenantId, organizationId }`
- Add `workers/product-delete.ts`:
  - Queue: `magento-product-delete`, concurrency: 3
  - `DELETE /rest/V1/products/{magentoSku}`
  - On 404: log info (already deleted in Magento) — treat as success
  - On success:
    - `externalIdMappingService.deleteExternalIdMapping('sync_magento', 'catalog.product', productId, { organizationId, tenantId })` — removes product mapping
    - Also clean up `catalog.attachment` mappings: `externalIdMappingService.deleteExternalIdMappings('sync_magento', 'catalog.attachment', productAttachmentIds, { organizationId, tenantId })` (batch delete variant — must be added to the service alongside the single-record delete method)
    - Emit `sync_magento.product.deleted` event
  - **Warning**: Magento cascades the deletion — all child simples (for configurable products), Magento-side media entries, and customer reviews are permanently removed. Log a warning with the SKU before executing.

**Testable:** Deleting a previously-exported OM product triggers `DELETE /rest/V1/products/{sku}`. Products not in `SyncExternalIdMapping` skip silently. HTTP 404 from Magento treated as success. All `SyncExternalIdMapping` rows for the product (including attachment mappings) cleaned up after deletion.

#### Step 7.2: Magento → OM Reconciliation (Deletion Detection)

Detects products deleted directly in Magento admin (bypassing OM), which `updated_at` delta sync can never see.

This is **opt-in** (`reconciliation_enabled: false` by default) — the first full run can be slow for large catalogs.

New settings fields on `MagentoSyncSettings` (added in Phase 7):

```typescript
  // Opt-in; false = reconciliation worker is a no-op
  @Property({ default: false })
  reconciliation_enabled: boolean

  // Interval in days (1 = daily)
  @Property({ default: 1 })
  reconciliation_frequency_days: number

  // 'log_only' = log + emit event only; 'disable_product' = also sets is_active=false on the OM product
  @Property({ default: 'log_only' })
  deleted_externally_action: 'log_only' | 'disable_product'
```

Additional `syncSettingsSchema` fields:
```typescript
  reconciliationEnabled: z.boolean().optional(),
  reconciliationFrequencyDays: z.number().int().min(1).max(365).optional(),
  deletedExternallyAction: z.enum(['log_only', 'disable_product']).optional(),
```

New scheduled worker `workers/reconciliation.ts`:

```
Scheduled: every reconciliation_frequency_days (cron via packages/queue scheduler)
Guard: skip entirely when reconciliation_enabled = false

For internalEntityType 'catalog.product':
├── Fetch all active Magento product SKUs (paginated, 300/page):
│   GET /rest/V1/products?fields=items[sku]&searchCriteria[pageSize]=300&...
├── Load all SyncExternalIdMapping rows for integrationId='sync_magento',
│   internalEntityType='catalog.product', tenantId, organizationId
├── Diff: mapping rows whose externalId (Magento SKU) is absent from fetched set → deleted in Magento
└── For each detected deletion:
    ├── Log warning via integrationLogService: { action: 'deleted_externally', magentoSku, productId }
    ├── Emit sync_magento.product.deleted_externally event
    └── If deleted_externally_action = 'disable_product':
            Update OM product is_active → false via catalog.products.update command
            (does NOT remove the SyncExternalIdMapping row — product may be re-activated and re-exported)
```

**Known limitation:** Reconciliation only detects products present in `SyncExternalIdMapping`. Products deleted in Magento before the initial OM export are invisible — this is expected and correct.

**Testable:** Reconciliation worker skips when `reconciliation_enabled: false`. All Magento SKUs fetched with pagination. Products missing from Magento detected and logged. `disable_product` action updates `is_active: false` on the OM product. `log_only` action creates integration log entry without modifying the product.

---

### Out of Scope (Future Phases)

The following are confirmed-feasible additions identified during pre-implementation analysis. They are not part of v1 scope.

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| **Customers sync** (bidirectional) | High | `CustomerEntity` + `CustomerAddress` ↔ Magento customer REST API. `firstname`/`lastname` ↔ `firstName`/`lastName`, `default_billing`/`default_shipping` → `isPrimary` + `purpose`. |
| **Invoices, shipments, credit memos** | High | Full sales document flow. Magento has complete REST CRUD for all three with `updated_at` delta support. |
| **Adobe Commerce real-time webhooks** | Medium | Adobe I/O Events replace polling for near-instant product/order sync. Received via the `webhooks` hub. Not available in open-source Magento CE. |
| **Multi-store-view → multilingual sync** | Medium | Store-view-scoped product calls (`/rest/{storeViewCode}/V1/products`) feeding OM translation system. Multiplies API calls N× per entity. |
| **Grouped/bundle product support** | Low | Approximation via `CatalogProductVariantRelation`; bundle option config stored in `metadata` JSONB. Structural mismatch limits fidelity. |
| **Deep MSI inventory management** | Blocked | Requires a dedicated OM inventory module (`packages/core/src/modules/inventory/`). Current `sync_magento_inventory` covers stock levels but not source/stock entity management. |

---

### File Manifest (Key Files)

> All paths are relative to the `open-mercato/official-modules` repository root (locally `external/official-modules/`).

| File | Action | Purpose |
|------|--------|---------|
| `packages/sync-magento/src/modules/sync_magento/integration.ts` | Create | Bundle + 4 child integration definitions |
| `packages/sync-magento/src/modules/sync_magento/data/entities.ts` | Create | `MagentoSyncSettings` ORM entity |
| `packages/sync-magento/src/modules/sync_magento/data/validators.ts` | Create | Zod schemas for settings |
| `packages/sync-magento/src/modules/sync_magento/lib/client.ts` | Create | Magento REST client factory + store-view header support |
| `packages/sync-magento/src/modules/sync_magento/lib/attribute-service.ts` | Create | Class A + Class B attribute/attribute-set provisioning |
| `packages/sync-magento/src/modules/sync_magento/lib/category-service.ts` | Create | Category tree sync with `SyncExternalIdMapping` |
| `packages/sync-magento/src/modules/sync_magento/lib/image-service.ts` | Create | Image upload + `SyncExternalIdMapping` dedup |
| `packages/sync-magento/src/modules/sync_magento/lib/price-service.ts` | Create | Base + special price per store view |
| `packages/sync-magento/src/modules/sync_magento/lib/product-mapper.ts` | Create | OM product → simple/configurable Magento REST payload |
| `packages/sync-magento/src/modules/sync_magento/lib/order-mapper.ts` | Create | Magento order → OM order payload |
| `packages/sync-magento/src/modules/sync_magento/adapters/products.ts` | Create | `DataSyncAdapter` for full product export (async bulk) |
| `packages/sync-magento/src/modules/sync_magento/adapters/prices.ts` | Create | `DataSyncAdapter` for fast bulk price export |
| `packages/sync-magento/src/modules/sync_magento/adapters/inventory.ts` | Create | `DataSyncAdapter` for inventory export |
| `packages/sync-magento/src/modules/sync_magento/adapters/orders.ts` | Create | `DataSyncAdapter` for order import |
| `packages/sync-magento/src/modules/sync_magento/workers/inventory-push.ts` | Create | Event-driven stock push (debounced batch, MSI/legacy) |
| `packages/sync-magento/src/modules/sync_magento/workers/price-push.ts` | Create | Event-driven price push (debounced batch, bulk API) |
| `packages/sync-magento/src/modules/sync_magento/subscribers/product-stock-changed.ts` | Create | Subscribe to `catalog.product.updated` → enqueue stock batch |
| `packages/sync-magento/src/modules/sync_magento/subscribers/product-price-changed.ts` | Create | Subscribe to `catalog.product.updated` → enqueue price batch |
| `packages/sync-magento/src/modules/sync_magento/api/GET/sync-magento/settings.ts` | Create | Settings read endpoint |
| `packages/sync-magento/src/modules/sync_magento/api/PUT/sync-magento/settings.ts` | Create | Settings write endpoint |
| `packages/sync-magento/src/modules/sync_magento/api/POST/sync-magento/validate.ts` | Create | Connection validation endpoint |
| `packages/sync-magento/src/modules/sync_magento/widgets/injection/settings-tab/widget.client.tsx` | Create | Settings UI tab component |
| `packages/sync-magento/migrations/` | Create | DB migrations for `sync_magento_settings` and `sync_magento_pending_push` tables |
| `packages/sync-magento/src/modules/sync_magento/subscribers/product-deleted.ts` | Create | Subscribe to `catalog.product.deleted` → enqueue Magento SKU deletion (Phase 7) |
| `packages/sync-magento/src/modules/sync_magento/workers/product-delete.ts` | Create | Execute `DELETE /rest/V1/products/{sku}` and clean up all `SyncExternalIdMapping` rows for the product (Phase 7) |
| `packages/sync-magento/src/modules/sync_magento/workers/reconciliation.ts` | Create | Daily opt-in scan: fetch all Magento SKUs, diff with `SyncExternalIdMapping`, detect externally-deleted products (Phase 7) |

---

### Integration Test Coverage

The implementation MUST ship with integration coverage for the following paths.

#### API Paths
- `GET /api/sync-magento/settings` — returns empty/default settings for fresh tenant
- `PUT /api/sync-magento/settings` — saves and returns updated settings; validates channel UUIDs
- `POST /api/sync-magento/validate` — returns store views with valid credentials; 409 with invalid token
- `POST /api/data_sync/run` — starts sync run, returns `progressJobId`; returns 409 when run already in progress

#### Adapter / Worker Paths
- Products adapter: incremental run picks up only products modified after cursor
- Products adapter: full re-sync (`cursor: null`) picks up all products
- Products adapter: attribute set pre-flight skipped when attributes already provisioned (idempotent)
- Products adapter: image not re-uploaded when attachment unchanged; re-uploaded when changed
- Products adapter: configurable product child-linking correct (parent ↔ child relationship in Magento)
- Inventory adapter: stock quantities pushed per channel→stock source mapping
- Inventory worker: `catalog.product.updated` subscriber enqueues push job
- Orders adapter: duplicate import skipped (dedup via `SyncExternalIdMapping`)
- Orders adapter: cursor advances to last `updated_at` value in batch
- Orders adapter: order line with unknown SKU stored as unresolved, not dropped
- Prices adapter: base prices sent as single bulk call (100 SKUs/batch); cursor advances after call completes
- Prices adapter: special price removal triggers `special-prices-delete` call
- Prices adapter: products not in `SyncExternalIdMapping` skipped (no Magento call attempted)
- Price push worker: multiple rapid price changes coalesced; single bulk API call for batch
- Price push worker: worker fetches current price at execution time, not enqueued value
- Inventory push worker: multiple rapid stock changes coalesced into single MSI batch call

#### Safety Assertions
- Credentials never appear in integration logs
- Settings endpoints reject unauthenticated requests
- Tenant isolation: settings/mappings from tenant A not accessible by tenant B
- `Store` header set correctly on store-view-scoped price update calls
- Attribute provisioning is idempotent (run twice produces same Magento state)

---

## Risks & Impact Review

### Data Integrity Failures

#### Partial Product Export (Crash Mid-Batch)
- **Scenario**: Export worker crashes after updating some products in a batch but before saving the cursor. On resume, the same batch is re-exported.
- **Severity**: Medium
- **Affected area**: Magento product data, duplicate image uploads
- **Mitigation**: Magento product upsert is by SKU (idempotent). Image service checks `SyncExternalIdMapping` before uploading. Re-processing a batch produces the same outcome.
- **Residual risk**: Low — idempotent operations absorb retries safely.

#### Configurable Product Child Linking Failure
- **Scenario**: Parent configurable product created successfully but child-linking step fails (network error or Magento validation error on child SKU format).
- **Severity**: High
- **Affected area**: Magento product catalog — configurable product has no children, appears broken on storefront.
- **Mitigation**: Child-link is per-variant within a transaction-like sequence. Failed variants are logged as item-level errors (not fatal to the run). Product is re-processed on next run. Item error logged via `integrationLogService`.
- **Residual risk**: Medium — a partial configurable product is visible on storefront until next sync run completes the children.

#### Product `type_id` Change (Simple → Configurable)
- **Scenario**: An OM product is exported as a Magento simple product. Later, variants are added in OM. The next sync run attempts to update the existing Magento product to `type_id: configurable`, but Magento returns a 400 — `type_id` is immutable.
- **Severity**: High
- **Affected area**: Product catalog — the product may stall in an inconsistent state until the mapper detects and handles the conflict.
- **Mitigation**: Mapper checks existing Magento `type_id` before upsert. On mismatch: delete + recreate. Deletion removes Magento-side data (reviews, etc.). Log a warning with the SKU so the operator is aware.
- **Residual risk**: Medium — product deletion loses Magento-side data. Documented trade-off; operators should avoid adding variants to products that already have Magento reviews or CMS links.

#### Attribute Option Removal
- **Scenario**: An OM option value is removed, but the corresponding Magento attribute option is not deleted (additive-only provisioning). Existing products retain the old option value in Magento.
- **Severity**: Low
- **Affected area**: Magento attribute options, storefront filter values.
- **Mitigation**: Additive-only provisioning is intentional (avoids breaking existing Magento products). Old option values are orphaned but harmless. A future "clean up stale options" command can be added.
- **Residual risk**: Low.

### Cascading Failures & Side Effects

#### Magento Rate Limiting / Downtime
- **Scenario**: Magento REST API returns 429 or 503 during a large product export.
- **Severity**: High
- **Affected area**: Export run — fails or stalls.
- **Mitigation**: Magento REST client implements exponential backoff (3 retries, 2s/4s/8s delays). Worker queue retries failed jobs via the `data_sync` retry mechanism. Cursor ensures no data is re-processed from scratch.
- **Residual risk**: Low — retries and cursor resume absorb transient Magento downtime.

#### Inventory Push Event Storm
- **Scenario**: A bulk product import in OM triggers `catalog.product.updated` for thousands of products, flooding the `magento-inventory-push` queue.
- **Severity**: Medium
- **Affected area**: Worker queue depth, Magento API rate limits.
- **Mitigation**: Worker concurrency capped at 10. Inventory pushes are batched (up to 500 SKUs per MSI API call). Bulk import scenarios should prefer the scheduled inventory adapter run over event-driven push.
- **Residual risk**: Medium — a very large bulk import may saturate the queue for several minutes.

#### Order Import Creates Duplicate Customer
- **Scenario**: Magento order has a guest email; `create_or_link` strategy creates a new OM customer, but the same email already exists in OM.
- **Severity**: Medium
- **Affected area**: OM customer records — potential duplicate.
- **Mitigation**: `create_or_link` strategy searches OM customers by email before creating. Case-insensitive email match. If found, order is linked to existing customer. If `create_only`, a new customer is always created (documented trade-off).
- **Residual risk**: Low with `create_or_link`; Medium with `create_only` (by design).

### Tenant & Data Isolation Risks

#### Cross-Tenant Magento Config Access
- **Scenario**: Bug in settings service returns another tenant's Magento credentials.
- **Severity**: Critical
- **Affected area**: Magento credentials leak.
- **Mitigation**: All `MagentoSyncSettings` queries scope by `tenant_id + organization_id`. Credentials retrieved via `integrationCredentialsService` which scopes by `tenantId + organizationId`. No global state.
- **Residual risk**: Negligible.

#### Magento SKU Collisions Across Tenants
- **Scenario**: Two different tenants share the same Magento instance and use the same SKU for different products.
- **Severity**: High
- **Affected area**: Product data overwritten in Magento.
- **Mitigation**: Documented constraint: this integration assumes one Magento instance is dedicated to one OM tenant. Multi-tenant-to-single-Magento setups are explicitly unsupported in v1. Admin documentation must warn about this.
- **Residual risk**: Medium — requires documentation and admin awareness.

### Migration & Deployment Risks

#### First-Run Full Sync Duration
- **Scenario**: A merchant with 10,000+ products and images runs a full sync for the first time.
- **Severity**: Medium
- **Affected area**: Initial onboarding experience.
- **Mitigation**: Async Bulk API reduces product data phase from ~30 min to ~2–4 min for 10k products. Concurrent image uploads (concurrency=5, resize enabled) reduce image phase from ~4h to ~60–90 min. Admin can set `image_sync_enabled: false` to push product data first (minutes) and sync images in a scheduled off-peak run. Progress bar in OM UI. Cursor enables safe resume if run is interrupted.
- **Residual risk**: Low — large first-run with images is expected; managed via progress visibility and image-sync decoupling.

#### Async Bulk API Unavailable
- **Scenario**: Magento instance has the `Magento_AsynchronousOperations` module disabled or the queue consumer is not running. `POST /rest/async/bulk/V1/products` returns 404. Bulk status polling never resolves.
- **Severity**: Medium
- **Affected area**: Product export throughput (falls back to synchronous, much slower).
- **Mitigation**: On 404 response from bulk endpoint → automatic fallback to synchronous `PUT /rest/V1/products` per product. Log a one-time warning recommending the admin enable the async module for better performance. No data loss.
- **Residual risk**: Low — sync still works, just slower.

#### Magento Attribute `attribute_code` Collisions
- **Scenario**: OM field name after prefix and sanitization (`om_color`) collides with an existing Magento native attribute or third-party attribute.
- **Severity**: Medium
- **Affected area**: Attribute provisioning fails or overwrites existing Magento attribute type.
- **Mitigation**: Provisioning service checks attribute existence before creating. If attribute exists with incompatible type, logs a warning and skips rather than overwriting. Admin should choose a unique prefix.
- **Residual risk**: Medium — admin must choose a non-colliding prefix.

### Operational Risks

#### Price Push Before Product Exists in Magento
- **Scenario**: `sync_magento_prices` event-driven worker fires for a product immediately after it is created in OM, before `sync_magento_products` has exported it to Magento. `POST /rest/V1/products/base-prices` returns a validation error for the unknown SKU.
- **Severity**: Low
- **Affected area**: Price not set in Magento until next price sync run or product sync run.
- **Mitigation**: Subscriber checks `SyncExternalIdMapping` before enqueueing — products not yet exported are silently skipped. Once the full product sync exports the product, the next incremental price sync (or next price change) will pick it up. Price export adapter also runs on `updated_at` cursor, so prices are set as part of the next scheduled run anyway.
- **Residual risk**: Negligible — at most one price sync interval of lag.

#### Debounce Window Causes Price Lag
- **Scenario**: A price change is queued with a 30s debounce window. During high-throughput bulk price imports in OM, the window resets repeatedly, delaying the Magento push indefinitely.
- **Severity**: Medium
- **Affected area**: Magento price accuracy during bulk OM operations.
- **Mitigation**: Debounce caps at 100 items (price) or 500 items (stock) — when cap is reached, flush immediately regardless of window. For bulk catalog imports, the scheduled price sync adapter (e.g., every 15 min) acts as a hard backstop.
- **Residual risk**: Low — maximum lag bounded by flush cap + scheduled sync interval.

#### Concurrent Product Create + Inventory Push Race Condition
- **Scenario**: `sync_magento_products` and `sync_magento_inventory` run in parallel. Inventory push for a newly created product executes before the product exists in Magento, returning 404.
- **Severity**: Medium
- **Affected area**: Stock levels for newly created products missing in Magento until next inventory sync.
- **Mitigation**: Inventory push worker checks `SyncExternalIdMapping` for `catalog.product` before pushing. If SKU is not yet in the mapping (product not yet exported) → skip + log info. The next scheduled inventory sync will pick up the stock once the product export has completed.
- **Residual risk**: Low — at most one inventory sync cycle of lag for new products.

#### Order Line Items Double-Counted for Configurable Products
- **Scenario**: Magento includes both the configurable parent item and the child simple item in `order.items[]`. Without filtering, each ordered configurable product appears twice in the OM order.
- **Severity**: High
- **Affected area**: OM order line quantities, totals.
- **Mitigation**: Order mapper filters items by `product_type !== 'configurable'`. Covered by integration test assertion.
- **Residual risk**: Negligible if test coverage is maintained.

#### Unsupported Image Format Blocks Product Export
- **Scenario**: All product images are in WebP format (increasingly common). Every product's image export fails silently, resulting in Magento products with no images.
- **Severity**: Medium
- **Affected area**: Storefront product presentation.
- **Mitigation**: Image format check logs a warning per attachment but does NOT abort product export. Admin is notified via integration logs. A future enhancement can add server-side WebP→JPEG conversion.
- **Residual risk**: Medium — operator must convert images or accept no-image products until conversion is added.

#### Product Deletions Not Propagated (v1 without Phase 7)

- **Scenario**: A product is deleted in OM (or directly in Magento admin) before Phase 7 is deployed. Delta sync via `updated_at` filtering never surfaces deletions — both sides drift silently.
- **Severity**: Medium
- **Affected area**: Magento storefront (orphan products remain live); OM catalog accuracy (missing products still tracked in `SyncExternalIdMapping`).
- **Mitigation**: Phase 7 Step 7.1 adds event-driven `catalog.product.deleted` → `DELETE /rest/V1/products/{sku}` (OM→Magento, immediate). Phase 7 Step 7.2 adds daily reconciliation scan for Magento→OM direction. Until Phase 7 is deployed, operators can remove orphan products manually in Magento admin or run a full re-sync followed by manual review.
- **Residual risk**: Low once Phase 7 is live. Medium during the deployment window.

#### Silent Sync Lag
- **Scenario**: Scheduled sync is delayed or silently fails — Magento catalog drifts from OM without operator awareness.
- **Severity**: Medium
- **Affected area**: Storefront product accuracy.
- **Mitigation**: Sync run completion/failure events (`sync_magento.sync.completed/failed`) with `clientBroadcast: true`. Integration health check (existing `health-probe` worker) detects credential/connectivity issues. Failed sync runs appear in the data sync dashboard with error details.
- **Residual risk**: Low — operator-visible via dashboard and health probe.

---

## Final Compliance Report — 2026-05-29

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — task router, conventions, critical rules, backward compatibility
- `packages/core/AGENTS.md` — module development, entities, API routes, events, commands, setup
- `packages/core/src/modules/integrations/AGENTS.md` — integration registry, credentials, UMES
- `packages/core/src/modules/data_sync/AGENTS.md` — sync hub, adapter contract, run lifecycle
- `packages/core/src/modules/catalog/AGENTS.md` — product model, pricing, events
- `packages/core/src/modules/sales/AGENTS.md` — order model, document flow, channel scoping
- `packages/shared/AGENTS.md` — shared utilities, types, encryption
- `packages/ui/AGENTS.md` — CrudForm, DataTable, design system
- `packages/queue/AGENTS.md` — background workers, concurrency
- `packages/events/AGENTS.md` — event bus, SSE, subscribers
- `.ai/skills/om-integration-builder/SKILL.md` — provider scaffolding guide
- `AGENTS.md` (root) → `external/official-modules/` section — official module workflow, activation, submodule git rules
- `BACKWARD_COMPATIBILITY.md` — 13 contract surfaces

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root AGENTS | No direct ORM relationships between modules | ✅ PASS | `MagentoSyncSettings` uses FK IDs. All three cross-module service gaps resolved: (1) `externalIdMappingService.deleteExternalIdMapping` / `deleteExternalIdMappings` added to `data_sync`; (2) `catalogProductService.findBySku` added to catalog module; (3) `salesOrderService.findByExternalReference` added to sales module |
| Root AGENTS | Filter by `organization_id` | ✅ PASS | All settings queries scope by `tenant_id + organization_id` |
| Root AGENTS | Validate all inputs with Zod | ✅ PASS | `syncSettingsSchema`, `channelStockMappingSchema`, `channelStoreMappingSchema` declared |
| Root AGENTS | API routes MUST export `openApi` | ✅ PASS | Settings GET/PUT and validate route all export `openApi` |
| Root AGENTS | Event IDs: `module.entity.action` | ✅ PASS | `sync_magento.product.exported`, `sync_magento.order.imported`, etc. |
| Root AGENTS | Feature naming: `module.action` | ✅ PASS | `sync_magento.view`, `sync_magento.configure` |
| Root AGENTS | Use `findWithDecryption` for encrypted data | ✅ PASS | Credentials read via `integrationCredentialsService` (existing encrypted credential store) |
| Root AGENTS | Never log credentials | ✅ PASS | Client factory resolves credentials per call; integration log service strips secrets |
| Root AGENTS | Every dialog: `Cmd+Enter` submit, `Escape` cancel | ✅ PASS | Settings form in widget follows convention |
| Root AGENTS | Keep `pageSize ≤ 100` | ✅ PASS | Order import pages at 100; OM DB product fetch at 50 per page (Magento async-bulk batch is 150 — a separate, outbound layer) |
| Root AGENTS | No hardcoded user-facing strings | ✅ PASS | All strings via `i18n/en.json` |
| Root AGENTS | Design System — semantic tokens only | ✅ PASS | Settings UI uses `<CrudForm>` and dropdowns — no hardcoded status colors in the described UI; `<Alert>`/`<StatusBadge>` not used in this spec's UI section and removed from the claim |
| official-modules | Module lives in `open-mercato/official-modules`; no core changes required → single PR | ✅ PASS | All platform contracts consumed as-is; no core module modified |
| official-modules | Activated via `official-modules.json`, NOT via manual `modules.ts` edit | ✅ PASS | `"sync_magento": "activated"` entry; `official-modules.generated.ts` regenerated by postinstall |
| Integration Builder | New provider in own npm workspace | ✅ PASS | `packages/sync-magento/` workspace in `open-mercato/official-modules` repo |
| Integration Builder | `integration.ts` at module root | ✅ PASS | Exports bundle + children |
| Integration Builder | Provider-owned env preconfiguration | ✅ PASS | `lib/preset.ts` + `setup.ts` + `configure-from-env` CLI |
| Integration Builder | Health check validates real connectivity | ✅ PASS | Calls `/rest/V1/store/storeViews` |
| data_sync AGENTS | Use queue system for syncs | ✅ PASS | All adapters registered with `data_sync` hub; use `DataSyncAdapter` streaming contract |
| data_sync AGENTS | Persist cursor after each batch | ✅ PASS | `SyncCursor` updated via `dataSyncRunService` after each batch |
| data_sync AGENTS | Log item-level errors | ✅ PASS | Failed individual products/orders logged via `integrationLogService`; run continues |
| data_sync AGENTS | Check for overlap before starting | ✅ PASS | Handled by existing `dataSyncRunService.checkOverlap()` |
| BC Contract | Auto-discovery conventions | ✅ PASS | New provider package; no existing conventions changed |
| BC Contract | Import paths | ✅ PASS | New exports only; no moved modules |
| BC Contract | API routes | ✅ PASS | New `/api/sync-magento/*` namespace; no existing routes modified |
| BC Contract | DB schema | ✅ PASS | New table `sync_magento_settings` only; no changes to core tables |
| BC Contract | DI service names | ✅ PASS | New `magentoHealthCheck`, `magentoSyncSettingsService`; no renames |
| BC Contract | Event IDs | ✅ PASS | New `sync_magento.*` events only |
| BC Contract | ACL feature IDs | ✅ PASS | New `sync_magento.*` features |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | ✅ Pass | `MagentoSyncSettings` fields match settings API request/response |
| API contracts match UI/UX section | ✅ Pass | Settings UI consumes `GET/PUT /api/sync-magento/settings` and `POST /api/sync-magento/validate` |
| Risks cover all write operations | ✅ Pass | Magento product upsert, configurable linking, inventory push, attribute creation covered. Duplicate-order risk addressed by Step 5.3 crash-recovery guard (`salesOrderService.findByExternalReference` — now implemented) |
| Commands defined for all mutations | ✅ Pass | Order creation via `sales.orders.create` command (corrected from `sales.order.create`); reconciliation disable via `catalog.products.update` (corrected from `catalog.product.update`). Both command IDs verified against origin/develop |
| Class A vs Class B attribute distinction explicit | ✅ Pass | Separate provisioning paths documented; configurable attribute requirements (`scope: global`, `is_configurable: true`, `frontend_input: select`) spelled out |
| Image dedup strategy documented | ✅ Pass | `SyncExternalIdMapping` + `updated_at` comparison |
| Order deduplication strategy documented | ✅ Pass | `SyncExternalIdMapping` by `increment_id` |
| Store-view header requirement documented | ✅ Pass | Client factory + price service both addressed |
| `type_id` immutability documented | ✅ Pass | Step 3.1a: delete+recreate on simple→configurable mismatch; risk entry added |
| Mutation guard on custom write route | ✅ Pass | PUT /api/sync-magento/settings notes `validateCrudMutationGuard` requirement |
| `MagentoSyncSettings` unique constraint | ✅ Pass | `@Unique({ properties: ['tenant_id', 'organization_id'] })` on entity |
| Inventory worker convergence | ✅ Pass | Worker fetches current stock at execution time, not enqueue time |
| `DataSyncAdapter.getMapping()` implemented | ✅ Pass | All 4 adapters implement required `getMapping()` returning minimal DataMapping |
| `ExportBatch`/`ImportBatch` contract | ✅ Pass | All adapters yield correct shapes; Steps 3.1, 3.6.1, 4.1, 5.1 |
| `SyncExternalIdMapping` correct field names | ✅ Pass | All references use `internalEntityType`/`internalEntityId`/`integrationId: 'sync_magento'` |
| `externalIdMappingService` via DI | ✅ Pass | Service used for all lookups/creates/deletes. `deleteExternalIdMapping` and `deleteExternalIdMappings` implemented in `data_sync` service; all 3 deletion sites route through them |
| `POST /api/data_sync/run` correct schema | ✅ Pass | Full schema with `entityType`+`direction` documented; entityType registry table added |
| Debounce/coalesce implementable | ✅ Pass | DB accumulator table `sync_magento_pending_push` + delayed worker; `jobId` not used (verified: not in queue EnqueueOptions) |
| Subscriber field-change detection removed | ✅ Pass | Subscribers enqueue on any product update; workers fetch current values |
| `sales.orders.create` field mapping | ✅ Pass | Command ID corrected to `sales.orders.create`. Totals mapping corrected to use actual `orderTotalsSchema` fields (`totalGrossAmount`, `totalNetAmount`, `subtotalNetAmount`, `subtotalGrossAmount`, `shippingNetAmount`, `taxAmount`). Tax-mode assumption documented. |
| Async bulk polling non-blocking | ✅ Pass | Re-enqueue pattern with `magento-bulk-poll` deferred job; no thread-blocking poll loops |
| `deleted_at` + `msi_mode_detected` on entity | ✅ Pass | Both columns added to `MagentoSyncSettings` |
| `sync_magento.view` ACL feature | ✅ Pass | Declared in `acl.ts`; granted to employee+admin in `defaultRoleFeatures`; Step 1.1 |
| `sharp` optional dependency | ✅ Pass | `optionalDependency`; graceful fallback when not installed |
| `p-limit` explicit dependency | ✅ Pass | Listed in Step 1.1 package.json |
| Cross-module product SKU lookup | ✅ Pass | `catalogProductService.findBySku(sku, scope)` implemented in catalog module; `sync_magento` uses it via DI — no raw `em.findOne(CatalogProduct)` |
| Option ID lookup (select attrs) | ✅ Pass | Provisioning cache built after each select/multiselect/configurable attribute; used in product-mapper |
| attribute_code sanitization rules | ✅ Pass | Sanitization function + collision detection documented in Architecture and Step 2.1 |
| Product visibility flags | ✅ Pass | Parent configurable `visibility:4`; child simples `visibility:1`; Step 3.2/3.3 |
| Website assignment | ✅ Pass | `extension_attributes.website_ids` set in Steps 3.2/3.3 from channelStoreMapping |
| SKU sanitization | ✅ Pass | `sanitizeSku` utility in Step 3.2; sanitized SKU stored in SyncExternalIdMapping |
| MSI detection logic | ✅ Pass | `GET /rest/V1/inventory/sources` probe with 404→legacy fallback; Step 4.1 |
| Order configurable item dedup | ✅ Pass | Filter `product_type==='configurable'` items in Step 5.2 |
| Order currency (base vs order) | ✅ Pass | `base_*` amounts used; `order_currency_code` stored as metadata; Step 5.2 |
| SKU fallback lookup in order import | ✅ Pass | Step 5.2: `externalIdMappingService.lookupLocalId` → `catalogProductService.findBySku` fallback; method implemented in catalog module |
| Guest order handling | ✅ Pass | `customer_id=0/null` → create-or-link by email; Step 5.2 |
| Address name field mapping | ✅ Pass | `firstname + ' ' + lastname` → OM `name`; Step 5.2 |
| Root category ID detection | ✅ Pass | `GET /rest/V1/store/storeGroups` probe; Step 2.3 |
| Default attribute set fallback | ✅ Pass | `GET /rest/V1/eav/attribute-sets/list` for "Default" set; Step 2.1 |
| Image format validation | ✅ Pass | MIME check before upload; unsupported formats logged+skipped; Step 3.4 |
| Concurrent sync race condition | ✅ Pass | Inventory push checks externalIdMappingService before push; skips unexported products |

### Non-Compliant Items

All previously blocking items resolved. The following spec-text corrections were applied during the review pass:

| Item | Severity | Status |
|---|---|---|
| `externalIdMappingService` missing `deleteExternalIdMapping` / `deleteExternalIdMappings` | High | ✅ Resolved — methods implemented in `data_sync` (merged 2026-06-28) |
| `catalogProductService.findBySku` not exposed | High | ✅ Resolved — method implemented in catalog module (merged 2026-06-28) |
| `salesOrderService.findByExternalReference` not exposed | High | ✅ Resolved — method implemented in sales module (merged 2026-06-28) |
| `externalId` for `catalog.product` was documented as `entity_id` | High | ✅ Fixed — corrected to sanitized SKU in spec review pass |
| Configurable item filter was inverted | High | ✅ Fixed — corrected to `product_type === 'configurable'` only |
| Command IDs `sales.order.create` / `catalog.product.update` | High | ✅ Fixed — corrected to `sales.orders.create` / `catalog.products.update` |
| `OrderCreateInput` totals used non-existent `total` field | Medium | ✅ Fixed — corrected to `orderTotalsSchema` fields with tax-mode assumption |
| No Undo/rollback contract; duplicate-order hole | Medium | ✅ Resolved — Step 5.3 crash-recovery guard via `salesOrderService.findByExternalReference` (now implemented) |
| Stale `jobId` assertions in Testable sections | Medium | ✅ Fixed — removed in spec review pass |
| "three" child adapters in Proposed Solution | Low | ✅ Fixed — corrected to "four" |
| Image-throughput math (~25 min) inconsistent with performance table | Low | ✅ Fixed — corrected to ~50 min |

### Verdict

**Ready for implementation.** All three cross-module service method gaps are resolved: `deleteExternalIdMapping` / `deleteExternalIdMappings` in `data_sync`, `catalogProductService.findBySku` in catalog, and `salesOrderService.findByExternalReference` in sales. Spec is architecturally sound, all compliance items pass, and no blocking issues remain.

---

## Changelog

### 2026-06-28 (cross-module service gaps resolved)
- Three implementation blockers merged to `open-mercato/open-mercato` main: `deleteExternalIdMapping` / `deleteExternalIdMappings` added to `externalIdMappingService` in `data_sync`; `catalogProductService.findBySku` added to catalog module; `salesOrderService.findByExternalReference` added to sales module
- Data-model section updated: replaced "gap that must be resolved" note with implemented method signatures for `deleteExternalIdMapping` / `deleteExternalIdMappings`
- All `⚠️ PENDING` compliance/consistency rows updated to `✅ Pass`
- Non-Compliant Items table converted to resolved-items record; verdict changed from "Implementation-blocked" to "Ready for implementation"

### 2026-06-05 (spec review pass — low findings)
- L1: "Bundle + 3 children" comment in Component Layout corrected to 4 (Proposed Solution was already fixed; this was the last stale reference)
- L2: Skill path corrected: `.ai/skills/integration-builder/SKILL.md` → `.ai/skills/om-integration-builder/SKILL.md`
- L3: `image_sync_enabled` entity comment reworded — removed reference to out-of-scope `sync_magento_images` child
- L4: Batch-size ambiguity resolved — flow diagram and compliance matrix now clarify "50" is the OM DB fetch page size, distinct from the Magento async-bulk batch size of 150
- Cross-link to `.ai/specs/analysis/ANALYSIS-009-magento2-integration.md` added to Overview section for traceability

### 2026-06-05 (spec review pass)
- Spec review findings resolved: (A1) `externalId` for `catalog.product` corrected to sanitized SKU (was `entity_id` — would have broken all SKU-keyed bulk calls); (A2) configurable item filter corrected to `product_type === 'configurable'` only (inverted filter would have dropped child simples); (A3) command ID `sales.order.create` → `sales.orders.create` (verified against origin/develop); (A4) command ID `catalog.product.update` → `catalog.products.update`; (A5) `OrderCreateInput` totals corrected to actual `orderTotalsSchema` fields (`totalGrossAmount`, `totalNetAmount`, `subtotalNetAmount`, `subtotalGrossAmount`, `shippingNetAmount`, `taxAmount`) with tax-mode assumption documented; (A6/A7) stale `jobId` assertions removed from Testable sections for price-push and inventory-push; (A7) "three" → "four" child adapters; (A8) image-throughput math corrected to ~50 min
- Module isolation fixes: `em.nativeDelete(SyncExternalIdMapping)` replaced throughout with `externalIdMappingService.deleteExternalIdMapping()` (service method to be added); `em.findOne(CatalogProduct)` replaced with `catalogProductService.findBySku()` (catalog module to expose); data-model note updated to document the service gap; compliance rows updated to ⚠️ PENDING for all three cross-module gaps
- Order import atomicity: Step 5.3 crash-recovery pre-check added (`salesOrderService.findByExternalReference` before `sales.orders.create`); duplicate-order risk documented; sales module must expose the method
- Tax/PII: `OrderCreateInput` tax-mode assumption note added; customer PII note added (covered by sales module encryption maps)
- `MagentoPendingPush` ephemeral comment added explaining intentional absence of `updated_at`/`deleted_at`
- Non-Compliant Items table added; verdict updated to reflect three implementation-blocking cross-module service gaps

### 2026-06-05 (official-modules deployment model)
- Official-modules deployment model: module lives in `open-mercato/official-modules` repo (not in the main monorepo); added "Repository & Activation" section with submodule setup, `official-modules.json` activation, and post-activation commands; updated Phase 1 Step 1.1 to use `yarn official-modules add` + `official-modules.json` instead of manual `apps/mercato` edits; anchored component layout and file manifest paths to the official-modules repo root; added official-modules compliance rows to the compliance matrix; noted single-repo PR workflow (no cross-cutting core changes required)
- Phase 7 (Deletion Detection): Step 7.1 — event-driven OM→Magento deletion push (`catalog.product.deleted` subscriber + `magento-product-delete` worker, cleans up all SyncExternalIdMapping rows); Step 7.2 — opt-in daily Magento→OM reconciliation scan (paginated SKU fetch + diff, configurable `deleted_externally_action: log_only|disable_product`); new settings fields `reconciliation_enabled`, `reconciliation_frequency_days`, `deleted_externally_action`; new events `sync_magento.product.deleted` + `sync_magento.product.deleted_externally`; 3 new files in manifest; deletion-not-propagated risk entry
- Strategy 1 clarification: Magento 2.4.3+ global array input limit of 20 items/request on synchronous endpoints — documents why async bulk API is used for products and why dedicated bulk-by-design endpoints (base-prices, source-items) can safely use larger batch sizes
- Added "Out of Scope (Future Phases)" section: customers bidirectional sync, invoices/shipments/credit memos, Adobe Commerce webhooks, multilingual sync, grouped/bundle products, deep MSI inventory management

### 2026-05-29
- Skeleton spec with open questions gate
- Full spec: architecture, data models, adapter flows, attribute class distinction, image dedup, order dedup, store-view header requirement, 6-phase implementation plan, integration test coverage, risks, compliance report
- Patch: `type_id` immutability risk + Step 3.1a delete+recreate handler; `@Unique` constraint on `MagentoSyncSettings`; mutation guard requirement on settings PUT route; validate endpoint returns stock sources; inventory worker fetch-at-execution note
- Implementation gap patch: select attribute option ID cache + lookup; `attribute_code` sanitization rules + collision handling; product `visibility` flags (parent=4, children=1); website assignment; SKU sanitization; MSI detection via `GET /rest/V1/inventory/sources`; configurable order item double-count filter; `base_*` currency for order amounts; SKU fallback in order import; guest order handling; address firstname+lastname→name; root category ID detection; Default attribute set fallback; image format validation (no WebP/AVIF); concurrent sync race condition guard; 3 new risk entries
- Second pre-implement patch: `jobId` not in queue EnqueueOptions → debounce via `sync_magento_pending_push` DB accumulator (FOR UPDATE SKIP LOCKED); `externalIdMappingService` actual API corrected (`lookupLocalId`/`lookupExternalId`/`storeExternalIdMapping`; no delete — raw `em.nativeDelete` for type_id mismatch); service is in `data_sync`, not `integrations`; `sales.order.create` confirmed no-quote; credentials injected by engine (not resolved in adapter); `sync_magento_pending_push` entity added to data models; flow diagrams updated
- Pre-implement patch: all 4 adapters now implement required `getMapping()`; `ExportBatch`/`ImportBatch` contracts aligned; `SyncExternalIdMapping` field names corrected (`internalEntityType`/`internalEntityId`/`integrationId`) throughout; `externalIdMappingService` via DI for all lookups; `POST /api/data_sync/run` full schema + entityType registry; debounce replaced with BullMQ `jobId` pattern; subscriber field-change detection removed; `OrderCreateInput` mapping table added; async bulk polling replaced with re-enqueue `magento-bulk-poll` pattern; `deleted_at`+`msi_mode_detected` on entity; `sync_magento.view` ACL feature; `sharp` as optionalDependency with fallback; `p-limit` explicit dep; `productRepository.findBySku` → `em.findOne`; proposed solution diagram updated to 4 children
- Fast price+stock path: 4th child `sync_magento_prices`; bulk price APIs (`/products/base-prices`, `/products/special-prices`, `/special-prices-delete`); event-driven debounced batcher for prices and stock (30s window, 100/500 item flush cap); operates only on `SyncExternalIdMapping` known SKUs — no existence check; Phase 3.6 implementation steps; 2 new risk entries (price before export, debounce lag); performance table updated
- Performance + attribute prefix patch: Async Bulk API for product data; parallel image upload with p-limit; image resize via `sharp`; decoupled image sync phase (`image_sync_enabled`); attribute prefix made optional (empty string allowed); per-field `attribute_code_overrides` mapping; Performance Considerations section; new settings fields; async bulk unavailable risk; updated first-run duration estimate
