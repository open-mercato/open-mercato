# SPEC-029: Ecommerce Storefront Module

**Date**: 2026-02-17
**Status**: Proposed
**Related Issues**: #289, #288

---

## 1) Overview

This specification defines the full architecture of the **Ecommerce Storefront Module** for Open Mercato: a headless, multi-tenant, multi-channel commerce layer comprising a core backend module and a standalone storefront starter application.

Deliverables:

| Deliverable | Location | Description |
|---|---|---|
| Core ecommerce module | `packages/core/src/modules/ecommerce/` | Store context, public APIs, checkout boundary, admin CRUD |
| Storefront starter app | `apps/storefront/` | Next.js frontend consuming ecommerce APIs only |

Scope per phase:

- **Phase 1** — Foundation: entities, migrations, admin CRUD, store context resolver
- **Phase 2** — Public Catalog APIs: product browse/search/detail, categories, faceted filters
- **Phase 3** — Checkout Session: `EcommerceCheckoutSession` entity + workflow integration *(see §19)*
- **Phase 4** — Storefront Starter App: all frontend pages and components
- **Phase 5** — Hardening: rate limits, integration tests, WCAG audit, performance profiling

---

## 2) Problem Statement

The platform has strong back-office capabilities (products, pricing, orders, workflows) but no public commerce channel:

- No first-class concept of an organization-owned storefront
- No stable public API contract for product discovery, browsing, and variant selection
- No shared store context resolver (host → tenant/org/channel)
- No checkout boundary between storefront UX and `sales` internals
- No headless channel contract usable by web, mobile, and AI agents
- No per-store branding/theme configuration

Without this layer each channel duplicates scoping, pricing, and checkout logic.

---

## 3) Proposed Solution

### 3.1 Core Module (`packages/core/src/modules/ecommerce/`)

- Owns store configuration, domain mapping, channel bindings, and checkout sessions
- Exposes public storefront APIs (no auth)
- Exposes admin APIs (auth + feature guard)
- Integrates with: `catalog` (products/pricing), `sales` (orders), `workflows` (checkout state machine), `search`, `translations`

### 3.2 Storefront App (`apps/storefront/`)

- Standalone Next.js app — **no dependency on `@open-mercato/core`**
- Consumes only `/api/ecommerce/storefront/*` endpoints
- Reads store context (branding, locale, currency) from API on boot
- Applies per-store CSS variables dynamically at runtime

### 3.3 Principles

1. **Multi-tenant by default** — every query scoped by `tenant_id` and `organization_id`
2. **No cross-module ORM relations** — FK IDs only, fetch separately
3. **Headless-first** — same APIs serve web, mobile, AI agents
4. **Workflow-driven checkout** — frontend state follows backend workflow state machine (Phase 3)
5. **Localization-first** — all responses respect locale resolution and entity translation overlays
6. **Accessibility-first** — WCAG 2.2 AA compliance enforced from component design
7. **RWD-first** — mobile layout is primary; desktop is progressive enhancement

---

## 4) Goals

- Allow each organization to operate one or more storefronts under custom domains
- Expose stable, documented storefront APIs for product browse/search/detail/facets
- Support product variants and option selection with deterministic variant resolution
- Support language-aware product fields (title, subtitle, description, SEO)
- Enable per-store configurable branding (colors, fonts, logo, radius) without redeployment
- Use `sales` as source of truth for order creation and lifecycle (Phase 3)
- Prepare channel abstraction for mobile and AI consumers

---

## 5) Non-Goals (This Spec)

- Full CMS / page-builder
- Marketplace / multi-vendor splits
- Advanced promotions engine (coupons, campaigns, stacks)
- Customer account redesign / loyalty system
- Offline storefront mode
- Payment gateway integration (Phase 3+)
- Inventory reservation at browse time

---

## 6) Architecture

### 6.1 High-Level Diagram

```
┌──────────────────────────────────────────────────────┐
│  apps/storefront/ (Next.js, standalone)              │
│                                                      │
│  /                   → ProductListingPage            │
│  /products/[handle]  → ProductDetailPage             │
│  /categories/[slug]  → CategoryPage                  │
│  /search             → SearchResultsPage             │
│  /cart               → CartPage (Phase 3)            │
│  /checkout           → CheckoutPage (Phase 3)        │
│  /order/[token]      → OrderConfirmPage (Phase 3)    │
└─────────────────┬────────────────────────────────────┘
                  │  fetch() via storefrontFetch()
                  ▼
┌──────────────────────────────────────────────────────┐
│  /api/ecommerce/storefront/* (public, no auth)       │
│                                                      │
│  GET  /context                   → StoreContext      │
│  GET  /products                  → list + facets     │
│  GET  /products/:idOrHandle      → PDP payload       │
│  GET  /categories                → tree              │
│  GET  /categories/:slug          → category + list   │
│  POST /checkout/sessions         → Phase 3           │
│  PATCH /checkout/sessions/:id    → Phase 3           │
│  POST /checkout/sessions/:id/transition → Phase 3    │
└─────────────────┬────────────────────────────────────┘
                  │
          ┌───────┴──────────────────────────────────┐
          │  packages/core/src/modules/ecommerce/    │
          │                                          │
          │  storeContext resolver                   │
          │    Host header → EcommerceStoreDomain    │
          │               → EcommerceStore           │
          │               → tenantId + orgId         │
          │               → channelBinding           │
          │                                          │
          │  lib/storefrontProducts.ts               │
          │    ├── catalog.CatalogProduct queries    │
          │    ├── catalogPricingService.resolve()   │
          │    └── applyTranslationOverlays()        │
          │                                          │
          │  lib/storefrontFacets.ts                 │
          │    └── server-side facet aggregation     │
          └──────────────────────────────────────────┘
```

### 6.2 Ownership Boundaries

| Module | Owns |
|---|---|
| `ecommerce` | Store config, domain mapping, public API surface, checkout session boundary |
| `catalog` | Product/variant/media domain model, pricing primitives (`selectBestPrice`) |
| `sales` | Orders, quotes, payments, shipments, document totals |
| `workflows` | Checkout state machine execution, transition rules |
| `translations` | Locale overlay of translatable product/category fields |
| `search` | Fulltext/vector/token index for product search |

### 6.3 Domain Resolution Flow

```
Incoming request to firda.pl/products/red-dress
  │
  ▼
ecommerce.storeContext.resolveStoreFromRequest(request)
  │  1. Extract Host header (or ?storeSlug= for dev)
  │  2. em.findOne(EcommerceStoreDomain, { host: 'firda.pl' })
  │  3. em.findOne(EcommerceStore, { id: domain.storeId, status: 'active' })
  │  4. em.findOne(EcommerceStoreChannelBinding, { storeId, isDefault: true })
  │  5. Compute effectiveLocale (query → X-Locale header → store.defaultLocale)
  ▼
StoreContext {
  store: { id, code, name, slug, defaultLocale, supportedLocales,
           defaultCurrencyCode, settings: { branding, contact } }
  tenantId, organizationId
  channelBinding: { salesChannelId, priceKindId } | null
  effectiveLocale: 'pl'
}
```

---

## 7) Data Models

All entities include standard scoped columns: `id` (UUID PK), `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`.

### 7.1 `EcommerceStore` (`ecommerce_stores`)

| Column | Type | Notes |
|---|---|---|
| `code` | text | Unique within tenant |
| `name` | text | Display name |
| `slug` | text | URL-safe, unique within tenant |
| `status` | enum | `draft \| active \| archived` |
| `default_locale` | text | `pl`, `en`, `de`, etc. |
| `supported_locales` | jsonb | `string[]` |
| `default_currency_code` | text | `PLN`, `EUR`, etc. |
| `is_primary` | boolean | One primary per org |
| `settings` | jsonb | See §7.1.1 |

#### 7.1.1 `settings` JSONB Schema

```typescript
type EcommerceStoreSettings = {
  branding: {
    logoUrl?: string | null
    faviconUrl?: string | null
    // OKLCH color values — applied as CSS variables at runtime
    primaryColor?: string         // e.g. 'oklch(0.3 0.15 270)'
    primaryForeground?: string
    accentColor?: string
    accentForeground?: string
    backgroundColor?: string
    foregroundColor?: string
    borderRadius?: string         // e.g. '0.5rem'
    fontFamilyBase?: string       // e.g. "'Inter', sans-serif"
    fontFamilyHeading?: string
  }
  contact: {
    email?: string | null
    phone?: string | null
    address?: string | null
    social?: Record<string, string>  // { twitter: '@...', instagram: '...' }
  }
  features: {
    showOutOfStock: boolean           // default: true
    allowBackorder: boolean           // default: false
    showPriceIncludingTax: boolean    // default: true
    enableSearch: boolean             // default: true
    enableReviews: boolean            // default: false (Phase 2+)
    enableWishlist: boolean           // default: false (Phase 3+)
  }
  seo: {
    siteName?: string
    defaultMetaDescription?: string
    googleSiteVerification?: string
    robotsTxt?: string
  }
}
```

