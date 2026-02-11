# SPEC-023: Catalog Content Localization

## Overview

Extend the catalog module's localization capabilities from offer-only to the full product data model. Currently, `localizedContent` exists only on `CatalogOffer`, limiting multilingual support to channel-specific content. This specification introduces localization at the product, variant, option schema, and custom field levels — enabling platforms to serve multilingual markets regardless of their channel configuration.

## Problem Statement

Platforms that operate with a single sales channel but serve multilingual markets face friction:
- A product must have an offer (tied to a sales channel) before any translated content can be provided
- Base product content (`title`, `subtitle`, `description`) has no locale-specific variants
- Variant names, option labels, and custom field labels/values cannot be translated
- No resolution helpers exist to apply locale overlays when displaying content

## Proposed Solution

### Design Principles

1. **Reuse the proven `localizedContent` JSONB pattern** from `CatalogOffer`
2. **Backward compatible** — all new fields are nullable JSONB, existing data unaffected
3. **Fallback chain** — helpers resolve content through a priority chain, falling back to base fields
4. **Pure function resolvers** — immutable, no side effects, usable in API transforms and frontend
5. **Custom fields included** — both definition labels and text/multiline values are localizable

---

## Architecture

### Localization Layers

```
┌─────────────────────────────────────────────────────┐
│                   Resolution Layer                   │
│  resolveProductContent() / resolveVariantContent()   │
│  resolveCustomFieldLabel() / resolveCustomFieldValue()│
├─────────────────────────────────────────────────────┤
│                   Storage Layer                      │
│                                                      │
│  CatalogProduct.localizedContent      (JSONB, NEW)   │
│  CatalogProductVariant.localizedContent (JSONB, NEW) │
│  CatalogOffer.localizedContent        (JSONB, exists)│
│  CatalogOptionSchemaTemplate          (JSONB, NEW)   │
│    .localizedContent                                 │
│  CustomFieldDef.configJson            (JSONB, extend)│
│    .localizedLabels / .localizedOptions              │
│  CustomFieldValue.localizedValues     (JSONB, NEW)   │
├─────────────────────────────────────────────────────┤
│                   Base Fields                        │
│  product.title / subtitle / description              │
│  variant.name                                        │
│  offer.title / description                           │
│  optionDef.label / description / choices[].label     │
│  customFieldDef.configJson.label / description       │
│  customFieldValue.valueText / valueMultiline         │
└─────────────────────────────────────────────────────┘
```

---

## Data Models

### 1. CatalogProduct — new `localizedContent` field

**Entity:** `CatalogProduct` in `packages/core/src/modules/catalog/data/entities.ts`

```typescript
@Property({ name: 'localized_content', type: 'jsonb', nullable: true })
localizedContent?: CatalogProductLocalizedContent | null
```

**Type:**
```typescript
type CatalogProductContent = {
  title?: string | null
  subtitle?: string | null
  description?: string | null
}

type CatalogProductLocalizedContent = Record<string, CatalogProductContent>
// e.g. { "de": { title: "Recyceltes PP-Granulat", subtitle: "...", description: "..." } }
```

**Validation (zod):**
```typescript
const productContentSchema = z.object({
  title: z.string().trim().max(255).optional(),
  subtitle: z.string().trim().max(255).optional(),
  description: z.string().trim().max(4000).optional(),
})

// Added to productBaseSchema:
localizedContent: z.record(
  z.string().trim().min(2).max(10),  // locale code
  productContentSchema
).optional()
```

**Migration:** `ALTER TABLE catalog_products ADD COLUMN localized_content JSONB NULL`

---

### 2. CatalogProductVariant — new `localizedContent` field

**Entity:** `CatalogProductVariant` in `packages/core/src/modules/catalog/data/entities.ts`

```typescript
@Property({ name: 'localized_content', type: 'jsonb', nullable: true })
localizedContent?: CatalogVariantLocalizedContent | null
```

**Type:**
```typescript
type CatalogVariantContent = {
  name?: string | null
}

type CatalogVariantLocalizedContent = Record<string, CatalogVariantContent>
// e.g. { "de": { name: "Rot / XL" }, "es": { name: "Rojo / XL" } }
```

**Migration:** `ALTER TABLE catalog_product_variants ADD COLUMN localized_content JSONB NULL`

---

### 3. CatalogOffer — extend `localizedContent` with `subtitle`

**Current type:**
```typescript
type CatalogOfferContent = { title?: string | null; description?: string | null }
```

