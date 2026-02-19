# SPEC-030: Ecommerce Cart, Checkout & Per-Channel Catalog Filtering

**Date**: 2026-02-18
**Status**: Implemented
**Extends**: SPEC-029 (Ecommerce Storefront Module)
**Related Issues**: #289

---

## 1) TLDR

Extends SPEC-029 with:
1. **Per-channel catalog filtering**: apply `EcommerceStoreChannelBinding.catalogScope` to restrict visible products per store channel, and apply `priceKindId` to use channel-designated price lists.
2. **Token-based shopping cart**: guest + authenticated, stored in `ecommerce_carts` + `ecommerce_cart_lines`. Price snapshots captured at add-to-cart time.
3. **Checkout**: creates a `SalesOrder` (with lines) in the existing sales module. Cart marked as `converted`.

No payment gateway integration in this spec. Cart → Order is the complete flow.

---

## 2) Overview

SPEC-029 delivered Phases 1–4: core module, public catalog APIs, admin UI, and storefront app. The storefront now shows products and categories. This spec adds:

- **Catalog scope** — when a store has a channel binding, the binding's `catalogScope` restricts which products are exposed. `priceKindId` restricts which price list is used.
- **Cart API** — public (no auth) endpoints: create cart, add/update/remove lines, checkout.
- **Cart UI** — CartSidebar, AddToCartButton, CartIcon, `/cart` page, `/checkout` page, order confirmation.

---

## 3) Problem Statement

Currently:
- `EcommerceStoreChannelBinding.catalogScope` (JSONB) is persisted but never applied — all active products are always visible regardless of channel restrictions.
- `EcommerceStoreChannelBinding.priceKindId` is persisted but ignored — all price kinds are considered.
- There is no cart — shoppers cannot add products or place orders from the storefront.
- The `SalesOrder` creation path exists in the sales module but has never been called from the storefront.

---

## 4) Goals

- Apply `catalogScope` from the store's channel binding to product listing and detail APIs.
- Apply `priceKindId` from the channel binding to price resolution.
- Provide a token-based cart that works for guests and logged-in users interchangeably.
- On checkout, create a `SalesOrder` + `SalesOrderLine[]` in the sales module scoped to the channel.
- Provide cart UI components in `apps/storefront/`.

---

## 5) Non-Goals

- Payment gateway integration (Stripe, PayU, etc.)
- Inventory reservation or stock checks at cart time
- Tax calculation during checkout (order totals are stored as-is from cart lines)
- Customer account registration / login from the storefront
- Coupon / promotion codes
- Address validation

---

## 6) Architecture

```
apps/storefront/                           packages/core/modules/ecommerce/
─────────────────────────────────────      ──────────────────────────────────────
CartContext.tsx ←─── useCart hook          lib/storefrontCart.ts
  ├── localStorage: om_cart_token            resolveCartByToken()
  ├── addLine()     ─────────────────────►   formatCartDto()
  ├── updateLine()
  ├── removeLine()  ─────────────────────►  api/storefront/cart/route.ts
  └── checkout()    ─────────────────────►  api/storefront/cart/lines/route.ts
                                            api/storefront/cart/lines/[lineId]/route.ts
CartSidebar ◄─── CartContext               api/storefront/cart/checkout/route.ts
AddToCartButton                               └── em.create(SalesOrder)
CartIcon (header)                              └── em.create(SalesOrderLine[])
/cart page
/checkout page
/order-confirmation page

Product listing / detail:
  lib/storefrontProducts.ts ── resolveChannelScopeIds() ── catalogScope applied
  lib/storefrontDetail.ts  ── filterByPriceKind()      ── priceKindId applied
```

---

## 7) Data Models

### 7.1 `EcommerceCart` (new entity, table `ecommerce_carts`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | tenant scope |
| `tenant_id` | uuid | tenant scope |
| `store_id` | uuid | FK → `ecommerce_stores` |
| `token` | uuid | globally unique, client identifier |
| `status` | text | `active \| converted \| abandoned` |
| `currency_code` | text | copied from store at creation |
| `locale` | text nullable | effective locale at creation |
| `converted_order_id` | uuid nullable | set after successful checkout |
| `metadata` | jsonb nullable | |
| `expires_at` | timestamptz nullable | optional TTL |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Indexes: `(tenant_id, store_id)`, unique on `token`.

