# SPEC-034: Units of Measure and Product Conversions (Catalog + Sales Core)

**Date**: 2026-02-18
**Status**: Proposed
**Scope**: OSS (`.ai/specs`)

---

## TLDR

**Key Points:**
- Introduce a hybrid Units of Measure (UoM) model: global physical unit dictionary (`unit`) plus product-level conversion factors.
- Keep existing `quantity` flows compatible, but add normalized quantities and immutable UoM snapshots on sales lines.
- Support ERP-style selling in different units (for example `pack`, `carton`, `pallet`) while preserving a single accounting/base unit per product.
- Add optional EU unit-price display model (for example price per `1 kg`, `1 l`, `1 m2`, `1 m3`, `1 pc`).

**Scope (v1):**
- `catalog` + `sales` core only.
- Product model, conversion model, pricing quantity semantics, quote/order/invoice/credit memo line semantics, API/UI/search/events/ACL coverage, integration test coverage plan.

**Out of Scope (v1):**
- Purchasing, warehouse, inventory reservation logic, logistics, EDI, BI reporting redesign.

**Primary Concerns:**
- Backward compatibility for existing qty-only records.
- Deterministic conversion rules (no ambiguous graph paths).
- Stable document snapshots when catalog conversions change later.

---

## 1) Overview

Open Mercato currently stores and processes mostly qty-centric line quantities. The platform already has a shared dictionary `unit`, and sales lines already persist `quantityUnit`, but there is no canonical conversion system that ties products, pricing, and documents together end-to-end.

This specification defines an implementation-ready architecture for Units of Measure in ERP terms:
- Product has one **base/accounting unit**.
- Product can define **multiple sales units** and conversion factors to base unit.
- Sales users can enter quantities in different units while the system computes and stores normalized quantities.
- Pricing thresholds and legal unit-price displays become conversion-aware.

### Market Reference

Reference systems reviewed at concept level:
- **Odoo** (product UoM categories and conversion factors).
- **ERPNext** (stock UoM vs sales UoM, conversion factors, document-level snapshots).

Adopted:
- Base unit + conversion factors per product.
- Document snapshot immutability.
- Optional legal/unit-price display controls.

Rejected for v1:
- Full category-wide dimensional conversion engine with automatic unit families.
- Global procurement/warehouse redesign in same rollout.

---

## 2) Problem Statement

Current platform gaps:
1. Product-level `defaultUnit` exists, but product create/edit UX does not expose robust unit and conversion configuration.
2. Sales lines persist `quantity` + `quantityUnit`, but line dialog and calculations are still qty-first and conversion-agnostic.
3. Pricing threshold selection (`minQuantity`/`maxQuantity`) operates on raw provided quantity, not normalized base quantity.
4. Quote -> order -> invoice document flow preserves numbers but not a formal UoM conversion snapshot.
5. Legal EU unit-price display (per 1 kg / 1 l / 1 m2 / 1 m3 / 1 pc) has no first-class model.
6. Search/indexing does not expose normalized unit semantics.

Business impact:
- Inability to sell the same product in pack/carton/pallet scenarios safely.
- Ambiguous commercial calculations and legal display gaps in B2B/B2C contexts.
- High risk of manual conversion errors.

---

## 3) Scope, Boundaries, and Defaults

### 3.1 In Scope (v1)

- Catalog product UoM defaults and per-product conversion model.
- Sales document line normalization and snapshot model across quotes, orders, invoices, credit memos.
- API contracts and OpenAPI updates for affected routes.
- Backoffice UX in product create/edit and sales line dialog/table.
- Optional product-level EU unit-price configuration and rendering rules.
- ACL coverage using existing catalog/sales/dictionaries feature model.
- Search indexing updates and integration test coverage plan.

### 3.2 Out of Scope (v1)

- Purchasing and supplier UoM flows.
- Warehouse picking/stock reservation conversion mechanics.
- Shipping carrier billing weight/volumetric conversion redesign.
- Financial reporting redesign beyond line-level unit-price display fields.
- Enterprise-only overlays.

### 3.3 Locked Defaults

1. `unit` dictionary remains the global source of unit codes.
2. Product conversion model is additive; no global conversion-matrix rewrite.
3. EU unit-price is optional in v1.
4. No cross-module ORM relationship changes; FK IDs only.
5. OSS-only spec.

---

## 4) Current State Baseline (As-Is)

### 4.1 Dictionary Baseline

- Catalog seeds system dictionary `unit` (key aliases include `unit`, `units`, `measurement_units`).
- Route exists: `GET /api/catalog/dictionaries/{key}`.
- Current unit list includes `pc`, `pkg`, `box`, `kg`, `l`, `m2`, `m3`, `hour`, etc.

### 4.2 Product Baseline

- Entity has `default_unit` (`CatalogProduct.defaultUnit`).
- Validators/commands already allow `defaultUnit` in product payload.
- Product backoffice forms currently focus on dimensions/weight, not dedicated UoM conversion management.

### 4.3 Sales Baseline

- Entities already contain `quantity` and `quantity_unit` on:
  - `sales_order_lines`
  - `sales_quote_lines`
  - `sales_invoice_lines`
  - `sales_credit_memo_lines`
- Line dialog submits qty and price but has no explicit UoM selection/conversion UX.
- Sales calculations operate on `quantity` without conversion normalization semantics.

### 4.4 Pricing Baseline

- Catalog pricing resolver uses `minQuantity`/`maxQuantity` with simple numeric comparison.
- No normalized quantity context for conversion-aware tiering.

### 4.5 ACL/Setup Baseline

- Catalog features: `catalog.products.view/manage`, `catalog.pricing.manage`, etc.
- Sales features: `sales.orders.*`, `sales.quotes.*`, etc.
- Dictionaries features: `dictionaries.view/manage`.
- Role defaults in `setup.ts` already include wildcard catalog/sales coverage for admin/employee.

### 4.6 Search Baseline

