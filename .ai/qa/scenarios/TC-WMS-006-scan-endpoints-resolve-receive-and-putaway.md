# Test Scenario 006: Scan Endpoints Resolve Receive And Putaway

## Test ID
TC-WMS-006

## Category
Warehouse Management System

## Priority
Medium

## Type
API Test

## Description
Validate the barcode-scan-ready API layer for receiving and putaway by resolving scanned location/lot values and using them in inbound actions.

## Prerequisites
- User is authenticated as admin with inbound WMS permissions
- Warehouse, scannable location code, and lot-aware variant exist
- ASN and putaway context exist for the target variant

## API Endpoint (for API tests)
`POST /api/wms/scan/resolve-location`, `POST /api/wms/scan/resolve-lot`, `POST /api/wms/scan/receive`, `POST /api/wms/scan/putaway`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST `/api/wms/scan/resolve-location` with a known location code | Response returns canonical location ID and readable label |
| 2 | POST `/api/wms/scan/resolve-lot` with a known or generated lot token | Response returns canonical lot identity or validation guidance |
| 3 | POST `/api/wms/scan/receive` using resolved IDs and receipt data | Receipt succeeds without browser-specific state assumptions |
| 4 | POST `/api/wms/scan/putaway` for the created inbound stock | Putaway action succeeds and target location is recorded |

## Expected Results
- Scan endpoints remain UI-agnostic and return canonical IDs
- Resolved values can be reused safely in receive and putaway flows
- Invalid scanned values produce explicit validation errors
- Scan flow does not require brittle client-side state to complete the operation

## Edge Cases / Error Scenarios
- Unknown location code should return a clear not-found response
- Invalid lot token format should be rejected cleanly
- Receive/putaway requests with stale resolved IDs should fail safely
