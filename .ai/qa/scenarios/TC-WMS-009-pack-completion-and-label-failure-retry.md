# Test Scenario 009: Pack Completion And Label Failure Retry

## Test ID
TC-WMS-009

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Validate that packing completion hands off correctly to shipment/label orchestration and that carrier-label failure becomes a retryable exception rather than rolling back picked stock.

## Prerequisites
- User is authenticated as admin with outbound WMS permissions
- Picked outbound goods exist and are ready to be packed
- Sales order/shipment context exists for handoff
- Carrier integration can be stubbed or forced into a controlled failure response

## API Endpoint (for API tests)
`POST /api/wms/packing-tasks/:id/complete`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or select an open packing task for picked goods | Task is in a packable state |
| 2 | POST pack completion with `requestCarrierLabel=true` | Packing succeeds and shipment handoff begins |
| 3 | Simulate or capture carrier label failure in the downstream path | Label request does not complete successfully |
| 4 | Read the packing task and shipment-handoff state | Packing remains complete; label state is retryable or failed, not rolled back |
| 5 | Retry label request or confirm retry path availability | System exposes a forward recovery path |

## Expected Results
- Packing completion records packed lines and shipment handoff state
- Carrier-label failure does not reverse packing or inventory consumption
- Label state is visible as `failed` or retryable, not silently dropped
- Shipment ownership remains outside WMS even though WMS initiated the handoff

## Edge Cases / Error Scenarios
- Packing without required picked quantities should be blocked
- Repeating complete-pack on an already completed task should fail safely
- Carrier timeout and explicit carrier error responses should produce equivalent retryable exception behavior
