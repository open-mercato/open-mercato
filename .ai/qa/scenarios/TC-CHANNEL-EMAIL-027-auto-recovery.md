# Test Scenario: Auto-Recovery from `status='error'`

## Test ID
TC-CHANNEL-EMAIL-027

## Category
Communications Hub / Polling / Spec B § Phase B5

## Priority
High — operators expect transient outages to self-heal.

## Description
When a channel's poll fails (network blip, IMAP timeout, transient 5xx), `poll-channel.ts` flips `status='error'` and records `lastFailureAt`. The `poll-tick.ts` scheduler enumerates two pools each tick: (a) connected + due, (b) error-state + aged past `OM_CHANNEL_AUTO_RECOVER_MINUTES` (default 30). A successful poll in pool (b) flips status back to `connected` automatically — no manual reconnect needed.

## Prerequisites
- A connected IMAP channel.
- Ability to simulate a transient failure (briefly drop the IMAP server, set wrong port, etc.).

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Trigger a transient failure (drop IMAP for one poll cycle). | Channel goes to `status='error'`, `lastError` populated. |
| 2 | Restore IMAP. Wait 30 minutes (or set `OM_CHANNEL_AUTO_RECOVER_MINUTES=0` for the test). | Next tick re-enqueues the channel; poll succeeds; status flips back to `connected`. |
| 3 | Verify `lastFailureAt` is null + `lastError` cleared on success. | Confirmed. |
| 4 | Trigger a PERMANENT error (delete the credentials row). | Channel stays in `status='error'`; auto-recovery retries every 30 min but each fails. |
| 5 | Permanent errors should NOT spam — observe the 30-min cadence in pool (b). | Each retry separated by ≥30 min. |

## Pass Criteria
- Transient errors self-heal without operator action within 30 min.
- Permanent errors retry at the bounded 30-min cadence (no thundering herd).

## Fail Criteria
- Self-heal never fires.
- Auto-recovery retries on every tick (60s) instead of every 30 min.
