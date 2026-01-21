# Procurement / Purchasing Module Spec (Procure-to-Pay)

## Goal

Define a procurement module that manages vendors, purchase requests/orders, approvals, goods receipt, and 3-way matching (PO ↔ receipt ↔ invoice). This module should integrate with inventory (WMS) for receipt handling and with finance for invoice/payments. All cross-module links use foreign key ids only (no cross-module ORM relations).

---

## Scope

Primary capabilities:
- Vendor management
- Purchase requisitions and approvals
- Purchase orders and line items
- Goods receipt with discrepancy handling
- Supplier invoices and 3-way match
- Spend controls (budgets, thresholds, blocked items)

---

## Core Data Model (MikroORM entities)

All entities include: `id (uuid)`, `created_at`, `updated_at`, `deleted_at`, `tenant_id`, `organization_id`.

### 1) Vendor
- `name` (string, required)
- `code` (string, unique per org)
- `status` (active|inactive|blocked)
- `tax_id` (string, nullable)
- `contact_email` (string, nullable)
- `contact_phone` (string, nullable)
- `address_snapshot` (jsonb)
- `payment_terms` (text, nullable)
- `currency_code` (text, nullable)
- `metadata` (jsonb)

### 2) VendorContact
- `vendor_id` (uuid)
- `name` (string)
- `email` (string)
- `phone` (string, nullable)
- `role` (text, nullable)
- `is_primary` (boolean)

### 3) PurchaseRequest (PR)
- `request_number` (text)
- `requested_by_user_id` (uuid)
- `status` (draft|submitted|approved|rejected|canceled|converted)
- `needed_by` (date, nullable)
- `justification` (text, nullable)
- `total_estimated_amount` (numeric)
- `currency_code` (text)
- `metadata` (jsonb)

### 4) PurchaseRequestLine
- `purchase_request_id` (uuid)
- `product_id` (uuid, nullable)
- `product_variant_id` (uuid, nullable)
- `description` (text)
- `quantity` (numeric)
- `unit` (text, nullable)
- `estimated_unit_price` (numeric)
- `estimated_total` (numeric)
- `preferred_vendor_id` (uuid, nullable)
- `status` (pending|approved|rejected|canceled)
- `metadata` (jsonb)

### 5) PurchaseApproval
- `context_type` (purchase_request|purchase_order)
- `context_id` (uuid)
- `status` (pending|approved|rejected)
- `required_by_role` (text, nullable)
- `assigned_user_id` (uuid, nullable)
- `approved_by_user_id` (uuid, nullable)
- `approved_at` (timestamp, nullable)
- `reason` (text, nullable)

### 6) PurchaseOrder (PO)
- `order_number` (text)
- `vendor_id` (uuid)
- `status` (draft|sent|confirmed|partially_received|received|closed|canceled)
- `requested_by_user_id` (uuid, nullable)
- `issued_at` (timestamp, nullable)
- `expected_at` (timestamp, nullable)
- `currency_code` (text)
- `tax_amount` (numeric)
- `shipping_amount` (numeric)
- `discount_amount` (numeric)
- `subtotal_amount` (numeric)
- `total_amount` (numeric)
- `payment_terms` (text, nullable)
- `metadata` (jsonb)

### 7) PurchaseOrderLine
- `purchase_order_id` (uuid)
- `product_id` (uuid, nullable)
- `product_variant_id` (uuid, nullable)
- `description` (text)
- `quantity` (numeric)
- `unit` (text, nullable)
- `unit_price` (numeric)
- `total_price` (numeric)
- `received_quantity` (numeric)
- `billed_quantity` (numeric)
- `status` (open|partially_received|received|canceled|closed)
- `metadata` (jsonb)

### 8) GoodsReceipt (GRN)
- `receipt_number` (text)
- `purchase_order_id` (uuid)
- `warehouse_id` (uuid)
- `status` (draft|received|closed|canceled)
- `received_by_user_id` (uuid, nullable)
- `received_at` (timestamp, nullable)
- `notes` (text, nullable)
- `metadata` (jsonb)

### 9) GoodsReceiptLine
- `goods_receipt_id` (uuid)
- `purchase_order_line_id` (uuid)
- `product_id` (uuid, nullable)
- `product_variant_id` (uuid, nullable)
- `lot_id` (uuid, nullable)
- `serial_number` (text, nullable)
- `quantity_received` (numeric)
- `quantity_accepted` (numeric)
- `quantity_rejected` (numeric)
- `qc_status` (pending|passed|failed)
- `disposition` (restock|return_to_vendor|dispose)
- `metadata` (jsonb)

