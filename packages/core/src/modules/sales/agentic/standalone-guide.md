# Sales Module — Standalone App Guide

Use the sales module for orders, quotes, invoices, shipments, and payments. This module has the most complex business logic in the system.

## Document Flow

```
Quote → Order → Invoice
         ↓
    Shipments + Payments
```

- Quotes convert to orders — do not create orders without a source quote (unless configured)
- Orders track shipments and payments independently
- Each entity has its own status workflow — do not skip states
- Returns create line-level adjustments and update `returned_quantity`

## Pricing Calculations

Always use the sales calculation service — never inline price math:

```typescript
const calcService = container.resolve('salesCalculationService')
```

- Dispatches `sales.line.calculate.*` and `sales.document.calculate.*` events
- For catalog pricing: use `selectBestPrice` from the catalog module
- Register custom line/totals calculators or override via DI

## Channel Scoping

All sales documents are scoped to channels. Channel selection affects:
- Available pricing tiers
- Document numbering sequences
- Visibility in admin UI

## Data Model

### Core Entities
| Entity | Purpose | Key Constraint |
|--------|---------|---------------|
| **Sales Orders** | Confirmed customer orders | MUST have a channel and at least one line |
| **Sales Quotes** | Proposed orders | MUST track conversion status |
| **Order/Quote Lines** | Individual items | MUST reference valid products |
| **Adjustments** | Discounts/surcharges | MUST use registered `AdjustmentKind` |

### Fulfillment
| Entity | Purpose |
|--------|---------|
| **Shipments** | Delivery tracking with status workflow |
| **Payments** | Payment recording with status workflow |
| **Returns** | Order returns with line selection and automatic adjustments |

### Configuration (do not modify directly)
Channels, statuses, payment/shipping methods, price kinds, adjustment kinds, and document numbers — configure via admin UI or `setup.ts` hooks.

## Subscribing to Sales Events

```typescript
// src/modules/<your_module>/subscribers/order-created.ts
export const metadata = {
  event: 'sales.order.created',
  persistent: true,
  id: 'your-module-order-created',
}

export default async function handler(payload, ctx) {
  // React to new orders
}
```

Key events: `sales.order.created` / `updated` / `deleted`, `sales.quote.created` / `updated`, `sales.payment.created`, `sales.shipment.created`

## Extending Sales UI

Widget injection spots:

**Order & Quote detail page:**
- `sales.document.detail.order:details` — order detail page sections
- `sales.document.detail.quote:details` — quote detail page sections
- `sales.document.detail.order:tabs` — order detail page tabs
- `sales.document.detail.quote:tabs` — quote detail page tabs
- `detail:sales.order:stage-bar` — order stage bar (empty, ready for extension)
- `detail:sales.quote:stage-bar` — quote stage bar (empty, ready for extension)
- `detail:sales.order:closure` — order closure section (empty, ready for extension)
- `detail:sales.quote:closure` — quote closure section (empty, ready for extension)

**Order list:**
- `data-table:sales.orders:columns` — order list columns
- `data-table:sales.orders:row-actions` — order row actions

**Order form:**
- `crud-form:sales.sales_order:fields` — order detail form

**Payments:**
- `data-table:sales.payments:columns` — payment list columns

**Payment methods:**
- `crud-form:sales.payment_method:fields` — payment method form fields
- `crud-form:sales.sales_payment_method:fields` — sales payment method form fields

## Frontend Pages

- `frontend/quote/` — public-facing quote view for customer acceptance
