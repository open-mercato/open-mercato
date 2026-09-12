# Storefront Customer Account

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 2 — pre-implementation fixes 2026-08-17) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 9, Phase 4 |
| **Modules** | `customer_accounts` (extended), `portal` (extended) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Cart Module](./2026-08-14-cart-module.md), [Checkout Funnel](./2026-03-19-checkout-simple-checkout.md), [Availability Contract](./2026-08-14-availability-contract.md) |

---

## TLDR

**Key Points:**
- The buyer-facing account area: order history, addresses, saved carts and reorder, wishlist, back-in-stock alerts — plus a B2B half that is the real differentiator: a company buyer roster, an approvals inbox, credit exposure, PO history and quote acceptance.
- It extends `customer_accounts`, which already ships `CustomerUser`, `CustomerRole`, `CustomerRoleAcl`, `CustomerUserAcl`, sessions, invitations and password reset. Identity, authentication and portal ACL are **solved** — this spec adds commerce surfaces on top, not a second identity model.
- Order history reads `sales` **through the query engine, never an ORM relation**. `customer_accounts` must not import `SalesOrder`.
- The sharpest risk is authorization, not features: a B2B buyer must see their company's orders but not their colleague's salary-sensitive negotiated terms, and an ex-employee's revoked access must actually revoke.

**Scope:**
- Order and quote history, order detail, reorder, document downloads
- Address book over `customers.CustomerAddress`
- Saved carts, wishlist, back-in-stock subscriptions
- B2B: buyer roster with roles, approvals inbox, credit overview, PO history, quote acceptance
- Portal navigation and page registration

**Concerns:**
- "Which orders may this user see" is a per-tenant policy question with no single right answer, and getting it wrong either hides a buyer's own orders or discloses a colleague's
- Reorder is a trap: prices, availability and even product existence change between the original order and the reorder, and a silent partial reorder is worse than a refusal
- Wishlist and back-in-stock subscriptions are a GDPR surface — they are behavioural data tied to an identified person

---

## 1) Overview

Everything before this spec sells to a buyer once. This one keeps them: it is where a returning customer finds what they ordered, reorders it, and — for B2B — where a company actually operates, because a wholesale buyer spends far more time in the account area than on the catalogue.

The module boundary is narrow. `customer_accounts` already owns identity, sessions and portal ACL, and `portal` already owns the shell, navigation and widget system. This spec adds commerce-specific pages, a small number of entities that nothing else owns, and one genuinely hard piece of policy: B2B visibility.

---

## 2) Problem Statement

### 2.1 No post-purchase surface

After checkout the buyer receives a confirmation and has nowhere to go. No order history, no way to track a shipment, no invoice download, no reorder. Every one of these becomes a support email.

### 2.2 B2B operates through the account area

Consumer commerce treats the account as an afterthought. B2B does not. A wholesale buyer needs to see what their company ordered (not only what they personally ordered), approve a junior colleague's basket, check how much of the credit line is left before committing, find the PO number for a delivery in dispute, and accept a quote the merchant negotiated. None of this exists, and none of it is optional for a B2B storefront.

### 2.3 Visibility policy is undefined and consequential

`customers` models companies (`CustomerCompanyProfile`), people (`CustomerPersonProfile`), their links (`CustomerPersonCompanyLink`, `CustomerPersonCompanyRole`) and roles on entities (`CustomerEntityRole`). `customer_accounts` models portal login (`CustomerUser`) with roles and per-user ACL. What no layer states is which orders a given `CustomerUser` may read. Defaulting to "everything for the company" discloses colleagues' orders; defaulting to "only my own" makes an approver unable to do their job.

### 2.4 Reorder is not "add these lines again"

Between an order and its reorder a product may be discontinued, renamed, repriced, out of stock, or outside the buyer's current assortment. A reorder that silently drops two of eight lines produces a wrong order the buyer believes is right.

---

## 3) Architecture

