# Checkout Module — Pay Links: UI Wireframes

Companion wireframes for [Checkout Pay Links Spec](./2026-03-19-checkout-pay-links.md).

---

## Backend Pages

### Pay Links List

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Pay Links                                                    [+ Create Link]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│  [Search pay links…                              ]  [Filters (2)]  [Export v]  │
│                                                                                 │
│  Active filters:  [Status: Active x]  [Pricing: Fixed x]         [Clear all]  │
├────┬──────────────┬──────────────┬──────────────┬────────┬────────┬────────┬───┤
│ [] │ Name         │ Slug         │ Pricing      │ Status │ Uses   │ Created│   │
├────┼──────────────┼──────────────┼──────────────┼────────┼────────┼────────┼───┤
│ [] │ Jan Consult  │ /pay/jan-c.. │ Fixed $150   │ Active │ 1 / 1  │ Mar 15 │ : │
│ [] │ Donation     │ /pay/donate  │ Custom $5-500│ Active │ 12 / * │ Mar 10 │ : │
│ [] │ Spring Gala  │ /pay/spring..│ Price List   │ Active │ 45/100 │ Mar 08 │ : │
│ [] │ Workshop Fee │ /pay/works.. │ Fixed $75    │ Inact. │ 0 / *  │ Mar 01 │ : │
├────┴──────────────┴──────────────┴──────────────┴────────┴────────┴────────┴───┤
│  : row action menu:                                                            │
│  ┌──────────────────────┐                                                      │
│  │  Edit                │                                                      │
│  │  View Pay Page       │                                                      │
│  │  Copy Link URL       │                                                      │
│  │  Show Transactions   │                                                      │
│  │ ──────────────────── │                                                      │
│  │  Delete              │                                                      │
│  └──────────────────────┘                                                      │
│                                                     Page 1 of 3  [< 1 2 3 >]  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Templates List

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Link Templates                                                [+ Create]      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  [Search…]                                                                     │
├────┬──────────────────┬──────────────┬──────────────┬───────────┬─────────┬────┤
│ [] │ Name             │ Pricing Mode │ Gateway      │ Max Uses  │ Created │    │
├────┼──────────────────┼──────────────┼──────────────┼───────────┼─────────┼────┤
│ [] │ Consulting Fee   │ Fixed        │ Stripe       │ 1         │ Mar 12  │ :  │
│ [] │ Donation         │ Custom Amt   │ Stripe       │ Unlimited │ Mar 10  │ :  │
│ [] │ Event Ticket     │ Price List   │ PayU         │ 100       │ Mar 08  │ :  │
├────┴──────────────────┴──────────────┴──────────────┴───────────┴─────────┴────┤
│  : row action menu:                                                            │
│  ┌────────────────────────────┐                                                │
│  │  Edit                      │                                                │
│  │  Create Link from Tmpl.    │                                                │
│  │ ─────────────────────────  │                                                │
│  │  Delete                    │                                                │
│  └────────────────────────────┘                                                │
│                                                       Page 1 of 1  [< 1 >]    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Transactions List

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  Transactions                                                         [Export v]             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  [Search transactions…                           ]  [Filters (1)]                            │
│                                                                                              │
│  Active filters:  [Link: Spring Gala x]                              [Clear]                │
├──────────────────┬──────────────┬────────────────┬─────────┬──────────┬────────┬─────────────┤
│ Link             │ Customer*    │ Email*         │ Amount  │ Status   │ Pay.St │ Date        │
├──────────────────┼──────────────┼────────────────┼─────────┼──────────┼────────┼─────────────┤
│ Jan Consulting   │ John Smith   │ john@acme.com  │ $150.00 │ Compltd  │ Captrd │ Mar 18      │
│ Donation         │ Alice Jones  │ alice@mail.co  │  $50.00 │ Compltd  │ Captrd │ Mar 17      │
│ Spring Gala      │ Bob Wilson   │ bob@corp.io    │  $75.00 │ Process. │ Pendng │ Mar 17      │
│ Donation         │ Eve Davis    │ eve@test.org   │  $25.00 │ Failed   │ Failed │ Mar 16      │
├──────────────────┴──────────────┴────────────────┴─────────┴──────────┴────────┴─────────────┤
│  * Customer and Email columns require checkout.viewPii permission.                           │
│    Users without this permission see these columns hidden.                                   │
│                                                            Page 1 of 5  [< 1 2 3 4 5 >]     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

