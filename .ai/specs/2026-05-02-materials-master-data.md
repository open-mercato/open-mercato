# Materials Master Data — Phase 1

> **Status:** Ready for implementation. Author: agent. Date: 2026-05-02.
> Reference module: `packages/core/src/modules/customers` (CRUD pattern source).
> Roadmap position: SPEC #1 in the ERP track. Unblocks `inventory`, `procurement`, `production`, `quality`.

## TLDR

**Key Points:**
- New `materials` core module holding **ERP-grade material master data** distinct from `catalog.product` (which is sales-oriented).
- A `Material` is the root identifier for anything that can be **stocked, purchased, produced, or consumed** — including non-saleable items (raw materials, semi-finished goods, tools, indirect/MRO supplies).
- Phase 1 delivers the minimum required to unblock the next two specs in the ERP roadmap: `inventory` and `procurement`. PIM-style attributes, CAD/drawing links, and ABC analysis are explicitly out of scope and tracked for Phase 2/3.
- `Material` is linked to `catalog.product` via a separate extension entity (FK ID, no ORM relationship), per AGENTS.md cross-module rules. Each module remains independently usable.
- Multi-supplier per material with per-supplier pricing (currency-aware, validity-bounded, no quantity bands in Phase 1), MOQ, lead time, supplier-side SKU, preferred flag — modelled as `MaterialSupplierLink` referencing `customers.companies` (role-tagged).
- Multi-unit handling per material (purchase / stock / sales / production) with explicit conversions to a per-material base unit. Independent of `catalog.CatalogProductUnitConversion` for Phase 1; consolidation into a platform `units` module deferred to Phase 2.

**Scope (Phase 1):**
- `Material` (master, common fields only) + `MaterialSalesProfile` (1:1 optional, holds sales-only data) + `MaterialUnit` + `MaterialSupplierLink` + `MaterialPrice` + `MaterialLifecycleEvent` entities
- `MaterialCatalogProductLink` extension entity declared from `materials/data/extensions.ts`
- Lifecycle states (`draft` | `active` | `phase_out` | `obsolete`) + optional successor pointer (`replacement_material_id`)
- Capability flags on `Material`: `isPurchasable`, `isSellable`, `isStockable`, `isProducible` — materialized invariant; `isSellable` is mirrored from `MaterialSalesProfile` row existence via subscriber
- Sales-only attributes (`gtin`, `commodity_code`) live on `MaterialSalesProfile` — keeps `materials` master sparse-free for non-sellable kinds (raw, tools, indirect)
- Future capabilities (purchase/stock/production-specific data) follow the same `material_<capability>_profiles` convention; their tables are deferred to Phase 2 because Phase 1 has no fields to put in them
- ACL features, typed events, search config, custom fields registration, OpenAPI exports
- CRUD API + backend list/create/detail pages following the `customers` reference pattern
- Widget injection from `materials` into `catalog` product detail (linked material panel) and from `materials` into `customers.company` detail (supplied materials panel)

**Out of scope (deferred to Phase 2 or later specs):**
- `MaterialFeatureData` / `MaterialFeatureGroup` (PIM-style attributes) → Phase 2
- `MaterialLongText` per-audience descriptions → Phase 2
- `MaterialStat` / ABC analysis / slow-mover detection → Phase 2
- `MaterialDrawing` / `MaterialCadMapping` / CAD sync → Phase 3
- `MaterialInspectionPlan` (depends on `quality` module — not yet built)
- `MaterialProvidedMaterial` (customer-supplied material) → Phase 3
- Kits / `MaterialSet` → covered by `production.bom` spec

**Concerns addressed:**
- Material/Product boundary fixed via Q1=A: two parallel root entities, optional bidirectional link.
- UoM duplication accepted in Phase 1 (Q2=A); consolidation tracked as Phase 2.
- Supplier role expressed via existing `customers.CustomerEntityRole` (Q3=A) — no new partner entity.
- Material code uniqueness scoped per organization (Q4); GTIN optional secondary identifier (lives on sales profile).
- Sparse fields avoided via Class Table Inheritance: sales-only attributes (gtin, commodity_code) live on `MaterialSalesProfile` (1:1, optional) — same pattern as `customers` (`CustomerEntity` + `CustomerPersonProfile`/`CustomerCompanyProfile`).
- FX volatility for `MaterialPrice` mitigated by storing both original and cached base-currency amounts (Q6=A).

## Overview

ERP master data starts with **what is the thing**. In e-commerce-only platforms this collapses into a single "product" concept, but as soon as you need procurement, inventory, BoM, or production scheduling, the e-commerce product model breaks down:

- A **raw material** has no SKU on a storefront, no SEO description, no variant matrix — but it has a CN code, multiple suppliers, a stock unit (kg) different from its purchase unit (paleta), and a lead time.
- A **semi-finished good** is consumed by production and produced by another production order — it never appears in `catalog`.
- A **tool** is allocated to work centers, not stocked for sale.
- An **indirect/MRO supply** (cleaning agents, lubricants) is purchased but never sold or BoM'd.

open-mercato today has `catalog.product` (sales-oriented: variants, channel-scoped pricing, offers, categories, SEO-relevant fields). Building `inventory` directly on top of `catalog.product` would force the sales model onto every operational record — the same trap fromee/ERPbos consciously avoid by separating `Material` (or `Item`) from sales.

The `materials` module establishes the master record. It is independent: an instance of open-mercato running for a contract manufacturer (no online store) can use `materials` + `inventory` + `procurement` + `production` and never enable `catalog`. An instance running a pure storefront keeps `catalog` and never enables `materials`. A full ERP+commerce instance enables both, with `Material ↔ Product` link materialized as an extension entity.

> **Market reference**: SAP's distinction between `Material Master` and any sales/marketing layer; Microsoft Dynamics 365 keeps "Released Product" as a per-LE projection over a global "Product"; Odoo's `product.template` vs `product.product`. Phase 1 stays much simpler: the master only.

## Problem Statement

Every downstream ERP spec in the roadmap (`inventory`, `procurement`, `production`, `quality`) needs the same thing: an answer to "what is the thing we are stocking / buying / building / inspecting", with metadata that `catalog.product` does not and should not carry. Without `materials`:

- `inventory.stock_balance` would have to FK to `catalog_products` — forcing every stocked item to be a saleable product.
- `procurement.purchase_order_line` would have to invent its own supplier-pricing structure.
- `production.bom_line` would have to FK to `catalog_products` — forcing raw materials and semi-finished goods to be modeled as products.
- `quality.inspection_plan` would have to attach to products — wrong semantic for inspecting incoming raw material lots.

