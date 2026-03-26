# SPEC-026: System-Wide Entity Translations

## Overview

Introduce a **system-wide translation framework** that enables any entity in the platform to have localized content. Instead of per-entity `localizedContent` JSONB columns (the current approach on `CatalogOffer`), translations are stored in a **dedicated `entity_translations` table** — following the same architectural pattern as `entity_indexes` and `search_tokens`.

This specification covers:
1. **`entity_translations` table** — generic storage for translations of any entity
2. **`translations` module** — new core module with CRUD API, batch loading, and overlay helpers
3. **Global locale support** — `?locale=` query param and `X-Locale` header in all API routes
4. **`applyLocalizedContent` helper** — automatic translation overlay in the CRUD factory pipeline
5. **CatalogOffer migration** — remove the existing `localizedContent` column in favor of the new system

## Problem Statement

- The current `localizedContent` JSONB column on `CatalogOffer` is a per-entity approach that doesn't scale — every entity that needs translations requires a schema migration and dedicated handling in commands, validators, API routes, and frontend
- 23+ entities across the platform have translatable text fields (products, variants, dictionary entries, shipping methods, categories, tags, etc.), but only offers have localization support
- `DictionaryEntry.label` drives order statuses, payment statuses, fulfillment statuses, product types, and deal stages — localizing dictionaries alone would unlock system-wide status localization
- No API-level locale support exists — there's no way for API consumers to request content in a specific language
- Translated content is excluded from search indexing (`catalog/search.ts` explicitly excludes `localized_content`)

## Proposed Solution

### Design Principles

1. **Follow the `entity_indexes` pattern** — one generic table with `entity_type` + `entity_id` referencing any entity, JSONB storing the data
2. **System-wide by default** — any entity can have translations without schema changes or new columns
3. **Separate data lifecycle** — translations are managed independently from the source entity (separate CRUD, no impact on entity commands/undo)
4. **Global locale support** — locale detected from query param, header, or cookie and applied automatically in the CRUD factory
5. **Batch loading** — efficient single-query loading for list endpoints (no N+1)
6. **Backward compatible** — requests without a locale parameter return base fields unchanged
7. **Phase 2 deferred** — search indexers, QueryEngine per-locale filtering, and translation UI are out of scope

---

## Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     API Request                              │
│  GET /api/catalog/products?locale=de                         │
│  Header: X-Locale: de                                        │
├──────────────────────────────────────────────────────────────┤
│                     CRUD Factory Pipeline                    │
│                                                              │
│  1. QueryEngine.query()          → raw entity rows           │
│  2. transformItem()              → camelCase mapping         │
│  3. decorateItemsWithCustomFields() → CF values attached     │
│  4. applyTranslationOverlays()   → locale content overlaid   | ← NEW
├──────────────────────────────────────────────────────────────┤
│                     Translation Module                       │
│                                                              │
│  batchLoadTranslations()  → SELECT FROM entity_translations  │
│    WHERE entity_type = ? AND entity_id IN (?)                │
│  applyLocalizedContent()  → overlay translations[locale]     │
│    over base record fields                                   │
├──────────────────────────────────────────────────────────────┤
│                     Storage                                  │
│                                                              │
│  entity_translations                                         │
│  ┌──────────────────────────────────────────────────┐        │
│  │ entity_type │ entity_id │ translations (JSONB)   │        │
│  │─────────────│───────────│────────────────────────│        │
│  │ catalog:    │ prod-123  │ { "de": { "title":     │        │
│  │  catalog_   │           │   "Recyceltes PP..." },│        │
│  │  product    │           │   "es": { "title":     │        │
│  │             │           │   "Granulado..." } }   │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  (Same pattern as entity_indexes / search_tokens)            │
└──────────────────────────────────────────────────────────────┘
```

### Comparison with Existing Patterns

| Aspect | `entity_indexes` | `search_tokens` | `entity_translations` (new) |
|--------|------------------|-----------------|----------------------------|
| **Purpose** | Search & filtering | Token-based text search | Localization overlays |
| **entity_type** | `'catalog:catalog_product'` | Same | Same convention |
| **entity_id** | text (UUID as string) | text | Same |
| **Data column** | `doc` JSONB (flat fields) | `token_hash` text | `translations` JSONB (locale-keyed) |
| **Rows per entity** | 1 | N (one per token) | 1 |
| **Populated by** | Auto (event subscriber) | Auto (indexer pipeline) | Manual (translation API) |
| **Queried by** | QueryEngine | QueryEngine (search) | CRUD factory (overlay) |
| **Scope** | org_id + tenant_id | org_id + tenant_id | org_id + tenant_id |

---

## Data Model

### `entity_translations` Table

**Entity definition:** `packages/core/src/modules/translations/data/entities.ts`

```typescript
@Entity({ tableName: 'entity_translations' })
@Index({ name: 'entity_translations_batch_idx', properties: ['entityType', 'tenantId'] })
export class EntityTranslation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'translations', type: 'jsonb' })
  translations!: Record<string, Record<string, unknown>>

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

