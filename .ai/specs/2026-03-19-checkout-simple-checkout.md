# Checkout Module — Simple Checkout (Phase B)

| Field | Value |
|-------|-------|
| **Status** | Specification (Phase B — not yet scheduled) |
| **Author** | Piotr Karwatka |
| **Created** | 2026-03-19 |
| **Related** | [Phase A — Pay Links](./2026-03-19-checkout-pay-links.md), [SPEC-041 (UMES)](./SPEC-041-2026-02-24-universal-module-extension-system.md), [SPEC-044 (Payment Gateways)](./SPEC-044-2026-02-24-payment-gateway-integrations.md), Sales module |

## TLDR

**Key Points:**
- Extends the existing `@open-mercato/checkout` package (Phase A) with cart-based checkout — merchants define products/services on a link, and customers see a one-page checkout with items, totals, and payment.
- Checkout completion creates a sales quote → converts to order, connecting the standalone checkout flow to the full sales document pipeline.

**Scope:**
- New `CheckoutCartItem` entity for pre-defined items on a link
- Product/service selection from catalog (by FK ID) or custom items (name + price)
- One-page checkout UX: items review, customer info, totals, payment
- Quote creation on checkout submit → Order creation on payment completion
- Integration with sales module via UMES + DI-resolved `salesCalculationService`

**Concerns:**
- Sales module dependency for quote/order creation — carefully scoped to existing sales command contracts, no direct entity imports
- Pricing must flow through `salesCalculationService` for consistency with tax rules, adjustments, and currency handling

---

## Overview

Simple Checkout transforms pay links from single-amount payment pages into mini storefronts. A merchant pre-defines items (products from the catalog or custom line items) on a checkout link. Customers visit the link, see the items with quantities and prices, review totals, fill in their details, and pay — all on a single page. Behind the scenes, totals are previewed without persistence on page load; a sales quote is created only when the customer actually submits checkout, then converted to an order upon successful payment.

### Market Reference

**Stripe Checkout Sessions** with line items is the market leader. Adopted: pre-defined items with quantities, automatic total calculation, single-page checkout. Rejected: Stripe's tight coupling to their product catalog (our approach allows both catalog product references and freeform custom items). Also studied: **Shopify Buy Button** (embedded product checkout), **Gumroad** (digital product links).

### Relationship to Phase A

Phase B is an **additive extension** of Phase A. All Phase A code remains unchanged:

| Aspect | Phase A (unchanged) | Phase B (added) |
|--------|---------------------|-----------------|
| Entity discriminator | `checkoutType = 'pay_link'` | `checkoutType = 'simple_checkout'` |
| Pricing | Fixed / Custom Amount / Price List | Cart items with totals |
| Data model | `CheckoutLink`, `CheckoutTransaction` | + `CheckoutCartItem`, + quote/order FK columns |
| CrudForm | 10 groups (2-column) | + "Products" group |
| Pay page | Amount-based + legal-consent flow | Items review + totals + inherited legal-consent flow |
| Payment flow | Direct amount → adapter | Order total → adapter |
| Financial record | Transaction amount | Transaction + Quote + Order |

---

## Problem Statement

Phase A Pay Links handle single-amount payments well, but merchants need a way to:

1. **Sell specific items** — Bundle products or services with defined quantities and prices in a shareable checkout link.
2. **Create sales records** — Connect payments to proper sales orders for accounting, fulfillment, and reporting.
3. **Apply tax and pricing rules** — Use the platform's `salesCalculationService` for consistent tax handling, currency conversion, and adjustments.
4. **Track orders from checkout** — Correlate checkout transactions with sales orders, quotes, shipments, and invoices.

---

## Proposed Solution

Extend the `checkout` module with a `simple_checkout` link type that:
- Adds a `CheckoutCartItem` entity for pre-defined items on a link
- On checkout submit, creates a `SalesQuote` via existing sales command contracts
- On payment completion, converts the quote to a `SalesOrder`
- Stores `quoteId` and `orderId` on `CheckoutTransaction` for traceability