**Extended type:**
```typescript
type CatalogOfferContent = {
  title?: string | null
  subtitle?: string | null  // NEW
  description?: string | null
}
```

No migration needed — JSONB already stores arbitrary keys. Existing data without `subtitle` works via optional chaining.

---

### 4. CatalogOptionSchemaTemplate — new `localizedContent` field

**Entity:** `CatalogOptionSchemaTemplate` in `packages/core/src/modules/catalog/data/entities.ts`

```typescript
@Property({ name: 'localized_content', type: 'jsonb', nullable: true })
localizedContent?: CatalogOptionSchemaLocalizedContent | null
```

**Type:**
```typescript
type CatalogOptionSchemaLocalizedContent = Record<string, CatalogOptionSchemaLocaleContent>

type CatalogOptionSchemaLocaleContent = {
  name?: string | null          // template name
  description?: string | null   // template description
  options?: Record<string, {    // keyed by option code
    label?: string | null
    description?: string | null
    choices?: Record<string, string>  // keyed by choice code -> translated label
  }>
}

// Example:
// {
//   "de": {
//     name: "Größenoptionen",
//     options: {
//       "size": {
//         label: "Größe",
//         choices: { "s": "Klein", "m": "Mittel", "l": "Groß", "xl": "Sehr Groß" }
//       },
//       "color": {
//         label: "Farbe",
//         choices: { "red": "Rot", "blue": "Blau" }
//       }
//     }
//   }
// }
```

**Migration:** `ALTER TABLE catalog_product_option_schemas ADD COLUMN localized_content JSONB NULL`

---

### 5. CustomFieldDef — extend `configJson` with localized properties

**Entity:** `CustomFieldDef` in `packages/core/src/modules/entities/data/entities.ts`

No schema migration needed — `configJson` is JSONB. New optional properties added to `CustomFieldDefinition` type:

```typescript
// packages/shared/src/modules/entities.ts
type CustomFieldDefinition = {
  // ...existing fields...
  label?: string
  description?: string
  options?: Array<string | number | boolean | { value: string | number | boolean; label?: string | null }>

  // NEW: per-locale overrides for definition metadata
  localizedLabels?: Record<string, string>
  // e.g. { "de": "Material", "es": "Material", "pl": "Materiał" }

  localizedDescriptions?: Record<string, string>
  // e.g. { "de": "Hauptmaterial des Produkts" }

  localizedOptions?: Record<string, Record<string, string>>
  // locale -> { optionValue -> translatedLabel }
  // e.g. { "de": { "high": "Hoch", "medium": "Mittel", "low": "Niedrig" } }

  localizedGroupTitles?: Record<string, string>
  // e.g. { "de": "Technische Daten" }

  localizedGroupHints?: Record<string, string>
  // e.g. { "de": "Technische Spezifikationen des Produkts" }
}
```

---

### 6. CustomFieldValue — new `localizedValues` column

**Entity:** `CustomFieldValue` in `packages/core/src/modules/entities/data/entities.ts`

```typescript
@Property({ name: 'localized_values', type: 'jsonb', nullable: true })
localizedValues?: Record<string, string> | null
// { "de": "Recycelter Kunststoff", "es": "Plástico reciclado" }
```

**Applies to kind `text` and `multiline` only.** For `select`, `boolean`, `integer`, `float`, `dictionary`, `currency` — values are codes/numbers/booleans that don't need translation. Select display labels are translated at the definition level (`localizedOptions`).

**Migration:** `ALTER TABLE custom_field_values ADD COLUMN localized_values JSONB NULL`

**Validation:** Max 20 locales per value entry to prevent unbounded JSONB growth.

---

## Content Resolution Helpers

All helpers are **pure functions** returning **new objects** (immutable). Located in `packages/core/src/modules/catalog/lib/localization.ts` (catalog helpers) and `packages/shared/src/modules/entities/localization.ts` (custom field helpers).

### resolveProductContent

```typescript
function resolveProductContent(
  product: { title: string; subtitle?: string | null; description?: string | null; localizedContent?: Record<string, any> | null },
  locale?: string | null,
  offer?: { title: string; description?: string | null; localizedContent?: Record<string, any> | null } | null,
): { title: string; subtitle: string | null; description: string | null }
```

**Fallback chain per field:**
```
title:
  1. offer?.localizedContent?.[locale]?.title
  2. offer?.title
  3. product.localizedContent?.[locale]?.title
  4. product.title

subtitle:
  1. offer?.localizedContent?.[locale]?.subtitle
  2. product.localizedContent?.[locale]?.subtitle
  3. product.subtitle

description:
  1. offer?.localizedContent?.[locale]?.description
  2. offer?.description
  3. product.localizedContent?.[locale]?.description
  4. product.description
```

