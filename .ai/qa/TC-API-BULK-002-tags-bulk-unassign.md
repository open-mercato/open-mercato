# Test Scenario 89: Bulk Tag Unassignment API

## Test ID
TC-API-BULK-002

## Category
Bulk Operations APIs

## Priority
Medium

## Type
API Test

## Description
Verify that tags can be removed from multiple customers in bulk.

## Prerequisites
- Valid authentication token
- User has `customers.edit` feature
- Tags are assigned to customers

## API Endpoint
`POST /api/customers/tags/unassign`

## Request Body
```json
{
  "customerIds": ["cust-1", "cust-2", "cust-3"],
  "tagIds": ["tag-churned"]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify tags are assigned | Current state |
| 2 | Send POST to unassign | Bulk removal starts |
| 3 | Verify response | Success with counts |
| 4 | Check individual customers | Tags are removed |
| 5 | Other tags remain | Only specified removed |

## Expected Response
```json
{
  "success": true,
  "unassignedCount": 3,
  "skippedCount": 0,
  "errors": []
}
```

## Expected Results
- Specified tags removed
- Other tags untouched
- Skip if not assigned
- Return removal count
- Audit logged

## Edge Cases / Error Scenarios
- Tag not assigned (skip silently)
- Non-existent tag (error or skip)
- All tags removed (customer has no tags)
- Large batch operation
- Concurrent assign/unassign
