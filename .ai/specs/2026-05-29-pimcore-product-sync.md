# Pimcore Product Sync

- **Date**: 2026-05-29
- **Status**: Draft
- **Scope**: OSS
- **Package**: `@open-mercato/pimcore-sync`
- **Module ID**: `pimcore_sync`
- **Requires**: `integrations`, `data_sync`, `catalog`

## TLDR

**Key Points:**
- Build a dedicated workspace package `packages/pimcore-sync/` (`@open-mercato/pimcore-sync`) that synchronises product and category data from a Pimcore 10/11 instance into Open Mercato catalog entities through the **Pimcore Datahub GraphQL API**.
- Reuse Open Mercato's existing integration, `data_sync`, catalog-command, credentials, progress, and mapping infrastructure instead of inventing a Pimcore-specific sync engine.
- Ship an operator-facing mapping UI on the integration detail page so product/category class selection and field mapping remain configurable without code changes.

**Scope:**
- `IntegrationDefinition` for Pimcore credentials (`baseUrl`, `apiKey`, `datahubConfig`, optional default class names) plus env-based preconfiguration in `setup.ts`.
- `PimcoreGraphQLClient`, health check service, discovery endpoint, and mapping UI widget.
- `DataSyncAdapter` for `catalog_product` and `catalog_category`, with incremental sync via `modificationDate` cursor and additive/idempotent upsert behavior.
- Persistence through existing `SyncMapping`, `SyncRun`, `SyncExternalIdMapping`, `IntegrationCredentials`, and catalog entities — **no new DB entities**.
- Optional follow-up for media import: download Pimcore assets and re-host them through Open Mercato attachments, analogous to `sync-akeneo`.

**Concerns:**
- Pimcore Datahub schemas are operator-defined, so class/field discovery and mapping validation must be strict.
- Category import needs parent-before-child ordering and bounded parent resolution lookups.
- Pimcore authenticates with an API key in the query string, so the client must enforce HTTPS and never log secret-bearing URLs.

## Overview

This spec adds a first-party Pimcore connector for teams whose source-of-truth product catalog lives in Pimcore, but whose commerce, quoting, or ordering workflows run in Open Mercato. The package lives at `packages/pimcore-sync/` and follows the existing `packages/sync-akeneo/` pattern: provider-owned package, integration marketplace registration, `DataSyncAdapter` implementation, mapping UI, and no schema forks inside `packages/core/`.

The target audience is implementation teams and operators who need a supported, repeatable Pimcore import with tenant-scoped credentials, health checks, incremental sync, and no project-specific APIs, export jobs, or one-off middleware.

> **Implementation Reference**: This design uses Open Mercato's existing `packages/sync-akeneo/` package only as an internal implementation reference for provider-owned packages, integration marketplace wiring, `DataSyncAdapter` registration, mapping UI, and env preconfiguration. The external Pimcore contract remains Pimcore Datahub GraphQL. We explicitly reject file-export / CSV-drop / one-off push workflows because Open Mercato already has a queue-backed `data_sync` engine, cursor persistence, integration credentials, and catalog commands. The connector therefore stays pull-based and GraphQL-native.

## Problem Statement

Pimcore is a widely-used open-source PIM. Teams that maintain their master product catalog in Pimcore often expose product data through custom APIs, bespoke export jobs, or one-off middleware because Open Mercato does not yet provide a first-party Pimcore connector. The difficulty is not only transport: Pimcore's architecture allows each implementation to define its own object classes, field layouts, naming conventions, and category model. That flexibility is powerful, but it makes connecting Pimcore to a commerce catalog difficult even for technical teams unless discovery, mapping, and validation are handled explicitly.

Key challenges:
- Pimcore's architecture allows arbitrary object classes, field layouts, and naming conventions, so each implementation can look different.
- Mapping Pimcore into a commerce catalog can be difficult even for technical teams when class structure, field names, and category modeling are project-specific.
- A hardcoded product/category mapping is insufficient; operator-driven discovery and configuration UI are required.
- Pimcore categories form a tree; import order must respect parent-child dependencies.
- Incremental sync must resume after failure without re-importing the entire catalog.
- Credentials and remote schema metadata must stay tenant-scoped and safe at rest.

## Proposed Solution

A new package `packages/pimcore-sync/` that follows the established `sync-akeneo` pattern:

1. **IntegrationDefinition** — registers Pimcore in the integrations marketplace with a credential form (base URL, API key, Datahub configuration name).
2. **PimcoreGraphQLClient** — thin GraphQL client with pagination, auth, timeout handling, and safe query construction.
3. **DataSyncAdapter** — implements the mandatory `getMapping()` method (loads config from `SyncMapping` via DI) and `streamImport()` for `catalog_product` and `catalog_category`. The adapter itself persists catalog entities via catalog commands in `lib/catalog-importer.ts`.
4. **Discovery API** — `GET /api/pimcore_sync/discovery` fetches available Pimcore classes + their fields via GraphQL introspection (using stored credentials from `integrationCredentialsService`). Used by the mapping UI.
5. **Mapping config UI widget** — injected into the Pimcore integration detail page. Lets operators select product/category classes and configure field mappings. Persisted via the existing `POST /api/data_sync/mappings` and `PUT /api/data_sync/mappings/:id` endpoints.
6. **Env preconfiguration** — `OM_INTEGRATION_PIMCORE_BASE_URL` + `OM_INTEGRATION_PIMCORE_API_KEY` + `OM_INTEGRATION_PIMCORE_DATAHUB_CONFIG` are read in `setup.ts` so a fresh install can self-configure from environment variables. Legacy `PIMCORE_*` aliases may be accepted but are not the documented primary surface.
7. **Media import** — product image fields (operator-configured) are downloaded from `{baseUrl}{asset.fullpath}?apikey={apiKey}`, re-hosted through the Open Mercato `Attachment` storage layer, and linked to the product. Mirrors the `sync-akeneo` asset pipeline. Included in Phase 2.
8. **Additive idempotent sync** — no deletion/reconciliation in MVP; re-running sync deduplicates by external ID through `externalIdMappingService`.
9. **Deferred enrichments** — prices and custom fields are follow-up capabilities, not hidden writes inside the Phase 2 product command path.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Provider package lives in `packages/pimcore-sync/` | Matches monorepo rules for external connectors and mirrors `packages/sync-akeneo/` |
| Use Pimcore Datahub GraphQL instead of ad-hoc REST assumptions | Datahub is the supported Pimcore contract for object data and schema introspection |
| Store connector config in existing `SyncMapping` rows | Avoids new tables and keeps mappings editable through the existing `data_sync` APIs |
| Persist through catalog commands, not direct ORM writes | Preserves audit/cache/index/event side effects owned by catalog |
| Keep sync additive-only in MVP | Simplifies blast radius; no risky deletion/reconciliation logic before baseline import works |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Create a new Pimcore-specific mapping table | Existing `SyncMapping` already fits the data and avoids schema churn |
| Use direct ORM writes to catalog tables | Violates command-side-effect rules and risks bypassing index/cache/event updates |
| Build a push/export workflow in Pimcore | Inverts ownership; Open Mercato already has `data_sync` jobs, cursors, and retry handling |
| Add deletion reconciliation in MVP | Too risky without first validating class mapping, category ordering, and cursor behavior |

## User Stories / Use Cases

- **Integration admin** wants to save Pimcore credentials and validate connectivity so that the connector can be enabled without manual scripts.
- **Catalog manager** wants to choose which Pimcore classes represent products and categories so that one Pimcore instance can expose multiple object models safely.
- **Catalog manager** wants to map Pimcore field keys to Open Mercato product/category fields so that no code change is needed for class-specific schemas.
- **Operations engineer** wants incremental sync with resume-after-failure semantics so that large imports are repeatable and do not duplicate catalog entities.
- **Merchandiser** wants category parents imported before children so that the Open Mercato category tree stays valid even when Pimcore returns rows out of order.
- **Support engineer** wants discovery responses and health checks to fail clearly when Datahub schema or credentials are wrong so that setup issues are diagnosable without SSHing into Pimcore.

## Architecture

### Components

| Component | Responsibility |
|-----------|----------------|
| `integration.ts` | Registers Pimcore as an `IntegrationDefinition`, credential schema, health service, detail widget spot |
| `lib/client.ts` | Builds authenticated Datahub GraphQL requests, validates class names, paginates listings, runs introspection and health checks |
| `lib/adapter.ts` | Implements `DataSyncAdapter` contract for `catalog_product` and `catalog_category` |
| `lib/mapping.ts` | Loads and validates `SyncMapping` rows, applies defaults, resolves class fallback chain |
| `lib/catalog-importer.ts` | Converts Pimcore objects into existing catalog commands and updates external ID mappings |
| `api/discovery/route.ts` | Tenant-scoped discovery endpoint with cache, auth, and `openApi` export |
| `widgets/injection/pimcore-config/widget.client.tsx` | Operator UI for class selection and field mapping |
| `data_sync` engine | Owns run orchestration, cursor persistence, job/progress lifecycle, and engine-level events |

### Runtime Data Flow

#### 1. Discovery + Configuration Flow
1. Operator opens the Pimcore integration detail page.
2. The injected widget calls `GET /api/pimcore_sync/discovery` using `apiCall`.
3. The route enforces `requireAuth` + `requireFeatures: ['pimcore_sync.configure']`, parses `refresh`, and checks tenant-scoped cache first.
4. On cache miss (or `?refresh=true`), the route resolves `integrationCredentialsService`, loads stored credentials, creates `PimcoreGraphQLClient`, runs GraphQL introspection, parses the schema into class/field metadata, and stores the result in cache.
5. The widget renders class selectors and field mapping selectors, then saves mappings through the existing `data_sync` mapping endpoints via `useGuardedMutation(...).runMutation(...)`.

#### 2. Sync Execution Flow
1. Operator or scheduler triggers the existing `POST /api/data_sync/run` endpoint for `integrationId: 'pimcore_sync'` and an entity type (`catalog_product` or `catalog_category`).
2. The `data_sync` engine resolves credentials through `integrationCredentialsService`, calls adapter `getMapping()`, serialises mapping into the run payload, and starts the run/progress lifecycle.
3. `streamImport()` creates `PimcoreGraphQLClient`, reuses a single request container for the entire run, and pages through Datahub listing queries.
4. The adapter maps each remote object into catalog command input and calls existing catalog commands through `commandBus`.
5. `externalIdMappingService` stores or updates the remote-to-local mapping, making re-runs idempotent.
6. The engine records counters/cursor in `SyncRun` / `SyncCursor` and emits its normal lifecycle/progress events.

