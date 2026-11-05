# Test Scenario 8: Provider Registry and Generic Fallback UI

## Test ID
TC-SEC-008

## Category
Security

## Priority
Medium

## Type
UI Test + API Fixture Setup

## Description
Verify that the MFA provider registry exposes the built-in providers, that a custom provider registered by an auxiliary test module appears in the security module APIs and UI, and that the generic setup/verify fallback path works when the custom provider does not supply dedicated React components.

## Prerequisites
- Application is running with the enterprise `security` module enabled
- A test-only custom MFA provider module is enabled for the scenario
- The custom provider is registered without custom `SetupComponent` or `VerifyComponent`
- A tenant-scoped user fixture exists only for this scenario

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Log in as the fixture user and request `GET /api/security/mfa/providers` | Built-in providers `totp`, `passkey`, and `otp_email` are listed |
| 2 | Verify that the custom provider is also returned by `/api/security/mfa/providers` | The custom provider appears with label, icon, and `allowMultiple` metadata |
| 3 | Open `/backend/profile/security/mfa` | The available methods UI shows both built-in and custom providers |
| 4 | Navigate to the custom provider setup route | The generic fallback setup form is rendered instead of a provider-specific component |
| 5 | Submit the generic setup payload and confirm enrollment | The custom provider method is enrolled successfully |
| 6 | Sign out and log back in to trigger MFA challenge flow for the custom provider | The generic verify fallback is rendered for the custom provider challenge |
| 7 | Complete verification with a valid custom-provider payload | MFA login succeeds and the user is redirected to `/backend` |

## Expected Results
- Provider registry returns all built-in providers and the registered custom provider
- The security UI can render custom providers without custom React components
- Generic setup and generic verification flows are sufficient to complete the custom provider lifecycle
- The custom provider behaves like a first-class MFA method in both management and challenge flows

## Edge Cases / Error Scenarios
- Remove the custom provider from test setup and verify only built-ins remain
- Submit invalid generic setup payload and expect provider-schema validation errors
- Confirm cleanup unregisters or tears down the custom provider fixture state after the scenario
