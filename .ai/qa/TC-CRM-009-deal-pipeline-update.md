# Test Scenario 52: Update Deal Pipeline Stage

## Test ID
TC-CRM-009

## Category
Customer/CRM Management

## Priority
High

## Description
Verify that deals can be moved through pipeline stages, tracking progression toward closure.

## Prerequisites
- User is logged in with `customers.deals.edit` feature
- A deal exists in the pipeline
- Multiple pipeline stages are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to deals pipeline view | Pipeline board displayed |
| 2 | Find deal in current stage | Deal card visible in column |
| 3 | Drag deal to next stage | Deal moves to new stage |
| 4 | Observe stage update | Stage is changed |
| 5 | Open deal detail | Stage field shows new value |
| 6 | Change stage via dropdown | Alternative update method |
| 7 | Move deal to "Won" stage | Deal marked as won |
| 8 | Verify probability auto-update | Won = 100%, Lost = 0% |

## Expected Results
- Stage change is saved immediately
- Deal position in pipeline updates
- Stage history may be tracked
- Probability may auto-update based on stage
- Time in stage is tracked
- Stage change triggers notifications (if configured)
- "Won" stage closes the deal
- "Lost" stage closes the deal
- Activities may be logged automatically

## Edge Cases / Error Scenarios
- Move deal backwards in pipeline (should be allowed)
- Skip stages (may be allowed or prevented)
- Move closed deal (reopen or prevent)
- Stage with required fields (must fill before moving)
- Concurrent stage updates (last write wins)
- Custom pipeline per organization
- Stage-specific automation triggers
- Move multiple deals at once (bulk update)
