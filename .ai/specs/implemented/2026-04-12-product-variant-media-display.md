# Product Variant Media Display & Default Fallback

> Cross-referenced against GitHub issue `#892` (`bug: product catalog - editing product - display media from variants + set default variant media as default product media if none set`) on 2026-04-12.

## TLDR

**Key Points:**
- When editing a product, display media from all its variants alongside the product's own media so admins can see the full media landscape without navigating to each variant individually.
- If a product has no default media set, automatically fall back to the default variant's media (or the first variant with media) as the product's default media.

**Scope:**
- Read-only variant media gallery on the product edit page
- Automatic default media fallback from variant to product on save
- Variant API enrichment with media metadata needed by the product edit page

**Concerns:**
- Variant media must remain read-only on the product page — editing variant media must still happen on the variant edit page to maintain clear ownership boundaries.

## Overview

## Issue Cross-Reference

### Source of Truth

- GitHub issue `#892` is the primary source.
- The issue contains a title and a screenshot only; it does not define API shape, fallback precedence, batching strategy, or exact UI copy.

### Requirements Confirmed Directly by the Issue

- While editing a product, admins should be able to see media coming from variants.
- If the product has no product-level default media, variant media should be used as the product default.

### Design Choices Inferred by This Spec

- Showing variant media as a dedicated read-only gallery below the existing product media manager.
- Resolving fallback preference as default variant first, then first variant with media.
- Applying fallback on save rather than eagerly on page load.

These are reasonable implementation choices, but they are not explicitly required by the issue and should be labeled as such.

Currently, product media and variant media are managed independently. The product edit page shows only product-level attachments, and variant media is only visible by navigating to each variant's individual edit page. This forces admins to open multiple pages to understand the full visual identity of a product.

This spec adds a **Variant Media** section to the product edit page that aggregates media from all variants into a read-only gallery, grouped by variant. Additionally, when a product has no default media of its own, the system will automatically adopt the default variant's media as the product's display image — reducing the number of products appearing without images in listings, dashboards, and the storefront.

> **Market Reference**: Shopify displays variant images within the product editor, grouped under each variant. We adopt the aggregated view pattern but keep editing at the variant level to preserve the existing ownership model. WooCommerce similarly shows variant images on the product page in a read-only fashion within the Variations tab.

## Problem Statement

1. **Hidden media**: Admins must navigate to each variant's edit page to see its images. For products with many variants (e.g. 10+ color/size combinations), this is time-consuming and error-prone.
2. **Missing product thumbnails**: Products that rely on variant-level media (common for configurable products) appear without images in product lists, search results, dashboards (quality widget), and the storefront because the product's `defaultMediaId` is null.
3. **Inconsistent UX**: The screenshot in the issue shows the product edit page with no visual indication that variants may already have rich media attached.

## Proposed Solution

### Two changes, one page

| Change | Type | Where |
|--------|------|-------|
| **Variant Media Gallery** | Frontend read-only UI | Product edit page, below product media section |
| **Default Media Fallback** | Backend logic | Product update command + new API field on variants |

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Read-only gallery on product page | Editing variant media on the product page would create confusing ownership semantics — variant media belongs to the variant |
| Link to variant edit page per group | Quick navigation keeps the workflow efficient without duplicating edit capabilities |
| Fallback only on explicit save | Auto-setting `defaultMediaId` on page load (without save) could surprise users; doing it on save makes the change explicit and undoable |
| Fallback prefers the default variant | The `is_default` variant is the canonical representative of the product; its media is the natural fallback |
| Prefer exposing `defaultMediaId` on variant list responses; expose `defaultMediaUrl` only if implementation truly needs it | `defaultMediaUrl` can be derived from the attachment id in the UI, so adding both fields increases contract surface without clear issue-driven value |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Copy variant media to product on variant save | Creates duplicate attachments, wastes storage, and media can drift out of sync |
| Editable variant media on product page | Violates single-ownership principle; complex conflict scenarios |
| Auto-set product default media in a subscriber | Side-effect would be invisible and harder to debug; explicit save-time logic is clearer |

## User Stories / Use Cases

- **Admin** wants to **see all variant images while editing a product** so that they can **verify visual completeness without navigating to each variant**.
- **Admin** wants **products to automatically get a thumbnail when only variants have images** so that **product listings and the storefront always show an image**.
- **Admin** wants to **quickly navigate to a variant's edit page from the product media gallery** so that they can **update a specific variant's images efficiently**.

