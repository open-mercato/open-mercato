# Storefront Customer Account

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 3 — shopping lists, shared line resolution 2026-09-16) |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 9, Phase 4 |
| **Modules** | `customer_accounts` (extended), `portal` (extended) |
| **Depends on** | [Customer Groups & B2B Terms](./2026-08-14-customer-groups-and-b2b-terms.md), [Cart Module](./2026-08-14-cart-module.md), [Checkout Funnel](./2026-03-19-checkout-simple-checkout.md), [Availability Contract](./2026-08-14-availability-contract.md) |

---

## TLDR

**Key Points:**
- The buyer-facing account area: order history, addresses, saved carts and reorder, shopping lists, back-in-stock alerts — plus a B2B half that is the real differentiator: a company buyer roster, an approvals inbox, credit exposure, PO history and quote acceptance.
- It extends `customer_accounts`, which already ships `CustomerUser`, `CustomerRole`, `CustomerRoleAcl`, `CustomerUserAcl`, sessions, invitations and password reset. Identity, authentication and portal ACL are **solved** — this spec adds commerce surfaces on top, not a second identity model.
- Order history reads `sales` **through the query engine, never an ORM relation**. `customer_accounts` must not import `SalesOrder`.
- The sharpest risk is authorization, not features: a B2B buyer must see their company's orders but not their colleague's salary-sensitive negotiated terms, and an ex-employee's revoked access must actually revoke.

**Scope:**
- Order and quote history, order detail, reorder, document downloads
- Address book over `customers.CustomerAddress`
- Saved carts, shopping lists with per-item quantities, back-in-stock subscriptions
- B2B: buyer roster with roles, approvals inbox, credit overview, PO history, quote acceptance
- Portal navigation and page registration

**Concerns:**
- "Which orders may this user see" is a per-tenant policy question with no single right answer, and getting it wrong either hides a buyer's own orders or discloses a colleague's
- Reorder is a trap: prices, availability and even product existence change between the original order and the reorder, and a silent partial reorder is worse than a refusal
- Shopping lists and back-in-stock subscriptions are a GDPR surface — they are behavioural data tied to an identified person

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
              │        CustomerShoppingList / Item
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

### 5.1 `CustomerShoppingList` (`customer_shopping_lists`) / `CustomerShoppingListItem` (`customer_shopping_list_items`)

| `CustomerShoppingList` | Type | Notes |
|---|---|---|
| `customer_user_id` | uuid | |
| `store_id` | uuid, nullable | |
| `name` | text | Default "My shopping list"; B2B buyers keep several ("Monthly restock", "Site B consumables") |
| `visibility` | text | `private \| company \| shared_link` |
| `share_token` | text, nullable | Only for `shared_link`; CSPRNG |
| `is_default` | boolean | |

| `CustomerShoppingListItem` | Type | Notes |
|---|---|---|
| `shopping_list_id` | uuid | |
| `product_id` / `variant_id` | uuid | |
| `quantity` | numeric(16,4) | Required, default 1. A list line is a quantity of a thing, not a bookmark for it — this is what separates a shopping list from a wishlist, and it is what makes `add-to-cart` a real conversion rather than a lookup |
| `note` | text, nullable | |
| `unit_price_snapshot` | numeric(16,4), nullable | The buyer's resolved unit price at the moment the item was added. The `PRICE_MOVED` anchor for §7.1; null when no price resolved (an unpriced or assortment-excluded product), and a null anchor omits the class rather than asserting "unchanged" |
| `snapshot_price_kind_id` | uuid, nullable | Which `CatalogPriceKind` the snapshot was taken under. `PRICE_MOVED` is reported only when the current context resolves the same kind — otherwise the comparison would report a change of viewer as a change of price (§7.1) |
| `snapshot_currency_code` | text, nullable | |
| `added_at` | timestamptz | |

`visibility: 'company'` is a B2B affordance: a buyer assembles a proposed order and a colleague with authority converts it to a cart. `shared_link` remains the B2C affordance — a shopper shares a list by token — so one entity serves both personas without a `kind` discriminator.

**Why "shopping list" and not "wishlist" (decided 2026-09-16).** A wishlist records intent to want; a shopping list records intent to buy, in a stated amount. This entity was always the second thing — it carries a per-item quantity and a `company` visibility whose whole purpose is converting a colleague's list into a cart — so the wishlist name described a model this spec never had. It is also the term the B2B market uses (BigCommerce B2B Edition ships "Shopping Lists"; Adobe Commerce B2B calls them "Requisition Lists"). The rename is free today because Phase 3 is unimplemented: no table exists, no ACL id is seeded, no event has been emitted, so `BACKWARD_COMPATIBILITY.md` binds none of it. After Phase 3 ships, the same rename costs a migration, a deprecated-id bridge and a dual-emit window.