### 7.2 `EcommerceStoreDomain` (`ecommerce_store_domains`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `host` | text | Globally unique, normalized lowercase (e.g. `firda.pl`) |
| `is_primary` | boolean | One primary per store |
| `tls_mode` | enum | `platform \| external` |
| `verification_status` | enum | `pending \| verified \| failed` |

Constraints:
- Unique `host` globally (cross-tenant uniqueness prevents hostname squatting)
- One `is_primary=true` per `store_id`

### 7.3 `EcommerceStoreChannelBinding` (`ecommerce_store_channel_bindings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `sales_channel_id` | uuid | References sales channel |
| `price_kind_id` | uuid, nullable | Overrides default price kind |
| `catalog_scope` | jsonb | Optional assortment constraints |
| `is_default` | boolean | One default per store |

`catalog_scope` JSONB schema:
```typescript
type CatalogScope = {
  categoryIds?: string[]   // Restrict to these categories (and descendants)
  tagIds?: string[]        // Restrict to products with any of these tags
  excludeProductIds?: string[]
}
```

### 7.4 `EcommerceCheckoutSession` (`ecommerce_checkout_sessions`) — Phase 3

> **Design note**: The checkout session is also the cart. There is no separate cart entity. `status: 'open'` means the user is still browsing and modifying items — this is the cart state. Transitioning through checkout steps changes the status. An authenticated user's session is assigned to them on creation or login association; a guest session remains unassigned until email is provided.

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `status` | enum | `open \| locked \| submitted \| completed \| canceled \| expired` |
| `version` | integer | Monotonically incrementing; used for optimistic locking on mutations |
| `idempotency_key` | text, nullable | Client-supplied key on creation; globally unique per store |
| `currency_code` | text | Locked at session creation |
| `locale` | text | Locked at session creation |
| `email` | text, nullable | |
| `customer_ref` | jsonb, nullable | `{ id?, name?, phone? }` |
| `shipping_address` | jsonb, nullable | Full address object |
| `billing_address` | jsonb, nullable | Full address object |
| `line_snapshot` | jsonb | `CartLine[]` — snapshot of cart lines |
| `totals_snapshot` | jsonb | `CartTotals` — computed totals |
| `workflow_instance_id` | uuid, nullable | FK → `workflow_instances` |
| `sales_order_id` | uuid, nullable | Set after order creation |
| `expires_at` | timestamptz | TTL for abandoned sessions |

**Status lifecycle**:
```
open (= cart)
  → locked    (payment processing started; blocks modifications)
  → submitted (order created in sales module)
  → completed (payment confirmed)
  → canceled  (user or admin canceled)
  → expired   (TTL exceeded — automatic via background job)
```

### 7.5 Idempotency Strategy

All critical cart/checkout operations MUST be idempotent to prevent duplicate sessions, duplicate order creation, and payment double-charges.

#### 7.5.1 Session Creation — Idempotency Key

`POST /checkout/sessions` accepts an optional `Idempotency-Key` header (client-generated UUID). The server stores the key → session mapping:

- **First call**: session created normally; key stored alongside session
- **Duplicate call** (same key, same store): **returns the existing session unchanged** with HTTP 200 (not 201)
- **Key expiry**: idempotency keys expire after 24 hours (same as session TTL)
- **Key conflict**: if same key used with different request body → HTTP 422 with `idempotency_key_mismatch`

The storefront client MUST generate a fresh UUID key per cart creation and store it in `sessionStorage` (survives tab refresh; lost on tab close). On retry after network error, re-use the same key.

#### 7.5.2 Session Mutations — Optimistic Locking (Version)

Every `PATCH /checkout/sessions/:id` and `POST /checkout/sessions/:id/transition` request MUST include the current `version` in the request body:

```typescript
// PATCH /checkout/sessions/:id
{ version: 3, lines: [{ variantId, quantity }] }

// Server:
// 1. Load session
// 2. If session.version !== request.version → 409 Conflict { error: 'version_mismatch', currentVersion: 4 }
// 3. Apply changes
// 4. Increment session.version → 4
// 5. Return updated session with new version
```

The storefront client always stores the latest `version` from the last successful response and passes it on the next mutation. On 409, re-fetch the session to get the current state before retrying.

This prevents:
- Concurrent tab modifications stomping each other
- Double-submit from debounce/network retry
- Stale-client updates after server-side expiry bump

#### 7.5.3 Workflow Transition Idempotency

Workflow transitions are inherently idempotent at the engine level: re-sending an already-executed transition returns the current state without re-executing activities. No additional client-side handling required for transitions.

---

## 8) Product & Variant Handling

### 8.1 Product Types

From `CATALOG_PRODUCT_TYPES`:
- `simple` — Single variant, no option selection
- `configurable` — Multiple variants, requires option selection
- `virtual` — No physical shipping
- `downloadable` — Digital delivery
- `bundle` — Group of products sold together
- `grouped` — Related products sold individually

Configurable types (`configurable`, `virtual`, `downloadable`) require variant resolution.

### 8.2 Option Schema Structure

From `CatalogProductOptionSchema` (types.ts):

```typescript
type CatalogProductOptionSchema = {
  version?: number
  name?: string | null
  options: Array<{
    code: string           // e.g. 'color', 'size'
    label: string          // e.g. 'Color', 'Size'
    inputType: 'select' | 'text' | 'textarea' | 'number'
    isRequired?: boolean
    isMultiple?: boolean
    choices?: Array<{      // For 'select' inputType
      code: string         // e.g. 'red', 'xl'
      label?: string | null // e.g. 'Red', 'XL'
    }>
  }>
}
```

Each `CatalogProductVariant` has `optionValues: Record<string, string>` (e.g. `{ color: 'red', size: 'xl' }`).

### 8.3 Variant Resolution Algorithm

```typescript
// Given: optionSchema, variants[], selectedOptions: Record<string, string>
// Returns: matched variant | null, availability, pricing

function resolveVariant(
  variants: CatalogProductVariant[],
  selectedOptions: Record<string, string>
): VariantResolutionResult {
  // 1. Filter variants where ALL selected options match optionValues
  // 2. Among matched, prefer isDefault=true
  // 3. If no complete match, return partial matches for option availability hints
  // 4. Compute which choices are unavailable given current selections
}

type VariantResolutionResult = {
  variant: CatalogProductVariant | null
  isComplete: boolean       // all required options selected
  unavailableChoices: Record<string, string[]>  // code → unavailable choice codes
  pricing: ResolvedPrice | null
}
```

### 8.4 Product List Payload

```typescript
type StorefrontProductListItem = {
  id: string
  handle: string | null
  title: string              // localized
  subtitle: string | null    // localized
  defaultMediaUrl: string | null
  productType: string
  isConfigurable: boolean
  hasVariants: boolean
  variantCount: number
  categories: Array<{ id: string; name: string; slug: string | null }>
  tags: string[]
  priceRange: {
    min: string              // formatted with currency symbol
    max: string
    currencyCode: string
    minNet: number           // raw numeric for sorting
    maxNet: number
  } | null
  availability: 'in_stock' | 'out_of_stock' | 'backorder'
  badges: string[]           // e.g. ['new', 'sale', 'featured']
}
```

### 8.5 Product Detail Payload

```typescript
type StorefrontProductDetail = {
  id: string
  handle: string | null
  title: string              // localized
  subtitle: string | null    // localized
  description: string | null // localized, may contain markdown/HTML
  sku: string | null
  productType: string
  isConfigurable: boolean
  defaultMediaUrl: string | null
  media: Array<{
    id: string
    url: string
    alt: string | null
    sortOrder: number
  }>
  dimensions: {
    length: number | null; width: number | null; height: number | null; unit: string | null
  } | null
  weightValue: number | null
  weightUnit: string | null
  categories: Array<{ id: string; name: string; slug: string | null; ancestorIds: string[] }>
  tags: string[]
  optionSchema: CatalogProductOptionSchema | null
  variants: Array<{
    id: string
    name: string
    sku: string | null
    optionValues: Record<string, string>
    isDefault: boolean
    isActive: boolean
    availability: 'in_stock' | 'out_of_stock' | 'backorder'
    pricing: {
      currencyCode: string
      unitPriceNet: number
      unitPriceGross: number
      displayMode: 'including-tax' | 'excluding-tax'
      formattedPrice: string      // e.g. '129,00 zł'
      isPromotion: boolean
      originalPriceGross: number | null
      formattedOriginalPrice: string | null
    } | null
    dimensions: { length: number | null; width: number | null; height: number | null; unit: string | null } | null
    weightValue: number | null
    weightUnit: string | null
  }>
  pricing: {                 // base product best price (non-configurable / default variant)
    currencyCode: string
    unitPriceNet: number
    unitPriceGross: number
    displayMode: 'including-tax' | 'excluding-tax'
    formattedPrice: string
    isPromotion: boolean
    originalPriceGross: number | null
    formattedOriginalPrice: string | null
  } | null
  priceRange: {
    min: string; max: string; currencyCode: string
  } | null
  relatedProducts: StorefrontProductListItem[]  // max 8
  seo: {
    title: string | null
    description: string | null
    canonicalUrl: string | null
  }
}
```

