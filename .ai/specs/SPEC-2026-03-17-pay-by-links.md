# SPEC-2026-03-17 — Pay by Links

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Created** | 2026-03-17 |
| **Module** | `payment_link_pages` (public page) + `payment_gateways` (admin/API) |
| **Related** | SPEC-058 (Payment Gateway Refactor), SPEC-044 |

---

## Summary

Shareable payment links that let customers pay for orders without logging in. Admin creates a link via API when creating a payment gateway session, customer opens the link and completes payment on a branded single-page checkout. Supports password protection, customer detail capture with terms/GDPR consent, custom branding, and provider-specific checkout widgets.

## How It Works

### Admin Flow

1. Create a payment gateway session with `paymentLink.enabled: true` via `POST /api/payment_gateways/sessions`
2. Response includes `paymentLinkUrl` (e.g., `https://merchant.example.com/pay/abc123`)
3. Share the URL with the customer (copy/paste — no built-in email sending)

### Customer Flow

1. Open the link in a browser
2. If password-protected: enter password to unlock (8-hour session)
3. If customer capture enabled: fill contact form (and accept terms if required)
4. View order summary (amount, currency, provider, custom fields)
5. Complete payment via the provider's checkout widget (Stripe Elements, redirect, bank details, etc.)
6. Auto-redirects to provider checkout when applicable (Stripe redirect, PayU, etc.)

```
┌─────────────────────────────────────────────────┐
│  [Logo]  Acme Corp                    [EN ▾]    │
│          Protected checkout                      │
│                                                  │
│  Secure payment link                             │
│  Invoice link                                    │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ $88.40       │  │ Provider: stripe          │ │
│  │ Amount due   │  │ Payment method            │ │
│  └──────────────┘  └──────────────────────────┘ │
│                                                  │
│  Status: ● Pending                               │
│                                                  │
│  Custom Fields                                   │
│  ┌──────────────────────────────────────────┐   │
│  │ supportEmail: billing@example.com        │   │
│  │ companyName: Acme Commerce Ltd           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │          Provider Checkout Widget         │   │
│  │     (Stripe Elements / redirect / etc.)   │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Data Model

### GatewayPaymentLink

Table: `gateway_payment_links`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `transaction_id` | UUID | FK to `GatewayTransaction` |
| `token` | VARCHAR | Unique. Auto-generated (18 random bytes, base64url) or custom slug |
| `provider_key` | VARCHAR | e.g., `stripe`, `wire-transfer`, `cash` |
| `title` | VARCHAR(160) | Display title on checkout page |
| `description` | VARCHAR(500) | Optional description |
| `password_hash` | VARCHAR | Nullable. Bcrypt hash (cost 10) |
| `status` | VARCHAR | `active`, `completed`, `cancelled` |
| `completed_at` | TIMESTAMP | Set when transaction settles |
| `metadata` | JSONB | Stores page branding, custom fields, customer capture state |
| `organization_id` | UUID | Tenant scope |
| `tenant_id` | UUID | Tenant scope |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |
| `deleted_at` | TIMESTAMP | Soft delete |

### Metadata JSONB Structure

```typescript
{
  amount?: number
  currencyCode?: string
  pageMetadata?: {
    logoUrl?: string
    brandName?: string
    securitySubtitle?: string
    accentColor?: string
    customCss?: string
  }
  customFields?: Record<string, unknown>
  customFieldsetCode?: string | null
  customerCapture?: {
    enabled: boolean
    companyRequired: boolean
    termsRequired: boolean
    termsMarkdown: string | null
    collectedAt?: string | null
    termsAcceptedAt?: string | null
    companyEntityId?: string | null
    personEntityId?: string | null
    companyName?: string | null
    personName?: string | null
    email?: string | null
  }
}
```

## API

### Admin (Authenticated)

#### POST /api/payment_gateways/sessions

Creates a payment session. Include the `paymentLink` object to generate a shareable URL.

**Feature gate**: `payment_gateways.manage`

```typescript
// Request — paymentLink fields
{
  providerKey: string
  amount: number
  currencyCode: string
  captureMethod?: 'automatic' | 'manual'
  description?: string
  paymentLink?: {
    enabled: boolean             // must be true to create a link
    title?: string               // required if enabled, max 160 chars
    description?: string         // max 500 chars
    password?: string            // min 4, max 128 chars
    token?: string               // custom slug, 3-80 chars, lowercase alphanumeric + hyphens
    metadata?: Record<string, unknown>  // page branding (logoUrl, brandName, etc.)
    customFields?: Record<string, unknown>  // arbitrary data displayed on page
    customFieldsetCode?: string  // max 100 chars
    customerCapture?: {
      enabled: boolean
      companyRequired?: boolean
      termsRequired?: boolean
      termsMarkdown?: string     // max 20,000 chars, required if termsRequired
    }
  }
}