### Commands & Events

#### Commands used by this connector
- `catalog.products.create`
- `catalog.products.update`
- `catalog.categories.create`
- `catalog.categories.update`

The connector introduces **no new Pimcore-specific command contract**. All mutations go through existing catalog commands so indexing, cache invalidation, audit, and downstream side effects remain owned by the catalog module.

#### Events used by this connector
- The connector emits **no new `pimcore_sync.*` events** in MVP.
- The connector relies on existing engine and progress events already emitted by the platform, such as `data_sync.run.*` lifecycle events (for example completion/failure) and `progress.job.*` DOM/SSE updates.
- Because the connector has no cross-module side-effect subscribers of its own in MVP, there is no new `events.ts` file in this package.

#### Undo / rollback contract
- Sync is **additive-only** in MVP (Phases 1–4). It does **not** delete or reconcile missing Pimcore objects.
- There is **no undo** for products/categories created by a sync run. Created catalog entities are real domain rows and remain until a user or later feature removes them via standard catalog flows.
- Re-running the same sync is **idempotent** for already-seen external IDs because `externalIdMappingService` deduplicates on `integrationId + entityType + externalId + scope`.
- Failure is isolated to the current item/batch. Previously completed items stay committed; the run resumes from cursor on retry.
- **Future (Phase 5):** Reconciliation — deactivating catalog objects whose Pimcore IDs are absent from `SyncExternalIdMapping` records touched in a full sync run (following `reconcileProducts`/`reconcileCategories` pattern from `sync-akeneo`). Intentionally deferred until baseline import is proven stable.

### Transaction, Isolation, and DI Boundaries
- The adapter uses `createRequestContainer()` exactly once per run to resolve `em`, `commandBus`, and `externalIdMappingService`. Never create a new container inside a per-item loop.
- Catalog writes remain per-command atomic; the spec does not introduce a multi-batch transaction.
- All reads and writes are scoped with `tenantId` and `organizationId`.
- Cross-module references use foreign key IDs and the mapping service only — **no direct ORM relationships between Pimcore package entities and core catalog/integration entities**.

### Key Architectural Decisions

#### 1. Adapter persists data itself — sync engine only counts
The sync engine does not persist `ImportBatch.items`. It uses the items array only to count create/update/skip/fail and to log failed items. The adapter's `streamImport` must write all entities to the database directly, using catalog commands (`catalog.products.create`, `catalog.products.update`, `catalog.categories.create`, `catalog.categories.update`) via a `CommandBus` resolved from `createRequestContainer()`. This is encapsulated in `lib/catalog-importer.ts`. `ImportItem.action` reflects what the importer decided; `ImportItem.data` on failure carries `{ errorMessage, sourceIdentifier }` for log display.

#### 2. `getMapping()` and `streamImport()` have separate DI access points
`getMapping()` runs inside a web-process request context (called by the sync engine before enqueueing). It uses `createRequestContainer()` to load `SyncMapping` rows and returns the `DataMapping` blob that the engine then serialises into the queue job payload and passes back as `input.mapping` when `streamImport` starts in the worker process.

`streamImport()` receives `input.mapping` (already loaded) and `input.credentials` (resolved by the engine from `integrationCredentialsService`). It does not resolve credentials through DI itself. It only reuses the single request container needed by `catalog-importer.ts` for `em`, `CommandBus`, and `ExternalIdMappingService`.

#### 3. GraphQL client builds queries dynamically, but safely
Since Pimcore's GraphQL schema is generated per Datahub configuration and class names determine query names, the `PimcoreGraphQLClient` builds queries dynamically using template strings. The class name is validated against `/^[A-Z][A-Za-z0-9_]*$/` before interpolation to prevent injection. Field selections come from validated mapping config and introspection results, not arbitrary free text.

#### 4. Convention defaults before UI config
Phase 2 ships working product import with hardcoded defaults (`name` → `title`, `sku` → `sku`, etc.) in `buildDefaultProductMapping()`. Phase 4 overlays operator configuration on top. Operators get value immediately and customise later.

#### 5. Class resolution fallback chain
See the Data Models section below. The adapter prefers `SyncMapping` class choices, then credential defaults, then hardcoded literals.

#### 6. Reconciliation is out of scope for Phases 1–4
Objects deleted from Pimcore are not removed from Open Mercato in this version. The sync is additive. Objects with `published: false` are updated to `isActive: false` (field update, not deletion). Phase 5 adds opt-in reconciliation (deactivation of catalog records absent from a full sync run) following the `sync-akeneo` `reconcileProducts`/`reconcileCategories` pattern.

#### 7. Discovery response cache uses `@open-mercato/cache`
The discovery route resolves `cacheService` from `createRequestContainer()` and uses a tenant-scoped key with TTL 300 seconds. `?refresh=true` bypasses the cache and overwrites the cached payload.

#### 8. Introspection-based discovery
The discovery endpoint uses GraphQL schema introspection (`__schema`) to discover available classes and their fields. This is more reliable than maintaining a separate REST API, as the introspection result always reflects the exact schema exposed by the configured Datahub endpoint.

## Data Models

### Persistent Models Used (Existing — No New Tables)

#### `IntegrationCredentials` (existing `integration_credentials`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Existing PK |
| `integration_id` | text | `pimcore_sync` |
| `credentials` | json | Encrypted blob at rest; stores `baseUrl`, `apiKey`, `datahubConfig`, optional default class names |
| `organization_id` | UUID | Scope boundary |
| `tenant_id` | UUID | Scope boundary |
| `created_at`, `updated_at`, `deleted_at` | timestamp | Standard lifecycle columns |

**Encryption note**: credentials are stored via `integrationCredentialsService`, which creates/uses the existing encryption map for `integrations:integration_credentials`, encrypts the credentials blob at rest, and reads it back via `findOneWithDecryption`. This package does **not** introduce any hand-rolled crypto.

#### `SyncMapping` (existing `sync_mappings`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Existing PK |
| `integration_id` | text | Always `pimcore_sync` |
| `entity_type` | text | One of `pimcore_config`, `catalog_product`, `catalog_category` |
| `mapping` | json | Stores class config and field-map blobs |
| `organization_id` | UUID | Scope boundary |
| `tenant_id` | UUID | Scope boundary |
| `created_at`, `updated_at` | timestamp | Existing timestamps |

#### `SyncExternalIdMapping` (existing `sync_external_id_mappings`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Existing PK |
| `integration_id` | text | Always `pimcore_sync` |
| `internal_entity_type` | text | `catalog_product` or `catalog_product_category` |
| `internal_entity_id` | UUID | Local catalog entity ID |
| `external_id` | text | Pimcore object ID as string |
| `sync_status` | text | Existing integration sync status |
| `last_synced_at` | timestamp | Existing field |
| `organization_id` | UUID | Scope boundary |
| `tenant_id` | UUID | Scope boundary |
| `created_at`, `updated_at`, `deleted_at` | timestamp | Existing lifecycle columns |

This is the idempotency anchor for re-runs and retry-after-failure behavior.

#### `SyncRun` / `SyncCursor` (existing `sync_runs`, `sync_cursors`)
| Entity | Key columns used | Purpose |
|--------|------------------|---------|
| `SyncRun` | `integration_id`, `entity_type`, `status`, `cursor`, `created_count`, `updated_count`, `skipped_count`, `failed_count`, `organization_id`, `tenant_id`, `progress_job_id` | Existing run tracking owned by `data_sync` |
| `SyncCursor` | `integration_id`, `entity_type`, `direction`, `cursor`, `organization_id`, `tenant_id` | Existing persisted cursor store |

The Pimcore connector does not add columns here; it only supplies cursor values in the engine contract.

#### `CatalogProduct` / `CatalogProductCategory` (existing catalog tables)
| Entity | Columns materially written by this connector |
|--------|---------------------------------------------|
| `CatalogProduct` | `title`, `subtitle`, `description`, `sku`, `handle`, `is_active` |
| `CatalogProductCategory` | `name`, `slug`, `parent_id`, `is_active` |

The connector writes these through existing catalog commands only. It does not define cross-module ORM relations.

### SyncMapping JSONB Schema

All Pimcore configuration is stored in `SyncMapping` rows (from `data_sync`). Three row types per tenant/org:

#### Row 1 — Global class config (`entityType: 'pimcore_config'`)

```typescript
type PimcoreConfigBlob = {
  productClass: string    // e.g. 'Product'
  categoryClass?: string  // e.g. 'Category'; optional
}
```

The adapter reads this row to determine which Pimcore class to query in `streamImport`. The UI "Classes" tab writes to this row.

#### Row 2 — Product field mapping (`entityType: 'catalog_product'`)

```typescript
type PimcoreProductMappingBlob = {
  fieldMap: {
    title?: string        // Pimcore field key → OM title
    handle?: string
    sku?: string
    description?: string
    subtitle?: string
    imageField?: string   // Pimcore image/asset field key (e.g. 'mainImage'); absent = no media import
  }
}
```

#### Row 3 — Category field mapping (`entityType: 'catalog_category'`)

```typescript
type PimcoreCategoryMappingBlob = {
  fieldMap: {
    name?: string   // Pimcore field key → OM category name
    slug?: string   // Pimcore field key → OM slug; defaults to `key`
  }
}
```

Defaults when no row exists: `buildDefaultProductMapping()` / `buildDefaultCategoryMapping()` in `lib/shared.ts` return a `PimcoreDataMapping` (see Adapter Contract section).

`SyncMapping.mapping` is `Record<string, unknown>`. `loadPimcoreMapping` MUST validate it through `pimcoreMappingBlobSchema.safeParse(row.mapping)` before use. On parse failure, fall back to the default blob — never trust the raw value.

### Class Resolution Fallback Chain (First Wins)

Used by the adapter when starting `streamImport`:

1. `SyncMapping[entityType='pimcore_config'].mapping.productClass` — set by operator via UI
2. `credentials.defaultProductClass` — set in credential form
3. Literal `'Product'` (or `'Category'` for categories)

### Adapter Contract

The `DataSyncAdapter` interface requires:

