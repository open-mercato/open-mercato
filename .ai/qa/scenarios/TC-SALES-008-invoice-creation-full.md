# Test Scenario 35: Create Full Invoice from Order

## Test ID
TC-SALES-008

## Category
Sales Management

## Priority
High

## Description
Verify that a complete invoice can be created from an order, capturing all line items and totals.

## Prerequisites
- User is logged in with `sales.invoices.create` feature
- An order exists that is ready for invoicing
- Order has been shipped or invoice before ship is allowed

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to order detail page | Order is displayed |
| 2 | Find invoices section | Invoice area visible |
| 3 | Click "Create Invoice" button | Invoice form appears |
| 4 | Select "Full Invoice" option | All lines selected |
| 5 | Verify invoice lines match order | All items included |
| 6 | Review invoice totals | Totals match order |
| 7 | Set invoice date | Date is captured |
| 8 | Set due date | Payment terms applied |
| 9 | Save invoice | Invoice is created |

## Expected Results
- Invoice record is created with unique number
- Invoice number follows configured format
- All order lines are invoiced
- Invoice totals match order totals
- Invoice linked to order
- Order status updates (e.g., "Invoiced")
- Invoice is immutable after creation (for compliance)
- Due date calculated from payment terms
- Invoice available for printing/PDF

## Edge Cases / Error Scenarios
- Create invoice for already invoiced order (should warn or prevent)
- Order total changed after invoice (version mismatch)
- Currency mismatch (should use order currency)
- Invoice date before order date (may be prevented)
- Very old order invoicing (audit trail)
- Multiple full invoices for same order (should be prevented)
- Invoice with adjustments not on order
- Tax rate changes between order and invoice
