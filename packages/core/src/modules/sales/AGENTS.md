# Sales Module — Agent Guidelines

Use the sales module for orders, quotes, invoices, shipments, and payments. This module has the most complex business logic in the system.

## Always

1. **MUST use `salesCalculationService` from DI** for document math.
2. **MUST follow document flow**: Quote → Order → Invoice — no skipping steps
3. **MUST scope all documents to a channel** — channel selection affects pricing, numbering, and visibility

## Ask First

- Ask before changing the Quote → Order → Invoice flow, workflow states, numbering rules, or channel scoping behavior.
- Ask before changing configuration entity semantics for statuses, methods, channels, price kinds, adjustment kinds, or document numbers.

## Never

- Never reimplement document math inline.
- Never skip configured document workflow states.
- Never modify configuration entities directly; use the admin UI or setup hooks.
- Never inline price calculations.

## Validation Commands

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
```

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
- **Current state (not yet wired):** no production code path in this module calls `catalog`'s `selectBestPrice`/`resolvePriceVariantId`/`catalogPricingService` today — sales line pricing is entered/edited directly on the line, not resolved from `CatalogProductPrice`. An earlier revision of this file stated the opposite as an already-enforced `MUST` rule; that was aspirational, not descriptive. Wiring sales to the catalog pricing engine is tracked separately (`2026-08-14-cart-module.md`, a future `sales`-specific spec) and is out of scope for `.ai/specs/2026-08-21-pricing-engine.md`. If/when that wiring lands, route it through `catalogPricingService` per `catalog/AGENTS.md` — never reimplement pricing inline in `sales`.

## Data Model Constraints

### Core Entities
- **Sales Orders** — confirmed customer orders. MUST have a channel and at least one line
- **Sales Quotes** — proposed orders. MUST track conversion status
- **Order/Quote Lines** — individual items. MUST reference valid products
- **Adjustments** — discounts/surcharges. MUST use registered `AdjustmentKind`

### Fulfillment
- **Shipments** — delivery tracking. MUST follow status workflow
- **Payments** — payment recording. MUST follow status workflow
- **Returns** — order returns with line selection; create return generates line-level adjustments (kind `return`, negative amounts), updates `returned_quantity`, recalculates order totals. Use `sales.return.create` command; list via `GET /api/sales/returns?orderId=...`

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