**Database schema:**

```sql
CREATE TABLE entity_translations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  translations    jsonb NOT NULL DEFAULT '{}',
  organization_id uuid NULL,
  tenant_id       uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entity_translations_lookup_idx
  ON entity_translations (
    entity_type,
    entity_id,
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000')
  );

CREATE INDEX entity_translations_batch_idx
  ON entity_translations (entity_type, tenant_id);
```

**Unique constraint:** One translation row per entity record per tenant/org scope — same COALESCE pattern as `entity_indexes`.

### Translation JSONB Structure

```json
{
  "de": {
    "title": "Recyceltes PP-Granulat",
    "subtitle": "Hochwertiger recycelter Kunststoff",
    "description": "Detaillierte Beschreibung..."
  },
  "es": {
    "title": "Granulado de PP reciclado",
    "description": "Descripción detallada..."
  },
  "pl": {
    "title": "Granulat PP z recyklingu"
  }
}
```

**Rules:**
- Top-level keys are locale codes (2-10 chars, e.g. `de`, `en-US`, `pt-BR`)
- Each locale maps to an object of field overrides
- Only fields that have translations are included (sparse — missing fields fall back to base values)
- Max 50 locales per entity (validated via zod)

---

## Module Structure

### New module: `packages/core/src/modules/translations/`

```
translations/
├── index.ts                              # Module metadata
├── data/
│   ├── entities.ts                       # EntityTranslation MikroORM entity
│   └── validators.ts                     # Zod schemas for CRUD
├── api/
│   └── translations/
│       └── route.ts                      # Translation CRUD endpoint
├── lib/
│   ├── apply.ts                          # applyTranslationOverlays() for CRUD lists
│   ├── batch.ts                          # batchLoadTranslations() batch loader
│   └── locale.ts                         # resolveLocaleFromRequest()
├── subscribers/
│   └── cleanup.ts                        # Cleanup on entity delete
└── events.ts                             # Event declarations
```

### Shared types: `packages/shared/src/lib/localization/`

```
localization/
├── types.ts                              # TranslationRecord, LocaleCode
├── resolver.ts                           # applyLocalizedContent() pure function
└── index.ts                              # Barrel exports
```

---

## API Contracts

### Translation CRUD

All translation operations go through a single generic endpoint.

#### `GET /api/translations/:entityType/:entityId`

Returns the full translation record for a single entity.

**Response:**
```json
{
  "entityType": "catalog:catalog_product",
  "entityId": "abc-123",
  "translations": {
    "de": { "title": "Recyceltes PP-Granulat" },
    "es": { "title": "Granulado de PP reciclado" }
  },
  "createdAt": "2026-02-13T10:00:00Z",
  "updatedAt": "2026-02-13T10:00:00Z"
}
```

Returns `404` if no translations exist for this entity.

#### `PUT /api/translations/:entityType/:entityId`

Create or update translations for an entity. Full replacement of the `translations` JSONB.

**Request body:**
```json
{
  "de": { "title": "Recyceltes PP-Granulat", "description": "..." },
  "es": { "title": "Granulado de PP reciclado" }
}
```

**Response:** `200` with the full translation record (same format as GET).

**Validation (zod):**
```typescript
const translationBodySchema = z.record(
  z.string().trim().min(2).max(10),     // locale code
  z.record(
    z.string().trim().min(1).max(100),  // field name
    z.union([z.string().max(10000), z.null()])
  )
).refine(obj => Object.keys(obj).length <= 50, 'Maximum 50 locales per entity')
```