- **`getMapping(input)`** — mandatory, non-optional. Called by the sync engine before `streamImport`. Loads `SyncMapping` rows from DB via `createRequestContainer()` → `em`. Returns a `PimcoreDataMapping` value.
- **`streamImport(input)`** — receives `input.credentials` (resolved by the engine from `integrationCredentialsService`) and `input.mapping` (the `PimcoreDataMapping` returned by `getMapping()`). Creates `PimcoreGraphQLClient` from `input.credentials`. All DB writes happen in `lib/catalog-importer.ts`. `ImportBatch.items` carries only status — the sync engine uses items only for counting and error logging.
- **`getInitialCursor()`** — omitted; engine defaults to a full scan on first run.
- **`validateConnection(input)`** — creates `PimcoreGraphQLClient` from `input.credentials`, calls `healthCheck()`.

#### `PimcoreDataMapping` type

```typescript
// lib/shared.ts
export type PimcoreDataMapping = DataMapping & {
  blob: PimcoreProductMappingBlob | PimcoreCategoryMappingBlob
}
```

`buildDefaultProductMapping(entityType)` always populates the required `DataMapping` fields:

```typescript
{
  entityType,
  matchStrategy: 'externalId',  // mandatory — engine uses this for dedup log
  fields: [],                    // engine ignores fields[] for this adapter
  blob: { fieldMap: { title: 'name', sku: 'sku', handle: 'key', description: 'description', subtitle: 'shortDescription' } }
}
```

`streamImport` casts `input.mapping` back: `const blob = (input.mapping as PimcoreDataMapping).blob as PimcoreProductMappingBlob`.

`createRequestContainer()` in `streamImport`: called once per run at the start of the generator to create the catalog importer (`createPimcoreCatalogImporter`). The container, `em`, `commandBus`, and `externalIdMappingService` resolved from that single call are reused for the entire run — this is critical for identity-map correctness. Never call `createRequestContainer()` inside a per-item loop.

### Data Mapping

#### Product (default convention mapping)

| Pimcore field (default key) | OM CatalogProduct field | Notes |
|---|---|---|
| `name` | `title` | Configurable via mapping UI |
| `key` | `handle` | Pimcore object key — must be slugified to `/^[a-z0-9\-_]+$/` before passing to command |
| `sku` | `sku` | Configurable; falls back to `articleNumber` if `sku` field missing. If the resolved value fails `/^[A-Za-z0-9\-_\.]+$/`, omit the field (pass `undefined`) — do not sanitize, as that risks collisions |
| `description` | `description` | Configurable |
| `shortDescription` | `subtitle` | Configurable, optional |
| `published` | `isActive` | `false` → `isActive: false` even on incremental runs (additive update, not deletion) |
| `id` | external ID in `ExternalIdMapping` | Always set; not user-configurable |
| Image field (configurable) | `Attachment` (hero image + storage) | Operator selects the Pimcore image field key in the mapping UI. Asset binary downloaded from `{baseUrl}{asset.fullpath}?apikey={apiKey}` and re-hosted through `storePartitionFile` → `Attachment` entity. Only the first/hero image is synced in Phase 2; multi-image galleries are a follow-up. |

Custom fields not in the `fieldMap` are skipped by default. Arbitrary Pimcore attributes may be added in a later custom-field/metadata mapping phase, but Phase 2 imports only the fixed product fields above.

Price import is also out of scope for Phase 2. A later pricing phase must write through `catalog.prices.create/update` and define `priceKindId`, `currencyCode`, and optional channel mapping explicitly; it must not treat `basePrice` as a product command field.

#### Category (default convention mapping)

| Pimcore field (default key) | OM CatalogProductCategory field | Notes |
|---|---|---|
| `key` | `slug` | Pimcore object key — must be slugified to `/^[a-z0-9\-_]+$/` |
| `name` (class field) or `key` | `name` | Configurable; falls back to `key` if no `name` field |
| `id` | external ID | Always set |
| computed `parentId` | `parentId` | Two-level lookup: see Category Parent Resolution below |

#### Category Import Order

All category objects for the configured class are fetched before any DB writes. Each object's depth is computed as the number of `/` separators in its `fullpath` field (for example `/Electronics/Laptops/` → depth 2). Objects are sorted by depth ascending so parents are always processed before children within a run.

**Incremental sync dependency**: incremental category sync (with cursor) only correctly resolves parents whose external-ID mapping was stored by a prior full sync run. On the very first sync, always run a full sync (`cursor = null`). This is a known limitation — the spec does not attempt to resolve it automatically.

#### Category Parent Resolution

For each category object, the importer resolves the Open Mercato parent category ID with this two-level lookup (same pattern as `sync-akeneo`):

1. `externalIdMappingService.lookupLocalId('pimcore_sync', 'catalog_product_category', pimcoreParentId, scope)` — covers parents imported in this or a previous run.
2. If not found: `findOneWithDecryption(em, CatalogProductCategory, { slug: key_of_parent, organizationId, tenantId, deletedAt: null })` — covers categories that exist in Open Mercato but were not imported via Pimcore (for example manually created). On hit, the mapping is stored for future lookups.
3. If still not found: `parentId = null` (root category).

Parent ID for each category object is determined from the GraphQL response:
- The `fullpath` field gives the object's full path (for example `/Electronics/Laptops/Gaming`).
- The parent's Pimcore ID is resolved by looking up the object at the parent path, or by using the `parent { id }` field if exposed in the Datahub schema.
- The client requests `parent { ... on object_{ClassName} { id key fullpath } }` in the listing query when fetching categories.

## API Contracts

### Internal API — `GET /api/pimcore_sync/discovery`

**Ownership**: new package-owned route in `packages/pimcore-sync/src/modules/pimcore_sync/api/discovery/route.ts`

**Route metadata**:
- `metadata.GET = { requireAuth: true, requireFeatures: ['pimcore_sync.configure'] }`
- Route **must export `openApi`**.

**Query schema**:

```typescript
type DiscoveryQuery = {
  refresh?: boolean
}
```

- `refresh=true` bypasses cache and fetches fresh introspection data from Pimcore.
- Any non-boolean query value fails `discoveryQuerySchema` parsing and returns `400`.

**Response schema**:

```typescript
type DiscoveryResponse = {
  ok: boolean
  classes: Array<{
    name: string
    fields: Array<{
      name: string
      type: string
    }>
  }>
  message?: string
}
```

**Success response** (`200`):

```json
{
  "ok": true,
  "classes": [
    {
      "name": "Product",
      "fields": [
        { "name": "name", "type": "String" },
        { "name": "sku", "type": "String" },
        { "name": "shortDescription", "type": "String" }
      ]
    }
  ],
  "message": "Pimcore schema loaded"
}
```

**Handled non-fatal response** (`200` with empty payload):
- Missing credentials: `{ ok: false, classes: [], message: 'Save Pimcore credentials before loading remote fields.' }`
- Upstream introspection/auth failure: `{ ok: false, classes: [], message: '<safe error message>' }`

The route stays `200` for these cases so the widget can render inline setup guidance without breaking the page shell.

**Error responses**:
- `400` — invalid query (`refresh` parse failure)
- `401` — missing auth context
- `403` — feature guard failure (`pimcore_sync.configure`)

**Cache behavior**:
- Key: `pimcore:discovery:${tenantId}:${organizationId}`
- TTL: 300 seconds
- `refresh=true` bypasses and overwrites cache
- No cache invalidation is required for `SyncMapping` writes because mappings are not cached by this endpoint

**OpenAPI contract**:

```typescript
export const openApi = {
  tags: ['Pimcore'],
  summary: 'Fetch available Pimcore classes and their field definitions',
}
```

### Reused Platform Endpoints (No Contract Changes)

| Endpoint | Ownership | Pimcore usage |
|----------|-----------|---------------|
| `POST /api/data_sync/run` | existing `data_sync` route | Triggers product/category import runs |
| `POST /api/data_sync/validate` | existing `data_sync` route | Runs `validateConnection()` against stored Pimcore credentials |
| `GET /api/data_sync/mappings?integrationId=pimcore_sync` | existing `data_sync` route | Loads saved mapping rows for widget prefill |
| `POST /api/data_sync/mappings` | existing `data_sync` route | Creates first mapping row for a given `entityType` |
| `PUT /api/data_sync/mappings/:id` | existing `data_sync` route | Updates an existing mapping row |

This spec does **not** redefine those route payloads; it only specifies how the Pimcore package consumes them.

### External API — Pimcore Datahub GraphQL Contract

Pimcore exposes its data through the **Datahub** bundle which generates a GraphQL endpoint per configuration.

#### Endpoint

```
{baseUrl}/pimcore-graphql-webservices/{configurationName}?apikey={apiKey}
```

- `baseUrl`: the Pimcore instance URL (for example `https://pim.example.com`)
- `configurationName`: the Datahub endpoint name configured in Pimcore admin (for example `open-mercato`)
- `apiKey`: generated in Pimcore Datahub security settings; passed as query parameter `?apikey=...`

All requests are `POST` with `Content-Type: application/json` body containing `{ "query": "...", "variables": {...} }`.

#### Authentication

The API key is passed as a **query parameter** (`?apikey=<key>`). This is Pimcore's built-in Datahub authentication method. The client MUST use HTTPS to avoid key leakage.

#### Queries

##### List objects (initial full sync)

```graphql
query ListProducts($first: Int!, $after: Int, $sortBy: String, $sortOrder: String) {
  get{ClassName}Listing(
    first: $first
    after: $after
    sortBy: $sortBy
    sortOrder: $sortOrder
  ) {
    totalCount
    edges {
      node {
        id
        key
        fullpath
        published
        modificationDate
        # ... class-specific fields selected dynamically
      }
    }
  }
}
```

- `first`: page size (limit)
- `after`: offset (0-based integer) — **not a cursor token**. Offset-based pagination is not stable when objects are inserted or deleted mid-sync; the connector therefore relies on `modificationDate` filtering as the primary resumption mechanism rather than offset continuation.
- `sortBy`: `"modificationDate"`
- `sortOrder`: `"ASC"`
- `{ClassName}` is replaced with the actual Pimcore class name (for example `Product` → `getProductListing`)

##### List objects (incremental sync)