### 7.2 `EcommerceCartLine` (new entity, table `ecommerce_cart_lines`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `organization_id` | uuid | |
| `tenant_id` | uuid | |
| `cart_id` | uuid | FK → `ecommerce_carts` |
| `product_id` | uuid | catalog product reference |
| `variant_id` | uuid nullable | catalog variant reference |
| `quantity` | integer | ≥ 1 |
| `unit_price_net` | numeric(19,4) nullable | snapshot at add time |
| `unit_price_gross` | numeric(19,4) nullable | snapshot at add time |
| `currency_code` | text nullable | |
| `title_snapshot` | text nullable | product title at add time |
| `sku_snapshot` | text nullable | |
| `image_url_snapshot` | text nullable | |
| `metadata` | jsonb nullable | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Index: `(cart_id)`.

### 7.3 `catalogScope` JSONB schema (existing field, now applied)

```typescript
type CatalogScope = {
  categoryIds?: string[]        // restrict to products in these categories (incl. descendants)
  tagIds?: string[]             // additionally restrict to products with these tags
  excludeProductIds?: string[]  // always exclude specific product IDs
}
```

All fields are optional. Multiple fields are intersected: `categoryIds AND tagIds`. `excludeProductIds` is always subtracted.

---

## 8) API Contracts

### 8.1 Channel filtering (existing endpoints — behavior change)

`GET /api/ecommerce/storefront/products` and `GET /api/ecommerce/storefront/products/[idOrHandle]` and `GET /api/ecommerce/storefront/categories/[slug]`:
- **Before**: show all active products regardless of channel binding.
- **After**: when `storeCtx.channelBinding` is set, apply `catalogScope` restrictions and `priceKindId` price filter before returning results.
- Response schemas unchanged. Clients see fewer products when scope is configured.

### 8.2 Cart API (new endpoints)

All cart endpoints: `requireAuth: false`. Token passed via `X-Cart-Token` header or `?cartToken=` query param.

#### `GET /api/ecommerce/storefront/cart`
Retrieve cart by token.

Query: `storeSlug?`, `tenantId?`, `cartToken` (required)

Response `200`:
```typescript
{
  id: string
  token: string
  status: 'active' | 'converted' | 'abandoned'
  currencyCode: string
  locale: string | null
  lines: Array<{
    id: string
    productId: string
    variantId: string | null
    quantity: number
    unitPriceNet: string | null
    unitPriceGross: string | null
    currencyCode: string | null
    titleSnapshot: string | null
    skuSnapshot: string | null
    imageUrlSnapshot: string | null
  }>
  itemCount: number         // sum of quantities
  subtotalGross: string | null  // sum of unitPriceGross * quantity
}
```

Errors: `404` Cart not found.

#### `POST /api/ecommerce/storefront/cart`
Create a new cart for this store.

Body: `{ storeSlug?: string, tenantId?: string }`

Response `201`:
```typescript
{ token: string, cart: CartDto }
```

#### `POST /api/ecommerce/storefront/cart/lines`
Add a product to the cart. If `productId + variantId` combination already exists in cart, quantities are summed.

Headers: `X-Cart-Token: <uuid>`

Body:
```typescript
{
  productId: string        // uuid
  variantId?: string       // uuid or null
  quantity: number         // ≥ 1
  storeSlug?: string
  tenantId?: string
}
```

Price snapshot is captured from `catalogPricingService` at add time (same resolution as product listing, including `priceKindId` filter).

Response `200`: full `CartDto`

Errors: `400` Missing/invalid fields, `404` Cart or product not found.

#### `PUT /api/ecommerce/storefront/cart/lines/[lineId]`
Update line quantity. Setting `quantity` to `0` removes the line.

Headers: `X-Cart-Token: <uuid>`

Body: `{ quantity: number }`

Response `200`: full `CartDto`

#### `DELETE /api/ecommerce/storefront/cart/lines/[lineId]`
Remove a line from cart.

Headers: `X-Cart-Token: <uuid>`

Response `200`: full `CartDto`

#### `POST /api/ecommerce/storefront/cart/checkout`
Convert cart to SalesOrder. Cart must be `active` with at least one line. Store must have a channel binding.

Headers: `X-Cart-Token: <uuid>`

