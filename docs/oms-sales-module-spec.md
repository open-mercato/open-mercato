# OMS Support in Sales Module (Open Mercato)

## Goal

Extend the existing Sales module to behave as a full OMS and integrate cleanly with the WMS module. The OMS layer should orchestrate order lifecycle, reservations, allocations, fulfillment requests, shipment progress, and returns, while WMS owns warehouse inventory operations. All cross-module links are foreign key ids only (no cross-module ORM relations).

---

## Current Sales Module Snapshot (Observed)

Core entities already exist:
- SalesOrder, SalesOrderLine, SalesOrderAdjustment
- SalesShipment, SalesShipmentItem
- SalesPayment, SalesInvoice, SalesCreditMemo
- Dictionary-based statuses for order, order line, shipment, payment

Key fields already present:
- Order: fulfillment_status, payment_status, shipping/delivery/payment snapshots
- Order line: reserved_quantity, fulfilled_quantity, returned_quantity
- Shipment: carrier/tracking, items_snapshot

Gaps for OMS + WMS support:
- No explicit fulfillment request workflow (order -> WMS request -> pick/pack/ship).
- No line-level allocation detail (warehouse, location, lot/serial, reservation ids).
- No order hold/cancel reason tracking.
- No backorder vs partial fulfillment orchestration.
- No return/RMA workflows.
- No explicit shipment package/label metadata, split shipment coordination, or WMS linkage.

---

## Proposed OMS Additions and Modifications

### A) New Entities (Sales module)

1) SalesFulfillmentRequest
- Represents a request from OMS to WMS for picking/packing/shipping.
- Fields:
  - order_id (uuid)
  - warehouse_id (uuid, FK id only)
  - status (enum: draft|requested|accepted|in_progress|packed|shipped|canceled|failed)
  - priority (int, default 0)
  - requested_ship_at (timestamptz, nullable)
  - requested_delivery_at (timestamptz, nullable)
  - shipping_method_id (uuid, nullable)
  - shipping_method_snapshot (jsonb)
  - metadata (jsonb)
  - created_at, updated_at, deleted_at

2) SalesFulfillmentLine
- Line-level request details, linked to order line.
- Fields:
  - fulfillment_request_id (uuid)
  - order_line_id (uuid)
  - product_id (uuid, nullable)
  - product_variant_id (uuid, nullable)
  - quantity_requested (numeric)
  - quantity_allocated (numeric)
  - quantity_picked (numeric)
  - quantity_packed (numeric)
  - quantity_shipped (numeric)
  - status (pending|allocated|picked|packed|shipped|short|canceled)
  - metadata (jsonb)

3) SalesAllocation
- OMS-side view of WMS allocation/reservation decisions.
- Fields:
  - fulfillment_line_id (uuid)
  - warehouse_id (uuid)
  - location_id (uuid, nullable)
  - lot_id (uuid, nullable)
  - serial_number (text, nullable)
  - quantity (numeric)
  - wms_reservation_id (uuid, nullable)
  - wms_movement_id (uuid, nullable)
  - status (reserved|allocated|released|fulfilled)
  - metadata (jsonb)

4) SalesOrderHold
- Enforced holds to block fulfillment or cancellation.
- Fields:
  - order_id (uuid)
  - code (text, required, e.g. payment_hold, fraud, manual)
  - reason (text, nullable)
  - status (active|released)
  - created_by (uuid, nullable)
  - released_by (uuid, nullable)
  - created_at, released_at

5) SalesReturn (RMA)
- OMS-driven return flow; can connect to WMS receiving.
- Fields:
  - order_id (uuid)
  - status (requested|approved|received|rejected|refunded|closed)
  - reason (text, nullable)
  - return_number (text)
  - warehouse_id (uuid, nullable)
  - metadata (jsonb)

6) SalesReturnLine
- Fields:
  - return_id (uuid)
  - order_line_id (uuid)
  - quantity_requested (numeric)
  - quantity_received (numeric)
  - quantity_accepted (numeric)
  - quantity_rejected (numeric)
  - disposition (restock|dispose|repair)
  - lot_id (uuid, nullable)
  - serial_number (text, nullable)

7) SalesShipmentPackage (optional in phase 2)
- Structured packaging for labels and WMS pack output.
- Fields:
  - shipment_id (uuid)
  - package_number (text)
  - weight_value, weight_unit
  - dimensions_json (jsonb)
  - tracking_number (text, nullable)
  - label_url (text, nullable)

### B) Extensions to Existing Entities

SalesOrder
- Add: `warehouse_id` (default fulfillment warehouse), `priority` (int), `hold_status` (derived), `fulfillment_policy` (enum: ship_complete|ship_partial|backorder)
- Add: `split_fulfillment` (boolean) to allow multi-warehouse shipments

SalesOrderLine
- Add: `backordered_quantity` (numeric)
- Add: `canceled_quantity` (numeric)
- Add: `picked_quantity`, `packed_quantity`, `shipped_quantity` (numeric)
- Keep `reserved_quantity` and `fulfilled_quantity` in sync with allocations and shipments

SalesShipment
- Add: `warehouse_id`, `fulfillment_request_id` (uuid)
- Add: `carrier_service_level` (text, nullable)
- Add: `labels_snapshot` (jsonb, nullable) for WMS packaging output

### C) Dictionary / Status Additions

