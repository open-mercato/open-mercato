# Test Scenario: Renewal Cron Actually Re-issues Push

## Test ID
TC-CHANNEL-EMAIL-C05

## Category
Communications Hub / Push delivery / Spec C § Phase C4

## Priority
High — without renewal, push silently dies after the provider's expiry window.

## Description
The renewal cron workers iterate active push channels whose expiry is within the renewal lead window and call `pushRenew → pushRegister`. Gmail watch (7-day cap) is renewed daily at 04:00 UTC with default lead 24h. Microsoft subscriptions (~70h cap) are renewed every 2 h with default lead 4h.

## Prerequisites
- Connected Gmail channel AND Microsoft channel with `pushStatus='active'`.
- Ability to fast-forward the cron schedule or override `OM_PUSH_RENEWAL_*_LEAD_HOURS` to force eligibility.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Force Gmail channel's `channelState.watchExpirationMs` to `Date.now() + 1 hour`. | Daily cron eligibility achieved. |
| 2 | Trigger the daily cron (manually run `gmail-renew-watch` worker). | `pushRegister` called; `users.watch` re-issued; `watchExpirationMs` advanced ~7 days. |
| 3 | Force Microsoft channel's `subscriptionExpiresAt` to `now + 1 hour`. | Every-2h cron eligibility achieved. |
| 4 | Trigger `microsoft-renew-subscriptions`. | New `/subscriptions` POST; new `subscriptionId` + `subscriptionExpiresAt` ~70h ahead persisted. |
| 5 | Inspect `communication_channels.push.renewed` event log. | Two events emitted (one per channel). |

## Pass Criteria
- Both providers' push registrations stay live indefinitely without operator action.
- `push.renewed` events fire so observability dashboards track the renewal cadence.

## Fail Criteria
- Renewal cron fires but `users.watch` / subscription PATCH never called (the old bug).
- Renewal happens but `channelState` not updated → next tick thinks it's still expired and renews again.
