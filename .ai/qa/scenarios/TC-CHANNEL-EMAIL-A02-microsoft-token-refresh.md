# Test Scenario: Microsoft 365 Token Refresh End-to-End

## Test ID
TC-CHANNEL-EMAIL-A02

## Category
Communications Hub / Channel-Microsoft

## Priority
High — production-breaking bug fix verification

## Description
Verify that a connected Microsoft 365 channel survives access-token expiry by refreshing through the new `RefreshCredentialsInput.oauthClient` wiring (Spec A, [`.ai/specs/2026-05-27-email-integration-inbound-reliability-and-threading.md`](../../specs/2026-05-27-email-integration-inbound-reliability-and-threading.md)). Additionally verifies Microsoft's per-refresh **refresh-token rotation** is correctly persisted.

## Prerequisites
- An Azure AD app registration with delegated permissions: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`.
- Authentication → Redirect URI configured for the Open Mercato deployment.
- Client secret created in Azure (or public-client + PKCE configured).
- OAuth client registered in Open Mercato Integrations UI (`oauth_microsoft` row in `integration_credentials`) for the tenant, with `clientId`, `tenantId` (e.g. `common`), and `clientSecret`.
- A test Microsoft 365 account connected to the tenant as a `CommunicationChannel` (status=`connected`, `providerKey='microsoft'`, valid `refreshToken` persisted).

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Confirm channel was connected and `integration_credentials` for `oauth_microsoft` has all three fields (`clientId`, `tenantId`, `clientSecret`). Confirm `credentials.refreshToken` is set. | Both rows present. |
| 2 | Force `credentials.expiresAt` to a past timestamp. | `expiresAt` reflects the past. |
| 3 | Trigger an inbound poll: send an email to the Microsoft 365 mailbox and wait ≤90 s, or POST `/api/communication_channels/channels/{id}/poll-now`. | Poll attempts a delta query. |
| 4 | Observe server logs for the refresh call. | `refreshCredentialsIfNeeded` resolves `oauth_microsoft`, invokes `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token` with both `client_secret` AND `code_verifier` semantics (confidential-client + PKCE). |
| 5 | After the poll completes, query the channel's stored credentials. | `credentials.accessToken` has changed; `credentials.expiresAt` is ~60-90 minutes in the future; `credentials.refreshToken` has been **rotated** (different value from prior). |
| 6 | Trigger another poll. | Uses the rotated refresh token; succeeds; rotates again on next refresh. |
| 7 | Trigger a `reauthorizationRequired` scenario: revoke the user's OAuth grant in Azure portal (`Sign out everywhere` or remove the app from "Enterprise apps"). Force a poll. | Refresh fails with `invalid_grant`; channel flips to `status='requires_reauth'`; notification fires. |
| 8 | Delete the `oauth_microsoft` integration row. Force `credentials.expiresAt` to past. Trigger poll. | Refresh fails; channel flips to `status='requires_reauth'`. |

## Pass Criteria
- Step 4 confirms refresh uses real `clientId`+`tenantId` resolved from `oauth_microsoft`, NOT throwing.
- Step 5 confirms refresh-token rotation persisted (this is critical — if we don't adopt the rotated token, the NEXT refresh fails with `invalid_grant`).
- Steps 7 and 8 confirm both reauth paths trigger cleanly.

## Fail Criteria
- Step 4 logs `Invalid Microsoft OAuth client credentials` or any Zod error from `parseClientCredentialsOrThrow`.
- Step 5 shows the refresh token UNCHANGED after a successful refresh — this is a silent failure that breaks the next refresh cycle.
- Step 7/8 keeps retrying instead of surfacing `requires_reauth`.

## Notes
This is the primary regression test for the bug uncovered during the OAuth audit (see Spec A). Microsoft's per-refresh refresh-token rotation is documented at [Microsoft Entra ID refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens#token-lifetime). The legacy `credentials._client` path is still recognized for one minor release with a one-time deprecation warning per process — verify that warning appears once.

## Related Tests
- TC-CHANNEL-EMAIL-A01 (Gmail equivalent)
- TC-CHANNEL-EMAIL-011 / -012 / -013 (Microsoft provider wiring smoke tests)