#### `DELETE /api/translations/:entityType/:entityId`

Remove all translations for an entity.

**Response:** `204 No Content`

### Global Locale Parameter

Every `makeCrudRoute` GET endpoint automatically supports locale resolution.

**Resolution priority:**
1. Query param: `?locale=de`
2. Header: `X-Locale: de`
3. Cookie: `locale=de` (existing i18n cookie)
4. `Accept-Language` header (first match against supported locales)
5. Default: `null` (no overlay — base fields returned as-is)

When a locale is resolved, `applyTranslationOverlays()` is called after custom field decoration, adding an `_locale` metadata field to the response:

```json
{
  "id": "abc-123",
  "title": "Recyceltes PP-Granulat",
  "_locale": "de",
  "_translated": ["title"]
}
```

---

## Key Helpers

### `resolveLocaleFromRequest(request: Request): string | null`

**Location:** `packages/core/src/modules/translations/lib/locale.ts`

```typescript
export function resolveLocaleFromRequest(request: Request): string | null {
  const url = new URL(request.url)
  const queryLocale = url.searchParams.get('locale')
  if (queryLocale && queryLocale.length >= 2 && queryLocale.length <= 10) return queryLocale

  const headerLocale = request.headers.get('x-locale')
  if (headerLocale && headerLocale.length >= 2 && headerLocale.length <= 10) return headerLocale

  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader) {
    const cookieLocale = readCookieFromHeader(cookieHeader, 'locale')
    if (cookieLocale && cookieLocale.length >= 2 && cookieLocale.length <= 10) return cookieLocale
  }

  const acceptLang = request.headers.get('accept-language')
  if (acceptLang) {
    const parsed = parseAcceptLanguage(acceptLang)
    if (parsed) return parsed
  }

  return null
}
```

### `batchLoadTranslations(knex, entityType, entityIds, scope)`

**Location:** `packages/core/src/modules/translations/lib/batch.ts`

Efficient batch loader — one SQL query for all entities in a list response.

```typescript
export async function batchLoadTranslations(
  knex: Knex,
  entityType: string,
  entityIds: string[],
  scope: { tenantId?: string | null; organizationId?: string | null },
): Promise<Map<string, Record<string, Record<string, unknown>>>> {
  if (!entityIds.length) return new Map()

  const rows = await knex('entity_translations')
    .where('entity_type', entityType)
    .whereIn('entity_id', entityIds)
    .andWhereRaw('tenant_id is not distinct from ?', [scope.tenantId ?? null])
    .andWhereRaw('organization_id is not distinct from ?', [scope.organizationId ?? null])
    .select(['entity_id', 'translations'])

  const map = new Map<string, Record<string, Record<string, unknown>>>()
  for (const row of rows) {
    map.set(row.entity_id, row.translations ?? {})
  }
  return map
}
```

**Performance:** For a list of 50 products, this is 1 additional query — same cost as custom field batch loading.

### `applyLocalizedContent(record, translations, locale)`

**Location:** `packages/shared/src/lib/localization/resolver.ts`

Pure function that overlays translated fields on a base record.

```typescript
export function applyLocalizedContent<T extends Record<string, unknown>>(
  record: T,
  translations: Record<string, Record<string, unknown>> | null | undefined,
  locale: string,
): T & { _locale?: string; _translated?: string[] } {
  if (!translations || !translations[locale]) return record
  const overlay = translations[locale]
  const result = { ...record }
  const translated: string[] = []
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== null && value !== undefined && key in record) {
      ;(result as any)[key] = value
      translated.push(key)
    }
  }
  if (translated.length > 0) {
    ;(result as any)._locale = locale
    ;(result as any)._translated = translated
  }
  return result
}
```

### `applyTranslationOverlays(items, options)`

**Location:** `packages/core/src/modules/translations/lib/apply.ts`

Higher-level helper used by CRUD factory to batch-apply translations to a list.

```typescript
export async function applyTranslationOverlays(
  items: Record<string, unknown>[],
  options: {
    entityType: string
    locale: string
    tenantId?: string | null
    organizationId?: string | null
    container: AwilixContainer
  },
): Promise<Record<string, unknown>[]> {
  const knex = resolveKnex(options.container)
  const entityIds = items.map(item => String(item.id)).filter(Boolean)
  const translationsMap = await batchLoadTranslations(knex, options.entityType, entityIds, {
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  })

  return items.map(item => {
    const entityId = String(item.id)
    const translations = translationsMap.get(entityId)
    return applyLocalizedContent(item, translations ?? null, options.locale)
  })
}
```

