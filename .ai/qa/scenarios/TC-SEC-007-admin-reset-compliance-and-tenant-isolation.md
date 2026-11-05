# Test Scenario 7: Admin MFA Reset, Status Reporting, and Cross-Tenant Isolation

## Test ID
TC-SEC-007

## Category
Security

## Priority
High

## Type
API Test

## Description
Verify that a privileged administrator can inspect a user’s MFA status, reset that user’s MFA with a reason and valid sudo authorization, read enforcement-compliance reporting, and cannot manage users from another tenant.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A superadmin or security administrator fixture exists with features needed for the admin routes
- Two separate tenant/user fixture sets are created for isolation checks
- The target user in the primary tenant has at least one enrolled MFA method before reset

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create tenant A and tenant B user fixtures, then enroll MFA for the tenant A user | Tenant A target user has measurable MFA state |
| 2 | As the privileged admin, request `GET /api/security/users/:id/mfa/status` for the tenant A user | Response returns enrolled state, method list, recovery-code count, and compliance flag |
| 3 | Request `GET /api/security/enforcement/compliance` for the relevant scope | Compliance counters are returned successfully |
| 4 | Attempt `POST /api/security/users/:id/mfa/reset` without a valid sudo token | The reset is rejected with sudo-required behavior |
| 5 | Complete the required sudo challenge and repeat the reset with a non-empty reason | MFA reset succeeds |
| 6 | Request `GET /api/security/users/:id/mfa/status` again for the same tenant A user | The user now shows no enrolled methods or updated post-reset state |
| 7 | Attempt to read or reset the tenant B user from the tenant A admin context | Access is denied or the user is treated as not found due to tenant isolation |

## Expected Results
- Admin status reporting returns the security summary for a same-tenant target user
- MFA reset is gated by sudo and requires a reason
- Successful reset removes the target user’s active MFA state
- Compliance reporting remains available to the authorized admin path
- Cross-tenant reads and management actions are blocked

## Edge Cases / Error Scenarios
- Attempt reset with an empty reason and expect request validation failure
- Attempt status lookup with an invalid UUID and expect `400`
- Verify that reset does not affect users outside the targeted tenant
