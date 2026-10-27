# Test Scenario 005: QC Failed Receipt Does Not Increase Availability

## Test ID
TC-WMS-005

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Validate that a received ASN line with failed QC is tracked for audit but does not increase available stock or create an unsafe putaway path.

## Prerequisites
- User is authenticated as admin with inbound WMS permissions
- Warehouse, staging location, and tracked variant exist
- ASN exists with an open receiving line
- Baseline inventory balance for the variant is known before the test

## API Endpoint (for API tests)
`POST /api/wms/asns/:id/receive`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Record baseline available quantity for the target variant | Initial balance is known |
| 2 | POST ASN receive action with `qcStatus="failed"` and a rejection reason | Response succeeds or returns a controlled QC failure state |
| 3 | Read the receiving line and related audit trail | Line reflects failed QC and captures rejection details |
| 4 | Read the inventory balance for the variant | Available quantity remains unchanged from baseline |
| 5 | Check for follow-up operational tasks | No standard putaway task is created for failed stock unless explicitly routed to quarantine flow |

## Expected Results
- Failed QC is auditable and visible on the receiving record
- Available stock does not increase as a result of failed receipt
- Balance math remains unchanged for pickable inventory
- Unsafe downstream execution paths are blocked until the stock is dispositioned correctly

## Edge Cases / Error Scenarios
- Failed QC with missing rejection reason should be rejected if the route requires one
- Retrying receipt with corrected data should not duplicate the original failed audit trail
- Quarantine-specific follow-up behavior should be explicit, not implicit
