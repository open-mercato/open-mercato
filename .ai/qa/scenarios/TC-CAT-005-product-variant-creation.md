# Test Scenario 20: Create Product Variant

## Test ID
TC-CAT-005

## Category
Catalog Management

## Priority
High

## Description
Verify that a user can create product variants with specific SKU, pricing, and attributes that differentiate them from the base product.

## Prerequisites
- User is logged in with `catalog.products.edit` feature
- A product exists that can have variants
- Price kinds are configured (if needed for variant pricing)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to product detail page | Product details are displayed |
| 2 | Click "Add Variant" or navigate to variants section | Variant creation form is displayed |
| 3 | Enter variant SKU | SKU field accepts input |
| 4 | Enter variant name/title | Name is accepted |
| 5 | Set variant-specific attributes (size, color, etc.) | Attributes are saved |
| 6 | Enter variant dimensions (if applicable) | Weight, dimensions are accepted |
| 7 | Set variant price | Price is entered |
| 8 | Click "Save" button | Form is submitted |
| 9 | Observe success response | Success notification shown |

## Expected Results
- POST request to `/api/catalog/products/[productId]/variants` succeeds
- Variant record is created linked to parent product
- Variant has unique SKU within organization
- Variant attributes are stored
- Variant pricing is set (linked to price kinds)
- Variant is searchable/selectable in order forms
- Product detail shows new variant in variants list

## Edge Cases / Error Scenarios
- Duplicate variant SKU (validation error)
- Variant SKU same as parent product SKU (may be allowed or error)
- Variant without price (may be allowed or required)
- Very large number of variants (performance consideration)
- Variant attributes with special characters (should be handled)
- Create variant on deleted product (should be prevented)
- Variant with conflicting attribute combinations (may need validation)
