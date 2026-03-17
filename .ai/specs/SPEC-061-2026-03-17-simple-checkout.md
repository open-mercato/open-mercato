# SPEC-061 — Simple Checkout (Single-Page Checkout Links)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-17 |
| **Author** | Piotr Karwatka |
| **Module** | `simple_checkout` |
| **Depends on** | SPEC-058 (Pay Links / Payment Gateways), SPEC-060 (Customer Identity), `sales`, `catalog`, `payment_link_pages` |

---

## 1. Problem Statement

Merchants need a way to sell individual products (or custom services) via a shareable link — without requiring customers to browse a full storefront. Current pay-by-links (SPEC-058) only handle payment for existing orders. There is no way to create a self-service checkout that lets a customer:

1. View a product with variant/option selection
2. Enter shipping details
3. See real-time totals (taxes, shipping, discounts)
4. Pay — all on a single page

This is critical for:
- Service businesses selling one-off packages
- Social commerce (share a link on Instagram/WhatsApp)
- B2B custom quotes sent as checkout links
- Pop-up / event sales with minimal setup

## 2. Goals

- **Admin**: Configure multiple checkout pages, each tied to a product (catalog or ad-hoc), with selected payment methods, branding, and optional fields.
- **Customer**: Single-page experience — select variant, fill details, pay.
- **Architecture**: Fully ejectable module (`simple_checkout`), 100% UMES-customizable (widgets, component replacement, injection slots).
- **MVP scope**: Single-product checkout. Multi-product cart support designed in schema but deferred to Phase 3.

## 3. Non-Goals (v1)

- Full storefront / product listing page
- Discount code / coupon entry (Phase 3)
- Subscription / recurring payments
- Guest checkout without any customer info capture (we always capture email minimum)
- Multi-currency per checkout (uses channel currency)

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Admin (Backend)                        │
│  Configure Checkout → Select Product → Payment Options   │
│  → Appearance → Generate Link                            │
└────────────────────────┬────────────────────────────────┘
                         │ creates SimpleCheckout entity
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Public Checkout Page (Frontend)              │
│  /checkout/{slug}                                        │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐  │
│  │ Product  │→ │ Customer │→ │Shipping│→ │  Payment  │  │
│  │ Options  │  │  Info    │  │        │  │           │  │
│  └─────────┘  └──────────┘  └────────┘  └───────────┘  │
│       ↓             ↓            ↓            ↓          │
│                   Quote (cart)                            │
│                      → Order                             │
│                         → Payment (via gateway)          │
└─────────────────────────────────────────────────────────┘
```

### Module Location

`packages/core/src/modules/simple_checkout/`

This is a core module (not an integration provider) because it orchestrates sales, catalog, and payment gateway interactions.

### Data Flow

1. **Admin creates** a `SimpleCheckout` configuration (product, payment methods, appearance)
2. **System generates** a unique slug/URL
3. **Customer opens** the link → public frontend page renders
4. **Customer selects** variant/options → system creates a `Quote` draft via `salesCalculationService`
5. **Customer fills** contact info + shipping → quote is updated with shipping/tax calculations
6. **Customer pays** → quote converts to `Order` → payment initiated via payment gateway (SPEC-058)
7. **On success** → order confirmed, confirmation page shown, events emitted

## 5. Data Model

### 5.1 SimpleCheckout (main configuration entity)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK → tenant |
| `channel_id` | UUID | FK → sales channel |
| `name` | VARCHAR(255) | Admin-facing name (e.g., "Summer Workshop Checkout") |
| `slug` | VARCHAR(255) | URL slug, unique per org. Auto-generated, editable |
| `status` | ENUM | `draft`, `active`, `paused`, `archived` |
| `product_type` | ENUM | `catalog` (existing product) or `custom` (ad-hoc) |
| `product_id` | UUID | FK → Product (nullable, for `catalog` type) |
| `custom_product` | JSONB | For `custom` type: `{ name, description, price, taxRate, sku?, image? }` |
| `allowed_payment_methods` | JSONB | Array of payment method IDs enabled for this checkout |
| `require_shipping` | BOOLEAN | Whether to show shipping step |
| `allowed_shipping_methods` | JSONB | Array of shipping method IDs (when require_shipping=true) |
| `appearance` | JSONB | `{ logoUrl?, primaryColor?, heading?, description?, successMessage?, customCss? }` |
| `customer_fields` | JSONB | Which fields to collect: `{ email: true, name: true, phone: boolean, company: boolean, address: boolean, customFields: [...] }` |
| `settings` | JSONB | `{ maxQuantity?: number, allowQuantityChange: boolean, requireTermsAcceptance: boolean, termsUrl?: string, expiresAt?: Date, redirectUrl?: string }` |
| `stats` | JSONB | `{ views: 0, conversions: 0, revenue: 0 }` (updated async) |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |
| `deleted_at` | TIMESTAMP | Soft delete |

### 5.2 SimpleCheckoutSession (tracks each customer session)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK → tenant |
| `checkout_id` | UUID | FK → SimpleCheckout |
| `session_token` | VARCHAR(255) | Unique token for session continuity |
| `quote_id` | UUID | FK → Quote (created on first interaction) |
| `order_id` | UUID | FK → Order (set after conversion) |
| `customer_email` | VARCHAR(255) | Captured customer email |
| `customer_data` | JSONB | Full captured customer info |
| `status` | ENUM | `browsing`, `quote_created`, `paying`, `completed`, `abandoned` |
| `ip_address` | VARCHAR(45) | For analytics / fraud |
| `user_agent` | TEXT | |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

## 6. Phases

### Phase 1 — Core Entity & Admin CRUD (Backend)

**Scope**: Admin can create, list, edit, and archive checkout configurations.

#### 6.1.1 Module Scaffold

```
simple_checkout/
├── index.ts              # metadata
├── acl.ts                # features: simple_checkout.view, .create, .update, .delete
├── setup.ts              # defaultRoleFeatures for admin
├── ce.ts                 # custom entity definitions
├── events.ts             # module events
├── translations.ts       # translatable fields (name)
├── data/
│   ├── entities.ts       # SimpleCheckout, SimpleCheckoutSession
│   └── validators.ts     # zod schemas
├── commands/
│   ├── createCheckout.ts
│   ├── updateCheckout.ts
│   ├── archiveCheckout.ts
│   └── duplicateCheckout.ts
├── api/
│   ├── simple-checkouts/
│   │   └── route.ts      # CRUD: GET (list), POST (create)
│   ├── simple-checkouts/[id]/
│   │   └── route.ts      # GET (detail), PUT (update), DELETE (archive)
│   └── simple-checkouts/[id]/duplicate/
│       └── route.ts      # POST (duplicate config)
├── backend/
│   ├── simple-checkout/
│   │   ├── page.tsx       # List page
│   │   └── page.meta.ts
│   ├── simple-checkout/new/
│   │   ├── page.tsx       # Create form
│   │   └── page.meta.ts
│   └── simple-checkout/[id]/
│       ├── page.tsx       # Edit / detail page with tabs
│       └── page.meta.ts
└── widgets/
    └── injection-table.ts
