# Test Scenario 37: Record Payment

## Test ID
TC-SALES-010

## Category
Sales Management

## Priority
High

## Description
Verify that payments can be recorded against orders or invoices with proper payment method and amount tracking.

## Prerequisites
- User is logged in with `sales.payments.create` feature
- An order or invoice exists with outstanding balance
- Payment methods are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to order or invoice detail | Document is displayed |
| 2 | Find payments section | Payments area visible |
| 3 | Click "Record Payment" button | Payment form appears |
| 4 | Select payment method | Method is set |
| 5 | Enter payment amount | Amount accepted |
| 6 | Enter payment reference (check number, transaction ID) | Reference stored |
| 7 | Set payment date | Date captured |
| 8 | Save payment | Payment recorded |

## Expected Results
- Payment record is created
- Payment linked to order/invoice
- Payment method captured
- Amount and reference stored
- Outstanding balance is reduced
- Full payment marks document as "Paid"
- Partial payment shows remaining balance
- Payment history visible on document
- Receipt may be generated

## Edge Cases / Error Scenarios
- Payment exceeds outstanding balance (may create credit)
- Negative payment amount (refund - separate flow)
- Zero payment amount (should be prevented)
- Payment on already paid document (should warn)
- Payment method not available for organization
- Future payment date (scheduled payment)
- Payment in different currency (conversion)
- Void/reverse payment (if supported)
- Payment splits across multiple orders
