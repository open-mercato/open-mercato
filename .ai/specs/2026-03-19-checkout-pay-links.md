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
- Zero direct references from core modules to checkout. All cross-module integration via UMES (menu injection, widget injection, response enrichers). Checkout reuses the existing `paymentGatewayService` (DI) contract unchanged by setting `paymentId = checkoutTransaction.id` and correlating gateway events back to checkout transactions through that existing field.

**Scope:**
- Pay Links and Link Templates CRUD with shared CrudForm (tab-organized)
- Three pricing modes: fixed (incl/excl tax + promotion strikethrough), custom amount (range-validated), price list selection
- Customizable customer data collection reusing `FieldDefinitionsEditor` UI
- Gateway-agnostic payment via the existing `paymentGatewayService` (DI) contract, with no required contract changes in `payment_gateways`
- Public pay pages with branding, markdown descriptions, light/dark mode, password protection
- Transaction tracking with gateway payment status correlation
- Transactional emails (start, success, error) with markdown-editable templates
- Admin notifications for payment events
- Atomic usage limit enforcement (single-use, N-use, unlimited)
- UMES extension points on public pay pages for third-party customization
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
- Requires zero required changes to existing core contract surfaces
- Is architecturally prepared for Phase B (Simple Checkout with cart/order flow)

---

## Proposed Solution

A new `@open-mercato/checkout` package containing a single `checkout` module with:
- **Link Templates** — reusable configurations for rapidly creating pay links
- **Pay Links** — public-facing payment pages with unique URL slugs
- **Transactions** — records of each payment attempt with gateway status tracking
- **Public pay pages** — branded, responsive pages with light/dark mode
- **UMES integration** — menu injection into sidebar, widget injection into gateway transactions, extension points for third-party modules

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

All integration with core modules is via UMES — the checkout module never imports from core module internals:

| Direction | Mechanism | Detail |
|-----------|-----------|--------|
| Checkout → Sidebar | Menu injection | Adds "Checkout" section with Pay Links, Templates, Transactions |
| Checkout → Gateway Transactions | Widget injection + Response enricher | Shows checkout transaction link on gateway transaction detail |
| Other modules → Checkout pay page | UMES extension points | Spots and replaceable components on the public pay page |
| Checkout → Payment sessions | DI: `paymentGatewayService` | `createPaymentSession({ paymentId: checkoutTransaction.id, ... })` |
| Gateway → Checkout | Event subscription | Checkout subscribes to `payment_gateways.payment.*`, then resolves `CheckoutTransaction` by `id = paymentId` in scoped lookup |
| Checkout → Provider settings | Sales provider registry | `getPaymentProvider()` for settings field definitions |

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
│           │   │   └── page.tsx            # Section landing (redirect)
│           │   ├── checkout/pay-links/
│           │   │   ├── page.tsx            # Pay Links list
│           │   │   ├── create/page.tsx     # Create pay link
│           │   │   └── [id]/page.tsx       # Edit/view pay link
│           │   ├── checkout/templates/
│           │   │   ├── page.tsx            # Templates list
│           │   │   ├── create/page.tsx     # Create template
│           │   │   └── [id]/page.tsx       # Edit/view template
│           │   └── checkout/transactions/
│           │       ├── page.tsx            # Transactions list
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
│           │   ├── LinkTemplateForm.tsx     # Shared CrudForm for links & templates
│           │   ├── PricingModeFields.tsx    # Pricing mode form section
│           │   ├── CustomerFieldsEditor.tsx # Customer data field definitions
│           │   ├── GatewaySettingsFields.tsx # Dynamic gateway settings
│           │   ├── PayPage.tsx             # Public pay page component
│           │   ├── PayPageCustomerForm.tsx  # Customer data form on pay page
│           │   ├── PayPagePricing.tsx       # Pricing section on pay page
│           │   ├── PayPagePaymentForm.tsx   # Gateway payment form wrapper
│           │   ├── SuccessPage.tsx          # Success page component
│           │   └── ErrorPage.tsx            # Error/cancel page component
│           ├── data/
│           │   ├── entities.ts             # MikroORM entities
│           │   ├── validators.ts           # Zod schemas
│           │   ├── enrichers.ts            # Response enrichers
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
│           │   │   ├── sidebar-menu/       # Sidebar menu injection
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
| `is_active` | boolean | DEFAULT `true` | |
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
- Index: `(organization_id, tenant_id, is_active, deleted_at)`

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