Export menu (Export v):
┌─────────────────────────┐
│ Export filtered (CSV)    │
│ Export filtered (JSON)   │
│ Export all (CSV)         │
│ Export all (JSON)        │
└─────────────────────────┘
```

### Transaction Detail Page

```text
┌─────────────────────────────────────────────────────────────────────┐
│  <- Back to Transactions                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  * Completed                                    Mar 18, 2026 │  │
│  │  Transaction completed successfully.                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Payment Details ────────────────────────────────────────────┐  │
│  │  Amount:          $150.00 USD                                │  │
│  │  Status:          Completed                                  │  │
│  │  Payment Status:  Captured                                   │  │
│  │  Transaction ID:  a1b2c3d4-e5f6-7890-abcd-ef1234567890      │  │
│  │  Created:         2026-03-18 14:32:05                        │  │
│  │  Updated:         2026-03-18 14:33:12                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Link Details ───────────────────────────────────────────────┐  │
│  │  Link Name:       January Consulting Session                 │  │
│  │  Slug:            /pay/january-consulting                    │  │
│  │  Pricing Mode:    Fixed                                      │  │
│  │  [View Pay Link ->]                                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Customer Information ───────────────────────────────────────┐  │
│  │  * Requires checkout.viewPii permission                      │  │
│  │                                                              │  │
│  │  First Name:      John                                       │  │
│  │  Last Name:       Smith                                      │  │
│  │  Email:           john@acme.com                              │  │
│  │  Phone:           +1 555-123-4567                            │  │
│  │  Company:         Acme Corp                                  │  │
│  │  Address:         123 Main St, Springfield                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Gateway Transaction ────────────────────────────────────────┐  │
│  │  Gateway:         Stripe                                     │  │
│  │  Gateway Txn ID:  gw_9f8e7d6c-5b4a-3210                     │  │
│  │  [View Gateway Transaction ->]                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Custom Fields ──────────────────────────────────────────────┐  │
│  │  Reference Code:  INV-2026-0042                              │  │
│  │  Priority:        High                                       │  │
│  │  Internal Notes:  VIP client — fast-track processing         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Link/Template CrudForm

The `LinkTemplateForm` component renders as a `CrudForm` with **2-column scrollable layout**. Groups are assigned to columns: column 1 (left, ~60% width) for main content and column 2 (right, ~40% width) for secondary/settings content.

**CrudForm groups declaration:**

```typescript
const groups: CrudFormGroup[] = [
  { id: 'general', title: t('checkout.form.groups.general'), column: 1, fields: ['name', 'title', 'subtitle', 'description', 'slug'] },
  { id: 'appearance', title: t('checkout.form.groups.appearance'), column: 2, fields: ['logoAttachmentId', 'logoUrl', 'primaryColor', 'secondaryColor', 'backgroundColor', 'themeMode', 'displayCustomFieldsOnPage'] },
  { id: 'pricing', title: t('checkout.form.groups.pricing'), column: 1, fields: ['pricingMode', /* conditional fields */] },
  { id: 'payment', title: t('checkout.form.groups.payment'), column: 2, fields: ['gatewayProviderKey'], component: GatewaySettingsFields },
  { id: 'customerFields', title: t('checkout.form.groups.customerFields'), column: 1, component: CustomerFieldsEditor },
  { id: 'settings', title: t('checkout.form.groups.settings'), column: 2, fields: ['maxCompletions', 'password', 'isActive'] },
  { id: 'messages', title: t('checkout.form.groups.messages'), column: 1, fields: ['successTitle', 'successMessage', 'cancelTitle', 'cancelMessage', 'errorTitle', 'errorMessage'] },
  { id: 'emails', title: t('checkout.form.groups.emails'), column: 1, fields: ['startEmailSubject', 'startEmailBody', 'successEmailSubject', 'successEmailBody', 'errorEmailSubject', 'errorEmailBody'] },
  { id: 'customFields', title: t('checkout.form.groups.customFields'), column: 2, kind: 'customFields' },
]
```

