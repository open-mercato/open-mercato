# Test Scenario 118: Not Found (404) Error Responses

## Test ID
TC-API-ERR-002

## Category
API Error Handling & Edge Cases

## Priority
High

## Type
API Test

## Description
Verify that non-existent resources return proper 404 responses.

## Prerequisites
- API endpoint with resource lookup
- Non-existent IDs available

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Request non-existent ID | 404 returned |
| 2 | Verify error structure | Standard format |
| 3 | Request valid UUID, wrong type | 404 returned |
| 4 | Request deleted resource | 404 returned |
| 5 | Request with invalid UUID format | 400 or 404 |

## Expected Response
```json
{
  "error": "Not Found",
  "message": "Resource not found",
  "statusCode": 404,
  "resourceType": "customer",
  "resourceId": "invalid-id-123"
}
```

## Expected Results
- 404 status code
- Resource type indicated
- Requested ID included
- No sensitive data
- Consistent across endpoints

## Edge Cases / Error Scenarios
- Soft-deleted resource (404)
- Cross-tenant resource (404 not 403)
- Valid UUID wrong entity
- Empty/null ID
- Special characters in ID