- Catalog search indexes title/sku/type but not product UoM semantics.
- Sales line search indexes quantity/kind/status but not normalized quantity or unit semantics.

### 4.7 As-Is Route Surface (Impacted)

| Area | Current Route Family | Current Limitation |
| --- | --- | --- |
| Unit dictionary | `/api/catalog/dictionaries/unit` | No product-level conversion relation |
| Products | `/api/catalog/products` | `defaultUnit` not reflected as complete UoM model |
| Prices | `/api/catalog/prices` | Tier selection not normalized-unit aware |
| Sales lines | `/api/sales/order-lines`, `/api/sales/quote-lines` | No normalized quantity fields/snapshot contract |
| Public quote | `/api/sales/quotes/public/[token]` | Displays `quantityUnit` only as plain text |

### 4.8 As-Is UI Surface (Impacted)

| Area | Current Path | Current Limitation |
| --- | --- | --- |
| Product create | `/backend/catalog/products/create` | No base/sales UoM conversion editor |
| Product edit | `/backend/catalog/products/[id]` | No conversion management |
| Sales document details | `/backend/sales/documents/[id]` | Qty and unit price only; no conversion-aware quantity UX |
| Public quote page | `/frontend/quote/[token]` | No unit-price legal display and no normalized context |

### 4.9 Existing Business Invariants

| Invariant | Current State |
| --- | --- |
| Tenant isolation by `organization_id` | Enforced in CRUD routes |
| No cross-module direct ORM relation | Mostly compliant |
| `pageSize <= 100` on major list routes | Enforced in catalog/products and most core routes |
| CRUD routes export `openApi` | Enforced for impacted route families |

---

## 5) Proposed Solution

### 5.1 Core Approach

Implement a hybrid model:
1. Global `unit` dictionary remains source of valid unit codes.
2. Each product defines one base unit (accounting unit).
3. Each product defines conversion factors from sales units to base unit.
4. Sales lines store entered quantity/unit and computed normalized quantity (base unit).
5. Document conversion snapshot freezes factors used at line creation/update time.

### 5.2 Key Benefits

- Supports ERP selling patterns (pack/carton/pallet) without losing accounting consistency.
- Preserves historical document correctness after catalog conversion changes.
- Enables normalized quantity-based pricing tiers.
- Provides legal EU unit-price display capability with explicit product configuration.

### 5.3 Design Tradeoff

Chosen model uses product-specific conversion factors to base unit (star topology), not arbitrary multi-edge graph traversal. This prevents ambiguous conversion paths and simplifies validation/performance.

### 5.4 Design Decisions

| Decision | Rationale |
| --- | --- |
| Keep `unit` dictionary as global source of unit codes | Reuses existing seeded dictionary and existing admin workflows |
| Keep existing `quantity` and `quantity_unit` as entered values | Preserves backward compatibility for sales APIs and UI |
| Add normalized fields instead of replacing entered fields | Allows legal/commercial traceability and no data loss |
| Persist immutable `uom_snapshot` | Prevents historical drift after catalog conversion edits |
| EU unit-price as optional configuration | Supports legal use cases without forcing complexity on all tenants |

### 5.5 Alternatives Considered

| Alternative | Why Rejected |
| --- | --- |
| Global conversion matrix for all products | Too broad for v1, difficult tenant-specific governance |
| Arbitrary conversion graph traversal per product | Ambiguity risk and expensive validation |
| Replacing `quantity` with normalized quantity only | Breaks current commercial semantics and existing API clients |
| Mandatory legal unit-price for all products | Not all tenants/products require it and would increase rollout risk |

### 5.6 User Stories / Use Cases

- **Sales manager** wants to define product base unit and packaging units so that offers/orders can be entered in operational units while accounting stays consistent.
- **Sales operator** wants to enter quote line quantity in `pack` and see normalized quantity in base unit so that pricing and totals remain accurate.
- **Admin** wants conversion edits to apply only to new lines so that historical documents remain legally and commercially traceable.
- **Compliance-focused merchant** wants to show optional legal unit-price per 1 reference unit so that customer-facing documents can include required transparency fields.

---

## 6) Glossary and Domain Invariants

### 6.1 Glossary

- **Physical Unit**: unit code from global `unit` dictionary (`kg`, `m2`, `l`, `pc`, etc.).
- **Base Unit**: product accounting unit; all quantities normalize to this unit.
- **Sales Unit**: unit used in line entry (`pack`, `carton`, `pallet`, `kg`, etc.).
- **Conversion Factor (`toBaseFactor`)**: number of base units contained in one sales unit.
- **Normalized Quantity**: `enteredQuantity * toBaseFactor`, rounded by product UoM policy.
- **UoM Snapshot**: immutable line-level JSON storing conversion details used at mutation time.
- **Unit Price Reference**: optional legal display rule (for example per `1 kg`).

### 6.2 Required Invariants

1. Every product UoM conversion entry points to the product base unit by factor.
2. No duplicate active conversion per `(productId, unitCode)`.
3. `toBaseFactor > 0`.
4. Document lines must persist both entered and normalized quantity semantics.
5. Quote -> order -> invoice -> credit memo propagation must preserve UoM snapshot lineage.
6. All scoped queries remain tenant/org isolated.

---

## 7) Architecture

### 7.1 High-Level Flow

```text
Catalog product setup
  -> base unit + default sales unit + conversions
  -> persisted in catalog product + conversion table

Sales line entry (quote/order)
  -> user enters quantity + sales unit
  -> UoM service resolves toBaseFactor
  -> normalizedQuantity computed
  -> catalog pricing resolver receives normalized quantity context
  -> line persisted with uomSnapshot

Document progression
  quote -> order -> invoice/credit_memo
  -> UoM snapshot copied, not recalculated from latest catalog config
```

### 7.2 Component Responsibilities

- `catalog` module:
  - Product UoM defaults.
  - Conversion CRUD.
  - Conversion validation.
  - Pricing normalization context.
