# Pre-Implementation Analysis: Storefront Public API (rev 3)

> **Spec**: `.ai/specs/2026-08-14-storefront-public-api.md` (rev 3, changelog to 2026-09-16 (b)).
> **Release scope analysed**: Phases 1–3 (listing + detail, facets + categories, search + hardening). Phase 4 (content pages, `contentPageSource`) is **out of scope** for this release and was only checked for leakage into Phases 1–3.
> **Analysed against**: `develop` @ `a108dd07f4` (2026-10-05). No prior pre-implementation analysis exists for this spec.
> **Depends on**: `ANALYSIS-2026-10-05-spec-029-ecommerce-store-module-v4.5.md` (the `StoreContext` it consumes). Consolidated decisions: `ANALYSIS-2026-10-05-storefront-release-decisions.md`.

---

## Executive Summary

The spec's design rules — the client never joins, one scope helper composed by every endpoint, buyer-keyed server cache with `private, no-store` HTTP — are right, and the BC posture is clean (all-new routes). The problem is its **§3.2 "reuse over reimplementation" table and §3.3 scope representation, both of which describe internals that do not exist in the shape claimed**: `PricingContext` has no `priceKindId` and price selection ignores price kind; `buildPricingContext` parses admin query params and never sets `customerGroupIds` or `currencyCode`; `buildProductFilters` takes a non-exported local type, lives in a route module that builds `makeCrudRoute` on import, and does not expand category descendants; the product index document carries **no category or tag ids**, `entity_indexes` has no GIN index, the query engine has no array-overlap operator, and Meilisearch (the default fulltext driver) can filter only on entity and organization — so `scopeKeys` (§3.3) and the in-query search scope (§8.2) are new infrastructure across `catalog`, `query_index`, `shared` and `search`, not a field added to an existing document. Omnibus (`lowestPriorAmount`, R7) is spec-only; `pricing-engine.md` Phase 2b indexes are not shipped and their planned predicate references a non-existent `deleted_at`; option/choice labels are not translatable today. **Recommendation: needs spec updates first** — mainly a revised §3.2/§3.3 that names the real seams and owners, and decisions on scope substrate (D9), price kind (D2) and Omnibus (D11).

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | 7 API routes | Five new `GET` routes under `/api/ecommerce/storefront/*` (Phases 1–3). New, additive. Become STABLE (and a public contract for third-party storefronts) on release; response field removal later is breaking. | None (additive) | Freeze payload names in this spec revision (`availableSorts`/`appliedSort`, `price.displayMode`, `priceTiers`). |
| 2 | 3 Function signatures / 4 Import paths (`catalog`) | Reusing `buildProductFilters` safely requires extracting it (and its query type) from `catalog/api/products/route.ts` into `catalog/lib/`. The route-file exports (`route.ts:107,115,355,806`) are importable today → keep them as re-exports. | Warning | Extract to `catalog/lib/productFilters.ts`; keep `export { buildProductFilters } from '../../lib/productFilters'` in the route for ≥1 minor. |
| 3 | 2 Types (`catalog`) | `PricingContext` gains optional `priceKindId` (D2). Additive optional field. | Warning (additive) | Optional; extend `matchesContext` + `buildPriceRowFilter` + its property test together. |
| 4 | 2 Types (`shared` query engine) | `scopeKeys` filtering needs an array-overlap operator; `FilterOp` is a closed union (`shared/lib/query/types.ts:5`). Adding a member is additive but breaks exhaustive `switch`es in third-party code compiled with `never` checks. | Warning | Add `'overlap'` with a `@since` note in `UPGRADE_NOTES.md`; or keep the predicate inside an ecommerce-owned SQL builder (D9). |
| 5 | 8 DB schema | GIN index on `entity_indexes` (expression over `doc->'scope_keys'`, partial on `entity_type`) and Phase 2b price indexes. Additive. | None | `CREATE INDEX CONCURRENTLY`; no column changes. |
| 6 | 5 Event IDs | Invalidation tags listen to `catalog-product:{id}`, `catalog-category:{id}`, `availability:{tenantId}:{variantId}` — tags, not events; real catalog events are singular (`catalog.product.created\|updated\|deleted`, `catalog.category.*`, `catalog.variant.*`, `catalog.price.*`, `catalog/events.ts:19-40`). **No tag, offer, price-kind or option-schema events exist.** | Warning | List the real event IDs per tag; state TTL-only staleness for tag/price-kind/option-schema edits, or add those events to `catalog` (additive). |
| 7 | 9 DI | Consumes `catalogPricingService` (`catalog/di.ts:13-17`), `domainMappingService`, `policyResolutionService`; `availabilityService` does **not** exist — availability is `resolveAvailability(query)` from `@open-mercato/shared/lib/availability` (`registry.ts:110`). | None | Fix names in §3.1/§3.2. |
| 8 | 1, 6, 10, 11, 12, 13, 14 | No auto-discovery rename, spot IDs, ACL features, notification types, AI IDs, CLI commands or generated-export changes in Phases 1–3. | None | — |

