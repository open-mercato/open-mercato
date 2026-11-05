# Test Scenario 12: Create New Role

## Test ID
TC-AUTH-012

## Category
Authentication & User Management

## Priority
High

## Description
Verify that an admin can create a new role with specific features/permissions that can be assigned to users.

## Prerequisites
- Admin user is logged in with `auth.roles.manage` feature
- Role management page is accessible
- Feature list is available for assignment

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/roles` | Roles list page is displayed |
| 2 | Click "Create Role" button | Role creation form is displayed |
| 3 | Enter role name | Name field accepts input |
| 4 | Select features/permissions to grant | Features are selectable (checkboxes or tree) |
| 5 | Use ACL editor to assign features | Features are assigned visually |
| 6 | Optionally set organization visibility | Organization filter is applied |
| 7 | Click "Save" button | Form is submitted |
| 8 | Observe success response | Success notification shown |

## Expected Results
- POST request to `/api/auth/roles` succeeds with 201 status
- Role record is created in database
- Role is scoped to current tenant
- RoleAcl record is created with selected features
- `featuresJson` contains array of feature strings
- Role appears in roles list
- Role can be assigned to users immediately
- Wildcard features (e.g., `users.*`) are properly stored

## Edge Cases / Error Scenarios
- Duplicate role name within tenant (may be allowed or error)
- Empty role name (validation error)
- Role with no features (should be allowed - empty permissions)
- Role with `*` wildcard (super admin equivalent)
- Very long role name (max length validation)
- Special characters in role name (may be sanitized)
- Create role with organization restrictions (visibility filter)