```graphql
query ListProductsIncremental($first: Int!, $after: Int, $filter: String) {
  get{ClassName}Listing(
    first: $first
    after: $after
    sortBy: "modificationDate"
    sortOrder: "ASC"
    filter: $filter
  ) {
    totalCount
    edges {
      node {
        id
        key
        fullpath
        published
        modificationDate
        # ... class-specific fields
      }
    }
  }
}
```

The `filter` variable is a JSON string: `"{\"o_modificationDate\": {\"$gt\": <unix_timestamp>}}"`. `modificationDate` values are Unix seconds integers.

##### Get object parent info (for categories)

```graphql
query GetCategory($id: Int!) {
  get{ClassName}(id: $id) {
    id
    key
    fullpath
    published
    modificationDate
    parent {
      ... on object_{ClassName} {
        id
        key
        fullpath
      }
    }
  }
}
```

Parent info is also available on listing nodes if the schema exposes the `parent` field.

##### Product image/asset field (media import)

When the operator configures an image field (for example `mainImage`), the listing query includes that field as an asset fragment:

```graphql
mainImage {
  id
  fullpath
  mimetype
  filesize
}
```

The asset binary is downloaded via:
```
GET {baseUrl}{asset.fullpath}?apikey={apiKey}
```

This is a direct HTTP `GET` against the Pimcore server — the same API key used for GraphQL requests authenticates asset downloads. The connector uses this URL to download the binary, then stores it through `storePartitionFile` → `Attachment` entity, exactly as `sync-akeneo` does. The `asset.id` (Pimcore integer) is used as the `externalId` for `externalIdMappingService` deduplication so re-runs skip already-downloaded assets.

If the image field is not configured or the asset node is `null`, media import is silently skipped for that product.



```graphql
query IntrospectSchema {
  __schema {
    queryType {
      fields {
        name
        description
      }
    }
    types {
      name
      kind
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
}
```

The client parses introspection results to:
1. Extract class names from listing query fields (`get{ClassName}Listing` → class name)
2. Extract available fields per class from `object_{ClassName}` type definition

##### Health ping

```graphql
query HealthCheck {
  __typename
}
```

A successful response (`{ "data": { "__typename": "Query" } }`) confirms connectivity and valid API key. A 401 or error response indicates invalid credentials.

#### Response Format

All responses follow standard GraphQL format:

```json
{
  "data": { ... },
  "errors": [{ "message": "...", "locations": [...] }]
}
```

#### Key Differences from REST API (Common Misconception)

- ❌ Pimcore does **not** expose `/api/objects`, `/api/class-list`, `/api/class?id=...`, or `/api/user` for this integration — those are hallucinated REST endpoints in the context of this connector.
- ✅ All data access goes through the Datahub GraphQL endpoint.
- ✅ Class/field discovery uses standard GraphQL introspection (`__schema`, `__type`).
- ✅ The query names are dynamically generated: `get{ClassName}Listing` for lists, `get{ClassName}` for single objects.
- ✅ `modificationDate` is a Unix timestamp (integer seconds) on the node response.

## Security

- **Validation**: `data/validators.ts` defines `discoveryQuerySchema`, `discoveryResponseSchema`, `pimcoreCredentialsSchema`, and `pimcoreMappingBlobSchema`. All user-controlled request/query payloads are parsed with Zod before use.
- **GraphQL injection prevention**: the client validates `className` against `/^[A-Z][A-Za-z0-9_]*$/` before interpolating it into GraphQL query names. Field selections come from validated mapping blobs and/or introspection results, not raw user text.
- **HTTPS only**: Pimcore Datahub uses `?apikey=` in the URL by design. The connector therefore requires HTTPS for remote requests. Non-HTTPS base URLs are rejected.
- **Credential secrecy**: credentials are stored through `integrationCredentialsService`, encrypted at rest, and read with decryption helpers. The connector never returns the API key in API responses.
- **Log hygiene**: error handling must not log full Datahub URLs containing `apikey`. Safe error messages only.
- **Auth & RBAC**: provider-owned discovery UI/route requires authenticated backend access plus `pimcore_sync.configure`. Existing shared endpoints keep their own guards: mapping writes require `data_sync.configure`, and sync execution requires `data_sync.run`. The provider does not declare a misleading `pimcore_sync.run` feature unless a provider-owned run wrapper is introduced later.
- **Tenant isolation**: every scoped entity lookup filters by `organizationId` and `tenantId`. Cache keys are tenant-scoped and org-scoped.
- **XSS**: widget renders only plain text labels from translations/introspection; no unsafe HTML rendering is introduced.

## Internationalization (i18n)

Translation files: `src/modules/pimcore_sync/i18n/en.json` and `pl.json`.

### Required key set

| Area | Keys |
|------|------|
| Integration metadata | `pimcore_sync.title`, `pimcore_sync.description` |
| Credential fields | `pimcore_sync.credentials.baseUrl`, `pimcore_sync.credentials.apiKey`, `pimcore_sync.credentials.datahubConfig`, `pimcore_sync.credentials.defaultProductClass`, `pimcore_sync.credentials.defaultCategoryClass` |
| Tabs | `pimcore_sync.config.tab`, `pimcore_sync.config.tabs.classes`, `pimcore_sync.config.tabs.productFields`, `pimcore_sync.config.tabs.categoryFields` |
| Section headers | `pimcore_sync.config.sections.classes`, `pimcore_sync.config.sections.productFields`, `pimcore_sync.config.sections.categoryFields` |
| Class selectors | `pimcore_sync.config.fields.productClass`, `pimcore_sync.config.fields.categoryClass` |
| Product field labels | `pimcore_sync.config.fields.title`, `pimcore_sync.config.fields.handle`, `pimcore_sync.config.fields.sku`, `pimcore_sync.config.fields.description`, `pimcore_sync.config.fields.subtitle` |
| Category field labels | `pimcore_sync.config.fields.name`, `pimcore_sync.config.fields.slug` |
| Actions | `pimcore_sync.actions.save`, `pimcore_sync.actions.refresh`, `pimcore_sync.actions.validate` |
| Loading / empty / errors | `pimcore_sync.discovery.loading`, `pimcore_sync.discovery.empty`, `pimcore_sync.discovery.credentialsMissing`, `pimcore_sync.discovery.failed`, `pimcore_sync.discovery.refreshed`, `pimcore_sync.validation.invalidQuery`, `pimcore_sync.validation.httpsRequired` |
| Health messages | `pimcore_sync.health.ok`, `pimcore_sync.health.failed` |

All user-facing strings in widgets, integration labels, and safe error messages must use these keys. No hard-coded UI labels.

## UI/UX

### Widget placement and behavior
- The integration detail page uses `detailPage: { widgetSpotId: pimcoreSyncDetailWidgetSpotId }`.
- `widgets/injection/pimcore-config/widget.ts` registers a tab widget on `pimcoreSyncDetailWidgetSpotId`.
- The client widget has three tabs:
  1. **Classes** — select product and category class names discovered from Pimcore.
  2. **Product Fields** — map Pimcore fields to Open Mercato product fields.
  3. **Category Fields** — map Pimcore fields to Open Mercato category fields.
- On initial load, the widget requests discovery data and the existing `SyncMapping` rows, then pre-fills selectors.
- A visible **Refresh** action calls `GET /api/pimcore_sync/discovery?refresh=true` to bust the cached discovery payload.
- Saving uses the required upsert pattern: first `POST`, then `PUT` on subsequent saves once row IDs are known.

### Design System primitives
- `Select`
- `FormField`
- `SectionHeader`
- `Button`
- `LoadingMessage`
- `ErrorMessage`
- `Alert` for inline remote/discovery warnings if needed

No raw custom CSS, no hardcoded Tailwind status colors, no arbitrary text sizes, and no inline SVGs in page-body UI.

### HTTP and mutation rules
- All reads go through `apiCall` / `apiCallOrThrow`.
- All writes go through `useGuardedMutation(...).runMutation(...)`.
- The widget does not use `CrudForm`, so `useGuardedMutation` is mandatory for every `POST`/`PUT`.

### Accessibility and interaction
- Buttons use visible labels; if an icon-only refresh affordance is used, it must include `aria-label`.
- No dialog is required in MVP. If a confirmation dialog is added later, it must support `Cmd/Ctrl+Enter` submit and `Escape` cancel.
- Error states must remain inline so operators can fix credentials/mappings without leaving the integration detail page.

## Performance, Cache & Scale

- **Discovery cache**: the discovery route uses `cacheService` from DI with key `pimcore:discovery:${tenantId}:${organizationId}` and TTL 300 seconds.
- **Cache bust**: `?refresh=true` bypasses the cache and writes the fresh discovery payload back.
- **No mapping cache invalidation needed**: `SyncMapping` writes do not invalidate discovery cache because mapping rows are not cached by this route; the route only caches remote schema metadata.
- **Batching**: product import pages in `input.batchSize` chunks. Category import fetches the current result set fully, sorts it by depth, then yields batches in slices of `input.batchSize`.
- **N+1 mitigation**: category parent resolution does at most one `externalIdMappingService.lookupLocalId(...)` plus one slug fallback query per unresolved category parent. This is bounded by the imported batch/set size, not by the entire catalog table. Reusing one request container and one `externalIdMappingService` instance per run keeps any service-level in-memory cache warm during the run.
- **Large category trees**: full fetch before sort is intentional. To cap memory risk, abort and warn when the category set exceeds 10,000 rows in one run.
- **Foreground vs worker**: run orchestration remains owned by the existing `data_sync` worker/progress system; this package does not invent a second background-processing model.

## Package Structure

