# Pre-Implementation Analysis: SPEC-029 Ecommerce Store Module (v4.5)

> **Spec**: `.ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md` (header says v4.2, changelog runs to v4.5 — 2026-09-16).
> **Release scope analysed**: Phases 1–3 (entities + resolution, branding, admin UI).
> **Analysed against**: `develop` @ `a108dd07f4` (2026-10-05), after `git pull --ff-only`. Phase 0 already merged: #6709 (`customer_groups`, `availability`, `packages/shared/src/lib/catalog-visibility`, `resolveAssortmentScope`) and #6268 (`PricingContext.customerGroupIds`, `buildPriceRowFilter`).
> **Previous audit**: `ANALYSIS-2026-08-14-spec-029-ecommerce-store-module.md` (v4.0). §"Closure of the previous audit" below checks it item by item.
> **Siblings in the same release**: `ANALYSIS-2026-10-05-storefront-public-api.md`, `ANALYSIS-2026-10-05-buyer-scoped-catalog-visibility-phase-2.md`. Consolidated decisions: `ANALYSIS-2026-10-05-storefront-release-decisions.md`.

---

## Executive Summary

The module is still genuinely greenfield — zero `ecommerce` directory, ACL feature, table, route, `BuyerContext`, `StoreContext` or `buildStorefrontCacheKey` anywhere in the repo — so the BC self-audit holds and nothing existing breaks. But checking the spec against the Phase 0 code that has since landed exposes **three blocking mismatches the spec text cannot be implemented against**: (1) the resolver serves on `DomainMapping.status = 'verified'`, while the real lifecycle is `pending → verified → active` and `verified` means *DNS passed, TLS not yet provisioned* — `domainMappingService.resolveByHostname` returns only `active`; (2) `taxMode` is derived from the buyer's resolved `priceKindId`, but `catalog`'s `PricingContext` has **no `priceKindId`** and `selectBestPrice` never filters by price kind, so the group/channel price kind has no effect on which price is returned and the "derived" display mode can disagree with the row actually shown — the §6.1a defect reappears one layer down; (3) the portal session helper `getCustomerAuthFromRequest` trusts the JWT tenant and never compares it with the resolved store's tenant, which the spec does not ask the resolver to check. Of the five findings §21 was supposed to close, only `preview-branding` is fully closed; taxMode is closed in this spec but reopened by code and by Public API §6.2, ADR-7 divergence is untouched, the structural cache guard is mis-specified on four counts, and `search.ts` was silently dropped. **Recommendation: needs spec updates before implementation** (one focused revision, v4.6), not a redesign.

---

## Closure of the previous audit (2026-08-17) — does §21 close it?

