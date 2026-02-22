# SPEC-034: Generic Channel Product Projections (Multi-Channel Sales Models)

## TLDR

**Key Points:**
- Introduce a generic, schema-driven channel product projection layer so each sales channel (Storefront, Allegro, Amazon, etc.) can have a different product representation without duplicating the canonical catalog product model.
- Keep current responsibilities intact: `CatalogProduct` remains source of truth, `CatalogOffer` remains channel-scoped commercial/visibility layer, and new `channel_listings` module owns publication/validation/sync state.
- Add `ChannelModelDefinition` (schema + capabilities) and `ChannelProductListing` (per-product, per-channel projection) with workflow-driven lifecycle (`draft -> validating -> ready -> publishing -> published / sync_error`).
- Reuse existing platform mechanics: `sales` channels, `catalog` pricing/offers/variants, `workflows`, `events`, `queue`, `translations`, `query_index`, and widget injection.
- Preserve storefront compatibility by making Storefront projections optional in Phase 1 (fallback to current `CatalogOffer` behavior), then progressively adopt projections for richer channel-specific content/attributes.

**Scope:**
- New core module: `packages/core/src/modules/channel_listings/`
- Admin APIs + pages for channel model definitions and channel product listings
- Validation and publication workflows (generic adapter contract)
- Integration hooks with `catalog`, `sales`, `ecommerce`, `workflows`, `queue`, `events`
- Storefront read-path compatibility/fallback rules
- Spec-defined integration coverage for API and UI paths

**Concerns / Design Constraints:**
- Must not overload `CatalogOffer` with marketplace-specific schema and sync lifecycle fields
- Must not create per-channel product entities (`AmazonProduct`, `AllegroProduct`) that duplicate catalog data
- Must keep tenant/org scoping strict and avoid cross-module ORM relations
- Must keep Storefront stable while introducing a broader multi-channel architecture

---

## 1) Overview

This specification defines a generic architecture for selling the same canonical catalog product through multiple sales channels with different channel-specific product models.

Examples:
- **Storefront**: richer branding/content and selective field overrides
- **Allegro**: channel taxonomy + mandatory attributes + external listing lifecycle
- **Amazon**: marketplace category schema + compliance attributes + feed/API sync state
- **Custom channel**: organization-specific schema and export integration

The goal is to support **different product representations per channel** while preserving a single source of truth for catalog products, variants, and core pricing.

---

## 2) Problem Statement

Open Mercato already supports:
- canonical products/variants/pricing in `catalog`
- channel-scoped commercial offers via `CatalogOffer` + `SalesChannel`
- storefront channel bindings in `ecommerce`

This is enough for storefront MVP filtering/visibility/pricing, but it does not solve marketplace-style requirements:

1. Different required attribute sets per channel/category
2. Different category taxonomies per channel
3. Different variant and media mapping constraints
4. Publication lifecycle and sync status per channel
5. External identifiers (`externalRef`) and sync retry history
6. Validation results tied to a channel-specific schema version

If these concerns are added directly into `CatalogOffer`, that entity becomes overloaded with responsibilities:
- commercial pricing/visibility
- content overrides
- marketplace-specific validation state
- external sync lifecycle
- publication diagnostics and retry history

That creates coupling between storefront and marketplace behavior and increases regression risk.

---

## 3) Proposed Solution

Introduce a new generic module: **`channel_listings`**.

### 3.1 Responsibility Split (Core Decision)

| Layer | Responsibility |
| --- | --- |
| `catalog.CatalogProduct` / `CatalogProductVariant` | Canonical product domain (source of truth) |
| `catalog.CatalogOffer` | Channel-scoped commercial layer (visibility, pricing overrides, basic content/media override) |
| `channel_listings.ChannelProductListing` | Channel-specific product projection/publication model |
| `channel_listings.ChannelModelDefinition` | Schema-driven contract for channel-specific fields and validation |

### 3.2 Why This Split

- `SalesChannel` answers: **where we sell**
- `CatalogOffer` answers: **whether/how we sell commercially in that channel**
- `ChannelProductListing` answers: **how the product is represented/published in that channel**

