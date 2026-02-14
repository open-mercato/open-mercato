# Test Scenario 17: Company Delete And Undo

## Test ID
TC-CRM-017

## Category
Customer/CRM Management

## Priority
High

## Type
UI Test

## Description
Verify that a company can be deleted and restored via undo.

## Prerequisites
- User is logged in as `admin`
- A test company is created for this scenario

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/companies` | Companies list is visible |
| 2 | Search and open the test company | Company detail page opens |
| 3 | Click `Delete company` and confirm | User is redirected to companies list |
| 4 | Click `Undo` in the confirmation/flash area | Deletion is reverted |
| 5 | Search for the company again | Company is visible in list |

## Expected Results
- Company delete action completes successfully
- Undo restores the deleted company
- Company remains accessible after restore

## Edge Cases / Error Scenarios
- Undo not executed: company remains deleted
- Delete permission missing: delete action should be blocked
