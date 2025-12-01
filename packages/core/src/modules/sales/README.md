# Sales Module

The sales module orchestrates quotes, orders, fulfillment, billing, and payments while remaining extensible through hooks, dictionaries, and custom fields. It depends on the catalog module for product data and the customers module for buyer identities, but keeps database relations module-local by storing external references as UUIDs.

## Data Model Overview

### Configuration Entities

- **SalesChannel** – Named channel with address/contact metadata; selectable on quotes and orders.
- **SalesShippingMethod**, **SalesDeliveryWindow**, **SalesPaymentMethod** – Scope aware dictionaries rendered as dedicated settings pages.
- **SalesTaxRate** – Tax definitions with geographic/customer/product scoping, priority, and compound handling.

### Documents

- **SalesQuote** + **SalesQuoteLine** – Pre-order documents supporting configurable line status dictionaries, per-line pricing snapshots, and optional custom fields.
- **SalesOrder** + **SalesOrderLine** – Confirmed orders capturing customer/address IDs, multi-currency totals (net/gross/tax/discount), and calculated fulfillment/payment aggregates.
- **SalesOrderAdjustment** / **SalesQuoteAdjustment** – Normalised adjustments (tax, discount, surcharge, shipping, custom) attachable at order or line scope.
- **SalesShipment** + **SalesShipmentItem** – Courier events with tracking, weight, declared value, and per-line quantities.
- **SalesInvoice** + **SalesInvoiceLine** – Billing records referencing optional order lines to enable partial invoicing.
- **SalesCreditMemo** + **SalesCreditMemoLine** – Return/credit documents tied to orders or invoices.
- **SalesPayment** + **SalesPaymentAllocation** – Payment receipts and allocations across orders/invoices, tracking captured/refunded amounts.
- **SalesNote** – Comment/annotation records for quotes, orders, invoices, and credit memos.

Every document entity includes `{ organizationId, tenantId }`, timestamps, soft-delete, and optional `customFieldSetId` hooks so user-defined fields plug in via the global EEAV system.

## Validation Layer

`data/validators.ts` mirrors each entity with zod schemas to enforce:

- Scope requirements, UUID identity, ISO currency codes, and distribution of totals across nested payloads (lines, adjustments, allocations, shipment items).
- Numeric coercion for monetary fields with inclusive validation for percentages and tier quantities.
- Payload types used by command handlers, CRUD factories, and future UI forms are exported for type-safe reuse.

## Calculation Pipeline

`lib/calculations.ts` + `lib/types.ts` provide a modular totals engine:

1. **Base Line Calculator** – Derives net, gross, tax, and discount amounts for `SalesLineSnapshot` inputs using high precision math.
2. **Hook Registry** – `registerSalesLineCalculator` and `registerSalesTotalsCalculator` allow other modules to prepend/append calculators that can override results.
3. **Event Emission** – `calculateLine` and `calculateDocumentTotals` emit `sales.line.calculate.{before,after}` and `sales.document.calculate.{before,after}` events (with `setResult` mutators) so runtime subscribers can replace totals without patching the pipeline.

The pipeline works for any `SalesDocumentKind` (`quote`, `order`, `invoice`, `credit_memo`) and shares logic between quotes and orders as requested.

## Access Control & Custom Fields

- `acl.ts` advertises feature switches (`sales.orders.manage`, `sales.payments.manage`, etc.) to gate UI/API endpoints.
- `ce.ts` registers custom-field containers for every major document/line, enabling the global custom field module to extend data without new columns.

## Status & Dictionary Integrations

- Status references (`statusEntryId`, `fulfillmentStatusEntryId`, etc.) expect dictionary entries from the dictionaries module (e.g., keys `sales.order_status`, `sales.order_line_status`).
- Shipping, payment, delivery, and tax configurations live in dedicated tables but should still expose manage flows via settings pages that respect `sales.settings.manage`.

## Extensibility Guidelines

- Avoid direct MikroORM relations to external modules; use UUID references and fetch lazily via DI services.
- When adding new document types, reuse `SalesAdjustmentKind` and the calculator registry instead of rolling bespoke totals logic.
- Emit commands with undo support (via `@open-mercato/shared/lib/commands`) for every state mutation; reducer style helpers can reuse the validators and calculation pipeline.
- When integrating catalog data, snapshot the necessary fields (`name`, `sku`, pricing, configuration`) to keep historical accuracy even if catalog entries change later.

## Frontend Events

- Sales document UI surfaces emit `sales:document:totals:refresh` after mutating items, adjustments, shipments, or payments; use `emitSalesDocumentTotalsRefresh({ documentId, kind })` from `lib/frontend/documentTotalsEvents.ts` to fire it.
- Subscribe via `subscribeSalesDocumentTotalsRefresh` to reload cached totals without coupling sections directly to the detail page.
