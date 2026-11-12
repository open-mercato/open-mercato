# Storefront Release (fork) — Consolidated Decisions

> **Release scope**: SPEC-029 Phases 1–3 · Storefront Public API Phases 1–3 · Buyer-Scoped Catalog Visibility Phase 2 only.
> **Verified against**: `develop` @ `a108dd07f4` (2026-10-05).
> **Source analyses**: `ANALYSIS-2026-10-05-spec-029-ecommerce-store-module-v4.5.md` · `ANALYSIS-2026-10-05-storefront-public-api.md` · `ANALYSIS-2026-10-05-buyer-scoped-catalog-visibility-phase-2.md`.

## Release-level facts that shape every decision

- No `ecommerce`, `cart` or `pricing` module exists on `develop`; the whole release is additive.
- Phase 0 is partial: the shared visibility algebra shipped (with an undocumented `allOf`), but `resolveAssortmentScope()` always returns `null`, because `CustomerGroupTerms.assortment_scope` was not shipped.
- No cart exists, so leaving out visibility Phase 3 is safe **only while no storefront add-to-cart ships**.

## Decisions (options and recommendations; the owner's choices are in "Decisions taken" below)

Blocking ones (**B**) must be settled before Phase 1 code starts.

| # | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| D1 | Which `DomainMapping.status` a store serves on | `verified` (as specified) / `active` | **`active`**. `verified` means TLS has not been issued yet, and `resolveByHostname` returns only `active`. Binding to a domain in any status stays allowed. | **B** — SPEC-029 P1 |
| D2 | How a price kind takes part in price selection (and therefore `taxMode`) | (a) optional `priceKindId` on `PricingContext`, filtered in `matchesContext` and `buildPriceRowFilter`; (b) ecommerce pre-filters rows by kind; (c) leave as is | **(a)**. It is additive and owned by `pricing-engine.md`. Show the amount from the selected row's net/gross field that matches `taxMode`. Contract rows must be written against the buyer's kind; document that. | **B** — SPEC-029 P1, API P1 |
| D3 | What `BuyerContext.customerId` / `companyId` mean | `CustomerUser.customer_entity_id` (company) / `person_entity_id` (person) / union of both | **`customerId = customerEntityId ?? personEntityId`, `companyId = customerEntityId`**, read fresh from the DB (cached 60 s), not from the JWT. Groups resolve for one id; a union of both is a later change. | **B** — SPEC-029 P1 |
| D4 | Portal token whose tenant/org differs from the store's | 401 / treat as anonymous | **Treat as anonymous** and log it, covered by an integration test using a second-tenant token. | **B** — SPEC-029 P1 |
| D5 | Domain constraints: at most 2 mappings per org, supersession via `replaces_domain_id`, hard delete | Accept and document / raise the limit in `customer_accounts` | **Accept for this release.** Multi-store per org goes through `path_prefix`. Add a subscriber on `domain_mapping.replaced` that re-points bindings, and an R3 diagnostic for deleted mappings. | SPEC-029 P1 |
| D6 | How host → store resolves | One 4-table SQL join across modules / `domainMappingService` (cached) + one ecommerce query | **The second.** It is a DI seam, already cached and tagged, and the P95 budget still holds because hop 1 is a cache hit. | SPEC-029 P1 |
| D7 | Shape of the R1 structural guard | As specified (regex on `cache.resolve(`/`.get(`/`.set(` over `api/**` plus REPO_WIDE_GUARDS) / redesign | **Redesign.** `lib/cacheKeys.ts` is the only file allowed to call `resolve('cache')` and exposes a typed `storefrontCache(ctx)`. A module-wide regex ban (`api/`, `lib/`, `subscribers/`) is modelled on `command-interceptor-http-coverage.test.ts`. No REPO_WIDE_GUARDS entry. | **B** — SPEC-029 P1 |
| D8 | Where the canonical `assortmentScopeHash` lives | ecommerce / `packages/shared/lib/catalog-visibility` | **`packages/shared`** (`canonicalizeEffectiveScope`, `hashEffectiveScope`). It recurses into `allOf` and has a property test for branch order. The channel-binding validator rejects `allOf`. | SPEC-029 P1 |
| D9 | Substrate for `scopeKeys` (the SQL twin of `matchesScope`) | (a) `scope_keys` in the catalog product index doc, with an indexer enrichment hook, GIN on `entity_indexes` and an `overlap` FilterOp; (b) ecommerce-owned projection table; (c) EXISTS over junctions in P1, migrate later | **(a)**, run as a separate pre-step. It is the spec's literal intent and keeps one projection substrate (ADR-9). It touches catalog, query_index, shared and search, so it needs the "Ask First" multi-module approval. If time does not allow, choose (c) consciously and record that §3.3 is deferred, since the spec forbids this silently. | **B** — API P1 |
| D10 | `ecommerce.branding.manage` vs the single `PUT /stores/:id` writing `settings` | Separate `PUT /stores/:id/branding` (command, mutation guards) / drop `branding.manage` | **Separate branding route.** It still locks on the store's `updated_at`, so two admins saving different tabs at once still get a 409 — an honest conflict rather than a silent overwrite; a branding-only version field would be needed to remove it. | SPEC-029 P2/P3 |
| D11 | Omnibus (`lowestPriorAmount`): no implementation in the repo | Implement SPEC-033 first / ship `null` and suppress promotion presentation / ship `null` and keep `isPromotion` | **Ship `null` and suppress presentation:** `originalAmount = null`, `isPromotion = false` and no sale badge until SPEC-033 lands. A contract test asserts that no "was" price appears without `lowestPriorAmount`. | API P1 |
| D12 | Store-level `showOutOfStock`/`allowBackorder` in `settings` vs the `AvailabilityPolicy` store_default row | Keep both / settings only / policy row only | **Policy row only** (`store_id = store.id`), edited from the store's tab through the availability API. Remove the two keys from `settings.display`. `hideWhenOutOfStock` must still go into `AvailabilityItemResult` or be read through `policyResolutionService.resolveMany`. | SPEC-029 P1 |
| D13 | Group-level assortment scope in this release | Add `CustomerGroupTerms.assortment_scope` and replace the stub / channel-only scope this release | **Add the column and replace the stub.** The spec already defines it, it is small and owned by `customer_groups`; without it R7, US-A1 and the channel ∩ group tests are hollow. Fallback: state "channel-level only" in the UI and release notes. | Visibility P2 |
| D14 | Channel-binding exclude pickers (spec lists them in visibility Phase 3) | Leave them in P3 (outside the release) / move them to P2 | **Move them to P2.** SPEC-029 §11 and US-B1 expect them on the Channels tab. | Visibility P2 |
| D15 | Reconciling `BuyerContext` with roadmap ADR-7 | Change SPEC-029 / change ADR-7 | **Change ADR-7** to SPEC-029's shape, `storeContextService`, and the derived `taxMode`. SPEC-029 owns the resolver, and channel/currency/locale already live on `StoreContext`. | SPEC-029 P1 (type becomes STABLE) |
| D16 | `search.ts` for stores | Add / scope out | **Add a minimal one** (name/code/slug, `aclFeatures: ['ecommerce.stores.view']`). | SPEC-029 P3 |
| D17 | Draft store for existing tenants | Upgrade Action / lazy seed when the list is first opened / none | **Upgrade Action** (`configs/lib/upgrade-actions.ts`, `requiredModules: ['ecommerce']`). | SPEC-029 P3 |
| D18 | Gating for `?storeSlug=` and draft `403` | `NODE_ENV` / explicit env flag | **Env flag `OM_ECOMMERCE_DEV_STORE_SLUG`**, default off and on in the dev `.env.example`. Staging runs with `NODE_ENV=production`. | SPEC-029 P1 |
| D19 | Search backends in API Phase 3 | `tokens` + pgvector only / also Meilisearch (needs `scope_keys` as a filterable attribute) | **`tokens` + pgvector in this release.** Meilisearch only after `scope_keys` is pushed as a filterable attribute; R14 is not achievable without it. | API P3 |
| D20 | Translating option/choice labels (facets) | Extend `catalog/translations.ts` / base labels this release | **Extend catalog translations** (additive). Otherwise facets on a PL storefront stay untranslated. | API P2 |
| D21 | `availability=in_stock` filter and the availability facet at scale | Cap like price sort (5 000) with an honest header / post-filter of the page only / SQL projection of stock | **Cap at 5 000**, mirroring price sort: `X-Availability-Approximate` plus a field in the response. A stock projection is a later ADR. | API P1/P2 |
| D22 | Enabling `ecommerce` in the create-app template | Enable right away / follow the `availability` precedent | **Enable it in `apps/mercato`; keep it commented out in the template** until the harness has coverage (`om-refresh-standalone-harness`). | SPEC-029 P1 |

