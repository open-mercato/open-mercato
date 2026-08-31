# Storefront Public API

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 2 — cache-split fix) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 4, Phase 1 |
| **Modules** | `ecommerce` (public read surface) |
| **Depends on** | [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md), [Availability Contract](./2026-08-14-availability-contract.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md) |
| **Related** | [SPEC-026 Catalog Localization](./implemented/SPEC-026-2026-02-11-catalog-localization.md), [SPEC-033 Omnibus](./SPEC-033-2026-02-18-omnibus-price-tracking.md), [SPEC-071 SEO Helper](./SPEC-071-2026-04-06-seo-helper-validation-visibility.md) |

---

## TLDR

**Key Points:**
- The public read surface of the `ecommerce` module: product listing with facets, product detail, category tree, category landing, and search. Five endpoints, all `GET`, all served under a resolved `StoreContext`.
- These endpoints are **not anonymous**. An authenticated B2B buyer gets different prices, a different tax display mode and a narrower assortment from the same URL. Every response is keyed and cached on the buyer-context digest, or it leaks contract pricing.
- Almost nothing here is new logic. `catalog` already exports `buildProductFilters`, `buildPricingContext`, `selectBestPrice`, `scoreProductSearchRelevance` and `computeHierarchyForCategories`; `translations` exports the overlay batch helpers; `availability` supplies stock state. This spec is a **public projection** over existing internals, and its main job is to not fork them.
- Cross-facet exclusion — the rule that a facet's counts ignore that facet's own filter — is the expensive part: one aggregation per facet dimension per request.

**Scope:**
- `GET /products`, `/products/:idOrHandle`, `/categories`, `/categories/:slug`, `/search/suggest`
- `StorefrontProductListItem`, `StorefrontProductDetail`, `StorefrontFacets` payload contracts
- Filter query grammar, sorting, pagination
- Locale resolution and translation overlays
- Search: `ILIKE` phase and `@open-mercato/search` phase behind one response shape
- Caching, rate limiting, performance budgets

**Concerns:**
- Facet aggregation with cross-exclusion is 5–7 queries per listing request; under B2B contract pricing it cannot be shared across buyers, so the cache hit rate falls exactly where the cost is highest
- Price-range faceting and price sorting require resolved prices, which are buyer-dependent — sorting by price cannot be pushed entirely into SQL without materializing per-context prices
- Handle-based lookup must not become an enumeration oracle for draft or out-of-assortment products

---

## 1) Overview

This is the contract every storefront client — the reference app, a mobile client, an AI shopping agent — programs against. It is intentionally boring: five read endpoints returning fully-resolved, fully-localized, fully-priced payloads with no client-side assembly required.

The design rule throughout: **the client never joins.** It never resolves a variant price from a price list, never computes a facet count, never applies a translation fallback. Everything arrives decided, because a mobile client and an AI agent cannot be trusted to reimplement the pricing specificity algorithm identically.

---

## 2) Problem Statement

`catalog` exposes admin CRUD APIs behind `requireAuth`, shaped for a back-office DataTable: raw fields, admin-scoped filters, no price resolution against a buyer, no locale overlay, no availability, no facets. Pointing a storefront at them would mean:

- Authenticating a public visitor against the back-office ACL
- Exposing internal fields (cost prices, supplier references, draft state) to the public
- Reimplementing pricing, localization and availability resolution in every client
- No facet counts, which are the core of catalogue navigation

And, specific to this platform: `catalog`'s pricing already resolves customer-scoped prices, but nothing assembles a `PricingContext` from a web request. Spec 3 now does. This spec consumes it.

---

## 3) Architecture

### 3.1 Position