### resolveVariantContent

```typescript
function resolveVariantContent(
  variant: { name?: string | null; localizedContent?: Record<string, any> | null },
  product: { title: string; localizedContent?: Record<string, any> | null },
  locale?: string | null,
): { name: string }
```

**Fallback chain:**
```
name:
  1. variant.localizedContent?.[locale]?.name
  2. variant.name
  3. product.localizedContent?.[locale]?.title
  4. product.title
```

### resolveOptionLabel / resolveOptionChoiceLabel

```typescript
function resolveOptionLabel(
  optionDef: CatalogProductOptionDefinition,
  schemaLocalizedContent: CatalogOptionSchemaLocalizedContent | null | undefined,
  locale?: string | null,
): string
// Fallback: localizedContent[locale].options[code].label -> optionDef.label

function resolveOptionChoiceLabel(
  choice: CatalogProductOptionChoice,
  optionCode: string,
  schemaLocalizedContent: CatalogOptionSchemaLocalizedContent | null | undefined,
  locale?: string | null,
): string
// Fallback: localizedContent[locale].options[optionCode].choices[choice.code] -> choice.label -> choice.code
```

### resolveCustomFieldLabel / resolveCustomFieldValue

```typescript
// packages/shared/src/modules/entities/localization.ts

function resolveCustomFieldLabel(
  definition: CustomFieldDefinition,
  locale?: string | null,
): string
// Fallback: localizedLabels[locale] -> label -> key

function resolveCustomFieldDescription(
  definition: CustomFieldDefinition,
  locale?: string | null,
): string | null
// Fallback: localizedDescriptions[locale] -> description -> null

function resolveCustomFieldOptionLabel(
  option: { value: string; label?: string | null },
  definition: CustomFieldDefinition,
  locale?: string | null,
): string
// Fallback: localizedOptions[locale][option.value] -> option.label -> option.value

function resolveCustomFieldValue(
  value: { valueText?: string | null; valueMultiline?: string | null; localizedValues?: Record<string, string> | null },
  kind: string,
  locale?: string | null,
): string | number | boolean | null
// For text/multiline: localizedValues[locale] -> valueText/valueMultiline
// For other kinds: return raw value (no translation)
```

### resolveLocalizedProduct (higher-order)

```typescript
function resolveLocalizedProduct(
  product: CatalogProductRecord,
  options: { locale?: string | null; offer?: CatalogOfferRecord | null },
): ResolvedCatalogProduct
```

Resolves the entire product including variants and custom fields. Returns a new object with all translatable fields resolved for the given locale.

---

## API Contracts

### Product CRUD — extended request/response

**POST/PUT `/api/catalog/products`** — `localizedContent` added to request body:

```json
{
  "title": "Recycled PP Granulate",
  "subtitle": "High-quality recycled plastic",
  "description": "...",
  "localizedContent": {
    "de": { "title": "Recyceltes PP-Granulat", "subtitle": "Hochwertiger recycelter Kunststoff", "description": "..." },
    "es": { "title": "Granulado de PP reciclado", "subtitle": "Plástico reciclado de alta calidad" }
  }
}
```

**GET `/api/catalog/products`** — response includes `localizedContent`:

```json
{
  "id": "...",
  "title": "Recycled PP Granulate",
  "localizedContent": { "de": { "title": "Recyceltes PP-Granulat" } },
  "variants": [
    { "id": "...", "name": "1kg Bag", "localizedContent": { "de": { "name": "1kg Beutel" } } }
  ]
}
```

**GET `/api/catalog/products?locale=de`** — optional locale query parameter triggers resolution:

When `locale` is provided, the response returns **resolved** content (helpers applied), with `_locale` metadata:

```json
{
  "id": "...",
  "title": "Recyceltes PP-Granulat",
  "_locale": "de",
  "_originalTitle": "Recycled PP Granulate"
}
```

### Variant CRUD — extended request/response

Same pattern as product — `localizedContent` field added to variant create/update schemas.

### Custom Field API — extended with localization

**Custom field definition** create/update — `configJson` accepts localized properties:

```json
{
  "key": "material",
  "kind": "text",
  "label": "Material",
  "localizedLabels": { "de": "Material", "pl": "Materiał", "es": "Material" },
  "localizedDescriptions": { "de": "Hauptmaterial des Produkts" }
}
```