```

#### 6.1.2 Admin List Page

- DataTable with columns: Name, Status, Product, Views, Conversions, Created, Actions
- Row actions: Edit, Duplicate, Copy Link, Pause/Resume, Archive
- Bulk actions: Archive, Change Status
- Filter by status, product type

#### 6.1.3 Admin Create/Edit Form

Multi-section form with tabs or accordion:

1. **General**: Name, slug (auto-generated with edit), channel, status
2. **Product**: Toggle catalog/custom → product picker or inline form (name, price, tax, description, image)
3. **Customer Fields**: Toggle which fields to collect (email always required)
4. **Shipping**: Enable/disable, select shipping methods
5. **Payment**: Select from enabled payment gateways (checkboxes)
6. **Appearance**: Logo, colors, heading text, success message, custom CSS
7. **Settings**: Max quantity, terms acceptance, expiry, redirect URL

#### 6.1.4 Events

```typescript
export const eventsConfig = createModuleEvents('simple_checkout', [
  { id: 'simple_checkout.checkout.created', label: 'Checkout Created' },
  { id: 'simple_checkout.checkout.updated', label: 'Checkout Updated' },
  { id: 'simple_checkout.checkout.archived', label: 'Checkout Archived' },
  { id: 'simple_checkout.checkout.paused', label: 'Checkout Paused' },
  { id: 'simple_checkout.checkout.activated', label: 'Checkout Activated' },
  { id: 'simple_checkout.session.started', label: 'Checkout Session Started', clientBroadcast: true },
  { id: 'simple_checkout.session.completed', label: 'Checkout Session Completed', clientBroadcast: true },
  { id: 'simple_checkout.session.abandoned', label: 'Checkout Session Abandoned' },
] as const)
```

#### 6.1.5 ACL Features

```typescript
export const features = [
  'simple_checkout.view',
  'simple_checkout.create',
  'simple_checkout.update',
  'simple_checkout.delete',
  'simple_checkout.analytics',
]
```

---

### Phase 2 — Public Checkout Page (Frontend)

**Scope**: Customer-facing single-page checkout rendered at `/checkout/{slug}`.

#### 6.2.1 Public API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/checkout/{slug}` | None | Get checkout config + product details |
| `POST` | `/api/checkout/{slug}/session` | None | Create session, return session token |
| `POST` | `/api/checkout/{slug}/quote` | Session token | Create/update quote with selected variant + quantity |
| `PUT` | `/api/checkout/{slug}/customer` | Session token | Submit customer details, recalculate shipping/tax |
| `PUT` | `/api/checkout/{slug}/shipping` | Session token | Select shipping method, recalculate totals |
| `GET` | `/api/checkout/{slug}/totals` | Session token | Get current quote totals |
| `POST` | `/api/checkout/{slug}/pay` | Session token | Convert quote → order, initiate payment |
| `GET` | `/api/checkout/{slug}/status` | Session token | Get payment/order status |

