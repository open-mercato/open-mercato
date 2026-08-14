# Ecommerce Suite — Module Roadmap & Boundaries

| Field | Value |
|-------|-------|
| **Status** | Specification (umbrella) |
| **Created** | 2026-08-14 |
| **Type** | Roadmap / architecture decision record |
| **Supersedes scope of** | [SPEC-029](./SPEC-029-2026-02-17-ecommerce-storefront-module.md) §14–19 |
| **Related** | [SPEC-055 Promotions](./SPEC-055-2026-02-23-promotions-module.md), [Simple Checkout](./2026-03-19-checkout-simple-checkout.md), [Pay Links](./implemented/2026-03-19-checkout-pay-links.md), [SPEC-026 Catalog Localization](./implemented/SPEC-026-2026-02-11-catalog-localization.md), [WMS Roadmap](./2026-04-15-wms-roadmap.md), [SPEC-071 SEO Helper](./SPEC-071-2026-04-06-seo-helper-validation-visibility.md) |

---

## TLDR

**Key Points:**
- Open Mercato has the back-office half of commerce (`catalog`, `sales`, `wms`, `payment_gateways`, `shipping_carriers`, `customers`, `customer_accounts`) but no selling channel. SPEC-029 tried to close the gap with one 1892-line spec covering a backend module, a public API, a checkout state machine and a complete Next.js application at once.
- This roadmap replaces that monolith with **nine scoped specs across six new modules**, fixes the ownership boundaries between them, and records the architecture decisions that the individual specs must not re-litigate.
- The load-bearing correction: **the cart is a first-class, channel-agnostic module** (`cart`), not a status on a checkout session. Storefront, POS, pay links and AI agents all mutate the same cart contract; checkout consumes a cart and turns it into a `SalesOrder`.
- **B2B is in scope from v1.** Catalog pricing already resolves `customer_id` / `customer_group_id` / quantity tiers / validity windows — the missing pieces are the `CustomerGroup` entity itself (today a dangling UUID column), credit limits, and buyer approval flow.

**Scope:**
- Module inventory, ownership boundaries and dependency direction for the ecommerce suite
- Nine specs: what each owns, what it must not own, and in which order they land
- Eight architecture decisions (ADR-1 … ADR-8) binding on every downstream spec
- Phasing with explicit gating criteria

**Concerns:**
- `customer_group_id` is referenced by `catalog` pricing and `sales` tax rates with no owning table — every B2B feature is blocked on closing that first
- Two competing checkout models exist (SPEC-029 §19 vs. the `@open-mercato/checkout` package); one must be retired explicitly, not left to drift
- Cart totals must flow through `salesCalculationService` or storefront and back-office will disagree on tax, which is a correctness bug, not a cosmetic one

---

## 1) Overview

This is an umbrella specification. It contains no implementable work of its own. It defines the module set that constitutes Open Mercato's ecommerce capability, assigns ownership of every domain concept to exactly one module, fixes the dependency direction between them, and sequences the child specs.

Every child spec in the suite MUST conform to the decisions recorded in §5. A child spec that needs to deviate MUST amend this document first.

---

## 2) Problem Statement

### 2.1 The capability gap

The platform sells nothing. There is no public channel through which a customer can browse an assortment, assemble an order and pay for it. Each of the pieces required to build such a channel exists, but nothing composes them:

| Capability | Owner today | Usable by a storefront? |
|---|---|---|
| Products, variants, categories, option schemas | `catalog` | Yes, via internal APIs only |
| Price resolution incl. customer/group/quantity scoping | `catalog/lib/pricing.ts` | Yes, but no public contract |
| Orders, quotes, tax rates, shipping & payment methods, totals | `sales` | Yes, via commands |
| Stock balances and reservations | `wms` | No availability contract exposed |
| Customer identity for a public visitor | `customer_accounts` | Yes (`CustomerUser`, portal sessions) |
| Domain → tenant routing | `customer_accounts.DomainMapping` | Yes |
| Payment execution | `payment_gateways`, `gateway-stripe` | Yes |
| Assembling a basket | — | **Nothing owns this** |
| Discount evaluation | — | **Spec only** (SPEC-055) |
| Store configuration & branding | — | **Spec only** (SPEC-029) |

### 2.2 Why SPEC-029 cannot be implemented as written