```
apps/storefront ──HTTP──► /api/ecommerce/storefront/*   (this spec)
                                    │
                                    ├─ storeContextService.resolve()   (spec 3)
                                    │     → StoreContext { store, buyer, digest }
                                    │
                                    ├─ catalog: buildProductFilters()
                                    │           buildPricingContext()
                                    │           selectBestPrice()
                                    │           scoreProductSearchRelevance()
                                    │           computeHierarchyForCategories()
                                    │
                                    ├─ translations: batch overlay helpers
                                    │
                                    ├─ availability: availabilityService.check()
                                    │
                                    └─ search: SearchModuleConfig (phase 2)
```

### 3.2 Reuse over reimplementation

| Need | Existing export | Adaptation |
|---|---|---|
| Product filtering | `catalog/api/products/route.ts` → `buildProductFilters` | Public filter subset; store assortment scope forced |
| Pricing context | same file → `buildPricingContext` | Fed from `BuyerContext` instead of admin query params |
| Best-price selection | `catalog/lib/pricing.ts` → `selectBestPrice` | Unchanged; called with buyer group id **set** |
| Search relevance | `catalog/api/products/route.ts` → `scoreProductSearchRelevance` | Unchanged |
| Category hierarchy | `catalog/lib/categoryHierarchy.ts` → `computeHierarchyForCategories` | Unchanged; counts added |
| Locale overlay | `translations/lib/apply.ts`, `lib/batch.ts` | Batch mode, one call per response |
| Availability | `availability` contract | One batched `check` per response |

Where a helper needs public-shaped behaviour it is **extended with an option**, not copied. A forked filter builder would drift from the admin one and produce a storefront that disagrees with the back office about which products exist.

### 3.3 The assortment invariant

Every product-returning query enforces, without exception:

```
tenant_id = ctx.tenantId
AND organization_id = ctx.organizationId
AND deleted_at IS NULL
AND is_active = true
AND product ∈ (channel.assortmentScope ∩ buyer.assortmentScope)
```

This is applied in one place — a `buildStorefrontProductScope(ctx)` helper — and every endpoint composes it. It is not repeated per endpoint, because an endpoint that forgets one clause is a data leak.

---

## 4) Endpoints

Base path `/api/ecommerce/storefront`. All `GET`. All resolve `StoreContext` first; a resolution failure returns per SPEC-029 §6.2 before any catalogue work happens.

### 4.1 `GET /products`

Query grammar:

```
?page=1&pageSize=24
&search=sukienka
&categoryId=<uuid>            # includes descendants
&categorySlug=<slug>          # alternative to categoryId
&tagSlugs=sale,new
&priceMin=50&priceMax=200     # in the response currency, gross or net per taxMode
&options[color]=red,blue      # bracket notation, comma-separated
&options[size]=xl
&productType=configurable
&availability=in_stock        # in_stock | available (incl. backorder/preorder) | all
&sort=relevance|price_asc|price_desc|title_asc|title_desc|newest|featured
&locale=pl
```

`pageSize` defaults to 24, capped at 100 per root `AGENTS.md`. Unknown query parameters are **rejected** with `400`, not ignored — silently ignoring a misspelled filter shows the buyer an unfiltered catalogue that looks filtered.

Response:

```typescript
{
  items: StorefrontProductListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  facets: StorefrontFacets
  effectiveLocale: string
  requestedLocale: string | null
  currencyCode: string
  taxMode: 'gross' | 'net'
  appliedFilters: AppliedFilters      // echo of what the server actually applied
}
```

`appliedFilters` echoes the server's interpretation. A client that requested a category outside the assortment sees it absent here rather than silently dropped.

### 4.2 `GET /products/:idOrHandle`

Params: UUID or handle. Query: `locale`, `variantId` (preselection).

Returns `StorefrontProductDetail` (§5.2).

**Enumeration.** A product outside the effective assortment, inactive, deleted or belonging to another tenant returns `404` — identical in body and timing to a nonexistent handle. Handles are guessable; the response must not distinguish "exists but you may not see it" from "does not exist" (R4).

### 4.3 `GET /categories`

Query: `locale`, `parentId`, `depth`, `includeEmpty` (default `false`).

