# Test Scenario 109: Onboarding Email Verification API

## Test ID
TC-API-ONBOARD-002

## Category
Onboarding APIs

## Priority
High

## Type
API Test

## Description
Verify that email verification completes the signup and creates tenant.

## Prerequisites
- Pending signup exists
- Verification token available
- Token not expired

## API Endpoint
`GET /api/onboarding/onboarding/verify`

## Query Parameters
- `token`: Verification token from email

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET with valid token | Verification processed |
| 2 | Verify tenant created | New tenant exists |
| 3 | Verify user created | User in tenant |
| 4 | Check admin role assigned | User is admin |
| 5 | Verify redirect or success | Login possible |

## Expected Response
```json
{
  "success": true,
  "tenantId": "tenant-456",
  "userId": "user-789",
  "message": "Account verified successfully",
  "redirectUrl": "/login?verified=true"
}
```

## Expected Results
- Email verified
- Tenant created with defaults
- User created as admin
- Default role assigned
- Can login immediately

## Edge Cases / Error Scenarios
- Invalid token (error)
- Expired token (error)
- Already verified (idempotent or error)
- Tenant creation failure (rollback)
- Email already used (conflict)