This blocks four specs. Building Phase 1 unblocks all of them.

## Proposed Solution

### Module Layout

Create `packages/core/src/modules/materials/` mirroring `packages/core/src/modules/customers/` exactly:

```
packages/core/src/modules/materials/
├── AGENTS.md                # Module-specific rules
├── README.md
├── index.ts                 # Module metadata
├── acl.ts                   # Feature definitions
├── ce.ts                    # Custom-fields-extensible entities
├── di.ts                    # Awilix registrations
├── events.ts                # Typed event declarations (createModuleEvents)
├── search.ts                # Search config (fulltext + vector)
├── setup.ts                 # Tenant init + defaultRoleFeatures + seed kinds
├── translations.ts          # Translatable fields (name, description)
├── api/
│   ├── openapi.ts
│   ├── materials/route.ts          # CRUD via makeCrudRoute
│   ├── materials/[id]/route.ts
│   ├── materials/[id]/lifecycle/route.ts
│   ├── materials/[id]/sales-profile/route.ts  # GET/PUT/DELETE single 1:1 profile
│   ├── material-suppliers/route.ts
│   ├── material-suppliers/[id]/route.ts
│   ├── material-prices/route.ts
│   ├── material-prices/[id]/route.ts
│   ├── material-units/route.ts
│   └── material-units/[id]/route.ts
├── backend/
│   └── materials/
│       ├── page.tsx                # List
│       ├── create/page.tsx         # Create
│       └── [id]/page.tsx           # Detail (tabs: suppliers, prices, units)
├── commands/                       # Undoable commands (per customers pattern)
│   ├── material.ts
│   ├── material-sales-profile.ts   # Upsert/delete 1:1 sales profile
│   ├── material-supplier.ts
│   ├── material-price.ts
│   ├── material-unit.ts
│   └── material-lifecycle.ts
├── subscribers/
│   ├── recompute-base-currency.ts  # FX cache refresh (Step 8)
│   └── sync-sales-capability.ts    # Toggle Material.is_sellable when sales profile created/deleted
├── data/
│   ├── entities.ts
│   ├── validators.ts
│   ├── enrichers.ts                # Optional: enrich catalog.product responses with linked material
│   └── extensions.ts               # MaterialCatalogProductLink, MaterialSupplierCompanyLink declarations
├── widgets/
│   ├── injection-table.ts
│   └── injection/
│       ├── catalog-product-detail.linked-material.tsx
│       └── customer-company-detail.supplied-materials.tsx
├── migrations/                     # Generated by yarn db:generate
└── seed/
    └── kinds.ts                    # Seed material kinds dictionary
```

Cross-module integration is exclusively via FK IDs — no MikroORM relationships across module boundaries (per AGENTS.md Architecture rules).

### Decisions Locked

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | Material and Product are independent root entities; bidirectional optional link via `MaterialCatalogProductLink` extension entity | Allows `materials`-only and `catalog`-only deployments without dead code |
| Q2 | `MaterialUnit` table per material; `catalog.CatalogProductUnitConversion` left untouched | Avoids breaking change to existing catalog data; consolidation tracked as Phase 2 spec |
| Q3 | Supplier = `customers.CustomerCompanyProfile` with `CustomerEntityRole` tagged `'supplier'`; `MaterialSupplierLink.supplier_company_id` is FK ID only | No duplicate counterparty registry; CRM and ERP share the same company records |
| Q4 | `Material.code` unique per `organization_id`; free-form string ≤ 64 chars; optional `gtin` lives on `MaterialSalesProfile` (also unique per org when present, only meaningful for sellable items); auto-sequence not in Phase 1 | Most ERP systems work this way; sequence generator can be added later via `SalesDocumentSequence` pattern |
| Q5 | No quantity bands in Phase 1; `valid_from`/`valid_to` supported; `currency_id` per price; `MaterialSupplierLink.preferred` flag (max one true per material) | Bands deferred — additive change later. Validity + currency essential for any real procurement. |
| Q6 | Store both original price and cached base-currency amount on `MaterialPrice`; subscriber to `currencies.exchange_rate.updated` recomputes cache | Fast reads, transparent FX history, single conversion algorithm |
| Q7 | Lifecycle changes emit `materials.material.lifecycle_changed`; no in-module guards | Downstream modules (`procurement`, `production`) own their own enforcement rules |
| Q8 | Platform `translations` module via `translations.ts` for `name`/`description`; nothing custom in Phase 1 | Reuse, no duplication |
| Q9 | `commodityCode` nullable string field on `Material`; format validation deferred to PL providers | Cheap to add now, expensive to migrate later |
| Q10 | Kits not modelled in Phase 1 | Belongs to `production.bom` spec |

## Data Model

All entities carry `id` (uuid PK), `organization_id` (uuid FK, indexed), `tenant_id` (uuid FK, indexed), `created_at`, `updated_at`, `deleted_at`, `is_active` per platform conventions.

### `materials` (table: `materials`)
Master entity. Holds only fields common to every material kind (Class Table Inheritance pattern, master row).

| Column | Type | Notes |
|--------|------|-------|
| `code` | varchar(64) | unique per `organization_id` (partial unique index where `deleted_at IS NULL`) |
| `name` | varchar(255) | required, translatable |
| `description` | text | nullable, translatable |
| `kind` | enum: `raw`, `semi`, `final`, `tool`, `indirect` | required (discriminator-tag — does not generate child tables) |
| `lifecycle_state` | enum: `draft`, `active`, `phase_out`, `obsolete` | default `draft` |
| `replacement_material_id` | uuid FK → `materials.id` | nullable; only meaningful when `lifecycle_state = 'obsolete'` |
| `base_unit_id` | uuid FK → `material_units.id` | nullable until first unit created (chicken/egg resolved by validator) |
| `is_purchasable` | boolean | default `true` (capability flag — Phase 1 has no `material_purchase_profiles`; flag is independently settable) |
| `is_sellable` | boolean | default `false` (capability flag — **materialized**: subscriber sets it to `true` when `MaterialSalesProfile` exists for this material, `false` when removed) |
| `is_stockable` | boolean | default `true` (capability flag — Phase 1 has no `material_stock_profiles`) |
| `is_producible` | boolean | default `false` (capability flag — Phase 1 has no `material_production_profiles`) |

Indexes: `(organization_id, kind)`, `(organization_id, lifecycle_state)`, `(organization_id, code) WHERE deleted_at IS NULL` (unique). The unique index on `gtin` moves to `material_sales_profiles`.

