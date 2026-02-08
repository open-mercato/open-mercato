# Test Scenario 46: Edit Company Details

## Test ID
TC-CRM-003

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that company details can be edited and changes are properly saved.

## Prerequisites
- User is logged in with `customers.companies.edit` feature
- At least one company exists
- User has access to the company (organization scope)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies` | Companies list displayed |
| 2 | Click on company or "Edit" action | Company detail/edit page shown |
| 3 | Verify current values are populated | All fields show current values |
| 4 | Modify company name | New name accepted |
| 5 | Update website URL | New URL saved |
| 6 | Change industry selection | Industry updated |
| 7 | Update lifecycle stage | Stage changed |
| 8 | Modify custom field values | Values updated |
| 9 | Click "Save" button | Changes persisted |

## Expected Results
- Company record is updated in database
- Display name recalculated if needed
- Changes reflected in companies list
- Search index updated
- Audit log records changes
- Related contacts not affected
- Deals retain company link
- Timeline shows update activity

## Edge Cases / Error Scenarios
- Edit company from different org (access denied)
- Concurrent edit by two users (last write wins)
- Clear required fields (validation error)
- Change company that has active orders (may be allowed)
- Merge duplicate companies (if feature exists)
- Company name change affects display elsewhere
- Edit soft-deleted company (should be prevented)
