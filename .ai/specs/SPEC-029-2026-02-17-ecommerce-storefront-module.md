# SPEC-029: Ecommerce Store Module

| Field | Value |
|-------|-------|
| **Status** | Specification (v4.1 — rescoped, pre-implementation fixes) |
| **Created** | 2026-02-17 |
| **Rescoped** | 2026-08-14 |
| **Pre-implementation fixes** | 2026-08-17 — see §21 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 3, Phase 1 |
| **Modules** | `ecommerce` (new) |
| **Related Issues** | #289, #288 |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md) |

> **v4 rescope notice.** Versions 1–3 of this document specified a backend module, a public catalog API, a checkout state machine and a complete Next.js application in one spec. That scope is now split across the ecommerce suite. This document retains **only the `ecommerce` module**: store definition, hostname binding, channel binding, buyer-context resolution, branding and admin surface. See §14 for what moved where, and §15 for what was withdrawn outright.

---

## TLDR

**Key Points:**
- The `ecommerce` module owns *what a store is* and *who is asking* — nothing else. It resolves an incoming request to a store, a tenant/organization, a sales channel, a price kind and a buyer identity, and it serves per-store branding. It is a read-and-configure module with no write path into commerce.
- Domain lifecycle is **not** reimplemented here. `customer_accounts.DomainMapping` already owns hostname → tenant/org routing with provider abstraction, DNS verification, TLS failure tracking and supersession chains. `ecommerce` adds only a binding row from a verified domain to a store.
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
- The two-hop hostname resolution (host → `DomainMapping` → binding → store) is on every single request and must not cost two round trips
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
  ├─ 1. Normalize Host  ('firda.pl')  — or ?storeSlug= in development
  │
  ├─ 2. customer_accounts: DomainMapping by hostname
  │        → tenantId, organizationId, status must be 'verified'
  │
  ├─ 3. EcommerceStoreDomainBinding by domainMappingId (+ pathPrefix)
  │        → storeId
  │
  ├─ 4. EcommerceStore by id, status = 'active'
  │
  ├─ 5. EcommerceStoreChannelBinding, isDefault = true
  │        → salesChannelId, priceKindId, assortmentScope
  │
  ├─ 6. Buyer identity (optional portal session cookie)
  │        customer_accounts: CustomerUser → customers: CustomerEntity
  │        customer_groups: resolveGroups() → groupIds
  │        customer_groups: resolveTerms()  → priceKind override,
  │                                            assortment scope, credit flags
  │        catalog: CatalogPriceKind.displayMode of the resolved priceKindId
  │                 (group override, else channel default) → taxMode
  │                 ('excluding-tax' → 'net', 'including-tax' → 'gross') — §6.1a
  │
  └─ 7. Locale:  ?locale → X-Locale → Accept-Language → store.defaultLocale
                 (must be in store.supportedLocales, else fall back)
  ▼
StoreContext { store, tenantId, organizationId, channel, buyer, effectiveLocale, digest }
```

Steps 2–5 are one query, not four — see §8.1.

### 4.2 Ownership boundaries

| Concern | Owner |
|---|---|
| Store identity, branding, locale/currency defaults, SEO defaults | `ecommerce` |
| Hostname registration, DNS verification, TLS, provider | `customer_accounts.DomainMapping` |
| Which store a verified hostname serves | `ecommerce` (binding only) |
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
| `slug` | text | URL-safe, unique within tenant; development host override |
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
    showOutOfStock: boolean          // default true — store-level default in the availability chain
    allowBackorder: boolean          // default false — idem
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

`display.showOutOfStock` and `display.allowBackorder` are the **store-level defaults in the `AvailabilityPolicy` resolution chain** (availability spec §5.2), not independent switches. Per-product policy overrides them.

### 5.2 `EcommerceStoreDomainBinding` (`ecommerce_store_domain_bindings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `domain_mapping_id` | uuid | `customer_accounts.DomainMapping.id` — FK id, no ORM relation |
| `path_prefix` | text, nullable | e.g. `/shop`; null = host root. Enables one host serving several stores |
| `is_primary` | boolean | One per store; drives canonical URLs |

Constraints: unique `(domain_mapping_id, path_prefix)` among non-deleted rows — one host+prefix serves exactly one store; at most one `is_primary = true` per store.

