# SPEC-029: Ecommerce Store Module

| Field | Value |
|-------|-------|
| **Status** | Specification (v4.6 — Phase 0 reconciliation, owner decisions 2026-10-05) |
| **Created** | 2026-02-17 |
| **Rescoped** | 2026-08-14 |
| **Pre-implementation fixes** | 2026-08-17 — see §21 |
| **Phase 0 reconciliation** | 2026-10-05 — see §21 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 3, Phase 1 |
| **Modules** | `ecommerce` (new) |
| **Related Issues** | #289, #288 |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) |

> **v4 rescope notice.** Versions 1–3 of this document specified a backend module, a public catalog API, a checkout state machine and a complete Next.js application in one spec. That scope is now split across the ecommerce suite. This document retains **only the `ecommerce` module**: store definition, hostname binding, channel binding, buyer-context resolution, branding and admin surface. See §14 for what moved where, and §15 for what was withdrawn outright.

---

## TLDR

**Key Points:**
- The `ecommerce` module owns *what a store is* and *who is asking* — nothing else. It resolves an incoming request to a store, a tenant/organization, a sales channel, a price kind and a buyer identity, and it serves per-store branding. It is a read-and-configure module with no write path into commerce.
- Domain lifecycle is **not** reimplemented here. `customer_accounts.DomainMapping` already owns hostname → tenant/org routing with provider abstraction, DNS verification, TLS failure tracking and supersession chains. `ecommerce` adds only a binding row from a domain to a store, and serves it only once the domain is `active` (TLS issued).
- `resolveStoreFromRequest` returns a `BuyerContext` alongside the store. B2C and B2B differ in context, not in code path — the same endpoint serves an anonymous visitor and a logged-in wholesale buyer, at different prices.
- Because prices vary by buyer, **every cache key in the suite must include a buyer-context digest**. This is the module's most consequential export and its largest risk.

**Scope:**
- `EcommerceStore`, `EcommerceStoreDomainBinding`, `EcommerceStoreChannelBinding`
- `storeContextService`: store resolution, buyer-context resolution, branding
- Per-store branding as CSS custom properties, with SSR injection and no FOUC
- Admin CRUD and admin UI (store list, general, branding with live preview, domains, channels, SEO)
- Cache and invalidation for the resolution hot path

**Concerns:**
- Buyer-context cache bleed would disclose one customer's contract pricing to another — critical, and mitigated by making the digest a required argument rather than an optional discipline
- The two-hop hostname resolution (host → `DomainMapping` → binding → store) is on every single request: hop 1 is served from `domainMappingService`'s own cache, hop 2 is one `ecommerce` query (§8.1)
- `EcommerceStore.settings` is a JSONB blob; three of its former subtrees now belong to other modules and must not be reintroduced here

---

## 1) Overview

Open Mercato has no first-class notion of a storefront. This module introduces one: a named, branded, addressable selling surface owned by an organization, bound to a sales channel and reachable at one or more verified hostnames.

The module deliberately does almost nothing at runtime. It answers one question per request — *given this host, this session and this locale, which store, which tenant, which prices and which assortment?* — and it answers it fast enough that everything downstream can depend on it.

---

## 2) Problem Statement

The platform can model products, price them per customer, hold stock, take payments and issue documents. It cannot say "this is firda.pl, it belongs to organization X, it sells the wholesale price list in PLN, and the person browsing is a buyer at ACME Sp. z o.o. with a 100 000 PLN credit line."

Concretely:

- No entity represents a store. Branding, locale set, currency and SEO defaults have nowhere to live.
- No mapping exists from a public hostname to a selling context. `customer_accounts.DomainMapping` resolves a host to a tenant and organization, which is necessary but not sufficient — it says nothing about which store, channel or price kind.
- No shared resolver exists, so every channel that wanted one would re-derive scoping, and they would diverge.
- Nothing carries buyer identity into pricing. `catalog/lib/pricing.ts` accepts a customer and group context and scores rows by specificity, but no caller assembles that context from a web request.

---

## 3) Proposed Solution

### 3.1 Module

`packages/core/src/modules/ecommerce/` — three entities, one service, admin CRUD, admin UI. No cart, no checkout, no order creation, no product domain model.

### 3.2 Principles

1. **Multi-tenant by construction** — resolution yields exactly one tenant and organization; every downstream query is scoped by them.
2. **No cross-module ORM relations** — FK ids and DI services only.
3. **Read-only** — the module configures and resolves; it never mutates commerce state.
4. **Headless** — the same resolution serves web, mobile, and AI agents.
5. **Context, not code paths** — B2C and B2B are one implementation with different `BuyerContext` values (ADR-7).
6. **Reuse over reimplementation** — domains, identity, pricing, stock and translation each stay with their owning module.

---

## 4) Architecture

### 4.1 Resolution flow

```
GET https://firda.pl/products/czerwona-sukienka
  │
  ▼  ecommerce.storeContextService.resolve(request)
  │
  ├─ 1. Normalize Host  ('firda.pl')  — or ?storeSlug= when OM_ECOMMERCE_DEV_STORE_SLUG=true (§9.1)
  │
  ├─ 2. customer_accounts: domainMappingService.resolveByHostname(host)   (DI; cached 5 min,
  │        tag domain_routing:{host}) → domainMappingId, tenantId, organizationId;
  │        status must be 'active' ('verified' = DNS passed, TLS not yet issued — never served)
  │
  ├─ 3–5. ONE ecommerce query:
  │        EcommerceStoreDomainBinding by domainMappingId (+ longest pathPrefix match)
  │        ⋈ EcommerceStore (status = 'active')
  │        ⋈ EcommerceStoreChannelBinding (isDefault = true)
  │        → storeId, salesChannelId, priceKindId, assortmentScope, requireAuthentication
  │
  ├─ 6. Buyer identity (optional portal session: cookie customer_auth_token or Bearer)
  │        customer_accounts: getCustomerAuthFromRequest(req)
  │          auth.tenantId ≠ tenantId OR auth.orgId ≠ organizationId → 401 (§6.2, D4)
  │        customer_accounts: CustomerUser by auth.sub (read fresh, never from JWT claims)
  │          → personId = person_entity_id, companyId = customer_entity_id
  │          → customerIds = distinct non-null [personId, companyId]   (person first)
  │        customer_groups: resolveGroups({ customerIds, tenantId })  → groupIds (union of both)
  │        customer_groups: resolveTerms({ customerIds, tenantId })   → priceKind override, credit flags
  │                         (equal-priority tie → the person's group wins)
  │        assortment: requireAuthentication && !authenticated
  │                      ? [] (deny-all; customer_groups NOT called)
  │                      : customer_groups.resolveAssortmentScope({ customerIds, tenantId }) → OR-list
  │                        (groups, plus the customer's own override — grant
  │                         unioned in, restriction intersected over — all inside
  │                         that one call; visibility spec §3.6)
  │                    then intersectScopes(channel.assortmentScope, groupScope)
  │        catalog: CatalogPriceKind.displayMode of the resolved priceKindId
  │                 (group override, else channel default) → taxMode
  │                 ('excluding-tax' → 'net', 'including-tax' → 'gross') — §6.1a;
  │                 the same priceKindId is passed to PricingContext as a filter (D2)
  │
  └─ 7. Locale:  ?locale → X-Locale → Accept-Language → store.defaultLocale
                 (must be in store.supportedLocales, else fall back)
  ▼
StoreContext { store, tenantId, organizationId, channel, buyer, effectiveLocale, digest }
```

Step 2 is a DI call to the service that already owns hostname routing and its cache; steps 3–5 are one `ecommerce` query, not three — see §8.1.

### 4.2 Ownership boundaries

| Concern | Owner |
|---|---|
| Store identity, branding, locale/currency defaults, SEO defaults | `ecommerce` |
| Hostname registration, DNS verification, TLS, provider | `customer_accounts.DomainMapping` |
| Which store an `active` hostname serves | `ecommerce` (binding only) |
| Store-level availability defaults | `availability` (`AvailabilityPolicy` store-default row) |
| Sales channel definition | `sales.SalesChannel` |
| Price kinds and price rows | `catalog` |
| Customer identity and portal sessions | `customer_accounts` |
| Commercial groups, terms, credit | `customer_groups` |
| Product payloads, facets, search | `ecommerce` public API — spec 4 |
| Cart, checkout, orders | `cart`, `@open-mercato/checkout`, `sales` |

---

## 5) Data Models

Standard scoped columns on all entities: `id` (UUID PK), `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`.

### 5.1 `EcommerceStore` (`ecommerce_stores`)

| Column | Type | Notes |
|---|---|---|
| `code` | text | Unique within tenant |
| `name` | text | |
| `slug` | text | URL-safe, unique within tenant; `?storeSlug=` host override when `OM_ECOMMERCE_DEV_STORE_SLUG=true` |
| `status` | text | `draft \| active \| archived` |
| `default_locale` | text | |
| `supported_locales` | jsonb | `string[]`; must contain `default_locale` |
| `default_currency_code` | text | |
| `is_primary` | boolean | At most one per organization |
| `settings` | jsonb | §5.1.1 |

### 5.1.1 `settings` schema

```typescript
type EcommerceStoreSettings = {
  branding: {
    logoUrl?: string | null
    faviconUrl?: string | null
    primaryColor?: string          // OKLCH, e.g. 'oklch(0.3 0.15 270)'
    primaryForeground?: string
    accentColor?: string
    accentForeground?: string
    backgroundColor?: string
    foregroundColor?: string
    borderRadius?: string
    fontFamilyBase?: string
    fontFamilyHeading?: string
  }
  contact: {
    email?: string | null
    phone?: string | null
    address?: string | null
    social?: Record<string, string>
  }
  display: {
    priceDisplayModeDefault: 'gross' | 'net'   // fallback ONLY when no price kind resolves at all (misconfigured channel); normally taxMode is derived from the resolved price kind's displayMode — §6.1a
    enableSearch: boolean            // default true
  }
  seo: {
    siteName?: string
    defaultMetaDescription?: string
    googleSiteVerification?: string
    robotsTxt?: string
  }
}
```

**Removed from v3.** `features.enableReviews` and `features.enableWishlist` are gone — those modules do not exist and a settings flag for an unbuilt feature is dead configuration. `features.showPriceIncludingTax` is replaced by `display.priceDisplayModeDefault`, a last-resort fallback for when no price kind resolves at all — the effective mode for an identified buyer is derived from their resolved price kind's `CatalogPriceKind.displayMode`, not stored as an independent per-buyer preference (§6.1a; fixed 2026-08-17 after a `/om-pre-implement-spec` audit found an earlier draft storing it twice, in a now-removed `CustomerGroupTerms.tax_display_mode` column, with no rule reconciling the two).

**Availability defaults are not stored here (changed 2026-10-05, D12).** Earlier versions carried `display.showOutOfStock` and `display.allowBackorder` as "store-level defaults in the `AvailabilityPolicy` chain". The chain already has a store default of its own — an `AvailabilityPolicy` row with `store_id = store.id` and `product_id`/`variant_id` null (`availability/lib/policyResolution.ts`, levels `variant_store → variant → product_store → product → store_default → module_default`) — so keeping the same value in `settings` would have been a second source of truth. The store's admin edits that store-default policy row through the availability API (General tab, §11); per-product and per-variant policies override it exactly as today. The storefront reads the resolved `hideWhenOutOfStock`/`allowBackorder` through `policyResolutionService.resolveMany()` in the same batch as availability, because `hideWhenOutOfStock` is resolved by the chain but not part of `AvailabilityItemResult` and no provider applies it.

