# Test Scenario 19: Payment Entry and Grand Total Stability

## Test ID
TC-SALES-019

## Category
Sales Management

## Priority
High

## Type
UI Test

## Description
Verify that recording a payment creates a payment record while preserving the document grand total (payments affect settlement, not itemized total calculation).

## Prerequisites
- User is logged in with `sales.payments.create` feature
- Payment methods are configured
- An order exists with at least one billable line item

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a new order with one line item | Grand total is visible |
| 2 | Capture grand total before payment | Baseline total is recorded |
| 3 | Record a payment from Payments section | Payment is saved successfully |
| 4 | Re-check grand total row | Grand total remains unchanged |

## Expected Results
- Payment record is created
- Payment operation is confirmed in UI
- Grand total stays equal before and after payment

## Edge Cases / Error Scenarios
- Payment amount greater than due amount
- Payment without method/status selection
- Duplicate payment submissions
