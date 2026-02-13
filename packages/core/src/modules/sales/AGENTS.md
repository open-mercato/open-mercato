# Sales Module — Agent Guidelines

Use the sales module for orders, quotes, invoices, shipments, and payments. This module has the most complex business logic in the system.

## MUST Rules

1. **MUST NOT reimplement document math inline** — use `salesCalculationService` from DI
2. **MUST follow document flow**: Quote → Order → Invoice — no skipping steps
3. **MUST NOT modify configuration entities directly** (statuses, methods, channels) — use the admin UI or setup hooks
4. **MUST use `selectBestPrice`** from catalog pricing helpers — never inline price calculations
5. **MUST scope all documents to a channel** — channel selection affects pricing, numbering, and visibility

## Document Flow

```
Quote → Order → Invoice
         ↓
    Shipments + Payments
```

- Quotes convert to orders — MUST NOT create orders without a source quote (unless configured)
- Orders track shipments and payments independently
- Each entity has its own status workflow — MUST NOT skip workflow states

## Pricing Calculations

Resolve `salesCalculationService` from DI for all document math:

```typescript
const calcService = container.resolve('salesCalculationService')
```

- Dispatches `sales.line.calculate.*` / `sales.document.calculate.*` events
- Register line/totals calculators or override via DI
- For catalog pricing: use `selectBestPrice`, `resolvePriceVariantId` from catalog module

## Data Model Constraints

### Core Entities
- **Sales Orders** — confirmed customer orders. MUST have a channel and at least one line
- **Sales Quotes** — proposed orders. MUST track conversion status
- **Order/Quote Lines** — individual items. MUST reference valid products
- **Adjustments** — discounts/surcharges. MUST use registered `AdjustmentKind`

### Fulfillment
- **Shipments** — delivery tracking. MUST follow status workflow
- **Payments** — payment recording. MUST follow status workflow

### Configuration — MUST NOT Modify Directly
- **Channels** — sales channels (web, POS). Configure via admin UI
- **Statuses** (order, payment, shipment, line) — workflow states. Seed via `setup.ts`
- **Payment/Shipping Methods** — configure via admin UI
- **Price Kinds, Adjustment Kinds** — configure via admin UI
- **Document Numbers** — numbering sequences. Configure via `setup.ts`

## Channel Scoping

Sales documents are scoped to channels. Channel selection affects:
- Available pricing tiers
- Document numbering sequences
- Visibility in admin UI

## Key Directories

| Directory | When to modify |
|-----------|---------------|
| `api/` | When adding/modifying CRUD routes per entity |
| `backend/` | When changing admin pages (config, sales documents) |
| `commands/` | When adding undoable business commands |
| `components/` | When modifying shared React components (document table, forms, payment/shipment sections) |
| `data/` | When changing ORM entities or validators |
| `emails/` | When modifying order confirmation email templates |
| `lib/` | When changing business logic (pricing providers, shipment helpers) |
| `services/` | When modifying calculation or channel scoping services |
| `subscribers/` | When adding event subscribers (notifications, indexing) |

## Reference Patterns

- Complex CRUD with related entities: `api/orders/route.ts`
- Multi-section detail page: `backend/sales/` pages
- Service-based calculations: `services/`
- Email on document creation: `subscribers/`
- Notification implementation: `notifications.ts`, `notifications.client.ts`, `widgets/notifications/`

## Frontend

- `frontend/quote/` — public-facing quote view (for customer acceptance)
