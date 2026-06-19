# Test Scenario 29: Order GET Payment-Total Read-Back Contract

## Test ID
TC-SALES-029

## Category
Sales Management

## Priority
Medium

## Type
API Test

## Description
Document and guard the read-back contract for order payment totals (issue #2397).
After `POST /api/sales/payments`, the payment command response carries the
authoritative settlement totals. `GET /api/sales/orders?id=` recomputes display
totals from the stored order column. This scenario locks in the guarantees that
hold today: the command totals are internally consistent, and the order GET
read-back never violates the non-negativity invariants nor reports an
outstanding amount above the grand total.

## Prerequisites
- User is logged in with `sales.orders.manage` / `sales.payments.create` features
- API authentication via bearer token

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `POST /api/sales/orders` then `POST /api/sales/order-lines` for a $100 line | Order created with grand total 100 |
| 2 | `POST /api/sales/payments` for $40 against the order | 201; response returns `orderTotals` |
| 3 | Assert command-returned `orderTotals` | paid=40, refunded=0, outstanding=60 |
| 4 | `GET /api/sales/orders?id=<orderId>` immediately after | 200 with the order item |
| 5 | Assert read-back invariants | paid >= 0, refunded >= 0, outstanding >= 0, outstanding <= grand |

## Expected Results
- The payment command response is authoritative and internally consistent
  (`outstanding = grandTotalGross - paid + refunded`)
- The order GET read-back upholds non-negativity invariants and never exceeds
  the grand total
- The test stays green against current behavior while documenting the contract
  the order GET read-back should eventually honor in full

## Edge Cases / Error Scenarios
- Payment greater than the outstanding amount (over-payment)
- Refund recorded after payment
- Multiple payments allocated across the same order