// Response (when paymentLink.enabled)
{
  transactionId: string
  sessionId: string
  status: string
  paymentId: string
  paymentLinkId: string
  paymentLinkToken: string
  paymentLinkUrl: string         // e.g., "https://example.com/pay/abc123"
}
```

**Validation rules**:
- Title required when enabled
- Terms markdown required when `termsRequired: true`
- Custom token must match `^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$`
- Reserved tokens blocked: `api`, `app`, `admin`, `backend`, `auth`, `login`, `pay`, etc.
- Custom token uniqueness enforced per organization

### Public (No Auth)

#### GET /api/payment_link_pages/pay/:token

Returns the payment link page payload for rendering.

- If password-protected and no valid access token: returns 403 with minimal data (`passwordRequired: true`)
- Auto-refreshes transaction status from gateway if not settled
- Auto-marks link as `completed` if transaction is settled
- Applies response enrichers via UMES

```typescript
// Response (200)
{
  passwordRequired: false
  accessGranted: true
  link: {
    id: string
    token: string
    title: string
    description: string | null
    providerKey: string
    status: 'active' | 'completed' | 'cancelled'
    completedAt: string | null
    amount: number
    currencyCode: string
    paymentLinkWidgetSpotId: string | null
    metadata: Record<string, unknown> | null
    customFields: Record<string, unknown> | null
    customFieldsetCode: string | null
    customerCapture: {
      enabled: boolean
      companyRequired: boolean
      termsRequired: boolean
      termsMarkdown: string | null
      collected: boolean
    } | null
  }
  transaction: {
    id: string
    paymentId: string
    providerKey: string
    providerSessionId: string | null
    unifiedStatus: string
    gatewayStatus: string | null
    redirectUrl: string | null
    clientSecret: string | null
    amount: number
    currencyCode: string
    gatewayMetadata: Record<string, unknown> | null
    createdAt: string | null
    updatedAt: string | null
  }
  _meta: { enrichedBy: string[] }
}
```

#### POST /api/payment_link_pages/pay/:token/unlock

Verifies password and returns an 8-hour access token.

```typescript
// Request
{ password: string }  // 1-128 chars

// Response (200)
{ accessToken: string, passwordRequired: false }

// Response (403) — wrong password
{ error: string }
```

Access token format: `v1.{linkId}.{linkToken}.{expiresAtMs}.{hmacSignature}`
Stored in `sessionStorage` on the client.

#### POST /api/payment_link_pages/pay/:token/customer

Captures customer details before payment. Creates or links CRM records.

```typescript
// Request
{
  firstName: string     // 1-120 chars
  lastName: string      // 1-120 chars
  email: string         // valid email, max 320 chars
  phone?: string        // max 50 chars
  companyName?: string  // max 200 chars, required if companyRequired
  acceptedTerms?: boolean  // required if termsRequired
}

// Response (200)
{ ok: true, customerCapture: { collected: true } }
```

**Behavior**:
- Searches for existing person by email — reuses if found, creates if not
- Searches for existing company by name — reuses if found, creates if not
- Links person to company
- Stores all captured data in payment link metadata (`collectedAt`, entity IDs, etc.)

## Page Layout

### Sections

The checkout page is a two-column responsive layout (single column on mobile):

**Left column** (light background, teal-to-white gradient):
- Brand section: logo, company name, security subtitle, language switcher
- Summary section: title, description, amount/provider cards, status badge, custom fields display

**Right column** (dark theme, `#101828` background, light text):
- Checkout section — renders one of three states:
  1. **Password form** — if password-protected and not yet unlocked
  2. **Customer capture form** — if customer capture enabled and not yet collected
  3. **Provider checkout widget** — the payment gateway's embedded UI