### 10) SupplierInvoice
- `invoice_number` (text)
- `vendor_id` (uuid)
- `purchase_order_id` (uuid, nullable)
- `status` (draft|received|matched|disputed|approved|paid|canceled)
- `invoice_date` (date)
- `due_date` (date, nullable)
- `currency_code` (text)
- `subtotal_amount` (numeric)
- `tax_amount` (numeric)
- `total_amount` (numeric)
- `metadata` (jsonb)

### 11) SupplierInvoiceLine
- `supplier_invoice_id` (uuid)
- `purchase_order_line_id` (uuid, nullable)
- `description` (text)
- `quantity` (numeric)
- `unit_price` (numeric)
- `total_price` (numeric)
- `matched_status` (unmatched|matched|variance)

### 12) ThreeWayMatch
- `purchase_order_id` (uuid)
- `goods_receipt_id` (uuid, nullable)
- `supplier_invoice_id` (uuid, nullable)
- `status` (pending|matched|variance|blocked)
- `variance_summary` (jsonb)

---

## Validations (Zod)

Add to `procurement/data/validators.ts`:
- `vendorCreateSchema`, `vendorUpdateSchema`
- `purchaseRequestCreateSchema`, `purchaseRequestLineSchema`
- `purchaseOrderCreateSchema`, `purchaseOrderLineSchema`
- `goodsReceiptCreateSchema`, `goodsReceiptLineSchema`
- `supplierInvoiceCreateSchema`, `supplierInvoiceLineSchema`
- `threeWayMatchSchema`

Key validation rules:
- PO lines quantity > 0, unit_price >= 0.
- GRN quantity_received <= remaining PO quantity.
- SupplierInvoice quantities and totals must match or be flagged as variance.
- Vendor must be active to issue PO.
- Approval required for thresholds (configurable).

---

## Commands (Undoable)

Add to `packages/core/src/modules/procurement/commands/`:
- `vendors.create`, `vendors.update`, `vendors.deactivate`
- `purchaseRequests.create`, `purchaseRequests.submit`, `purchaseRequests.approve`, `purchaseRequests.reject`, `purchaseRequests.cancel`
- `purchaseOrders.create`, `purchaseOrders.submit`, `purchaseOrders.confirm`, `purchaseOrders.cancel`, `purchaseOrders.close`
- `goodsReceipts.create`, `goodsReceipts.receive`, `goodsReceipts.close`, `goodsReceipts.cancel`
- `supplierInvoices.create`, `supplierInvoices.receive`, `supplierInvoices.match`, `supplierInvoices.dispute`, `supplierInvoices.approve`, `supplierInvoices.cancel`
- `threeWayMatch.evaluate`

All commands:
- use `emitCrudSideEffects` + `emitCrudUndoSideEffects` with `indexer: { entityType, cacheAliases }`
- enforce tenant/org scoping
- keep matched states in sync

---

## API Surface

All routes export `openApi` with Zod schemas.

- `/api/procurement/vendors`
- `/api/procurement/purchase-requests`
- `/api/procurement/purchase-orders`
- `/api/procurement/goods-receipts`
- `/api/procurement/supplier-invoices`
- `/api/procurement/three-way-match`

Key endpoints:
- POST `/api/procurement/purchase-requests/:id/submit`
- POST `/api/procurement/purchase-requests/:id/approve`
- POST `/api/procurement/purchase-orders/:id/confirm`
- POST `/api/procurement/goods-receipts/:id/receive`
- POST `/api/procurement/supplier-invoices/:id/match`

---

## 3-Way Match Logic

Match criteria:
- PO ↔ GRN: quantities per line within tolerance
- PO ↔ Invoice: unit price and totals within variance threshold
- GRN ↔ Invoice: received vs billed quantities

Status rules:
- `matched` if all lines within tolerance.
- `variance` if any line outside tolerance.
- `blocked` if vendor is blocked or approvals missing.

---

## Spend Controls

- Configurable approval thresholds (amount, vendor, category)
- Blocked vendors/products
- Budget caps per department or cost center (optional future phase)

---

## WMS Integration Contract

Events:
- `procurement.goods_receipt.created` → WMS to create inbound receipt
- `procurement.goods_receipt.received` → WMS to update inventory
- `wms.receipt.confirmed` → Procurement updates GRN status

---

## Phased Delivery

Phase 1 (Core P2P)
- Vendor, PR, PO, GoodsReceipt, SupplierInvoice entities
- Basic approvals and 3-way match
- CRUD APIs + validations

Phase 2 (Spend Controls)
- Approval thresholds and budget checks
- Vendor blocks and item restrictions

Phase 3 (Automation + Integrations)
- EDI import for invoices and POs
- Auto-match and auto-approve workflows
- Analytics dashboards
