# Test Scenario 15: Access Denied for Missing Permissions

## Test ID
TC-AUTH-015

## Category
Authentication & User Management

## Priority
High

## Description
Verify that the system properly denies access to pages and features when the user lacks required permissions, displaying appropriate error messages.

## Prerequisites
- User is logged in with limited permissions (not super admin)
- User's role lacks specific features (e.g., no `auth.users.create`)
- Pages/features exist that require permissions user doesn't have

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to a page requiring ungranted feature | Access denied page/message shown |
| 2 | Observe the error response | 403 Forbidden status |
| 3 | Verify no sensitive data is exposed | Only access denied message shown |
| 4 | Try direct API call to restricted endpoint | 403 Forbidden response |
| 5 | Check for action buttons on list pages | Create/Edit/Delete hidden if no permission |
| 6 | Attempt URL manipulation to access restricted page | Access denied |

## Expected Results
- Pages with `requireFeatures` check user permissions
- 403 Forbidden status returned for unauthorized access
- Access denied message is user-friendly
- No sensitive data is leaked in error response
- UI hides actions user cannot perform
- Direct API calls are also protected
- Feature check is performed on every request (not just cached)
- Audit log may record access denial attempts

## Edge Cases / Error Scenarios
- Access page during role ACL update (should reflect changes immediately)
- Partial permissions (can view but not edit)
- Wildcard permission matches (e.g., `users.*` grants `users.view`)
- Access to own user's data vs others' data
- Organization-scoped permissions (can access in org A but not org B)
- Super admin permissions override all checks
- Expired session during permission check (redirect to login)
- Concurrent permission revocation (should deny on next request)