---

## 9) Dynamic Filters & Faceted Search

### 9.1 Filter Types

| Filter | Source | Type | Multi-select |
|---|---|---|---|
| Category | `CatalogProductCategoryAssignment` | Tree checkbox | Yes |
| Price range | `CatalogProductPrice` | Min/max slider | No (range) |
| Tags | `CatalogProductTagAssignment` | Pill toggles | Yes |
| Options | `CatalogProductVariant.optionValues` | Dynamic per schema | Yes per option |
| Product type | `CatalogProduct.productType` | Checkbox list | Yes |
| Availability | computed | Radio group | No |

### 9.2 Server-Side Facet Computation

All facets are computed server-side, returned in the products list response:

```typescript
type StorefrontFacets = {
  categories: Array<{
    id: string
    name: string
    slug: string | null
    depth: number
    parentId: string | null
    count: number             // products matching current filters (excl. category filter)
  }>
  tags: Array<{
    slug: string
    label: string
    count: number             // products matching current filters (excl. tag filter)
  }>
  priceRange: {
    min: number               // global min across all matching products
    max: number
    currencyCode: string
  } | null
  options: Array<{
    code: string              // e.g. 'color'
    label: string             // e.g. 'Color'
    values: Array<{
      code: string            // e.g. 'red'
      label: string           // e.g. 'Red'
      count: number           // products with this option value
    }>
  }>
  productTypes: Array<{
    type: string
    label: string
    count: number
  }>
  total: number               // total matching products (before pagination)
}
```

### 9.3 Cross-Facet Exclusion

**Rule**: The count for a given facet dimension is computed against all other active filters *except* the filter for that same dimension. This ensures filter counts remain accurate even when a user has selected values in that dimension.

Example: User selected `color=red`. Category counts are computed on products `color=red` AND matching price AND matching tags. But the color value counts are computed without the color filter, so all color options remain visible with accurate counts.

Implementation:
```
For each facet dimension D:
  baseQuery = all active filters EXCEPT filters in dimension D
  counts = aggregate(baseQuery grouped by D)
```

This requires running multiple aggregation queries. Cache results for 60s with tag `store:{storeId}:facets`.

### 9.4 Filter Query Parameters

```
GET /api/ecommerce/storefront/products
  ?page=1
  &pageSize=24
  &search=dress
  &categoryId=uuid            # single category (includes descendants)
  &tagSlugs=sale,new          # comma-separated
  &priceMin=50
  &priceMax=200
  &options[color]=red,blue    # bracket notation, comma-separated values
  &options[size]=xl
  &productType=configurable
  &availability=in_stock
  &sort=price_asc             # price_asc|price_desc|title_asc|title_desc|newest|featured
  &locale=pl
```

### 9.5 Storefront URL State Synchronization

The storefront app syncs filter state to URL using the `useStorefrontFilters` hook:

```typescript
// lib/useStorefrontFilters.ts
type StorefrontFilters = {
  search: string
  categoryId: string | null
  tagSlugs: string[]
  priceMin: number | null
  priceMax: number | null
  options: Record<string, string[]>    // { color: ['red', 'blue'] }
  sort: SortOption
  page: number
}

function useStorefrontFilters(): {
  filters: StorefrontFilters
  setFilter: <K extends keyof StorefrontFilters>(key: K, value: StorefrontFilters[K]) => void
  clearFilter: (key: keyof StorefrontFilters) => void
  clearAll: () => void
  activeFilterCount: number
  toQueryParams: () => URLSearchParams
}
// Backed by Next.js useSearchParams + router.push (shallow)
// Debounce 300ms on search text changes
```

---

## 10) Localization and Languages

Aligned with `SPEC-026`.

### 10.1 Locale Resolution Order (per request)

1. `?locale=` query parameter
2. `X-Locale` header
3. `Accept-Language` header (first matching supported locale)
4. Store `defaultLocale`

### 10.2 Localized Fields

Applied via `applyTranslationOverlays()` from translations module:

| Entity | Localized fields |
|---|---|
| `CatalogProduct` | `title`, `subtitle`, `description` |
| `CatalogProductVariant` | `name` (if translated) |
| `CatalogProductCategory` | `name`, `description` |
| `EcommerceStore` (future) | Store-specific UI labels |

Fallback chain: `requested locale → store.defaultLocale → base entity field`

### 10.3 Response Locale Transparency

All storefront responses include:
```json
{
  "effectiveLocale": "pl",
  "requestedLocale": "pl",
  "supportedLocales": ["pl", "en", "de"]
}
```

---

## 11) Branding & Per-Store Theming

### 11.1 Architecture

The storefront applies per-store branding by injecting CSS custom properties into the root element at runtime. This requires no redeployment — configuration is served via `GET /api/ecommerce/storefront/context`.

### 11.2 Branding Token Mapping

`EcommerceStore.settings.branding` values map to CSS custom properties:

| Setting field | CSS variable | Default |
|---|---|---|
| `primaryColor` | `--primary` | `oklch(0.205 0 0)` |
| `primaryForeground` | `--primary-foreground` | `oklch(0.985 0 0)` |
| `accentColor` | `--accent` | `oklch(0.97 0 0)` |
| `accentForeground` | `--accent-foreground` | `oklch(0.205 0 0)` |
| `backgroundColor` | `--background` | `oklch(1 0 0)` |
| `foregroundColor` | `--foreground` | `oklch(0.145 0 0)` |
| `borderRadius` | `--radius` | `0.625rem` |
| `fontFamilyBase` | `--font-base` | `'Inter', sans-serif` |
| `fontFamilyHeading` | `--font-heading` | same as base |

### 11.3 Runtime Injection Pattern

```typescript
// apps/storefront/src/lib/applyStoreBranding.ts
export function applyStoreBranding(branding: EcommerceStoreSettings['branding']) {
  const root = document.documentElement
  if (branding.primaryColor) root.style.setProperty('--primary', branding.primaryColor)
  if (branding.accentColor) root.style.setProperty('--accent', branding.accentColor)
  if (branding.borderRadius) root.style.setProperty('--radius', branding.borderRadius)
  if (branding.fontFamilyBase) root.style.setProperty('--font-base', branding.fontFamilyBase)
  // ... etc
}

// Called in StoreContextProvider on initial data load
```

### 11.4 Server-Side Rendering

For SSR, branding tokens are embedded in `<style>` tag in `<head>` via `generateBrandingStyles(settings.branding)`:

```typescript
// Generates: :root { --primary: oklch(...); --radius: ...; ... }
```

This ensures no flash of unthemed content (FOUC) before hydration.

### 11.5 Admin UI for Branding