Body:
```typescript
{
  storeSlug?: string
  tenantId?: string
  customerInfo: {
    name: string
    email: string
    phone?: string | null
  }
  shippingAddress?: {
    line1: string
    line2?: string | null
    city?: string | null
    region?: string | null
    postalCode?: string | null
    country?: string | null
  } | null
}
```

Behavior:
1. Loads cart + lines
2. Creates `SalesOrder` with `channelId` from store binding, `currencyCode` from cart, `customerSnapshot: { name, email, phone }`, `shippingAddressSnapshot` if provided
3. Creates `SalesOrderLine[]` (one per cart line, `kind: 'product'`)
4. Sets `cart.status = 'converted'`, `cart.convertedOrderId = order.id`
5. Flushes in a single `em.flush()`

Response `200`:
```typescript
{ orderId: string }
```

Errors:
- `400` Cart empty or already converted
- `404` Cart or store not found
- `422` Store has no channel binding (cannot create order without channel)

---

## 9) Implementation Details

### 9.1 Channel scope filtering (`lib/storefrontProducts.ts`)

New helper `resolveChannelScopeIds()`:
- Reads `storeCtx.channelBinding?.catalogScope`
- If `categoryIds` present: load category assignments for those IDs (+ descendants) → build ID set
- If `tagIds` present: load tag assignments → build ID set
- Intersect all sets (AND semantics)
- After the main `resolveProductIds()` intersection, intersect with scope result
- If `excludeProductIds` present: subtract from final set before passing to `baseWhere`

New helper `filterByPriceKind(prices: PriceRow[], priceKindId: string | null)`:
- When `priceKindId` is non-null: filter `prices` to those where `price.priceKind?.id === priceKindId`
- If the filter yields no prices, fall back to all prices (defensive — prevents accidental empty catalog)
- Apply to `priceCandidates` before every `pricingService.resolvePrice()` call

### 9.2 Price kind filtering (`lib/storefrontDetail.ts`)

Same `filterByPriceKind()` applied to:
- `productLevelPrices` (line 237 in current file)
- `variantCandidates` inside the variant loop (line 242)
- `relatedPrices` for related products

### 9.3 Cart creation flow

```
POST /api/ecommerce/storefront/cart
  → resolveStoreFromRequest()
  → em.create(EcommerceCart, { token: randomUUID(), status: 'active', storeId, currencyCode, locale, organizationId, tenantId })
  → em.flush()
  → return { token, cart: formatCartDto(cart, []) }
```

### 9.4 Add-to-cart flow

```
POST /api/ecommerce/storefront/cart/lines
  → resolveCartByToken(em, token, organizationId, tenantId)
  → resolveStoreFromRequest() [to get pricingCtx]
  → fetch product + variant [for snapshots]
  → resolve price via pricingService (with priceKindId filter)
  → check existing line (same productId + variantId) → upsert quantity
  → em.flush()
  → return formatCartDto(cart, allLines)
```

### 9.5 Checkout flow

```
POST /api/ecommerce/storefront/cart/checkout
  → resolveStoreFromRequest()
  → if (!channelBinding) → 422
  → resolveCartByToken()
  → if (cart.status !== 'active' || lines.length === 0) → 400
  → em.create(SalesOrder, { organizationId, tenantId, channelId: binding.salesChannelId, currencyCode: cart.currencyCode, customerSnapshot, shippingAddressSnapshot, metadata: { sourceCartId: cart.id } })
  → lines.forEach(line => em.create(SalesOrderLine, { order, kind: 'product', productId, productVariantId, title: titleSnapshot, sku: skuSnapshot, quantity, unitPriceGross, unitPriceNet, currencyCode }))
  → cart.status = 'converted'; cart.convertedOrderId = order.id
  → await em.flush()
  → return { orderId: order.id }
```

### 9.6 Storefront cart state management

`CartContext` (React context):
- Token persisted in `localStorage['om_cart_token']`
- On mount: if token exists, `GET /api/ecommerce/storefront/cart?cartToken=<token>` to restore cart
- If no token: POST `/api/ecommerce/storefront/cart` to create one, store token
- All mutation methods (`addLine`, `updateLine`, `removeLine`) update state optimistically after API response
- `isOpen` controls `CartSidebar` visibility
- `itemCount` = `cart.lines.reduce((sum, l) => sum + l.quantity, 0)`

