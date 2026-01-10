# Test Scenario 110: Onboarding Invalid Token Handling

## Test ID
TC-API-ONBOARD-003

## Category
Onboarding APIs

## Priority
Medium

## Type
API Test

## Description
Verify proper handling of invalid or expired verification tokens.

## Prerequisites
- Onboarding module enabled
- Token scenarios available (invalid, expired)

## API Endpoint
`GET /api/onboarding/onboarding/verify`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET with invalid token | Error returned |
| 2 | Verify error message | Clear error text |
| 3 | Send GET with expired token | Expiration error |
| 4 | Verify no tenant created | No side effects |
| 5 | Check resend option | Retry guidance |

## Expected Response (Invalid)
```json
{
  "success": false,
  "error": "INVALID_TOKEN",
  "message": "The verification link is invalid or has expired",
  "actions": {
    "resend": "/onboarding/resend"
  }
}
```

## Expected Results
- Invalid token rejected
- Expired token rejected
- No partial tenant creation
- Helpful error messages
- Resend option provided

## Edge Cases / Error Scenarios
- Malformed token (handled)
- SQL injection attempt (sanitized)
- Empty token parameter (validation)
- Token for deleted pending (error)
- Brute force protection
