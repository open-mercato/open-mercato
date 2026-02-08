# Test Scenario 27: Product Search and Filter

## Test ID
TC-CAT-012

## Category
Catalog Management

## Priority
High

## Description
Verify that products can be searched and filtered using various criteria including name, SKU, category, tags, and status.

## Prerequisites
- User is logged in with `catalog.products.view` feature
- Multiple products exist with varying attributes
- Products have categories and tags assigned

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/products` | Products list is displayed |
| 2 | Enter text in search box | Search results update |
| 3 | Search by product name | Matching products shown |
| 4 | Search by SKU | Product with matching SKU shown |
| 5 | Filter by category | Only products in category shown |
| 6 | Filter by tag | Products with tag shown |
| 7 | Filter by status (active/inactive) | Status filter applied |
| 8 | Combine multiple filters | Intersection of filters |
| 9 | Clear filters | All products shown |

## Expected Results
- Search is case-insensitive
- Partial text matching works
- Category filter includes subcategory products
- Multiple tags can be selected (AND/OR logic)
- Status filter toggles active/inactive
- Combined filters work correctly
- Result count is displayed
- Pagination works with filters
- Search is reasonably fast (indexed)

## Edge Cases / Error Scenarios
- Search with special characters (escaped properly)
- Search with very long text (truncated or handled)
- No results found (empty state message)
- Filter by deleted category (should be handled)
- Very large result set (pagination/performance)
- Concurrent filter changes (debounced requests)
- Filter state preserved on page refresh (URL parameters)
- Export filtered results (if supported)