### 5.2 `CustomerSavedCart` (`customer_saved_carts`)

| Column | Type | Notes |
|---|---|---|
| `customer_user_id` | uuid | |
| `cart_id` | uuid | `cart.Cart.id`, status `saved` |
| `name` | text | "Friday's order, parked" |
| `last_used_at` | timestamptz, nullable | |

This realizes cart spec Open Question 1. The cart module holds the basket; this holds the naming and the buyer's relationship to it.

**`is_template` removed (2026-09-16).** An earlier revision gave this entity a template flag whose semantics were "copied on use rather than resumed" — a named, reusable set of products and quantities that survives being used. That is a shopping list (§5.1), described a second time in a second table, and the duplication was invisible only while §5.1 was called a wishlist. A saved cart is now exactly one thing: **a real basket, suspended, to be resumed once**. Reusable belongs to a list; parked belongs to a cart. Capability parity is kept by conversion in both directions rather than by a flag — `POST /shopping-lists/from-cart` turns the basket a buyer is holding into a reusable list, and §7.3 turns a list into a basket.

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
| Shopping lists | List and detail; edit quantities inline; add all to cart |
| Saved carts | Resume a parked basket; save it as a shopping list instead |
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

## 7) Line Resolution: Reorder and List Conversion

Never silent, and never partial-without-saying-so. Two surfaces turn a stored set of lines into a cart — reorder from an order, and add-to-cart from a shopping list — and they face the same problem: the stored lines were captured in a context that has since moved. One resolver serves both (§7.1), then each surface decides how much ceremony the buyer owes before the cart is created (§7.2, §7.3).

### 7.1 The shared resolver (added 2026-09-16)

`portalLineResolutionService.resolveLineSet(lines, buyerContext, { priceAnchor })` takes any set of `{ productId, variantId, quantity, anchorUnitPrice?, anchorPriceKindId? }` and returns a `ResolvedLineSet`: every input line, resolved in the buyer's **current** context, with zero or more difference classes attached.

```
For each line, in the buyer's CURRENT context:
  product exists and is active?      → else UNAVAILABLE
  within the current assortment?     → else NOT_PERMITTED
  variant still exists?              → else VARIANT_GONE
  availability for the quantity      → else PARTIAL or OUT_OF_STOCK
  quantity rules still satisfied?    → else QUANTITY_ADJUSTED
  current price vs. the anchor       → else PRICE_MOVED   (see anchor rule below)
```

`ResolvedLineSet.isClean` is true only when no line carries any class.

**The price anchor rule.** `PRICE_MOVED` is computable only against a price the buyer has actually seen. Reorder always has one — the order line's own unit price. A shopping list has one only if a snapshot was captured when the item was added (§5.1), and only if that snapshot was taken under the **same resolved price kind** as the current context: a `company`-visible list assembled by one buyer and converted by a colleague on different negotiated terms must not report "the price moved" when what actually changed is who is looking. Where the anchor is absent or its price kind differs, `PRICE_MOVED` is **omitted** for that line — never reported as "unchanged", because an unknown difference and no difference are not the same statement.

Because resolution is read-only, it is not a command and carries no mutation guard. It sits in `customer_accounts` rather than `cart` because it answers a portal question ("what would this buyer get"), not a basket question.

### 7.2 Reorder — always previews

```
1. Load the order's lines within the visibility scope
2. Resolve them via §7.1, anchored on each line's original unit price
3. Return a reorder PREVIEW — never a cart, even when the resolution is clean
4. The buyer confirms, having seen every issue
5. Only then create the cart from the accepted lines, via `cartService`'s `cart.lines.bulkAdd` command (`cart-module.md` §3.1a/§10) — never a direct `Cart`/`CartLine` write, the same command list conversion (§7.3) uses
```

The preview names every difference, per line, with the reason. A reorder that quietly drops two of eight lines produces a wrong order the buyer believes is right, and they discover it at delivery.

Price differences are shown per line and in total. A B2B buyer restocking monthly needs to see that the unit price moved before committing, not after.

