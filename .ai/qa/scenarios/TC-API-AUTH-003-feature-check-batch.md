# Test Scenario 113: Batch Feature Permission Check API

## Test ID
TC-API-AUTH-003

## Category
API Authentication & Security

## Priority
Medium

## Type
API Test

## Description
Verify that multiple feature permissions can be checked in single request.

## Prerequisites
- Valid authentication token
- Features are configured

## API Endpoint
`POST /api/auth/feature-check`

## Request Body
```json
{
  "features": [
    "catalog.products.view",
    "catalog.products.create",
    "sales.orders.view",
    "admin.system.manage"
  ]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with feature list | Check executed |
| 2 | Verify boolean per feature | Granted/denied |
| 3 | Check wildcard matching | Pattern matches |
| 4 | Test super admin | All granted |
| 5 | Test restricted user | Limited grants |

## Expected Response
```json
{
  "ok": true,
  "granted": [
    "catalog.products.view",
    "sales.orders.view"
  ],
  "denied": [
    "catalog.products.create",
    "admin.system.manage"
  ]
}
```

## Expected Results
- All features evaluated
- Granted/denied lists clear
- Wildcard expansion works
- Fast response time
- Caching utilized

## Edge Cases / Error Scenarios
- Empty feature list (empty response)
- Non-existent features (denied)
- Very long feature list (limit)
- Special characters in feature name
- Organization-scoped check
