# Notify — 2026-10-05-release-3-storefront-read-side

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-05T10:47:00Z — run started
- Brief: storefront read side release — roadmap Phase 1 + visibility Phase 2 (SPEC-029 P1–3, Storefront Public API P1–3, Omnibus MVP, prerequisites), continuing fork PR #12.
- External skill URLs: none
- Decisions: owner override — reuse PR #12 and its branch instead of feat/release-3-storefront-read-side; Phase 0 already done (8040682f1a). Owner added Omnibus to this PR (D11); authoritative spec = 2026-06-30-omnibus-price-tracking.md (it supersedes SPEC-033), MVP Phases 1–3 only.
- Repo guard: all pushes to remote `fork`; all gh commands with --repo adeptofvoltron/open-mercato; upstream read-only.

## 2026-10-05T11:02:21Z — Step 1.5 scope decision: no ancestor inheritance for assortment scope
- customer-groups spec §6.4 and visibility spec §3.1 define the union over "each currently-matching group's own scope" and say nothing about walking parent groups (the §6.1 ancestor walk is stated for the scalar terms only). `resolveAssortmentScope` therefore reads each matching group's OWN terms row only (`loadGroupOwnAssortmentScope`); a parent's scope is not inherited. A matching group with no terms row, a null scope, or a scope whose lists are all empty contributes `null` (unrestricted), which makes the union unrestricted per `unionScopes`.
- Not in this step: catalog existence check for category/tag ids (US-A1 inline error) — belongs with the pickers (Step 7.10) or a later validation pass.

## 2026-10-05T11:05:17Z — checkpoint 1 (steps 1.1–1.6)
- Phase 1 prerequisites green: typecheck shared+core, 53 shared + 1051 core tests.
- Decision: Tasks-table Commit cells are back-filled by the following commit (a commit cannot embed its own SHA).
- Decision: unrelated wms snapshot drift from `yarn db:generate` is discarded each time; catalog/customer_groups snapshots hand-limited to the intended entries.
- Note (minor, for final review): `hashEffectiveScope` uses node:crypto and is exported from the catalog-visibility barrel; client imports of that barrel would pull it in.

## 2026-10-05T11:47:14Z — scope decision (2.4-fix appended)
- 2.4 executor flagged: POST /stores accepts branding without ecommerce.branding.manage; store delete leaves bindings holding the domain+prefix. Decision: gate branding on create by feature; cascade soft-delete bindings on store delete. Appended Step 2.4-fix.
- Note for spec changelog: branding fonts are stored as allowlist ids (ECOMMERCE_BRANDING_FONTS), not CSS strings (2.2 decision).

## 2026-10-05T11:53:55Z — implementation decision (2.4-fix)
- Store delete cascade runs in the CRUD factory's `afterDelete` hook as its own `em.transactional` (find live bindings → nativeUpdate deleted_at), with a compensating restore of the store's deleted_at if the cascade fails (customer_groups `cascadeGroupDelete` precedent). Staging binding mutations in `beforeDelete` to ride the factory's store flush would put a query (`deleteOrmEntity`'s findOne) between dirty scalars and the flush — the SPEC-018 pattern core AGENTS.md forbids. Binding `.deleted` events + query-index removal go through dataEngine.markOrmEntityChange after commit, then per-binding CRUD cache invalidation.
- Create branding gate: non-empty `settings.branding` without `ecommerce.branding.manage` (rbacService.userHasAllFeatures, wildcard-aware, fail-closed) → 403 with a `settings.branding` field error (status 403 per SPEC-029 §verification for the branding route; field-error shape as the 2.4 PUT case).

## 2026-10-05T12:01:57Z — checkpoint 2 (steps 2.1–2.4-fix)
- ecommerce scaffold, entities, migration, admin CRUD green: typecheck core, 307 core tests, i18n sync, template parity.