SPEC-029 is a good design document and a bad unit of work.

1. **It spans four deliverables in one document** — a backend module (§6–7, §13), a public API surface (§9, §12), a checkout state machine (§19), and a complete Next.js application including its design system, WCAG compliance and responsive strategy (§14–18). These have different reviewers, different risk profiles and different release cadences.
2. **It models the cart as a checkout session status** (§7.4: *"The checkout session is also the cart. There is no separate cart entity."*). This makes the basket a property of one channel's funnel. POS (SPEC-022), pay links (`@open-mercato/checkout`) and AI purchasing agents each need a basket, and under this model each must either invent its own or borrow the storefront's checkout entity.
3. **It collides with a shipped package.** `@open-mercato/checkout` Phase A is implemented (`CheckoutLinkTemplate`, `CheckoutLink`, `CheckoutTransaction`); Phase B specifies `CheckoutCartItem` plus quote→order conversion. SPEC-029 §19 specifies a parallel session→order path via `workflows`. Two checkout models, both unimplemented past Phase A, both claiming order creation.
4. **It duplicates domain lifecycle management.** `EcommerceStoreDomain` (§7.2) proposes `tls_mode` and `verification_status` alongside the existing `customer_accounts.DomainMapping`, which already carries provider, DNS verification state, TLS failure reasons, retry counters and supersession chains.
5. **It invents availability from nothing.** `availability: 'in_stock' | 'out_of_stock' | 'backorder'` appears in three payload types (§8.4, §8.5, §9.1) with no stated source. `wms` owns `InventoryBalance` and `InventoryReservation`; no contract connects them.
6. **It has no promotions integration**, while SPEC-055 is written against a `cart` module that does not exist and that SPEC-029 does not create.
7. **It is B2C-shaped.** No customer-contract pricing, no quantity break UI, no purchase-on-account, no buyer approval — despite `catalog` already resolving customer-scoped prices.

---

## 3) Module Inventory

### 3.1 New modules

All new modules live in `packages/core/src/modules/<module>/` and follow the standard module layout.

| Module | Owns | Must not own |
|---|---|---|
| `ecommerce` | Store definition, hostname→store binding, sales-channel binding, buyer-context resolution, branding, public read API surface | Cart state, checkout funnel, order creation, product domain model |
| `cart` | `Cart`, `CartLine`, line pricing snapshots, totals, promotion effect application, TTL and abandonment, guest→customer merge | Addresses, shipping selection, payment, order creation, product domain model |
| `promotions` | Promotion rule tree, benefits, codes, usage ledger, evaluation engine | Cart mutation, totals arithmetic, order creation |
| `customer_groups` | `CustomerGroup`, group membership, group-scoped commercial terms, credit limit and exposure, buyer approval policy | Price rows (owned by `catalog`), tax rates (owned by `sales`) |
| `merchandising` | Storefront navigation menus, homepage/landing blocks, banners, category enrichment, curated product sets, cross/upsell rules | Product domain model, CMS pages (owned by `content`) |
| `availability` | The `availabilityService` DI contract and its catalog-only fallback implementation | Stock movements, lots, reservations (owned by `wms`) |

### 3.2 Extended existing modules

| Module | Extension |
|---|---|
| `@open-mercato/checkout` | Becomes the single checkout funnel for every channel, consuming a `cart` rather than owning line items |
| `customer_accounts` | Storefront-facing account area: order history, address book, saved carts, wishlist, B2B buyer roster |
| `wms` | Registers the concrete `availabilityService` implementation backed by `InventoryBalance` / `InventoryReservation` |
| `catalog` | Admin UI for customer/group/quantity-scoped price rows (the data model already supports them) |
| `sales` | Order creation entrypoint used by checkout; purchase-on-account payment method |

### 3.3 New application

| App | Purpose |
|---|---|
| `apps/storefront` | Reference Next.js storefront consuming only the public `ecommerce` API surface |

---

## 4) Dependency Direction