For select fields:
```json
{
  "key": "quality_grade",
  "kind": "select",
  "label": "Quality Grade",
  "options": [
    { "value": "high", "label": "High" },
    { "value": "medium", "label": "Medium" },
    { "value": "low", "label": "Low" }
  ],
  "localizedLabels": { "de": "Qualitätsstufe" },
  "localizedOptions": {
    "de": { "high": "Hoch", "medium": "Mittel", "low": "Niedrig" },
    "pl": { "high": "Wysoka", "medium": "Średnia", "low": "Niska" }
  }
}
```

**Custom field value** set — `localizedValues` alongside base value:

```json
{
  "cf_material": "Recycled Plastic",
  "cf_material__localized": {
    "de": "Recycelter Kunststoff",
    "es": "Plástico reciclado"
  }
}
```

---

## Integration with OpenMercato Features

### Commands (undoable)

**Files:**
- `packages/core/src/modules/catalog/commands/products.ts`
- `packages/core/src/modules/catalog/commands/variants.ts` (if exists, or extend products.ts)

Changes:
- Add `localizedContent` to `ProductSnapshot` / `VariantSnapshot` types
- Include `localizedContent` in `PRODUCT_CHANGE_KEYS` / `VARIANT_CHANGE_KEYS`
- Create command: store `localizedContent` from parsed input
- Update command: update `localizedContent` if provided
- Undo: restore from before snapshot

### Validators (zod)

**File:** `packages/core/src/modules/catalog/data/validators.ts`

- Extend `productBaseSchema` with `localizedContent` (same pattern as `offerBaseSchema`)
- Extend `variantBaseSchema` with `localizedContent`
- Add `localizedContent` to `optionSchemaBaseSchema`

### CRUD Routes

**Files:**
- `packages/core/src/modules/catalog/api/products/route.ts`
- `packages/core/src/modules/catalog/api/variants/route.ts` (if exists)
- `packages/core/src/modules/catalog/api/offers/route.ts` (subtitle addition)

Changes:
- Add `localized_content` to field lists
- Add to `transformItem` (snake_case -> camelCase)
- Optional `?locale=xx` query param to trigger resolution
- Update OpenAPI schemas

### Query Index

- Include `localized_content` in indexed `doc` for products and variants
- Enables future per-locale search indexing

### Audit Trail

- `localizedContent` tracked in change keys
- Full snapshot diff available in version history

### Encryption

**File:** `packages/core/src/modules/entities/lib/encryptionDefaults.ts`

- Add `localized_content` to encryption defaults for `catalog_products`, `catalog_product_variants`, `catalog_product_option_schemas`
- Add `localized_values` to encryption defaults for `custom_field_values`

### Events

Optional — emit `catalog.product.content.localized` when localizedContent is set/updated. Useful for triggering search reindexing or cache invalidation.

---

## UI/UX

### LocalizedContentEditor component

**Location:** `packages/ui/src/backend/inputs/LocalizedContentEditor.tsx`

Reusable component for editing `localizedContent` JSONB. Used in product, variant, offer, and option schema forms.

**Props:**
```typescript
type LocalizedContentEditorProps = {
  value: Record<string, Record<string, string | null>> | null
  onChange: (value: Record<string, Record<string, string | null>> | null) => void
  fields: Array<{ key: string; label: string; multiline?: boolean; maxLength?: number }>
  // e.g. [{ key: 'title', label: 'Title', maxLength: 255 }, { key: 'description', label: 'Description', multiline: true }]
}
```

**UX:**
- Collapsible locale sections (e.g. "DE - German", "ES - Spanish")
- "Add locale" button with locale code input or dropdown
- Remove locale button per section
- Fields rendered per locale matching the `fields` prop
- Empty state: "No translations added. Click 'Add locale' to start."

### Product edit form — "Translations" tab

Add a "Translations" tab on the product detail page (`packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx`).

Contains:
1. **Product translations** — `LocalizedContentEditor` with fields: title, subtitle, description
2. **Variant translations** — per variant, `LocalizedContentEditor` with field: name
3. **Option schema translations** — if product is configurable, `LocalizedContentEditor` for option labels/descriptions/choices

### Custom field definition editor — localization fields

Extend `FieldDefinitionsEditor.tsx` with:
- "Translations" section per field definition
- Per-locale label, description inputs
- Per-locale option label inputs (for select fields)

### Custom field value editor — per-locale inputs

When editing a text/multiline custom field value in a CRUD form:
- Base value input (existing)
- Expandable "Translations" section below
- Per-locale text input for each configured locale

---

