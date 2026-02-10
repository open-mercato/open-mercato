# POS Module Specification (SPEC-016)

**Date**: 2026-02-07  
**Status**: Proposed  
**Issue**: [#391 - feat: POS module](https://github.com/open-mercato/open-mercato/issues/391)

---

## 1) Problem Statement

Current sales flows in Open Mercato are oriented toward e-commerce and B2B ordering, leading to:

- **No Session Management**: No concept of "opening a register" with a cash drawer float, preventing cashier accountability.
- **No Cash Handling**: No mechanism to track cash-in/cash-out movements, payouts, or end-of-day reconciliation.
- **Slow Checkout**: The quote-to-order workflow is too heavy for high-volume in-store transactions requiring instant payment capture.
- **No Receipt Engine**: No dedicated receipt generation with print/email/SMS delivery methods.
- **Audit Gaps**: Inability to link POS transactions to physical registers, sessions, and cashiers.

---

## 2) Goals

- Provide register and session management for in-store operations.
- Enable fast cart-based checkout with scan/search, price overrides, and discounts.
- Support multi-method payment processing (cash/card/split payments).
- Generate receipts with print/email/SMS delivery.
- Create `SalesOrder` and `SalesPayment` records on cart completion.
- Track cash movements and session reconciliation.
- Keep POS data tenant- and organization-scoped.

---

## 3) Non-Goals (for MVP / Phase 1)

- Returns and exchanges (Phase 2).
- Offline mode and sync (Phase 3).
- Gift cards and vouchers (Phase 3).
- Customer loyalty and promotions integration (Phase 3 - no promotions module exists yet).
- **Inventory decrement** — WMS module does not exist; POS will emit events for future integration.
- Hardware integration (receipt printers, barcode scanners, cash drawers).

---

## 3.1) Module Integration Status

| Module | Exists | Phase 1 Integration |
|--------|--------|---------------------|
| **sales** | ✅ Yes | **Critical** — Create `SalesOrder`, `SalesPayment`, use `SalesChannel` |
| **catalog** | ✅ Yes | **Critical** — Product lookup, pricing, variants |
| **customers** | ✅ Yes | **Optional** — Link customer to cart |
| **currencies** | ✅ Yes | **Critical** — Currency handling for pricing |
| **auth** | ✅ Yes | **Critical** — User/cashier identification |
| **notifications** | ✅ Yes | **Optional** — Receipt email/SMS delivery |
| **audit_logs** | ✅ Yes | **Built-in** — ActionLog for POS operations |
| **WMS** | ❌ No | **Deferred** — No inventory decrement; emit `pos.cart.completed` event |
| **promotions** | ❌ No | **Deferred** — Manual discounts only in Phase 1 |

> **Forward Compatibility:** `PosRegister.warehouseId` is included as an optional field for future WMS integration. POS will emit domain events (`pos.cart.completed`, `pos.session.closed`) that a future WMS or analytics module can subscribe to.

---

## 4) User Stories / Use Cases

| ID | Actor | Use Case | Description | Priority | Phase |
|----|-------|----------|-------------|----------|-------|
| P1 | Manager | Create register | Manager creates register for checkout station | High | 1 |
| P2 | Cashier | Open session | Cashier opens session with opening float amount | High | 1 |
| P3 | Cashier | Create cart | Cashier starts new cart for customer transaction | High | 1 |
| P4 | Cashier | Add items | Cashier scans/searches and adds items to cart | High | 1 |
| P5 | Cashier | Price override | Cashier applies override with manager-approved reason | Medium | 1 |
| P6 | Cashier | Apply discount | Cashier enters line or cart discount | Medium | 1 |
| P7 | Cashier | Take payment | Cashier records cash or card payment | High | 1 |
| P8 | Cashier | Split payment | Cashier accepts multiple payment methods | Medium | 1 |
| P9 | Cashier | Complete cart | Cart finalized, SalesOrder created, receipt issued | High | 1 |
| P10 | Cashier | Issue receipt | Cashier prints or emails receipt to customer | High | 1 |
| P11 | Cashier | Record cash movement | Cashier records cash-in/out with reason | Medium | **2** |
| P12 | Cashier | Close session | Cashier counts drawer, records variance, closes | High | 1 |
| P13 | Manager | View session report | Manager reviews session sales and variance | Medium | 1 |
| P14 | User | View POS orders | User filters orders by POS channel in Sales module | Low | 1 |

---

## 5) Functional Requirements

**FR-1: Register & Session Management**
- Support `PosRegister` with `name`, `code`, `status` (active/inactive/maintenance), optional `warehouse_id`.
- Support `PosSession` with float amounts, variance tracking, status (open/closed/suspended).
- Enforce one open session per register at a time.
- Track `opened_by_user_id` and `closed_by_user_id` for audit.

**FR-2: Cash Movement Tracking**
- Support `PosCashMovement` with types: `cash_in`, `cash_out`, `float_adjustment`, `payout`.
- Require `reason` field for all movements.
- Track `created_by_user_id`.

**FR-3: Cart Operations**
- `PosCart` linked to session with statuses: `open`, `completed`, `abandoned`.
- `PosCartLine` with product lookup, quantity (>0), pricing, discounts, tax.
- Price overrides require `price_override_reason`.
- Use Sales calculation service for totals.

**FR-4: Payment Processing**
- `PosPayment` with methods: `cash`, `card`, `voucher`, `gift_card`, `custom`.
- Statuses: `authorized`, `captured`, `voided`, `refunded`.
- Sum of payments must cover cart total to complete.

**FR-5: Cart Completion & Sales Integration**
- `carts.complete` creates `SalesOrder` + `SalesPayment`.
- Set channel to POS-type `SalesChannel`.
- Store `sales_order_id` on PosCart.

**FR-6: Receipt Generation**
- `PosReceipt` with `receipt_number`, `delivery_method` (print/email/sms).
- Store `payload_snapshot` for self-contained reprints.

**FR-7: Session Reporting**
- Provide session summary with: total sales count, total revenue, payment breakdown by method.
- Show variance summary (opening float + cash in - cash out vs closing count).
- API endpoint: `GET /api/pos/sessions/:id/report`.

---

## 6) Data Model

### Entity: `PosRegister`

```typescript
@Entity({ tableName: 'pos_register' })
export class PosRegister {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'code', type: 'text', unique: true })
  code!: string

  @Property({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null

  @Property({ name: 'status', type: 'text' })
  status: 'active' | 'inactive' | 'maintenance' = 'active'

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  // Standard columns: tenant_id, organization_id, created_at, updated_at, deleted_at
}
```

### Entity: `PosSession`

```typescript
@Entity({ tableName: 'pos_session' })
export class PosSession {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'register_id', type: 'uuid' })
  registerId!: string

  @Property({ name: 'opened_by_user_id', type: 'uuid' })
  openedByUserId!: string

  @Property({ name: 'closed_by_user_id', type: 'uuid', nullable: true })
  closedByUserId?: string | null

  @Property({ name: 'status', type: 'text' })
  status: 'open' | 'closed' | 'suspended' = 'open'

  @Property({ name: 'opened_at', type: Date })
  openedAt!: Date

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'opening_float_amount', type: 'numeric', precision: 18, scale: 4 })
  openingFloatAmount!: string

  @Property({ name: 'closing_cash_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  closingCashAmount?: string | null

  @Property({ name: 'expected_cash_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  expectedCashAmount?: string | null

  @Property({ name: 'variance_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  varianceAmount?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null
}
```

### Entity: `PosCart`

```typescript
@Entity({ tableName: 'pos_cart' })
export class PosCart {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'session_id', type: 'uuid' })
  sessionId!: string

  @Property({ name: 'status', type: 'text' })
  status: 'open' | 'completed' | 'abandoned' = 'open'

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null
}
```

### Entity: `PosCartLine`

```typescript
@Entity({ tableName: 'pos_cart_line' })
export class PosCartLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_variant_id', type: 'uuid', nullable: true })
  productVariantId?: string | null

  @Property({ name: 'description', type: 'text' })
  description!: string

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4 })
  quantity!: string

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4 })
  unitPriceNet!: string

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 18, scale: 4 })
  unitPriceGross!: string

  @Property({ name: 'discount_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountAmount: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 8, scale: 4 })
  taxRate!: string

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4 })
  totalNetAmount!: string

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4 })
  totalGrossAmount!: string

  @Property({ name: 'price_override_reason', type: 'text', nullable: true })
  priceOverrideReason?: string | null

  @Property({ name: 'customer_note', type: 'text', nullable: true })
  customerNote?: string | null  // Maps to SalesOrderLine.comment on completion

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  // Standard columns: tenant_id, organization_id, created_at, updated_at, deleted_at
}
```

### Entity: `PosCashMovement`

```typescript
@Entity({ tableName: 'pos_cash_movement' })
export class PosCashMovement {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'session_id', type: 'uuid' })
  sessionId!: string

  @Property({ name: 'type', type: 'text' })
  type!: 'cash_in' | 'cash_out' | 'float_adjustment' | 'payout'

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4 })
  amount!: string

  @Property({ name: 'reason', type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'reference', type: 'text', nullable: true })
  reference?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  // Standard columns: tenant_id, organization_id, created_at, updated_at, deleted_at
}
```

### Entity: `PosPayment`

```typescript
@Entity({ tableName: 'pos_payment' })
export class PosPayment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'session_id', type: 'uuid' })
  sessionId!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  @Property({ name: 'sales_payment_id', type: 'uuid', nullable: true })
  salesPaymentId?: string | null

  @Property({ name: 'method', type: 'text' })
  method!: 'cash' | 'card' | 'voucher' | 'gift_card' | 'custom'

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4 })
  amount!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'status', type: 'text' })
  status: 'authorized' | 'captured' | 'voided' | 'refunded' = 'authorized'

  @Property({ name: 'provider_reference', type: 'text', nullable: true })
  providerReference?: string | null

  // Standard columns: tenant_id, organization_id, created_at, updated_at, deleted_at
}
```

### Entity: `PosReceipt`

```typescript
@Entity({ tableName: 'pos_receipt' })
export class PosReceipt {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  @Property({ name: 'receipt_number', type: 'text' })
  receiptNumber!: string

  @Property({ name: 'issued_at', type: Date })
  issuedAt!: Date

  @Property({ name: 'delivery_method', type: 'text' })
  deliveryMethod!: 'print' | 'email' | 'sms'

  @Property({ name: 'recipient', type: 'text', nullable: true })
  recipient?: string | null

  @Property({ name: 'payload_snapshot', type: 'json' })
  payloadSnapshot!: Record<string, unknown>

  // Standard columns: tenant_id, organization_id, created_at, updated_at, deleted_at
}
```

---

## 7) API Design

### 7.1 Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pos/registers` | CRUD | Register management |
| `/api/pos/sessions` | GET, POST | Session listing/creation |
| `/api/pos/sessions/:id/open` | POST | Open session with float |
| `/api/pos/sessions/:id/close` | POST | Close with reconciliation |
| `/api/pos/sessions/:id/report` | GET | Session summary report (P13) |
| `/api/pos/cash-movements` | GET, POST | Cash movements (Phase 2) |
| `/api/pos/carts` | CRUD | Cart management |
| `/api/pos/cart-lines` | CRUD | Cart line management |
| `/api/pos/carts/:id/complete` | POST | Complete cart → Order |
| `/api/pos/payments` | GET, POST | Payment creation |
| `/api/pos/receipts` | GET, POST | Receipt generation |

### 7.2 OpenAPI Schema (Example)

```typescript
export const openApi: OpenApiRouteDoc = {
  tag: 'POS',
  summary: 'Point of Sale operations',
  methods: {
    POST: {
      summary: 'Complete cart and create SalesOrder',
      responses: [
        { status: 200, description: 'Cart completed', schema: cartCompleteResponseSchema },
        { status: 400, description: 'Payment insufficient', schema: errorSchema },
      ],
    },
  },
}
```

---

## 7a) Command Architecture (Reversible Operations)

POS operations that modify cart state should use the Command Pattern for undo/redo support and audit logging.

**Reference:** See `sales/commands/documents.ts` for the established pattern.

### Command Structure

```typescript
const posCartLineDeleteCommand: CommandHandler<Input, Result> = {
  id: 'pos.carts.lines.delete',
  
  // 1. Capture state BEFORE execution
  async prepare(input, ctx) {
    const snapshot = await loadCartSnapshot(em, input.cartId)
    return { before: snapshot }
  },
  
  // 2. Execute the operation
  async execute(input, ctx) {
    // ... delete line, recalculate totals
    return { cartId, lineId }
  },
  
  // 3. Capture state AFTER execution (for audit diff)
  captureAfter: async (_input, result, ctx) => {
    return loadCartSnapshot(em, result.cartId)
  },
  
  // 4. Build audit log entry
  buildLog: async ({ result, snapshots }) => ({
    actionLabel: 'Delete cart line',
    resourceKind: 'pos.cart',
    resourceId: result.cartId,
    snapshotBefore: snapshots.before,
    snapshotAfter: snapshots.after,
    payload: { undo: { before: snapshots.before, after: snapshots.after } },
  }),
  
  // 5. Undo: restore from before-snapshot
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload(logEntry)?.before
    await restoreCartSnapshot(em, before)
  },
}
```

### POS Commands (Phase 1)

| Command ID | Description | Reversible |
|------------|-------------|:----------:|
| `pos.carts.lines.add` | Add product to cart | ✓ |
| `pos.carts.lines.update` | Change quantity/price | ✓ |
| `pos.carts.lines.delete` | Remove line from cart | ✓ |
| `pos.carts.discount.apply` | Apply cart discount | ✓ |
| `pos.carts.complete` | Finalize cart → SalesOrder | ✗ |
| `pos.sessions.open` | Open register session | ✗ |
| `pos.sessions.close` | Close register session | ✗ |

> **Note:** All operations use the Command Pattern (per `sales/commands/documents.ts`) for consistent logging and audit. However, certain operations are **non-reversible by design** (confirmed by @pkarw):
>
> - **`pos.carts.complete`** — Creates both a `SalesOrder` and a `SalesPayment`. While `sales.orders.create` is normally undoable in the Sales module, POS cart completion bundles payment recording — undoing after payment could lead to unconscious fraud scenarios (order canceled but not refunded). Reversal requires an explicit **void or refund** workflow.
> - **`pos.sessions.open/close`** — Session lifecycle is part of cash accountability. Closing records the drawer count and variance. Reopening a closed session would break reconciliation integrity.
>
> These operations still use the Command Pattern (for logging and audit trail), but intentionally do not implement `undo`.

---

## 8) UI Design (Minimal Checkout)

### 8.1 Phase 1 Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Register List | `/backend/pos/registers` | CRUD list of registers |
| Session Dashboard | `/backend/pos/sessions` | Open/close sessions, view active |
| Checkout | `/backend/pos/checkout` | Main POS terminal interface |
| Session Report | `/backend/pos/sessions/:id/report` | End-of-day summary |

### 8.2 Checkout Screen Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Session: Register 1 - John D.]                    [Close Session] │
├─────────────────────────────────────┬───────────────────────────────┤
│                                     │                               │
│  🔍 [Search products...]            │   Cart Summary                │
│                                     │   ─────────────               │
│  ┌─────────────────────────────┐    │   Item 1         $12.00      │
│  │ Product search results      │    │   Item 2          $8.50      │
│  │ or barcode scan display     │    │   Item 3         $27.00      │
│  │                             │    │   ─────────────               │
│  └─────────────────────────────┘    │   Subtotal       $47.50      │
│                                     │   Tax (10%)       $4.75      │
│  [Quick Keys / Favorites]           │   ─────────────               │
│  ┌─────┐ ┌─────┐ ┌─────┐           │   TOTAL          $52.25      │
│  │ Bag │ │ Tip │ │  -  │           │                               │
│  └─────┘ └─────┘ └─────┘           │   [Pay Cash] [Pay Card]       │
│                                     │   [Split Payment]             │
│                                     │                               │
├─────────────────────────────────────┴───────────────────────────────┤
│  [Abandon Cart]              [Customer Lookup]      [Price Override]│
└─────────────────────────────────────────────────────────────────────┘
```

### 8.3 Reusable Components (from Sales Module)

The following existing components can be reused:

| Component | Path | Purpose |
|-----------|------|---------|
| `ItemsSection` | `sales/components/documents/ItemsSection.tsx` | Cart line items table |
| `LineItemDialog` | `sales/components/documents/LineItemDialog.tsx` | Add/edit line item |
| `DocumentTotals` | `sales/components/documents/DocumentTotals.tsx` | Subtotal, tax, total |
| `PaymentsSection` | `sales/components/documents/PaymentsSection.tsx` | Payment list |
| `PaymentDialog` | `sales/components/documents/PaymentDialog.tsx` | Record payment |
| `AddressEditor` | `customers/components/AddressEditor.tsx` | Customer address |
| `NotesSection` | `ui/backend/detail/NotesSection.tsx` | Cart notes |

### 8.4 New POS Components (Phase 1)

| Component | Purpose |
|-----------|---------|
| `PosCheckoutPage` | Main checkout terminal page |
| `PosCartPanel` | Right-side cart summary with totals |
| `PosProductSearch` | Product search with barcode support |
| `PosCategoryTabs` | Category filter tabs (uses `CatalogProductCategory`) |
| `PosProductGrid` | Tile grid for visual product selection |
| `PosProductTile` | Single product tile (image, name, price) |
| `PosQuickKeys` | Configurable quick-action buttons |
| `PosPaymentPanel` | Payment method selection + amount |
| `PosSessionHeader` | Current session/register info |
| `PosReceiptDialog` | Print/email/SMS receipt options |
| `PosSessionOpenDialog` | Open session with float amount |
| `PosSessionCloseDialog` | Close session with reconciliation |
| `PosDiscountDialog` | Apply line/cart discount with reason (P6) |
| `PosLineNoteDialog` | Add/edit customer note per line (e.g., "no assembly") |
| `PosSessionReport` | Session summary: sales, payments, variance (P13) |

> **See also:** [SPEC-016a - POS Tile Browsing](./SPEC-016a-2026-02-09-pos-tile-browsing.md) for detailed tile/category UI design.

---

## 9) Access Control

### 9.1 Feature Permissions

| Feature | Admin | Employee | Description |
|---------|-------|----------|-------------|
| `pos.registers.manage` | ✓ | | Create/update/delete registers |
| `pos.registers.view` | ✓ | ✓ | View registers |
| `pos.sessions.manage` | ✓ | ✓ | Open/close sessions |
| `pos.sessions.view` | ✓ | ✓ | View sessions |
| `pos.carts.manage` | ✓ | ✓ | Create/edit carts |
| `pos.payments.manage` | ✓ | ✓ | Record payments |
| `pos.receipts.view` | ✓ | ✓ | View/reprint receipts |
| `pos.discounts.apply` | ✓ | | Apply discounts above threshold |
| `pos.cash.manage` | ✓ | | Cash in/out operations |

### 9.2 Employee Switching (Quick Auth)

POS terminals often have multiple employees using the same register. **PIN-based switching** is the chosen approach for Phase 1:

- Each employee has a 4-6 digit PIN for quick switch
- Works on any device (tablets, phones, shared terminals)
- Zero hardware dependencies (NFC deferred to Phase 3)

**Implementation:** Add `pin` column (hashed) to employee credentials in `auth` module. Full login remains available as fallback.

### 9.3 Fullscreen Mode

**Backend route with feature flag** is the chosen approach:

- URL: `/backend/pos/checkout?fullscreen=1`
- Feature flag: `pos.fullscreen` hides navigation shell
- Reuses existing routes, ACL, and auth logic

**Rationale:** Avoids route duplication and inherits existing permission model.

---

## 10) Use Case Examples

**Use Case 1: Standard Cash Transaction**
- Cashier opens session with $100 float
- Scans 3 items totaling $47.50
- Customer pays $50 cash → $2.50 change
- SalesOrder created, receipt printed

**Use Case 2: Split Payment**
- Cart total: $125.00
- Customer pays $100 card + $25 cash
- Two PosPayment records, single SalesOrder

**Use Case 3: End-of-Day Reconciliation**
- Cashier counts drawer: $847.50
- Expected: $850.00
- Variance: -$2.50 recorded in session

---

## 11) Open Questions (Please Confirm)

1. Should POS registers be linked to specific warehouse locations for inventory?
2. Should we emit events for WMS integration (`pos.sale.completed`, `pos.return.completed`)?
3. Should price overrides require manager PIN/approval workflow?
4. Should receipts support template customization per tenant?
5. Should we track drawer cash denominations (bills/coins breakdown)?
6. Should suspended sessions be resumable by a different cashier?
7. Should POS events (`pos.cart.completed`, `pos.session.closed`) trigger workflows via the `workflows` module (e.g., send manager notification, update loyalty points)?

---

## 12) Implementation Checklist

- [ ] Create `packages/core/src/modules/pos/` module structure
- [ ] Create `data/entities.ts` with all POS entities
- [ ] Create `data/validators.ts` with Zod schemas
- [ ] Create commands: registers, sessions, cashMovements, carts, payments
- [ ] Create API routes with OpenAPI exports
- [ ] Create initial migration
- [ ] Create `index.ts` with module metadata
- [ ] Create `setup.ts` with tenant seeding
- [ ] Create `acl.ts` with feature definitions
- [ ] Create `events.ts` with event types
- [ ] Write command unit tests
- [ ] Write API integration tests
- [ ] Run `npm run modules:prepare`

---

## Changelog

### 2026-02-07
- Initial specification from GitHub issue #391
- Reformatted to match internal spec standards (numbered sections, use cases table, open questions, checklist)