## Decisions taken (2026-10-05, owner)

| # | Chosen | Differs from recommendation? | Consequence to carry into the specs |
|---|---|---|---|
| D1 | `active` | No | SPEC-029 §4.1/§5.2/§6.2/§11/§12/§16/US-D1. |
| D2 | Optional `priceKindId` on `PricingContext` | No | Amend `pricing-engine.md` (owner of the type) + Public API §6.1; extend the `buildPriceRowFilter` property test. |
| D3 | **Union of person and company** | **Yes** (rec. was company with person fallback) | `BuyerContext` carries both ids. Groups resolve for both (`resolveGroups` takes an id set — additive change to `customer_groups`); pricing needs `customerIds: string[]` on `PricingContext` (additive, `matchesContext` + `buildPriceRowFilter`). `customerOverlayId` must cover both ids. Ids are read fresh from the DB, not from the JWT. |
| D3a | **Person wins** over company on ties | No | Price rows: a person-scoped row beats a company-scoped row of equal specificity. Scalar terms keep group-priority order; on equal priority the person's group wins. `explain-terms` must show which entity the value came from. |
| D4 | **401** on a tenant/org mismatch | **Yes** (rec. was anonymous) | Compare both `tenantId` and `orgId`. Side effects to document: a buyer logged into store A cannot browse store B on the same host (path-prefix stores, dev `localhost`) until they log out; the storefront must handle 401 by offering logout/re-login rather than looping. Integration tests: second-tenant bearer → 401; same-tenant other-org cookie → 401. |
| D5 | Accept limit + re-binding subscriber | No | Subscriber on `customer_accounts.domain_mapping.replaced`; R3 diagnostic. |
| D6 | `domainMappingService` + one ecommerce query | No | Rewrite SPEC-029 §8.1. |
| D7 | Typed accessor + module-wide ban | No | Rewrite SPEC-029 §6.1 Enforcement; drop the REPO_WIDE_GUARDS sentence. |
| D8 | Canonical hash in `packages/shared` | No | New exports in `catalog-visibility`, recurse into `allOf`; validator rejects `allOf`. |
| D9 | `scope_keys` in the index document | No | A separate pre-step: query_index enrichment hook, catalog provides keys, GIN on `entity_indexes`, `overlap` FilterOp, reindex. Owner approval for the multi-module change is recorded by this decision; it still needs its own spec section (Public API §3.3 rewrite or a small spec). |
| D10 | Separate `PUT /stores/:id/branding` | No | SPEC-029 §9.2: a command route with mutation guards and `ecommerce.branding.manage`. |
| D11 | **Implement SPEC-033 (Omnibus) first** | **Yes** (rec. was null + suppress presentation) | Omnibus becomes a prerequisite of Public API Phase 1 in this release. Two Omnibus specs exist (`SPEC-033-2026-02-18-omnibus-price-tracking.md` and `2026-06-30-omnibus-price-tracking.md`); pick the authoritative one and run `/om-pre-implement-spec` on it before scheduling. |
| D12 | `AvailabilityPolicy` store-default row only | No | Remove `display.showOutOfStock/allowBackorder` from SPEC-029 §5.1.1; `hideWhenOutOfStock` is read via `policyResolutionService.resolveMany`. |
| D13 | Add `CustomerGroupTerms.assortment_scope`, replace the stub | No | Additive migration in `customer_groups`; group-terms pickers; fix the stub comment. |
| D14 | Channel exclude pickers move to visibility Phase 2 | No | Visibility §12. |
| D15 | ADR-7 amended to SPEC-029's shape | No | Roadmap ADR-7 + `storeContextService` naming + derived `taxMode`. The D3 union also changes the shape: `customerId` becomes person + company. |
| D16 | Minimal `search.ts` | No | SPEC-029 §10. |
| D17 | Upgrade Action | No | Note: the module-sets spec (`2026-09-29-module-sets-for-standalone-apps.md`, Phase 2) plans `mercato module setup` to replay `onTenantCreated` for existing tenants. Keep `onTenantCreated` idempotent so both paths can coexist. |
| D18 | Env flag `OM_ECOMMERCE_DEV_STORE_SLUG`, default off | No | SPEC-029 §9.1/§12; `.env.example` + template sync. |
| D19 | `tokens` + pgvector | No | Public API §8.2; Meilisearch excluded from the storefront in this release. |
| D20 | Extend catalog translations to option/choice labels | No | Additive change in `catalog/translations.ts` + translation UI; needs addressing nested jsonb fields. |
| D21 | **Page-only availability filter** | **Yes** (rec. was a 5 000 cap) | `?availability=in_stock` and the availability facet apply to the returned page only: a page may have fewer than `pageSize` items, and `total`/`totalPages` describe the pre-availability set. The response must say so (e.g. `appliedFilters.availability.scope: 'page'`), and storefront-app pagination must tolerate short pages. Revisit when a stock projection exists. |
| D22 | `apps/mercato` enabled; template entry commented out next to `customer_groups`/`availability` | No | Fits the module-sets spec: the `commerce` preset (its Phase 3) later enables the commented trio, and AI-harness coverage ships with that preset. |

## Mechanical spec fixes (no decision needed)

- Event IDs: `catalog.price.created|updated|deleted` (not `catalog.prices.create…`); `customer_groups.membership.added|removed|expired` (`expired` is never emitted, so it is TTL-only); `terms.updated`/`group.updated` carry `groupId`, so buyer-context entries get a `customer-group:{id}` tag.
- Roles `employee`/`superadmin`, not `member`; five locales (de, en, es, ko, pl).
- SPEC-029 header v4.2 → v4.5+; Events table; notification type IDs, `createForFeature` and throttling; a live-count endpoint for the Channels tab.
- Public API §6.2/§12: anonymous `taxMode` follows SPEC-029 §6.1a, not `priceDisplayModeDefault`.
- `pricing-engine.md` Phase 2b: the index predicate references `deleted_at`, which does not exist on `catalog_product_variant_prices`.
- Visibility: `resolveAssortmentScope` takes `tenantId`; document `allOf`; a closed channel returns `200` empty / `404` detail, never `503`; the §13 "nothing exists on develop" claim is stale; the cited `ANALYSIS-2026-08-21-buyer-scoped-catalog-visibility.md` does not exist.
- Follow-up issue outside this scope: `customer_accounts` emits `notifications.create` and nothing subscribes to it.
