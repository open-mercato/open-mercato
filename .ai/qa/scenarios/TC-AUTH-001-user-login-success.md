# Test Scenario 1: Successful User Login

## Test ID
TC-AUTH-001

## Category
Authentication & User Management

## Priority
High

## Description
Verify that a user can successfully log in to the application with valid credentials and is redirected to the backend dashboard.

## Prerequisites
- Application is running and accessible
- A valid user account exists in the system
- User has appropriate roles assigned

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` page | Login form is displayed with email and password fields |
| 2 | Enter valid email address in the email field | Email is accepted and displayed in the field |
| 3 | Enter valid password in the password field | Password is masked and accepted |
| 4 | Click the "Login" button | Form is submitted |
| 5 | Wait for authentication process | Loading indicator may appear briefly |
| 6 | Observe redirection | User is redirected to `/backend` dashboard |

## Expected Results
- User is successfully authenticated
- Auth token cookie (`auth_token`) is set with 8-hour expiration
- User is redirected to `/backend` dashboard
- User's `lastLoginAt` timestamp is updated in the database
- Dashboard displays user-appropriate content based on roles

## Edge Cases / Error Scenarios
- Login with correct email but incorrect case (should work - email is case-insensitive)
- Login immediately after password change (should work with new password)
- Login with trailing/leading spaces in email (should be trimmed)
- Rapid successive login attempts (should not cause issues)
