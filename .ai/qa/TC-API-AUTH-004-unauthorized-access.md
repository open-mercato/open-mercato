# Test Scenario 114: Unauthorized Access (401) Responses

## Test ID
TC-API-AUTH-004

## Category
API Authentication & Security

## Priority
High

## Type
API Test

## Description
Verify proper 401 Unauthorized responses for unauthenticated requests.

## Prerequisites
- Protected API endpoints exist
- No valid authentication provided

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make request without auth header | 401 returned |
| 2 | Verify response body | Standard error format |
| 3 | Check no data leaked | Only error message |
| 4 | Make request with malformed token | 401 returned |
| 5 | Make request with expired token | 401 returned |

## Expected Response
```json
{
  "error": "Unauthorized",
  "message": "Authentication required",
  "statusCode": 401
}
```

## Expected Results
- Consistent 401 status
- Standard error format
- No sensitive data in response
- WWW-Authenticate header (if applicable)
- Login redirect hint

## Edge Cases / Error Scenarios
- Various invalid token formats
- Empty Authorization header
- Wrong auth scheme (Basic vs Bearer)
- Token from different environment
- Concurrent auth failures (no lockout)