## 2026-10-05T12:15:58Z — implementation decisions (2.6)
- Dangling binding (R3): a hard-deleted DomainMapping drops its hostname, so on the request path it is indistinguishable from an unknown host (resolveByHostname → null → 404, logged `reason=domain_mapping_not_active`). The "domain removed" diagnostic must come from the admin Domains tab (findById null) and/or the 2.9 `customer_accounts.domain_mapping.deleted` subscriber, which knows both host and id. Resolver logs distinct 404 reasons (`domain_binding_not_found`, `domain_routing_unavailable`, `slug_ambiguous` at warn).
- Path-prefix matching uses `options.pathname` when given, else the request URL pathname. The public /context route (2.8) is an API path, so it must pass the storefront page path explicitly (e.g. a `path` query param) for prefix stores to resolve.
- Dev slug rule: slug is unique per tenant; `resolveStoreBySlug(..., { tenantId })` scopes by tenant, otherwise the slug must be unique across tenants (ambiguous → 404). No `?tenant=` param was added.
- Resolution cache entry = all bindings of a domain mapping (key per mapping id; tags ecommerce-store:*, ecommerce-domain:{host}, ecommerce-domain-mapping:{id}); longest-prefix selection is in memory so the key does not vary by path. Empty binding lists are cached (2.9 must invalidate by the mapping tag on binding create). The 503 misconfiguration throttle is an untagged 1h resolution-cache entry.

## 2026-10-05T12:44:58Z — checkpoint 3 (steps 2.5–2.9-fix)
- Store/buyer resolution, /context and subscribers green after one regression fix (bare sort → 2.9-fix).
- Spec sync list (apply to SPEC-029 at run end): rate-limit keyPrefix `ecommerce_storefront_context` (spec §12 says ecommerce_context); route file at `api/storefront/context/route.ts` (spec §10 lists api/get/...); branding fonts stored as allowlist ids; `/context` takes `?path=` for path-prefix matching; price-row deletes rely on 60 s TTL; `sales.channel.*` not subscribed (no cached field depends on it).
- Decision: integration tests run in the ephemeral environment (own containers + DB) — this is not a local `yarn db:migrate`.

## 2026-10-05T13:27:32Z — checkpoint 4 (steps 2.10–2.11) + safety stop
- SPEC-029 Phase 1 gate green: 12/12 ecommerce integration tests in the ephemeral env, 429 core unit tests.
- Env decisions: integration fixture activates DomainMappings via direct DB update (no API reaches `active` without DNS/TLS, same as existing dbFixtures tests); custom host sent as a real `Host` header because the ephemeral app runs NODE_ENV=production (X-Force-Host only honored in test mode); ephemeral app needs a non-placeholder JWT_SECRET (passed as a throwaway env var).
- Open for final gate: resolution P95 latency budget not measured yet.
- SAFETY STOP: 20 consecutive Steps landed (1.1–2.11 incl. fix rows). Halting dispatch for owner review before Phase 3 (Omnibus). Resume with `om-auto-continue-pr-loop 12` from Step 3.1.

## 2026-10-05T15:05:51Z — resume started (om-auto-continue-pr-loop)
- Resuming at Step 3.1 (Omnibus MVP) after the owner-review safety stop.

## 2026-10-05T15:46:29Z — checkpoint 5 (steps 3.1–3.3-fix)
- Omnibus history foundation green. Full core suite: only the pre-existing locale-dependent warranty_claims quantity test fails (passes under en_US).
- Regression caught: ecommerce ACL feature titles lacked auth i18n keys (from 2.1) → 3.3-fix. Checkpoints now run full core + shared suites.
- Known limitation (pre-existing, not in scope): undo of a product delete does not restore prices, so it records no history.