```
                          apps/storefront
                                 │  (HTTP only, public API)
                                 ▼
                          ┌─────────────┐
                          │  ecommerce  │  store context, public read API
                          └──┬───┬───┬──┘
             ┌───────────────┘   │   └──────────────┐
             ▼                   ▼                  ▼
      ┌────────────┐      ┌──────────────┐   ┌──────────────┐
      │ catalog    │      │ merchandising│   │ availability │
      │ (products, │      │ (nav, blocks)│   │  (contract)  │
      │  pricing)  │      └──────────────┘   └──────┬───────┘
      └────────────┘                                │ implemented by
                                                    ▼
                                                 ┌─────┐
                                                 │ wms │
                                                 └─────┘

                          ┌──────┐
                          │ cart │◄──── storefront, POS, pay links, AI agents
                          └──┬───┘
             ┌───────────────┼────────────────┬─────────────────┐
             ▼               ▼                ▼                 ▼
      ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────────┐
      │ catalog    │  │ promotions │  │ availability │  │    sales     │
      │ (pricing)  │  │ (effects)  │  │  (ATP check) │  │ (calculation)│
      └────────────┘  └────────────┘  └──────────────┘  └──────────────┘

                        ┌──────────┐
                        │ checkout │  addresses, delivery, payment, submit
                        └────┬─────┘
                             ├──► cart      (reads and locks a cart)
                             ├──► sales     (creates SalesOrder / SalesQuote)
                             ├──► shipping_carriers  (rate quoting)
                             └──► payment_gateways   (payment intent)

                     ┌──────────────────┐
                     │ customer_groups  │◄── catalog pricing, sales tax rates,
                     └──────────────────┘    cart, checkout, customer_accounts
```

**Rules:**
- Arrows are one-directional. `catalog` MUST NOT know about `cart`; `cart` MUST NOT know about `checkout`.
- Every cross-module edge is an FK id plus a DI-resolved service call. No cross-module ORM relations (root `AGENTS.md`).
- `ecommerce` never mutates. Every write path in the suite goes through `cart` or `checkout`.

---

## 5) Architecture Decisions

### ADR-1 — The cart is a module, not a checkout status

**Decision.** `cart` owns `Cart` and `CartLine` as first-class entities. A cart is identified by an opaque token, is channel-tagged, and outlives any single funnel.

**Rationale.** Four channels need a basket: storefront, POS (SPEC-022), pay links, and AI purchasing agents (`catalog` already ships mutation-approval tooling). A basket bound to a checkout entity forces three of them to duplicate line management, price snapshotting and promotion evaluation.

**Consequence.** SPEC-029 §7.4 `EcommerceCheckoutSession.line_snapshot` is withdrawn. Checkout holds `cart_id`, not lines.

**Rejected alternative.** Cart-as-session (SPEC-029 as written) — simpler by one entity, but pushes basket logic into every channel. Also rejected: extending `CheckoutCartItem` from the pay-links package, because that model was shaped by merchant-defined static link contents, not shopper-mutable baskets.

---

### ADR-2 — `cart` never computes tax or totals itself

**Decision.** `cart` resolves unit prices via `catalogPricingService`, resolves discounts via `promotionsService`, and then delegates all totalling — tax, rounding, adjustments, currency — to `salesCalculationService`.

**Rationale.** A storefront total that disagrees with the order it produces is a correctness defect with financial and legal consequences (invoice mismatch, Omnibus disclosure, VAT). `sales` already owns `SalesTaxRate` and the calculation service used by every back-office document.

**Consequence.** `cart` depends on `sales` for calculation. This is the one place where a read-side module depends on the transactional core; it is deliberate and must not be worked around by reimplementing arithmetic.

---

### ADR-3 — Checkout is one funnel, owned by `@open-mercato/checkout`

**Decision.** The `@open-mercato/checkout` package is the sole owner of the checkout funnel for all channels. SPEC-029 §19 (workflow-driven `EcommerceCheckoutSession`) is withdrawn. The Simple Checkout spec is rewritten to consume a `cart` instead of defining `CheckoutCartItem`.

**Rationale.** Two unimplemented checkout models both claiming order creation is a guaranteed divergence. Pay links Phase A already ships in this package with a working transaction and payment-callback path; that is the code with production evidence.

**Consequence.** A checkout session references `cart_id`. Locking a cart for checkout is a `cart` state transition requested by `checkout`, not a status owned by `checkout`.

**Open point for the child spec.** Whether the funnel's step machine uses the `workflows` module (SPEC-029's proposal, giving configurable per-store checkout steps) or a fixed state machine. Configurability has real B2B value (approval steps, PO number capture); the child spec decides and justifies.

