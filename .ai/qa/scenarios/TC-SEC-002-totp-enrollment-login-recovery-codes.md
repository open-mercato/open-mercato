# Test Scenario 2: TOTP Enrollment, MFA Login, and Recovery Codes

## Test ID
TC-SEC-002

## Category
Security

## Priority
High

## Type
UI Test + API Fixture Setup

## Description
Verify that an enrolled user can add a TOTP MFA method from the security profile, complete an MFA-gated login with the TOTP code, consume a recovery code when the TOTP code is unavailable, and regenerate the recovery code set from the MFA settings area.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A tenant-scoped admin user exists and can log in with email and password
- The test creates its own user fixture and does not rely on seeded/demo data
- The test can read the setup payload returned by `POST /api/security/mfa/provider/totp`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a tenant-scoped user fixture and sign in to `/login` | User reaches the backend and has access to `/backend/profile/security/mfa` |
| 2 | Open `/backend/profile/security/mfa` and inspect available providers | TOTP is listed as an available provider and no TOTP method is enrolled yet |
| 3 | Start TOTP setup through `/backend/profile/security/mfa/totp` or the provider action on the MFA page | The UI requests setup data from `POST /api/security/mfa/provider/totp` and shows QR/manual-secret details |
| 4 | Generate a valid TOTP code from the returned secret and confirm setup through `PUT /api/security/mfa/provider/totp` | TOTP enrollment succeeds and recovery codes are shown once |
| 5 | Persist one recovery code for later use and return to the MFA overview | The TOTP method appears in the enrolled methods list with active status |
| 6 | Sign out, then sign in again with the same email and password | Login response is intercepted and the flow switches to MFA challenge instead of issuing a full session immediately |
| 7 | Submit a valid TOTP code through the MFA challenge flow | MFA verification succeeds, a verified session is issued, and the user is redirected to `/backend` |
| 8 | Sign out again and repeat login, but complete the challenge with an unused recovery code via `POST /api/security/mfa/recovery` | Login succeeds and the recovery code is consumed |
| 9 | Return to `/backend/profile/security/mfa/recovery-codes` and regenerate recovery codes via `POST /api/security/mfa/recovery-codes/regenerate` | A fresh set of 10 recovery codes is returned and previous recovery codes are invalidated |
| 10 | Attempt to use the previously consumed or superseded recovery code | Verification is rejected with an invalid recovery code response |

## Expected Results
- TOTP enrollment works end to end through the provider route pair:
  - `POST /api/security/mfa/provider/totp`
  - `PUT /api/security/mfa/provider/totp`
- First MFA enrollment returns recovery codes exactly once during setup
- Password login for a user with active MFA methods produces an MFA challenge instead of a full session
- Successful TOTP verification completes login and redirects to `/backend`
- Recovery code verification works exactly once per code
- Recovery code regeneration replaces the previous set and does not leave old codes usable

## Edge Cases / Error Scenarios
- Submit an invalid TOTP code during setup confirmation and expect enrollment to remain inactive
- Submit an invalid TOTP code during login challenge and expect a 401-style verification failure
- Attempt recovery-code login without an MFA-pending session and expect rejection
- Verify that cleanup removes the created user, MFA methods, recovery codes, and challenge records
