# Test Scenario 30: Create Sales Order

## Test ID
TC-SALES-003

## Category
Sales Management

## Priority
High

## Description
Verify that a user can create a sales order directly (without quote) with complete customer and product information.

## Prerequisites
- User is logged in with `sales.orders.create` feature
- Products exist in the catalog
- Customer exists in the system
- Sales channel is configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/sales/orders` | Orders list is displayed |
| 2 | Click "Create Order" button | Order creation form is displayed |
| 3 | Select customer | Customer is assigned |
| 4 | Select sales channel | Channel is set |
| 5 | Select billing address | Address is captured |
| 6 | Select shipping address | Shipping address set (may differ from billing) |
| 7 | Add line items from catalog | Products are added |
| 8 | Set quantities | Line quantities set |
| 9 | Review totals | Net, tax, gross calculated |
| 10 | Click "Save" or "Create" | Order is created |

## Expected Results
- POST request to `/api/sales/orders` succeeds
- Order record is created with unique order number
- Order number follows configured format
- Customer snapshot is stored
- Address snapshots are stored (billing and shipping)
- Order lines are created with product snapshots
- Line calculations are correct
- Order totals are accurate
- Order status is set to initial status
- Order appears in orders list

## Edge Cases / Error Scenarios
- Order without customer (may be allowed for B2C)
- Order without lines (should be prevented for submission)
- Same billing and shipping address (should work)
- Customer with no addresses (prompt to add)
- Product out of stock (may warn or block)
- Currency mismatch (should use channel currency)
- Very large order (performance consideration)