---

### ADR-4 — Availability is a contract, `wms` is one implementation

**Decision.** A thin `availability` module declares `availabilityService` in DI:

```typescript
type AvailabilityQuery = {
  items: Array<{ productId: string; variantId?: string | null; quantity: number }>
  channelId?: string | null
  locationIds?: string[] | null
}

type AvailabilityResult = {
  byItem: Record<string, {
    state: 'in_stock' | 'low_stock' | 'out_of_stock' | 'backorder' | 'preorder'
    availableQuantity: number | null   // null = not tracked
    leadTimeDays: number | null
    canFulfil: boolean
  }>
}
```

`wms` registers the authoritative implementation (`InventoryBalance` minus open `InventoryReservation`). The `availability` module itself ships a catalog-only fallback that reports `not tracked` so a storefront works without `wms` installed.

**Rationale.** Storefront and cart must not query WMS entities directly — that would be a hard dependency on a module many tenants do not run, and a cross-module ORM coupling.

**Consequence.** SPEC-029's three inline `availability` unions are replaced by this contract's `state`. `low_stock` and `preorder` are added; the storefront needs them and they cost nothing now.

---

### ADR-5 — `ecommerce` binds hostnames, `customer_accounts` owns them

**Decision.** SPEC-029's `EcommerceStoreDomain` is reduced to a binding row (`store_id`, `domain_mapping_id`, `is_primary`, `path_prefix`). DNS verification, TLS provisioning, provider selection and supersession stay in `customer_accounts.DomainMapping`.

**Rationale.** `DomainMapping` already implements the hard part — provider abstraction (`traefik`), `verified_at`, `last_dns_check_at`, `dns_failure_reason`, `tls_failure_reason`, `tls_retry_count`, `replaces_domain_id`. Reimplementing a subset in `ecommerce` guarantees two divergent verification state machines.

**Consequence.** Store resolution is a two-hop lookup: hostname → `DomainMapping` (tenant/org) → store binding → `EcommerceStore`. The child spec must specify the cache and invalidation for this hop.

---

### ADR-6 — `CustomerGroup` is a real entity, and it is a prerequisite

**Decision.** A `customer_groups` module introduces `CustomerGroup` and `CustomerGroupMembership`, and becomes the owner of the `customer_group_id` UUID that `catalog` and `sales` already reference.

**Rationale.** `customer_group_id` is consumed today by `catalog/lib/pricing.ts` (specificity score +3), `catalog/api/prices`, `catalog/commands/prices.ts`, `catalog` AI price tooling and `SalesTaxRate` — with no table behind it. Every B2B feature in this suite (contract pricing, group tax treatment, credit terms, assortment scoping) resolves through this id. It is the first thing that must land.

**Consequence.** This module ships before `cart`. Backward compatibility: the column stays a plain UUID with no FK constraint added in the first release, so existing rows carrying arbitrary ids keep working; a reconciliation report lists orphans. Adding the constraint is a later, separately-specified migration.

**Scope note.** Credit limit, credit exposure, payment terms and approval policy attach to the group and to `CustomerEntity`. `CustomerCompanyBilling` already carries `payment_terms` and is extended rather than replaced.

---

### ADR-7 — Buyer context is resolved once, at the edge

**Decision.** `ecommerce.storeContext.resolve(request)` returns a `BuyerContext` alongside the store, and every downstream price, tax, assortment and availability call takes it as input:

```typescript
type BuyerContext = {
  customerUserId: string | null      // customer_accounts.CustomerUser
  customerId: string | null          // customers.CustomerEntity
  customerGroupIds: string[]         // customer_groups
  companyId: string | null           // customers.CustomerCompanyProfile
  channelId: string | null           // sales.SalesChannel
  priceKindId: string | null         // catalog.CatalogPriceKind
  currencyCode: string
  locale: string
  taxMode: 'gross' | 'net'           // B2C shows gross, B2B typically net
  purchaseOnAccount: boolean
}
```

**Rationale.** B2C and B2B differ in *context*, not in code path. Resolving once at the edge means one place to test tenant isolation, and no module re-deriving "is this a B2B buyer" from partial signals.

