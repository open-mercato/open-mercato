# Checkout Module — Pay Links (Phase A)

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Author** | Piotr Karwatka |
| **Created** | 2026-03-19 |
| **Related** | [Phase B — Simple Checkout](./2026-03-19-checkout-simple-checkout.md), [SPEC-041 (UMES)](./SPEC-041-2026-02-24-universal-module-extension-system.md), [SPEC-044 (Payment Gateways)](./SPEC-044-2026-02-24-payment-gateway-integrations.md), [SPEC-045 (Integration Marketplace)](./SPEC-045-2026-02-24-integration-marketplace.md) |

## TLDR

**Key Points:**
- New `@open-mercato/checkout` npm package (`packages/checkout/`) with a `checkout` module providing Pay Links — shareable payment pages with customizable branding, pricing modes, and customer data collection.
- Zero direct references from core modules to checkout. Cross-module integration is kept minimal: backend sidebar navigation comes from normal backend route discovery plus `page.meta`, while real cross-module touchpoints use UMES only where needed (gateway transaction widgets, DataTable toolbar injection, pay-page extension points). Checkout reuses the existing `paymentGatewayService` (DI) contract unchanged by setting `paymentId = checkoutTransaction.id` and correlating gateway events back to checkout transactions through that existing field.

**Scope:**
- Pay Links and Link Templates CRUD with shared CrudForm (2-column group layout)
- Three pricing modes: fixed (incl/excl tax + promotion strikethrough), custom amount (range-validated), price list selection
- Customizable customer data collection reusing `FieldDefinitionsEditor` UI
- Gateway-agnostic payment via the existing `paymentGatewayService` (DI) contract plus one small additive generic provider-descriptor surface in `payment_gateways` for settings, currencies, and presentation capabilities
- Public pay pages with branding, markdown descriptions, light/dark mode, password protection
- Transaction tracking with gateway payment status correlation
- Transactional emails (start, success, error) with markdown-editable templates
- Admin notifications for payment events
- Atomic usage limit enforcement (single-use, N-use, unlimited)
- Rich UMES extension points on public pay pages for third-party customization, including section-level replacement/wrapper support
- Standard custom fields on links/templates, copyable from template to link

**Concerns:**
- Gateway provider must be configured in Integrations before pay links can process payments — seed examples ship without provider selection
- Customer PII requires full encryption pipeline; all customer data stored encrypted
- Webhooks flow through the existing gateway module's webhook processor — checkout subscribes to `payment_gateways.payment.*` events and attempts a scoped lookup by `paymentId = checkoutTransaction.id`

**Phase B Preview:**
- [Simple Checkout](./2026-03-19-checkout-simple-checkout.md) extends pay links with product/service selection and cart functionality, creating quotes → orders on completion. Designed for maximum code reuse — shared entities, CrudForm, payment flow.

---

## Overview

Pay Links provide merchants with a no-code way to accept payments through shareable URLs. A merchant creates a branded payment page with customizable pricing, customer data collection, and gateway integration — then shares the link via email, social media, or embedded on a website. Customers visit the link, fill in their details, select or confirm the amount, and pay.

### Market Reference

**Stripe Payment Links** is the market leader studied. Adopted: shareable URLs with branding, multiple pricing modes, customer data collection, usage limits. Rejected: Stripe's tight coupling to their own gateway (our architecture is gateway-agnostic via the adapter pattern), and their limited extensibility (our UMES system allows third-party modules to extend every surface of the pay page).

**Also studied**: LemonSqueezy (product-focused checkout), Paddle (tax-inclusive pricing), Gumroad (creator-focused). Key insight: all major players support both single-price and customer-entered-amount modes, and all provide transaction tracking with payment status correlation.

---

## Problem Statement

1. **No standalone payment collection** — Merchants who need to collect one-off payments (consulting fees, donations, event tickets, deposits) must create a full sales order workflow even for a simple payment.
2. **No shareable payment URLs** — There is no way to generate a branded URL that a customer can visit and pay without logging into the system.
3. **No gateway-agnostic checkout** — Payment processing is tightly integrated into the sales order flow; there is no reusable checkout primitive that works independently.
4. **No template system** — Merchants who send similar payment requests repeatedly must recreate them from scratch each time.

### Goal

Build a **self-contained checkout module** as an independent npm package that:
- Provides pay links as a standalone payment collection mechanism
- Works with any installed payment gateway via the adapter pattern
- Requires only minimal additive core changes where the platform does not yet expose a generic provider descriptor surface
- Is architecturally prepared for Phase B (Simple Checkout with cart/order flow)

---

## Proposed Solution

A new `@open-mercato/checkout` package containing a single `checkout` module with:
- **Link Templates** — reusable configurations for rapidly creating pay links
- **Pay Links** — public-facing payment pages with unique URL slugs
- **Transactions** — records of each payment attempt with gateway status tracking
- **Public pay pages** — branded, responsive pages with light/dark mode
- **Extension integration** — widget injection into gateway transactions, DataTable toolbar injection where needed, and pay-page extension/replacement points for third-party modules

The module creates payment sessions via the existing `paymentGatewayService` (resolved from DI) without changing its current contract. Checkout creates its own `CheckoutTransaction` first, then calls `createPaymentSession()` with `paymentId = checkoutTransaction.id`. Webhooks remain fully owned by the gateway module; checkout updates its transaction statuses by subscribing to existing `payment_gateways.payment.*` events and matching the emitted `paymentId` back to `CheckoutTransaction.id` within tenant scope.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│  @open-mercato/checkout (packages/checkout/)                       │
│                                                                    │
│  Module: checkout                                                  │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Link         │  │ Pay Links    │  │ Transactions             │ │
│  │ Templates    │  │              │  │                          │ │
│  │ (CRUD)       │  │ (CRUD +      │  │ (List + Detail,          │ │
│  │              │  │  Public Page) │  │  gateway status          │ │
│  │              │  │              │  │  correlation)            │ │
│  └──────────────┘  └──────┬───────┘  └────────────┬─────────────┘ │
│                           │                        │               │
│                    ┌──────▼────────────────────────▼──────┐        │
│                    │  Payment Flow                         │        │
│                    │  • Creates session via gateway service │        │
│                    │  • Subscribes to gateway events        │        │
│                    │  • Updates transaction on event        │        │
│                    └──────────────┬───────────────────────┘        │
│                                   │                                │
│  Subscribers:                     │                                │
│  • payment_gateways.payment.*     │                                │
│    (scoped lookup by paymentId)   │                                │
│                                   │                                │
└───────────────────────────────────┼────────────────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │  payment_gateways module       │
                    │  (packages/core/)              │
                    │                                │
                    │  paymentGatewayService (DI)    │
                    │  • createPaymentSession()      │
                    │  • Webhook processing          │
                    │  • Status sync                 │
                    │  • Event emission               │
                    │                                │
                    │  GatewayTransaction entity     │
                    │  (used unchanged)              │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │  Gateway Providers             │
                    │  (Stripe, PayU, P24, ...)      │
                    │  Independent npm packages      │
                    └───────────────────────────────┘