The pricing section on the pay page is replaced with an items table showing product names, quantities, unit prices, and totals — calculated by `salesCalculationService`.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  @open-mercato/checkout (Phase B additions)                            │
│                                                                        │
│  CheckoutCartItem ──────── defines items on a link                     │
│       │                                                                │
│       │ linked to                                                      │
│       ▼                                                                │
│  CheckoutLink (checkoutType = 'simple_checkout')                       │
│       │                                                                │
│       │ on checkout                                                    │
│       ▼                                                                │
│  ┌──────────────────────────────────────────────┐                      │
│  │ Checkout Flow:                                │                      │
│  │ 1. Create SalesQuote via command bus          │                      │
│  │ 2. Add line items from CheckoutCartItem       │                      │
│  │ 3. Calculate totals via salesCalculationSvc   │                      │
│  │ 4. Show one-page checkout (items + totals)    │                      │
│  │ 5. Customer pays (same adapter flow as A)     │                      │
│  │ 6. Convert quote → order on success           │                      │
│  └──────────────────────────────────────────────┘                      │
│                                                                        │
│  CheckoutTransaction                                                   │
│    + quoteId (FK → sales_quotes by ID)                                 │
│    + orderId (FK → sales_orders by ID)                                 │
└────────────────────────────────────────────────────────────────────────┘
          │                           │
          │ DI resolution             │ command bus
          ▼                           ▼
   salesCalculationService    `sales.quotes.create`
   (from sales module)        `sales.quotes.convert_to_order`