**Full 2-column layout overview:**

```text
┌─ Create Pay Link ───────────────────────────────────────────────────────────────┐
│  <- Back to Pay Links                                          [Cancel] [Save]  │
│                                                                                 │
│  ┌─ Column 1 (~60%) ──────────────────┐  ┌─ Column 2 (~40%) ────────────────┐ │
│  │                                     │  │                                   │ │
│  │  ┌─ General ─────────────────────┐  │  │  ┌─ Appearance ───────────────┐  │ │
│  │  │ Name*, Title, Subtitle,       │  │  │  │ Logo upload/URL, Colors,   │  │ │
│  │  │ Description (markdown),       │  │  │  │ Theme mode, Custom fields  │  │ │
│  │  │ Slug + URL preview            │  │  │  │ on page checkbox           │  │ │
│  │  └───────────────────────────────┘  │  │  └─────────────────────────────┘  │ │
│  │                                     │  │                                   │ │
│  │  ┌─ Pricing ─────────────────────┐  │  │  ┌─ Payment ──────────────────┐  │ │
│  │  │ Mode select, conditional      │  │  │  │ Gateway select, dynamic    │  │ │
│  │  │ fields (Fixed/Custom/List)    │  │  │  │ provider settings          │  │ │
│  │  └───────────────────────────────┘  │  │  └─────────────────────────────┘  │ │
│  │                                     │  │                                   │ │
│  │  ┌─ Customer Fields ─────────────┐  │  │  ┌─ Settings ─────────────────┐  │ │
│  │  │ Field definitions editor      │  │  │  │ Max completions, Password, │  │ │
│  │  │ with fixed + custom fields    │  │  │  │ Active toggle              │  │ │
│  │  └───────────────────────────────┘  │  │  └─────────────────────────────┘  │ │
│  │                                     │  │                                   │ │
│  │  ┌─ Messages ────────────────────┐  │  │  ┌─ Custom Fields ────────────┐  │ │
│  │  │ Success/Cancel/Error titles   │  │  │  │ (auto-rendered via         │  │ │
│  │  │ + markdown bodies             │  │  │  │  entityId, kind:           │  │ │
│  │  └───────────────────────────────┘  │  │  │  'customFields')           │  │ │
│  │                                     │  │  └─────────────────────────────┘  │ │
│  │  ┌─ Emails ──────────────────────┐  │  │                                   │ │
│  │  │ Start/Success/Error subjects  │  │  │                                   │ │
│  │  │ + markdown bodies + preview   │  │  │                                   │ │
│  │  └───────────────────────────────┘  │  │                                   │ │
│  │                                     │  │                                   │ │
│  └─────────────────────────────────────┘  └───────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Group: General** (`column: 1`)

```text
┌─ General ───────────────────────────────────────────────────────────┐
│                                                                     │
│  Name *                                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ January Consulting Session                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Title                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Consulting Session Payment                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Subtitle                                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ One-hour strategy consultation                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Description (Markdown)                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Book your **one-hour consulting session** with our team.    │    │
│  │ Includes:                                                   │    │
│  │ - Strategy review                                           │    │
│  │ - Action plan document                                      │    │
│  │                                                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Slug  (link only)                                                  │
│  ┌──────────────────────────────────────────────────────┐ [~ Gen]   │
│  │ january-consulting                                   │           │
│  └──────────────────────────────────────────────────────┘           │
│  Preview: https://yourstore.com/pay/january-consulting              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Appearance** (`column: 2`)