**Consequence.** Public read endpoints are no longer purely anonymous — an authenticated B2B session changes prices and assortment. Caching keys MUST include the buyer-context digest, and responses for authenticated contexts MUST be marked private. This is a security-relevant requirement, called out in every child spec's risk section.

**Rejected alternative.** Separate `/api/ecommerce/b2b/*` endpoints. Doubles the API surface and the test matrix for what is one resolver difference.

---

### ADR-8 — The storefront shares tokens, not components

**Decision.** `apps/storefront` MUST NOT depend on `@open-mercato/core`. It MAY depend on a new, deliberately small `@open-mercato/storefront-ui` package holding the design tokens and the primitives the storefront actually needs.

**Rationale.** SPEC-029 §14.2 forbids all shared UI, which means reimplementing Button, Badge, Sheet, Dialog, Spinner and their accessibility behaviour a second time. Two independently-maintained accessible dialog implementations is how WCAG regressions ship. The genuine requirement is that the storefront must not pull the back-office bundle — not that it must share no code.

**Consequence.** `@open-mercato/storefront-ui` has a hard size and dependency budget enforced in CI, and MUST NOT import from `@open-mercato/ui`.

---

## 6) Spec Breakdown

| # | Spec | Status | Module(s) | Depends on |
|---|---|---|---|---|
| 1 | `2026-08-14-customer-groups-and-b2b-terms.md` | to write | `customer_groups`, `customers`, `catalog` (admin UI) | — |
| 2 | `2026-08-14-availability-contract.md` | to write | `availability`, `wms` | — |
| 3 | SPEC-029 (rewritten, slimmed) | to rewrite | `ecommerce` | 1 |
| 4 | `2026-08-14-storefront-public-api.md` | to write | `ecommerce` | 1, 2, 3 |
| 5 | `2026-08-14-cart-module.md` | to write | `cart` | 1, 2 |
| 6 | SPEC-055 Promotions (amended) | to amend | `promotions` | 5 |
| 7 | `2026-03-19-checkout-simple-checkout.md` (rewritten) | to rewrite | `@open-mercato/checkout` | 5 |
| 8 | `2026-08-14-storefront-merchandising.md` | to write | `merchandising` | 3, 4 |
| 9 | `2026-08-14-storefront-customer-account.md` | to write | `customer_accounts` | 1, 5, 7 |
| 10 | `2026-08-14-storefront-app.md` | to write | `apps/storefront`, `@open-mercato/storefront-ui` | 4, 5, 7, 8 |

### 6.1 What each spec must contain beyond the standard checklist

| Spec | Non-obvious required content |
|---|---|
| 1 — Customer groups | Migration strategy for orphaned `customer_group_id` values; credit exposure calculation and its concurrency guarantee; approval policy model |
| 2 — Availability | Fallback semantics when `wms` is absent; caching and staleness budget; the oversell window and who owns it |
| 3 — `ecommerce` | Two-hop hostname resolution and its cache invalidation; `BuyerContext` resolver; branding SSR without FOUC |
| 4 — Public API | Buyer-context cache-key digest and private-response rules; facet cross-exclusion cost; rate limiting for unauthenticated traffic |
| 5 — Cart | Price snapshot staleness policy and re-pricing triggers; guest→customer merge conflict rules; optimistic locking; TTL and abandonment events; B2B quantity-break re-evaluation |
| 6 — Promotions | Realignment of the cart interaction API to the actual `cart` contract; code reservation under the cart's locking model |
| 7 — Checkout | Retirement path for `CheckoutCartItem`; cart lock/unlock protocol; quote-vs-order branch for B2B; purchase-on-account against credit limit; idempotency of submit |
| 8 — Merchandising | Boundary against `content` module pages; per-store vs. per-channel scoping; publishing and scheduling |
| 9 — Customer account | B2B buyer roster and approvals in the portal; order history sourced from `sales` without cross-module ORM relations |
| 10 — Storefront app | `@open-mercato/storefront-ui` budget and CI enforcement; WCAG 2.2 AA evidence; RWD; performance targets |

Specs 3, 6 and 7 are rewrites/amendments of existing documents. Per `.ai/specs/AGENTS.md`, their filenames are left unchanged — renaming legacy `SPEC-*` files is a separate, explicitly-requested normalization.

---

## 7) Phasing