## Architecture

### Data Flow

```
Product Edit Page Load
  ├── Fetch product media (existing: GET /api/attachments?entityId=catalog_product&recordId={id})
  ├── Fetch variants (existing: GET /api/catalog/variants?productId={id})
  │   └── Response should include at least defaultMediaId per variant
  └── Fetch variant media (existing attachments API, one request per variant unless API is explicitly extended)
       └── Current attachments API accepts a single recordId, so client-side capped parallel requests are the safe baseline

Product Save
  ├── If product.defaultMediaId is set → save normally (existing behavior)
  └── If product.defaultMediaId is null AND variants have media:
       ├── Find the default variant (is_default=true) with media
       ├── Fallback: first variant with a non-null defaultMediaId
       └── Set product.defaultMediaId = variant.defaultMediaId
           Set product.defaultMediaUrl = derived URL or variant.defaultMediaUrl if that field is exposed
```

### Component Hierarchy

```
ProductDetailsSection (existing)
  ├── ProductMediaManager (existing — product's own media)
  └── VariantMediaReadonlyGallery (NEW)
       ├── Per-variant group header (variant name + link to edit page)
       └── Thumbnail grid (read-only, no upload/delete/star)
```

### Commands & Events

No new commands or events. The default media fallback is integrated into the existing `UpdateProductCommand` flow.

## Data Models

### CatalogProductVariant (Entity Fix Required)

The DB columns `default_media_id` and `default_media_url` already exist on `catalog_product_variants` (added in Migration20251117165931), but the ORM entity `CatalogProductVariant` in `packages/core/src/modules/catalog/data/entities.ts` (lines 480-561) is **missing** the corresponding property declarations. The `defaultMediaId`/`defaultMediaUrl` properties that appear earlier in the same file (lines 449-453) belong to `CatalogOffer`, not the variant.

Add to `CatalogProductVariant`:

```typescript
@Property({ name: 'default_media_id', type: 'uuid', nullable: true })
defaultMediaId?: string | null

@Property({ name: 'default_media_url', type: 'text', nullable: true })
defaultMediaUrl?: string | null
```

No new migration is needed — the columns are already present. Run `yarn db:generate` to confirm no diff is produced.

## API Contracts

### Variant List (Modified)

- `GET /api/catalog/variants?productId={id}`
- Response items should include at least:

```json
{
  "id": "uuid",
  "name": "Blue / Small",
  "sku": "SKU-001",
  "is_default": true,
  "default_media_id": "uuid | null"
}
```

`default_media_url` is optional and should only be added if deriving the URL in the UI proves impractical.

**Backward compatibility**: Additive-only — optional response fields only. No breaking change.

### Attachments List (Existing)

- Current route shape: `GET /api/attachments?entityId=catalog_product_variant&recordId={id}`
- Current implementation does not support comma-separated `recordId` values.
- Baseline implementation should use multiple requests with a concurrency cap.
- Extending the attachments API to support multi-record lookup would be a separate contract change and is out of scope for the GitHub issue as written.

**OpenAPI**: Update the variant route's `openApi` export to include whichever new variant response fields are actually introduced.

## Internationalization (i18n)

New keys (all 4 locales: `en`, `pl`, `de`, `es`):

| Key | English Default |
|-----|----------------|
| `catalog.products.variantMedia.title` | `Variant media` |
| `catalog.products.variantMedia.empty` | `No variant media uploaded yet.` |
| `catalog.products.variantMedia.editVariant` | `Edit variant` |
| `catalog.products.variantMedia.defaultFallbackApplied` | `Product thumbnail set from variant "{name}".` |

## UI/UX

### Variant Media Gallery

- **Location**: Inside the product edit page's "Details" section, below the existing `ProductMediaManager`.
- **Visibility**: Only shown for configurable products (`hasVariants === true`) that have at least one variant with media.
- **Layout**: 
  - Section header: "Variant media" with muted styling to distinguish from product media.
  - For each variant with media: variant name as a subheading with a small link icon to the variant edit page.
  - Thumbnail grid: same 2-3 column layout as `ProductMediaManager`, but without upload zone, star, or delete buttons.
  - Default media indicator: the variant's default image gets a subtle badge.
