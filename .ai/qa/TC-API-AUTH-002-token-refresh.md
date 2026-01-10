# Test Scenario 112: Session Token Refresh API

## Test ID
TC-API-AUTH-002

## Category
API Authentication & Security

## Priority
High

## Type
API Test

## Description
Verify that session tokens can be refreshed for continued access.

## Prerequisites
- Valid session exists
- Session token cookie present

## API Endpoint
`POST /api/auth/session/refresh`

## Cookies Required
- `session_token`: Long-lived session token

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with session cookie | Token refreshed |
| 2 | Verify new auth_token issued | Cookie set |
| 3 | Verify session extended | Expiry updated |
| 4 | Use new token | Access works |
| 5 | Test with expired session | Refresh fails |

## Expected Response
```json
{
  "success": true,
  "message": "Token refreshed",
  "expiresIn": 28800
}
```

## Expected Results
- New auth_token issued
- Session validity extended
- Old token may be invalidated
- Seamless user experience
- Works across tabs

## Edge Cases / Error Scenarios
- Session revoked (refresh fails)
- Session expired (401)
- Invalid session token (401)
- Concurrent refresh calls
- Session hijacking prevention
