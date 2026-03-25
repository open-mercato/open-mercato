# SPEC-052: Order Returns & Adjustment Generation

## TLDR

**Key Points:**
- Add first-class **order returns**: user selects which order lines (and quantities) were returned; the system creates a return record and generates **return adjustments** on the order (credit), and updates line-level `returned_quantity` and order-level refund tracking.
- Aligns with existing shipments (select items + quantities) and adjustments (order/line-level credits); returns are the missing fulfillment counterpart for “goods came back.”

**Scope:**
- New entities: `SalesReturn`, `SalesReturnLine` (order-scoped, tenant-safe).
- New adjustment kind: `return` (added to `DEFAULT_SALES_ADJUSTMENT_KINDS` and seed).
- Command: create/confirm return → create return lines, create line-level adjustments with kind `return`, update order line `returned_quantity`, recalc order totals (including refunded/outstanding).
- API: CRUD for returns; “create return” from order with selected lines + quantities.
- UI: Returns section on order detail (like Shipments); “Create return” flow to select lines and quantities, then confirm to generate adjustments.

**Concerns:**
- Return amounts must be negative (credit); calculation service must treat `return` adjustments as reducing totals. Reuse existing adjustment pipeline; no new document kind.

---

## Overview

Today the sales module has shipments (which items went out), payments, and manual adjustments. There is no structured way to record **which items were returned** and to reflect that as a credit on the order. Order lines already have `returned_quantity` and orders have `refunded_total_amount`, but no flow populates them from a “return” action. This spec adds a **return** entity and flow: user selects returned lines and quantities; the system creates a return record and generates **return adjustments** (negative amounts) on the order, and updates `returned_quantity` and order totals consistently.

**Target audience:** Sales and support staff managing order fulfillment and refunds.

**Market reference:** Common in ERP/e-commerce (Odoo, Medusa, Saleor): returns as first-class records with lines and optional link to credit memo/refund. We adopt: return header + return lines linked to order lines; we generate order-level adjustments for the credit and defer optional credit-memo automation to a later phase.

---

## Problem Statement

- **No structured returns:** Users cannot record “these items from this order were returned” in a way that drives order totals and line-level returned quantity.
- **Manual workarounds:** Adding manual adjustments for returns is error-prone and does not update `returned_quantity` on lines or keep a clear audit of what was returned.
- **Data already present but unused:** `SalesOrderLine.returnedQuantity` and `SalesOrder.refundedTotalAmount` exist but are not updated by any dedicated return flow.

---

## Proposed Solution

1. **SalesReturn** (header): Belongs to one order; has return number (from sequence), status, optional reason/notes, dates; organization/tenant-scoped.
2. **SalesReturnLine**: Links return to order line; stores `quantity_returned` and snapshot of unit prices (for audit); used to compute credit amounts.
3. **Adjustment generation:** On creating/confirming a return, create one **line-level** `SalesOrderAdjustment` per return line with:
   - `kind: 'return'`
   - `scope: 'line'`
   - `order_line_id` = that order line
   - `amount_net` / `amount_gross` = **negative** (credit), derived from returned quantity × line unit price (and proportional tax/discount if needed).
4. **Order line and totals:** Increment `SalesOrderLine.returned_quantity` by the return line quantity; then run existing order totals recalculation (e.g. `salesCalculationService.calculateDocumentTotals` with all lines and adjustments), which will:
   - Include the new return adjustments (negative) in totals.
   - Update order cached totals; `refunded_total_amount` / `outstanding_amount` are updated by existing logic if already driven by adjustments, or set explicitly in the same command if they are maintained separately.
5. **Adjustment kind `return`:** Add to `DEFAULT_SALES_ADJUSTMENT_KINDS` and to `ADJUSTMENT_KIND_DEFAULTS` in sales dictionaries so the kind is available and labeled in the UI.

Return is **order-scoped only** (no cross-order returns). Optional later: link a return to a Credit Memo or Payment refund (out of scope for this spec).