---

## Integration with CRUD Factory

**File:** `packages/shared/src/lib/crud/factory.ts`

In the GET list handler, after the existing custom field decoration step:

```typescript
// Existing pipeline:
let transformedItems = rawItems.map(i => (opts.list!.transformItem ? opts.list!.transformItem(i) : i))
transformedItems = await decorateItemsWithCustomFields(transformedItems, ctx)

// NEW: apply translation overlays if locale is present
if (opts.list?.entityId) {
  const locale = resolveLocaleFromRequest(request)
  if (locale) {
    transformedItems = await applyTranslationOverlays(transformedItems, {
      entityType: String(opts.list.entityId),
      locale,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? null,
      container: ctx.container,
    })
  }
}
```

This is **zero-config** for existing routes — any `makeCrudRoute` with an `entityId` automatically gets translation support. No per-route changes needed.

---

## Entities with Translation Support

### Phase 1 — Covered by this spec

The `entity_translations` table is generic — any entity can store translations from day one. The following entities are the primary targets with their translatable fields:

| Entity Type | Module | Translatable Fields |
|-------------|--------|---------------------|
| `catalog:catalog_product` | catalog | title, subtitle, description |
| `catalog:catalog_product_variant` | catalog | name |
| `catalog:catalog_offer` | catalog | title, subtitle, description |
| `catalog:catalog_option_schema_template` | catalog | name, description, options.\*.label, options.\*.choices.\* |
| `dictionaries:dictionary_entry` | dictionaries | label |
| `entities:custom_field_def` | entities | label, description, options.\*.label, groupTitle, groupHint |
| `entities:custom_field_value` | entities | value (text/multiline kinds only) |

**Note:** `DictionaryEntry` is the keystone entity — dictionary labels drive order statuses, payment statuses, fulfillment statuses, product types, and deal stages. Localizing dictionary entries automatically enables localized statuses across every module.

### Phase 2+ Roadmap

No code changes needed to add new entities — just PUT translations via the API. Suggested priority:

| Priority | Entity Type | Module | Fields |
|----------|-------------|--------|--------|
| P2 | `catalog:catalog_product_category` | catalog | name, description |
| P2 | `catalog:catalog_product_tag` | catalog | label |
| P2 | `sales:sales_shipping_method` | sales | name, description |
| P2 | `sales:sales_payment_method` | sales | name, description, terms |
| P2 | `sales:sales_channel` | sales | name, description |
| P3 | `catalog:catalog_price_kind` | catalog | title |
| P3 | `sales:sales_tax_rate` | sales | name |
| P3 | `workflows:workflow_definition` | workflows | workflowName, description |

---

## Integration with OpenMercato Features

### Commands / Undo

Entity commands **do not** touch translations. Translations have a separate data lifecycle:
- Creating a product does not create translations
- Updating a product does not update translations
- Undoing a product update does not affect translations
- Deleting a product triggers cleanup of its translation row (via event subscriber)

If undo for translations is needed in the future, the translation CRUD can be wrapped in its own command. This is optional for Phase 1.

### Custom Fields

Custom field definitions and values are entities like any other — they can have translations via the same `entity_translations` table:

**CustomFieldDef translations:**
```json
// entity_type: 'entities:custom_field_def', entity_id: '<def_id>'
{
  "de": {
    "label": "Material",
    "description": "Hauptmaterial des Produkts",
    "groupTitle": "Technische Daten"
  }
}
```

For select-type custom fields, option labels are stored in a nested structure:
```json
{
  "de": {
    "label": "Qualitätsstufe",
    "options": { "high": "Hoch", "medium": "Mittel", "low": "Niedrig" }
  }
}
```

**CustomFieldValue translations (text/multiline only):**
```json
// entity_type: 'entities:custom_field_value', entity_id: '<value_id>'
{
  "de": { "value": "Recycelter Kunststoff" }
}
```

