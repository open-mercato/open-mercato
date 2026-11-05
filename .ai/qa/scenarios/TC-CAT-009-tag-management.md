# Test Scenario 24: Product Tag Management

## Test ID
TC-CAT-009

## Category
Catalog Management

## Priority
Medium

## Description
Verify that tags can be created and assigned to products for flexible categorization and filtering.

## Prerequisites
- User is logged in with `catalog.products.edit` feature
- At least one product exists
- Tag management is enabled

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to product edit page | Product form is displayed |
| 2 | Find tags field/section | Tag input is visible |
| 3 | Type a new tag name | Autocomplete may show existing tags |
| 4 | Press Enter or click to add tag | New tag is added to product |
| 5 | Add multiple tags | Multiple tags are visible |
| 6 | Save the product | Tags are persisted |
| 7 | Navigate to products list | Product shows assigned tags |
| 8 | Filter products by tag | Filtered results shown |

## Expected Results
- Tags can be created inline or from tag library
- Multiple tags can be assigned to a single product
- Tags are reusable across products
- Tag autocomplete shows existing tags
- Products can be filtered by tag(s)
- Tags are searchable in product search
- Removing a tag from product doesn't delete the tag

## Edge Cases / Error Scenarios
- Create tag with very long name (max length validation)
- Duplicate tag names (should use existing tag)
- Tag with special characters (may be sanitized)
- Delete tag that is assigned to products (remove assignments or prevent)
- Bulk tag assignment to multiple products (if supported)
- Empty tag name (should be prevented)
- Case sensitivity in tag names (may normalize to lowercase)
