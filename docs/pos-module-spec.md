# POS Module Specification (Point of Sale)

## Goal

Provide a POS module for in-store sales that creates Sales orders/payments, manages registers/sessions, supports cash handling, returns/exchanges, and connects to WMS for immediate fulfillment when store inventory is involved. All cross-module links use foreign key ids only (no cross-module ORM relations).

---

## Scope

Primary capabilities:
- Registers and sessions (open/close, cash drawer, reconciliation)
- Fast cart (scan/search items, price overrides, discounts)
- Multiple payment methods (cash/card/split)
- Receipt generation and refunds
- Returns/exchanges with validation against original sale
- Optional store fulfillment (pickup/ship) with WMS integration

---

## Core Data Model (MikroORM entities)

All entities include: `id (uuid)`, `created_at`, `updated_at`, `deleted_at`, `tenant_id`, `organization_id`.

### 1) PosRegister
- `name` (text)
- `code` (text, unique per org)
- `warehouse_id` (uuid, nullable) — links to WMS warehouse id for store stock
- `status` (active|inactive|maintenance)
- `metadata` (jsonb)

### 2) PosSession
- `register_id` (uuid)
- `opened_by_user_id` (uuid)
- `closed_by_user_id` (uuid, nullable)
- `status` (open|closed|suspended)
- `opened_at` (timestamp)
- `closed_at` (timestamp, nullable)
- `opening_float_amount` (numeric)
- `closing_cash_amount` (numeric, nullable)
- `expected_cash_amount` (numeric, nullable)
- `variance_amount` (numeric, nullable)
- `currency_code` (text)
- `metadata` (jsonb)

### 3) PosCashMovement
- `session_id` (uuid)
- `type` (cash_in|cash_out|float_adjustment|payout)
- `amount` (numeric)
- `reason` (text, nullable)
- `reference` (text, nullable)
- `created_by_user_id` (uuid)

### 4) PosCart
- `session_id` (uuid)
- `status` (open|completed|abandoned)
- `customer_id` (uuid, nullable)
- `sales_order_id` (uuid, nullable) — FK to SalesOrder id
- `currency_code` (text)
- `metadata` (jsonb)

### 5) PosCartLine
- `cart_id` (uuid)
- `product_id` (uuid, nullable)
- `product_variant_id` (uuid, nullable)
- `description` (text)
- `quantity` (numeric)
- `unit_price_net` (numeric)
- `unit_price_gross` (numeric)
- `discount_amount` (numeric)
- `tax_rate` (numeric)
- `total_net_amount` (numeric)
- `total_gross_amount` (numeric)
- `price_override_reason` (text, nullable)
- `metadata` (jsonb)

### 6) PosPayment
- `session_id` (uuid)
- `cart_id` (uuid)
- `sales_payment_id` (uuid, nullable) — FK to SalesPayment id
- `method` (cash|card|voucher|gift_card|custom)
- `amount` (numeric)
- `currency_code` (text)
- `status` (authorized|captured|voided|refunded)
- `provider_reference` (text, nullable)

### 7) PosReceipt
- `cart_id` (uuid)
- `receipt_number` (text)
- `issued_at` (timestamp)
- `delivery_method` (print|email|sms)
- `recipient` (text, nullable)
- `payload_snapshot` (jsonb) — receipt layout data

### 8) PosReturn
- `session_id` (uuid)
- `sales_order_id` (uuid)
- `status` (requested|approved|completed|rejected)
- `reason` (text, nullable)
- `metadata` (jsonb)

### 9) PosReturnLine
- `pos_return_id` (uuid)
- `sales_order_line_id` (uuid)
- `quantity` (numeric)
- `refund_amount` (numeric)
- `disposition` (restock|dispose|repair)

---

## Extensions to Existing Sales Module

- POS creates `SalesOrder` and `SalesPayment` records for completed carts.
- Set `SalesOrder.channel_id` to a SalesChannel representing POS (metadata flag: `channel_type = pos`).
- For store pickup/ship, record `warehouse_id` on the POS side and push fulfillment to WMS as needed.

