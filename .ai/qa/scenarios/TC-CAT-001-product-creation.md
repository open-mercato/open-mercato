# Test Scenario 16: Create New Product

## Test ID
TC-CAT-001

## Category
Catalog Management

## Priority
High

## Description
Verify that a user can successfully create a new product with all required and optional fields, including category assignment and custom fields.

## Prerequisites
- User is logged in with `catalog.products.create` feature
- At least one product category exists
- Custom fields are configured for products (if applicable)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/products` | Products list page is displayed |
| 2 | Click "Create Product" button | Product creation form is displayed |
| 3 | Enter product name | Name field accepts input |
| 4 | Enter SKU (stock keeping unit) | SKU is accepted |
| 5 | Enter product description | Rich text or plain text accepted |
| 6 | Select product category | Category dropdown shows options |
| 7 | Add product tags | Tags are selectable or createable |
| 8 | Set product status (active/inactive) | Status toggle works |
| 9 | Fill custom fields (if configured) | Custom fields accept appropriate values |
| 10 | Click "Save" button | Form is submitted |

## Expected Results
- POST request to `/api/catalog/products` succeeds with 201 status
- Product record is created in database
- Product is scoped to current tenant/organization
- Category relationship is established
- Tags are linked to product
- Custom field values are stored
- `catalog.crud.product.created` event is emitted
- Product appears in products list
- Product is searchable immediately or after index update

## Edge Cases / Error Scenarios
- Duplicate SKU within organization (should show validation error)
- Empty product name (validation error)
- Very long product name (max length validation)
- Product without category (may be allowed or required)
- Special characters in name/description (should be handled)
- HTML in description (sanitized or allowed in rich text)
- Create product with no variants (may require at least one)