```

### Cross-Module Integration

| Direction | Mechanism | Detail |
|-----------|-----------|--------|
| Checkout → Sales (quote/order creation) | Existing command contracts | Execute `sales.quotes.create` and `sales.quotes.convert_to_order` through `commandBus` |
| Checkout → Sales (calculations) | DI-resolved service | `salesCalculationService` for totals, tax, adjustments |
| Checkout → Catalog (product refs) | FK IDs + API | Store `productId`/`variantId` as FK IDs; fetch product data via API or DI service |
| Checkout → Payment Gateways | Phase A generic descriptor surface | Reuse provider settings, supported-currency validation, and presentation capabilities |
| Sales → Checkout (traceability) | UMES widget injection | Inject "Created from Checkout" badge on order/quote detail if `metadata.sourceModule = 'checkout'` |

---

## Data Models

### Entity: CheckoutCartItem (NEW)

Table: `checkout_cart_items`

Pre-defined items on a simple checkout link. These define what the customer will purchase.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `organization_id` | uuid | NOT NULL | Tenant scope |
| `tenant_id` | uuid | NOT NULL | Tenant scope |
| `link_id` | uuid | NOT NULL | FK → `checkout_links` (by ID) |
| `product_id` | uuid | NULL | FK → `catalog_products` (by ID, no ORM relation) |
| `variant_id` | uuid | NULL | FK → `catalog_product_variants` (by ID) |
| `name` | varchar(255) | NOT NULL | Product/service name (snapshot or freeform) |
| `description` | text | NULL | Item description |
| `sku` | varchar(100) | NULL | SKU reference |
| `quantity` | integer | NOT NULL, DEFAULT `1` | |
| `unit_price` | decimal(12,2) | NOT NULL | |
| `currency_code` | varchar(3) | NOT NULL | ISO 4217 |
| `tax_rate` | decimal(5,2) | NULL | Tax rate percentage |
| `image_url` | varchar(500) | NULL | Product image URL |
| `sort_order` | integer | DEFAULT `0` | Display order |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |
| `deleted_at` | timestamptz | NULL | Soft delete to support undoable admin delete |

**Indexes:**
- Index: `(link_id, sort_order)`

**Currency rules**

- A simple checkout link MUST use a single checkout currency for all cart items.
- `CheckoutCartItem.currencyCode` is stored per row for snapshot clarity, but all active items on the same link must match.
- Admin create/update/reorder flows MUST reject mixed-currency carts.
- If a gateway provider is selected on the link, the cart currency MUST also be supported by that provider's published descriptor from `payment_gateways`.

### Entity Modifications: CheckoutTransaction (ADDITIVE)

New nullable columns on `checkout_transactions`:

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `quote_id` | uuid | NULL | FK → `sales_quotes` (by ID, no ORM relation) |
| `order_id` | uuid | NULL | FK → `sales_orders` (by ID, no ORM relation) |

These columns are `NULL` for `pay_link` type transactions and populated for `simple_checkout` type.

### Entity Modifications: CheckoutLink (NO CHANGES)

The `checkout_type` column already exists from Phase A with values `'pay_link'` | `'simple_checkout'`.

---

## Commands (Phase B Additions)

All **admin/backend mutations** introduced in Phase B remain undoable. Financial lifecycle commands inherited from Phase A remain intentionally non-undoable.

| Command | Undo | Notes |
|---------|------|-------|
| `checkout.cartItem.create` | Delete the created item | Add item to a simple checkout link |
| `checkout.cartItem.update` | Restore before snapshot | Update item details |
| `checkout.cartItem.delete` | Restore the item | Remove item from link |
| `checkout.cartItem.reorder` | Restore previous order | Change sort order of items |

The existing `checkout.transaction.create` command is extended (not replaced) to handle `simple_checkout` type:
- Creates a `SalesQuote` with line items from `CheckoutCartItem`
- Calculates totals via `salesCalculationService`
- Stores `quoteId` on the transaction

The existing `checkout.transaction.updateStatus` command is extended:
- On `completed` status for `simple_checkout` type: executes `sales.quotes.convert_to_order`, stores `orderId`
- On `failed` / `cancelled` / `expired`: triggers quote cleanup via existing sales command path and marks checkout-owned quotes as cancelled/abandoned

---

## Events (Phase B Additions)

```typescript
const additionalEvents = [
  { id: 'checkout.cartItem.created', label: 'Cart Item Created', entity: 'cartItem', category: 'crud' },
  { id: 'checkout.cartItem.updated', label: 'Cart Item Updated', entity: 'cartItem', category: 'crud' },
  { id: 'checkout.cartItem.deleted', label: 'Cart Item Deleted', entity: 'cartItem', category: 'crud' },
  { id: 'checkout.order.created', label: 'Checkout Order Created', entity: 'order', category: 'lifecycle', clientBroadcast: true },
] as const
```

---

## API Contracts (Phase B Additions)

### Admin API

`GET /api/checkout/links/:id/items` — List cart items for a link
- Features: `checkout.view`
- Response: Array of `CheckoutCartItem`

`POST /api/checkout/links/:id/items` — Add item to link
- Features: `checkout.edit`
- Body: `{ productId?, variantId?, name, description?, quantity, unitPrice, currencyCode, taxRate?, imageUrl? }`
- Validates: link `checkoutType = 'simple_checkout'`, link not locked, item currency matches the link's existing cart currency, and selected gateway provider supports that currency when configured

`PUT /api/checkout/links/:id/items/:itemId` — Update item
- Features: `checkout.edit`

`DELETE /api/checkout/links/:id/items/:itemId` — Remove item
- Features: `checkout.edit`

`PUT /api/checkout/links/:id/items/reorder` — Reorder items
- Features: `checkout.edit`
- Body: `{ itemIds: string[] }` — ordered array of item IDs

### Public API (Extensions)

`GET /api/checkout/pay/:slug` — Extended response for `simple_checkout` type:
```json
{
  "checkoutType": "simple_checkout",
  "items": [
    {
      "id": "uuid",
      "name": "Premium Widget",
      "description": "High-quality widget",
      "quantity": 2,
      "unitPrice": 49.99,
      "currencyCode": "USD",
      "imageUrl": "https://...",
      "lineTotal": 99.98
    }
  ],
  "subtotal": 99.98,
  "taxTotal": 20.00,
  "total": 119.98,
  "currencyCode": "USD"
}
```

`POST /api/checkout/pay/:slug/submit` — Extended for `simple_checkout`:
- Body: same customer data (no cart manipulation — items are pre-defined by admin)
- Server calculates totals from `CheckoutCartItem` via `salesCalculationService`
- Server re-validates that all cart items share one currency and that the selected gateway provider supports that currency
- Creates `SalesQuote` → payment session with order total
- On webhook completion: converts quote → order

---

## UI/UX (Phase B Additions)

### CrudForm: "Products" Group

Uses the same `CrudForm` instance as Phase A with an additional group. The `checkoutType` field value controls group visibility — when `'simple_checkout'`, the Products group is shown and the Pricing group is hidden.

The Products group uses `column: 1` (full-width main content area) since it contains a wide items table that benefits from spanning the full form width.

Visible only when `checkoutType = 'simple_checkout'`. Contains:
- **Product Selector**: Search catalog products by name/SKU or add custom freeform item
- **Items Table**: Sortable list with columns: Image, Name, SKU, Quantity, Unit Price, Tax Rate, Line Total
- **Add Item Button**: Opens product search dialog or freeform item form
- **Totals Summary**: Subtotal, Tax, Grand Total (calculated by `salesCalculationService`)
- **Pricing group hidden**: When `checkoutType = 'simple_checkout'`, the Pricing group is hidden since pricing comes from items

**Wireframe:** See [Products Group wireframe](./2026-03-19-checkout-simple-checkout-wireframes.md#products-group)

**Wireframe:** See [Add Product Dialog wireframe](./2026-03-19-checkout-simple-checkout-wireframes.md#add-product-dialog)

### Public Pay Page: Cart View

For `simple_checkout` links, the pricing section is replaced with:

1. **Items Table** — Product image, name, quantity, unit price, line total per item
2. **Totals Section** — Subtotal, tax breakdown, grand total
3. **Customer Form** — Same as Phase A (shared component)
4. **Payment Section** — Same as Phase A (shared component, uses order total)

**Wireframe:** See [Public Pay Page: Cart View wireframe](./2026-03-19-checkout-simple-checkout-wireframes.md#public-pay-page-cart-view)

### UMES Extension Points (Phase B Additions)

| Spot ID | Location | Context |
|---------|----------|---------|
| `checkout.pay-page:items:before` | Before items table on checkout page | `{ link, items }` |
| `checkout.pay-page:items:after` | After items table | `{ link, items, totals }` |
| `checkout.pay-page:totals:before` | Before totals section | `{ link, totals }` |
| `checkout.pay-page:totals:after` | After totals section | `{ link, totals }` |

**Component replacement handles (Phase B additions)**

| Handle | Component | Purpose |
|--------|-----------|---------|
| `section:checkout.pay-page.items` | `PayPageItemsTable` | Replace/wrap items table |
| `section:checkout.pay-page.totals` | `PayPageTotals` | Replace/wrap totals block |
| `section:checkout.pay-page.cart-summary` | `PayPageCartSummary` | Replace/wrap combined cart summary shell |

Phase B inherits all Phase A pay-page spots and replacement handles, including exported default components for wrapper/replace/eject-style customization.

### Sales Module Widgets (via UMES)

Checkout injects into sales module:
- **Order detail page**: Badge showing "Created from Checkout Link: {linkName}" with link to checkout transaction
- **Quote detail page**: Same badge
- **Orders DataTable**: Optional column "Source" showing "Checkout" for checkout-originated orders

**Wireframe:** See [Order Detail Page — Checkout Source Badge wireframe](./2026-03-19-checkout-simple-checkout-wireframes.md#order-detail-page----checkout-source-badge)

**Wireframe:** See [Orders DataTable — Source Column wireframe](./2026-03-19-checkout-simple-checkout-wireframes.md#orders-datatable----source-column)

---

## Payment Flow (Simple Checkout)

```
Customer visits /pay/[slug] (simple_checkout type)
         │
         ▼
  Load pay page with items, calculate totals preview
  (salesCalculationService via API, no quote persisted)
         │
         ▼
  Customer reviews items + fills customer form
         │
         ▼
  Submit (POST /api/checkout/pay/:slug/submit)
         │
         ▼
  ┌─────────────────────────────────────────────┐
  │  Server-side:                                │
  │  1. Validate customer fields                 │
  │  2. Create SalesQuote via commandBus         │
  │     (`sales.quotes.create`)                  │
  │  3. Calculate totals via salesCalcService    │
  │  4. Create CheckoutTransaction               │
  │     (status: processing, quoteId: quote.id)  │
  │  5. Create payment session (total = order    │
  │     total from calculation)                  │
  └───────────────────┬─────────────────────────┘
                      │
                      ▼
  Customer pays (same flow as Phase A)
         │
         ▼
  Webhook: payment completed
         │
         ▼
  ┌─────────────────────────────────────────────┐
  │  Server-side:                                │
  │  1. Update transaction status → completed    │
  │  2. Convert SalesQuote → SalesOrder          │
  │     via `sales.quotes.convert_to_order`      │
  │  3. Store orderId on transaction             │
  │  4. Emit checkout.order.created event        │
  └─────────────────────────────────────────────┘