```text
┌─ Appearance ────────────────────────────────────────────────────────┐
│                                                                     │
│  Logo                                                               │
│  o Upload file   * External URL                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ https://example.com/logo.png                                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  Preview: ┌──────┐                                                  │
│           │ LOGO │                                                  │
│           └──────┘                                                  │
│                                                                     │
│  Primary Color          Secondary Color       Background Color      │
│  ┌───────────────┐      ┌───────────────┐     ┌───────────────┐    │
│  │ #  #3B82F6    │      │ #  #1E40AF    │     │ #  #FFFFFF    │    │
│  └───────────────┘      └───────────────┘     └───────────────┘    │
│                                                                     │
│  Theme Mode                                                         │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Auto (follow system preference)                         v   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  [x] Display custom fields on pay page                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Pricing** (`column: 1`)

```text
┌─ Pricing ───────────────────────────────────────────────────────────┐
│                                                                     │
│  Pricing Mode                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Fixed Price                                             v   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  When "Fixed Price" is selected:                             ║  │
│  ║                                                              ║  │
│  ║  Amount *                        Currency *                  ║  │
│  ║  ┌──────────────────────┐        ┌──────────────────────┐   ║  │
│  ║  │ 150.00               │        │ USD              v   │   ║  │
│  ║  └──────────────────────┘        └──────────────────────┘   ║  │
│  ║                                                              ║  │
│  ║  [x] Price includes tax                                     ║  │
│  ║                                                              ║  │
│  ║  Original Amount (strikethrough -- promotional display)      ║  │
│  ║  ┌──────────────────────┐                                   ║  │
│  ║  │ 199.00               │  Shows as: ~~$199.00~~ $150.00    ║  │
│  ║  └──────────────────────┘                                   ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                     │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  When "Custom Amount" is selected:                           ║  │
│  ║                                                              ║  │
│  ║  Min Amount                      Max Amount                  ║  │
│  ║  ┌──────────────────────┐        ┌──────────────────────┐   ║  │
│  ║  │ 5.00                 │        │ 500.00               │   ║  │
│  ║  └──────────────────────┘        └──────────────────────┘   ║  │
│  ║                                                              ║  │
│  ║  Currency *                                                  ║  │
│  ║  ┌──────────────────────┐                                   ║  │
│  ║  │ USD              v   │                                   ║  │
│  ║  └──────────────────────┘                                   ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                     │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  When "Price List" is selected:                              ║  │
│  ║                                                              ║  │
│  ║  ┌────┬──────────────────────┬───────────┬──────────┬──────┐║  │
│  ║  │ :: │ Description          │ Amount    │ Currency │      │║  │
│  ║  ├────┼──────────────────────┼───────────┼──────────┼──────┤║  │
│  ║  │ :: │ General Admission    │  25.00    │ USD  v   │  x   │║  │
│  ║  │ :: │ VIP Access           │  75.00    │ USD  v   │  x   │║  │
│  ║  │ :: │ Premium Package      │ 150.00    │ USD  v   │  x   │║  │
│  ║  └────┴──────────────────────┴───────────┴──────────┴──────┘║  │
│  ║  [+ Add Price Item]                                          ║  │
│  ║                                                              ║  │
│  ║  :: = drag handle for reordering                              ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Payment** (`column: 2`)

