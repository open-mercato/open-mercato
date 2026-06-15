# Test Scenario: IMAP Zero-History Bootstrap

## Test ID
TC-CHANNEL-EMAIL-021

## Category
Communications Hub / Channel-IMAP / Cursor management

## Priority
High — fixes the "we can't scan a new user's 1M-message inbox on connect" failure mode by construction.

## Description
A freshly-connected IMAP channel fetches **zero** historical messages: the worker persists the mailbox's `UIDVALIDITY` + `UIDNEXT` and returns immediately. From the next tick onward, polling is incremental against the stored cursor (Spec B § Phase B4).

## Prerequisites
- A working IMAP mailbox with at least 100 existing messages.
- The channel has not yet been connected (or has been disconnected and a fresh row will be created).
- Logged-in user with `communication_channels.connect_user_channel`.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Connect the IMAP channel via `/backend/profile/communication-channels`. | Channel row appears with `status='connected'`. |
| 2 | Wait for one poll cycle (60s) OR click "Poll now". | Channel processes ZERO messages; `channelState.uidValidity` + `channelState.uidNext` are populated. |
| 3 | Check Person timelines for any of the 100 pre-existing messages. | None of them are present — the bootstrap intentionally skipped them. |
| 4 | Send a new email to the mailbox. | Next poll picks it up (within ~60s). Verify `channelState.uidNext` advanced past the new message's UID. |

## Pass Criteria
- Step 2 result: 0 messages ingested on the first poll, cursor persisted.
- Step 4 result: new mail arrives within ~60s of being sent.

## Fail Criteria
- Step 2 ingests pre-existing history (defeats the bootstrap fix).
- Step 4 misses the new message (cursor didn't advance).

## Related Tests
- TC-CHANNEL-EMAIL-022 (incremental polling)
- TC-CHANNEL-EMAIL-029 (operator-triggered backfill via Import History)