```
        portal (shell, nav, auth guards)          ← existing
              │
              ▼
   customer_accounts  ← existing: CustomerUser, CustomerRole,
              │          CustomerRoleAcl, CustomerUserAcl, sessions,
              │          invitations, password reset, DomainMapping
              │
              ├── NEW: account pages + these entities
              │        CustomerWishlist / Item
              │        CustomerSavedCart
              │        CustomerBackInStockSubscription
              │        CustomerOrderVisibilityPolicy
              │
              └── reads, never relates:
                   sales             → orders, quotes, invoices, shipments (query engine)
                   cart              → saved carts, reorder (cartService)
                   customers         → CustomerAddress, company links, roles
                   customer_groups   → terms, credit, approvals
                   availability      → back-in-stock triggers
                   ecommerce         → store context and buyer context
```

**No entity in this module has an ORM relation to `sales`.** Order history is a query-engine read filtered by the visibility policy, returning a projection. Importing `SalesOrder` would couple the portal to the transactional core and violate the module boundary.

---

## 4) Order Visibility Policy

The load-bearing decision.

### 4.1 Scopes

| Scope | Meaning |
|---|---|
| `own` | Orders where `placed_by_customer_user_id` is this user |
| `company` | Every order for the company the user is linked to |
| `company_summary` | Company orders visible as header only — number, date, status, total — without lines, prices per line or documents |
| `assigned` | Own, plus orders the user is a named approver or recipient on |

### 4.2 `CustomerOrderVisibilityPolicy` (`customer_order_visibility_policies`)

| Column | Type | Notes |
|---|---|---|
| `customer_id` | uuid, nullable | `customers.CustomerEntity.id`; null = tenant default |
| `customer_group_id` | uuid, nullable | Group-level default |
| `default_scope` | text | One of §4.1; tenant default is `own` |
| `role_scopes` | jsonb | `Record<roleType, scope>` — e.g. `{ purchase_approver: 'company', company_admin: 'company' }` |
| `allow_document_download` | boolean | Whether invoices and credit memos are downloadable |
| `allow_price_visibility` | boolean | `false` → company orders show quantities without prices |

Resolution: user's roles → the **widest** scope any role grants → falling back to `default_scope` → falling back to the tenant default `own`.

**The default is `own`.** A default of `company` would, on first deployment, disclose every colleague's orders to every portal user of that company — a privacy incident caused by a default. Widening is an explicit operator decision.

### 4.3 Enforcement

Visibility is applied in a single `buildOrderVisibilityFilter(buyerContext)` helper that every order-reading endpoint composes, in the same style as spec 4's `buildStorefrontProductScope`. It is never re-derived per endpoint, because an endpoint that re-derives it is an endpoint that will get it wrong.

