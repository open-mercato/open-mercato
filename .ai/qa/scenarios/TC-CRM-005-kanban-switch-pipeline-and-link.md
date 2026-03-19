# Test Scenario 5: Kanban pipeline switcher + link to settings

## Test ID
TC-CRM-005

## Category
CRM

## Priority
High

## Description
Verify that the Deals Kanban can switch between pipelines (columns reflect stages) and provides a link to manage pipeline stages.

## Prerequisites
- At least two pipelines exist with different stage sets.
- At least one deal exists in each pipeline.
- User has access to view Deals Kanban.

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to **Deals Kanban**. | Kanban view is visible. |
| 2 | Select pipeline `New Business` in the pipeline switcher (tabs or dropdown). | Columns match `New Business` stages; only deals from `New Business` are shown. |
| 3 | Note the column names and deal counts. | Column labels and counts are consistent with `New Business` stages. |
| 4 | Switch pipeline to `Renewals`. | Columns update to `Renewals` stages; only deals from `Renewals` are shown. |
| 5 | Note the column names and deal counts again. | Column labels and counts are consistent with `Renewals` stages. |
| 6 | Click the link/button **Manage pipeline stages**. | User is navigated to **Settings > Customers > Pipeline stages**. |

## Expected Results
- Kanban columns always match the stages of the selected pipeline.
- Deals shown on Kanban are filtered to the selected pipeline.
- Navigation link from Kanban to pipeline stages settings works.

## Edge Cases / Error Scenarios
- If a pipeline has no stages configured, Kanban should show a helpful empty state and/or prevent selecting it (implementation-dependent).
- If there are no deals in the selected pipeline, Kanban should show empty columns rather than errors.
