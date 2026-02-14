# Test Scenario 19: Deal Association Remove And Undo

## Test ID
TC-CRM-019

## Category
Customer/CRM Management

## Priority
High

## Type
UI Test

## Description
Verify that a linked person can be removed from a deal and restored via undo.

## Prerequisites
- User is logged in as `admin`
- Test fixtures are created: one person and one deal linked to that person

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the test deal detail page | Deal detail is visible |
| 2 | Click `Remove {Person Name}` for linked person | Person is marked for removal in form state |
| 3 | Click `Update deal` | Person is no longer linked to deal |
| 4 | Click `Undo` | Person link is restored |

## Expected Results
- Deal update removes person association successfully
- Undo restores the association without manual re-linking

## Edge Cases / Error Scenarios
- Removing last linked person should still allow save
- Missing update permission should block association changes
