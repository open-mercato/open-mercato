# Test Scenario 004: ASN Receiving And Putaway Queue

## Test ID
TC-WMS-004

## Category
Warehouse Management System

## Priority
High

## Type
UI Test

## Description
Verify the happy path for phase-2 inbound execution: receive an ASN line with QC pass into staging and complete the generated putaway task from backend work queues.

## Prerequisites
- User is logged in as admin with inbound WMS permissions
- Warehouse, staging location, storage location, and tracked catalog variant exist
- ASN exists with at least one open receiving line for the target variant

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/wms/asns` and open the target ASN | ASN detail view is displayed |
| 2 | Review expected lines and start receiving the open line | Receive action/form is available |
| 3 | Enter received quantity, staging location, and QC status `passed`, then submit | Receipt is accepted and line status updates |
| 4 | Navigate to `/backend/wms/putaway` | Generated putaway task is visible in the queue |
| 5 | Open the task, confirm target location, and complete the task | Task moves to done/completed state |
| 6 | Review inventory/state summary for the variant | Stock is now associated with the target storage location instead of only staging |

## Expected Results
- Receiving a passed line creates inbound stock and a follow-up putaway task
- Putaway queue exposes source, target, quantity, and status clearly
- Completing putaway removes or reclassifies staging stock and records the target storage state
- UI provides visible success feedback for both receipt and putaway completion

## Edge Cases / Error Scenarios
- Attempting to complete putaway to an inactive or invalid target location should be blocked
- ASN lines with incomplete tracking data should show validation errors before receipt submission
- Completing a task twice should be prevented or clearly reported as invalid