This enables generic multi-channel behavior without duplicating catalog products.

### 3.3 Module Placement

Create a new core module:
- `packages/core/src/modules/channel_listings/`

Rationale:
- avoids overloading `catalog`
- keeps publication/integration lifecycle separate from pricing logic
- supports future adapters (marketplaces, exports, channel feeds) without polluting catalog internals

### 3.4 Storefront Compatibility Strategy

Storefront remains compatible during rollout:
- **Phase 1**: storefront APIs continue using `CatalogOffer` + `salesChannelId` filtering as primary source
- **Phase 2**: storefront APIs optionally read `ChannelProductListing` (`channel_model_key = 'storefront.product.v1'`) when present
- **Fallback rule**: if no listing exists for storefront channel, use current `CatalogOffer` behavior (no breakage)

---

## 4) Goals

1. Support multiple channels with different product representation models
2. Reuse canonical products/variants/prices and existing pricing resolver pipeline
3. Keep channel-specific requirements schema-driven and versioned
4. Support workflow-driven validation/publication/sync lifecycle
5. Preserve storefront compatibility and avoid regressions
6. Enable future mobile/AI clients to consume stable, channel-aware representations
7. Keep implementation generic (not hardcoded to Allegro/Amazon)

---

## 5) Non-Goals (This Spec)

- Implementing a specific marketplace adapter end-to-end (e.g. Allegro API auth, token flow)
- Replacing `CatalogOffer`
- Replacing storefront catalog APIs
- Full feed export engine for all channels in Phase 1
- Marketplace order import / fulfillment sync
- External account credential storage UX (can be separate spec)

---

## 6) Architecture

### 6.1 High-Level Architecture

```text
Canonical Catalog (catalog)
  ├─ CatalogProduct
  ├─ CatalogProductVariant
  ├─ CatalogProductPrice
  └─ CatalogOffer (salesChannel-scoped commercial layer)
           │
           │ productId + salesChannelId
           ▼
Channel Product Projection Layer (channel_listings)
  ├─ ChannelModelDefinition (schema + capabilities + uiSchema)
  ├─ ChannelProductListing (attributes/content/mappings/status)
  ├─ ChannelListingSyncRun (append-only sync/publish attempts)
  └─ Workflow lifecycle integration (validate/publish/pause/archive)
           │
           ├─ events (catalog changes trigger revalidation)
           ├─ queue/workers (async publish/sync)
           ├─ workflows (listing lifecycle)
           └─ adapters (storefront/allegro/amazon/custom)
```

### 6.2 Module Responsibilities

| Module | Responsibility in this design |
| --- | --- |
| `catalog` | Canonical product, variants, offers, prices, media, option schemas |
| `sales` | `SalesChannel` identity, channel scoping, orders |
| `ecommerce` | Storefront APIs and store/channel binding; projection-aware read path (later phases) |
| `channel_listings` (new) | Channel model definitions, product projections, validation/publication lifecycle |
| `workflows` | Generic listing workflow execution |
| `events` | Cross-module reactions (product changed → listing stale) |
| `queue` | Publish/sync/retry jobs |
| `translations` | Localized overlays for listing content |
| `search` | Optional indexing of listing readiness/status in admin search |

### 6.3 Adapter Contract (Generic)

Each channel type registers a DI adapter implementing capabilities such as:
- `validateListing(listing, context)`
- `buildPublishPayload(listing, canonicalProduct, offer)`
- `publishListing(...)`
- `pauseListing(...)`
- `archiveListing(...)`
- `syncListingStatus(...)`

This keeps the module generic while allowing channel-specific behavior.

### 6.4 Workflow Integration

`channel_listings` defines a standard lifecycle workflow (extensible per model):
- `draft`
- `mapped`
- `validating`
- `validation_failed`
- `ready`
- `publishing`
- `published`
- `sync_error`
- `paused`
- `archived`

Adapters may provide additional transitions, but the core workflow contract must remain stable.

---

## 7) Data Models

