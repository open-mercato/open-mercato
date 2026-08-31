# Storefront Merchandising

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 3 — user stories 2026-08-31) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 8, Phase 4 |
| **Modules** | `merchandising` (new) |
| **Depends on** | [SPEC-029 Ecommerce Store Module](./SPEC-029-2026-02-17-ecommerce-storefront-module.md), [Storefront Public API](./2026-08-14-storefront-public-api.md), [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md) |
| **Related** | `content` module (static pages), [SPEC-071 SEO Helper](./SPEC-071-2026-04-06-seo-helper-validation-visibility.md) |

---

## TLDR

**Key Points:**
- A storefront that can only list products in category order is a database browser. This module adds the merchant's editorial layer: navigation, composed landing pages, banners, curated collections and cross-sell — the parts that turn an assortment into a shop.
- Everything is **audience-targetable by customer group**, which is what makes it B2B-capable: a wholesale buyer sees a different homepage, a different menu and different featured collections from a retail visitor, from the same store.
- Collections come in two flavours — **manual** (an ordered list a merchant curates) and **rule-driven** (a saved query, materialized on a schedule). Rule-driven collections are the ones that stay current without anyone touching them.
- Boundary with `content`: `content` owns standalone informational pages (privacy policy, terms, about). `merchandising` owns everything that composes or navigates the catalogue. A page with a product carousel is merchandising; a page of legal text is content.

**Scope:**
- `MerchandisingMenu` / `MerchandisingMenuItem`, `MerchandisingBlock`, `MerchandisingPlacement`, `MerchandisingCollection` / `MerchandisingCollectionItem`, `MerchandisingRecommendationRule`, `MerchandisingCategoryEnrichment`
- Audience targeting, scheduling, draft/publish and preview
- Public read API under the storefront namespace
- Admin composition UI

**Concerns:**
- A composed page fans out into several product queries; without batching a homepage becomes the slowest route in the storefront
- Audience targeting multiplies the cache key space — the digest already varies by buyer, and merchandising adds more variance on the least cacheable page
- Rule-driven collections are saved queries over a moving catalogue; a stale materialization shows discontinued products, and an eager one is a scheduled full-catalogue scan per collection

---

## 1) Overview

The public API (spec 4) answers "what products match these filters". This module answers "what should this buyer see first, and how do they get around".

It is deliberately a composition layer over the existing read API. It stores no product data, duplicates no pricing and re-implements no filtering — a block that shows products holds a *reference* to a collection or a query, and rendering it calls the same code path a listing page uses.

---

## 2) Problem Statement

### 2.1 No navigation model

A storefront needs a header menu, a footer menu, possibly a mega-menu, each with items pointing at categories, collections, static pages or external URLs, each localized, each orderable. Nothing models this. Deriving the menu from the category tree is the naive fallback and it fails immediately: merchants want "Sale" and "New in" in the header, and they do not want every category there.

### 2.2 No landing page composition

`GET /products` returns a grid. A homepage is a hero, a promoted collection, a banner, a category grid and an editorial block, in an order the merchant chose. Hard-coding that in the storefront app means every layout change is a deployment.

### 2.3 `content` does not cover it

The `content` module is a thin static-pages module — it has no entities, no composition model, and no relationship to the catalogue. It is the right owner for a privacy policy and the wrong owner for a page with a product carousel on it.

### 2.4 B2B needs a different shop, not a different price

A wholesale buyer landing on a consumer homepage full of single-unit promotions is a poor experience even when their prices are correct. They need their own navigation (bulk categories), their own featured collections (pallet quantities, contract items) and their own banners (credit terms, order deadlines). Without audience targeting the only options are one compromised storefront or two stores to maintain.

### 2.5 Recommendations are hard-coded

Spec 4's `relatedProducts` is "same category, limit 8". Merchants want to control cross-sell and upsell — accessories with the device, the larger pack with the small one — and no model exists.

---

## 3) Architecture

```
        ┌────────────────────────────────────────────┐
        │             merchandising                  │
        │                                            │
        │  Menu ──► MenuItem (tree, localized)       │
        │                                            │
        │  Placement (store + slot + audience)       │
        │      └──► Block[] (ordered, scheduled)     │
        │                │                           │
        │                ├─ hero / banner / richtext │
        │                ├─ product_carousel ──┐     │
        │                ├─ category_grid      │     │
        │                └─ collection_grid ───┤     │
        │                                      │     │
        │  Collection (manual | rule-driven) ◄─┘     │
        │  RecommendationRule                        │
        │  CategoryEnrichment                        │
        └───────────────────┬────────────────────────┘
                            │ resolves product references through
                            ▼
              ecommerce storefront read API (spec 4)
              — same scope, same pricing, same availability
```

**Invariant:** every product a merchandising surface returns passes through `buildStorefrontProductScope` (spec 4 §3.3). A curated collection containing a product outside the buyer's assortment shows the collection without that product, never the product. Curation cannot widen visibility.

### 3.1 Module file structure (added 2026-08-17)

