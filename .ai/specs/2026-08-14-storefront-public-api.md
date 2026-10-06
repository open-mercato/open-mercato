# Storefront Public API

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 4 — Phase 0 reconciliation 2026-10-05) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 4, Phase 1 |
| **Modules** | `ecommerce` (public read surface), `content` (page source behind the DI seam, §3.4); pre-steps in `catalog`, `query_index`, `shared`, `search` (§3.3, §14a) |
| **Depends on** | [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md), [Availability Contract](./2026-08-14-availability-contract.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Pricing Engine](./2026-08-21-pricing-engine.md) (Phase 2, Phase 2b indexes, and the 2026-10-05 `PricingContext` amendment adding `priceKindId` and `customerIds`), Omnibus price tracking — **prerequisite of Phase 1** (D11); two candidate documents exist, [SPEC-033](./SPEC-033-2026-02-18-omnibus-price-tracking.md) and [2026-06-30 Omnibus price tracking](./2026-06-30-omnibus-price-tracking.md), and the authoritative one MUST be chosen before Phase 1 starts |
| **Decisions** | [`analysis/ANALYSIS-2026-10-05-storefront-release-decisions.md`](./analysis/ANALYSIS-2026-10-05-storefront-release-decisions.md) — D# references below |
| **Related** | [SPEC-026 Catalog Localization](./implemented/SPEC-026-2026-02-11-catalog-localization.md), [SPEC-033 Omnibus](./SPEC-033-2026-02-18-omnibus-price-tracking.md), [SPEC-071 SEO Helper](./SPEC-071-2026-04-06-seo-helper-validation-visibility.md) |

---

## TLDR

**Key Points:**
- The public read surface of the `ecommerce` module: product listing with facets, product detail, category tree, category landing, search, and static content pages. Seven endpoints, all `GET`, all served under a resolved `StoreContext`.
- These endpoints are **not anonymous**. An authenticated B2B buyer gets different prices, a different tax display mode and a narrower assortment from the same URL. Every response is keyed and cached on the buyer-context digest, or it leaks contract pricing. Content pages (§4.6–4.7) are the one deliberate exception: they carry no buyer-dependent field at all.
- Content pages are served over a **DI seam** (`contentPageSource`, §3.4), not over a module. The minimal source ships with `content`; a CMS module on the long-range roadmap can replace it without the storefront changing, because `body` is a discriminated union the client handles both arms of from day one.
- Almost nothing here is new *business* logic. `catalog` already exports `selectBestPrice`, `buildPriceRowFilter`, `scoreProductSearchRelevance` and `computeHierarchyForCategories`, and `buildProductFilters` is extracted into `catalog/lib` for reuse; `translations` exports the overlay helpers; `availability` supplies stock state through `resolveAvailability`. This spec is a **public projection** over existing internals, and its main job is to not fork them. What *is* new is infrastructure the projection needs and the platform did not have: a scope-key array on the product index document (§3.3) and two additive `PricingContext` fields (§6.1) — both named as pre-steps, not hidden inside "reuse" (rev 4).
- Cross-facet exclusion — the rule that a facet's counts ignore that facet's own filter — is the expensive part: one aggregation per facet dimension per request.

**Scope:**
- `GET /products`, `/products/:idOrHandle`, `/categories`, `/categories/:slug`, `/search/suggest`, `/pages`, `/pages/:slug`
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
                                    ├─ ecommerce/lib: buildStorefrontPricingContext(ctx)   (from BuyerContext)
                                    │
                                    ├─ catalog: buildProductFilters()            (catalog/lib/productFilters.ts)
                                    │           buildPriceRowFilter() + selectBestPrice()   (catalogPricingService)
                                    │           scoreProductSearchRelevance()
                                    │           computeHierarchyForCategories()
                                    │
                                    ├─ query_index: entity_indexes doc incl. scope_keys (§3.3)
                                    │
                                    ├─ translations: applyTranslationOverlays() / batchLoadTranslations()
                                    │
                                    ├─ availability: resolveAvailability(query)   (@open-mercato/shared/lib/availability)
                                    │                policyResolutionService.resolveMany()
                                    │
                                    ├─ search: tokens + pgvector strategies (phase 3, §8.2)
                                    │
                                    └─ contentPageSource.getPage() / .listPages()   (§3.4)
                                          → StorefrontPage   (swappable: minimal | CMS)
