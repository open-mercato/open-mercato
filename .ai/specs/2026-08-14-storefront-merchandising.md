# Storefront Merchandising

| Field | Value |
|-------|-------|
| **Status** | Specification |
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

| Surface | TTL | Key | Invalidation |
|---|---|---|---|
| Menu | 300s | audience digest + menu code | Menu or item write |
| Placement blocks | 120s | audience digest + slot + context | Block or placement write; also on the next schedule boundary |
| Collection membership (materialized) | 300s | collection id | Materialization |
| Collection products | 30s | full buyer digest + collection + page | Product or price change |
| Recommendations | 300s | audience digest + slot + source | Rule write |

**Two digests, deliberately.** Menus, blocks and recommendations depend only on *audience* (groups, auth, locale, channel), not on price. They key on an `audienceDigest` — a coarser, higher-hit-rate subset of the full buyer digest. Only product payloads, which are price-bearing, key on the full digest. Keying the whole homepage on the full digest would make it uncacheable per customer, which is exactly the wrong outcome on the most-hit page (R2).

Scheduled blocks need care: a block whose window opens at 09:00 must not be served late because of a 120s TTL taken at 08:59. Cache entries carry an expiry clamped to the next schedule boundary among the blocks they contain.

---

## 9) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Curation leaks restricted products | **High** | A manual collection contains a product outside a B2B buyer's assortment; the collection surface renders it, bypassing the assortment scope. | Every product-returning surface composes `buildStorefrontProductScope`; materialized membership is still filtered at read time (§6); a test asserts a restricted product is absent from a collection containing it | Low |
| R2 | Homepage becomes uncacheable | **High** | Audience targeting plus the buyer digest makes every homepage response unique; the most-hit page misses cache every time. | Two-digest split (§8): structure keys on the coarser audience digest, only product payloads on the full digest; hit rate measured at the Phase 4 gate | Medium — a tenant with many groups still fragments; bounded by group count, which is operator-controlled |
| R3 | Stored XSS via `html_embed` and rich text | **High** | An operator stores a script in an embed block; every visitor executes it. | `html_embed` gated behind a feature granted to no role by default; `rich_text`, `intro_html` and `outro_html` sanitized server-side against an allowlist before leaving the API, as spec 4 R5 requires for descriptions; embed blocks additionally rendered inside a sandboxed frame | Low |
| R4 | Composed page fan-out | **High** | A homepage with six product blocks issues six independent listing queries plus six pricing and availability resolutions. | Blocks resolve product references in one batched pass per request — one product query, one pricing resolution, one availability check across all blocks; query count asserted for a six-block homepage | Low |
| R5 | Stale materialized collection | Medium | An hourly job means a discontinued product sits in "Bestsellers" for up to an hour. | Read-time scope filter removes inactive and deleted products regardless of materialization; `materialized_at` surfaced in admin; on-demand materialization available | Low |
| R6 | Scheduled block served late or early | Medium | A campaign block appears minutes after its start or lingers after its end because of the cache TTL. | Cache expiry clamped to the next schedule boundary among the blocks in the entry (§8) | Low |
| R7 | Preview token leaks unpublished campaigns | Medium | A shared preview URL exposes an unlaunched campaign, including pricing intentions, to anyone with the link. | Short-lived, single-store, admin-issued tokens; preview responses `no-store`; token issuance audited | Low |
| R8 | `bought_together` promises what it does not deliver | Low | A merchant selects the strategy and gets empty or misleading results. | Out of scope for v1 and stated: the strategy returns empty with a logged warning and is disabled in the admin picker with an explanatory note | Low |

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

## 11) Implementation Phases

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

## 12) Open Questions

1. **`bought_together`** — needs order-history analysis, and the question of whether that runs in `search`, `analytics` or a new module is unresolved. Reserved, not built (R8).
2. **A/B testing placements** — merchants will ask. The `priority` field and audience model could carry a split, but experiment assignment, tracking and significance belong to an analytics capability that does not exist.
3. **Personalization beyond groups** — browsing history and affinity are a different class of problem from audience targeting and would need a profile store and a consent model.
4. **Page builder for arbitrary pages** — this module composes *known slots*. Whether merchants can create wholly new URLs with arbitrary composition, and whether that belongs here or in `content`, is unresolved. The roadmap's non-goal list excluded a full CMS; this stays inside that line.

---

## 13) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Product, category and collection references are FK ids; product data resolved through the spec 4 read path |
| Tenant/organization scoping | Every entity and every public surface; asserted per test |
| Assortment invariant | `buildStorefrontProductScope` composed by every product-returning surface, materialized collections included |
| Zod validation | Block `config` as a discriminated union on `block_type`; all routes |
| No `any` | Block config union and audience model fully typed |
| i18n | Labels, titles and editorial copy via `translations`; no per-locale columns; no hard-coded strings |
| Sanitization | Rich text and enrichment HTML sanitized server-side; `html_embed` feature-gated and sandboxed |
| Optimistic locking | All editable entities expose `updatedAt`; admin forms use `CrudForm` |
| Cache safety | Audience digest and buyer digest split deliberately; preview responses `no-store` |
| Design system | Admin UI uses `@open-mercato/ui` primitives and semantic tokens |
| Backward compatibility | New module; no existing contract surface changes |
| Integration coverage | §10, shipping in the same change |

---

## 14) Changelog

### 2026-08-14
- Initial specification.
- Established the `merchandising` / `content` boundary after confirming that `content` is a thin static-pages module with no entities and no catalogue relationship: composition and navigation here, standalone informational pages there.
- Resolved SPEC-029 v4 Open Question 5 and the roadmap's merchandising-vs-content question by locating category editorial content in `MerchandisingCategoryEnrichment` — store-specific and audience-targetable, which `CatalogProductCategory` is not.
- Introduced the two-digest caching split after observing that audience-dependent structure and price-dependent product payloads have very different cacheability, and that keying both on the full buyer digest would make the homepage uncacheable (R2).
- Reused SPEC-055's JSONB-plus-Zod-discriminated-union pattern for block configuration, and spec 4's public filter grammar verbatim for `rule_query`, rather than introducing new schemas or a query language.