---

## Commands

All write operations use the Command pattern with undo support. Commands live in `commands/`.

### Template Commands

| Command | Undo | Notes |
|---------|------|-------|
| `checkout.template.create` | Soft-delete the created template | Snapshot: `after` entity + custom fields |
| `checkout.template.update` | Restore `before` snapshot | Snapshot: `before`/`after` entity + custom fields. Uses `withAtomicFlush` |
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
  AND is_active = true
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
  { id: 'checkout.link.locked', label: 'Link Locked', entity: 'link', category: 'lifecycle', clientBroadcast: true },

  // Transaction lifecycle
  { id: 'checkout.transaction.created', label: 'Transaction Created', entity: 'transaction', category: 'crud' },
  { id: 'checkout.transaction.completed', label: 'Transaction Completed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.failed', label: 'Transaction Failed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.cancelled', label: 'Transaction Cancelled', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.expired', label: 'Transaction Expired', entity: 'transaction', category: 'lifecycle' },

  // Usage limits
  { id: 'checkout.link.usageLimitReached', label: 'Usage Limit Reached', entity: 'link', category: 'lifecycle', clientBroadcast: true },
] as const
```

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

### Public API (no auth required)

`GET /api/checkout/pay/:slug` — Get public link data
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
    "displayCustomFieldsOnPage": false,
    "customFields": {},
    "gatewayProviderKey": "stripe",
    "available": true,
    "remainingUses": null
  }
  ```
- If password-protected and not verified: `{ requiresPassword: true, title: "..." }` (minimal info)
- If limit reached: `{ available: false, message: "..." }`
- If inactive/deleted: `404`
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
    "amount": 99.99,
    "selectedPriceItemId": "item_1"
  }
  ```
- Headers:
  - `Idempotency-Key: <opaque-random-key>` — required for safe client retries
- Validation:
  - All fixed customer fields present and valid
  - Customer fields validated against `customer_fields_schema`
  - For `custom_amount`: amount within `[min, max]` range
  - For `price_list`: `selectedPriceItemId` matches a valid item; amount must equal item's amount (server-side enforcement — never trust frontend amount)
  - For `fixed`: amount must equal `fixedPriceAmount` (server-side enforcement)
  - Password session verified if link is password-protected
  - Usage slot reserved atomically
  - Replayed `Idempotency-Key` returns the already-created transaction/session response instead of creating duplicates
- Response: `{ transactionId, redirectUrl?, embeddedFormData? }`
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
]
```

```typescript
// setup.ts — defaultRoleFeatures
{
  superadmin: ['checkout.*'],
  admin: ['checkout.view', 'checkout.create', 'checkout.edit', 'checkout.delete', 'checkout.viewPii'],
  employee: ['checkout.view'],
}
```

---

## UI/UX

### Backend Pages

#### Pay Links List (`/backend/checkout/pay-links`)

DataTable with `extensionTableId="checkout-links"`:
- Columns: Name, Title, Slug, Pricing Mode, Status (Active/Inactive), Completions (`3 / 10` or `5 / ∞`), Created At
- Row actions: Edit, View Pay Page (external link), Show Transactions (navigates to transactions filtered by `linkId`), Copy Link URL, Delete
- Bulk actions: Activate, Deactivate, Delete
- Filters: Status, Pricing Mode, Locked, Template

#### Templates List (`/backend/checkout/templates`)

DataTable with `extensionTableId="checkout-templates"`:
- Columns: Name, Pricing Mode, Gateway Provider, Max Completions, Created At
- Row actions: Edit, Create Link from Template, Delete

#### Transactions List (`/backend/checkout/transactions`)

DataTable with `extensionTableId="checkout-transactions"`:
- Columns: Link Name, Customer (First + Last), Email, Amount, Status, Payment Status, Created At
- Row actions: View Detail
- Filters: Link (select), Status, Date Range
- **PII columns** (Customer, Email) only visible to users with `checkout.viewPii`