All public endpoints validate:
- Checkout exists and is `active`
- Checkout not expired
- Session token valid (where required)
- Rate limiting per IP

#### 6.2.2 Frontend Page Structure

```
simple_checkout/
├── frontend/
│   └── checkout/[slug]/
│       ├── page.meta.ts    # No auth required, no layout chrome
│       └── page.tsx         # Server component → CheckoutPageClient
├── components/
│   ├── CheckoutPageClient.tsx     # Main orchestrator
│   ├── CheckoutLayout.tsx         # Branded layout wrapper
│   ├── ProductSection.tsx         # Product display, variant picker, quantity
│   ├── CustomerSection.tsx        # Contact info form
│   ├── ShippingSection.tsx        # Shipping method selector
│   ├── PaymentSection.tsx         # Payment method selector + gateway UI
│   ├── OrderSummary.tsx           # Running totals sidebar/bottom
│   ├── CheckoutSuccess.tsx        # Confirmation page
│   └── CheckoutExpired.tsx        # Expired/inactive state
```

#### 6.2.3 Checkout Flow (Single-Page UX)

The page renders as a single scrollable form with collapsible sections (not a multi-step wizard). Sections unlock progressively:

1. **Product Section** (always visible)
   - Display product name, description, image(s)
   - Variant selector (dropdowns/swatches) if product has variants
   - Quantity selector (if `allowQuantityChange` is true)
   - Price display updates live on variant change

2. **Customer Section** (visible after product selection)
   - Dynamic fields based on `customer_fields` config
   - Email always required
   - Auto-creates session on first field blur

3. **Shipping Section** (visible if `require_shipping` is true, after customer section)
   - Address form
   - Shipping method radio buttons with prices
   - Recalculates totals on selection

4. **Payment Section** (visible after all required sections complete)
   - Payment method selector (cards from allowed_payment_methods)
   - Embedded gateway UI (Stripe Elements, PayU form, etc.)
   - Terms checkbox if configured

5. **Order Summary** (always visible, sticky sidebar on desktop)
   - Line items, subtotal, tax, shipping, total
   - Updates reactively as options change

6. **Pay Button** → Creates order from quote → Initiates payment → Shows success/failure

#### 6.2.4 Quote as Cart

The quote serves as the shopping cart:

```
Customer selects variant → POST /api/checkout/{slug}/quote
  → salesCalculationService creates/updates Quote draft
  → Returns line items, subtotal, tax estimate

Customer enters address → PUT /api/checkout/{slug}/customer
  → Quote updated with customer data
  → Shipping + tax recalculated

Customer selects shipping → PUT /api/checkout/{slug}/shipping
  → Quote updated with shipping line
  → Final totals returned

Customer clicks Pay → POST /api/checkout/{slug}/pay
  → Quote status: draft → confirmed
  → Order created from Quote
  → Payment gateway session initiated
  → On payment success: Order status updated, confirmation shown
```

#### 6.2.5 Widget Injection Spots (FROZEN after release)