- **Interaction**: Clicking a thumbnail does nothing (read-only). Clicking the variant name or link icon navigates to the variant edit page.

### Default Fallback UX

- When the user saves a product and the fallback triggers, show a flash message: `Product thumbnail set from variant "Blue / Small".`
- The `defaultMediaId` field in the form is updated after save so the UI reflects the new state.

## Migration & Compatibility

- **No new migration**: DB columns already exist.
- **ORM entity update required**: Add missing `defaultMediaId` and `defaultMediaUrl` properties to `CatalogProductVariant`. Run `yarn db:generate` to confirm no migration is produced.
- **API backward compatibility**: Response-only additive fields — existing consumers are unaffected.
- **No breaking changes** to any contract surface.

## Implementation Plan

### Phase 1: Entity Fix & API Enrichment

1. **Add missing ORM properties** to `CatalogProductVariant` in [entities.ts](packages/core/src/modules/catalog/data/entities.ts) — `defaultMediaId` and `defaultMediaUrl` (DB columns already exist from Migration20251117165931).
2. **Run `yarn db:generate`** to verify no migration is produced (columns already present).
3. **Update variant API route** in [variants/route.ts](packages/core/src/modules/catalog/api/variants/route.ts) to include at least `default_media_id` in the list response and `openApi` schema. Only add `default_media_url` if deriving the URL client-side proves impractical.
4. **Verify**: `GET /api/catalog/variants?productId=...` returns the new media field(s).

### Phase 2: Variant Media Gallery Component

1. **Create `VariantMediaReadonlyGallery` component** in [components/products/](packages/core/src/modules/catalog/components/products/) — accepts variant media data, renders grouped read-only thumbnails.
2. **Update `VariantSummaryApi` type** on the product edit page to match the actual enriched route response.
3. **Fetch variant attachments** on the product edit page using capped parallel calls to the existing attachments API.
4. **Integrate gallery** into `ProductDetailsSection` below `ProductMediaManager`, gated on `hasVariants && variantsHaveMedia`.
5. **Add i18n keys** to all 4 locale files (`en`, `pl`, `de`, `es`).
6. **Verify**: Product edit page shows variant media in read-only gallery with links to variant pages.

### Phase 3: Default Media Fallback

