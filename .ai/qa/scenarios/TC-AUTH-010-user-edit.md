# Test Scenario 10: Edit Existing User

## Test ID
TC-AUTH-010

## Category
Authentication & User Management

## Priority
High

## Description
Verify that an admin user can successfully edit an existing user's details including email, roles, and organization assignment.

## Prerequisites
- Admin user is logged in with `auth.users.edit` feature
- At least one non-admin user exists for editing
- User has access to view/edit the target user (organization scope)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/users` | Users list is displayed |
| 2 | Find target user in list | User is visible |
| 3 | Click "Edit" action for the user | Edit form is displayed at `/backend/users/[id]/edit` |
| 4 | Verify current values are populated | All fields show current values |
| 5 | Modify email address | New email is accepted |
| 6 | Add or remove roles | Role selection is updated |
| 7 | Change organization (if applicable) | Organization is updated |
| 8 | Leave password field empty (no change) | Password remains unchanged |
| 9 | Click "Save" button | Form is submitted |
| 10 | Observe success response | Success notification shown |

## Expected Results
- PATCH/PUT request to `/api/auth/users/[id]` succeeds
- User record is updated in database
- If email changed, email hash is recomputed
- If password provided, it's hashed and updated
- Role assignments are updated (added/removed)
- Organization assignment is updated
- Custom field values are updated
- `auth.crud.user.updated` event is emitted
- Changes are reflected in user list
- If email changed, user must log in with new email

## Edge Cases / Error Scenarios
- Edit own user account (may have restrictions)
- Change email to existing email (duplicate error)
- Remove all roles from user (may be allowed or error)
- Change tenant of user (may not be allowed)
- Edit super admin user (may require special permissions)
- Concurrent edit by two admins (last write wins or conflict)
- Edit deleted user (should not be possible)