```text
┌─ Payment ───────────────────────────────────────────────────────────┐
│                                                                     │
│  Gateway Provider                                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Stripe                                                  v   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ Provider Settings (Stripe) ────────────────────────────────┐   │
│  │                                                             │   │
│  │  Capture Method                                             │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Automatic                                     v   │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Payment Form Style                                         │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Embedded                                      v   │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  When NO provider is selected:                               ║  │
│  ║                                                              ║  │
│  ║  ! You must set up a payment integration first.              ║  │
│  ║    Go to Integrations to configure a payment provider.       ║  │
│  ║    [Set up integrations ->]                                  ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Customer Fields** (`column: 1`)

```text
┌─ Customer Fields ───────────────────────────────────────────────────┐
│                                                                     │
│  Configure which fields customers must fill in on the pay page.     │
│                                                                     │
│  ┌────┬────┬───────────────────┬────────────┬──────────┬──────────┐│
│  │    │    │ Label             │ Type       │ Required │          ││
│  ├────┼────┼───────────────────┼────────────┼──────────┼──────────┤│
│  │ L  │    │ First Name        │ text       │ [x]      │          ││
│  │ L  │    │ Last Name         │ text       │ [x]      │          ││
│  │ L  │    │ Email             │ text       │ [x]      │          ││
│  │ L  │    │ Phone             │ text       │ [ ]      │          ││
│  │    │ :: │ Company Name      │ text       │ [ ]      │ Ed  x   ││
│  │    │ :: │ Company ID        │ text       │ [ ]      │ Ed  x   ││
│  │    │ :: │ Address           │ multiline  │ [ ]      │ Ed  x   ││
│  │    │ :: │ T-Shirt Size      │ select     │ [x]      │ Ed  x   ││
│  └────┴────┴───────────────────┴────────────┴──────────┴──────────┘│
│                                                                     │
│  L = fixed (cannot be removed)    :: = drag to reorder             │
│                                                                     │
│  [+ Add Field]                                                      │
│                                                                     │
│  ┌─ Add Field Dialog ──────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Label *                                                    │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ T-Shirt Size                                      │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Type *                                                     │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Select                                        v   │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  [x] Required                                               │   │
│  │                                                             │   │
│  │  Options (for select/radio):                                │   │
│  │  ┌──────────────────┬──────────────────┬──────┐             │   │
│  │  │ Value            │ Label            │      │             │   │
│  │  ├──────────────────┼──────────────────┼──────┤             │   │
│  │  │ s                │ Small            │  x   │             │   │
│  │  │ m                │ Medium           │  x   │             │   │
│  │  │ l                │ Large            │  x   │             │   │
│  │  │ xl               │ X-Large          │  x   │             │   │
│  │  └──────────────────┴──────────────────┴──────┘             │   │
│  │  [+ Add Option]                                             │   │
│  │                                                             │   │
│  │                            [Cancel]  [Add Field (Cmd+Enter)]│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Settings** (`column: 2`)

```text
┌─ Settings ──────────────────────────────────────────────────────────┐
│                                                                     │
│  Max Completions                                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 100                                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  Leave empty for unlimited uses.                                    │
│                                                                     │
│  Password                                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ ********                                                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  If set, customers must enter this password before viewing          │
│  the pay page.                                                      │
│                                                                     │
│  Active                                                             │
│  [====*]  On                                                        │
│                                                                     │
│  Checkout Type                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Pay Link                                                v   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Messages** (`column: 1`)

```text
┌─ Messages ──────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ Success Message ───────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Title                                                      │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Payment Successful!                               │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Message (Markdown)                                         │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Thank you for your payment. You will receive a   │      │   │
│  │  │ confirmation email shortly.                      │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                              [Preview]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─ Cancel Message ────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Title                                                      │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Payment Cancelled                                 │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Message (Markdown)                                         │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Your payment was cancelled. You can try again     │      │   │
│  │  │ using the original link.                         │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                              [Preview]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─ Error Message ─────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Title                                                      │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Payment Error                                     │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Message (Markdown)                                         │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Something went wrong with your payment. Please    │      │   │
│  │  │ try again or contact support.                    │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                              [Preview]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Emails** (`column: 1`)

