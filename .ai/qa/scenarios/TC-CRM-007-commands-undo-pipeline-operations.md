# Test Scenario 7: Commands undo support for pipeline operations

## Test ID
TC-CRM-007

## Category
CRM

## Priority
High

## Description
Verify that pipeline/stage data operations implemented via Commands support undo (as requested by maintainers for the data operations).

## Prerequisites
- User is logged in and has permissions to manage Settings / Customers configuration.
- The implementation uses Commands for pipeline/stage operations and provides an undo mechanism (UI-level or command-level in integration tests).

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to **Settings > Customers > Pipeline stages**. | Settings screen is visible. |
| 2 | Create a new pipeline named `Undo Test Pipeline`. | Pipeline is created and visible. |
| 3 | Trigger **Undo** for the last operation (create pipeline command). | Pipeline `Undo Test Pipeline` is removed (no longer visible after refresh). |
| 4 | Create `Undo Test Pipeline` again. | Pipeline is created and visible. |
| 5 | Set `Undo Test Pipeline` as default. | `Undo Test Pipeline` is marked as default. |
| 6 | Trigger **Undo** for the last operation (set default pipeline command). | Default pipeline reverts to the previous default; `Undo Test Pipeline` is no longer default. |
| 7 | Add a stage `Undo Test Stage` to `Undo Test Pipeline`. | Stage is created and visible. |
| 8 | Trigger **Undo** for the last operation (add stage command). | Stage `Undo Test Stage` is removed (no longer visible after refresh). |

## Expected Results
- Undo reverses pipeline creation without leaving orphaned data.
- Undo reverses default pipeline change and restores the previous default.
- Undo reverses stage creation without leaving invalid references.

## Edge Cases / Error Scenarios
- Undo must not leave orphaned stages or invalid deal references.
- If undo is not available in UI, validate via the command-level undo mechanism used by integration tests.