#### Link/Template Create/Edit (Shared `CrudForm`)

The `LinkTemplateForm` component is shared between link and template creation/editing. It renders as a `CrudForm` with **tabs**:

**Tab 1: General**
- Name (required, text)
- Title (text)
- Subtitle (text)
- Description (textarea, markdown editor)
- Slug (text, auto-generated from title — link only, not on templates)

**Tab 2: Appearance**
- Logo: Upload (to attachments) OR URL input (toggle)
- Primary Color (color picker)
- Secondary Color (color picker)
- Background Color (color picker)
- Theme Mode (select: Light / Dark / Auto)
- Display Custom Fields on Page (checkbox)

**Tab 3: Pricing**
- Pricing Mode (select: Fixed Price / Custom Amount / Price List)
- _Conditional fields based on mode:_
  - **Fixed**: Amount, Currency, Includes Tax (toggle), Original Amount (promotion strikethrough)
  - **Custom Amount**: Min Amount, Max Amount, Currency
  - **Price List**: Sortable list editor with Description + Amount + Currency per item

**Tab 4: Customer Fields**
- Reuses `FieldDefinitionsEditor` from `@open-mercato/ui/backend/custom-fields/`
- Pre-populated with fixed fields (firstName, lastName, email, phone — non-removable)
- Admin can add additional fields (text, multiline, boolean, select, radio)
- Each field: label, key (auto-generated), kind, required toggle, options (for select/radio)

**Tab 5: Payment**
- Gateway Provider (select — populated from installed payment integrations)
- **Notice when no provider selected**: "You must set up a payment integration first. Go to [Integrations](/backend/integrations) to configure a payment provider."
- Dynamic gateway settings fields (loaded from `PaymentProvider.settings.fields` for selected provider)

**Tab 6: Messages**
- Success: Title + Message (markdown)
- Cancel: Title + Message (markdown)
- Error: Title + Message (markdown)

**Tab 7: Emails**
- Start Email: Subject + Body (markdown)
- Success Email: Subject + Body (markdown)
- Error Email: Subject + Body (markdown)
- Preview button for each email

**Tab 8: Settings**
- Max Completions (number input, empty = unlimited)
- Password (password input — stored as bcrypt hash)
- Is Active (toggle)

**Locked link display:** When `is_locked = true`, the form shows a read-only banner:
> "This pay link has been used in {completionCount} transaction(s) and can no longer be edited."
> Below: read-only detail view with all fields displayed as text.
> Action: "Show Transactions" button linking to filtered transactions list.

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
6. **Customer Form** — Renders fields from `customerFieldsSchema`, fixed fields always shown
7. **Payment Section** — Gateway-rendered form (embedded) or "Pay Now" button (redirect)
8. **Footer** — Powered by branding (optional)

**Password gate:** If password-protected, show a password form first. On verification, store a slug-bound signed access session in an HttpOnly cookie, then render the full page.

**Usage limit reached:** Display friendly message with the link title but no payment form:
> "This payment link has reached its maximum number of uses."

**Dark mode:** Uses `themeMode` setting. `'auto'` follows system preference via `prefers-color-scheme`. Colors applied via CSS custom properties.

### Success/Error Pages

- **Success** (`/pay/[slug]/success/[transactionId]`): Shows `successTitle` + rendered `successMessage` markdown. Polls transaction status to confirm.
- **Cancel/Error** (`/pay/[slug]/cancel/[transactionId]`): Shows `cancelTitle` + `cancelMessage` or `errorTitle` + `errorMessage` based on transaction status.

---

## UMES Integration Points

### Outbound: Checkout → Other Modules

| Target | UMES Mechanism | Spot/ID | Detail |
|--------|---------------|---------|--------|
| Main sidebar | Menu injection | `menu:sidebar:main` | "Checkout" group with items: Pay Links, Templates, Transactions |
| Gateway transactions DataTable | Row-actions injection | `data-table:payment_gateways.transactions.list:row-actions` | Inject checkout action buttons into the payment-gateway transactions table in Settings |
| Gateway transaction detail page | Widget injection | `admin.page:payment-gateways/transactions:after` | Checkout transaction details panel |
| Gateway transaction response | Response enricher | Target: `payment_gateways:gateway_transaction` | Adds `_checkout.transactionId`, `_checkout.linkName` if related |