## 2026-10-05T16:19:10Z — step 3.6 scope decisions
- PATCH /api/catalog/config/omnibus is a shallow top-level merge (a provided `channels` map replaces the stored one; `defaultPresentedPriceKindId: null` clears it). Strict schema: unknown keys, Phase-4 derogation fields and `backfillCoverage` are rejected with 400 field errors (`backfillCoverage` is server-managed so the 422 gate cannot be bypassed — Step 3.7's `omnibus:backfill` must write it via ModuleConfigService directly).
- Config PATCH invalidates via a new tenant-wide cache tag `catalog:omnibus:<tenantId>` (added to every omnibus cache entry), since the config is tenant-scoped and spans organizations.

## 2026-10-05T17:20:07Z — checkpoint 6 (steps 3.4–3.8-fix)
- Omnibus resolution/config/backfill/UI green after one regression fix (bare sorts → 3.8-fix). UI smoke screenshot captured in the ephemeral env (port changes per start; read it from the start log).
- Playwright note: the repo's `@playwright/test` resolves a chromium revision not installed here; screenshots use `executablePath` of the installed headless shell (1243).
- Known gap (from 3.8): config page is gated by `catalog.settings.manage`, so view-only users cannot open the Omnibus panel yet (panel itself supports read-only).

## 2026-10-05T17:48:10Z — checkpoint 7 (Phase 3 close)
- Omnibus MVP gate green: 8/8 TC-CAT-OMNI integration tests.
- Pre-existing bug found by 3.9 (not fixed, out of scope): minimal-payload product-level price PUT → 403 in updatePriceCommand scope check. Follow-up issue candidate.
- Env: executor installed Playwright chromium-headless-shell build 1228 into ~/.cache/ms-playwright (repo's playwright-core 1.61.1 needs it).

## 2026-10-05T18:12:31Z — step 4.3 scope decisions
- GIN index migration lives in **query_index** (`Migration20261005201500_query_index`), not catalog as the step text suggested: modules migrate alphabetically, so on a fresh DB a catalog migration runs before query_index creates `entity_indexes` (and CREATE INDEX CONCURRENTLY cannot be wrapped in a DO-block existence check). This matches the spec §3.3 ownership table. Manual DDL, not in any snapshot; guard test in `catalog/__tests__/product-scope-keys-index.test.ts`.
- Reindex triggers: persistent subscribers on `catalog.category.updated` (only when the payload carries `hierarchyChanged: true`) and `catalog.category.deleted`. The category update command now adds `hierarchyChanged` + `previousDescendantIds` to the payload on a parent change (additive); category update/delete **undo** now emit `catalog.category.updated` with `hierarchyChanged` (previously emitted nothing). Subtree ≤ 500 products → per-product `query_index.upsert_one` from the worker; above → one scoped `query_index.reindex` job.
- Product assignment edits need nothing extra: they go through product commands, which already emit with `productCrudIndexer`.
- Tag deletion has no event (R16): covered by the next product reindex / periodic coverage only.
- Spec sync list: `scope_keys` backfill per existing tenant = `yarn mercato query_index reindex --entity catalog:catalog_product --tenant <tenantId>` (omit `--tenant` for all tenants); until it completes, docs lack `scope_keys` and `isProductScopeIndexed(doc)` (catalog/lib/productScopeKeys.ts) returns false → Step 4.4 must fail closed.

## 2026-10-05T18:22:25Z — step 4.4 scope decisions
- The query-engine filter grammar has no `$not` (it is silently dropped by `normalizeFilters`), so exclusions were not expressible. Added an additive `noverlap` FilterOp (`$noverlap`) next to `overlap` in both engines: index-doc arrays → `(jsonb_typeof(expr) = 'array' and not (expr ?| $n::text[]))` (missing/null key never matches), array columns → `not (col && $n)`, `cf:*` keys → `false` (unsupported, never widens). UPGRADE_NOTES overlap entry extended.
- `buildStorefrontProductScope` returns `{ tenantId, organizationId, withDeleted: false, filters }`; later steps must AND endpoint filters via `composeStorefrontProductFilters` (never spread `filters`). Every restricted branch carries `scope_keys $exists` (fail closed on unindexed docs); deny-all is `scope_keys $overlap []` (an empty `$or` would be dropped by the normalizer and widen).
- Pre-existing bug found (not fixed, out of scope): `normalizeFilters` treats a disjunct that is empty (initially, or after `liftCommonClauses`) as absent instead of TRUE, so `A OR (A AND B)` compiles to `A AND B` (narrows). The scope builder absorbs implied branches to stay exact; other `$or` callers (advanced filters) are still affected. Follow-up issue candidate.

## 2026-10-06T09:35:38Z — checkpoint 8 (steps 4.1–4.5) + owner decision D2a
- Phase 4 part 1 green: full core 19420 / shared 2641 passing.
- Owner decision D2a (2026-10-06): promotional price kinds act as an overlay on D2's priceKindId filter (resolved kind OR isPromotion kinds). Appended Step 4.5-fix.
- Follow-up issue candidates (pre-existing, shared filter normalizer, found in 4.4): `A OR (A AND B)` collapses to `A AND B`; `$not` filters are silently dropped. Storefront scope builder works around the first.
- Spec sync additions: `noverlap` FilterOp; GIN migration lives in query_index (module migration order); backfill = `yarn mercato query_index reindex --entity catalog:catalog_product --tenant <id>`; category.updated payload gains hierarchyChanged/previousDescendantIds.

## 2026-10-06T09:55:58Z — step 4.6 scope decisions
- `featured` has no backing rank in catalog yet: it orders by `created_at desc` (same as `newest`) until merchandising supplies one. Default sort = `relevance` with a search, else `featured`; `relevance` is offered only with a search (requested without one → default).
- Relevance with a search ranks the whole filtered set in memory (≤ cap); past the cap it ranks the SQL title-ordered page only and sets `sortApproximate`.
- Under `price_sort_fallback = 'unavailable'` past the cap, `priceMin/priceMax` are left unapplied (absent from `appliedFilters.price`); under `'approximate'` they filter on the default-kind list prices with `appliedFilters.price.approximate = true`.
- Spec leaves `AppliedFilters` undefined; shipped shape: `{ search?, category?: {id, slug, includesDescendants}, tagSlugs?, price?: {min, max, approximate}, options?, productType?, availability?: {value, scope:'page'} }`. Response adds `priceSort: {cap, fallback, capExceeded}`, `sortApproximate`, `sortUnavailable` (route 4.8 maps the two flags to `X-Sort-Approximate` / `X-Sort-Unavailable`). Unknown / out-of-assortment category and unknown tag slugs are dropped from the filter and absent from the echo.
- Translations: `batchLoadTranslations` is single-entity-type, so a page issues up to 3 batched overlay queries (product, category, tag) instead of §10's "1 translations". Plain page = 10 queries, price-sorted page = 11 (≤ 13 asserted). Step 6.2 (≤ 5 facet queries) will exceed 13 unless translations become one multi-type query (additive helper in `translations/lib/batch.ts`) — flag for 6.2.
- Grammar rejects repeated parameters (`duplicate_parameter`) as well as unknown ones; schema lives in `data/validators.ts` (`ecommerceStorefrontProductListQuerySchema`), bracket parsing + `StorefrontQueryError` in `lib/storefrontQuery.ts`.

## 2026-10-06T10:10:35Z — step 4.7 scope decisions
- Query budget (§10 "≤ 7, independent of variant count"): holds for an uncategorized product (20 variants = 7: scoped lookup, one joined product load with variants/category+tag assignments/option template, media, prices, one multi-type translation query, availability, policies). A categorized product adds the related-products lookup + load and the breadcrumb ancestors → 10 (asserted ≤ 10). Both counts are constant in the variant count. §10's 7 does not budget related products or breadcrumb — spec sync item.
- The product load uses MikroORM `strategy: 'joined'` (one SQL); rows grow as variants × category assignments × tag assignments of one product (and of ≤ 8 related products).
- Not-found path (R4): exactly one query — id/handle match (UUID → `id`, otherwise `handle`) composed with `buildStorefrontProductScope`; restricted / inactive / deleted / other-tenant / nonexistent all return `null` with an identical query.
- Added `batchLoadTranslationsMany` (additive, `translations/lib/batch.ts`): one query for several entity types. 4.6 listing left on the single-type helper (behaviour unchanged) — 6.2 can switch to it.
- 4.6 helpers extracted to `lib/storefrontCatalogSupport.ts` (list-item builder, overlays, generalized product+variant availability/policy resolver); `storefrontProducts.ts` re-exports `isCategoryInAssortment` and its public types, behaviour unchanged.
- Option/choice label overlay reads template translation fields `options.<optionCode>.label` and `options.<optionCode>.choices.<choiceCode>.label` (`optionLabelTranslationField` / `optionChoiceLabelTranslationField` in `lib/storefrontDetail.ts`). Step 6.1 (D20) MUST use this key format (or move the helpers into catalog and re-export).
- Detail-payload decisions: `selectedVariantId` added (requested variant if it belongs to the product, else the default variant, else null; an unknown `variantId` is not a 404). `quantityRules` = resolved policy value, falling back to the product's `minOrderQty` / `maxOrderQty` / `orderQtyIncrement` where the policy sets none. `relatedProducts` = up to 8 products whose `scope_keys` overlap the product's visible assigned categories (so descendants count), same scope, newest first, `hideWhenOutOfStock` applied. `dimensions.length` maps catalog `depth`. Media = product attachments, default media first, `alt: null` (no alt column).
- Found (4.5, not changed): product-level `priceTiers` resolve over all product rows incl. variant-specific rows, so on a product whose variants carry their own prices the variant row (+8 score) wins every tier quantity and the tiers collapse to `[]`. Follow-up candidate: resolve tiers over product-level rows only, or per variant.

## 2026-10-06T11:20:52Z — checkpoint 9 (Phase 4 close) + safety stop
- Public API Phase 1 gate and the release ACCEPTANCE green (TC-ECOM-010..013 9/9, TC-ECOM-001..004 12/12, full unit suites).
- Spec sync additions: detail query budget 10 with categories (related + breadcrumb); `selectedVariantId` + per-variant `priceTiers`; option label translation key format `options.<code>.label` / `options.<code>.choices.<choice>.label` (6.1 must follow); `featured` sort = newest until a featured rank exists; TTL-only invalidation cases (tags/offers/price kinds/option schemas, deleted variants/prices).
- SAFETY STOP: 22 Steps landed since resume (3.1–4.9 incl. fix rows). Next: Step 5.1 (require_authentication). Resume with `om-auto-continue-pr-loop 12`.

## 2026-10-06T11:23:00Z — om-auto-continue-pr-loop resume
- Resumed by: @adeptofvoltron
- Resume point: 5.1 (source: HANDOFF.md + Tasks table, agree)
- PR head SHA: 5805b4b8bd
- Worktree reused (created by the original run). Ephemeral env from the previous session still running (port 41351); rebuild + restart before Phase 5 integration tests.

## 2026-10-06T12:26:53Z — checkpoint 10 (Phase 5 close)
- Visibility Phase 2 gate green: TC-ECOM-005 3/3, TC-ECOM-01 9/9 (unmodified), TC-ECOM-00 15/15, full core 19561.
- Env: restarted the ephemeral env on a forced rebuild (previous session's env stopped). Integration runs need `DATABASE_URL` exported alongside `BASE_URL`.

## 2026-10-06T12:50:00Z — step 6.1 scope decisions
- Key format unchanged (`options.<optionCode>.label`, `options.<optionCode>.choices.<choiceCode>.label`). The two helpers moved to `catalog/lib/optionSchemaTranslations.ts` (single source of truth); `ecommerce/lib/storefrontDetail.ts` re-exports them under the same names.
- The translations module is generic over static field lists, so per-option keys cannot be declared statically. Added a record-driven expander registry in shared (`registerTranslatableFieldExpander`) and `resolveFieldList(..., baseValues)` now appends expanded keys (with base values and labels) after the registered ones. Catalog registers its expander as a top-level side effect of `catalog/translations.ts` (that file is already imported by the generated `translations-fields.generated.ts` on server and client), so no generator change was needed. Works in the standalone Translation Manager (record from `/api/catalog/option-schemas`) and in the embedded widget when a host passes the record as `baseValues`.
- Translation PUT validator field-key max raised 100 -> 400 (additive relaxation): a choice key can reach 150 + 150 chars of codes.
- No new user-facing strings (expansion labels are record data such as `Color › Red`), so no locale changes; `yarn i18n:check-sync` is green.
- Mocks of `@open-mercato/shared/lib/localization/translatable-fields` must now also provide `registerTranslatableFieldExpander` (updated the one existing mock).


## 2026-10-06T12:51:13Z — step 6.2 scope decisions
- Facet universe = assortment scope + search clause (search is the one non-facet filter). Cross-exclusion is computed in memory over that one universe load, so the no-filter case and every filtered case cost the same 5 facet queries: universe (query engine: id, product_type, option_schema_id), category+tag assignments (one Kysely `UNION ALL`, tag slug/label joined in), the tenant's non-deleted categories, the universe's active variants (chunked `$in` at 10 000 ids), the option schema templates (skipped when none). §5.4's per-dimension SQL GROUP BY is replaced by this; semantics match the listing's SQL filters (category = assigned to it or a descendant, tags = any, options = all codes on the same variant).
- Option codes are separate dimensions: `options[color]` counts keep `options[size]` applied (same variant) but not `options[color]`. Count facets do NOT apply `priceMin/priceMax` (they would depend on buyer prices, which the assortment-keyed entry must not); only `priceRange` cross-excludes price.
- Count facets list nonzero entries only (a selected value whose count drops to 0 under the other filters disappears; `appliedFilters` still echoes it). Categories: active + in assortment, descendant-inclusive counts, ordered depth → localized name; tags count desc → label; options by label, values in template choice order (choice matched by code, then label; untemplated values fall back to the stored value, untemplated codes to the code); product types in `CATALOG_PRODUCT_TYPES` order with `catalog.products.types.<type>` labels in the effective locale. `facets.total` = response `total`.
- Cache split (§9.1): count facets cached via `storefrontCache` `scope: 'assortment'` (store + effective locale + `assortmentScopeHash`), parts = `products-count-facets` + hash of {search, categoryId, categorySlug, tagSlugs, options, productType}, TTL 30 s, tags `catalog-products:<tenant>` (+ `catalog-category:<id>` when filtered) + the store tag. `priceRange` and page-scoped `availability` are computed per request and ride in the digest-keyed listing entry. Canonical query hashing moved to `storefrontCacheValueHash` in `cacheKeys.ts` (listing key unchanged).
- `priceRange` = min/max of each product's from-price (the amount the price filter compares) over the filtered set without the price filter. To price that set the listing now always reads ordered candidates (≤ cap) and pages in memory — plain listings included; past the cap: `'approximate'` ranges over default-kind list prices (re-reads all candidate ids + one price query), `'unavailable'` returns `priceRange: null`. No approximate flag on `priceRange`; `priceSort.capExceeded` signals it.
- `availability` facet = states of the returned page after `hideWhenOutOfStock`, before the `availability=` filter, ordered in_stock, low_stock, backorder, preorder, not_tracked, out_of_stock.
- Query budget (unit counters, uncached): plain page 13 (facets 5 + candidates, prices, page products, category assignments, tag assignments, 1 multi-type translation query incl. facet labels, availability, policies) — the facet variant load replaces the listing's own variant query; price-sorted 13; search 13; count-facet cache hit 9. Not within 13: category filter 16 (+3 pre-existing filter prequeries), past-cap `'approximate'` 15. Asserted: plain and price-sorted ≤ 13, count-facet hit ≤ 9.
- Listing translations switched to `loadStorefrontTranslations` (`batchLoadTranslationsMany`, one query per response).

## 2026-10-06T13:02:13Z — step 6.3 scope decisions
- Visibility: a category is visible when it is active, every ancestor is active (so the tree can reach it) and `isCategoryInAssortment` admits it. Parents of an admitted category are always admitted (reach ⊇ descendants, exclusions inherit down), so a visible node's `parentId` never points at a hidden category. The one divergence from facets/listing/detail (self-active only): a child of an inactive parent is absent from the tree and 404s on the landing, while `/products?categorySlug=` still resolves it.
- Counts: descendant-inclusive, over the assortment universe (`buildStorefrontProductScope` through the shared `queryStorefrontProductUniverse`, now exported from `storefrontFacets.ts`) plus one category-assignment query; a product counts once per category and ancestor. Uncached cost 4 queries regardless of tree size (categories, universe, assignments, one multi-entity translation query); a deny-all assortment (closed `require_authentication` channel) costs 0 and yields `{ tree: [] }` / 404.
- Cache (deviation from the §9 table, which says `digest`): both the tree and the landing's category block are price-free, so they are keyed `scope: 'assortment'` (store, effective locale, `assortmentScopeHash`), TTL 300 s / 60 s, tags `catalog-products:<tenant>` (+ `catalog-category:<id>` for the landing). The landing's embedded `/products` response goes through `cachedListStorefrontProducts` on the digest, so it shares the entry of an identical `GET /products?categoryId=…`. Spec §9 sync (rows `/categories`, `/categories/:slug`) is left for the next checkpoint's spec sync.
- 404 parity: nonexistent, inactive, deleted, foreign-tenant, out-of-assortment and under-inactive-ancestor slugs all take one categories query and answer `{ "error": "category_not_found" }`; a 404 is never cached. If the embedded listing no longer resolves the cached category (deactivated inside the TTL), the landing answers the same 404 instead of an unfiltered catalogue. An unknown, hidden or foreign `parentId` on `/categories` yields the same empty tree as a nonexistent one.
- Grammar (§4.3 is silent on `depth`): `depth` = number of levels returned from the starting level (1..20, default all); a node cut by `depth` has `children: []` and `hasChildren: true`. `includeEmpty` accepts `true|false|1|0`. `/categories/:slug` takes the `/products` grammar minus `categoryId`/`categorySlug` (`400 unknown_parameter`; the path slug is the category) — the list schema's shape was split into `storefrontProductListFilterShape` + category shape in `data/validators.ts` (behaviour of the list schema unchanged). Landing `children` list non-empty visible children only; siblings sort by localized name then id.
- `seo` is `{ title: null, description: null, canonicalUrl: null }`: `CatalogProductCategory` has no SEO columns and `catalog/translations.ts` declares only `name` and `description` for categories (spec §7.2 lists category SEO translations, which do not exist). Contract slots kept; filling them needs a catalog follow-up.
- HTTP: `/categories` anonymous `public, max-age=300, stale-while-revalidate=60` (matches the 300 s server TTL), landing `public, max-age=30, stale-while-revalidate=30`; authenticated `private, no-store`. Rate limits 120/min (`/categories`) and 240/min (`/categories/:slug`, same as product detail); 6.5 reviews all storefront limits.
- Unit tests only (integration in 6.6): tree/counts/assortment/deny-all/depth/parentId/overlay/budget (`storefrontCategories.test.ts`), cache keying + tags + shared list entry (`storefrontCategoryCache.test.ts`), both routes, parsers. `yarn generate` run; no generated file is committed.
