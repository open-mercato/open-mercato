# Test Scenario 25: Create Price Kind Configuration

## Test ID
TC-CAT-010

## Category
Catalog Management

## Priority
High

## Description
Verify that price kinds (price labels like Retail, Wholesale, Promotional) can be created to support tiered and channel-specific pricing.

## Prerequisites
- User is logged in with `catalog.pricing.manage` feature
- Catalog configuration page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/config/catalog` or pricing settings | Pricing configuration is displayed |
| 2 | Find price kinds section | List of price kinds shown |
| 3 | Click "Add Price Kind" | Price kind form appears |
| 4 | Enter price kind name (e.g., "Wholesale") | Name is accepted |
| 5 | Set price kind code/identifier | Unique code is set |
| 6 | Configure net/gross settings | Tax inclusion is specified |
| 7 | Set priority/order | Display order is set |
| 8 | Click "Save" button | Price kind is created |

## Expected Results
- Price kind record is created in database
- Price kind has unique code within tenant
- Net/gross flag determines tax calculation
- Price kind appears in product pricing forms
- Products can have prices for each price kind
- Sales channels can be linked to specific price kinds
- Customer groups can be assigned price kinds

## Edge Cases / Error Scenarios
- Duplicate price kind code (validation error)
- Empty price kind name (validation error)
- Delete price kind with existing prices (prevent or orphan prices)
- Price kind used by sales channel (may prevent deletion)
- Special characters in code (may be restricted to alphanumeric)
- Default price kind designation (one must be default)
- Currency-specific price kinds (if multi-currency supported)