### Missing BC Section

No "Migration & Backward Compatibility" section. §15 has a one-line BC row. Add a section covering rows 2–5 above (catalog extraction bridge, `PricingContext` field, `FilterOp`, index migrations, reindex of existing tenants for `scope_keys`).

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Migration & Backward Compatibility | Catalog/query-engine changes are hidden inside "reuse" claims. | Add (see above). |
| Data/projection model for `scopeKeys` | §3.3 says "no new entity, maintained by the same indexer". The indexer builds docs as `selectAll()` + `cf:*` (`query_index/lib/indexer.ts:27-61`) with **no enrichment hook**; reindex triggers for assignment/category-tree changes are unspecified. | Name the owner, the hook, the reindex triggers (product update, category re-parent → subtree), and the backfill for existing tenants. |
| User stories / UI | N/A — API only. | — |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §3.2 row "Pricing context" | `buildPricingContext(query, channelFallback)` (`route.ts:355`) parses the admin `listSchema`, sets legacy `customerGroupId`, never `customerGroupIds` or `currencyCode`. | Build `PricingContext` directly from `BuyerContext` in `ecommerce/lib`; drop the reuse claim. |
| §3.2 row "Product filtering" | `ProductsQuery`/`listSchema` are local (`route.ts:96`); importing the route module instantiates `makeCrudRoute` (`route.ts:822`); category filter matches `category $in ids` exactly, no descendants (`route.ts:280-296`). | Extract to `catalog/lib` (BC row 2); descendant expansion via `CatalogProductCategory.descendant_ids` (jsonb, `entities.ts:372-379`). |
| §6.1 | `pricingContext.priceKindId` — field does not exist; `selectBestPrice` never filters by kind (`pricing.ts:58-77,148`). | D2. |
| §6.1 | `buildPriceRowFilter` exists and is property-tested (`pricing.ts:102`, `lib/__tests__/buildPriceRowFilter.property.test.ts`) but no production caller uses it; Phase 2b indexes not shipped; planned predicate `WHERE customer_id IS NOT NULL AND deleted_at IS NULL` (`pricing-engine.md:215`) — `catalog_product_variant_prices` has no `deleted_at`. | Fix `pricing-engine.md` Phase 2b predicate; ship 2b before Phase 1 gate (R13 row-count assertion depends on it). |
| §6.2 | "Anonymous buyers use `store.settings.display.priceDisplayModeDefault`" and §12 "anonymous uses the store default" contradict SPEC-029 §6.1a (derive from the channel price kind; store default only when no kind resolves). | Align with §6.1a; fix the §12 test line. |
| §6.2 | "the other is derived through the applicable `SalesTaxRate`, resolved with the buyer's group id set" — `SalesTaxRate.customer_group_id` exists (`sales/data/entities.ts:289`) but is single-valued; the selection rule for a buyer in several groups is unstated. | State it (reuse `customerGroupIds` priority order). |
| §5.1 / R7 `lowestPriorAmount` | Omnibus is not implemented (no `lowestPrior`/price-history code; SPEC-033 and `2026-06-30-omnibus-price-tracking.md` are spec-only). The R7 contract test ("a promotional item without it fails") fails every promotion. | D11. |
| §5.2 `quantityRules` | Sourced "from `AvailabilityPolicy`" — fields exist (`min_order_quantity`, `max_order_quantity`, `quantity_increment`), but they are not in `AvailabilityItemResult`; providers only flip `canFulfil` (`catalogOnlyProvider.ts:64-83`). | Read them via `policyResolutionService.resolveMany` (`availability/lib/policyResolution.ts:239-242`) in the same batch. |
| §4.1 `availability=in_stock` filter, §5.3 availability facet | Availability is resolved per item by a provider after the query; it is not a SQL column. Filtering *before* pagination and counting the facet over a 10 000-product filtered set means resolving availability for the whole set. | D21 (cap like price sort, or define it as post-filter over the page with honest `total`). |
| §7.2 Option schema labels | `catalog/translations.ts` makes option schema `name`/`description` translatable — **not** option labels or choice labels. | D20. |
| §7.2 | `batchLoadTranslations` matches `organization_id IS NOT DISTINCT FROM` exactly (no org→tenant fallback) (`translations/lib/batch.ts:3`). | State it; use `applyTranslationOverlays` (`translations/lib/apply.ts:11`). |
| §8.2 | "search strategies run over Postgres" — true for `tokens` (Kysely) and the `pgvector` driver; the `fulltext` strategy's default driver is Meilisearch, filterable only on `_entityId`/`_organizationId` (`fulltext/drivers/meilisearch/index.ts:110`). | D19. |
| §9 rate limits "per IP, per store" | Declarative `rateLimit` metadata keys by IP only; per-store keying needs `checkRateLimit(rateLimiterService, config, key, …)` (`shared/lib/ratelimit/helpers.ts:34`) with `getClientIp`. Precedent: `directory/api/get/organizations/lookup.ts:34-39,71-92`. | Name the helper and the fail-open/closed posture. |
| §5.2 / R5 sanitization | `sanitizeRichTextHtml` already exists (`shared/lib/html/sanitizeRichText.ts:71`, `sanitize-html` 2.17.5). | Name it; no new dependency. |
| §15 OpenAPI | No public-route OpenAPI helper; security derives from `metadata.requireAuth` (`openapi/generator.ts:842,1087`). | Export `OpenApiRouteDoc` literals; schema-vs-response test as stated. |
| §10 budgets | Query-count budget ≤ 12 for `/products`, but `/categories` counts per category within the assortment and `/categories/:slug` embeds a full `/products` response — no budget for the embedded case. | Add a budget row for `/categories/:slug`. |
| §5.3 options facet | Counts per option value need the variant option values in the aggregation; their storage/aggregation path is unspecified. | Specify the source (variant `optionValues` jsonb vs index doc). |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Root: no cross-module coupling beyond DI/events/FK ids | §3.2 importing `catalog/api/products/route.ts` internals | Extract to `catalog/lib` and import from the package path. |
| Root: never bypass shared data helpers | §6.1 price row fetch | Use `findWithDecryption` (as the admin route does, `route.ts:617-622`) with `buildPriceRowFilter`. |
| Root: keep `pageSize ≤ 100` | §4.1 | Compliant. |
| Root: "Ask First … touching multiple modules in a way not covered by an existing spec" | §3.3 `scopeKeys` touches `catalog` indexer, `query_index`, `shared` query engine, `search` | Spec must name these explicitly (currently "no new entity, the same indexer") before implementation. |
| `packages/cache/AGENTS.md`: tenant-scoped caching via DI `cache` | §9 | Compliant in intent; route through SPEC-029's typed accessor (SPEC-029 H2). |
| Root: i18n | Error messages on `400` (unknown param) are developer-facing | Prefix `[internal]` or use stable error codes; not user-facing copy. |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **C1 — price kind ignored by pricing** (shared with SPEC-029 C2) | Group/channel price-kind configuration has no effect; displayed tax mode can mislabel the amount. Fails the roadmap Phase 1 gate for any tenant whose B2B differentiation is by price kind rather than by group-scoped rows. | D2. |
| **C2 — `scopeKeys` substrate does not exist** | Implementing §3.3 literally is a cross-module infrastructure change; implementing it any other way is what §3.3 explicitly forbids ("a first implementation that puts `EXISTS`-over-junctions inside the helper … makes §8.2's filter-push and R2's facet cost unfixable"). Either path changes Phase 1 size materially. | D9; the SQL emitter must also handle the `allOf` branches `intersectScopes` produces (`shared/lib/catalog-visibility/intersectScopes.ts:49-76`). |
| R13 price fetch unbounded | Phase 2b indexes absent; predicate bug in `pricing-engine.md`. | Fix and ship 2b; adopt `buildPriceRowFilter` in `ecommerce` from day one. |
| R7 Omnibus | No data source; legal exposure if promotions are advertised without a prior price. | D11. |
| R1 cross-buyer cache bleed | Same as SPEC-029; additionally `priceRange` must stay in the digest-keyed entry (§9.1 — correct as written). | Typed cache accessor; isolation suite as Phase 1 gate. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Availability filter/facet at scale | Uncached `/products?availability=in_stock` on 10 000 products blows the 300 ms budget. | D21. |
| R14 search starvation on Meilisearch | Scope cannot be pushed into Meili today. | D19. |
| Translation gaps for options | Polish storefront shows untranslated option facets. | D20. |
| Catalog extraction regressions | Admin `/api/catalog/products` behaviour changes if extraction is not byte-for-byte. | Move code, re-export, keep admin integration tests green unmodified. |
| Missing invalidation events | Tag/price-kind/option-schema edits stale for up to TTL (30–300 s). | State it, or add catalog events (additive). |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Unknown-param `400` breaking naive clients | By design (R6). | Document in OpenAPI. |
| `/categories/:slug` embedded listing cost | Unbudgeted. | Add budget row. |
| Phase 4 references in §9/§12 | Content-page cache rows and tests present in a release that excludes Phase 4. | Mark Phase-4-only rows; do not register `contentPageSource` in this release. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **Price kind as a pricing input** (D2) — §6.1 cannot be written against today's `PricingContext`.
- **`scopeKeys` owner and mechanism** (D9) — §3.3 is a requirement on infrastructure that does not exist; Phase 1's `buildStorefrontProductScope` depends on it.

