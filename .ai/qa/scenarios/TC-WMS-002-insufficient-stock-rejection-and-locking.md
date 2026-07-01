# Test Scenario 002: Insufficient Stock Rejection And Locking

## Test ID
TC-WMS-002

## Category
Warehouse Management System

## Priority
High

## Type
API Test

## Description
Verify that WMS prevents over-reservation under low-stock and concurrent-demand conditions, preserving non-negative availability.

## Prerequisites
- User is authenticated as admin with `wms.manage_inventory`
- Warehouse, location, and tracked product variant exist
- Available stock is limited to a small known quantity
- Two independent reservation attempts can be executed against the same SKU

## API Endpoint (for API tests)
`POST /api/wms/inventory/reserve`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or confirm a balance bucket with a small available quantity, for example `1` | Balance is readable and available quantity is known |
| 2 | Send a reservation request for the full available quantity | First request succeeds |
| 3 | Send a second reservation request that would exceed remaining availability | Second request is rejected |
| 4 | Read the final reservation set and balance bucket | Only one active reservation exists and availability is not negative |

## Expected Results
- Over-reservation is rejected with a business error such as `409 insufficient_stock`
- Balance state remains internally consistent after the failed attempt
- No duplicate or partially persisted reservation rows exist for the rejected request
- Transactional locking or equivalent concurrency protection prevents negative available stock

## Edge Cases / Error Scenarios
- Two concurrent requests for the same last unit should still result in only one success
- Retry after a failed request should work if stock becomes available later
- Rejected requests must not leave stale allocations or partial balance updates
