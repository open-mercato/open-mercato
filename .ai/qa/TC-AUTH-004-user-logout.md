# Test Scenario 4: User Logout

## Test ID
TC-AUTH-004

## Category
Authentication & User Management

## Priority
High

## Description
Verify that user logout properly terminates the session, clears all authentication cookies, and prevents access to protected resources.

## Prerequisites
- Application is running and accessible
- User is currently logged in
- Session token exists (if Remember Me was used)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to any protected backend page | Page loads successfully |
| 2 | Click the logout button/link | Logout action is triggered |
| 3 | Observe the logout process | POST request to `/api/auth/logout` |
| 4 | Check redirection | User is redirected to `/login` |
| 5 | Inspect browser cookies | `auth_token` and `session_token` are cleared |
| 6 | Attempt to navigate to a protected page | Access is denied |

## Expected Results
- POST/GET request to `/api/auth/logout` succeeds
- `auth_token` cookie is deleted
- `session_token` cookie is deleted (if exists)
- Session record is removed from database (if exists)
- User is redirected to `/login` page
- Subsequent requests to protected endpoints return 401
- Browser back button does not grant access to protected pages

## Edge Cases / Error Scenarios
- Logout when session already expired (should still clear cookies)
- Logout with network interruption (cookies should be cleared locally)
- Concurrent logout from multiple tabs (should handle gracefully)
- Logout after password change (should invalidate all sessions)
- Direct API call to logout without UI (should work)
