# Test Scenario 2: Set default pipeline (single default enforced)

## Test ID
TC-CRM-002

## Category
CRM

## Priority
High

## Description
Verify that exactly one default pipeline can be set per organization, and that changing the default updates persistence correctly.

## Prerequisites
- User is logged in and has permissions to manage Settings / Customers configuration.
- At least two pipelines exist (e.g., `New Business` and `Renewals`).

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to **Settings > Customers > Pipeline stages**. | Settings screen is visible. |
| 2 | Set pipeline `Renewals` as the default pipeline. | `Renewals` is marked as default. |
| 3 | Refresh the page. | `Renewals` remains marked as default after refresh. |
| 4 | Set pipeline `New Business` as the default pipeline. | `New Business` becomes default; `Renewals` is no longer default. |
| 5 | Refresh the page again. | `New Business` remains default after refresh. |

## Expected Results
- Exactly one pipeline is marked as default at any time.
- The default pipeline persists correctly after refresh.

## Edge Cases / Error Scenarios
- If there is a backend constraint, attempting to set two defaults (via concurrent actions) should result in a consistent single default.
- If the system requires a default pipeline always, blocking “unset default” should be enforced (no state with zero defaults).