```text
packages/pimcore-sync/
├── package.json                    # @open-mercato/pimcore-sync
├── build.mjs
├── tsconfig.json
├── jest.config.cjs
└── src/
    ├── index.ts                    # export { metadata } from './modules/pimcore_sync/index'
    └── modules/
        └── pimcore_sync/
            ├── index.ts            # { id: 'pimcore_sync', title, description, requires: ['integrations','data_sync','catalog'] }
            ├── integration.ts      # IntegrationDefinition + credential fields
            ├── acl.ts              # features: pimcore_sync.view, pimcore_sync.configure
            ├── di.ts               # registerDataSyncAdapter(pimcoreAdapter) + container.register({ pimcoreHealthCheck })
            ├── setup.ts            # defaultRoleFeatures + env preconfiguration (OM_INTEGRATION_PIMCORE_*)
            ├── i18n/
            │   ├── en.json
            │   └── pl.json
            ├── data/
            │   └── validators.ts   # Zod: discoveryQuerySchema, discoveryResponseSchema, pimcoreCredentialsSchema, pimcoreMappingBlobSchema
            ├── lib/
            │   ├── client.ts            # PimcoreGraphQLClient: query(), listObjects(), introspect(), healthCheck()
            │   ├── adapter.ts           # DataSyncAdapter: getMapping() + streamImport() for catalog_product + catalog_category
            │   ├── catalog-importer.ts  # Upserts CatalogProduct / CatalogProductCategory via catalog commands; returns ImportItem[]
            │   ├── cursor.ts            # buildCursor(unixSeconds: number): string / parseCursor(str): number | null
            │   ├── mapper.ts            # buildProductInput(), buildCategoryInput() — translates Pimcore obj → catalog command input
            │   ├── health.ts            # pimcoreHealthCheck: calls client.healthCheck()
            │   ├── mapping.ts           # loadPimcoreMapping(em, entityType, scope) → DataMapping wrapping blob
            │   ├── preset.ts            # readEnvPreset(): reads canonical OM_INTEGRATION_PIMCORE_* vars plus optional legacy aliases
            │   ├── introspection.ts     # parseIntrospectionResult() — extracts classes + fields from __schema response
            │   └── shared.ts            # Types, defaults, slugifyPimcoreKey()
            ├── api/
            │   └── discovery/
            │       └── route.ts         # GET /api/pimcore_sync/discovery — classes + field list via GraphQL introspection
            └── widgets/
                ├── injection-table.ts
                └── injection/
                    └── pimcore-config/
                        ├── widget.ts          # Headless widget registration
                        └── widget.client.tsx  # Tabs: Classes + Product Fields + Category Fields
```

## Configuration

### Env Variables

| Variable | Required | Description |
|---|---|---|
| `OM_INTEGRATION_PIMCORE_BASE_URL` | No | Auto-configures `baseUrl` credential on tenant creation |
| `OM_INTEGRATION_PIMCORE_API_KEY` | No | Auto-configures `apiKey` credential on tenant creation |
| `OM_INTEGRATION_PIMCORE_DATAHUB_CONFIG` | No | Datahub configuration name (defaults to `'open-mercato'`) |
| `OM_INTEGRATION_PIMCORE_DEFAULT_PRODUCT_CLASS` | No | Default product class name (defaults to `'Product'`) |
| `OM_INTEGRATION_PIMCORE_DEFAULT_CATEGORY_CLASS` | No | Default category class name (defaults to `'Category'`) |

Legacy aliases (`PIMCORE_BASE_URL`, `PIMCORE_API_KEY`, `PIMCORE_DATAHUB_CONFIG`, `PIMCORE_DEFAULT_PRODUCT_CLASS`, `PIMCORE_DEFAULT_CATEGORY_CLASS`) may be read for compatibility, but docs and examples must use the canonical `OM_INTEGRATION_PIMCORE_*` names.

### ACL Features

| Feature | Default roles |
|---|---|
| `pimcore_sync.view` | admin, employee |
| `pimcore_sync.configure` | admin |

Run execution is governed by the existing `data_sync.run` feature. Mapping saves are governed by the existing `data_sync.configure` feature because they go through shared `data_sync` endpoints.

## Migration & Compatibility

- No modifications to existing contract surfaces in `data_sync`, `integrations`, or `catalog`.
- `SyncMapping`, `SyncRun`, `SyncCursor`, `SyncExternalIdMapping`, and `IntegrationCredentials` usage is additive — **no schema change**.
- Package is opt-in: no effect when not registered in `apps/mercato/src/modules.ts`.
- Existing `data_sync` endpoints keep their contract; the Pimcore package only plugs into them.
- Credentials reuse the existing encrypted `integration_credentials` storage rather than adding a package-owned secret table.
- Deletion/reconciliation is opt-in starting Phase 5 (deactivation only, never hard-delete); existing catalog entities are safe by default.

## Open Questions (Resolved)

| # | Question | Decision |
|---|---|---|
| Q1 | Module location | `packages/pimcore-sync/` — canonical workspace package per AGENTS.md |
| Q2 | API protocol | Pimcore Datahub GraphQL (`/pimcore-graphql-webservices/{config}`) — the supported external API for Pimcore object data |
| Q3 | Sync direction | Import only (Pimcore → Open Mercato) |
| Q4 | Mapping config | UI widget (class selection + per-field dropdowns) |
| Q5 | Entity scope | Products + categories |
| Q6 | Authentication | API key as query parameter (`?apikey=...`) — Pimcore Datahub built-in method |
| Q7 | Schema discovery | GraphQL introspection (`__schema`, `__type`) — no separate REST endpoint needed |

## Implementation Plan

### Phase 1 — Foundation & Credentials

**Goal**: package scaffold, integration registration, GraphQL client, health check, env preconfiguration.

**Steps**:

1. Scaffold `packages/pimcore-sync/` with `package.json`, `build.mjs`, `tsconfig.json`, `jest.config.cjs` — mirror `packages/sync-akeneo/` structure exactly.
2. `src/index.ts` — `export { metadata } from './modules/pimcore_sync/index'`.
3. `modules/pimcore_sync/index.ts` — `{ id: 'pimcore_sync', title: 'Pimcore PIM', requires: ['integrations','data_sync','catalog'] }`.
4. `integration.ts` — `IntegrationDefinition`:
   - `id: 'pimcore_sync'`, `category: 'data_sync'`, `hub: 'data_sync'`, `providerKey: 'pimcore'`
   - Credentials: `baseUrl` (url, required), `apiKey` (secret, required), `datahubConfig` (text, required, placeholder: `open-mercato`), `defaultProductClass` (text, optional, placeholder: `Product`), `defaultCategoryClass` (text, optional, placeholder: `Category`)
   - `healthCheck: { service: 'pimcoreHealthCheck' }`
5. `lib/client.ts` — `createPimcoreGraphQLClient(credentials)` factory returning `PimcoreGraphQLClient` with:
   - `query<T>(gql: string, variables?: Record<string, unknown>): Promise<T>` — sends POST to `{baseUrl}/pimcore-graphql-webservices/{datahubConfig}?apikey={apiKey}`, 30s timeout. Throws on HTTP errors or GraphQL `errors[]` array.
   - `listObjects(params: { className, first, after?, filter? }): Promise<ListingResult>` — builds `get{className}Listing` query dynamically, validates `className` against `/^[A-Z][A-Za-z0-9_]*$/`, returns `{ totalCount, edges: Array<{ node }> }`.
   - `introspect(): Promise<IntrospectionResult>` — sends `__schema` introspection query.
   - `introspectType(typeName: string): Promise<TypeIntrospectionResult>` — sends `__type(name: ...)` query for a specific type.
   - `healthCheck(): Promise<{ ok: boolean }>` — sends `{ __typename }` query; returns `{ ok: true }` on success, `{ ok: false }` on error/401.
   - All requests use HTTPS. The API key is passed as query parameter per Pimcore Datahub convention and must never be logged.
6. `lib/health.ts` — `pimcoreHealthCheck`: creates client from stored credentials, calls `healthCheck()`.
7. `lib/preset.ts` — `readEnvPreset()`: reads canonical `OM_INTEGRATION_PIMCORE_*` variables and may accept legacy `PIMCORE_*` aliases.
8. `setup.ts` — `defaultRoleFeatures`, `onTenantCreated` applying env preset via `integrationCredentialsService`.
9. `acl.ts` — features: `pimcore_sync.view`, `pimcore_sync.configure`. Shared `data_sync.run` and `data_sync.configure` features continue to gate shared run/mapping endpoints.
10. `di.ts` — `register(container)` registering `pimcoreHealthCheck` via `asValue`.
11. Register `{ id: 'pimcore_sync', from: '@open-mercato/pimcore-sync' }` in `apps/mercato/src/modules.ts`.
12. Run `yarn generate` + `yarn mercato configs cache structural --all-tenants`.

**Acceptance criteria**:
- `pimcore_sync` appears in the integrations marketplace.
- Credentials form renders with `baseUrl` + `apiKey` + `datahubConfig` fields.
- Health check passes against a live Pimcore instance with a valid API key and Datahub config.
- Env-preset auto-configures credentials on tenant creation when `OM_INTEGRATION_PIMCORE_BASE_URL` + `OM_INTEGRATION_PIMCORE_API_KEY` + `OM_INTEGRATION_PIMCORE_DATAHUB_CONFIG` are set.

### Phase 2 — Product Import (including media)

**Goal**: working `DataSyncAdapter` for `catalog_product` with convention-based defaults, cursor-backed incremental sync, and hero image download via the Attachment storage layer.

**Steps**:

1. `lib/shared.ts`:
   - Types: `PimcoreDataMapping`, `PimcoreConfigBlob`, `PimcoreProductMappingBlob`, `PimcoreCategoryMappingBlob` (see Data Models section).
   - `buildDefaultProductMapping(entityType): PimcoreDataMapping` — returns `{ entityType, matchStrategy: 'externalId', fields: [], blob: { fieldMap: { title: 'name', sku: 'sku', handle: 'key', description: 'description', subtitle: 'shortDescription' } } }`. `imageField` is absent by default — media import is opt-in.
   - `buildDefaultCategoryMapping(entityType): PimcoreDataMapping` — returns `{ entityType, matchStrategy: 'externalId', fields: [], blob: { fieldMap: { name: 'name', slug: 'key' } } }`.
   - `slugifyPimcoreKey(value: string): string` — `value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150)`.
   - Type: `PimcoreAssetNode = { id: string | number; fullpath: string; mimetype?: string; filesize?: number }` — shape of asset fields returned by Datahub for image-type class fields.

2. `lib/cursor.ts`:
   - `buildCursor(unixSeconds: number): string` — serialises Unix timestamp to a string for `SyncRun.cursor`.
   - `parseCursor(cursor: string | null): number | null` — parses back to Unix integer; returns `null` on first run.
   - Cursor is passed as `filter: "{\"o_modificationDate\": {\"$gt\": <unixSeconds>}}"` in GraphQL listing queries.