### Important Gaps (Should Address)

- Rewrite §3.2 against real seams: `PricingContext` built in `ecommerce`; `buildProductFilters` extracted; `resolveAvailability` + `policyResolutionService`; `applyTranslationOverlays`; `sanitizeRichTextHtml`; `checkRateLimit`.
- §6.2 tax-display contradiction with SPEC-029 §6.1a.
- Phase 2b indexes + predicate fix in `pricing-engine.md`.
- Omnibus decision (D11), availability filter/facet decision (D21), option-label translations (D20), Meilisearch scope (D19).
- Real catalog event IDs per invalidation tag; TTL-only staleness stated where no event exists.

### Nice-to-Have Gaps

- `/categories/:slug` budget; options-facet source; `SalesTaxRate` multi-group selection rule; Phase-4-only rows marked.

---

## Remediation Plan

### Before Implementation (Must Do)

1. Decide D2 and amend `pricing-engine.md` (owner of `PricingContext` shape) and this spec §6.1 together.
2. Decide D9; write the `scopeKeys` mechanism into §3.3 with owner, hook, reindex triggers and backfill; include `allOf` handling.
3. Rewrite §3.2 table against the verified seams (see Incomplete Sections).
4. Align §6.2/§12 with SPEC-029 §6.1a.
5. Fix `pricing-engine.md` Phase 2b predicate (`deleted_at` does not exist) and schedule 2b before this spec's Phase 1 gate.

### During Implementation (Add to Spec)

1. Extract catalog filter helpers with re-export bridge; add Migration & BC section.
2. Real event IDs per cache tag; declare TTL-only cases.
3. Rate-limit helper and keys; OpenAPI literal docs.
4. Decisions D11, D19, D20, D21 recorded in §14.

### Post-Implementation (Follow Up)

1. Materialized price projection (ADR-9) once a tenant hits the 5 000 cap.
2. Phase 4 (content pages) needs its `content`-module storage spec first — `packages/content` has no `di.ts`, entities or `i18n/` today, and its pages hard-code English (`frontend/terms/page.tsx`), contrary to its own AGENTS.md.

---

## Recommendation

**Needs spec updates first.** The API contract and safety rules can stay as they are. The reuse table and the scope representation need rewriting against the code that exists, and two decisions (price kind, scope substrate) change how big Phase 1 is. Do not start Phase 1 until D2 and D9 are decided, because both are FROZEN-adjacent choices: once data is indexed and keys exist they cannot be changed cheaply.