```text
┌─ Emails ────────────────────────────────────────────────────────────┐
│                                                                     │
│  Available variables: {{firstName}}, {{amount}}, {{currencyCode}},  │
│  {{linkTitle}}, {{transactionId}}, {{errorMessage}}                 │
│                                                                     │
│  ┌─ Start Email (sent when payment begins) ────────────────────┐   │
│  │                                                             │   │
│  │  Subject                                                    │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Your payment for {{linkTitle}} is being processed │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Body (Markdown)                                            │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Hi {{firstName}},                                │      │   │
│  │  │                                                  │      │   │
│  │  │ We're processing your payment of                 │      │   │
│  │  │ **{{amount}} {{currencyCode}}**.                  │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                              [Preview]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─ Success Email ─────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Subject                                                    │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Payment confirmed -- {{linkTitle}}                │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Body (Markdown)                                            │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Hi {{firstName}},                                │      │   │
│  │  │                                                  │      │   │
│  │  │ Your payment of **{{amount}} {{currencyCode}}**  │      │   │
│  │  │ has been confirmed. Reference: {{transactionId}} │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                              [Preview]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─ Error Email ───────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  Subject                                                    │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Payment issue -- {{linkTitle}}                    │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                                             │   │
│  │  Body (Markdown)                                            │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │ Hi {{firstName}},                                │      │   │
│  │  │                                                  │      │   │
│  │  │ There was an issue with your payment:            │      │   │
│  │  │ {{errorMessage}}                                 │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  │                                              [Preview]      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Group: Custom Fields** (`column: 2`, `kind: 'customFields'`)

```text
┌─ Custom Fields (auto-rendered via entityId) ────────────────────────────────────┐
│                                                                                 │
│  (Fields below are defined by admins in Settings -> Entities -> Pay Link)       │
│                                                                                 │
│  Reference Code                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ INV-2026-0042                                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  Priority                                                                       │
│  ┌──────────────────────────┐                                                   │
│  │ High                  v  │                                                   │
│  └──────────────────────────┘                                                   │
│                                                                                 │
│  Internal Notes                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ VIP client — expedite processing                                        │    │
│  │                                                                    ~ 3  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Locked link view:**

When `is_locked = true`, the form shows a read-only banner instead of editable groups:

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Pay Link: January Consulting Session                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  L This pay link has been used in 3 transaction(s) and can   │  │
│  │     no longer be edited.                                     │  │
│  │                                                              │  │
│  │     [Show Transactions ->]   [View Pay Page ->]              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ General ────────────────────────────────────────────────────┐  │
│  │  Name:          January Consulting Session                   │  │
│  │  Title:         Consulting Session Payment                   │  │
│  │  Subtitle:      One-hour strategy consultation               │  │
│  │  Slug:          /pay/january-consulting                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Payment ───────────────────────────────────────────────────┐  │
│  │  Gateway:       Stripe                                      │  │
│  │  Pricing Mode:  Fixed Price                                 │  │
│  │  Amount:        $150.00 USD                                 │  │
│  │  Includes Tax:  Yes                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Settings ──────────────────────────────────────────────────┐  │
│  │  Max Uses:      1                                           │  │
│  │  Completions:   1 / 1                                       │  │
│  │  Password:      Set                                         │  │
│  │  Status:        Active                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Description ───────────────────────────────────────────────┐  │
│  │  Book your one-hour consulting session with our team.       │  │
│  │  Includes:                                                  │  │
│  │  - Strategy review                                          │  │
│  │  - Action plan document                                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Public Pages

### Password Gate

