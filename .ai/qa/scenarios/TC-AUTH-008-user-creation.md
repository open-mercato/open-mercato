# Test Scenario 8: Admin Creates New User

## Test ID
TC-AUTH-008

## Category
Authentication & User Management

## Priority
High

## Description
Verify that an admin user can successfully create a new user account with all required fields and proper role assignment.

## Prerequisites
- Admin user is logged in with `auth.users.create` feature
- At least one tenant exists
- At least one organization exists
- At least one role exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/users` | Users list page is displayed |
| 2 | Click "Create User" button | User creation form is displayed |
| 3 | Enter valid email address | Email field accepts input |
| 4 | Enter password (minimum 6 characters) | Password is accepted |
| 5 | Select tenant from dropdown | Tenant is selected |
| 6 | Select organization from dropdown | Organization options filter by tenant |
| 7 | Select one or more roles | Roles are assigned |
| 8 | Fill any custom fields (if configured) | Custom fields accept input |
| 9 | Click "Save" or "Create" button | Form is submitted |
| 10 | Observe success response | Success notification is shown |

## Expected Results
- POST request to `/api/auth/users` succeeds with 201 status
- User record is created in database
- Email hash is computed for duplicate detection
- Password is hashed with bcryptjs (cost=10)
- User is marked as `isConfirmed: true`
- UserRole records are created for assigned roles
- Custom field values are stored
- `auth.crud.user.created` event is emitted
- User appears in the users list
- New user can log in with provided credentials

## Edge Cases / Error Scenarios
- Duplicate email address (should show validation error)
- Invalid email format (validation error)
- Password too short (validation error)
- No role selected (may be allowed or validation error)
- Tenant/organization mismatch (should not be possible with filtered dropdowns)
- Missing required custom fields (validation error)