- `sales` module:
  - Line entry unit handling.
  - Snapshot persistence and propagation.
  - Conversion-aware display fields.
- Event/worker boundary:
  - No new mandatory worker in v1 runtime path; backfill may run as chunked worker job when row volume requires it.
  - Catalog and sales event emissions stay one-way (no circular subscriber dependency introduced by this spec).
- `shared` (if needed):
  - Numeric rounding helpers reused by catalog/sales.

### 7.3 Commands and Events

Mutations remain command-driven.

- Reused commands:
  - `catalog.products.create`
  - `catalog.products.update`
  - `sales.orders.lines.upsert`
  - `sales.quotes.lines.upsert`
- New commands (v1):
  - `catalog.product-unit-conversion.create`
  - `catalog.product-unit-conversion.update`
  - `catalog.product-unit-conversion.delete`

Proposed events (catalog side):
- `catalog.product.updated` (payload extended with UoM delta metadata).
- `catalog.product_unit_conversion.created`
- `catalog.product_unit_conversion.updated`
- `catalog.product_unit_conversion.deleted`

Sales events continue to use existing line/document lifecycle IDs with payload extensions.

### 7.4 Undo/Rollback Contract

| Mutation | Execute Contract | Undo Contract | Transaction Boundary |
| --- | --- | --- | --- |
| `catalog.products.create` / `update` (UoM fields) | Persist product UoM defaults and unit-price config | Restore previous product snapshot via existing command undo payload | Single DB transaction |
| `catalog.product-unit-conversion.create` / `update` / `delete` | Mutate one conversion row and emit side effects | Restore previous conversion row state from command snapshot | Single DB transaction |
| `sales.quotes.lines.upsert` / `sales.orders.lines.upsert` | Resolve conversion, persist entered + normalized values + snapshot, recalc totals | Restore previous line snapshot and previous totals snapshot | Single DB transaction per line upsert |
| Quote -> order conversion | Copy line UoM snapshots and normalized fields to target lines | Revert generated target document graph via existing document undo strategy | Graph transaction |

### 7.5 Side-Effect Reversibility

- Reversible side effects:
  - Search/index upsert/delete side effects tied to command undo.
  - Cache invalidation can be re-triggered on undo restore.
- Not strictly reversible:
  - Notifications/webhooks already emitted externally.
- Mitigation for non-reversible effects:
  - Include `eventId` and `causationId` in payload metadata to allow idempotent consumers and compensating notifications.

---

## 8) Data Models

### 8.1 `CatalogProduct` Extensions (`catalog_products`)

Existing `default_unit` is retained and treated as `baseUnitCode` alias.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `default_unit` | text | yes | null | Existing field, canonical base unit |
| `default_sales_unit` | text | yes | null | Preferred unit for sales line entry |
| `default_sales_unit_quantity` | numeric(18,6) | no | `1` | Default entered quantity suggestion |
| `uom_rounding_scale` | int2 | no | `4` | Supported range: `0..6` |
| `uom_rounding_mode` | text | no | `half_up` | `half_up`, `down`, `up` |
| `unit_price_enabled` | boolean | no | `false` | Optional legal display toggle |
| `unit_price_reference_unit` | text | yes | null | Allowed: `kg`, `l`, `m2`, `m3`, `pc` |
| `unit_price_base_quantity` | numeric(18,6) | yes | null | Base units equivalent to one reference unit |

Validation:
- If `unit_price_enabled = true`, then `unit_price_reference_unit` and `unit_price_base_quantity` are required.
- `unit_price_base_quantity > 0`.

### 8.2 New Entity: `CatalogProductUnitConversion` (`catalog_product_unit_conversions`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `organization_id` | uuid | Tenant isolation |
| `tenant_id` | uuid | Tenant isolation |
| `product_id` | uuid FK -> `catalog_products.id` | Same-module relation allowed |
| `unit_code` | text | Must exist in dictionary `unit` |
| `to_base_factor` | numeric(24,12) | base units in 1 `unit_code` |
| `sort_order` | int | UI ordering |
| `is_active` | boolean | default true |
| `metadata` | jsonb nullable | Optional extra annotations |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp nullable | Soft delete |

Constraints:
- Unique active conversion per product and `unit_code`.
- Conversion for base unit may be omitted (implicitly factor `1`) or present only with `1`.

### 8.3 Sales Line Extensions (All Line Tables)

Applies to:
- `sales_order_lines`
- `sales_quote_lines`
- `sales_invoice_lines`
- `sales_credit_memo_lines`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `normalized_quantity` | numeric(18,6) | no | `0` | Quantity in product base unit |
| `normalized_unit` | text | yes | null | Usually product base unit code |
| `uom_snapshot` | jsonb | yes | null | Immutable conversion snapshot |

Existing fields remain:
- `quantity` (entered quantity)
- `quantity_unit` (entered unit)

### 8.4 `uom_snapshot` JSON Contract

```ts
type SalesLineUomSnapshot = {
  version: 1
  productId: string | null
  productVariantId: string | null
  baseUnitCode: string | null
  enteredUnitCode: string | null
  enteredQuantity: string
  toBaseFactor: string
  normalizedQuantity: string
  rounding: {
    mode: 'half_up' | 'down' | 'up'
    scale: number
  }
  source: {
    conversionId: string | null
    resolvedAt: string // ISO timestamp
  }
  unitPriceReference?: {
    enabled: boolean
    referenceUnitCode: 'kg' | 'l' | 'm2' | 'm3' | 'pc' | null
    baseQuantity: string | null
    grossPerReference?: string | null
    netPerReference?: string | null
  }
}
```

### 8.5 Data Access and Indexes

Required indexes:
- `catalog_product_unit_conversions(product_id, organization_id, tenant_id, unit_code)`
- `sales_*_lines(normalized_unit, normalized_quantity)` for analytics/search filters.

### 8.6 Migration and Backfill Strategy

