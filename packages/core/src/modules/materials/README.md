# Materials Module

ERP master data for items that can be **stocked, purchased, produced, or consumed**.

## What It Is

A `Material` is the root identifier for any operational record — raw materials, semi-finished goods, finished products, tools, indirect/MRO supplies. Distinct from `catalog.product` (which is sales-oriented). When both modules are enabled in a deployment, an optional 1:1 link (`MaterialCatalogProductLink`) bridges them.

## When to Use This vs Catalog

| Need | Use |
|------|-----|
| Storefront / SEO / variants / channel pricing | `catalog.product` |
| Stock balance / replenishment / BoM / inspection | `materials.material` |
| Both — single physical thing tracked end-to-end | Both, linked via `MaterialCatalogProductLink` |

A contract manufacturer with no online store can run `materials` + `inventory` + `procurement` + `production` without `catalog`. A pure storefront keeps `catalog` and never enables `materials`. A full ERP+commerce instance enables both.

## Quick Tour

- **Create a material** at `/backend/materials/create` — code, name, kind (raw / semi / final / tool / indirect), capability flags (purchasable / stockable / producible).
- **Open the detail page** to manage the master record + 5 child surfaces:
  - **Overview** — edit master fields + lifecycle state.
  - **Sales** — toggle "Listed for sales" to create a `MaterialSalesProfile` with GTIN and CN/HS code; toggling on flips `is_sellable=true` via subscriber.
  - **Units** — add measurement units (KG, PCS, PALLET) with conversion factors. Exactly one base unit per material; one default unit per usage (stock / purchase / sales / production).
  - **Suppliers** — link suppliers from your CRM (CustomerCompanyProfile). Star marks the preferred supplier (one per material).
  - **Prices** — per-supplier prices with multi-currency support and validity windows. Foreign-currency prices show "pending FX" until the next exchange-rate update lands.
- **Lifecycle** — POST `/api/materials/{id}/lifecycle` walks the state machine: `draft → active → phase_out → obsolete` (plus reverse `phase_out → active`). Audit log preserved in `material_lifecycle_events`.

## Capability Model

Four boolean capability flags live on the master:

| Flag | Default | Mutability | Phase 2 hook |
|------|---------|-----------|--------------|
| `is_purchasable` | true | user-settable | will be derived from a future `material_purchase_profiles` table |
| `is_sellable` | false | **derived** from `MaterialSalesProfile` row existence (subscriber-managed; direct mutation rejected) | already split — Phase 1 |
| `is_stockable` | true | user-settable | will be derived from a future `material_stock_profiles` table |
| `is_producible` | false | user-settable | will be derived from a future `material_production_profiles` table |

The pattern: Phase 1 ships only the `material_sales_profiles` aspect table because gtin / commodity_code need a place to live; the other three capabilities will get their own profile tables when there are real fields to put in them (Phase 2).

## API Surface

All routes scoped by tenant + organization. ACL gates per-action via the standard `requireFeatures` page metadata.

| Method | Path | Feature |
|--------|------|---------|
| GET / POST | `/api/materials` | `materials.material.view` / `.manage` |
| PUT / DELETE | `/api/materials?id=…` | `materials.material.manage` |
| GET / PUT / DELETE | `/api/materials/{id}/sales-profile` | `materials.material.view` / `.manage` |
| POST | `/api/materials/{id}/lifecycle` | `materials.material.manage` |
| GET / PUT / DELETE | `/api/materials/{id}/catalog-link` | `materials.material.view` / `.manage` |
| GET / POST | `/api/material-units` | `materials.units.view` / `.manage` |
| GET / POST | `/api/material-suppliers` | `materials.supplier_link.view` / `.manage` |
| GET / POST | `/api/material-prices` | `materials.price.view` / `.manage` |

OpenAPI shapes are auto-generated from zod schemas in `data/validators.ts`.

## Events

Declared in `events.ts`. Persistent unless noted otherwise.

- `materials.material.{created,updated,deleted,lifecycle_changed}`
- `materials.sales_profile.{created,updated,deleted}`
- `materials.unit.{created,updated,deleted}`
- `materials.supplier_link.{created,updated,removed}`
- `materials.price.{created,updated,fx_recalculated,expired}` (`fx_recalculated` is non-persistent — UI hint)
- `materials.catalog_link.{created,removed}`

## Subscribers

- `subscribers/sync-sales-on-create.ts` — toggles `Material.is_sellable=true` when a sales profile is added.
- `subscribers/sync-sales-on-delete.ts` — toggles back to false on profile removal (with a re-check for concurrent upserts).
- `subscribers/recompute-base-currency.ts` — listens to `currencies.exchange_rate.updated` and refills `MaterialPrice.base_currency_amount` for affected rows.

## Workers

- `workers/expire-prices.ts` — daily idempotent job that flips `is_active=false` on prices where `valid_to < now()` and emits `materials.price.expired`.

## Default Custom Fields

`internal_notes` (multiline) and `safety_data_sheet_url` (text). Tenants can extend further via the standard custom-fields UI; the master entity is registered as customer-extensible in `ce.ts`.

## Cross-Module Integration

| Other module | Integration | Direction |
|--------------|-------------|-----------|
| `catalog` | `MaterialCatalogProductLink` extension | bidirectional FK ID; widget injection materials → catalog |
| `customers` | `MaterialSupplierLink.supplier_company_id` FK ID; widget injection materials → customers | one-way FK; bidirectional UI |
| `currencies` | `MaterialPrice.currency_id` FK ID; subscriber to FX updates | one-way dependency on currencies |
| `auth` | `MaterialLifecycleEvent.changed_by_user_id` FK ID | one-way FK |
| `entities` (custom fields) | `material` registered in `ce.ts` | platform |
| `translations` | `materials:material` declared in `translations.ts` for `name` + `description` | platform |

No MikroORM relations cross module boundaries.

## Roadmap (Phase 2+)

See `AGENTS.md → Phase 2 Roadmap` and the source spec at `.ai/specs/2026-05-02-materials-master-data.md`.
