# Test Scenario: Microsoft `reauthorizationRequired` → `requires_reauth`

## Test ID
TC-CHANNEL-EMAIL-C04

## Category
Communications Hub / Channel-Microsoft / OAuth lifecycle / Spec C § Phase C3

## Priority
High

## Description
When a user revokes OAuth consent, or scopes are narrowed, Graph emits a `reauthorizationRequired` lifecycle event. The hub flips the channel to `status='requires_reauth'`, sets `channelState.pushStatus='inactive'`, and emits `communication_channels.channel.requires_reauth` so the operator-facing notification fires.

## Prerequisites
- Connected Microsoft channel with `pushStatus='active'`.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Revoke the Open Mercato app's permission in the Microsoft tenant (admin → Enterprise Apps → Permissions → Remove). | Within hours Graph emits `reauthorizationRequired` to the lifecycle webhook. |
| 2 | Channel row: `status='requires_reauth'`, `pushStatus='inactive'`, `lastError='microsoft_lifecycle_reauth_required'`. | Confirmed. |
| 3 | UI surfaces the reconnect prompt; the user reconnects via the OAuth flow. | New subscription created; `pushStatus` flips back to `active`. |

## Pass Criteria
- Status flip happens automatically (no operator intervention).
- Reconnect re-registers push.

## Fail Criteria
- Channel stays `connected` while OAuth is revoked (notifications keep failing).
