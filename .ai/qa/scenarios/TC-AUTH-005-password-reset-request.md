# Test Scenario 5: Password Reset Request

## Test ID
TC-AUTH-005

## Category
Authentication & User Management

## Priority
High

## Description
Verify that users can request a password reset email and the system generates a secure, time-limited reset token.

## Prerequisites
- Application is running and accessible
- Email service is configured and operational
- A valid user account exists with a known email

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` page | Login page is displayed |
| 2 | Click "Forgot Password" or navigate to `/reset` | Password reset form is displayed |
| 3 | Enter a registered email address | Email field accepts input |
| 4 | Click "Send Reset Link" button | Form is submitted |
| 5 | Observe success message | Generic success message is shown |
| 6 | Check email inbox | Reset email is received |
| 7 | Inspect reset link in email | Link contains reset token |

## Expected Results
- POST request to `/api/auth/reset` returns success (200)
- Success message is shown regardless of whether email exists (security)
- If email exists, reset token is generated (32-byte hex)
- Token expires in 60 minutes
- Email is sent with reset link: `{APP_URL}/reset/{token}`
- Email template includes expiration notice
- Previous unused reset tokens for same user remain valid

## Edge Cases / Error Scenarios
- Request reset for non-existent email (show same success message - no info leak)
- Request multiple resets for same email (each creates new valid token)
- Email service is down (should handle gracefully, possibly retry)
- Invalid email format (validation error)
- Empty email field (validation error)
- Request reset for inactive/disabled account (may still send or silently fail)