The store settings admin page (`backend/config/ecommerce/[id]/branding/page.tsx`) includes:
- Color pickers for primary, accent, background
- Font family dropdowns (system fonts + Google Fonts popular choices)
- Border radius slider
- Logo/favicon upload
- Live preview panel (renders a miniature storefront preview using store's current branding)

---

## 12) API Contracts

All routes export `openApi` and use Zod validation. Authentication: public endpoints `requireAuth: false`.

### 12.1 Public Storefront APIs

Base path: `/api/ecommerce/storefront`

#### `GET /api/ecommerce/storefront/context`

**Headers**: `Host`
**Query**: `storeSlug` (dev override), `locale`

**Response**:
```typescript
{
  store: {
    id: string
    code: string
    name: string
    slug: string
    status: 'active'
    defaultLocale: string
    supportedLocales: string[]
    defaultCurrencyCode: string
    settings: EcommerceStoreSettings
  }
  effectiveLocale: string
  requestedLocale: string
  supportedLocales: string[]
}
```

**Error**: `404` if no store found for host; `403` if store is `draft`/`archived`.

---

#### `GET /api/ecommerce/storefront/products`

**Query params**: see §9.4

**Response**:
```typescript
{
  items: StorefrontProductListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  effectiveLocale: string
  facets: StorefrontFacets
}
```

**Implementation notes**:
- Max `pageSize`: 100
- Default `pageSize`: 24
- Batch-load prices for all product IDs using `catalogPricingService.resolvePrice()`
- Pricing context: `{ channelId: binding.salesChannelId, priceKindId: binding.priceKindId, quantity: 1, date: now }`
- Product query uses `CatalogProduct` filtered by `organizationId + tenantId + deletedAt=null + isActive=true`
- Apply `catalogScope` from channel binding (categoryIds, tagIds exclusions)
- Facets computed via separate aggregation queries (see §9.3)
- Response cached with `stale-while-revalidate: 30` header

---

#### `GET /api/ecommerce/storefront/products/:idOrHandle`

**Params**: `idOrHandle` — UUID or `handle` string
**Query**: `locale`, `variantId` (pre-selected variant)

**Response**: `StorefrontProductDetail` (see §8.5)

**Implementation notes**:
- Load product with all variants
- Batch load all `CatalogProductPrice` for product + all variant IDs
- Resolve best price per variant using `selectBestPrice()` with channel context
- Load `optionSchema` from `CatalogOptionSchemaTemplate` if linked via `optionSchemaTemplate`
- Load media from `defaultMediaUrl` + related media records
- Load related products: same category, excluding current product, limit 8
- Apply translation overlays for all localized fields

---

#### `GET /api/ecommerce/storefront/categories`

**Query**: `locale`, `parentId` (optional), `depth` (max depth, default: unlimited), `includeEmpty` (default: false)

**Response**:
```typescript
{
  tree: Array<{
    id: string
    name: string              // localized
    slug: string | null
    description: string | null // localized
    depth: number
    parentId: string | null
    productCount: number
    hasChildren: boolean
    children: <recursive>[]
  }>
  effectiveLocale: string
}
```

**Implementation**: reuse `computeHierarchyForCategories()` from catalog lib. Filter by store's `catalogScope` if defined. Product counts from `CatalogProductCategoryAssignment` aggregation.

---

#### `GET /api/ecommerce/storefront/categories/:slug`

**Response**:
```typescript
{
  category: {
    id: string; name: string; slug: string | null; description: string | null
    depth: number; parentId: string | null; ancestorIds: string[]
    breadcrumb: Array<{ id: string; name: string; slug: string | null }>
    children: Array<{ id: string; name: string; slug: string | null; productCount: number }>
    productCount: number
    seo: { title: string | null; description: string | null }
  }
  products: {                // Same shape as product list response
    items: StorefrontProductListItem[]
    total: number; page: number; pageSize: number; totalPages: number
    facets: StorefrontFacets
  }
  effectiveLocale: string
}
```

---

#### Cart / Checkout Session APIs (Phase 3)

The session is both the cart and the checkout record. `status: 'open'` = cart. Advancing through checkout steps updates status and fields on the same entity.

```
POST   /api/ecommerce/storefront/checkout/sessions
       Header: Idempotency-Key: <client-uuid>
       Body: { currencyCode, locale, lines?: CartLine[] }
       → 201 Created (new session) or 200 OK (existing session for same key)

GET    /api/ecommerce/storefront/checkout/sessions/:id
       → Returns session with current version

PATCH  /api/ecommerce/storefront/checkout/sessions/:id
       Body: { version: N, lines?, email?, customerRef?, shippingAddress?, billingAddress? }
       → 200 OK with { session, version: N+1 }
       → 409 Conflict if version mismatch

POST   /api/ecommerce/storefront/checkout/sessions/:id/transition
       Body: { version: N, toStepId, data? }
       → Advances workflow step; returns { session, version: N+1, currentStep, availableTransitions }
       → 409 Conflict if version mismatch

POST   /api/ecommerce/storefront/checkout/sessions/:id/submit
       Body: { version: N }
       → status: 'submitted'; creates SalesOrder; returns { session, orderId }
       → Idempotent: if already submitted, returns existing orderId
```

See §19 for full checkout workflow specification.

### 12.2 Admin APIs (`requireAuth: true`)

All require `ecommerce.stores.manage` feature.

```
GET    /api/ecommerce/stores
POST   /api/ecommerce/stores
GET    /api/ecommerce/stores/:id
PUT    /api/ecommerce/stores/:id
DELETE /api/ecommerce/stores/:id

GET    /api/ecommerce/store-domains
POST   /api/ecommerce/store-domains
GET    /api/ecommerce/store-domains/:id
PUT    /api/ecommerce/store-domains/:id
DELETE /api/ecommerce/store-domains/:id

GET    /api/ecommerce/store-channel-bindings
POST   /api/ecommerce/store-channel-bindings
PUT    /api/ecommerce/store-channel-bindings/:id
DELETE /api/ecommerce/store-channel-bindings/:id
```

### 12.3 ACL Features (`acl.ts`)

```typescript
export const features = [
  { id: 'ecommerce.stores.view',        title: 'View stores' },
  { id: 'ecommerce.stores.manage',      title: 'Manage stores' },
  { id: 'ecommerce.storefront.view',    title: 'View storefront config' },
  { id: 'ecommerce.storefront.manage',  title: 'Manage storefront config' },
  { id: 'ecommerce.checkout.manage',    title: 'Manage checkout sessions' },
  { id: 'ecommerce.orders.view',        title: 'View orders from storefront' },
]
```

Default role features in `setup.ts`: `admin` gets all, `member` gets `view` features.

---

## 13) Module File Structure

```
packages/core/src/modules/ecommerce/
├── index.ts                            # Module metadata
├── acl.ts                              # Feature permissions
├── setup.ts                            # Tenant init, default role features
├── events.ts                           # Event declarations
├── i18n/
│   ├── en.json
│   └── pl.json
├── data/
│   ├── entities.ts                     # All ORM entities
│   └── validators.ts                   # Zod schemas
├── lib/
│   ├── storeContext.ts                 # resolveStoreFromRequest()
│   ├── storefrontProducts.ts           # Product list query + decoration
│   ├── storefrontDetail.ts             # PDP payload assembly
│   ├── storefrontCategories.ts         # Category tree + counts
│   ├── storefrontFacets.ts             # Facet aggregation queries
│   └── brandingStyles.ts               # generateBrandingStyles() for SSR
├── api/
│   ├── openapi.ts
│   ├── get/ecommerce/
│   │   ├── stores/route.ts
│   │   ├── store-domains/route.ts
│   │   └── store-channel-bindings/route.ts
│   ├── post/ecommerce/
│   │   ├── stores/route.ts
│   │   ├── store-domains/route.ts
│   │   └── store-channel-bindings/route.ts
│   ├── put/ecommerce/
│   │   ├── stores/[id]/route.ts
│   │   ├── store-domains/[id]/route.ts
│   │   └── store-channel-bindings/[id]/route.ts
│   ├── delete/ecommerce/
│   │   ├── stores/[id]/route.ts
│   │   ├── store-domains/[id]/route.ts
│   │   └── store-channel-bindings/[id]/route.ts
│   └── get/ecommerce/storefront/
│       ├── context/route.ts
│       ├── products/route.ts
│       ├── products/[idOrHandle]/route.ts
│       ├── categories/route.ts
│       └── categories/[slug]/route.ts
├── backend/
│   └── config/ecommerce/
│       ├── page.tsx                    # Store list
│       └── [id]/
│           ├── page.tsx                # Store detail
│           ├── domains/page.tsx        # Domain management
│           ├── channels/page.tsx       # Channel binding config
│           └── branding/page.tsx       # Branding editor with live preview
└── subscribers/
    └── store-cache-invalidation.ts     # Invalidate context cache on store change
```

---

## 14) Storefront App Architecture (`apps/storefront/`)

### 14.1 App Structure

```
apps/storefront/
├── package.json                        # @open-mercato/storefront
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # Root: StoreContextProvider + branding injection
│   │   ├── not-found.tsx
│   │   ├── error.tsx
│   │   ├── page.tsx                    # / → ProductListingPage
│   │   ├── products/
│   │   │   └── [handle]/
│   │   │       ├── page.tsx            # /products/:handle
│   │   │       └── not-found.tsx
│   │   ├── categories/
│   │   │   └── [slug]/
│   │   │       └── page.tsx            # /categories/:slug
│   │   └── search/
│   │       └── page.tsx                # /search?q=
│   ├── lib/
│   │   ├── api.ts                      # storefrontFetch() + error types
│   │   ├── storeContext.tsx            # React context + provider
│   │   ├── useStorefrontFilters.ts     # URL-synced filter state hook
│   │   ├── useVariantSelection.ts      # Variant resolution logic
│   │   ├── formatPrice.ts              # Currency formatting utilities
│   │   ├── applyStoreBranding.ts       # CSS variable injection
│   │   └── seo.ts                      # generateMetadata() helpers
│   └── components/
│       ├── layout/
│       │   ├── StorefrontLayout.tsx    # Header + main + footer wrapper
│       │   ├── StorefrontHeader.tsx    # Logo, nav, search trigger, locale
│       │   ├── StorefrontFooter.tsx    # Links, contact, legal
│       │   ├── MobileMenu.tsx          # Full-screen mobile navigation
│       │   └── SkipToContent.tsx       # WCAG: skip navigation link
│       ├── catalog/
│       │   ├── ProductCard.tsx         # Grid card: image, title, price, badges
│       │   ├── ProductGrid.tsx         # Responsive grid with view toggle
│       │   ├── ProductSkeleton.tsx     # Loading placeholder for ProductCard
│       │   ├── PriceDisplay.tsx        # Price with promo strikethrough
│       │   ├── AvailabilityBadge.tsx   # In stock / Out of stock / Backorder
│       │   ├── BadgeList.tsx           # Product badges (new, sale, etc.)
│       │   └── ProductTypeIcon.tsx     # Icon for product type
│       ├── pdp/
│       │   ├── ProductDetail.tsx       # PDP root: image + info columns
│       │   ├── ImageGallery.tsx        # Main image + thumbnails, zoom on hover
│       │   ├── VariantSelector.tsx     # Option groups → deterministic variant
│       │   ├── OptionGroup.tsx         # Single option (color swatches / chips / text)
│       │   ├── VariantPrice.tsx        # Price that updates on variant change
│       │   ├── VariantAvailability.tsx # Availability indicator per variant
│       │   ├── ProductSpecs.tsx        # Dimensions, weight, SKU table
│       │   └── RelatedProducts.tsx     # Horizontal scrolling product row
│       ├── filters/
│       │   ├── FilterSidebar.tsx       # Desktop sidebar filter panel
│       │   ├── FilterSheet.tsx         # Mobile slide-over filter panel
│       │   ├── CategoryFilter.tsx      # Hierarchical category tree checkboxes
│       │   ├── PriceRangeFilter.tsx    # Dual-handle range slider
│       │   ├── TagFilter.tsx           # Tag pill toggles
│       │   ├── OptionFilter.tsx        # Dynamic option value checkboxes
│       │   ├── AvailabilityFilter.tsx  # Stock status radio group
│       │   └── FilterChips.tsx         # Active filter summary chips
│       ├── navigation/
│       │   ├── Breadcrumbs.tsx         # ARIA breadcrumb nav
│       │   ├── CategoryNav.tsx         # Top-level category navigation
│       │   ├── Pagination.tsx          # Page controls with ARIA
│       │   └── SortSelect.tsx          # Sort dropdown
│       └── search/
│           ├── SearchDialog.tsx        # Full-screen search overlay
│           └── SearchBar.tsx           # Inline search input with debounce
```

### 14.2 Dependencies

```json
{
  "dependencies": {
    "next": "15.x",
    "react": "19.x",
    "react-dom": "19.x",
    "tailwindcss": "4.x",
    "lucide-react": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest"
  },
  "devDependencies": {
    "typescript": "5.x",
    "@types/react": "19.x",
    "@types/node": "latest"
  }
}
```

**MUST NOT** depend on `@open-mercato/core`, `@open-mercato/ui`, or `@open-mercato/shared`. Pure API consumer.

Primitive components (Button, Badge, Spinner, etc.) are re-implemented minimally in the storefront app following the same design token conventions — they share CSS variables but not code.

### 14.3 API Client

```typescript
// src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_STOREFRONT_API_URL ?? ''

export class StorefrontApiError extends Error {
  constructor(public status: number, public body: string, public code?: string) {
    super(`Storefront API error ${status}: ${body}`)
  }
}

export class StorefrontVersionConflictError extends StorefrontApiError {
  constructor(public currentVersion: number) {
    super(409, 'version_mismatch')
  }
}

export async function storefrontFetch<T>(
  path: string,
  opts?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    params?: Record<string, string | string[] | number | null | undefined>
    body?: unknown
    locale?: string
    host?: string
    idempotencyKey?: string
    revalidate?: number
    tags?: string[]
  }
): Promise<T> {
  const url = new URL(`${API_BASE}/api/ecommerce/storefront${path}`)
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v == null) continue
      if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item))
      else url.searchParams.set(k, String(v))
    }
  }
  const headers: Record<string, string> = {}
  if (opts?.locale) headers['X-Locale'] = opts.locale
  if (opts?.host) headers['Host'] = opts.host
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  if (opts?.body) headers['Content-Type'] = 'application/json'

  const res = await fetch(url.toString(), {
    method: opts?.method ?? 'GET',
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    next: {
      revalidate: opts?.revalidate ?? 30,
      tags: opts?.tags,
    },
  })

  if (res.status === 409) {
    const json = await res.json().catch(() => ({}))
    throw new StorefrontVersionConflictError(json.currentVersion)
  }
  if (!res.ok) throw new StorefrontApiError(res.status, await res.text())
  return res.json() as Promise<T>
}
```

---

## 15) Component Specifications

### 15.1 VariantSelector

**Purpose**: Render option groups from `optionSchema`, track user selections, resolve to variant.

```typescript
// components/pdp/VariantSelector.tsx
type VariantSelectorProps = {
  optionSchema: CatalogProductOptionSchema
  variants: StorefrontProductDetail['variants']
  initialVariantId?: string | null
  onChange: (result: VariantResolutionResult) => void
}
```

**Behavior**:
- Renders one `OptionGroup` per `optionSchema.options` entry
- `select` inputType with ≤8 choices → color swatches or chip buttons
- `select` inputType with >8 choices → native `<select>` with `size` label
- `text` → `<input type="text">`
- `number` → `<input type="number">`
- Unavailable combinations shown as disabled chips (not hidden — WCAG §1.4.1)
- Selecting any option re-evaluates available choices across all other dimensions
- When all required options selected → fires `onChange` with resolved variant

**WCAG 2.2 Requirements**:
- Each chip button: `role="radio"` with `aria-checked`, grouped with `role="radiogroup"` and `aria-labelledby`
- Disabled chips: `aria-disabled="true"` + visual strikethrough (not just color)
- Keyboard: `Arrow` keys navigate chips within group, `Space`/`Enter` selects
- Color swatches: `aria-label` includes color name (not just swatch visual)

### 15.2 ProductGrid

```typescript
type ProductGridProps = {
  products: StorefrontProductListItem[]
  isLoading: boolean
  viewMode: 'grid' | 'list'
  columns?: { sm: 2 | 3; md: 3 | 4; lg: 4 | 5 }
}
```

**Behavior**:
- Grid: responsive CSS grid, `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4`
- List: single-column with horizontal product cards
- Loading state: renders `ProductSkeleton` cards (12 by default)
- Empty state: `EmptyState` component with illustration and CTA

### 15.3 ProductCard

```typescript
type ProductCardProps = {
  product: StorefrontProductListItem
  priority?: boolean          // true for above-fold images (LCP optimization)
}
```

**Design** (minimalist):
```
┌──────────────────────┐
│                      │
│    product image     │  ← aspect-square, rounded-xl, object-cover
│    (hover zoom)      │    hover: scale-[1.03], transition-transform 300ms
│                      │
└──────────────────────┘
  AvailabilityBadge  BadgeList
  title              ← text-sm font-medium line-clamp-2
  subtitle           ← text-xs text-muted-foreground line-clamp-1
  PriceDisplay       ← text-base font-semibold
```

**WCAG 2.2 Requirements**:
- Entire card is one `<a>` link (no nested interactive elements)
- Image: `alt` attribute from product title
- Focus ring: `focus-visible:ring-2 focus-visible:ring-primary`
- Color contrast: price text ≥ 4.5:1 against background

### 15.4 PriceDisplay

```typescript
type PriceDisplayProps = {
  price: { formattedPrice: string; formattedOriginalPrice?: string | null; isPromotion: boolean }
  size?: 'sm' | 'md' | 'lg'
  showTaxLabel?: boolean
}
```

**Design**:
- Normal: `129,00 zł`
- Promotion: ~~`199,00 zł`~~ `129,00 zł` (original struck through, promo in accent color)
- Tax label: `incl. VAT` / `excl. VAT` in muted small text below

**WCAG**: `<del>` with `aria-label="Original price: 199,00 zł"` + `<ins>` with `aria-label="Sale price: 129,00 zł"`.

### 15.5 FilterSidebar / FilterSheet

**Desktop**: Sticky sidebar, `w-64`, `border-r`, filter sections collapsible (`<details>` or accordion).
**Mobile**: `<Sheet>` slide-over from left, triggered by filter button. Closes on apply.

**CategoryFilter**: Tree display with indentation for depth, checkbox per node, expand/collapse for subtrees.

**PriceRangeFilter**: Two `<input type="number">` fields + visual range track. Debounce 500ms before firing. Validates min ≤ max.

**TagFilter**: Pill buttons, `role="checkbox"`, `aria-checked`, sorted by count desc.

**OptionFilter**: Generated from `facets.options`. Header = option label, items = value chips with count.

**FilterChips**: Row of removable chips showing active filters. Each chip has `<button aria-label="Remove filter: Color Red">` with `×` icon.

### 15.6 ImageGallery

```typescript
type ImageGalleryProps = {
  images: Array<{ id: string; url: string; alt: string | null }>
  productTitle: string
}
```

**Design**:
- Large main image (`aspect-square` or `aspect-[4/3]` configurable)
- Thumbnail strip below (horizontal scroll on mobile)
- Selected thumbnail highlighted with `ring-2 ring-primary`
- Click thumbnail → swap main image with crossfade animation
- Keyboard: `←`/`→` arrows navigate thumbnails
- Touch: swipe on mobile main image navigates thumbnails

**WCAG**: Main image `alt` from media record or product title. Thumbnails: `aria-label="View image N of M"`. Current: `aria-current="true"`.

### 15.7 Breadcrumbs

```html
<nav aria-label="Breadcrumb">
  <ol itemscope itemtype="https://schema.org/BreadcrumbList">
    <li><a href="/">Home</a></li>
    <li aria-hidden="true">/</li>
    <li><a href="/categories/clothing">Clothing</a></li>
    <li aria-hidden="true">/</li>
    <li aria-current="page">Red Dress</li>
  </ol>
</nav>
```

Schema.org `BreadcrumbList` markup for SEO.

### 15.8 Pagination

```typescript
type PaginationProps = {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}
```

**WCAG**:
- `<nav aria-label="Pagination">`
- Current page: `aria-current="page"`
- Prev/next: `aria-label="Previous page"` / `aria-label="Next page"`
- Disabled: `aria-disabled="true"` (not just visually disabled)

### 15.9 SearchDialog

- Opens on search icon click or `Cmd/Ctrl+K` keyboard shortcut
- Fullscreen overlay on mobile, centered modal (max-w-2xl) on desktop
- Input auto-focused on open, `role="combobox"` with `aria-expanded`
- Results list: `role="listbox"`, each item `role="option"`, keyboard navigable
- `Escape` closes; focus returns to trigger element
- Debounce 300ms; minimum 2 characters to trigger search
- Loading state during fetch

---

## 16) Design System & Visual Language

### 16.1 Design Aesthetic

**Target**: Minimalist enterprise — clean whitespace, sharp typography, subtle interactions. Reference: Apple Store, Vercel, Linear.

### 16.2 Typography Scale

| Usage | Class | Notes |
|---|---|---|
| Page title | `text-4xl font-light tracking-tight` | Product name on PDP |
| Section heading | `text-2xl font-semibold` | Category names |
| Card title | `text-sm font-medium` | Product card |
| Body | `text-base` | Descriptions |
| Meta / label | `text-xs text-muted-foreground` | SKU, availability |
| Price | `text-lg font-semibold` | Key conversion element |

### 16.3 Spacing System

- Container: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`
- Section gap: `py-12 sm:py-16`
- Card gap: `gap-4 sm:gap-6`
- Filter sidebar: `w-64 pr-8`

### 16.4 Color Usage

- `--primary`: CTAs, active states, focus rings, selected chips
- `--accent`: Promotional prices, badges, highlights
- `--muted`: Disabled, secondary text, filter backgrounds
- `--background` + `--foreground`: Base surface
- `--border/50`: Subtle dividers (not heavy cards)

### 16.5 Elevation & Shadow

- Cards: no shadow by default; `hover:shadow-sm transition-shadow` on hover
- Modals / Sheet: `shadow-xl`
- Sticky header: `shadow-sm` on scroll

### 16.6 Motion

- Image hover: `transition-transform duration-300 ease-out hover:scale-[1.03]`
- Filter appearance: `transition-all duration-200`
- Page navigation: No full-page transitions; use loading skeletons
- Respect `prefers-reduced-motion`: all transitions wrapped with `@media (prefers-reduced-motion: reduce) { transition: none }`

---

## 17) Responsive Web Design

### 17.1 Breakpoints (Tailwind defaults)

| Breakpoint | Width | Usage |
|---|---|---|
| default (mobile) | <640px | Single column layout |
| `sm:` | 640px+ | 2-column product grid |
| `md:` | 768px+ | Sidebar visible, 3-column grid |
| `lg:` | 1024px+ | 4-column grid, expanded header |
| `xl:` | 1280px+ | Max container width reached |

### 17.2 Mobile-First Patterns

**Product Listing Page**:
```
Mobile:  [Filter Button] [Sort] → full-width grid
         Filters in slide-over Sheet
         2-column product grid

Tablet:  Sidebar + 3-column grid (md:)

Desktop: Sidebar + 4-column grid (lg:)
```

**PDP**:
```
Mobile:  Image gallery (full width)
         Product info below (stacked)

Desktop: Image gallery (left 55%) | Product info (right 45%)
         Sticky "Add to cart" on scroll (Phase 3)
```

**Navigation**:
```
Mobile:  Hamburger → full-screen menu overlay
Desktop: Horizontal category nav in header
```

### 17.3 Touch Targets

All interactive elements: minimum `44px × 44px` tap target (WCAG 2.2 SC 2.5.8).
Applied via: `min-h-[44px] min-w-[44px]` or padding compensation.

---

## 18) Accessibility — WCAG 2.2 AA Compliance

### 18.1 Required Implementation

| Criterion | SC | Implementation |
|---|---|---|
| Non-text Content | 1.1.1 | `alt` on all images, `aria-label` on icon buttons |
| Color not sole differentiator | 1.4.1 | Disabled options: strikethrough + color; promo: label + color |
| Contrast (minimum) | 1.4.3 | Text ≥ 4.5:1, large text ≥ 3:1 against background |
| Reflow | 1.4.10 | Single-column layout at 320px CSS width; no horizontal scroll |
| Text Spacing | 1.4.12 | No fixed heights that clip text on font scaling |
| Keyboard | 2.1.1 | All interactive elements reachable via Tab |
| No Keyboard Trap | 2.1.2 | Modal: focus trapped inside; Escape releases |
| Focus Order | 2.4.3 | Logical DOM order matches visual order |
| Focus Visible | 2.4.7 | `focus-visible:ring-2` on all interactive elements |
| Focus Appearance | 2.4.11 | Focus indicator area ≥ perimeter × 1px; not obscured |
| Target Size | 2.5.8 | All targets ≥ 24×24px; most ≥ 44×44px |
| Language of Page | 3.1.1 | `<html lang={effectiveLocale}>` |
| On Focus | 3.2.1 | No context change on focus |
| Error Identification | 3.3.1 | Filter errors communicated via `aria-live` region |
| Labels or Instructions | 3.3.2 | All form inputs have visible labels |
| Status Messages | 4.1.3 | Filter count updates via `aria-live="polite"` |

### 18.2 ARIA Landmark Regions

```html
<header role="banner">          <!-- StorefrontHeader -->
<nav aria-label="Main navigation">
<nav aria-label="Breadcrumb">
<main id="main-content">        <!-- linked from SkipToContent -->
<aside aria-label="Product filters">
<nav aria-label="Pagination">
<footer role="contentinfo">
```

### 18.3 Skip Navigation

```tsx
// components/layout/SkipToContent.tsx
<a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4
   focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded">
  Skip to main content
</a>
```

### 18.4 Live Regions

```html
<!-- Filter result count update -->
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {total} products found
</div>

<!-- Loading state announcements -->
<div role="status" aria-live="polite">
  {isLoading ? 'Loading products...' : ''}
</div>
```

### 18.5 Keyboard Navigation Map

| Element | Keys |
|---|---|
| Search dialog trigger | `Cmd/Ctrl+K` |
| Search dialog | `Escape` to close, `↑↓` navigate results, `Enter` select |
| Product grid | `Tab` to navigate cards |
| Filter checkboxes | `Space` toggle, `Tab` move to next |
| Price range | `←→` on range input, `Tab` between inputs |
| Variant selector chips | `←→` navigate within group, `Space`/`Enter` select |
| Image gallery | `←→` navigate images |
| Pagination | `Tab` navigate, `Enter` activate |

---

## 19) Checkout Workflow Integration (Phase 3)

### 19.1 Approach

Checkout is implemented as a **workflow instance** using the `workflows` module. The checkout UI is a state machine frontend — the current step and available transitions are determined by the backend workflow state, not by hardcoded frontend routing.

### 19.2 Why Workflows

- Audit trail of every checkout action (event sourcing)
- Configurable checkout flows per store (multi-step vs. express)
- Async activity support (payment processing, inventory hold, email confirmations)
- Compensation (saga pattern) if order creation fails after payment
- Compatible with AI agent assistance for checkout completion

### 19.3 Checkout Workflow Definition

A default workflow `checkout_storefront_v1` is seeded at tenant creation via `setup.ts`:

```
Steps:
  cart_review (USER_TASK)
    → customer_info (USER_TASK)         [trigger: manual]
    → guest_checkout (USER_TASK)        [trigger: manual, condition: no customer]

  customer_info / guest_checkout
    → shipping_address (USER_TASK)      [trigger: manual]

  shipping_address
    → shipping_method (USER_TASK)       [trigger: manual]

  shipping_method
    → payment (USER_TASK)               [trigger: manual]

  payment
    → order_create (AUTOMATED)          [trigger: auto, activities: CREATE_ORDER, SEND_CONFIRMATION]

  order_create
    → end                               [trigger: auto]

Compensation:
  order_create compensation: CANCEL_ORDER (if payment capture fails)
```

### 19.4 Frontend Checkout Pattern

```typescript
// Cart/session creation — idempotency key generated once per cart lifecycle
// Stored in sessionStorage so retries reuse same key
const idempotencyKey = sessionStorage.getItem('cart-idempotency-key')
  ?? (() => {
    const key = crypto.randomUUID()
    sessionStorage.setItem('cart-idempotency-key', key)
    return key
  })()

const session = await storefrontFetch('/checkout/sessions', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: { currencyCode, locale, lines: cartLines }
})
// Returns: { id, version: 1, status: 'open', workflowInstanceId, currentStep, availableTransitions }
// Store session.version in state — required for all subsequent mutations