```

### Why a Separate Package?

| Concern | Inside `@open-mercato/core` (rejected) | Separate `@open-mercato/checkout` (chosen) |
|---------|---------------------------------------|-------------------------------------------|
| Optional install | Always bundled, bloats core | Install only if needed |
| Release cadence | Tied to core releases | Independent versioning |
| Dependency surface | Pulls all core modules | Minimal: shared + adapter types |
| Phase B evolution | Risk of coupling to sales internals | Clean boundary, extend via UMES |
| Community contributions | High bar — PR to core | Lower bar — separate package |

### Cross-Module Communication

Checkout never imports from core module internals. Integration stays on stable platform surfaces: discovered backend routes and `page.meta` for navigation, DI for payment sessions, events for payment-status sync, and UMES only for true extension points.

| Direction | Mechanism | Detail |
|-----------|-----------|--------|
| Checkout → Sidebar | Backend route discovery + `page.meta` | Adds "Checkout" section with Pay Links, Templates, Transactions without a menu widget |
| Checkout → Gateway Transactions | Widget injection | Shows checkout transaction link on gateway transaction detail via checkout-owned lookup API |
| Other modules → Checkout pay page | UMES extension points | Spots and replaceable components on the public pay page |
| Checkout → Payment sessions | DI: `paymentGatewayService` | `createPaymentSession({ paymentId: checkoutTransaction.id, ... })` |
| Gateway → Checkout | Event subscription | Checkout subscribes to `payment_gateways.payment.*`, then resolves `CheckoutTransaction` by `id = paymentId` in scoped lookup |
| Checkout → Provider settings | Generic payment-gateway descriptor service | Resolve provider session fields, supported currencies, and presentation capabilities without checkout-specific coupling |

---

## NPM Package Structure

```
packages/checkout/
├── package.json                    # @open-mercato/checkout
├── tsconfig.json
├── tsconfig.build.json
├── AGENTS.md
├── src/
│   └── modules/
│       └── checkout/
│           ├── index.ts                    # Module metadata
│           ├── acl.ts                      # RBAC features
│           ├── ce.ts                       # Custom entity declarations
│           ├── di.ts                       # DI registration
│           ├── events.ts                   # Event declarations
│           ├── notifications.ts            # Notification types (server)
│           ├── notifications.client.ts     # Notification renderers (client)
│           ├── search.ts                   # Search configuration
│           ├── setup.ts                    # Tenant init, role features, seeding
│           ├── translations.ts             # Translatable field declarations
│           ├── api/
│           │   ├── openapi.ts              # Shared OpenAPI factory
│           │   ├── interceptors.ts         # API interceptors
│           │   ├── links/route.ts          # CRUD: /api/checkout/links
│           │   ├── links/[id]/route.ts     # Detail: /api/checkout/links/:id
│           │   ├── templates/route.ts      # CRUD: /api/checkout/templates
│           │   ├── templates/[id]/route.ts # Detail: /api/checkout/templates/:id
│           │   ├── transactions/route.ts   # List: /api/checkout/transactions
│           │   ├── transactions/[id]/route.ts # Detail
│           │   └── pay/
│           │       ├── [slug]/route.ts         # Public: GET link data
│           │       ├── [slug]/verify-password/route.ts  # Public: POST verify password
│           │       ├── [slug]/submit/route.ts  # Public: POST create transaction
│           │       └── [slug]/status/[transactionId]/route.ts  # Public: GET status
│           ├── backend/
│           │   ├── checkout/
│           │   │   ├── page.tsx            # Section landing (redirect)
│           │   │   └── page.meta.ts        # Sidebar section registration via discovered backend route
│           │   ├── checkout/pay-links/
│           │   │   ├── page.tsx            # Pay Links list
│           │   │   └── page.meta.ts        # Child page metadata for Checkout section
│           │   │   ├── create/page.tsx     # Create pay link
│           │   │   └── [id]/page.tsx       # Edit/view pay link
│           │   ├── checkout/templates/
│           │   │   ├── page.tsx            # Templates list
│           │   │   └── page.meta.ts        # Child page metadata for Checkout section
│           │   │   ├── create/page.tsx     # Create template
│           │   │   └── [id]/page.tsx       # Edit/view template
│           │   └── checkout/transactions/
│           │       ├── page.tsx            # Transactions list
│           │       └── page.meta.ts        # Child page metadata for Checkout section
│           │       └── [id]/page.tsx       # Transaction detail
│           ├── frontend/
│           │   └── pay/
│           │       ├── [slug]/
│           │       │   ├── page.tsx            # Public pay page
│           │       │   └── page.meta.ts        # requireAuth: false
│           │       ├── [slug]/success/[transactionId]/
│           │       │   ├── page.tsx            # Success page
│           │       │   └── page.meta.ts
│           │       └── [slug]/cancel/[transactionId]/
│           │           ├── page.tsx            # Cancel/error page
│           │           └── page.meta.ts
│           ├── commands/
│           │   ├── templates.ts            # Template CRUD commands
│           │   ├── links.ts                # Link CRUD commands
│           │   └── transactions.ts         # Transaction status commands
│           ├── components/
│           │   ├── index.ts               # Public exports for wrapper/replace/eject-style customization
│           │   ├── LinkTemplateForm.tsx     # Shared CrudForm for links & templates
│           │   ├── PricingModeFields.tsx    # Pricing mode form section
│           │   ├── CustomerFieldsEditor.tsx # Customer data field definitions
│           │   ├── GatewaySettingsFields.tsx # Dynamic gateway settings
│           │   ├── PayPage.tsx             # Public pay page component
│           │   ├── PayPageHeader.tsx       # Header block
│           │   ├── PayPageDescription.tsx  # Description block
│           │   ├── PayPageSummary.tsx      # Amount summary block
│           │   ├── PayPageCustomerForm.tsx  # Customer data form on pay page
│           │   ├── PayPagePricing.tsx       # Pricing section on pay page
│           │   ├── PayPagePaymentSection.tsx # Payment section shell
│           │   ├── PayPagePaymentForm.tsx   # Gateway payment form wrapper
│           │   ├── PayPageHelp.tsx          # Help/legal section
│           │   ├── PayPageFooter.tsx        # Footer block
│           │   ├── SuccessPage.tsx          # Success page component
│           │   ├── SuccessPageContent.tsx   # Success content block
│           │   ├── ErrorPage.tsx            # Error/cancel page component
│           │   └── ErrorPageContent.tsx     # Error/cancel content block
│           ├── data/
│           │   ├── entities.ts             # MikroORM entities
│           │   ├── validators.ts           # Zod schemas
│           │   └── extensions.ts           # Entity extensions (Phase B prep)
│           ├── emails/
│           │   ├── PaymentStartEmail.tsx    # Transaction started email
│           │   ├── PaymentSuccessEmail.tsx  # Payment success email
│           │   └── PaymentErrorEmail.tsx    # Payment error email
│           ├── lib/
│           │   ├── checkout-service.ts     # High-level checkout operations
│           │   ├── slug-generator.ts       # Title → slug conversion + uniqueness
│           │   ├── usage-enforcer.ts       # Atomic usage limit enforcement
│           │   ├── password-verifier.ts    # bcrypt password verification + token
│           │   ├── customer-fields.ts      # Field schema helpers
│           │   └── payment-session.ts      # Gateway adapter session creation
│           ├── i18n/
│           │   ├── en.json
│           │   └── pl.json
│           ├── seed/
│           │   ├── defaults.ts             # Default customer field schemas
│           │   ├── examples.ts             # Example templates and links
│           │   └── custom-fields.ts        # Seed custom fields for entities
│           ├── subscribers/
│           │   ├── gateway-payment-status.ts        # Subscribes to payment_gateways.payment.*
│           │   ├── transaction-completed-notification.ts
│           │   ├── transaction-failed-notification.ts
│           │   ├── transaction-completed-email.ts
│           │   ├── transaction-failed-email.ts
│           │   └── transaction-started-email.ts
│           ├── workers/
│           │   ├── email-sender.ts         # Async email delivery
│           │   └── transaction-expiry.ts   # Release stale reservations / expire stale pending transactions
│           ├── widgets/
│           │   ├── injection-table.ts      # UMES slot mappings
│           │   ├── components.ts           # Component replacement definitions
│           │   ├── injection/
│           │   │   └── gateway-transaction-link/  # Widget on gateway transaction detail
│           │   └── notifications/
│           │       ├── TransactionCompletedRenderer.tsx
│           │       └── TransactionFailedRenderer.tsx
│           └── migrations/                 # Auto-generated
```

### package.json

```json
{
  "name": "@open-mercato/checkout",
  "version": "0.1.0",
  "type": "module",
  "private": false,
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./dist/index.js" },
    "./*": { "types": ["./src/*.ts", "./src/*.tsx"], "default": "./dist/*.js" },
    "./*/*": { "types": ["./src/*/*.ts", "./src/*/*.tsx"], "default": "./dist/*/*.js" }
  },
  "scripts": {
    "build": "node build.mjs",
    "watch": "node watch.mjs",
    "lint": "eslint src/",
    "test": "jest --config jest.config.cjs",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@open-mercato/shared": "workspace:*",
    "@open-mercato/ui": "workspace:*"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

---

## Data Models

### Entity: CheckoutLinkTemplate

Table: `checkout_link_templates`

Reusable configuration for rapidly creating pay links. Templates define defaults that are copied to links on creation.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `organization_id` | uuid | NOT NULL | Tenant scope |
| `tenant_id` | uuid | NOT NULL | Tenant scope |
| `name` | varchar(255) | NOT NULL | Internal name |
| `title` | varchar(255) | NULL | Display title on pay page |
| `subtitle` | varchar(255) | NULL | Display subtitle |
| `description` | text | NULL | Markdown-formatted |
| `logo_attachment_id` | uuid | NULL | FK → attachments (by ID, no ORM relation) |
| `logo_url` | varchar(500) | NULL | Alternative: external logo URL |
| `primary_color` | varchar(7) | NULL | Hex color, e.g., `#3B82F6` |
| `secondary_color` | varchar(7) | NULL | |
| `background_color` | varchar(7) | NULL | |
| `theme_mode` | varchar(10) | DEFAULT `'auto'` | `'light'` \| `'dark'` \| `'auto'` |
| `pricing_mode` | varchar(20) | NOT NULL | `'fixed'` \| `'custom_amount'` \| `'price_list'` |
| `fixed_price_amount` | decimal(12,2) | NULL | For `pricing_mode = 'fixed'` |
| `fixed_price_currency_code` | varchar(3) | NULL | ISO 4217 |
| `fixed_price_includes_tax` | boolean | DEFAULT `true` | |
| `fixed_price_original_amount` | decimal(12,2) | NULL | Strikethrough price (promotion display) |
| `custom_amount_min` | decimal(12,2) | NULL | For `pricing_mode = 'custom_amount'` |
| `custom_amount_max` | decimal(12,2) | NULL | |
| `custom_amount_currency_code` | varchar(3) | NULL | |
| `price_list_items` | jsonb | NULL | `[{id, description, amount, currencyCode}]` |
| `gateway_provider_key` | varchar(100) | NULL | Provider key (e.g., `'stripe'`) |
| `gateway_settings` | jsonb | NULL | Provider-specific per-session settings |
| `customer_fields_schema` | jsonb | NULL | Field definitions for customer data collection |
| `legal_documents` | jsonb | NULL | Optional legal content: `{ terms?: { title, markdown, required }, privacyPolicy?: { title, markdown, required } }` |
| `display_custom_fields_on_page` | boolean | DEFAULT `false` | Show entity custom fields below description |
| `success_title` | varchar(255) | NULL | |
| `success_message` | text | NULL | Markdown |
| `cancel_title` | varchar(255) | NULL | |
| `cancel_message` | text | NULL | Markdown |
| `error_title` | varchar(255) | NULL | |
| `error_message` | text | NULL | Markdown |
| `success_email_subject` | varchar(255) | NULL | |
| `success_email_body` | text | NULL | Markdown |
| `error_email_subject` | varchar(255) | NULL | |
| `error_email_body` | text | NULL | Markdown |
| `start_email_subject` | varchar(255) | NULL | |
| `start_email_body` | text | NULL | Markdown |
| `password_hash` | varchar(255) | NULL | bcrypt hash (cost ≥ 10) |
| `max_completions` | integer | NULL | `NULL` = unlimited, `1` = single-use |
| `status` | varchar(20) | DEFAULT `'draft'` | `'draft'` \| `'active'` \| `'inactive'` |
| `checkout_type` | varchar(20) | DEFAULT `'pay_link'` | `'pay_link'` \| `'simple_checkout'` (Phase B) |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |
| `deleted_at` | timestamptz | NULL | Soft delete |

### Entity: CheckoutLink

Table: `checkout_links`

The actual pay link with a unique public URL slug. Shares all template columns plus link-specific fields.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| _(all columns from CheckoutLinkTemplate)_ | | | Same structure |
| `template_id` | uuid | NULL | FK → `checkout_link_templates` (by ID) |
| `slug` | varchar(255) | NOT NULL | URL-friendly, unique per tenant |
| `completion_count` | integer | DEFAULT `0` | Successful completed uses only |
| `active_reservation_count` | integer | DEFAULT `0` | In-flight payment attempts currently occupying a usage slot |
| `is_locked` | boolean | DEFAULT `false` | Set `true` after first transaction |

**Indexes:**
- Partial unique index: `UNIQUE (organization_id, tenant_id, slug) WHERE deleted_at IS NULL`
- Index: `(organization_id, tenant_id, status, deleted_at)`

### Entity: CheckoutTransaction

Table: `checkout_transactions`

Records each payment attempt/completion. No soft delete — transactions are immutable financial records.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `organization_id` | uuid | NOT NULL | Tenant scope |
| `tenant_id` | uuid | NOT NULL | Tenant scope |
| `link_id` | uuid | NOT NULL | FK → `checkout_links` (by ID) |
| `status` | varchar(20) | NOT NULL | See status values below |
| `amount` | decimal(12,2) | NOT NULL | |
| `currency_code` | varchar(3) | NOT NULL | |
| `customer_data` | jsonb | NULL | **Encrypted**: all submitted form data |
| `first_name` | varchar(255) | NULL | **Encrypted**, denormalized from customer_data |
| `last_name` | varchar(255) | NULL | **Encrypted** |
| `email` | varchar(255) | NULL | **Encrypted** |
| `phone` | varchar(100) | NULL | **Encrypted** |
| `gateway_transaction_id` | uuid | NULL | FK → `gateway_transactions` (by ID, no ORM relation) |
| `payment_status` | varchar(50) | NULL | Denormalized unified status from gateway |
| `selected_price_item_id` | varchar(100) | NULL | For `price_list` pricing mode |
| `accepted_legal_consents` | jsonb | NULL | **Encrypted** immutable acceptance proof copied from link snapshot, e.g. `{ terms?: { title, required, acceptedAt, markdownHash }, privacyPolicy?: {...} }` |
| `ip_address` | varchar(45) | NULL | **Encrypted** |
| `user_agent` | text | NULL | |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**Transaction statuses:**
- `pending` — Created, awaiting customer action
- `processing` — Payment session initiated with gateway
- `completed` — Payment captured/settled successfully
- `failed` — Payment declined or errored
- `cancelled` — Customer cancelled the payment
- `expired` — Session expired without completion

**Indexes:**
- Index: `(organization_id, tenant_id, link_id, status)`
- Index: `(organization_id, tenant_id, created_at DESC)`
- Index: `(gateway_transaction_id)` — for event-driven lookups

### Customer Fields Schema (JSON structure)

Stored in `customer_fields_schema` on links and templates:

```typescript
type CustomerFieldDefinition = {
  key: string           // Field identifier (camelCase)
  label: string         // Display label (i18n key or literal)
  kind: 'text' | 'multiline' | 'boolean' | 'select' | 'radio'
  required: boolean
  fixed: boolean        // true = cannot be removed (firstName, lastName, email, phone)
  placeholder?: string
  options?: Array<{ value: string; label: string }>  // For select/radio
  sortOrder: number
}
```

Default schema (pre-populated on new templates):
```json
[
  { "key": "firstName", "label": "checkout.fields.firstName", "kind": "text", "required": true, "fixed": true, "sortOrder": 0 },
  { "key": "lastName", "label": "checkout.fields.lastName", "kind": "text", "required": true, "fixed": true, "sortOrder": 1 },
  { "key": "email", "label": "checkout.fields.email", "kind": "text", "required": true, "fixed": true, "sortOrder": 2 },
  { "key": "phone", "label": "checkout.fields.phone", "kind": "text", "required": false, "fixed": true, "sortOrder": 3 },
  { "key": "companyName", "label": "checkout.fields.companyName", "kind": "text", "required": false, "fixed": false, "sortOrder": 4 },
  { "key": "companyId", "label": "checkout.fields.companyId", "kind": "text", "required": false, "fixed": false, "sortOrder": 5 },
  { "key": "address", "label": "checkout.fields.address", "kind": "multiline", "required": false, "fixed": false, "sortOrder": 6 }
]
```

### Price List Item (JSON structure)

Stored in `price_list_items`:

```typescript
type PriceListItem = {
  id: string            // Unique item ID (uuid or slug)
  description: string   // Display description
  amount: number        // Price amount
  currencyCode: string  // ISO 4217
}
```

**Currency consistency rules**

- Phase A supports exactly one checkout currency per link at payment time.
- `fixed` mode uses `fixedPriceCurrencyCode`.
- `custom_amount` mode uses `customAmountCurrencyCode`.
- `price_list` mode may offer multiple amounts, but all `priceListItems` on a single link/template MUST share the same `currencyCode`; this is enforced in validation.
- If a gateway provider is already selected, create/update validation MUST reject any configured currency that is not supported by that provider's published capabilities.
- Public submit flow MUST re-validate the final currency against the selected provider's capabilities before creating the gateway session. Frontend currency checks are advisory only.

---

## Commands

All **admin/backend mutations** use the Command pattern with undo support. Commands live in `commands/`.

Undoability boundary:
- Template, link, and later Phase B cart-item mutations are admin operations and MUST be undoable.
- Public checkout submissions and payment-status lifecycle changes are financial events, not backoffice edits, so they are intentionally **not** undoable.

### Template Commands

| Command | Undo | Notes |
|---------|------|-------|
| `checkout.template.create` | Soft-delete the created template | Snapshot: `after` entity + custom fields |
| `checkout.template.update` | Restore `before` snapshot | Snapshot: `before`/`after` entity + custom fields. Selectively syncs existing unlocked links with the same `templateId`: fields/custom fields update only when the link still matches the previous template value, so manual link overrides are preserved. |
| `checkout.template.delete` | Restore `deleted_at = null` | Soft delete only |

### Link Commands

| Command | Undo | Notes |
|---------|------|-------|
| `checkout.link.create` | Soft-delete the created link | If `templateId` provided: copy all template fields + custom field values |
| `checkout.link.update` | Restore `before` snapshot | **Fails with 422** if `is_locked = true` (link has transactions) |
| `checkout.link.delete` | Restore `deleted_at = null` | Soft delete. Fails if link has active (`pending`/`processing`) transactions |

### Transaction Commands

| Command | Undo | Notes |
|---------|------|-------|
| `checkout.transaction.create` | N/A (not undoable — financial record) | Internal only. Called from public submit endpoint. Atomically reserves one usage slot by incrementing `active_reservation_count` |
| `checkout.transaction.updateStatus` | N/A (not undoable) | Internal only. Called from gateway event subscriber and status polling. Releases reservations on terminal states and increments `completion_count` only on successful completion |

**Link locking on first transaction:** When the first `CheckoutTransaction` is created for a link, set `link.is_locked = true` within the same `withAtomicFlush` block. This prevents further edits to the link configuration.

**Atomic usage enforcement:** The `checkout.transaction.create` command uses a single atomic SQL operation:
```sql
UPDATE checkout_links
SET active_reservation_count = active_reservation_count + 1
WHERE id = $1
  AND organization_id = $2
  AND tenant_id = $3
  AND deleted_at IS NULL
  AND status = 'active'
  AND (
    max_completions IS NULL
    OR completion_count + active_reservation_count < max_completions
  )
RETURNING *
```
If zero rows returned → link has reached its limit or is inactive. Return `422` with user-friendly error.

**Terminal state reconciliation:**
- `completed`: decrement `active_reservation_count`, increment `completion_count`
- `failed` / `cancelled` / `expired`: decrement `active_reservation_count` only
- transitions are idempotent; repeated terminal updates do not mutate counters twice

---

## Events

```typescript
const events = [
  // Template CRUD
  { id: 'checkout.template.created', label: 'Template Created', entity: 'template', category: 'crud' },
  { id: 'checkout.template.updated', label: 'Template Updated', entity: 'template', category: 'crud' },
  { id: 'checkout.template.deleted', label: 'Template Deleted', entity: 'template', category: 'crud' },

  // Link CRUD
  { id: 'checkout.link.created', label: 'Link Created', entity: 'link', category: 'crud' },
  { id: 'checkout.link.updated', label: 'Link Updated', entity: 'link', category: 'crud' },
  { id: 'checkout.link.deleted', label: 'Link Deleted', entity: 'link', category: 'crud' },
  { id: 'checkout.link.published', label: 'Link Published', entity: 'link', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.link.locked', label: 'Link Locked', entity: 'link', category: 'lifecycle', clientBroadcast: true },

  // Transaction lifecycle
  { id: 'checkout.transaction.created', label: 'Transaction Created', entity: 'transaction', category: 'crud' },
  { id: 'checkout.transaction.customerDataCaptured', label: 'Customer Data Captured', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.sessionStarted', label: 'Payment Session Started', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.completed', label: 'Transaction Completed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.failed', label: 'Transaction Failed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.cancelled', label: 'Transaction Cancelled', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.expired', label: 'Transaction Expired', entity: 'transaction', category: 'lifecycle' },

  // Usage limits
  { id: 'checkout.link.usageLimitReached', label: 'Usage Limit Reached', entity: 'link', category: 'lifecycle', clientBroadcast: true },
] as const
```

**Webhook-facing lifecycle guarantees**

- `checkout.transaction.customerDataCaptured` is emitted only after validated customer fields have been encrypted, stored on `CheckoutTransaction`, and flushed successfully
- `checkout.transaction.sessionStarted` is emitted only after `createPaymentSession()` succeeds and `gatewayTransactionId` plus checkout payment-session metadata are persisted
- `checkout.transaction.completed` / `failed` / `cancelled` / `expired` are emitted only after the checkout transaction terminal status is committed
- these events are intended to be consumed by the generic `webhooks` module for external automations; payloads must stay stable and webhook-safe
- webhook-facing payloads must include stable identifiers and current state at minimum: `transactionId`, `linkId`, `templateId` when present, `slug`, `status`, `paymentStatus`, `amount`, `currency`, `gatewayProvider`, `gatewayTransactionId` when known, `occurredAt`
- never include gateway secrets, embedded-form tokens, raw provider settings, or mutable client-submitted payment inputs in webhook-facing event payloads
- customer fields may be included only from the already validated and persisted checkout transaction snapshot; downstream consumers must treat webhook delivery as at-least-once and reconcile by `transactionId`

---

## API Contracts

### Admin API (requires auth + features)

#### Templates CRUD

`GET /api/checkout/templates` — List templates (paged)
- Features: `checkout.view`
- Query: `?page=1&pageSize=25&search=&sortBy=createdAt&sortDir=desc`
- Response: Paged list with standard custom fields

`POST /api/checkout/templates` — Create template
- Features: `checkout.create`
- Body: Template fields (validated by `createTemplateSchema`)
- Response: `{ id, ...template }`

`PUT /api/checkout/templates/:id` — Update template
- Features: `checkout.edit`
- Body: Partial template fields
- Response: `{ ok: true }`

`DELETE /api/checkout/templates/:id` — Soft delete template
- Features: `checkout.delete`
- Response: `{ ok: true }`

#### Links CRUD

`GET /api/checkout/links` — List links (paged)
- Features: `checkout.view`
- Query: standard + `?templateId=&isActive=&isLocked=`
- Response: Paged list with `completionCount`, `activeReservationCount`, `maxCompletions`

`POST /api/checkout/links` — Create link
- Features: `checkout.create`
- Body: Link fields + optional `templateId` (copies template config)
- Response: `{ id, slug, ...link }`
- Slug auto-generated from `title` if not provided; validated for uniqueness

`PUT /api/checkout/links/:id` — Update link
- Features: `checkout.edit`
- **Returns 422** if `is_locked = true` with message: `"This link has active transactions and cannot be edited"`
- Body: Partial link fields (slug change re-validates uniqueness)

`DELETE /api/checkout/links/:id` — Soft delete link
- Features: `checkout.delete`
- **Returns 422** if link has `pending` or `processing` transactions

#### Transactions (read-only for admin)

`GET /api/checkout/transactions` — List transactions (paged)
- Features: `checkout.view`
- Query: standard + `?linkId=&status=&dateFrom=&dateTo=`
- Response: Paged list. `firstName`, `lastName`, `email`, `phone` decrypted via `findWithDecryption`
- PII fields are only returned to users with `checkout.viewPii` feature

`GET /api/checkout/transactions/:id` — Transaction detail
- Features: `checkout.view`
- Response: Full transaction including `customerData` (decrypted, requires `checkout.viewPii`), `paymentStatus`, link info

### Public API (no auth required — except preview mode)

`GET /api/checkout/pay/:slug` — Get public link data

- Query param: `?preview=true` — requires valid admin session with `checkout.view` feature; returns full link data with `"preview": true` flag regardless of link status
- Response (no password / password verified):
  ```json
  {
    "id": "uuid",
    "title": "...",
    "subtitle": "...",
    "description": "...",
    "logoUrl": "...",
    "primaryColor": "#3B82F6",
    "secondaryColor": "...",
    "backgroundColor": "...",
    "themeMode": "auto",
    "pricingMode": "fixed",
    "fixedPriceAmount": 99.99,
    "fixedPriceCurrencyCode": "USD",
    "fixedPriceIncludesTax": true,
    "fixedPriceOriginalAmount": 129.99,
    "customAmountMin": null,
    "customAmountMax": null,
    "priceListItems": null,
    "customerFieldsSchema": [...],
    "legalDocuments": {
      "terms": { "title": "Terms and Conditions", "markdown": "...", "required": true },
      "privacyPolicy": { "title": "Privacy Policy", "markdown": "...", "required": true }
    },
    "displayCustomFieldsOnPage": false,
    "customFields": {},
    "gatewayProviderKey": "stripe",
    "available": true,
    "remainingUses": null
  }
  ```
- If password-protected and not verified: `{ requiresPassword: true, title: "..." }` (minimal info)
- If limit reached: `{ available: false, message: "..." }`
- If `draft`, `inactive`, or deleted (without `preview=true`): `404`
- **MUST NOT** expose: `passwordHash`, `gatewaySettings`, admin-only fields, PII from other transactions

`POST /api/checkout/pay/:slug/verify-password` — Verify password
- Body: `{ password: string }`
- Response: `{ ok: true }` — short-lived signed slug-bound session stored only in an HttpOnly cookie (1 hour)
- On failure: `{ error: "Invalid password" }` (generic, no info leakage)

`POST /api/checkout/pay/:slug/submit` — Create transaction and payment session
- Body:
  ```json
  {
    "customerData": { "firstName": "...", "lastName": "...", "email": "...", ... },
    "acceptedLegalConsents": {
      "terms": true,
      "privacyPolicy": true
    },
    "amount": 99.99,
    "selectedPriceItemId": "item_1"
  }
  ```
- Headers:
  - `Idempotency-Key: <opaque-random-key>` — required for safe client retries
- Validation:
  - All fixed customer fields present and valid
  - Customer fields validated against `customer_fields_schema`
  - Required legal-consent checkboxes accepted when `legalDocuments.terms.required = true` and/or `legalDocuments.privacyPolicy.required = true`
  - For `custom_amount`: amount within `[min, max]` range
  - For `price_list`: `selectedPriceItemId` matches a valid item; amount must equal item's amount (server-side enforcement — never trust frontend amount)
  - For `fixed`: amount must equal `fixedPriceAmount` (server-side enforcement)
  - Password session verified if link is password-protected
  - Usage slot reserved atomically
  - Replayed `Idempotency-Key` returns the already-created transaction/session response instead of creating duplicates
- Response: `{ transactionId, redirectUrl?, paymentSession? }`
  - `paymentSession` is the generic provider-owned embedded session shape returned from `paymentGatewayService`
  - checkout resolves the browser renderer through the shared client registry; it never imports Stripe/other provider UI directly
- Creates `CheckoutTransaction` with status `processing`
- Creates gateway session via `paymentGatewayService` with `paymentId = checkoutTransaction.id`
- Sends start email to customer

`GET /api/checkout/pay/:slug/status/:transactionId` — Poll transaction status
- Response: `{ status, paymentStatus }`
- Used by frontend to poll after redirect/embedded payment
- Must verify that `transactionId` belongs to the requested `slug`
- Must require the same password session as the pay page when the link is password-protected
- Returns `404` for cross-link or cross-tenant mismatches

---

## Access Control

```typescript
// acl.ts
export const features = [
  'checkout.view',
  'checkout.create',
  'checkout.edit',
  'checkout.delete',
  'checkout.viewPii',       // View decrypted customer data in transactions
  'checkout.export',        // Export transactions (CSV/JSON)
]
```

```typescript
// setup.ts — defaultRoleFeatures
{
  superadmin: ['checkout.*'],
  admin: ['checkout.view', 'checkout.create', 'checkout.edit', 'checkout.delete', 'checkout.viewPii', 'checkout.export'],
  employee: ['checkout.view'],
}
```

---

## UI/UX

### Backend Pages

#### Pay Links List (`/backend/checkout/pay-links`)

DataTable with `extensionTableId="checkout-links"`:
- Columns: Name, Title, Slug, Pricing Mode, Status (Draft/Active/Inactive), Completions (`3 / 10` or `5 / ∞`), Created At
- Row actions: Edit, Preview (opens pay page in preview mode), View Pay Page (external link — only for `active` links), Show Transactions, Copy Link URL, Publish (draft → active), Deactivate, Delete
- Bulk actions: Publish, Deactivate, Delete
- FilterBar with `FilterDef[]`:
  - `status` (select: Draft / Active / Inactive)
  - `pricingMode` (select: Fixed / Custom Amount / Price List)
  - `isLocked` (checkbox)
  - `templateId` (select with `loadOptions` — async template lookup)
  - Custom field filters auto-merged via `useCustomFieldFilterDefs('checkout:link')`

**Wireframe:** See [Pay Links List wireframe](./2026-03-19-checkout-pay-links-wireframes.md#pay-links-list)

#### Templates List (`/backend/checkout/templates`)

DataTable with `extensionTableId="checkout-templates"`:
- Columns: Name, Pricing Mode, Gateway Provider, Max Completions, Created At
- Row actions: Edit, Preview (renders a temporary pay page preview with template data), Create Link from Template, Delete

**Wireframe:** See [Templates List wireframe](./2026-03-19-checkout-pay-links-wireframes.md#templates-list)

#### Transactions List (`/backend/checkout/transactions`)

DataTable with `extensionTableId="checkout-transactions"`:
- Columns: Link Name, Customer (First + Last), Email, Amount, Status, Payment Status, Created At
- Row actions: View Detail
- FilterBar with `FilterDef[]`:
  - `linkId` (select with `loadOptions` — async link lookup)
  - `status` (select: Pending / Processing / Completed / Failed / Cancelled / Expired)
  - `date` (dateRange: from/to)
  - Custom field filters auto-merged via `useCustomFieldFilterDefs('checkout:transaction')`
- **PII columns** (Customer, Email) only visible to users with `checkout.viewPii`
- Export: `buildCrudExportUrl('checkout/transactions', currentParams, format)` with scopes `'view'` (filtered) and `'full'` (all). Formats: CSV, JSON. PII fields in exports respect `checkout.viewPii` — users without this feature get masked/excluded PII columns.

**Wireframe:** See [Transactions List wireframe](./2026-03-19-checkout-pay-links-wireframes.md#transactions-list)

#### Transaction Detail Page

Accessed from the transactions list row action ("View Detail"). Shows full transaction information in read-only cards.

**Wireframe:** See [Transaction Detail Page wireframe](./2026-03-19-checkout-pay-links-wireframes.md#transaction-detail-page)

#### Link/Template Create/Edit (Shared `CrudForm`)

The `LinkTemplateForm` component is shared between link and template creation/editing. It renders as a `CrudForm` with a **scrollable 2-column layout** — column 1 (left, ~60% width) for main content and column 2 (right, ~40% width) for secondary/settings content.

The form uses `CrudForm` with `entityId` prop to auto-handle entity custom fields:
- Links: `entityId="checkout:link"` — custom fields from `ce.ts` auto-rendered
- Templates: `entityId="checkout:template"` — custom fields auto-rendered
- Custom field values are collected via `collectCustomFieldValues()` on submit
- Template-to-link creation copies custom field values via `loadCustomFieldValues` + `setCustomFieldsIfAny`

Groups are defined with `CrudFormGroup[]` using `column: 1` and `column: 2` for responsive 2-column layout. The last group uses `kind: 'customFields'` to auto-render entity custom fields without manual wiring.

CrudForm groups declaration pattern:

```typescript
const groups: CrudFormGroup[] = [
  { id: 'general', title: t('checkout.form.groups.general'), column: 1, fields: ['name', 'title', 'subtitle', 'description', 'slug'] },
  { id: 'appearance', title: t('checkout.form.groups.appearance'), column: 2, fields: ['logoAttachmentId', 'logoUrl', 'primaryColor', 'secondaryColor', 'backgroundColor', 'themeMode', 'displayCustomFieldsOnPage'] },
  { id: 'pricing', title: t('checkout.form.groups.pricing'), column: 1, fields: ['pricingMode', /* conditional fields */] },
  { id: 'payment', title: t('checkout.form.groups.payment'), column: 2, fields: ['gatewayProviderKey'], component: GatewaySettingsFields },
  { id: 'customerFields', title: t('checkout.form.groups.customerFields'), column: 1, component: CustomerFieldsEditor },
  { id: 'legal', title: t('checkout.form.groups.legal'), column: 1, fields: ['legalDocuments.terms.title', 'legalDocuments.terms.markdown', 'legalDocuments.terms.required', 'legalDocuments.privacyPolicy.title', 'legalDocuments.privacyPolicy.markdown', 'legalDocuments.privacyPolicy.required'] },
  { id: 'settings', title: t('checkout.form.groups.settings'), column: 2, fields: ['status', 'maxCompletions', 'password'] },
  { id: 'messages', title: t('checkout.form.groups.messages'), column: 1, fields: ['successTitle', 'successMessage', 'cancelTitle', 'cancelMessage', 'errorTitle', 'errorMessage'] },
  { id: 'emails', title: t('checkout.form.groups.emails'), column: 1, fields: ['startEmailSubject', 'startEmailBody', 'successEmailSubject', 'successEmailBody', 'errorEmailSubject', 'errorEmailBody'] },
  { id: 'customFields', title: t('checkout.form.groups.customFields'), column: 2, kind: 'customFields' },
]
```

**Column 1 groups (main content, ~60% width):**

**General** (`column: 1`)
- Name (required, text)
- Title (text)
- Subtitle (text)
- Description (textarea, markdown editor)
- Slug (text, auto-generated from title — link only, not on templates)
- Template selector on link creation (searchable combobox; applying a template copies template values into the current link draft without leaving the form)

**Pricing** (`column: 1`)
- Pricing Mode (select: Fixed Price / Custom Amount / Price List)
- _Conditional fields based on mode:_
  - **Fixed**: Amount, Currency, Includes Tax (toggle), Original Amount (promotion strikethrough)
  - **Custom Amount**: Min Amount, Max Amount, Currency
  - **Price List**: Sortable list editor with Description + Amount + Currency per item

**Customer Fields** (`column: 1`)
- Reuses `FieldDefinitionsEditor` from `@open-mercato/ui/backend/custom-fields/`
- Pre-populated with fixed fields (firstName, lastName, email, phone — non-removable)
- Admin can add additional fields (text, multiline, boolean, select, radio)
- Each field: label, key (auto-generated), kind, required toggle, options (for select/radio)

**Messages** (`column: 1`)
- Success: Title + Message (markdown)
- Cancel: Title + Message (markdown)
- Error: Title + Message (markdown)

**Legal** (`column: 1`)
- Terms & Conditions: Title + Markdown body + "Acceptance required" checkbox
- Privacy Policy: Title + Markdown body + "Acceptance required" checkbox
- Empty markdown means the document is disabled and not shown on the public page
- Template values copy to a link when creating from template
- Later template edits also propagate to existing unlocked links with the same `templateId`, but only for fields that the link has not overridden since creation/template sync
- Admin help text: "If marked required, the customer must accept before payment. The document opens in a popup on the pay page."

**Emails** (`column: 1`)
- Start Email: Subject + Body (markdown)
- Success Email: Subject + Body (markdown)
- Error Email: Subject + Body (markdown)
- Preview button for each email
- Available variables: `{{firstName}}`, `{{amount}}`, `{{currencyCode}}`, `{{linkTitle}}`, `{{transactionId}}`, `{{errorMessage}}`

**Column 2 groups (secondary, ~40% width):**

**Appearance** (`column: 2`)
- Logo: Upload (to attachments) OR URL input (toggle)
- Primary Color (color picker)
- Secondary Color (color picker)
- Background Color (color picker)
- Theme Mode (select: Light / Dark / Auto)
- Display Custom Fields on Page (checkbox)

**Payment** (`column: 2`)
- Gateway Provider (select — populated from installed payment integrations)
- **Notice when no provider selected**: "You must set up a payment integration first. Go to [Integrations](/backend/integrations) to configure a payment provider."
- Dynamic gateway settings fields (loaded from the selected payment-gateway descriptor)

**Settings** (`column: 2`)
- Status (select: Draft / Active / Inactive) — new links default to `draft`
- Max Completions (number input, empty = unlimited)
- Password (password input — stored as bcrypt hash)
- Checkout Type (select: Pay Link / Simple Checkout)

**Custom Fields** (`column: 2`, `kind: 'customFields'`)

Auto-renders any entity custom fields defined for `checkout:link` or `checkout:template` via the standard CrudForm mechanism — no manual field wiring needed.

**Locked link display:** When `is_locked = true`, the form shows a read-only banner:
> "This pay link has been used in {completionCount} transaction(s) and can no longer be edited."
> Below: read-only detail view with all fields displayed as text.
> Action: "Show Transactions" button linking to filtered transactions list.

**Wireframe:** See [Link/Template CrudForm wireframe](./2026-03-19-checkout-pay-links-wireframes.md#linktemplate-crudform)

### Public Pay Page (`/pay/[slug]`)

Responsive, single-page design supporting light and dark mode. Fully replaceable via UMES component replacement (`page:checkout.pay-page`).

**Layout:**
1. **Header** — Logo (from attachment or URL), background color
2. **Title & Subtitle** — Large heading with optional subtitle
3. **Description** — Rendered markdown content
4. **Custom Fields Display** — (if `displayCustomFieldsOnPage = true`) Entity custom field values shown below description
5. **Pricing Section** — Based on mode:
   - Fixed: Displays price with optional strikethrough original price
   - Custom Amount: Number input with min/max validation, real-time feedback
   - Price List: Radio button selection of items with descriptions and prices
6. **Summary Section** — Selected amount summary, promotion context, and helper text
7. **Customer Form** — Renders fields from `customerFieldsSchema`, fixed fields always shown
8. **Legal Consent Section** — Optional Terms & Conditions / Privacy Policy consent row with checkboxes; each document opens in a modal popup rendering sanitized markdown
9. **Payment Section** — Gateway-rendered form (embedded) or "Pay Now" button (redirect)
10. **Help / Legal Section** — Optional support, refund, tax, or trust information beyond the required consent documents
11. **Footer** — Powered by branding (optional)

**Legal consent behavior**
- If a legal document is configured, show a consent line in the pay form such as: `I accept the [Terms and Conditions] and [Privacy Policy]`
- Clicking the document name opens a modal/popup with the sanitized markdown content and title
- Each document has its own required flag; if required, the matching checkbox must be checked before payment can proceed
- The submit button remains disabled until all required consents are accepted, but the backend must independently validate the same rule
- On successful submit, store immutable acceptance proof on `CheckoutTransaction.acceptedLegalConsents` including acceptance timestamp and a hash of the markdown snapshot shown to the customer

**Password gate:** If password-protected, show a password form first. On verification, store a slug-bound signed access session in an HttpOnly cookie, then render the full page.

**Wireframe:** See [Password Gate wireframe](./2026-03-19-checkout-pay-links-wireframes.md#password-gate)

#### Public Pay Page — Fixed Price Mode

Full-page wireframe for the default fixed-price pay page with all layout sections and UMES injection spots marked.

**Wireframe:** See [Pay Page — Fixed Price Mode wireframe](./2026-03-19-checkout-pay-links-wireframes.md#pay-page----fixed-price-mode)

#### Public Pay Page — Custom Amount Mode (pricing section variant)

**Wireframe:** See [Pay Page — Custom Amount Mode wireframe](./2026-03-19-checkout-pay-links-wireframes.md#pay-page----custom-amount-mode-pricing-variant)

#### Public Pay Page — Price List Mode (pricing section variant)

**Wireframe:** See [Pay Page — Price List Mode wireframe](./2026-03-19-checkout-pay-links-wireframes.md#pay-page----price-list-mode-pricing-variant)

**Usage limit reached:** Display friendly message with the link title but no payment form:
> "This payment link has reached its maximum number of uses."

**Wireframe:** See [Usage Limit Reached wireframe](./2026-03-19-checkout-pay-links-wireframes.md#usage-limit-reached)

**Dark mode:** Uses `themeMode` setting. `'auto'` follows system preference via `prefers-color-scheme`. Colors applied via CSS custom properties.

**Customization model**

- Additive content should use UMES injection spots.
- Visual or behavioral reshaping of an existing section should use replacement-aware section handles with `wrapper` or `propsTransform` first.
- Full `replace` is supported for the whole page and for key sections where a custom experience is required.
- Checkout ships and exports its default frontend components from the package so app modules can:
  - reuse them directly
  - wrap them via UMES
  - replace them with their own implementation
  - copy/fork them into app code for deeper "eject-style" customization
- There is no special runtime eject feature; exported defaults + replaceable handles are the supported customization path.

### Preview & Draft Mode

Links and templates support a **draft → active → inactive** lifecycle. New links are created in `draft` status by default, allowing admins to preview and verify the full pay page experience before publishing.

**Link statuses:**

| Status     | Public visibility          | Admin preview                           | Can edit                            | Can accept payments |
|------------|----------------------------|-----------------------------------------|-------------------------------------|---------------------|
| `draft`    | 404 (not found)            | Yes — full pay page with preview banner | Yes                                 | No                  |
| `active`   | Visible, payments accepted | Yes                                     | No (locked after first transaction) | Yes                 |
| `inactive` | 404 (not found)            | Yes — with "inactive" banner            | No (locked)                         | No                  |

**Admin preview flow:**

1. Admin clicks "Preview" on the DataTable row action or the CrudForm header button
2. Opens `/pay/[slug]?preview=true` in a new tab
3. The API detects `preview=true` query param and validates the admin session (`requireAuth`, `requireFeatures: ['checkout.view']`)
4. The full pay page renders with all branding, pricing, customer fields, and gateway form — identical to the live page
5. A sticky preview banner is shown at the top:
   > "Preview Mode — This link is not published. Payments are disabled. [← Back to Admin] [Publish]"
6. The submit button is replaced with a disabled "Pay" button showing "(Preview — payments disabled)"
7. The gateway payment form section shows a placeholder instead of the real gateway form

**Template preview:**

Templates do not have slugs. Preview is accessed via a dedicated admin route:
- URL: `/backend/checkout/templates/[id]/preview`
- Renders the same pay page component using template field values
- Generates a temporary preview slug (not persisted) for URL display
- Same preview banner behavior as link preview

**Publishing (draft → active):**

- Admin clicks "Publish" in the CrudForm header, preview banner, or DataTable row action
- Executes `checkout.link.update` command setting `status = 'active'`
- Validates that `gatewayProviderKey` is set before allowing publish (returns validation error if missing)
- Event `checkout.link.published` emitted (category: `lifecycle`, `clientBroadcast: true`)

**Public API behavior by status:**

- `GET /api/checkout/pay/:slug` — returns 404 for `draft` and `inactive` links (unless `preview=true` with valid admin session)
- `POST /api/checkout/pay/:slug/submit` — returns 422 for non-`active` links: "This payment link is not currently accepting payments"

**CrudForm header actions (link edit page):**

| Status | Header actions |
|--------|---------------|
| `draft` | [Preview] [Publish] [Save] |
| `active` (not locked) | [Preview] [Deactivate] [Save] |
| `active` (locked) | [Preview] [Deactivate] — read-only form |
| `inactive` | [Preview] [Reactivate] — read-only form |

### Success Page (`/pay/[slug]/success/[transactionId]`)

Shows `successTitle` + rendered `successMessage` markdown. Polls transaction status to confirm payment was captured by the gateway.

**Wireframe:** See [Success Page wireframe](./2026-03-19-checkout-pay-links-wireframes.md#success-page)

### Cancel/Error Page (`/pay/[slug]/cancel/[transactionId]`)

Shows `cancelTitle` + `cancelMessage` or `errorTitle` + `errorMessage` based on transaction status. Provides a button to return to the payment page for retry.

**Wireframe:** See [Error / Cancel Page wireframe](./2026-03-19-checkout-pay-links-wireframes.md#error--cancel-page)

### Gateway Transaction Widget

Checkout injects a widget on the gateway transaction detail page (`admin.page:payment-gateways/transactions:after`) showing the related checkout transaction details. This widget is only rendered when the gateway transaction is linked to a checkout transaction (resolved via `paymentId` lookup).

**Wireframe:** See [Gateway Transaction Detail — Injected Widget wireframe](./2026-03-19-checkout-pay-links-wireframes.md#gateway-transaction-detail----injected-widget)

---

## UMES Integration Points

### Outbound: Checkout → Other Modules

| Target | UMES Mechanism | Spot/ID | Detail |
|--------|---------------|---------|--------|
| Gateway transactions DataTable | Toolbar injection | `data-table:payment_gateways.transactions.list:toolbar` | Inject checkout action buttons into the top action area of the payment-gateway transactions table in Settings |
| Gateway transaction detail page | Widget injection | `admin.page:payment-gateways/transactions:after` | Checkout transaction details panel fed by a checkout-owned lookup API |

**Backend sidebar navigation**

- The Checkout sidebar section is **not** implemented via UMES menu injection.
- It is provided by normal backend route discovery plus `page.meta.ts` on the checkout backend pages.
- The checkout root backend page metadata owns the top-level sidebar entry and group metadata.
- Child pages under `/backend/checkout/...` reuse the same `pageGroup`/`pageGroupKey` and rely on standard route-prefix nesting, which keeps the nav behavior simpler and aligned with existing modules.

**Payment gateway transactions DataTable actions**

- **Create Payment Link** — available in the top action area of the payment-gateway transactions DataTable in Settings
- Opens checkout link creation prefilled from the selected gateway transaction where possible:
  - provider key
  - amount / currency
  - title or description fallback from transaction metadata
- Uses the DataTable toolbar injection contract (`data-table:<tableId>:toolbar`)
- Requires a minimal additive `DataTable` host enhancement in Phase A so top action buttons can be injected next to the standard create/export/refresh controls while keeping the stable table id `payment_gateways.transactions.list`

**Top-of-table action area note**

- The current `DataTable` host already supports injected row actions and a rendered `data-table:<tableId>:header` spot.
- The nominal `data-table:<tableId>:toolbar` spot id exists in shared UI constants, but is not yet wired as an active injection surface in the current `DataTable` implementation.
- Phase A explicitly includes this minimal additive UI enhancement:
  - wire `data-table:<tableId>:toolbar` as a real injection host next to existing top action buttons
  - keep `data-table:<tableId>:header` unchanged for backward compatibility
  - prefer `:toolbar` for action buttons and keep `:header` for richer informational/instructional widgets
- The required checkout integration is therefore toolbar injection on `payment_gateways.transactions.list`, not row actions

### Inbound: Extension Points Exposed by Checkout

Other modules can extend checkout surfaces via these UMES spots:

**Widget injection spots (FROZEN once released):**

| Spot ID | Location | Context |
|---------|----------|---------|
| `checkout.pay-page:header:before` | Before header on pay page | `{ link, themeMode, themeTokens }` |
| `checkout.pay-page:header:after` | After header/logo | `{ link, themeMode, themeTokens }` |
| `checkout.pay-page:description:after` | After description | `{ link, themeMode, themeTokens }` |
| `checkout.pay-page:summary:before` | Before amount summary section | `{ link, selectedAmount, currencyCode, themeTokens }` |
| `checkout.pay-page:summary:after` | After amount summary section | `{ link, selectedAmount, currencyCode, themeTokens }` |
| `checkout.pay-page:pricing:before` | Before pricing section | `{ link, pricingMode, themeTokens }` |
| `checkout.pay-page:pricing:after` | After pricing section | `{ link, selectedAmount, currencyCode, themeTokens }` |
| `checkout.pay-page:customer-fields:before` | Before customer form fields | `{ link, customerSchema, themeTokens }` |
| `checkout.pay-page:customer-fields:after` | After customer form fields | `{ link, customerData, themeTokens }` |
| `checkout.pay-page:payment:before` | Before payment section | `{ link, transaction, paymentView, themeTokens }` |
| `checkout.pay-page:payment:after` | After payment section | `{ link, transaction, paymentView, themeTokens }` |
| `checkout.pay-page:legal-consent:before` | Before legal consent section | `{ link, legalDocuments, customerData, themeTokens }` |
| `checkout.pay-page:legal-consent:after` | After legal consent section | `{ link, legalDocuments, acceptedLegalConsents, themeTokens }` |
| `checkout.pay-page:submit:before` | Before submit / pay CTA area | `{ link, selectedAmount, currencyCode, themeTokens }` |
| `checkout.pay-page:submit:after` | After submit / pay CTA area | `{ link, selectedAmount, currencyCode, themeTokens }` |
| `checkout.pay-page:help:before` | Before help/legal section | `{ link, themeTokens }` |
| `checkout.pay-page:help:after` | After help/legal section | `{ link, themeTokens }` |
| `checkout.pay-page:footer:before` | Before footer | `{ link, themeTokens }` |
| `checkout.pay-page:footer:after` | After footer | `{ link, themeTokens }` |
| `checkout.success-page:header:after` | After success page heading | `{ link, transaction, themeTokens }` |
| `checkout.success-page:actions:after` | After success page actions | `{ link, transaction, themeTokens }` |
| `checkout.error-page:header:after` | After error/cancel page heading | `{ link, transaction, themeTokens }` |
| `checkout.error-page:actions:after` | After error/cancel page actions | `{ link, transaction, themeTokens }` |
| `crud-form:checkout:link:fields` | Link CrudForm field injection | Standard CrudForm context |
| `crud-form:checkout:template:fields` | Template CrudForm field injection | Standard CrudForm context |
| `data-table:checkout-links:columns` | Link DataTable columns | Standard DataTable context |
| `data-table:checkout-links:row-actions` | Link DataTable row actions | Standard DataTable context |
| `data-table:checkout-links:filters` | Link DataTable filters | Standard DataTable context |
| `data-table:checkout-templates:columns` | Template DataTable columns | Standard DataTable context |
| `data-table:checkout-transactions:columns` | Transaction DataTable columns | Standard DataTable context |
| `data-table:checkout-transactions:row-actions` | Transaction DataTable row actions | Standard DataTable context |
| `data-table:checkout-transactions:filters` | Transaction DataTable filters | Standard DataTable context |

**Component replacement handles:**

| Handle | Component | Purpose |
|--------|-----------|---------|
| `page:checkout.pay-page` | `PayPage` | Replace entire public pay page |
| `page:checkout.success-page` | `SuccessPage` | Replace success page |
| `page:checkout.error-page` | `ErrorPage` | Replace error/cancel page |
| `section:checkout.pay-page.header` | `PayPageHeader` | Replace or wrap header block |
| `section:checkout.pay-page.description` | `PayPageDescription` | Replace or wrap description block |
| `section:checkout.pay-page.summary` | `PayPageSummary` | Replace or wrap amount summary block |
| `section:checkout.pay-page.pricing` | `PayPagePricing` | Replace pricing section |
| `section:checkout.pay-page.payment` | `PayPagePaymentSection` | Replace full payment section shell |
| `section:checkout.pay-page.customer-form` | `PayPageCustomerForm` | Replace customer data form |
| `section:checkout.pay-page.legal-consent` | `PayPageLegalConsent` | Replace or wrap legal consent block and consent modal trigger UI |
| `section:checkout.pay-page.gateway-form` | `PayPagePaymentForm` | Replace gateway form wrapper only |
| `section:checkout.pay-page.help` | `PayPageHelp` | Replace help/legal section |
| `section:checkout.pay-page.footer` | `PayPageFooter` | Replace footer block |
| `section:checkout.success-page.content` | `SuccessPageContent` | Replace success content area |
| `section:checkout.error-page.content` | `ErrorPageContent` | Replace error/cancel content area |

**Replacement contract**

- All section handles are replacement-aware through `useRegisteredComponent`.
- `wrapper` and `propsTransform` SHOULD be preferred over `replace` where possible.
- Props contracts for exported default components are part of the checkout package surface and must remain stable under the backward-compatibility policy.
- Extensions may alter copy, layout, helper UI, and decorative behavior, but MUST NOT change server-authoritative payment data, status values, gateway payload integrity, or security checks.

**Theme token context**

- `themeTokens` is a safe, computed presentation object passed to pay-page widgets/replacements.
- It includes normalized values such as `themeMode`, `primaryColor`, `secondaryColor`, `backgroundColor`, `textColor`, and `resolvedLogoUrl`.
- Extensions consume these tokens instead of re-deriving branding state from raw link fields.

---

## Customer Data Collection

### Editor UI

The Customer Fields group reuses `FieldDefinitionsEditor` from `@open-mercato/ui/backend/custom-fields/`. The editor supports:
- Drag-and-drop reordering
- Field kind selection: `text`, `multiline`, `boolean`, `select`, `radio`
- Required toggle per field
- Options editor for `select` and `radio` kinds
- Fixed fields (firstName, lastName, email, phone) show a lock icon and cannot be removed

### Pay Page Rendering

Customer fields on the pay page are rendered dynamically from the `customerFieldsSchema`:
- `text` → `<input type="text" />`
- `multiline` → `<textarea />`
- `boolean` → `<input type="checkbox" />`
- `select` → `<select>` with options
- `radio` → radio button group with options

Fixed fields (firstName, lastName, email, phone) are rendered first in their own section, followed by custom fields.

### Data Storage

Submitted customer data is stored in `CheckoutTransaction.customerData` as encrypted JSON. The four fixed fields are also denormalized to encrypted columns (`first_name`, `last_name`, `email`, `phone`) for list display and filtering.

### UMES Extension

Other modules can register additional customer field types by injecting into the `checkout.pay-page:customer-fields:after` spot or by extending the `FieldDefinitionsEditor` via the custom fields module's extension mechanism.

---

## Payment Flow

### Session Creation

```
Customer visits /pay/[slug]
         │
         ▼
    ┌─ Password required? ──── Yes ──→ Show password form
    │                                         │
    No                             Verify (POST /verify-password)
    │                                         │
    ▼                                         ▼
  Load pay page (GET /api/checkout/pay/:slug)
         │
         ▼
  Customer fills form + selects amount
         │
         ▼
  Submit (POST /api/checkout/pay/:slug/submit)
         │
         ▼
  ┌─────────────────────────────────────────────┐
  │  Server-side validation:                    │
  │  1. Validate customer fields against schema │
  │  2. Validate amount (server-enforced)       │
  │  3. Reserve usage slot atomically           │
  │  4. Verify password session if required     │
  │  5. Check Idempotency-Key / replay state    │
  └───────────────────┬─────────────────────────┘
                      │
                      ▼
  ┌─────────────────────────────────────────────┐
  │  Create CheckoutTransaction (status:        │
  │  processing)                                │
  │  Lock link if first transaction             │
  │  Increment active_reservation_count         │
  │  atomically                                 │
  └───────────────────┬─────────────────────────┘
                      │
                      ▼
  ┌─────────────────────────────────────────────┐
  │  Resolve paymentGatewayService from DI      │
  │                                             │
  │  paymentGatewayService.createPaymentSession({│
  │    paymentId: checkoutTransaction.id,       │
  │    providerKey: link.gatewayProviderKey,    │
  │    amount, currencyCode,                    │
  │    captureMethod,                           │
  │    description: link.title,                 │
  │    successUrl, cancelUrl,                   │
  │    metadata: {                              │
  │      organizationId, tenantId,              │
  │      checkoutLinkId: link.id,               │
  │      checkoutSlug: link.slug                │
  │    },                                       │
  │    organizationId, tenantId,                │
  │  })                                         │
  │  → Returns { sessionId, redirectUrl,        │
  │              gatewayTransactionId }          │
  └───────────────────┬─────────────────────────┘
                      │
                      ▼
  Store gatewayTransactionId on CheckoutTransaction
         │
         ▼
  Send start email to customer (async via worker)
         │
         ▼
  ┌─── Gateway supports embedded form? ───┐
  │                                        │
  Yes                                     No
  │                                        │
  ▼                                        ▼
  Return paymentSession                Return redirectUrl
  (render inline)                      (frontend redirects)
```

### Gateway Event Processing

Checkout does **not** handle webhooks directly. The existing gateway module's webhook endpoint (`/api/payment_gateways/webhook/[provider]`) processes all payment webhooks, updates `GatewayTransaction` status, and emits events. Checkout subscribes to these existing events:

```
Gateway webhook → /api/payment_gateways/webhook/[provider]
         │
         ▼
  Gateway module: verify signature, parse event,
  update GatewayTransaction, emit events
         │
         ▼
  Event: payment_gateways.payment.authorized/captured/failed/...
  Payload includes the existing gateway event fields,
  including { transactionId, paymentId, ... }
         │
         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Checkout subscriber: gateway-payment-status.ts          │
  │                                                          │
  │  metadata: {                                             │
  │    event: 'payment_gateways.payment.*',                  │
  │    persistent: true,                                     │
  │    id: 'checkout-gateway-status-sync'                    │
  │  }                                                       │
  │                                                          │
  │  1. Scoped lookup: find CheckoutTransaction              │
  │     where id = payload.paymentId                         │
  │     and tenant/org match                                 │
  │     (skip if not found — event belongs elsewhere)        │
  │  2. Map gateway status to checkout transaction status:   │
  │     authorized/captured → completed                      │
  │     failed → failed                                      │
  │     cancelled → cancelled                                │
  │  3. Update checkout transaction status + paymentStatus   │
  │  4. Reconcile reservation counters idempotently          │
  │  5. Emit checkout.transaction.completed/failed/cancelled │
  │  6. Downstream subscribers: send email, notification     │
  └──────────────────────────────────────────────────────────┘
```

This approach means:

- **Zero webhook duplication** — all webhook verification, signature checking, and processing happens in the gateway module
- **One source of truth** — `GatewayTransaction` is the canonical payment record; `CheckoutTransaction` stores checkout-specific data and a denormalized `paymentStatus`
- **Loose coupling** — checkout only depends on existing gateway service + event contracts, not on gateway internals

For external automation, checkout also emits its own post-commit lifecycle events (`checkout.transaction.customerDataCaptured`, `checkout.transaction.sessionStarted`, `checkout.transaction.completed`, `checkout.transaction.failed`). The generic `webhooks` module can subscribe to those events without any checkout-specific code in core payment modules.

### Gateway Provider Settings

When an admin selects a gateway provider in the pay link form:

1. The form resolves a generic provider descriptor from `payment_gateways`, not from checkout-specific logic
2. The descriptor exposes safe UI metadata for:
   - session settings fields
   - supported currencies
   - supported payment types (if applicable)
   - presentation mode: `embedded` / `redirect` / `either`
3. These fields are rendered dynamically in the Payment group
4. Values are stored in `link.gatewaySettings`
5. At payment time, checkout normalizes the supported subset of `gatewaySettings` into the current gateway session contract (`captureMethod`, `paymentTypes`, descriptive metadata)
6. Unsupported or unknown provider-specific keys are rejected at validation time if they are submitted through checkout APIs
7. Unsupported future-safe keys may still exist in provider-owned config UIs, but checkout only accepts keys published by the generic descriptor

**Proposed additive platform change**

To keep checkout decoupled from provider packages while still supporting dynamic configuration, Phase A introduces a minimal generic descriptor surface in `payment_gateways`:

```typescript
type PaymentGatewayDescriptor = {
  providerKey: string
  label: string
  sessionConfig?: {
    fields: Array<{
      key: string
      label: string
      type: 'text' | 'number' | 'select' | 'boolean' | 'textarea' | 'secret' | 'url'
      description?: string
      required?: boolean
      options?: Array<{ value: string; label: string }>
    }>
    supportedCurrencies?: '*' | string[]
    supportedPaymentTypes?: Array<{ value: string; label: string }>
    defaultRendererKey?: string
    renderers?: Array<{
      key: string
      label: string
      type: 'embedded' | 'redirect'
      description?: string
      supportedPaymentTypes?: '*' | string[]
      settingsFields?: PaymentGatewayDescriptorField[]
    }>
    presentation?: 'embedded' | 'redirect' | 'either'
    embeddedRenderers?: string[]
  }
}
```

The core `payment_gateways` module should expose this generically through a DI service and safe API route such as:
- `paymentGatewayDescriptorService.list(scope)`
- `paymentGatewayDescriptorService.get(providerKey, scope)`
- `GET /api/payment_gateways/providers`
- `GET /api/payment_gateways/providers/:providerKey`

Provider packages register descriptors next to their adapters. Core remains unaware of pay links; it only exposes generic provider capabilities.

For embedded payments, provider packages register their browser renderer through `widgets/payments/client.ts(x)`, discovered by the generator and imported by client bootstrap. Checkout receives `{ providerKey, rendererKey, payload, settings }` from the session response and mounts the provider-owned component through the shared registry, keeping the pay page fully gateway-agnostic.

The pay page host also exposes a UMES behavior spot at `checkout.pay-page:form` plus renderer-local visual spots:

- `checkout.pay-page:gateway-widget:before`
- `checkout.pay-page:gateway-widget:renderer:before`
- `checkout.pay-page:gateway-widget:renderer:after`
- `checkout.pay-page:gateway-widget:actions:before`
- `checkout.pay-page:gateway-widget:actions:after`
- `checkout.pay-page:gateway-widget:after`

`checkout.pay-page:form` widgets may use `onFieldChange`, `transformValidation`, `transformFormData`, `onBeforeSave`, `onSave`, and `onAfterSave` so public payment flows stay aligned with UMES behavior contracts.

If a provider does not render anything on the merchant page, the same generic contract can return `clientSession.type = 'redirect'` (with the existing `redirectUrl` preserved as a bridge). Checkout still remains provider-agnostic: it either mounts the provider-owned renderer or follows the redirect returned by the gateway layer.

**Currency validation**

- Checkout MUST validate that every configured payment currency is supported by the selected provider descriptor.
- `POST /api/checkout/links` and `PUT /api/checkout/links/:id` reject unsupported currencies when `gatewayProviderKey` is set.
- `POST /api/checkout/pay/:slug/submit` re-validates the final transaction currency before calling `createPaymentSession`.
- If a provider publishes `supportedCurrencies = '*'`, checkout accepts any ISO currency code but still normalizes to uppercase and lets the adapter be the final authority.

### Core Module Change Policy

Phase A is designed to keep core changes **minimal and additive**:

- `paymentGatewayService.createPaymentSession()` remains unchanged; checkout uses `CheckoutTransaction.id` as `paymentId`
- gateway events already emit `paymentId`, which is sufficient for checkout correlation
- webhook scope derivation already supports `organizationId` / `tenantId` in metadata
- checkout-specific gateway detail links are added through checkout-owned widgets and lookup APIs, not by teaching core modules about checkout
- the only required core-module addition is a **generic payment gateway descriptor surface** for UI settings/capabilities/currency support

Out of scope for Phase A:
- adding checkout-specific concepts to `payment_gateways`
- adding `sourceType` / `sourceId` to gateway transactions
- letting core know what a pay link is

---

## Security & Encryption

### Encryption Requirements

| Field | Storage | Query Pattern |
|-------|---------|---------------|
| `CheckoutTransaction.customerData` | Encrypted JSON | Decrypt on detail view only |
| `CheckoutTransaction.firstName` | Encrypted | `findWithDecryption` for list display |
| `CheckoutTransaction.lastName` | Encrypted | `findWithDecryption` for list display |
| `CheckoutTransaction.email` | Encrypted | `findWithDecryption` for list display |
| `CheckoutTransaction.phone` | Encrypted | `findWithDecryption` for list display |
| `CheckoutTransaction.ipAddress` | Encrypted | Decrypt on detail view only |
| `CheckoutLink.passwordHash` | bcrypt hash (not reversible encryption) | Compare only |
| `CheckoutLink.gatewaySettings` | Encrypted JSON | Decrypt for payment processing |
| `CheckoutLinkTemplate.gatewaySettings` | Encrypted JSON | Decrypt for template detail |

### Security Rules

1. **Never trust frontend amounts**: Server validates that submitted amount matches the configured price (fixed mode), falls within range (custom_amount mode), or matches a valid price list item (price_list mode). The amount in the payment session is always server-derived.
2. **No PII in public API responses**: The `GET /api/checkout/pay/:slug` endpoint never returns customer data from previous transactions.
3. **No status/amount override**: Public submit endpoint ignores `status`, `paymentStatus`, `completionCount`, `isLocked` in the request body.
4. **Password protection**: bcrypt with cost ≥ 10. Slug-bound signed session token stored only in an HttpOnly, Secure, SameSite=Strict cookie with 1-hour expiry.
5. **No direct webhook handling**: All webhook signature verification is handled by the gateway module. Checkout receives payment status updates exclusively through gateway events, eliminating the need for separate webhook security.
6. **Rate limiting + replay protection**: Public submit endpoint rate-limited per IP (10 requests/minute) and protected by required `Idempotency-Key`. Password verify rate-limited per slug + IP (5 attempts/minute).
7. **GDPR compliance**: All customer data encrypted at rest. `checkout.viewPii` feature controls access. Transaction detail API strips PII for users without the feature.
8. **Consent enforcement**: Required legal consents are server-validated on submit; frontend checkbox state is advisory only. Missing required consent returns `422`.
9. **Consent evidence**: The transaction stores the accepted legal-document snapshot hash and timestamp so later edits to the link/template do not alter historical consent proof.
10. **XSS prevention**: Markdown descriptions and legal-document content are rendered with sanitized HTML (no raw HTML injection). User-entered data escaped in all contexts.
11. **Tenant isolation**: All queries scoped by `organizationId` + `tenantId`. Public slug lookups resolve tenant from the slug → link mapping. Status, success, and cancel flows must also validate `transaction.linkId === link.id`.
12. **No raw provider leakage**: Public APIs never expose gateway credentials, gateway settings, provider metadata, or raw webhook payloads.

---

## Email Templates

Three transactional emails, each implemented as a React Email component in `emails/`:

### PaymentStartEmail

Sent when a transaction is created (status: `processing`). Template:
- Subject: Configurable (`startEmailSubject` from link, fallback: `checkout.emails.start.defaultSubject`)
- Body: Rendered markdown from `startEmailBody` with variables: `{{firstName}}`, `{{amount}}`, `{{currencyCode}}`, `{{linkTitle}}`
- To: Customer's email from the submitted form

### PaymentSuccessEmail

Sent when transaction completes. Template:
- Subject: Configurable (`successEmailSubject`, fallback: `checkout.emails.success.defaultSubject`)
- Body: Rendered markdown from `successEmailBody` with variables: `{{firstName}}`, `{{amount}}`, `{{currencyCode}}`, `{{linkTitle}}`, `{{transactionId}}`
- To: Customer's email

### PaymentErrorEmail

Sent when transaction fails. Template:
- Subject: Configurable (`errorEmailSubject`, fallback: `checkout.emails.error.defaultSubject`)
- Body: Rendered markdown from `errorEmailBody` with variables: `{{firstName}}`, `{{linkTitle}}`, `{{errorMessage}}`
- To: Customer's email

All emails:
- Sent asynchronously via the `email-sender` worker queue
- Support i18n (locale resolved from link or system default)
- React components can be replaced via UMES component replacement

---

## Notifications

```typescript
// notifications.ts
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'checkout.transaction.completed',
    module: 'checkout',
    titleKey: 'checkout.notifications.transaction.completed.title',
    bodyKey: 'checkout.notifications.transaction.completed.body',
    icon: 'check-circle',
    severity: 'success',
    actions: [{
      id: 'view',
      labelKey: 'common.view',
      variant: 'outline',
      href: '/backend/checkout/transactions/{sourceEntityId}',
      icon: 'external-link',
    }],
    linkHref: '/backend/checkout/transactions/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'checkout.transaction.failed',
    module: 'checkout',
    titleKey: 'checkout.notifications.transaction.failed.title',
    bodyKey: 'checkout.notifications.transaction.failed.body',
    icon: 'alert-circle',
    severity: 'error',
    actions: [{
      id: 'view',
      labelKey: 'common.view',
      variant: 'outline',
      href: '/backend/checkout/transactions/{sourceEntityId}',
      icon: 'external-link',
    }],
    linkHref: '/backend/checkout/transactions/{sourceEntityId}',
    expiresAfterHours: 168,
  },
  {
    type: 'checkout.link.usageLimitReached',
    module: 'checkout',
    titleKey: 'checkout.notifications.link.usageLimitReached.title',
    bodyKey: 'checkout.notifications.link.usageLimitReached.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [{
      id: 'view',
      labelKey: 'common.view',
      variant: 'outline',
      href: '/backend/checkout/pay-links/{sourceEntityId}',
      icon: 'external-link',
    }],
    linkHref: '/backend/checkout/pay-links/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]
```

Subscribers create notifications on:
- `checkout.transaction.completed` → success notification to admin/staff recipients with checkout operational visibility (default: users with `checkout.view`)
- `checkout.transaction.failed` → error notification to admin/staff recipients with checkout operational visibility (default: users with `checkout.view`)
- `checkout.link.usageLimitReached` → warning notification to admin/staff recipients who can manage checkout links (default: users with `checkout.edit`)

---

## Search Configuration

```typescript
// search.ts
export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'checkout:link',
      enabled: true,
      priority: 10,
      fieldPolicy: {
        searchable: ['name', 'title', 'slug'],
        excluded: ['passwordHash', 'gatewaySettings', 'customerFieldsSchema'],
      },
      buildSource: async (ctx) => ({
        text: [`${ctx.record.name}: ${ctx.record.title ?? ''} (${ctx.record.slug})`],
        presenter: { title: ctx.record.name, subtitle: ctx.record.slug },
        checksumSource: { record: ctx.record, customFields: ctx.customFields },
      }),
      formatResult: async (ctx) => ({
        title: ctx.record.name,
        subtitle: `/pay/${ctx.record.slug}`,
        icon: 'lucide:link',
      }),
    },
    {
      entityId: 'checkout:template',
      enabled: true,
      priority: 8,
      fieldPolicy: {
        searchable: ['name', 'title'],
        excluded: ['passwordHash', 'gatewaySettings'],
      },
      buildSource: async (ctx) => ({
        text: [ctx.record.name],
        presenter: { title: ctx.record.name, subtitle: 'Link Template' },
        checksumSource: { record: ctx.record, customFields: ctx.customFields },
      }),
      formatResult: async (ctx) => ({
        title: ctx.record.name,
        subtitle: 'Link Template',
        icon: 'lucide:file-text',
      }),
    },
  ],
}
```

---

## Custom Fields (Entity-Level)

```typescript
// ce.ts
import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'

export const entities: CustomEntitySpec[] = [
  {
    id: 'checkout:link',
    label: 'Pay Link',
    description: 'Custom fields for pay links',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'checkout:template',
    label: 'Link Template',
    description: 'Custom fields for link templates',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'checkout:transaction',
    label: 'Checkout Transaction',
    description: 'Custom fields for checkout transactions',
    labelField: 'id',
    showInSidebar: false,
    fields: [],
  },
]
```

**Template → Link custom field copy:** When creating a link from a template, the `checkout.link.create` command copies all custom field values from the template entity to the new link entity using `loadCustomFieldValues` + `setCustomFieldsIfAny`.

**Seed custom fields:** Checkout example entities ship with customer-safe fieldset-based custom fields for links and templates:
- `service_package` fieldset — `service_deliverables`, `delivery_timeline`, `session_format`, `support_contact`
- `donation_campaign` fieldset — `impact_summary`, `donation_usage`, `tax_receipt_note`, `support_contact`
- `event_ticket` fieldset — `event_date`, `event_location`, `ticket_includes`, `support_contact`

Only fieldsets explicitly selected on a link/template and enabled via `displayCustomFieldsOnPage` are exposed on the public pay page.

---

## Seeding & Examples

### `seedDefaults` (always runs)

- Default customer fields schema (the 7 pre-populated fields)
- Default email templates (subject + body markdown) for start, success, error

### `seedExamples` (skipped with `--no-examples`)

**Example templates:**
1. "Consulting Fee" — Fixed price, $150, single-use
2. "Donation" — Custom amount, $5–$500 range, unlimited
3. "Event Ticket" — Price list with 3 tiers (General $25, VIP $75, Premium $150), max 100 completions

**Example links (created from templates):**
1. "January Consulting Session" — From template #1, slug: `january-consulting`
2. "Community Donation" — From template #2, slug: `donate`
3. "Spring Gala 2026" — From template #3, slug: `spring-gala-2026`

All examples are seeded **without** `gatewayProviderKey` set. The link form displays:
> "To accept payments, you need to configure a payment integration first. [Set up integrations →](/backend/integrations)"

Example templates and links include prefilled success/cancel/error messages, transactional email subjects/bodies, and fieldset-specific public custom field values.

---

## Phase B Preparation (Design for Reuse)

The Phase A data model and UI are designed to maximize code reuse for [Phase B — Simple Checkout](./2026-03-19-checkout-simple-checkout.md):

### Entity Design

- `CheckoutLink.checkoutType` column: `'pay_link'` (Phase A) or `'simple_checkout'` (Phase B)
- `CheckoutLinkTemplate.checkoutType`: same discriminator
- Phase B adds `CheckoutCartItem` entity linked to `CheckoutLink` (additive, no schema changes)
- Phase B adds `quoteId` and `orderId` nullable columns to `CheckoutTransaction` (additive-only)

### UI Reuse

- `LinkTemplateForm` component: Phase B adds a new "Products" group visible when `checkoutType = 'simple_checkout'`
- `PayPage` component: Phase B adds an items/cart section above the pricing section, replaces pricing with order totals
- Public API: Phase B extends `GET /api/checkout/pay/:slug` with cart/totals data and keeps `POST /submit` customer-data-only while deriving cart items server-side
- Payment flow: identical — adapter-based session creation with the order total

### Code Sharing Strategy

| Component | Phase A | Phase B Extension |
|-----------|---------|-------------------|
| `LinkTemplateForm` | 10 groups (2-column) | +1 "Products" group |
| `PayPage` | Pricing modes | Cart + totals |
| `PayPageCustomerForm` | Shared | Shared (no changes) |
| Payment flow | Amount-based | Order-total-based |
| Transaction tracking | Status + amount | +Quote/Order IDs |
| Email templates | Shared | Shared + order confirmation |
| Notifications | Shared | Shared |
| Search | Link + Template | Shared |
| UMES spots | All spots | +Cart-specific spots |

---

## Documentation Requirements

Implementation of Phase A MUST ship with documentation updates.

Required deliverables:
- `packages/checkout/README.md` covering package purpose, install/enable flow, build/watch/test scripts, and canary publication expectations
- Admin/user docs for Pay Links:
  - creating templates
  - creating links
  - pricing modes
  - password protection
  - usage limits
  - transaction tracking
  - email/notification behavior
- Developer docs for extensibility:
  - available UMES spots
  - replacement handles
  - exported default components and supported wrapper/replace/eject-style customization path
  - limits of customization for payment-critical behavior
- Integration docs for gateway providers:
  - required provider-descriptor surface in `payment_gateways`
  - supported gateway settings contract
  - supported currency validation behavior
- API docs/OpenAPI coverage for all new checkout endpoints and the additive provider-descriptor endpoints in `payment_gateways`

Preferred doc locations:
- package-level overview in `packages/checkout/README.md`
- framework/product docs in `apps/docs/docs/framework/modules/checkout*.mdx` or equivalent checkout docs section
- API docs through generated OpenAPI plus any needed handbook pages for public checkout flow and customization

## Implementation Plan

### Phase A.1: Package Scaffolding & Data Layer

1. Create `packages/checkout/` with `package.json`, `tsconfig.json`, build scripts
2. Create MikroORM entities: `CheckoutLinkTemplate`, `CheckoutLink`, `CheckoutTransaction`
3. Create Zod validators for all entities
4. Create `index.ts`, `acl.ts`, `ce.ts`, `events.ts`, `setup.ts`, `di.ts`
5. Generate database migrations
6. Create AGENTS.md for the checkout package
7. Register module in `apps/mercato/src/modules.ts`
8. Run `yarn generate` and verify module discovery

### Phase A.2: Admin CRUD — Templates & Links

1. Implement template commands (create/update/delete) with undo support
2. Implement link commands (create/update/delete) with undo, template copy, lock enforcement
3. Create CRUD API routes for templates and links with OpenAPI
4. Create shared `LinkTemplateForm` component with 2-column group layout (10 groups)
5. Create backend pages for templates (list, create, edit)
6. Create backend pages for links (list, create, edit) with locked-link read-only view
7. Add slug generation and uniqueness validation
8. Add currency validation rules, including single-currency enforcement for Phase A price lists
9. Wire custom fields (ce.ts) and verify copy from template to link
10. Export default frontend components and stable props contracts for wrapper/replace/eject-style customization
11. Wire search configuration

### Phase A.3: Sidebar & UMES Outbound

1. Implement checkout backend `page.meta.ts` files so sidebar registration comes from discovered routes, not menu injection
2. Add the minimal additive `payment_gateways` provider-descriptor surface (DI service + safe API) for gateway settings, supported currencies, payment types, and presentation mode
3. Add the minimal additive `DataTable` enhancement to wire `data-table:<tableId>:toolbar` as a real injection host
4. Inject `Create Payment Link` into the payment-gateway transactions DataTable toolbar (`data-table:payment_gateways.transactions.list:toolbar`)
5. Implement widget injection into gateway transaction detail
6. Create injection-table.ts with checkout-owned spot definitions
7. Define component replacement handles and exported default component contracts

### Phase A.4: Public Pay Page & Payment Flow

1. Create public pay page components (PayPage, PayPagePricing, PayPageCustomerForm, PayPagePaymentForm)
2. Create public API routes (GET link, POST verify-password, POST submit, GET status)
3. Implement payment session creation via existing `paymentGatewayService` contract using `paymentId = checkoutTransaction.id`
4. Create gateway event subscriber (`gateway-payment-status.ts`) resolving checkout transactions by emitted `paymentId`
5. Implement password verification with slug-bound HttpOnly cookie sessions
6. Validate final transaction currency and selected gateway settings against the provider descriptor before session creation
7. Implement atomic reservation-based usage limit enforcement
8. Implement submit idempotency and transaction/slug binding on status pages
9. Create success/cancel/error pages
10. Add light/dark mode support
11. Add UMES extension spots and section replacement handles on pay page

### Phase A.5: Transactions, Emails & Notifications

1. Create transaction list and detail backend pages
2. Implement transaction status updates from webhook events
3. Create React Email components for start, success, error emails
4. Create email sender worker
5. Create notification types and client renderers
6. Create event subscribers for notifications and emails
7. Create transaction expiry worker (expire pending transactions after configurable timeout and release reserved usage slots)

### Phase A.6: Seeding, Security & Polish

1. Implement seed defaults (customer field schemas, email templates)
2. Implement seed examples (templates, links with custom fields, no gateway)
3. Add encryption to all PII fields and GDPR-sensitive data, including encryption-default registration for checkout-owned sensitive fields
4. Add rate limiting on public endpoints and require submit idempotency
5. Security audit: validate all inputs, verify no PII leakage, test tenant isolation, verify slug/transaction binding, and confirm search excludes sensitive fields
6. Add i18n translations (en, pl)
7. Translatable fields declaration (translations.ts)
8. Write/update package README and product/developer docs for Pay Links, gateway descriptors, and UMES customization

### Phase A.7: Integration Tests

1. Template CRUD tests (create, update, delete, list)
2. Link CRUD tests (create from template, update, lock after transaction, delete)
3. Public pay page tests (load, password protection, usage limits)
4. Payment flow tests (submit, webhook, status updates)
5. Transaction list and detail tests
6. PII access control tests (viewPii feature)
7. Integration tests for sidebar route metadata, gateway widget, payment-gateway transactions toolbar injection, provider descriptor loading, and key pay-page replacement/extension paths

---

## Integration Test Coverage

| Test ID | Scenario | API/UI Path |
|---------|----------|-------------|
| TC-CHKT-001 | Create template, verify in list | `POST /api/checkout/templates`, `GET /api/checkout/templates` |
| TC-CHKT-002 | Update template, verify changes | `PUT /api/checkout/templates/:id` |
| TC-CHKT-003 | Delete template, verify soft delete | `DELETE /api/checkout/templates/:id` |
| TC-CHKT-004 | Create link from template, verify field copy | `POST /api/checkout/links` with `templateId` |
| TC-CHKT-037 | Update template, verify unchanged link fields sync while manual overrides stay intact | `PUT /api/checkout/templates/:id`, `GET /api/checkout/links/:id` |
| TC-CHKT-005 | Create link without template | `POST /api/checkout/links` |
| TC-CHKT-006 | Slug auto-generation and uniqueness | `POST /api/checkout/links` with duplicate slug |
| TC-CHKT-007 | Update link, verify changes | `PUT /api/checkout/links/:id` |
| TC-CHKT-008 | Attempt update on locked link, verify 422 | `PUT /api/checkout/links/:id` after transaction |
| TC-CHKT-009 | Public pay page load | `GET /api/checkout/pay/:slug` |
| TC-CHKT-010 | Password-protected page flow | `GET` → verify password → `POST verify-password` → load page |
| TC-CHKT-011 | Submit fixed-price payment | `POST /api/checkout/pay/:slug/submit` |
| TC-CHKT-012 | Submit custom-amount payment (valid range) | `POST /submit` with amount in range |
| TC-CHKT-013 | Submit custom-amount payment (out of range) | `POST /submit` → 422 |
| TC-CHKT-014 | Submit price-list payment | `POST /submit` with valid `selectedPriceItemId` |
| TC-CHKT-015 | Usage limit enforcement | Create single-use link, submit twice → second fails |
| TC-CHKT-016 | Transaction list filtered by link | `GET /api/checkout/transactions?linkId=` |
| TC-CHKT-017 | Transaction detail with PII (viewPii feature) | `GET /api/checkout/transactions/:id` |
| TC-CHKT-018 | Transaction detail without PII | Same endpoint, user without `checkout.viewPii` |
| TC-CHKT-019 | Gateway event updates checkout transaction status | Gateway event → checkout subscriber → status update |
| TC-CHKT-020 | Checkout sidebar section visible with checkout.view feature via route metadata | Navigate to `/backend`, verify sidebar group |
| TC-CHKT-021 | Custom fields copy from template to link | Verify custom field values after link creation |
| TC-CHKT-022 | Link deletion blocked with active transactions | `DELETE /api/checkout/links/:id` → 422 |
| TC-CHKT-023 | Draft/inactive link returns 404 on public page | `GET /api/checkout/pay/:slug` for draft/inactive → 404 |
| TC-CHKT-029 | Admin preview of draft link renders pay page | `GET /api/checkout/pay/:slug?preview=true` with admin session → 200 with `preview: true` |
| TC-CHKT-030 | Preview mode disables payment submission | `POST /submit` on draft link → 422 |
| TC-CHKT-031 | Publish draft link makes it publicly accessible | Update status to `active`, `GET /api/checkout/pay/:slug` → 200 |
| TC-CHKT-032 | Publish requires gateway provider | Attempt publish without `gatewayProviderKey` → validation error |
| TC-CHKT-024 | Amount tampering prevention (fixed mode) | `POST /submit` with wrong amount → 422 |
| TC-CHKT-025 | Submit replay with same `Idempotency-Key` does not create duplicate transactions | Repeat `POST /submit` with same header |
| TC-CHKT-026 | Status endpoint rejects transaction from another slug | `GET /status/:transactionId` with mismatched slug → 404 |
| TC-CHKT-027 | Password-protected status/success page requires verified session | Access after cookie expiry → blocked |
| TC-CHKT-028 | Payment-gateway transactions DataTable shows injected `Create Payment Link` toolbar action | Settings → Payment Transactions table |
| TC-CHKT-029 | Link create/update rejects currency unsupported by selected gateway provider | `POST/PUT /api/checkout/links` |
| TC-CHKT-030 | Payment-gateway descriptor API exposes safe settings/currency metadata without credentials | `GET /api/payment_gateways/providers/:providerKey` |
| TC-CHKT-031 | Pay page section wrapper/replacement handle can customize summary/help area without changing payment integrity | UMES component replacement test |
| TC-CHKT-032 | Checkout emits webhook-ready customer-data/session-start lifecycle events only after commit | Submit flow with webhook subscriber spy |
| TC-CHKT-033 | External webhook subscription can receive checkout success/failure automation events with stable identifiers and no secrets | `webhooks` module subscribed to `checkout.transaction.**` |
| TC-CHKT-034 | Required terms/privacy consent blocks submit when unchecked | `POST /api/checkout/pay/:slug/submit` → 422 |
| TC-CHKT-035 | Terms/privacy links open popup with sanitized markdown content and accepted proof is stored on transaction | Public pay page + transaction detail |

---

## Risks & Impact Review

### Event Processing Race Condition — Duplicate Status Updates

- **Scenario**: Gateway emits a `payment.captured` event and the customer simultaneously lands on the success page triggering a status poll. Both paths attempt to update the checkout transaction status.
- **Severity**: Medium
- **Affected area**: Transaction status consistency
- **Mitigation**: Use optimistic locking (version column) on `CheckoutTransaction`. Status transitions are validated (e.g., `processing → completed` is valid, `completed → completed` is no-op). The gateway event subscriber is persistent and idempotent — replayed events produce the same outcome.
- **Residual risk**: Minimal — double-processing results in the same state.

### Gateway Provider Not Configured

- **Scenario**: Admin creates a pay link without selecting a gateway provider. Customer visits the page and tries to pay.
- **Severity**: Low
- **Affected area**: Customer-facing pay page
- **Mitigation**: Submit endpoint validates `gatewayProviderKey` is set and adapter is registered. Returns user-friendly error: "Payment is not yet configured for this link." Admin form shows warning when no provider is selected. Seed examples explicitly omit provider to demonstrate the flow.
- **Residual risk**: None — clean error path.

### Usage Limit Race Condition

- **Scenario**: Multiple customers simultaneously submit payments for a single-use link. Without atomic enforcement, both could succeed.
- **Severity**: High
- **Affected area**: Business integrity — link used more times than intended
- **Mitigation**: Atomic SQL reservation using `completion_count + active_reservation_count < max_completions`. The database guarantees only one contender wins the final remaining slot. Losers get a clear error message before payment session creation.
- **Residual risk**: None — database atomicity is reliable.

### Customer PII Exposure

- **Scenario**: A bug in the public API or admin API leaks customer PII (email, phone, address) from other transactions.
- **Severity**: Critical
- **Affected area**: GDPR compliance, customer trust
- **Mitigation**: (1) Public API never includes transaction data from other customers. (2) Admin API requires `checkout.viewPii` feature for PII fields; without it, PII columns are null/masked. (3) All PII stored encrypted. (4) API response serialization strips PII fields at the type level when feature is absent.
- **Residual risk**: Low — defense in depth with encryption + feature gating + response stripping.

### Payment Amount Tampering

- **Scenario**: Attacker modifies the submitted amount in the POST request to pay less than configured.
- **Severity**: Critical
- **Affected area**: Financial integrity
- **Mitigation**: Server derives the payment amount from the link configuration. For `fixed` mode, the configured amount is used regardless of submitted value. For `price_list`, the amount is looked up from the matching item. For `custom_amount`, the submitted value is validated against `[min, max]` range. The amount passed to `paymentGatewayService.createPaymentSession()` is always the server-validated value.
- **Residual risk**: None — server is authoritative.

### Slug Collision After Soft Delete

- **Scenario**: Link with slug `donate` is soft-deleted. Admin creates a new link with slug `donate`. Both exist in the database with the same slug.
- **Severity**: Medium
- **Affected area**: URL routing
- **Mitigation**: Partial unique index: `UNIQUE (organization_id, tenant_id, slug) WHERE deleted_at IS NULL`. Only active (non-deleted) links participate in the uniqueness constraint. Public slug lookup filters by `deleted_at IS NULL`.
- **Residual risk**: None — partial index guarantees correctness.

### Stale Pending Transactions

- **Scenario**: Customer starts a payment but abandons it. The transaction remains in `pending` or `processing` status indefinitely, inflating reserved usage and blocking later customers.
- **Severity**: Medium
- **Affected area**: Usage limit accuracy, data cleanliness
- **Mitigation**: `transaction-expiry` worker runs periodically (every 15 minutes) and expires transactions in `pending`/`processing` status older than a configurable timeout (default: 2 hours). On expiry, `active_reservation_count` is decremented atomically. Event `checkout.transaction.expired` is emitted.
- **Residual risk**: Brief window where a stale transaction occupies a usage slot. Acceptable for most use cases.

### Public Flow Replay / Enumeration

- **Scenario**: A client retries submit due to flaky connectivity or probes transaction IDs from another link.
- **Severity**: High
- **Affected area**: Duplicate transaction creation, cross-link information disclosure
- **Mitigation**: Require `Idempotency-Key` on submit, cache the first successful response per key, and validate `transaction.linkId === link.id` on `status`, `success`, and `cancel` flows before returning any state.
- **Residual risk**: Low — only brute-force traffic remains, handled by rate limiting and UUID entropy.

---

## Migration & Backward Compatibility

Phase A keeps core changes minimal, but it does introduce one **additive** contract surface in `payment_gateways`: a generic provider-descriptor registry/service/API for session settings, supported currencies, payment types, and presentation capabilities.

- **Auto-discovery conventions**: additive only; new package/module files follow existing conventions
- **Type/function contracts**: no existing public signatures need to change
- **Event IDs**: checkout adds new event IDs only; it consumes existing `payment_gateways.payment.*` events unchanged
- **Gateway service**: `paymentGatewayService.createPaymentSession()` remains unchanged
- **Gateway descriptor surface**: new additive service/API only; no existing fields or routes are removed or renamed
- **API routes**: additive only; checkout introduces new `/api/checkout/*` endpoints
- **Database schema**: additive only; checkout introduces new checkout-owned tables/columns
- **Widget spots**: additive only; checkout adds new UMES spots and checkout-owned widgets

Optional future enhancements to generic payment-source correlation in `payment_gateways` must be specified separately and follow the full deprecation / BC process if they alter existing contracts.

---

## Final Compliance Report — 2026-03-19

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md` (via research)
- `packages/events/AGENTS.md` (via research)
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All cross-module refs use FK IDs (template_id, link_id, gateway_transaction_id) |
| root AGENTS.md | Filter by organization_id | Compliant | All queries scoped by organization_id + tenant_id |
| root AGENTS.md | Never expose cross-tenant data | Compliant | All API routes include tenant scope in queries |
| root AGENTS.md | Use DI (Awilix) to inject services | Compliant | checkoutService, integrationCredentialsService resolved via DI |
| root AGENTS.md | Validate all inputs with Zod | Compliant | All validators in data/validators.ts |
| root AGENTS.md | Use findWithDecryption | Compliant | All PII queries use encrypted find helpers |
| root AGENTS.md | API routes export openApi | Compliant | All routes export openApi via shared factory |
| root AGENTS.md | Write operations via Command pattern | Compliant | All mutations through registered commands |
| root AGENTS.md | Event IDs: module.entity.action | Compliant | e.g., checkout.transaction.completed |
| root AGENTS.md | Modules plural, snake_case | Compliant | Module id: `checkout` (singular — special case like `auth`) |
| root AGENTS.md | i18n: useT client, resolveTranslations server | Compliant | All strings use locale keys |
| root AGENTS.md | Every dialog: Cmd+Enter submit, Escape cancel | Compliant | Standard CrudForm behavior |
| root AGENTS.md | pageSize ≤ 100 | Compliant | Default 25, max 100 |
| core AGENTS.md | CRUD routes use makeCrudRoute with indexer | Compliant | indexer: { entityType: 'checkout:link' } etc. |
| core AGENTS.md | setup.ts declares defaultRoleFeatures | Compliant | See Access Control section |
| core AGENTS.md | Events use createModuleEvents with as const | Compliant | See Events section |
| core AGENTS.md | Custom fields declared in ce.ts | Compliant | See Custom Fields section |
| core AGENTS.md | Widget injection via injection-table.ts | Compliant | See UMES section |
| BC contract | Event IDs FROZEN | Compliant | New events, no modifications |
| BC contract | Widget spot IDs FROZEN | Compliant | New spots, no modifications |
| BC contract | Database schema ADDITIVE-ONLY | Compliant | New tables only |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | All entity fields reflected in API request/response schemas |
| API contracts match UI/UX section | Pass | All CrudForm groups map to API fields |
| Risks cover all write operations | Pass | Template/Link CRUD, transaction creation, webhook processing, usage enforcement |
| Commands defined for all admin mutations | Pass | 6 undoable admin commands + 2 non-undoable internal financial commands |
| Cache strategy covered | N/A | Read-heavy public endpoint can add caching in future; admin CRUD volume is low |
| Events cover all state changes | Pass | 14 events covering CRUD + lifecycle |
| Search covers key entities | Pass | Links and templates indexed |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant** — Approved for implementation.

---

## Changelog

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase A — Pay Links | Done | 2026-03-19 | Public flow, admin CRUD, workers, docs, and verification completed |

### Phase A — Detailed Progress
- [x] Package scaffolding and data layer
- [x] Admin CRUD for templates, links, and transactions
- [x] Sidebar wiring and UMES outbound integrations
- [x] Public pay page and payment flow
- [x] Emails, notifications, and expiry worker
- [x] Seeding, security polish, and public endpoint protections
- [x] Documentation and unit-test verification

### 2026-03-19
- Initial specification created
- Defined Phase A scope: Pay Links, Link Templates, Transactions
- Designed data models with Phase B extensibility (checkout_type discriminator)
- Defined UMES integration points (outbound and inbound)
- Defined payment flow via existing `paymentGatewayService` contract using `paymentId = checkoutTransaction.id`
- Checkout subscribes to gateway events — no duplicate webhook handling
- Defined security model with encryption, PII gating, amount validation
- Defined implementation plan (7 sub-phases)
- Defined 24 integration test cases
- Completed compliance review against all AGENTS.md rules
- Updated public payment flow to return generic `paymentSession` descriptors instead of checkout-owned embedded form payloads
- Added provider-owned client renderer registration via generated `payments.client.generated.ts` from module entrypoints under `widgets/payments/client.ts(x)`
- Added fieldset-based, customer-safe example custom fields for checkout links/templates and public pay-page rendering
- Seeded checkout examples with richer success/cancel/error messaging and transactional email templates