Each phase is gated: the next does not start until the gate passes.

### Phase 0 — Foundations
Specs 1 and 2. Delivers `CustomerGroup` with membership and commercial terms, and the `availabilityService` contract with the `wms` implementation.

**Gate:** `catalog` price rows can be authored against a real group in admin UI and resolve correctly; `availabilityService` returns authoritative state with `wms` installed and a clean `not tracked` fallback without it.

### Phase 1 — Read side
Specs 3 and 4. Store, hostname binding, buyer-context resolver, branding, and the public catalog read API with facets and localization.

**Gate:** an anonymous request and an authenticated B2B request to the same product URL return correctly different prices, with no cross-tenant leakage and no cache bleed between buyer contexts.

### Phase 2 — Write side
Specs 5 and 6. Cart with line management, price snapshots, promotion effects and `salesCalculationService` totals.

**Gate:** cart totals are byte-identical to the totals of the `SalesOrder` the same cart produces; promotions apply identically on the product page and in the cart.

### Phase 3 — Conversion
Spec 7. Checkout funnel: addresses, delivery selection with live rates, payment, order or quote creation, purchase-on-account.

**Gate:** end-to-end B2C purchase and B2B purchase-on-account both produce correct `SalesOrder` documents; submit is idempotent under retry and concurrent double-submit.

### Phase 4 — Experience
Specs 8, 9 and 10. Merchandising, customer account area, and the storefront application.

**Gate:** WCAG 2.2 AA audit passes; performance targets met; integration tests cover every API path and key UI path per `.ai/qa/AGENTS.md`.

---

## 8) Data Models

This umbrella defines no entities. It fixes ownership only:

| Concept | Owning module | Table prefix |
|---|---|---|
| Store, hostname binding, channel binding | `ecommerce` | `ecommerce_` |
| Cart, cart line | `cart` | `cart_` |
| Promotion, rule, benefit, code, usage | `promotions` | `promotion_` |
| Customer group, membership, commercial terms | `customer_groups` | `customer_group_` |
| Navigation, blocks, banners, curated sets | `merchandising` | `merchandising_` |
| Checkout session | `@open-mercato/checkout` | `checkout_` |

No entity may be introduced in a child spec under a prefix owned by another module.

---

## 9) API Contracts

This umbrella defines no endpoints. It fixes the namespaces:

| Namespace | Auth | Owner |
|---|---|---|
| `/api/ecommerce/storefront/*` | Public + optional buyer session | `ecommerce` |
| `/api/ecommerce/*` | `requireAuth`, `ecommerce.*` features | `ecommerce` |
| `/api/cart/*` | Public + optional buyer session, cart-token bound | `cart` |
| `/api/checkout/*` | Public + optional buyer session, session bound | `@open-mercato/checkout` |
| `/api/customer-groups/*` | `requireAuth` | `customer_groups` |
| `/api/merchandising/*` | Admin `requireAuth`; read mirror under storefront namespace | `merchandising` |

Every public namespace MUST be rate limited and MUST include the buyer-context digest in its cache key.

---

