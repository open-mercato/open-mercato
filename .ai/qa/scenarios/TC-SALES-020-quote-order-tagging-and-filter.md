# Test Scenario: Quote and Order Tagging and Filter

## Test ID
TC-SALES-020

## Category
Sales Management

## Priority
High

## Type
UI Test

## Description
Verify that users can assign tags to sales quotes and orders, and filter documents by tags. The filter should display tag names (not IDs) and correctly show assigned records.

## Prerequisites
- User is logged in with `sales.quotes.view` and `sales.orders.view` features
- At least one quote and one order exist
- Sales tags have been created (via tags management)

## Test Steps

### Part 1: Create and Assign Tags
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/sales/tags` (or via Sales > Tags) | Tags list is displayed |
| 2 | Click "Create Tag" button | Tag creation form is displayed |
| 3 | Enter tag label (e.g., "Urgent") | Label is entered |
| 4 | Enter tag description (e.g., "Requires immediate attention") | Description is entered |
| 5 | Click "Save" button | Tag is created and visible in list |
| 6 | Create additional tag (e.g., "Archived") | Second tag is created |

### Part 2: Assign Tags to Quote
| Step | Action | Expected Result |
|------|--------|-----------------|
| 7 | Navigate to `/backend/sales/quotes` | Quotes list is displayed |
| 8 | Click on a quote to open detail page | Quote detail is displayed |
| 9 | Find "Tags" section in the form | Tags section is visible |
| 10 | Click "Add tag" or similar input | Tag selector is displayed |
| 11 | Search and select "Urgent" tag | Tag is added to the quote |
| 12 | Click "Save" or similar | Changes are saved |

### Part 3: Assign Tags to Order
| Step | Action | Expected Result |
|------|--------|-----------------|
| 13 | Navigate to `/backend/sales/orders` | Orders list is displayed |
| 14 | Click on an order to open detail page | Order detail is displayed |
| 15 | Find "Tags" section in the form | Tags section is visible |
| 16 | Search and select "Archived" tag | Tag is added to the order |
| 17 | Click "Save" or similar | Changes are saved |

### Part 4: Filter Quotes by Tags
| Step | Action | Expected Result |
|------|--------|-----------------|
| 18 | Navigate to `/backend/sales/quotes` | Quotes list is displayed |
| 19 | Click "Filters" button | Filter overlay is displayed |
| 20 | Find and click "Tags" filter | Tag selector is displayed |
| 21 | Search for tag name "Urgent" in the input | "Urgent" tag appears as option (label, not UUID) |
| 22 | Click on "Urgent" tag to select it | Tag is added to selected filters |
| 23 | Click "Apply" button | Filter is applied |
| 24 | Verify displayed quotes contain the tag | Quote with "Urgent" tag is visible |
| 25 | Verify the selected filter shows "Urgent" (not ID) | Filter tag shows label, not UUID |

### Part 5: Filter Orders by Tags
| Step | Action | Expected Result |
|------|--------|-----------------|
| 26 | Navigate to `/backend/sales/orders` | Orders list is displayed |
| 27 | Click "Filters" button | Filter overlay is displayed |
| 28 | Find and click "Tags" filter | Tag selector is displayed |
| 29 | Search for tag name "Archived" | "Archived" tag appears as option (label, not UUID) |
| 30 | Click on "Archived" tag to select it | Tag is added to selected filters |
| 31 | Click "Apply" button | Filter is applied |
| 32 | Verify displayed orders contain the tag | Order with "Archived" tag is visible |
| 33 | Verify the selected filter shows "Archived" (not ID) | Filter tag shows label, not UUID |

### Part 6: Multiple Tags Filter
| Step | Action | Expected Result |
|------|--------|-----------------|
| 34 | Go back to `/backend/sales/quotes` | Quotes list is displayed |
| 35 | Click "Filters" button | Filter overlay is displayed |
| 36 | Select "Urgent" tag in Tags filter | First tag is selected |
| 37 | Also select "Archived" tag | Multiple tags selected |
| 38 | Click "Apply" button | Filter is applied with multiple tags |
| 39 | Verify results show quotes matching either tag | Correct quotes are displayed |

## Expected Results
- Tags are created successfully with labels and descriptions
- Tags can be assigned to quotes and orders
- Tag filter shows tag names (labels) instead of UUIDs
- Tag filter correctly displays assigned documents
- Multiple tag selection works correctly
- Filter bar displays tag names when filters are active
- Tag names are preserved in filter UI (even after page reload)

## Edge Cases / Error Scenarios
- Creating a tag with special characters
- Assigning same tag multiple times (should be deduplicated)
- Filtering by tag that has no assigned documents (should show empty results)
- Clearing tag filter should reset the view
- Filter persists through pagination
- Tag label updates don't break existing filters by ID