1. Add additive columns and new conversion table.
2. Backfill existing product rows:
   - `default_sales_unit = default_unit` when null and `default_unit` present.
   - `default_sales_unit_quantity = 1`.
3. Backfill line rows:
   - `normalized_quantity = quantity`.
   - `normalized_unit = quantity_unit`.
   - `uom_snapshot = null` for legacy rows.
4. Migration is backward compatible; old clients continue sending qty only.

Rollback safety:
- New fields are additive and nullable/defaulted.
- Existing behaviors remain valid when conversion records are absent.

### 8.7 Write Atomicity and Transaction Boundaries

- Product UoM update + conversion changes in the same user action MUST execute in one transaction.
- Sales line upsert MUST persist:
  - entered quantity/unit,
  - normalized quantity/unit,
  - `uom_snapshot`,
  - recalculated totals
  in one transaction.
- Quote/order to invoice/credit_memo propagation MUST copy UoM snapshots atomically with line creation.

### 8.8 Query Cardinality and Access Patterns

| Query Pattern | Type | Expected Cardinality | Index Support |
| --- | --- | --- | --- |
| Product conversion by `(product_id, unit_code)` | Point lookup | O(1) | Composite index on `product_id, unit_code, organization_id, tenant_id` |
| Product conversions list by `product_id` | Small range scan | Usually `< 100` rows/product | Composite index on `product_id, organization_id, tenant_id` |
| Sales lines by document id | Range scan | 1..500 per document typical | Existing document line indexes + new normalized columns |
| Migration backfill sweep | Full scan (chunked) | Potentially millions of lines | Chunk by PK + checkpointing |

---

## 9) API Contracts

### 9.1 Product API Delta (`/api/catalog/products`)

### Request Additions (POST/PUT)

```json
{
  "defaultUnit": "m2",
  "defaultSalesUnit": "pkg",
  "defaultSalesUnitQuantity": 1,
  "uomRoundingScale": 4,
  "uomRoundingMode": "half_up",
  "unitPrice": {
    "enabled": true,
    "referenceUnit": "m2",
    "baseQuantity": 1
  }
}
```

### Response Additions (GET list/detail)

```json
{
  "default_unit": "m2",
  "default_sales_unit": "pkg",
  "default_sales_unit_quantity": 1,
  "uom_rounding_scale": 4,
  "uom_rounding_mode": "half_up",
  "unit_price": {
    "enabled": true,
    "reference_unit": "m2",
    "base_quantity": 1
  }
}
```

Backward compatibility:
- Existing `defaultUnit` input remains accepted.

### 9.2 New Conversion CRUD API (`/api/catalog/product-unit-conversions`)

### GET
- Query: `id?`, `productId?`, `page`, `pageSize`, sorting.
- Pagination rule: `pageSize <= 100`.
- Keyset note: for this endpoint, cursor/keyset is marked N/A in v1 because per-product conversion cardinality is intentionally bounded (expected `< 100`).

### POST

```json
{
  "productId": "uuid",
  "unitCode": "pkg",
  "toBaseFactor": 2.5,
  "sortOrder": 10,
  "isActive": true
}
```

### PUT

```json
{
  "id": "uuid",
  "toBaseFactor": 5,
  "sortOrder": 20,
  "isActive": true
}
```

### DELETE

```json
{ "id": "uuid" }
```

Validation rules:
- `unitCode` must exist in dictionary `unit`.
- Reject duplicate active conversion per product/unit.
- Reject non-positive factors.
- Reject disabling/deleting unit still configured as product default sales unit unless product update is part of same logical operation.

### 9.3 Pricing API Delta (`/api/catalog/prices` and product pricing resolution)

- Price matching context must evaluate quantity tiers on **normalized quantity** whenever product/unit context is provided.
- Existing price storage (`minQuantity`, `maxQuantity`) is retained.
- No breaking schema change for price records in v1.

Request context extension where price resolution is called:
- `quantity`
- `quantityUnit` (optional)
- `productId` or `variantId`

### 9.4 Sales Line API Delta (`/api/sales/order-lines`, `/api/sales/quote-lines`)

### Request (POST/PUT)

```json
{
  "orderId": "uuid",
  "productId": "uuid",
  "quantity": 12,
  "quantityUnit": "pkg"
}
```

### Response additions (list/get)

```json
{
  "quantity": 12,
  "quantity_unit": "pkg",
  "normalized_quantity": 30,
  "normalized_unit": "m2",
  "uom_snapshot": { "version": 1 }
}
```

Behavior:
- If `quantityUnit` omitted and product has `defaultSalesUnit`, use it.
- If neither present, fallback to product base unit.
- Custom line (no product): `normalized_quantity = quantity`, `normalized_unit = quantityUnit`.

### 9.5 Document/Public Quote Payload Delta

Impacted route families:
- `/api/sales/quotes/public/[token]`
- Internal document APIs from `sales/api/documents/factory.ts`

Line payload should include normalized fields and optional computed legal unit-price display fields.

### 9.6 Error Contract Matrix

| Code | Error Key | HTTP | Trigger |
| --- | --- | --- | --- |
| `uom.unit_not_found` | Unknown unit code in dictionary | 400 | Conversion create/update, line upsert |
| `uom.duplicate_conversion` | Duplicate product/unit conversion | 409 | Conversion create/update |
| `uom.invalid_factor` | Non-positive or overflow factor | 400 | Conversion create/update |
| `uom.default_unit_missing` | Product base unit not defined for conversion-requiring action | 400 | Line upsert with product |
| `uom.conversion_not_found` | Product has no conversion for entered unit | 400 | Line upsert |
| `uom.precision_overflow` | Calculated numeric exceeds precision | 422 | Normalization/calculation |
| `uom.reference_config_invalid` | Unit-price config incomplete/invalid | 400 | Product save with unitPrice enabled |

### 9.7 OpenAPI Requirements

All affected and newly added routes MUST export `openApi`.

