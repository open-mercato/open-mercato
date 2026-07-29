# Test Scenario 014: Return Mismatch And Non-Restock Disposition

## Test ID
TC-WMS-014

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Validate that lot/serial mismatches are flagged during reverse logistics and that non-restock dispositions such as scrap or RTV do not increase available inventory.

## Prerequisites
- User is authenticated as admin with reverse-logistics permissions
- Approved RMA and receipt context exist
- Target line expects a known lot or serial value
- A non-restock disposition type such as `scrap` or `RTV` is configured

## API Endpoint (for API tests)
`POST /api/wms/returns/receipts`, `POST /api/wms/returns/inspections`, `POST /api/wms/returns/inspections/:id/execute`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Submit return receipt or inspection data with a mismatched lot or serial value | Mismatch is flagged or rejected explicitly |
| 2 | Correct the workflow enough to proceed with inspection of the returned line | Inspection can continue with audited mismatch context |
| 3 | Execute a non-restock disposition such as scrap or RTV | Disposition completes successfully |
| 4 | Read the resulting disposition log and inventory balance | Disposition is logged, but available stock does not increase |

## Expected Results
- Lot/serial verification failures are explicit and auditable
- Unsafe restock path is blocked when identity verification fails or disposition is non-restock
- Non-restock outcome produces logistics traceability without adding pickable inventory
- Reverse-logistics audit trail remains complete even when goods are not returned to stock

## Edge Cases / Error Scenarios
- Missing override reason for a forced disposition change should be rejected
- Attempting to set a restock disposition after failed verification should require explicit corrective handling
- Duplicate receipt/inspection submissions should not create double disposition logs