**Payment gateway transactions DataTable actions**

- **Create Payment Link** — available from the payment-gateway transactions DataTable row actions in Settings
- Opens checkout link creation prefilled from the selected gateway transaction where possible:
  - provider key
  - amount / currency
  - title or description fallback from transaction metadata
- Uses the existing DataTable row-actions injection contract (`data-table:<tableId>:row-actions`)
- If the host page in the target release does not yet expose this standard action-button injection surface, add it as a minimal additive host change and keep the stable table id `payment_gateways.transactions.list`

**Menu injection detail:**

```typescript
// widgets/injection/sidebar-menu/widget.ts
export const menuItems: InjectionMenuItem[] = [
  {
    id: 'checkout-pay-links',
    labelKey: 'checkout.sidebar.payLinks',
    href: '/backend/checkout/pay-links',
    icon: 'link',
  },
  {
    id: 'checkout-templates',
    labelKey: 'checkout.sidebar.templates',
    href: '/backend/checkout/templates',
    icon: 'file-text',
  },
  {
    id: 'checkout-transactions',
    labelKey: 'checkout.sidebar.transactions',
    href: '/backend/checkout/transactions',
    icon: 'receipt',
  },
]

// widgets/injection-table.ts
export const injectionTable = {
  'menu:sidebar:main': {
    widgetId: 'checkout.sidebar-menu',
    priority: 60,
    placement: { kind: 'group', groupLabel: 'checkout.sidebar.group', groupIcon: 'shopping-bag' },
  },
}
```

### Inbound: Extension Points Exposed by Checkout

Other modules can extend checkout surfaces via these UMES spots:

**Widget injection spots (FROZEN once released):**

| Spot ID | Location | Context |
|---------|----------|---------|
| `checkout.pay-page:header:before` | Before header on pay page | `{ link, themeMode }` |
| `checkout.pay-page:header:after` | After header/logo | `{ link, themeMode }` |
| `checkout.pay-page:description:after` | After description | `{ link, themeMode }` |
| `checkout.pay-page:pricing:before` | Before pricing section | `{ link, pricingMode }` |
| `checkout.pay-page:pricing:after` | After pricing section | `{ link, selectedAmount }` |
| `checkout.pay-page:customer-fields:after` | After customer form fields | `{ link, customerData }` |
| `checkout.pay-page:payment:before` | Before payment section | `{ link, transaction }` |
| `checkout.pay-page:footer:before` | Before footer | `{ link }` |
| `checkout.pay-page:footer:after` | After footer | `{ link }` |
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
| `section:checkout.pay-page.pricing` | `PayPagePricing` | Replace pricing section |
| `section:checkout.pay-page.customer-form` | `PayPageCustomerForm` | Replace customer data form |
| `section:checkout.pay-page.payment-form` | `PayPagePaymentForm` | Replace payment form wrapper |

---

## Customer Data Collection

### Editor UI

The Customer Fields tab reuses `FieldDefinitionsEditor` from `@open-mercato/ui/backend/custom-fields/`. The editor supports:
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
  Return embeddedFormData              Return redirectUrl
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

### Gateway Provider Settings

When an admin selects a gateway provider in the pay link form:

1. The form calls `getPaymentProvider(providerKey)` from the sales provider registry
2. The provider's `settings.fields` array defines form fields (capture mode, form style, etc.)
3. These fields are rendered dynamically in the Payment tab
4. Values are stored in `link.gatewaySettings`
5. At payment time, checkout normalizes the supported subset of `gatewaySettings` into the current gateway session contract (`captureMethod`, `paymentTypes`, descriptive metadata)
6. Unsupported provider-specific session options are preserved in `link.gatewaySettings` for display / future extension, but are not sent to the gateway unless a later additive gateway-session contract explicitly supports them

This pattern stays aligned with the current platform boundary: the provider exposes configurable options generically, checkout renders them without knowing provider internals, and only the subset supported by the existing gateway session contract is active in Phase A.

