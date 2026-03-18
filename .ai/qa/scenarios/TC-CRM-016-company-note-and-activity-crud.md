# Test Scenario 16: Company Note And Activity CRUD

## Test ID
TC-CRM-016

## Category
Customer/CRM Management

## Priority
High

## Type
UI Test

## Description
Verify that a user can add a note to a company and log a company activity from the detail page.

## Prerequisites
- User is logged in as `admin`
- At least one company record exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies` | Companies list is visible |
| 2 | Open the first company from the list | Company detail page opens |
| 3 | Click `Add note`, enter note content, submit | New note appears in the Notes section |
| 4 | Open `Activities` tab and click `Log activity` | Activity dialog opens |
| 5 | Select activity type, fill subject/description, save | Activity is created and visible in Activities |

## Expected Results
- Note is persisted on the company record
- Activity is persisted on the company record
- Both entries are visible immediately after save

## Edge Cases / Error Scenarios
- Empty note body should fail validation
- Missing required activity fields should block save