### Auto-Redirect

When the transaction has a `redirectUrl` and no blocking conditions (no password, no pending capture, not settled, no `?checkout` query param), the page auto-redirects to the provider's hosted checkout via `window.location.replace()`.

### Status Badges

| Transaction Status | Color | Label |
|--------------------|-------|-------|
| `captured`, `authorized`, `completed` | Green | Paid / Authorized / Completed |
| `failed`, `cancelled` | Red | Failed / Cancelled |
| Others (pending, etc.) | Amber | Pending |

## Customization

### Branding (via metadata)

| Field | Purpose |
|-------|---------|
| `logoUrl` | Custom logo image URL in brand header |
| `brandName` | Company name (default: "Open Mercato") |
| `securitySubtitle` | Subtitle text (default: "Protected checkout") |
| `customCss` | Injected into `<style>` tag, scoped to page root |

### UMES Widget Injection Spots

| Spot ID | Location |
|---------|----------|
| `payment-link-pages.pay:before` | Before entire page |
| `payment-link-pages.pay:hero` | Before summary section |
| `payment-link-pages.pay:summary` | After summary section |
| `payment-link-pages.pay:checkout` | After checkout section |
| `payment-link-pages.pay:after` | After entire page |

### UMES Component Replacement Handles

| Handle | Component |
|--------|-----------|
| `payment-link-pages:brand` | Brand section |
| `payment-link-pages:summary` | Summary section |
| `payment-link-pages:checkout` | Checkout section |
| `payment-link-pages:page` | Root page component |

### Provider Checkout Widget

Each payment gateway provider can register a checkout widget via `paymentLinkWidgetSpotId` in their integration definition. The widget receives:

```typescript
{
  link: PaymentLinkData
  transaction: TransactionData
  metadata: Record<string, unknown> | null
  customFields: Record<string, unknown> | null
  refreshLink: () => Promise<void>  // callback to reload link state
}
```

## Security

- **Token generation**: 18 random bytes, base64url-encoded (144-bit entropy)
- **Password hashing**: bcrypt, cost factor 10
- **Access tokens**: HMAC-SHA256 signed with `APP_SECRET`, 8-hour TTL, timing-safe comparison
- **Tenant isolation**: All records scoped by `organization_id` + `tenant_id`
- **Soft deletion**: Cancelled links use `deleted_at`, not hard delete
- **No credentials exposed**: Gateway secrets never reach the client

## Events

### payment_link_pages module

| Event | Category | When |
|-------|----------|------|
| `payment_link_pages.page.viewed` | lifecycle | Customer opens the link |
| `payment_link_pages.page.unlocked` | lifecycle | Customer enters correct password |
| `payment_link_pages.customer.captured` | custom | Customer submits contact form |

### payment_gateways module

| Event | Category | When |
|-------|----------|------|
| `payment_gateways.payment_link.created` | crud | Link created with session |

## Permissions

Payment link creation requires `payment_gateways.manage`. Public endpoints (GET/unlock/customer) require no authentication.

No dedicated `payment_links.*` ACL features exist — link management is gated under the broader payment gateways feature set.

## Not Implemented

The following are described in SPEC-058 but not yet built:

- **Admin list/management UI** — no backend page; links created via API only
- **Email sending** — no send endpoint; share by copying the URL
- **Delete/cancel endpoint** — no API to cancel a link after creation
- **Link expiration** — links stay active until the transaction settles
- **Rate limiting on unlock** — no brute-force protection on password attempts
- **Analytics** — no view/conversion counters beyond event emission
- **QR code generation**
- **Reminders/follow-ups**

## Changelog

| Date | Change |
|------|--------|
| 2026-03-17 | Initial spec — documented actual implementation state |