### 5.2 `EcommerceStoreDomainBinding` (`ecommerce_store_domain_bindings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `domain_mapping_id` | uuid | `customer_accounts.DomainMapping.id` — FK id, no ORM relation |
| `path_prefix` | text, nullable | e.g. `/shop`; null = host root. Enables one host serving several stores |
| `is_primary` | boolean | One per store; drives canonical URLs |

Constraints: unique `(domain_mapping_id, path_prefix)` among non-deleted rows — one host+prefix serves exactly one store; at most one `is_primary = true` per store.

**This entity replaces v3's `EcommerceStoreDomain`.** The `host`, `tls_mode` and `verification_status` columns are gone: hostname uniqueness, DNS verification state, TLS provisioning, failure reasons, retry counters and supersession all remain in `DomainMapping`, which already implements them.

**Serving requires `status = 'active'` (fixed 2026-10-05, D1).** `DomainMapping.status` is `pending | verified | active | dns_failed | tls_failed` (`customer_accounts/data/entities.ts`). `verified` means DNS has passed but the TLS certificate is not yet issued (`isAllowedForTls` accepts `verified` precisely so the certificate can be requested); `active` means TLS works. `domainMappingService.resolveByHostname` returns only `active` rows, and the resolver uses it (§4.1 step 2), so a store never serves over a host without TLS. Binding to a mapping in **any** status is permitted, so an operator can configure ahead of DNS propagation; the Domains tab shows the status read-only.

**Constraints inherited from `DomainMapping` (D5).**
- **At most two mappings per organization** (`customer_accounts/data/guards.ts`, `MAX_DOMAINS_PER_ORG = 2`, designed as one active domain plus one pending replacement). Several stores in one organization therefore share a host and are separated by `path_prefix`; one hostname per store is not available without changing `customer_accounts`.
- **Supersession creates a new row.** Replacing a domain inserts a new `DomainMapping` with `replaces_domain_id` pointing at the old one and emits `customer_accounts.domain_mapping.replaced`. The subscriber `subscribers/domain-binding-rebind.ts` re-points every binding from the superseded id to the new id in the same tenant, so the store keeps serving once the replacement becomes `active`.
- **Deletes are hard** (`DomainMapping` has no `deleted_at`). A binding whose mapping no longer exists is the dangling case of R3: the Domains tab shows an explicit "domain removed" state and the resolver logs a distinguishable error before answering `404`.

### 5.3 `EcommerceStoreChannelBinding` (`ecommerce_store_channel_bindings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `sales_channel_id` | uuid | `sales.SalesChannel.id` |
| `price_kind_id` | uuid, nullable | `catalog.CatalogPriceKind.id`; anonymous default |
| `assortment_scope` | jsonb, nullable | `AssortmentScope \| null` — `{ categoryIds?, tagIds?, excludeProductIds?, excludeCategoryIds?, excludeTagIds? }`, the shared type from `packages/shared/src/lib/catalog-visibility/`. `excludeCategoryIds`/`excludeTagIds` added 2026-09-06 |
| `require_authentication` | boolean | **New 2026-09-06.** Default `false`. When `true` and the request has no authenticated buyer, `storeContextService.resolve()` short-circuits `buyer.assortmentScope` to `[]` — see below |
| `price_sort_fallback` | text | **New 2026-09-16.** `'approximate'` (default) or `'unavailable'`. Governs what `/products?sort=price_*` does past the 5 000-product in-memory sort cap: keep today's list-price fallback with `X-Sort-Approximate: true`, or withdraw the sort option entirely. See [Storefront Public API](./2026-08-14-storefront-public-api.md) §6.3 |
| `is_default` | boolean | One per store |

`assortment_scope` uses the same shape as `CustomerGroupTerms.assortment_scope`. Its zod validator is the shared `AssortmentScope` **without** `allOf`, strict (unknown keys rejected), uuid arrays only: `allOf` exists in `packages/shared/src/lib/catalog-visibility/types.ts` only as an intersection-internal field that `intersectScopes` adds when it must AND two sources, and a single source — this column — never carries it. Accepting it from admin input would break that invariant and the canonical hash built on it (§6.1).

When both are present they **intersect**: the buyer sees products allowed by the channel *and* by their group. Resolving Open Question 4 of the roadmap — channel scope is the store's assortment, group scope narrows it further for that buyer, and neither can widen the other.

The intersection is computed by `intersectScopes(channelScope, buyerScope)` from `packages/shared/src/lib/catalog-visibility/`, not by ad hoc prose: a buyer's group-side scope is an **OR-list of AND-scopes**, one branch per contributing group ([Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.1, §3.3), so intersecting it with the channel's single scope distributes across the branches. Merging the arrays instead would compute a stronger, different condition.

`require_authentication` exists because the alternative — configuring the anonymous/default group's scope defensively and hoping no code path bypasses it — is an indirect trick where BigCommerce and Shopify both ship an explicit switch. It gates **catalog visibility only**, not the whole storefront: branding, static pages and the login page itself are unaffected, and a full site-wide access wall is a `customer_accounts` portal-auth feature, out of scope here. `[]` is an ordinary value of `EffectiveAssortmentScope` meaning "matches nothing" (the vacuous OR), so it composes through `intersectScopes` and `matchesScope` with no special-casing downstream in `cart` or the public API.

---

## 6) Service Contract

`ecommerce/di.ts` registers `storeContextService`.

```typescript
export type BuyerContext = {
  customerUserId: string | null     // customer_accounts.CustomerUser.id (auth.sub)
  customerId: string | null         // personEntityId ?? customerEntityId — the most specific identity ("person wins")
  companyId: string | null          // CustomerUser.customer_entity_id — the company
  customerIds: string[]             // NEW 2026-10-05: distinct non-null [personEntityId, customerEntityId], person first;
                                    // used for group resolution, price matching and (later) assortment overrides — D3
  customerGroupIds: string[]        // priority-ordered union over customerIds, from customerGroupsService
  isAuthenticated: boolean
  taxMode: 'gross' | 'net'          // DERIVED from priceKindId's CatalogPriceKind.displayMode — see §6.1a; never set independently
  priceKindId: string | null        // group terms override the channel default; passed to PricingContext as a filter (D2)
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  assortmentScope: EffectiveAssortmentScope   // intersectScopes(channel, group union); null = unrestricted, [] = deny-all

  // New 2026-09-16, per roadmap ADR-7 (amended). Named, independently-hashable projections
  // of the fields above; they add no information, they make it addressable. Every cache,
  // projection and index key in this suite is built from these rather than from `digest`
  // whenever a named component would do.
  assortmentScopeHash: string        // hashEffectiveScope(assortmentScope) from packages/shared — digest of the CANONICALIZED
                                     // RESOLVED scope, never of its inputs (no customer ids, no group ids, no has-override flag);
                                     // see §6.1 and visibility spec §3.7
  priceScopeKey: string              // sha256(channelId, currencyCode, priceKindId, sortedCustomerGroupIds), truncated
  customerOverlayId: string | null   // null when none of customerIds has price rows of its own; otherwise a stable key of the
                                     // ids that do, person first, joined with ',' — see §6.1
}

// Identity fields (customerId, companyId, customerIds) are read fresh from customer_accounts.CustomerUser
// (person_entity_id, customer_entity_id) and cached with the buyer context (60 s, §8) — never taken from
// JWT claims, which are copied at login (customerSessionService) and go stale when CRM links change.

export type StoreContext = {
  store: {
    id: string; code: string; name: string; slug: string
    status: 'active'
    defaultLocale: string
    supportedLocales: string[]
    defaultCurrencyCode: string
    settings: EcommerceStoreSettings
  }
  tenantId: string
  organizationId: string
  channel: { salesChannelId: string; priceKindId: string | null } | null
  buyer: BuyerContext
  effectiveLocale: string
  requestedLocale: string | null
  currencyCode: string
  /**
   * Stable digest of every field that can change what a buyer sees or pays.
   * MUST be a component of every cache key derived from this context.
   */
  digest: string
}

export interface StoreContextService {
  resolve(request: Request): Promise<StoreContext>
  resolveBySlug(slug: string, opts?: { locale?: string }): Promise<StoreContext>
  brandingStyles(settings: EcommerceStoreSettings): string   // ':root { --primary: ... }'
  invalidate(storeId: string): Promise<void>
}
```

### 6.0 Buyer identity: person and company (added 2026-10-05, D3/D3a)

A portal `CustomerUser` links to two CRM records: `person_entity_id` (the person) and `customer_entity_id` (always the **company**, enforced by `customer_accounts/subscribers/autoLinkCrm.ts`). Group memberships and contract price rows can be authored against either (`customer_groups` injects its tab into both `detail:customers.person:tabs` and `detail:customers.company:tabs`). The buyer is therefore the **union** of both identities:

- **Groups** — `resolveGroups({ customerIds, tenantId })` returns the union of both records' memberships, priority-ordered; on equal `priority` the person's group wins.
- **Scalar terms** — `resolveTerms({ customerIds, tenantId })` keeps the per-field group-priority algorithm over that union, with the same tie-break.
- **Prices** — `PricingContext.customerIds` (catalog, `pricing-engine.md`); a person-scoped row beats a company-scoped row of equal specificity score.
- **Assortment** — `resolveAssortmentScope({ customerIds, tenantId })`; the per-customer override (visibility spec Phase 4) applies per id.

These multi-id inputs are additive changes to `customer_groups` and `catalog` (the legacy single `customerId` inputs stay). `customerId` remains in the context as the most specific identity for consumers that need one id (display, audit); everything that resolves commercial state uses `customerIds`.

### 6.1 The digest

```
digest = sha256(
  storeId, effectiveLocale, taxMode,
  priceScopeKey,                    // channelId, currencyCode, priceKindId, sortedCustomerGroupIds
  assortmentScopeHash,
  customerOverlayId ?? '-'          // was: customerId ?? '-'  — see below
)
```

Truncated to 16 hex characters.

**`customerOverlayId`, not `customerId` (fixed 2026-09-16).** The original wording — "it deliberately includes `customerId`, so a customer with a personal price row does not share a cache entry with their group peers" — states the right requirement and implements it with the wrong input. `customerId` is non-null for *every* authenticated buyer, so the digest gives every one of them a private cache entry, whether or not they have a personal price row. In B2B the large majority do not: they are their group, they resolve to exactly their group's prices, and they could have shared one entry with it. The original input buys the stated safety at the cost of near-zero cache hit rate for authenticated traffic — which is precisely the traffic R2 identifies as the most expensive to serve.

`customerOverlayId` is `null` **when none of the buyer's `customerIds` has price rows of its own**, and otherwise a stable key of the ids that do — person first, joined with `','` (2026-10-05, D3). The stated requirement is unchanged — a buyer with a personal or company contract row still gets a private entry, by construction — while buyers without contracts collapse onto a shared, group-level entry. It is resolved once in `resolve()` by an `EXISTS` over `catalog_product_variant_prices` with `customer_id IN (customerIds)` — served by the `customer_id` partial index of `pricing-engine.md` Phase 2b, **which does not exist yet and MUST ship before this probe is enabled** (today the table has only the variant/product scope indexes) — and cached per buyer, invalidated on `catalog.price.created|updated|deleted` and bounded by the buyer-context TTL. A query rather than a denormalized flag: a stale `false` would serve a contracted buyer their group's prices, which is R1's failure mode.