**Structural guard (added 2026-08-17)**: given this is the sharpest risk in the module (R1, Critical — a colleague's negotiated financial terms, not catalog pricing), a review-and-test discipline alone is not the only gate. A Phase 1 deliverable is `customer_accounts/__tests__/no-raw-order-query.test.ts`, a plain-regex grep over `customer_accounts/api/**`/`customer_accounts/lib/**` banning any query-engine read of `sales` order/quote entities outside a call chain rooted in `buildOrderVisibilityFilter`, registered in `scripts/repo-wide-guards.mjs` — mirroring the equivalent guards already added to `SPEC-029` (buyer-context digest) and `storefront-merchandising` (cache-key builder) in this suite.

Revocation is immediate: removing a `CustomerPersonCompanyLink` or deactivating a `CustomerUser` invalidates the cached policy by tag and terminates active sessions for that user (R1).

---

## 5) Data Models

Standard scoped columns. Everything else this module needs already exists elsewhere.

### 5.1 `CustomerWishlist` (`customer_wishlists`) / `CustomerWishlistItem` (`customer_wishlist_items`)

| `CustomerWishlist` | Type | Notes |
|---|---|---|
| `customer_user_id` | uuid | |
| `store_id` | uuid, nullable | |
| `name` | text | Default "My wishlist"; B2B buyers keep several |
| `visibility` | text | `private \| company \| shared_link` |
| `share_token` | text, nullable | Only for `shared_link`; CSPRNG |
| `is_default` | boolean | |

| `CustomerWishlistItem` | Type | Notes |
|---|---|---|
| `wishlist_id` | uuid | |
| `product_id` / `variant_id` | uuid | |
| `quantity` | numeric(16,4) | B2B buyers wishlist a quantity, not just an item |
| `note` | text, nullable | |
| `added_at` | timestamptz | |

`visibility: 'company'` is a B2B affordance: a buyer assembles a proposed order and a colleague with authority converts it to a cart.

### 5.2 `CustomerSavedCart` (`customer_saved_carts`)

| Column | Type | Notes |
|---|---|---|
| `customer_user_id` | uuid | |
| `cart_id` | uuid | `cart.Cart.id`, status `saved` |
| `name` | text | "Monthly restock" |
| `is_template` | boolean | A template is copied on use rather than resumed |
| `last_used_at` | timestamptz, nullable | |

This realizes cart spec Open Question 1. The cart module holds the basket; this holds the naming and the buyer's relationship to it.

### 5.3 `CustomerBackInStockSubscription` (`customer_back_in_stock_subscriptions`)

| Column | Type | Notes |
|---|---|---|
| `customer_user_id` | uuid, nullable | Null for an email-only anonymous subscription |
| `email` | text | Encrypted at rest — declared in `customer_accounts/encryption.ts`'s `defaultEncryptionMaps: [{ entityId: 'customer_accounts:customer_back_in_stock_subscription', fields: [{ field: 'email', hashField: 'email_hash' }] }]` (named 2026-08-17; the `hashField` is required for the double-opt-in and per-address subscription-cap equality lookups, since the column itself is ciphertext) |
| `product_id` / `variant_id` | uuid | |
| `store_id` | uuid | |
| `quantity_wanted` | numeric(16,4), nullable | Notify when this much is available, not merely one unit — B2B |
| `status` | text | `active \| notified \| expired \| unsubscribed` |
| `notified_at` | timestamptz, nullable | |
| `expires_at` | timestamptz | Default 180 days |
| `unsubscribe_token` | text | CSPRNG; a one-click unsubscribe link is required for this class of mail |

Driven by `availability.state.changed` (availability spec §9). A subscription with `quantity_wanted` fires only when sellable quantity reaches it.

Anonymous subscriptions require double opt-in — otherwise the endpoint is an open relay for sending mail to arbitrary addresses (R4).

### 5.4 Reused, not redefined

| Need | Existing owner |
|---|---|
| Addresses | `customers.CustomerAddress` |
| Identity, roles, portal ACL, sessions, invitations | `customer_accounts` |
| Company profile, person↔company links and roles | `customers` |
| Credit limit, exposure, approvals | `customer_groups` |
| Orders, quotes, invoices, shipments, returns | `sales` |
| Carts | `cart` |

---

## 6) Account Surfaces

### 6.1 Both segments

| Page | Content |
|---|---|
| Overview | Recent orders, open approvals, credit summary (B2B), saved carts |
| Orders | Filterable list within the visibility scope |
| Order detail | Lines, totals, addresses, shipments with tracking, payments, documents, reorder |
| Quotes | Merchant-issued quotes; accept converts to an order |
| Addresses | CRUD over `CustomerAddress`; default shipping and billing |
| Profile | Name, email, phone, password, locale, communication preferences |
| Wishlists | List and detail; add all to cart |
| Saved carts | Resume or copy a template |
| Returns | Request a return against a delivered order; status tracking |

### 6.2 B2B only

| Page | Content | Guard |
|---|---|---|
| Company | Profile, billing details, payment terms | `company_admin` |
| Buyers | Roster: invite, assign roles, deactivate | `company_admin` |
| Approvals | Inbox of pending requests; approve or reject with a note | `purchase_approver` |
| Credit | Limit, exposure, available, ledger extract | `allow_price_visibility` |
| Purchase orders | PO numbers against orders, searchable | scope-dependent |
| Price list | The buyer's contracted prices, incl. quantity tiers; exportable to CSV | `allow_price_visibility` |

The price list page is the most-requested B2B feature in practice and is nearly free here: it is `GET /products` with the buyer's context, rendered as a table with `priceTiers` (spec 4 §5.2) instead of a grid.

### 6.3 Portal integration

Pages register through `portal`'s existing route and navigation mechanism with `requireCustomerAuth` and `requireCustomerFeatures` in page metadata, per root `AGENTS.md`. Navigation entries inject through the portal's menu injection, so a tenant disabling this module simply loses the entries.

---

## 7) Reorder

Never silent, and never partial-without-saying-so.

```
1. Load the order's lines within the visibility scope
2. For each line resolve, in the buyer's CURRENT context:
     product exists and is active?      → else UNAVAILABLE
     within the current assortment?     → else NOT_PERMITTED
     variant still exists?              → else VARIANT_GONE
     current price                      → compare to the original
     availability for the quantity      → else PARTIAL or OUT_OF_STOCK
     quantity rules still satisfied?    → else QUANTITY_ADJUSTED
3. Return a reorder PREVIEW — never a cart
4. The buyer confirms, having seen every issue
5. Only then create the cart from the accepted lines, via `cartService`'s `cart.lines.bulkAdd` command (`cart-module.md` §3.1a/§10) — never a direct `Cart`/`CartLine` write, the same command wishlist add-to-cart (§8) uses
```

The preview names every difference, per line, with the reason. A reorder that quietly drops two of eight lines produces a wrong order the buyer believes is right, and they discover it at delivery.

Price differences are shown per line and in total. A B2B buyer restocking monthly needs to see that the unit price moved before committing, not after.

---

## 8) API Contracts

Base `/api/portal/account`. All require an authenticated `CustomerUser` session.

**ACL naming fixed 2026-08-17** — see §8.1 for the full before/after and rationale. The table below uses the corrected, real feature ids throughout; the mechanism column states which routes are `makeCrudRoute` (straightforward CRUD, guard + command wiring handled internally) versus custom action routes (must wire the mutation-guard registry per `packages/core/AGENTS.md` → API Routes).

| Method | Path | Guard | Mechanism |
|---|---|---|---|
| GET | `/orders` | `portal.orders.view` + `buildOrderVisibilityFilter` | `makeCrudRoute` (read) |
| GET | `/orders/:id` | `portal.orders.view` + `buildOrderVisibilityFilter` | `makeCrudRoute` (read) |
| GET | `/orders/:id/documents/:documentId` | `portal.documents.download` + `allow_document_download` | Custom action |
| POST | `/orders/:id/reorder-preview` | `portal.orders.reorder` | Custom action (read-only computation, no mutation guard needed) |
| POST | `/orders/:id/reorder` | `portal.orders.reorder` | Custom action, mutation guard — creates a cart via `cart.lines.bulkAdd` (§7) |
| GET | `/quotes`, `/quotes/:id` | `portal.quotes.view` (existing) | `makeCrudRoute` (read) |
| POST | `/quotes/:id/accept` | `portal.quotes.accept` | Custom action, mutation guard — delegates to `sales`'s existing quote→order conversion, not a new implementation |
| GET/POST/PUT/DELETE | `/addresses[/:id]` | `portal.addresses.view` (reads) / `portal.addresses.manage` (writes) — existing, unseeded | `makeCrudRoute` |
| GET/PUT | `/profile` | `portal.account.manage` (existing) | `makeCrudRoute` |
| GET/POST/DELETE | `/wishlists[/:id][/items/:itemId]` | `portal.wishlists.manage`; `company`-visibility reads additionally require the item's wishlist to be scoped to the caller's company | `makeCrudRoute` |
| POST | `/wishlists/:id/add-to-cart` | `portal.wishlists.manage` | Custom action, mutation guard — creates/extends a cart via `cart.lines.bulkAdd` (§7) |
| GET/POST/DELETE | `/saved-carts[/:id]` | `portal.wishlists.manage` (saved carts share the "own basket management" feature — no separate id) | `makeCrudRoute` |
| POST | `/saved-carts/:id/resume` | `portal.wishlists.manage` | Custom action — see Open Questions for the `cart`-module copy-primitive gap this depends on |
| GET/POST/DELETE | `/back-in-stock[/:id]` | own (no feature gate beyond authentication — a buyer manages only their own subscriptions) | `makeCrudRoute` |
| GET | `/company` | `portal.company.manage` (new) | `makeCrudRoute` (read) |
| GET/POST/DELETE | `/company/buyers[/:id]` | `portal.users.view` (reads) / `portal.users.manage` / `.roles.manage` (writes) — existing, unchanged | `makeCrudRoute` |
| GET | `/approvals` | `portal.approvals.decide` + `buildOrderVisibilityFilter`-equivalent scoping to assigned approvals | `makeCrudRoute` (read) |
| POST | `/approvals/:id/decide` | `portal.approvals.decide` | Custom action — **resolves visibility only** (is this approval assigned to the caller?), then delegates the actual decision-recording to `customer_groups`'s existing `POST /api/customer-groups/approvals/:id/decide` command via a DI-resolved service call, never reimplementing `enforceCommandOptimisticLock` against `CustomerPurchaseApproval` a second time (fixed 2026-08-17 — see Cross-Module Coupling note below) |
| GET | `/credit` | `portal.credit.view` (new) | `makeCrudRoute` (read) |
| GET | `/price-list` | `portal.pricelist.view` (new) | Custom action — proxies `GET /products` with the buyer's context (§6.2) |
| GET | `/price-list/export` | `portal.pricelist.view` (new) | Custom action, audit-logged (R7) |

Public, unauthenticated: `POST /api/portal/back-in-stock` (double opt-in) and `GET /api/portal/back-in-stock/unsubscribe/:token`.

**Cross-module coupling for `/approvals/:id/decide` (fixed 2026-08-17).** An earlier draft implied this route independently records the approval decision. It does not: `customer_groups.CustomerPurchaseApproval` and its optimistic-locked decide command already exist (`customer-groups-and-b2b-terms.md` §5.6/§8/§6.3). This route is a thin, visibility-scoped wrapper — the same soft-optional-peer shape `packages/core/AGENTS.md` → Cross-Module Coupling describes, applied here to a mandatory (not optional) peer since B2B approvals are core to this module's value. Two independent decision-recording paths would let a race between them double-decide an approval, defeating `customer_groups`'s own R8 mitigation.

### 8.1 Portal ACL features — reconciled against the real `customer_accounts` module (fixed 2026-08-17)

An earlier draft invented a parallel `portal.account.*` namespace. `packages/core/src/modules/customer_accounts/setup.ts` already seeds and grants a **flat** `portal.<resource>.<action>` namespace to default portal roles (`portal.account.manage`, `portal.orders.view`, `.orders.create`, `portal.quotes.view`, `.quotes.request`, `portal.invoices.view`, `portal.catalog.view`), and further flat features already exist unseeded in the roles editor (`portal.addresses.view`/`.manage`) or wired into real routes (`portal.users.view`/`.manage`/`.roles.manage`, `portal.profile.view`). Reconciled:

| Was (invented) | Verdict | Now |
|---|---|---|
| `portal.account.orders.view` | Duplicate of the real `portal.orders.view` | **Deleted** — reuse `portal.orders.view` |
| `portal.account.orders.reorder` | New | `portal.orders.reorder` |
| `portal.account.documents.download` | New | `portal.documents.download` |
| `portal.account.quotes.accept` | New | `portal.quotes.accept` |
| `portal.account.wishlists.manage` | New | `portal.wishlists.manage` |
| `portal.account.company.manage` | Conflated two resources | **Split**: buyer roster reuses `portal.users.*` unchanged; company profile/billing gets new `portal.company.manage` |
| `portal.account.approvals.decide` | New (distinct persona from the admin-facing `customer_groups.approvals.decide`) | `portal.approvals.decide` |
| `portal.account.credit.view` | New | `portal.credit.view` |
| `portal.account.pricelist.view` | New | `portal.pricelist.view` |

```typescript
// New features only — everything else above reuses an existing id unchanged
export const newFeatures = [
  { id: 'portal.orders.reorder',     title: 'Reorder from order history' },
  { id: 'portal.documents.download', title: 'Download order/invoice documents' },
  { id: 'portal.quotes.accept',      title: 'Accept a merchant-issued quote' },
  { id: 'portal.wishlists.manage',   title: 'Manage wishlists and saved carts' },
  { id: 'portal.company.manage',     title: 'Manage company profile and billing details' },
  { id: 'portal.approvals.decide',   title: 'Approve or reject purchase requests' },
  { id: 'portal.credit.view',        title: 'View credit limit and exposure' },
  { id: 'portal.pricelist.view',     title: 'View and export the contracted price list' },
]
```

---

## 9) Events

```typescript
'customer_accounts.wishlist.created' | '.item_added' | '.item_removed'
'customer_accounts.saved_cart.created' | '.resumed'
'customer_accounts.back_in_stock.subscribed' | '.confirmed' | '.notified' | '.unsubscribed'
'customer_accounts.reorder.created'
'customer_accounts.quote.accepted'
'customer_accounts.buyer.invited' | '.deactivated'
```

A subscriber on `availability.state.changed` matches active subscriptions and enqueues notifications. Notification delivery is a queue job with per-recipient rate limiting — a large restock must not send one buyer forty emails in a minute (R5).

---

## 10) Risks & Impact Review

| # | Risk | Severity | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Cross-buyer order disclosure | **Critical** | A default of `company` scope, or a missing filter on one endpoint, shows a colleague's — or another company's — orders, prices and negotiated terms. | Default scope is `own`; a single `buildOrderVisibilityFilter` composed by every order-reading endpoint; per-endpoint tests with a same-company colleague and a different-company user; policy cache invalidated and sessions terminated on link removal or deactivation | Low |
| R2 | Revoked access persists | **High** | An employee leaves; their portal session and cached policy keep working until TTL, and they continue reading company orders. | Deactivation terminates active `CustomerUserSession` rows and invalidates the policy cache by tag; a test asserts an in-flight session is refused after deactivation | Low |
| R3 | Silent partial reorder | **High** | Two of eight lines are unavailable; the reorder cart contains six and the buyer, recognizing the order name, checks out believing it complete. | Reorder is a two-step preview-then-confirm; every line difference named with a reason; no cart created before confirmation (§7) | Low |
| R4 | Back-in-stock as a mail relay | **High** | The public subscribe endpoint accepts arbitrary addresses; an attacker uses the storefront to send unsolicited mail carrying the tenant's domain reputation. | Double opt-in for anonymous subscriptions; rate limit per IP and per address; one-click unsubscribe token; a hard cap on active subscriptions per address | Low |
| R5 | Notification storm on restock | Medium | A large goods receipt satisfies thousands of subscriptions at once; the mail provider throttles or blocks the tenant. | Queue-based delivery with per-recipient and per-tenant rate limits; debounce per variant (availability spec §9); batching per recipient across variants | Low |
| R6 | Document download authorization | **High** | An invoice URL is guessable or unchecked, and one buyer downloads another's invoice. | Documents fetched by id through the visibility filter and `allow_document_download`; identical `404` for not-found and not-permitted; no direct storage URLs, ever — always a proxied, authorized read | Low |
| R7 | Price list export leaks contract pricing | Medium | An exported CSV of contracted prices is forwarded outside the company. | Cannot be prevented technically once authorized; gated behind `allow_price_visibility`, exports are audit-logged with user and timestamp, and the file is watermarked with the company name and generation time | Medium — accepted; the mitigation is traceability, not prevention |
| R8 | Wishlist and subscriptions as GDPR data | Medium | Behavioural data tied to an identified person outlives account deletion with nothing cleaning it up. | **Fixed 2026-08-17** — no generic "GDPR erasure surface" exists in this platform (verified); the real, shipped pattern is a per-module subscriber on a lifecycle-deletion event, e.g. `communication_channels/subscribers/user-deleted-cascade.ts` listening on `auth.user.deleted`. This module adds `customer_accounts/subscribers/user-deleted-cascade.ts` listening on the already-emitted `customer_accounts.user.deleted`: hard-deletes `CustomerWishlist`/`CustomerWishlistItem`/`CustomerSavedCart` rows for that user, and nulls `customer_user_id` on `CustomerBackInStockSubscription` rows (converting to an anonymous subscription rather than deleting outright, since the product-availability interest itself isn't personal data once disconnected from an identity); anonymous subscriptions carry their own erasure path via the unsubscribe token; retention default 180 days with expiry | Low |
| R9 | Order history N+1 | Medium | An order list resolving shipments, payments and documents per row makes the most-visited account page the slowest. | Projection-based list query; detail-only enrichment; query count asserted for a 25-order page | Low |

---

## 11) Integration Coverage

**Visibility (the gate for this spec):**
- `own` scope: a colleague's order in the same company returns `404`
- `company` scope: colleague orders visible; another company's still `404`
- `company_summary`: headers present, lines and prices absent
- `assigned`: an order the user approved is visible; an unrelated one is not
- Role-derived scope takes the widest of several roles
- `allow_price_visibility: false` shows quantities without prices
- Removing a company link revokes access immediately (R1)
- Deactivating a user terminates active sessions (R2)
- Cross-tenant access refused on every endpoint

**Reorder:**
- Every difference class — unavailable, not permitted, variant gone, price changed, partial stock, quantity adjusted — appears in the preview with its reason
- No cart is created by the preview call
- Confirmation creates a cart containing exactly the accepted lines (R3)

**Documents:**
- Not-permitted and not-found are indistinguishable in body and status
- `allow_document_download: false` refuses
- No response exposes a direct storage URL (R6)

**Back-in-stock:**
- Anonymous subscription requires confirmation before it can ever notify (R4)
- `quantity_wanted` fires only at that quantity
- Unsubscribe token works once and is idempotent
- A restock satisfying 1 000 subscriptions respects the rate limits and batches per recipient (R5)

**B2B:**
- Approvals inbox lists only requests this user may decide
- Deciding an already-decided request surfaces the optimistic-lock conflict
- Credit page matches `customerGroupsService` exposure exactly
- Price list matches what the storefront shows the same buyer, tiers included
- Buyer invitation, role assignment and deactivation
- Quote acceptance creates an order; a non-approver is refused

**Wishlists and saved carts:**
- `company` visibility shares within the company only; `private` does not
- `shared_link` requires the token; the token is not guessable
- Add-all-to-cart skips items outside the current assortment and says so
- Resuming a template copies rather than resumes

**GDPR:** deleting a `CustomerUser` triggers `customer_accounts.user.deleted`, and the subscriber cascade removes that user's wishlists, saved-cart links and disconnects (not deletes) their back-in-stock subscriptions (R8, fixed 2026-08-17).

**Performance:** a 25-order history page meets its query-count budget (R9).

---

## 12) Implementation Phases

### Phase 1 — Visibility and order history
`CustomerOrderVisibilityPolicy`, `buildOrderVisibilityFilter`, order list and detail, document download, portal pages and navigation.

**Gate:** the full visibility matrix passes, including immediate revocation.

### Phase 2 — Self-service
Addresses, profile, returns request, reorder preview and confirm.

**Gate:** every reorder difference class surfaces in the preview.

### Phase 3 — Wishlists, saved carts, back-in-stock
All three entities, the `availability.state.changed` subscriber, double opt-in, unsubscribe, rate limiting.

**Gate:** the mail-relay and notification-storm tests pass.

### Phase 4 — B2B
Company page, buyer roster, approvals inbox, credit overview, PO history, price list and export, quote acceptance.

**Gate:** approvals integrate end to end with checkout's `awaiting_approval` state; the credit page reconciles with the ledger.

---

## 13) Open Questions

1. **Order visibility beyond company** — group structures (a parent company seeing subsidiaries' orders) are a real enterprise requirement with no model here. The `customer_id`-keyed policy could extend, but the hierarchy does not exist in `customers`.
2. **Spending limits per buyer** — distinct from approval thresholds: a per-buyer monthly cap. Belongs with `customer_groups` credit if it is built.
3. **Shipment tracking depth** — whether tracking is a link out to the carrier or an ingested timeline depends on `shipping_carriers` capabilities, unverified here.
4. **Self-service returns** — this spec exposes a return *request*. The approval, RMA and refund flow belongs to [WMS Phase 5](./2026-04-15-wms-phase-5-returns-reverse-logistics.md) and `sales`; the boundary needs confirming before Phase 2.
5. **Saved-cart resume as a copy** (added 2026-08-17) — §5.2 states "A template is copied on use rather than resumed," but `cart-module.md`'s command set (§3.1a) has no copy-a-cart-into-a-new-cart primitive today, only `cart.merge`. `POST /saved-carts/:id/resume` needs either a new `cart` command or a confirmation that `cart.merge` (creating an empty cart and merging the saved one into it) is an acceptable substitute. Flagged against `cart-module.md` for its next revision if the gap is real.

---

## 14) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `sales` read through the query engine as a projection; no `SalesOrder` import |
| Tenant/organization scoping | Every endpoint; asserted against a second tenant |
| Portal RBAC | `requireCustomerAuth` / `requireCustomerFeatures` in page metadata; features resolved through the existing `CustomerRoleAcl` / `CustomerUserAcl` wildcard handling |
| Never expose cross-customer data | `buildOrderVisibilityFilter` composed by every reading endpoint; default scope `own` |
| Encryption | Subscription email and address data encrypted; read via decryption helpers |
| GDPR | `customer_accounts/subscribers/user-deleted-cascade.ts` on `customer_accounts.user.deleted` (fixed 2026-08-17 — no platform-wide erasure surface exists; this follows the real `communication_channels` precedent); retention defaults |
| Zod validation | All routes; `z.infer` types |
| No `any` | Visibility policy and payloads fully typed |
| i18n | Portal copy via `useT` / `resolveTranslations`; no hard-coded strings |
| Design system | Portal pages use the portal extension patterns and semantic tokens |
| Optimistic locking | Approval decisions and editable entities; conflicts surfaced via `surfaceRecordConflict` |
| Queue usage | Notification delivery via the worker contract with rate limiting |
| Backward compatibility | Additive to `customer_accounts`; no existing contract surface changes — true only after the 2026-08-17 ACL fix (§8.1): the original draft's `portal.account.*` ids duplicated/shadowed real, already-seeded `portal.*` features, which would have been a functional regression for any tenant with existing custom role grants |
| Integration coverage | §11, shipping in the same change |

---

## 15) Changelog

### 2026-08-17 (rev 2 — pre-implementation fixes)

Fixed the findings of a `/om-pre-implement-spec` audit (`ANALYSIS-2026-08-14-storefront-customer-account.md`):

- **Critical**: §8.1 invented a parallel `portal.account.*` ACL namespace. Reconciled against the real, already-shipped `customer_accounts/setup.ts`: `portal.account.orders.view` was a straight duplicate of the real `portal.orders.view` (deleted); `portal.account.company.manage` conflated company-profile management with the already-shipped buyer-roster surface (`portal.users.*`) and is split; the remaining 7 ids are genuinely new but renamed off the fabricated `.account.` shape onto the real flat `portal.<resource>.<action>` convention. Profile and Addresses now cite the existing `portal.account.manage` and `portal.addresses.view`/`.manage` instead of an unnamed "own" guard.
- **Critical**: `POST /approvals/:id/decide` didn't state its relationship to `customer_groups`'s already-implemented, optimistic-locked decide command. Clarified: this route resolves visibility only and delegates the actual decision to the existing command — two independent decision-recording paths would have let a race double-decide an approval.
- Replaced the "GDPR erasure surface" claim (no such mechanism exists anywhere in this platform) with a concrete `user-deleted-cascade.ts` subscriber design on `customer_accounts.user.deleted`, following the real `communication_channels` precedent.
- Named the `customer_accounts/encryption.ts` addition backing `CustomerBackInStockSubscription.email`'s encryption claim, including the required `hashField`.
- Named the `cart.lines.bulkAdd` command for reorder-confirm and wishlist-add-to-cart; flagged saved-cart resume's missing `cart`-module copy primitive as an Open Question against `cart-module.md`.
- Added a structural CI guard for `buildOrderVisibilityFilter` (R1, Critical), matching the precedent set by 2 of 3 directly comparable sibling specs in this suite.
- Added table names to §5.1; stated `makeCrudRoute` vs. custom-action-route per §8 route.

### 2026-08-14
- Initial specification.
- Grounded in the implemented `customer_accounts` model — `CustomerUser`, `CustomerRole`, `CustomerRoleAcl`, `CustomerUserAcl`, `CustomerUserSession`, `CustomerUserInvitation`, `CustomerUserEmailVerification`, `CustomerUserPasswordReset` — so identity, authentication, portal ACL and invitations are reused rather than redefined; and in `customers`' `CustomerCompanyProfile`, `CustomerPersonCompanyLink`, `CustomerPersonCompanyRole`, `CustomerEntityRole` and `CustomerAddress` for the company and address model.
- Introduced `CustomerOrderVisibilityPolicy` after finding that no layer answers which orders a `CustomerUser` may read — the single highest-consequence gap in the account area. Default scope is `own` specifically so that a first deployment cannot disclose colleagues' orders by default.
- Realized cart spec Open Question 1 (saved carts and order templates) via `CustomerSavedCart` over a `saved` cart.
- Made reorder a preview-then-confirm flow rather than a one-click cart creation, because silent partial reorders produce wrong orders the buyer trusts.