Introduce new dictionaries (sales/lib/dictionaries.ts):
- fulfillment-request-status
- return-status
- return-line-status
- order-hold-status (optional)

Seed defaults (examples):
- fulfillment-request-status: draft, requested, accepted, in_progress, packed, shipped, canceled, failed
- return-status: requested, approved, received, rejected, refunded, closed

---

## OMS Workflows (High Level)

1) Order placement
- Validate inventory availability (read from WMS inventory balances).
- Create order lines with reserved_quantity = 0.
- Create fulfillment request if auto-fulfill enabled.

2) Reservation/Allocation
- OMS requests reservation from WMS using order line quantities and strategy (FIFO/LIFO/FEFO).
- WMS responds with allocation details (warehouse/location/lot/serial).
- OMS stores SalesAllocation entries, updates reserved_quantity and backordered_quantity.

3) Pick/Pack/Ship
- OMS sends fulfillment request to WMS (or WMS pulls).
- WMS updates status events (picked/packed/shipped) back to OMS.
- OMS updates fulfillment line and shipment items; creates SalesShipment and SalesShipmentPackage.

4) Returns
- OMS creates SalesReturn and SalesReturnLine.
- WMS receives return into inventory and sends confirmation.
- OMS updates return status and triggers refund/invoice credit memo.

---

## API Surface (Sales module)

All routes export openApi with zod schemas.

New endpoints:
- POST `/api/sales/orders/:id/fulfillment-requests`
- GET `/api/sales/fulfillment-requests`
- GET `/api/sales/fulfillment-requests/:id`
- POST `/api/sales/fulfillment-requests/:id/cancel`
- POST `/api/sales/fulfillment-requests/:id/accept` (WMS ack)
- POST `/api/sales/fulfillment-requests/:id/complete` (packed/shipped update)

- POST `/api/sales/orders/:id/holds`
- POST `/api/sales/orders/:id/holds/:holdId/release`

- POST `/api/sales/orders/:id/allocate`
- POST `/api/sales/orders/:id/release-allocations`

- POST `/api/sales/orders/:id/returns`
- GET `/api/sales/returns`
- POST `/api/sales/returns/:id/approve`
- POST `/api/sales/returns/:id/reject`
- POST `/api/sales/returns/:id/receive`
- POST `/api/sales/returns/:id/close`

Existing endpoints to extend:
- `/api/sales/orders` and `/api/sales/order-lines` should expose new fields (warehouse_id, allocation summaries, picked/packed/shipped quantities).

---

## Command Layer (Undoable)

Add commands to `packages/core/src/modules/sales/commands/`:
- `fulfillmentRequests.create`
- `fulfillmentRequests.cancel`
- `fulfillmentRequests.updateStatus`
- `orderHolds.create`
- `orderHolds.release`
- `allocations.create` (records WMS allocation + updates order line quantities)
- `allocations.release`
- `returns.create`
- `returns.approve`
- `returns.reject`
- `returns.receive`
- `returns.close`

All commands must:
- use `emitCrudSideEffects` + `emitCrudUndoSideEffects` with `indexer: { entityType, cacheAliases }`
- capture custom fields in snapshots as required
- enforce tenant/org scoping

---

## Validation (Zod)

Add schemas to `sales/data/validators.ts`:
- `fulfillmentRequestCreateSchema`
- `fulfillmentRequestUpdateSchema`
- `allocationCreateSchema`
- `allocationReleaseSchema`
- `orderHoldCreateSchema`
- `orderHoldReleaseSchema`
- `returnCreateSchema`
- `returnLineCreateSchema`
- `returnReceiveSchema`

Key validation rules:
- Allocation quantities must be <= (ordered - reserved - canceled).
- Backordered quantity >= 0 and only when insufficient inventory.
- Return lines must reference order lines and <= shipped quantity.
- Holds block fulfillment if active.
- Fulfillment request status transitions enforced (requested -> accepted -> in_progress -> packed -> shipped).

---

## WMS Integration Contract

Use event-driven integration via Event Bus:

OMS -> WMS events:
- `sales.fulfillment.requested` (order_id, fulfillment_request_id, warehouse_id, lines)
- `sales.fulfillment.canceled`
- `sales.return.requested`

WMS -> OMS events:
- `wms.allocation.created` (fulfillment_line_id, allocation details)
- `wms.allocation.released`
- `wms.pick.completed`
- `wms.pack.completed`
- `wms.ship.completed`
- `wms.return.received`

All events should include tenant_id and organization_id for scope.

---

## Search and UI

- Extend sales search config to include fulfillment status fields for orders.
- Add admin pages for fulfillment requests and returns.
- Extend order detail view to show allocations, pick/pack status, and returns.

---

## Phased Delivery

Phase 1 (OMS Core)
- New fulfillment request + allocation entities
- Order holds
- Fulfillment request API + events
- Minimal UI for fulfillment requests

Phase 2 (Returns)
- Return entities + APIs
- Return flows + status updates
- UI for returns

Phase 3 (Packaging and Labels)
- Shipment package entity
- Label metadata + carrier integrations
- UI for package labels

---

## Notes on Module Isolation

- No ORM relations to WMS entities; store ids only.
- Use WMS APIs/events for allocation and inventory movement updates.
- Keep OMS logic in Sales module; WMS only responds with inventory state and fulfillment progress.
