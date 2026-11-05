# Test Scenario 20: Deal Note And Activity Creation

## Test ID
TC-CRM-020

## Category
Customer/CRM Management

## Priority
High

## Type
UI Test

## Description
Verify that a user can add a note to a deal and create a linked activity from the deal detail page.

## Prerequisites
- User is logged in as `admin`
- Test fixtures are created: company, person, and deal with associations

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the test deal detail page | Deal detail page is visible |
| 2 | Click `Add a note`, enter content, submit | New note appears in Notes section |
| 3 | Open `Activities` section and click `Add an activity` | Activity dialog opens |
| 4 | Select linked deal and activity type, fill subject/description, save | Activity is created for the deal |
| 5 | Return to Activities list | Empty-state message (`No activities yet`) is no longer shown |

## Expected Results
- Deal note is persisted
- Deal activity is persisted and linked to the target deal
- Activity list reflects the new record

## Edge Cases / Error Scenarios
- Missing required activity type should block save
- Activity created without linked deal should not appear on this deal detail