> **Capability flags as materialized invariant:** `is_purchasable`, `is_stockable`, `is_producible` are user-settable in Phase 1 (no profile tables exist for those capabilities yet). `is_sellable` is **derived** from `MaterialSalesProfile` row existence — direct PUT to `is_sellable` is rejected; toggle by creating/deleting the sales profile via `/api/materials/[id]/sales-profile`. This is enforced by validator on `Material` update and by subscriber `subscribers/sync-sales-capability.ts` on sales profile lifecycle events. Phase 2 will analogously derive the other three flags when their profile tables ship.

### `material_sales_profiles` (table: `material_sales_profiles`)
Optional 1:1 child of `Material`. Existence of a row means the material is sellable. Holds fields that apply only to sellable items — keeps `materials` master sparse-free for raw, tools, indirect, and other non-sellable kinds.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | standard |
| `organization_id`, `tenant_id` | uuid | standard scoping (denormalized from material for tenant isolation in queries) |
| `material_id` | uuid FK → `materials.id` | required, **unique** (1:1) |
| `gtin` | varchar(20) | nullable; unique per org when present |
| `commodity_code` | varchar(20) | nullable; CN/HS code for Intrastat |
| standard timestamps + soft-delete | — | `created_at`, `updated_at`, `deleted_at`, `is_active` |

Indexes: `(material_id)` unique, `(organization_id, gtin) WHERE gtin IS NOT NULL AND deleted_at IS NULL` (unique).

> **Phase 2 expansion target:** future sales-only fields (e.g., `vat_class`, `country_of_origin`, `intrastat_extra_code`, `listed_for_export`) ship as additive columns on this table — no impact on `materials` master.

### `material_units` (table: `material_units`)
| Column | Type | Notes |
|--------|------|-------|
| `material_id` | uuid FK → `materials.id` | required, cascade-soft-delete |
| `code` | varchar(16) | e.g., `KG`, `PCS`, `PALLET` |
| `label` | varchar(64) | translatable display name |
| `usage` | enum: `stock`, `purchase`, `sales`, `production` | required |
| `factor` | numeric(18,6) | multiplier from this unit → material's base unit; `1.0` for the base unit |
| `is_base` | boolean | exactly one true per material; check constraint |
| `is_default_for_usage` | boolean | unique per `(material_id, usage)` when true |

Indexes: `(material_id, usage)`, `(material_id, code)` unique.

### `material_supplier_links` (table: `material_supplier_links`)
| Column | Type | Notes |
|--------|------|-------|
| `material_id` | uuid FK → `materials.id` | required |
| `supplier_company_id` | uuid | FK ID only — points to `customer_companies.id` (no ORM relationship; verified at validator level) |
| `supplier_sku` | varchar(64) | nullable; supplier's catalog code for this material |
| `min_order_qty` | numeric(18,6) | nullable |
| `lead_time_days` | integer | nullable |
| `preferred` | boolean | default `false`; partial unique `(material_id) WHERE preferred = true` |
| `notes` | text | nullable |

Indexes: `(material_id)`, `(supplier_company_id)`, partial unique on preferred.

### `material_prices` (table: `material_prices`)
| Column | Type | Notes |
|--------|------|-------|
| `material_supplier_link_id` | uuid FK → `material_supplier_links.id` | required |
| `price_amount` | numeric(18,6) | original supplier price |
| `currency_id` | uuid | FK ID → `currencies.currency.id` |
| `base_currency_amount` | numeric(18,6) | nullable; cached conversion to tenant base |
| `base_currency_at` | timestamptz | nullable; timestamp of cache compute |
| `valid_from` | date | nullable |
| `valid_to` | date | nullable; check `valid_to >= valid_from` |

Indexes: `(material_supplier_link_id, valid_from)`, `(currency_id)`.

### `material_lifecycle_events` (table: `material_lifecycle_events`)
| Column | Type | Notes |
|--------|------|-------|
| `material_id` | uuid FK → `materials.id` | required |
| `from_state` | enum (same as material) | required |
| `to_state` | enum | required |
| `changed_by_user_id` | uuid | FK ID → `auth.users.id` |
| `reason` | text | nullable |
| `changed_at` | timestamptz | required |

Append-only (no update/delete). Index: `(material_id, changed_at DESC)`.

### `material_catalog_product_links` (table: `material_catalog_product_links`) — declared from `materials/data/extensions.ts`
| Column | Type | Notes |
|--------|------|-------|
| `material_id` | uuid | FK ID → `materials.id`; unique (1:1) |
| `catalog_product_id` | uuid | FK ID → `catalog_products.id`; unique (1:1) |

Validator guarantees both records exist in the same `organization_id`. Soft-delete supported.

## API Contracts

All routes follow `makeCrudRoute` with `indexer: { entityType }`. All write operations go through Command pattern with undo support (per customers reference). Every route exports `openApi`. Custom field hooks wired via `collectCustomFieldValues()`.

| Method | Path | Purpose | Required feature |
|--------|------|---------|------------------|
| GET | `/api/materials` | List with filters (`kind`, `lifecycle_state`, `is_*`, `supplier_company_id`, `q` text search, `ids=` narrowing) | `materials.material.view` |
| POST | `/api/materials` | Create | `materials.material.manage` |
| GET | `/api/materials/[id]` | Read (custom fields normalized via `normalizeCustomFieldResponse`) | `materials.material.view` |
| PUT | `/api/materials/[id]` | Update | `materials.material.manage` |
| DELETE | `/api/materials/[id]` | Soft delete | `materials.material.manage` |
| POST | `/api/materials/[id]/lifecycle` | Transition lifecycle state (body: `to_state`, `reason?`, `replacement_material_id?`) | `materials.material.manage` |
| GET | `/api/materials/[id]/sales-profile` | Read sales profile if exists (returns `404` when none — caller renders "Not listed for sales" empty state) | `materials.material.view` |
| PUT | `/api/materials/[id]/sales-profile` | Upsert sales profile (body: `gtin?`, `commodityCode?`). Creating row marks material `is_sellable=true` via subscriber. | `materials.material.manage` |
| DELETE | `/api/materials/[id]/sales-profile` | Soft-delete sales profile. Subscriber sets `is_sellable=false`. | `materials.material.manage` |
| GET/POST | `/api/material-units` | List/create units (filter by `material_id`) | `materials.units.view`/`materials.units.manage` |
| GET/PUT/DELETE | `/api/material-units/[id]` | Unit ops | as above |
| GET/POST | `/api/material-suppliers` | List/create supplier links | `materials.supplier_link.view`/`.manage` |
| GET/PUT/DELETE | `/api/material-suppliers/[id]` | Supplier link ops | as above |
| GET/POST | `/api/material-prices` | List/create prices (filter by `material_supplier_link_id`, `effective_at`) | `materials.price.view`/`.manage` |
| GET/PUT/DELETE | `/api/material-prices/[id]` | Price ops | as above |