All entities follow platform conventions:
- UUID PKs
- `organization_id`, `tenant_id`
- `created_at`, `updated_at`, `deleted_at`
- no cross-module ORM relations (store FK IDs as UUID fields)

### 7.1 `ChannelModelDefinition` (`channel_model_definitions`)

Defines a versioned schema for a channel-specific product model.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `organization_id` | uuid nullable | `null` = system/global model, set = tenant override/custom |
| `tenant_id` | uuid nullable | `null` for global models |
| `code` | text | Unique key (e.g. `storefront.product`, `allegro.offer`) |
| `version` | int | Schema version |
| `channel_type` | text | `storefront`, `marketplace`, `custom`, etc. |
| `title` | text | Display name |
| `description` | text nullable | Admin help text |
| `schema_json` | jsonb | Channel-specific attributes/content schema |
| `ui_schema_json` | jsonb nullable | Admin form rendering hints |
| `capabilities_json` | jsonb | Feature flags (`supportsVariants`, `supportsMediaMapping`, etc.) |
| `mapping_defaults_json` | jsonb nullable | Default mapping behavior from canonical product |
| `is_active` | boolean | Model availability |
| `is_system` | boolean | Protected core-provided model |
| `supersedes_model_id` | uuid nullable | Prior version lineage |

Constraints:
- Unique `(tenant_id, organization_id, code, version)`
- For `is_system=true`, `tenant_id` and `organization_id` must be null

### 7.2 `ChannelProductListing` (`channel_product_listings`)

Represents a channel-specific product projection/publication record.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `organization_id` | uuid | Required |
| `tenant_id` | uuid | Required |
| `product_id` | uuid | FK ID to `catalog_products.id` (no ORM relation) |
| `sales_channel_id` | uuid | FK ID to `sales_channels.id` |
| `catalog_offer_id` | uuid nullable | Optional link to `CatalogOffer` record for the same product/channel |
| `model_definition_id` | uuid | FK ID to `channel_model_definitions.id` |
| `model_key` | text | Denormalized `code@version` (e.g. `allegro.offer@1`) |
| `listing_key` | text nullable | Tenant-facing unique key/slug for the listing |
| `channel_category_ref` | text nullable | External taxonomy/category id |
| `status` | text | `draft`, `mapped`, `validation_failed`, `ready`, `publishing`, `published`, `sync_error`, `paused`, `archived` |
| `workflow_state` | text nullable | Mirrors workflow state when workflow is active |
| `workflow_instance_id` | uuid nullable | Link to workflows instance via metadata/fk-id |
| `is_default_for_channel` | boolean | Optional selection hint when multiple listings per product/channel |
| `attributes` | jsonb nullable | Channel-specific attributes payload |
| `content_overrides` | jsonb nullable | Localized title/description/bullets/seo etc. |
| `media_mapping` | jsonb nullable | Which canonical media assets are used and in what order/role |
| `variant_mapping` | jsonb nullable | Canonical variant → channel variant/group mapping |
| `compliance_data` | jsonb nullable | Certifications/flags/market-specific metadata |
| `validation_result` | jsonb nullable | Last validation report (errors/warnings, schema version, timestamp) |
| `sync_state` | jsonb nullable | Last known external sync state snapshot |
| `external_ref` | text nullable | External listing/offer identifier |
| `external_url` | text nullable | Marketplace listing URL |
| `published_at` | timestamptz nullable | First successful publish |
| `last_synced_at` | timestamptz nullable | Last sync success |
| `stale_since` | timestamptz nullable | Set when canonical source change invalidates listing |
| `metadata` | jsonb nullable | Generic extension bag |

Constraints / indexes:
- Unique `(tenant_id, organization_id, sales_channel_id, product_id, model_key)`
- Optional unique `(tenant_id, organization_id, sales_channel_id, listing_key)` where `listing_key` not null
- Index `(tenant_id, organization_id, sales_channel_id, status)`
- Index `(tenant_id, organization_id, product_id)`
- Index `(tenant_id, organization_id, external_ref)`

### 7.3 `ChannelListingSyncRun` (`channel_listing_sync_runs`)