```text
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                       ┌──────┐                                  │
│                       │ LOGO │                                  │
│                       └──────┘                                  │
│                                                                 │
│               Consulting Session Payment                        │
│                                                                 │
│         This payment page is password-protected.                │
│         Please enter the password to continue.                  │
│                                                                 │
│           ┌─────────────────────────────────────┐               │
│           │ ********                            │               │
│           └─────────────────────────────────────┘               │
│           x Invalid password. Please try again.                 │
│                                                                 │
│                  [     Continue     ]                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Pay Page -- Fixed Price Mode

Full-page wireframe with all layout sections and UMES injection spots marked.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  <-- checkout.pay-page:header:before  (UMES injection spot)            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         ┌──────┐                               │    │
│  │            bg color     │ LOGO │                               │    │
│  │                         └──────┘                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  <-- checkout.pay-page:header:after  (UMES injection spot)             │
│                                                                         │
│           ┌───────────────────────────────────────────┐                  │
│           │                                           │                  │
│           │     Consulting Session Payment             │                  │
│           │     One-hour strategy consultation         │                  │
│           │                                           │                  │
│           │  Book your **one-hour consulting           │                  │
│           │  session** with our team. Includes:        │                  │
│           │  - Strategy review                         │                  │
│           │  - Action plan document                    │                  │
│           │                                           │                  │
│           └───────────────────────────────────────────┘                  │
│                                                                         │
│  <-- checkout.pay-page:description:after  (UMES injection spot)        │
│                                                                         │
│  <-- checkout.pay-page:pricing:before  (UMES injection spot)           │
│                                                                         │
│           ┌─ Pricing ────────────────────────────────┐                  │
│           │                                          │                  │
│           │     ~~$199.00~~    $150.00 USD            │                  │
│           │                   (tax included)          │                  │
│           │                                          │                  │
│           └──────────────────────────────────────────┘                  │
│                                                                         │
│  <-- checkout.pay-page:pricing:after  (UMES injection spot)            │
│                                                                         │
│           ┌─ Your Information ───────────────────────┐                  │
│           │                                          │                  │
│           │  ┌──────────────┐  ┌──────────────┐      │                  │
│           │  │ John         │  │ Smith        │      │                  │
│           │  └──────────────┘  └──────────────┘      │                  │
│           │  First Name *       Last Name *           │                  │
│           │                                          │                  │
│           │  ┌─────────────────────────────────┐     │                  │
│           │  │ john@acme.com                   │     │                  │
│           │  └─────────────────────────────────┘     │                  │
│           │  Email *                                  │                  │
│           │                                          │                  │
│           │  ┌─────────────────────────────────┐     │                  │
│           │  │ +1 555-123-4567                 │     │                  │
│           │  └─────────────────────────────────┘     │                  │
│           │  Phone                                    │                  │
│           │                                          │                  │
│           │  ┌─────────────────────────────────┐     │                  │
│           │  │ Acme Corp                       │     │                  │
│           │  └─────────────────────────────────┘     │                  │
│           │  Company                                  │                  │
│           │                                          │                  │
│           └──────────────────────────────────────────┘                  │
│                                                                         │
│  <-- checkout.pay-page:customer-fields:after  (UMES injection spot)    │
│                                                                         │
│  <-- checkout.pay-page:payment:before  (UMES injection spot)           │
│                                                                         │
│           ┌─ Payment ────────────────────────────────┐                  │
│           │                                          │                  │
│           │  Card Number                              │                  │
│           │  ┌─────────────────────────────────┐     │                  │
│           │  │ 4242 4242 4242 4242              │     │                  │
│           │  └─────────────────────────────────┘     │                  │
│           │                                          │                  │
│           │  ┌───────────────┐  ┌───────────────┐    │                  │
│           │  │ 12/28         │  │ 123           │    │                  │
│           │  └───────────────┘  └───────────────┘    │                  │
│           │  Expiry              CVC                   │                  │
│           │                                          │                  │
│           └──────────────────────────────────────────┘                  │
│                                                                         │
│              ┌──────────────────────────────────┐                       │
│              │        Pay $150.00 USD            │                       │
│              └──────────────────────────────────┘                       │
│                                                                         │
│  <-- checkout.pay-page:footer:before  (UMES injection spot)            │
│                                                                         │
│           ┌──────────────────────────────────────┐                      │
│           │        Powered by Open Mercato        │                      │
│           └──────────────────────────────────────┘                      │
│                                                                         │
│  <-- checkout.pay-page:footer:after  (UMES injection spot)             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Pay Page -- Custom Amount Mode (Pricing Variant)

```text
           ┌─ Pricing ────────────────────────────────┐
           │                                          │
           │  Enter your amount:                       │
           │                                          │
           │  ┌──────┬───────────────────────────┐    │
           │  │ USD  │ 50.00                      │    │
           │  └──────┴───────────────────────────┘    │
           │                                          │
           │  Min: $5.00 -- Max: $500.00               │
           │                                          │
           │  x Amount must be between $5.00           │
           │    and $500.00.                           │
           │                                          │
           └──────────────────────────────────────────┘
