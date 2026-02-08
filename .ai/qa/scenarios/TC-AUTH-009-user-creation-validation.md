# Test Scenario 9: User Creation Validation Errors

## Test ID
TC-AUTH-009

## Category
Authentication & User Management

## Priority
Medium

## Description
Verify that the user creation form properly validates all inputs and displays appropriate error messages for invalid data.

## Prerequisites
- Admin user is logged in with `auth.users.create` feature
- User creation form is accessible
- Existing user with known email for duplicate testing

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/users/create` | User creation form is displayed |
| 2 | Submit form with empty email | Validation error for email |
| 3 | Enter invalid email format (e.g., "notanemail") | Validation error for email format |
| 4 | Enter valid email, empty password | Validation error for password |
| 5 | Enter password less than 6 characters | Validation error for password length |
| 6 | Enter duplicate email (existing user) | Validation error for duplicate |
| 7 | Fill all required fields correctly | Form is ready for submission |
| 8 | Submit without selecting tenant | Validation error for tenant |
| 9 | Submit with tenant but no organization | May succeed or validation error |

## Expected Results
- Empty email: "Email is required" error
- Invalid email: "Invalid email format" error
- Empty password: "Password is required" error
- Short password: "Password must be at least 6 characters" error
- Duplicate email: "Email already exists" or "User with this email already exists"
- Missing tenant: "Tenant is required" error
- Form does not submit until all validation passes
- Field-level errors are displayed next to respective fields
- Errors are cleared when field is corrected

## Edge Cases / Error Scenarios
- Email with unicode characters (may be valid or rejected)
- Email with plus sign (e.g., user+tag@email.com - should be valid)
- Very long email address (should have max length validation)
- Password with only spaces (should be rejected)
- Special characters in password (should be allowed)
- Emoji in password (may be allowed or rejected)
- XSS attempts in any field (should be sanitized)
