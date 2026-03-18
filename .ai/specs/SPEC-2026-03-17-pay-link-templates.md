# SPEC-2026-03-17 — Pay Link Templates

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-17 |
| **Author** | Piotr Karwatka |
| **Module** | `payment_link_pages` |
| **Related** | SPEC-2026-03-17-pay-by-links, SPEC-058 |

---

## Problem

Creating a pay-by-link requires passing branding metadata, custom fields, customer capture config, and other settings via the API every time. There is no way to:

1. Save a reusable template with branding/metadata presets
2. Visually configure branding (logo, colors, text) without raw JSON
3. Quickly create a new link from a saved template

Merchants who send many payment links (invoicing, B2B, recurring services) need a way to define templates once and reuse them.

## Solution

Add a **Pay Link Template** entity with full CRUD, a visual branding editor, and a metadata JSON editor in the admin backend. When creating a payment session with a pay link, the admin can select a template to pre-fill all settings.

## Data Model

### PaymentLinkTemplate

Table: `payment_link_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | Tenant scope |
| `tenant_id` | UUID | Tenant scope |
| `name` | VARCHAR(200) | Admin-facing template name |
| `description` | VARCHAR(500) | Optional description |
| `is_default` | BOOLEAN | Default template for new links (one per org) |
| `branding` | JSONB | `{ logoUrl, brandName, securitySubtitle, accentColor, customCss }` |
| `default_title` | VARCHAR(160) | Pre-filled link title |
| `default_description` | VARCHAR(500) | Pre-filled link description |
| `custom_fields` | JSONB | Pre-filled custom field values |
| `custom_fieldset_code` | VARCHAR(100) | Pre-selected fieldset |
| `customer_capture` | JSONB | `{ enabled, companyRequired, termsRequired, termsMarkdown }` |
| `metadata` | JSONB | Any additional metadata to pass to links |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |
| `deleted_at` | TIMESTAMP | Soft delete |

### Branding JSONB

```typescript
{
  logoUrl?: string         // URL to logo image
  brandName?: string       // Company name in header
  securitySubtitle?: string // Subtitle under brand name
  accentColor?: string     // Hex color for accents
  customCss?: string       // Scoped CSS injected into page
}
```

## API

### Admin Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/payment-link-templates` | List templates |
| `POST` | `/api/payment-link-templates` | Create template |
| `GET` | `/api/payment-link-templates/:id` | Get template detail |
| `PUT` | `/api/payment-link-templates/:id` | Update template |
| `DELETE` | `/api/payment-link-templates/:id` | Archive (soft delete) |
| `POST` | `/api/payment-link-templates/:id/set-default` | Mark as default template |

**Feature gate**: `payment_link_pages.templates.manage`

### Integration with Session Creation

Extend `POST /api/payment_gateways/sessions` to accept an optional `templateId`:

```typescript
{
  paymentLink: {
    enabled: true,
    templateId?: string  // UUID — loads template, then overrides with any explicit fields
    title?: string       // overrides template default_title
    metadata?: {}        // deep-merged with template branding + metadata
    // ... other fields override template values
  }
}
```

**Merge behavior**: Template values serve as defaults. Any explicitly provided field in the request overrides the template value. `metadata` and `branding` are deep-merged (request wins on conflict).

## Backend Pages

### Template List Page

**Route**: `/backend/payment-link-templates`

DataTable with columns: Name, Default (badge), Description, Created, Actions

Row actions: Edit, Duplicate, Set as Default, Archive

### Template Create/Edit Page

**Route**: `/backend/payment-link-templates/new` and `/backend/payment-link-templates/:id`

Multi-section CrudForm:

#### Section 1: General

- Name (text, required)
- Description (multiline, optional)
- Is Default (toggle)

#### Section 2: Branding

Visual editor with live preview:

