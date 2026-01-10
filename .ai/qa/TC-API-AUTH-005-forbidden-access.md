# Test Scenario 115: Forbidden Access (403) Responses

## Test ID
TC-API-AUTH-005

## Category
API Authentication & Security

## Priority
High

## Type
API Test

## Description
Verify proper 403 Forbidden responses for authenticated but unauthorized requests.

## Prerequisites
- Valid authentication
- User lacks required permissions
- Protected endpoint exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Authenticate with limited user | Token obtained |
| 2 | Request protected resource | 403 returned |
| 3 | Verify response body | Permission error |
| 4 | Check required feature noted | Feature hint given |
| 5 | Verify audit logged | Access attempt logged |

## Expected Response
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions",
  "requiredFeature": "admin.system.manage",
  "statusCode": 403
}
```

## Expected Results
- 403 status (not 401)
- Clear permission message
- Required feature indicated
- No data leaked
- Audit trail recorded

## Edge Cases / Error Scenarios
- Multiple required features
- Organization-level restriction
- Feature recently revoked
- Super admin bypass
- Role-based vs user-based ACL
