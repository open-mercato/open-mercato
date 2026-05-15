# Materials Module — Agent Guidelines

> **IMPORTANT**: Update this file with every major change to this module. When implementing new features, modifying architecture, or changing key interfaces, update the relevant sections to keep guidance accurate for future agents.

## Use This Module To...

- Manage ERP master data for items that can be **stocked, purchased, produced, or consumed** — including non-saleable items (raw materials, semi-finished goods, tools, indirect/MRO supplies).
- Track per-supplier prices with currency awareness and automatic FX conversion to a tenant base currency.
- Define multi-unit conversions per material (purchase / stock / sales / production usages with one base unit).
- Optionally bridge a material to a `catalog.product` for storefronts that ship a unified ERP+commerce experience.
- Drive lifecycle workflows (`draft → active → phase_out → obsolete`) with append-only audit history.

## When to Choose Materials vs Catalog Products

- Choose `materials` when the record is operational: it has supplier links, lead times, stock units, BoM relationships. It does NOT need a storefront listing.
- Choose `catalog.product` when the record is sales-oriented: variants, channel-scoped pricing, SEO, offers.
- Use the optional 1:1 `MaterialCatalogProductLink` when a single physical thing needs both projections.

## Module Layout

```
packages/core/src/modules/materials/
├── AGENTS.md                # This file
├── README.md                # User-facing overview
├── index.ts                 # Module metadata
├── acl.ts                   # Feature definitions (materials.*)
├── ce.ts                    # Custom-fields-extensible entities (Material)
├── customFieldDefaults.ts   # Default custom fields (internal_notes, safety_data_sheet_url)
├── di.ts                    # Awilix registrations (currently empty — no module services)
├── events.ts                # Typed event declarations (14 events across 5 entities)
├── search.ts                # Search config (fulltext on Material; gtin/commodity_code TODO)
├── setup.ts                 # Tenant init + defaultRoleFeatures
├── translations.ts          # Translatable fields: materials:material → ['name', 'description']
├── api/
│   ├── openapi.ts                                 # Materials CRUD OpenAPI factory
│   ├── utils.ts                                   # Module-scoped withScopedPayload helper
│   ├── materials/route.ts                         # Master CRUD (list/create/update/delete)
│   ├── materials/[id]/sales-profile/route.ts      # 1:1 sales profile (GET/PUT/DELETE)
│   ├── materials/[id]/lifecycle/route.ts          # Lifecycle transition (POST)
│   ├── materials/[id]/catalog-link/route.ts       # Catalog link (GET/PUT/DELETE)
│   ├── material-units/route.ts                    # Units CRUD
│   ├── material-suppliers/route.ts                # Supplier links CRUD
│   └── material-prices/route.ts                   # Prices CRUD
├── backend/
│   └── materials/
│       ├── page.tsx                                # List (DataTable + filters)
│       ├── create/page.tsx                         # Create (CrudForm)
│       └── [id]/
│           ├── page.tsx                            # Detail with tabs
│           ├── UnitsTab.tsx                        # Units management tab
│           ├── SuppliersTab.tsx                    # Supplier links tab
│           └── PricesTab.tsx                       # Prices tab
├── commands/                                       # Undoable commands (per customers pattern)
│   ├── index.ts
│   ├── material.ts                                 # Master CRUD
│   ├── material-sales-profile.ts                   # 1:1 sales profile (upsert + delete)
│   ├── material-unit.ts                            # Units CRUD + base/default invariants
│   ├── material-supplier-link.ts                   # Supplier links + cross-org validator
│   ├── material-price.ts                           # Prices + currency cross-module validator
│   ├── material-lifecycle.ts                       # Lifecycle transitions + state machine
│   └── material-catalog-link.ts                    # Catalog product 1:1 link
├── data/
│   ├── entities.ts                                 # 7 entities (Material + 6 children)
│   ├── validators.ts                               # zod schemas + state-machine guards
│   └── extensions.ts                               # MaterialCatalogProductLink extension
├── subscribers/
│   ├── recompute-base-currency.ts                  # FX cache (currencies.exchange_rate.updated)
│   ├── sync-sales-on-create.ts                     # Material.is_sellable → true
│   └── sync-sales-on-delete.ts                     # Material.is_sellable → false (with re-check)
├── widgets/
│   ├── injection-table.ts                          # Maps widgets to two new spots
│   └── injection/
│       ├── catalog-product-sidebar/widget.client.tsx       # Linked-material panel
│       └── customer-company-tabs/widget.client.tsx         # Supplied-materials tab
├── workers/
│   └── expire-prices.ts                            # Daily idempotent expiry job
└── migrations/                                     # 5 migrations (one per entity table)
```