```

### 3.2 Reuse over reimplementation

| Need | Existing seam (verified on `develop` @ `a108dd07f4`) | Adaptation |
|---|---|---|
| Product filtering | `buildProductFilters(query, ctx)` — today in `catalog/api/products/route.ts:115`, typed by a **non-exported** local `ProductsQuery`; importing the route module also instantiates `makeCrudRoute` (`route.ts:822`) | **Extracted** with its query type to `catalog/lib/productFilters.ts`; `route.ts` keeps a re-export (BC bridge, §14a). Gains an option for descendant expansion — today's category filter matches `category $in ids` exactly (`route.ts:280-296`); descendants come from `CatalogProductCategory.descendant_ids` (jsonb, maintained) — plus the forced store assortment scope |
| Pricing context | — (`buildPricingContext` in the admin route parses the admin `listSchema`, sets only legacy `customerGroupId` and never `customerGroupIds` or `currencyCode`, so it is **not** reused) | Built directly from `BuyerContext` in `ecommerce/lib` (`buildStorefrontPricingContext`, §6.1) |
| Row narrowing | `catalog/lib/pricing.ts` → `buildPriceRowFilter` (exported, property-tested, no production caller yet) | Required on every price fetch (§6.1); needs `pricing-engine.md` Phase 2b indexes |
| Best-price selection | `catalog/lib/pricing.ts` → `selectBestPrice`, via DI `catalogPricingService` | Called with the amended `PricingContext` (`priceKindId`, `customerIds`, `customerGroupIds`, `currencyCode` — §6.1) |
| Search relevance | `catalog/api/products/route.ts` → `scoreProductSearchRelevance` (exported) | Unchanged; moved alongside `buildProductFilters` or imported from the extracted module |
| Category hierarchy | `catalog/lib/categoryHierarchy.ts` → `computeHierarchyForCategories` | Unchanged; counts added |
| Assortment scope in SQL | — (does not exist) | New `scope_keys` array on the product index document, new `overlap` filter operator (§3.3) |
| Locale overlay | `translations/lib/apply.ts` → `applyTranslationOverlays`; `lib/batch.ts` → `batchLoadTranslations` | One call per response. `batchLoadTranslations` matches `organization_id` exactly (no org → tenant fallback) — stated, not worked around |
| Availability | `resolveAvailability(query)` from `@open-mercato/shared/lib/availability` (there is no `availabilityService` DI key); `policyResolutionService.resolveMany` (`availability/lib/policyResolution.ts`) | One batched `resolveAvailability` per response for state; one `resolveMany` for quantity rules and `hideWhenOutOfStock`, which are not in `AvailabilityItemResult` |
| HTML sanitization | `sanitizeRichTextHtml` from `@open-mercato/shared/lib/html/sanitizeRichText` (`sanitize-html` allowlist) | Used for `description` (R5); no new dependency |
| Rate limiting | `checkRateLimit` + `getClientIp` from `@open-mercato/shared/lib/ratelimit` | Per-IP-per-store keys (§9); the declarative `rateLimit` route metadata keys by IP only |

Where a helper needs public-shaped behaviour it is **extended with an option**, not copied. A forked filter builder would drift from the admin one and produce a storefront that disagrees with the back office about which products exist. The two places where an existing helper is deliberately *not* reused — `buildPricingContext` and the in-route location of `buildProductFilters` — are not forks: the first parses a different input entirely, the second moves to a library location with a re-export so both callers share one implementation.

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

**The scope clause is a predicate over denormalized keys, not a set of joins (added 2026-09-16).** The last line expands to `buyer-scoped-catalog-visibility.md` §3.3's DNF: an OR-list of AND-scopes, each of which can carry up to five id-set conditions. Written literally over the junction tables (`catalog_product_category_assignments`, `catalog_product_tag_assignments`) that is, per group, `EXISTS(categories) AND EXISTS(tags) AND NOT EXISTS(×3)`, OR'd across groups — and it sits in front of *every* product query in this document, the six facet aggregations of R2 included.

The helper MUST therefore emit its scope clause against a denormalized, GIN-indexed key array on the product's index document rather than against the assignment tables:

```
doc->'scope_keys': jsonb string array   -- ["cat:<uuid>", …, "tag:<uuid>"], categories expanded to include ancestors
```

Each DNF branch then becomes an overlap test on `scope_keys` against the branch's inclusion ids, plus a negated overlap against its exclusions — one index serving every branch, every buyer and every facet, instead of a join plan that grows with the buyer's group count. A branch carrying `allOf` (which the shipped `intersectScopes` emits when two sources' inclusion sets cannot be merged flat — `packages/shared/src/lib/catalog-visibility/intersectScopes.ts`) becomes an **AND** of the overlap tests of its own fields and of each `allOf` entry, recursively; nothing about the representation changes for it.

Two things make this cheap rather than speculative. The visibility spec already defines the matcher's input as `ScopedProduct = { id, categoryIds, tagIds }`, i.e. it has already committed to a product's scope-relevant attributes being a small flat set — `scope_keys` is that set, serialized. And `CatalogProductCategory` already carries `ancestor_ids`/`descendant_ids` as maintained `jsonb` columns (`catalog/data/entities.ts:372-379`), so the ancestor expansion the "includes descendants" rule needs (§4.1) is a lookup, not a recursive CTE.

**What has to be built, and who owns it (rewritten 2026-10-05, D9).** An earlier revision called this "not a new entity … maintained by the same indexer that already projects products". The first half holds; the second does not describe today's code. Verified on `develop`: the `query_index` indexer builds a document as `selectAll()` from the base table plus `cf:*` custom-field values (`query_index/lib/indexer.ts:27-61`) with **no enrichment hook**; the product document carries no category or tag ids; `entity_indexes.doc` has no GIN index; and the query engine's `FilterOp` (`packages/shared/src/lib/query/types.ts:5`) has no array-overlap operator. The mechanism is therefore a **cross-module pre-step** owned jointly by `catalog`, `query_index`, `shared` and `search`, approved by the owner on 2026-10-05:

| Piece | Owner | Shape |
|---|---|---|
| Doc-enrichment hook | `query_index` | A new, additive extension point letting the module that owns an entity contribute computed fields to that entity's index document at index time (one batched callback per reindex batch, not per row) |
| `scope_keys` contributor | `catalog` | For `catalog:catalog_product`: `cat:<id>` for every assigned category and each of its `ancestor_ids`, `tag:<id>` for every assigned tag. Ids only — never encrypted, never translated |
| GIN index | `query_index` (migration) | `CREATE INDEX CONCURRENTLY … ON entity_indexes USING gin ((doc->'scope_keys')) WHERE entity_type = 'catalog:catalog_product'` |
| `overlap` filter operator | `shared` (query engine) | New additive `FilterOp` member compiling to jsonb `?|` against the indexed expression; usable by any entity whose document carries a string array |
| Search strategies | `search` | The `tokens` and `pgvector` strategies accept the same predicate so ranking and scope share one query (§8.2) |

**Reindex triggers.** A product's keys change when its assignments change (`catalog.product.created` / `catalog.product.updated` — assignments are written through the product commands), when a category is **re-parented** (`catalog.category.updated` with a changed parent → reindex every product assigned anywhere in that category's subtree, since its ancestor keys changed), and when a category or tag is deleted (`catalog.category.deleted`; tags have no events today, see §9 — tag deletion is covered by the next product reindex and by the periodic coverage job, and that staleness window is R16). **Backfill:** enabling the hook schedules a full reindex of `catalog:catalog_product` for every existing tenant through the existing reindex job; until a tenant's backfill completes, `buildStorefrontProductScope` for that tenant MUST fail closed (deny-all for restricted buyers, `503` for the listing) rather than evaluate against documents without keys.

**Equivalence.** `matchesScope` in memory and the SQL emitted here are two evaluators of one rule; the property-based equivalence test (`buyer-scoped-catalog-visibility.md` §11) runs over the existing seeded generator in `packages/shared/src/lib/catalog-visibility/__tests__/testFixtures.ts`, `allOf` branches included.

The point of writing the shape down is unchanged: "applied in one place" already protects correctness; it does not by itself protect the shape, and a first implementation that puts `EXISTS`-over-junctions inside the helper satisfies every stated rule while making §8.2's filter-push and R2's facet cost unfixable without redoing it. That shortcut remains **not** permitted.

### 3.4 Content pages: one contract, two possible sources

Static pages — terms, privacy, about us, shipping information — are the one part of this surface whose *content* the platform does not author. Today `@open-mercato/content` ships hardcoded React pages carrying Open Mercato's own legal entity (`packages/content/src/modules/content/frontend/terms/page.tsx`); a CMS module sits on the long-range roadmap. A storefront bound directly to either one has to be rewritten when the other arrives.

So §4.6–4.7 are served over a **DI seam**, not over a module:

```typescript
// packages/content/src/modules/content/di.ts
container.register({ contentPageSource: asClass(MinimalContentPageSource).scoped() })
```

```typescript
interface ContentPageSource {
  getPage(ctx: StoreContext, args: { slug: string; locale: string }): Promise<StorefrontPage | null>
  listPages(ctx: StoreContext, args: { locale: string; cursor?: string; limit?: number }):
    Promise<{ items: StorefrontPageRef[]; nextCursor: string | null }>
}
```

A DI key rather than a route override, because the HTTP endpoint is not the only consumer:

| Consumer | Why the endpoint alone is insufficient |
|---|---|
| `GET /pages/:slug`, `GET /pages` | — |
| Sitemap generation | Enumerates published pages (spec 10 §4) |
| Merchandising `target_type: content_page` | Resolves and validates a menu item's target **in process**, inside the admin — an HTTP hop to itself would be absurd |

A CMS module registers its own implementation under the same key, or an app swaps it through `entry.overrides.di` ([unified `modules.ts` overrides](./implemented/2026-05-04-modules-ts-unified-overrides.md)). Consumers that must survive the source being absent entirely resolve it through the local `tryResolve` pattern (`packages/core/AGENTS.md` § Cross-Module Coupling) and degrade: no source means `/pages/*` returns `404` and the sitemap omits them, not that the app fails to boot.

**The contract is derived from what the storefront needs and from nothing else.** No workflows, taxonomies, publication calendars or revision trees appear in it — those are a CMS's private concerns, and importing them now, against a module that does not exist, is exactly how a speculative seam ends up the wrong shape. Two methods is the budget. If the interface grows past them, someone else's vocabulary has leaked in and the seam needs re-deriving from its consumers rather than extending.

**What the seam does not move.** Tenant and store scoping, publication filtering and HTML sanitization live in the route layer, applied to whatever the source returned — never inside the implementation. A swapped source therefore cannot opt out of them (R12).

---

## 4) Endpoints

Base path `/api/ecommerce/storefront`. All `GET`. All resolve `StoreContext` first; a resolution failure returns per SPEC-029 §6.2 before any catalogue work happens.

4.1–4.5 are buyer-aware. 4.6–4.7 are not, by design (§4.6).

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
&availability=in_stock        # in_stock | available (incl. backorder/preorder) | all — page-scoped, see below
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
  availableSorts: Array<'relevance' | 'price_asc' | 'price_desc' | 'title_asc' | 'title_desc' | 'newest' | 'featured'>
  appliedSort: (typeof availableSorts)[number]   // what the server actually sorted by
}
```

`appliedFilters` echoes the server's interpretation. A client that requested a category outside the assortment sees it absent here rather than silently dropped.

**`availability=` is page-scoped (D21, 2026-10-05).** Availability is not a SQL column: `resolveAvailability` asks the active provider (`wms`, or the catalog-only fallback) per item, after the product query. Filtering by it *before* pagination would mean resolving stock for the entire filtered set — up to the 10 000-product fixture §10 budgets for — on every uncached request. The filter is therefore a **post-filter over the returned page**:

- the page is selected and paginated exactly as without the filter, then items not matching the requested availability are removed — a page MAY contain fewer than `pageSize` items, including zero;
- `total` and `totalPages` count the **pre-availability** set and say so;
- the response carries `appliedFilters.availability = { value: 'in_stock' | 'available', scope: 'page' }`, and the availability facet carries `facets.availabilityScope: 'page'` (§5.3);
- clients MUST tolerate short and empty pages and MUST NOT treat `items.length < pageSize` as end-of-results — `page < totalPages` is the only continuation signal.

This is a stated, visible limitation (R15), not an approximation hidden behind a header. It is revisited when a stock projection exists (§14 OQ8).

`availableSorts` and `appliedSort` do the same job for ordering (added 2026-09-16). They exist because §6.3's per-channel `price_sort_fallback` makes the offered set **server-decided**: a channel set to `'unavailable'` omits `price_asc`/`price_desc` past the listing cap, and a client with its own hard-coded list would keep offering a sort this server has declined to perform. `appliedSort` is separate from the request's `?sort=` for the same reason `appliedFilters` is separate from the query: a `?sort=price_asc` that is not on offer resolves to the default and says so here, rather than being echoed back as though it had been honoured. `storefront-app.md` §5.4a renders its control from these two fields and from nothing else.

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

### 4.6 `GET /pages`

Query: `locale`, `cursor`, `limit` (default 50, max 200).

```typescript
{
  items: Array<StorefrontPageRef>   // { slug, locale, title, updatedAt }
  nextCursor: string | null
  effectiveLocale: string
}
```

Published pages only. It exists to feed sitemap generation and footer navigation, so it is a listing and not a search: no filters beyond locale. A store with enough static pages to need filtering here has outgrown this surface and wants the CMS.

**Unlike every other endpoint in this spec, 4.6 and 4.7 are not buyer-aware.** The same slug returns the same bytes to an anonymous visitor and to an authenticated B2B buyer. This is a scope boundary, not an oversight: audience-targeted content is merchandising's job — blocks and placements carrying `customerGroupIds`, `excludeCustomerGroupIds` and `requiresAuthentication` (spec 8 §4.7) — and duplicating that targeting model into the page store would give merchants two places to configure the same thing and two places to get it wrong. A merchant who needs a B2B-only page composes it as a placement, or waits for the CMS.

The consequence is a cache that is shared rather than fragmented per buyer (§9), which is the whole benefit of having drawn the boundary here.

### 4.7 `GET /pages/:slug`

Query: `locale`. Returns `StorefrontPage` (§5.5), or `404`.

Draft, scheduled-but-not-yet-live, soft-deleted and nonexistent slugs return an **identical** `404`, and the publication filter is part of the source's query rather than a post-check — the same rule R4 imposes on product handles, for the same reason: an unreleased campaign page or a pending terms revision is discoverable by probing otherwise (R11).

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
    lowestPriorAmount: number | null      // Omnibus — prerequisite of Phase 1 (D11), see below
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

**Omnibus is a prerequisite, not a parallel track (D11, 2026-10-05).** Verified on `develop`: no price-history or lowest-prior-price code exists anywhere (`lowestPrior`, `omnibus`, `priceHistory`, `price_history` — zero hits outside specs). The field is therefore sourced from the Omnibus implementation, which ships **before** Phase 1 of this spec; the owner chose that over shipping `null` with promotions suppressed. Two candidate specifications exist (`SPEC-033-2026-02-18-omnibus-price-tracking.md`, `2026-06-30-omnibus-price-tracking.md`); the authoritative one is chosen, and run through `/om-pre-implement-spec`, before Phase 1 is scheduled. The R7 contract test stays as written: a promotional item without `lowestPriorAmount` fails it.

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
  quantityRules: {                 // from AvailabilityPolicy via policyResolutionService.resolveMany (not in AvailabilityItemResult)
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

`description` is **sanitized server-side** against an allowlist (`sanitizeRichTextHtml`, `@open-mercato/shared/lib/html/sanitizeRichText`) before it leaves the API. It originates from a back-office rich-text field and reaches the DOM; sanitizing in the client would mean trusting every client equally (R5).

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
  availabilityScope: 'page'        // availability counts cover the returned page only — §4.1 (D21)
  total: number
}
```

`availability` counts are the one facet that is **not** computed over the filtered set: they count the items of the returned page, for the same reason the `availability=` filter is page-scoped (§4.1). `availabilityScope` says so in the payload rather than leaving clients to assume set-wide counts. Every other facet is set-wide.

**`priceRange` is computed and cached separately from the rest of this type** (fixed 2026-08-17 — see §9): every other field here is a count over the assortment scope and does not depend on which buyer is asking, but `priceRange` is explicitly buyer-priced (§12 "Price range reflects the buyer's resolved prices, not list prices"). Bundling it into a response cached by assortment-scope hash alone — as an earlier draft's R2 mitigation did — would have let one buyer's negotiated price range leak into another buyer's response whenever the two share an assortment scope, which is exactly the class of bleed R1 rates Critical.

### 5.4 Cross-facet exclusion

For each facet dimension `D`, counts are computed against every active filter **except** the filters in `D`.

```
for each dimension D:
    baseQuery = assortment scope + all active filters EXCEPT those in D
    counts[D] = aggregate(baseQuery GROUP BY D)
```

Without this, selecting `color=red` collapses the colour facet to a single option with the current result count, and the buyer cannot switch to blue without clearing the filter.

Cost: one aggregation per dimension over the filtered set — four SQL `GROUP BY` dimensions (`categories`, `tags`, `options`, `productTypes`) plus `priceRange`, which is computed over resolved prices (§6.3) — run with `Promise.all`. A dimension with no active filter anywhere in the request shares the base query — in the common no-filters-applied case the SQL dimensions collapse to one aggregation. The availability dimension is not an SQL aggregation: it is counted over the page's already-resolved availability (§4.1, §5.3), so cross-exclusion does not apply to it.

### 5.5 `StorefrontPage`

```typescript
type StorefrontPageRef = {
  slug: string
  locale: string
  title: string
  updatedAt: string
}

type StorefrontPage = StorefrontPageRef & {
  body:
    | { format: 'html'; value: string }          // sanitized server-side — R10
    | { format: 'blocks'; value: BlockNode[] }   // merchandising block nodes, spec 8 §5
  seo: {
    title: string | null
    description: string | null
    canonical: string | null
    noindex: boolean
  }
  publishedAt: string | null
  versionRef: string | null
  requestedLocale: string
  effectiveLocale: string
}
```

**`body` is a discriminated union, and that union is the point of this type.** The minimal source returns `html`; a CMS returns `blocks`, reusing the node shape merchandising already defines and the reference storefront already renders (`BlockRenderer`, spec 10 §5.6). A client that handles both arms from the first release pays for one `switch`; a client that handles one pays for a rewrite. Clients MUST fall through an unrecognized `format` to a neutral fallback and MUST NOT render `value` as markup in that case (spec 10 §5.7, R9 there).

`versionRef` identifies the exact content served — a row version under the minimal source, a revision id under a CMS. It exists so an acceptance of terms can be tied to the text actually shown at the time. Nothing consumes it yet; §14 OQ5 records why that is a deliberate stop rather than an omission.

Locale resolution follows §7 unchanged: a page absent in the requested locale falls back and reports `requestedLocale` alongside `effectiveLocale` rather than returning `404`.

---

## 6) Pricing

### 6.1 Resolution

Per response, in batch: collect every product and variant id, load their `CatalogProductPrice` rows (`catalog_product_variant_prices`) in one query through `findWithDecryption`, and resolve each with `selectBestPrice(rows, pricingContext)` (via `catalogPricingService`) in memory. Never per item.

**The row query MUST be narrowed by `buildPriceRowFilter(pricingContext)`** (`pricing-engine.md` → Data Model → Row narrowing, Phase 2), not fetched by product id alone (added 2026-09-16). Fetching by product id returns every contracted customer's rows for every product on the page — `pageSize × contracts` rows to keep a handful — and does so without tripping §10's query-count budget, because the number of queries is unchanged and only the row count explodes. The predicate is sound in one direction by contract (it never hides a row `matchesContext` would accept), so narrowing cannot change the resolved price. This surface is the reason that predicate exists; it is required here, not optional. `buildPriceRowFilter` is on `develop` with its property test but has no production caller yet, and the partial indexes it is written for (`pricing-engine.md` Phase 2b) are **not** shipped — Phase 2b is a prerequisite of this spec's Phase 1 (§13), and its index predicate must first drop `deleted_at`, a column `catalog_product_variant_prices` does not have.

`pricingContext` is built from `BuyerContext` directly, in `ecommerce/lib` (`buildStorefrontPricingContext`) — not through `catalog`'s `buildPricingContext`, which parses the admin list query and sets neither `customerGroupIds` nor `currencyCode`:

```typescript
{
  channelId: ctx.channel?.salesChannelId ?? null,
  priceKindId: ctx.buyer.priceKindId,              // already resolved: group-terms override, else channel default (SPEC-029 §6)
  customerId: ctx.buyer.customerId,                // person ?? company (SPEC-029 §6)
  customerIds: ctx.buyer.customerIds,              // person first, then company — both match personal rows
  customerGroupIds: ctx.buyer.customerGroupIds,    // priority-ordered, per spec 1 §7.1
  currencyCode: ctx.currencyCode,
  quantity: 1,                                     // list/detail; tiers resolved separately
  date: now,
}
```

**`priceKindId` and `customerIds` are new, additive `PricingContext` fields (amended 2026-10-05, D2/D3).** Verified on `develop`: `PricingContext` (`catalog/lib/pricing.ts:11-25`) has neither, and `matchesContext`/`selectBestPrice` never filter by price kind — the kind only contributes to the score by its code (`custom`/`tier`/`promotion`). Without the filter, a group-terms price-kind override would change nothing about which row wins, and the `taxMode` SPEC-029 §6.1a derives from the resolved kind could label an amount from a row of the *other* `displayMode`. `pricing-engine.md` owns the type shape and is amended alongside this revision:

- `priceKindId?: string | null` — when set, rows of any other price kind are excluded, in `matchesContext` and in `buildPriceRowFilter` alike (the soundness invariant is extended to cover it). Contract rows must therefore be authored against the price kind the buyer resolves to; that is stated in the admin price-rule UI. Rows of a promotional kind (`CatalogPriceKind.isPromotion`) are the one exception and are admitted as an overlay (owner decision D2a, 2026-10-06), so `scorePrice` selects a promotion exactly as the admin path does; `originalAmount` is then the best non-promotional row of the resolved kind from the same batch, the amount is read on the buyer's `taxMode` side, and §5.1's Omnibus gate still decides whether the promotion is presented.
- `customerIds?: string[]` — a personal row matches if its `customer_id` is any of the ids; among equally-scored rows, a row scoped to the **person** beats one scoped to the **company** (owner decision D3a). `customerId` keeps its meaning for existing callers.

Because the selected row is now of the resolved price kind (or a promotional overlay row read on that kind's tax side), the kind's `displayMode` and the presented amount agree by construction — the property §6.2 depends on.

### 6.2 Tax display

`ctx.buyer.taxMode` decides whether `amount` carries tax. It is derived for **every** buyer, anonymous included, from the resolved price kind's `CatalogPriceKind.displayMode` (`'excluding-tax' → 'net'`, `'including-tax' → 'gross'`) exactly as `SPEC-029` §6.1a specifies; `store.settings.display.priceDisplayModeDefault` applies only when no price kind resolves at all (a misconfigured channel). An earlier revision of this section said anonymous buyers use the store default — that contradicted §6.1a and is withdrawn (2026-10-05).

`amount` is taken from the selected row's `unitPriceNet` or `unitPriceGross`, whichever `taxMode` names. Where the row supplies only the other side, it is derived through the applicable `SalesTaxRate` (`sales_tax_rates.customer_group_id` is single-valued): the rate of the highest-priority group in `customerGroupIds` order that has one wins, otherwise the ungrouped rate (spec 1 §7.2).

### 6.3 Price sorting and range faceting

Both need resolved prices, which are buyer-dependent, so neither can be a plain SQL `ORDER BY` on a price column.

Approach: resolve prices for the filtered id set, then sort and paginate in memory. Bounded by capping the pre-sort id set at 5 000 products. A catalogue of that size with per-customer contract pricing needs a materialized price projection, whose shape is fixed by roadmap ADR-9 and whose implementation is a separate spec.

**What happens past the cap is a per-channel policy, not one fixed fallback (amended 2026-09-16).** The original single fallback — sort by the default price kind's rows, set `X-Sort-Approximate: true` — is right for a B2C catalogue, where list prices and the buyer's prices are the same numbers and "approximate" is an honest word for the result. It is wrong for a contracted B2B buyer whose *entire* catalogue is negotiated: sorting their page by list price does not approximate their price order, it is unrelated to it, and the only signal is a response header no shopper will ever see.

New column on `EcommerceStoreChannelBinding` (amends `SPEC-029` §5.3, alongside `require_authentication` from `buyer-scoped-catalog-visibility.md` §4.2):

| Column | Type | Default | Behavior past the cap |
|---|---|---|---|
| `price_sort_fallback` | text | `'approximate'` | `'approximate'` — today's behavior: sort by the default price kind, `X-Sort-Approximate: true`. `'unavailable'` — `price_asc`/`price_desc` are **not offered**: the sort option is absent from the response's available sorts, and requesting it explicitly returns the default sort with `X-Sort-Unavailable: true` rather than a wrong order. |

Either way the offered set is carried in the response's `availableSorts`, and what the server actually did in `appliedSort` (§4.1) — the policy is not something a client can be expected to know or to mirror in its own literal option list.

`'approximate'` stays the default, so nothing changes for an existing or B2C channel. An operator running a contract-priced B2B channel sets `'unavailable'`, and loses a feature instead of shipping a price ranking that lies. Returning the default sort rather than a `400` is deliberate: a buyer who lands on a shared `?sort=price_asc` URL should get the catalogue, not an error.

**Not hidden:** the 5 000 cap, the active policy and which of the two headers was set are surfaced in the response and in the admin diagnostics, per the roadmap's no-silent-caps rule.

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
| Option schema | option `label`, choice `label` — **requires the catalog extension below** |

Fallback chain: requested locale → `store.defaultLocale` → base entity field. Never an empty string — an untranslated product shows its base title, not a blank card. Overlays are applied with `applyTranslationOverlays` (`translations/lib/apply.ts`); `batchLoadTranslations` matches the organization exactly (`organization_id IS NOT DISTINCT FROM`), so a translation stored only at tenant level does not apply to an organization's store — stated rather than worked around here.

Option and choice labels are included because facet labels come from them; without translation the Polish storefront shows an English colour facet. **They are not translatable today (verified 2026-10-05, D20):** `catalog/translations.ts` declares only the option schema's `name` and `description`, not the per-option labels or choice labels nested in its `schema` jsonb. An additive extension of `catalog/translations.ts` (plus the matching translation-editor UI) that addresses those nested labels by option and choice code is a **prerequisite of Phase 2** (facets), owned by `catalog`.

---

## 8) Search

### 8.1 Phase 1 — `ILIKE`

Escaped, case-insensitive match over `title`, `subtitle`, `description`, `sku`, `handle`, ranked with `catalog`'s existing `scoreProductSearchRelevance`. Applied within the assortment scope.

### 8.2 Phase 3 — `@open-mercato/search` (`tokens` + `pgvector`)

`catalog` already ships a `search.ts` `SearchModuleConfig`. The storefront reuses that index, filtered by the effective assortment **before** ranking, so a restricted B2B buyer never sees a relevance-ranked list containing products they cannot buy.

**"Before ranking" means inside the query, not after retrieval (clarified 2026-09-16).** Retrieving the index's top-k and then dropping the out-of-assortment rows is correct but starves: a buyer whose scope admits 5% of the catalogue gets a top-50 retrieval that leaves two or three results, and no amount of paging recovers the rest. The scope predicate and the ranking can share one query only when the strategy runs where the predicate can be evaluated, and only if the predicate is expressible against the indexed document — which is exactly what §3.3's `scope_keys` buys. The two are one decision, not two.

**Which strategies the storefront uses (corrected 2026-10-05, D19).** An earlier revision said "this platform's search strategies run over Postgres". That holds for two of the three: the `tokens` strategy (Kysely over Postgres) and the `vector` strategy with its `pgvector` driver. The `fulltext` strategy's default driver is **Meilisearch**, an external engine whose index exposes only `_entityId` and `_organizationId` as filterable attributes (`packages/search/src/fulltext/drivers/meilisearch/index.ts:110`), so the scope predicate cannot be pushed into it. Storefront search therefore uses **`tokens` and `pgvector` only**, each with the `scope_keys` predicate in the same query as the ranking. The `fulltext` (Meilisearch) strategy is excluded from storefront search until `scope_keys` is pushed to it as a filterable attribute (§14 OQ9); a deployment whose only configured strategy is Meilisearch falls back to the Phase 1 `ILIKE` path for the storefront, not to a post-filtered Meilisearch result. The `chromadb`/`qdrant` vector drivers are excluded for the same reason as Meilisearch.

§12 asserts the starvation case directly: a search whose unrestricted top-k would be dominated by out-of-assortment products still returns a full page of in-assortment results for the restricted buyer.

### 8.3 One response shape

The `ILIKE` path and the `@open-mercato/search` path return identical payloads. The client never learns which backend is active. Switching is a deployment concern, and a client that branches on it would break at the switch.

---

## 9) Caching & Rate Limiting

| Endpoint | TTL | Key | Notes |
|---|---|---|---|
| `/products` items + `priceRange` | 30s | `digest` + normalized query | `stale-while-revalidate: 30` |
| `/products` count facets (`categories`/`tags`/`options`/`productTypes`) | 30s | `assortmentScopeHash` + normalized query, **excluding price/tax/customer fields from the digest** | See "Facet cache split" below — R2's cost optimization; safe only because these counts don't depend on price. The `availability` facet is page-scoped (§4.1) and is cached with `items` |
| `/products/:idOrHandle` | 60s | `digest` + product id | |
| `/categories` | 300s | `digest` + params | |
| `/categories/:slug` | 60s | `digest` + slug + query | |
| `/search/suggest` | 30s | `digest` + `q` + limit | |
| `/pages` *(Phase 4)* | 300s | `storeId` + effective locale | Not buyer-keyed (§4.6) |
| `/pages/:slug` *(Phase 4)* | 300s | `storeId` + effective locale + slug | Not buyer-keyed; `public` at the HTTP layer in both auth states |

Every key is built through `buildStorefrontCacheKey(ctx, parts)` (SPEC-029 §6.1), which requires the `StoreContext` and therefore the digest. Concretely, every read and write goes through the typed accessor `storefrontCache(ctx)` in `ecommerce/lib/cacheKeys.ts` — the only file in the module allowed to resolve the DI `cache` — so this spec's `lib/storefront*.ts` files never hold a raw cache handle (SPEC-029 §6.1 Enforcement, 2026-10-05). There are **two deliberate exceptions**, both of which still go through the helper rather than around it: the count-facets row keys on `assortmentScopeHash` (a documented sub-component of the digest, not an ad hoc value), and the two `/pages` rows key on the store id and effective locale, both likewise `StoreContext` fields. The page exception is safe for a different reason than the facet one — not "these fields happen not to vary by buyer" but "this payload has no buyer-dependent field in it at all" (§4.6), which is enforced by the contract test in §12 rather than assumed.

**These are exceptions to the default key, not exceptions to the rule (amended 2026-09-16).** Roadmap ADR-7 now requires every cache, projection and index key in this suite to be built from `BuyerContext`'s **named** scope components — `assortmentScopeHash`, `priceScopeKey`, `customerOverlayId` — rather than from a digest of the whole context where a named component would do. The count-facet exception below is the first instance of that rule, arrived at reactively; it is now the general case. Concretely, for this document: a surface that varies only with the assortment keys on `assortmentScopeHash`; a surface that varies with price but not with an individual contract keys on `priceScopeKey`; only a surface that genuinely varies per contracted buyer takes `customerOverlayId`, and that component is `null` for the majority of authenticated B2B buyers, who have no price rows of their own and may therefore share entries with their whole group. Keying those buyers on a whole-context digest is what an opaque digest silently costs.

**`customerOverlayId` covers person and company (2026-10-05, D3).** A buyer now carries `customerIds` — the person and the company they buy for, person first. `customerOverlayId` is `null` when **none** of those ids has price rows of its own, and otherwise a stable key of the ids that do (person first, `','`-joined). A buyer whose company holds a contract therefore shares the overlay entry with every colleague buying for that company who has no personal rows; a buyer with personal rows gets an entry of their own. Both still collapse to the group bucket when neither id holds a contract.

### 9.1 Facet cache split (fixed 2026-08-17)

An earlier draft cached the entire `StorefrontFacets` block — `priceRange` included — by `assortmentScopeHash` alone (§11 R2's optimization), on the reasoning that buyers sharing an assortment scope can share facet counts. That reasoning holds for `categories`/`tags`/`options`/`productTypes`, which are genuinely price-independent counts (`availability` was in this list until it became page-scoped in rev 4, §4.1, and now travels with `items`), but not for `priceRange`, which §5.3 and §12 both require to reflect the requesting buyer's own resolved prices. Two buyers sharing an assortment scope but on different price kinds or with different negotiated contract prices would otherwise see each other's price-range slider bounds — the same class of disclosure R1 rates Critical, introduced by R2's own mitigation.

Fixed: `priceRange` is computed and cached with the `items` response (full `digest`), not with the count facets. The count-facet cache split by `assortmentScopeHash` is unchanged and still delivers R2's win for the expensive part (the SQL facet aggregations collapsing to a shared cache entry across same-assortment buyers) — only the one buyer-priced field moves.

Authenticated responses are `Cache-Control: private, no-store` at the HTTP layer while still using the **server-side** cache keyed on the digest. The two are distinct: shared server caching keyed per buyer context is safe; shared browser or CDN caching is not.

Invalidation tags and the events that fire them (event IDs verified against `catalog/events.ts`, `availability/events.ts`, 2026-10-05):

| Tag | Invalidated by |
|---|---|
| `catalog-product:{id}` | `catalog.product.created\|updated\|deleted`, `catalog.variant.created\|updated\|deleted` (by the variant's product) |
| `catalog-category:{id}` | `catalog.category.created\|updated\|deleted` |
| `catalog-price:{productId}` | `catalog.price.created\|updated\|deleted` (singular — an earlier revision of the suite wrote `catalog.prices.create`, which does not exist) |
| `ecommerce-store:{storeId}` | `ecommerce` store and binding events (SPEC-029 §9.4) |
| `availability:{tenantId}:{variantId}` | `availability.policy.created\|updated\|deleted`, plus the active provider's own stock signals |
| `content-page:{storeId}:{slug}`, `content-pages:{storeId}` | *(Phase 4)* the content source's publish signal |

**TTL-only staleness, stated rather than hidden.** `catalog` emits **no** events for tags, offers, price kinds or option schemas. A tag rename, an offer edit, a price kind's `displayMode` change or an option-label change is therefore picked up when the affected entries expire (30–300 s per the table above), not on write. That bound is accepted for this release; adding those events to `catalog` is additive and would let the tags above be extended without changing this contract.

Page invalidation is the source's responsibility to trigger and the route layer's to tag — a replacement source that publishes without emitting the tag serves stale legal copy for up to five minutes, so the contract suite (§12) asserts that a publish is observable on the next read.

**Rate limits** (per IP, per store). Enforced with `checkRateLimit(rateLimiterService, config, key, …)` from `@open-mercato/shared/lib/ratelimit` with the key `ip:storeId` (`getClientIp` for the IP, honouring the configured trusted-proxy depth), configured through `readEndpointRateLimitConfig` so operators can tune each limit by environment. The declarative `rateLimit` route metadata is not used here because it keys by IP alone. Posture is **fail-open**: if the rate limiter is unavailable, the request is served and the failure logged — a read-only catalogue outage is worse than a missed limit (precedent: `directory/api/get/organizations/lookup.ts`).

| Endpoint | Limit |
|---|---|
| `/products` | 120/min |
| `/products/:idOrHandle` | 240/min |
| `/categories` | 120/min |
| `/search/suggest` | 300/min |
| `/pages/:slug` *(Phase 4)* | 240/min |
| `/pages` *(Phase 4)* | 60/min |

Typeahead gets the highest limit because a real user types quickly; a 60/min limit would rate-limit legitimate use.

---

## 10) Performance Budgets

| Metric | Target | Conditions |
|---|---|---|
| `/products` P95, cached | < 50 ms | |
| `/products` P95, uncached | < 300 ms | 10 000 products, 5 set-wide facet dimensions + page-scoped availability (§4.1), incl. facet computation |
| `/categories/:slug` P95, uncached | < 350 ms | Category landing embedding a full `/products` response (§4.4) |
| `/products/:idOrHandle` P95, uncached | < 200 ms | Configurable product with 20 variants |
| `/categories` P95, uncached | < 150 ms | 500-category tree |
| `/search/suggest` P95 | < 120 ms | Typeahead budget |
| `/pages/:slug` P95, uncached | < 100 ms | Single page, one locale overlay |
| `/pages` P95, uncached | < 150 ms | 200 published pages |
| Query count, `/products` | ≤ 13 | 1 scope + 1 products + 1 prices + 1 translations + 1 availability state + 1 availability policies + ≤ 5 facets + 1 media |
| Query count, `/products/:id` | ≤ 7 | Independent of variant count |
| Query count, `/pages/:slug` | ≤ 3 | 1 scope + 1 page + 1 translation overlay |

Query counts are asserted in tests. A per-item query is a defect regardless of wall-clock time on a small fixture — it only shows up in production.

---

## 11) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Contract pricing served to the wrong buyer | **Critical** | `ecommerce` | A `/products` response cached without the digest, or an authenticated response cached by a CDN, serves ACME's negotiated prices to an anonymous visitor or a competitor. | All keys via `buildStorefrontCacheKey`, through the typed `storefrontCache(ctx)` accessor — the only place in `ecommerce` allowed to resolve the DI `cache`, enforced by SPEC-029's module-wide structural guard (§6.1, rewritten 2026-10-05); authenticated responses `private, no-store`; a cross-context isolation suite is a Phase 1 gate; a CDN configuration note ships with the spec | Low |
| R2 | Facet cost under B2B | **High** | `ecommerce` | Five set-wide facet aggregations per uncached listing request, and per-buyer caching means low hit rates exactly for the buyers whose queries are most expensive. | Dimensions without an active filter share one base query; facets computed with `Promise.all`; the scope predicate is one GIN-indexed overlap per branch (§3.3); the count-facet block (`categories`/`tags`/`options`/`productTypes` — price-independent) is cached separately from items, keyed on the assortment-scope hash rather than the full digest; `priceRange` is excluded from that split and cached with `items` on the full digest instead (§9.1, fixed 2026-08-17 — bundling it into the assortment-hash cache would have leaked one buyer's price range to another sharing the same assortment scope) | Medium — a tenant with many distinct assortment scopes still pays for count facets; measured at the Phase 1 gate |
| R3 | Price sort degrades silently | Medium | `ecommerce` | Above 5 000 matching products, price sort falls back to the default price kind and a contracted B2B buyer sees an order unrelated to their prices, signalled only by a response header no shopper reads. | Per-channel `price_sort_fallback` policy (§6.3, amended 2026-09-16): `'approximate'` keeps the header-signalled fallback for B2C, `'unavailable'` withdraws the sort option entirely rather than showing a wrong order. Plus the documented cap and admin diagnostics. | Low for a channel set to `'unavailable'`; Medium and accepted for `'approximate'`, where the fallback is honest about B2C prices. A materialized price projection (roadmap ADR-9) remains the real fix and is out of scope here |
| R13 | Price fetch unbounded under contract pricing | **High** | `ecommerce`, `catalog` | §6.1 fetches price rows by product id, so a listing page for a tenant with 2 000 contracted customers loads ~48 000 rows to keep two dozen. The ≤ 13-query budget still passes — the query count is unchanged — so the regression is invisible to §10's own gate and shows up only as latency that scales with B2B adoption. | §6.1 requires `buildPriceRowFilter` (`pricing-engine.md` Phase 2, on `develop`) rather than a fetch by product id; the partial indexes it needs (`pricing-engine.md` Phase 2b, **not yet shipped**, predicate to be corrected — no `deleted_at` on the table) are a **Phase 1 prerequisite** (§13), not a follow-up; a row-count assertion, not just a query-count assertion, is added to the §12 performance gate | Medium — bounded per buyer, not eliminated; elimination is ADR-9's projection |
| R14 | Search starvation under a restrictive scope | Medium | `ecommerce`, `search` | A restricted buyer's search retrieves top-k from the index and post-filters it down to two results on a page of 24, looking like an empty catalogue rather than a filtered one. | §8.2: the scope predicate is pushed into the ranking query of the `tokens` and `pgvector` strategies, which §3.3's `scope_keys` makes expressible; Meilisearch (filterable only on entity/org) is excluded from storefront search rather than post-filtered; §12 asserts a full page of in-assortment results for a buyer whose unrestricted top-k would be dominated by hidden products | Low |
| R15 | Page-scoped availability filter misread | Medium | `ecommerce`, storefront clients | A client treats `total` as the number of in-stock products, or stops paginating at the first short page, after `?availability=in_stock` (§4.1, D21). The buyer sees "120 results" with nine on page one, or misses in-stock products on later pages. | `appliedFilters.availability.scope` and `facets.availabilityScope` say `'page'` in the payload; §4.1 states the continuation rule (`page < totalPages`); `storefront-app.md` renders a "showing in-stock items on this page" note from those fields; §12 asserts short pages and an unchanged `total` | Medium — accepted until a stock projection exists (§14 OQ8) |
| R16 | Stale `scope_keys` after a category re-parent or tag deletion | Medium | `catalog`, `query_index` | A category moves under a restricted parent, but products in its subtree keep their old ancestor keys until reindexed, so a restricted buyer still sees them — or loses them — in listings, facets and search. Tags have no events, so a deleted tag's key lingers until the next reindex of each product. | Reindex triggers in §3.3 (re-parent → whole subtree; product create/update; category delete); the periodic coverage job catches tag deletions; tenants whose backfill has not completed fail closed; the matchesScope ≡ SQL property test plus a named re-parent fixture (§12) | Low for categories; Medium for tags until `catalog` emits tag events |
| R4 | Handle enumeration oracle | **High** | `ecommerce` | Probing `/products/<handle>` distinguishes "restricted" from "nonexistent" by status code, body or timing, mapping a competitor's private assortment. | Identical `404` body for all four cases; assortment filtering happens inside the same query rather than as a post-check, so timing does not diverge; a timing test asserts no measurable difference | Low |
| R5 | Stored XSS via product description | **High** | `ecommerce` | A back-office user with catalogue access stores `<img onerror=…>`; every storefront visitor executes it. | Server-side allowlist sanitization (`sanitizeRichTextHtml`) before the field leaves the API; the client renders sanitized HTML; sanitizing client-side would trust every client equally | Low |
| R6 | Unknown query parameters ignored | Medium | `ecommerce` | A client sends `?categoryID=` (wrong case); the server ignores it and returns the whole catalogue, which the UI presents as filtered results. | Unknown parameters rejected with `400`; `appliedFilters` echoes the server's interpretation | Low |
| R7 | Omnibus non-compliance | Medium | `ecommerce`, legal | A promotional price is shown without the lowest prior price from the preceding 30 days, which EU law requires. | `lowestPriorAmount` is part of the price contract and sourced from the Omnibus implementation, which is a **Phase 1 prerequisite** (D11, §5.1) — nothing on `develop` implements it today; a promotional item without it fails a contract test | Low, once the prerequisite ships; the storefront does not launch before it |
| R8 | Translation overlay N+1 | Medium | `ecommerce` | Overlay applied per entity turns a 24-product page into 200+ lookups. | Batch helpers, one call per response; query count asserted (§10) | Low |
| R9 | Facet counts leak restricted assortment | Medium | `ecommerce` | Counts computed before the assortment intersection tell a restricted buyer how many products exist outside their scope. | `buildStorefrontProductScope` is the base of every aggregation, facets included; test asserts counts equal the visible set | Low |
| R10 | Stored XSS via content-page HTML | **High** | `ecommerce`, `content` | An author — or a payload migrated in from a CMS — stores `<img onerror=…>` in a page body, and every visitor to a public legal page executes it. | R5's sanitizer is necessary but not sufficient here: a content page is *deliberately* author-controlled HTML, its reach is site-wide (footer-linked from every page) and its authors are the least technical in the system. `body.value` is sanitized with the server-side allowlist **in the route layer**, applied to whatever `contentPageSource` returned rather than trusted from it; `blocks` payloads are sanitized node by node; a swapped source cannot opt out because it never touches the response | Low |
| R11 | Draft page disclosure by slug probing | Medium | `ecommerce`, `content` | Probing `/pages/<slug>` distinguishes "draft" from "nonexistent", exposing an unreleased campaign page or a pending terms revision before its effective date. | Identical `404` for draft, scheduled, soft-deleted and nonexistent; the publication filter sits inside the source's query rather than in a post-check, so timing does not diverge (§4.7); asserted by test | Low |
| R12 | A swapped source bypasses the invariants | **High** | `ecommerce`, `content` | A CMS module — or an app `overrides.di` binding — registers a `contentPageSource` that forgets tenant scoping, returns drafts, or emits unsanitized HTML, and the storefront serves it. This is the standing cost of making the source pluggable. | Scoping, publication filtering and sanitization live in the route layer over the source's output, never inside the implementation (§3.4); the §12 contract suite runs against **every** registered implementation and is a merge gate for a new one; the sole in-process consumer (merchandising's admin target resolver) reads `StorefrontPageRef`s only and never renders `body`, so it does not sit outside the sanitization boundary | Medium — the gate is a test convention, and a downstream app that binds its own source in `modules.ts` is outside this repo's CI; documented as an override requirement rather than assumed |

---

## 12) Integration Coverage

**Assortment and isolation:**
- Products from another tenant never appear, via any endpoint or facet count
- Channel scope ∩ group scope applied to items, facets and category counts (R9)
- Inactive, deleted and out-of-assortment products all return an identical `404` from `/products/:idOrHandle`, with no timing divergence (R4)
- **`scope_keys` re-parent staleness (R16):** move a category under a parent excluded from a buyer's scope; after the reindex trigger fires, products anywhere in the moved subtree disappear from that buyer's listing, facets and search, and the in-memory `matchesScope` agrees with the SQL predicate for every product in the fixture
- A tenant whose `scope_keys` backfill has not completed fails closed for a restricted buyer (no product served), never evaluates against key-less documents (§3.3)

**Buyer-dependent pricing:**
- Anonymous and authenticated B2B requests to the same URL return different prices from the same fixture
- Group price row wins over channel default; personal customer price wins over group
- **Price-kind filter (D2):** a buyer whose group terms override the channel's price kind gets the row of the *overridden* kind even when a higher-scored row of the channel kind exists, and `taxMode` matches that kind's `displayMode`; removing the override switches both the selected price and `taxMode` back
- **Person vs company (D3a):** a buyer whose person and company both hold an equally-scored contract row for the same product gets the person's row; with only the company's row, every colleague buying for that company gets it and shares the overlay cache entry
- The narrowed price fetch (§6.1) and an unnarrowed fetch by product id resolve to the **same** price, for a buyer with a contract row and for one without (R13)
- The price-row count fetched for a listing page does not grow with the number of *other* customers' contract rows on those products — asserted as a row count, not only as a query count, since the query count is what R13 slips past
- `price_sort_fallback: 'unavailable'` past the 5 000 cap omits `price_asc`/`price_desc` from `availableSorts` and returns the default order with `X-Sort-Unavailable: true`; `'approximate'` returns the fallback order with `X-Sort-Approximate: true` (§6.3)
- `?sort=price_asc` against a channel offering neither resolves to the default order with `appliedSort` naming it — not a `400`, and not an `appliedSort` echoing the unhonoured request (§4.1)
- Two buyers in the same groups with the same channel/currency/price kind, neither holding contract rows, resolve to the same `priceScopeKey` and share a cache entry; giving one of them a single contract row moves only that buyer off the shared entry (§9, ADR-7)
- `taxMode: 'net'` returns net amounts; `'gross'` returns gross; an anonymous buyer's `taxMode` follows the channel price kind's `displayMode`, and `priceDisplayModeDefault` applies only when no price kind resolves (SPEC-029 §6.1a)
- `priceTiers` reflects `min_quantity` / `max_quantity` rows for the buyer's context
- `lowestPriorAmount` present on promotional items (R7)
- Two buyers in different groups never share a cache entry (R1)

**Facets:**
- Cross-exclusion: with `color=red` selected, the colour facet still lists blue with a nonzero count
- Category counts include descendants
- Price range reflects the buyer's resolved prices, not list prices
- **Two buyers sharing an assortment scope but on different price kinds never see each other's `priceRange`, even though they share the same count-facet cache entry** (regression test for the fixed §9.1 cache split)
- With no filters applied, the count-facet block issues one SQL aggregation, not one per dimension (R2)
- The availability facet carries `availabilityScope: 'page'` and its counts sum to the page's item count before the availability filter

**Localization:**
- Overlay applied to titles, descriptions, category names, tag labels, option and choice labels (the latter through the catalog translation extension, §7.2)
- Fallback chain never yields an empty string
- Unsupported locale falls back with both `requestedLocale` and `effectiveLocale` returned

**Availability:**
- State comes from `resolveAvailability`; a `wms`-less environment returns `not_tracked` throughout
- Page-scoped filter (D21, R15): `availability=in_stock` removes backorder and out-of-stock items **from the returned page only** — the page may hold fewer than `pageSize` items (including zero), `total`/`totalPages` equal the unfiltered values, `appliedFilters.availability.scope` is `'page'`, and requesting the next page continues to work while `page < totalPages`; `available` keeps backorder/preorder items
- `quantityRules` come from the resolved `AvailabilityPolicy` (via `policyResolutionService.resolveMany`), in one batched call per response

**Search:**
- `ILIKE`, `tokens` and `pgvector` paths return identical shapes for the same fixture
- Results are assortment-filtered before ranking
- **Meilisearch not used (D19):** with the `fulltext` strategy configured on Meilisearch, storefront search never queries it — it uses `tokens`/`pgvector` when configured, else the `ILIKE` path
- A restricted buyer searching a term whose unrestricted top-k is dominated by out-of-assortment products still receives a full page of in-assortment results — the scope predicate is part of the ranking query, not a post-filter over its output (R14, §8.2)
- `q` shorter than 2 characters returns empty, not an error

**Content pages** *(Phase 4)*:
- A published page resolves by slug and returns `StorefrontPage`; an unpublished, scheduled, soft-deleted and nonexistent slug all return an identical `404` with no timing divergence (R11)
- A page absent in the requested locale falls back, returning `requestedLocale` ≠ `effectiveLocale` rather than a `404`
- A script payload stored in an `html` body does not reach the client (R10); a `blocks` body is sanitized node by node
- **Two buyers in different customer groups receive byte-identical page responses and share one cache entry** — the §4.6 non-buyer-aware boundary asserted rather than assumed
- A slug that exists in another tenant returns `404`
- `/pages` lists only published pages, paginates by cursor, and its items resolve one-for-one through `/pages/:slug`
- A publish is observable on the next read — the invalidation tag fires (§9)
- **Contract suite:** every assertion in this block runs against *each* registered `contentPageSource` implementation, not just the shipped one (R12), so a future CMS source is held to the minimal source's guarantees before it can be bound

**Contract and safety:**
- Unknown query parameter returns `400` (R6)
- `pageSize` above 100 is rejected
- Malicious HTML in a description is sanitized before it leaves the API (R5)
- Every endpoint exports `openApi` and the emitted schema matches the actual response shape

**Performance:** query counts per §10 asserted against a 200-variant, 10 000-product fixture.

---

## 13) Implementation Phases

### Phase 1 prerequisites (added 2026-10-05)

None of these exist on `develop`; each is its own PR, landing before Phase 1 code:

1. **`pricing-engine.md` amendment + Phase 2b** — `PricingContext.priceKindId` and `.customerIds` with the extended `buildPriceRowFilter` soundness test (D2, D3); the Phase 2b partial indexes, with their predicate corrected (no `deleted_at` on `catalog_product_variant_prices`).
2. **Omnibus price tracking** (D11) — the authoritative document chosen between `SPEC-033-2026-02-18-omnibus-price-tracking.md` and `2026-06-30-omnibus-price-tracking.md`, pre-implementation-audited, and shipped far enough to supply `lowestPriorAmount`.
3. **`scope_keys` pre-step** (D9, §3.3) — `query_index` enrichment hook, `catalog` contributor, GIN index, `overlap` filter operator, reindex triggers, backfill job.
4. **Catalog filter extraction** — `buildProductFilters` + its query type into `catalog/lib/productFilters.ts` with the route re-export; descendant-expansion option. Admin `/api/catalog/products` integration tests unchanged and green.
5. **`SPEC-029` Phase 1** — `StoreContext`/`BuyerContext`, `buildStorefrontCacheKey` and the typed `storefrontCache(ctx)` accessor with its structural guard.

### Phase 1 — Listing and detail
`buildStorefrontProductScope` over `scope_keys`, `lib/storefrontPricing.ts` (`buildStorefrontPricingContext`), `lib/storefrontProducts.ts`, `lib/storefrontDetail.ts`, batched narrowed pricing, availability (`resolveAvailability` + `policyResolutionService.resolveMany`, page-scoped filter), translation overlay, `/products` and `/products/:idOrHandle`, `ILIKE` search, caching.

**Gate:** cross-context isolation suite passes; query-count and row-count budgets met; the enumeration-oracle test shows no divergence; the `matchesScope` ≡ SQL property test passes.

### Phase 2 — Facets and categories
`lib/storefrontFacets.ts` with cross-exclusion, `lib/storefrontCategories.ts`, `/categories`, `/categories/:slug`.

**Prerequisite:** the `catalog/translations.ts` extension making option and choice labels translatable (D20, §7.2).

**Gate:** facet counts match the visible set; the no-filter case issues one SQL aggregation; option facets render translated labels.

### Phase 3 — Search and hardening
`/search/suggest`, `@open-mercato/search` integration through the `tokens` and `pgvector` strategies with the scope predicate in the ranking query (D19, §8.2), rate limiting via `checkRateLimit`, OpenAPI, performance profiling. Meilisearch is out of scope.

**Gate:** `ILIKE`, `tokens` and `pgvector` produce identical payloads; the starvation test passes on both search strategies; rate limits verified; budgets met at scale.

### Phase 4 — Content pages
The `ContentPageSource` contract and its DI binding, the minimal implementation in `content`, `/pages` and `/pages/:slug`, route-layer sanitization and publication filtering, caching and invalidation tags, the shared contract suite.

**Gate:** the contract suite passes against the shipped source; the draft-probe test shows no divergence; a page response carries no buyer-dependent field, asserted rather than reviewed.

Phase 4 is independent of Phases 2 and 3 and can ship alongside either — it touches no product query. It is last only because a storefront can launch without an "about us" page and cannot launch without a catalogue.

**Not in this spec:** the minimal source's entity, migrations, admin CRUD and locale handling are `content` module scope and want their own spec. This spec owns the contract and the endpoints, not the storage — which is the same separation that makes the source replaceable in the first place, so collapsing the two would defeat §3.4.

---

## 14) Open Questions

1. **Sitemap and robots** — `sitemap.xml` per store, driven by the assortment. Belongs here (server-generated, always current) or in spec 10 (Next.js route). *Leaning here; the app cannot enumerate the assortment without paginating this API.* **Divergence to reconcile:** spec 10 §4 already states the app generates both natively, treating the question as settled the other way. Whichever side wins, this surface owes the data — `/pages` (§4.6) supplies the static-page half.
2. **Materialized price projection** — the real fix for R3. Needs its own spec once a tenant hits the cap.
3. **Product recommendations** — `relatedProducts` is "same category, limit 8". Anything better belongs to spec 8 (merchandising) with curated and rule-driven sets.
4. **Media transformation** — `defaultMediaUrl` is a raw URL; responsive images need width variants. `storage-s3` may already offer this; unverified.
5. **Consent-to-terms versioning** — `StorefrontPage.versionRef` (§5.5) exists so an acceptance of terms can be tied to the exact text shown, which a consumer-law dispute requires and a page rendered from a git commit cannot supply. Checkout's `consent_flags` ([simple checkout](./2026-03-19-checkout-simple-checkout.md) §4) is free-form `jsonb` with no reference to it. Wiring the two is a change to that spec and is deliberately **not** made here; until it happens the field is emitted and unconsumed, which is the honest state rather than a silent gap.
6. **Migration into a CMS** — pages authored against the minimal source must be importable when a CMS module lands, and the importer is that spec's obligation. Recorded here so the requirement is inherited rather than discovered.
7. **Page-level audience targeting** — §4.6 assigns audience-targeted content to merchandising placements and keeps pages buyer-agnostic. If a merchant requirement for a genuinely B2B-only *URL* appears, that boundary is where it breaks, and the fix is a merchandising placement rather than a buyer-keyed page cache.
8. **Stock projection** (D21 follow-up, added 2026-10-05) — the page-scoped availability filter (§4.1) exists because stock is a provider call, not a column. A denormalized availability state on the product index document, kept current from `wms` signals, would make `availability=` a set-wide filter and the availability facet set-wide again. Needs its own ADR on staleness (an advisory projection vs. the authoritative check at submit, availability contract §7).
9. **Meilisearch scope attribute** (D19 follow-up, added 2026-10-05) — pushing `scope_keys` to the Meilisearch index as a filterable attribute would let the `fulltext` strategy join storefront search without post-filtering. Requires a sync path for every reindex trigger in §3.3 and lives in `packages/search`.

---

## 14a) Migration & Backward Compatibility

Added 2026-10-05. Everything below is additive; nothing existing is renamed or removed.

| Change | Surface (`BACKWARD_COMPATIBILITY.md`) | Bridge / note |
|---|---|---|
| New `GET /api/ecommerce/storefront/*` routes (Phases 1–3) | 7 API routes | New; STABLE from first release — payload field names are frozen by this spec |
| `buildProductFilters` (+ its query type, `scoreProductSearchRelevance`) moved to `catalog/lib/productFilters.ts` | 3 signatures, 4 import paths | `catalog/api/products/route.ts` keeps re-exports for ≥ 1 minor version; behaviour byte-for-byte; the descendant expansion is an opt-in option, default off |
| `PricingContext.priceKindId?`, `PricingContext.customerIds?` (owned by `pricing-engine.md`) | 2 types | Optional fields; existing callers unchanged; `buildPriceRowFilter`'s soundness property test extended to both |
| `overlap` member added to `FilterOp` | 2 types | Additive union member; third-party code with an exhaustive `switch` over `FilterOp` gets a compile error, so it is recorded in `UPGRADE_NOTES.md` |
| `query_index` doc-enrichment hook | 1 auto-discovery / 9 DI | New, optional extension point; modules that do not contribute are unaffected |
| GIN expression index on `entity_indexes`, Phase 2b price indexes | 8 DB schema | Indexes only, `CREATE INDEX CONCURRENTLY`; no column changes |
| `catalog/translations.ts` gains option and choice labels | 1 auto-discovery (translatable fields) | Additive fields; existing translations untouched |
| `scope_keys` backfill | — | A full reindex of `catalog:catalog_product` per tenant through the existing reindex job; until a tenant completes, restricted storefront reads fail closed (§3.3) |

No `ecommerce` storefront contract existed before this spec, so there is nothing to deprecate on this surface.

---

## 15) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Reads `catalog` through its exported library helpers (`catalog/lib/*`, never route modules) and the query engine; availability via `resolveAvailability` and `policyResolutionService`; price rows via `findWithDecryption` |
| Cross-module pre-steps named | `catalog`, `query_index`, `shared`, `search` changes listed in §3.3, §13 prerequisites and §14a, approved by the owner 2026-10-05 |
| Tenant/organization scoping | `buildStorefrontProductScope` composed by every endpoint, aggregations included |
| Never expose cross-tenant data | Isolation suite gates Phase 1 |
| `pageSize` ≤ 100 | Enforced, request rejected above |
| Zod validation | Query grammar validated; unknown parameters rejected |
| No `any` | Payload contracts fully typed; `z.infer` for query types |
| OpenAPI | Exported per route; schema-vs-response contract test |
| i18n | Overlays via `translations`; no hard-coded user-facing strings |
| Rate limiting | §9, per IP per store via `checkRateLimit`, fail-open |
| Cache safety | Keys via `buildStorefrontCacheKey` through the typed `storefrontCache(ctx)` accessor (SPEC-029 §6.1); authenticated responses `private, no-store`; TTL-only staleness stated where `catalog` emits no events (§9) |
| Legal (Omnibus) | `lowestPriorAmount` sourced from the Omnibus implementation, a Phase 1 prerequisite (§5.1) |
| Swappable content source | `contentPageSource` DI key (§3.4); scoping, publication filtering and sanitization enforced in the route layer, not in the implementation; the §12 contract suite gates any implementation bound under that key |
| Backward compatibility | New public API surface; the supporting `catalog`/`shared`/`query_index` changes are additive with bridges (§14a). Once published these payloads are a STABLE contract under `BACKWARD_COMPATIBILITY.md` — `StorefrontPage.body` is a discriminated union, so a new `format` arm is an additive change and clients are required to tolerate an unknown one (§5.5) |
| Integration coverage | §12, shipping in the same change |

---

## 16) Changelog

### 2026-10-06 — rev 4.1 (owner decision D2a)
- **§6.1 promotions overlay the `priceKindId` filter (D2a).** With D2's kind filter a buyer resolved to a regular kind never saw promotional rows; rows of `isPromotion` kinds are now admitted alongside the resolved kind, `originalAmount` comes from the resolved kind, and the Omnibus presentation gate is unchanged.

### 2026-10-05 — rev 4 (Phase 0 reconciliation, owner decisions)
Re-checked against `develop` @ `a108dd07f4` after Phase 0 (#6709, #6268) landed; findings in `analysis/ANALYSIS-2026-10-05-storefront-public-api.md`, decisions in `analysis/ANALYSIS-2026-10-05-storefront-release-decisions.md`.
- **§3.1/§3.2 rewritten against the seams that exist.** `PricingContext` is built in `ecommerce/lib` from `BuyerContext` — `catalog`'s `buildPricingContext` parses the admin query and never sets `customerGroupIds`/`currencyCode`. `buildProductFilters` is extracted to `catalog/lib/productFilters.ts` with a re-export bridge (its query type was local, and importing the route instantiates `makeCrudRoute`), gaining descendant expansion. Availability is `resolveAvailability` + `policyResolutionService.resolveMany` (no `availabilityService` exists); sanitizer `sanitizeRichTextHtml`; rate limiting `checkRateLimit`.
- **§3.3 `scope_keys` mechanism specified (D9).** The earlier "same indexer, no new entity" did not describe the code: the indexer has no enrichment hook, product docs hold no category/tag ids, `entity_indexes` has no GIN and `FilterOp` no overlap. Now a named cross-module pre-step (`query_index` hook, `catalog` contributor, GIN expression index, additive `overlap` operator, reindex triggers incl. category re-parent, backfill with fail-closed), with `allOf` branches as AND-of-overlaps. EXISTS-over-junctions stays forbidden.
- **§6.1 `PricingContext` gains `priceKindId` and `customerIds` (D2, D3).** On `develop` price kind is not a pricing input at all, so a group's price-kind override did nothing and the derived `taxMode` could mislabel the selected row. The kind filter makes row and `displayMode` agree by construction; person-scoped rows beat company-scoped ones on ties (D3a). Phase 2b indexes become a Phase 1 prerequisite, with their `deleted_at` predicate corrected.
- **§6.2 tax display aligned with `SPEC-029` §6.1a.** Anonymous buyers no longer use `priceDisplayModeDefault` unconditionally; multi-group `SalesTaxRate` selection stated.
- **§4.1/§5.3 availability is page-scoped (D21).** Filter and facet apply to the returned page; `total` unchanged; payload says `scope: 'page'`; new R15.
- **§5.1 Omnibus is a Phase 1 prerequisite (D11)**; nothing on `develop` implements it; the authoritative of two candidate specs is to be chosen first.
- **§7.2 option/choice labels** need an additive `catalog/translations.ts` extension (D20) — prerequisite of Phase 2.
- **§8.2 search uses `tokens` + `pgvector` only (D19).** The "runs over Postgres" premise was false for Meilisearch, which can filter only on entity/org; it is excluded until scope keys are pushed to it (OQ9).
- **§9** real catalog event IDs per invalidation tag (`catalog.price.*`, singular); TTL-only staleness stated for tags, offers, price kinds and option schemas (no events exist); `customerOverlayId` over person + company; rate-limit key `ip:storeId`, fail-open; content-page rows marked Phase 4.
- **§10** budgets: `/products` ≤ 13 queries (availability policies), new `/categories/:slug` row.
- **§11** R1, R2, R7, R13, R14 updated; new R15 (page-scoped availability misread), R16 (stale `scope_keys` after re-parent / tag deletion).
- **§12** new tests: price-kind filter, person-vs-company tie, re-parent staleness, backfill fail-closed, page-scoped availability, Meilisearch not used.
- **§13** Phase 1 prerequisites listed; Phase 2 translation prerequisite; Phase 3 on `tokens`/`pgvector`.
- **§14** OQ8 (stock projection), OQ9 (Meilisearch scope attribute). **§14a** new Migration & Backward Compatibility section. **§15** compliance rows updated.

### 2026-09-16 (b) — buyer-scoped read-path amendments
- **§6.1 now requires `buildPriceRowFilter`** rather than a fetch by product id, and R13 records why: `selectBestPrice` is pure over whatever rows the caller fetched, and the only indexes on `catalog_product_variant_prices` are by product/variant, so a listing page under contract pricing loads every contracted customer's rows for every product on it. §10's ≤ 12-query budget does not catch this — the query count is unchanged — so §12 now asserts a row count, not only a query count.
- **§4.1 gained `availableSorts` and `appliedSort`.** The sort set became server-decided the moment §6.3 became a policy, and the response had no field carrying it — leaving `storefront-app.md`'s control with nothing to read and no reason not to hard-code six options.
- **§6.3's single fallback became a per-channel policy** (`price_sort_fallback`, amending `SPEC-029` §5.3). Sorting a contracted B2B buyer's page by list price is not an approximation of their price order, and `X-Sort-Approximate` is a signal no shopper sees; `'unavailable'` withdraws the sort instead. `'approximate'` remains the default, so B2C behavior is unchanged. R3 re-rated accordingly.
- **§3.3 now fixes the scope clause's shape** — a GIN-indexed `scopeKeys` array on the product's index document, not `EXISTS` over the assignment tables. "Applied in one place" already protected correctness but not shape, and the DNF from `buyer-scoped-catalog-visibility.md` §3.3 sits in front of every query here, the six facet aggregations of R2 included.
- **§8.2 clarified that "before ranking" means inside the query**, and added R14: post-filtering a top-k retrieval starves a restricted buyer down to a near-empty page. This is the same decision as §3.3's — pushing the predicate into the ranking query is only possible because the scope is expressible against the indexed document.
- **§9 restated the two cache-key exceptions as instances of a general rule** (roadmap ADR-7, amended): keys are built from named scope components (`assortmentScopeHash`, `priceScopeKey`, `customerOverlayId`), never from a whole-context digest where a named one would do. §9.1's 2026-08-17 fix was the first, reactive instance of this; it is now the stated default.

### 2026-09-16 (a) — content pages
- Added `GET /pages` and `GET /pages/:slug` (§4.6–4.7) with the `StorefrontPage` contract (§5.5). The suite previously referenced static pages from two directions without ever defining them: spec 10 §4 routes `pages/[slug]`, and merchandising `US-N1` gives menu items a `content_page` target type — with no endpoint for either to read, and no entry in the sitemap that spec 10 generates from paginated API reads.
- Introduced the `contentPageSource` DI seam (§3.4) rather than binding the endpoints to a module. The existing `content` module hardcodes pages in React (including Open Mercato's own legal entity in `terms/page.tsx`), a CMS module is on the long-range roadmap, and a storefront bound to either would be rewritten when the other arrived. Constrained the interface to two consumer-derived methods and stated the budget explicitly, because a seam designed against an unbuilt module is the usual way to get the shape wrong.
- Made `body` a discriminated union over `html` and `blocks` so the reference storefront handles both arms before a CMS exists — the single decision that makes the swap cheap rather than theoretical.
- Declared content pages **not buyer-aware** (§4.6) and assigned audience-targeted content to merchandising placements instead, so the page store does not grow a second targeting model. The shared cache entry follows from that boundary, and §12 asserts it rather than trusting it.
- Added R10 (stored XSS via author-controlled page HTML), R11 (draft disclosure by slug probing) and R12 (a swapped source bypassing the invariants), and put scoping, publication filtering and sanitization in the route layer over the source's output so a replacement implementation cannot opt out.
- Added `versionRef` and recorded OQ5: checkout's `consent_flags` has no link to it, and wiring the two belongs to the checkout spec rather than to a quiet edit here.

### 2026-08-17
- Fixed a self-contradiction between R2's facet-caching optimization and §5.3/§12's own requirement that `priceRange` reflect the requesting buyer's resolved prices: the original draft cached the entire facet block — `priceRange` included — by `assortmentScopeHash` alone, which would leak one buyer's price range to another buyer sharing the same assortment scope but a different price kind or contract price (the same class of disclosure R1 rates Critical). Split `priceRange` out to cache with `items` on the full digest (§9.1); the count-facet cache split by `assortmentScopeHash` is otherwise unchanged and still delivers R2's win.

### 2026-08-14
- Initial specification, carrying forward SPEC-029 v3 §8, §9, §10, §12.1, §21 and the API half of §24.
- Reshaped for buyer-dependent pricing per ADR-7: prices are single resolved amounts in the buyer's tax mode rather than net/gross pairs; `priceTiers` added so B2B quantity breaks are visible; every cache key carries the buyer digest.
- Added `lowestPriorAmount` for Omnibus compliance (SPEC-033), absent from v3.
- Replaced v3's bare `availability` string union with the availability contract's object.
- Grounded reuse in existing exports: `buildProductFilters`, `buildPricingContext`, `scoreProductSearchRelevance` (`catalog/api/products/route.ts`), `selectBestPrice` (`catalog/lib/pricing.ts`), `computeHierarchyForCategories` (`catalog/lib/categoryHierarchy.ts`), the `translations` batch overlay helpers, and `catalog/search.ts`'s existing `SearchModuleConfig`.
- Added the handle-enumeration oracle (R4) and stored-XSS-via-description (R5) risks, neither of which v3 addressed.
