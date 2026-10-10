# Freight phase 1 — spot orders and the sales bridge (buildable)

## TLDR

Deliver the `freight_operations` module skeleton and the full spot-order loop end-to-end: create a
one-time truck order → assign vehicle/driver (availability-checked against the fleet) → dispatch →
deliver with proof of delivery → issue a VAT invoice through the `sales` command bus → record a
bank-transfer payment with the invoice-totals sync. Demoable on its own.

Part of the program in [`2026-10-10-freight-program.md`](2026-10-10-freight-program.md).

## Overview

Scope of this phase:

- Module scaffold: `index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `events.ts`, i18n (6 locales),
  migration, `modules.ts` registration, create-app template mirroring entry.
- `FreightOrder` + `FreightDocumentSequence` entities with validators.
- Order lifecycle commands and routes (confirm/assign/dispatch/deliver/complete/cancel).
- The sales bridge: `orders.invoice` builds a sales order + invoice via the command bus; payments
  record through `sales.payments.create` with an explicit invoice-totals sync; a `resync` action.
- Module settings in `module_configs` (`api/settings`), dashboard summary, transport reference API.
- Backend screens: dashboard, orders list/create/edit/detail, settings.

## Problem Statement

See the program spec. Phase 1 must prove the riskiest integration — the sales bridge — on the
simplest document (a spot order), before contracts/trips/abstracts build on it.

## Proposed Solution

### Entities

`FreightOrder` (`freight_orders`): `order_number` (partial unique per org+tenant), `status`
(`draft|confirmed|assigned|in_transit|delivered|completed|invoiced|cancelled`), `customer_id` +
`customer_snapshot` jsonb, cargo block (`cargo_description`, `cargo_weight_kg`, `cargo_volume_m3`,
`cargo_quantity`, `cargo_unit`, `cargo_hazardous`, `cargo_refrigerated`, `temperature_min_c`,
`temperature_max_c`), `pickup_location`/`dropoff_location` (+ optional address snapshots),
`requested_pickup_at`/`requested_delivery_at`, `truck_type_required`
(`flatbed|curtain_side|refrigerated|tanker|tipper|lowbed|other`), `vehicle_id`/`driver_id` +
snapshots, `transport_trip_id` (optional operator link), execution stamps
(`assigned_at|dispatched_at|delivered_at|completed_at`), POD (`pod_document_id`,
`pod_reference`, `pod_received_by_name`, `pod_received_at`), money (`agreed_amount_net`,
`adjustment_amount_net` signed, `adjustment_note`, `currency_code` default SAR, `vat_rate`
default 15), sales links (`sales_order_id`, `sales_invoice_id`, `invoiced_at`), `notes`,
standard scope/timestamps/soft-delete.

`FreightDocumentSequence` (`freight_document_sequences`): `kind` (`order|contract|trip|abstract`),
`current_value`, partial unique per org+tenant+kind.

### Settings (`module_configs`, key `settings`, tenant-scoped)

`defaultRequiresCustomerApproval` (bool, default true — used by contracts in Phase 2),
`defaultPaymentTermsDays` (30), `defaultBillingCycle` (`monthly`), `defaultVatRate` (0.15),
`salesChannelId` (nullable), `requirePodForBilling` (bool, default false), number prefixes.
Read via `lib/freightSettings.ts` (mirrors `saudi_localization/lib/vat-settings.ts`); `updatedAt`
is the optimistic-lock version on the settings API.

### Commands

`freight_operations.orders.{create,update,delete,confirm,assign,dispatch,deliver,complete,cancel,invoice}`.

- `create` allocates the order number from the sequence; status `draft`.
- `confirm`: draft → confirmed; requires agreed amount, locations, customer in scope.
- `assign`: confirmed → assigned; vehicle/driver existence checked with the same rules as
  `transport_operations` (`assertFreightAssignmentAvailable`) but implemented over freight's own
  reads (see Coupling); writes id + snapshot.
- `dispatch`: assigned → in_transit (`dispatched_at = now`), re-checks availability.
- `deliver`: in_transit → delivered; requires POD (`pod_document_id` or `pod_reference`) when
  `settings.requirePodForBilling`; stamps `delivered_at`.
- `complete`: delivered → completed, requires POD.
- `cancel`: any of the above before `invoiced` → cancelled.
- `invoice`: completed → invoiced via the sales bridge (below); refuses when already linked.

### The sales bridge (`lib/salesBridge.ts` + `commands/orders.ts`)

1. Build invoice draft lines (pure `lib/invoiceDraft.ts`): one line, `kind: 'service'`, name from
   the order number + cargo, quantity 1, `unitPriceNet = roundToHalalas(agreed + adjustment)`,
   `taxRate` = order `vat_rate`; totals via `computeVatFromNet`.
2. `commandBus.execute('sales.orders.create', { input, ctx: scrubbedDispatchContext(ctx) })` with
   `customerEntityId` + `customerSnapshot`, `currencyCode`, `externalReference = order_number`,
   `metadata: { freight: { orderId, orderNumber } }`, `channelId` from settings when set,
   `dueAt = now + payment_terms_days`, lines.
3. `sales.invoices.create` with `orderId`, the same lines, explicit totals, `issueDate`/`dueDate`.
4. Persist links on the order (`sales_order_id`, `sales_invoice_id`, `invoiced_at`, status
   `invoiced`) in a locked transaction; on failure after order creation, compensate with
   `sales.orders.delete` and mark an internal orphan log entry (warranty_claims pattern).

### Payments (`commands/payments.ts` — Phase 1: record against the order's invoice)

1. `FreightPayment` row (recorded).
2. `sales.payments.create` (`orderId`, `amount`, `currencyCode`, `paymentReference`,
   `receivedAt`, `allocations: [{ invoiceId, amount, currencyCode }]`).
3. Explicit invoice sync: `sales.invoices.update` with computed `paidTotalAmount` /
   `outstandingAmount` (sum of non-voided `FreightPayment` rows) + `invoice_synced_at`.
4. `payments.void` mirrors with negative pressure; `payments.resync` repairs a forced mismatch.

### Coupling — fleet master data (`lib/transportReference.ts`)

- Snapshots on the order; tolerant scoped Kysely reads for pickers/validation
  (`transport_vehicles`, `transport_drivers`, `transport_routes`; `42P01` → `[]`).
- `assertFreightAssignmentAvailable` (module-local): vehicle must be `active`, driver must not be
  `suspended`/`on_leave` with a valid licence, and no overlapping non-cancelled `freight_orders`
  for the same vehicle/driver window (freight's own board is the source of truth in Phase 1).
- No `requires` on `transport_operations`; the reference API degrades to empty lists.

### API routes

`GET/POST/PUT/DELETE /api/freight_operations/orders` (filters `status`, `customerId`,
`requestedFrom/To`, `search`, `ids`; `updatedAt` in responses; indexer). Action routes
`orders/confirm|assign|dispatch|deliver|complete|cancel|invoice` (POST). `GET dashboard-summary`,
`GET/PUT settings`, `GET reference/transport`. All staff routes guarded by the `freight.*`
features; every route exports `openApi`; custom write routes wire `runRouteMutationGuards`.

### UI

`/backend/freight` (dashboard KPIs), `/backend/freight/orders` (list with status badges + row
actions per state), `orders/create` + `orders/[id]/edit` (`CrudForm`), `orders/[id]` (detail:
status timeline, assignment, POD, invoice card with sales links), `/backend/freight/settings`.

### Integration coverage (ships with this phase)

- `TC-FREIGHT-001-orders-list-filters-and-locking` — filters narrow; stale `updatedAt` → 409.
- `TC-FREIGHT-002-order-execution-lifecycle` — happy path incl. POD; illegal transitions → 409.
- `TC-FREIGHT-003-order-assignment-availability` — unavailable vehicle/driver refused.
- `TC-FREIGHT-004-spot-invoice-sales-bridge` — sales order + invoice exist with customer +
  service line; totals = agreed + adjustment, 15% VAT to the halala; second invoice call → 409.
- `TC-FREIGHT-005-payment-recording` — payment reduces invoice outstanding; void restores;
  partial payment correct; resync repairs.
- Unit: `documentNumber`, `invoiceDraft` (halala math), `freightSettings` merge,
  `assertFreightAssignmentAvailable` matrix, validators.

## Risks & Impact Review

See the program spec table (sales-bridge constraint, totals-sync gap, channel scoping).

## Final Compliance Report

- All new files module-local; no core package changes.
- `yarn generate`, `typecheck`, `lint`, unit + integration tests green; `template:sync` clean for
  the new module.
- Migration generated via `yarn db:generate`, freight SQL only, applied only with user approval.

## Changelog

- 2026-10-10: Initial phase-1 spec.