```

### Pay Page -- Price List Mode (Pricing Variant)

```text
           ┌─ Select an Option ────────────────────────┐
           │                                            │
           │  (*) General Admission                     │
           │    Standard entry to the event    $25.00   │
           │                                            │
           │  ( ) VIP Access                            │
           │    Front-row seating + backstage   $75.00  │
           │                                            │
           │  ( ) Premium Package                       │
           │    VIP + dinner + signed merch    $150.00  │
           │                                            │
           └────────────────────────────────────────────┘
```

### Usage Limit Reached

```text
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                       ┌──────┐                                  │
│                       │ LOGO │                                  │
│                       └──────┘                                  │
│                                                                 │
│               Consulting Session Payment                        │
│                                                                 │
│         ┌───────────────────────────────────────────┐           │
│         │                                           │           │
│         │   This payment link has reached its        │           │
│         │   maximum number of uses.                  │           │
│         │                                           │           │
│         │   If you believe this is an error,         │           │
│         │   please contact the merchant.             │           │
│         │                                           │           │
│         └───────────────────────────────────────────┘           │
│                                                                 │
│           ┌──────────────────────────────────────┐              │
│           │        Powered by Open Mercato        │              │
│           └──────────────────────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Success Page

```text
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                       ┌──────┐                                  │
│                       │ LOGO │                                  │
│                       └──────┘                                  │
│                                                                 │
│                         OK                                      │
│                                                                 │
│                Payment Successful!                               │
│                                                                 │
│         ┌───────────────────────────────────────────┐           │
│         │                                           │           │
│         │  Thank you for your payment. You will      │           │
│         │  receive a confirmation email shortly.     │           │
│         │                                           │           │
│         └───────────────────────────────────────────┘           │
│                                                                 │
│         Transaction Reference:                                  │
│         a1b2c3d4-e5f6-7890-abcd-ef1234567890                   │
│                                                                 │
│         Amount: $150.00 USD                                     │
│                                                                 │
│         (Polling transaction status for confirmation...)         │
│                                                                 │
│           ┌──────────────────────────────────────┐              │
│           │        Powered by Open Mercato        │              │
│           └──────────────────────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Error / Cancel Page

```text
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                       ┌──────┐                                  │
│                       │ LOGO │                                  │
│                       └──────┘                                  │
│                                                                 │
│                         X                                       │
│                                                                 │
│                  Payment Cancelled                               │
│                                                                 │
│         ┌───────────────────────────────────────────┐           │
│         │                                           │           │
│         │  Your payment was cancelled. You can try   │           │
│         │  again using the original link.            │           │
│         │                                           │           │
│         └───────────────────────────────────────────┘           │
│                                                                 │
│              ┌──────────────────────────────────┐               │
│              │    Return to Payment Page         │               │
│              └──────────────────────────────────┘               │
│                                                                 │
│           ┌──────────────────────────────────────┐              │
│           │        Powered by Open Mercato        │              │
│           └──────────────────────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## UMES Widgets

### Gateway Transaction Detail -- Injected Widget

```text
┌─ Checkout Transaction ──────────────────────────────────────────────┐
│                                                                     │
│  Link Name:       January Consulting Session                        │
│  Slug:            /pay/january-consulting                           │
│  Transaction ID:  a1b2c3d4-e5f6-7890-abcd-ef1234567890             │
│  Status:          Completed                                         │
│  Customer:        John Smith (john@acme.com)                        │
│  Amount:          $150.00 USD                                       │
│  Created:         2026-03-18 14:32:05                               │
│                                                                     │
│  [View Checkout Transaction ->]   [View Pay Link ->]                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```
