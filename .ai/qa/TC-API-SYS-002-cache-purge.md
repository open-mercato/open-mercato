# Test Scenario 75: Cache Purge API

## Test ID
TC-API-SYS-002

## Category
System & Maintenance APIs

## Priority
Medium

## Type
API Test

## Description
Verify that the cache purge API successfully clears the cache.

## Prerequisites
- Valid authentication token
- User has `configs.manage` feature
- Cache service is operational

## API Endpoint
`POST /api/configs/system-status`

## Request Body
```json
{
  "action": "clear-cache",
  "scope": "all"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Generate cached data | Cache populated |
| 2 | Send POST request with clear action | Request accepted |
| 3 | Verify response status code | 200 OK |
| 4 | Verify cache clear confirmation | Success message |
| 5 | Check cache is empty | Stats show cleared |
| 6 | Verify application still works | No errors |

## Expected Response
```json
{
  "success": true,
  "message": "Cache cleared successfully",
  "clearedKeys": 1250
}
```

## Expected Results
- Cache is cleared successfully
- Application continues to function
- Cache rebuilds on subsequent requests
- Operation is logged

## Edge Cases / Error Scenarios
- Clear specific category only
- Cache service unavailable (error response)
- Partial clear failure (error handling)
- Concurrent clear requests (idempotent)
- Clear with invalid scope (validation error)