OpenAPI shapes derived from zod schemas in `data/validators.ts` via `z.infer<>` per project convention.

## Events

Declared in `events.ts` via `createModuleEvents()` with `as const`:

| Event ID | Payload | Persistent | Client broadcast |
|----------|---------|-----------|------------------|
| `materials.material.created` | `{ id, code, kind, organizationId, tenantId }` | yes | yes |
| `materials.material.updated` | `{ id, before, after, organizationId, tenantId }` | yes | yes |
| `materials.material.deleted` | `{ id, code, organizationId, tenantId }` | yes | yes |
| `materials.material.lifecycle_changed` | `{ id, fromState, toState, replacementMaterialId?, reason?, organizationId }` | yes | yes |
| `materials.sales_profile.created` | `{ id, materialId, gtin?, commodityCode?, organizationId, tenantId }` | yes | yes |
| `materials.sales_profile.updated` | `{ id, materialId, before, after, organizationId, tenantId }` | yes | yes |
| `materials.sales_profile.deleted` | `{ id, materialId, organizationId, tenantId }` | yes | yes |
| `materials.supplier_link.created` | `{ id, materialId, supplierCompanyId, organizationId }` | yes | yes |
| `materials.supplier_link.updated` | `{ id, before, after, organizationId }` | yes | yes |
| `materials.supplier_link.removed` | `{ id, materialId, supplierCompanyId, organizationId }` | yes | yes |
| `materials.price.created` | `{ id, materialSupplierLinkId, amount, currencyId, validFrom, validTo, organizationId }` | yes | yes |
| `materials.price.updated` | `{ id, before, after, organizationId }` | yes | yes |
| `materials.price.fx_recalculated` | `{ id, baseCurrencyAmount, baseCurrencyAt, organizationId }` | no | no |
| `materials.price.expired` | `{ id, materialSupplierLinkId, validTo, organizationId }` | yes | yes |

Subscribers in Phase 1:
- `subscribers/recompute-base-currency.ts` — listens to `currencies.exchange_rate.updated`, recomputes `base_currency_amount` for affected materials, emits `materials.price.fx_recalculated`.
- `subscribers/sync-sales-capability.ts` — listens to `materials.sales_profile.created`/`materials.sales_profile.deleted`. Toggles `Material.is_sellable` accordingly, ensuring the materialized capability flag stays consistent with the sales profile row's existence. Idempotent: if flag already matches, no UPDATE is issued.

Worker in Phase 1:
- `workers/expire-prices.ts` (queue: `materials.price-expiry`, idempotent, scheduled daily) — finds prices where `valid_to < now()`, emits `materials.price.expired`. Uses existing `queue` package contract.

## ACL Features

Declared in `acl.ts`:

```
materials.material.view
materials.material.manage              # includes lifecycle transitions
materials.units.view
materials.units.manage
materials.supplier_link.view
materials.supplier_link.manage
materials.price.view
materials.price.manage
materials.settings.manage
materials.widgets.linked-material        # for catalog.product sidebar injection
materials.widgets.supplied-materials     # for customers.company tabs injection
```

`setup.ts` declares `defaultRoleFeatures` mapping to platform-seeded roles only (`superadmin`, `admin`, `employee` — verified in `auth/cli.ts:419`):
- `admin`: `materials.*` (full access via wildcard grant)
- `employee`: `materials.material.view`, `materials.material.manage`, `materials.units.*`, `materials.supplier_link.*`, `materials.price.*`, `materials.widgets.*` (operational access without `materials.settings.manage`)

ERP-specific roles (`procurement`, `production_planner`, `sales`) and their feature mappings are deferred to a separate `auth-erp-roles` spec that will extend `auth/setup.ts` to seed those roles. Until that ships, tenants can grant materials features to custom roles via the standard role/permission UI.

Customer portal: no portal access in Phase 1.

## Custom Fields

`Material` is registered as custom-fields-extensible in `ce.ts` under `entityId: 'materials:material'`. Default custom fields shipped:
- `internal_notes` (text, internal-only) — for production team annotations
- `safety_data_sheet_url` (string) — link to MSDS

Both are nullable and additive. Existing tenants must run `yarn mercato entities install` to receive them — verified as part of Step 14 (setup defaults).

## Search Configuration

`search.ts` follows the `customers/search.ts:1-100` pattern. Concrete shape:

```ts
const MATERIAL_ENTITY_FIELDS = [
  'id', 'code', 'name', 'description', 'kind',
  'lifecycle_state',
  'is_purchasable', 'is_sellable', 'is_stockable', 'is_producible',
  'organization_id', 'tenant_id', 'created_at', 'updated_at',
] as const

// Sales-only columns (gtin, commodity_code) join from material_sales_profiles via material_id.
const MATERIAL_SALES_FIELDS = ['gtin', 'commodity_code'] as const

const MATERIAL_CUSTOM_FIELD_SOURCES: QueryCustomFieldSource[] = [
  { entityId: 'materials:material', table: 'materials', alias: 'material', joinOn: 'material.id' },
]

export const searchConfig: SearchModuleConfig = {
  entities: [{
    entityId: 'materials:material',
    fieldPolicy: {
      fulltext: ['code', 'name', 'description'],
      keyword: ['kind', 'lifecycle_state', 'gtin', 'commodity_code'],
    },
    queryFields: MATERIAL_ENTITY_FIELDS,
    customFieldSources: MATERIAL_CUSTOM_FIELD_SOURCES,
    // Indexer composes the search document from materials + LEFT JOIN material_sales_profiles
    // so gtin/commodity_code remain searchable as keywords without polluting the master row.
    buildSource: async (ctx) => { /* vector embedding — see strategy below */ },
    formatResult: (row) => ({
      title: `${row.code} — ${row.name}`,
      subtitle: `${row.kind} · ${row.lifecycle_state}`,
      href: `/backend/materials/${row.id}`,
    }),
  }],
}
```

