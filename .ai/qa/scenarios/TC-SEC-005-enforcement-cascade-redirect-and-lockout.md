# Test Scenario 5: MFA Enforcement Cascade, Allowed Methods, Redirect, and Lockout

## Test ID
TC-SEC-005

## Category
Security

## Priority
High

## Type
API Test + UI Redirect Verification

## Description
Verify that MFA enforcement policies resolve by scope precedence, that allowed-method restrictions affect the providers exposed to the user, that unenrolled users are redirected to the MFA enrollment page during the grace period, and that overdue users are blocked after the deadline.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- Superadmin credentials are available for enforcement-policy setup
- The scenario creates its own tenant, organization, and user fixtures where needed
- Time-sensitive assertions use controlled deadlines or fixtures rather than depending on wall-clock timing drift

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | As superadmin, create a platform-wide enforcement policy through `POST /api/security/enforcement` with multiple allowed methods and a future deadline | The policy is created successfully |
| 2 | Create a tenant-scoped policy for the same user population with a narrower allowed-method list | Tenant policy is created and coexists with the platform policy |
| 3 | Create an organization-scoped policy with the highest precedence and a single allowed method | Organization policy is created successfully |
| 4 | Sign in as a user affected by all three scopes but not yet enrolled in MFA | The user is redirected to `/backend/profile/security/mfa` with the enrollment-required notice during the grace period |
| 5 | Inspect the MFA page providers and `/api/security/mfa/providers` response for the affected user | Only the methods allowed by the effective highest-precedence policy are available |
| 6 | Enroll one allowed method and re-enter the application | The redirect requirement is cleared and the user regains normal backend access |
| 7 | Create a second unenrolled user under the same effective policy but with an overdue deadline | Login is blocked or held in the hard-lockout path after the deadline |
| 8 | Query `GET /api/security/enforcement/compliance` for the relevant scope | The enrolled, pending, and overdue counters reflect the fixture users accurately |

## Expected Results
- Policy resolution follows organisation > tenant > platform precedence
- Allowed-method filtering affects both setup availability and later verification paths
- During the grace period, unenrolled users are redirected to the MFA enrollment experience instead of accessing the backend normally
- After the deadline, unenrolled users are blocked from completing login
- Compliance reporting reflects the current enforcement state for the tested scope

## Edge Cases / Error Scenarios
- Delete the most specific policy and verify resolution falls back to the next-most-specific scope
- Attempt to enroll a disallowed MFA provider and expect it to be absent from the available provider list
- Assert that created policies and users are removed in cleanup to avoid cross-test leakage
