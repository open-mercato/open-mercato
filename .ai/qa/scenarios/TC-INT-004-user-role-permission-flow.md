# Test Scenario 72: User to Role to Permission to Access Verification

## Test ID
TC-INT-004

## Category
Integration Scenarios

## Priority
High

## Description
Verify that user permissions flow correctly from role assignment through feature access in the UI.

## Prerequisites
- Admin user is logged in with user/role management
- Test user account exists
- Role with limited permissions exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create new role with limited features | Role created |
| 2 | Assign only `catalog.products.view` feature | View-only permission |
| 3 | Create new user | User created |
| 4 | Assign the limited role to user | Role attached |
| 5 | Log in as new user | Login succeeds |
| 6 | Navigate to products list | Products visible |
| 7 | Attempt to create product | No create button or denied |
| 8 | Attempt direct URL to create page | Access denied |
| 9 | Log out and back in as admin | Admin session |
| 10 | Add `catalog.products.create` to role | Permission added |
| 11 | Log in as test user again | New session |
| 12 | Verify create button now visible | Permission applies |
| 13 | Successfully create product | Action succeeds |

## Expected Results
- Role permissions control user access
- UI hides unauthorized actions
- Direct URL access is blocked
- Permission changes take effect on next request
- Audit logs capture access attempts
- Multiple roles combine permissions
- Organization scope limits data visibility
- Super admin bypasses all checks

## Edge Cases / Error Scenarios
- User with no roles (minimal access)
- Conflicting permissions from multiple roles (union)
- Permission removed during session (immediate effect)
- Wildcard permission expansion (module.*)
- Super admin flag overrides all
- Role deleted while assigned (handle gracefully)
- Circular role inheritance (if supported)
- Cache of permissions (invalidation timing)