```
packages/core/src/modules/merchandising/
├── index.ts
├── acl.ts
├── setup.ts
├── events.ts
├── di.ts
├── i18n/{en,pl}.json
├── data/
│   ├── entities.ts               # 8 entities, §4
│   └── validators.ts
├── lib/
│   ├── menuResolver.ts
│   ├── placementResolver.ts      # structure + resolved-product cache split, §8
│   ├── collectionMaterializer.ts
│   └── cacheKeys.ts               # buildStorefrontCacheKey-based; sole cache-key builder — §8
├── api/
│   ├── openapi.ts
│   ├── get/ecommerce/storefront/{menus,placements,collections,recommendations,categories}/…   # public, §7.1
│   └── {get,post,put,delete}/merchandising/…       # admin CRUD, §7.2
├── backend/config/merchandising/     # admin composition UI
├── workers/
│   └── materialize-collections.ts   # §6
├── __tests__/
│   └── no-raw-cache-calls.test.ts   # structural guard, §8/R9 — register in scripts/repo-wide-guards.mjs
└── subscribers/
    └── merchandising-cache-invalidation.ts
```

Public routes live under `merchandising`'s own `api/` tree even though the URL namespace is `ecommerce`-prefixed (`/api/ecommerce/storefront/*`) — auto-discovery is path-based, so this is consistent with how `availability`'s and `customer_groups`' routes already sit outside the `ecommerce` module while serving under shared namespaces elsewhere in this suite.

---

## 4) Data Models

Standard scoped columns throughout. All user-facing text fields are translatable via the `translations` module rather than carrying per-locale columns.

### 4.1 `MerchandisingMenu` (`merchandising_menus`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid, nullable | null = all stores in the organization |
| `code` | text | `main`, `footer`, `mobile`, `b2b-main` — unique per store |
| `name` | text | |
| `is_active` | boolean | |

### 4.2 `MerchandisingMenuItem` (`merchandising_menu_items`)

| Column | Type | Notes |
|---|---|---|
| `menu_id` | uuid | |
| `parent_id` | uuid, nullable | Tree; depth capped at 3 |
| `label` | text | Translatable |
| `target_type` | text | `category \| collection \| product \| content_page \| url \| search_query` |
| `target_ref` | text | Id, slug or URL depending on type |
| `icon` | text, nullable | |
| `badge_label` | text, nullable | Translatable — "New", "Sale" |
| `open_in_new_tab` | boolean | |
| `audience` | jsonb, nullable | §4.7 |
| `sort_order` | integer | |
| `is_active` | boolean | |

`search_query` as a target is what lets a merchant put "Under 100 zł" in the menu without creating a collection for it.

### 4.3 `MerchandisingPlacement` (`merchandising_placements`)

A slot on a page, for an audience.

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid, nullable | |
| `slot` | text | `home.main`, `category.top`, `pdp.below_description`, `cart.sidebar`, `checkout.confirmation` |
| `context_type` | text, nullable | `category \| product \| collection` — scopes the placement to one context |
| `context_ref` | text, nullable | e.g. a category id, so a slot can differ per category |
| `audience` | jsonb, nullable | §4.7 |
| `priority` | integer | When several placements match one slot, highest wins |
| `is_active` | boolean | |

### 4.4 `MerchandisingBlock` (`merchandising_blocks`)

| Column | Type | Notes |
|---|---|---|
| `placement_id` | uuid | |
| `block_type` | text | `hero \| banner \| rich_text \| product_carousel \| product_grid \| collection_grid \| category_grid \| video \| html_embed \| countdown` |
| `title` / `subtitle` | text, nullable | Translatable |
| `config` | jsonb | Zod-validated discriminated union on `block_type` |
| `media_url` | text, nullable | |
| `cta_label` / `cta_target_type` / `cta_target_ref` | text, nullable | |
| `starts_at` / `ends_at` | timestamptz, nullable | Scheduling |
| `status` | text | `draft \| published \| archived` |
| `sort_order` | integer | |

`html_embed` is deliberately last in the list and is **feature-gated behind `merchandising.blocks.embed_html`**, granted to no role by default. It renders operator-authored markup into the storefront and is a stored-XSS surface by construction (R3).

**Price-bearing block types (stated explicitly, fixed 2026-08-17)**: `product_carousel`, `product_grid` and `collection_grid` resolve and embed priced product payloads (§7.1) — see §8's cache-key split for why this matters. `category_grid` is **not** price-bearing: it renders category tiles with names/media/counts only, never a resolved product or price. `hero`, `banner`, `rich_text`, `video`, `html_embed` and `countdown` are purely editorial/structural. A future block type that embeds any resolved product data MUST follow the same cache-key split as the three price-bearing types above, not the `audienceDigest`-only path the purely structural types use.

The `config` discriminated union follows the pattern SPEC-055 established for promotion rules and benefits: one JSONB column, one Zod union, validated at write. Extension block types register through the same style of registry.

### 4.5 `MerchandisingCollection` (`merchandising_collections`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid, nullable | |
| `code` / `title` / `description` | text | Title and description translatable |
| `slug` | text | Unique per store; the collection is addressable at `/collections/:slug` |
| `kind` | text | `manual \| rule` |
| `rule_query` | jsonb, nullable | Saved storefront query — the same grammar as spec 4 §4.1 |
| `sort_strategy` | text | `manual \| newest \| price_asc \| price_desc \| bestselling \| relevance` |
| `max_items` | integer, nullable | |
| `materialized_at` | timestamptz, nullable | Rule collections only |
| `audience` | jsonb, nullable | |
| `seo` | jsonb, nullable | |
| `is_active` | boolean | |