```
┌─────────────────────────────────────────────────────┐
│  Branding                                            │
│                                                      │
│  Logo                                                │
│  ┌──────────┐                                        │
│  │  [logo]  │  [Upload] [Remove]                     │
│  │  preview  │  PNG, SVG, or JPG. Max 2 MB.          │
│  └──────────┘                                        │
│                                                      │
│  Brand Name  [Acme Corp                       ]     │
│  Subtitle    [Secure payment                  ]     │
│  Accent Color [#1a73e8] [████]                      │
│                                                      │
│  Custom CSS                                          │
│  ┌─────────────────────────────────────────────┐    │
│  │ .checkout-brand { font-weight: 600; }       │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Preview                                             │
│  ┌─────────────────────────────────────────────┐    │
│  │ [Logo] Acme Corp                             │    │
│  │        Secure payment                        │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Logo upload** uses the `attachments` module:
- Upload button opens the attachment library picker or a direct file upload (PNG, SVG, JPG, max 2 MB)
- Uploaded file is stored via `POST /api/attachments/library` as a library attachment with `entityType: 'payment_link_templates'` and `entityId` set to the template ID
- The attachment's public URL is saved in `branding.logoUrl`
- Remove button clears `branding.logoUrl` (attachment stays in the library for reuse)
- Logo preview shown inline as a thumbnail

#### Section 3: Default Content

- Default Title (text, max 160) — pre-filled when creating links
- Default Description (multiline, max 500)

#### Section 4: Customer Capture

- Enable customer capture (toggle)
- Company name required (toggle, visible when capture enabled)
- Require terms acceptance (toggle)
- Terms markdown (multiline editor, visible when terms required)

#### Section 5: Custom Fields

- Fieldset code selector (dropdown of available fieldsets)
- Custom fields JSON editor (key-value pairs, with "Add field" button for simple mode)

#### Section 6: Additional Metadata

JSON editor for arbitrary metadata. Two modes:
- **Simple mode**: Key-value pair editor with Add/Remove buttons
- **Advanced mode**: Raw JSON textarea

## ACL Features

```typescript
export const features = [
  'payment_link_pages.templates.view',
  'payment_link_pages.templates.manage',
]
```

Default role features in `setup.ts`:

```typescript
defaultRoleFeatures: {
  admin: ['payment_gateways.*', 'payment_link_pages.templates.*'],
  employee: ['payment_link_pages.templates.view'],
}
```

## Events

```typescript
{ id: 'payment_link_pages.template.created', label: 'Template Created' },
{ id: 'payment_link_pages.template.updated', label: 'Template Updated' },
{ id: 'payment_link_pages.template.deleted', label: 'Template Archived' },
```

## Phases

### Phase 1 — Entity + API + Admin CRUD

- `PaymentLinkTemplate` entity and migration
- CRUD API with `makeCrudRoute`
- List and edit backend pages
- ACL features and setup defaults
- Events

### Phase 2 — Branding Editor + Preview

- Visual branding section with live preview component
- Color picker, logo upload/URL, CSS editor
- Mini preview of the brand header as it would appear on the payment page

### Phase 3 — Session Creation Integration

- Add `templateId` to session creation schema
- Template loading and deep-merge logic
- Template selector dropdown in the payment transaction create dialog (UMES)

### Phase 4 — Navigation Restructure

Move Payments from settings sidebar to main sidebar. Create a "Payments" group containing: Transactions, Links, Link Templates, Payment Providers.

### Phase 5 — Links Listing Page

New DataTable page at `/backend/payment-links` listing all GatewayPaymentLink records with status, token, title, amount, mode, provider, uses, created date. Row actions: copy URL, open link, view transaction.

### Phase 6 — Customer Capture Form Customization

Per-field visible/required config for customer capture form (email always required). Support for custom form fields with type, label, placeholder, hint, options. Terms field uses markdown editor.

### Phase 7 — Multi-Use Payment Links

Add `linkMode` column (single/multi) to GatewayPaymentLink. Multi-use links create transactions on-demand when customers visit. New junction table `gateway_payment_link_transactions` for 1:many tracking. New public API `POST /api/payment_link_pages/pay/[token]/session`. useCount/maxUses tracking.

### Phase 8 — Browser Testing

E2E verification of all features.

## Navigation

Add to sidebar under Payment Gateways group:

```
Payment Gateways
  ├── Transactions
  └── Link Templates  ← NEW
```

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Entity + API + Admin CRUD | Done | 2026-03-17 | Entity, validators, CRUD API, list/create/edit pages, ACL, events, i18n |
| Phase 2 — Branding Editor + Preview | Done | 2026-03-17 | BrandingPreview component, shared form config extraction, integrated into create/edit pages |
| Phase 3 — Session Creation Integration | Done | 2026-03-17 | templateId added to session schema, deep-merge logic in session route, template loading with tenant scoping |

## Changelog

| Date | Change |
|------|--------|
| 2026-03-17 | Initial draft |
| 2026-03-17 | All phases implemented — entity, API, admin pages, branding preview, session integration with template deep-merge |
| 2026-03-17 | Added Phases 4-8: navigation restructure, links listing page, customer capture form customization, multi-use payment links, browser testing |