Reorder previews even a clean resolution because the buyer's intent is inherently retrospective — they asked for "the same again", and confirming what "the same" means today is the whole point of the screen.

### 7.3 Shopping list → cart — previews on difference (added 2026-09-16)

A list is converted far more often than an order is reordered, and a mandatory two-step on an unchanged list is friction with no information in it. So the ceremony is conditional, not the honesty:

```
1. Load the list's items within the caller's visibility scope (§5.1)
2. Resolve them via §7.1, anchored on each item's price snapshot where one applies
3. If ResolvedLineSet.isClean → create the cart immediately via `cart.lines.bulkAdd` and return it
4. Otherwise → create NOTHING; return the preview and a short-lived resolutionToken
5. The buyer confirms the lines they accept; confirm re-resolves and compares
```

Step 5 is the part that matters. The token proves the buyer confirmed a preview they were actually shown; **re-resolution at confirm is what makes the result correct**, because stock can move between preview and confirm. If the fresh resolution differs from the token's, the confirm is refused and a new preview is returned rather than a cart — a buyer must never accept difference set A and receive cart B. Tokens expire after 15 minutes; an expired token is the same refusal.

The accepted lines carry each item's stored `quantity`, not 1. A `QUANTITY_ADJUSTED` line enters the cart at the adjusted quantity **and says so** — the adjustment is part of the preview the buyer confirmed, never an unannounced correction.