| # | Finding (2026-08-17) | §21 claims | Verified against spec + code (2026-10-05) | Status |
|---|---|---|---|---|
| 1 | `taxMode` vs `CatalogPriceKind.displayMode` dual source | v4.1: derived from resolved price kind (§6.1a) | Spec text: fixed. `customer_groups` code confirms `ResolvedTerms` has no tax field (`services/customerGroupsService.ts:36-43`). **But**: `PricingContext` has no `priceKindId` (`catalog/lib/pricing.ts:11-25`), `matchesContext`/`selectBestPrice` ignore price kind (`pricing.ts:58-77, 148`; kind only adds score by code `custom/tier/promotion`, `pricing.ts:131-146`), so the row shown can belong to a kind with the *other* `displayMode`. Public API §6.2 and §12 still say "anonymous buyers use `priceDisplayModeDefault`", contradicting §6.1a. Roadmap ADR-7 still reads `taxMode // B2C shows gross, B2B typically net` with no derivation note. | **Partially closed — reopened (Critical, see C2)** |
| 2 | `BuyerContext` diverges from roadmap ADR-7 | v4.3 "applied ADR-7 (amended)" | v4.3 only added the three named components to both documents. Field sets still differ: ADR-7 has `channelId`, `currencyCode`, `locale`, `purchaseOnAccount`; SPEC-029 has `isAuthenticated`, `allowPurchaseOnAccount`, `approvalRequiredAbove`, `assortmentScope` and keeps channel/currency/locale on `StoreContext`. ADR-7 also names `ecommerce.storeContext.resolve`, SPEC-029 registers `storeContextService`. Roadmap §1: a deviating child spec "MUST amend this document first". | **Not closed (High, H1)** |
| 3 | R1 relies on typing + review only → add structural guard | v4.1: `no-raw-cache-calls.test.ts`, registered in `REPO_WIDE_GUARDS` | Guard added to text, but wrong on four counts (H2): `cache.resolve(` is not the cache API; bare `.get(`/`.set(` regex mostly hits `searchParams`/`headers`/`Map`; it scans `api/**` only while Public API puts caching in `lib/storefront*.ts`; `REPO_WIDE_GUARDS` registration is for tests that read *outside* their package (`scripts/repo-wide-guards.mjs:20-21`) and is unnecessary here; the cited model test is neither a file walk nor registered. | **Partially closed (High, H2)** |
| 4a | Missing `notifications.ts` | v4.1: added to §10 | Files added to §10. Delivery mechanism and dedupe unspecified; do NOT copy `customer_accounts`' `eventBus.emitEvent('notifications.create', …)` — no subscriber listens for it (likely latent bug there). | **Closed (residual M3)** |
| 4b | Missing `search.ts` | — | Not mentioned in §21, not in §10, not scoped out. | **Not closed (M2)** |
| 5 | `preview-branding` mutation-guard status | v4.1: `POST` → `GET` | Verified: `MutationGuard.operations` is `'create'\|'update'\|'delete'` only (`shared/lib/crud/mutation-guard-registry.ts:17, 38`); both cited precedents are `GET`. Residual: input mechanism ("query params or a signed short-lived draft reference") is undecided; no generic signed-token helper exists (closest: `checkout/lib/utils.ts:293-330`). | **Closed (residual L)** |
| 6 | Encryption row for `settings.contact` | v4.1: added §20 row | Present. | Closed |
| 7 | §8.1 join is not an ORM relation | — | Not addressed; now superseded by H5 (the 4-table join itself should go). | Superseded |
| 8 | §18 heading + `sync-role-acls` note | — | Not addressed. | Not closed (Low) |

---

## Backward Compatibility