3. `lib/mapping.ts` — `loadPimcoreMapping(em, entityType, scope): Promise<PimcoreDataMapping>`:
   - Calls `findOneWithDecryption(em, SyncMapping, { integrationId: 'pimcore_sync', entityType, ...scope })`.
   - If row exists: validates `row.mapping` via `pimcoreMappingBlobSchema.safeParse(row.mapping)`. On parse failure, logs a warning and falls back to the default blob.
   - If no row: uses `buildDefaultProductMapping(entityType)` / `buildDefaultCategoryMapping(entityType)`.
   - Returns a `PimcoreDataMapping` with `matchStrategy: 'externalId'`, `fields: []`, and the resolved blob.
   - For `catalog_product`: also loads the `pimcore_config` row (same pattern) to embed `productClass` in the blob for the fallback chain.

4. `lib/mapper.ts`:
   - `buildProductInput(pimcoreObj, blob: PimcoreProductMappingBlob): Record<string, unknown>` — translates Pimcore object to the input shape accepted by `catalog.products.create` / `catalog.products.update`. Rules:
     - `handle`: `slugifyPimcoreKey(pimcoreObj[blob.fieldMap.handle ?? 'key'])` — always slugified.
     - `sku`: if resolved value fails `/^[A-Za-z0-9\-_\.]+$/`, omit entirely (do not coerce).
     - `isActive`: `pimcoreObj.published === true` → `true`; `false` → `false`; `undefined` → omit.
     - Other fields: skip if the mapped Pimcore key is missing or the value is `null`/`undefined`.
   - Helper `resolveProductClass(blob, credentials): string` — three-level fallback chain.
   - `extractAssetNode(pimcoreObj, imageFieldKey: string): PimcoreAssetNode | null` — reads `pimcoreObj[imageFieldKey]`, validates it has a `fullpath` string, returns `null` otherwise.

5. `lib/catalog-importer.ts` — `createPimcoreCatalogImporter(scope, credentials)` async factory:
   - Calls `createRequestContainer()` internally — once per factory invocation (once per `streamImport` run).
   - Resolves from the container: `em`, `commandBus`, `externalIdMappingService`.
   - Builds `CommandRuntimeContext` via a local `buildCommandContext()` helper mirroring the Akeneo pattern.
   - **`upsertAsset(asset: PimcoreAssetNode, entityId: string, recordId: string): Promise<string>`** (internal):
     - External ID = `String(asset.id)` (Pimcore integer asset ID as string).
     - Checks `externalIdMappingService.lookupLocalId('pimcore_sync', 'attachment', externalId, scope)` — if found, returns existing `attachmentId` (skip re-download).
     - Downloads binary: `GET {credentials.baseUrl}{asset.fullpath}?apikey={credentials.apiKey}` with a 30 s timeout. Extracts `Content-Type` and `Content-Length` headers.
     - Calls `ensureDefaultPartitions(em)`, `storePartitionFile(...)`, creates `Attachment` entity, persists, builds URL via `buildAttachmentImageUrl(id)` or `buildAttachmentFileUrl(id)` depending on mimetype.
     - Sets `attachment.storageMetadata = { source: 'pimcore', externalId, remoteFullpath: asset.fullpath }`.
     - Emits attachment CRUD events via `emitAttachmentCrudChange('created', attachment)`.
     - Stores mapping: `externalIdMappingService.storeExternalIdMapping('pimcore_sync', 'attachment', attachment.id, externalId, scope)`.
     - Returns `attachment.id`.
   - **`upsertProduct(pimcoreObj, blob, scope): Promise<ImportItem>`**:
     - Looks up existing product via `externalIdMappingService`.
     - If found → `catalog.products.update`; else → `catalog.products.create`.
     - If `blob.fieldMap.imageField` is set and `extractAssetNode(pimcoreObj, blob.fieldMap.imageField)` returns an asset: calls `upsertAsset(...)` and sets `heroImageId` / `heroImageUrl` on the product update/create input.
     - Asset download errors are caught and logged as warnings — they do not fail the parent product item.
     - Stores/updates product mapping in `externalIdMappingService`.
     - Returns `ImportItem` with `action: 'create'|'update'|'skip'`; on error: `action: 'failed'`, `data: { errorMessage, sourceIdentifier: pimcoreObj.key }`.

6. `lib/adapter.ts` — `pimcoreDataSyncAdapter`:
   - `providerKey: 'pimcore'`, `direction: 'import'`, `supportedEntities: ['catalog_product']`
   - `getMapping(input)`: calls `createRequestContainer()` → `em` → `loadPimcoreMapping(em, input.entityType, input.scope)`. Returns `PimcoreDataMapping`.
   - `streamImport(input)`:
     - Creates `PimcoreGraphQLClient` from `input.credentials` (not DI).
     - Casts: `const blob = (input.mapping as PimcoreDataMapping).blob as PimcoreProductMappingBlob`.
     - Resolves product class via `resolveProductClass(blob, input.credentials)`.
     - Builds dynamic field selection from `blob.fieldMap` values. If `blob.fieldMap.imageField` is set, adds the asset fragment `{ id fullpath mimetype filesize }` for that field in the listing query.
     - Calls `await createPimcoreCatalogImporter(input.scope, input.credentials)` once — single DI container for the entire run.
     - Paginates `client.listObjects({ className: productClass, filter: parseCursor(input.cursor) ? buildModificationDateFilter(cursor) : undefined, first: input.batchSize, after: offset })`.
     - Per page: calls `importer.upsertProduct()` per item → collects `ImportItem[]` → yields `ImportBatch{ items, cursor: buildCursor(maxModDate), hasMore, batchIndex }`.
   - `validateConnection(input)`: creates `PimcoreGraphQLClient` from `input.credentials`, calls `healthCheck()`.

7. Wire adapter in `di.ts` via `registerDataSyncAdapter(pimcoreDataSyncAdapter)`.

8. Unit tests:
   - `lib/__tests__/cursor.test.ts` — `buildCursor`/`parseCursor` round-trip; verifies filter JSON string format.
   - `lib/__tests__/mapper.test.ts` — `buildProductInput` with default blob, custom blob, `published: false` → `isActive: false`; `extractAssetNode` returns null for missing/malformed asset fields.
   - `lib/__tests__/client.test.ts` — validates className injection prevention, query building, error handling.
   - `lib/__tests__/catalog-importer-media.test.ts` — `upsertAsset`: downloads binary via mocked fetch, creates Attachment, deduplicates on second call; asset download failure logs warning but does not fail product upsert.

**Acceptance criteria**:
- `POST /api/data_sync/run` with `{ integrationId: 'pimcore_sync', entityType: 'catalog_product' }` creates rows in `catalog_products`.
- After initial sync, re-running only imports products with `modificationDate > <cursor unix int>`.
- A product with `published: false` in Pimcore syncs as `isActive: false` in Open Mercato.
- Retry after failure resumes from the last persisted cursor without duplicating already-synced products.
- When `imageField` is configured and the product node exposes an asset, an `Attachment` row is created and linked to the product.
- Re-running sync on the same product does not re-download the asset (external ID mapping deduplication).
- If the asset download fails (network error / 404), the product is still upserted successfully; the asset failure appears in item `data` as a warning, not as `action: 'failed'`.

### Phase 3 — Category Import

**Goal**: `streamImport` for `catalog_category` with depth-ordered upsert and two-level parent resolution.

**Steps**:

1. Extend `lib/mapper.ts`: `buildCategoryInput(pimcoreObj, blob: PimcoreCategoryMappingBlob): Record<string, unknown>` — returns input for `catalog.categories.create/update`. Computes slug as `slugifyPimcoreKey(pimcoreObj[blob.fieldMap.slug ?? 'key'])` and does not resolve `parentId` (handled by importer).

2. Extend `lib/catalog-importer.ts`: add `upsertCategory(pimcoreObj, blob, scope): Promise<ImportItem>`:
   - Resolves `parentId` using two-level lookup:
     1. `externalIdMappingService.lookupLocalId('pimcore_sync', 'catalog_product_category', String(pimcoreObj.parent?.id), scope)`.
     2. On miss: `findOneWithDecryption(em, CatalogProductCategory, { slug: parentSlug, organizationId, tenantId, deletedAt: null })` then store the mapping for future runs.
     3. On miss: `parentId = null`.
   - Calls `catalog.categories.create` or `catalog.categories.update` via `commandBus`.
   - `catalog.categories.create` returns `{ categoryId: string }` — use `created.categoryId` as the local ID to store in `externalIdMappingService`.
   - Stores/updates external ID mapping.

3. Extend `lib/adapter.ts`: `supportedEntities` adds `'catalog_category'`. Add `catalog_category` branch in `streamImport`:
   - Builds the listing query to include `parent { ... on object_{ClassName} { id key fullpath } }` for category objects.
   - Fetches all category objects for the configured class (full page loop, ignoring cursor on first run; incremental filter via `modificationDate` cursor on subsequent runs).
   - Sorts all fetched objects by `fullpath.split('/').filter(Boolean).length` ascending before any writes — this is the depth-sort guaranteeing parent-before-child.
   - Processes in slices of `input.batchSize`, yielding one `ImportBatch` per slice.
   - Cursor = `buildCursor(max(modificationDate) in entire fetched set)` — emitted only in the final batch (`hasMore: false`).

4. Unit tests:
   - `lib/__tests__/category-depth-sort.test.ts` — verifies that objects with shallower `fullpath` sort before deeper ones regardless of fetch order.
   - `lib/__tests__/catalog-importer-category.test.ts` — two-level `parentId` lookup: DB hit path and slug fallback path.

**Acceptance criteria**:
- `POST /api/data_sync/run { entityType: 'catalog_category' }` creates categories with correct `parentId` relationships.
- No FK constraint errors when Pimcore returns children before parents.
- A category whose Open Mercato parent was created manually (not via sync) is correctly linked via slug fallback.

### Phase 4 — Mapping Config UI

**Goal**: operator can configure class selection and field mappings via the integration detail page without editing code.

**Steps**:

1. `data/validators.ts` — `discoveryQuerySchema`, `discoveryResponseSchema`:

   ```typescript
   type DiscoveryResponse = {
     ok: boolean
     classes: Array<{
       name: string
       fields: Array<{ name: string; type: string }>
     }>
     message?: string
   }
   ```

2. `lib/introspection.ts` — `parseIntrospectionResult(schema: IntrospectionResult): DiscoveryResponse`:
   - Extracts class names from `queryType.fields` matching pattern `get{Name}Listing` → class name = captured `{Name}`.
   - For each class, looks up `object_{ClassName}` in `schema.types` to get field definitions.
   - Filters out system/internal fields (starting with `_` or `__`).
   - Returns structured `DiscoveryResponse`.

