# Test Scenario 32: Apply Order Discount

## Test ID
TC-SALES-005

## Category
Sales Management

## Priority
Medium

## Description
Verify that discounts can be applied to orders at line or order level, with proper recalculation of totals.

## Prerequisites
- User is logged in with `sales.orders.edit` feature
- An editable order exists with line items
- Discount types are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to order detail page | Order is displayed |
| 2 | Find adjustments/discounts section | Adjustments section visible |
| 3 | Click "Add Adjustment" or "Add Discount" | Adjustment form appears |
| 4 | Select adjustment type "Discount" | Discount type selected |
| 5 | Enter discount value (percentage or fixed) | Value is accepted |
| 6 | Specify discount reason/description | Description added |
| 7 | Save adjustment | Discount is applied |
| 8 | Verify order totals update | Discounted total shown |
| 9 | Verify tax recalculation | Tax on discounted amount |

## Expected Results
- Discount adjustment is created
- Discount can be percentage or fixed amount
- Order subtotal is reduced by discount
- Tax is calculated on discounted amount (usually)
- Discount appears in adjustments list
- Multiple discounts can stack (if allowed)
- Discount has description/reason
- Order total reflects applied discounts
- Discount limits may be enforced

## Edge Cases / Error Scenarios
- Discount exceeds order total (negative total - should warn or prevent)
- 100% discount (may be allowed for free orders)
- Discount on already discounted items (stacking rules)
- Remove discount (order recalculates to original)
- Percentage discount with rounding issues
- Discount on order with mixed tax rates
- Line-level vs order-level discount combination
- Discount requires approval (workflow)
