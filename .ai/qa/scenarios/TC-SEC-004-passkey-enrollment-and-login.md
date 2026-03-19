# Test Scenario 4: Passkey Enrollment and MFA Login

## Test ID
TC-SEC-004

## Category
Security

## Priority
High

## Type
UI Test

## Description
Verify that a user can register a passkey MFA method from the security profile and then complete a subsequent MFA login with the registered passkey. This scenario is feature-detected and must skip with an explicit reason when WebAuthn is unsupported in the CI/runtime environment.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A tenant-scoped user fixture exists only for this test
- Browser/runtime support for WebAuthn is available, or the test can skip explicitly with a recorded reason
- The user has access to `/backend/profile/security/mfa/passkey`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a user fixture and sign in | User reaches the backend security area |
| 2 | Open `/backend/profile/security/mfa` and confirm that passkey is listed as an available provider | Passkey appears in the available methods UI |
| 3 | Navigate to `/backend/profile/security/mfa/passkey` | The passkey setup flow loads and performs a browser-support check |
| 4 | If WebAuthn is unsupported, mark the scenario skipped with an explicit environment reason | Skip is recorded intentionally and not treated as a product failure |
| 5 | If WebAuthn is supported, start enrollment and complete the browser credential-creation ceremony | Passkey registration succeeds |
| 6 | Return to the MFA methods list | The new passkey method is shown as active |
| 7 | Sign out and log in again with email/password | Login enters MFA challenge mode |
| 8 | Select the passkey method and complete the browser verification ceremony | MFA verification succeeds and the user is redirected to `/backend` |

## Expected Results
- Passkey provider is visible in the MFA management UI
- The passkey setup flow feature-detects browser/runtime support before attempting WebAuthn calls
- Successful passkey enrollment adds an active `passkey` method to the current user
- Subsequent login can be completed through the passkey MFA challenge path

## Edge Cases / Error Scenarios
- Cancel the browser passkey ceremony and expect the enrollment to remain incomplete
- Attempt login challenge with a missing or rejected WebAuthn assertion and expect the session to remain MFA-pending
- Verify that the test skips explicitly rather than failing when WebAuthn is unsupported in CI
