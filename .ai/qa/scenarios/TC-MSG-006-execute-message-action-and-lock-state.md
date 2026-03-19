# Test Scenario 006: Execute Message Action And Lock State

## Test ID
TC-MSG-006

## Category
Messages

## Priority
High

## Type
UI Test

## Description
Validates execution of message-level action buttons and verifies that actions are disabled after terminal action is taken.

## Prerequisites
- Message exists with at least two configured actions (for example `Approve` and `Reject`)
- No action has been taken yet (`actionTaken = null`)
- User is logged in as eligible recipient

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open actionable message detail | `Actions` section shows available action buttons |
| 2 | Click primary action (for example `Approve`) and confirm when prompted | Action request is submitted |
| 3 | Wait for completion state | Success flash `Action completed.` is shown |
| 4 | Inspect action panel after completion | `Action taken` summary is visible with selected action |
| 5 | Attempt to click any secondary action button | Button is disabled or execution is prevented |

## Expected Results
- One terminal action can be executed from UI
- Action status is persisted and visible in detail
- Additional actions are blocked after action is taken

## Edge Cases / Error Scenarios
- If action is already taken by another user, UI surfaces API conflict message
- If action is expired, UI surfaces expiration error from backend