| Route Family | OpenAPI Delta |
| --- | --- |
| `/api/catalog/products` | Add UoM and unit-price fields in request/response schemas |
| `/api/catalog/product-unit-conversions` | New CRUD docs |
| `/api/sales/order-lines` | Add normalized/uom snapshot response schema |
| `/api/sales/quote-lines` | Add normalized/uom snapshot response schema |
| `/api/sales/quotes/public/[token]` | Extend line schema for normalized semantics |

---

## 10) UI/UX Contracts

### 10.1 Product Create/Edit (`/backend/catalog/products/create`, `/backend/catalog/products/[id]`)

Add dedicated UoM section:
- Base unit selector (dictionary `unit`).
- Default sales unit selector.
- Default sales unit quantity input.
- Rounding mode and scale.

Add conversion editor grid:
- Columns: `Unit`, `To base factor`, `Sort order`, `Active`.
- Inline validation and duplicate unit prevention.
- Example preview: "1 carton = 10 pack = 25 m2".

Add optional legal unit-price section:
- Toggle enable.
- Reference unit selector (`kg`, `l`, `m2`, `m3`, `pc`).
- Base quantity for one reference unit.

### 10.2 Sales Line Dialog (`/backend/sales/documents/[id]`)

In line item dialog:
- Add unit selector for selected product (base + product conversions).
- Keep quantity input.
- Show normalized preview (read-only): `Entered X UNIT -> Y BASE_UNIT`.
- Keep price mode controls.
- If unit changes, recalculate display and re-resolve candidate prices.

Keyboard/accessibility:
- Preserve `Cmd/Ctrl+Enter` submit and `Escape` cancel.
- Announce conversion errors in form error region.

### 10.3 Items Table (`ItemsSection`)

Display format:
- Quantity column: `enteredQuantity enteredUnit`.
- Secondary line: `normalizedQuantity baseUnit` when different.
- Optional unit-price display line if product config enabled.

### 10.4 Public Quote (`/frontend/quote/[token]`)

- Continue showing entered quantity + entered unit.
- Optionally show legal unit-price line when snapshot contains reference pricing.

### 10.5 i18n Requirements

All new strings must use locale keys. Required namespaces:
- `catalog.products.uom.*`
- `catalog.products.unitPrice.*`
- `sales.documents.items.uom.*`
- `sales.documents.items.errors.uom.*`
- `sales.quotes.public.unitPrice.*`

---

## 11) Pricing and Calculation Semantics

### 11.1 Canonical Formulas

Normalization:

```text
normalizedQuantity = round(enteredQuantity * toBaseFactor, scale, mode)
```

Line totals remain commercial-entry based:

```text
lineNet = enteredQuantity * unitPriceNet
lineGross = enteredQuantity * unitPriceGross
```

Tier selection quantity context:

```text
pricingContext.quantity = normalizedQuantity
```

### 11.2 Rounding Rules

- Storage precision for normalized quantities: scale up to `6`.
- Product-level rounding policy controls normalization result.
- Calculation services continue monetary rounding to existing 4-decimal strategy unless separately revised.

### 11.3 Snapshot Rule

- At line upsert, persist `uom_snapshot`.
- Downstream documents copy snapshot from source line.
- Catalog conversion edits do not mutate historical snapshots.

---

## 12) EU Unit-Price Model (Optional)

### 12.1 Product Configuration

When enabled on product:
- `referenceUnit` must be one of: `kg`, `l`, `m2`, `m3`, `pc`.
- `baseQuantity` defines how many base units equal `1 referenceUnit`.

### 12.2 Calculation

For a line with entered unit and `toBaseFactor`:

```text
grossPerBase = unitPriceGross / toBaseFactor
grossPerReference = grossPerBase * unitPriceBaseQuantity
```

Same for net amount.

### 12.3 Display Rules

- Show only when product config is valid and snapshot contains calculation data.
- If config invalid or missing, hide display (do not block document save in v1 unless explicit validation path is requested on product save).

---

## 13) ACL and Authorization

v1 keeps existing feature model; no mandatory new feature IDs.

| Action | Route/UI | Required Feature |
| --- | --- | --- |
| View product UoM data | Product list/detail | `catalog.products.view` |
| Manage product UoM defaults | Product create/edit | `catalog.products.manage` |
| Manage conversions | `/api/catalog/product-unit-conversions` | `catalog.products.manage` |
| Manage legal unit-price settings | Product create/edit | `catalog.products.manage` |
| Use UoM in sales lines | Quote/order line upsert | `sales.quotes.manage` / `sales.orders.manage` |
| Edit dictionary units | Dictionaries module | `dictionaries.manage` |

Future option (deferred): granular `catalog.uom.manage` feature.

---

## 14) Events, Search, Cache, and Operations

### 14.1 Events

Catalog:
- Emit conversion CRUD events for automation and indexing triggers.
- Reuse `catalog.product.updated` with explicit UoM change metadata.

Sales:
- Reuse existing line/document events with payload extension for normalized fields.

### 14.2 Search Impact

Catalog search (`catalog/search.ts`):
- Include `default_unit`, `default_sales_unit`, reference unit-price metadata in indexed text/presenter subtitles.

Sales search (`sales/search.ts`):
- Include `quantity_unit`, `normalized_quantity`, `normalized_unit` for order/quote/invoice/credit memo lines.

### 14.3 Cache Strategy

No dedicated distributed cache module introduction in v1.

Read path cache plan:

| Read Path | Strategy | TTL | Cache Key Scope | Miss Behavior |
| --- | --- | --- | --- | --- |
| Product conversion map by product | In-process memory cache (optional) | 300s | `tenantId:organizationId:productId` | Fallback to DB point/range queries; rebuild map |
| Unit dictionary (`unit`) | Existing dictionary read cache (if enabled) | 86400s | `tenantId:organizationId:key` | Fallback to dictionary query route |
| Product detail/list UoM fields | No new cache in v1 | N/A | N/A | Direct DB read |

