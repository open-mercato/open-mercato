# Test Scenario 011: Appointment Conflict And Dock Occupancy

## Test ID
TC-WMS-011

## Category
Warehouse Management System

## Priority
Medium

## Type
API Test

## Description
Verify that WMS prevents overlapping approved appointments for the same dock window and preserves reliable dock occupancy planning.

## Prerequisites
- User is authenticated as admin with yard-management permissions
- Warehouse and dock door exist
- One appointment is already approved for a known time window on the target dock

## API Endpoint (for API tests)
`POST /api/wms/yard/appointments`, `POST /api/wms/yard/appointments/:id/approve`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create an appointment for a dock door and approve it | Appointment status becomes `approved` |
| 2 | Create a second appointment that overlaps the same dock and time window | Draft/requested appointment is created or prepared |
| 3 | Attempt to approve the overlapping appointment | Approval is rejected with a conflict error |
| 4 | Read both appointment records and dock state | First appointment remains approved; second is not approved; dock occupancy plan remains coherent |

## Expected Results
- Overlapping approved appointments are blocked for the same dock/time range
- Conflict response is explicit and actionable
- Existing approved appointment is not corrupted by the failed approval attempt
- Dock scheduling remains a reliable source for yard operations

## Edge Cases / Error Scenarios
- Back-to-back non-overlapping windows should be allowed
- Overlap detection should work even when one appointment lacks optional end-time fields by applying the contract rules
- Manual override paths, if later added, should remain explicit and auditable
