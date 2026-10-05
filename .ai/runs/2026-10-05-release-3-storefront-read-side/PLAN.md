# Plan — Release 3: storefront read side

**Slug:** release-3-storefront-read-side
**Branch:** spec/storefront-release-phase0-reconciliation (owner override: continue fork PR #12, no new branch)
**Repo:** fork `adeptofvoltron/open-mercato` (remote `fork`); `origin` = upstream, read-only
**Base branch:** develop (fork/develop fast-forwarded to origin/develop @ a108dd07f4)
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/12
**Source specs:**
- `.ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md` (v4.6): §17 Phase 0.5, Phases 1–3
- `.ai/specs/2026-08-14-storefront-public-api.md` (rev 4): §13 Phase 1 prerequisites, Phases 1–3 (Phase 4 content pages is a non-goal)
- `.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md`: Phase 1 completion items (D13) + Phase 2 only
- `.ai/specs/2026-06-30-omnibus-price-tracking.md`: MVP Phases 1–3 (owner decision D11 + 2026-10-05: Omnibus ships in this PR; this spec supersedes SPEC-033)
- `.ai/specs/2026-08-21-pricing-engine.md` (2026-10-05 amendment + Phase 2b), `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md` (§6.0 multi-id, §5.3 column)
- Decisions: `.ai/specs/analysis/ANALYSIS-2026-10-05-storefront-release-decisions.md` ("Decisions taken", D1–D22)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Spec amendments + analysis reports (D1–D22) | inline | done | 8040682f1a |
| 0 | 0.2 | Run-folder commit (this plan) | inline | done | 5f186e62c2 |
| 1 | 1.1 | Shared catalog-visibility canonical scope hash | dispatch:standard | done | 8be09af845 |
| 1 | 1.2 | Catalog PricingContext priceKindId + customerIds | dispatch:capable | done | a487032b25 |
| 1 | 1.3 | Catalog price-row index migration (pricing-engine Phase 2b) | inline | done | 28e2ca0f38 |
| 1 | 1.4 | customer_groups multi-id resolution (customerIds input) | dispatch:capable | done | 8904e86e46 |
| 1 | 1.5 | customer_groups CustomerGroupTerms.assortment_scope column + stub replacement | dispatch:standard | done | fe885074f9 |
| 1 | 1.6 | Generate + review customer_groups assortment_scope migration | inline | done | 068dda8806 |
| 2 | 2.1 | Scaffold ecommerce module (index, acl, setup, di, events, i18n, modules.ts) | inline | done | 384a10d53e |
| 2 | 2.2 | ecommerce entities + validators | dispatch:standard | done | adbb805f34 |
| 2 | 2.3 | Generate + review ecommerce migration | inline | done | efe8cbec4d |
| 2 | 2.4 | Admin CRUD routes: stores, domain bindings, channel bindings | dispatch:standard | done | 1324706161 |
| 2 | 2.4-fix | Store create branding gate + cascade soft-delete of bindings on store delete | dispatch:standard | done | a0de6848be |
| 2 | 2.5 | lib/cacheKeys.ts typed storefront cache + structural guard test | dispatch:capable | done | 1b551a100e |
| 2 | 2.6 | lib/storeContext.ts host/slug resolution, locale, failure modes | dispatch:capable | done | 0d05fb429c |
| 2 | 2.7 | lib/buyerContext.ts buyer identity, groups, terms, taxMode, digest | dispatch:capable | done | 4b57c2ddd0 |
| 2 | 2.8 | Public GET /api/ecommerce/storefront/context | dispatch:standard | done | e397b297e4 |
| 2 | 2.9 | Subscribers: cache invalidation, domain re-binding, misconfiguration notifications | dispatch:standard | done | 3d6bd9e6b1 |
| 2 | 2.9-fix | Explicit comparator in priceScopeKey group-id sort (checkpoint 3 regression) | inline | done | ad6984039f |
| 2 | 2.10 | ecommerce search.ts | dispatch:cheap | done | 56a708e730 |
| 2 | 2.10-fix | Lazy-load portal auth so ecommerce DI never imports next/server | inline | done | b74e2ca04f |
| 2 | 2.11 | Integration tests: resolution + buyer context + cache isolation (SPEC-029 Phase 1 gate) | dispatch:capable | done | c0ef621f3d |
| 3 | 3.1 | Omnibus: CatalogPriceHistoryEntry entity + migration | dispatch:capable | done | c7b5340eaf |
| 3 | 3.2 | Omnibus: history capture wired into price commands and undo | dispatch:capable | done | 0ff66ab118 |
| 3 | 3.2-fix | Omnibus: capture history for product/variant price cascades and variant-undo restores | dispatch:standard | done | fee1a34c0f |
| 3 | 3.3 | Omnibus: GET /api/catalog/prices/history | dispatch:standard | done | a1ac0f6500 |
| 3 | 3.3-fix | Translate ecommerce ACL feature titles (auth ACL i18n guard, missed in 2.1) | inline | done | 26e58e3c80 |
| 3 | 3.4 | Omnibus: catalogOmnibusService resolution + DI | dispatch:capable | done | 4f3b6c1a7e |
| 3 | 3.5 | Omnibus: omnibus-preview route + products-list enrichment | dispatch:standard | done | 7e2d0dde3d |
| 3 | 3.6 | Omnibus: GET/PATCH /api/catalog/config/omnibus | dispatch:standard | done | 84be2e9457 |
| 3 | 3.7 | Omnibus: ACL features, setup grants, backfill CLI | dispatch:standard | done | 66a1002ff2 |
| 3 | 3.8 | Omnibus: admin UI (settings panel + price editor reference row) + i18n | dispatch:standard | done | c52b9ed595 |
| 3 | 3.8-fix | Explicit comparators in Omnibus config/settings channel sorts (checkpoint 6 regression) | inline | done | c73c7b42b6 |
| 3 | 3.9 | Omnibus: integration tests | dispatch:capable | done | 2ea735bc2d |
| 4 | 4.1 | Catalog: extract product filters to lib with descendant expansion | dispatch:standard | done | c8286520e8 |
| 4 | 4.2 | query_index doc-enrichment hook + overlap FilterOp | dispatch:capable | done | f908ee78a2 |
| 4 | 4.3 | Catalog scope_keys contributor, GIN index, reindex triggers | dispatch:capable | done | be1c0b2309 |
| 4 | 4.4 | ecommerce buildStorefrontProductScope + SQL/matchesScope equivalence test | dispatch:capable | done | b76d9a4c99 |
| 4 | 4.5 | ecommerce storefront pricing (buildStorefrontPricingContext, batched resolution, tax mode) | dispatch:capable | done | pending |
| 4 | 4.6 | ecommerce lib/storefrontProducts.ts listing | dispatch:capable | todo | — |
| 4 | 4.7 | ecommerce lib/storefrontDetail.ts detail | dispatch:capable | todo | — |
| 4 | 4.8 | Public routes /products and /products/:idOrHandle with storefront cache | dispatch:standard | todo | — |
| 4 | 4.9 | Integration tests: cross-context isolation, enumeration oracle, query budgets (Public API Phase 1 gate) | dispatch:capable | todo | — |
| 5 | 5.1 | Channel binding require_authentication + resolver short-circuit + intersectScopes | dispatch:standard | todo | — |
| 5 | 5.2 | Generate + review require_authentication migration | inline | todo | — |
| 5 | 5.3 | Integration tests: authentication gate; isolation suite unchanged (Visibility Phase 2 gate) | dispatch:standard | todo | — |
| 6 | 6.1 | Catalog option and choice label translations | dispatch:standard | todo | — |
| 6 | 6.2 | ecommerce lib/storefrontFacets.ts with cross-exclusion | dispatch:capable | todo | — |
| 6 | 6.3 | Categories: /categories and /categories/:slug | dispatch:standard | todo | — |
| 6 | 6.4 | /search/suggest + search-module integration (tokens, pgvector) | dispatch:capable | todo | — |
| 6 | 6.5 | Rate limiting + OpenAPI for all storefront routes | dispatch:standard | todo | — |
| 6 | 6.6 | Integration tests: facets, categories, search (Public API Phases 2–3 gates) | dispatch:capable | todo | — |
| 7 | 7.1 | lib/brandingStyles.ts + validation + fuzz tests + SSR helper | dispatch:standard | todo | — |
| 7 | 7.2 | PUT /stores/:id/branding command route + GET preview-branding | dispatch:standard | todo | — |
| 7 | 7.3 | GET store-channel-bindings/:id/assortment-count | dispatch:standard | todo | — |
| 7 | 7.4 | Admin UI: store list + create | dispatch:standard | todo | — |
| 7 | 7.5 | Admin UI: General tab (incl. store availability defaults) | dispatch:standard | todo | — |
| 7 | 7.6 | Admin UI: Branding tab + live preview | dispatch:standard | todo | — |
| 7 | 7.7 | Admin UI: Domains tab | dispatch:standard | todo | — |
| 7 | 7.8 | Admin UI: Channels tab (scope pickers, require_authentication, price_sort_fallback, live count) | dispatch:capable | todo | — |
| 7 | 7.9 | Admin UI: SEO tab | dispatch:cheap | todo | — |
| 7 | 7.10 | customer_groups group-terms assortment pickers | dispatch:standard | todo | — |
| 7 | 7.11 | setup.ts draft-store seed + Upgrade Action for existing tenants | dispatch:standard | todo | — |
| 7 | 7.12 | Integration tests: admin UI paths (SPEC-029 Phases 2–3 gates) | dispatch:capable | todo | — |

## Goal

Ship the storefront read side (roadmap Phase 1 + visibility Phase 2): a resolved store/buyer context, a public catalog API whose prices and assortment differ per buyer, and zero cache bleed or cross-tenant leakage between buyer contexts.

## Scope

- New `ecommerce` module (SPEC-029 Phases 1–3) and its public read API (Storefront Public API Phases 1–3).
- Cross-module prerequisites the amended specs require: shared canonical scope hash, catalog `PricingContext` amendment and Phase 2b indexes, `customer_groups` multi-id resolution and `assortment_scope` column, the `scope_keys` index substrate, catalog option-label translations, and Omnibus MVP.

## Non-goals

- Storefront Public API Phase 4 (content pages, `contentPageSource`).
- Buyer-Scoped Visibility Phases 3–4 (cart write path, per-customer overrides); the `cart` module; checkout; `apps/storefront`.
- Omnibus Phases 4–5 (member-state derogations, sales line snapshots).
- Meilisearch storefront search (D19); stock projection (D21 follow-up).
- Enabling `ecommerce` in the create-app template (commented out, D22).

## Implementation Plan

### Phase 0 — Spec amendments
- **0.1 Spec amendments + analysis reports (D1–D22)** — done in 8040682f1a.
- **0.2 Run-folder commit (this plan)** — PLAN/HANDOFF/NOTIFY; PR #12 converted to draft and claimed.

### Phase 1 — Prerequisites (SPEC-029 §17 Phase 0.5)
- **1.1 Shared catalog-visibility canonical scope hash** — `canonicalizeEffectiveScope` + `hashEffectiveScope` in `packages/shared/src/lib/catalog-visibility/` (sorted ids, sorted keys, branches sorted by canonical form, recursing into `allOf`; `null` and `[]` distinct). Export from `index.ts`; list in `packages/shared/AGENTS.md`. Property tests (seeded generator in `__tests__/testFixtures.ts`): equal hash for equivalent scopes in different order; distinct where semantics differ. Visibility spec §3.7.
- **1.2 Catalog PricingContext priceKindId + customerIds** — pricing-engine.md "Amendment 2026-10-05": optional `priceKindId` (reject rows of another kind in `matchesContext`; `buildPriceRowFilter` adds the clause), optional `customerIds` (person first; legacy `customerId` kept), tie-break person-scoped over company-scoped row on equal score. Extend `buildPriceRowFilter.property.test.ts` and unit tests. No caller changes.
- **1.3 Catalog price-row index migration (pricing-engine Phase 2b)** — index-only migration with the Phase 2b partial indexes (no `deleted_at` predicate), entity `@Index` declarations, snapshot. Review SQL.
- **1.4 customer_groups multi-id resolution** — `resolveGroups/resolveTerms/resolveAssortmentScope` accept `{ customerIds, tenantId, at? }` additively (customer-groups §6.0): union of memberships, order priority desc → person before company → newest; default group only when no id has a membership. Unit tests.
- **1.5 customer_groups CustomerGroupTerms.assortment_scope column + stub replacement** — jsonb nullable column on `customer_group_terms`, zod validator = `AssortmentScope` without `allOf`, terms CRUD accepts it, `groupOwnAssortmentScope` reads it (fix the misleading "Phase 5" comment), `resolveAssortmentScope` returns real unions. Unit tests (incl. category-vs-tag disjoint fixture).
- **1.6 Generate + review customer_groups migration** — `yarn db:generate`, keep only the intended SQL + snapshot.

### Phase 2 — SPEC-029 Phase 1 (entities and resolution)
- **2.1 Scaffold ecommerce module** — `packages/core/src/modules/ecommerce/` index/acl (§9.3 features)/setup (superadmin/admin all, employee view)/di/events (§9.4)/i18n (de,en,es,ko,pl)/notifications(.client).ts; enable in `apps/mercato/src/modules.ts`, commented-out entry in the create-app template (D22); `yarn generate`.
- **2.2 Entities + validators** — `EcommerceStore`, `EcommerceStoreDomainBinding`, `EcommerceStoreChannelBinding` (§5; includes `price_sort_fallback`; `require_authentication` lands in 5.1), closed zod `settings` schema (§5.1.1 without display availability keys, D12), channel `assortment_scope` validator rejecting `allOf`.
- **2.3 Generate + review ecommerce migration.**
- **2.4 Admin CRUD routes** — `makeCrudRoute` for the three entities (§9.2), `openApi`, optimistic lock, `indexer`, general store PUT rejects `settings.branding` changes, events emitted.
- **2.4-fix Store create branding gate + cascade soft-delete of bindings on store delete** — found during 2.4: `POST /stores` must reject non-default `settings.branding` unless the caller has `ecommerce.branding.manage`; deleting a store soft-deletes its domain and channel bindings (emitting their `.deleted` events) so the domain/prefix is released.
- **2.5 lib/cacheKeys.ts + structural guard** — `buildStorefrontCacheKey(ctx, parts)`, `storefrontCache(container, ctx)` typed accessor (the only `resolve('cache')` in the module); `__tests__/no-raw-cache-access.test.ts` (§6.1 Enforcement, D7).
- **2.6 lib/storeContext.ts** — host → `domainMappingService.resolveByHostname` (`active` only, D1) → one ecommerce query (bindings + store + default channel, longest prefix) (D6); `storeSlug` behind `OM_ECOMMERCE_DEV_STORE_SLUG` (D18); locale order; §6.2 failure modes; resolution cache + tags.
- **2.7 lib/buyerContext.ts** — `getCustomerAuthFromRequest`; tenant/org mismatch → 401 (D4); person+company ids read fresh (D3/D3a); groups/terms via multi-id input; priceKind override; `taxMode` from `CatalogPriceKind.displayMode`; `customerOverlayId` EXISTS probe; assortment = `intersectScopes(channel, groupScope)` (require_authentication short-circuit lands in 5.1); `priceScopeKey`, `assortmentScopeHash` (shared hash), `digest`; buyer cache with `customer:*` + `customer-group:*` tags.
- **2.8 Public /context route** — §9.1 projection, cache headers, declarative rate limit, 401/404/410/503 mapping.
- **2.9 Subscribers** — store/binding/domain/group/price invalidation; `domain_mapping.replaced` re-binding; misconfiguration notifications via `createForFeature`, throttled (§9.4).
- **2.9-fix Explicit comparator in priceScopeKey group-id sort (checkpoint 3 regression)** — `explicit-sort-comparators` repo-wide guard flagged a bare `.sort()` in `lib/buyerContext.ts`; use a code-unit comparator (locale-independent, so the hash is stable).
- **2.10 search.ts** — stores by name/code/slug, `aclFeatures: ['ecommerce.stores.view']` (D16).
- **2.10-fix Lazy-load portal auth so ecommerce DI never imports next/server** — found starting the ephemeral env: `di.ts → storeContextService → buyerContext → customer_accounts/lib/customerAuth → next/server` crashes non-Next processes. Dynamic import at session-read time + structural test over di/search/subscribers import graphs.
- **2.11 Integration tests** — §16 Resolution, Buyer context, Cache isolation, API tenant isolation.

### Phase 3 — Omnibus MVP (`2026-06-30-omnibus-price-tracking.md` Phases 1–3)
- **3.1 History entity + migration** — `CatalogPriceHistoryEntry`, lookback + idempotency indexes, manual immutability trigger per spec, snapshot.
- **3.2 Capture** — `lib/omnibus.ts` (`buildHistoryEntry`, `recordPriceHistoryEntry`, idempotency key, `is_announced`) wired into price create/update/delete and all undo paths.
- **3.2-fix Omnibus: capture history for product/variant price cascades and variant-undo restores** — found during 3.2: `products.ts:1019,2241` and `variants.ts:1077,1079` `nativeDelete` price rows and `variants.ts:353-420` re-creates them on undo without history rows; the spec's file manifest lists both command files.
- **3.3 History route** — `GET /api/catalog/prices/history` (keyset cursor, `findWithDecryption`).
- **3.3-fix Translate ecommerce ACL feature titles (auth ACL i18n guard, missed in 2.1)** — `auth/__tests__/acl-feature-catalog.i18n.test.ts` requires `auth.acl.features.<id>` keys in 5 locales for every declared feature.
- **3.4 Resolution service** — `catalogOmnibusService` (baseline + window, same-row net/gross, promotion anchoring, EU gating, `noChannelMode`, TTL cache) + DI.
- **3.5 Preview + enrichment** — `GET /api/catalog/prices/omnibus-preview`, products-list `afterList` omnibus block.
- **3.6 Config** — `GET|PATCH /api/catalog/config/omnibus` (zod, mutation guards, backfill gate).
- **3.7 ACL + setup + backfill CLI** — `catalog.price_history.view`, `catalog.settings.view`; grants; `omnibus:backfill`.
- **3.8 Admin UI** — `OmnibusSettings`, `PriceEditorOmnibusRow`, i18n (5 locales).
- **3.8-fix Explicit comparators in Omnibus config/settings channel sorts (checkpoint 6 regression)** — repo-wide `explicit-sort-comparators` guard.
- **3.9 Integration tests** — spec test plan for Phases 1–3.

### Phase 4 — Storefront Public API Phase 1 (+ §13 prerequisites)
- **4.1 Catalog product filters extraction** — `catalog/lib/productFilters.ts` with exported query type, descendant expansion; re-export from the route (BC bridge); admin products tests unchanged.
- **4.2 query_index doc-enrichment hook + `overlap` FilterOp** — additive extension point in the indexer; `overlap` op in `packages/shared/src/lib/query/types.ts` + engine (`?|` over jsonb); UPGRADE_NOTES entry.
- **4.3 Catalog scope_keys** — contributor (`cat:` incl. ancestors, `tag:`), GIN expression index migration on `entity_indexes`, reindex triggers (product create/update, category re-parent subtree, deletions), backfill job; fail-closed until backfilled.
- **4.4 buildStorefrontProductScope** — invariant (§3.3) over scope_keys, DNF + `allOf`; property-based equivalence vs `matchesScope`.
- **4.5 Storefront pricing** — `buildStorefrontPricingContext(ctx)`, batched row fetch (`findWithDecryption` + `buildPriceRowFilter`), `selectBestPrice`, amount per `taxMode`, `priceTiers`, Omnibus `lowestPriorAmount`.
- **4.6 Listing** — filters (strict query grammar, unknown → 400), sorts with `availableSorts`/`appliedSort` and `price_sort_fallback`, ILIKE search ranked by `scoreProductSearchRelevance`, page-scoped availability (D21), translation overlays, sanitized fields.
- **4.7 Detail** — `/products/:idOrHandle` payload (§5.2), identical 404 for all hidden cases, `quantityRules` via `policyResolutionService`, sanitized description, related products.
- **4.8 Routes + cache** — public routes through `storefrontCache`, `private, no-store` for authenticated, `stale-while-revalidate` for anonymous.
- **4.9 Integration tests** — §12 assortment/isolation, buyer pricing, enumeration oracle, query/row-count budgets.

### Phase 5 — Buyer-Scoped Visibility Phase 2 (backend)
- **5.1 require_authentication** — column on channel binding + validator; resolver short-circuit to `[]` without calling `customer_groups`.
- **5.2 Generate + review migration.**
- **5.3 Integration tests** — authentication gate (customer_groups not called; closed channel = 200 empty / 404 detail); Phase 4.9 isolation suite passes unmodified.

### Phase 6 — Storefront Public API Phases 2–3
- **6.1 Catalog option/choice label translations** (D20).
- **6.2 Facets** — cross-exclusion, count-facet cache by `assortmentScopeHash`, `priceRange` with items on the digest.
- **6.3 Categories** — `/categories`, `/categories/:slug` (counts within assortment).
- **6.4 Search** — `/search/suggest`; `@open-mercato/search` tokens + pgvector with scope predicate in the query (D19), same response shape.
- **6.5 Rate limiting + OpenAPI** — `checkRateLimit` keyed `ip:storeId`; `openApi` for every route + schema contract test.
- **6.6 Integration tests** — §12 facets, categories, search, rate limits.

### Phase 7 — SPEC-029 Phases 2–3 (branding + admin UI)
- **7.1 brandingStyles.ts** — OKLCH/hex validation, font allowlist, fixed declaration set, SSR `<style>` helper, injection fuzz suite.
- **7.2 Branding routes** — `PUT /stores/:id/branding` command (mutation guards, `ecommerce.branding.manage`, optimistic lock); `GET preview-branding` (query params only).
- **7.3 Assortment-count endpoint** — saved scope + `?draftScope=`.
- **7.4–7.9 Admin UI** — store list/create; General (incl. store-default `AvailabilityPolicy`, D12); Branding + sandboxed live preview; Domains (status read-only, `active` requirement, dangling diagnostic); Channels (include/exclude pickers, `require_authentication`, `price_sort_fallback`, live count); SEO.
- **7.10 Group-terms assortment pickers** (D13).
- **7.11 Seed** — `setup.ts` draft store on tenant creation (idempotent) + Upgrade Action for existing tenants (D17).
- **7.12 Integration tests** — §16 UI paths incl. optimistic-lock conflict.

## Risks

- **Size.** ~60 Steps across catalog, customer_groups, query_index, shared, search and a new module. Safety stop after ~20 consecutive Steps for owner review (executor-dispatch rule).
- **No CI on fork PRs.** The local full `validation.commands` gate (turbo with `--force`) is the only evidence.
- **Migrations.** `yarn db:generate` + review only; owner is asked before any `yarn db:migrate`. Integration suites that need applied migrations wait for that approval or run in the ephemeral test environment.
- **query_index extension point and `overlap` FilterOp** are new contract surface (BC categories 1/2) — additive, documented in UPGRADE_NOTES.
- **Omnibus is a compliance feature** — follow `2026-06-30-omnibus-price-tracking.md` exactly; its immutability trigger is manual DDL outside the snapshot.

## External References

- None (`--skill-url` not passed).