3. `api/discovery/route.ts` — `GET /api/pimcore_sync/discovery`:
   - `metadata.GET = { requireAuth: true, requireFeatures: ['pimcore_sync.configure'] }`.
   - Parse `refresh` through `discoveryQuerySchema`.
   - `const container = await createRequestContainer()`.
   - `const cacheService = container.resolve('cacheService')` — resolves `@open-mercato/cache` instance.
   - Cache key: `pimcore:discovery:${auth.tenantId}:${auth.orgId}`, TTL 300s. Return cached response if hit and `refresh !== true`.
   - On `refresh=true`, bypass the cache, fetch fresh introspection data, and overwrite the cached entry.
   - On miss: resolve `integrationCredentialsService`, read credentials for `'pimcore_sync'`, create `PimcoreGraphQLClient`, call `introspect()` then `introspectType()` per class, parse via `parseIntrospectionResult()`, store in cache, return response.
   - Route **must export `openApi`** with `tags: ['Pimcore']`, `summary: 'Fetch available Pimcore classes and their field definitions'`.

4. `integration.ts` — set `detailPage: { widgetSpotId: pimcoreSyncDetailWidgetSpotId }` where `pimcoreSyncDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('pimcore_sync')`.

5. `widgets/injection/pimcore-config/widget.ts` — registers widget for spot `pimcoreSyncDetailWidgetSpotId` with `placement: { kind: 'tab', label: 'pimcore_sync.config.tab' }`.

6. `widgets/injection/pimcore-config/widget.client.tsx` — three-tab UI:
   - **Tab "Classes"**: two `<Select>` inputs for product class and category class, populated from `GET /api/pimcore_sync/discovery`. Refresh action calls `GET /api/pimcore_sync/discovery?refresh=true`.
   - **Tab "Product Fields"**: two-column table; left column = Open Mercato field labels (Title, SKU, Description, Subtitle, Handle, **Image Field**); right column = `<Select>` of Pimcore fields from the chosen product class. For "Image Field", only show fields of type `hotspotimage`, `image`, or `objectbricks` (or fallback: any field); hint text explains it must be an image/asset field. On save, writes `PimcoreProductMappingBlob.fieldMap` (including `imageField`) to the `catalog_product` SyncMapping row. Leaving "Image Field" unset disables media import.
   - **Tab "Category Fields"**: same pattern for `name` and `slug` fields, writes to `catalog_category` row.
   - All reads via `apiCall` and all saves via `useGuardedMutation(...).runMutation(...)` — no raw fetch.
   - **SyncMapping upsert pattern** (required to avoid unique constraint violations on second save): on mount, call `GET /api/data_sync/mappings?integrationId=pimcore_sync` and store each row's `id` keyed by `entityType` (`pimcore_config`, `catalog_product`, `catalog_category`). On save: if an `id` is already stored for that `entityType`, issue `PUT /api/data_sync/mappings/:id` with the updated mapping blob; otherwise issue `POST /api/data_sync/mappings` with `{ integrationId: 'pimcore_sync', entityType, mapping }` and store the returned `id` for future saves. Never POST twice for the same `entityType`.
   - On load, reads existing SyncMapping rows via `GET /api/data_sync/mappings?integrationId=pimcore_sync` and pre-fills form values.
   - DS primitives: `Select`, `FormField`, `SectionHeader`, `Button`, `LoadingMessage`, `ErrorMessage`, optional `Alert`. No hardcoded status colors. No arbitrary text sizes.

7. `widgets/injection-table.ts` — maps widget to `pimcoreSyncDetailWidgetSpotId`.

8. Run `yarn generate`.

**Acceptance criteria**:
- Pimcore integration detail page shows a **Classes** tab with class selectors.
- After selecting a product class, **Product Fields** tab shows that class's Pimcore fields in the dropdowns, including the "Image Field" selector.
- Saving an "Image Field" value stores `imageField` in the `catalog_product` SyncMapping blob; a subsequent `POST /api/data_sync/run` downloads the asset and creates an `Attachment` linked to the product.
- Leaving "Image Field" unset does not affect product text fields — no asset download is attempted.
- Saving field mappings persists them; a subsequent `POST /api/data_sync/run` uses the configured mapping, not defaults.
- Refreshing the page restores saved values from `SyncMapping`.
- `GET /api/pimcore_sync/discovery?refresh=true` bypasses the cache and returns fresh schema metadata.

### Phase 5 — Reconciliation (Deactivation)

**Goal**: after a successful full sync run, deactivate catalog products/categories whose Pimcore counterparts are absent — completing the sync lifecycle.

**Steps**:

1. Add opt-in `enableReconciliation: boolean` field (default `false`) to `PimcoreConfigBlob` in `lib/shared.ts`. Validate via Zod schema.
2. Extend `lib/catalog-importer.ts`:
   - `reconcileProducts(seenExternalIds: Set<string>, scope): Promise<void>` — queries all `SyncExternalIdMapping` rows for `pimcore_sync` + `catalog_product` + scope; any row whose `externalId` is absent from the `seenExternalIds` set gets its corresponding `CatalogProduct.isActive` set to `false` via `catalog.products.update` command.
   - `reconcileCategories(seenExternalIds: Set<string>, scope): Promise<void>` — same for `catalog_product_category`.
   - **Deactivation only** — never hard-delete catalog records.
3. Extend `lib/adapter.ts` `streamImport`:
   - For `catalog_product`: after the final batch (`hasMore: false`), if `enableReconciliation` is `true` in the config blob AND the run is a full sync (no cursor on start), call `reconcileProducts(seenExternalIds, scope)`.
   - For `catalog_category`: same pattern with `reconcileCategories`.
   - Yield a final `ImportBatch` with `items: []` and `message: 'Reconciling...'` before reconciliation (mirrors `sync-akeneo` pattern).
4. Extend the mapping UI "Classes" tab: add a checkbox for `enableReconciliation` (off by default) with warning text explaining that it deactivates catalog records.
5. Unit tests:
   - `lib/__tests__/reconcile.test.ts` — verifies only missing IDs are deactivated; present IDs remain unchanged.
   - `lib/__tests__/adapter-reconcile.test.ts` — verifies reconciliation skipped on incremental runs and when `enableReconciliation: false`.

**Acceptance criteria**:
- Full sync with `enableReconciliation: true` deactivates products absent from Pimcore response.
- Incremental sync never triggers reconciliation (regardless of config flag).
- Deactivated products have `isActive: false`; no catalog records are deleted.
- Default behavior (flag off) matches Phases 1–4 — purely additive.

### Optional Follow-up — Media Import

Media import should follow the Akeneo approach at a high level: download Pimcore asset binaries, re-host them through Open Mercato attachments/storage, and store local media references. Keep it opt-in and incremental. This spec intentionally does not detail the media pipeline.

## Integration Test Coverage

| Path | Test |
|---|---|
| `POST /api/data_sync/run` (products, full) | Creates `catalog_products` rows with correct field values from mock Pimcore GraphQL response |
| `POST /api/data_sync/run` (products, incremental) | Passes `o_modificationDate > <cursor>` filter; only processes objects returned by mock |
| `POST /api/data_sync/run` (products, `published: false`) | Sets `isActive: false` on existing product |
| `POST /api/data_sync/run` (products, `imageField` configured) | Downloads mock asset binary, creates `Attachment` row, links to product; second run skips re-download |
| `POST /api/data_sync/run` (products, asset download fails) | Product is still upserted; asset failure logged as warning, not `action: 'failed'` |
| `POST /api/data_sync/run` (categories) | Creates categories in correct parent-child order; category with unsynced parent links via slug fallback |
| `POST /api/data_sync/validate` | Returns `ok: true` for valid credentials; `ok: false` for 401 from mock |
| `GET /api/pimcore_sync/discovery` | Returns class list with fields; second call returns cached response without hitting mock |
| `GET /api/pimcore_sync/discovery?refresh=true` | Bypasses cache and re-fetches introspection data |
| `GET /api/pimcore_sync/discovery` without credentials | Returns `200` with `ok: false`, empty `classes`, and setup guidance message |
| `PUT /api/data_sync/mappings/:id` | Saves custom `fieldMap` including `imageField`; next run uses it |
| `POST /api/data_sync/run` (product price fields present remotely) | Does not create price records in MVP; fields are ignored unless a future phase explicitly maps them |

Tests MUST mock Pimcore GraphQL HTTP via `jest.spyOn(global, 'fetch')` or MSW — no live Pimcore dependency in CI. All fixtures are created via API in test setup and cleaned up in `finally`.

## Risks & Impact Review

#### Datahub schema does not expose required classes or fields
- **Scenario**: the configured Datahub workspace omits the product/category class or required fields, so discovery and/or import cannot build the needed queries.
- **Severity**: Medium
- **Affected area**: Discovery UI, Phase 2 product import, Phase 3 category import
- **Mitigation**: discovery endpoint introspects the live schema before mapping; mapping UI only offers fields present in the schema; safe error messages explain that Datahub configuration must expose the classes/fields.
- **Residual risk**: Operator still has to configure Pimcore correctly; the connector cannot auto-fix remote schema exposure.

#### Incremental filter behavior differs between Pimcore/Datahub versions
- **Scenario**: `o_modificationDate > cursor` filter semantics vary, causing under-fetch or over-fetch on incremental runs.
- **Severity**: Medium
- **Affected area**: Product/category incremental sync correctness
- **Mitigation**: cursor format is explicit and test-covered; the actual GraphQL filter payload is deterministic; initial release keeps full sync as the recovery path if incremental behavior is suspicious.
- **Residual risk**: Some Pimcore installations may still require operator validation on the first incremental run.

#### Large category tree causes memory pressure
- **Scenario**: category sync must fetch the whole result set before depth-sort, and a very large tree blows memory or makes the run too slow.
- **Severity**: Medium
- **Affected area**: Category sync performance and run stability
- **Mitigation**: depth-sort is intentional for correctness; the run is capped at 10,000 categories; the engine can retry after operator reduces scope or batch size.
- **Residual risk**: Tenants with larger trees need a future streaming/tree-index strategy.