The `decorateItemsWithCustomFields()` function in `packages/shared/src/lib/crud/custom-fields.ts` will receive the resolved locale and apply CF label/value translations alongside the standard entity translation overlay.

### Events

- `translations.updated` event emitted when PUT creates/updates a translation record
- `translations.deleted` event emitted when DELETE removes a translation record
- Generic entity delete events (e.g., `catalog.product.deleted`) trigger a cleanup subscriber that removes the corresponding translation row — same pattern as `entity_indexes` cleanup

### Audit Trail

Translation changes are tracked via the `translations.updated` event. Full before/after snapshots can be implemented if needed by comparing the JSONB content.

### Encryption

The `translations` JSONB column can be encrypted at rest using the same tenant-scoped encryption infrastructure as `entity_indexes.doc`. This ensures translated content (which may include sensitive product descriptions or custom field values) respects tenant encryption settings.

### Search (Phase 2 — Deferred)

Per pkarw: "as a next phase we'll need to modify the search indexers and custom fields indexer (entity_indexes relation) and QueryEngine to store the per locale values"

Phase 2 will:
- Extend `buildIndexDoc()` to JOIN `entity_translations` and flatten locale fields as `l10n:{locale}:{field}` keys in `entity_indexes.doc`
- Extend search token generation to tokenize translated fields
- Extend QueryEngine with locale-scoped filtering
- This is explicitly **out of scope** for Phase 1

---

## CatalogOffer Migration

pkarw: "Then we can remove the `localizedContent` columns — I don't like this way of solving it and I think it's an obsolete design"

### Migration Steps

1. **Create** `entity_translations` table with indexes (zero downtime — new table)

2. **Migrate** existing CatalogOffer data:
```sql
INSERT INTO entity_translations (entity_type, entity_id, translations, organization_id, tenant_id)
SELECT
  'catalog:catalog_offer',
  id::text,
  localized_content,
  organization_id,
  tenant_id
FROM catalog_product_offers
WHERE localized_content IS NOT NULL
  AND localized_content != '{}';
```

3. **Remove** `localizedContent` from CatalogOffer:
   - Entity: remove `@Property` for `localizedContent` in `catalog/data/entities.ts`
   - Types: remove `CatalogOfferContent`, `CatalogOfferLocalizedContent` from `data/types.ts`
   - Validators: remove `localizedContent` from `offerBaseSchema` in `data/validators.ts`
   - Commands: remove `localizedContent` from `OfferSnapshot`, `OFFER_CHANGE_KEYS`, create/update/undo logic in `commands/offers.ts`
   - API route: remove `localized_content` from field list and `transformItem` in `api/offers/route.ts`
   - Search: remove `localized_content` from excluded list in `search.ts`
   - Frontend: remove `localizedContent` from offer types in `backend/catalog/products/[id]/page.tsx`

4. **Drop column**:
```sql
ALTER TABLE catalog_product_offers DROP COLUMN localized_content;
```

---

## UI/UX (Phase 1 — Minimal)

Phase 1 focuses on the backend infrastructure. UI for managing translations is a Phase 2 deliverable. However, the API is fully functional for programmatic use and can be consumed by external translation management tools.

For Phase 1, the product edit page is **not modified** — translations are managed via the API directly.

---

## Alternatives Considered

### A. Per-entity `localizedContent` JSONB column (previous SPEC-023 — rejected)

Adding `localizedContent: JSONB` to every entity that needs translations. Rejected because:
- Every new entity requires a schema migration
- Every entity needs custom handling in commands, validators, API routes
- Does not scale to 23+ entities
- pkarw: "I don't like this way of solving it and I think it's an obsolete design"

### B. Generic EAV translation table (pat-lewczuk proposal — rejected)

A table with one row per field per locale (`entity_type`, `entity_id`, `field_name`, `locale`, `value`). Rejected because:
- N+1 query risk on reads without batch loading
- 100K products × 5 locales × 3 fields = 1.5M rows (vs 100K in the chosen approach)
- Multi-row writes require explicit transactions for atomicity
- Orphaned rows possible on entity delete without CASCADE
- Does not match the `entity_indexes` pattern used in the codebase

### C. Chosen: Dedicated `entity_translations` entity with JSONB