---

## Validations (Zod)

Add to `pos/data/validators.ts`:
- `registerCreateSchema`, `registerUpdateSchema`
- `sessionOpenSchema`, `sessionCloseSchema`
- `cashMovementSchema`
- `cartCreateSchema`, `cartLineSchema`
- `paymentCreateSchema`
- `returnCreateSchema`, `returnLineSchema`

Key validation rules:
- Session must be open to add cart lines or accept payments.
- Cash movements require a reason.
- Cart line quantity > 0; price overrides require `price_override_reason`.
- Sum of payments must cover cart total to complete.
- Returns must not exceed sold quantity.

---

## Commands (Undoable)

Add to `packages/core/src/modules/pos/commands/`:
- `registers.create`, `registers.update`, `registers.deactivate`
- `sessions.open`, `sessions.close`, `sessions.suspend`, `sessions.resume`
- `cashMovements.create`
- `carts.create`, `carts.addLine`, `carts.updateLine`, `carts.removeLine`, `carts.complete`
- `payments.create`, `payments.void`, `payments.refund`
- `returns.create`, `returns.complete`, `returns.reject`

All commands:
- use `emitCrudSideEffects` + `emitCrudUndoSideEffects` with `indexer: { entityType, cacheAliases }`
- enforce tenant/org scoping
- update Sales module entities as part of completion/return commands

---

## API Surface

All routes export `openApi` with Zod schemas.

- `/api/pos/registers`
- `/api/pos/sessions`
- `/api/pos/cash-movements`
- `/api/pos/carts`
- `/api/pos/cart-lines`
- `/api/pos/payments`
- `/api/pos/receipts`
- `/api/pos/returns`

Key endpoints:
- POST `/api/pos/sessions/:id/open`
- POST `/api/pos/sessions/:id/close`
- POST `/api/pos/carts/:id/complete`
- POST `/api/pos/returns/:id/complete`

---

## POS Workflow (High Level)

1) Open session
- Cashier opens a session with opening float.

2) Build cart
- Scan or search items; allow price override with reason.
- Apply discounts and compute totals with Sales calculation service.

3) Take payment
- Record one or more payments.
- On success, create SalesOrder + SalesPayment, mark POS cart completed.

4) Issue receipt
- Print/email/SMS receipt using PosReceipt payload snapshot.

5) Returns
- Validate original sale; create PosReturn + Sales adjustments/refunds.

---

## WMS Integration

- Optional: POS may create fulfillment requests to WMS when shipping from store stock.
- For immediate pickup, mark fulfilled without WMS.
- Events:
  - `pos.sale.completed` → WMS optional reservation/fulfillment
  - `pos.return.completed` → WMS inbound receipt

---

## Reusable UI Components (Existing)

These can be reused instead of creating new sections:

- Addresses (shipping/billing):
  - `packages/core/src/modules/sales/components/documents/AddressesSection.tsx`
  - `packages/core/src/modules/customers/components/AddressEditor.tsx`
  - `packages/core/src/modules/customers/utils/addressFormat.ts`
- Comments/Notes:
  - `packages/ui/src/backend/detail/NotesSection.tsx`
- Cart/Line items:
  - `packages/core/src/modules/sales/components/documents/ItemsSection.tsx`
  - `packages/core/src/modules/sales/components/documents/LineItemDialog.tsx`
- Payments:
  - `packages/core/src/modules/sales/components/documents/PaymentsSection.tsx`
  - `packages/core/src/modules/sales/components/documents/PaymentDialog.tsx`
- Totals:
  - `packages/core/src/modules/sales/components/documents/DocumentTotals.tsx`

---

## Phased Delivery

Phase 1 (Core POS)
- Registers + sessions
- Cart + payment + receipt
- SalesOrder integration
- Minimal UI for checkout

Phase 2 (Returns + Cash Management)
- Returns/exchanges
- Cash movements + reconciliation

Phase 3 (Advanced)
- Offline mode + sync
- Gift cards and vouchers
- Customer loyalty and promotions
