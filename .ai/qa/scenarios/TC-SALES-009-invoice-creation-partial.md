# Test Scenario 36: Create Partial Invoice

## Test ID
TC-SALES-009

## Category
Sales Management

## Priority
Medium

## Description
Verify that partial invoices can be created for orders, invoicing only some line items or partial quantities.

## Prerequisites
- User is logged in with `sales.invoices.create` feature
- An order exists with multiple line items
- Partial invoicing is enabled

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to order detail page | Order with multiple lines displayed |
| 2 | Click "Create Invoice" button | Invoice form appears |
| 3 | Select partial invoice option | Line selection enabled |
| 4 | Select specific lines to invoice | Checkboxes or quantities set |
| 5 | Set partial quantity for a line | Less than ordered quantity |
| 6 | Review invoice totals | Partial totals calculated |
| 7 | Save invoice | Partial invoice created |
| 8 | Check remaining uninvoiced items | Balance shown on order |
| 9 | Create second invoice for remainder | Second invoice possible |

## Expected Results
- Partial invoice includes only selected items
- Partial quantities are allowed
- Invoice total reflects partial items
- Order tracks invoiced vs uninvoiced amounts
- Multiple partial invoices can be created
- Total of all invoices should not exceed order total
- Order status shows "Partially Invoiced"
- Each invoice has unique number
- Remaining items available for future invoicing

## Edge Cases / Error Scenarios
- Invoice more than remaining quantity (should prevent)
- Invoice zero quantity (should prevent)
- All lines have been partially invoiced (track remainders)
- Partial invoice with order-level discounts (proration)
- Partial invoice with minimum invoice amount (may warn)
- Cancel partial invoice (restore available quantities)
- Partial invoice for shipped vs unshipped items
- Tax calculation on partial amounts