`rule_query` reuses the public filter grammar verbatim rather than inventing a query language. A merchant builds a collection by filtering the storefront and saving the result, which is both the simplest implementation and the most learnable UI.

**`sort` vs. `sort_strategy` (stated 2026-08-17)**: the public filter grammar's own `sort` parameter, if present in a saved `rule_query`, is ignored — `sort_strategy` (above) is the single source of ordering truth for a collection, so a collection's order is never split across two fields.

### 4.6 `MerchandisingCollectionItem` (`merchandising_collection_items`)

| Column | Type | Notes |
|---|---|---|
| `collection_id` | uuid | |
| `product_id` | uuid | |
| `sort_order` | integer | Manual collections |
| `is_pinned` | boolean | Pinned items lead a rule collection regardless of its sort strategy |
| `source` | text | `manual \| materialized` |

Pinning is what makes rule collections usable in practice: "everything on sale, but these three first".

### 4.7 Audience targeting

```typescript
type MerchandisingAudience = {
  customerGroupIds?: string[]      // ANY match
  requiresAuthentication?: boolean
  excludeCustomerGroupIds?: string[]
  locales?: string[]
  channels?: string[]
}
```

Null or empty means everyone. Evaluated against `BuyerContext` (SPEC-029 §6). Exclusion beats inclusion.

### 4.8 `MerchandisingRecommendationRule` (`merchandising_recommendation_rules`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid, nullable | |
| `slot` | text | `pdp.cross_sell \| pdp.upsell \| cart.cross_sell \| checkout.cross_sell` |
| `source_type` | text | `product \| category \| tag \| all` |
| `source_ref` | text, nullable | |
| `strategy` | text | `manual \| same_category \| same_tag \| bought_together \| collection \| higher_tier` |
| `target_collection_id` | uuid, nullable | For `collection` strategy |
| `max_items` | integer | Default 8 |
| `priority` | integer | |
| `audience` | jsonb, nullable | |

`bought_together` requires order-history analysis and is **explicitly out of scope for v1** — the enum value reserves it, and the strategy returns empty with a logged warning until an implementation exists. Reserving without implementing is stated rather than silently returning `same_category` results under a name that promises something else.

`higher_tier` is the B2B upsell: given a product, recommend the larger pack or the next quantity tier.

### 4.9 `MerchandisingCategoryEnrichment` (`merchandising_category_enrichments`)

| Column | Type | Notes |
|---|---|---|
| `category_id` | uuid | `catalog.CatalogProductCategory.id` |
| `store_id` | uuid, nullable | |
| `hero_media_url` | text, nullable | |
| `intro_html` / `outro_html` | text, nullable | Translatable, sanitized |
| `featured_collection_id` | uuid, nullable | |
| `seo` | jsonb, nullable | Overrides category defaults |
| `audience` | jsonb, nullable | |

Category editorial content lives here rather than on `CatalogProductCategory` because it is store-specific and audience-targetable, while the category itself is neither. This resolves SPEC-029 v4 Open Question 5 and the roadmap's `merchandising` vs `content` question.

---

## 5) Publishing, Scheduling and Preview

- Blocks carry `status` and a `starts_at`/`ends_at` window. A block is served when `published` and inside its window.
- Preview: `GET /api/ecommerce/storefront/merchandising/*?preview=<token>` returns draft and scheduled content as of an optional `at` timestamp. Preview tokens are short-lived, single-store, admin-issued, and required — a `preview=true` boolean would expose unpublished campaigns.
- Preview responses are `no-store` and never enter the shared cache.

---

## 6) Rule Collection Materialization

Rule collections resolve in one of two modes, chosen per collection:

| Mode | Behaviour | Use |
|---|---|---|
| `live` | The saved query runs at request time within the buyer's scope | Small result sets; audience-sensitive collections |
| `materialized` | A scheduled job resolves the query and writes `MerchandisingCollectionItem` rows | Large catalogues; stable collections |

Materialization runs hourly by default, per collection, and on demand from admin. `materialized_at` is exposed in the admin UI so a merchant can see how current a collection is.

**Worker definition (added 2026-08-17)**: `workers/materialize-collections.ts`, queue `merchandising-collection-materialization`, concurrency 5–10 (I/O-bound: catalog reads, no heavy computation per job). Idempotent by design — each run replaces a collection's `MerchandisingCollectionItem` rows in place (delete-and-reinsert inside one transaction, not append), so an overlapping scheduled run and an on-demand "materialize now" request never produce duplicates regardless of which finishes last. `POST /collections/:id/materialize` (§7.2) enqueues a job and returns immediately; it does not block the request on the materialization itself.

**Materialized collections are still scope-filtered at read time.** Materialization decides membership; the buyer's assortment decides visibility. Skipping the read-time filter would leak restricted products through a curated surface (R1).

---

## 7) API Contracts

### 7.1 Public

