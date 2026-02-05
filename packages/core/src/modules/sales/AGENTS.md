# Sales Module — Agent Guidelines

The sales module handles orders, quotes, invoices, shipments, and payments. It has the most complex business logic in the system.

## Data Model

### Core Entities
- **Sales Orders** — confirmed customer orders
- **Sales Quotes** — proposed orders (convert to orders)
- **Order Lines / Quote Lines** — individual items in a document
- **Order Adjustments / Quote Adjustments** — discounts, surcharges

### Fulfillment
- **Shipments** — delivery tracking with status workflow
- **Payments** — payment recording with status workflow

### Configuration
- **Channels** — sales channels (web, POS, etc.)
- **Order Statuses / Payment Statuses / Shipment Statuses** — workflow states
- **Order Line Statuses** — per-line fulfillment tracking
- **Payment Methods** — accepted payment types
- **Shipping Methods** — available shipping options
- **Price Kinds** — pricing tier definitions
- **Adjustment Kinds** — discount/surcharge types
- **Delivery Windows** — scheduling options
- **Document Numbers** — numbering sequences
- **Tags** — categorization

## Pricing Calculations

**Never reimplement document math inline.** Use the DI-provided services:

- `salesCalculationService` — wraps the `salesCalculations` registry
- Dispatches `sales.line.calculate.*` / `sales.document.calculate.*` events
- Register line/totals calculators or override via DI

```typescript
// Use DI service, never calculate inline
const calcService = container.resolve('salesCalculationService')
```

For catalog pricing:
- Use helpers from `packages/core/src/modules/catalog/lib/pricing.ts`
- `selectBestPrice`, `resolvePriceVariantId`
- Register custom resolver: `registerCatalogPricingResolver(resolver, { priority })`
- Use DI token `catalogPricingService` for overrides

## Document Flow

```
Quote → Order → Invoice
         ↓
    Shipments + Payments
```

- Quotes can be converted to orders
- Orders track shipments and payments independently
- Each entity has its own status workflow

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `api/` | CRUD routes per entity (orders, quotes, lines, payments, shipments, etc.) |
| `backend/` | Admin pages (config, sales documents) |
| `commands/` | Undoable business commands |
| `components/` | Shared React components (documents table, forms, payment/shipment sections) |
| `data/` | ORM entities and validators |
| `emails/` | Email templates for order confirmations |
| `lib/` | Business logic (pricing providers, shipment helpers) |
| `seed/` | Example data for `seedExamples` |
| `services/` | Domain services (calculation, channel scoping) |
| `subscribers/` | Event subscribers (notifications, indexing) |
| `widgets/notifications/` | Notification renderers |

## Channel Scoping

Sales documents are scoped to channels. Channel selection affects:
- Available pricing tiers
- Document numbering sequences
- Visibility in admin UI

## Frontend

- `frontend/quote/` — public-facing quote view (for customer acceptance)

## Notifications

Full notification implementation:
- `notifications.ts` — server-side type definitions
- `notifications.client.ts` — client-side renderers
- `subscribers/` — event-driven notification creation
- `widgets/notifications/` — renderer components

## Reference Patterns

- Complex CRUD with related entities: `api/orders/route.ts`
- Multi-section detail page: `backend/sales/` pages
- Service-based calculations: `services/`
- Email on document creation: `subscribers/`