---

## 10) File Manifest

### Core module (`packages/core/src/modules/ecommerce/`)

| File | Change |
|------|--------|
| `data/entities.ts` | Add `EcommerceCart`, `EcommerceCartLine` |
| `lib/storefrontProducts.ts` | Add `resolveChannelScopeIds()`, `filterByPriceKind()`, apply both |
| `lib/storefrontDetail.ts` | Apply `filterByPriceKind()` |
| `lib/storefrontCart.ts` | **New**: cart helpers |
| `api/storefront/cart/route.ts` | **New**: GET/POST cart |
| `api/storefront/cart/lines/route.ts` | **New**: POST add line |
| `api/storefront/cart/lines/[lineId]/route.ts` | **New**: PUT/DELETE line |
| `api/storefront/cart/checkout/route.ts` | **New**: POST checkout |

### Storefront app (`apps/storefront/src/`)

| File | Change |
|------|--------|
| `lib/api.ts` | Add `storefrontPost/Put/Delete`, cart API helpers |
| `lib/CartContext.tsx` | **New**: cart state provider |
| `app/layout.tsx` | Wrap in `CartProvider` |
| `components/CartIcon.tsx` | **New**: header icon with count badge |
| `components/CartSidebar.tsx` | **New**: slide-over cart panel |
| `components/CartLine.tsx` | **New**: single cart line |
| `components/AddToCartButton.tsx` | **New**: PDP add-to-cart button |
| `components/StorefrontHeader.tsx` | Add `CartIcon` |
| `app/products/[handle]/page.tsx` | Add `AddToCartButton` |
| `app/cart/page.tsx` | **New**: full cart page |
| `app/checkout/page.tsx` | **New**: checkout form |
| `app/order-confirmation/page.tsx` | **New**: success page |

---

## 11) Migration

Run `yarn db:generate` after entity changes to generate:
- `ecommerce_carts` table migration
- `ecommerce_cart_lines` table migration

---

## 12) Integration Test Coverage

| Scenario | API Path |
|----------|----------|
| catalogScope restricts visible products | `GET /api/ecommerce/storefront/products` |
| priceKindId returns correct price | `GET /api/ecommerce/storefront/products/:id` |
| Create cart → receive token | `POST /api/ecommerce/storefront/cart` |
| Add line → cart has 1 line | `POST /api/ecommerce/storefront/cart/lines` |
| Add same product → quantity summed | `POST /api/ecommerce/storefront/cart/lines` |
| Update quantity | `PUT /api/ecommerce/storefront/cart/lines/:id` |
| Remove line | `DELETE /api/ecommerce/storefront/cart/lines/:id` |
| Checkout → SalesOrder created | `POST /api/ecommerce/storefront/cart/checkout` |
| Checkout on empty cart → 400 | `POST /api/ecommerce/storefront/cart/checkout` |
| Checkout without channel → 422 | `POST /api/ecommerce/storefront/cart/checkout` |

---

## 13) Risks & Impact

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `catalogScope` filter excludes all products for a misconfigured channel | Medium | `resolveChannelScopeIds()` returns `null` when scope is empty/null, so no restriction. Admin can verify via store context API. |
| `priceKindId` filter finds no matching prices → empty pricing | Medium | `filterByPriceKind()` falls back to all prices when none match the kind. Log a warning. |
| Cart token collision | Low | UUID v4 → ~10^38 combinations, negligible risk |
| Cart checkout without `SalesOrderLine` totals | Low | Totals are set to null/zero; sales module admin can adjust. Tax is out of scope. |
| Old cart tokens in localStorage pointing to expired carts | Low | `GET /api/ecommerce/storefront/cart` returns 404 → frontend creates new cart + new token |

---

## 14) Final Compliance Report

- All new API routes export `openApi` ✓
- All routes are `requireAuth: false` for cart endpoints ✓
- All queries scope by `organizationId` + `tenantId` ✓
- No cross-module ORM relations (cart uses UUID refs to `CatalogProduct`) ✓
- No hand-written migrations (entities only, `yarn db:generate`) ✓
- `apps/storefront/` has no `@open-mercato/core` dependency ✓

---

## 15) Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-02-18 | Claude | Initial draft: per-channel filtering + cart/checkout spec |