Append-only execution log for validate/publish/sync operations (audit + troubleshooting).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `organization_id` | uuid | Required |
| `tenant_id` | uuid | Required |
| `listing_id` | uuid | ChannelProductListing id |
| `operation` | text | `validate`, `publish`, `pause`, `archive`, `sync_status`, `retry_publish` |
| `status` | text | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `attempt` | int | Retry counter |
| `idempotency_key` | text nullable | Prevent duplicate publishes |
| `trigger_source` | text | `manual`, `auto_revalidate`, `catalog_event`, `scheduler`, `api` |
| `request_payload` | jsonb nullable | Sanitized payload sent to adapter |
| `response_payload` | jsonb nullable | Sanitized response from adapter |
| `error_code` | text nullable | Adapter/system error code |
| `error_message` | text nullable | Sanitized message |
| `started_at` | timestamptz nullable | Start time |
| `finished_at` | timestamptz nullable | End time |
| `created_at` | timestamptz | Queue request creation |

Indexes:
- `(tenant_id, organization_id, listing_id, created_at desc)`
- `(tenant_id, organization_id, status, created_at desc)`

### 7.4 JSONB Contract Sketches (Schema-Driven)

#### `capabilities_json`
```ts
{
  supportsVariants: boolean
  supportsMediaMapping: boolean
  supportsLocalizedContent: boolean
  supportsCategoryMapping: boolean
  supportsComplianceAttributes: boolean
  supportsExternalPublish: boolean
  supportsStatusSync: boolean
  maxMediaCount?: number | null
  variantMode?: 'none' | 'flat' | 'matrix' | 'grouped'
}
```

#### `validation_result`
```ts
{
  schemaVersion: number
  validatedAt: string // ISO UTC
  isValid: boolean
  errors: Array<{ code: string; path: string[]; message: string; severity: 'error' }>
  warnings: Array<{ code: string; path: string[]; message: string; severity: 'warning' }>
  adapterDiagnostics?: Record<string, unknown>
}
```

#### `content_overrides`
```ts
{
  locales: {
    [localeCode: string]: {
      title?: string
      subtitle?: string
      description?: string
      bullets?: string[]
      seoTitle?: string
      seoDescription?: string
      custom?: Record<string, unknown>
    }
  }
}
```

---

## 8) API Contracts

All API routes MUST export `openApi` and use strict zod validation.

### 8.1 Admin APIs (new `channel_listings` module)

#### `GET /api/channel-listings/models`
List available channel model definitions.

Filters:
- `channelType?`
- `code?`
- `active?`
- standard paging/sorting

#### `POST /api/channel-listings/models` (admin/superadmin)
Create tenant-scoped custom model definition.

Body (high-level):
- `code`, `title`, `channelType`, `schemaJson`, `uiSchemaJson?`, `capabilitiesJson`, `mappingDefaultsJson?`

Constraints:
- cannot create `isSystem=true` via API

#### `GET /api/channel-listings/listings`
List channel product listings.

Filters:
- `salesChannelId?`
- `productId?`
- `status?`
- `modelDefinitionId?`
- `staleOnly?`
- `externalRef?`

#### `POST /api/channel-listings/listings`
Create listing (draft) for a canonical product in a sales channel.

Body:
- `productId`
- `salesChannelId`
- `modelDefinitionId`
- optional initial `attributes`, `contentOverrides`, `mediaMapping`, `variantMapping`, `channelCategoryRef`

Validation:
- product exists in same tenant/org
- sales channel exists in same tenant/org
- optional `CatalogOffer` exists for same product/channel (configurable requirement per model)
- unique constraint on `(productId, salesChannelId, modelKey)`

#### `PATCH /api/channel-listings/listings/:id`
Update listing fields in `draft|mapped|validation_failed|ready` states.

Supported mutable fields (state-dependent):
- `attributes`
- `contentOverrides`
- `mediaMapping`
- `variantMapping`
- `channelCategoryRef`
- `isDefaultForChannel`
- `listingKey`

#### `GET /api/channel-listings/listings/:id`
Return listing detail with:
- listing record
- model definition summary
- validation result
- latest sync runs
- optional canonical product summary snapshot (computed)