**Vector embedding strategy:** `buildSource` is implemented only when a `vectorService` resolves from DI at boot. If not registered, the entity falls back to fulltext-only (matching `customers/search.ts` behavior). Vector model selection and key configuration are platform concerns, not specified in this spec. Embedding source: `${code}\n${name}\n${description}\n${salesProfile?.commodity_code ?? ''}` (sales profile loaded via LEFT JOIN; absent for non-sellable materials).

**Indexed columns** for fulltext: `materials.code`, `materials.name`, `materials.description`, plus `material_sales_profiles.gtin`/`commodity_code` (LEFT JOIN on `material_id`) and `material_supplier_links.supplier_sku` joined via materials-to-supplier-links query alias.

## Widget Injection

Two injection widgets in `widgets/injection/`. Both target newly-registered spots (registered as part of Step 13 in their host modules):

1. **`catalog-product-sidebar.linked-material`** — targets `page:catalog.product.sidebar` (new spot, registered in `catalog/widgets/injection-table.ts`). Shows linked material code/name/kind with "Open material" CTA. Reads via `MaterialCatalogProductLink`.
2. **`customer-company-tabs.supplied-materials`** — targets `page:customers.company.tabs` (new spot, registered in `customers/widgets/injection-table.ts` — file does not exist today and is created in Phase 1). Shows materials supplied by this company with preferred-flag indicator and active price count. Reads via `MaterialSupplierLink` filtered by `supplier_company_id`.

Materials' own `widgets/injection-table.ts` maps these widgets to the target spot IDs. Both new spots are additive — adding a spot is BC-safe per surface #6 (FROZEN spots cannot be renamed/removed; new spots may be introduced freely). Visibility gated via wildcard-aware `hasFeature` from `@open-mercato/shared` on `materials.widgets.linked-material` / `materials.widgets.supplied-materials`. No component overrides in Phase 1.

## Cross-Module Integration

| Other module | Integration | Direction |
|--------------|-------------|-----------|
| `catalog` | `MaterialCatalogProductLink` extension entity | bidirectional FK ID; widget injection materials → catalog |
| `customers` | `MaterialSupplierLink.supplier_company_id` FK ID; widget injection materials → customers | one-way FK; bidirectional UI |
| `currencies` | `MaterialPrice.currency_id` FK ID; subscriber to FX updates | one-way dependency on currencies |
| `auth` | `MaterialLifecycleEvent.changed_by_user_id` FK ID | one-way FK |
| `entities` (custom fields) | `material` registered in `ce.ts` | platform |
| `translations` | declared in `translations.ts` under `entityId: 'materials:material'` for `name` and `description` fields | platform |

No MikroORM relations cross module boundaries.

## Risks & Impact Review

### Backward Compatibility (per BACKWARD_COMPATIBILITY.md)

| Surface | Impact | Action |
|---------|--------|--------|
| Auto-discovery file conventions (FROZEN) | none — only adding new module-internal files following the standard | OK |
| Type definitions (STABLE) | none — new types only | OK |
| Function signatures (STABLE) | none — no platform fn changes | OK |
| Import paths (STABLE) | new public exports under `@open-mercato/core/modules/materials/...` | OK |
| Event IDs (FROZEN) | new IDs only (`materials.*`); no existing rename | OK |
| Widget injection spot IDs (FROZEN) | adds two new spots — `page:catalog.product.sidebar` (via `catalog/widgets/injection-table.ts`) and `page:customers.company.tabs` (via newly-created `customers/widgets/injection-table.ts`). Adding spots is allowed by surface #6; no rename/removal of existing spots | OK |
| API route URLs (STABLE) | new `/api/materials*` routes only | OK |
| Database schema (ADDITIVE-ONLY) | seven new tables (`materials`, `material_sales_profiles`, `material_units`, `material_supplier_links`, `material_prices`, `material_lifecycle_events`, `material_catalog_product_links`); no column/table rename or removal | OK |
| DI service names (STABLE) | new `materialService`, `materialPriceFxRecomputer` | OK |
| ACL feature IDs (FROZEN) | new IDs only | OK |
| Notification type IDs (FROZEN) | none in Phase 1 | OK |
| CLI commands (STABLE) | none | OK |
| Generated file contracts (STABLE) | new `BootstrapData.materials` field — additive | OK |

### Concrete Failure Scenarios

| Scenario | Severity | Mitigation | Residual risk |
|----------|----------|------------|---------------|
| User creates Material with `is_sellable=true` then later links it to a Catalog Product in a different organization | High | Validator on `MaterialCatalogProductLink` rejects cross-org links | Low (UI cannot present the option; API returns 422) |
| FX recompute subscriber lags behind a critical pricing decision in `procurement` | Medium | `procurement` reads `MaterialPrice.price_amount + currency_id` and converts on the fly; cached `base_currency_amount` is a hint, not source of truth | Low |
| Lifecycle changed to `obsolete` but downstream `procurement` already has open POs | Medium | Phase 1 emits `materials.material.lifecycle_changed`; `procurement` (when built) subscribes and flags affected POs. Phase 1 itself does not block. | Accepted — `procurement` spec must address |
| Soft-delete of a Material referenced by future `inventory.stock_balance` | High | Domain rule: cannot soft-delete when active references exist. Phase 1 enforces no-existing-supplier-links and no-existing-prices; future modules add their own checks via subscriber to `materials.material.deleted` (cancel-on-veto pattern is out of scope; deletion proceeds and downstream cleans up) | Low for Phase 1 (no downstream consumers yet) |
| Multiple `MaterialSupplierLink.preferred = true` for one material | Medium | Partial unique index `WHERE preferred = true`; validator ensures atomic toggle | None |
| `Material.is_sellable` toggled directly via PUT /api/materials/[id], drifts from `MaterialSalesProfile` existence | Medium | Validator on Material update rejects direct changes to `is_sellable`; toggle only via `/sales-profile` endpoint. Subscriber `sync-sales-capability.ts` re-syncs flag on every sales profile event for defense-in-depth | None |
| `MaterialSalesProfile` row exists for two materials in same org with same `gtin` | Low | Partial unique index `(organization_id, gtin) WHERE gtin IS NOT NULL AND deleted_at IS NULL` on `material_sales_profiles` | None |
| Custom field migration drift (existing tenant misses new defaults) | Low | `ce.ts` declares defaults; `yarn mercato entities install` reconciles | None |
| `MaterialPrice` with `valid_from > valid_to` | Low | zod schema check; DB check constraint | None |
| Race in lifecycle transition (two concurrent state changes) | Low | Optimistic concurrency on `material.updated_at`; rejected duplicate emits no event | None |

### Performance

