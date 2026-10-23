# Purchases Module — Agent Guidelines

Use the `purchases` module for vendor management, purchase orders (POs), requests for quotation (RFQs), vendor pricelists, goods receipts (PZ documents), 3-way matching, and automated stock replenishment (Min-Max engine).

## Always

1. **MUST scope all entities to tenant and organization** via `PurchasesScopedEntity`.
2. **MUST use `purchaseCalculationService` and `purchaseDocumentNumberGenerator` from DI** for document math and sequential numbering (`RFQ/YYYY/XXXX`, `PO/YYYY/XXXX`, `PZ/YYYY/XXXX`).
3. **MUST support optimistic locking (`updated_at`)** on all editable and deletable entities (`PurchaseOrder`, `PurchaseReceipt`, `VendorPricelist`, `PurchaseBill`, `ReorderingRule`).
4. **MUST decouple cross-module references**: external entities (vendor contacts from `customers`, products from `catalog`, warehouses from `wms`) MUST only be referenced by string UUIDs, never through direct ORM relations.
5. **MUST publish domain events via `createModuleEvents`** for state transitions (`purchases.order.confirmed`, `purchases.receipt.validated`, `purchases.bill.matched`, `purchases.reorder.executed`).

## Ask First

- Ask before changing purchase approval threshold logic (`doubleValidationEnabled`, `approvalThresholdAmount`).
- Ask before modifying 3-way matching tolerances or control policies (`on_received` vs `on_ordered`).
- Ask before adding direct couplings or ORM relationships to other modules.

## Never

- Never create direct MikroORM relations across module boundaries.
- Never bypass the 3-way match verification rules for vendor bills.
- Never hardcode currency codes or tax percentages outside configuration defaults.
- Never skip tenant and organization scoping filters on queries.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/core test src/modules/purchases
yarn workspace @open-mercato/core typecheck
yarn workspace @open-mercato/app typecheck
yarn eslint packages/core/src/modules/purchases
```

## Architecture & Document Flow

```
[Draft RFQ] ──(Send)──► [RFQ Sent] ──(Confirm)──► [To Approve / PO]
                                                         │
                                        ┌────────────────┴────────────────┐
                                        ▼                                 ▼
                           [Goods Receipt (PZ)]                  [Vendor Bill]
                                        │                                 │
                                        └───────────┬─────────────────────┘
                                                    ▼
                                          [3-Way Match Verified]
```

### Core Services
- `PurchaseOrderService`: Manages RFQ/PO lifecycle, threshold evaluation, and state machine transitions.
- `PurchaseCalculationService`: Calculates line totals, taxes, and order subtotals.
- `VendorPricelistService`: Resolves best tier prices, supplier SKU codes, and delivery lead times.
- `PurchaseReceiptService`: Validates goods arrivals, updates `quantityReceived`, and splits backorders.
- `ThreeWayMatchService`: Compares PO $\leftrightarrow$ PZ $\leftrightarrow$ Vendor Bill to verify billing quantities and prices.
- `ReorderingEngine`: Evaluates Min-Max rules ($\text{Stock} + \text{Inbound} - \text{Reserved} < \text{Min}$) and creates replenishment draft RFQs.