If/when cache tags are used by affected routes, required invalidation chain:
- Product write -> invalidate product detail/list and conversion read models.
- Conversion write -> invalidate product UoM projections and sales line product-lookup caches.
- Sales line write -> invalidate document detail read model and any unit-price display projection cache.

All cache keys/tags must include tenant/org scope.

### 14.4 Operational Considerations

- Conversion lookup should be O(1) by in-memory map per product in request scope.
- Guard against numeric overflow and precision drift.
- Add logs/metrics for conversion-missing errors and reference unit-price computation failures.

### 14.5 Security and Data Protection Controls

- Input validation:
  - All new request payloads MUST be validated via zod schemas before business logic and persistence.
- Query safety:
  - Use ORM/query-engine parameterized conditions only; no raw interpolated SQL for unit/conversion filtering.
- Output and rendering safety:
  - UoM/unit-price strings rendered through React escaping by default; no unsafe HTML rendering of user-provided fields.
  - URLs generated with encoded IDs (`encodeURIComponent`) in route builders.
- PII and encryption:
  - UoM data itself is non-PII; no new sensitive columns are introduced by this spec.
  - Existing customer/product reads in affected flows continue using existing encrypted-read patterns where applicable (`findWithDecryption` / `findOneWithDecryption`).
- Authentication/authorization:
  - Keep `requireAuth` + `requireFeatures` guards on all non-public routes.
- Logging and secrets:
  - Never log credentials/tokens; validation errors should not leak sensitive internals.
- Tenant isolation:
  - Every conversion and line normalization read/write must filter by `organization_id` and `tenant_id`.

### 14.6 Scale and Performance Constraints

- N+1 target query budgets:
  - Product detail with conversions: <= 3 queries (product, conversions, optional dictionary cache miss).
  - Sales line upsert with conversion and pricing resolution: <= 5 queries typical.
- Large list behavior:
  - Existing list APIs stay with page/pageSize for v1 compatibility and cap at `<= 100`.
  - Cursor/keyset pagination is deferred and explicitly out of scope where cardinality is bounded.
- Schema growth guardrails:
  - Conversion rows are bounded operationally per product (target < 100); no unbounded nested arrays are introduced in write payloads.
- Background work threshold:
  - Backfill operations touching >1000 rows must execute chunked and resumable; use worker path when operationally required.
- Compound command threshold:
  - Multi-entity UoM changes in one UX flow (product + conversions) should use compound/graph orchestration to avoid partial commits.

---

## 15) Integration Coverage Matrix

This section is mandatory for implementation and QA planning.

### 15.1 API Coverage Matrix

| API Path Family | Required Scenarios |
| --- | --- |
| `/api/catalog/products` | Create/update/read product with base unit, default sales unit, unit-price optional config |
| `/api/catalog/product-unit-conversions` | CRUD success, duplicate prevention, invalid factor, unknown unit |
| `/api/catalog/prices` + product pricing resolution | Tier selection uses normalized quantity context |
| `/api/sales/quote-lines` | Line creation in non-base unit, normalized fields persisted, snapshot written |
| `/api/sales/order-lines` | Same as quote-lines + update path |
| `/api/sales/quotes/convert` | Quote to order preserves UoM snapshot |
| Invoice/credit memo APIs | Propagate normalized fields and snapshots from source lines |
| `/api/sales/quotes/public/[token]` | Public payload includes unit and optional unit-price display fields |

### 15.2 Key UI Coverage Matrix

| UI Path | Required Scenarios |
| --- | --- |
| `/backend/catalog/products/create` | Configure base/sales units and conversions, save success |
| `/backend/catalog/products/[id]` | Edit conversions, validate conflicts, save and reload consistency |
| `/backend/sales/documents/[id]` (quote) | Add line in sales unit, preview normalized quantity, save |
| `/backend/sales/documents/[id]` (order) | Edit line unit/qty, recalc and persist snapshot |
| `/frontend/quote/[token]` | Render entered unit and optional unit-price display |

### 15.3 Fixture and Isolation Strategy

- Integration tests must create products, conversions, and documents via API fixtures.
- No dependency on seeded demo products.
- Every test cleans up created entities in `finally`/teardown.

### 15.4 Minimum Acceptance Matrix

1. Base-only product setup.
2. Multi-level packaging setup (pack -> carton -> pallet via factors to base).
3. Sales line in non-base unit with deterministic normalized quantity.
4. Tier pricing decision based on normalized quantity.
5. Validation failures: missing base mapping, duplicate unit, invalid factor, precision overflow.
6. ACL denial for unauthorized conversion management.
7. Optional EU unit-price display enabled path.
8. Optional EU unit-price disabled path.
9. Backward compatibility with legacy rows (no snapshot).
10. Tenant isolation and no cross-org conversion leakage.

---

## 16) Implementation Plan (For Future Coding Phase)

### Phase 1: Schema and Domain Foundation
1. Add catalog product columns and conversion entity.
2. Add sales line normalized fields and snapshots.
3. Generate migration with backfill operations.

### Phase 2: Catalog APIs and Commands
1. Extend product validators and commands.
2. Add conversion CRUD route and command handlers.
3. Update OpenAPI schemas.

### Phase 3: Sales Calculations and Line Commands
1. Extend quote/order line upsert command logic.
2. Persist normalized fields and snapshot.
3. Propagate to invoice/credit memo generation paths.

### Phase 4: UI Delivery
1. Product create/edit UoM sections and conversion editor.
2. Sales line dialog unit selector and normalized preview.
3. Items table and public quote display updates.

### Phase 5: Search/Events/Hardening
1. Extend search indexing fields and presenters.
2. Emit/consume new conversion events.
3. Add metrics/logging around conversion failures.

### Phase 6: Integration Testing and QA
1. Implement matrix coverage in Playwright/API integration tests.
2. Verify migration/backward compatibility scenarios.
3. Final regression on catalog and sales core flows.

