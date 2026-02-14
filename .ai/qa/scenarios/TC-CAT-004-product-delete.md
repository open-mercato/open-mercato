# Test Scenario 19: Delete Product

## Test ID
TC-CAT-004

## Category
Catalog Management

## Priority
Medium

## Description
Verify that a user can delete a product and the system properly handles the soft delete, retaining data for historical records while preventing the product from appearing in active listings.

## Prerequisites
- User is logged in with `catalog.products.delete` feature
- At least one product exists that can be safely deleted
- Product is not referenced in active orders (or test cascade behavior)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/products` | Products list is displayed |
| 2 | Find target product in list | Product is visible |
| 3 | Click "Delete" action for the product | Confirmation dialog appears |
| 4 | Confirm the deletion | Delete action is executed |
| 5 | Observe success response | Success notification shown |
| 6 | Verify product is removed from list | Product no longer visible in active list |
| 7 | Check if product is available for orders | Product is not selectable |

## Expected Results
- DELETE request to `/api/catalog/products/[id]` succeeds
- Product is soft-deleted (`deleted_at` timestamp is set)
- Product is removed from active products list
- Product variants are also soft-deleted (cascade)
- Product prices remain for historical orders
- `catalog.crud.product.deleted` event is emitted
- Search index is updated to exclude product
- Product data retained for audit/historical purposes

## Edge Cases / Error Scenarios
- Delete product with active quotes/orders (may be prevented)
- Delete product from different organization (access denied)
- Delete already deleted product (should be no-op or error)
- Restore deleted product (if feature supported)
- Delete product while someone is viewing it (graceful handling)
- Cascade delete of variants and prices (verify integrity)
- Delete last product in category (category remains)
