# Test Scenario 11: Delete User Account

## Test ID
TC-AUTH-011

## Category
Authentication & User Management

## Priority
Medium

## Description
Verify that an admin user can delete a user account and the system properly handles the soft delete, preventing the deleted user from accessing the system.

## Prerequisites
- Admin user is logged in with `auth.users.delete` feature
- At least one user exists that can be safely deleted
- User to delete is not the currently logged-in admin

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/users` | Users list is displayed |
| 2 | Find target user in list | User is visible |
| 3 | Click "Delete" action for the user | Confirmation dialog appears |
| 4 | Confirm the deletion | Delete action is executed |
| 5 | Observe success response | Success notification shown |
| 6 | Verify user is removed from list | User no longer visible |
| 7 | Attempt to login as deleted user | Login fails |

## Expected Results
- DELETE request to `/api/auth/users/[id]` succeeds
- User is soft-deleted (`deleted_at` timestamp is set)
- User is removed from active users list
- User's sessions are invalidated
- `auth.crud.user.deleted` event is emitted
- Deleted user cannot log in
- User data is retained for audit purposes
- Related records (roles, ACLs) remain intact but orphaned

## Edge Cases / Error Scenarios
- Attempt to delete own account (should be prevented)
- Attempt to delete super admin (may require special permission)
- Delete user with active sessions (sessions should be invalidated)
- Delete user who owns critical data (may have cascade warnings)
- Restore deleted user (may be supported via admin)
- Delete already deleted user (should be no-op or error)
- Delete user from different organization (access denied)