### Core Module Change Policy

Phase A is designed to ship with **no required changes** to existing `payment_gateways` or `sales` contract surfaces:

- `paymentGatewayService.createPaymentSession()` already accepts a required `paymentId`; checkout uses `CheckoutTransaction.id`
- gateway events already emit `paymentId`, which is sufficient for checkout correlation
- webhook scope derivation already supports `organizationId` / `tenantId` in metadata
- checkout-specific gateway detail links are added through checkout-owned response enrichers and widgets, not by teaching core modules about checkout

Optional future optimization:
- a later additive-only enhancement may introduce generic `sourceType` / `sourceId` on gateway transactions for richer diagnostics, but that is explicitly **out of scope for Phase A**

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
8. **XSS prevention**: Markdown descriptions rendered with sanitized HTML (no raw HTML injection). User-entered data escaped in all contexts.
9. **Tenant isolation**: All queries scoped by `organizationId` + `tenantId`. Public slug lookups resolve tenant from the slug → link mapping. Status, success, and cancel flows must also validate `transaction.linkId === link.id`.
10. **No raw provider leakage**: Public APIs never expose gateway credentials, gateway settings, provider metadata, or raw webhook payloads.

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
- `checkout.transaction.completed` → success notification to all users with `checkout.view`
- `checkout.transaction.failed` → error notification to all users with `checkout.view`
- `checkout.link.usageLimitReached` → warning notification to users with `checkout.edit`

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

**Seed custom fields:** The `seed/custom-fields.ts` file creates example custom fields for `checkout:link`:
- `referenceCode` (text) — External reference
- `internalNotes` (multiline) — Internal notes for the team
- `priority` (select: low/medium/high) — Link priority level

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

Example custom field values are populated on seeded links.

---

## Phase B Preparation (Design for Reuse)

The Phase A data model and UI are designed to maximize code reuse for [Phase B — Simple Checkout](./2026-03-19-checkout-simple-checkout.md):

### Entity Design

- `CheckoutLink.checkoutType` column: `'pay_link'` (Phase A) or `'simple_checkout'` (Phase B)
- `CheckoutLinkTemplate.checkoutType`: same discriminator
- Phase B adds `CheckoutCartItem` entity linked to `CheckoutLink` (additive, no schema changes)
- Phase B adds `quoteId` and `orderId` nullable columns to `CheckoutTransaction` (additive-only)

### UI Reuse

- `LinkTemplateForm` component: Phase B adds a new tab "Products" visible when `checkoutType = 'simple_checkout'`
- `PayPage` component: Phase B adds an items/cart section above the pricing section, replaces pricing with order totals
- Public API: Phase B extends `POST /submit` to accept `cartItems` in the body
- Payment flow: identical — adapter-based session creation with the order total

### Code Sharing Strategy

| Component | Phase A | Phase B Extension |
|-----------|---------|-------------------|
| `LinkTemplateForm` | 8 tabs | +1 "Products" tab |
| `PayPage` | Pricing modes | Cart + totals |
| `PayPageCustomerForm` | Shared | Shared (no changes) |
| Payment flow | Amount-based | Order-total-based |
| Transaction tracking | Status + amount | +Quote/Order IDs |
| Email templates | Shared | Shared + order confirmation |
| Notifications | Shared | Shared |
| Search | Link + Template | Shared |
| UMES spots | All spots | +Cart-specific spots |

---

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
4. Create shared `LinkTemplateForm` component with all 8 tabs
5. Create backend pages for templates (list, create, edit)
6. Create backend pages for links (list, create, edit) with locked-link read-only view
7. Add slug generation and uniqueness validation
8. Wire custom fields (ce.ts) and verify copy from template to link
9. Wire search configuration

### Phase A.3: Sidebar & UMES Outbound

1. Implement sidebar menu injection (Checkout group with 3 items)
2. Inject `Create Payment Link` into the payment-gateway transactions DataTable row actions (`data-table:payment_gateways.transactions.list:row-actions`)
3. Implement widget injection into gateway transaction detail
4. Implement response enricher on gateway transactions
5. Create injection-table.ts with all spot definitions
6. Define component replacement handles

