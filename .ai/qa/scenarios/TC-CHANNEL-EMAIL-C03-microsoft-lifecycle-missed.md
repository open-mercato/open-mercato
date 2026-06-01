# Test Scenario: Microsoft Graph Lifecycle `missed` Triggers Catch-Up Delta

## Test ID
TC-CHANNEL-EMAIL-C03

## Category
Communications Hub / Channel-Microsoft / Push reliability / Spec C § Phase C3

## Priority
High — without catch-up, missed notifications mean lost mail.

## Description
When Microsoft Graph drops one or more change notifications (our webhook returned non-2xx, or there was a Graph-side blip), Graph emits a `missed` lifecycle event. Our `microsoft/[subscriptionId]/lifecycle` handler enqueues a `microsoft-delta-sync` job to catch up via `/me/messages/delta` from the stored `deltaLink`.

## Prerequisites
- Connected Microsoft channel with `pushStatus='active'`.
- Ability to inject a lifecycle POST OR simulate by briefly returning 500 from the notification webhook to make Graph mark notifications as missed.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Cause webhook to fail temporarily (e.g. block requests). | Graph eventually emits a `missed` lifecycle event. |
| 2 | Lifecycle endpoint accepts the POST (clientState validates). | Handler enqueues `microsoft-delta-sync` job; returns 202. |
| 3 | Worker pulls `/me/messages/delta` and ingests any missed messages. | All previously-missed messages appear in CRM within ~30s. |

## Pass Criteria
- No mail is permanently lost across a missed-notification incident.

## Fail Criteria
- Lifecycle webhook rejects the event or 500s.
- `microsoft-delta-sync` worker never runs.
