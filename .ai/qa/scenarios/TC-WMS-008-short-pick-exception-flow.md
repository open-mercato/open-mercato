# Test Scenario 008: Short Pick Exception Flow

## Test ID
TC-WMS-008

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Verify that short-pick handling records only the actual picked quantity, preserves the shortage as an exception, and avoids corrupting inventory state.

## Prerequisites
- User is authenticated as admin with outbound WMS permissions
- Pick task exists with requested quantity greater than physically available quantity
- Baseline task and balance states are known before the short-pick action

## API Endpoint (for API tests)
`POST /api/wms/pick-tasks/:id/short`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Read the pick task and source balance bucket before action | Requested quantity and available quantity are known |
| 2 | POST short-pick action with the actual picked quantity and reason | Response succeeds and returns short state metadata |
| 3 | Read the pick task again | Task status becomes `short` and shortage amount is traceable |
| 4 | Read the affected balance bucket and movements | Only the actually picked quantity is consumed |
| 5 | Review exception output for downstream handling | Remaining shortage is visible for manual or automated follow-up |

## Expected Results
- Inventory decrement equals actual picked quantity, not requested quantity
- Task state clearly distinguishes `short` from `done`
- Shortage reason is captured for audit and follow-up
- Downstream shipment flow can react to the shortfall without corrupting stock history

## Edge Cases / Error Scenarios
- Short-pick action with quantity greater than requested should be rejected
- Missing shortage reason should be rejected if required by route contract
- Repeating short-pick on a closed task should fail safely
