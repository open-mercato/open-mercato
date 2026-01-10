# Test Scenario 58: Customer Search and Filter

## Test ID
TC-CRM-015

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that customers can be searched and filtered using various criteria including name, email, status, tags, and custom fields.

## Prerequisites
- User is logged in with `customers.view` feature
- Multiple customers exist with varying attributes
- Customers have tags, statuses, and custom fields

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies` | Customers list displayed |
| 2 | Enter text in search box | Search results update |
| 3 | Search by company name | Matching companies shown |
| 4 | Search by email | Customer with email shown |
| 5 | Filter by status (active/inactive) | Status filter applied |
| 6 | Filter by lifecycle stage | Stage filter applied |
| 7 | Filter by tags | Tagged customers shown |
| 8 | Filter by custom field | Custom filter applied |
| 9 | Combine multiple filters | Intersection of filters |
| 10 | Clear all filters | All customers shown |

## Expected Results
- Search is case-insensitive
- Partial text matching works
- Filters can be combined (AND logic)
- Status filter toggles active/inactive
- Tag filter supports multiple selection
- Date range filters work (created, updated)
- Result count displayed
- Pagination with filters works
- Search is reasonably fast

## Edge Cases / Error Scenarios
- Search with special characters (escaped)
- No results found (empty state message)
- Filter by deleted status (show deleted)
- Very large result set (performance)
- Filter state in URL (shareable)
- Export filtered results (if supported)
- Saved filters/perspectives (if supported)
- Clear individual filters
