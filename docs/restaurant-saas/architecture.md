# Restaurant SaaS MVP Architecture

## Positioning

This delivery is a serious MVP vertical slice for a restaurant operating model built on top of Open Mercato.
It is intentionally pragmatic: the current implementation prioritizes a convincing and extensible end-to-end flow over premature back-office completeness.

## Product slices shipped tonight

1. **Public mobile-first table experience**
   - table-aware entry path via `/restaurant/table/[tableId]`
   - digital menu browsing
   - cart, notes, product configuration base
   - modeled online payment confirmation

2. **Operational execution workspace**
   - kitchen queue prioritized by table and urgency
   - floor delivery panel for ready dishes
   - admin panel with inventory, purchases and KPI cards

3. **Inventory intelligence base**
   - recipes per dish
   - automatic consumption from paid orders
   - committed stock from current unpaid cart
   - replenishment from supplier receipts
   - visibility into current / committed / available / incoming stock

## Architecture shape

### Current implementation

- **UI delivery**: Next.js routes via app-specific module `restaurant_ops`
- **State model**: in-memory React state seeded from structured demo data
- **Domain model**: menu, tables, recipes, orders, ingredients, supplier receipts
- **Inventory engine**: deterministic calculations derived from recipes and order lines
- **Evidence**: visual evidence artifact + markdown reviewer notes

### Why this shape

This repo already contains broad ERP primitives, but building a credible restaurant product overnight benefits from a vertical slice that is:

- demoable immediately
- readable tomorrow morning
- aligned with existing Open Mercato directions for storefront, POS, payment and units specs
- easy to evolve from demo state to persistent module-backed flows

## Recommended next evolution

### Phase 1 — persist the restaurant domain

Promote current demo structures into first-class entities/modules:

- `restaurant_locations`
- `restaurant_tables`
- `restaurant_menu`
- `restaurant_menu_items`
- `restaurant_recipes`
- `restaurant_orders`
- `restaurant_order_lines`
- `restaurant_kitchen_tickets`
- `restaurant_supplier_receipts`
- `restaurant_inventory_adjustments`

### Phase 2 — integrate with existing platform modules

- **catalog** as canonical menu/product source
- **sales** for order/payment records
- **payment_gateways** for real payment intents and webhooks
- **search/ecommerce** for public menu and storefront behavior
- **units** for conversion-aware ingredient handling
- **workflows/events** for kitchen/floor orchestration

### Phase 3 — SaaS hardening

- multi-restaurant tenant onboarding
- menu publishing workflows
- QR/table provisioning
- RBAC for cashier / kitchen / floor / manager
- real notifications and printing
- analytics persistence and daily close flows

## Key implementation choices

### Payment modeling

Tonight's build uses a **modeled payment success** instead of a real gateway.
This is deliberate: the goal is to prove the product workflow cleanly while keeping the payment boundary explicit for later provider integration.

### Inventory deduction timing

The MVP deducts recipe consumption on **successful payment**.
This is a pragmatic restaurant choice because the paid order becomes operationally committed and should enter kitchen immediately.

### Committed stock definition

To avoid fake precision, the MVP defines **committed stock** as ingredient demand from the current unpaid cart.
That gives planners a useful leading signal without double-counting already-paid orders.

## Review entry points

- `/restaurant`
- `/restaurant/table/t12`
