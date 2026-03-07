# Test Scenario: Mutation Lifecycle Showcase Page — Sync Subscriber Probe (UI)

## Test ID
TC-UMES-ML06

## Category
UMES — Mutation Lifecycle (SPEC-041m2)

## Priority
High

## Description
Verify that the Phase M showcase page correctly executes the multi-step sync subscriber probe via the UI. The probe creates a todo (tests auto-default-priority), marks it as done then attempts to revert (tests prevent-uncomplete), and finally deletes it (tests audit-delete).

## Prerequisites
- User is logged in as `admin`
- Example module is enabled with mutation lifecycle showcase page
- All three sync subscribers are registered: `auto-default-priority`, `prevent-uncomplete`, `audit-delete`
- Page accessible at `/backend/mutation-lifecycle`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/mutation-lifecycle` | Showcase page loads |
| 2 | Verify Phase m2 section title reads "Phase m2 — Sync Event Subscribers" | Section heading is correct |
| 3 | Verify initial status shows `status=idle` in `[data-testid="phase-m2-status"]` | Sync probe has not run yet |
| 4 | Click "Run sync subscriber probe" button `[data-testid="phase-m2-run-probe"]` | Status changes to `pending` |
| 5 | Wait for probe to complete (all 3 steps) | `[data-testid="phase-m2-status"]` shows `status=ok` |
| 6 | Verify `[data-testid="phase-m2-probe-defaultPriority"]` shows `status=ok` and `httpStatus=201` | auto-default-priority subscriber ran, todo created |
| 7 | Verify `[data-testid="phase-m2-probe-preventUncomplete"]` shows `status=ok` and `httpStatus=422` | prevent-uncomplete subscriber blocked revert |
| 8 | Verify `[data-testid="phase-m2-probe-auditDelete"]` shows `status=ok` and `httpStatus=200` | audit-delete subscriber ran, todo deleted |
| 9 | Verify `[data-testid="phase-m2-error"]` is not visible | No error displayed |
| 10 | Verify `[data-testid="phase-m2-result"]` contains payloads for create, markDone, revert, and delete | All step payloads are visible |

## Expected Results
- Probe 1 (defaultPriority): Todo created (201), sync before-create subscriber injected priority
- Probe 2 (preventUncomplete): Mark as done succeeds, revert blocked with 422
- Probe 3 (auditDelete): Todo deleted (200), sync after-delete subscriber fires
- Overall status is `ok` when all three probes pass
- Each probe row shows individual status, HTTP status code, and descriptive details
- Payloads section shows raw responses from each API call

## Edge Cases / Error Scenarios
- If probe 1 fails (no todo created), probes 2 and 3 are skipped with error details
- If probe 2 fails (revert not blocked), overall status shows `error` with partial results
- Running the probe multiple times should always clean up and produce consistent results
- The probe cleans up the created todo in a `finally` block even on failure
