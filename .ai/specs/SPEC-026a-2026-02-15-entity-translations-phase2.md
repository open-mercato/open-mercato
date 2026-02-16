# SPEC-026a: Entity Translations — Phase 2 (UI, Search, Field Definitions)

**Parent**: [SPEC-026 - System-Wide Entity Translations](./SPEC-026-2026-02-11-catalog-localization.md)
**Date**: 2026-02-15
**Status**: Proposed
**Issue**: [#527](https://github.com/open-mercato/open-mercato/issues/527)
**Feedback**: [pkarw comment, Feb 14](https://github.com/open-mercato/open-mercato/issues/527)

---

## TLDR

Phase 2 adds three capabilities on top of SPEC-026's translation infrastructure:
1. A reusable **TranslationManager** UI component (standalone config page + widget injection in entity forms)
2. **Search indexer extension** — translated fields indexed as `l10n:{locale}:{field}` keys in `entity_indexes.doc` and tokenized in `search_tokens`
3. **Per-entity translatable field definitions** — code-based registry + auto-detection fallback

Phase 3 (multiple translation versions per locale for A/B testing) is mentioned as a future direction.

---

## Overview

SPEC-026 (Phase 1) established the `entity_translations` table, the `translations` module with CRUD API, `applyLocalizedContent` overlay in the CRUD factory, and global locale resolution. Phase 1 explicitly deferred UI, search integration, and per-entity field definitions.

pkarw approved Phase 1 for implementation but identified the missing parts (issue #527, Feb 14):

> "The missing part is a little bit of the UI spec for how translations are managed — it should be a single, reusable component that can be embedded in the forms. For the UI matter, we should also have a kind of per-entity definitions — which fields are translatable — this is optional, as on the other hand the translations component could take the per-entity-type fields list (like EncryptionManager.tsx) and the user decides which ones to translate — saved for non-text fields and uuid like dates that should not be translated."

---

## Problem Statement

- Translations stored via Phase 1 are only accessible through direct API calls — there is no UI for managing them
- Translated content is invisible to the search indexer: searching for "Recyceltes" will not find a German translation of a product, even though the translation exists in `entity_translations`
- There is no declarative way to know which fields on a given entity are translatable, forcing manual field lists

---

## Proposed Solution

### Design Principles

1. **Follow existing patterns exactly** — TranslationManager mirrors `EncryptionManager.tsx` for standalone mode; widget injection mirrors `product-seo` for form embedding
2. **Minimal search pipeline changes** — translation data is flattened into the existing `entity_indexes.doc` JSONB as `l10n:{locale}:{field}` keys, reusing the same `cf:*` mechanism in QueryEngine
3. **Optional field config** — translatable field definitions are code-based per module, with auto-detection fallback via `isTranslatableField()`
4. **Event-driven consistency** — translation changes trigger entity re-indexing through the existing subscriber infrastructure

---

## Architecture

### Phase 2 Additions

```
┌──────────────────────────────────────────────────────────────┐
│                     TranslationManager UI                     │
│                                                              │
│  Mode A: Standalone Config Page                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Entity Picker → Record Picker → Locale Tabs          │    │
│  │ Field Name | Base Value | Translated Value            │    │
│  │ Save → PUT /api/translations/:entityType/:entityId    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Mode B: Widget Injection (crud-form:catalog.product)        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Locale Tabs → Field table for current record         │    │
│  │ data.id → record ID, context.entityId → entity type  │    │
│  │ Compact layout, separate save from entity form       │    │
│  └──────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────┤
│                     Search Indexer Extension                  │
│                                                              │
│  buildIndexDoc()                                             │
│    → queries entity_translations                             │
│    → flattens as l10n:de:title, l10n:es:description, ...    │
│                                                              │
│  shouldIndexField() → l10n:* passes existing checks          │
│  buildSearchTokenRows() → tokens with field="l10n:de:title" │
├──────────────────────────────────────────────────────────────┤
│                     Event-Driven Reindex                     │
│                                                              │
│  translations.updated → subscriber →                         │
│    emit query_index.upsert_one → rebuilds doc + tokens      │
│                                                              │
│  translations.deleted → same flow                            │
├──────────────────────────────────────────────────────────────┤
│                     QueryEngine                              │
│                                                              │
│  cfFilters check: startsWith('cf:') || startsWith('l10n:')  │
│  JSONB filter: doc->'l10n:de:title' (same as cf:* path)     │
│  Token search: field='l10n:de:title' (works unchanged)      │
└──────────────────────────────────────────────────────────────┘
```

### QueryEngine Compatibility

The `l10n:{locale}:{field}` keys live inside `entity_indexes.doc` JSONB — exactly like `cf:*` keys. The existing `buildCfExpressions()` and `applyCfFilterAcrossSources()` methods in `HybridQueryEngine` already support arbitrary doc keys via `doc -> 'key'` / `doc ->> 'key'` SQL. Filters like `{ field: 'l10n:de:title', op: 'ilike', value: '%recycelt%' }` work through the existing JSONB filter path.

For search token queries, tokens are stored with `field = "l10n:de:title"` in `search_tokens`. The `applySearchTokens()` method uses the field value directly, so locale-scoped token search works out of the box.

**Only change needed**: the `cfFilters` partition and `wantsCf` check in `engine.ts` need to also match the `l10n:` prefix (2 lines).

---

## 1. TranslationManager UI Component

### Component Location

`packages/core/src/modules/translations/components/TranslationManager.tsx`

### Props Interface

```typescript
type TranslationManagerProps = {
  // Mode A (standalone): user selects entity + record
  // Mode B (embedded): these are provided by widget injection
  entityType?: string                    // e.g., 'catalog:catalog_product'
  recordId?: string                      // specific record ID
  baseValues?: Record<string, unknown>   // base field values for side-by-side display

  // Optional: restrict which fields are translatable
  translatableFields?: string[]

  // UI options
  mode?: 'standalone' | 'embedded'
  compact?: boolean                      // reduced chrome for widget mode
}
```

### Mode A — Standalone Config Page

**Page:** `packages/core/src/modules/translations/backend/config/translations/page.tsx`

Follows the exact pattern of the encryption config page:

```typescript
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TranslationManager } from '../../../components/TranslationManager'

export default function TranslationSettingsPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <TranslationManager mode="standalone" />
      </PageBody>
    </Page>
  )
}
```

**UX flow:**
1. Entity selector dropdown — loads from `/api/entities/entities` (same as EncryptionManager)
2. Record picker — once entity type selected, load records via list API (e.g., `/api/catalog/products?pageSize=20&search=...`)
3. Locale tabs — tabs for each supported locale (`en`, `pl`, `es`, `de`)
4. Field table — for each translatable field: field name | base value (read-only) | translated value (editable input/textarea)
5. Save button — `PUT /api/translations/:entityType/:entityId` with full translations JSONB
6. Flash feedback — success/error via `flash()`

### Mode B — Widget Injection

**Widget files:**
- `packages/core/src/modules/translations/widgets/injection/translation-manager/widget.ts`
- `packages/core/src/modules/translations/widgets/injection/translation-manager/widget.client.tsx`

**Injection table:** `packages/core/src/modules/translations/widgets/injection-table.ts`

The widget client extracts `entityType` from injection context and `recordId` from form data:

```typescript
// widget.client.tsx
export default function TranslationWidget({ context, data }: InjectionWidgetComponentProps) {
  const entityType = context?.entityId
  const recordId = data?.id ? String(data.id) : undefined

  if (!entityType || !recordId) return null

  return (
    <TranslationManager
      mode="embedded"
      compact
      entityType={entityType}
      recordId={recordId}
      baseValues={data}
    />
  )
}
```

**Widget definition:**

```typescript
// widget.ts
const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'translations.injection.translation-manager',
    title: 'Translation Manager',
    description: 'Manage translations for the current record',
    features: [],
    priority: 40,
    enabled: true,
  },
  Widget: TranslationWidget,
}
```

**Injection table mappings:**

```typescript
export const injectionTable: ModuleInjectionTable = {
  'crud-form:catalog.product': [
    {
      widgetId: 'translations.injection.translation-manager',
      kind: 'group',
      column: 2,
      groupLabel: 'translations.widgets.translationManager.groupLabel',
      groupDescription: 'translations.widgets.translationManager.groupDescription',
      priority: 40,
    },
  ],
  'crud-form:catalog.catalog_product': 'translations.injection.translation-manager',
  'crud-form:catalog.catalog_offer': [
    {
      widgetId: 'translations.injection.translation-manager',
      kind: 'group',
      column: 2,
      groupLabel: 'translations.widgets.translationManager.groupLabel',
      groupDescription: 'translations.widgets.translationManager.groupDescription',
      priority: 40,
    },
  ],
  'crud-form:catalog.catalog_product_variant': 'translations.injection.translation-manager',
}
```

### Internal Flow (Both Modes)

Following the EncryptionManager pattern:

1. **Load entities** (standalone only): `useQuery` fetching `/api/entities/entities`
2. **Resolve translatable fields**: Use `getTranslatableFields(entityType)` from registry. If not registered, fall back to `getEntityFields(entitySlug)` filtered by `isTranslatableField()`
3. **Augment with custom fields**: Use `useCustomFieldDefs()` hook, filter to `text` and `multiline` kinds
4. **Load translations**: `useQuery` fetching `GET /api/translations/:entityType/:entityId`
5. **Locale tabs**: Render tabs for supported locales from `packages/shared/src/lib/i18n/config.ts`
6. **Field table**: For each translatable field, show base value (read-only, from `baseValues` or empty) and translated value (editable)
7. **Save**: `useMutation` calling `PUT /api/translations/:entityType/:entityId` with full translations object
8. **Feedback**: `flash()` on success/error

### UI Components Used

| Component | Import | Usage |
|-----------|--------|-------|
| `Button` | `@open-mercato/ui/primitives/button` | Save, locale tab actions |
| `LoadingMessage` | `@open-mercato/ui/backend/detail` | Loading state |
| `ErrorMessage` | `@open-mercato/ui/backend/detail` | Error state with retry |
| `flash()` | `@open-mercato/ui/backend/FlashMessages` | Success/error toasts |
| `apiCall`/`readApiResultOrThrow` | `@open-mercato/ui/backend/utils/apiCall` | API calls |
| `useT()` | `@open-mercato/shared/lib/i18n/context` | i18n |
| `useOrganizationScopeVersion()` | `@open-mercato/shared/lib/frontend/useOrganizationScope` | Cache key scoping |
| `getEntityFields()` | `#generated/entity-fields-registry` | Static field discovery |
| `useCustomFieldDefs()` | `@open-mercato/ui/backend/utils/customFieldDefs` | Dynamic CF field discovery |

### Key UX Decisions

- **No auto-save** — explicit save button to avoid accidental partial translations
- **Widget hidden on create page** — translations require an existing record (`!recordId → return null`)
- **Translations save independently from entity** — separate API call, not mixed into entity form submission
- **Sparse translations** — only fields with values are stored; missing fields fall back to base values

---

## 2. Per-Entity Translatable Field Definitions

### Registry Pattern

**File:** `packages/shared/src/lib/localization/translatable-fields.ts`

```typescript
type TranslatableFieldsRegistry = Record<string, string[]>

let _registry: TranslatableFieldsRegistry = {}

export function registerTranslatableFields(fields: TranslatableFieldsRegistry): void {
  _registry = { ..._registry, ...fields }
}

export function getTranslatableFields(entityType: string): string[] | undefined {
  return _registry[entityType]
}

export function getTranslatableFieldsRegistry(): TranslatableFieldsRegistry {
  return { ..._registry }
}
```

### Auto-Detection Utility

**File:** `packages/core/src/modules/translations/lib/translatable-fields.ts`

```typescript
const NON_TRANSLATABLE_SUFFIXES = ['_id', '_at', '_hash']
const NON_TRANSLATABLE_EXACT = [
  'id', 'created_at', 'updated_at', 'deleted_at',
  'tenant_id', 'organization_id', 'is_active',
  'sort_order', 'position', 'slug', 'sku', 'barcode',
  'price', 'quantity', 'weight', 'width', 'height', 'depth',
]

export function isTranslatableField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase()
  if (NON_TRANSLATABLE_EXACT.includes(lower)) return false
  for (const suffix of NON_TRANSLATABLE_SUFFIXES) {
    if (lower.endsWith(suffix)) return false
  }
  return true
}
```

### Per-Module Configs

**File:** `packages/core/src/modules/catalog/lib/translatable-fields.ts`

```typescript
export const catalogTranslatableFields: Record<string, string[]> = {
  'catalog:catalog_product': ['title', 'subtitle', 'description'],
  'catalog:catalog_product_variant': ['name'],
  'catalog:catalog_offer': ['title', 'subtitle', 'description'],
  'catalog:catalog_option_schema_template': ['name', 'description'],
  'catalog:catalog_product_category': ['name', 'description'],
  'catalog:catalog_product_tag': ['label'],
}
```

**File:** `packages/core/src/modules/dictionaries/lib/translatable-fields.ts`

```typescript
export const dictionaryTranslatableFields: Record<string, string[]> = {
  'dictionaries:dictionary_entry': ['label'],
}
```

### Resolution Priority

1. If `translatableFields` prop is passed → use those fields (explicit override)
2. If `getTranslatableFields(entityType)` returns a list → use registry
3. Otherwise → auto-detect from `getEntityFields(entitySlug)` filtered by `isTranslatableField()`

---

## 3. Search Indexer Extension

### 3.1 Extend `buildIndexDoc()`

**File:** `packages/core/src/modules/query_index/lib/indexer.ts`

After the custom field attachment block (line 48-70), before encryption (line 72-80), add translation loading:

```typescript
// After CF attachment, before encryption:

// Attach translations under flat keys 'l10n:{locale}:{field}'
try {
  const translationRow = await knex('entity_translations')
    .where({ entity_type: params.entityType, entity_id: String(params.recordId) })
    .andWhereRaw('tenant_id is not distinct from ?', [params.tenantId ?? null])
    .andWhereRaw('organization_id is not distinct from ?', [params.organizationId ?? null])
    .select(['translations'])
    .first()

  if (translationRow?.translations && typeof translationRow.translations === 'object') {
    for (const [locale, fields] of Object.entries(translationRow.translations)) {
      if (!fields || typeof fields !== 'object') continue
      for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 0) {
          doc[`l10n:${locale}:${field}`] = value
        }
      }
    }
  }
} catch {
  // Translation loading failure should not block indexing
}
```

**Performance:** One additional query per entity during indexing. Same cost as custom field loading. Only runs during index writes, not reads.

### 3.2 Search Token Generation

**File:** `packages/core/src/modules/query_index/lib/search-tokens.ts`

**No changes needed.** The existing `shouldIndexField()` function (line 54-64) already passes `l10n:de:title` because:
- It does not end in `_id` or `_at`
- It is not in the blocklist
- It contains text content (string value)

`buildSearchTokenRows()` iterates over `Object.entries(params.doc)` and tokenizes any field that passes `shouldIndexField()`. The generated tokens will have `field = "l10n:de:title"`.

### 3.3 Reindex Subscribers

**File:** `packages/core/src/modules/translations/subscribers/reindex.ts`

```typescript
export const metadata = {
  event: 'translations.updated',
  persistent: true,
  id: 'translations-reindex-entity',
}

export default async function handle(
  payload: { entityType: string; entityId: string; tenantId?: string; organizationId?: string },
  ctx: { resolve: <T = any>(name: string) => T }
) {
  const bus = ctx.resolve<any>('eventBus')
  await bus.emitEvent('query_index.upsert_one', {
    entityType: payload.entityType,
    recordId: payload.entityId,
    tenantId: payload.tenantId ?? null,
    organizationId: payload.organizationId ?? null,
  })
}
```

**File:** `packages/core/src/modules/translations/subscribers/reindex-on-delete.ts`

Same structure, listening to `translations.deleted` event.

When a translation is saved or deleted, the entity's index row is rebuilt (now includes `l10n:*` fields), and search tokens are regenerated.

---

## 4. QueryEngine Extension

**File:** `packages/core/src/modules/query_index/lib/engine.ts`

Two small changes to route `l10n:*` filters through the JSONB path:

### 4.1 `cfFilters` Partition

Currently checks `filter.field.startsWith('cf:')`. Add `l10n:` prefix:

```typescript
const cfFilters = normalizedFilters.filter(
  (filter) => filter.field.startsWith('cf:') || filter.field.startsWith('l10n:')
)
```

### 4.2 `wantsCf` Check

Add `l10n:` prefix to field checks:

```typescript
const wantsCf = (
  (opts.fields || []).some((field) =>
    typeof field === 'string' && (field.startsWith('cf:') || field.startsWith('l10n:'))
  ) ||
  cfFilters.length > 0 ||
  opts.includeCustomFields === true ||
  (Array.isArray(opts.includeCustomFields) && opts.includeCustomFields.length > 0)
)
```

**Everything else works unchanged:**
- `buildCfExpressions()` generates `doc->'l10n:de:title'` SQL (same as `doc->'cf:color'`)
- `applyCfFilterAcrossSources()` handles filtering across index sources
- `applySearchTokens()` matches `field = 'l10n:de:title'` in search_tokens

---

## 5. Phase 3 — Future Direction (Out of Scope)

pkarw: "What would be awesome as the even third phase — is to have an option to have more than single translation per locale — I mean few versions so we could test and choose the best one based on conversion etc."

This would extend the `translations` JSONB structure to support multiple versions per locale, potentially with weights for A/B testing:

```json
{
  "de": {
    "title": {
      "_versions": [
        { "id": "v1", "value": "Recyceltes PP-Granulat", "weight": 70 },
        { "id": "v2", "value": "PP-Granulat aus Recycling", "weight": 30 }
      ]
    }
  }
}
```

The current JSONB structure is forward-compatible — adding a `_versions` key per field can coexist with the flat `{ field: value }` structure. The `applyLocalizedContent()` resolver would detect the versioned format and select based on weights or session-based bucketing.

This is explicitly out of scope for SPEC-026a.

---

## Risks & Impact Review

### Risk 1: Index Size Growth

**Severity:** Medium
**Area:** Database storage
**Scenario:** Entities with translations in 4 locales and 3 fields add 12 extra JSONB keys to each `entity_indexes.doc` row.
**Mitigation:** JSONB compression is efficient for text keys. The `entity_indexes.doc` column already stores all base fields + custom fields; adding 12 text keys is marginal. Monitor index table size after rollout.
**Residual risk:** Low — JSONB storage is well-tested at scale in this codebase.

### Risk 2: Reindex Storm on Bulk Translation Import

**Severity:** Medium
**Area:** Event processing
**Scenario:** Importing translations for 10,000 products triggers 10,000 `translations.updated` events, each triggering a reindex.
**Mitigation:** The existing `query_index.reindex` subscriber handles bulk operations. For bulk translation imports, consider a dedicated bulk endpoint that emits a single reindex event per entity type rather than per record. The persistent subscription retry logic handles backpressure.
**Residual risk:** Medium — addressed by event bus throttling.

### Risk 3: Widget Injection in Create Mode

**Severity:** Low
**Area:** UI
**Scenario:** On the product create page, `data.id` is undefined because the record hasn't been saved yet. The translation widget should not render.
**Mitigation:** Widget client explicitly checks `if (!recordId) return null`. Translations can only be added after the entity exists.
**Residual risk:** Negligible.

### Risk 4: Phase 1 Dependency

**Severity:** High
**Area:** Dependencies
**Scenario:** Phase 2 depends on the `entity_translations` table, `translations` module API, and events from Phase 1. If Phase 1 is not complete, Phase 2 cannot proceed.
**Mitigation:** Phase 1 (SPEC-026) must be fully implemented before starting Phase 2. The translations module directory must exist with functioning CRUD API.
**Residual risk:** None if Phase 1 is completed first.

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/shared/src/lib/localization/translatable-fields.ts` | Registry: `registerTranslatableFields()` / `getTranslatableFields()` |
| `packages/core/src/modules/translations/lib/translatable-fields.ts` | `isTranslatableField()` auto-detection utility |
| `packages/core/src/modules/translations/components/TranslationManager.tsx` | Main UI component (standalone + embedded modes) |
| `packages/core/src/modules/translations/backend/config/translations/page.tsx` | Standalone config page |
| `packages/core/src/modules/translations/widgets/injection/translation-manager/widget.ts` | Widget injection module definition |
| `packages/core/src/modules/translations/widgets/injection/translation-manager/widget.client.tsx` | Widget client component |
| `packages/core/src/modules/translations/widgets/injection-table.ts` | Widget-to-spot mappings |
| `packages/core/src/modules/translations/subscribers/reindex.ts` | Reindex on `translations.updated` |
| `packages/core/src/modules/translations/subscribers/reindex-on-delete.ts` | Reindex on `translations.deleted` |
| `packages/core/src/modules/catalog/lib/translatable-fields.ts` | Catalog translatable field definitions |
| `packages/core/src/modules/dictionaries/lib/translatable-fields.ts` | Dictionary translatable field definitions |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/modules/query_index/lib/indexer.ts` | Add translation loading after CF block in `buildIndexDoc()` (~15 lines) |
| `packages/core/src/modules/query_index/lib/engine.ts` | Add `l10n:` prefix to `cfFilters` and `wantsCf` checks (2 lines) |
| `packages/shared/src/lib/localization/index.ts` | Add barrel exports for translatable-fields |

---

## Verification

1. **TranslationManager standalone** — navigate to `/backend/config/translations`, select entity, select locale, edit translations, save and reload to confirm persistence
2. **TranslationManager widget** — edit a product at `/backend/catalog/products/[id]`, see translation widget in column 2, add German translation, save, reload
3. **Widget on create page** — create a new product, translation widget should not appear (no record ID yet)
4. **Search index** — create product with German translation, verify `entity_indexes.doc` contains `l10n:de:title` key
5. **Search tokens** — verify `search_tokens` has rows with `field = 'l10n:de:title'`
6. **Reindex on translation update** — update a translation via API, verify entity index is updated automatically
7. **QueryEngine filter** — filter products by `l10n:de:title` via API query params
8. **Fulltext search** — search with a German term, confirm products with matching German translations appear
9. **Build** — `yarn build` passes
10. **Tests** — `yarn test` passes

---

## Changelog

### 2026-02-15 (v1)
- Initial SPEC-026a for Phase 2
- TranslationManager UI component (standalone config page + widget injection)
- Search indexer extension: `l10n:{locale}:{field}` keys in `entity_indexes.doc`
- Reindex subscribers for `translations.updated` / `translations.deleted` events
- QueryEngine `l10n:*` filter routing (2-line change in `engine.ts`)
- Per-entity translatable field definitions (code-based registry + auto-detection)
- Phase 3 A/B testing mentioned as future direction