```typescript
{
  tree: Array<{
    id: string; name: string; slug: string | null; description: string | null
    depth: number; parentId: string | null
    productCount: number          // within the effective assortment
    hasChildren: boolean
    children: CategoryNode[]
  }>
  effectiveLocale: string
}
```

Counts respect the assortment intersection, so a B2B buyer restricted to one category tree does not see counts for categories they cannot browse.

### 4.4 `GET /categories/:slug`

```typescript
{
  category: {
    id: string; name: string; slug: string | null; description: string | null
    depth: number; parentId: string | null; ancestorIds: string[]
    breadcrumb: Array<{ id: string; name: string; slug: string | null }>
    children: Array<{ id: string; name: string; slug: string | null; productCount: number }>
    productCount: number
    seo: { title: string | null; description: string | null; canonicalUrl: string | null }
  }
  products: { /* identical shape to §4.1 */ }
  effectiveLocale: string
}
```

### 4.5 `GET /search/suggest`

Query: `q` (min 2 characters), `limit` (default 8, max 20), `locale`.

```typescript
{
  products: Array<{ id: string; handle: string | null; title: string
                    defaultMediaUrl: string | null; formattedPrice: string | null }>
  categories: Array<{ id: string; name: string; slug: string | null }>
  suggestions: string[]           // query completions; empty in phase 1
  effectiveLocale: string
}
```

Separate from `/products?search=` because typeahead has a different latency budget (§10) and must not pay for facet computation.

---

## 5) Payload Contracts

### 5.1 `StorefrontProductListItem`

```typescript
type StorefrontProductListItem = {
  id: string
  handle: string | null
  title: string                    // localized
  subtitle: string | null          // localized
  defaultMediaUrl: string | null
  productType: string
  isConfigurable: boolean
  hasVariants: boolean
  variantCount: number
  categories: Array<{ id: string; name: string; slug: string | null }>
  tags: string[]
  price: {
    currencyCode: string
    displayMode: 'gross' | 'net'
    amount: number                 // resolved for THIS buyer, in displayMode
    formatted: string              // e.g. '129,00 zł'
    isPromotion: boolean
    originalAmount: number | null
    formattedOriginal: string | null
    lowestPriorAmount: number | null      // Omnibus — SPEC-033
    formattedLowestPrior: string | null
  } | null
  priceRange: {                    // configurable products
    min: number; max: number; formattedMin: string; formattedMax: string
  } | null
  availability: {
    state: AvailabilityState       // availability contract §3.2
    canFulfil: boolean
    leadTimeDays: number | null
    releaseAt: string | null
  }
  badges: string[]                 // 'new' | 'sale' | 'featured' | custom
}
```

Changes from SPEC-029 v3: prices are single resolved numbers plus a formatted string rather than a net/gross pair, because the buyer's `taxMode` decides which one is shown and shipping both invites a client to display the wrong one. `lowestPriorAmount` is added for Omnibus compliance, which is a legal requirement in the EU and was absent from v3. `availability` is the contract's object rather than a bare string.

### 5.2 `StorefrontProductDetail`

Everything in the list item, plus:

```typescript
{
  description: string | null       // localized; sanitized HTML or markdown
  sku: string | null
  media: Array<{ id: string; url: string; alt: string | null; sortOrder: number }>
  dimensions: { length: number|null; width: number|null; height: number|null; unit: string|null } | null
  weightValue: number | null
  weightUnit: string | null
  categories: Array<{ id: string; name: string; slug: string | null; ancestorIds: string[] }>
  breadcrumb: Array<{ id: string; name: string; slug: string | null }>
  optionSchema: CatalogProductOptionSchema | null
  variants: Array<{
    id: string
    name: string                   // localized
    sku: string | null
    optionValues: Record<string, string>
    isDefault: boolean
    price: StorefrontPrice | null  // resolved per variant for THIS buyer
    availability: StorefrontAvailability
    dimensions: …; weightValue: …; weightUnit: …
  }>
  quantityRules: {                 // from AvailabilityPolicy
    minOrderQuantity: number | null
    maxOrderQuantity: number | null
    quantityIncrement: number | null
  }
  priceTiers: Array<{              // B2B quantity breaks, resolved for THIS buyer
    minQuantity: number
    maxQuantity: number | null
    amount: number
    formatted: string
  }>
  relatedProducts: StorefrontProductListItem[]   // max 8
  seo: { title: string | null; description: string | null; canonicalUrl: string | null }
}
```

