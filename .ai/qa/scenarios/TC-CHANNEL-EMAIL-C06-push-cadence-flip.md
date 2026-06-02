# Test Scenario: Push Active → Polling Cadence Flips to 30 min

## Test ID
TC-CHANNEL-EMAIL-C06

## Category
Communications Hub / Push delivery / Spec C § Phase C5

## Priority
Medium — verifies the polling fallback contract.

## Description
When `adapter.registerPush(...)` returns `status: 'active'`, `pushRegister` persists `pollIntervalSeconds = recommendedPollIntervalSeconds` (1800 = 30 min). This keeps a belt-and-suspenders polling cadence running so if push goes silent for any reason, mail is at most 30 min late instead of indefinitely lost. When push fails (`pushStatus='failed'`), `pollIntervalSeconds` stays at the default 60s.

## Prerequisites
- Test Gmail channel.
- `OM_GMAIL_PUBSUB_TOPIC` properly configured.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Connect Gmail (auto-registers push via Spec C § GAP-3 wiring) OR click "Re-register push". | `pushStatus='active'` and `pollIntervalSeconds=1800` persisted. |
| 2 | Misconfigure the Pub/Sub topic (revoke publisher grant) and re-register. | `pushStatus='failed'`; `pollIntervalSeconds` stays at the previous value (or reverts to 60 if no prior value). |
| 3 | Verify polling fallback runs at 60s cadence when push failed. | Channel keeps ingesting mail (just slower). |
| 4 | Fix the misconfiguration and click "Re-register push". | Status flips back to active; cadence returns to 1800. |

## Pass Criteria
- Active push: 30-min polling (cost reduction).
- Failed push: 60s polling (no data loss).
- Re-register recovers seamlessly.

## Fail Criteria
- Failed-push state still polls at 30 min (mail late).
- Active-push state still polls at 60s (cost not reduced).