---

### Design Decisions

| Decision | Rationale |
|----------|------------|
| Line-level return adjustments | One adjustment per returned line keeps audit and reporting clear; matches “which line was credited.” |
| Negative amounts for return adjustments | Credits are negative; existing calculation service already supports negative adjustments for totals. |
| Return number from sequence | Consistent with shipments and orders; use a new document sequence e.g. `return` in `SalesDocumentSequence`. |
| Snapshot prices on return line | Preserves “what we credited” even if order line prices change later. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Single order-level “return” adjustment | Harder to attribute credit to specific lines and to reconcile with `returned_quantity` per line. |
| Only manual adjustments, no return entity | Does not update `returned_quantity` or give a clear record of what was returned. |
| Return creates Credit Memo automatically | Increases scope; Credit Memo can be a follow-up integration once returns exist. |

---

## User Stories / Use Cases

- **Sales admin** wants to record which items from an order were returned so that the order shows correct returned quantities and credit (adjustments).
- **Support** wants to see a list of returns for an order and the generated adjustments so that they can explain refunds to the customer.
- **Back-office** wants return amounts to reduce order totals and outstanding amount so that financial reports are correct.

---

## Architecture

```
Order detail
  → Returns section (list of returns for this order)
  → "Create return" → Return creation flow:
       1. Select order lines + quantity to return (max = line.quantity - line.returnedQuantity).
       2. Optional: reason, notes.
       3. Submit → Command: create SalesReturn + SalesReturnLines; create line-level
          SalesOrderAdjustment (kind=return) per line; increment order line returned_quantity;
          recalc order totals; emit events.
```

- **Commands:** Implement via Command pattern (e.g. `sales.return.create`); use `withAtomicFlush` where multiple entities and recalculation are involved; side effects (indexer, events) after flush.
- **Calculation:** Reuse `salesCalculationService.calculateDocumentTotals` after adding the new return adjustments to the order’s adjustment set; ensure calculators treat `kind === 'return'` as credit (negative contribution to totals).
- **Events:** e.g. `sales.return.created` (and optionally `sales.order.updated` for totals); subscribers for indexing/notifications as needed.

### Commands & Events

- **Command:** `sales.return.create` — input: orderId, lines: [{ orderLineId, quantity }], optional reason/notes. Creates return + return lines, adjustments, updates returned quantities, recalculates totals.
- **Events:** `sales.return.created` (payload: return id, order id, organization/tenant). Optionally reuse or extend existing order totals events.

---

## Data Models

### SalesReturn

- `id`: uuid, PK
- `organization_id`, `tenant_id`: uuid, required
- `order_id`: uuid, FK to sales_orders
- `return_number`: text, unique per (organization_id, tenant_id) — from sequence
- `status_entry_id`, `status`: uuid/text, nullable (e.g. draft, received, closed)
- `reason`: text, nullable
- `notes`: text, nullable
- `returned_at`: timestamptz, nullable
- `created_at`, `updated_at`, `deleted_at`: timestamptz

Indexes: (order_id), (organization_id, tenant_id), (organization_id, tenant_id, status). Unique: (organization_id, tenant_id, return_number).

### SalesReturnLine

- `id`: uuid, PK
- `organization_id`, `tenant_id`: uuid, required
- `return_id`: uuid, FK to sales_returns
- `order_line_id`: uuid, FK to sales_order_lines
- `quantity_returned`: numeric(18,4), required, > 0
- `unit_price_net`, `unit_price_gross`: numeric(18,4), snapshot from order line at return time
- `total_net_amount`, `total_gross_amount`: numeric(18,4), computed (negative for credit)
- `created_at`, `updated_at`, `deleted_at`: timestamptz

Indexes: (return_id), (order_line_id). Constraint: quantity_returned <= order_line.quantity - order_line.returned_quantity (enforced in command).

### SalesOrderAdjustment (existing)