#### Parent category is not yet mapped when child is imported
- **Scenario**: incremental sync sees a child before its parent mapping exists, so parent resolution falls back to `null`.
- **Severity**: Low
- **Affected area**: Category hierarchy correctness
- **Mitigation**: full sync depth-sort handles normal first import; re-run updates the child after the parent mapping exists; slug fallback links to manually created parents.
- **Residual risk**: A temporary orphaned child can exist until the next successful run.

#### Discovery cache becomes stale after Pimcore schema change
- **Scenario**: operator adds/removes Pimcore fields or classes, but the widget still shows the cached schema.
- **Severity**: Low
- **Affected area**: Mapping UI usability
- **Mitigation**: cache TTL is 300 seconds and `?refresh=true` explicitly busts cache; cached data is tenant/org scoped.
- **Residual risk**: Without a manual refresh, UI can stay stale for up to five minutes.

#### API key in query string leaks through insecure transport or logs
- **Scenario**: connector uses `http://` or logs a full Datahub URL, exposing `apikey`.
- **Severity**: High
- **Affected area**: Integration credentials security
- **Mitigation**: client requires HTTPS, credentials are stored encrypted at rest, and logging must redact/avoid full secret-bearing URLs.
- **Residual risk**: The upstream authentication mechanism itself is a Pimcore limitation; URL-based key transport still exists on the wire, but only over TLS.

#### Sync-created catalog entities cannot be automatically undone
- **Scenario**: operator runs sync against the wrong Pimcore class and creates valid but unwanted catalog records.
- **Severity**: Medium
- **Affected area**: Catalog data quality, operational recovery
- **Mitigation**: health/discovery/mapping steps happen before sync; sync is idempotent on re-run; there is no delete/reconcile logic in MVP, which avoids accidental removals.
- **Residual risk**: Cleanup requires explicit catalog actions or a future reconciliation feature; there is no one-click undo for created entities.

## Definition of Done

### Code
- [ ] `packages/pimcore-sync/` workspace package created; builds without TypeScript errors (`yarn build:packages`)
- [ ] `{ id: 'pimcore_sync', from: '@open-mercato/pimcore-sync' }` registered in `apps/mercato/src/modules.ts`
- [ ] `yarn generate` runs cleanly after registration; no stale generated files
- [ ] `yarn lint` passes with no new warnings

### Integration & Health
- [ ] `pimcore_sync` integration appears in the marketplace UI after `yarn mercato configs cache structural --all-tenants`
- [ ] Credential form renders with `baseUrl` + `apiKey` + `datahubConfig` fields
- [ ] Health check (`validateConnection`) returns `ok: true` against a live or mock Pimcore instance; `ok: false` on 401
- [ ] Env preset (`OM_INTEGRATION_PIMCORE_BASE_URL` + `OM_INTEGRATION_PIMCORE_API_KEY` + `OM_INTEGRATION_PIMCORE_DATAHUB_CONFIG`) auto-configures credentials on tenant creation

### Product Sync
- [ ] Full sync (`POST /api/data_sync/run { entityType: 'catalog_product' }`) creates rows in `catalog_products` with correct field values
- [ ] Incremental sync passes `o_modificationDate > <cursor unix int>` filter; only processes objects returned after the cursor
- [ ] Product with `published: false` in Pimcore syncs as `isActive: false` in Open Mercato
- [ ] Retry after mid-run failure resumes from the last persisted cursor without duplicates
- [ ] Invalid SKU (fails `/^[A-Za-z0-9\-_\.]+$/`) results in the field being omitted, not coerced
- [ ] `handle` field is always slugified to `/^[a-z0-9\-_]+$/` before the catalog command

### Category Sync
- [ ] Full category sync creates categories with correct `parentId` relationships
- [ ] No FK constraint errors when Pimcore returns children before parents (depth-sort verified)
- [ ] A category whose Open Mercato parent was created manually (not via sync) is correctly linked via slug fallback
- [ ] `slug` field is slugified via `slugifyPimcoreKey` before the catalog command

### Mapping Config UI (Phase 4)
- [ ] Pimcore integration detail page shows a **Classes** tab, **Product Fields** tab, and **Category Fields** tab
- [ ] Class selectors are populated from `GET /api/pimcore_sync/discovery` (via GraphQL introspection)
- [ ] **Product Fields** tab includes an "Image Field" selector that saves `imageField` in `PimcoreProductMappingBlob.fieldMap`
- [ ] Saving mappings issues `POST` on first save and `PUT` on subsequent saves (no unique constraint error)
- [ ] Refreshing the page restores saved field mappings from `SyncMapping`
- [ ] `GET /api/pimcore_sync/discovery?refresh=true` bypasses the discovery cache
- [ ] A `POST /api/data_sync/run` after saving uses the configured mapping, not the defaults

### Media Import (Phase 2)
- [ ] When `imageField` is set in the mapping and the product node includes a Pimcore asset, an `Attachment` is created and linked to the product
- [ ] Asset downloaded via `GET {baseUrl}{asset.fullpath}?apikey={apiKey}` — same auth as GraphQL
- [ ] Re-running sync on the same product does not re-download already-imported assets (external ID mapping deduplication)
- [ ] Asset download failure (network error / 404) logs a warning and does not fail the parent product import item

### Reconciliation (Phase 5)
- [ ] Full sync with `enableReconciliation: true` deactivates products/categories absent from Pimcore response
- [ ] Incremental sync never triggers reconciliation regardless of config flag
- [ ] Deactivated records have `isActive: false`; no catalog records are hard-deleted
- [ ] Default behavior (flag off) remains purely additive — no regressions to Phases 1–4

### Deferred Enrichments
- [ ] Price fields from Pimcore are not written in MVP; a future phase must use `catalog.prices.create/update` with explicit price kind and currency mapping
- [ ] Custom fields not listed in the fixed mapping are skipped in MVP; a future phase may add custom-field or metadata mapping
- [ ] Multi-image gallery support (importing more than the hero/first image) is deferred to a future phase

### Tests
- [ ] Unit tests pass: `cursor.test.ts`, `mapper.test.ts`, `client.test.ts`, `category-depth-sort.test.ts`, `catalog-importer-category.test.ts`, `catalog-importer-media.test.ts`
- [ ] Integration tests pass: all paths listed in the Integration Test Coverage table (including media import row)
- [ ] No live Pimcore dependency in CI (all GraphQL HTTP mocked via MSW or `jest.spyOn`)

### ACL & Security
- [ ] `pimcore_sync.view` and `pimcore_sync.configure` features declared in `acl.ts` and granted via `setup.ts` `defaultRoleFeatures`
- [ ] Operators that save mappings or start runs also receive the existing `data_sync.configure` / `data_sync.run` grants as appropriate
- [ ] `yarn mercato auth sync-role-acls` run so existing tenants receive the new ACL grants
- [ ] Credentials are stored encrypted at rest via `integrationCredentialsService`
- [ ] API key only transmitted over HTTPS (client validates URL scheme)
- [ ] `className` parameter validated against `/^[A-Z][A-Za-z0-9_]*$/` before query interpolation (prevents GraphQL injection)
- [ ] Connector emits no new package-level events; existing `data_sync` engine events remain the source of truth

### Spec Housekeeping
- [ ] All spec acceptance criteria for Phases 1–5 verified
- [ ] Changelog entry added with implementation date
- [ ] Spec moved to `.ai/specs/implemented/` via `git mv`

## Changelog

| Date | Change |
|------|--------|
| 2026-05-29 | Added media import (hero image) to Phase 2 and Phase 4: `PimcoreAssetNode` type, `upsertAsset()` in `catalog-importer.ts`, `imageField` in `PimcoreProductMappingBlob`, Image Field selector in mapping UI, new integration test rows, and DoD media checklist. |
| 2026-05-29 | Aligned architecture with current Open Mercato integration contracts: canonical `OM_INTEGRATION_PIMCORE_*` env vars, provider ACL boundaries vs shared `data_sync` permissions, deferred pricing/custom-field handling. |
| 2026-05-28 | Initial draft |

## Progress
- [ ] Phase 1 — Foundation & Credentials
- [ ] Phase 2 — Product Import
- [ ] Phase 3 — Category Import
- [ ] Phase 4 — Mapping Config UI
- [ ] Phase 5 — Reconciliation (Deactivation)

## Final Compliance Report — 2026-05-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | No direct ORM relationships between modules | Compliant | Connector uses FK IDs via `externalIdMappingService`; catalog persistence goes through commands |
| root `AGENTS.md` | Filter by `organization_id` | Compliant | All entity reads/writes and cache scope are documented with `organizationId` + `tenantId` |
| root `AGENTS.md` (Design System Rules) | Use Design System primitives/tokens only | Compliant | Widget section names `Select`, `FormField`, `SectionHeader`, `Button`, `LoadingMessage`, `ErrorMessage`, optional `Alert`; no hardcoded colors or arbitrary text sizes |
| `packages/core/AGENTS.md` → API Routes | API routes MUST export `openApi` | Compliant | Discovery route explicitly exports `openApi` and the requirement is repeated in Phase 4 |
| `packages/core/AGENTS.md` → Encryption | Sensitive data uses platform encryption/decryption mechanisms | Compliant | Credentials are stored through `integrationCredentialsService`, encrypted at rest, and read with decryption helpers |
| `packages/ui/AGENTS.md` | Non-`CrudForm` writes use `useGuardedMutation` | Compliant | Mapping widget writes go through `useGuardedMutation(...).runMutation(...)` |
| `packages/cache/AGENTS.md` | Cache via DI and tenant-scoped keys | Compliant | Discovery route resolves `cacheService` from DI and uses tenant/org-scoped key with TTL 300s |
| `packages/events/AGENTS.md` | Cross-module side effects go through declared events/subscribers | N/A | Connector emits no new package events and relies on existing `data_sync` engine/progress events |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Discovery contract, mapping blobs, cursor usage, and external ID mapping align |
| API contracts match UI/UX section | Pass | Widget reads/writes exactly match discovery + existing mapping endpoints |
| Risks cover all write operations | Pass | Product/category upserts, discovery cache refresh, and credential transport are covered |
| Commands defined for all mutations | Pass | Catalog writes use existing catalog commands; mapping writes use existing `data_sync` endpoints |
| Cache strategy covers all read APIs | Pass | Discovery caching, refresh bust, and no mapping-cache invalidation are explicit |
