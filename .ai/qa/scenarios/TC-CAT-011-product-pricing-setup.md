# Test Scenario 26: Configure Product Pricing

## Test ID
TC-CAT-011

## Category
Catalog Management

## Priority
High

## Description
Verify that product/variant pricing can be configured with different price kinds, currencies, and time-based validity windows.

## Prerequisites
- User is logged in with `catalog.products.edit` feature
- Product with variants exists
- Multiple price kinds are configured
- Multi-currency may be enabled

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to product/variant detail | Product pricing section is visible |
| 2 | Find pricing table or form | Existing prices are shown |
| 3 | Add new price for specific price kind | Price form appears |
| 4 | Enter price value | Numeric value accepted |
| 5 | Select currency (if multi-currency) | Currency is selected |
| 6 | Set validity period (optional) | Start and end dates set |
| 7 | Set minimum quantity (optional) | Quantity break is set |
| 8 | Save price | Price is persisted |
| 9 | Verify price selection in sales | Correct price is selected |

## Expected Results
- Multiple prices per product/variant are supported
- Price kinds differentiate pricing tiers
- Currency support for international pricing
- Time-based prices for promotions
- Quantity breaks for volume discounts
- Price selection algorithm picks best applicable price
- Historical prices retained for order accuracy
- Price changes don't affect existing orders

## Edge Cases / Error Scenarios
- Negative price value (may be error or allowed for credits)
- Zero price (should be allowed for free items)
- Overlapping validity periods (priority handling)
- Price for past date range (may be rejected or allowed)
- Very high price values (max value validation)
- Currency not supported by organization (validation error)
- Multiple prices with same conditions (conflict resolution)
- Price precision (decimal places by currency)