Under the storefront namespace so a client has one base URL and one auth model:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ecommerce/storefront/menus/:code` | Resolved menu tree for this buyer |
| GET | `/api/ecommerce/storefront/placements/:slot` | Blocks for a slot, with context params |
| GET | `/api/ecommerce/storefront/collections` | Collection list |
| GET | `/api/ecommerce/storefront/collections/:slug` | Collection plus its products, paginated like `/products` |
| GET | `/api/ecommerce/storefront/recommendations` | Params: `slot`, `productId` or `cartToken` |
| GET | `/api/ecommerce/storefront/categories/:slug/enrichment` | Editorial layer for a category |

A block referencing products returns them **resolved** — full `StorefrontProductListItem` payloads, priced for the buyer, not ids the client must fetch. A homepage should be one request, not one plus N.

`GET /placements/:slot` accepts several slots comma-separated so a page fetches its whole composition once.

### 7.2 Admin

`makeCrudRoute` under `/api/merchandising/*` for menus, menu items, placements, blocks, collections, collection items, recommendation rules and category enrichments, plus:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/merchandising/collections/:id/materialize` | Force materialization |
| POST | `/api/merchandising/collections/:id/preview-query` | Run `rule_query`, return matches and a count, without saving |
| POST | `/api/merchandising/preview-tokens` | Issue a preview token |

### 7.3 ACL

```typescript
export const features = [
  { id: 'merchandising.menus.view',        title: 'View menus' },
  { id: 'merchandising.menus.manage',      title: 'Manage menus' },
  { id: 'merchandising.blocks.view',       title: 'View content blocks' },
  { id: 'merchandising.blocks.manage',     title: 'Manage content blocks' },
  { id: 'merchandising.blocks.embed_html', title: 'Embed raw HTML blocks' },
  { id: 'merchandising.blocks.publish',    title: 'Publish content blocks' },
  { id: 'merchandising.collections.view',  title: 'View collections' },
  { id: 'merchandising.collections.manage',title: 'Manage collections' },
  { id: 'merchandising.recommendations.manage', title: 'Manage recommendation rules' },
]
```

`manage` and `publish` are separate so a tenant can let a merchandiser draft while a manager publishes. `embed_html` is granted to no role by default.

---

## 8) Caching

| Surface | TTL | Key | Invalidation | Tag |
|---|---|---|---|---|
| Menu | 300s | audience digest + menu code | Menu or item write | `merchandising-menu:{menuId}` |
| Placement structure (block ordering, editorial content, unresolved product/collection references) | 120s | audience digest + slot + context | Block or placement write; also on the next schedule boundary | `merchandising-placement:{placementId}`, `merchandising-block:{blockId}` |
| Placement resolved products (`product_carousel`/`product_grid`/`collection_grid` payloads only — fixed 2026-08-17, see below) | 30s | full buyer digest + slot + block id + context + page | Product or price change; block/placement write | `merchandising-block:{blockId}` |
| Collection membership (materialized) | 300s | collection id | Materialization | `merchandising-collection:{collectionId}` |
| Collection products | 30s | full buyer digest + collection + page | Product or price change | `merchandising-collection:{collectionId}` |
| Recommendation selection (which products a strategy/rule picks) | 300s | audience digest + slot + source | Rule write | `merchandising-recommendation:{ruleId}` |
| Recommendation resolved products (priced payloads — fixed 2026-08-17, see below) | 30s | full buyer digest + slot + source + selected product ids | Product or price change; rule write | `merchandising-recommendation:{ruleId}` |

**Fixed 2026-08-17 — the "two digests" claim was too broad and self-contradicted §7.1.** An earlier draft said "menus, blocks and recommendations depend only on audience... not on price," and cached the entire placement-blocks and recommendations surfaces on `audienceDigest` alone. But §7.1 states plainly that a block referencing products (`product_carousel`/`product_grid`/`collection_grid`) and every `/recommendations` response return **resolved, buyer-priced** `StorefrontProductListItem` payloads — the same class of buyer-priced data `storefront-public-api.md` §9.1 already had to split out of its own audience/assortment-scoped facet cache for the identical reason (two buyers sharing an audience but not a price kind would otherwise share cached prices — the same severity as that document's own R1, "contract pricing served to the wrong buyer"). This document's own "Collections" rows already got the split right (`Collection membership` on a coarse key, `Collection products` on the full digest) — the fix here is applying that same, already-demonstrated pattern to Placement and Recommendations: `audienceDigest` is safe **only** for the purely structural/editorial portion of a surface (which blocks appear, in what order, which collection or rule a block points at); any surface that embeds a **resolved** product or price payload — regardless of which cache row it lives in — keys on the full buyer digest, no exception. A structural CI test (`merchandising/__tests__/no-raw-cache-calls.test.ts`, mirroring SPEC-029 §6.1's guard, registered in `scripts/repo-wide-guards.mjs`) enforces that every route builds its cache key through `lib/cacheKeys.ts` rather than ad hoc, so a future price-bearing block type or recommendation strategy can't reintroduce this by construction.

Scheduled blocks need care: a block whose window opens at 09:00 must not be served late because of a 120s TTL taken at 08:59. Cache entries carry an expiry clamped to the next schedule boundary among the blocks they contain — this applies to the structure layer; the resolved-product layer's short 30s TTL makes the same concern moot there.

---

## 9) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Curation leaks restricted products | **High** | A manual collection contains a product outside a B2B buyer's assortment; the collection surface renders it, bypassing the assortment scope. | Every product-returning surface composes `buildStorefrontProductScope`; materialized membership is still filtered at read time (§6); a test asserts a restricted product is absent from a collection containing it | Low |
| R2 | Homepage becomes uncacheable | **High** | Audience targeting plus the buyer digest makes every homepage response unique; the most-hit page misses cache every time. | Two-digest split (§8): structure keys on the coarser audience digest, only product payloads on the full digest; hit rate measured at the Phase 4 gate | Medium — a tenant with many groups still fragments; bounded by group count, which is operator-controlled |
| R3 | Stored XSS via `html_embed` and rich text | **High** | An operator stores a script in an embed block; every visitor executes it. | `html_embed` gated behind a feature granted to no role by default; `rich_text`, `intro_html` and `outro_html` sanitized server-side via the shared `sanitizeRichTextHtml` helper (`packages/shared/src/lib/html/sanitizeRichText.ts`, fixed 2026-08-17 — reuses the same allowlist `entities`/`messages`/the admin rich-text editor already share, instead of an independently hand-rolled one that could drift), same requirement as spec 4 R5 for descriptions; embed blocks additionally rendered inside a sandboxed frame | Low |
| R4 | Composed page fan-out | **High** | A homepage with six product blocks issues six independent listing queries plus six pricing and availability resolutions. | Blocks resolve product references in one batched pass per request — one product query, one pricing resolution, one availability check across all blocks; query count asserted for a six-block homepage | Low |
| R5 | Stale materialized collection | Medium | An hourly job means a discontinued product sits in "Bestsellers" for up to an hour. | Read-time scope filter removes inactive and deleted products regardless of materialization; `materialized_at` surfaced in admin; on-demand materialization available | Low |
| R6 | Scheduled block served late or early | Medium | A campaign block appears minutes after its start or lingers after its end because of the cache TTL. | Cache expiry clamped to the next schedule boundary among the blocks in the entry (§8) | Low |
| R7 | Preview token leaks unpublished campaigns | Medium | A shared preview URL exposes an unlaunched campaign, including pricing intentions, to anyone with the link. | Short-lived, single-store, admin-issued tokens; preview responses `no-store`; token issuance audited | Low |
| R8 | `bought_together` promises what it does not deliver | Low | A merchant selects the strategy and gets empty or misleading results. | Out of scope for v1 and stated: the strategy returns empty with a logged warning and is disabled in the admin picker with an explanatory note | Low |
| R9 | Buyer-priced block/recommendation cache bleed | **Critical** | A `product_carousel`/`product_grid`/`collection_grid` block or a `/recommendations` response is cached on `audienceDigest` alone, but embeds resolved, buyer-priced product data (§7.1). Two buyers sharing customer groups but on different price kinds or personal contract prices (personal price beats group price, per spec 1) share a cache entry and one sees the other's negotiated prices — the same class of disclosure `ecommerce`'s own R1 and `storefront-public-api`'s own R1 rate Critical, introduced here by an earlier draft's `audienceDigest`-only mitigation for R2 rather than by a runtime bug. | Resolved-product payloads for these two surfaces key on the full buyer digest, not `audienceDigest` (§8, fixed 2026-08-17); structural CI guard bans building these cache keys any other way; cross-buyer isolation is a Phase 2/4 gate | Low |

---

## 10) Integration Coverage

**Scope and isolation:**
- A manual collection containing a product outside the buyer's assortment renders without it (R1)
- Materialized membership filtered at read time
- Menu items targeting a restricted category are hidden for that buyer
- Cross-tenant merchandising never resolves

**Audience:**
- Anonymous, B2C-group and B2B-group buyers receive different menus, placements and collections from the same store
- `excludeCustomerGroupIds` beats inclusion
- `requiresAuthentication` hides a block from anonymous visitors
- Two buyers in the same group share the audience-digest cache entry; two in different groups do not (R2)
- **Two buyers sharing an audience digest (same customer groups) but differing `priceKindId`/`customerId` never see each other's prices in a `product_carousel`/`product_grid`/`collection_grid` block or in `/recommendations`, even though they share the same structural cache entry for that surface** (regression test for the fixed R9 cache split)

**Scheduling and publishing:**
- A draft block is absent from the public response and present under a valid preview token
- A block outside its window is absent; inside, present
- A window opening mid-TTL is served on time (R6)
- An invalid or expired preview token is refused (R7)

**Collections:**
- `rule_query` reuses the public filter grammar and returns the same set as the equivalent `/products` call
- Pinned items lead regardless of sort strategy
- `materialize` updates membership and `materialized_at`
- `preview-query` returns a count without saving

**Blocks and safety:**
- Malicious markup in `rich_text` and `intro_html` sanitized before leaving the API (R3)
- `html_embed` refused without the feature
- `config` rejected when it does not match the block type's schema

**Performance:**
- A six-block homepage issues one product query, one pricing resolution and one availability check (R4)
- A multi-slot placement request returns all slots in one round trip

**API:** every route, with tenant isolation asserted.

---

## 11) User Stories

Roles referenced below map directly to the ACL features in §7.3: **Merchandiser** holds the `*.manage` features but not `*.publish`; **Store Manager** holds both `*.manage` and `*.publish`; **Viewer** holds only `*.view` features; **Platform Admin** is the rare role additionally holding `merchandising.blocks.embed_html`. Outcomes are written from the storefront buyer's perspective where the admin action's effect is what matters.

### Navigation (menus)

**US-N1 — Build a menu tree**
As a Merchandiser, I want to add, nest and drag-reorder menu items in a store's menu, so that buyers see a header/footer/mobile navigation the merchant chose rather than the raw category tree.
- Depth is capped at 3; the UI blocks a 4th-level drop and explains why.
- An item's `target_type` (`category | collection | product | content_page | url | search_query`) drives a type-specific target picker; picking `search_query` accepts a filter string directly (§4.2).
- Reordering is optimistic: the new order applies immediately in the tree and rolls back with an inline error if the save fails.
- Deleting an item with children asks for confirmation and explains that children are removed too (no orphaned rows).
- Empty state: a menu with no items shows a prompt to add the first one, not a blank tree.
- Keyboard: arrow keys move focus between tree rows; Cmd/Ctrl+Enter saves the currently edited item; Escape cancels an in-progress edit.

**US-N2 — Target a menu item to an audience**
As a Merchandiser, I want to scope a menu item to specific customer groups (or require authentication, or exclude a group), so that a B2B buyer sees "Bulk Orders" while a retail visitor does not, from the same `main` menu.
- The audience editor exposes `customerGroupIds`, `excludeCustomerGroupIds`, `requiresAuthentication`, `locales`, `channels` (§4.7); leaving all empty is visibly labeled "Everyone."
- Setting both an inclusion and an exclusion for the same group shows an inline hint that exclusion wins (§4.7's stated precedence), not a silent contradiction.
- Default value: a newly created item inherits no audience restriction (everyone) rather than an empty-but-ambiguous state.

**US-N3 — Restricted targets stay invisible, not broken**
As a Merchandiser, I want a menu item pointing at a category or collection outside a buyer's assortment to simply not render for that buyer, so that curation never becomes a dead link or an error page (R1).
- The admin tree still shows the item to the Merchandiser (it is valid configuration), with a badge noting it targets a scoped resource.
- The prototype's preview-as-audience control (US-P4) demonstrates the item disappearing for a restricted persona.

**US-N4 — Read-only access**
As a Viewer, I want to see the full menu tree and item configuration without edit controls, so that I can audit navigation without risking a change.
- Drag handles, delete buttons and the "Add item" action are absent, not disabled-and-clickable.
- Attempting a direct API action a Viewer's role does not permit surfaces the same permission error CrudForm shows elsewhere, not a silent no-op.

### Placements and blocks

**US-P1 — Compose a placement's blocks**
As a Merchandiser, I want to add, reorder and remove blocks (hero, banner, rich text, product carousel, product grid, collection grid, category grid, video, countdown) within a placement slot, so that a page like `home.main` renders the composition I chose in one request (§7.1, R4).
- The block-type picker excludes `html_embed` unless the current user holds `merchandising.blocks.embed_html` (§4.4); Merchandisers without it never see the option.
- A block's `config` form is type-specific (a discriminated union per §4.4); submitting a config that fails its schema shows the specific field error inline, not a generic failure toast.
- Removing a block asks for confirmation and is undoable for the remainder of the editing session (a "Block removed — Undo" flash), not a hard delete on click.
- Empty state: a placement with zero blocks shows a prompt to add the first block, distinguishing "nothing configured yet" from "configured to show nothing."

**US-P2 — Schedule a block**
As a Merchandiser, I want to set a block's `starts_at`/`ends_at` window, so that a campaign banner appears and disappears on schedule without anyone touching it live (§5, R6).
- Leaving both fields empty means "always active within its published state," shown as an explicit "No schedule" default rather than blank inputs that look unset.
- An end date before the start date is rejected inline before submit.
- The block list shows a compact schedule badge ("Starts in 3 days", "Ends today", "Expired") so a Merchandiser can scan a placement's timeline at a glance.

**US-P3 — Draft and publish are separate steps**
As a Merchandiser without publish rights, I want to save a block as `draft` and hand it to a Store Manager to publish, so that drafting and publishing stay separately accountable (§7.3).
As a Store Manager, I want to review a draft block and publish it, so that only reviewed content goes live.
- The status control offers `draft`/`published`/`archived`; a Merchandiser without `merchandising.blocks.publish` sees `published` disabled with a tooltip explaining who can set it.
- A published block that is later edited reverts to `draft` only if the spec's workflow requires re-approval — this prototype flags it as an **open question** (see Open Questions) rather than assuming an answer.

**US-P4 — Preview draft and scheduled content**
As a Merchandiser, I want to generate a preview link (or pick a preview persona and "as of" time in the admin UI) and see draft/scheduled blocks as that buyer would, so that I can verify a campaign before it goes live (§5).
- The preview banner is unmistakable ("Previewing as: B2B — Wholesale, as of 2026-09-01 09:00") so a Merchandiser never mistakes a preview for the live site.
- An expired or invalid preview token shows a clear "This preview link has expired" state, never a blank page (R7).
- Preview responses are never cached client-side either — reloading re-fetches.

**US-P5 — `html_embed` carries a visible warning**
As a Platform Admin, when I add an `html_embed` block, I want an explicit stored-XSS warning next to the editor, so that the risk of the one block type that is not sanitized is never invisible (R3).
- The raw-HTML textarea is visually distinct (warning-toned border/banner using DS status tokens) from every sanitized rich-text field.
- Saving shows a confirmation step restating that this content is not sanitized before it takes effect.

### Collections

**US-C1 — Curate a manual collection**
As a Merchandiser, I want to search products and add them to a manual collection with drag-reorder and pinning, so that I control exactly which products appear in "Staff Picks" and in what order (§4.5, §4.6).
- Adding a product already in the collection is a no-op with an inline "Already in this collection" hint, not a duplicate row.
- Pinned items are visually pulled to the top of the list with a pin icon, and the UI explains they lead regardless of `sort_strategy`.
- Removing the last item shows the collection's empty state, not an error.

**US-C2 — Build a rule collection from a saved query**
As a Merchandiser, I want to build a rule collection by reusing the storefront's own filter builder and saving the result, so that "Everything on Sale" stays current without manual curation (§4.5).
- A live "Preview matches" action calls `preview-query` and shows a count and a sample grid before saving, so a Merchandiser sees the effect of a filter change immediately.
- Zero matches is shown as an explicit "No products match this query yet" state, not an empty grid indistinguishable from a loading state.
- Changing `sort_strategy` after products already exist visibly reorders the preview so the field never feels inert.

**US-C3 — Materialize on demand**
As a Merchandiser, I want to trigger materialization for a rule collection and see how current it is, so that I do not have to wait up to an hour for a change in the underlying catalogue to show up (§6).
- `materialized_at` is shown as a relative freshness label ("Materialized 12 minutes ago"); a collection that has never materialized shows "Not yet materialized."
- Triggering materialization shows an in-progress state (the job is enqueued and returns immediately, §6) rather than blocking the UI until the job completes.
- A materialization failure surfaces on the collection detail screen, not silently.

**US-C4 — Collection audience and SEO**
As a Merchandiser, I want to scope a collection to an audience and set its SEO overrides, so that a B2B-only collection is invisible to retail buyers and still ranks well for the audience it serves (§4.5, §4.7).
- Same audience editor as US-N2, reused rather than reinvented.

### Recommendations and category enrichment

**US-R1 — Configure a recommendation rule**
As a Merchandiser, I want to set up a recommendation rule for a slot (`pdp.cross_sell`, `pdp.upsell`, `cart.cross_sell`, `checkout.cross_sell`) with a strategy and a source, so that cross-sell and upsell reflect merchandising intent instead of a hard-coded "same category" fallback (§4.8).
- The strategy picker lists `manual | same_category | same_tag | bought_together | collection | higher_tier`.
- Picking `collection` reveals a `target_collection_id` picker; picking any other strategy hides it, so the form never shows an irrelevant field.
- `max_items` defaults to 8 (§4.8) and is editable.

**US-R2 — `bought_together` is honestly unavailable**
As a Merchandiser, when I open the strategy picker, I want `bought_together` shown but disabled with an explanatory note, so that I understand it is reserved for a future release rather than assuming it works and getting silently empty results (R8, §4.8).
- Hovering or focusing the disabled option shows the same "not yet available" copy used elsewhere in the admin for reserved-but-unbuilt features.

**US-R3 — `higher_tier` B2B upsell**
As a Merchandiser serving a B2B store, I want to configure a `higher_tier` rule so that a product page recommends the next quantity tier or the larger pack, so that wholesale buyers naturally trade up (§4.8).

**US-R4 — Enrich a category page**
As a Merchandiser, I want to add hero media, intro/outro copy, a featured collection and SEO overrides to a category, so that a category landing page reads as curated rather than a bare product grid (§4.9).
- Intro/outro HTML fields are rich-text (sanitized), not raw HTML, and are visually distinct from the `html_embed` warning state in US-P5.
- Leaving SEO overrides empty falls back to the category's own defaults, shown as greyed-out placeholder text rather than blank fields.

### Cross-cutting

**US-X1 — Optimistic locking on every editable entity**
As a Merchandiser, when another Merchandiser or Store Manager edits the same menu, block, collection or rule I have open, I want to see a conflict instead of silently overwriting their change, so that concurrent editing across a merchandising team is safe (per `AGENTS.md`'s default-on optimistic locking rule).
- Every edit/delete form derives its lock header from `initialValues.updatedAt`; a conflicting save surfaces the unified conflict bar (`surfaceRecordConflict`), not a generic 500.

**US-X2 — Consistent dialog keyboard behavior**
As any admin user, I want every dialog in this module (audience editor, block config, preview picker, materialize confirmation) to submit on Cmd/Ctrl+Enter and cancel on Escape, so that the module feels consistent with the rest of the backoffice.

---

## 12) Implementation Phases

### Phase 1 — Navigation
Menus, items, audience targeting, public menu endpoint, admin tree editor with drag-reorder.

**Gate:** audience-targeted menus resolve correctly; restricted targets hidden.

### Phase 2 — Placements and blocks
Placements, block types except `html_embed`, scheduling, draft/publish, preview tokens, batched product resolution, admin composition UI.

**Gate:** the six-block fan-out budget is met; scheduling is punctual; sanitization holds.

### Phase 3 — Collections
Manual and rule collections, pinning, materialization job, `/collections/:slug`, saved-query builder reusing the storefront filter UI.

**Gate:** rule collections match the equivalent public query; read-time scope filtering verified.

### Phase 4 — Recommendations and enrichment
Recommendation rules (excluding `bought_together`), category enrichment, `html_embed` behind its feature.

**Gate:** `higher_tier` returns the correct B2B upsell; enrichment overrides category SEO defaults.

---

## 13) Open Questions

1. **`bought_together`** — needs order-history analysis, and the question of whether that runs in `search`, `analytics` or a new module is unresolved. Reserved, not built (R8).
2. **A/B testing placements** — merchants will ask. The `priority` field and audience model could carry a split, but experiment assignment, tracking and significance belong to an analytics capability that does not exist.
3. **Personalization beyond groups** — browsing history and affinity are a different class of problem from audience targeting and would need a profile store and a consent model.
4. **Page builder for arbitrary pages** — this module composes *known slots*. Whether merchants can create wholly new URLs with arbitrary composition, and whether that belongs here or in `content`, is unresolved. The roadmap's non-goal list excluded a full CMS; this stays inside that line.
5. **Re-approval on edit of a published block** (raised while drafting §11 US-P3) — whether editing an already-`published` block reverts it to `draft` (forcing a Store Manager to re-approve every edit) or lets a Merchandiser edit published content in place without re-publish. Neither §5 nor §7.3 states this; it changes the admin UI's status-transition rules and should be resolved before Phase 2 implementation.

---

## 14) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Product, category and collection references are FK ids; product data resolved through the spec 4 read path |
| Tenant/organization scoping | Every entity and every public surface; asserted per test |
| Assortment invariant | `buildStorefrontProductScope` composed by every product-returning surface, materialized collections included |
| Zod validation | Block `config` as a discriminated union on `block_type`; all routes |
| No `any` | Block config union and audience model fully typed |
| i18n | Labels, titles and editorial copy via `translations`; no per-locale columns; no hard-coded strings |
| Sanitization | Rich text and enrichment HTML sanitized server-side via the shared `sanitizeRichTextHtml` helper (fixed 2026-08-17 — reuses existing infrastructure); `html_embed` feature-gated and sandboxed |
| Cache safety — price isolation | Resolved product/price payloads embedded in Placement blocks and Recommendations key on the full buyer digest, never `audienceDigest` alone (§8, R9, fixed 2026-08-17); structural CI guard registered in `scripts/repo-wide-guards.mjs` |
| Queue usage | Collection materialization via the `queue` worker contract (`workers/materialize-collections.ts`, §6, added 2026-08-17), not a custom timer |
| Optimistic locking | All editable entities expose `updatedAt`; admin forms use `CrudForm` |
| Cache safety | Audience digest and buyer digest split deliberately; preview responses `no-store` |
| Design system | Admin UI uses `@open-mercato/ui` primitives and semantic tokens |
| Backward compatibility | New module; no existing contract surface changes |
| Integration coverage | §10, shipping in the same change |

---

## 15) Changelog

### 2026-08-31 (rev 3 — user stories)

Added §11 User Stories (role-goal-outcome, with acceptance criteria covering empty/permission/error/optimistic/undo/keyboard/default-value states) so a click-through admin-UI prototype could be built from this spec. Roles map onto §7.3's ACL features (`*.manage` vs `*.publish` vs `*.view`, plus the rare `embed_html` holder). Renumbered §11–§14 to §12–§15 accordingly. Raised one new Open Question (§13 Q5): whether editing a published block forces re-approval — neither §5 nor §7.3 states this, and it changes the admin status-transition rules.

### 2026-08-17 (rev 2 — pre-implementation fixes)

Fixed the findings of a `/om-pre-implement-spec` audit (`ANALYSIS-2026-08-14-storefront-merchandising.md`):

- **Critical (new R9)**: §8's cache table keyed "Placement blocks" and "Recommendations" on `audienceDigest` alone, directly contradicting §7.1's own statement that `product_carousel`/`product_grid`/`collection_grid` blocks and every `/recommendations` response embed resolved, buyer-priced product payloads. Two buyers sharing customer groups but differing price kinds or personal contract prices would have shared cached prices — the same severity `ecommerce`'s and `storefront-public-api`'s own R1 rate Critical, and the identical defect class already found and fixed once in this same suite (`storefront-public-api.md` §9.1's facet/`priceRange` split). Fixed: split both surfaces into a structural layer (`audienceDigest`) and a resolved-product layer (full buyer digest); added R9, a regression test (§10), and a structural CI guard.
- Named the shared `sanitizeRichTextHtml` helper for rich-text/embed sanitization instead of an independently-described allowlist (R3, §14).
- Declared the collection-materialization worker's queue, concurrency and idempotency (§6).
- Stated `category_grid`'s price-independence and `rule_query.sort`'s precedence against `sort_strategy` explicitly (§4.4, §4.5).
- Added a Module File Structure section (§3.1) and concrete cache-invalidation tag names (§8).

### 2026-08-14
- Initial specification.
- Established the `merchandising` / `content` boundary after confirming that `content` is a thin static-pages module with no entities and no catalogue relationship: composition and navigation here, standalone informational pages there.
- Resolved SPEC-029 v4 Open Question 5 and the roadmap's merchandising-vs-content question by locating category editorial content in `MerchandisingCategoryEnrichment` — store-specific and audience-targetable, which `CatalogProductCategory` is not.
- Introduced the two-digest caching split after observing that audience-dependent structure and price-dependent product payloads have very different cacheability, and that keying both on the full buyer digest would make the homepage uncacheable (R2).
- Reused SPEC-055's JSONB-plus-Zod-discriminated-union pattern for block configuration, and spec 4's public filter grammar verbatim for `rule_query`, rather than introducing new schemas or a query language.