- All list queries paginated (`pageSize ≤ 100` per AGENTS.md).
- Indexes cover all filter combinations declared in API.
- FX recompute is batched per currency with idempotent worker; concurrent runs deduped via job key.

### Security

- All endpoints scoped by `organization_id` from request context (`withScopedPayload`).
- ACL features applied via declarative page metadata (`requireFeatures`, never `requireRoles`).
- Input validation via zod; no raw SQL.
- No encrypted fields in Phase 1 (suppliers and prices are not GDPR-personal).

## Implementation Plan

Each step ends in a working state with tests passing. Steps are numbered and tracked in the Progress checklist below.

### Lessons & Constraints (apply to every step)

These constraints derive from `.ai/lessons.md` and AGENTS.md and apply to all command/entity/widget code in this module. Treat them as MUST rules during code review:

- **UUIDs at create time** (`.ai/lessons.md` "MikroORM 6 does NOT generate UUIDs client-side"): When creating a parent entity (`Material`) and immediately referencing its `id` for child entities (`MaterialUnit`, `MaterialSupplierLink`, `MaterialPrice`) before flush, generate the UUID with `crypto.randomUUID()` and pass `id` explicitly to `em.create()`. Otherwise `entity.id` is `undefined` until `em.flush()` runs the INSERT.
- **Forked EntityManager in `buildLog()`** (`.ai/lessons.md` "Avoid identity-map stale snapshots"): Always load `snapshotAfter` via a forked EM (or `em.refresh(entity)`). Reusing the prepare-time EM returns identity-map cached entities and produces identical before/after audit logs.
- **Centralized undo helpers** (`.ai/lessons.md` "We've got centralized helpers for extracting `UndoPayload`"): Use `extractUndoPayload<T>` and `UndoPayload` from `@open-mercato/shared/lib/commands/undo`. Do not duplicate or re-implement.
- **Cross-module FK validation**: Use `findOneWithDecryption(em, Entity, { id }, undefined, { tenantId, organizationId })` from `@open-mercato/shared/lib/encryption/find` — never raw `em.findOne`. Applies to Step 7 (`supplier_company_id` → `customer_companies`) and Step 13 (`catalog_product_id` → `catalog_products`). Throw `NotFoundException` on miss; never reveal cross-org records.
- **Wildcard-aware permission matching** (`.ai/lessons.md` "Feature-gated runtime helpers must use wildcard-aware permission matching"): Widget visibility (Step 13) and any feature-gated runtime helper must use `hasFeature` / `hasAllFeatures` from `@open-mercato/shared` — never `array.includes` or `Set.has`. Wildcard grants like `materials.*` are stored in DB and must match.
- **Soft-delete cascade**: When `Material` is soft-deleted, also soft-delete its `material_units`, `material_supplier_links`, `material_prices` rows. Implement via the delete command — not via DB cascade — so events fire and audit is preserved.
- **Partial unique indexes**: For `materials.code` (in master) and `material_sales_profiles.gtin` (in sales profile), declare partial unique indexes via raw `@Index({ expression: 'create unique index "<name>" on "<table>" ("<col>") where "deleted_at" is null' })`. MikroORM v7 has no DSL helper for partial indexes. Reference: `customers/data/entities.ts:211`.
- **`flush` before relation syncs** (`.ai/lessons.md` "Flush entity updates before running relation syncs that query"): If an update command mutates scalar fields and then runs queries that touch related rows (e.g., toggling `MaterialSupplierLink.preferred` and rebalancing siblings), call `em.flush()` between the mutation and the sync queries.

### Phase 1 Steps

