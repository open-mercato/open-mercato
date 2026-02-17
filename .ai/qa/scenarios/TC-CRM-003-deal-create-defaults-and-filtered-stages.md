# Test Scenario 3: Create deal defaults + stage dropdown filters by pipeline

## Test ID
TC-CRM-003

## Category
CRM

## Priority
High

## Description
Verify that when creating a deal:
- the Pipeline defaults to the org default pipeline,
- the Stage defaults to the first stage of that pipeline,
- changing the Pipeline filters the Stage dropdown to only stages from the selected pipeline.

## Prerequisites
- A default pipeline exists and has at least one stage.
- At least one additional pipeline exists with a different set of stages.
- User has access to create deals.

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to **CRM > Customers > Deals**. | Deals page is visible. |
| 2 | Click **Create deal**. | Create deal form is opened. |
| 3 | Observe the default **Pipeline** value. | Pipeline defaults to the org default pipeline. |
| 4 | Observe the default **Stage** value. | Stage defaults to the first stage of the selected pipeline. |
| 5 | Open the Stage dropdown and note available stages. | Stages shown belong only to the selected pipeline. |
| 6 | Change Pipeline to another pipeline (e.g., `Renewals`). | Stage dropdown options update to stages of `Renewals`. |
| 7 | Verify Stage selection is valid after pipeline change (e.g., resets to first stage). | Selected stage belongs to the newly selected pipeline. |
| 8 | Fill required deal fields (e.g., name `Test Deal A`) and save. | Deal is created successfully. |
| 9 | Re-open the created deal (or verify on list/kanban). | Deal shows the selected Pipeline and Stage correctly. |

## Expected Results
- Create deal defaults to (default pipeline, first stage).
- Stage dropdown always reflects the currently selected pipeline.
- Deal is persisted with a valid (pipelineId, pipelineStageId) relationship.

## Edge Cases / Error Scenarios
- If the user changes pipeline after selecting a stage, the stage must not remain set to a stage from the previous pipeline.
- If a pipeline has no stages configured, the UI should prevent save and show a clear validation message (if supported).
