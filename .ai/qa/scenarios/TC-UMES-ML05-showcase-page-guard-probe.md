# Test Scenario: Mutation Lifecycle Showcase Page — Guard Probe (UI)

## Test ID
TC-UMES-ML05

## Category
UMES — Mutation Lifecycle (SPEC-041m1)

## Priority
Medium

## Description
Verify that the Phase M showcase page at `/backend/mutation-lifecycle` correctly executes the mutation guard probe via the UI, creating and deleting a todo through the guard pipeline and displaying success status.

## Prerequisites
- User is logged in as `admin`
- Example module is enabled with mutation lifecycle showcase page
- Page accessible at `/backend/mutation-lifecycle`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/mutation-lifecycle` | Showcase page loads with all 4 phase sections visible |
| 2 | Verify Phase m1 section title reads "Phase m1 — Mutation Guard Registry" | Section heading is correct |
| 3 | Verify initial status shows `status=idle` in `[data-testid="phase-m1-status"]` | Guard probe has not run yet |
| 4 | Click "Run guard probe" button `[data-testid="phase-m1-run-probe"]` | Status changes to `status=pending` then `status=ok` |
| 5 | Wait for probe to complete | `[data-testid="phase-m1-status"]` shows `status=ok` |
| 6 | Verify `[data-testid="phase-m1-result"]` contains a response with an `id` field | Probe created and cleaned up a todo successfully |
| 7 | Verify `[data-testid="phase-m1-error"]` is not visible | No error displayed |

## Expected Results
- The guard probe creates a todo via `POST /api/example/todos`, verifies success, then deletes it
- Final status is `ok` — indicating the mutation guard pipeline allowed the operation
- The response payload displays the created entity (with `id`)
- No error message is shown
- The cleanup delete runs automatically

## Edge Cases / Error Scenarios
- If the user lacks `example.todos.manage` feature, the probe should fail with an error status
- If the guard blocks (e.g., missing org context), status should show `error` with descriptive message
- Running the probe multiple times should always produce the same result (idempotent)