## Alternatives Considered

### A. Localized options inside JSONB schema (rejected)

Adding `localizedLabels: Record<locale, string>` directly inside `CatalogProductOptionDefinition` within the `schema` JSONB. Rejected because:
- Increases complexity of an already nested JSONB structure
- Harder to query and validate
- Breaking change risk for existing schema data

### B. Separate translation table (rejected)

Creating a generic `translations` table (entity_id, field, locale, value). Rejected because:
- Adds JOINs to every read operation
- Breaks the JSONB pattern already established with offers
- More complex migration and query patterns

### C. Custom field values in parent `localizedContent` (rejected)

Storing CF translations in the parent record's `localizedContent` (e.g. `product.localizedContent.de["cf:material"]`). Rejected because:
- Mixes product content and CF content in the same JSONB
- CF values are managed by DataEngine, not product commands
- Violates separation of concerns

---

## Migration Path

1. **Database migrations** — 4 `ADD COLUMN` statements, all nullable JSONB, zero downtime
2. **No data migration needed** — existing records have `NULL` localizedContent, helpers fall back to base fields
3. **API backward compatible** — `localizedContent` is optional in all request schemas
4. **UI progressive** — translations tab appears but is empty by default

---

## Out of Scope (Phase 2 follow-ups)

- Default locale setting per tenant/organization
- Locale fallback chains (`de-AT` -> `de` -> `en`)
- Search indexing per locale (architecture designed, implementation deferred)
- Translation import/export (CSV/XLIFF)
- AI-assisted translation
- Media alt-text translations
- Category and tag localization (reference data — separate initiative)
- Locale-aware sorting in DataTable

---

## Files to Modify

### Catalog module (`packages/core/src/modules/catalog/`)
| File | Changes |
|------|---------|
| `data/entities.ts` | Add `localizedContent` to Product, Variant, OptionSchemaTemplate |
| `data/types.ts` | New types: `CatalogProductLocalizedContent`, `CatalogVariantLocalizedContent`, `CatalogOptionSchemaLocalizedContent`; extend `CatalogOfferContent` with `subtitle` |
| `data/validators.ts` | Add `localizedContent` to product/variant/optionSchema base schemas |
| `commands/products.ts` | Add `localizedContent` to snapshot, create, update, undo |
| `commands/offers.ts` | Update `CatalogOfferContent` references for subtitle |
| `api/products/route.ts` | Add `localized_content` field, transform, OpenAPI |
| `api/offers/route.ts` | Update for subtitle in localized content |
| `backend/catalog/products/[id]/page.tsx` | Add "Translations" tab |
| `search.ts` | Include `localized_content` in indexed doc (exclude from fulltext for now) |
| **NEW** `lib/localization.ts` | Resolution helpers |

### Entities module (`packages/core/src/modules/entities/`)
| File | Changes |
|------|---------|
| `data/entities.ts` | Add `localizedValues` to `CustomFieldValue` |
| `lib/helpers.ts` | Handle `localizedValues` in `setCustomFields` |

### Shared package (`packages/shared/`)
| File | Changes |
|------|---------|
| `src/modules/entities.ts` | Extend `CustomFieldDefinition` type with `localizedLabels`, `localizedDescriptions`, `localizedOptions`, `localizedGroupTitles`, `localizedGroupHints` |
| `src/modules/entities/options.ts` | Extend `CustomFieldOptionDto` |
| `src/lib/crud/custom-fields.ts` | Update `decorateRecordWithCustomFields`, `loadCustomFieldValues` for locale resolution |
| **NEW** `src/modules/entities/localization.ts` | CF resolution helpers |

### UI package (`packages/ui/`)
| File | Changes |
|------|---------|
| **NEW** `src/backend/inputs/LocalizedContentEditor.tsx` | Reusable localization editor |
| `src/backend/custom-fields/FieldDefinitionsEditor.tsx` | Add localization fields to CF definition editor |

### Encryption defaults
| File | Changes |
|------|---------|
| `packages/core/src/modules/entities/lib/encryptionDefaults.ts` | Add new JSONB fields |

---

## Verification

1. **Unit tests** — resolution helpers with various fallback scenarios
2. **Integration tests** — product CRUD with localizedContent, undo/redo
3. **Custom field tests** — CF definition with localized labels, CF values with localized values
4. **API tests** — `?locale=de` query param returns resolved content
5. **UI manual test** — translations tab on product form, CF editor with locale fields
6. **Build verification** — `npm run build` passes after all changes

---

## Changelog

### 2026-02-11
- Initial specification