`priceTiers` is new and is the point of B2B on the read side. `CatalogProductPrice` already carries `min_quantity` and `max_quantity`; without exposing them, a wholesale buyer cannot see that 100 units cost less per unit, which is the entire premise of wholesale.

`description` is **sanitized server-side** against an allowlist before it leaves the API. It originates from a back-office rich-text field and reaches the DOM; sanitizing in the client would mean trusting every client equally (R5).

### 5.3 `StorefrontFacets`

```typescript
type StorefrontFacets = {
  categories: Array<{ id: string; name: string; slug: string | null
                      depth: number; parentId: string | null; count: number }>
  tags: Array<{ slug: string; label: string; count: number }>
  priceRange: { min: number; max: number; currencyCode: string } | null   // buyer-priced — see §9 cache note
  options: Array<{ code: string; label: string
                   values: Array<{ code: string; label: string; count: number }> }>
  productTypes: Array<{ type: string; label: string; count: number }>
  availability: Array<{ state: AvailabilityState; count: number }>
  total: number
}
```

**`priceRange` is computed and cached separately from the rest of this type** (fixed 2026-08-17 — see §9): every other field here is a count over the assortment scope and does not depend on which buyer is asking, but `priceRange` is explicitly buyer-priced (§12 "Price range reflects the buyer's resolved prices, not list prices"). Bundling it into a response cached by assortment-scope hash alone — as an earlier draft's R2 mitigation did — would have let one buyer's negotiated price range leak into another buyer's response whenever the two share an assortment scope, which is exactly the class of bleed R1 rates Critical.

### 5.4 Cross-facet exclusion

For each facet dimension `D`, counts are computed against every active filter **except** the filters in `D`.

```
for each dimension D:
    baseQuery = assortment scope + all active filters EXCEPT those in D
    counts[D] = aggregate(baseQuery GROUP BY D)
```

Without this, selecting `color=red` collapses the colour facet to a single option with the current result count, and the buyer cannot switch to blue without clearing the filter.

Cost: one aggregation per dimension, six dimensions, run with `Promise.all`. A dimension with no active filter anywhere in the request shares the base query — in the common no-filters-applied case this collapses to one aggregation, not six.

---

## 6) Pricing

### 6.1 Resolution

Per response, in batch: collect every product and variant id, load their `CatalogProductPrice` rows in one query, and resolve each with `selectBestPrice(rows, pricingContext)` in memory. Never per item.

`pricingContext` is built from `BuyerContext`:

```typescript
{
  channelId: ctx.channel?.salesChannelId ?? null,
  priceKindId: ctx.buyer.priceKindId ?? ctx.channel?.priceKindId ?? null,
  customerId: ctx.buyer.customerId,
  customerGroupIds: ctx.buyer.customerGroupIds,   // per spec 1 §7.1
  currencyCode: ctx.currencyCode,
  quantity: 1,                                     // list/detail; tiers resolved separately
  date: now,
}
```

### 6.2 Tax display

`ctx.buyer.taxMode` decides whether `amount` carries tax. Where a price row supplies only one of net/gross, the other is derived through the applicable `SalesTaxRate`, resolved with the buyer's group id set (spec 1 §7.2). Anonymous buyers use `store.settings.display.priceDisplayModeDefault`.

