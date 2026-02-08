# Test Scenario 33: Order Tax Calculation

## Test ID
TC-SALES-006

## Category
Sales Management

## Priority
High

## Description
Verify that taxes are correctly calculated on orders based on configured tax rates, customer location, and product tax categories.

## Prerequisites
- User is logged in with `sales.orders.edit` feature
- Tax rates are configured in the system
- Products have tax categories assigned
- Customer addresses are set up

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or open an order | Order form is displayed |
| 2 | Select customer with taxable address | Address is captured |
| 3 | Add product with standard tax rate | Line is added |
| 4 | Verify line tax is calculated | Tax amount shown on line |
| 5 | Add product with different tax rate | Second line with different tax |
| 6 | Verify order tax totals | Tax subtotals by rate shown |
| 7 | Change shipping address to tax-exempt region | Tax recalculates |
| 8 | Observe tax changes | Zero or reduced tax shown |

## Expected Results
- Tax is calculated based on applicable rules
- Tax rate selection considers: product category, customer location, channel
- Multiple tax rates are handled (e.g., state + county)
- Tax is shown per line and as order total
- Tax-exempt customers show zero tax
- Tax-exempt products are not taxed
- Net vs gross price handling is correct
- Tax breakdown is available for reporting

## Edge Cases / Error Scenarios
- Missing tax rate for location (default or error)
- Tax-exempt customer with certificate
- Mixed taxable and non-taxable items
- Cross-border orders (different tax rules)
- Tax rate changed after order creation (use snapshot)
- Discount affects tax base
- Shipping charges taxation
- Tax calculation rounding (per line vs total)