## Reference Tables

| Table | Purpose | Key Indexes |
|-------|---------|-------------|
| `materials` | Master records | `(org, code) WHERE deleted_at IS NULL` unique; `(org, kind)`; `(org, lifecycle_state)` |
| `material_sales_profiles` | 1:1 sales-only attributes (gtin, commodity_code) | `(material_id)` unique; `(org, gtin)` partial unique |
| `material_units` | N:1 measurement units per material | `(material_id, code)` unique; `(material_id)` partial unique on is_base; `(material_id, usage)` partial unique on is_default_for_usage |
| `material_supplier_links` | N:1 supplier links (FK to customer_companies) | `(material_id)` partial unique on preferred; `(material_id, supplier_company_id)` unique |
| `material_prices` | N:1 prices per supplier link | `(material_supplier_link_id, valid_from)`; `(currency_id)` |
| `material_lifecycle_events` | Append-only audit log | `(material_id, changed_at DESC)` |
| `material_catalog_product_links` | 1:1 cross-module link to catalog | `(material_id)` partial unique; `(catalog_product_id)` partial unique |

## Common Tasks

### Add a New Sub-Entity (e.g., MaterialFeature, MaterialDrawing)

1. Add the entity to `data/entities.ts` (mirror existing patterns: standard scoping, partial unique indexes for soft-delete-aware uniqueness).
2. Add zod schemas to `data/validators.ts`.
3. Add events to `events.ts` (`materials.<entity>.{created,updated,deleted}`).
4. Generate a new migration: `yarn db:generate` from project root (NOT the worktree — worktree drift produces noisy migrations; copy out the relevant CREATE TABLE if you must).
5. Write commands in `commands/<entity>.ts` mirroring the existing patterns:
   - Cross-org validator if it FKs into another module.
   - Auto-rebalance helpers if there's a "preferred" / "default" / "base" boolean invariant.
   - Full undo support — include the entity's tracked columns in the snapshot.
6. Register the command file in `commands/index.ts`.
7. Add an API route in `api/<entity>/route.ts` via `makeCrudRoute`.
8. Add a tab component to `backend/materials/[id]/<Entity>Tab.tsx`.
9. Mount the tab in `backend/materials/[id]/page.tsx`.

### Change Lifecycle State Machine

State transitions live in `data/validators.ts` → `MATERIAL_LIFECYCLE_TRANSITIONS`. Update both the map AND the `commands/material-lifecycle.ts` allowed-transitions guard (the validator and command share the same constant).

### Modify FX Behavior

The FX subscriber lives at `subscribers/recompute-base-currency.ts`. It listens to `currencies.exchange_rate.updated` and recomputes `base_currency_amount` for affected `MaterialPrice` rows. To add an "initial compute on price create" subscriber, mirror the structure listening to `materials.price.created`.

## Architecture Constraints

When modifying this module, follow these constraints:

```
┌────────────────────────────────────────────────────────────────────────┐
│                         MATERIALS MODULE                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Material (master)                                                      │
│  ├── MaterialSalesProfile (1:1 optional, materializes is_sellable)     │
│  ├── MaterialUnit (N:1, one base + per-usage defaults)                 │
│  ├── MaterialSupplierLink (N:1, FK to customer_companies)              │
│  │   └── MaterialPrice (N:1, FK to currencies.currency)                │
│  ├── MaterialLifecycleEvent (append-only audit)                        │
│  └── MaterialCatalogProductLink (1:1 optional, FK to catalog_products) │
│                                                                         │
│  Cross-module dependencies:                                             │
│   - customers.CustomerCompanyProfile (supplier link FK)                 │
│   - currencies.Currency / ExchangeRate (price FK + FX subscriber)       │
│   - catalog.CatalogProduct (1:1 extension link)                         │
│   - auth.User (lifecycle event actor FK)                                │
│                                                                         │
│  All cross-module FKs are bare uuid IDs — no MikroORM relations.        │
│  Cross-org validators use findOneWithDecryption per .ai/lessons.md.     │
└────────────────────────────────────────────────────────────────────────┘
```

**MUST rules for architecture changes:**
- MUST NOT add ORM relations across module boundaries (use bare uuid FK + validator).
- MUST go through `findOneWithDecryption` for cross-module entity lookups (encryption-aware) per .ai/lessons.md.
- MUST scope every operation by `organization_id` AND `tenant_id`.
- MUST keep capability flags (`is_purchasable`, `is_stockable`, `is_producible`) user-settable; `is_sellable` is materialized — direct mutation is rejected by the strict zod schema.
- MUST emit events through `eventBus.emitEvent(...)` from subscribers; commands use `emitCrudSideEffects` from `@open-mercato/shared/lib/commands/helpers`.
- MUST use partial unique indexes (`WHERE deleted_at IS NULL`) for any soft-delete-aware uniqueness constraint — full unique would block re-create after delete.

## Phase 2 Roadmap (Out of Scope for Phase 1)

- `MaterialFeatureData` / `MaterialFeatureGroup` — PIM-style attributes per material kind.
- `MaterialLongText` per-audience descriptions (technical, marketing, internal).
- `MaterialStat` / ABC analysis / slow-mover detection (consumer of `inventory` events).
- `MaterialDrawing` / `MaterialCadMapping` — CAD sync.
- `material_purchase_profiles` / `material_stock_profiles` / `material_production_profiles` — additional CTI capability profiles (currently capability flags are bare booleans on master because Phase 1 has no fields to put in dedicated profile tables).
- Search join with `material_sales_profiles` for gtin / commodity_code searchability — needs a structured aux JOIN hook from the SearchModuleConfig API.
- Soft-delete cascade subscriber on `materials.material.deleted` — currently child entities are NOT auto-cascaded; commit-time guard rules live inside child commands.
- Initial FX compute subscriber on `materials.price.created` — Phase 1 keeps the cache empty until the next exchange_rate.updated event.
- Translations widget injection on the master form — gtin/commodity_code are not user-facing strings so they don't need translations.

## Changelog

### 2026-05-03 — Phase 1 implementation (Steps 1–17)

Initial Phase 1 ship across 17 commits on `feat/materials-master-data`. CTI refactor (option C1 from sparse-fields review) extracts gtin/commodity_code to `material_sales_profiles`. Reference module pattern is `customers` (CustomerEntity + CustomerPersonProfile/CustomerCompanyProfile). All cross-module FKs validated via findOneWithDecryption. Backend UI ships with 5 tabs (overview / sales / units / suppliers / prices) all functional.

Key deliverables:
- 7 entities + 5 migrations
- 16 commands across 7 command files (full undo support throughout)
- 14 API routes (master CRUD + 4 child CRUDs + 3 dynamic 1:1 routes + lifecycle)
- 14 declared events + 3 subscribers (FX, sync-sales-on-create, sync-sales-on-delete)
- 1 worker (price expiration, idempotent daily)
- 2 widget components for cross-module injection (catalog product sidebar + customer company tabs)
- ACL: 9 features (materials.material.*, materials.units.*, materials.supplier_link.*, materials.price.*, materials.settings.manage, materials.widgets.*)
