# Test Scenario: Gmail Token Refresh End-to-End

## Test ID
TC-CHANNEL-EMAIL-A01

## Category
Communications Hub / Channel-Gmail

## Priority
High — production-breaking bug fix verification

## Description
Verify that a connected Gmail channel survives access-token expiry by refreshing through the new `RefreshCredentialsInput.oauthClient` wiring (Spec A, [`.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`](../../specs/2026-05-27-email-integration-inbound-reliability-and-threading.md)). Prior to Spec A, this path failed silently because no production caller populated `credentials._client`.

## Prerequisites
- A Google Cloud project with the Gmail API enabled.
- An OAuth client ID/secret registered in Open Mercato Integrations UI (`oauth_gmail` row in `integration_credentials`) for the tenant.
- A test Gmail account connected to the tenant as a `CommunicationChannel` (status=`connected`, `providerKey='gmail'`, valid `refreshToken` persisted).
- Logged-in user has `communication_channels.view` and `communication_channels.manage` features.

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Confirm channel was connected and `integration_credentials` for `oauth_gmail` has `clientId` and `clientSecret`. Confirm `credentials.refreshToken` is set on the channel's stored credentials. | Both rows present in DB. |
| 2 | Force the channel's `credentials.expiresAt` to a past timestamp (e.g. `now - 60s`). Update via DB query or by setting `OM_PROFILE=communication_channels.*` and waiting >1 h for natural expiry. | `expiresAt` reflects the new past time. |
| 3 | Trigger an inbound poll: either send a new email to the Gmail address and wait ≤90 s, or POST `/api/communication_channels/channels/{id}/poll-now`. | Poll attempts to fetch history. |
| 4 | Observe server logs for the refresh call. | A log line indicates `refreshCredentialsIfNeeded` resolved `oauth_gmail` and invoked `gmail.users.messages.send` token endpoint successfully. NO `Invalid Gmail OAuth client credentials: OAuth Client ID required` error. |
| 5 | After the poll completes, query the channel's stored credentials. | `credentials.accessToken` has changed (new token); `credentials.expiresAt` is ~1 hour in the future; `credentials.refreshToken` is unchanged unless Google rotated it. |
| 6 | Trigger another poll within the next 60 minutes (before the new token expires). | Poll succeeds without a fresh refresh call. |
| 7 | Force `credentials.expiresAt` to the past again, but DELETE the `oauth_gmail` row first (simulate tenant admin removing the OAuth config). | Refresh attempts fail; channel flips to `status='requires_reauth'`; operator-facing notification `communication_channels.channel.requires_reauth` fires. |

## Pass Criteria
- Step 4 shows the refresh call carrying a real `clientId` resolved from `oauth_gmail`, NOT throwing.
- Step 5 confirms the new access token persisted to `integration_credentials` under `channel_gmail` scope.
- Step 7 confirms the requires-reauth path triggers cleanly when the OAuth config is missing.

## Fail Criteria
- Step 4 logs `Invalid Gmail OAuth client credentials` or any "expected string, received undefined" Zod error from `parseClientCredentialsOrThrow`.
- Step 5 shows the access token unchanged (silent refresh failure).
- Subsequent polls keep retrying and accumulating errors instead of flipping to `requires_reauth`.

## Notes
This is the primary regression test for the bug uncovered during the OAuth audit (see Spec A). The legacy `credentials._client` path is still recognized for one minor release with a one-time deprecation warning per process — verify that warning appears once and only once in dev logs.

## Related Tests
- TC-CHANNEL-EMAIL-006 / -007 / -008 (Gmail provider wiring smoke tests)