#### `POST /api/channel-listings/listings/:id/validate`
Run validation (sync or queued depending adapter/model capability).

Output:
- updated `validationResult`
- `status`
- `allowedActions`

#### `POST /api/channel-listings/listings/:id/publish`
Queue publish operation.

Body:
- `idempotencyKey?`
- `forceRevalidate?: boolean`

Output:
- queued sync run id
- listing status (`publishing`)

#### `POST /api/channel-listings/listings/:id/pause`
Pause/unpublish listing (adapter-dependent).

#### `POST /api/channel-listings/listings/:id/archive`
Archive listing (local state; adapter may be no-op or remote archive).

#### `GET /api/channel-listings/listings/:id/sync-runs`
List historical sync/validation runs.

### 8.2 Existing API Impacts (compatibility + extension)

#### `ecommerce` storefront APIs (read path changes, backward compatible)
Affected endpoints (implementation phases noted in §14):
- `GET /api/ecommerce/storefront/context`
- `GET /api/ecommerce/storefront/me`
- `GET /api/ecommerce/storefront/products`
- `GET /api/ecommerce/storefront/products/:idOrHandle`
- `GET /api/ecommerce/storefront/categories`

Behavioral extension (phase-gated):
- When a storefront listing exists for `(productId, salesChannelId, modelKey='storefront.product@v1')` and is `published|ready`, the storefront resolver MAY overlay listing `content_overrides`, `media_mapping`, and allowed variant projection onto the response.
- If no listing exists, current `CatalogOffer`-based behavior remains unchanged.

#### `catalog` / `sales` impacts (no breaking API changes)
- `catalog` CRUD remains source of truth
- `sales` channel CRUD remains source of truth for channels
- `CatalogOffer` APIs remain focused on commercial layer and do not absorb listing lifecycle fields

---

## 9) UI / UX

### 9.1 Admin UI Goals

1. Manage channel-specific product representations without touching canonical product data unnecessarily
2. Keep commercial offer editing separate from channel-specific publication schema
3. Make validation and sync state visible and actionable
4. Reuse shared backend components (`CrudForm`, `DataTable`, `LoadingMessage`, `ErrorMessage`)

### 9.2 New Admin Screens (Phase 1/2)

#### A) Channel Listings Table (module backend page)
Path (proposed):
- `/backend/channel-listings`

Features:
- filters by sales channel, status, model, stale flag
- columns: product, channel, model, status, validation, sync state, updatedAt
- row actions: open, validate, publish, pause, archive, view sync runs

#### B) Channel Listing Detail/Edit Page
Path (proposed):
- `/backend/channel-listings/[id]`

Sections:
- canonical product summary (read-only snapshot panel)
- channel + model summary
- schema-driven form (attributes/content)
- media mapping editor
- variant mapping editor
- validation result panel (errors/warnings)
- sync run history panel
- workflow state + action buttons

#### C) Product Page Injection: “Channel Listings” widget
Host:
- `crud-form:catalog:catalog_product`

Purpose:
- show all listings for the product across channels
- quick status overview
- quick-create listing for channel/model

#### D) Sales Channel Page Injection (optional Phase 2)
Host:
- `admin.page:/backend/sales/channels/[id]:after` (or module-specific slot)

Purpose:
- list channel models supported by adapter
- listing counts by status
- publish/sync queue health summary

### 9.3 Storefront UX Impact (Future Phases)

No immediate UX change is required in storefront for Phase 1.

Later phases may use storefront projections to support:
- channel-specific PDP content blocks
- marketplace-specific storefront variants (if needed)
- stricter variant/media presentation rules per channel

---

## 10) Configuration

### 10.1 Module Config (`channel_listings`)

Stored via module config service:

```ts
{
  enabled: boolean,                       // default: false (feature gate for phased rollout)
  storefrontProjectionMode: 'off' | 'optional' | 'required',
                                         // default: 'optional'
  autoCreateStorefrontListing: boolean,   // default: false; if true, create draft listing from offer/product
  autoMarkStaleOnCatalogChanges: boolean, // default: true
  validationMode: 'sync' | 'queue',       // default: 'sync' for local models, adapters may override
  publishMode: 'queue',                   // always queue for external channels
  defaultRetryPolicy: {
    maxAttempts: number,
    backoffMs: number,
  },
  adapters: {
    [channelType: string]: {
      enabled: boolean,
      timeoutMs?: number,
      rateLimit?: { perMinute?: number },
    }
  }
}
```

### 10.2 Feature Flags

Potential flags (exact placement may vary):
- `channel_listings.enabled`
- `channel_listings.storefront_projection_read`
- `channel_listings.external_publish_enabled`

### 10.3 ACL Features (`channel_listings/acl.ts`)

Proposed features:
- `channel_listings.view`
- `channel_listings.create`
- `channel_listings.edit`
- `channel_listings.validate`
- `channel_listings.publish`
- `channel_listings.pause`
- `channel_listings.archive`
- `channel_listings.models.view`
- `channel_listings.models.manage`

`setup.ts` must seed `defaultRoleFeatures` accordingly.

---

## 11) Alternatives Considered

### Alternative A: Put everything into `CatalogOffer`

**Rejected**.

Pros:
- fewer tables initially
- simpler short-term storefront integration

Cons:
- mixes pricing/visibility with publication/sync lifecycle
- forces marketplace-specific schema into catalog offer records
- increases regression risk for storefront and sales flows
- difficult to version channel-specific schemas cleanly

### Alternative B: Separate product entities per channel (`AmazonProduct`, `AllegroProduct`)

**Rejected**.

Pros:
- explicit models per marketplace

Cons:
- duplicates canonical product data
- drift between catalog and channel products
- repeated logic for variants/media/pricing references
- poor extensibility for arbitrary/custom channels

### Alternative C: JSONB “channel_data” directly on `CatalogProduct`

**Rejected**.

Pros:
- minimal schema changes initially

Cons:
- no channel scoping granularity
- poor lifecycle tracking
- no per-listing status/history
- mixes core and integration concerns

### Chosen: Canonical Product + Offer + Channel Listing Projection (Schema-Driven)

This provides the cleanest separation and best long-term extensibility.

---

## 12) Implementation Approach

### Phase 1 — Foundation (No Storefront Behavior Change)

1. Create new `channel_listings` module scaffold
2. Add entities:
- `ChannelModelDefinition`
- `ChannelProductListing`
- `ChannelListingSyncRun`
3. Add validators (`data/validators.ts`)
4. Add CRUD-like admin APIs + OpenAPI exports
5. Add `acl.ts`, `setup.ts`, `events.ts`
6. Add backend admin pages (table + detail)
7. Add product-page injection widget (listing summary)
8. Add `search.ts` (optional admin indexing)
9. Add migrations via `yarn db:generate`
10. Add module spec integration coverage tests (API + UI skeleton cases)

### Phase 2 — Workflow + Validation Lifecycle

1. Define standard listing workflow in `channel_listings`
2. Implement `validate` action and validation result persistence
3. Implement `publish/pause/archive` actions + `ChannelListingSyncRun`
4. Add queue workers for async publish/sync tasks
5. Emit typed events for lifecycle transitions
6. Add notifications (optional) for validation/publish failures

### Phase 3 — Storefront Projection Read Path (Backward Compatible)

1. Add storefront projection adapter/model definition (`storefront.product@v1`)
2. Update `ecommerce` storefront resolvers to overlay listing content/mappings when present
3. Preserve fallback to `CatalogOffer` behavior when listing absent
4. Add integration tests for both projection and fallback paths

### Phase 4 — Marketplace Reference Adapter (e.g. Allegro)

1. Add adapter contract implementation
2. Add channel model definition(s)
3. Add category/attribute mapping UX improvements
4. Add external publish/sync status handling and retry policies
5. Add integration and (where feasible) mocked adapter tests

---

## 13) Migration Path

### 13.1 Existing Data Compatibility

No destructive migration of `catalog` or `sales` is required.

