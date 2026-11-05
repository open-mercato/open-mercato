# Test Scenario 3: OTP Email Enrollment and Challenge Attempt Handling

## Test ID
TC-SEC-003

## Category
Security

## Priority
High

## Type
API Test + Minimal UI Verification

## Description
Verify that the OTP email MFA provider can be enrolled, that login challenges can be prepared for `otp_email`, and that repeated invalid verification attempts are rejected without issuing a verified session.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A tenant-scoped user fixture exists for this scenario only
- The test environment can capture the generated OTP challenge payload or inspect the email-delivery stub/test adapter
- The user has no pre-existing MFA methods

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a tenant-scoped user fixture and log in | User is authenticated and can access security profile APIs |
| 2 | Fetch `GET /api/security/mfa/providers` | `otp_email` is present in the provider list with user-facing label and metadata |
| 3 | Start and confirm OTP email setup using the provider route for `otp_email` | The method is enrolled successfully for the user |
| 4 | Verify the method list through `GET /api/security/mfa/methods` | A single active `otp_email` method is returned for the user |
| 5 | Sign out and log in again with email/password | Login enters MFA-pending state and returns the available MFA methods |
| 6 | Prepare the OTP email challenge with `POST /api/security/mfa/prepare` using `methodType: otp_email` | The server accepts the challenge preparation and triggers the email-based challenge path |
| 7 | Submit an invalid OTP code to `POST /api/security/mfa/verify` | Verification is rejected and no verified session is issued |
| 8 | Repeat invalid verification until the failure threshold is reached | Attempt counters advance and the challenge remains unusable for a successful login |
| 9 | Restart the login flow, prepare a fresh challenge, and submit the valid OTP code | Verification succeeds and the verified session redirects to `/backend` |

## Expected Results
- The `otp_email` provider is discoverable through `/api/security/mfa/providers`
- OTP email enrollment succeeds through the generic provider route
- Challenge preparation for `otp_email` is routed through `POST /api/security/mfa/prepare`
- Invalid verification attempts do not mint a verified auth cookie or redirect the user into the backend
- A fresh valid challenge can still be completed successfully after previous failed attempts on an earlier challenge

## Edge Cases / Error Scenarios
- Prepare a challenge with a non-existent `methodType` and expect validation or provider-resolution failure
- Call `/api/security/mfa/verify` without MFA-pending auth context and expect `403`
- Reuse an already-consumed OTP code and expect rejection
- Confirm the invalid-attempt assertions against the server response rather than brittle UI copy