1. **Update product save logic** on the product edit page — after form validation, if `defaultMediaId` is null and variants have media, resolve the fallback.
2. **Fallback resolution order**: (a) default variant with `defaultMediaId`, (b) first variant with `defaultMediaId`.
3. **Flash message**: Show `catalog.products.variantMedia.defaultFallbackApplied` after save when fallback was applied.
4. **Verify**: Save a product with no media but variants with media — product gets a thumbnail. Existing products with media are unaffected.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/catalog/data/entities.ts` | Modify | Add `defaultMediaId`/`defaultMediaUrl` to `CatalogProductVariant` |
| `packages/core/src/modules/catalog/api/variants/route.ts` | Modify | Include media fields in list response + openApi |
| `packages/core/src/modules/catalog/components/products/VariantMediaReadonlyGallery.tsx` | Create | Read-only variant media gallery component |
| `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` | Modify | Integrate gallery, fetch variant media, fallback logic |
| `packages/core/src/modules/catalog/i18n/en.json` | Modify | Add variant media i18n keys |
| `packages/core/src/modules/catalog/i18n/pl.json` | Modify | Add variant media i18n keys |
| `packages/core/src/modules/catalog/i18n/de.json` | Modify | Add variant media i18n keys |
| `packages/core/src/modules/catalog/i18n/es.json` | Modify | Add variant media i18n keys |

### Testing Strategy

- **Unit test**: `VariantMediaReadonlyGallery` renders variant groups with correct thumbnails and link hrefs.
- **Unit test**: Fallback resolution picks default variant first, then first-with-media.
- **Integration test**: Create product with variants → upload media to variant → edit product → verify gallery appears.
- **Integration test**: Save product with no media, variant has media → verify `defaultMediaId` is populated.
- **Regression**: Save product with existing media → verify no change to `defaultMediaId`.

## Risks & Impact Review

### Data Integrity Failures

No new write paths for variant media. The only mutation is setting `defaultMediaId` on product save — this uses the existing `UpdateProductCommand` which is atomic and undoable.

### Cascading Failures & Side Effects

The variant media fetch on product load adds multiple attachment requests unless the attachments API is enhanced separately. If some requests fail, the gallery should degrade per variant and the rest of the product form must remain fully functional.

### Tenant & Data Isolation Risks

All queries are scoped by `organizationId` and `tenantId` through existing CRUD factories. No new isolation surface.

### Migration & Deployment Risks

No migration. No breaking API changes. Can be deployed without downtime.

### Operational Risks

Fetching attachments for all variants could be slow for products with many variants (50+). Mitigated by batching and the existing 100-variant page limit.

### Risk Register

#### Attachment API batch limit
- **Scenario**: A product has 50+ variants, each with multiple images. The product edit page triggers many attachment requests.
- **Severity**: Low
- **Affected area**: Product edit page load performance
- **Mitigation**: Cap parallel requests, only render groups with returned media, and consider a dedicated multi-record attachments endpoint only if profiling proves it necessary.
- **Residual risk**: Slight increase in page load time for products with many variants — acceptable for admin UI if concurrency is bounded.

#### False positive fallback
- **Scenario**: Admin intentionally leaves product without media. The fallback auto-sets variant media on save.
- **Severity**: Low
- **Affected area**: Product default media
- **Mitigation**: The fallback only triggers when `defaultMediaId` is null. If the admin explicitly removes product media (setting it to null), the fallback re-applies on next save. This is desirable behavior — if the admin wants no image, they can upload a placeholder or the feature can be toggled via a future setting.
- **Residual risk**: Minor surprise for admins who intentionally want no product image. Acceptable for now; can add an explicit "no image" toggle if feedback warrants it.

## Final Compliance Report — 2026-04-12

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/shared/AGENTS.md` (import conventions)
- `packages/ui/AGENTS.md` (component patterns)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Uses attachment API (polymorphic), not ORM joins |
| root AGENTS.md | Filter by organization_id | Compliant | All queries use existing tenant-scoped CRUD |
| root AGENTS.md | API routes MUST export openApi | Compliant | Variant route openApi updated |
| root AGENTS.md | Modules must remain isomorphic and independent | Compliant | Gallery component is within catalog module |
| root AGENTS.md | Use apiCall, never raw fetch | Compliant | All API calls use apiCall |
| root AGENTS.md | i18n: useT client-side | Compliant | All new strings use useT |
| packages/core/AGENTS.md | CRUD routes use makeCrudRoute with indexer | N/A | No new CRUD routes |
| catalog AGENTS.md | MUST NOT reimplement pricing logic | N/A | No pricing changes |
| Backward Compatibility | Event IDs are FROZEN | Compliant | No event changes |
| Backward Compatibility | API response fields additive-only | Compliant | Two optional fields added to variant response |
| Backward Compatibility | Widget injection spot IDs FROZEN | N/A | No spot ID changes |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Entity fields align with API response |
| API contracts match UI/UX section | Pass | Gallery uses variant list + attachments APIs |
| Risks cover all write operations | Pass | Only write is existing product update |
| Commands defined for all mutations | Pass | Uses existing UpdateProductCommand |

### Non-Compliant Items

- The challenge update incorrectly claimed `CatalogProductVariant` already has `defaultMediaId`/`defaultMediaUrl` — those properties at lines 449-453 belong to `CatalogOffer`. The original draft's entity fix prerequisite was correct and has been restored.
- The original draft assumed `/api/attachments` supports comma-separated `recordId` values; the current route accepts a single `recordId`.
- The original draft treated fallback precedence and save-time behavior as issue requirements, but GitHub issue `#892` does not specify those details.

### Verdict

**Fully compliant** — ready for implementation. Fallback precedence and attachment-fetch strategy are documented as inferred design choices, not issue-mandated requirements.

## Changelog

### 2026-04-12
- Initial specification
- Cross-referenced the draft against GitHub issue `#892`
- Corrected the attachments API assumption (single `recordId`, not comma-separated)
- Reframed fallback precedence and save-time behavior as inferred design choices rather than direct issue requirements
- Restored entity fix prerequisite after verifying `CatalogProductVariant` is indeed missing `defaultMediaId`/`defaultMediaUrl` (the properties at line 449 belong to `CatalogOffer`)
