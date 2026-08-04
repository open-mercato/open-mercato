# Test Scenario 003: Sales Order WMS Enrichment

## Test ID
TC-WMS-003

## Category
Warehouse Management System

## Priority
Medium

## Type
API Test

## Description
Validate that opted-in sales detail responses are enriched additively with `_wms.*` data without altering sales-owned fields.

## Prerequisites
- User is authenticated with both `sales.view` and relevant WMS read features
- Sales order exists with at least one line referencing a catalog variant tracked by WMS
- WMS balance and reservation state exist for the same variant
- Target sales route is configured to opt into WMS response enrichers

## API Endpoint (for API tests)
`GET /api/sales/orders/:id`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or prepare a sales order with a line item tracked by WMS | Order exists and is readable from sales API |
| 2 | Create WMS stock and reservation context for the order line | WMS state exists for the same variant/order |
| 3 | GET `/api/sales/orders/:id` on the opted-in route | Response succeeds |
| 4 | Inspect the response payload | `_wms.stockSummary`, `_wms.reservationSummary`, or `_wms.assignedWarehouseId` are present additively |
| 5 | Compare sales-owned fields with a baseline order response | Sales-owned fields remain unchanged in shape and ownership |

## Expected Results
- Enrichment uses the `_wms.*` namespace only
- Sales-owned document fields are not overwritten or structurally changed
- Enrichment reflects current WMS balance/reservation state
- Response remains backward-compatible for existing sales clients

## Edge Cases / Error Scenarios
- If the caller lacks WMS read access, `_wms.*` fields should be omitted or access denied according to the route contract
- If WMS enrichment fails non-critically, the sales response should still be returned with fallback behavior
- Orders without WMS-linked variants should return an empty or absent `_wms` payload
