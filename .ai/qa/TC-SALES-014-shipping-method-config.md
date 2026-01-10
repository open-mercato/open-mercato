# Test Scenario 41: Configure Shipping Method

## Test ID
TC-SALES-014

## Category
Sales Management

## Priority
Medium

## Description
Verify that shipping methods can be configured with carrier information, base rates, and availability rules.

## Prerequisites
- User is logged in with `sales.shipping.manage` feature
- Shipping configuration page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to sales shipping configuration | Shipping methods list displayed |
| 2 | Click "Add Shipping Method" | Shipping method form appears |
| 3 | Enter method name (e.g., "Standard Ground") | Name accepted |
| 4 | Enter method code | Unique code set |
| 5 | Select carrier (if applicable) | Carrier linked |
| 6 | Enter base rate | Rate amount set |
| 7 | Configure delivery time estimate | Lead time set |
| 8 | Set availability (zones, channels) | Availability rules configured |
| 9 | Save shipping method | Method is created |

## Expected Results
- Shipping method record is created
- Method has unique code
- Base rate is stored
- Carrier integration configured (if any)
- Delivery estimate shown to users
- Method available in order/quote forms
- Method can be limited to specific zones
- Method can be limited to specific channels
- Shipping charges calculated correctly

## Edge Cases / Error Scenarios
- Duplicate method code (validation error)
- Negative shipping rate (may be allowed for promo)
- Zero shipping rate (free shipping option)
- Method without carrier (manual tracking)
- Delete method used in orders (may be prevented)
- Rate calculation by weight/dimensions
- Zone-specific rates (rate tables)
- Method not available for customer location
