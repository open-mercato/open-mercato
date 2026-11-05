# Test Scenario 6: Complete Password Reset

## Test ID
TC-AUTH-006

## Category
Authentication & User Management

## Priority
High

## Description
Verify that users can complete the password reset process using a valid token and successfully set a new password.

## Prerequisites
- Application is running and accessible
- User has requested a password reset
- Valid reset token exists and has not expired
- Email with reset link has been received

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the reset link from email or navigate to `/reset/{token}` | Password reset form is displayed |
| 2 | Verify token validation | Form loads without error |
| 3 | Enter new password in password field | Password is masked and accepted |
| 4 | Enter same password in confirm field (if exists) | Passwords match |
| 5 | Click "Reset Password" button | Form is submitted |
| 6 | Observe success response | Success message is displayed |
| 7 | Check redirection | User is redirected to `/login` |
| 8 | Login with new password | Login succeeds |

## Expected Results
- POST request to `/api/auth/reset/confirm` with token and new password
- Token is validated (exists, not expired, not used)
- Password is hashed with bcryptjs (cost=10)
- Token is marked as used (`usedAt` timestamp set)
- User is redirected to `/login` page
- Login with new password succeeds
- Login with old password fails

## Edge Cases / Error Scenarios
- Password too short (less than 6 characters - validation error)
- Passwords don't match in confirm field (validation error)
- Empty password field (validation error)
- Common/weak password (may show warning depending on policy)
- Attempt to reuse same reset token (should fail - token already used)
- Token valid but user account deleted (should handle gracefully)