### File Manifest (Planned)

| File | Action | Purpose |
| --- | --- | --- |
| `packages/core/src/modules/catalog/data/entities.ts` | Modify | Product UoM fields + conversion entity |
| `packages/core/src/modules/catalog/data/validators.ts` | Modify | Product/conversion payload schemas |
| `packages/core/src/modules/catalog/commands/products.ts` | Modify | Persist product UoM/unit-price config |
| `packages/core/src/modules/catalog/api/products/route.ts` | Modify | Expose new product fields |
| `packages/core/src/modules/catalog/api/product-unit-conversions/route.ts` | Create | Conversion CRUD API |
| `packages/core/src/modules/catalog/events.ts` | Modify | Conversion event IDs |
| `packages/core/src/modules/catalog/search.ts` | Modify | UoM search fields |
| `packages/core/src/modules/sales/data/entities.ts` | Modify | Normalized fields + `uom_snapshot` |
| `packages/core/src/modules/sales/data/validators.ts` | Modify | Sales line UoM-aware schema updates |
| `packages/core/src/modules/sales/commands/documents.ts` | Modify | Normalize quantity and snapshot persistence |
| `packages/core/src/modules/sales/lib/calculations.ts` | Modify | Consume normalized quantity context where required |
| `packages/core/src/modules/sales/api/order-lines/route.ts` | Modify | Response schema extensions |
| `packages/core/src/modules/sales/api/quote-lines/route.ts` | Modify | Response schema extensions |
| `packages/core/src/modules/sales/api/quotes/public/[token]/route.ts` | Modify | Public payload unit-price fields |
| `packages/core/src/modules/catalog/backend/catalog/products/create/page.tsx` | Modify | Product UoM UI |
| `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` | Modify | Product UoM edit UI |
| `packages/core/src/modules/sales/components/documents/LineItemDialog.tsx` | Modify | Unit selector + preview |
| `packages/core/src/modules/sales/components/documents/ItemsSection.tsx` | Modify | Unit-aware rendering |
| `packages/core/src/modules/catalog/lib/seeds.ts` | Modify | Ensure needed default units available |
| `packages/core/src/modules/core/__integration__/...` | Modify/Create | Integration fixtures/tests for UoM |

---

## 17) Testing Strategy

### 17.1 Unit Tests

- Conversion normalization utility tests.
- Product conversion validation tests (duplicate, invalid factor, missing base unit).
- Unit-price reference formula tests.

### 17.2 Integration Tests (API + UI)

Representative test IDs:
- `TC-CAT-UOM-001`: product with base unit + conversions CRUD.
- `TC-CAT-UOM-002`: conversion validation failures.
- `TC-SALES-UOM-001`: quote line in non-base unit stores normalized fields.
- `TC-SALES-UOM-002`: quote -> order preserves snapshot.
- `TC-SALES-UOM-003`: invoice inherits normalized semantics.
- `TC-SALES-UOM-004`: tier pricing uses normalized quantity.
- `TC-SALES-UOM-005`: ACL denies unauthorized conversion edits.
- `TC-SALES-UOM-006`: optional legal unit-price display path.
- `TC-SALES-UOM-007`: backward compatibility with legacy records.
- `TC-SALES-UOM-008`: cross-tenant data isolation.

### 17.3 Performance/Scale Checks

- Bulk product list with UoM fields enabled.
- Pricing resolution latency with large conversion catalog per product (up to 50 conversion rows).

---

## 18) Migration and Compatibility

### 18.1 Compatibility Guarantees

- Existing clients sending only `quantity` remain supported.
- Existing documents remain readable without `uom_snapshot`.
- Existing `defaultUnit` field semantics are preserved.

### 18.2 Deployment Plan

1. Deploy additive schema migration.
2. Deploy read/write code with compatibility fallbacks.
3. Run backfill script for normalized fields and product defaults.
4. Enable UI sections after API readiness.

### 18.3 Rollback Considerations

- Application rollback safe while additive columns remain.
- Data written to new columns is ignored by old code without integrity loss.

---

## 19) Risks & Impact Review

### 19.1 Data Integrity Failures

- Risk of inconsistent normalization if factor lookup fails mid-command.
- Risk of stale conversion assumptions when product config changes frequently.

### 19.2 Cascading Failures and Side Effects

- Pricing tier mismatch if normalization context is omitted in one call path.
- Event subscribers may miss new payload fields if parsing is strict.

### 19.3 Tenant and Isolation Risks

- Conversion lookup must always include tenant/org scope.
- Shared dictionary access must not leak organization-specific dictionary precedence.

### 19.4 Migration and Deployment Risks

- Large-line-table backfill duration could impact deploy windows.
- Numeric precision mismatch across DB and runtime conversion routines.

### 19.5 Operational Risks

- Error storms from invalid product conversion configuration.
- Increased support load if UI allows ambiguous setup.

### 19.6 Risk Register

#### Normalization Mismatch Across Call Paths
- **Scenario**: Some sales line write path computes normalized quantity, another path does not.
- **Severity**: High
- **Affected area**: Sales line APIs, pricing, documents
- **Mitigation**: Centralize normalization in shared service invoked by all line upsert flows; add integration tests for all line entry paths.
- **Residual risk**: Medium until all legacy mutation paths are audited.

#### Conversion Record Drift After Document Creation
- **Scenario**: Product conversion updated after quote creation changes displayed semantics unexpectedly.
- **Severity**: High
- **Affected area**: Quote/order/invoice legal and commercial correctness
- **Mitigation**: Persist immutable `uom_snapshot` on lines and propagate downstream.
- **Residual risk**: Low.

#### Cross-Tenant Conversion Leakage
- **Scenario**: Conversion lookup misses `organization_id` filter.
- **Severity**: Critical
- **Affected area**: Security and tenant isolation
- **Mitigation**: Enforce scoped CRUD factory fields and scoped queries in services; add cross-tenant integration tests.
- **Residual risk**: Low.