// Mutation (add/remove lines, update address) — always pass current version
await storefrontFetch(`/checkout/sessions/${session.id}`, {
  method: 'PATCH',
  body: { version: currentVersion, lines: updatedLines }
})
// → { session, version: currentVersion + 1 }  → update stored version

// Polling while workflow is active
const poll = useQuery({
  queryKey: ['checkout-session', session.id],
  queryFn: () => storefrontFetch(`/checkout/sessions/${session.id}`),
  refetchInterval: (q) => {
    const wfStatus = q.state.data?.workflowStatus
    return (wfStatus === 'RUNNING' || wfStatus === 'WAITING_FOR_ACTIVITIES') ? 1000 : false
  }
})

// Transition (advancing checkout step) — version required
await storefrontFetch(`/checkout/sessions/${session.id}/transition`, {
  method: 'POST',
  body: { version: currentVersion, toStepId: 'shipping_address', data: { email, firstName, lastName } }
})

// Submit (cart → order) — idempotent: re-submit returns same orderId
await storefrontFetch(`/checkout/sessions/${session.id}/submit`, {
  method: 'POST',
  body: { version: currentVersion }
})
// On success: clear sessionStorage idempotency key
sessionStorage.removeItem('cart-idempotency-key')
```

### 19.5 Note on Documentation

The workflow module author is preparing comprehensive documentation on workflow creation and frontend integration patterns. **Phase 3 implementation MUST wait for that documentation** and incorporate feedback from that first integration attempt. The data model (`EcommerceCheckoutSession`) and API contracts are defined here as a forward reference.

---

## 20) Admin UI (Backoffice)

### 20.1 Store List Page

`backend/config/ecommerce/page.tsx`

- DataTable with columns: Name, Code, Status, Domains, Primary, Created
- Row actions: Edit, Manage Domains, Manage Channels, Archive
- Create button → modal form or dedicated create page
- Status filter (draft/active/archived)

### 20.2 Store Edit Page

`backend/config/ecommerce/[id]/page.tsx`

Tabs:
1. **General** — name, slug, code, status, locale, currency
2. **Branding** — color pickers, font selectors, logo upload, live preview
3. **Domains** — domain list, add/verify, set primary
4. **Channels** — channel binding, price kind override, catalog scope
5. **SEO** — default meta, robots config

### 20.3 Branding Live Preview

The branding editor tab renders an iframe containing a miniature storefront preview component. When color/font values change, the preview updates in real-time via postMessage injection of new CSS variables — no save required to preview.

---

## 21) Search Integration

### 21.1 Phase 1 (Text Search)

`ILIKE` on `title`, `subtitle`, `description`, `sku`, `handle` — case-insensitive, escaped.
Applied via the same intersection filter pattern used in catalog API.

### 21.2 Phase 2 (Full-Text / Vector Search)

Integrate `@open-mercato/search` module. Define `ecommerce/search.ts`:

```typescript
export const searchConfig: SearchModuleConfig = {
  // Reuse catalog product index
  // ecommerce-specific: filtered by store channel scope
}
```

Search results filtered to store's catalog scope before ranking.

### 21.3 Search Response Consistency

Regardless of backend strategy (ILIKE vs. fulltext), response shape is identical. Frontend never needs to know which backend is active.

---

## 22) Security

- Context resolver maps Host → single `tenantId + organizationId` — cross-tenant exposure is impossible by design
- Public endpoints filter all queries by resolved `tenantId + organizationId`
- `deletedAt=null + status=active` always enforced on storefront product queries
- Rate limiting: public search and checkout mutation endpoints — 60 req/min per IP
- Checkout sessions: 24-hour TTL via `expiresAt`; expired sessions return 410 Gone
- Idempotency keys scoped per store — cannot be used across stores
- Version field enforced at DB level via conditional UPDATE (`WHERE version = $expected`); atomic increment prevents race conditions
- Store domain uniqueness: globally enforced at DB level (unique index on `host`)
- Checkout session IDs are UUIDs — not predictable; no sequential enumeration
- Payment operations never touch sensitive card data — delegated to payment provider

---

## 23) Caching Strategy

| Data | Cache TTL | Invalidation |
|---|---|---|
| Store context | 5 min | On `EcommerceStore` update (subscriber) |
| Product list + facets | 30s | On `CatalogProduct` update (subscriber) |
| Product detail | 60s | On product/variant update (subscriber) |
| Category tree | 5 min | On `CatalogProductCategory` update |
| Storefront app pages | `revalidate: 30` | Next.js ISR |

For full-page caching in the storefront app: use Next.js `fetch` with `{ next: { revalidate: 30, tags: ['products'] } }`. Cache tags invalidated via revalidation endpoint on relevant events.

---

## 24) Performance Targets

| Metric | Target | Notes |
|---|---|---|
| TTFB (cached) | < 100ms | Store context + product list |
| LCP | < 2.5s | First product image (above fold) |
| CLS | < 0.1 | Reserve aspect ratios on image containers |
| Product list API P95 | < 300ms | Including facet computation |
| Product detail API P95 | < 200ms | With pricing resolution |
| Facet recomputation | < 500ms | Cross-facet exclusion queries |

### Performance Implementation Notes

- Product list images: `priority` prop on first 4 cards (above-fold LCP)
- Image aspect ratios: always reserve with `aspect-square` or explicit `width`/`height`
- Facet queries: run in parallel (Promise.all), not sequentially
- Pricing: batch load all prices for page of products, resolve in memory
- Category tree: precomputed hierarchy (not recursive DB query)
- Store context: cached at app boot, refreshed on stale (SWR pattern)

---

## 25) Integration Tests

Per `AGENTS.md`: integration tests defined in spec MUST be implemented in the same change.

### 25.1 Core Module Tests (`packages/core/src/modules/ecommerce/`)

```
TC-EC-001: Create store → store created with isPrimary=true
TC-EC-002: Add domain to store → domain resolves store via host
TC-EC-003: resolveStoreFromRequest(host) → returns correct tenantId + orgId
TC-EC-004: GET /storefront/context (Host: firda.pl) → returns store config
TC-EC-005: GET /storefront/context (unknown host) → 404
TC-EC-006: GET /storefront/products → returns products with pricing
TC-EC-007: GET /storefront/products?categoryId=X → filtered results
TC-EC-008: GET /storefront/products?search=dress → search results
TC-EC-009: GET /storefront/products returns facets.categories with counts
TC-EC-010: GET /storefront/products/:handle → full PDP payload
TC-EC-011: PDP payload includes all variants with pricing
TC-EC-012: GET /storefront/products/:handle (nonexistent) → 404
TC-EC-013: GET /storefront/categories → tree with product counts
TC-EC-014: GET /storefront/categories/:slug → category + product list
TC-EC-015: Locale overlay: GET /storefront/products?locale=pl → Polish titles
TC-EC-016: Channel binding: prices resolved via binding.salesChannelId
TC-EC-017: Catalog scope: products filtered by binding.catalogScope.categoryIds
TC-EC-018: Store status=draft → GET /storefront/context returns 403
TC-EC-019: Cross-tenant isolation: products from org A not visible via store for org B
TC-EC-020: Price range filter: ?priceMin=50&priceMax=100 returns correct subset
```

### 25.2 Storefront App Tests (Playwright)

```
TC-SF-001: / loads product grid with products
TC-SF-002: Product card click → navigates to PDP
TC-SF-003: PDP displays variant selector for configurable product
TC-SF-004: Selecting all variant options → price updates
TC-SF-005: Filter by category → URL updated, products filtered
TC-SF-006: Filter chip removal → filter cleared, results reset
TC-SF-007: Search input → products filtered in real time
TC-SF-008: Pagination → navigates to page 2
TC-SF-009: Mobile viewport → filter sheet opens on button click
TC-SF-010: Keyboard navigation: Tab through product grid cards
TC-SF-011: Keyboard: Enter on product card navigates to PDP
TC-SF-012: SearchDialog: Cmd+K opens, Escape closes
TC-SF-013: Breadcrumbs present on PDP with correct links
TC-SF-014: Skip to content link visible on first Tab press
```

---

## 26) Implementation Phases

### Phase 1: Foundation (Sprint 1)

1. Module scaffold: `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `i18n/`
2. Entities: `EcommerceStore`, `EcommerceStoreDomain`, `EcommerceStoreChannelBinding`
3. Validators (`data/validators.ts`) — Zod schemas for all entities
4. Run `yarn db:generate` → migration files
5. Admin CRUD APIs (stores, domains, channel bindings)
6. Store context resolver (`lib/storeContext.ts`)
7. Run `npm run modules:prepare`
8. TC-EC-001 through TC-EC-005