### Phase A.4: Public Pay Page & Payment Flow

1. Create public pay page components (PayPage, PayPagePricing, PayPageCustomerForm, PayPagePaymentForm)
2. Create public API routes (GET link, POST verify-password, POST submit, GET status)
3. Implement payment session creation via existing `paymentGatewayService` contract using `paymentId = checkoutTransaction.id`
4. Create gateway event subscriber (`gateway-payment-status.ts`) resolving checkout transactions by emitted `paymentId`
5. Implement password verification with slug-bound HttpOnly cookie sessions
6. Implement atomic reservation-based usage limit enforcement
7. Implement submit idempotency and transaction/slug binding on status pages
8. Create success/cancel/error pages
9. Add light/dark mode support
10. Add UMES extension spots on pay page

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

### Phase A.7: Integration Tests

1. Template CRUD tests (create, update, delete, list)
2. Link CRUD tests (create from template, update, lock after transaction, delete)
3. Public pay page tests (load, password protection, usage limits)
4. Payment flow tests (submit, webhook, status updates)
5. Transaction list and detail tests
6. PII access control tests (viewPii feature)
7. UMES integration tests (sidebar, gateway widget, payment-gateway transactions row action injection)

---

## Integration Test Coverage

| Test ID | Scenario | API/UI Path |
|---------|----------|-------------|
| TC-CHKT-001 | Create template, verify in list | `POST /api/checkout/templates`, `GET /api/checkout/templates` |
| TC-CHKT-002 | Update template, verify changes | `PUT /api/checkout/templates/:id` |
| TC-CHKT-003 | Delete template, verify soft delete | `DELETE /api/checkout/templates/:id` |
| TC-CHKT-004 | Create link from template, verify field copy | `POST /api/checkout/links` with `templateId` |
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
| TC-CHKT-020 | Sidebar menu visible with checkout.view feature | Navigate to `/backend`, verify sidebar group |
| TC-CHKT-021 | Custom fields copy from template to link | Verify custom field values after link creation |
| TC-CHKT-022 | Link deletion blocked with active transactions | `DELETE /api/checkout/links/:id` → 422 |
| TC-CHKT-023 | Inactive link returns 404 on public page | Deactivate link, `GET /api/checkout/pay/:slug` → 404 |
| TC-CHKT-024 | Amount tampering prevention (fixed mode) | `POST /submit` with wrong amount → 422 |
| TC-CHKT-025 | Submit replay with same `Idempotency-Key` does not create duplicate transactions | Repeat `POST /submit` with same header |
| TC-CHKT-026 | Status endpoint rejects transaction from another slug | `GET /status/:transactionId` with mismatched slug → 404 |
| TC-CHKT-027 | Password-protected status/success page requires verified session | Access after cookie expiry → blocked |
| TC-CHKT-028 | Payment-gateway transactions DataTable shows injected `Create Payment Link` row action | Settings → Payment Transactions table |

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

Phase A intentionally avoids modifications to existing public contract surfaces in `payment_gateways`, `sales`, or other core modules.

- **Auto-discovery conventions**: additive only; new package/module files follow existing conventions
- **Type/function contracts**: no existing public signatures need to change
- **Event IDs**: checkout adds new event IDs only; it consumes existing `payment_gateways.payment.*` events unchanged
- **API routes**: additive only; checkout introduces new `/api/checkout/*` endpoints
- **Database schema**: additive only; checkout introduces new checkout-owned tables/columns
- **Widget spots**: additive only; checkout adds new UMES spots and new checkout-owned enrichers/widgets

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
| API contracts match UI/UX section | Pass | All CrudForm tabs map to API fields |
| Risks cover all write operations | Pass | Template/Link CRUD, transaction creation, webhook processing, usage enforcement |
| Commands defined for all mutations | Pass | 7 commands covering all write operations |
| Cache strategy covered | N/A | Read-heavy public endpoint can add caching in future; admin CRUD volume is low |
| Events cover all state changes | Pass | 14 events covering CRUD + lifecycle |
| Search covers key entities | Pass | Links and templates indexed |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant** — Approved for implementation.

---

## Changelog

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
