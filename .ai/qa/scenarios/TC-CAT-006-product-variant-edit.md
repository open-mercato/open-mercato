# Test Scenario 21: Edit Product Variant

## Test ID
TC-CAT-006

## Category
Catalog Management

## Priority
Medium

## Description
Verify that a user can edit existing product variant details including SKU, attributes, and pricing.

## Prerequisites
- User is logged in with `catalog.products.edit` feature
- A product with at least one variant exists
- User has access to the product (organization scope)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to product detail page | Product with variants is displayed |
| 2 | Find target variant in variants list | Variant is visible |
| 3 | Click "Edit" on the variant | Variant edit form is displayed |
| 4 | Verify current values are populated | All fields show current values |
| 5 | Modify variant SKU | New SKU is accepted |
| 6 | Update variant attributes | Attributes are changed |
| 7 | Change variant price | New price is entered |
| 8 | Click "Save" button | Form is submitted |
| 9 | Observe success response | Success notification shown |

## Expected Results
- PATCH/PUT request to `/api/catalog/products/[productId]/variants/[variantId]` succeeds
- Variant record is updated in database
- SKU uniqueness is validated
- Attributes are updated
- Pricing changes are reflected
- Historical pricing may be preserved for orders
- Search index is updated
- Audit log records the changes

## Edge Cases / Error Scenarios
- Change SKU to existing SKU (duplicate error)
- Edit variant on different org's product (access denied)
- Edit variant used in active orders (may preserve snapshot)
- Clear required attributes (validation error)
- Concurrent edit by two users (conflict handling)
- Edit variant of deleted product (should be prevented)
- Set invalid price (negative, non-numeric - validation error)