### 6.3 Price sorting and range faceting

Both need resolved prices, which are buyer-dependent, so neither can be a plain SQL `ORDER BY` on a price column.

Approach: resolve prices for the filtered id set, then sort and paginate in memory. Bounded by capping the pre-sort id set at 5 000 products; beyond that, price sort falls back to the default price kind's rows with an `X-Sort-Approximate: true` response header, and the child implementation logs it. A catalogue of that size with per-customer contract pricing needs a materialized price projection, which is a separate spec, not a silent degradation.

**Not hidden:** the 5 000 cap and the fallback are surfaced in the response header and in the admin diagnostics, per the roadmap's no-silent-caps rule.

---

## 7) Localization

### 7.1 Resolution order

`?locale=` → `X-Locale` → `Accept-Language` (first supported) → `store.defaultLocale`. A requested locale outside `supportedLocales` falls back; `requestedLocale` and `effectiveLocale` are both returned so the client can tell.

### 7.2 Overlay

Applied via the `translations` batch helpers — one call per response, never per entity.

| Entity | Fields |
|---|---|
| `CatalogProduct` | `title`, `subtitle`, `description`, SEO title/description |
| `CatalogProductVariant` | `name` |
| `CatalogProductCategory` | `name`, `description`, SEO title/description |
| `CatalogProductTag` | `label` |
| Option schema | option `label`, choice `label` |

Fallback chain: requested locale → `store.defaultLocale` → base entity field. Never an empty string — an untranslated product shows its base title, not a blank card.

Option and choice labels are included because facet labels come from them; without translation the Polish storefront shows an English colour facet.

---

## 8) Search

### 8.1 Phase 1 — `ILIKE`

Escaped, case-insensitive match over `title`, `subtitle`, `description`, `sku`, `handle`, ranked with `catalog`'s existing `scoreProductSearchRelevance`. Applied within the assortment scope.

### 8.2 Phase 2 — `@open-mercato/search`

`catalog` already ships a `search.ts` `SearchModuleConfig`. The storefront reuses that index, post-filtered by the effective assortment **before** ranking, so a restricted B2B buyer never sees a relevance-ranked list containing products they cannot buy.

### 8.3 One response shape

Both phases return identical payloads. The client never learns which backend is active. Switching is a deployment concern, and a client that branches on it would break at the switch.

---

## 9) Caching & Rate Limiting

| Endpoint | TTL | Key | Notes |
|---|---|---|---|
| `/products` items + `priceRange` | 30s | `digest` + normalized query | `stale-while-revalidate: 30` |
| `/products` count facets (`categories`/`tags`/`options`/`productTypes`/`availability`) | 30s | `assortmentScopeHash` + normalized query, **excluding price/tax/customer fields from the digest** | See "Facet cache split" below — R2's cost optimization; safe only because these counts don't depend on price |
| `/products/:idOrHandle` | 60s | `digest` + product id | |
| `/categories` | 300s | `digest` + params | |
| `/categories/:slug` | 60s | `digest` + slug + query | |
| `/search/suggest` | 30s | `digest` + `q` + limit | |

Every key is built through `buildStorefrontCacheKey(ctx, parts)` (SPEC-029 §6.1), which requires the `StoreContext` and therefore the digest — the count-facets row is the **one deliberate exception**, and it uses `assortmentScopeHash` (a documented sub-component of the digest, not an ad hoc value) rather than bypassing the helper.

### 9.1 Facet cache split (fixed 2026-08-17)