- Add support for `kind: 'return'`. When scope is `line` and kind is `return`, `amount_net`/`amount_gross` are negative.

### SalesOrderLine (existing)

- `returned_quantity`: already exists; command increments it by sum of quantities from return lines for that order line.

### SalesDocumentSequence (existing)

- New sequence: `document_kind = 'return'`, with a default format (e.g. `RET-{YYYY}-{SEQ}`) in setup/seed.

---

## API Contracts

### List returns for an order

- `GET /api/sales/returns?orderId={orderId}` (or nested under order if preferred)
- Response: paged list of returns (id, return_number, status, order_id, returned_at, created_at, etc.).

### Get one return

- `GET /api/sales/returns/:id`
- Response: return with nested return lines (order_line_id, quantity_returned, amounts, etc.).

### Create return (from order)

- `POST /api/sales/returns`
- Request body: `{ orderId: string, lines: Array<{ orderLineId: string, quantity: string }>, reason?: string, notes?: string }`
- Validates: order exists and is in scope; each orderLineId belongs to order; quantity <= (line.quantity - line.returnedQuantity); no duplicate orderLineId.
- Response: created return with lines and IDs; order’s adjustments and totals updated (return in response or via subsequent GET order).

### Update return (optional, MVP can be create-only)

- `PATCH /api/sales/returns/:id` — e.g. status, notes. Optional for MVP.

### Delete / cancel return (optional)

- `DELETE /api/sales/returns/:id` — reverse: remove return adjustments, decrement returned_quantity, recalc. Optional for MVP; if omitted, document as future work.

---

## Internationalization (i18n)

- `sales.returns.title`, `sales.returns.create`, `sales.returns.returnNumber`, `sales.returns.status`, `sales.returns.reason`, `sales.returns.returnedAt`
- `sales.returns.lines.quantityReturned`, `sales.returns.lines.orderLine`, `sales.returns.adjustmentGenerated`
- `sales.documents.adjustments.kindLabels.return` (and in detail section)
- Section label on order detail: e.g. “Returns” with list and “Create return” button.

---

## UI/UX

- **Order detail page:** New section “Returns” (similar to Shipments / Adjustments):
  - Table of returns: return number, status, returned at, total credit (from adjustments or from return lines sum).
  - Primary action: “Create return.”
- **Create return flow:** Modal or inline form:
  - Order lines with available-to-return quantity (quantity - returned_quantity); checkbox or input per line for quantity to return.
  - Optional reason (dropdown or text) and notes.
  - Submit → call create API; on success refresh order (totals, adjustments, returned quantities) and return list; show success message.
- **Adjustments section:** When kind is `return`, show label from `sales.documents.adjustments.kindLabels.return`; amounts shown as negative (credit).

---

## Configuration

- **Document sequence:** Seed or setup: ensure document kind `return` exists with a default number format (e.g. `RET-{YYYY}-{SEQ}`).
- **Adjustment kind:** Seed `return` in adjustment kinds (label “Return”) via `ADJUSTMENT_KIND_DEFAULTS` / `seedSalesAdjustmentKinds`.
- **Return statuses (optional):** If status workflow is needed, add a small status dictionary for returns (e.g. draft, received, closed); otherwise a single “received” or freeform status field is enough for MVP.

---

## Migration & Compatibility

- **New tables:** `sales_returns`, `sales_return_lines` (MikroORM entities; generate migration with `yarn db:generate`).
- **Existing:** Add `return` to `DEFAULT_SALES_ADJUSTMENT_KINDS` (entity type); add to dictionary seed. No removal or rename of existing columns.
- **Backward compatibility:** Existing orders and adjustments unchanged; new behavior only when returns are created. API is additive.

---

## Implementation Plan

### Phase 1: Data model & adjustment kind

