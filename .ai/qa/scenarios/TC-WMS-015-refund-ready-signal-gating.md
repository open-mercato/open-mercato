# Test Scenario 015: Refund Ready Signal Gating

## Test ID
TC-WMS-015

## Category
Warehouse Management System

## Priority
Medium

## Type
API Test

## Description
Validate that the `wms.return.refund_ready` handoff is emitted only after the required reverse-logistics stages are complete and not earlier in the return lifecycle.

## Prerequisites
- User is authenticated as admin with reverse-logistics permissions
- Approved RMA exists with at least one return line
- Event observation or downstream handoff verification is available

## API Endpoint (for API tests)
`POST /api/wms/returns/receipts`, `POST /api/wms/returns/inspections`, `POST /api/wms/returns/inspections/:id/execute`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Approve or confirm the RMA exists in an approved state | RMA is eligible for reverse-logistics processing |
| 2 | Before any receipt or inspection completion, check for refund-ready signal/state | No refund-ready output is present |
| 3 | Complete receipt but not final inspection/disposition | Refund-ready is still absent |
| 4 | Complete inspection and the required disposition path | Reverse-logistics workflow reaches a completed, refund-safe state |
| 5 | Observe event stream, handoff record, or resulting state | `wms.return.refund_ready` is now emitted or marked as ready |

## Expected Results
- Refund-ready handoff is gated by required logistics milestones
- Early lifecycle states do not emit premature refund signals
- Finance and sales consumers can trust the refund-ready contract as a physical-completion indicator
- WMS still does not execute the refund itself

## Edge Cases / Error Scenarios
- Non-completed or failed inspection should not emit refund-ready
- Re-emitting refund-ready on duplicate completion actions should be avoided or idempotent
- Non-restock dispositions may still be refund-ready if the logistics contract says inspection/disposition is complete