### Phase 2: Public Catalog APIs (Sprint 2)

9. `lib/storefrontProducts.ts` — product query + decoration + pricing batch
10. `lib/storefrontFacets.ts` — facet aggregation with cross-facet exclusion
11. `lib/storefrontCategories.ts` — category tree + counts
12. `lib/storefrontDetail.ts` — PDP payload assembly
13. All 5 public GET endpoints with OpenAPI
14. Locale overlay integration (SPEC-026 `applyTranslationOverlays`)
15. TC-EC-006 through TC-EC-020

### Phase 3: Checkout Session + Workflow (Sprint 3)

> **Prerequisite**: Workflow module documentation published.

16. `EcommerceCheckoutSession` entity + migration
17. Checkout workflow definition seeded via `setup.ts`
18. Checkout session APIs (create, patch, transition, get, submit)
19. Integration with `sales` for order creation

### Phase 4: Storefront App (Sprint 4)

20. Scaffold `apps/storefront/` — Next.js + Tailwind
21. `lib/` utilities (api.ts, storeContext.tsx, useStorefrontFilters.ts, etc.)
22. Layout components (StorefrontLayout, StorefrontHeader, MobileMenu, SkipToContent)
23. Catalog components (ProductCard, ProductGrid, PriceDisplay, etc.)
24. PDP components (VariantSelector, ImageGallery, ProductSpecs, etc.)
25. Filter components (FilterSidebar, FilterSheet, CategoryFilter, PriceRangeFilter, etc.)
26. Navigation components (Breadcrumbs, Pagination, SortSelect)
27. SearchDialog
28. Home page, PDP page, Category page, Search page
29. Branding CSS injection + SSR
30. TC-SF-001 through TC-SF-014