An earlier draft cached the entire `StorefrontFacets` block — `priceRange` included — by `assortmentScopeHash` alone (§11 R2's optimization), on the reasoning that buyers sharing an assortment scope can share facet counts. That reasoning holds for `categories`/`tags`/`options`/`productTypes`/`availability`, which are genuinely price-independent counts, but not for `priceRange`, which §5.3 and §12 both require to reflect the requesting buyer's own resolved prices. Two buyers sharing an assortment scope but on different price kinds or with different negotiated contract prices would otherwise see each other's price-range slider bounds — the same class of disclosure R1 rates Critical, introduced by R2's own mitigation.

Fixed: `priceRange` is computed and cached with the `items` response (full `digest`), not with the count facets. The count-facet cache split by `assortmentScopeHash` is unchanged and still delivers R2's win for the expensive part (six aggregations collapsing to a shared cache entry across same-assortment buyers) — only the one buyer-priced field moves.

Authenticated responses are `Cache-Control: private, no-store` at the HTTP layer while still using the **server-side** cache keyed on the digest. The two are distinct: shared server caching keyed per buyer context is safe; shared browser or CDN caching is not.

Invalidation tags: `catalog-product:{id}`, `catalog-category:{id}`, `ecommerce-store:{storeId}`, `availability:{tenantId}:{variantId}`.

**Rate limits** (per IP, per store):

| Endpoint | Limit |
|---|---|
| `/products` | 120/min |
| `/products/:idOrHandle` | 240/min |
| `/categories` | 120/min |
| `/search/suggest` | 300/min |

Typeahead gets the highest limit because a real user types quickly; a 60/min limit would rate-limit legitimate use.

---

## 10) Performance Budgets

| Metric | Target | Conditions |
|---|---|---|
| `/products` P95, cached | < 50 ms | |
| `/products` P95, uncached | < 300 ms | 10 000 products, 6 facet dimensions, incl. facet computation |
| `/products/:idOrHandle` P95, uncached | < 200 ms | Configurable product with 20 variants |
| `/categories` P95, uncached | < 150 ms | 500-category tree |
| `/search/suggest` P95 | < 120 ms | Typeahead budget |
| Query count, `/products` | ≤ 12 | 1 scope + 1 products + 1 prices + 1 translations + 1 availability + ≤ 6 facets + 1 media |
| Query count, `/products/:id` | ≤ 7 | Independent of variant count |

Query counts are asserted in tests. A per-item query is a defect regardless of wall-clock time on a small fixture — it only shows up in production.

---

## 11) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Contract pricing served to the wrong buyer | **Critical** | `ecommerce` | A `/products` response cached without the digest, or an authenticated response cached by a CDN, serves ACME's negotiated prices to an anonymous visitor or a competitor. | All keys via `buildStorefrontCacheKey`; authenticated responses `private, no-store`; a cross-context isolation suite is a Phase 1 gate; a CDN configuration note ships with the spec | Low |
| R2 | Facet cost under B2B | **High** | `ecommerce` | Six aggregations per uncached listing request, and per-buyer caching means low hit rates exactly for the buyers whose queries are most expensive. | Dimensions without an active filter share one base query; facets computed with `Promise.all`; the count-facet block (`categories`/`tags`/`options`/`productTypes`/`availability` — price-independent) is cached separately from items, keyed on the assortment-scope hash rather than the full digest; `priceRange` is excluded from that split and cached with `items` on the full digest instead (§9.1, fixed 2026-08-17 — bundling it into the assortment-hash cache would have leaked one buyer's price range to another sharing the same assortment scope) | Medium — a tenant with many distinct assortment scopes still pays for count facets; measured at the Phase 1 gate |
| R3 | Price sort degrades silently | Medium | `ecommerce` | Above 5 000 matching products, price sort falls back to the default price kind and a buyer sees an order that does not match their prices, with no signal. | `X-Sort-Approximate: true` header, admin diagnostics entry, documented cap — not silent (§6.3) | Medium — accepted; a materialized price projection is the real fix and is out of scope |
| R4 | Handle enumeration oracle | **High** | `ecommerce` | Probing `/products/<handle>` distinguishes "restricted" from "nonexistent" by status code, body or timing, mapping a competitor's private assortment. | Identical `404` body for all four cases; assortment filtering happens inside the same query rather than as a post-check, so timing does not diverge; a timing test asserts no measurable difference | Low |
| R5 | Stored XSS via product description | **High** | `ecommerce` | A back-office user with catalogue access stores `<img onerror=…>`; every storefront visitor executes it. | Server-side allowlist sanitization before the field leaves the API; the client renders sanitized HTML; sanitizing client-side would trust every client equally | Low |
| R6 | Unknown query parameters ignored | Medium | `ecommerce` | A client sends `?categoryID=` (wrong case); the server ignores it and returns the whole catalogue, which the UI presents as filtered results. | Unknown parameters rejected with `400`; `appliedFilters` echoes the server's interpretation | Low |
| R7 | Omnibus non-compliance | Medium | `ecommerce`, legal | A promotional price is shown without the lowest prior price from the preceding 30 days, which EU law requires. | `lowestPriorAmount` is part of the price contract and sourced from SPEC-033; a promotional item without it fails a contract test | Low |
| R8 | Translation overlay N+1 | Medium | `ecommerce` | Overlay applied per entity turns a 24-product page into 200+ lookups. | Batch helpers, one call per response; query count asserted (§10) | Low |
| R9 | Facet counts leak restricted assortment | Medium | `ecommerce` | Counts computed before the assortment intersection tell a restricted buyer how many products exist outside their scope. | `buildStorefrontProductScope` is the base of every aggregation, facets included; test asserts counts equal the visible set | Low |

---

## 12) Integration Coverage

**Assortment and isolation:**
- Products from another tenant never appear, via any endpoint or facet count
- Channel scope ∩ group scope applied to items, facets and category counts (R9)
- Inactive, deleted and out-of-assortment products all return an identical `404` from `/products/:idOrHandle`, with no timing divergence (R4)

**Buyer-dependent pricing:**
- Anonymous and authenticated B2B requests to the same URL return different prices from the same fixture
- Group price row wins over channel default; personal customer price wins over group
- `taxMode: 'net'` returns net amounts; `'gross'` returns gross; anonymous uses the store default
- `priceTiers` reflects `min_quantity` / `max_quantity` rows for the buyer's context
- `lowestPriorAmount` present on promotional items (R7)
- Two buyers in different groups never share a cache entry (R1)

**Facets:**
- Cross-exclusion: with `color=red` selected, the colour facet still lists blue with a nonzero count
- Category counts include descendants
- Price range reflects the buyer's resolved prices, not list prices
- **Two buyers sharing an assortment scope but on different price kinds never see each other's `priceRange`, even though they share the same count-facet cache entry** (regression test for the fixed §9.1 cache split)
- With no filters applied, the count-facet block issues one aggregation, not six (R2)

**Localization:**
- Overlay applied to titles, descriptions, category names, tag labels, option and choice labels
- Fallback chain never yields an empty string
- Unsupported locale falls back with both `requestedLocale` and `effectiveLocale` returned

**Availability:**
- State comes from `availabilityService`; a `wms`-less environment returns `not_tracked` throughout
- `availability=in_stock` filter excludes backorder; `available` includes it

**Search:**
- `ILIKE` and search-module phases return identical shapes for the same fixture
- Results are assortment-filtered before ranking
- `q` shorter than 2 characters returns empty, not an error

**Contract and safety:**
- Unknown query parameter returns `400` (R6)
- `pageSize` above 100 is rejected
- Malicious HTML in a description is sanitized before it leaves the API (R5)
- Every endpoint exports `openApi` and the emitted schema matches the actual response shape

**Performance:** query counts per §10 asserted against a 200-variant, 10 000-product fixture.

---

## 13) Implementation Phases

### Phase 1 — Listing and detail
`buildStorefrontProductScope`, `lib/storefrontProducts.ts`, `lib/storefrontDetail.ts`, batched pricing, availability, translation overlay, `/products` and `/products/:idOrHandle`, `ILIKE` search, caching.

**Gate:** cross-context isolation suite passes; query-count budgets met; the enumeration-oracle test shows no divergence.

### Phase 2 — Facets and categories
`lib/storefrontFacets.ts` with cross-exclusion, `lib/storefrontCategories.ts`, `/categories`, `/categories/:slug`.

**Gate:** facet counts match the visible set; the no-filter case issues one aggregation.

### Phase 3 — Search and hardening
`/search/suggest`, `@open-mercato/search` integration behind the same shape, rate limiting, OpenAPI, performance profiling.

**Gate:** both search backends produce identical payloads; rate limits verified; budgets met at scale.

---

## 14) Open Questions

1. **Sitemap and robots** — `sitemap.xml` per store, driven by the assortment. Belongs here (server-generated, always current) or in spec 10 (Next.js route). *Leaning here; the app cannot enumerate the assortment without paginating this API.*
2. **Materialized price projection** — the real fix for R3. Needs its own spec once a tenant hits the cap.
3. **Product recommendations** — `relatedProducts` is "same category, limit 8". Anything better belongs to spec 8 (merchandising) with curated and rule-driven sets.
4. **Media transformation** — `defaultMediaUrl` is a raw URL; responsive images need width variants. `storage-s3` may already offer this; unverified.

---

## 15) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Reads `catalog` through its exported helpers and the query engine; availability via the contract |
| Tenant/organization scoping | `buildStorefrontProductScope` composed by every endpoint, aggregations included |
| Never expose cross-tenant data | Isolation suite gates Phase 1 |
| `pageSize` ≤ 100 | Enforced, request rejected above |
| Zod validation | Query grammar validated; unknown parameters rejected |
| No `any` | Payload contracts fully typed; `z.infer` for query types |
| OpenAPI | Exported per route; schema-vs-response contract test |
| i18n | Overlays via `translations`; no hard-coded user-facing strings |
| Rate limiting | §9, per IP per store |
| Cache safety | Keys via `buildStorefrontCacheKey`; authenticated responses `private, no-store` |
| Backward compatibility | New public API surface; additive, nothing existing changes. Once published these payloads are a STABLE contract under `BACKWARD_COMPATIBILITY.md` |
| Integration coverage | §12, shipping in the same change |

---

## 16) Changelog

### 2026-08-17
- Fixed a self-contradiction between R2's facet-caching optimization and §5.3/§12's own requirement that `priceRange` reflect the requesting buyer's resolved prices: the original draft cached the entire facet block — `priceRange` included — by `assortmentScopeHash` alone, which would leak one buyer's price range to another buyer sharing the same assortment scope but a different price kind or contract price (the same class of disclosure R1 rates Critical). Split `priceRange` out to cache with `items` on the full digest (§9.1); the count-facet cache split by `assortmentScopeHash` is otherwise unchanged and still delivers R2's win.

### 2026-08-14
- Initial specification, carrying forward SPEC-029 v3 §8, §9, §10, §12.1, §21 and the API half of §24.
- Reshaped for buyer-dependent pricing per ADR-7: prices are single resolved amounts in the buyer's tax mode rather than net/gross pairs; `priceTiers` added so B2B quantity breaks are visible; every cache key carries the buyer digest.
- Added `lowestPriorAmount` for Omnibus compliance (SPEC-033), absent from v3.
- Replaced v3's bare `availability` string union with the availability contract's object.
- Grounded reuse in existing exports: `buildProductFilters`, `buildPricingContext`, `scoreProductSearchRelevance` (`catalog/api/products/route.ts`), `selectBestPrice` (`catalog/lib/pricing.ts`), `computeHierarchyForCategories` (`catalog/lib/categoryHierarchy.ts`), the `translations` batch overlay helpers, and `catalog/search.ts`'s existing `SearchModuleConfig`.
- Added the handle-enumeration oracle (R4) and stored-XSS-via-description (R5) risks, neither of which v3 addressed.
