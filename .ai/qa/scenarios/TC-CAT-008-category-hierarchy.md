# Test Scenario 23: Create Nested Category Hierarchy

## Test ID
TC-CAT-008

## Category
Catalog Management

## Priority
Medium

## Description
Verify that categories can be organized in a nested hierarchy with parent-child relationships and proper tree path computation.

## Prerequisites
- User is logged in with `catalog.categories.manage` feature
- At least one root category exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/catalog/categories` | Categories tree is displayed |
| 2 | Click "Create Category" button | Category creation form is displayed |
| 3 | Enter subcategory name | Name field accepts input |
| 4 | Select existing category as parent | Parent dropdown shows options |
| 5 | Click "Save" button | Subcategory is created |
| 6 | Observe category tree | New category appears under parent |
| 7 | Create another subcategory under the first | Nested hierarchy is formed |
| 8 | Verify tree paths are computed | Each category has correct path |

## Expected Results
- Subcategory is linked to parent category
- Tree path includes all ancestors (e.g., "/root/parent/child")
- Category tree UI shows proper indentation
- Products can be assigned to any level
- Filtering by parent shows parent and all descendants
- Moving category updates tree paths for all descendants
- Depth limits may be enforced (if configured)

## Edge Cases / Error Scenarios
- Create circular reference (A -> B -> A) - should be prevented
- Set category as its own parent (validation error)
- Move category to be child of its own child (circular - prevented)
- Delete parent with children (cascade delete or prevent)
- Very deep hierarchy (performance and display considerations)
- Orphan categories after parent deletion (should be handled)
- Category tree with thousands of nodes (pagination/virtualization)
