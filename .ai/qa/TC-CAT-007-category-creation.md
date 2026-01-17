# Test Scenario 22: Create Product Category

## Test ID
TC-CAT-007

## Category
Catalog Management

## Priority
High

## Description
Verify that a user can create a new product category that can be used to organize products.

## Prerequisites
- User is logged in with `catalog.categories.manage` feature
- Category management page is accessible

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/categories` | Categories list/tree is displayed |
| 2 | Click "Create Category" button | Category creation form is displayed |
| 3 | Enter category name | Name field accepts input |
| 4 | Enter category description (optional) | Description is accepted |
| 5 | Set category as root (no parent) | Parent selection is empty or null |
| 6 | Optionally add category image/icon | Image upload works |
| 7 | Click "Save" button | Form is submitted |
| 8 | Observe success response | Success notification shown |

## Expected Results
- POST request to `/api/catalog/categories` succeeds with 201 status
- Category record is created in database
- Category is scoped to current tenant/organization
- Tree path is computed for hierarchy
- Category appears in categories list
- Category is selectable in product forms
- Category can be used as parent for subcategories

## Edge Cases / Error Scenarios
- Duplicate category name at same level (may be allowed or error)
- Empty category name (validation error)
- Very long category name (max length validation)
- Category with special characters in name (should be handled)
- Create category with image larger than allowed (size limit error)
- Create category while another user deletes parent (race condition)