One generic table, one row per entity, JSONB stores all locale translations. This approach:
- Follows the proven `entity_indexes` / `search_tokens` pattern
- Zero schema changes needed to add translations for a new entity
- Atomic writes (one UPSERT per entity)
- Efficient batch loading (one WHERE IN query per list endpoint)
- Clean separation — translations don't pollute entity schemas or commands

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/core/src/modules/translations/index.ts` | Module metadata |
| `packages/core/src/modules/translations/data/entities.ts` | `EntityTranslation` MikroORM entity |
| `packages/core/src/modules/translations/data/validators.ts` | Zod schemas for translation CRUD |
| `packages/core/src/modules/translations/api/translations/route.ts` | Generic translation CRUD endpoint |
| `packages/core/src/modules/translations/lib/apply.ts` | `applyTranslationOverlays()` for CRUD factory |
| `packages/core/src/modules/translations/lib/batch.ts` | `batchLoadTranslations()` batch loader |
| `packages/core/src/modules/translations/lib/locale.ts` | `resolveLocaleFromRequest()` |
| `packages/core/src/modules/translations/subscribers/cleanup.ts` | Delete translations on entity delete |
| `packages/core/src/modules/translations/events.ts` | Event declarations |
| `packages/shared/src/lib/localization/types.ts` | Shared types (`TranslationRecord`, `LocaleCode`) |
| `packages/shared/src/lib/localization/resolver.ts` | `applyLocalizedContent()` pure function |
| `packages/shared/src/lib/localization/index.ts` | Barrel exports |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/shared/src/lib/crud/factory.ts` | Add locale extraction + `applyTranslationOverlays()` after custom field decoration in GET handler |
| `packages/core/src/modules/catalog/data/entities.ts` | Remove `localizedContent` property from `CatalogOffer` |
| `packages/core/src/modules/catalog/data/types.ts` | Remove `CatalogOfferContent`, `CatalogOfferLocalizedContent` types |
| `packages/core/src/modules/catalog/data/validators.ts` | Remove `localizedContent` from `offerBaseSchema`, `offerCreateSchema`, `offerUpdateSchema` |
| `packages/core/src/modules/catalog/commands/offers.ts` | Remove `localizedContent` from `OfferSnapshot`, `OFFER_CHANGE_KEYS`, create/update/undo handlers |
| `packages/core/src/modules/catalog/api/offers/route.ts` | Remove `localized_content` from fields list and `transformItem` |
| `packages/core/src/modules/catalog/search.ts` | Remove `localized_content` from excluded field list |
| `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` | Remove `localizedContent` from `OfferSnapshot` type and related parsing |

---

## Verification

1. **Database migration** — `entity_translations` table created, existing Offer data migrated, `localized_content` column dropped
2. **Translation CRUD** — `PUT /api/translations/catalog:catalog_product/abc-123` creates translation, `GET` retrieves it, `DELETE` removes it
3. **Locale overlay on list** — `GET /api/catalog/products?locale=de` returns German titles with `_locale: "de"` and `_translated: ["title"]` metadata
4. **Locale overlay on detail** — `GET /api/catalog/products/abc-123?locale=de` returns resolved content
5. **Batch loading** — list of 50 products with locale = 2 SQL queries total (entities + translations)
6. **Cleanup** — deleting a product via API also removes its translation row
7. **Backward compatibility** — requests without `?locale=` return base fields unchanged, no `_locale` or `_translated` metadata
8. **CatalogOffer** — existing offer flows work without `localizedContent` column; translations served from `entity_translations`
9. **Build** — `yarn build` passes after all changes

---

## Changelog

### 2026-02-13 (v3)
- Complete rewrite per pkarw direction (issue #527, Feb 12 comment)
- Replaced per-entity JSONB columns with dedicated `entity_translations` table
- Following `entity_indexes` / `search_tokens` pattern
- Added global locale support via query param, header, cookie
- Added `applyLocalizedContent` overlay helper in CRUD factory pipeline
- CatalogOffer `localizedContent` column migration and removal
- Phase 2 (search indexers, QueryEngine) explicitly deferred

### 2026-02-11 (v2)
- Added system-wide localization framework in `packages/shared/src/lib/localization/`
- Added `DictionaryEntry.localizedContent` to scope
- Added query index search integration
- Expanded alternatives considered with EAV analysis

### 2026-02-11 (v1)
- Initial specification (per-entity JSONB columns approach)