This is the same principle as §7.2 under a different frequency, not a weaker one: the rule is that no difference reaches the cart unseen. A clean list has no difference to see.

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
| GET/POST/DELETE | `/shopping-lists[/:id][/items/:itemId]` | `portal.shopping_lists.manage`; `company`-visibility reads additionally require the item's list to be scoped to the caller's company | `makeCrudRoute` |
| POST | `/shopping-lists/:id/add-to-cart-preview` | `portal.shopping_lists.manage` | Custom action (read-only resolution via §7.1, no mutation guard) — returns the difference set and a `resolutionToken` |
| POST | `/shopping-lists/:id/add-to-cart` | `portal.shopping_lists.manage` | Custom action, mutation guard — resolves via §7.1; creates/extends a cart via `cart.lines.bulkAdd` immediately when clean, otherwise requires the accepted lines plus a live `resolutionToken` and refuses with a fresh preview when re-resolution differs (§7.3) |
| GET/POST/DELETE | `/saved-carts[/:id]` | `portal.shopping_lists.manage` (saved carts share the "own basket management" feature — no separate id) | `makeCrudRoute` |
| POST | `/saved-carts/:id/resume` | `portal.shopping_lists.manage` | Custom action, mutation guard — makes the saved cart active; when the buyer already holds a non-empty active cart it delegates to the existing `cart.merge` (undoable via `cart.mergeUndo`). The saved-cart record is consumed on resume. Needs no new `cart` primitive since `is_template` was removed (§5.2) |
| POST | `/shopping-lists/from-cart` | `portal.shopping_lists.manage` | Custom action, mutation guard — snapshots the active cart's lines, quantities and resolved unit prices (§5.1) into a new list; the cart is left untouched |
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
| `portal.account.wishlists.manage` | New | `portal.shopping_lists.manage` |
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
  { id: 'portal.shopping_lists.manage', title: 'Manage shopping lists and saved carts' },
  { id: 'portal.company.manage',     title: 'Manage company profile and billing details' },
  { id: 'portal.approvals.decide',   title: 'Approve or reject purchase requests' },
  { id: 'portal.credit.view',        title: 'View credit limit and exposure' },
  { id: 'portal.pricelist.view',     title: 'View and export the contracted price list' },
]
```

---

## 9) Events

```typescript
'customer_accounts.shopping_list.created' | '.item_added' | '.item_removed' | '.converted'
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
| R3 | Silent partial reorder or list conversion | **High** | Two of eight lines are unavailable; the resulting cart contains six and the buyer, recognizing the order or list name, checks out believing it complete. A long-lived shopping list is the worse case: it drifts further from current prices and availability than a month-old order does, and is converted far more often. | One shared resolver (§7.1) gives both surfaces the same difference classes, named per line with a reason. Reorder always previews (§7.2); list conversion previews whenever any difference exists and creates no cart until confirmed (§7.3). Confirm re-resolves and refuses a stale `resolutionToken` rather than creating a cart the buyer did not accept | Low |
| R4 | Back-in-stock as a mail relay | **High** | The public subscribe endpoint accepts arbitrary addresses; an attacker uses the storefront to send unsolicited mail carrying the tenant's domain reputation. | Double opt-in for anonymous subscriptions; rate limit per IP and per address; one-click unsubscribe token; a hard cap on active subscriptions per address | Low |
| R5 | Notification storm on restock | Medium | A large goods receipt satisfies thousands of subscriptions at once; the mail provider throttles or blocks the tenant. | Queue-based delivery with per-recipient and per-tenant rate limits; debounce per variant (availability spec §9); batching per recipient across variants | Low |
| R6 | Document download authorization | **High** | An invoice URL is guessable or unchecked, and one buyer downloads another's invoice. | Documents fetched by id through the visibility filter and `allow_document_download`; identical `404` for not-found and not-permitted; no direct storage URLs, ever — always a proxied, authorized read | Low |
| R7 | Price list export leaks contract pricing | Medium | An exported CSV of contracted prices is forwarded outside the company. | Cannot be prevented technically once authorized; gated behind `allow_price_visibility`, exports are audit-logged with user and timestamp, and the file is watermarked with the company name and generation time | Medium — accepted; the mitigation is traceability, not prevention |
| R8 | Shopping lists and subscriptions as GDPR data | Medium | Behavioural data tied to an identified person outlives account deletion with nothing cleaning it up. | **Fixed 2026-08-17** — no generic "GDPR erasure surface" exists in this platform (verified); the real, shipped pattern is a per-module subscriber on a lifecycle-deletion event, e.g. `communication_channels/subscribers/user-deleted-cascade.ts` listening on `auth.user.deleted`. This module adds `customer_accounts/subscribers/user-deleted-cascade.ts` listening on the already-emitted `customer_accounts.user.deleted`: hard-deletes `CustomerShoppingList`/`CustomerShoppingListItem`/`CustomerSavedCart` rows for that user, and nulls `customer_user_id` on `CustomerBackInStockSubscription` rows (converting to an anonymous subscription rather than deleting outright, since the product-availability interest itself isn't personal data once disconnected from an identity); anonymous subscriptions carry their own erasure path via the unsubscribe token; retention default 180 days with expiry | Low |
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

**Shopping lists and saved carts:**
- `company` visibility shares within the company only; `private` does not
- `shared_link` requires the token; the token is not guessable
- Add-all-to-cart skips items outside the current assortment and says so
- Add-all-to-cart carries each line's stored `quantity` into the cart, not quantity 1; a quantity the current quantity rules reject is adjusted and the adjustment is reported, never applied silently
- A clean list converts in one step and returns a cart; a list with any difference class returns a preview and creates **no** cart
- Every §7.1 difference class surfaces for a list conversion, not only for reorder
- Confirming with a stale `resolutionToken` — stock consumed between preview and confirm — is refused with a fresh preview, and no cart is created
- An expired (>15 min) token is refused the same way
- `PRICE_MOVED` is omitted, not reported as unchanged, when an item has no price snapshot; and when a `company` list assembled under one price kind is converted by a colleague resolving a different kind
- Resuming a saved cart makes it active and consumes the saved-cart record; resuming onto a non-empty active cart merges and the merge is undoable
- `POST /shopping-lists/from-cart` captures quantities and a price snapshot per line, and leaves the source cart unchanged

**GDPR:** deleting a `CustomerUser` triggers `customer_accounts.user.deleted`, and the subscriber cascade removes that user's shopping lists, saved-cart links and disconnects (not deletes) their back-in-stock subscriptions (R8, fixed 2026-08-17).

**Performance:** a 25-order history page meets its query-count budget (R9).

---

## 12) Implementation Phases

### Phase 1 — Visibility and order history
`CustomerOrderVisibilityPolicy`, `buildOrderVisibilityFilter`, order list and detail, document download, portal pages and navigation.

**Gate:** the full visibility matrix passes, including immediate revocation.

### Phase 2 — Self-service
Addresses, profile, returns request, the §7.1 shared line resolver, reorder preview and confirm.

**Gate:** every reorder difference class surfaces in the preview.

The resolver ships here even though its second consumer arrives in Phase 3 — building it as a reorder-private helper first would guarantee it grows an order-shaped signature that list conversion then has to fight.

### Phase 3 — Shopping lists, saved carts, back-in-stock
All three entities, list conversion over the Phase 2 resolver, the `availability.state.changed` subscriber, double opt-in, unsubscribe, rate limiting.

**Gate:** the mail-relay and notification-storm tests pass; list conversion surfaces every difference class and creates no cart when one is present.

### Phase 4 — B2B
Company page, buyer roster, approvals inbox, credit overview, PO history, price list and export, quote acceptance.

**Gate:** approvals integrate end to end with checkout's `awaiting_approval` state; the credit page reconciles with the ledger.

---

## 13) Open Questions

1. **Order visibility beyond company** — group structures (a parent company seeing subsidiaries' orders) are a real enterprise requirement with no model here. The `customer_id`-keyed policy could extend, but the hierarchy does not exist in `customers`.
2. **Spending limits per buyer** — distinct from approval thresholds: a per-buyer monthly cap. Belongs with `customer_groups` credit if it is built.
3. **Shipment tracking depth** — whether tracking is a link out to the carrier or an ingested timeline depends on `shipping_carriers` capabilities, unverified here.
4. **Self-service returns** — this spec exposes a return *request*. The approval, RMA and refund flow belongs to [WMS Phase 5](./2026-04-15-wms-phase-5-returns-reverse-logistics.md) and `sales`; the boundary needs confirming before Phase 2.
5. **Saved-cart resume as a copy** — *resolved 2026-09-16.* The gap existed only because `CustomerSavedCart.is_template` claimed a copy semantic that `cart-module.md` §3.1a had no primitive for. Removing the flag (§5.2) removes the requirement: a saved cart is resumed, never copied, and resuming onto a non-empty active cart uses the already-specified `cart.merge`/`cart.mergeUndo`. The reusable-template capability moved to shopping lists, which already own the conversion path. No new `cart` command is needed and the flag against `cart-module.md` is withdrawn.

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

### 2026-09-16 (rev 3 — shopping lists, shared line resolution, saved-cart reconciliation)

- **§7 rewritten as a shared resolver.** Reorder's per-line difference analysis was private to reorder while list conversion shared only the final `cart.lines.bulkAdd` call — so a list, which drifts further from current prices and availability than a month-old order does, could add lines silently. Extracted `portalLineResolutionService.resolveLineSet` (§7.1) and gave both surfaces the same difference classes. Reorder still always previews (§7.2); list conversion previews **only when a difference exists** (§7.3), since a mandatory two-step on an unchanged list is friction carrying no information. Confirm re-resolves and refuses a `resolutionToken` whose resolution has moved, so stock consumed between preview and confirm cannot turn accepted-difference-set-A into cart-B.
- Added `unit_price_snapshot` / `snapshot_price_kind_id` / `snapshot_currency_code` to `CustomerShoppingListItem`: without an anchor `PRICE_MOVED` is not computable for a list. The price-kind column exists so a `company` list converted by a colleague on different negotiated terms does not report a change of viewer as a change of price; a missing or mismatched anchor **omits** the class rather than asserting "unchanged".
- Added `POST /shopping-lists/:id/add-to-cart-preview` and the `.converted` event; stated that the resolver ships in Phase 2 with reorder and is reused by Phase 3, rather than being born order-shaped and retrofitted.
- **Removed `CustomerSavedCart.is_template`.** "Copied on use rather than resumed" described a reusable named set of products and quantities — a shopping list, modelled twice. A saved cart is now only a parked basket, resumed once, merging via the existing `cart.merge`/`cart.mergeUndo` when one is already held. Capability parity comes from `POST /shopping-lists/from-cart` instead of a flag. This closes Open Question 5 and withdraws the copy-primitive gap flagged against `cart-module.md` §3.1a, whose own Open Question 1 is updated to match.

- Renamed `CustomerWishlist`/`CustomerWishlistItem` to `CustomerShoppingList`/`CustomerShoppingListItem` (`customer_shopping_lists`/`customer_shopping_list_items`), the ACL feature `portal.wishlists.manage` to `portal.shopping_lists.manage`, the routes under `/wishlists` to `/shopping-lists`, and the events `customer_accounts.wishlist.*` to `customer_accounts.shopping_list.*`. Rationale in §5.1: the model already carried per-item quantities and a company-visibility convert-to-cart flow, which is a shopping list, not a wishlist. Done now because Phase 3 is unimplemented, so nothing on the contract surface exists yet to break.
- Made `CustomerShoppingListItem.quantity` required with default 1 rather than an unqualified B2B note, and added the matching add-all-to-cart integration coverage: the stored quantity reaches the cart, and a quantity the current rules reject is adjusted visibly.

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
