# Test Scenario 17: Multi-Adjustment Totals Recalculation

## Test ID
TC-SALES-017

## Category
Sales Management

## Priority
High

## Type
UI Test

## Description
Verify that order grand total recalculates correctly when multiple adjustments are added, including both surcharge-like and discount adjustments.

## Prerequisites
- User is logged in with `sales.orders.create` and `sales.adjustments.create` features
- A sales channel and customer are available

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a new order with one custom line | Initial grand total is visible |
| 2 | Add a positive adjustment (fee) | Grand total increases |
| 3 | Add a discount adjustment | Grand total decreases compared to previous state |
| 4 | Review adjustments list | Both adjustment records are visible |

## Expected Results
- Each adjustment is persisted
- Grand total updates after each adjustment save
- Discount adjustment lowers the previously increased total

## Edge Cases / Error Scenarios
- Discount larger than order subtotal
- Zero-value adjustment
- Adding multiple adjustments with identical labels