```typescript
// Spot IDs for UMES customization
'simple-checkout:product:before'           // Before product section
'simple-checkout:product:after'            // After product section
'simple-checkout:customer:before'          // Before customer form
'simple-checkout:customer:after'           // After customer form
'simple-checkout:customer:fields'          // Extra customer form fields
'simple-checkout:shipping:before'          // Before shipping section
'simple-checkout:shipping:after'           // After shipping section
'simple-checkout:payment:before'           // Before payment section
'simple-checkout:payment:after'            // After payment section
'simple-checkout:summary:before'           // Before order summary
'simple-checkout:summary:after'            // After order summary (e.g., upsells)
'simple-checkout:success:before'           // Before success message
'simple-checkout:success:after'            // After success message
'simple-checkout:layout:header'            // Custom header content
'simple-checkout:layout:footer'            // Custom footer content
```

#### 6.2.6 Component Replacement Handles

All major components are replaceable via `widgets/components.ts`:

```typescript
'simple-checkout:product-section'
'simple-checkout:customer-section'
'simple-checkout:shipping-section'
'simple-checkout:payment-section'
'simple-checkout:order-summary'
'simple-checkout:success-page'
'simple-checkout:layout'
```

---

### Phase 3 — Multi-Product Cart & Enhancements (Future)

**Deferred** — schema supports it, implementation later.

- "Add another product" button on checkout page
- Cart drawer with multiple line items
- Discount code / coupon field
- Cross-sell / upsell widget injection slots
- Abandoned cart recovery emails (via event subscribers)
- Analytics dashboard (conversion funnel, revenue per checkout)
- A/B testing support via appearance variants

---

## 7. API Specification

### 7.1 Admin Endpoints

#### POST /api/simple-checkouts

```typescript
// Request
{
  name: string
  channelId: string
  productType: 'catalog' | 'custom'
  productId?: string              // when productType = 'catalog'
  customProduct?: {               // when productType = 'custom'
    name: string
    description?: string
    price: number
    taxRate?: number
    sku?: string
    imageUrl?: string
  }
  allowedPaymentMethods: string[]
  requireShipping: boolean
  allowedShippingMethods?: string[]
  customerFields?: {
    name?: boolean
    phone?: boolean
    company?: boolean
    address?: boolean
  }
  appearance?: {
    logoUrl?: string
    primaryColor?: string
    heading?: string
    description?: string
    successMessage?: string
    customCss?: string
  }
  settings?: {
    maxQuantity?: number
    allowQuantityChange?: boolean
    requireTermsAcceptance?: boolean
    termsUrl?: string
    expiresAt?: string
    redirectUrl?: string
  }
}

// Response: 201
{
  id: string
  slug: string
  checkoutUrl: string   // Full public URL
  // ... all fields
}
```

#### GET /api/simple-checkouts

Standard CRUD list with filters: `status`, `productType`, `channelId`. Supports `makeCrudRoute` query engine.

#### GET /api/simple-checkouts/:id

Full detail including stats.

#### PUT /api/simple-checkouts/:id

Partial update. Cannot change `productType` after creation (must archive + recreate).

#### DELETE /api/simple-checkouts/:id

Soft delete (archive). Active sessions continue to work until completed.

#### POST /api/simple-checkouts/:id/duplicate

Clones config with new slug. Status set to `draft`.

### 7.2 Public Endpoints

#### GET /api/checkout/:slug

No auth. Returns checkout config for rendering (product info, appearance, enabled fields). Does NOT expose admin-only fields (stats, internal IDs).

#### POST /api/checkout/:slug/session

Creates anonymous session. Returns `sessionToken` (stored in cookie or header for subsequent requests).

#### POST /api/checkout/:slug/quote

Requires session token. Creates or updates the quote:

```typescript
// Request
{
  variantId?: string
  quantity?: number
  options?: Record<string, string>  // product options
}

// Response
{
  quoteId: string
  lineItems: [{ name, variant, quantity, unitPrice, totalPrice }]
  subtotal: number
  taxEstimate: number
  total: number
}
```

#### PUT /api/checkout/:slug/customer

```typescript
// Request
{
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  company?: string
  address?: { street, city, state, postalCode, country }
}

// Response — updated totals with tax calculated from address
```

#### PUT /api/checkout/:slug/shipping

```typescript
// Request
{ shippingMethodId: string }

// Response — updated totals with shipping cost
```

#### POST /api/checkout/:slug/pay

```typescript
// Request
{
  paymentMethodId: string
  // Gateway-specific fields handled by gateway integration
}

// Response
{
  orderId: string
  paymentStatus: 'pending' | 'processing' | 'completed' | 'failed'
  gatewayRedirectUrl?: string  // For redirect-based gateways
  gatewayClientSecret?: string // For embedded gateways (Stripe Elements)
}
```