1. Add `return` to `DEFAULT_SALES_ADJUSTMENT_KINDS` in `data/entities.ts` and to `ADJUSTMENT_KIND_DEFAULTS` in `lib/dictionaries.ts`; seed adjustment kind.
2. Add `SalesReturn` and `SalesReturnLine` entities in `data/entities.ts`; add validators in `data/validators.ts`.
3. Add document sequence for `return` in setup (onTenantCreated or seedDefaults) with default format.
4. Run `yarn db:generate` and apply migration.

### Phase 2: Command & calculation

5. Implement create-return command: validate order and lines, create SalesReturn + SalesReturnLine records, create line-level SalesOrderAdjustment (kind `return`, negative amounts), increment `SalesOrderLine.returned_quantity`, call `salesCalculationService.calculateDocumentTotals` and apply order totals (and `refunded_total_amount` if not derived); use `withAtomicFlush` for the mutation block; emit `sales.return.created` and order side effects after flush.
6. Ensure calculation service treats adjustments with kind `return` as credit (negative contribution); extend or register calculator if needed.
7. Register command; add API route `POST /api/sales/returns` and `GET /api/sales/returns` (list by orderId, get by id).

### Phase 3: UI

8. Add Returns section to order detail page: list returns for order, “Create return” button.
9. Implement Create Return flow: load order lines with available-to-return quantity; form for line selection + quantities, reason, notes; submit to create API; refresh order and returns list.
10. Add i18n keys for returns and for `sales.documents.adjustments.kindLabels.return`.
11. In Adjustments section, display return adjustments with correct label and negative amount.

### Phase 4: Events, ACL, integration tests

12. Declare `sales.return.created` in sales `events.ts`; emit from command; add subscriber for query index if returns are indexed.
13. ACL: add feature e.g. `sales.returns.create`, `sales.returns.view`; add to setup defaultRoleFeatures.
14. Integration tests: create order with lines → create return with partial quantities → assert return record, return lines, new adjustments (kind return), order line returned_quantity and order totals updated.

