# Test Scenario 13: Configure Role ACL and Permissions

## Test ID
TC-AUTH-013

## Category
Authentication & User Management

## Priority
High

## Description
Verify that an admin can configure role ACL settings including feature assignments, super admin flag, and organization visibility filters.

## Prerequisites
- Admin user is logged in with `auth.acl.manage` feature
- At least one role exists
- Multiple features and organizations exist for testing

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/backend/roles/[id]/edit` | Role edit form with ACL editor is displayed |
| 2 | Open ACL configuration section | Feature tree/list is visible |
| 3 | Expand feature categories | Individual features are shown |
| 4 | Select specific features (e.g., `users.view`, `users.create`) | Checkboxes are checked |
| 5 | Select a wildcard feature (e.g., `catalog.*`) | All catalog features are granted |
| 6 | Toggle super admin flag | isSuperAdmin is set |
| 7 | Configure organization visibility | Select specific organizations |
| 8 | Save changes | POST to `/api/auth/roles/[id]/acl` |
| 9 | Verify changes are persisted | Reload shows saved configuration |

## Expected Results
- ACL editor displays all available features grouped by module
- Individual features can be selected
- Wildcard patterns (e.g., `module.*`) are supported
- `isSuperAdmin` flag grants all features when enabled
- Organization visibility limits which orgs role can access
- Changes are saved to RoleAcl table
- Cache is invalidated for affected users
- Users with this role immediately see permission changes

## Edge Cases / Error Scenarios
- Remove all features from role (empty permissions)
- Set isSuperAdmin while also selecting specific features (super admin overrides)
- Select organization that user cannot access (should be filtered)
- Save empty organization list (grants access to all organizations)
- Concurrent ACL edit by two admins (last write wins)
- Edit ACL for role assigned to current user (may affect own permissions)
- Wildcard with specific exclusions (not supported - use specific features)