## 8. Widget Injection Context

All injection widgets receive checkout context:

```typescript
interface SimpleCheckoutInjectionContext {
  checkout: SimpleCheckout          // Full checkout config
  session?: SimpleCheckoutSession   // Current session (if started)
  quote?: Quote                     // Current quote (if created)
  totals?: QuoteTotals              // Current calculated totals
  retryLastMutation: () => void     // Standard UMES retry
}
```

## 9. Appearance & Customization

### 9.1 Default Theme

The checkout page uses a clean, minimal layout:
- Single column on mobile, two-column (form + summary) on desktop
- Branded header with logo and checkout name
- Neutral colors with configurable primary accent
- Responsive, mobile-first

### 9.2 Custom CSS

The `appearance.customCss` field allows merchants to inject scoped CSS. CSS is sanitized server-side (strip `@import`, `url()`, `expression()`) and rendered inside a `<style>` tag scoped to the checkout container.

### 9.3 Ejectable Architecture

The entire module is self-contained. To eject:
1. Copy `packages/core/src/modules/simple_checkout/` to `apps/mercato/src/modules/simple_checkout/`
2. Disable the core module in `modules.ts`
3. Enable the app-level copy
4. Full source control — modify anything

## 10. Security Considerations

- **Rate limiting**: Public endpoints rate-limited per IP (configurable, default 60 req/min)
- **Session tokens**: Cryptographically random, 256-bit, stored hashed
- **CSRF**: Session token acts as CSRF protection (not cookie-based auth)
- **Input validation**: All inputs validated with zod schemas
- **XSS**: Custom CSS sanitized, no raw HTML injection in appearance fields
- **Payment security**: Payment handled entirely by gateway (PCI-compliant); no card data touches our servers
- **Slug enumeration**: Slugs are random-ish (adjective-noun-4digits), not sequential
- **Expiry**: Admins can set checkout expiry; expired checkouts return 410 Gone

## 11. Integration Tests

| ID | Description |
|----|-------------|
| TC-SC-001 | Admin creates a catalog product checkout and verifies slug generation |
| TC-SC-002 | Admin creates a custom product checkout with all fields |
| TC-SC-003 | Admin duplicates a checkout, verifies new slug |
| TC-SC-004 | Admin pauses checkout, customer gets 410 on public page |
| TC-SC-005 | Customer opens checkout link, sees product details |
| TC-SC-006 | Customer selects variant, totals update correctly |
| TC-SC-007 | Customer fills contact info, session created |
| TC-SC-008 | Customer selects shipping, totals include shipping cost |
| TC-SC-009 | Customer completes payment (Stripe test mode), order created |
| TC-SC-010 | Completed session cannot be reused for new payment |
| TC-SC-011 | Expired checkout returns appropriate error |
| TC-SC-012 | Admin sees session in analytics (views, conversions) |
| TC-SC-013 | Widget injection slots render custom content |
| TC-SC-014 | Component replacement overrides product section |
| TC-SC-015 | Custom CSS applies to checkout page |
| TC-SC-016 | Quote totals recalculate on each step change |

## 12. Migration & Backward Compatibility

This is a **new module** — no backward compatibility concerns. All entity IDs, event IDs, injection spot IDs, and API paths are new and will become FROZEN upon first stable release.

### New Contract Surfaces

| Surface | IDs |
|---------|-----|
| Event IDs | `simple_checkout.checkout.*`, `simple_checkout.session.*` |
| Injection Spots | `simple-checkout:*` (15 spots) |
| Component Handles | `simple-checkout:*` (7 handles) |
| API Routes | `/api/simple-checkouts/**`, `/api/checkout/**` |
| ACL Features | `simple_checkout.*` (5 features) |

## 13. Open Questions

1. **Slug format**: Should slugs be human-readable (`summer-workshop-2026`) or random (`checkout-7x9k`)? Recommend: human-readable with random suffix for uniqueness.
2. **Multi-currency**: Should a single checkout support currency switching, or should merchants create one checkout per currency? Recommend: one per channel (inherits channel currency) for v1.
3. **Stock validation**: Should the checkout page validate stock in real-time? Recommend: yes, check on quote creation and on pay; show "out of stock" if unavailable.
4. **Customer account linking**: Should completing a checkout auto-create a `CustomerUser` (SPEC-060)? Recommend: optional, configurable per checkout.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-17 | Initial draft |