---

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/sales/data/entities.ts` | Modify | Add SalesReturn, SalesReturnLine; add `return` to DEFAULT_SALES_ADJUSTMENT_KINDS |
| `packages/core/src/modules/sales/data/validators.ts` | Modify | Zod schemas for return create/update |
| `packages/core/src/modules/sales/lib/dictionaries.ts` | Modify | Add `return` to ADJUSTMENT_KIND_DEFAULTS |
| `packages/core/src/modules/sales/setup.ts` | Modify | Ensure return document sequence |
| `packages/core/src/modules/sales/commands/returns.ts` (or under documents) | Create | Create-return command |
| `packages/core/src/modules/sales/api/returns/route.ts` | Create | GET list, GET one, POST create |
| `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` | Modify | Returns section + Create return UI |
| `packages/core/src/modules/sales/events.ts` | Modify | Declare sales.return.created |
| `packages/core/src/modules/sales/acl.ts` | Modify | sales.returns.view, sales.returns.create |
| `packages/core/src/modules/sales/services/*` (or calculation) | Modify | Treat kind `return` as credit in totals |
| `packages/core/src/modules/sales/i18n/*.json` | Modify | Keys for returns and kindLabels.return |
| New migration under sales/migrations | Generate | sales_returns, sales_return_lines |

---

### Testing Strategy

- **Unit:** Command: given order with two lines, create return for one line partial qty → correct return lines, negative adjustments, returned_quantity incremented, totals recalculated. Edge: quantity > available → validation error.
- **Integration:** Playwright or API: create order → create return → GET order and GET return → assert adjustments and returned_quantity and totals.

---

## Risks & Impact Review

### Data Integrity Failures

- **Partial write (return created but adjustments fail):** Use single transaction in command; create return + lines + adjustments + update order lines and totals in one `withAtomicFlush`; then side effects. **Mitigation:** Atomic flush; no partial commit. **Residual:** If flush succeeds and event/indexing fails, return exists but downstream may be stale; retry side effects or eventual consistency.
- **Concurrent returns on same order:** Two returns could both read same `returned_quantity` and each allow quantity that together exceed line quantity. **Mitigation:** Validate again inside transaction (re-read order lines before creating return lines); or use row-level check (e.g. constraint that returned_quantity <= quantity). **Residual:** Application-level check; constraint optional for simplicity in MVP.
- **Order line deleted after return created:** Return line and adjustment keep order_line_id; order line soft-delete is typical. **Mitigation:** Do not hard-delete order lines that have return lines; or treat as historical snapshot. **Residual:** Acceptable for MVP.

### Cascading Failures & Side Effects

- **Calculation service does not treat return as credit:** Totals could be wrong. **Mitigation:** Explicitly add return adjustments with negative amounts and ensure calculator sums them; test with return in calculation tests. **Residual:** Low if covered by tests.
- **Event subscriber fails:** Index or notification may lag. **Mitigation:** Event bus retry for persistent subscribers; non-blocking. **Residual:** Acceptable.

### Tenant & Data Isolation

- **Returns scoped by organization_id, tenant_id:** All queries and commands filter by tenant and org from auth context. **Mitigation:** Same pattern as orders/shipments. **Residual:** None.

### Migration & Deployment

- **New tables and sequence:** Additive; no breaking change. **Mitigation:** Standard migration; backfill not required. **Residual:** None.

### Operational Risks

- **Return number sequence exhaustion:** Same as other document sequences. **Mitigation:** Use same sequence pattern as orders. **Residual:** Low.

---

### Risk Register

#### Return quantity exceeds available

- **Scenario:** User (or bug) submits quantity > (line.quantity - line.returnedQuantity).
- **Severity:** High (wrong totals and negative stock implications if used).
- **Affected area:** Return create API, order totals.
- **Mitigation:** Validation in command: load order lines, compute available per line, reject if any requested quantity > available. Return 400 with clear message.
- **Residual risk:** Acceptable with validation and tests.

#### Order totals not updated after return

- **Scenario:** Adjustments created but order cached totals (grand_total, refunded_total, outstanding) not recalculated.
- **Severity:** High (incorrect financial view).
- **Affected area:** Order detail, reports.
- **Mitigation:** Command explicitly calls calculation and applies totals (same as shipment/payment flows); integration test asserts totals.
- **Residual risk:** Low.

---

## Final Compliance Report — 2026-03-02

### AGENTS.md Files Reviewed

- Root `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Returns reference sales_orders/sales_order_lines only (same module) |
| root AGENTS.md | Filter by organization_id / tenant_id | Compliant | All entities and queries scoped |
| root AGENTS.md | Command pattern for writes | Compliant | Create return implemented as command |
| root AGENTS.md | withAtomicFlush for multi-phase mutations | Compliant | Command uses atomic flush for return + lines + adjustments + totals |
| sales AGENTS.md | Use salesCalculationService for document math | Compliant | Reuse for order totals after adding return adjustments |
| sales AGENTS.md | AdjustmentKind registered | Compliant | `return` added to DEFAULT_SALES_ADJUSTMENT_KINDS and seed |
| core AGENTS.md | API routes export openApi | Compliant | Returns API must export openApi |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Return and ReturnLine match create/list/get |
| API contracts match UI/UX section | Pass | Create return with lines; list by order |
| Risks cover write operations | Pass | Create return and totals update covered |
| Commands defined for mutations | Pass | sales.return.create |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant** — ready for implementation after review.

---

## Changelog

### 2026-03-09

- Implementation complete: SalesReturn/SalesReturnLine, return adjustment kind, create command, GET/POST returns API, ReturnsSection + ReturnDialog on order detail, ACL, events, migration. Order totals recalc on read (single-order) so cached totals stay correct. Integration test: TC-SALES-023. Unit: calculations.test.ts covers return (credit) adjustment reducing grand total.

### 2026-03-02

- Initial specification: order returns with line selection and generated return adjustments; data model, command, API, UI, and integration test plan.
