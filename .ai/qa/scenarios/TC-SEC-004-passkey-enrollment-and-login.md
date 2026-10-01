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
Verify that a user can register a passkey MFA method from the security profile and then complete a subsequent MFA login with the registered passkey. Automated coverage uses Chromium virtual authenticators. Other browser projects skip with an explicit reason; Chromium must support WebAuthn.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A tenant-scoped user fixture exists only for this test
- Chromium with CDP virtual authenticator support, or a real authenticator for manual QA
- The user has access to `/backend/profile/security/mfa/passkey`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a user fixture and sign in | User reaches the backend security area |
| 2 | Open `/backend/profile/security/mfa` and confirm that passkey is listed as an available provider | Passkey appears in the available methods UI |
| 3 | Navigate to `/backend/profile/security/mfa/passkey` | The passkey setup flow loads and performs a browser-support check |
| 4 | Submit the legacy public-key payload with the actual setup challenge, then a malformed confirmation | Both return 400 and no active method is created |
| 5 | Enroll two distinct passkeys through separate authenticators and real credential-creation ceremonies | Both registrations succeed |
| 6 | Return to the MFA methods list | The new passkey method is shown as active |
| 7 | Sign out and log in again with email/password | Login enters MFA challenge mode |
| 8 | Attempt enrollment with the MFA-pending session, then submit an unsigned assertion | Enrollment returns 401; unsigned verification returns 401 and no token |
| 9 | Complete the prepared challenge with the indicated authenticator | Signed verification succeeds and returns a verified session |
| 10 | Remove the selected method, then repeat login using the remaining credential | The second independently enrolled credential also authenticates |

## Expected Results
- Passkey provider is visible in the MFA management UI
- The passkey setup flow feature-detects browser/runtime support before attempting WebAuthn calls
- Successful passkey enrollment adds an active `passkey` method to the current user
- Subsequent login can be completed through the passkey MFA challenge path

## Edge Cases / Error Scenarios
- Cancel the browser passkey ceremony and expect the enrollment to remain incomplete
- Attempt login challenge with a missing or rejected WebAuthn assertion and expect the session to remain MFA-pending
- Verify POST and PUT enrollment remain inaccessible to MFA-pending sessions

## Automation Coverage

`TC-SEC-004.spec.ts` covers the provider UI and the real setup/confirmation, methods-list,
login, prepare, verify and removal APIs. Two Chromium CDP virtual authenticators create real
registration responses and sign login challenges. The test follows the credential advertised
in `allowCredentials`, then removes it and proves the remaining passkey also works. It rejects
legacy enrollment, malformed confirmation, MFA-pending enrollment and unsigned verification.

Manual QA still checks the shipped UI's Add interaction and real hardware/browser behavior.
Passing passkey sudo step-up remains separate coverage; this scenario does not claim it.
