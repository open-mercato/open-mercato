# Test Scenario 73: Order to Shipment to Invoice to Credit Memo

## Test ID
TC-INT-005

## Category
Integration Scenarios

## Priority
Medium

## Description
Verify the complete fulfillment and billing cycle including returns/credits.

## Prerequisites
- User is logged in with sales permissions
- Order exists with multiple line items
- Shipping methods configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open existing order | Order displayed |
| 2 | Record first shipment (partial) | Partial shipment saved |
| 3 | Verify order status | "Partially Shipped" |
| 4 | Record second shipment (complete) | Remaining items shipped |
| 5 | Verify order status | "Shipped" |
| 6 | Create invoice for shipped items | Invoice generated |
| 7 | Record payment for invoice | Payment captured |
| 8 | Customer requests return | Return scenario |
| 9 | Create credit memo | Credit against invoice |
| 10 | Select return items/quantities | Return quantities set |
| 11 | Process credit | Credit memo created |
| 12 | Verify customer balance | Credit applied |
| 13 | Issue refund (if applicable) | Refund processed |

## Expected Results
- Shipments track what's been sent
- Invoices only for shipped items (if policy)
- Payments reduce outstanding balance
- Credit memos reverse charges
- Customer balance accurately reflects
- Inventory adjustments for returns
- Financial reports accurate
- Complete audit trail maintained

## Edge Cases / Error Scenarios
- Ship more than ordered (prevented)
- Invoice before ship (may be allowed)
- Partial credit memo (some items only)
- Credit exceeds invoice (creates credit balance)
- Refund for paid invoice (complex accounting)
- Return after payment (refund vs credit)
- Void shipment (un-ship items)
- Multiple invoices per order
