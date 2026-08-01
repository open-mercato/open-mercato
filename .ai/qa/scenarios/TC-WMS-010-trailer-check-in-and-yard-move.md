# Test Scenario 010: Trailer Check-In And Yard Move

## Test ID
TC-WMS-010

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Validate the core yard flow: check a trailer in at the gate, assign its initial state, then move it through yard or dock positions without conflicting occupancy.

## Prerequisites
- User is authenticated as admin with yard-management permissions
- Warehouse, gate, yard location, and dock door exist
- Trailer record exists or can be created during check-in
- No conflicting occupancy exists on the target locations

## API Endpoint (for API tests)
`POST /api/wms/yard/gate/check-in`, `POST /api/wms/yard/move-tasks/:id/complete`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST trailer check-in with trailer identity, condition, and operator details | Gate transaction is recorded and trailer state becomes checked in |
| 2 | Create a yard-move task from gate to yard or dock | Move task is created with source and target context |
| 3 | Complete the yard move | Trailer current location updates successfully |
| 4 | Read trailer and location occupancy state | Trailer, yard slot, and/or dock reflect the new consistent state |

## Expected Results
- Check-in records arrival time, trailer identity, and gate transaction audit data
- Yard move completion updates trailer state and occupancy atomically
- Trailer does not appear in two physical places at once
- Downstream yard-board views can rely on the resulting state

## Edge Cases / Error Scenarios
- Moving to an occupied or blocked destination should be rejected
- Completing the same move task twice should fail safely
- Check-in with missing mandatory trailer identity or sealed-trailer fields should be rejected