### Phase 5: Hardening (Sprint 5)

31. Rate limiting on public endpoints
32. WCAG 2.2 audit (axe-playwright or similar)
33. Performance profiling: TTFB, LCP, CLS benchmarks
34. Security review: cross-tenant isolation, rate limit bypass
35. Integration test coverage for all TC-EC-* and TC-SF-* cases

---

## 27) Key Files to Reference

| File | Purpose |
|---|---|
| `packages/core/src/modules/catalog/data/entities.ts` | CatalogProduct, CatalogProductVariant, CatalogProductCategory, CatalogProductPrice, CatalogOffer entities |
| `packages/core/src/modules/catalog/data/types.ts` | `CatalogProductOptionSchema`, `CatalogProductOptionDefinition`, `CatalogPriceDisplayMode` |
| `packages/core/src/modules/catalog/lib/pricing.ts` | `selectBestPrice()`, `resolveCatalogPrice()`, `PricingContext`, scoring algorithm |
| `packages/core/src/modules/catalog/lib/categoryHierarchy.ts` | `computeHierarchyForCategories()`, `ComputedCategoryNode` |
| `packages/core/src/modules/catalog/api/products/route.ts` | `buildProductFilters()`, `decorateProductsAfterList()`, `buildPricingContext()` |
| `packages/core/src/modules/catalog/api/categories/route.ts` | Category query building, `view=tree` mode |
| `packages/core/src/modules/workflows/data/entities.ts` | `WorkflowInstance`, `WorkflowStep`, `UserTask`, `WorkflowEvent` |
| `packages/core/src/modules/workflows/lib/workflow-executor.ts` | `startWorkflow()`, `executeWorkflow()` |
| `packages/core/src/modules/customers/AGENTS.md` | CRUD module pattern reference |
| `packages/core/AGENTS.md` | Module development guide |
| `packages/ui/src/primitives/` | Button, Card, Badge, Dialog, Input, Spinner, Tabs, Checkbox, Sheet, Tooltip |
| `packages/ui/src/frontend/Layout.tsx` | `FrontendLayout` component |
| `apps/mercato/src/app/globals.css` | CSS variables (OKLCH color system, radius, animation) |
| `packages/ui/src/theme/ThemeProvider.tsx` | Theme system (light/dark/system) |

