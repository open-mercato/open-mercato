# Catalog Compliance & Commercial Product Fields (PL/EU batch)

## TLDR
**Key Points:**
- Close 13 small gaps from `CATALOG_GAP_ANALYSIS` (2026-04-21) in one additive, catalog-only batch: Polish/EU compliance codes, safety/restriction flags, lifecycle/availability dates, B2B commercial constraints, and SEO fields on `catalog_products`, plus structured GTIN typing and HS code on `catalog_product_variants`.
- Quantity-focused by design (Open Mercato business approach): every field is an additive nullable column or defaulted boolean — the product card exposes the data, downstream modules (KSeF invoicing, feeds, carriers, sales cart) consume it later.
- Polish market first: GTU codes (JPK_V7/KSeF, mandatory 2026-02/04), PKWiU/CN (KSeF FA(3)), country of origin (GPSR), excise/age flags — the fields Comarch Optima, Enova365, and Subiekt nexo ship on their product cards.

**Scope (gap IDs from `CATALOG_GAP_ANALYSIS.preview.html`):**
- G-8.1 GTU codes (P0 🇵🇱) — `gtu_codes` (GTU_01..GTU_13)
- G-5.3 PKWiU / CN codes (P1 🇵🇱🇪🇺) — `pkwiu_code`, `cn_code`
- G-8.2 KSeF product codes (P0 🇵🇱) — covered by G-8.1 + G-5.3 exposure (catalog's role is to expose the data)
- G-3.6 Country of origin (P0 🇪🇺) — `country_of_origin_code`
- G-5.4 HS code (P1 🇪🇺) — `hs_code` on products and variants
- G-5.5 Tax classification (P2 🇵🇱) — `tax_classification_code`
- G-8.5 Excise / age-restricted (P1 🇵🇱🇪🇺) — `age_min`, `is_excise_good`, `excise_category`, `requires_prescription`
- G-8.6 Hazmat (P1 🇪🇺) — `hazmat_class`, `un_number`, `hazmat_packing_group`, `contains_lithium_battery`
- G-3.8 Lifecycle dates (P2) — `launch_at`, `end_of_life_at`, `available_from`, `available_until`
- G-7.5 Order quantity constraints (P1) — `min_order_qty`, `max_order_qty`, `order_qty_increment`
- G-9.7 Requires shipping (P1) — `requires_shipping`
- G-7.3 Quote-only / price-on-request (P1) — `is_quote_only` + resolved-price suppression in product list/detail decoration
- G-13.2 SEO fields (P1) — `seo_title`, `seo_description`, `canonical_url` (follow-on to SPEC-071 validation UX)
- G-3.3 GTIN identifier typing (P0) — `gtin_type` on variants + tenant-scoped partial unique index on `(tenant_id, organization_id, gtin_type, barcode)`

**Out of scope (follow-ups, deliberately):**
- Sales-cart enforcement of `min_order_qty`/`max_order_qty`/`order_qty_increment`/`age_min` (sales module change; data-first here)
- Quote-request flow for `is_quote_only` (sales/quotes integration)
- G-3.9 product code side-table, G-7.10 price-kind `displayMode: 'both'`, G-4.2 variant option-value enforcement (behavioral BC risk / new entity surface)
- Marketplace feeds, KSeF emitters, carrier integrations that will consume these fields
- Search facet/index changes (`search.ts` untouched; base columns are query-engine-served)

**Concerns:**
- The product command file (`commands/products.ts`) maps fields in seven places (snapshot type, load, seed, apply, create, update, audit change-key list) — mechanical but must be exhaustive, or undo/redo/audit silently drops fields. Mitigated by a command-level unit test asserting round-trip of new fields.

## Overview
Open Mercato's primary buyers today are Polish/EU businesses. The catalog gap analysis (benchmark: Shopify, Medusa, Saleor, Odoo, Akeneo, Comarch, Subiekt) found the catalog module architecturally strong but lacking the breadth of product-card data every Polish ERP ships: GTU codes for JPK_V7, PKWiU/CN for KSeF FA(3) (mandatory 2026-02-01/2026-04-01), GPSR-driven country of origin, excise/age flags, hazmat data for carriers, plus commercial basics (min order qty, quote-only) and SEO fields. This spec lands all of them as one additive batch on the existing product/variant entities — no new modules, entities, events, or ACL features.

> **Market Reference**: Comarch ERP Optima & Subiekt nexo (product-card compliance fields: GTU, PKWiU, excise), Shopify (variant `barcode` + GTIN convention, `requires_shipping`, `seo`), Odoo (HS code, lifecycle dates, min qty), Medusa v2 (additive nullable columns over existing product model). Adopted: flat additive columns on the product card. Rejected: Akeneo-style attribute-set scoping of these fields (depends on G-4.1 product families, L-effort) and a separate compliance extension entity (overkill for scalar codes; harder to filter/export).

## Problem Statement
1. A merchant on Open Mercato cannot legally produce a complete KSeF FA(3)/JPK_V7 invoice line because the product carries no GTU, PKWiU, or CN codes (G-8.1, G-5.3, G-8.2). KSeF becomes mandatory for all taxpayers 2026-04-01.
2. GPSR (applicable since 2024-12-13) and customs/marketplace feeds require country of origin; nothing structured exists (G-3.6).
3. `CatalogProductVariant.barcode` is untyped free text — feeds that require GTIN/EAN (Allegro, Google Merchant) cannot trust it, and duplicates are not prevented (G-3.3).
4. Excise/age-restricted and hazmat products carry no flags, so storefront/POS/carrier integrations have nothing to enforce or forward (G-8.5, G-8.6).
5. B2B sellers cannot express minimum/maximum/increment order quantities or "price on request" — both table-stakes in Polish B2B (G-7.5, G-7.3).
6. No lifecycle/availability dates, no `requires_shipping` for digital goods, no per-product SEO fields (G-3.8, G-9.7, G-13.2).

## Proposed Solution
Additive-only extension of the two existing entities, flowing through every existing layer with no new architecture:

1. **Entities** — 26 new columns on `CatalogProduct`, 2 on `CatalogProductVariant`, plus one expression-based partial unique index for GTIN scope-uniqueness (pattern: `customers/data/entities.ts` expression indexes).
2. **Validators** — extend `productBaseSchema` / `variantCreateSchema` (`data/validators.ts`) with typed, conservative validation; new `lib/gtin.ts` checksum helper for EAN-8/EAN-13/UPC-A.
3. **Commands** — wire fields through `commands/products.ts` and `commands/variants.ts` (snapshot type, `loadProductSnapshot`, `productSeedFromSnapshot`, `applyProductSnapshot`, create `em.create`, update `if (parsed.X !== undefined)` blocks) so audit/undo/redo keep working.
4. **API** — add snake_case fields to the products/variants `list.fields` arrays and the OpenAPI list-item schemas in `api/products/route.ts` / `api/variants/route.ts`. `decorateProductsAfterList` suppresses resolved pricing for `is_quote_only` products (returns `pricing: null`; clients read `is_quote_only` from the item).
5. **UI** — one new shared client component `components/products/ProductComplianceSection.tsx` (props `{ values, errors, setValue }`, mirrors `ProductUomSection`), rendered as a new `compliance` step in the create wizard (`PRODUCT_FORM_STEPS` + `STEP_FIELD_MATCHERS`) and as new column-1 groups on the edit page. Variant pages get GTIN type select + HS code input next to barcode.
6. **i18n** — keys under `catalog.products.compliance.*` / `catalog.variants.fields.*` in `en/pl/de/es.json`; `seo_title`/`seo_description` declared translatable in `translations.ts`.
7. **Migration** — one catalog migration (add columns + GTIN partial unique index) + `.snapshot-open-mercato.json` update.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Flat columns on `catalog_products`, not an extension entity | Scalar codes/flags; need list filtering/export/feeds; matches the gap analysis' own recommendations ("additive nullable columns"); zero joins |
| `gtu_codes text[]` (Postgres array) | A product can carry multiple GTU markers; validator constrains to `GTU_01..GTU_13`; mirrors `workflows.assigned_to_roles` `text[]` style |
| GTIN typing reuses existing `barcode` column for the value | Gap G-3.3 explicitly says "keep existing `barcode` as the unparsed value" — no rename, BC-safe |
| Partial unique index `(tenant_id, organization_id, gtin_type, barcode) WHERE deleted_at IS NULL AND gtin_type IS NOT NULL AND barcode IS NOT NULL` | Uniqueness only when merchant declares a type; untyped barcodes stay unconstrained; soft-deleted rows excluded (per repo soft-delete-unique lesson) |
| GTIN checksum validated only when `gtin_type` ∈ {ean13, ean8, upc} | Strict where the standard defines a check digit; lenient (format-only) for isbn/asin/mpn; never validates legacy untyped barcodes |
| Quote-only suppression in `decorateProductsAfterList`, not the pricing resolver | `PricingContext` (`lib/pricing.ts`) has no product record; the decorate hook already holds the product row. Resolver contract (BC-frozen) untouched |
| `requires_shipping` default `true` (explicit column, not derived from `product_type`) | Gap G-9.7's own recommendation: supports mixed cases (physical product bundled with digital license); default preserves current behavior |
| Dates as `timestamptz` | Matches every existing date column on the entity |
| No new ACL features / events | Fields are product-card data covered by `catalog.products.manage`; `catalog.product.created/updated` events already fire with the record |
| No encryption maps | Product compliance codes are not personal/GDPR data |
| No upgrade action | DB defaults make existing rows valid; no admin-UI default changes |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Separate `CatalogProductComplianceInfo` extension entity | Joins on every list/export/feed read; G-3.5 GPSR responsible-person (which *does* warrant an entity) is explicitly deferred to its own spec |
| New `gtin_value` column instead of typing `barcode` | Duplicates data; gap analysis explicitly prescribes keeping `barcode` as the value |
| Implementing quote-only inside a `catalogPricingResolver` | Context lacks product fields; would force a per-resolution product fetch (N+1) or context type change on a frozen surface |
| Custom fields (`ce.ts`) instead of real columns | These are platform-level compliance fields consumed by future core flows (KSeF, feeds); custom fields are tenant-defined and not contractual |

## User Stories / Use Cases
- **A Polish merchant** wants to set GTU_01 and PKWiU on a vodka product so that the future KSeF/JPK_V7 invoice lines are legally complete.
- **A merchant selling to the EU** wants country of origin and HS code on products so customs declarations and marketplace feeds can be generated.
- **A B2B wholesaler** wants `min_order_qty` 10 / increment 10 and "price on request" on contract items so the storefront and sales team quote correctly.
- **A merchant with digital goods** wants `requires_shipping = false` so checkout can skip shipping for those lines.
- **An operator** wants to type a variant's EAN-13 and have the system reject typos (checksum) and duplicates within the organization.
- **A content manager** wants per-product SEO title/description (translatable) and a canonical URL for the storefront.

## Architecture
No new components. Data flows through the existing layers:

```
CrudForm (create wizard step / edit groups / variant form)
  → productFormSchema (client zod) → onSubmit payload (camelCase)
  → POST/PUT /api/catalog/products | /api/catalog/variants (makeCrudRoute)
  → productCreateSchema/productUpdateSchema | variantCreateSchema/variantUpdateSchema (server zod)
  → catalog.products.create|update / catalog.variants.create|update commands (audit + undo snapshots)
  → CatalogProduct / CatalogProductVariant (MikroORM)
  → GET list/detail (query engine, snake_case fields) → transformItem → decorateProductsAfterList (quote-only pricing suppression)
```

### Commands & Events
- Commands: existing `catalog.products.create|update|delete`, `catalog.variants.create|update|delete` — extended field maps, no new command IDs.
- Events: existing `catalog.product.created|updated|deleted`, `catalog.variant.*` — payload shape gains additive fields only.

## Data Models

### CatalogProduct (additive columns on `catalog_products`)
| Column | Type | Constraint / Default | Gap |
|--------|------|----------------------|-----|
| `country_of_origin_code` | text | null; ISO 3166-1 alpha-2 (uppercased) | G-3.6 |
| `pkwiu_code` | text | null; max 32 | G-5.3 |
| `cn_code` | text | null; max 32 | G-5.3 |
| `hs_code` | text | null; max 32 | G-5.4 |
| `tax_classification_code` | text | null; max 64 | G-5.5 |
| `gtu_codes` | text[] | null; values ∈ GTU_01..GTU_13, deduped | G-8.1 |
| `age_min` | smallint | null; 0–120 | G-8.5 |
| `is_excise_good` | boolean | not null default false | G-8.5 |
| `excise_category` | text | null; enum alcohol\|tobacco\|energy_drink\|fuel\|other | G-8.5 |
| `requires_prescription` | boolean | not null default false | G-8.5 |
| `hazmat_class` | text | null; max 32 | G-8.6 |
| `un_number` | text | null; `^(UN)?[0-9]{4}$` normalized to `UN####` | G-8.6 |
| `hazmat_packing_group` | text | null; enum I\|II\|III | G-8.6 |
| `contains_lithium_battery` | boolean | not null default false | G-8.6 |
| `launch_at` | timestamptz | null | G-3.8 |
| `end_of_life_at` | timestamptz | null; ≥ `launch_at` when both set | G-3.8 |
| `available_from` | timestamptz | null | G-3.8 |
| `available_until` | timestamptz | null; ≥ `available_from` when both set | G-3.8 |
| `min_order_qty` | integer | null; ≥ 1 | G-7.5 |
| `max_order_qty` | integer | null; ≥ 1, ≥ `min_order_qty` when both set | G-7.5 |
| `order_qty_increment` | integer | null; ≥ 1 | G-7.5 |
| `requires_shipping` | boolean | not null default true | G-9.7 |
| `is_quote_only` | boolean | not null default false | G-7.3 |
| `seo_title` | text | null; max 255; translatable | G-13.2 |
| `seo_description` | text | null; max 1000; translatable | G-13.2 |
| `canonical_url` | text | null; max 500; absolute `http(s)://` when set | G-13.2 |

Entity class: camelCase properties with `@Property({ name: '<snake>', ... })`; defaulted booleans added to `[OptionalProps]` (`isExciseGood`, `requiresPrescription`, `containsLithiumBattery`, `requiresShipping`, `isQuoteOnly`).

Range pairs (`min_order_qty`/`max_order_qty`, `launch_at`/`end_of_life_at`, `available_from`/`available_until`) are validated twice: payload-level zod refinements on the exported create/update schemas, **and a merged-state check in `catalog.products.update`** (payload value ?? stored value per side) — a partial `PUT` carrying only one half of a pair cannot invert a stored range (400 with `fieldErrors`, same contract as the variant GTIN merged-state check).

### CatalogProductVariant (additive columns on `catalog_product_variants`)
| Column | Type | Constraint / Default | Gap |
|--------|------|----------------------|-----|
| `gtin_type` | text | null; enum ean13\|ean8\|upc\|isbn\|asin\|mpn | G-3.3 |
| `hs_code` | text | null; max 32 | G-5.4 |

New expression index (mirrors `customers/data/entities.ts` style):
```sql
create unique index "catalog_product_variants_gtin_scope_unique"
  on "catalog_product_variants" ("tenant_id", "organization_id", "gtin_type", "barcode")
  where deleted_at is null and gtin_type is not null and barcode is not null
```
Validation when `gtin_type` is set: `barcode` required; checksum (GS1 mod-10) for ean13 (13 digits), ean8 (8), upc (12); isbn → 10 or 13 alphanumeric (dashes stripped); asin → `^[A-Z0-9]{10}$`; mpn → free text max 70. Because a `PUT` may carry only one of (`gtinType`, `barcode`) while the other lives in the DB, the **`catalog.variants.update` command re-validates the merged state** (payload value ?? record value) — payload-level zod alone cannot see the stored half. Unique-violation surfaces exactly like duplicate SKU: `rethrowVariantUniqueConstraint` extended to match `catalog_product_variants_gtin_scope_unique` → `CrudHttpError(400)` with `fieldErrors` and i18n key `catalog.variants.errors.gtinExists` (today an unmatched constraint would bubble as a raw 500).

## API Contracts
No new endpoints. Existing endpoints gain additive fields.

### `GET/POST/PUT/DELETE /api/catalog/products`
- `POST`/`PUT` request (camelCase, all optional): `countryOfOriginCode`, `pkwiuCode`, `cnCode`, `hsCode`, `taxClassificationCode`, `gtuCodes: string[]`, `ageMin`, `isExciseGood`, `exciseCategory`, `requiresPrescription`, `hazmatClass`, `unNumber`, `hazmatPackingGroup`, `containsLithiumBattery`, `launchAt`, `endOfLifeAt`, `availableFrom`, `availableUntil`, `minOrderQty`, `maxOrderQty`, `orderQtyIncrement`, `requiresShipping`, `isQuoteOnly`, `seoTitle`, `seoDescription`, `canonicalUrl`.
- `GET` list/detail items (snake_case, matching existing convention): the 26 columns above, added to `list.fields` and `productListItemSchema`.
- Behavior: when `is_quote_only` is true, `decorateProductsAfterList` returns `pricing: null` for that item (price withheld); the flag itself is in the payload.
- Validation errors: structured zod 400s with i18n message keys (`catalog.products.validation.*`).

### `GET/POST/PUT/DELETE /api/catalog/variants`
- `POST`/`PUT` request: `gtinType`, `hsCode` (optional).
- `GET` items: `gtin_type`, `hs_code` added.
- New 400s: invalid GTIN checksum/format for typed barcodes; missing barcode when `gtinType` set (validated against merged state on partial updates). Duplicate typed barcode in scope → `CrudHttpError(400)` with `fieldErrors.barcode` and message key `catalog.variants.errors.gtinExists` (same contract as duplicate SKU's `catalog.variants.errors.skuExists`).

## Internationalization (i18n)
- `catalog.products.compliance.*` — step/group titles, sub-section titles (`codes`, `safety`, `logistics`, `commercial`, `seo`), field labels, help texts.
- `catalog.products.validation.*` — new validation messages (gtuInvalid, countryCodeInvalid, unNumberInvalid, canonicalUrlInvalid, orderQtyRange, dateRange…).
- `catalog.variants.fields.gtinType`, `catalog.variants.fields.hsCode`, `catalog.variants.validation.gtinChecksum`, `catalog.variants.validation.gtinBarcodeRequired`, `catalog.variants.validation.gtinDuplicate`.
- All four locale files (`en`, `pl`, `de`, `es`) updated; `yarn i18n:check-sync` green. Polish translations are first-class (GTU/PKWiU/KSeF terms are Polish domain language).
- `translations.ts`: add `seoTitle`, `seoDescription` to the product's translatable fields (additive overlay).

## UI/UX
- **Create wizard** (`backend/catalog/products/create/page.tsx`): new step `compliance` appended to `PRODUCT_FORM_STEPS` (after `uom`, before `variants`), with `STEP_FIELD_MATCHERS.compliance` routing the new field ids; renders `<ProductComplianceSection values setValue errors />`.
- **Edit page** (`backend/catalog/products/[id]/page.tsx`): new column-1 group `compliance` (after `product-uom`) rendering the same component; initial-values mapping extended (snake_case API → camelCase form), submit payload extended.
- **Variant create/edit pages**: GTIN type `Select` + HS code `Input` beside the existing barcode field.
- `ProductComplianceSection` uses DS primitives only (`Input`, `Label`, `Select`, `Checkbox`, lucide icons), semantic tokens, no arbitrary values, no hardcoded status colors; checkbox/date/number inputs follow `ProductUomSection` idioms. All labels via `useT()`.
- GTU codes UI: multi-select checkbox grid of GTU_01..GTU_13 rendered as their statutory identifiers ("GTU 01"…"GTU 13" — locale-invariant codes Polish bookkeeping users select by number; per-code descriptions are a possible follow-up).
- Dialog/dirty-state behavior unchanged (CrudForm handles optimistic locking from `initialValues.updatedAt`; products/variants already expose `updated_at`).

## Migration & Compatibility
- One new migration in `packages/core/src/modules/catalog/migrations/` (alter `catalog_products` add 26 columns; alter `catalog_product_variants` add 2 columns; create the GTIN partial unique index) + `.snapshot-open-mercato.json` updated in the same change. `yarn db:generate` re-run must report `no changes` for catalog.
- **Hand-verify the emitted index DDL keeps the `WHERE` predicate**: a prior expression-index migration (customers `Migration20251030150038.ts`) shipped without its predicate while entity+snapshot declared it — the generator's "no changes" check does not validate shipped SQL. The GTIN index's soft-delete/`gtin_type is not null` clause is load-bearing; mirror the predicate-preserving unique-index migration style (e.g. ai_assistant `Migration20260419100521.ts`), writing the full `create unique index … where …` statement verbatim in the migration.
- All columns nullable or defaulted → zero backfill, zero downtime, old rows valid.
- BC surfaces check (BACKWARD_COMPATIBILITY.md): DB schema additive (#8 ✓), types additive-optional (#2 ✓), no event/ACL/route/DI/import-path changes, no generated-file contract changes. Existing `barcode` column untouched.
- Rollback: the migration's `down` drops the added columns + index.

## Implementation Plan

### Phase 1 — Backend (schema → validators → commands → API)
1. `data/entities.ts`: add product + variant properties and the expression index.
2. `lib/gtin.ts` (new): `normalizeGtinValue`, `validateGtin(type, value)` with GS1 mod-10; unit tests.
3. `data/validators.ts`: extend `productBaseSchema` with the new **unrefined** optional fields only; chain cross-field refinements (qty/date ranges) as a reusable `superRefine` fn on the exported `productCreateSchema`/`productUpdateSchema` (the existing `productUomCrossFieldRefinement` pattern — **never** refine the base schema itself: zod 4.4.3 throws on `.partial()` over refined objects, and `productUpdateSchema`/`variantUpdateSchema` both call `.partial()`). For variants: keep `variantCreateSchema` fields unrefined and apply the GTIN `superRefine` on the exported create/update schemas the same way. Export `GTU_CODES`, `EXCISE_CATEGORIES`, `HAZMAT_PACKING_GROUPS`, `GTIN_TYPES` consts.
4. `commands/products.ts`: extend the **seven** mapping sites — `ProductSnapshot`, `loadProductSnapshot`, `productSeedFromSnapshot`, `applyProductSnapshot`, create `em.create` block, update apply block, **and the update `buildLog` change-key list** (the inline `buildChanges` array, ~line 1769) so audit diffs include the new fields. Same for `commands/variants.ts` (snapshot/load/seed/apply/create/update + **`VARIANT_CHANGE_KEYS`**, variants.ts:85-100) plus: merged-state GTIN validation in update, and extend `rethrowVariantUniqueConstraint` to map the GTIN constraint to a 400 `fieldErrors` response (`catalog.variants.errors.gtinExists`).
5. `api/products/route.ts`: `list.fields` + `productListItemSchema` + quote-only suppression in `decorateProductsAfterList`. `api/variants/route.ts`: fields + item schema.
6. Migration + snapshot; `yarn db:generate` no-op check.
7. Unit tests: gtin helper; command-level round-trip of new fields in existing `commands/__tests__/products.update.test.ts` pattern; validator edge cases.

### Phase 2 — Admin UI + i18n
1. `components/products/productForm.ts`: extend `ProductFormValues`, `productFormSchema`, `BASE_INITIAL_VALUES`, add `compliance` to `PRODUCT_FORM_STEPS`.
2. `components/products/ProductComplianceSection.tsx` (new shared client component).
3. Create page: step matchers, step render, submit payload mapping. Edit page: group, initial-values mapping, submit payload mapping.
4. Variant pages + `variantForm.ts`: `gtinType`, `hsCode`.
5. i18n keys in 4 locales; `translations.ts` SEO fields; `yarn i18n:check-sync`.

### Phase 3 — Integration tests
Implement the Integration Test Coverage below; full verification gate.

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Backend | ✅ Implemented | `data/types.ts` (GTU/excise/hazmat/GTIN consts), `data/entities.ts` (+26 product cols, +2 variant cols, GTIN expression index), `lib/gtin.ts` (+ unit tests), `data/validators.ts` (unrefined bases + chained refinements per audit C-1/C-1b), `commands/products.ts` (all seven mapping sites incl. audit change keys), `commands/variants.ts` (seven sites + merged-state GTIN check + `gtinExists` constraint mapping), `api/products/route.ts` (fields + schema + quote-only pricing suppression in `decorateProductsAfterList`), `api/variants/route.ts`, `migrations/Migration20260611090000.ts` + snapshot (hand-verified predicate; `yarn db:generate` → `catalog: no changes`) |
| Phase 2 — Admin UI + i18n | ✅ Implemented | `components/products/ProductComplianceSection.tsx` (shared, DS-clean), `productForm.ts` (values/schema/defaults/steps + `buildComplianceProductPayload`/`complianceFormValuesFromApiRecord`), create wizard `compliance` step + matchers, edit page group + mappings, `variantForm.ts`/`VariantBuilder.tsx` GTIN type + HS code, `translations.ts` (+`seoTitle`,`seoDescription`), 64 i18n keys × en/pl/de/es (`i18n:check-sync` green) |
| Phase 3 — Integration tests | ✅ Implemented | `__integration__/TC-CAT-COMP-001..004` (product fields round-trip + validation 400s; variant GTIN incl. two-step merged-state and duplicate; quote-only pricing suppression; edit-page UI persistence) |

Unit tests: `lib/__tests__/gtin.test.ts`, `data/__tests__/validators.compliance.test.ts`, `commands/__tests__/products.compliance.test.ts`, `commands/__tests__/variants.gtin.test.ts` (34 tests green).

## Integration Test Coverage
Self-contained Playwright specs in `packages/core/src/modules/catalog/__integration__/` (fixtures created via API, cleaned up in `finally`; no seeded-data reliance):

**API paths**
- `TC-CAT-COMP-001` `/api/catalog/products` — create with full compliance payload → GET (`?id=`) asserts all 26 snake_case fields (lowercase country code is normalized to uppercase, GTU codes deduped+sorted, UN number normalized to `UN####`); partial PUT preserves untouched fields; clearing fields (null) works; invalid payloads → 400 (bad GTU value, 3-letter country code, `min_order_qty > max_order_qty`, `available_until < available_from`, bad `canonical_url`, bad `un_number`); **merged-state ranges**: `PUT { maxOrderQty }` below the stored `minOrderQty` → 400, `PUT { endOfLifeAt }` before the stored `launchAt` → 400, consistent pair carried together → 200; delete cleans up.
- `TC-CAT-COMP-002` `/api/catalog/variants` — create variant with `gtinType: 'ean13'` + valid barcode → round-trip; invalid checksum → 400; `gtinType` without barcode → 400; **two-step partial update**: create with barcode only, then `PUT { gtinType }` alone → merged-state validation applies (invalid stored barcode → 400; valid → 200); duplicate (tenant, org, type, barcode) → 400 with `fieldErrors` (`gtinExists`); `hs_code` round-trip; untyped barcode (legacy) stays unvalidated and duplicable.
- `TC-CAT-COMP-003` `/api/catalog/products` quote-only — product with a price: baseline GET shows pricing; set `isQuoteOnly: true` → GET shows `pricing: null` while `is_quote_only: true` present; toggle back restores pricing.

**Key UI paths**
- `TC-CAT-COMP-004` product edit page — open `/backend/catalog/products/[id]`, compliance section visible; set country of origin + GTU codes + min order qty; save; reload; values persisted (CrudForm persistence-sweep pattern).

## Risks & Impact Review

### Data Integrity Failures
- Writes ride the existing command + `withAtomicFlush` transaction path; a mid-flight crash loses the whole update, never a partial column set.
- Concurrent edits: covered by existing optimistic locking (products/variants already expose `updated_at`; CrudForm sends the header).
- The GTIN partial unique index is enforced by Postgres; a race between two creates resolves to one structured duplicate error (same path as duplicate SKU).

### Cascading Failures & Side Effects
- Event payloads only gain fields — subscribers that destructure known fields are unaffected.
- Query index: products/variants are table-backed entity types in the hybrid query engine; new base columns are served from the table without reindex. `gtu_codes` is `text[]` — it is exposed in list responses but not added to filterables, so no query-shape risk.
- Quote-only suppression only changes items where the merchant explicitly sets the new flag (default false ⇒ zero behavior change for existing data).

### Tenant & Data Isolation Risks
- No new query paths; all reads/writes stay inside `makeCrudRoute`/commands with org+tenant scoping. The GTIN unique index includes `tenant_id, organization_id` — no cross-tenant uniqueness bleed.

### Migration & Deployment Risks
- Additive columns with defaults: `ALTER TABLE ... ADD COLUMN` with constant defaults is metadata-only on modern Postgres — no table rewrite, no downtime.
- Index creation on `catalog_product_variants` takes a brief lock; the partial predicate makes it small (only typed barcodes). Acceptable for the OSS migration path (consistent with every prior catalog index migration).
- If the migration fails halfway, it is transactional (single migration) and re-runnable.

### Operational Risks
- Blast radius: catalog module only; failure mode is a 400 on save (validator) — no background jobs, no event storms.
- Storage: ~26 mostly-null columns; negligible.

#### Risk: undo/redo/audit silently dropping new fields
- **Scenario**: a new column is missed in one of the seven mapping sites in `commands/products.ts` / `commands/variants.ts` (incl. the audit change-key lists); undo restores a stale value or audit diffs omit the field.
- **Severity**: Medium
- **Affected area**: catalog product/variant undo/redo, audit snapshots and diffs
- **Mitigation**: command unit test asserts create→update→undo round-trip for representative new fields (array, boolean, date, integer, text); reviewer checklist cross-checks the seven sites.
- **Residual risk**: low — mechanical omission caught by test or review.

#### Risk: client form drift (camelCase ⇄ snake_case mapping)
- **Scenario**: edit page initial-values mapping misses a field → form silently clears it on save (update sends `undefined` → command skips, so actually preserved; but UI shows empty).
- **Severity**: Low (server `!== undefined` guards prevent data loss)
- **Affected area**: product edit UI display
- **Mitigation**: TC-CAT-COMP-004 UI persistence test reloads and asserts values.
- **Residual risk**: cosmetic only.

#### Risk: GTIN uniqueness surprises on legacy data
- **Scenario**: a merchant has duplicate untyped barcodes; they type one of them and the second typed save fails.
- **Severity**: Low
- **Affected area**: variant editing
- **Mitigation**: uniqueness applies only when `gtin_type` is set (opt-in); error message is a clear i18n duplicate message.
- **Residual risk**: acceptable — this is exactly the integrity the gap asks for.

## Final Compliance Report — 2026-06-11

### AGENTS.md Files Reviewed
- `AGENTS.md` (root) — Task Router rows: Module-specific (catalog), CRUD API routes, CrudForm, migrations, i18n, optimistic locking, integration testing
- `packages/core/AGENTS.md` — Entity Schema And Migration Workflow, Translatable Fields, Commands, makeCrudRoute
- `packages/core/src/modules/catalog/AGENTS.md` — pricing pipeline rules, entity workflow, key directories
- `packages/core/src/modules/customers/AGENTS.md` — reference CRUD patterns (expression indexes, command undo)
- `packages/ui/AGENTS.md` — CrudForm guidelines
- `.ai/qa/AGENTS.md` — integration test workflow
- `.ai/ds-rules.md` / `.ai/ui-components.md` — DS canon for the new section

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | No cross-module references; all columns scalar |
| root AGENTS.md | Tenant/organization scoping everywhere | Compliant | Existing scoped routes/commands; GTIN index tenant+org scoped |
| root AGENTS.md | Zod validation in `data/validators.ts`, types via `z.infer` | Compliant | All new fields validated; enums exported as consts |
| root AGENTS.md | Optimistic locking on editable entities | Compliant | Existing `updated_at` + CrudForm auto-header; no new entities |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | All labels/messages via i18n keys, 4 locales |
| packages/core/AGENTS.md | Migration workflow: db:generate probe, scoped SQL + snapshot | Compliant | Phase 1 step 6 |
| packages/core/AGENTS.md | Domain writes through commands | Compliant | Extends existing commands; no route-level mutation |
| packages/core/AGENTS.md | Encryption maps for GDPR fields | N/A | Compliance codes are not personal data |
| catalog AGENTS.md | Never reimplement pricing inline; resolver priorities untouched | Compliant | Suppression in decorate hook; resolver pipeline untouched |
| catalog AGENTS.md | Standard event pattern | Compliant | No new events; payloads additive |
| packages/ui/AGENTS.md | CrudForm for edit/create; DS primitives | Compliant | Shared section component, DS tokens only |
| BACKWARD_COMPATIBILITY.md | DB schema additive-only (#8); types additive (#2) | Compliant | Nullable/defaulted columns; no renames/drops |
| .ai/qa/AGENTS.md | Self-contained integration tests in same change | Compliant | TC-CAT-COMP-001..004 in Phase 3 |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | snake_case list fields ↔ columns; camelCase write schema ↔ entity props |
| API contracts match UI/UX section | Pass | form values map 1:1 to write schema |
| Risks cover all write operations | Pass | product/variant create+update+undo |
| Commands defined for all mutations | Pass | existing commands extended |
| Cache strategy covers all read APIs | Pass | no new read paths; existing crud cache semantics unchanged |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation.

## Changelog
### 2026-06-11
- Initial specification (gap batch G-3.3, G-3.6, G-3.8, G-5.3, G-5.4, G-5.5, G-7.3, G-7.5, G-8.1, G-8.2-partial, G-8.5, G-8.6, G-9.7, G-13.2 from CATALOG_GAP_ANALYSIS 2026-04-21).
- Pre-implement audit fixes folded in (validator composition, seventh mapping site, merged-state GTIN check, migration predicate verification, duplicate-error contract).
- Implemented (Phases 1–3) same day; review fix: `gtuCodes` audit diff uses a serialized comparison in `buildLog` (strict `!==` in `buildChanges` cannot diff arrays); spec text aligned with normalization behavior (lowercase country codes accepted + uppercased) and statutory GTU code rendering.
- Cross-model review fix (Codex gpt-5.5): merged-state range validation added to `catalog.products.update` — partial PUTs carrying one half of a qty/date pair are re-validated against the stored half (mirrors the variant GTIN merged-state check); covered by a command unit test and a TC-CAT-COMP-001 case.