**This entity replaces v3's `EcommerceStoreDomain`.** The `host`, `tls_mode` and `verification_status` columns are gone: hostname uniqueness, DNS verification state, TLS provisioning, failure reasons, retry counters and supersession all remain in `DomainMapping`, which already implements them. Binding to an unverified `DomainMapping` is permitted (so an operator can configure ahead of DNS propagation) but the resolver refuses to serve it.

### 5.3 `EcommerceStoreChannelBinding` (`ecommerce_store_channel_bindings`)

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid | FK → `ecommerce_stores` |
| `sales_channel_id` | uuid | `sales.SalesChannel.id` |
| `price_kind_id` | uuid, nullable | `catalog.CatalogPriceKind.id`; anonymous default |
| `assortment_scope` | jsonb, nullable | `{ categoryIds?, tagIds?, excludeProductIds? }` |
| `is_default` | boolean | One per store |

`assortment_scope` uses the same shape as `CustomerGroupTerms.assortment_scope`. When both are present they **intersect**: the buyer sees products allowed by the channel *and* by their group. Resolving Open Question 4 of the roadmap — channel scope is the store's assortment, group scope narrows it further for that buyer, and neither can widen the other.

---

## 6) Service Contract

`ecommerce/di.ts` registers `storeContextService`.

```typescript
export type BuyerContext = {
  customerUserId: string | null
  customerId: string | null
  customerGroupIds: string[]        // priority-ordered, from customerGroupsService
  companyId: string | null
  isAuthenticated: boolean
  taxMode: 'gross' | 'net'          // DERIVED from priceKindId's CatalogPriceKind.displayMode — see §6.1a; never set independently
  priceKindId: string | null        // group terms override the channel default
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  assortmentScope: AssortmentScope | null   // channel ∩ group
}

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

### 6.1 The digest

```
digest = sha256(
  storeId, channelId, priceKindId, currencyCode, effectiveLocale, taxMode,
  sortedCustomerGroupIds, customerId ?? '-', assortmentScopeHash
)
```

Truncated to 16 hex characters. It deliberately includes `customerId`, so a customer with a personal price row does not share a cache entry with their group peers.

**Enforcement.** The suite ships a helper `buildStorefrontCacheKey(context: StoreContext, parts: string[])` that takes `StoreContext` as a required argument. Endpoints construct keys through it. A key built any other way is a review-blocking defect. Because R1 is Critical, review discipline alone is not the only gate: a Phase 1 deliverable is a structural test (`ecommerce/__tests__/no-raw-cache-calls.test.ts`, plain-regex grep over `ecommerce/api/**` for `cache.resolve(` / `.get(`/`.set(` calls outside `lib/cacheKeys.ts`, mirroring the existing `optimistic-lock-editable-entities.test.ts` pattern) that fails CI if a route bypasses the helper. This test MUST be registered in `scripts/repo-wide-guards.mjs`'s `REPO_WIDE_GUARDS` list — otherwise turbo's dependency-filtered CI silently skips it on PRs touching only `ecommerce` route files, which would defeat the point.

### 6.1a Tax display mode is derived, not resolved independently (fixed 2026-08-17)

`BuyerContext.taxMode` is **computed**, not carried through from `customerGroupsService.resolveTerms()`. `resolveTerms()` (spec 1, `customer_groups`) returns only `priceKindId`; `resolve()` here reads that price kind's `CatalogPriceKind.displayMode` (`catalog`, which this module already depends on for channel binding — no new dependency) and translates `'excluding-tax' → 'net'`, `'including-tax' → 'gross'`, the same translation `catalog`'s own `LineItemDialog.tsx` already performs everywhere else in this codebase. When no price kind resolves at all (misconfigured channel, no group override), `taxMode` falls back to `settings.display.priceDisplayModeDefault`.

A `/om-pre-implement-spec` audit found the original draft resolved `taxMode` independently (from a since-removed `CustomerGroupTerms.tax_display_mode` column) with no rule reconciling it against the selected price kind's own `displayMode` — a real defect, since a mismatch (e.g. a `net`-flagged buyer resolving to a `gross`-priced kind) mislabels a stored amount, not a cosmetic inconsistency.

### 6.2 Failure modes

| Condition | Result |
|---|---|
| Host matches no `DomainMapping` | `404`, no store details disclosed |
| `DomainMapping.status !== 'verified'` | `404` — an unverified host must not serve |
| `DomainMapping` verified, no store binding | `404` |
| Store `status = 'draft'` | `403` in development, `404` in production — a draft store's existence is not public |
| Store `status = 'archived'` | `410 Gone` |
| No default channel binding | `503` plus an admin notification — a misconfiguration, not a client error |
| Requested locale unsupported | Fall back to `store.defaultLocale`; `requestedLocale` preserved in the response |

v3 returned `403` for draft stores unconditionally, which confirms a store exists at that host to anyone probing. Production returns `404`.

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

### 7.3 Validation

Colour values are validated as OKLCH or hex by a Zod refinement before persistence. An unvalidated string reaches a `<style>` tag, so this is an **injection boundary**: values are rejected, not escaped, and the emitted stylesheet is a fixed set of declarations with validated values — never interpolated markup.

Font families are constrained to an allowlist of system stacks plus a curated Google Fonts set. Arbitrary font URLs are a third-party request from the storefront and a privacy consideration; the allowlist is edited in code, not by tenants.

---

## 8) Caching

| Data | TTL | Invalidation |
|---|---|---|
| Host → store resolution (steps 2–5) | 300s | Tag `ecommerce-store:{storeId}` and `ecommerce-domain:{host}` on store, binding or `DomainMapping` change |
| Buyer context (step 6) | 60s | Tag `customer:{customerId}` — invalidated by `customer_groups.membership.*` events |
| Branding stylesheet | 300s | Tag `ecommerce-store:{storeId}` |

### 8.1 The resolution query

Steps 2–5 resolve in **one** query joining `domain_mappings`, `ecommerce_store_domain_bindings`, `ecommerce_stores` and `ecommerce_store_channel_bindings`, filtered on the normalized host. This runs on every uncached request including static asset routes that carry a Host header, so a four-round-trip implementation is a defect.

Buyer context is resolved separately because it has a different TTL and a different invalidation tag; anonymous requests skip it entirely.

---

## 9) API Contracts

### 9.1 Public

This module exposes exactly one public endpoint. All product, category, facet and search endpoints belong to spec 4.

#### `GET /api/ecommerce/storefront/context`

Headers: `Host`, optional `X-Locale`, optional portal session cookie.
Query: `storeSlug` (development only, rejected in production), `locale`.

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
GET|PUT|DELETE   /api/ecommerce/stores/:id
GET|POST         /api/ecommerce/store-domain-bindings
GET|PUT|DELETE   /api/ecommerce/store-domain-bindings/:id
GET|POST         /api/ecommerce/store-channel-bindings
GET|PUT|DELETE   /api/ecommerce/store-channel-bindings/:id
GET              /api/ecommerce/stores/:id/preview-branding   // validate query params + return CSS, no persist
```

**`preview-branding` is `GET`, not `POST`** (fixed 2026-08-17): it performs no domain write, and this repo's existing precedent for "validate and return, don't persist" endpoints (`messages/api/[id]/forward-preview/route.ts`, `sync_excel/api/preview/route.ts`) is `GET` in every case — `POST` here would have left it ambiguous whether the mutation-guard registry applies (`packages/core/AGENTS.md` § API Routes requires it for non-`GET` custom routes). Candidate branding values are passed as validated query params or a signed short-lived draft reference, not a body.

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

`setup.ts` grants `admin` all features and `member` the `view` features.

---

## 10) Module File Structure

```
packages/core/src/modules/ecommerce/
├── index.ts
├── acl.ts
├── setup.ts                      # default store on tenant creation, role features
├── events.ts
├── di.ts                         # storeContextService
├── notifications.ts              # missing-default-channel-binding, empty-assortment-scope (R7) types
├── notifications.client.ts
├── i18n/{en,pl}.json
├── data/
│   ├── entities.ts               # 3 entities
│   └── validators.ts
├── lib/
│   ├── storeContext.ts           # resolve(), resolveBySlug()
│   ├── buyerContext.ts           # step 6, incl. taxMode derivation — §6.1a
│   ├── brandingStyles.ts         # generation + OKLCH/hex validation
│   └── cacheKeys.ts              # buildStorefrontCacheKey()
├── api/
│   ├── openapi.ts
│   ├── get/ecommerce/storefront/context/route.ts
│   └── {get,post,put,delete}/ecommerce/…       # admin CRUD
├── backend/config/ecommerce/
│   ├── page.tsx                  # store list
│   └── [id]/{page,branding,domains,channels,seo}.tsx
├── widgets/notifications/
│   └── index.ts                  # renderer for the notifications above
├── __tests__/
│   └── no-raw-cache-calls.test.ts  # R1 structural guard — §6.1
└── subscribers/
    └── store-cache-invalidation.ts
```

Added `notifications.ts`/`notifications.client.ts`/`widgets/notifications/` (fixed 2026-08-17): §6.2 and R7 already promised an admin notification and a warning event respectively, but the original file structure never declared where they'd be defined — per `packages/core/src/modules/customers/AGENTS.md` § Module Files Checklist, a module promising in-app notifications needs these files.

Spec 4 adds `lib/storefront*.ts` and the public read routes to this same module.

---

## 10a) User Stories

Scope: the admin/backoffice surface only — store definition, hostname binding, channel binding, branding, SEO. The shopper-facing storefront (spec 10) and the public catalogue (spec 4) are out of scope here; no shopper personas appear below.

**Roles**, from §9.3 ACL features and `setup.ts`: **Tenant Admin** (`admin` — all `ecommerce.*` features) and **Team Member** (`member` — `*.view` features only, no `.manage`/`.branding.manage`/`.domains.manage`/`.channels.manage`). A Team Member can navigate every tab a store's `view` feature exposes but cannot submit any write action.

### Epic A — Store directory and lifecycle
*Screens: store list (`backend/config/ecommerce/page.tsx`)*

- **US-A1.** As a Tenant Admin, I want to see all stores in my tenant with their status, primary domain and channel, so that I can find the one I need to configure.
  - Columns: Name, Code, Status, Primary domain, Channel, Created (§11). Status filter.
  - *Default-value:* a freshly onboarded tenant shows exactly one `draft` store, seeded from organization metadata (§17 Phase 3) — there is no reachable "zero stores" state after setup.
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

### Epic C — Branding
*Screens: store edit → Branding tab, `GET .../preview-branding`*

- **US-C1.** As a Tenant Admin, I want to set my store's colors, fonts and corner radius, so that the storefront matches my brand without needing a developer.
  - *Default-value:* any unset field falls back to the documented DS default (§7.1 table) — the form shows those defaults pre-filled rather than blank inputs of unknown effective value.
  - *Error:* a colour outside OKLCH/hex, or a font outside the allowlist, is rejected with a field error at submit time — never escaped-and-saved (R4, §7.3).
  - *Permission:* `ecommerce.branding.manage` gates this tab's write actions independently of `ecommerce.stores.manage` — a Tenant Admin missing only this feature can view the tab but not submit it.
- **US-C2.** As a Tenant Admin, I want to preview my branding changes live before saving, so that I can iterate on look-and-feel without repeatedly persisting bad values.
  - The preview iframe applies validated values via `postMessage` and CSS custom properties (§11) — nothing is written until an explicit Save, so this is illustrative live feedback, not an optimistic write; the prototype must not imply the preview alone persists anything.

### Epic D — Domain bindings
*Screens: store edit → Domains tab*

- **US-D1.** As a Tenant Admin, I want to bind an already-verified domain (optionally with a path prefix) to my store, so that the store becomes reachable at that hostname.
  - *Business rule as a permission-like gate:* only `DomainMapping`s already `verified` in `customer_accounts` are selectable for immediate serving; picking an unverified one is allowed but renders an explicit warning that the store will not serve at that host yet (§11).
  - *Error:* a duplicate `(domain_mapping_id, path_prefix)` pair is rejected (unique constraint, §5.2); two bindings where one prefix is a proper prefix of the other are both allowed and resolve by longest-prefix match (R6) — the UI should not present that as a conflict.
- **US-D2.** As a Tenant Admin, I want to be told clearly when a bound domain's underlying `DomainMapping` has been deleted elsewhere (in `customer_accounts`), so that I understand why my store stopped serving instead of seeing an unexplained generic error.
  - *Error state (R3):* the Domains tab surfaces an explicit "domain removed" diagnostic for a dangling binding, with a link to the domain management screen in `customer_accounts` (read-only cross-module reference, never a direct edit surface).
- **US-D3.** As a Tenant Admin, I want to designate one binding as primary, so that canonical URLs are unambiguous when a store has several domains.
  - *Default-value:* at most one `is_primary = true` per store is enforced — setting a new primary implicitly and visibly un-sets the previous one.

### Epic E — Channel bindings and assortment
*Screens: store edit → Channels tab*

- **US-E1.** As a Tenant Admin, I want to bind a sales channel to my store, optionally overriding its price kind and narrowing its assortment by category/tag, so that I control what this store sells and at what prices.
  - The tab shows a live count of matching products for the current `assortment_scope` (§11).
  - *Empty:* when the channel's assortment scope and a buyer's group scope (set elsewhere, in `customer_groups`) intersect to nothing for a real buyer, that is surfaced to admins as a warning event (R7) rather than silently shown as a normal, if small, catalogue — the prototype should show this as a distinct alert state, not just a "0 products" count.
- **US-E2.** As a Tenant Admin, I want to be notified when my store has no default channel binding, so that I can fix a misconfiguration before it causes a `503` for real traffic (§6.2).
  - *Error:* an in-app admin notification (`notifications.ts`, §10) is the delivery mechanism — this is a proactive alert, not something the admin has to discover by hitting the storefront themselves.

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

- **Domains** lists bindings joined to their `DomainMapping`, surfacing verification status, last DNS check and any TLS failure reason **read-only**, with a link to the domain management screen in `customer_accounts`. Adding a binding picks from already-verified domains. A binding to an unverified domain renders a warning that the store will not serve at that host yet.
- **Channels** binds a `SalesChannel`, optionally overrides the price kind, and edits `assortment_scope` with a live count of matching products.
- **Branding** offers colour pickers, the font allowlist, a radius slider, logo and favicon upload, and a live preview.

**Branding live preview** renders a miniature storefront in an iframe. Values are pushed via `postMessage` and applied as CSS variables without saving. The preview iframe is `sandbox`ed and receives only validated values — it is the same injection boundary as §7.3.

All forms use `CrudForm` and derive the optimistic-lock header from `initialValues.updatedAt`.

---

## 12) Security

- Resolution yields exactly one tenant and organization; every downstream query is scoped by both. Cross-tenant exposure is structurally impossible via this path.
- Storefront product queries always enforce `deleted_at IS NULL` and `is_active = true` — restated here because spec 4 depends on it.
- Draft stores return `404` in production (§6.2); their existence is not disclosed.
- Unverified `DomainMapping` never serves, preventing a hostname from being claimed and served before DNS proves ownership.
- `?storeSlug=` is rejected outside development. It bypasses host resolution and would otherwise let anyone address any store on the deployment.
- Branding values are validated, not escaped, before reaching a `<style>` tag (§7.3).
- The public context endpoint returns a buyer **projection**, never group ids, price kind or assortment scope (§9.1).
- Authenticated responses are `private, no-store`. Anonymous responses are `public, max-age=60`.
- Public endpoint rate limit: 120 req/min per IP for `/context` (it is called on every storefront boot). Spec 4 sets limits for the heavier read endpoints.

---

## 13) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Buyer-context cache bleed | **Critical** | `ecommerce` | A cached response keyed without the digest serves an ACME contract price to an anonymous visitor, or to a competitor with an account on the same store. Confidential commercial terms disclosed. | `digest` is a required field of `StoreContext`; `buildStorefrontCacheKey` takes the context as a required argument so a key cannot be built without it; authenticated responses are `no-store`; cross-context isolation tests gate Phase 1; **structural CI guard** (§6.1) bans raw `cache` calls outside `lib/cacheKeys.ts`, so a bypass fails the build rather than relying on review alone | Low |
| R2 | Resolution latency on every request | **High** | `ecommerce` | Four sequential lookups per uncached request; the resolver becomes the platform's slowest middleware and every storefront route inherits it. | Steps 2–5 are one joined query (§8.1); 300s cache with tag invalidation; anonymous requests skip buyer resolution; a latency budget test asserts P95 under 15 ms uncached | Low |
| R3 | Divergent domain state | Medium | `ecommerce`, `customer_accounts` | An operator deletes a `DomainMapping`; the binding dangles and the store silently stops serving with no diagnostic. | Binding stores the FK id only and joins at read time; a deleted mapping surfaces as an explicit "domain removed" error state in admin, and the resolver logs a distinguishable error rather than a generic 404 | Low |
| R4 | Branding CSS injection | **High** | `ecommerce` | A tenant admin stores `red; } body { background: url(https://evil/) } :root {` as a colour; the emitted stylesheet exfiltrates via a background request, or defaces the store. | Zod refinement validates OKLCH/hex and rejects anything else; fonts come from an allowlist; the generated sheet is a fixed declaration set with validated values, never interpolated markup; fuzz test over malformed colour inputs | Low |
| R5 | Store `settings` blob drift | Medium | `ecommerce` | The JSONB grows into a dumping ground for other modules' configuration, as v3's `enableReviews`/`enableWishlist` already showed. | `settings` is Zod-validated with a closed schema; unknown keys are rejected on write; new configuration belongs to the owning module | Low |
| R6 | Multi-store host collision | Medium | `ecommerce` | Two bindings claim the same host with overlapping path prefixes; resolution becomes order-dependent. | Unique `(domain_mapping_id, path_prefix)`; longest-prefix match is the documented rule; a binding whose prefix is a proper prefix of another is allowed and resolves by longest match | Low |
| R7 | Assortment scope intersection surprises | Medium | `ecommerce`, `customer_groups` | A buyer's group scope and the channel scope intersect to the empty set; the storefront shows an empty catalogue with no explanation. | Intersection is the documented rule (§5.3); admin shows a live matching-product count per scope; an empty effective assortment for an authenticated buyer emits a warning event | Medium — the operator must act on the warning |
| R8 | Draft store probing | Low | `ecommerce` | v3's `403` for draft stores confirms existence to a prober. | Production returns `404`; `403` retained only in development where the signal is useful | Low |

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
- Verified `DomainMapping` + binding resolves host → store → tenant/org
- Unverified `DomainMapping` does not serve (404) even with a valid binding
- Deleted `DomainMapping` yields the distinguishable dangling-binding error, not a generic 404 (R3)
- Unknown host → 404 with no store details
- Draft store → 404 in production, 403 in development
- Archived store → 410
- Missing default channel binding → 503 plus admin notification
- Longest-prefix match with two bindings on one host (R6)
- `?storeSlug=` works in development and is rejected in production

**Buyer context:**
- Anonymous: no groups, channel price kind resolves, `taxMode` derived from that price kind's `displayMode` (falls back to `display.priceDisplayModeDefault` only if no price kind resolves at all)
- Authenticated B2B: groups priority-ordered, group price kind overriding the channel default, `taxMode` derived from the *resolved* (group-overridden) price kind's `displayMode` — not read from a stored per-buyer field
- A price kind whose `displayMode` disagrees with the buyer's expected mode (regression test for the fixed dual-source-of-truth defect) resolves to the price kind's mode, never a stale independent value
- Assortment scope is the intersection of channel and group scopes; empty intersection emits the warning event (R7)
- Two buyers in different groups on the same store produce different digests
- The same buyer across two locales produces different digests
- Membership change invalidates the buyer context within the TTL

**Cache isolation (Phase 1 gate):**
- An anonymous request following an authenticated one for the same URL never receives the authenticated body
- Two authenticated buyers in different groups never share a cache entry
- Authenticated responses carry `private, no-store`

**Branding:**
- Valid OKLCH and hex persist; malformed values are rejected with a field error
- Fuzz suite of injection payloads is rejected, never escaped-and-emitted (R4)
- Font outside the allowlist rejected
- SSR emits the stylesheet in `<head>`; no post-hydration style mutation
- Unknown keys in `settings` rejected on write (R5)

**API paths:** every route in §9, each asserting tenant isolation against a second-tenant fixture.

**Performance:** uncached resolution P95 under 15 ms with a seeded 50-store tenant (R2).

**UI paths:** store list with status filter, store create, general edit with optimistic-lock conflict, branding with live preview and rejection of a bad colour, domain binding against a verified and an unverified domain, channel binding with live assortment count, SEO tab.

---

## 17) Implementation Phases

### Phase 1 — Entities and resolution
Module scaffold, three entities, validators, migration, admin CRUD, `storeContext.ts` with the single joined query, `buyerContext.ts`, `cacheKeys.ts`, the public `/context` endpoint, cache and invalidation subscriber.

**Gate:** the cache-isolation suite passes; resolution P95 within budget; anonymous and authenticated B2B contexts differ correctly.

### Phase 2 — Branding
`brandingStyles.ts` with validation, SSR injection, `preview-branding` endpoint.

**Gate:** the injection fuzz suite is fully rejected; no FOUC in an SSR render test.

### Phase 3 — Admin UI
Store list and all five tabs, live preview, domain state surfaced read-only from `customer_accounts`, assortment-scope product count.

**Gate:** UI paths in §16 pass, including the optimistic-lock conflict path.

`setup.ts` seeds one `draft` store per tenant from organization metadata (name, locale, currency) so a fresh tenant has something to configure rather than an empty screen.

---

## 18) Migration Path

- Additive throughout. No existing admin or product API changes.
- The module is opt-in via `modules.ts`; tenants not selling are unaffected.
- Existing deployments get a `draft` store seeded from organization metadata; nothing serves publicly until an operator binds a verified domain and activates.
- No data migration. `EcommerceStoreDomain` from v3 was never implemented, so its replacement by `EcommerceStoreDomainBinding` is a spec change, not a schema change — no deprecation protocol is triggered.

---

## 19) Open Questions

Resolved since v3:

1. ~~Customer account model~~ — `customer_accounts` (`CustomerUser`, portal sessions), already implemented.
2. ~~Payment providers~~ — spec 7; `payment_gateways` with `gateway-stripe` shipped.
3. ~~Inventory policy at browse vs. checkout~~ — [Availability Contract](./2026-08-14-availability-contract.md) §7: advisory at browse, authoritative at submit.
4. ~~Search backend~~ — spec 4.
5. ~~Multi-store per organization~~ — supported from Phase 1; `is_primary` marks the default, and host+path binding makes several stores per host possible.

Open:

6. **SEO sitemap** — auto-generated `sitemap.xml` and `robots.txt` per store. Belongs to spec 4 or spec 10; `settings.seo.robotsTxt` reserves the configuration.
7. **Store-level UI label translation** — v3 noted `EcommerceStore` as a future translatable entity. Whether per-store copy overrides go through the `translations` module or `settings` is unresolved; spec 8 (merchandising) is the natural owner.

---

## 20) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `domain_mapping_id`, `sales_channel_id`, `price_kind_id` are FK ids; groups and terms via `customerGroupsService` |
| Tenant/organization scoping | Resolution yields exactly one of each; every test asserts isolation |
| Never expose cross-tenant data | §12; cache isolation is a Phase 1 gate |
| Zod validation | All routes and the `settings` blob with a closed schema |
| No `any` | Service contract and settings fully typed |
| Optimistic locking | All three entities expose `updatedAt`; admin forms use `CrudForm`; no `version` counter (verified this document does not repeat the sibling customer-groups spec's original mistake) |
| Encryption | `settings.contact` (email/phone/address) is the store's own public business contact info shown on the storefront, not personal customer data — same category as `sales.SalesChannel`'s plaintext contact fields; no field encryption |
| Cache safety / structural guard | §6.1 — R1's mitigation includes a CI-enforced structural test, not review discipline alone, registered in `scripts/repo-wide-guards.mjs` |
| Cross-module data derivation | `taxMode` is derived from `catalog.CatalogPriceKind.displayMode` at resolution time, never stored as an independent field — §6.1a (fixed 2026-08-17) |
| i18n | No hard-coded strings; `en.json`, `pl.json` |
| Design system | Admin UI uses `@open-mercato/ui` primitives and semantic tokens; no hardcoded status colours |
| Backward compatibility | Additive; the withdrawn v3 scope was never implemented (independently verified: zero matches for `EcommerceStoreDomain`, `ecommerce.checkout.manage`, `ecommerce.orders.view`, `ecommerce.storefront.*` anywhere in this repo), so no contract surface is broken and no deprecation protocol applies |
| Migrations | `yarn db:generate`, snapshot reviewed |
| Integration coverage | §16, shipping in the same change |

---

## 21) Changelog

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
