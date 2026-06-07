# Test Scenario: Gmail Pub/Sub Push Delivery End-to-End

## Test ID
TC-CHANNEL-EMAIL-C01

## Category
Communications Hub / Channel-Gmail / Push delivery

## Priority
High — addresses "Latency should be near-real-time" demo requirement

## Description
Verify that a connected Gmail channel receives new mail via Pub/Sub push (Spec C § Phase C2) and ingests it within ~15 s, instead of the 60 s polling baseline. Covers happy path + JWT-rejection + Pub/Sub topic misconfiguration fallback.

## Prerequisites
- A Google Cloud project with the Gmail API enabled and a Pub/Sub topic created.
- `gmail-api-push@system.gserviceaccount.com` granted **publisher** on the topic.
- A push subscription attached to the topic with `pushEndpoint=https://<your-host>/api/communication_channels/webhooks/gmail` and an authentication service account (NOT the system one).
- Operator env set: `OM_GMAIL_PUBSUB_TOPIC`, `OM_GMAIL_PUBSUB_AUDIENCE`, `OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`.
- A connected Gmail channel in `/backend/profile/communication-channels` (status=`connected`).
- ACL feature `communication_channels.channel.push.manage` granted to the logged-in user.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click "Re-register push" (or trigger the connect flow). | `POST /api/communication_channels/channels/<id>/push/register` returns 202 with `{ ok: true, pushStatus: 'active' }`. `channelState.historyId` + `watchExpirationMs` + `pubsubTopic` populated. `pollIntervalSeconds = 1800`. |
| 2 | Send a new email from an external account to the connected Gmail address. | Within 5–15 s the message appears in the CRM unified inbox AND on the matching Person timeline. |
| 3 | Check the channel's `lastPolledAt` in the DB. | Advances within seconds of step 2 (not 30 min). |
| 4 | Reply to the message from the external account. | Reply threads correctly back to the existing conversation (Spec B layered matcher). |
| 5 | Run `gcloud pubsub subscriptions seek --to-time=...` to redeliver an already-processed notification. | Worker ingests are idempotent — no duplicate `MessageChannelLink` row. |
| 6 | Misconfigure the topic (remove publisher grant). Click "Re-register push" again. | Webhook still receives nothing; channel keeps polling at 60s (fallback). `pushStatus` may be `failed` if `users.watch` itself errored. |
| 7 | Wait until 24h before `watchExpirationMs`. Observe the 04:00 UTC cron firing. | `gmail-renew-watch` worker re-enqueues a renewal job; on next push the `watchExpirationMs` is extended ~7 days. |

## Pass Criteria
- Step 2 latency under 30 s end-to-end (typical 5–15 s).
- Step 3 confirms cursor advances on push, not on a 30-minute cycle.
- Step 5 confirms idempotency.
- Step 6 confirms graceful fallback (no data loss).

## Fail Criteria
- Webhook returns 5xx on a properly-signed Pub/Sub POST.
- Duplicate inbox entries appear after redelivery.
- Removing publisher grant causes message loss (no polling fallback).
- Renewal cron never fires.

## Related Tests
- TC-CHANNEL-EMAIL-021..030 (Spec B polling + threading + import-history baseline)