## 10) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Buyer-context cache bleed | **Critical** | `ecommerce`, `cart` | A B2B contract price or restricted assortment is cached under a key omitting the buyer digest and served to an anonymous visitor or a different customer. Confidential pricing disclosed cross-tenant. | Cache key MUST include a digest of `BuyerContext`; authenticated responses marked `Cache-Control: private`; dedicated cross-context isolation tests are a Phase 1 gate criterion | Low — enforced by test, but a new cached endpoint could forget the digest; mitigated by a shared cache-key helper that takes `BuyerContext` as a required argument |
| R2 | Cart/order total divergence | **High** | `cart`, `sales` | Cart computes tax independently and shows 123,00 zł; the resulting invoice says 123,45 zł. Legal exposure under consumer pricing rules and Omnibus. | ADR-2 mandates `salesCalculationService`; Phase 2 gate requires byte-identical totals; property-based test over the tax matrix | Low |
| R3 | Orphaned `customer_group_id` values | Medium | `catalog`, `sales` | Existing price rows and tax rates reference group ids with no group. After `CustomerGroup` lands, those rows silently never match, changing effective prices. | No FK constraint in the first release; reconciliation report enumerating orphans; admin surfaces unknown-group rows as invalid rather than hiding them | Medium — depends on tenants acting on the report |
| R4 | Two checkout models diverge | **High** | `checkout`, `ecommerce` | SPEC-029 §19 is implemented by one team while Simple Checkout is implemented by another; two order-creation paths with different idempotency guarantees produce duplicate orders. | ADR-3 withdraws §19 explicitly; the SPEC-029 rewrite must state the withdrawal in its changelog | Low |
| R5 | Oversell between browse and submit | Medium | `availability`, `cart`, `wms` | Availability is read without reservation; two buyers check out the last unit concurrently. | Availability at browse time is advisory; the authoritative check plus reservation happens at checkout submit inside the order transaction; the child specs define the reservation window | Medium — inherent to non-reserving carts; accepted, and the oversell window must be documented, not hidden |
| R6 | Credit limit overshoot | **High** | `customer_groups`, `checkout` | Concurrent purchase-on-account orders each pass an optimistic credit check and jointly exceed the limit. | Credit exposure update inside a serializable transaction at submit, mirroring SPEC-055's budget-cap approach | Low |
| R7 | Suite scope exceeds delivery capacity | Medium | all | Ten specs, six new modules. Partial delivery leaves a storefront that browses but cannot sell. | Phase gating; Phases 0–3 are the minimum shippable set; Phase 4 spec 10 can slip without invalidating the API contract | Medium |
| R8 | `packages/core` bundle growth | Low | `core` | Six new modules in core means every tenant, including non-commerce ones, carries them. | Modules are opt-in via `modules.ts`; measure and report bundle delta at each phase gate | Low — revisit as a package split if the delta is material |

---

## 11) Open Questions

1. **Checkout step machine** — `workflows`-driven (configurable per store, supports B2B approval steps) or a fixed state machine (simpler, testable)? Decided in spec 7. *Leaning: `workflows`, because B2B approval and PO capture are per-tenant policy.*
2. **Guest B2B** — can an unauthenticated visitor purchase on account? *Assumed no; purchase-on-account requires an authenticated `CustomerUser` linked to a company.*
3. **Multi-store carts** — is a cart scoped to one store, or shared across stores in an organization? *Assumed scoped to one store; cross-store baskets have no stated requirement.*
4. **Assortment scoping source** — SPEC-029's `catalog_scope` JSONB on the channel binding, or group-based assortment rules in `customer_groups`? Both have B2B use. Decided in spec 3.
5. **`merchandising` vs `content`** — where does a category landing page with editorial copy live? Decided in spec 8.

---

## 12) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | Enforced by §4; every edge is FK id + DI service |
| Tenant/organization scoping | Every new entity carries `tenant_id` + `organization_id`; R1 covers the cache dimension |
| No new `SPEC-*` filename prefixes | New specs use `{YYYY-MM-DD}-{kebab-case}`; legacy names left unchanged per `.ai/specs/AGENTS.md` |
| Backward compatibility | ADR-6 adds no FK constraint in the first release; ADR-3 and ADR-5 withdraw unimplemented spec scope, not shipped contracts, so no deprecation protocol is triggered |
| Optimistic locking | Required on `Cart` (spec 5) and every user-editable new entity, per root `AGENTS.md` |
| Integration coverage | Each child spec must list coverage for all affected API paths and key UI paths, shipping in the same change |
| Instruction budget | This document lives in `.ai/specs/`, not `AGENTS.md`; no budget impact |

---

## 13) Changelog

### 2026-08-14
- Initial umbrella specification.
- Recorded ADR-1 … ADR-8 following an architecture review of SPEC-029 against the implemented codebase.
- Findings driving the decisions: `CatalogProductPrice` already carries `customer_id`, `customer_group_id`, `user_id`, `user_group_id`, `channel_id`, quantity bounds and validity windows, and `catalog/lib/pricing.ts` already scores them by specificity — B2B pricing needs no new price model; `customer_group_id` has no owning table anywhere in the repo despite being consumed by `catalog` pricing/API/commands/AI tooling and `sales.SalesTaxRate`; `customer_accounts.DomainMapping` already implements domain verification and TLS lifecycle that SPEC-029 proposed to duplicate; `wms` already owns `InventoryBalance` and `InventoryReservation` with no availability contract exposed.
