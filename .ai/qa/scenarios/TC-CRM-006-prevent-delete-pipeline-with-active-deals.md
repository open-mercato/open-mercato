# Test Scenario 6: Prevent deleting pipeline with active deals

## Test ID
TC-CRM-006

## Category
CRM

## Priority
High

## Description
Verify that deleting a pipeline that contains active deals is blocked with a clear error message.

## Prerequisites
- User is logged in and has permissions to manage Settings / Customers configuration.
- Pipeline `Renewals` exists.
- At least one active deal is assigned to pipeline `Renewals`.

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to **Settings > Customers > Pipeline stages**. | Settings screen is visible. |
| 2 | Select pipeline `Renewals`. | Pipeline `Renewals` is active/selected in the settings UI. |
| 3 | Attempt to delete pipeline `Renewals`. | Delete action is blocked. |
| 4 | Observe the error message shown to the user. | Message clearly explains that the pipeline contains active deals and must be reassigned/closed first. |
| 5 | Confirm pipeline `Renewals` still exists after refresh. | Pipeline is not deleted and remains available. |

## Expected Results
- Pipeline deletion is blocked when active deals exist.
- User receives a clear and actionable error message.
- No partial deletion occurs (pipeline and stages remain intact).

## Edge Cases / Error Scenarios
- Definition of “active deals” should match implementation (e.g., exclude Closed Won/Lost). Behavior must be consistent.
- If a pipeline has only closed deals, deletion behavior should follow the agreed rule (implementation-dependent).
