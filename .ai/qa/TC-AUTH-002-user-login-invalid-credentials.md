# Test Scenario 2: Login Failure with Invalid Credentials

## Test ID
TC-AUTH-002

## Category
Authentication & User Management

## Priority
High

## Description
Verify that the system correctly rejects login attempts with invalid credentials and displays appropriate error messages without revealing whether the email exists.

## Prerequisites
- Application is running and accessible
- A valid user account exists for comparison testing

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` page | Login form is displayed |
| 2 | Enter a valid email but incorrect password | Fields accept input |
| 3 | Click the "Login" button | Form is submitted |
| 4 | Observe error response | Generic error message is displayed |
| 5 | Clear form and enter non-existent email with any password | Fields accept input |
| 6 | Click the "Login" button | Form is submitted |
| 7 | Observe error response | Same generic error message is displayed |

## Expected Results
- Login is rejected with 401 status code
- Generic error message "Invalid credentials" or similar is shown
- Error message does NOT reveal whether email exists in system
- No auth token is set
- User remains on login page
- Password field is cleared after failed attempt

## Edge Cases / Error Scenarios
- Empty email field submission (validation error)
- Empty password field submission (validation error)
- Invalid email format (validation error)
- Password less than minimum length (validation error)
- SQL injection attempts in email/password fields (sanitized/rejected)
- XSS attempts in email/password fields (sanitized/rejected)