---

## 28) Open Questions

1. **Customer account model**: Reuse `auth` module for storefront customer login or introduce separate customer identity? (Phase 3 decision point)
2. **Payment providers**: Which payment gateway for Phase 3 MVP? (Stripe / PayU / other)
3. **Inventory policy**: Should stock availability be checked at browse time or only at checkout? (Phase 2 vs Phase 3)
4. **Checkout workflow docs**: Timeline for workflow module documentation that unblocks Phase 3
5. **Search backend**: Use ILIKE only for launch, or invest in `@open-mercato/search` fulltext indexing from Phase 2?
6. **Multi-store on same org**: Should Phase 1 support multiple active stores per org, or start with `isPrimary=true` enforced?
7. **SEO sitemap**: Auto-generated sitemap.xml for products/categories — Phase 4 or Phase 5?

---

## 29) Migration Path

- Existing deployments: enable module progressively (no breaking change to existing admin/product APIs)
- Bootstrap: one-time script creates default store from existing org metadata (name, locale, currency)
- The storefront app is completely optional — existing admin UI unaffected

---

## 30) Changelog

### 2026-02-18

- **v3**: Incorporated reviewer feedback on idempotency and cart/checkout model simplification
  - Clarified `EcommerceCheckoutSession` is also the cart (`status: 'open'` = cart state; no separate cart entity)
  - Added `version` column (integer, monotonically incrementing) for optimistic locking on all cart mutations
  - Added `idempotency_key` column; `POST /checkout/sessions` accepts `Idempotency-Key` header — duplicate keys return existing session (200) instead of creating duplicate (§7.5.1)
  - Added `StorefrontVersionConflictError` (409) handling in API client for version mismatch recovery
  - Added `§7.5 Idempotency Strategy` section covering three layers: creation key, version locking, workflow transition idempotency
  - Updated checkout API contracts (§12.1) to show `Idempotency-Key` header and `version` field requirements
  - Updated frontend checkout pattern (§19.4) with idempotency key lifecycle (`sessionStorage`, clear on submit) and version threading
  - Added DB-level conditional UPDATE note in security section
  - Updated `storefrontFetch()` client to support `method`, `body`, `idempotencyKey` options and typed 409 error

### 2026-02-17

- **v2** (this revision): Expanded from initial high-level spec to full engineering specification
  - Added detailed `EcommerceStore.settings` JSONB schema with branding, contact, features, SEO
  - Added per-store CSS variable theming system with SSR FOUC prevention
  - Added full `StorefrontProductListItem` and `StorefrontProductDetail` type definitions
  - Added full `StorefrontFacets` type with cross-facet exclusion algorithm
  - Documented filter query parameter schema and URL state synchronization hook
  - Added `useVariantSelection` hook and `resolveVariant()` algorithm with unavailable choice computation
  - Added detailed component specifications: VariantSelector, ProductCard, PriceDisplay, FilterSidebar, ImageGallery, Breadcrumbs, Pagination, SearchDialog
  - Added WCAG 2.2 AA compliance checklist with per-component requirements and ARIA patterns
  - Added RWD section with per-breakpoint layout specifications and touch target requirements
  - Added design system section (typography, spacing, color usage, motion, elevation)
  - Added detailed checkout workflow integration plan (Phase 3) referencing `workflows` module architecture
  - Added caching strategy table with TTLs and invalidation triggers
  - Added performance targets (TTFB, LCP, CLS, API P95)
  - Added 34 integration test cases (TC-EC-001..020, TC-SF-001..014)
  - Added full `apps/storefront/` component tree with all ~30 component files
  - Added admin UI section (store list, store edit, branding preview)
  - Clarified checkout Phase 3 dependency on workflow module documentation

- **v1** (initial): Base architecture, entity definitions, API contract outline, 5-phase plan
