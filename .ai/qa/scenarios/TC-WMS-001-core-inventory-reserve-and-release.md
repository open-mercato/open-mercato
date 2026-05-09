# Test Scenario 001: Core Inventory Reserve And Release

## Test ID
TC-WMS-001

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Validate the core phase-1 reservation lifecycle: reserve available stock for a sales order, verify balance math, then release the reservation and restore availability.

## Prerequisites
- User is authenticated as admin with `wms.manage_inventory`
- Warehouse, storage location, catalog product variant, and inventory profile exist
- Positive on-hand quantity exists in a WMS balance bucket for the target variant
- Sales order fixture exists and can be referenced as the reservation source

## API Endpoint (for API tests)
`POST /api/wms/inventory/reserve`, `POST /api/wms/inventory/release`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or confirm an available inventory balance for a variant in a warehouse location | Balance shows positive `quantity_on_hand` and non-negative `quantity_available` |
| 2 | POST `/api/wms/inventory/reserve` with `sourceType="order"` and the sales order ID | Response succeeds and returns a new reservation ID |
| 3 | Read the reservation and affected balance bucket | Reservation status is `active`; reserved quantity increases and available quantity decreases |
| 4 | POST `/api/wms/inventory/release` for the created reservation | Response succeeds |
| 5 | Read the reservation and affected balance bucket again | Reservation status becomes `released`; reserved quantity returns to the pre-reserve value |

## Expected Results
- Reservation source traceability is preserved with `source_type="order"` and `source_id=<sales order id>`
- Balance math follows the WMS invariant: `available = on_hand - reserved - allocated`
- Release operation does not mutate historical movement rows destructively
- No cross-module sales schema mutation is required to complete the reservation lifecycle

## Out of scope (related backlog)
- **Ledger archival / cold retention** is deferred (phases 1–5); see scenario **TC-WMS-016** and roadmap *Deferred backlog*. Phase-1 tests assume movements remain queryable in the primary store only.

## Edge Cases / Error Scenarios
- Reserve more quantity than available should return `409 insufficient_stock`
- Reserve against a lot- or serial-tracked variant without required tracking data should return `422`
- Release an already released reservation should be idempotent or reject with a clear validation error
