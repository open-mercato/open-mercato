# Test Scenario 18: Person Display Name Edit And Undo

## Test ID
TC-CRM-018

## Category
Customer/CRM Management

## Priority
Medium

## Type
UI Test

## Description
Verify that a person display name can be edited and reverted using undo.

## Prerequisites
- User is logged in as `admin`
- At least one person record exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/customers/people` | People list is visible |
| 2 | Open the first person from the list | Person detail page opens |
| 3 | Edit display name and save | Updated name is shown on page |
| 4 | Click `Undo` | Original name is restored |

## Expected Results
- Person update is saved successfully
- Undo restores the previous display name

## Edge Cases / Error Scenarios
- Empty display name should fail validation
- Undo unavailable should leave edited value unchanged