All 14 surface categories of `BACKWARD_COMPATIBILITY.md` checked (the file now also lists AI agent/tool IDs as #12; CLI #13; generated files #14).

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | 1 Auto-discovery | New module files only (`acl.ts`, `setup.ts`, `di.ts`, `events.ts`, `notifications*.ts`, `search.ts`, `api/**`, `backend/**`, `subscribers/**`). No rename. | None | — |
| 2 | 2 Types | New `BuyerContext`/`StoreContext`. Becomes STABLE on first release — the ADR-7 field-set question (H1) MUST be settled before shipping, because later removal of a field is a breaking change. | Warning | Settle the shape in v4.6; export types from one module path only. |
| 3 | 2/3 Types & signatures (catalog) | Fixing C2 requires an additive optional field on `catalog`'s `PricingContext` (`priceKindId?`) and the matching clause in `matchesContext` + `buildPriceRowFilter`. Optional field = additive. | Warning (additive) | Add as optional; existing callers unaffected; property test for `buildPriceRowFilter` invariant extended. |
| 4 | 4 Import paths | None (new module). | None | — |
| 5 | 5 Event IDs | New `ecommerce.*` events (store CRUD, R7 empty-assortment warning) are FROZEN once shipped. Spec does not list them in `events.ts`. | Warning | Enumerate them in §10/§13 before Phase 1 (M3). |
| 6 | 6 Spot IDs | New pages expose new spot IDs (`crud-form:ecommerce.store`, `data-table:ecommerce.stores`…); FROZEN on release. | None (additive) | Name them in §11. |
| 7 | 7 API routes | All new; STABLE on release. `preview-branding` is `GET` — HTTP method is part of the contract, keep it. | None | — |
| 8 | 8 DB schema | Three new tables; additive. | None | — |
| 9 | 9 DI names | `storeContextService` new. ADR-7 calls it `ecommerce.storeContext` (H1). | Warning | Fix roadmap wording; DI key frozen at first release. |
| 10 | 10 ACL IDs | Five new features; FROZEN. Visibility spec §7 adds `ecommerce.visibility.diagnose` to this module's `acl.ts` but SPEC-029 §9.3 does not list it. | Warning | List it in §9.3 (or explicitly defer with the explainability tool). |
| 11 | 11 Notification types | Two new types (missing default binding, empty assortment). FROZEN. IDs not named. | Warning | Name them now (`ecommerce.store.channel_binding_missing`, `ecommerce.store.assortment_empty`). |
| 12 | 12 AI IDs | None. | None | — |
| 13 | 13 CLI | None. | None | — |
| 14 | 14 Generated files | New module enters generated registries; no export rename. Template parity: `packages/create-app/src/lib/template-modules-parity.test.ts` and module fact-sheet coverage (`module-facts-build.test.ts`) — the `availability` precedent keeps a new module commented out in the template until harness coverage lands (`apps/mercato/src/modules.ts:86-96`). | Warning | State the template/harness plan in §18 (M11). |

BC self-audit (§15/§18/§20): **re-verified true** — zero hits for `EcommerceStore*`, `ecommerce_*`, `/api/ecommerce`, `ecommerce.*` features, `BuyerContext`, `StoreContext`, `storeContextService`, `buildStorefrontCacheKey` in `packages/` and `apps/`.

### Missing BC Section

§18 "Migration Path" covers it in substance; heading still not "Migration & Backward Compatibility" (Low).

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Events list (`events.ts` contents) | §10 lists the file, but no event IDs are defined anywhere; R7's "warning event" and the cache-invalidation subscriber have nothing to emit or subscribe to by name. | Add an Events table: store/binding CRUD events + the R7 warning, with payloads. |
| Admin endpoint for the live assortment count | §10a US-E1/§11 and visibility US-B1/B2 require "a live count of matching products"; §9.2 defines no endpoint for it. | Add `GET /api/ecommerce/store-channel-bindings/:id/assortment-count` (or a draft-scope query variant), `ecommerce.channels.manage`/`stores.view`. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Header | Status says v4.2; changelog is at v4.5. | Bump header. |
| §4.1 step 2, §5.2, §6.2, §11, §12, §16, US-D1 | Serves on `verified`. Real statuses: `pending \| verified \| active \| dns_failed \| tls_failed` (`customer_accounts/data/entities.ts:4`); `verified` = DNS ok, TLS pending; `resolveByHostname` returns only `active` (`services/domainMappingService.ts:476`). | Serve on `active` only (C1). |
| §4.1 step 6 | "`CustomerUser → customers: CustomerEntity`" is ambiguous: `CustomerUser.customer_entity_id` is the **company**, `person_entity_id` the person (`customer_accounts/AGENTS.md:60-61`, `subscribers/autoLinkCrm.ts`); memberships can target both (`customer_groups/widgets/injection-table.ts:17,25`); both ids are copied into the JWT at login and can go stale (`services/customerSessionService.ts:64-65`). | Define `customerId`/`companyId` mapping and read them fresh (M1). |
| §4.1 step 6 | No tenant check between portal token and resolved store. `getCustomerAuthFromRequest` (`lib/customerAuth.ts:119`) takes tenant from JWT claims; only the server-component variant has `expectedTenantId` (`lib/customerAuthServer.ts:54-75`). | C3. |
| §5.1.1 `display.showOutOfStock/allowBackorder` | Described as "store-level defaults in the AvailabilityPolicy chain", but the chain's store default is already an `AvailabilityPolicy` row with `store_id = X` and null product/variant (`availability/lib/policyResolution.ts:62-77,112,130`). Two places to configure one value. `showOutOfStock` does not exist anywhere; its inverse `hideWhenOutOfStock` is resolved but used by no provider and absent from `AvailabilityItemResult`. | H6. |
| §6.1 `customerOverlayId` | Invalidation on `catalog.prices.create/update/delete` — real IDs are `catalog.price.created\|updated\|deleted` (`catalog/events.ts:38-40`). The `EXISTS` relies on `pricing-engine.md` Phase 2b's partial index, which is **not shipped** (only `variant_scope_idx`/`product_scope_idx` exist, `catalog/data/entities.ts:780-787`) and whose planned predicate `deleted_at IS NULL` references a column `catalog_product_variant_prices` does not have. | H3. |
| §6.1 `assortmentScopeHash` | Requires canonicalization; no canonicalize/hash helper exists anywhere (verified). `intersectScopes` emits merged branches with a nested `allOf` (`shared/lib/catalog-visibility/intersectScopes.ts:49-76`, `types.ts:6-20`) that the spec's `AssortmentScope` does not know. | M9. |
| §8 Caching table | Buyer context invalidated "by `customer_groups.membership.*`". Real events: `membership.added`/`.removed`/`.expired`; `.expired` is declared but **never emitted**; `terms.updated` and `group.updated` carry `groupId`, not `customerId` (`customer_groups/lib/groupEvents.ts:19-49`), so a `customer:{id}` tag cannot be invalidated by them. No `catalog` price-kind events exist, so a `displayMode` change cannot invalidate anything. `DomainMapping` has no `.updated`; it has `created/verified/activated/dns_failed/tls_failed/deleted/replaced` (`customer_accounts/events.ts:23-29`). | H3. |
| §8.1 | One SQL join over `domain_mappings` (owned by `customer_accounts`) + three `ecommerce` tables — a cross-module table read, and it duplicates `domainMappingService`'s own 5-minute tagged cache (`domainMappingService.ts:26,170-185`). | H5. |
| §5.2 / R3 | `DomainMapping` is hard-deleted (no `deleted_at`) and superseded via `replaces_domain_id`; after `.replaced` the binding points at the old id and the store stops serving. Max 2 mappings per org (`data/guards.ts:7`, "one active + one pending replacement"), so "several stores per organization at different hostnames" (§19 Q5, §5.2) is not possible today except via `path_prefix`. | H4. |
| §9.2 / §9.3 | `ecommerce.branding.manage` gates branding fields that live in `EcommerceStore.settings`, which is written by the single `PUT /stores/:id` (`makeCrudRoute`, one feature per method). Field-level feature gating is not a `makeCrudRoute` capability. Branding, General and SEO tabs also edit one row → two admins on different tabs get optimistic-lock 409s on each other. | H7. |
| §9.3 / §10a | Roles `admin`/`member`. This repo's roles are `superadmin`/`admin`/`employee` (e.g. `customer_groups/setup.ts:4-8`). | Fix to `employee`; add `superadmin`. |
| §10 `i18n/{en,pl}.json` | Repo modules ship `de, en, es, ko, pl` (e.g. `customer_groups/i18n/`, `catalog/i18n/`). | List all five (M5). |
| §17 Phase 3 / §18 | "Existing deployments get a `draft` store seeded" — `setup.ts` hooks run on tenant creation; existing tenants need the Upgrade Actions mechanism (`configs/lib/upgrade-actions.ts`). | M4. |
| §12 / §9.1 `?storeSlug=` | "development only, rejected in production" — no shared `isDevelopment` helper exists; routes check `NODE_ENV` inline; staging/preview run `NODE_ENV=production`. | M6. |
| §12 rate limit | 120/min per IP — declarative `rateLimit` metadata exists (`apps/mercato/src/app/api/[...slug]/route.ts:43,120-130,418-437`, example `communication_channels/api/post/webhooks/gmail/route.ts:44`). | Name the mechanism. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Root: no direct cross-module DB coupling | §8.1 joins `customer_accounts.domain_mappings` in raw SQL | Use `domainMappingService.resolveByHostname` (DI, cached) + one `ecommerce` query (H5). |
| Root: "Never expose cross-tenant data" | §4.1 step 6 trusts portal JWT tenant | Compare `auth.tenantId`/`auth.orgId` with the resolved store; mismatch → anonymous (C3). |
| `packages/cache/AGENTS.md`: DI token is `cache`, no `cacheService` | §6.1 guard regex `cache.resolve(` | Ban `resolve('cache')` / `resolveCrudCache` outside `lib/cacheKeys.ts` (H2). |
| `packages/core/AGENTS.md` Notifications: types in `notifications.ts`, delivery via `NotificationService.createForFeature` (`notifications/lib/notificationService.ts:238-239`, example `wms/subscribers/low-stock-notification.ts:30-50`) | §6.2 / R7 | Name types, use `createForFeature`, dedupe (M3). |
| `customers/AGENTS.md` Module Files Checklist: `search.ts` for an admin-searchable entity | §10 | Add `search.ts` with `aclFeatures: ['ecommerce.stores.view']` (enforced by `search/__tests__/global-search-acl.test.ts`) (M2). |
| Root: i18n for all shipped locales | §10 | Five locales (M5). |
| Root Always: optimistic locking on every new editable entity | Three entities, `CrudForm` | Compliant; but tab split over one row needs a decision (H7). |
| Root: "Use DI, avoid `new`" / data helpers | `findWithDecryption` for reads of the three entities | Spec silent; state it (no encrypted fields today, but the helper is mandated). |

**Confirmed compliant**: `makeCrudRoute` CRUD with default-on optimistic locking (`shared/lib/crud/factory.ts:1104,1119-1138`); `preview-branding` as `GET` outside the mutation-guard registry; no cross-module ORM relations in the entity design; RBAC by feature IDs.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **C1 — serving on `verified`** | Either the resolver ignores `domainMappingService` and serves hosts without TLS (`verified` = TLS not yet issued; `isAllowedForTls` accepts `verified` precisely so the cert can be requested), or it is written against the existing service and never matches anything. | Serve on `active` only; keep "bind before DNS propagates" (binding to any status allowed); Domains tab shows status read-only. |
| **C2 — price kind is not a pricing input** | Group-term `priceKindId` overrides change nothing in price selection; Phase 1 gate "anonymous and authenticated B2B contexts differ correctly" can only pass via `customerGroupIds` rows; `taxMode` derived from the resolved kind may label a net amount as gross (or vice versa) when the winning row is of another kind — exactly the defect §6.1a meant to remove. | Decision D2: add optional `priceKindId` to `PricingContext` (catalog, additive) and exclude rows of other kinds in `matchesContext` + `buildPriceRowFilter`; derive the amount shown from the selected row's own net/gross field according to `taxMode`. |
| **C3 — portal token not bound to store tenant** | A bearer token from tenant A sent to tenant B's store host yields `isAuthenticated: true`, a foreign `customerId` used in B-scoped lookups, `private, no-store` responses and a cache key derived from a foreign identity. Not a direct price leak (lookups are tenant-scoped), but an identity-confusion bug on the Critical R1 path. | Resolver compares `auth.tenantId === store.tenantId && auth.orgId === store.organizationId`; mismatch → anonymous; integration test with a second-tenant token. |
| **H2 — structural guard as written is unenforceable** | Either flaky false positives (hundreds of `searchParams.get`) that get allow-listed into meaninglessness, or a regex narrow enough to miss real bypasses in `lib/`. R1 residual "Low" rests on it. | Typed accessor: `lib/cacheKeys.ts` is the only file allowed to call `container.resolve('cache')`; it exposes `storefrontCache(ctx: StoreContext)` whose `get/set` build keys internally. Guard = regex ban on `resolve(['"]cache['"])`/`resolve<…>('cache')`/`resolveCrudCache` across the whole module (`api/`, `lib/`, `subscribers/`), modeled on `core/src/__tests__/command-interceptor-http-coverage.test.ts` (walk + regex). No `REPO_WIDE_GUARDS` entry needed (package-local). |
| **H3 — invalidation built on non-existent events** | Stale buyer context for up to 60 s after terms/priority/price-kind changes (acceptable if stated), indefinitely-cached `customerOverlayId` if keyed on wrong event IDs (R1 direction: stale `false` serves group price to a contracted buyer). | Use real IDs; tag buyer-context entries with `customer-group:{groupId}` for every contributing group; bound `customerOverlayId` cache by TTL as well as events; ship Phase 2b index (fix its predicate) before enabling the probe. |
| **H7 — one row, three tabs, two features** | False 409s between Branding/SEO/General editors; `branding.manage` cannot be enforced by `makeCrudRoute` on the shared `PUT`. | Decision D10 (separate branding command route vs. drop `branding.manage`). |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| H1 ADR-7 drift | Specs 5, 7, 14 (cart, checkout, offline) written against two shapes; `BuyerContext` becomes STABLE on release. | Amend roadmap ADR-7 to SPEC-029's shape (SPEC-029 owns the resolver). |
| H4 domain limits & supersession | Store stops serving after a domain replacement; multi-store-per-org only via path prefixes. | Subscriber on `customer_accounts.domain_mapping.replaced` re-points bindings to the new id; document the 2-domain limit; R3 diagnostic for hard-deleted mappings. |
| H5 resolution query shape | Cross-module SQL; duplicate cache layer with different tags (`ecommerce-domain:{host}` vs `domain_routing:{host}`). | Hop 1 via `domainMappingService` (cached), hop 2 one `ecommerce` query; invalidate on `ecommerce` events + `domain_mapping.*`. P95 budget still meetable (hop 1 is a cache hit). |
| H6 availability double configuration | Store setting and store-default policy row disagree; `hideWhenOutOfStock` has no effect anywhere. | Decision D12. |
| M3 notification storm | §6.2 "503 plus an admin notification" on a per-request path emits one notification per request. | Throttle per `(storeId, type)` via cache key, e.g. once per hour. |
| M11 template parity | Enabling `ecommerce` in `apps/mercato` without template/harness handling fails `template-modules-parity` / module-facts tests. | Follow the `availability` precedent. |
| Group scope stub | `resolveAssortmentScope` always returns `scope: null` (no `assortment_scope` column on `CustomerGroupTerms`, `customerGroupsService.ts:103-111`), so R7 and "channel ∩ group" tests are hollow for groups. | See visibility analysis, decision D13. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `?storeSlug=` gated on `NODE_ENV` | Open on a mis-set staging box, closed on a dev box running prod build. | Explicit env flag, default off (D18). |
| Draft-store `403` in development | Same gating issue. | Same flag. |
| US-A3 no unarchive | Archived store irrecoverable from UI. | Decide `archived → draft` transition or keep as stated gap. |
| `preview-branding` input | Signed draft reference needs a new helper. | Query params only; drop the signed-reference option. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **C1** serving status `verified` → `active`.
- **C2** price kind not an input to price selection; `taxMode` derivation unsound against real pricing (shared with Public API C1).
- **C3** portal token/tenant binding missing from resolver.

### Important Gaps (Should Address)

- H1 reconcile ADR-7; H2 guard redesign; H3 real event IDs + group-level buyer-context tags + Phase 2b index; H4 domain supersession + 2-per-org limit; H5 resolution via `domainMappingService`; H6 availability defaults; H7 branding feature vs single `PUT`.
- Events table (IDs + payloads); live-count admin endpoint; notification type IDs + `createForFeature` + throttling.
- `customerId`/`companyId` mapping (person vs company) and freshness (M1).
- Canonical hash helper in `packages/shared/src/lib/catalog-visibility` handling `allOf`; channel-binding validator rejects `allOf` in admin input (M9).
- Existing-tenant seeding via Upgrade Action (M4).

### Nice-to-Have Gaps

- `search.ts` (M2); five locales (M5); `storeSlug` env flag (M6); role names `employee`/`superadmin`; header version; §18 heading + `yarn mercato auth sync-role-acls` note; spot IDs named in §11; `ecommerce.visibility.diagnose` listed or deferred; follow-up issue for `customer_accounts`' undelivered `notifications.create` emits (out of scope here).

---

## Remediation Plan

### Before Implementation (Must Do)

1. **v4.6 of the spec**: `active` serving rule; tenant-binding of portal session; `customerId`/`companyId` mapping; price-kind decision (D2) cross-referenced with Public API and `pricing-engine.md`.
2. **Rewrite §6.1 Enforcement** as the typed-accessor + module-wide regex ban; drop the `REPO_WIDE_GUARDS` sentence (or keep it only if the guard ever scans outside `packages/core`).
3. **Rewrite §8**: real event IDs; group-level tags; TTL-only invalidation stated explicitly where no event exists (price kind, membership expiry); §8.1 two-hop via `domainMappingService`.
4. **Add Events table and notification type IDs** (FROZEN surfaces — name them before code).
5. **Amend roadmap ADR-7** to SPEC-029's `BuyerContext` shape and the `storeContextService` key; note `taxMode` derivation.
6. Decide D10 (branding route) and D12 (availability defaults) — both change §5.1.1/§9.2.

### During Implementation (Add to Spec)

1. Canonical scope hash in `packages/shared` (+ property test: equal hashes for differently ordered equivalent scopes).
2. `domain_mapping.replaced` re-binding subscriber + R3 diagnostic for hard-deleted mappings.
3. Upgrade Action for seeding a draft store in existing tenants.
4. `search.ts`, five locales, role names, rate-limit metadata, `findWithDecryption` statement.
5. Live-count admin endpoint.

### Post-Implementation (Follow Up)

1. Issue: `customer_accounts` subscribers emit `notifications.create` with no listener.
2. Raise or redesign `MAX_DOMAINS_PER_ORG` if multi-domain multi-store becomes a requirement.
3. Move spec to `implemented/` only after Phases 1–3 gates pass.

---

## Recommendation

**Needs spec updates first** (one focused v4.6 pass plus a roadmap ADR-7 amendment). Ownership boundaries, entity design and the cache-key philosophy are sound and the BC self-audit is still accurate; the blockers are three places where the spec contradicts code that landed after it was written (domain status, price-kind input, portal-token tenant), plus a structural guard that needs re-specifying before it can be the R1 mitigation it is credited as.
