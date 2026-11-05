# Test Scenario 38: Allocate Payment Across Invoices

## Test ID
TC-SALES-011

## Category
Sales Management

## Priority
Medium

## Description
Verify that a single payment can be allocated across multiple invoices for the same customer.

## Prerequisites
- User is logged in with `sales.payments.create` feature
- Customer has multiple outstanding invoices
- Payment allocation is enabled

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to payments section or customer account | Payment interface displayed |
| 2 | Click "Record Payment" | Payment form with allocation option |
| 3 | Select customer | Customer's open invoices shown |
| 4 | Enter total payment amount | Amount accepted |
| 5 | View unpaid invoices list | All open invoices displayed |
| 6 | Allocate amounts to each invoice | Partial or full allocation |
| 7 | Verify allocations sum to payment total | Validation passes |
| 8 | Save payment with allocations | Payment and allocations created |

## Expected Results
- Single payment record is created
- Multiple allocation records link payment to invoices
- Each invoice balance is reduced by allocated amount
- Sum of allocations equals payment amount
- Unallocated amount creates credit (if allowed)
- Invoice statuses update (Paid, Partially Paid)
- Payment history shows allocation breakdown
- Auto-allocation option may apply FIFO

## Edge Cases / Error Scenarios
- Allocate more than invoice balance (should limit to balance)
- Allocate more than payment amount (should be prevented)
- Leave portion unallocated (creates customer credit)
- Reallocate existing payment (if supported)
- Allocate to voided invoice (should be prevented)
- Allocate to invoice from different customer (should be prevented)
- Currency mismatch between invoices (multi-currency handling)
- Void payment with allocations (reverse all allocations)