```

---

## Security & Access (Phase B Additions)

Phase B inherits all Phase A public-flow protections and adds these rules:

1. **No quote creation on GET**: public page loads and totals previews must not persist `SalesQuote` rows.
2. **Server-authoritative totals**: product snapshots, taxes, discounts, shipping, and payment totals used for the payment session are recalculated on submit; preview totals are informational only.
3. **No public cart mutation**: public APIs cannot add/remove/reprice line items; only admin APIs manage `CheckoutCartItem`.
4. **Submit idempotency remains mandatory**: repeated submits with the same key must reuse the existing quote/transaction/session instead of creating duplicates.
5. **Quote/order tenant isolation**: checkout may only create, read, or convert sales documents inside the same `organizationId` / `tenantId`.
6. **Password/session inheritance**: password-protected simple checkout links require the same slug-bound access session for page load, submit, status, success, and cancel flows.
7. **Legal-consent inheritance**: Terms & Conditions / Privacy Policy markdown documents and required acceptance rules defined in Phase A continue to apply to simple checkout links, and acceptance proof remains stored on the checkout transaction.
8. **Sales-side data minimization**: checkout-specific customer data copied into quote/order metadata must avoid storing unnecessary PII outside the encrypted checkout transaction unless required by sales document rules.
9. **Search hygiene**: any checkout-derived fields added to sales metadata or search presenters must exclude or hash PII; Phase B must not make customer-entered checkout data searchable by default.

### Admin Access Control

- Admin cart-item APIs reuse existing checkout admin features: `checkout.view`, `checkout.edit`
- Sales widgets injected by checkout only render when the viewer also has the relevant `sales.*.view` permission for the host page

---

## Seeding (Phase B Additions)

**Example templates:**
- "Product Bundle" — Simple checkout, 3 items (Widget A $29, Widget B $49, Service Fee $15), unlimited completions

**Example links:**
- "Spring Sale Bundle" — From template, slug: `spring-bundle`, 3 items with catalog product references (if catalog has seeded products) or freeform items

---

## Documentation Requirements

When Phase B is implemented, docs MUST be extended alongside the code.

Required deliverables:
- update `packages/checkout/README.md` with Simple Checkout scope and Phase A vs Phase B differences
- product/admin docs for:
  - creating simple checkout links
  - managing products/cart items
  - single-currency cart rules
  - quote/order lifecycle from checkout
  - failure/expiry cleanup behavior
- developer docs for:
  - inherited and new UMES spots/handles for cart pages
  - exported cart components and supported wrapper/replace/eject-style customization path
  - interaction with sales commands and payment-gateway descriptors
- integration docs describing:
  - how Phase B reuses the Phase A generic payment-gateway descriptor surface
  - how currency validation works for carts
  - what sales metadata / traceability fields are written
- API/OpenAPI docs for cart-item endpoints and Phase B response additions

Preferred doc locations:
- extend `packages/checkout/README.md`
- extend checkout framework docs under `apps/docs/docs/framework/modules/checkout*.mdx` or equivalent
- extend any relevant sales/checkout integration handbook pages where cross-module behavior is important

## Implementation Plan

### Phase B.1: Cart Item Entity & Admin CRUD
1. Create `CheckoutCartItem` MikroORM entity
2. Add `quoteId`, `orderId` nullable columns to `CheckoutTransaction` migration
3. Create cart item commands (create/update/delete/reorder) with undo
4. Create cart item API routes with OpenAPI
5. Enforce single-currency cart validation and gateway-supported-currency validation on admin item mutations
6. Add "Products" group to `LinkTemplateForm` (conditional on `checkoutType`, `column: 1`)
7. Add product search/selector component
8. Hide Pricing group for `simple_checkout` type

### Phase B.2: Quote/Order Integration
1. Wire `salesCalculationService` resolution via DI
2. Reuse the Phase A payment-gateway descriptor surface to validate cart currency and presentation mode before session creation
3. Implement quote creation from cart items on checkout submit via `commandBus.execute('sales.quotes.create', ...)`
4. Implement quote → order conversion on payment completion via `commandBus.execute('sales.quotes.convert_to_order', ...)`
5. Store `quoteId`/`orderId` on transaction
6. Implement quote cleanup for failed / cancelled / expired checkout transactions
7. Add UMES widgets to sales order/quote detail pages

### Phase B.3: Public Checkout Page
1. Create cart view components (items table, totals section)
2. Export default cart view components and stable props contracts for wrapper/replace/eject-style customization
3. Extend public pay page to show cart view for `simple_checkout`
4. Extend public API to return items and calculated totals
5. Extend submit endpoint for `simple_checkout` flow

### Phase B.4: Testing & Polish
1. Integration tests for cart item CRUD
2. Integration tests for checkout → quote → order flow
3. Integration tests for totals calculation
4. Integration tests proving GET preview does not create quotes
5. Integration tests for duplicate submit idempotency and password/session inheritance
6. Integration tests for mixed-currency rejection and gateway-supported-currency enforcement
7. Integration tests for key cart-section replacement/extension paths
8. Integration tests for inherited required terms/privacy consent flow on simple checkout
9. Seed examples for simple checkout
10. i18n translations for new strings
11. Extend package README and framework/developer docs for Simple Checkout

---

## Integration Test Coverage (Phase B)

| Test ID | Scenario | API/UI Path |
|---------|----------|-------------|
| TC-CHKT-B01 | Create simple checkout link with items | `POST /api/checkout/links` + `POST items` |
| TC-CHKT-B02 | Add/update/delete cart items | Cart item CRUD endpoints |
| TC-CHKT-B03 | Reorder cart items | `PUT /api/checkout/links/:id/items/reorder` |
| TC-CHKT-B04 | Public page shows items and totals | `GET /api/checkout/pay/:slug` |
| TC-CHKT-B05 | Submit creates quote | `POST /submit` → verify quote created |
| TC-CHKT-B06 | Payment completion creates order | Webhook → verify order created |
| TC-CHKT-B07 | Transaction detail shows quote/order links | `GET /api/checkout/transactions/:id` |
| TC-CHKT-B08 | Order detail shows checkout source badge | Navigate to order, verify badge |
| TC-CHKT-B09 | Products group hidden for pay_link type | Create pay_link, verify no Products group |
| TC-CHKT-B10 | Pricing group hidden for simple_checkout type | Create simple_checkout, verify no Pricing group |
| TC-CHKT-B11 | GET preview does not create a quote | `GET /api/checkout/pay/:slug` then assert no new sales quote |
| TC-CHKT-B12 | Duplicate submit with same idempotency key reuses quote/session | Repeat `POST /submit` |
| TC-CHKT-B13 | Expired or failed checkout cancels cleanup quote | Expire transaction → verify quote cleanup |
| TC-CHKT-B14 | Password-protected checkout requires verified session on submit/status/success | Public guarded flow |
| TC-CHKT-B15 | Mixed-currency cart is rejected in admin APIs | `POST/PUT /api/checkout/links/:id/items` |
| TC-CHKT-B16 | Submit rejects cart currency unsupported by selected gateway provider | `POST /api/checkout/pay/:slug/submit` |
| TC-CHKT-B17 | Items/totals section wrapper or replacement can customize presentation without changing totals integrity | UMES component replacement test |
| TC-CHKT-B18 | Simple checkout inherits required terms/privacy consent gating and stores acceptance proof | Public submit flow + transaction detail |

---

## Risks & Impact Review

#### Sales Module Coupling

- **Scenario**: Sales module changes its quote/order creation API or calculation service signature, breaking the checkout integration.
- **Severity**: Medium
- **Affected area**: Simple checkout quote/order creation
- **Mitigation**: Checkout uses existing sales command contracts plus `salesCalculationService`, which is already registered in DI. Integration tests verify the end-to-end flow.
- **Residual risk**: Low — DI indirection + integration tests catch regressions.

#### Product Price Drift

- **Scenario**: A catalog product's price changes after it was added to a checkout link. Customer pays the old price.
- **Severity**: Medium
- **Affected area**: Pricing accuracy
- **Mitigation**: `CheckoutCartItem` stores a **snapshot** of the price at link creation time (`unitPrice` column). The price used for checkout is always from the cart item, not re-fetched from the catalog. This is intentional — the merchant explicitly set the checkout price.
- **Residual risk**: Merchants must manually update cart item prices if catalog prices change. This is the expected behavior (same as Stripe Checkout).

#### Quote/Order Orphaning

- **Scenario**: Checkout creates a quote but the customer abandons payment. The quote remains in the system without an associated order.
- **Severity**: Low
- **Affected area**: Data cleanliness in sales module
- **Mitigation**: The `transaction-expiry` worker (Phase A) handles expiration. On transaction expiry for `simple_checkout` type, the associated quote is cancelled (via sales command). Orphaned quotes are identifiable by `metadata.sourceModule = 'checkout'` and `status = 'cancelled'`.
- **Residual risk**: Brief window where a pending quote exists. Acceptable — same behavior as abandoned shopping carts in e-commerce.

#### Quote Spam / GET Side Effects

- **Scenario**: Refreshing or bot-crawling a public checkout URL creates many quotes if quote creation happens during page load.
- **Severity**: High
- **Affected area**: Sales data quality, abuse resistance
- **Mitigation**: Phase B explicitly forbids quote creation on GET. Quotes are created only during authenticated submit flow with idempotency protection.
- **Residual risk**: Low — abuse now requires repeated POSTs and is constrained by rate limiting + idempotency.

#### Totals Calculation Consistency

- **Scenario**: The totals shown on the public checkout page differ from the totals calculated at payment time due to race conditions or stale data.
- **Severity**: High
- **Affected area**: Customer trust, financial accuracy
- **Mitigation**: Totals are always recalculated server-side at submit time using `salesCalculationService`. The displayed totals are for preview only. If the recalculated total differs (e.g., tax rule changed), the customer sees the updated total before payment is initiated.
- **Residual risk**: None — server is authoritative for payment amounts.

---

## Migration & Backward Compatibility

Phase B remains additive to Phase A:

- adds a new checkout-owned table: `checkout_cart_items`
- adds nullable `quote_id` / `order_id` columns to `checkout_transactions`
- extends existing checkout APIs with additive fields for `simple_checkout`
- consumes existing sales command contracts plus `salesCalculationService` without changing their signatures
- reuses the Phase A generic payment-gateway descriptor surface; introduces no further `payment_gateways` contract changes

No existing checkout, sales, or payment gateway route is renamed or removed.

---

## Final Compliance Report — 2026-03-19

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `quoteId`/`orderId` are FK IDs, no ORM relations |
| root AGENTS.md | Filter by organization_id | Compliant | All queries tenant-scoped |
| root AGENTS.md | Write operations via Command pattern | Compliant | Cart item commands with undo |
| root AGENTS.md | Event IDs: module.entity.action | Compliant | checkout.cartItem.created, checkout.order.created |
| core AGENTS.md | No direct ORM relationships between modules | Compliant | Catalog product refs via FK IDs |
| sales AGENTS.md | Use salesCalculationService for math | Compliant | Resolved via DI |
| BC contract | Database schema ADDITIVE-ONLY | Compliant | New table + new nullable columns only |
| BC contract | Event IDs FROZEN | Compliant | New events only |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Cart items, extended transaction, extended public response |
| Phase A entities unchanged | Pass | Only additive nullable columns on CheckoutTransaction |
| Commands defined for all admin mutations | Pass | 4 undoable cart-item commands + extended non-undoable transaction lifecycle commands |
| Risks cover sales integration points | Pass | Coupling, price drift, orphaning, totals consistency |

### Verdict

**Fully compliant** — Approved for implementation (after Phase A).

---

## Changelog

### 2026-03-19
- Initial specification created as companion to Phase A (Pay Links)
- Defined cart item entity and transaction extensions (additive-only)
- Defined quote → order flow via existing sales commands + `salesCalculationService`
- Defined UI extensions (Products group, cart view on pay page)
- Defined implementation plan (4 sub-phases)
- Expanded security and abuse-prevention coverage, including no-quote-on-GET and submit idempotency
- Completed compliance review
