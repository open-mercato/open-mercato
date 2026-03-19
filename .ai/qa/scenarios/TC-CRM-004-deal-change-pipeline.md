# Test Scenario 4: Edit deal and move between pipelines

## Test ID
TC-CRM-004

## Category
CRM

## Priority
High

## Description
Verify that an existing deal can be reassigned to another pipeline and remains in a valid stage of that pipeline.

## Prerequisites
- At least two pipelines exist (e.g., `New Business` and `Renewals`) with different stage sets.
- A deal exists in pipeline `New Business`.
- User has access to edit deals.

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open an existing deal in pipeline `New Business`. | Deal edit view is visible. |
| 2 | Change Pipeline to `Renewals`. | Stage dropdown options update to stages of `Renewals`. |
| 3 | Verify the selected Stage is valid for `Renewals` (e.g., resets to first stage if needed). | Selected stage belongs to `Renewals`. |
| 4 | Save the deal. | Deal is saved successfully. |
| 5 | Go to Deals list or Kanban for `Renewals`. | The deal is visible under pipeline `Renewals`. |
| 6 | Go to Kanban for `New Business`. | The deal is no longer shown there. |

## Expected Results
- Deal pipeline changes from `New Business` to `Renewals`.
- Deal stage belongs to the selected pipeline after save.
- Deal appears only in the selected pipeline’s views.

## Edge Cases / Error Scenarios
- If the previously selected stage does not exist in the new pipeline, stage must be set to a valid stage before saving (auto-reset or validation).
- Attempt to save with an invalid pipeline/stage combination should be rejected (UI validation and/or backend validation).