1. **Module scaffold** — folder structure, `index.ts` metadata, empty `di.ts`, `acl.ts` with feature definitions, `setup.ts` skeleton with `defaultRoleFeatures`. Verify auto-discovery picks the module up. Run `yarn generate`. Run `yarn mercato configs cache structural --all-tenants`.
2. **Material entity + migration + validators** — `data/entities.ts` with `Material` (master, no sales-only fields), `data/validators.ts` with zod schemas (validator on Material update rejects direct `is_sellable` mutation — must go via `/sales-profile` endpoint). `yarn db:generate`. Manual review of generated migration for indexes/constraints.
3. **Material CRUD API** — `api/materials/route.ts` and `[id]/route.ts` via `makeCrudRoute`, `openApi` exports, custom field hooks via `collectCustomFieldValues`, query engine integration (`indexer: { entityType: 'material' }`). Unit tests for commands. List endpoint returns `is_sellable` capability flag (materialized in master); detail endpoint additionally embeds `salesProfile` (loaded via separate query, omitted when no row).
4. **Backend Material pages** — list (DataTable with filters by kind/lifecycle/is_* flags), create (CrudForm), detail (FormHeader/Footer, tabs reserved). Translations via `translations.ts`.
5. **MaterialSalesProfile entity, API, UI tab** — `data/entities.ts` adds `MaterialSalesProfile` (1:1 child via `material_id` unique FK), `data/validators.ts` adds `salesProfileSchema` with `gtin` + `commodityCode` (with same regex/format checks the previous Material schema had). Migration: new `material_sales_profiles` table + partial unique gtin index. API: `api/materials/[id]/sales-profile/route.ts` GET/PUT/DELETE. Commands: `commands/material-sales-profile.ts` upsert + delete with undo. Subscriber: `subscribers/sync-sales-capability.ts` toggling `Material.is_sellable`. Backend: new "Sales" tab on Material detail page — toggle `Listed for sales` (creates/deletes profile) + form for gtin/commodity_code.
6. **MaterialUnit entity, API, UI** — entity + migration + validators + API routes + units tab on Material detail page + unique-base-unit/unique-default-per-usage validators.
7. **MaterialSupplierLink entity, API, UI** — entity + migration + validators + API + suppliers tab on detail page. Validator verifies `supplier_company_id` exists in `customer_companies` within same `organization_id`. Preferred flag toggle.
8. **MaterialPrice entity, API, UI** — entity + migration + validators + API + prices tab. Validity range validation. Currency dropdown sourced from `currencies` module.
9. **FX cache subscriber** — `subscribers/recompute-base-currency.ts` listens to `currencies.exchange_rate.updated` (verified existing event in `currencies/events.ts:16`), recomputes `base_currency_amount` per affected price, emits `materials.price.fx_recalculated`.
10. **Lifecycle endpoint + audit** — `MaterialLifecycleEvent` entity + `/api/materials/[id]/lifecycle` POST + emits `materials.material.lifecycle_changed`. State machine: `draft→active→phase_out→obsolete`; reverse only `phase_out→active`. Replacement pointer optional on `obsolete`.
11. **Price expiration worker** — `workers/expire-prices.ts` daily job, emits `materials.price.expired`.
12. **Search + custom fields registration** — `search.ts` (fulltext + vector with LEFT JOIN on `material_sales_profiles` for gtin/commodity_code), `ce.ts` declaring `material` entity with default custom fields. Run `yarn generate`.
13. **`MaterialCatalogProductLink` extension** — declared in `data/extensions.ts`, entity + migration + validator (cross-org rejection) + simple link/unlink API.
14. **Widget injection (with new spot registration)** — Phase 1 introduces two new spots, both additive (BC-safe per surface #6):
    - Add spot `page:catalog.product.sidebar` to `packages/core/src/modules/catalog/widgets/injection-table.ts`. Wire the spot in `catalog/backend/catalog/products/[id]/page.tsx` to render at sidebar position (`InjectionPosition.SIDEBAR_AFTER_HEADER`).
    - Create `packages/core/src/modules/customers/widgets/injection-table.ts` (does not exist yet) and register `page:customers.company.tabs`. Wire the spot in `customers/backend/customers/companies/[id]/page.tsx` to render after default tabs (`InjectionPosition.TAB_AFTER_DEFAULT`).
    - Implement materials' two injection widgets (`catalog-product-sidebar.linked-material.tsx`, `customer-company-tabs.supplied-materials.tsx`) targeting those spots. Use wildcard-aware `hasFeature` matcher for visibility (per `.ai/lessons.md` "Feature-gated runtime helpers").
    - Run `yarn mercato configs cache structural --all-tenants` to refresh structural cache.
15. **Setup defaults + seed** — `setup.ts` finalized with kinds dictionary seed, default custom fields, `defaultRoleFeatures` complete.
16. **Documentation** — `AGENTS.md` for the module (rules + reference file map), `README.md` (overview + usage), update root `AGENTS.md` Task Router with materials row.
17. **Compliance gate** — `yarn lint`, `yarn build`, `yarn test`, `yarn test:integration`, `yarn mercato configs cache structural --all-tenants`. Confirm staff-engineer review checklist.

### Step Ordering Rationale

- Steps 1–4 deliver a usable Material list/create/detail without dependencies. Could be merged to PR 1 as a vertical slice.
- Step 5 (`MaterialSalesProfile`) depends on step 2 (Material exists) and step 4 (detail page exists for the new tab). Independently shippable.
- Steps 6–8 add other child entities; each step is independently shippable.
- Step 9 depends on step 8 (prices exist); step 10 depends on step 2 (material exists); step 11 depends on step 8.
- Step 13 depends on `catalog` being present; if `catalog` is disabled in the deployment, step 13 + step 14's catalog widget are inert (graceful no-op).

## Integration Test Coverage

Per AGENTS.md mandate ("For every new feature, the spec MUST list integration coverage for all affected API paths and key UI paths"). All tests are self-contained, create fixtures via API, clean up in teardown.

### API tests
- `materials.crud.spec.ts` — full CRUD lifecycle for `Material` including custom fields, organization isolation, code-uniqueness collision (same-org blocks, cross-org allows). Verify direct PUT on `is_sellable` is rejected with 422.
- `material-sales-profile.spec.ts` — PUT creates profile + flips `is_sellable=true`, DELETE removes + flips back to `false`, gtin partial unique within org (same-org duplicate rejected, cross-org allowed), missing parent material returns 404, profile returns 404 when none exists, subscriber idempotency (duplicate event does not double-toggle).
- `material-units.spec.ts` — base unit invariant (exactly one), default-per-usage uniqueness, cascade soft-delete with parent material.
- `material-suppliers.spec.ts` — link creation rejects cross-org `supplier_company_id`; preferred-flag uniqueness; supplier removal preserves price history.
- `material-prices.spec.ts` — validity range validation, currency FK, FX recompute on simulated `currencies.exchange_rate.updated`, expiration worker fires `materials.price.expired`.
- `material-lifecycle.spec.ts` — legal transitions accepted, illegal rejected, audit log appended, event emitted with correct payload.
- `material-catalog-link.spec.ts` — link/unlink, cross-org rejection, 1:1 enforcement.

### UI tests (Playwright)
- `materials-list.spec.ts` — list filters by kind, lifecycle, supplier company; pagination; column sort.
- `materials-create.spec.ts` — create flow with all required fields, kind selection, lifecycle defaults to `draft`. Confirm `is_sellable` is not editable in create form (only via Sales tab).
- `materials-detail-tabs.spec.ts` — sales/units/suppliers/prices tabs render and allow nested CRUD; sales tab "Listed for sales" toggle creates/deletes profile and flips `is_sellable` flag visible elsewhere; lifecycle change dialog with reason and successor selector.
- `catalog-product-linked-material-widget.spec.ts` — opens a catalog product, verifies linked material panel renders, follows CTA to material detail.
- `customer-company-supplied-materials-widget.spec.ts` — opens a customer company, verifies supplied materials tab renders, preferred indicator visible.

### ACL tests
- `materials.acl.spec.ts` — feature gating: a user with only `materials.material.view` cannot mutate; a user with no `materials.*` features cannot list.

## Final Compliance Report

| Check | Status |
|-------|--------|
| Singularity Law (entities, commands, events, feature IDs all singular) | OK — `material`, `materials.material.created`, `materials.sales_profile.created`, `materials.material.view` |
| Plural module + table names | OK — `materials` module, `materials`/`material_sales_profiles`/`material_units`/`material_supplier_links`/`material_prices`/`material_lifecycle_events`/`material_catalog_product_links` tables |
| FK IDs only across modules | OK — no MikroORM relations cross `materials`/`catalog`/`customers`/`currencies`/`auth` |
| `organization_id` mandatory | OK — on every scoped entity |
| Multi-tenant isolation enforced | OK — via `withScopedPayload` and validators |
| Zod validators for all API inputs | OK — declared in `data/validators.ts` |
| Custom fields integrated | OK — via `ce.ts` and `collectCustomFieldValues()` |
| Undoable commands with snapshot | OK — pattern copied from `customers/commands/people.ts` |
| OpenAPI export per route | OK |
| `makeCrudRoute` with `indexer: { entityType }` | OK |
| Translations via platform module | OK — `translations.ts` declares `name`, `description` |
| Search config covers fulltext + vector | OK |
| Events typed via `createModuleEvents()` | OK |
| ACL feature naming `<module>.<action>` | OK |
| `setup.ts` declares `defaultRoleFeatures` | OK |
| No `any` types | enforced via lint |
| No hardcoded user-facing strings | all strings via i18n |
| DS rules (no hardcoded status colors, no arbitrary values, no `dark:` on tokens) | UI step 4/13 must comply; verified at PR review |
| `pageSize ≤ 100` | enforced in CRUD route options |

## Migration & Backward Compatibility

This is a brand-new module with no prior version. No deprecation protocol triggered. New tables, new types, new events, new ACL features, new API routes — all additive.

The only existing surfaces touched are: (a) `catalog/widgets/injection-table.ts` — extended with a new spot `page:catalog.product.sidebar`; (b) creation of `customers/widgets/injection-table.ts` (file does not exist today) registering a new spot `page:customers.company.tabs`. Adding spot IDs is BC-safe per surface #6; renaming or removing them would not be.

If deployed without `catalog` enabled, the `MaterialCatalogProductLink` and the catalog widget are inert; the catalog widget registration checks for `catalog` module presence and no-ops if absent.

## Changelog

- 2026-05-02 — Initial spec drafted from skeleton + Open Questions answered ("pasuje" — all default recommendations accepted).
- 2026-05-02 — Pre-implementation analysis applied (see [`analysis/ANALYSIS-2026-05-02-materials-master-data.md`](analysis/ANALYSIS-2026-05-02-materials-master-data.md)). Remediation items 1–6 applied:
  - **(1)** Replaced non-existent `currencies.fx_rate.updated` with real `currencies.exchange_rate.updated` event ID throughout (Decisions Locked, Events, Step 8, integration tests, Progress checklist).
  - **(2)** Widget injection strategy switched to option (a): adds new spots `page:catalog.product.sidebar` and `page:customers.company.tabs`. Step 13 expanded with spot registration in target modules (BC-safe additive change per surface #6).
  - **(3)** `defaultRoleFeatures` re-mapped to platform-seeded `admin` + `employee` only. ERP roles (`procurement`, `production_planner`, `sales`) deferred to separate `auth-erp-roles` spec.
  - **(4)** Search Configuration expanded with concrete `MATERIAL_ENTITY_FIELDS`, `MATERIAL_CUSTOM_FIELD_SOURCES`, `formatResult` shape, and vector strategy (DI-resolved with fulltext fallback).
  - **(5)** `entityId: 'materials:material'` pinned in `ce.ts`, `translations.ts`, and Cross-Module Integration table.
  - **(6)** Dropped `materials.lifecycle.manage` feature; lifecycle now uses `materials.material.manage` (also updated in API contracts table).
- 2026-05-02 — Items 7–9 added as new "Lessons & Constraints" subsection within Implementation Plan: UUID timing, forked EM, centralized undo helpers, cross-module FK validation pattern, wildcard permissions, soft-delete cascade, partial unique index syntax, flush ordering.
- 2026-05-03 — **Class Table Inheritance refactor (option C1 from sparse-fields review).** Sales-only attributes (`gtin`, `commodity_code`) extracted from `materials` master into a new optional 1:1 child table `material_sales_profiles`. Mirrors the `customers.CustomerEntity` + `CustomerPersonProfile`/`CustomerCompanyProfile` pattern in this codebase. Effects:
  - `materials` master table loses `gtin` and `commodity_code` columns and the `(organization_id, gtin)` partial unique index. Capability flag `is_sellable` becomes materialized (derived from sales profile row existence; subscriber-synced; direct PUT rejected).
  - New entity `MaterialSalesProfile` (table `material_sales_profiles`) with 1:1 unique FK on `material_id`, plus `gtin`, `commodity_code`. Partial unique index `(organization_id, gtin) WHERE gtin IS NOT NULL AND deleted_at IS NULL` moves here.
  - New API `/api/materials/[id]/sales-profile` (GET/PUT/DELETE).
  - New events `materials.sales_profile.{created,updated,deleted}`.
  - New subscriber `subscribers/sync-sales-capability.ts` mirroring `is_sellable` from sales profile presence.
  - Implementation Plan grows by one step: new Step 5 ("MaterialSalesProfile + API + Sales tab"); subsequent steps renumbered (old 5→6, 6→7, …, 16→17).
  - Search config: gtin/commodity_code now joined from `material_sales_profiles` instead of read directly from `materials`.
  - Database surface count updated: 6 → 7 tables (BC: still purely additive — this spec is unimplemented, no migration needed for existing tenants).
  - Risks table extended with two new failure scenarios (direct flag mutation, gtin uniqueness within sales profile).

---

## Progress

> Tracked by `auto-create-pr` / `auto-continue-pr`. Each unchecked box is a step that must be completed and committed.

- [x] **Step 1** — Module scaffold (folder + index.ts + acl.ts + empty di.ts + setup.ts skeleton)
- [ ] **Step 2** — `Material` master entity (no sales-only fields) + migration + zod validators (rejects direct `is_sellable` mutation)
- [ ] **Step 3** — Material CRUD API routes + OpenAPI + commands with undo
- [ ] **Step 4** — Backend list/create/detail pages + translations
- [ ] **Step 5** — `MaterialSalesProfile` entity + migration + validators + `/api/materials/[id]/sales-profile` (GET/PUT/DELETE) + `subscribers/sync-sales-capability.ts` + Sales tab on Material detail page
- [ ] **Step 6** — `MaterialUnit` entity + API + UI tab
- [ ] **Step 7** — `MaterialSupplierLink` entity + API + UI tab + cross-org validator
- [ ] **Step 8** — `MaterialPrice` entity + API + UI tab + currency dropdown
- [ ] **Step 9** — FX recompute subscriber (`currencies.exchange_rate.updated`)
- [ ] **Step 10** — Lifecycle endpoint + `MaterialLifecycleEvent` audit + event emission
- [ ] **Step 11** — Price expiration worker (daily idempotent job)
- [ ] **Step 12** — Search config (LEFT JOIN `material_sales_profiles` for gtin/commodity_code) + custom fields registration in `ce.ts`
- [ ] **Step 13** — `MaterialCatalogProductLink` extension entity + link API
- [ ] **Step 14** — Widget injection into catalog product detail and customer company detail
- [ ] **Step 15** — `setup.ts` final: kinds seed + default custom fields + role features
- [ ] **Step 16** — Module `AGENTS.md` + `README.md` + Task Router update
- [ ] **Step 17** — Compliance gate: lint + build + test + integration tests + structural cache purge
