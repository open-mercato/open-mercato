# Test Scenario 18: Edit Existing Product

## Test ID
TC-CAT-003

## Category
Catalog Management

## Priority
High

## Description
Verify that a user can successfully edit an existing product's details including name, description, category, and custom fields.

## Prerequisites
- User is logged in with `catalog.products.edit` feature
- At least one product exists
- User has access to the product (organization scope)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/products` | Products list is displayed |
| 2 | Find target product in list | Product is visible |
| 3 | Click on product row or "Edit" action | Product detail page is displayed |
| 4 | Verify current values are populated | All fields show current values |
| 5 | Modify product name | New name is accepted |
| 6 | Change product category | New category is selected |
| 7 | Update description | New description is saved |
| 8 | Modify custom field values | Values are updated |
| 9 | Click "Save" button | Form is submitted |
| 10 | Observe success response | Success notification shown |

## Expected Results
- PATCH/PUT request to `/api/catalog/products/[id]` succeeds
- Product record is updated in database
- Category relationship is updated
- Custom field values are updated
- `catalog.crud.product.updated` event is emitted
- Changes are reflected in products list
- Search index is updated with new values
- Audit log records the changes

## Edge Cases / Error Scenarios
- Change SKU to existing SKU (duplicate error)
- Edit product from different organization (access denied)
- Edit soft-deleted product (should not be possible)
- Concurrent edit by two users (last write wins or conflict)
- Remove all categories (may be allowed or error)
- Clear required custom fields (validation error)
- Edit product with active orders (may have restrictions)