#### Numeric Overflow/Precision Loss
- **Scenario**: Very large quantity and factor overflow DB numeric precision.
- **Severity**: Medium
- **Affected area**: Line writes/calculations
- **Mitigation**: zod bounds, DB precision constraints, explicit overflow error mapping.
- **Residual risk**: Low.

#### Tier Pricing Regression
- **Scenario**: Existing price rules behave differently when normalized quantity is introduced.
- **Severity**: Medium
- **Affected area**: Catalog pricing and sales quoting
- **Mitigation**: Backward-compatible fallback (`normalized == entered` where no conversion), regression tests on legacy products.
- **Residual risk**: Medium for edge catalogs with implicit assumptions.

#### EU Unit-Price Misconfiguration
- **Scenario**: Product enables unit-price but lacks valid reference quantity mapping.
- **Severity**: Medium
- **Affected area**: Product UI/legal display
- **Mitigation**: Strong product validation and clear UI errors; display suppressed on invalid snapshot data.
- **Residual risk**: Low.

#### Search Result Quality Regression
- **Scenario**: Added unit fields pollute search ranking.
- **Severity**: Low
- **Affected area**: Search UX
- **Mitigation**: Add field policy tuning and targeted relevance checks.
- **Residual risk**: Low.

#### Migration Runtime Overrun
- **Scenario**: Backfill on large sales line tables exceeds maintenance window.
- **Severity**: High
- **Affected area**: Deployment operations
- **Mitigation**: Chunked backfill with resume checkpoints; deploy code with null-safe fallback before full backfill completion.
- **Residual risk**: Medium.

---

## 20) Self-Check (spec-writing skill)

### 20.1 Checklist Outcome Summary

| Checklist Area | Status | Notes |
| --- | --- | --- |
| Design Logic & Phasing | Pass | Scope, MVP boundaries, phased rollout, and use cases are explicit |
| Architecture & Module Isolation | Pass | FK-only cross-module references, tenant scoping, DI/service boundaries documented |
| Data Integrity & Security | Pass | Transaction boundaries, zod validation, auth guards, query safety, and output/logging constraints documented |
| Commands, Events & Naming | Pass | All mutations command-driven; new command names singular; undo and side-effect reversibility matrix added |
| API, UI & Compatibility | Pass | Contracts, OpenAPI expectations, i18n keys, migration/backward compatibility are explicit |
| Performance, Cache & Scale | Pass | Index strategy, N+1 budgets, TTL/miss behavior, chunking threshold documented |
| Risks & Impact | Pass | Scenario-based register with severity/mitigation/residual risk present |

### 20.2 Explicit N/A Decisions

- Cursor/keyset pagination is N/A for product conversion listing in v1 due bounded cardinality (<100 rows/product) and compatibility with existing CRUD pagination conventions.
- No dedicated distributed cache module in v1; optional in-process cache is sufficient for bounded conversion lookups.

### 20.3 Residual Gaps to Re-check During Implementation

1. Ensure every sales line write path funnels through the same normalization service (no bypass path).
2. Validate that quote->order->invoice/credit flows copy `uom_snapshot` in all edge transitions.
3. Confirm no legacy API caller depends on pre-normalization tier behavior without explicit migration note.

---

## Final Compliance Report - 2026-02-18

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/search/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No new cross-module ORM relations introduced in spec |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All new entities/routes explicitly scoped |
| root AGENTS.md | Validate inputs with zod | Compliant | API contract sections require zod schema updates |
| root AGENTS.md | Use DI and avoid ad-hoc instantiation | Compliant | UoM normalization specified as service responsibility |
| packages/core/AGENTS.md | API routes must export `openApi` | Compliant | Explicit OpenAPI delta listed for all impacted families |
| packages/core/AGENTS.md | CRUD conventions and route metadata | Compliant | New conversion CRUD follows existing route patterns |
| packages/core/src/modules/catalog/AGENTS.md | Reuse pricing resolver patterns | Compliant | Spec extends context to normalized quantity without replacing resolver architecture |
| packages/core/src/modules/sales/AGENTS.md | Keep document flow consistency | Compliant | Snapshot propagation rules defined quote->order->invoice/credit |
| packages/ui/AGENTS.md | Backend UI patterns and dialog keybindings | Compliant | `Cmd/Ctrl+Enter` and `Escape` explicitly preserved |
| packages/search/AGENTS.md | Search config and indexing consistency | Compliant | Search field updates and field policy adjustments defined |
| .ai/qa/AGENTS.md | Integration tests must be self-contained | Compliant | Fixture/teardown strategy explicitly required |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | New columns and response/request fields are aligned |
| API contracts match UI/UX section | Pass | Product and line dialog fields map to API deltas |
| Risks cover all write operations | Pass | Product save, conversion CRUD, line upsert, migration all covered |
| Commands defined for all mutations | Pass | Existing and new command IDs listed |
| Cache strategy covers read APIs | Pass | TTL, scope keys, miss behavior, and invalidation chain documented |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved - ready for implementation.

---

## Changelog

### 2026-02-18
- Initial specification for Units of Measure and product-level conversions in `catalog` + `sales` core.
- Added API/UI/data model contracts, integration coverage matrix, risks, and compliance report.
- Added self-check remediation details for undo contract, security controls, cache TTL/miss behavior, and scale constraints.

### Review - 2026-02-18
- **Reviewer**: Agent
- **Security**: Passed (zod validation, auth guards, output/logging constraints, tenant isolation checks documented)
- **Performance**: Passed (query budgets, bounded cardinality, backfill chunking constraints documented)
- **Cache**: Passed (TTL, tenant-scoped keys, miss fallback, and invalidation chain documented)
- **Commands**: Passed (singular naming for new commands, undo/rollback matrix, side-effect reversibility documented)
- **Risks**: Passed
- **Verdict**: Approved