- `CatalogProduct`, `CatalogOffer`, `SalesChannel` remain unchanged
- Existing storefront flow continues to work without `ChannelProductListing`

### 13.2 Optional Backfill for Storefront Listings

A future backfill command may create `storefront.product@v1` draft listings from existing:
- `CatalogProduct`
- `CatalogOffer`
- `EcommerceStoreChannelBinding.salesChannelId`

Backfill rules:
- idempotent
- tenant/org scoped
- no overwrite when listing already exists
- records `trigger_source = 'system_backfill'` in sync/audit logs where applicable

### 13.3 Rollout Safety

Use phased feature flags:
1. create/manage listings in admin only
2. validate/publish lifecycle
3. storefront read overlay (optional)
4. storefront read overlay required (after adoption and migration)

---

## 14) Integration Coverage (Required by Spec)

This section defines the minimum integration coverage expected when implementing this feature.

### 14.1 Affected API Paths (New)

Must be covered with integration tests (API-level):
- `GET /api/channel-listings/models`
- `POST /api/channel-listings/models` (permissions + validation)
- `GET /api/channel-listings/listings`
- `POST /api/channel-listings/listings`
- `GET /api/channel-listings/listings/:id`
- `PATCH /api/channel-listings/listings/:id`
- `POST /api/channel-listings/listings/:id/validate`
- `POST /api/channel-listings/listings/:id/publish`
- `POST /api/channel-listings/listings/:id/pause`
- `POST /api/channel-listings/listings/:id/archive`
- `GET /api/channel-listings/listings/:id/sync-runs`

### 14.2 Affected API Paths (Existing, Behavioral Integration)

Must be covered with integration tests after Phase 3 storefront overlay:
- `GET /api/ecommerce/storefront/products`
- `GET /api/ecommerce/storefront/products/:idOrHandle`
- `GET /api/ecommerce/storefront/categories`

Required assertions:
- fallback works when no storefront listing exists
- projection overlay applies when listing exists and is eligible (`ready|published`)
- hidden/ineligible status does not leak projection content
- tenant/org/channel scoping is enforced

### 14.3 Key UI Paths (Admin)

Must be covered by Playwright integration tests in `.ai/qa/tests/` or module integration tests:
- Channel listings table loads and filters by channel/status/model
- Create listing from admin flow (product + channel + model)
- Edit schema-driven fields and save
- Validate listing and surface validation errors/warnings
- Publish listing queues run and updates status
- Product page injection widget shows listing summary and status

### 14.4 Test Data Rules

Tests must be self-contained and must not rely on seed/demo data.

Fixtures should create via API where possible:
- tenant/org/user with required features
- `SalesChannel`
- `CatalogProduct` + variants + prices (minimal viable canonical product)
- `CatalogOffer` (when scenario requires commercial channel layer)
- `ChannelModelDefinition`
- `ChannelProductListing`

### 14.5 Suggested Test Case IDs (to be created during implementation)

- `TC-CHANNEL-LISTINGS-001` create/list/get listing CRUD happy path
- `TC-CHANNEL-LISTINGS-002` validation errors + status transitions
- `TC-CHANNEL-LISTINGS-003` publish queue run + sync run log
- `TC-CHANNEL-LISTINGS-004` RBAC feature enforcement
- `TC-CHANNEL-LISTINGS-005` storefront fallback without projection
- `TC-CHANNEL-LISTINGS-006` storefront overlay with eligible projection

---

## 15) Success Metrics

1. Add a new channel model definition without changing canonical product schema
2. Publish the same canonical product to >=2 channels with different listing payloads
3. Storefront remains backward-compatible during rollout (no regression in current offer-based flow)
4. Validation errors are deterministic and schema-versioned
5. Retryable publish/sync failures do not corrupt listing state
6. Teams can add a new adapter with no changes to `CatalogProduct` entity schema

---

## 16) Open Questions

