# Test Scenario: Microsoft Graph Subscription Push Delivery End-to-End

## Test ID
TC-CHANNEL-EMAIL-C02

## Category
Communications Hub / Channel-Microsoft / Push delivery

## Priority
High — companion to TC-C01 for the Microsoft side of the latency story.

## Description
Verify Microsoft 365 / Outlook channels receive new mail via Graph change-notification subscription (Spec C § Phase C3) within ~15 s, including the validation handshake, lifecycle event handling, and encrypted `clientState` round-trip.

## Prerequisites
- Microsoft tenant with Mail.Read + Mail.ReadWrite consented on the Open Mercato App.
- `OM_MICROSOFT_WEBHOOK_BASE_URL` env set to the public hostname (must be HTTPS, publicly reachable).
- Connected Microsoft channel in `/backend/profile/communication-channels`.
- ACL feature `communication_channels.channel.push.manage` granted.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click "Re-register push". | `pushRegister` posts `POST /subscriptions` to Graph. Within seconds, Graph POSTs `?validationToken=…` to `/api/communication_channels/webhooks/microsoft/<channelId>` — our route echoes verbatim with `text/plain` + `200 OK`. Graph then completes the subscription create; the response carries `id`, `expirationDateTime`. |
| 2 | Confirm `channel.client_state_encrypted` is populated and `channel.channelState.subscriptionId` matches Graph's id. | Both present; raw clientState NOT visible in plaintext anywhere. |
| 3 | Confirm `pollIntervalSeconds = 1800` and `pushStatus = 'active'`. | Polling cadence dropped to 30 min. |
| 4 | Send an email to the connected mailbox. | Graph POSTs `{ value: [{ subscriptionId, clientState, changeType: 'created', resource: '...' }] }` to the notification URL within 5–15 s. Webhook verifies clientState (decrypt + constant-time compare), enqueues `microsoft-delta-sync`. Worker pulls `/me/messages/delta` and ingests. Message appears in CRM within ~30 s. |
| 5 | Tamper: POST a notification with a wrong clientState. | Webhook returns `401 invalid_client_state`. No job enqueued. |
| 6 | Revoke OAuth consent for the user in the Microsoft tenant. | Within hours Graph emits a `reauthorizationRequired` lifecycle event. Webhook flips channel to `status='requires_reauth'` and emits the `communication_channels.channel.requires_reauth` notification. |
| 7 | Wait until 4h before `subscriptionExpiresAt`. Observe the every-2-hours cron firing. | `microsoft-renew-subscriptions` worker runs; subscription PATCHed to a new expiry. |
| 8 | Graph removes the subscription (e.g. too many missed notifications). | Lifecycle `subscriptionRemoved` event clears `pushStatus`, resets `pollIntervalSeconds = 60`. Polling fallback resumes — no data loss. |

## Pass Criteria
- Step 1 validation handshake completes within 10 s (Graph's hard limit).
- Step 5 prevents forged notifications (clientState constant-time compare).
- Step 6 surfaces the reauth notification to the operator UI.
- Step 7 cron renewal extends expiry without manual action.
- Step 8 graceful fallback to polling.

## Fail Criteria
- Validation handshake times out → subscription create fails.
- Forged notification with wrong clientState gets ingested.
- Renewal cron doesn't fire → subscription expires, channel goes silent without falling back to polling.

## Related Tests
- TC-CHANNEL-EMAIL-C01 (Gmail Pub/Sub)
- TC-CHANNEL-EMAIL-A02 (Microsoft token refresh — Spec A)
