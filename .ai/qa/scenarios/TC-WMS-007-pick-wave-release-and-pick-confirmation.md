# Test Scenario 007: Pick Wave Release And Pick Confirmation

## Test ID
TC-WMS-007

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Validate the primary outbound execution flow: release a pick wave from reserved demand and confirm a full pick against the allocated stock bucket.

## Prerequisites
- User is authenticated as admin with outbound WMS permissions
- Warehouse, pickable location, and tracked variant exist
- Sales order exists with reserved/allocated WMS demand
- Enough inventory is available in the expected source bucket

## API Endpoint (for API tests)
`POST /api/wms/pick-waves/:id/release`, `POST /api/wms/pick-tasks/:id/confirm`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or select a draft pick wave for reserved outbound demand | Wave is ready for release |
| 2 | POST release action for the wave | Response succeeds and pick tasks are generated |
| 3 | Inspect the created pick task | Task contains warehouse, location, lot, and requested quantity context |
| 4 | POST confirm action with the full requested quantity | Task moves to `done` and inventory movement is recorded |
| 5 | Read the affected balance bucket and task state | Picked quantity is decremented correctly and task remains auditable |

## Expected Results
- Pick wave release creates execution work from reserved/allocated demand only
- Pick confirmation consumes the correct stock bucket
- Task state, operator traceability, and inventory movement remain aligned
- No sales-owned shipment document is created prematurely by the pick action alone

## Edge Cases / Error Scenarios
- Releasing a wave with no eligible reserved demand should be rejected
- Confirming a pick with a wrong location or lot should fail validation
- Confirming an already completed task should be blocked or reported clearly