**`assortmentScopeHash` hashes the resolved value, not the inputs (added 2026-09-16).** It is computed by `hashEffectiveScope()` from `packages/shared/src/lib/catalog-visibility/` (added 2026-10-05, D8), next to the algebra it canonicalizes, so `cart` and offline mode reuse the same hash rather than re-deriving it. Canonicalization recurses into `allOf`, the field `intersectScopes` uses to AND two sources inside one branch. Once a customer can carry an assortment override of their own ([Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.6), this distinction decides the cache hit rate the same way `customerOverlayId` just did for price: hashing `customerId`, the contributing group ids, or a "has an override" flag gives every authenticated buyer a private entry, while hashing the canonicalized resolved `EffectiveAssortmentScope` means a buyer with no override resolves byte-identically to their group-only result and keeps sharing the count-facet entries `storefront-public-api.md` §9.1 splits out. Canonicalization is part of the requirement — id arrays sorted, keys sorted, branches sorted by their own canonical form — because otherwise two semantically identical scopes hash differently whenever their branches arrive in a different group-priority order, a performance-only regression no semantic test would catch. Whether the buyer has an override at all is resolved by `customer_groups` with a cached indexed `EXISTS`, the same shape as the `customerOverlayId` probe above.

**Named components are addressable on purpose.** `digest` remains the default key for anything buyer-dependent, but roadmap ADR-7 (amended) requires a surface that varies with only one dimension to key on that dimension's named component instead — `assortmentScopeHash` for scope-only counts (the split `storefront-public-api.md` §9.1 already makes), `priceScopeKey` for group-level prices. `buildStorefrontCacheKey` still takes `StoreContext` as a required argument and the structural CI guard below is unchanged; a component key is built *through* the helper, not around it.

**Enforcement (redesigned 2026-10-05, D7).** The suite ships `buildStorefrontCacheKey(context: StoreContext, parts: string[])`, and keys are never built any other way. Two mechanisms hold that, so R1 does not rest on review alone:

1. **Typed accessor.** `lib/cacheKeys.ts` is the only file in the module allowed to call `container.resolve('cache')`. It exposes `storefrontCache(ctx: StoreContext)`, whose `get`/`set`/`deleteByTags` take the caller's `parts` and build the key internally through `buildStorefrontCacheKey`; there is no way to pass a raw key. Component-keyed entries (`assortmentScopeHash`, `priceScopeKey`) are built through the same accessor.
2. **Structural test.** `ecommerce/__tests__/no-raw-cache-access.test.ts` walks the whole module (`api/`, `lib/`, `subscribers/`, `workers/`) and fails on `resolve('cache')`, `resolve<…>('cache')` or `resolveCrudCache(` anywhere outside `lib/cacheKeys.ts`, modeled on `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts` (directory walk + regex). The earlier wording — grep `api/**` for `cache.resolve(` / `.get(` / `.set(` — was unenforceable: the cache API has no `resolve` method, a bare `.get(`/`.set(` matches hundreds of `searchParams.get`/`headers.set`/`Map` calls, and storefront caching lives in `lib/`, not `api/`.

The test is package-local, so it is **not** registered in `scripts/repo-wide-guards.mjs`: that list is for tests that read files outside their own package (header of that file), and a PR touching `ecommerce` already selects this package's tests under turbo's filter. Admin CRUD list caching done by `makeCrudRoute` itself is not buyer-dependent and is unaffected.

### 6.1a Tax display mode is derived, not resolved independently (fixed 2026-08-17)

`BuyerContext.taxMode` is **computed**, not carried through from `customerGroupsService.resolveTerms()`. `resolveTerms()` (spec 1, `customer_groups`) returns only `priceKindId`; `resolve()` here reads that price kind's `CatalogPriceKind.displayMode` (`catalog`, which this module already depends on for channel binding — no new dependency) and translates `'excluding-tax' → 'net'`, `'including-tax' → 'gross'`, the same translation `catalog`'s own `LineItemDialog.tsx` already performs everywhere else in this codebase. When no price kind resolves at all (misconfigured channel, no group override), `taxMode` falls back to `settings.display.priceDisplayModeDefault`.

**The derivation is sound only because the price kind is a pricing input (2026-10-05, D2).** On `develop`, `catalog`'s `PricingContext` has no `priceKindId` and `selectBestPrice` never filters by kind (`catalog/lib/pricing.ts` — kind only adds a score by code), so the winning row could belong to a kind with the *other* `displayMode` and `taxMode` would mislabel it. `pricing-engine.md` therefore gains an optional `PricingContext.priceKindId`, applied in `matchesContext` and `buildPriceRowFilter`; `resolve()` passes the same resolved `priceKindId` it derives `taxMode` from, so the selected row's kind equals the resolved kind. The amount shown is the selected row's `unitPriceNet` or `unitPriceGross` matching `taxMode`. Contract rows must be authored against the buyer's price kind to apply. The fallback to `settings.display.priceDisplayModeDefault` is unchanged.

A `/om-pre-implement-spec` audit found the original draft resolved `taxMode` independently (from a since-removed `CustomerGroupTerms.tax_display_mode` column) with no rule reconciling it against the selected price kind's own `displayMode` — a real defect, since a mismatch (e.g. a `net`-flagged buyer resolving to a `gross`-priced kind) mislabels a stored amount, not a cosmetic inconsistency.

### 6.2 Failure modes

| Condition | Result |
|---|---|
| Host matches no `active` `DomainMapping` (unknown, `pending`, `verified`, `dns_failed`, `tls_failed`) | `404`, no store details disclosed — a host without working TLS must not serve |
| `DomainMapping` `active`, no store binding | `404` |
| Binding points at a deleted `DomainMapping` | `404` to the client; a distinguishable "domain removed" error in logs and the admin Domains tab (R3) |
| Store `status = 'draft'` | `403` when `OM_ECOMMERCE_DEV_STORE_SLUG=true`, otherwise `404` — a draft store's existence is not public |
| Store `status = 'archived'` | `410 Gone` |
| No default channel binding | `503` plus an admin notification, throttled to once per (store, notification type) per hour — a misconfiguration, not a client error |
| Portal token whose `tenantId` or `orgId` differs from the store's | `401` (D4). Covers a bearer token from another tenant and a same-host cookie from another organization's store (path-prefix stores, shared dev host). The storefront answers a `401` by offering logout/re-login, never by redirecting in a loop |
| Requested locale unsupported | Fall back to `store.defaultLocale`; `requestedLocale` preserved in the response |

v3 returned `403` for draft stores unconditionally, which confirms a store exists at that host to anyone probing. Outside the explicit development flag (§9.1) the answer is `404`.

**Why `401` rather than anonymous on a tenant mismatch (2026-10-05, D4).** `getCustomerAuthFromRequest` takes the tenant from the JWT and never compares it with the request's host; the portal cookie is host-only with `path: '/'`, so every store on one host receives the same cookie. Treating a foreign token as anonymous would hide the mismatch; the owner chose to reject it. The consequence is accepted and documented: a buyer logged into one organization's store cannot browse another organization's store on the same host until they log out.

---

## 7) Branding

### 7.1 Token mapping

| Setting | CSS variable | Default |
|---|---|---|
| `primaryColor` | `--primary` | `oklch(0.205 0 0)` |
| `primaryForeground` | `--primary-foreground` | `oklch(0.985 0 0)` |
| `accentColor` | `--accent` | `oklch(0.97 0 0)` |
| `accentForeground` | `--accent-foreground` | `oklch(0.205 0 0)` |
| `backgroundColor` | `--background` | `oklch(1 0 0)` |
| `foregroundColor` | `--foreground` | `oklch(0.145 0 0)` |
| `borderRadius` | `--radius` | `0.625rem` |
| `fontFamilyBase` | `--font-base` | `'Inter', sans-serif` |
| `fontFamilyHeading` | `--font-heading` | inherits base |

### 7.2 SSR injection

`brandingStyles()` returns a `:root { … }` rule embedded in `<head>` during SSR. No flash of unthemed content, and no client-side style mutation on first paint. Runtime `setProperty` calls are used only by the admin live preview.

Branding is written only through `PUT /api/ecommerce/stores/:id/branding` (§9.2, D10), not through the general store `PUT`, so `ecommerce.branding.manage` is enforceable — `makeCrudRoute` gates a method by one feature and cannot gate a subset of fields. The route writes only `settings.branding` (a server-side merge, never a whole-`settings` replace), so a branding save cannot overwrite General/SEO values; it still locks on the store's `updated_at`, so two admins saving different tabs at the same moment get an honest `409` rather than a silent overwrite.

### 7.3 Validation

Colour values are validated as OKLCH or hex by a Zod refinement before persistence. An unvalidated string reaches a `<style>` tag, so this is an **injection boundary**: values are rejected, not escaped, and the emitted stylesheet is a fixed set of declarations with validated values — never interpolated markup.

Font families are constrained to an allowlist of system stacks plus a curated Google Fonts set. Arbitrary font URLs are a third-party request from the storefront and a privacy consideration; the allowlist is edited in code, not by tenants.

---

## 8) Caching

| Data | TTL | Invalidation |
|---|---|---|
| Host → active mapping (step 2) | 300s | Owned by `customer_accounts`: `domainMappingService` cache, tags `domain_routing` / `domain_routing:{host}`, invalidated by its own `customer_accounts.domain_mapping.*` subscriber. Not duplicated here |
| Mapping → store + default channel binding (steps 3–5) | 300s | Tags `ecommerce-store:{storeId}` and `ecommerce-domain-mapping:{domainMappingId}`. Events: `ecommerce.store.*`, `ecommerce.store_domain_binding.*`, `ecommerce.store_channel_binding.*` (§9.4); `customer_accounts.domain_mapping.replaced`, `.deleted`, `.activated`, `.dns_failed`, `.tls_failed` (there is no `.updated`); `sales.channel.updated`, `sales.channel.deleted` |
| Buyer context (step 6) | 60s | Tagged `customer:{id}` for **each** of `customerIds` and `customer-group:{groupId}` for **every** contributing group. Events: `customer_groups.membership.added`, `.removed` (payload carries `customerId`); `customer_groups.terms.updated`, `customer_groups.group.updated`, `.deleted` (payload carries `groupId` only — hence the group tag); `catalog.price.created`, `.updated`, `.deleted` for `customerOverlayId`. **TTL-only, stated on purpose:** `customer_groups.membership.expired` is declared but never emitted, and `catalog` declares no price-kind events, so a lapsed membership or a changed `displayMode` is visible within the 60 s TTL, not immediately |
| Branding stylesheet | 300s | Tag `ecommerce-store:{storeId}`; event `ecommerce.store.branding_updated` |

### 8.1 The resolution path (rewritten 2026-10-05, D6)

Earlier versions resolved steps 2–5 in one SQL join over `domain_mappings`, `ecommerce_store_domain_bindings`, `ecommerce_stores` and `ecommerce_store_channel_bindings`. That reads `customer_accounts`' table directly from another module and duplicates `domainMappingService`'s own five-minute cache under different tags, so the two would invalidate on different events.

Now:
1. **Step 2** is `domainMappingService.resolveByHostname(host)` via DI. On the hot path it is a cache hit.
2. **Steps 3–5** are **one** `ecommerce` query: bindings by `domain_mapping_id` with longest-prefix match on `path_prefix`, joined to the store (`status = 'active'`) and its default channel binding, all `ecommerce` tables.

A three-round-trip implementation of steps 3–5 is still a defect: this path runs on every uncached request, including static asset routes that carry a Host header. R2's P95 budget is unchanged.

Buyer context is resolved separately because it has a different TTL and different invalidation tags; anonymous requests skip it entirely.

---

## 9) API Contracts

### 9.1 Public

This module exposes exactly one public endpoint. All product, category, facet and search endpoints belong to spec 4.

#### `GET /api/ecommerce/storefront/context`

Headers: `Host`, optional `X-Locale`, optional portal session (cookie `customer_auth_token` or `Authorization: Bearer`).
Query: `storeSlug` (accepted only when `OM_ECOMMERCE_DEV_STORE_SLUG=true`; rejected with `400` otherwise), `locale`.

**Development addressing (2026-10-05, D18).** `?storeSlug=` and the draft-store `403` are enabled by the explicit env flag `OM_ECOMMERCE_DEV_STORE_SLUG` (default off; set to `true` in the dev `.env.example`, mirrored into the create-app template), not by `NODE_ENV`. The repo has no shared `isDevelopment` helper, and staging/preview builds run with `NODE_ENV=production`; a flag makes the bypass deliberate where it is wanted and impossible by accident elsewhere.

A portal token whose tenant or organization differs from the resolved store returns `401` (§6.2).

```typescript
{
  store: { id, code, name, slug, status, defaultLocale, supportedLocales,
           defaultCurrencyCode, settings }
  effectiveLocale: string
  requestedLocale: string | null
  supportedLocales: string[]
  currencyCode: string
  buyer: {                          // safe projection — never the full BuyerContext
    isAuthenticated: boolean
    taxMode: 'gross' | 'net'
    displayName: string | null
    companyName: string | null
    allowPurchaseOnAccount: boolean
  }
}
```

The response exposes a **projection** of the buyer context. `customerGroupIds`, `priceKindId`, `customerId` and `assortmentScope` are internal: publishing them would tell a buyer which price list they are on and let them probe for others.

Cache headers: `public, max-age=60` when anonymous; `private, no-store` when authenticated.

### 9.2 Admin

All under `requireAuth` with feature guards, built with `makeCrudRoute`, `openApi` exported, Zod-validated, optimistic locking via `updated_at`.

```
GET|POST         /api/ecommerce/stores
GET|PUT|DELETE   /api/ecommerce/stores/:id                    // PUT rejects any change to settings.branding
PUT              /api/ecommerce/stores/:id/branding           // command route, ecommerce.branding.manage (D10)
GET              /api/ecommerce/stores/:id/preview-branding   // validate query params + return CSS, no persist
GET|POST         /api/ecommerce/store-domain-bindings
GET|PUT|DELETE   /api/ecommerce/store-domain-bindings/:id
GET|POST         /api/ecommerce/store-channel-bindings
GET|PUT|DELETE   /api/ecommerce/store-channel-bindings/:id
GET              /api/ecommerce/store-channel-bindings/:id/assortment-count   // live count; ?draftScope= for unsaved form state
```

Except for the three non-CRUD routes below, these are `makeCrudRoute` routes.

**`PUT /stores/:id/branding` (added 2026-10-05, D10).** A custom write route, not `makeCrudRoute`:
- `requireFeatures: ['ecommerce.branding.manage']`.
- Wired to the mutation guard registry as operation `update`: collect registered guards, call `runMutationGuards(…, { userFeatures })` before writing, merge `modifiedPayload`, run `afterSuccessCallbacks`.
- Optimistic lock on the store's `updated_at` (`x-om-ext-optimistic-lock-expected-updated-at`); conflicts are surfaced through `surfaceRecordConflict` on the client.
- Writes only `settings.branding` (server-side merge), validated per §7.3, and emits `ecommerce.store.branding_updated`.

The general `PUT /stores/:id` rejects a payload that changes `settings.branding` with a field error, so the branding feature cannot be bypassed through it.

**`GET .../assortment-count` (added 2026-10-05).** Backs the Channels tab's live product count (§10a US-E1, visibility spec US-B1/B2).
- `requireFeatures: ['ecommerce.stores.view']`.
- Counts products matching the binding's saved scope, or a validated `?draftScope=` (the same zod schema as `assortment_scope`) for unsaved form state.
- Returns the count for an anonymous buyer and states when `require_authentication` reduces it to `0`.

**`preview-branding` is `GET`, not `POST`** (fixed 2026-08-17): it performs no domain write, and this repo's existing precedent for "validate and return, don't persist" endpoints (`messages/api/[id]/forward-preview/route.ts`, `sync_excel/api/preview/route.ts`) is `GET` in every case. The mutation-guard registry covers only `create`/`update`/`delete` operations (`shared/lib/crud/mutation-guard-registry.ts`), so a `GET` is outside it by construction. Candidate branding values are passed as validated query params only; the earlier "signed short-lived draft reference" option is dropped (2026-10-05) — the repo has no generic signed-token helper, and the branding set is small enough for a query string.

### 9.3 ACL features

```typescript
export const features = [
  { id: 'ecommerce.stores.view',     title: 'View stores' },
  { id: 'ecommerce.stores.manage',   title: 'Manage stores' },
  { id: 'ecommerce.branding.manage', title: 'Manage store branding' },
  { id: 'ecommerce.domains.manage',  title: 'Manage store domain bindings' },
  { id: 'ecommerce.channels.manage', title: 'Manage store channel bindings' },
]
```

v3's `ecommerce.checkout.manage` and `ecommerce.orders.view` are removed — those surfaces moved to `@open-mercato/checkout` and `sales`. `ecommerce.storefront.view`/`.manage` are removed as duplicates of `stores.view`/`.manage`.

`setup.ts` `defaultRoleFeatures` grants `superadmin` and `admin` `ecommerce.*`, and `employee` `ecommerce.stores.view` (the repo's roles are `superadmin`/`admin`/`employee`, e.g. `customer_groups/setup.ts`; there is no `member` role). Existing tenants receive the grants through `yarn mercato auth sync-role-acls` (§18).

`ecommerce.visibility.diagnose` ([Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §7) is **not** part of Phases 1–3: it arrives with the optional explainability tool and is declared in this `acl.ts` only when that tool ships.

### 9.4 Events and notifications (added 2026-10-05)

Declared in `events.ts` with `createModuleEvents(… ) as const`. Event IDs are FROZEN once released.

| Event | Payload | Notes |
|---|---|---|
| `ecommerce.store.created` / `.updated` / `.deleted` | `{ id, tenantId, organizationId }` | CRUD; drives cache invalidation (§8) |
| `ecommerce.store_domain_binding.created` / `.updated` / `.deleted` | `{ id, storeId, domainMappingId, tenantId, organizationId }` | CRUD; also emitted by the `domain_mapping.replaced` re-binding subscriber |
| `ecommerce.store_channel_binding.created` / `.updated` / `.deleted` | `{ id, storeId, salesChannelId, tenantId, organizationId }` | CRUD |
| `ecommerce.store.branding_updated` | `{ id, tenantId, organizationId }` | From `PUT /stores/:id/branding` |
| `ecommerce.store.misconfigured` | `{ storeId, tenantId, organizationId, reason: 'no_default_channel_binding' }` | Emitted by the resolver on the `503` path, throttled once per (store, reason) per hour |
| `ecommerce.assortment.empty_detected` | `{ storeId, channelBindingId, assortmentScopeHash, tenantId, organizationId }` | R7 warning; throttled once per (store, binding, hash) per hour; **never** carries customer ids |

Notification types (`notifications.ts` / `notifications.client.ts`; type IDs FROZEN once released):
- `ecommerce.store.channel_binding_missing` — from `ecommerce.store.misconfigured`.
- `ecommerce.store.assortment_empty` — from `ecommerce.assortment.empty_detected`.

Both are delivered by a subscriber through `NotificationService.createForFeature` (`notifications/lib/notificationService.ts`, built with `buildFeatureNotificationFromType`, required feature `ecommerce.stores.manage`, precedent `wms/subscribers/low-stock-notification.ts`). They are **not** delivered by emitting a `notifications.create` event: nothing subscribes to that ID, which is why the `customer_accounts` subscribers that use it never deliver.

---

## 10) Module File Structure

```
packages/core/src/modules/ecommerce/
├── index.ts
├── acl.ts
├── setup.ts                      # default store on tenant creation (idempotent), role features
├── events.ts                     # §9.4
├── di.ts                         # storeContextService
├── search.ts                     # stores by name/code/slug, aclFeatures: ['ecommerce.stores.view'] (D16)
├── notifications.ts              # ecommerce.store.channel_binding_missing, ecommerce.store.assortment_empty (§9.4)
├── notifications.client.ts
├── i18n/{de,en,es,ko,pl}.json    # every locale the repo ships
├── data/
│   ├── entities.ts               # 3 entities
│   └── validators.ts             # incl. AssortmentScope without allOf (§5.3)
├── lib/
│   ├── storeContext.ts           # resolve(), resolveBySlug() — via domainMappingService + one query (§8.1)
│   ├── buyerContext.ts           # step 6: tenant/org check, person+company ids, taxMode derivation — §6.0, §6.1a
│   ├── brandingStyles.ts         # generation + OKLCH/hex validation
│   └── cacheKeys.ts              # the ONLY file that resolves 'cache': buildStorefrontCacheKey() + storefrontCache(ctx) — §6.1
├── api/
│   ├── openapi.ts
│   ├── get/ecommerce/storefront/context/route.ts
│   ├── put/ecommerce/stores/[id]/branding/route.ts         # command route, mutation guards (D10)
│   ├── get/ecommerce/store-channel-bindings/[id]/assortment-count/route.ts
│   └── {get,post,put,delete}/ecommerce/…       # admin CRUD
├── backend/config/ecommerce/
│   ├── page.tsx                  # store list
│   └── [id]/{page,branding,domains,channels,seo}.tsx
├── widgets/notifications/
│   └── index.ts                  # renderer for the notifications above
├── __tests__/
│   └── no-raw-cache-access.test.ts  # R1 structural guard — §6.1
└── subscribers/
    ├── store-cache-invalidation.ts
    ├── domain-binding-rebind.ts  # customer_accounts.domain_mapping.replaced → re-point bindings (§5.2)
    └── store-notifications.ts    # §9.4 events → createForFeature
```

Added `search.ts`, the five-locale `i18n/` set, the branding and assortment-count routes, the re-binding and notification subscribers, and the renamed cache guard (2026-10-05). Added `notifications.ts`/`notifications.client.ts`/`widgets/notifications/` (fixed 2026-08-17): §6.2 and R7 already promised an admin notification and a warning event respectively, but the original file structure never declared where they'd be defined — per `packages/core/src/modules/customers/AGENTS.md` § Module Files Checklist, a module promising in-app notifications needs these files.

Spec 4 adds `lib/storefront*.ts` and the public read routes to this same module.

---

## 10a) User Stories

Scope: the admin/backoffice surface only — store definition, hostname binding, channel binding, branding, SEO. The shopper-facing storefront (spec 10) and the public catalogue (spec 4) are out of scope here; no shopper personas appear below.

**Roles**, from §9.3 ACL features and `setup.ts`: **Tenant Admin** (`admin` or `superadmin` — all `ecommerce.*` features) and **Team Member** (`employee` — `ecommerce.stores.view` only, no `.manage`/`.branding.manage`/`.domains.manage`/`.channels.manage`). A Team Member can navigate every tab a store's `view` feature exposes but cannot submit any write action.

### Epic A — Store directory and lifecycle
*Screens: store list (`backend/config/ecommerce/page.tsx`)*

- **US-A1.** As a Tenant Admin, I want to see all stores in my tenant with their status, primary domain and channel, so that I can find the one I need to configure.
  - Columns: Name, Code, Status, Primary domain, Channel, Created (§11). Status filter.
  - *Default-value:* a freshly onboarded tenant shows exactly one `draft` store, seeded from organization metadata (§17 Phase 3); a tenant that existed before the module was enabled gets it through the Upgrade Action (§18) — until the operator runs it, the list shows an empty state pointing to that action.
  - *Empty:* a status filter that matches nothing shows an explicit empty-results state, distinct from the seeded-default case above.
  - *Permission:* a Team Member sees the same list and columns but no Create action and no per-row Archive action.
- **US-A2.** As a Tenant Admin, I want to create a new store, so that I can stand up an additional selling surface (e.g. a second brand) without touching the first.
  - *Error:* a `code` or `slug` already used within the tenant is rejected with a field-level error, not a generic failure.
  - *Keyboard:* the create dialog follows the project-wide rule — `Cmd/Ctrl+Enter` submits, `Escape` cancels.
- **US-A3.** As a Tenant Admin, I want to archive a store I no longer sell through, so that it stops resolving publicly (`410`, §6.2) while its configuration and history are preserved.
  - *Undo:* the spec defines no unarchive transition (§5.1 only lists `draft | active | archived`) — archiving is therefore presented behind an explicit confirmation, not an optimistic, silently-reversible toggle. This is a spec gap worth flagging in review, not something the prototype should paper over by inventing an unarchive button.
- **US-A4.** As a Team Member, I want read-only visibility into store status and bindings, so that I can support customers or diagnose issues without being able to change store configuration.
  - *Permission:* covered by the row-level restriction in US-A1; every write control (Create, Archive, and every Save button on every tab below) is hidden or disabled, never just failing silently on submit.

### Epic B — General settings
*Screens: store edit → General tab*

- **US-B1.** As a Tenant Admin, I want to edit a store's name, code, slug, supported locales, default locale and default currency, so that the store's identity and localization match how it actually sells.
  - *Error:* `default_locale` must be a member of `supported_locales` (§5.1) — removing the currently-default locale from the supported set is rejected with a field error, not silently auto-picking a new default.
  - *Optimistic:* two admins editing the same store concurrently — the second Save is rejected with a `409`, surfaced through the unified conflict bar (`surfaceRecordConflict`, derived from `initialValues.updatedAt` per `CrudForm`'s default optimistic-locking behavior), not a blind overwrite.
  - *Keyboard:* `Cmd/Ctrl+Enter` submit, `Escape` cancel.
- **US-B2.** As a Tenant Admin, I want to set whether my store shows out-of-stock products and allows backorders by default, so that per-product policies only need to describe exceptions (added 2026-10-05, D12).
  - The two controls edit the store-default `AvailabilityPolicy` row (`store_id` = this store) through the availability API; they are not stored on the store record. A product- or variant-level policy still overrides them, and the form says so.
  - *Permission:* requires `ecommerce.stores.manage` to see the controls enabled and the availability module's own manage feature to save; without the latter the controls are read-only with an explanation, never a failing Save.
  - *Optimistic:* the policy row carries its own `updated_at`; its conflict is surfaced independently of the store record's.

### Epic C — Branding
*Screens: store edit → Branding tab, `GET .../preview-branding`*

- **US-C1.** As a Tenant Admin, I want to set my store's colors, fonts and corner radius, so that the storefront matches my brand without needing a developer.
  - *Default-value:* any unset field falls back to the documented DS default (§7.1 table) — the form shows those defaults pre-filled rather than blank inputs of unknown effective value.
  - *Error:* a colour outside OKLCH/hex, or a font outside the allowlist, is rejected with a field error at submit time — never escaped-and-saved (R4, §7.3).
  - *Permission:* `ecommerce.branding.manage` gates this tab's write actions independently of `ecommerce.stores.manage` — a Tenant Admin missing only this feature can view the tab but not submit it. Enforced server-side by the dedicated `PUT /stores/:id/branding` route (§9.2), not only by hiding the button.
- **US-C2.** As a Tenant Admin, I want to preview my branding changes live before saving, so that I can iterate on look-and-feel without repeatedly persisting bad values.
  - The preview iframe applies validated values via `postMessage` and CSS custom properties (§11) — nothing is written until an explicit Save, so this is illustrative live feedback, not an optimistic write; the prototype must not imply the preview alone persists anything.

### Epic D — Domain bindings
*Screens: store edit → Domains tab*

- **US-D1.** As a Tenant Admin, I want to bind a domain (optionally with a path prefix) to my store, so that the store becomes reachable at that hostname.
  - *Business rule as a permission-like gate:* only a `DomainMapping` in status `active` (DNS verified **and** TLS issued) serves; picking a `pending`, `verified`, `dns_failed` or `tls_failed` one is allowed but renders an explicit warning naming the status and stating the store will not serve at that host yet (§5.2, §11).
  - *Limit:* an organization holds at most two domain mappings (one active plus one pending replacement); a second store in the same organization is reached through a `path_prefix` on the shared host, and the form says so instead of offering an "add domain" action that would fail.
  - *Error:* a duplicate `(domain_mapping_id, path_prefix)` pair is rejected (unique constraint, §5.2); two bindings where one prefix is a proper prefix of the other are both allowed and resolve by longest-prefix match (R6) — the UI should not present that as a conflict.
- **US-D2.** As a Tenant Admin, I want to be told clearly when a bound domain's underlying `DomainMapping` has been deleted elsewhere (in `customer_accounts`), so that I understand why my store stopped serving instead of seeing an unexplained generic error.
  - *Error state (R3):* the Domains tab surfaces an explicit "domain removed" diagnostic for a dangling binding, with a link to the domain management screen in `customer_accounts` (`/backend/customer_accounts/settings/domain`, read-only cross-module reference, never a direct edit surface).
  - *Replacement:* when the domain is replaced in `customer_accounts` (a new mapping superseding the old), the binding follows it automatically (§5.2); the tab shows the new hostname and its status, not a removed-domain error.
- **US-D3.** As a Tenant Admin, I want to designate one binding as primary, so that canonical URLs are unambiguous when a store has several domains.
  - *Default-value:* at most one `is_primary = true` per store is enforced — setting a new primary implicitly and visibly un-sets the previous one.

### Epic E — Channel bindings and assortment
*Screens: store edit → Channels tab*

- **US-E1.** As a Tenant Admin, I want to bind a sales channel to my store, optionally overriding its price kind, narrowing its assortment by category/tag and excluding specific products, categories or tags, so that I control what this store sells and at what prices.
  - Include pickers (categories, tags) and exclude pickers (products, categories, tags) both ship in this tab (D14); clearing a picker means "no restriction", never "hide everything".
  - The tab shows a live count of matching products for the current — including unsaved — `assortment_scope`, served by `GET .../assortment-count` (§9.2).
  - *Empty:* when the channel's assortment scope and a buyer's group scope (set elsewhere, in `customer_groups`) intersect to nothing for a real buyer, that is surfaced to admins as a warning event (R7) rather than silently shown as a normal, if small, catalogue — the prototype should show this as a distinct alert state, not just a "0 products" count.
- **US-E2.** As a Tenant Admin, I want to be notified when my store has no default channel binding, so that I can fix a misconfiguration before it causes a `503` for real traffic (§6.2).
  - *Error:* an in-app admin notification (`notifications.ts`, §10) is the delivery mechanism — this is a proactive alert, not something the admin has to discover by hitting the storefront themselves.

- **US-E3.** As a Tenant Admin running a contract-priced B2B channel, I want to choose what price sorting does past the 5 000-product cap, so that my buyers are never shown a price ranking computed from prices they do not pay (§5.3 `price_sort_fallback`, added 2026-09-16).
  - *Default value:* the field is `approximate` on an existing and a newly-created binding, so a B2C channel keeps today's behaviour and an admin who never opens this control changes nothing.
  - The control sits with the other per-channel catalogue policies — assortment scope, `require_authentication` and the live product count — because all four answer "what does this channel show, to whom".
  - Choosing `unavailable` must state its consequence on the form: `price_asc`/`price_desc` stop being offered on this channel at all, and a buyer arriving on a shared `?sort=price_asc` link gets the catalogue in the default order rather than an error.
  - Choosing `approximate` must state its own: past the cap the order is computed from the default price kind, not from the buyer's resolved prices, and the only signal is a response header no shopper sees.
  - The 5 000 cap is named on the form rather than left as an unexplained threshold — the roadmap's no-silent-caps rule applies to the admin surface too, not only to the API response.

### Epic F — SEO defaults
*Screens: store edit → SEO tab*

- **US-F1.** As a Tenant Admin, I want to set my store's site name, default meta description, `robots.txt` and Google site verification token, so that search engines index the storefront correctly.
  - *Default-value:* unset fields have no store-level fallback beyond "absent" (§5.1.1 `seo` subtree has no documented defaults, unlike `branding`) — the form should show these as genuinely empty, not implying a hidden default exists.
  - *Keyboard:* `Cmd/Ctrl+Enter` submit, `Escape` cancel.

### Cross-cutting rules

- Every write action across every tab uses `CrudForm` with optimistic locking derived from `initialValues.updatedAt`; a conflicting concurrent edit always surfaces through the unified conflict bar, never a silent overwrite or an unexplained failure (applies to US-B1 and, by the same mechanism, US-C1/D1/D3/E1/F1).
- Every dialog and form follows `Cmd/Ctrl+Enter` submit / `Escape` cancel.
- `ecommerce.stores.view` is the floor: it grants read-only navigation into every tab. Each `.manage` feature (`stores`, `branding`, `domains`, `channels`) independently gates that tab's write controls — a Team Member, or a Tenant Admin missing one specific `.manage` feature, sees the tab but its Save/Create/Archive controls are hidden or disabled rather than present-but-failing.
- No story above proposes an unarchive action, a shopper-facing view, or a redesign of the resolution/caching architecture in §4–§8 — this section only decomposes the already-decided admin surface (§11) into reviewable, screen-addressable stories for the click-through prototype.

---

## 11) Admin UI

**Store list** (`backend/config/ecommerce/page.tsx`) — `DataTable` with Name, Code, Status, Primary domain, Channel, Created. Row actions: Edit, Domains, Channels, Archive. Status filter.

**Store edit** — tabs: General, Branding, Domains, Channels, SEO.

- **General** edits identity, locales and currency (store record) and, in a separate section, the store-default availability policy — out-of-stock visibility and backorders — saved through the availability API to the `AvailabilityPolicy` store-default row (§5.1.1, US-B2).
- **Domains** lists bindings with their `DomainMapping` (read through `domainMappingService`, not a cross-module join), surfacing status, last DNS check and any TLS failure reason **read-only**, with a link to the domain management screen in `customer_accounts`. Only an `active` mapping serves; a binding to a `pending`/`verified`/`dns_failed`/`tls_failed` mapping renders a warning naming the status. The two-mappings-per-organization limit and the `path_prefix` alternative are stated on the form.
- **Channels** binds a `SalesChannel`, optionally overrides the price kind, and edits the channel's `assortment_scope` with include pickers (categories, tags) and exclude pickers (products, categories, tags) and a live count of matching products from `GET .../assortment-count`, recomputed for unsaved changes. It also carries the two per-channel catalogue policies added since: `require_authentication` (§5.3) and `price_sort_fallback` (§5.3), which belong beside the scope because all four describe what this channel shows and to whom.
- **Branding** offers colour pickers, the font allowlist, a radius slider, logo and favicon upload, and a live preview; it saves through `PUT /stores/:id/branding`.

**Branding live preview** renders a miniature storefront in an iframe. Values are pushed via `postMessage` and applied as CSS variables without saving. The preview iframe is `sandbox`ed and receives only validated values — it is the same injection boundary as §7.3.

All forms use `CrudForm` and derive the optimistic-lock header from `initialValues.updatedAt`. All copy ships in the five locales the repo maintains (`de`, `en`, `es`, `ko`, `pl`).

---

## 12) Security

- Resolution yields exactly one tenant and organization; every downstream query is scoped by both. Cross-tenant exposure is structurally impossible via this path.
- A portal token is accepted only when its `tenantId` **and** `orgId` equal the resolved store's; otherwise `401` (§6.2, D4). `getCustomerAuthFromRequest` does not perform this check itself, so the resolver must.
- Buyer identity ids are read from `CustomerUser`, never trusted from JWT claims.
- Storefront product queries always enforce `deleted_at IS NULL` and `is_active = true` — restated here because spec 4 depends on it.
- Draft stores return `404` unless `OM_ECOMMERCE_DEV_STORE_SLUG=true` (§6.2); their existence is not disclosed.
- Only an `active` `DomainMapping` serves (DNS verified and TLS issued), preventing a hostname from being served before DNS proves ownership or without TLS.
- `?storeSlug=` is rejected unless `OM_ECOMMERCE_DEV_STORE_SLUG=true`. It bypasses host resolution and would otherwise let anyone address any store on the deployment.
- Branding values are validated, not escaped, before reaching a `<style>` tag (§7.3).
- The public context endpoint returns a buyer **projection**, never group ids, price kind or assortment scope (§9.1).
- Authenticated responses are `private, no-store`. Anonymous responses are `public, max-age=60`.
- Public endpoint rate limit: 120 req/min per IP for `/context` (it is called on every storefront boot), declared through the route's `rateLimit` metadata (`{ points: 120, duration: 60, keyPrefix: 'ecommerce_context' }`, the mechanism `apps/mercato/src/app/api/[...slug]/route.ts` enforces). Spec 4 sets limits for the heavier read endpoints.

---

## 13) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Buyer-context cache bleed | **Critical** | `ecommerce` | A cached response keyed without the digest serves an ACME contract price to an anonymous visitor, or to a competitor with an account on the same store. Confidential commercial terms disclosed. | `digest` is a required field of `StoreContext`; `buildStorefrontCacheKey` takes the context as a required argument so a key cannot be built without it; authenticated responses are `no-store`; cross-context isolation tests gate Phase 1; **typed accessor + structural guard** (§6.1): only `lib/cacheKeys.ts` may resolve `cache`, it exposes no raw-key API, and a module-wide test fails the build on any other `resolve('cache')`/`resolveCrudCache(`, so a bypass fails CI rather than relying on review alone | Low |
| R2 | Resolution latency on every request | **High** | `ecommerce` | Four sequential lookups per uncached request; the resolver becomes the platform's slowest middleware and every storefront route inherits it. | Step 2 is a cached `domainMappingService` call and steps 3–5 one `ecommerce` query (§8.1); 300s cache with tag invalidation; anonymous requests skip buyer resolution; a latency budget test asserts P95 under 15 ms uncached | Low |
| R3 | Divergent domain state | Medium | `ecommerce`, `customer_accounts` | An operator deletes a `DomainMapping` (hard delete) or replaces it (a new row with `replaces_domain_id`); the binding dangles and the store silently stops serving with no diagnostic. | Binding stores the FK id only and reads the mapping through `domainMappingService`; `domain_mapping.replaced` re-points bindings to the new id (§5.2); a deleted mapping surfaces as an explicit "domain removed" error state in admin, and the resolver logs a distinguishable error rather than a generic 404 | Low |
| R4 | Branding CSS injection | **High** | `ecommerce` | A tenant admin stores `red; } body { background: url(https://evil/) } :root {` as a colour; the emitted stylesheet exfiltrates via a background request, or defaces the store. | Zod refinement validates OKLCH/hex and rejects anything else; fonts come from an allowlist; the generated sheet is a fixed declaration set with validated values, never interpolated markup; fuzz test over malformed colour inputs | Low |
| R5 | Store `settings` blob drift | Medium | `ecommerce` | The JSONB grows into a dumping ground for other modules' configuration, as v3's `enableReviews`/`enableWishlist` already showed. | `settings` is Zod-validated with a closed schema; unknown keys are rejected on write; new configuration belongs to the owning module | Low |
| R6 | Multi-store host collision | Medium | `ecommerce` | Two bindings claim the same host with overlapping path prefixes; resolution becomes order-dependent. | Unique `(domain_mapping_id, path_prefix)`; longest-prefix match is the documented rule; a binding whose prefix is a proper prefix of another is allowed and resolves by longest match | Low |
| R7 | Assortment scope intersection surprises | Medium | `ecommerce`, `customer_groups` | A buyer's group scope and the channel scope intersect to the empty set; the storefront shows an empty catalogue with no explanation. | Intersection is the documented rule (§5.3); admin shows a live matching-product count per scope; an empty effective assortment for an authenticated buyer emits `ecommerce.assortment.empty_detected` (§9.4), throttled, which notifies admins via `ecommerce.store.assortment_empty` | Medium — the operator must act on the warning |
| R8 | Draft store probing | Low | `ecommerce` | v3's `403` for draft stores confirms existence to a prober. | `404` by default; `403` only when `OM_ECOMMERCE_DEV_STORE_SLUG=true`, a deliberate per-environment flag rather than `NODE_ENV` | Low |
| R9 | Portal token from another tenant or organization | **High** | `ecommerce`, `customer_accounts` | `getCustomerAuthFromRequest` trusts the JWT tenant. A bearer token from tenant A, or a same-host cookie from another organization's store, reaches store B and is treated as an authenticated buyer: foreign identity in B-scoped lookups, private responses, cache entries for a stranger — and, for a same-tenant other-organization store, tenant-wide group memberships yielding B2B terms the buyer has no relationship with in that organization. | Resolver compares `auth.tenantId` and `auth.orgId` with the store and answers `401` on mismatch (§6.2, D4); identity ids read from `CustomerUser`, not the JWT; integration tests for both shapes (§16) | Low — accepted UX cost: one store per login on a shared host |
| R10 | Price kind without effect on price selection | **High** | `ecommerce`, `catalog` | Without a price-kind input to `PricingContext`, a group's price-kind override changes nothing in which row is selected, and `taxMode` derived from that kind can mislabel the amount of a row of another kind. | `PricingContext.priceKindId` filter (`pricing-engine.md`, D2) is a Phase 1 prerequisite; the amount shown is the selected row's net/gross field matching `taxMode`; §16 regression test | Low |

---

## 14) What Moved Where

| v3 section | Now in |
|---|---|
| §8 Product & variant payloads | Spec 4 — Storefront Public API |
| §9 Dynamic filters & faceted search | Spec 4 |
| §10 Localization | Spec 4 (resolution order stays here as §4.1 step 7) |
| §12.1 Public storefront APIs | Spec 4 |
| §21 Search integration | Spec 4 |
| §24 API performance targets | Spec 4; app-side targets to spec 10 |
| §14 Storefront app architecture | Spec 10 — Storefront App |
| §15 Component specifications | Spec 10 |
| §16 Design system | Spec 10 |
| §17 Responsive web design | Spec 10 |
| §18 WCAG 2.2 AA | Spec 10 |
| §25.2 `TC-SF-*` Playwright cases | Spec 10 |
| Availability semantics (§8.4, §8.5, §9.1) | [Availability Contract](./2026-08-14-availability-contract.md) |

## 15) What Was Withdrawn

| v3 section | Disposition |
|---|---|
| §7.4 `EcommerceCheckoutSession` | **Withdrawn.** The cart is a first-class entity in the `cart` module (ADR-1); the checkout session lives in `@open-mercato/checkout` and holds `cart_id` (ADR-3). |
| §7.5 Idempotency strategy | **Moved and reworked.** Session-creation keys and version locking belong to `cart` (spec 5) and `checkout` (spec 7). The reasoning in v3 was sound and is carried forward there. |
| §19 Checkout workflow integration | **Withdrawn** per ADR-3. `@open-mercato/checkout` is the sole checkout funnel for every channel. Whether its step machine uses the `workflows` module remains open and is decided in spec 7 — v3's rationale for workflows (audit trail, per-store configurability, compensation, async activities) is carried into that decision. |
| §19.5 Blocking on workflow documentation | No longer blocks this module. It may still gate spec 7. |
| `settings.features.enableReviews` / `.enableWishlist` | **Removed.** Configuration for unbuilt modules. |
| `ecommerce.checkout.manage`, `ecommerce.orders.view` ACL features | **Removed.** Those surfaces belong to `@open-mercato/checkout` and `sales`. |

---

## 16) Integration Coverage

Renumbered from v3's `TC-EC-*`; cases covering moved scope now live in the specs that own them.

**Resolution:**
- Store created with `is_primary` enforced at most once per organization
- `active` `DomainMapping` + binding resolves host → store → tenant/org
- A `verified`-but-not-`active` mapping (TLS not issued), and `pending`/`dns_failed`/`tls_failed` ones, do not serve (404) even with a valid binding
- Deleted `DomainMapping` yields the distinguishable dangling-binding error, not a generic 404 (R3)
- Replacing a domain (`customer_accounts.domain_mapping.replaced`) re-points the binding; the store serves at the new host once it is `active`, with no admin action
- Unknown host → 404 with no store details
- Draft store → 404 by default, 403 with `OM_ECOMMERCE_DEV_STORE_SLUG=true`
- Archived store → 410
- Missing default channel binding → 503 plus one admin notification; a burst of requests within the hour produces no second notification (throttling)
- Longest-prefix match with two bindings on one host (R6)
- `?storeSlug=` works with `OM_ECOMMERCE_DEV_STORE_SLUG=true` and is rejected with the flag unset, regardless of `NODE_ENV`
- Resolution of steps 2–5 issues one `domainMappingService` call (a cache hit when warm) and exactly one `ecommerce` query

**Buyer context:**
- Anonymous: no groups, channel price kind resolves, `taxMode` derived from that price kind's `displayMode` (falls back to `display.priceDisplayModeDefault` only if no price kind resolves at all)
- Authenticated B2B: groups priority-ordered, group price kind overriding the channel default, `taxMode` derived from the *resolved* (group-overridden) price kind's `displayMode` — not read from a stored per-buyer field
- A price kind whose `displayMode` disagrees with the buyer's expected mode (regression test for the fixed dual-source-of-truth defect) resolves to the price kind's mode, never a stale independent value
- Assortment scope is the intersection of channel and group scopes; empty intersection emits the warning event (R7)
- A group price kind whose `displayMode` differs from the channel default's: the selected price row is of the resolved (group) kind and its displayed amount matches `taxMode` — never a row of the other kind (R10, D2)
- Two buyers in different groups on the same store produce different digests
- The same buyer across two locales produces different digests
- Membership change invalidates the buyer context immediately (`membership.added`/`.removed`); a `terms.updated` on a contributing group invalidates via the `customer-group:{id}` tag; a lapsed membership (no event) is reflected within the 60 s TTL

**Identity and tenant binding (2026-10-05, D3/D3a/D4):**
- A bearer token issued by a second tenant, sent to a store of the first → `401`; no buyer context is resolved and nothing is cached for it
- A same-tenant cookie issued by another organization's store on the same host (path-prefix stores) → `401`
- A buyer whose person and company are each members of different groups resolves the union of both groups; on equal group `priority` the person's group wins the scalar term
- A person-scoped contract row beats a company-scoped row of equal specificity; `customerOverlayId` lists only the ids that have rows, person first
- Changing `CustomerUser.customer_entity_id` after login is reflected within the buyer-context TTL — the JWT copy is not used

**Cache isolation (Phase 1 gate):**
- An anonymous request following an authenticated one for the same URL never receives the authenticated body
- Two authenticated buyers in different groups never share a cache entry
- Authenticated responses carry `private, no-store`
- The structural guard (`no-raw-cache-access.test.ts`) fails on a fixture file under `lib/` or `subscribers/` that resolves `cache` directly, and passes for `lib/cacheKeys.ts`
- Two buyers with semantically identical but differently ordered resolved scopes (including `allOf` branches) produce the same `assortmentScopeHash`

**Branding:**
- Valid OKLCH and hex persist; malformed values are rejected with a field error
- Fuzz suite of injection payloads is rejected, never escaped-and-emitted (R4)
- Font outside the allowlist rejected
- SSR emits the stylesheet in `<head>`; no post-hydration style mutation
- Unknown keys in `settings` rejected on write (R5)
- `PUT /stores/:id/branding` without `ecommerce.branding.manage` → `403`; with it, writes only `settings.branding` and emits `ecommerce.store.branding_updated`
- General `PUT /stores/:id` that changes `settings.branding` is rejected with a field error
- `assortment_scope` containing `allOf` is rejected by the channel-binding validator

**API paths:** every route in §9, each asserting tenant isolation against a second-tenant fixture.

**Performance:** uncached resolution P95 under 15 ms with a seeded 50-store tenant (R2).

**UI paths:** store list with status filter, store create, general edit with optimistic-lock conflict, store-default availability policy edit, branding with live preview and rejection of a bad colour, domain binding against an `active` and a `verified`-only domain (warning shown), channel binding with include/exclude pickers and live assortment count for unsaved changes, `require_authentication` toggle, SEO tab, Cmd+K finds a store by code (`search.ts`).

---

## 17) Implementation Phases

### Phase 0.5 — Prerequisites outside this module (added 2026-10-05)
Each lands in its owning module/spec before Phase 1 code depends on it; all are additive:
- `catalog`: `PricingContext.priceKindId?` and `PricingContext.customerIds?` (person-scoped row beats company-scoped row of equal score), applied in `matchesContext` and `buildPriceRowFilter`, with the property test extended — owned by `pricing-engine.md` (D2, D3).
- `catalog`: `pricing-engine.md` Phase 2b partial indexes, including the `customer_id` index the `customerOverlayId` probe needs (its predicate corrected — `catalog_product_variant_prices` has no `deleted_at`).
- `customer_groups`: `resolveGroups`/`resolveTerms`/`resolveAssortmentScope` accept `{ customerIds, tenantId, at? }` (legacy `customerId` kept), person's group wins equal-priority ties; `CustomerGroupTerms.assortment_scope` column and the real body of `resolveAssortmentScope` replacing today's `null` stub (D13).
- `packages/shared`: `canonicalizeEffectiveScope` / `hashEffectiveScope` in `lib/catalog-visibility/`, recursing into `allOf` (D8).

### Phase 1 — Entities and resolution
Module scaffold, three entities, validators, migration, admin CRUD, `storeContext.ts` (`domainMappingService` + one query), `buyerContext.ts` (tenant/org check, person + company identity, `taxMode` derivation), `cacheKeys.ts` with the typed accessor and the structural guard, the public `/context` endpoint, events, cache and invalidation subscribers, the `domain_mapping.replaced` re-binding subscriber, notification types and their subscriber, `search.ts`.

**Gate:** the cache-isolation suite passes; the tenant-binding tests pass; resolution P95 within budget; anonymous and authenticated B2B contexts differ correctly, including by price kind.

### Phase 2 — Branding
`brandingStyles.ts` with validation, SSR injection, `preview-branding` endpoint, `PUT /stores/:id/branding` command route with mutation guards.

**Gate:** the injection fuzz suite is fully rejected; no FOUC in an SSR render test.

### Phase 3 — Admin UI
Store list and all five tabs, live preview, domain state surfaced read-only from `customer_accounts`, channel include/exclude pickers with the `assortment-count` endpoint, store-default availability policy section, the Upgrade Action for existing tenants.

**Gate:** UI paths in §16 pass, including the optimistic-lock conflict path.

`setup.ts` seeds one `draft` store per tenant from organization metadata (name, locale, currency) so a fresh tenant has something to configure rather than an empty screen. The seed is idempotent (no second draft if one exists), so the Upgrade Action (§18) and the module-sets spec's future `mercato module setup` can both run it safely.

---

## 18) Migration & Backward Compatibility

- Additive throughout. No existing admin or product API changes.
- The module is opt-in via `modules.ts`; tenants not selling are unaffected. It is enabled in `apps/mercato/src/modules.ts` and **commented out** in the create-app template next to `customer_groups` and `availability` (which are commented out there today for the same reason — standalone AI-harness coverage). It reaches standalone apps through the `commerce` preset of [Module Sets for Standalone Apps](./2026-09-29-module-sets-for-standalone-apps.md) (its Phase 3), which also adds `ecommerce` to the `ecommerce-suite` set (D22).
- **Existing tenants** get a `draft` store through an Upgrade Action in `packages/core/src/modules/configs/lib/upgrade-actions.ts` (`requiredModules: ['ecommerce']`), which calls the same idempotent seed `setup.ts` uses for new tenants (D17). `setup.ts` hooks only run at tenant creation, so without the action an existing tenant would see an empty list. Nothing serves publicly until an operator binds an `active` domain and activates the store.
- New ACL features reach existing tenants' roles via `yarn mercato auth sync-role-acls`.
- `OM_ECOMMERCE_DEV_STORE_SLUG` is added to `apps/mercato/.env.example` (and mirrored into the create-app template, `yarn template:sync:fix`).
- Changes this spec depends on in other modules, all additive (BC category in brackets): `catalog` `PricingContext.priceKindId?` / `customerIds?` [2 Types, 3 Signatures — optional fields]; `pricing-engine.md` Phase 2b indexes [8 DB — new indexes]; `customer_groups` multi-id service inputs [9 DI — optional input fields on an existing service] and `customer_group_terms.assortment_scope jsonb null` [8 DB — new nullable column]; `packages/shared` `hashEffectiveScope`/`canonicalizeEffectiveScope` [4 Import paths — new exports]. New surfaces this module introduces become FROZEN/STABLE on release: event IDs and notification type IDs (§9.4), ACL features (§9.3), API routes (§9), `storeContextService` and the `BuyerContext`/`StoreContext` types (§6).
- No data migration. `EcommerceStoreDomain` from v3 was never implemented, so its replacement by `EcommerceStoreDomainBinding` is a spec change, not a schema change — no deprecation protocol is triggered.

---

## 19) Open Questions

Resolved since v3:

1. ~~Customer account model~~ — `customer_accounts` (`CustomerUser`, portal sessions), already implemented.
2. ~~Payment providers~~ — spec 7; `payment_gateways` with `gateway-stripe` shipped.
3. ~~Inventory policy at browse vs. checkout~~ — [Availability Contract](./2026-08-14-availability-contract.md) §7: advisory at browse, authoritative at submit.
4. ~~Search backend~~ — spec 4.
5. ~~Multi-store per organization~~ — supported from Phase 1; `is_primary` marks the default, and host+path binding makes several stores per host possible. Because `customer_accounts` caps an organization at two domain mappings (one active + one pending replacement), several stores in one organization are reached through `path_prefix` on a shared host rather than one hostname each (§5.2, 2026-10-05).

Open:

6. **SEO sitemap** — auto-generated `sitemap.xml` and `robots.txt` per store. Belongs to spec 4 or spec 10; `settings.seo.robotsTxt` reserves the configuration.
7. **Store-level UI label translation** — v3 noted `EcommerceStore` as a future translatable entity. Whether per-store copy overrides go through the `translations` module or `settings` is unresolved; spec 8 (merchandising) is the natural owner.

---

## 20) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `domain_mapping_id`, `sales_channel_id`, `price_kind_id` are FK ids; groups and terms via `customerGroupsService` |
| Tenant/organization scoping | Resolution yields exactly one of each; every test asserts isolation |
| Never expose cross-tenant data | §12; cache isolation is a Phase 1 gate; portal tokens bound to the store's tenant and organization (`401` otherwise, §6.2) |
| Domain serving | Only `active` mappings serve, through `domainMappingService` (DI), never a cross-module SQL join (§4.1, §8.1) |
| Zod validation | All routes and the `settings` blob with a closed schema |
| No `any` | Service contract and settings fully typed |
| Optimistic locking | All three entities expose `updatedAt`; admin forms use `CrudForm`; no `version` counter (verified this document does not repeat the sibling customer-groups spec's original mistake) |
| Encryption | `settings.contact` (email/phone/address) is the store's own public business contact info shown on the storefront, not personal customer data — same category as `sales.SalesChannel`'s plaintext contact fields; no field encryption |
| Cache safety / structural guard | §6.1 — typed `storefrontCache(ctx)` accessor in `lib/cacheKeys.ts` plus a package-local structural test over the whole module; not in `REPO_WIDE_GUARDS`, which is for tests reading outside their own package |
| Cross-module data derivation | `taxMode` is derived from `catalog.CatalogPriceKind.displayMode` at resolution time, never stored as an independent field — §6.1a (fixed 2026-08-17); sound because the price kind is a `PricingContext` filter (D2, 2026-10-05) |
| Events & notifications | Event IDs and notification types enumerated in §9.4; delivery via `NotificationService.createForFeature`, throttled |
| Search | `search.ts` with `aclFeatures` (D16) |
| Availability | No store-level availability values in `settings`; the `AvailabilityPolicy` store-default row is the single source (D12) |
| i18n | No hard-coded strings; `de`, `en`, `es`, `ko`, `pl` |
| Design system | Admin UI uses `@open-mercato/ui` primitives and semantic tokens; no hardcoded status colours |
| Backward compatibility | Additive; the withdrawn v3 scope was never implemented (independently verified, re-verified 2026-10-05 on `develop` @ `a108dd07f4`: zero matches for `EcommerceStore*`, `ecommerce_*`, `/api/ecommerce`, `ecommerce.*` features, `BuyerContext`, `StoreContext`, `storeContextService`, `buildStorefrontCacheKey`), so no contract surface is broken and no deprecation protocol applies; dependencies on other modules are additive and listed in §18 |
| Migrations | `yarn db:generate`, snapshot reviewed |
| Integration coverage | §16, shipping in the same change |

---

## 21) Changelog

### 2026-10-05 — v4.6 (Phase 0 reconciliation, owner decisions)

Reconciles the spec with the Phase 0 code that landed after it was written (#6709 `customer_groups`/`availability`/`catalog-visibility`, #6268 pricing engine phases 1–2), per `/om-pre-implement-spec` analysis `ANALYSIS-2026-10-05-spec-029-ecommerce-store-module-v4.5.md`, and applies the owner's decisions recorded in `ANALYSIS-2026-10-05-storefront-release-decisions.md`.

- **D1 — serve on `active`, not `verified`** (§4.1, §5.2, §6.2, §10a US-D1, §11, §12, §16). Evidence: `DomainStatus = 'pending' | 'verified' | 'active' | 'dns_failed' | 'tls_failed'` (`customer_accounts/data/entities.ts`); `verified` = DNS ok, TLS not issued; `domainMappingService.resolveByHostname` returns only `active` (`services/domainMappingService.ts`).
- **D2 — price kind becomes a pricing input** (§4.1, §6, §6.1a, R10). Evidence: `PricingContext` has no `priceKindId` and `selectBestPrice` ignores kind (`catalog/lib/pricing.ts`). The derivation of `taxMode` now rests on an additive `PricingContext.priceKindId` owned by `pricing-engine.md`.
- **D3/D3a — buyer = person ∪ company, person wins ties** (new §6.0, §4.1, §6 types). `CustomerUser.customer_entity_id` is the company and `person_entity_id` the person (`customer_accounts/AGENTS.md`, `subscribers/autoLinkCrm.ts`). `BuyerContext` gains `customerIds`. `customerId` = person ?? company. `customerOverlayId` covers both ids. Ids are read from `CustomerUser`, not from JWT claims (`services/customerSessionService.ts` copies them at login).
- **D4 — portal token bound to the store's tenant and organization, `401` on mismatch** (§4.1, §6.2, §9.1, §12, R9, §16). Evidence: `getCustomerAuthFromRequest` (`customer_accounts/lib/customerAuth.ts`) never compares the JWT tenant with the host; the cookie is host-only with `path: '/'` (`api/login.ts`).
- **D5 — domain constraints documented, replacement followed** (§5.2, R3, US-D1/D2). Covers the 2-per-organization limit (`data/guards.ts`), hard deletes, and the `domain_mapping.replaced` re-binding subscriber.
- **D6 — resolution via `domainMappingService` + one `ecommerce` query** (§4.1, §8, §8.1, R2), replacing the cross-module four-table join.
- **D7 — cache guard redesigned** (§6.1, §10, §16, §20, R1). Introduces the typed `storefrontCache(ctx)` accessor and a module-wide ban on `resolve('cache')`/`resolveCrudCache(` outside `lib/cacheKeys.ts`, modeled on `command-interceptor-http-coverage.test.ts`, with no `REPO_WIDE_GUARDS` entry. The previous wording was unenforceable: `cache.resolve(` does not exist, `.get(`/`.set(` matches `searchParams`/`headers`, and only `api/**` was scanned.
- **D8 — `assortmentScopeHash` from the shared `hashEffectiveScope`, recursing into `allOf`** (§6, §6.1); `assortment_scope` validator rejects `allOf` (§5.3). Evidence: `intersectScopes` emits `allOf` (`shared/lib/catalog-visibility/types.ts`, `intersectScopes.ts`), and no canonicalization helper existed.
- **D10 — branding through a dedicated `PUT /stores/:id/branding` command route** (§7.2, §9.2, US-C1, §16). Also adds the live-count endpoint `GET .../assortment-count` (§9.2), which §10a/§11 had required with no endpoint. `preview-branding` takes query params only.
- **D12 — store availability defaults moved to the `AvailabilityPolicy` store-default row** (§5.1.1, §4.2, new US-B2, §11). Removed `display.showOutOfStock`/`allowBackorder`. Evidence: the `store_default` level in `availability/lib/policyResolution.ts`; `hideWhenOutOfStock` is applied by no provider.
- **D13/D14** — Phase 0.5 depends on the `CustomerGroupTerms.assortment_scope` column replacing the `null` stub (`customer_groups/services/customerGroupsService.ts`). The channel exclude pickers ship on the Channels tab (US-E1, §11).
- **D16 — `search.ts`**; **D17 — Upgrade Action for existing tenants** (§17, §18, US-A1); **D18 — `OM_ECOMMERCE_DEV_STORE_SLUG`** (§4.1, §5.1, §6.2, §9.1, §12, R8); **D22 — template entry commented out until the module-sets `commerce` preset** (§18).
- **Mechanical fixes**: invalidation now uses the real event IDs (`catalog.price.created|updated|deleted`, `customer_groups.membership.added|removed`, `terms.updated`/`group.*` via a new `customer-group:{id}` tag, `customer_accounts.domain_mapping.*` without `.updated`), with the TTL-only cases stated (`membership.expired` is never emitted; there are no price-kind events) (§8). New §9.4 lists events and notification types, delivered via `createForFeature` with throttling. Roles are now `superadmin`/`admin`/`employee` instead of `member` (§9.3, §10a). i18n covers five locales. The `/context` rate limit uses `rateLimit` metadata. §18 is renamed "Migration & Backward Compatibility", with the `sync-role-acls` note and the cross-module additive dependencies. A new Phase 0.5 lists the prerequisites (§17).
- **Closes the remaining open items of the 2026-08-17 audit**: `search.ts` (added), the R1 guard (redesigned), the §8.1 ORM-ambiguity note (the join is gone), and the §18 heading. The `BuyerContext` vs ADR-7 divergence is closed by amending the roadmap's ADR-7 to this spec's shape, with the person + company `customerIds` and `storeContextService` naming (roadmap changelog, same date).

### 2026-09-16 — v4.5 (story and admin-surface coverage for `price_sort_fallback`)

- **§10a Epic E** gains **US-E3** for the `price_sort_fallback` column v4.3 added to §5.3. The column was specified and defaulted, but no story described the control that sets it, so the admin surface it belongs to had no acceptance criteria — including the one that matters, that each value states its own consequence on the form.
- **§11** the Channels bullet is amended to list `require_authentication` and `price_sort_fallback`. It had described only the channel, price kind and assortment scope, and so still described the tab as it stood before 2026-09-06.

### 2026-09-16 — v4.4 (per-customer assortment overrides)

Applied from [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.6/§3.7, where per-customer visibility was raised as a requirement in both directions.

- §4.1 step 6 — the buyer-side scope now also carries that customer's own override (grant unioned in, restriction intersected over the result), resolved entirely inside `customer_groups.resolveAssortmentScope()`. **The composition line in this module is unchanged**: `intersectScopes(channel.assortmentScope, buyerScope)` still receives one finished `EffectiveAssortmentScope`, and the channel layer still bounds it from above, so an override can never reveal what a channel excludes.
- §6 / §6.1 — stated that `assortmentScopeHash` digests the **canonicalized resolved** scope rather than its inputs, and why: it is the same trade this version's own `customerOverlayId` fix made for price, and it is what keeps the per-customer cost confined to customers who actually carry an override. No new digest component; `require_authentication`'s short-circuit is unchanged and still skips the whole buyer layer, override included.

### 2026-09-16 — v4.3 (buyer-scoped read-path amendments)

Applied the suite-wide amendment recorded as roadmap ADR-7 (amended) and ADR-9.

- §6 `BuyerContext` gains `assortmentScopeHash`, `priceScopeKey` and `customerOverlayId` as named, independently-hashable scope components. No new information — all three are derived from fields already present; what changes is that cache, projection and index keys may now address one dimension instead of the whole context.
- §6.1 the digest takes **`customerOverlayId`** where it previously took `customerId`. The old input made the stated requirement true by giving *every* authenticated buyer a private cache entry, including the majority of B2B buyers who hold no contract rows and resolve to exactly their group's prices — buying R1's safety at the cost of the cache hit rate on the traffic R2 calls most expensive to serve. The requirement is unchanged and now costs only what it should.
- §5.3 gains **`price_sort_fallback`**, default `'approximate'` — the per-channel policy for what happens past the storefront's 5 000-product price-sort cap. Default preserves current behavior; `'unavailable'` exists because sorting a contract-priced B2B catalogue by list price is not an approximation of that buyer's price order.

### 2026-09-06 — v4.2 (sibling amendments applied)

Applied the amendments [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §0 records against this document, rather than leaving them pending in a sibling file that ships in the same change.

- §5.3 `EcommerceStoreChannelBinding.assortment_scope` retyped to the shared `AssortmentScope` from `packages/shared/src/lib/catalog-visibility/`, gaining `excludeCategoryIds` / `excludeTagIds` (additive jsonb keys, no migration change).
- §5.3 gains **`require_authentication: boolean`**, default `false` — the explicit login-required-to-view switch for an invitation-only B2B channel. Governs catalog visibility only, never the whole storefront.
- §4.1 step 6 and §6 `BuyerContext.assortmentScope`: the channel ∩ group intersection is now computed by the shared `intersectScopes()` over an `EffectiveAssortmentScope` (an OR-list of AND-scopes) rather than described as prose intersection, and the `require_authentication` short-circuit resolves to `[]` **without calling `customer_groups` at all**. `null` = unrestricted, `[]` = deny-all; both are ordinary values of the shared type, needing no sentinel.
- `assortmentScopeHash` (§6.1's digest) is unchanged — this supplies a correctly-computed value for the slot that already existed, and adds no new cache-key dimension.

### 2026-08-17 — v4.1 (pre-implementation fixes)

Fixed the findings of a `/om-pre-implement-spec` audit (`ANALYSIS-2026-08-14-spec-029-ecommerce-store-module.md`):

- **Critical**: `BuyerContext.taxMode` was resolved independently of `priceKindId` via a since-removed `CustomerGroupTerms.tax_display_mode` column, with no rule reconciling the two — a genuine dual-source-of-truth defect (verified: `catalog`'s own `LineItemDialog.tsx` always derives gross/net from the price kind's `displayMode`, never from an independent buyer preference). Fixed: `taxMode` is now derived from the resolved price kind's `CatalogPriceKind.displayMode` at resolution time (§6.1a, §4.1 step 6). Coordinated fix applied to `customer-groups-and-b2b-terms.md` §5.3/§6.1a too.
- R1's mitigation gained a CI-enforced structural guard (§6.1) alongside the existing type-level and review-based mitigations, given the risk's Critical severity.
- Added `notifications.ts`/`notifications.client.ts`/`widgets/notifications/` to §10, which §6.2 and R7 already promised but the file structure never declared.
- `POST .../preview-branding` (§9.2) changed to `GET`, matching this repo's existing "validate and return, don't persist" precedent and resolving mutation-guard-registry ambiguity.
- Added an Encryption row to §20 justifying `settings.contact` as non-PII public business info.
- Independently re-verified the BC self-audit claims in §15/§18 (withdrawn v3 scope, replaced `EcommerceStoreDomain`) — confirmed true, zero collisions found anywhere in this repo.

### 2026-08-14 — v4 (rescope)

- Rescoped to the `ecommerce` module alone. Public read APIs, the storefront application, its design system, RWD and WCAG scope moved to specs 4 and 10 of the suite (§14).
- Withdrew `EcommerceCheckoutSession` and the checkout workflow integration per ADR-1 and ADR-3 (§15).
- Replaced `EcommerceStoreDomain` with `EcommerceStoreDomainBinding` after finding that `customer_accounts.DomainMapping` already implements hostname routing, provider abstraction (`traefik`), `verified_at`, `last_dns_check_at`, `dns_failure_reason`, `tls_failure_reason`, `tls_retry_count` and `replaces_domain_id` — the state machine v3 proposed to duplicate. Added `path_prefix`, enabling several stores per host.
- Added `BuyerContext` and the cache digest per ADR-7, making B2C and B2B one code path with different context, and making cache-key construction mechanical via `buildStorefrontCacheKey`.
- Made `assortment_scope` intersect between the channel binding and group terms, resolving roadmap Open Question 4.
- Tightened security: draft stores return `404` in production rather than `403`; unverified domains never serve; the public context response is a buyer projection rather than the full context; branding values are validated as an injection boundary rather than escaped.
- Removed `settings.features.enableReviews` / `.enableWishlist` (configuration for unbuilt modules) and replaced `showPriceIncludingTax` with `display.priceDisplayModeDefault`, since the effective mode now comes from group terms. Repointed `showOutOfStock` / `allowBackorder` at the `AvailabilityPolicy` resolution chain.
- Removed `ecommerce.checkout.manage` and `ecommerce.orders.view` ACL features; removed `ecommerce.storefront.*` as duplicates.
- Closed five of seven open questions against implemented code.

### 2026-02-18 — v3

- Clarified `EcommerceCheckoutSession` as also being the cart (`status: 'open'`); added `version` optimistic locking and `idempotency_key`; added §7.5 idempotency strategy; added `StorefrontVersionConflictError`; threaded version through the frontend checkout pattern. *(Superseded by v4; the cart model moved to the `cart` module and the idempotency reasoning to specs 5 and 7.)*

### 2026-02-17 — v2

- Expanded the initial outline into a full engineering specification: `settings` schema, per-store CSS theming with SSR, storefront payload types, facets with cross-facet exclusion, filter query schema, variant resolution, component specifications, WCAG 2.2 checklist, RWD, design system, checkout workflow plan, caching, performance targets, 34 integration cases, the `apps/storefront` component tree and admin UI. *(Distributed across suite specs 4 and 10 by v4.)*

### 2026-02-17 — v1

- Base architecture, entity definitions, API contract outline, five-phase plan.
