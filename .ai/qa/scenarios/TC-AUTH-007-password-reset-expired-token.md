# Test Scenario 7: Password Reset with Expired Token

## Test ID
TC-AUTH-007

## Category
Authentication & User Management

## Priority
Medium

## Description
Verify that the system correctly rejects password reset attempts with expired or invalid tokens and provides appropriate feedback.

## Prerequisites
- Application is running and accessible
- Expired reset token exists (older than 60 minutes)
- Or invalid/malformed token for testing

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/reset/{expired_token}` | Reset page attempts to load |
| 2 | Observe token validation | Error message about expired token |
| 3 | Navigate to `/reset/{invalid_token}` | Reset page attempts to load |
| 4 | Observe token validation | Error message about invalid token |
| 5 | Navigate to `/reset/{used_token}` | Reset page attempts to load |
| 6 | Observe token validation | Error message about already used token |

## Expected Results
- Expired token: Clear error message "Token has expired"
- Invalid token: Error message "Invalid reset token"
- Already used token: Error message "Token has already been used"
- No password change is possible with invalid tokens
- User is directed to request a new reset link
- Link to `/reset` page is provided

## Edge Cases / Error Scenarios
- Token with tampered characters (invalid)
- Token that doesn't exist in database (invalid)
- Token expired by 1 second (should be rejected)
- Token exactly at expiration boundary (edge case timing)
- Empty token in URL (validation error)
- Token with special characters (sanitized/rejected)
- SQL injection in token parameter (sanitized/rejected)
