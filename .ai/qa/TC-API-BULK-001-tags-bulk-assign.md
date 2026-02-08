# Test Scenario 88: Bulk Tag Assignment API

## Test ID
TC-API-BULK-001

## Category
Bulk Operations APIs

## Priority
Medium

## Type
API Test

## Description
Verify that tags can be assigned to multiple customers in bulk.

## Prerequisites
- Valid authentication token
- User has `customers.edit` feature
- Tags and customers exist

## API Endpoint
`POST /api/customers/tags/assign`

## Request Body
```json
{
  "customerIds": ["cust-1", "cust-2", "cust-3"],
  "tagIds": ["tag-vip", "tag-enterprise"]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with customer and tag IDs | Bulk assignment starts |
| 2 | Verify response | Success with counts |
| 3 | Check individual customers | Tags are assigned |
| 4 | Verify no duplicates | Each tag once per customer |
| 5 | Test with already assigned | Idempotent |

## Expected Response
```json
{
  "success": true,
  "assignedCount": 6,
  "skippedCount": 0,
  "errors": []
}
```

## Expected Results
- All specified tags assigned
- All specified customers updated
- Skip duplicates silently
- Return count of assignments
- Audit logged

## Edge Cases / Error Scenarios
- Non-existent customer ID (skip or error)
- Non-existent tag ID (error)
- Empty arrays (validation error)
- Very large batch (timeout/chunking)
- Customer from different org (filtered out)