1. Should Storefront eventually require a `ChannelProductListing`, or remain permanently optional (`CatalogOffer` fallback forever)?
2. Do we allow multiple active listings for the same `(product, salesChannel, model)` for A/B or regional variants?
3. Where should external credentials/account bindings live (separate integration module vs `channel_listings`)?
4. Should listing validation be strictly synchronous for local models (storefront) and always async for marketplace models?
5. Do we need a separate append-only audit entity for listing field changes, or are command snapshots/audit logs sufficient initially?
6. How should channel category taxonomy synchronization be versioned and cached?

---

## 17) Risks & Impact Review

| Risk | Severity | Affected Area | Scenario | Mitigation | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| `CatalogOffer` / `ChannelProductListing` responsibility overlap | High | Catalog + Channel listings | Developers store marketplace sync state in offers and bypass listing lifecycle | Document strict boundaries; API/UI separate editing surfaces; code review guardrails | Medium |
| Storefront regression during projection rollout | High | `ecommerce` storefront APIs/UI | Projection overlay accidentally changes current listing/PDP output | Phase-gated rollout, fallback-first logic, integration tests for fallback + overlay | Low-Medium |
| Adapter-specific logic leaks into core | High | `channel_listings` module | Allegro/Amazon assumptions hardcoded into generic services | DI adapter contract + model definitions + capability flags; keep channel-specific code in adapters | Medium |
| Schema drift between model definition versions and existing listings | Medium | Validation + admin UI | Listing references old model schema after definition updates | Versioned model definitions; immutable `code+version`; explicit migration/backfill tools | Low |
| JSONB payloads become inconsistent | Medium | Data quality | Ad-hoc writes bypass schema | Strict zod validation + schema validation on all writes; workflow validate gate before publish | Low |
| Async publish duplicates external listing | Medium | External integrations | Retry publishes twice after timeout | `idempotencyKey` on publish + sync runs + adapter idempotency guidance | Medium |
| Tenant/org scoping bug leaks listing metadata | Critical | Security | Query by listing id without tenant/org filter | Mandatory scoped helpers + integration tests + declarative guards | Low |
| Queue failures leave listings stuck in `publishing` | Medium | Operations | Worker crash after status change | Sync run status + retry policies + watchdog/scheduler repair job (future) | Medium |
| Channel taxonomy changes invalidate many listings | Medium | Marketplace channels | External category schema updates | Mark listings stale; revalidate batch workflow; version taxonomy snapshots | Medium |

### Additional Impact Notes

- **Performance:** No impact on storefront performance in Phase 1. Phase 3 storefront overlay adds extra read path but can be scoped by channel/product and optimized with targeted indexes.
- **Operational Complexity:** Increases due to adapters/workflows/queue jobs; mitigated by explicit sync run logs and phased rollout.
- **Developer Ergonomics:** Improves long-term by preventing per-channel product forks, but requires disciplined use of module boundaries.

---

## 18) Final Compliance Report — 2026-02-22

| Requirement Source | Requirement | Status | Notes |
| --- | --- | --- | --- |
| Root `AGENTS.md` | Non-trivial change must be spec-first | Compliant | New architecture spec created before implementation |
| `.ai/specs/AGENTS.md` | Include TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks, Final Compliance Report, Changelog | Compliant | All required sections included |
| Root `AGENTS.md` | List integration coverage for affected API and key UI paths | Compliant | Section 14 defines API/UI coverage and test case IDs |
| Root `AGENTS.md` | Reuse existing core mechanics, avoid ad-hoc duplication | Compliant | Design reuses `catalog`, `sales`, `ecommerce`, `workflows`, `queue`, `events` |
| Root `AGENTS.md` | No direct cross-module ORM relations | Compliant (design) | Spec stores FK IDs only; explicit no-ORM-relations rule repeated |
| Root `AGENTS.md` | Multi-tenant scoping required | Compliant (design) | All new entities include tenant/org scope + security risks/mitigations |
| Root `AGENTS.md` | API routes must export `openApi` | Compliant (design) | Spec mandates `openApi` on all new routes |

---

## 19) Changelog

### 2026-02-22
- Initial specification for generic channel-specific product projections/listings
- Defined separation of concerns between `CatalogOffer` and `ChannelProductListing`
- Added phased rollout plan with storefront compatibility fallback
- Defined required integration coverage for API and UI paths
