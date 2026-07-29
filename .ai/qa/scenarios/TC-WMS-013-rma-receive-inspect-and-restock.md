# Test Scenario 013: RMA Receive Inspect And Restock

## Test ID
TC-WMS-013

## Category
Warehouse Management System

## Priority
High

## Type
UI Test

## Description
Verify the happy path for reverse logistics: approve an RMA, receive the returned package, inspect it, and restock saleable goods into inventory.

## Prerequisites
- User is logged in as admin with reverse-logistics permissions
- Original sales order and shipment context exist
- Warehouse and return-staging/target restock locations exist
- Return reason, condition grade, and restock-capable disposition type are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/wms/rmas` and open or create the target RMA | RMA detail is visible |
| 2 | Approve the RMA if still pending | RMA status becomes approved |
| 3 | Navigate to the return receiving flow and record package receipt | Return receipt is created with line-level traceability |
| 4 | Navigate to the inspection flow and assign a saleable condition grade | Suggested or chosen disposition is visible |
| 5 | Execute a restock disposition and choose a target location | Disposition completes successfully |
| 6 | Review resulting status and inventory context | RMA/inspection/disposition states reflect completion and stock is re-entered in the chosen location |

## Expected Results
- RMA, receipt, inspection, and disposition stages remain traceable end to end
- Suggested and final disposition are visible and auditable
- Restock writes inventory back into WMS only after inspection/disposition
- The workflow surfaces refund readiness without taking over finance execution

## Edge Cases / Error Scenarios
- Attempting to restock before inspection should be blocked
- Missing target location for restock should show validation error
- Non-saleable grades should not default silently to restock
