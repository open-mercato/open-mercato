# Test Scenario 3: Login with Remember Me

## Test ID
TC-AUTH-003

## Category
Authentication & User Management

## Priority
Medium

## Description
Verify that the "Remember Me" functionality creates a persistent session that survives browser restarts and allows automatic token refresh.

## Prerequisites
- Application is running and accessible
- A valid user account exists
- `REMEMBER_ME_DAYS` environment variable is configured (default 30 days)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` page | Login form with "Remember Me" checkbox is displayed |
| 2 | Enter valid credentials | Fields accept input |
| 3 | Check the "Remember Me" checkbox | Checkbox is selected |
| 4 | Click the "Login" button | Form is submitted |
| 5 | Observe cookies set | Both `auth_token` and `session_token` cookies are set |
| 6 | Wait for auth_token to expire (or manually delete it) | Short-lived token is gone |
| 7 | Refresh the page or navigate to `/api/session/refresh` | Session is automatically refreshed |
| 8 | Verify access to protected pages | User remains authenticated |

## Expected Results
- `auth_token` cookie is set with 8-hour expiration (HttpOnly, Secure in production)
- `session_token` cookie is set with 30-day expiration (or configured value)
- Session record is created in database with expiration timestamp
- When `auth_token` expires, session refresh endpoint issues new token
- User can close browser and return within 30 days without re-authenticating

## Edge Cases / Error Scenarios
- Session token is manually deleted from database (should require re-login)
- Session token expires (should require re-login)
- User logs out (both tokens should be cleared)
- Session refresh with invalid/corrupted token (should redirect to login)
- Multiple devices with same session token (should work independently)
