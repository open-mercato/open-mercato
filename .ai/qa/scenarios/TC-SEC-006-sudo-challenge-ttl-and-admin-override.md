# Test Scenario 6: Sudo Challenge, Token TTL, and Admin Override

## Test ID
TC-SEC-006

## Category
Security

## Priority
High

## Type
API Test

## Description
Verify that a sudo-protected target requires a challenge before access, that successful verification issues a short-lived sudo token, that the token is accepted within TTL and rejected after expiry, and that an admin override can disable or re-enable a developer-default target.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A sudo-protected developer-default target exists, or the test creates one through `POST /api/security/sudo/configs`
- The test user has credentials that satisfy the configured sudo challenge path
- The scenario creates and cleans up its own sudo configuration records

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or identify a sudo-protected target and log in as a user who can access it | User is authenticated but has no active sudo token |
| 2 | Attempt the protected action without `X-Sudo-Token` | The action is rejected with the sudo-required response |
| 3 | Initiate the challenge through `POST /api/security/sudo` for the same target | The response indicates that sudo is required and returns `sessionId`, method, and expiry metadata |
| 4 | If the method is MFA, prepare the challenge via `POST /api/security/sudo/prepare`; then verify through `POST /api/security/sudo/verify` | Verification succeeds and returns a `sudoToken` with `expiresAt` |
| 5 | Retry the protected action with `X-Sudo-Token` inside the configured TTL window | The protected action succeeds |
| 6 | Advance time or wait past the configured TTL and retry the same action with the old token | The token is rejected as expired or invalid |
| 7 | As superadmin, disable the developer-default target with `PUT /api/security/sudo/configs/:id` | The target no longer requires sudo |
| 8 | Re-enable the target and repeat the protected call without a token | The sudo-required behavior returns again |

## Expected Results
- Sudo-protected targets fail closed when no valid sudo token is present
- Successful challenge verification issues a short-lived token that can be reused only within its TTL
- Expired tokens are rejected and do not silently extend their lifetime
- Admin overrides can disable and later re-enable a developer-default sudo target

## Edge Cases / Error Scenarios
- Submit a malformed sudo-init or sudo-verify payload and expect validation failure
- Attempt to verify a session against the wrong target identifier and expect rejection
- Confirm cleanup removes created sudo configs and any transient challenge/session records
