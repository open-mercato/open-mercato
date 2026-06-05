# Test Scenario: IMAP Incremental Ingest Within 90s

## Test ID
TC-CHANNEL-EMAIL-022

## Category
Communications Hub / Channel-IMAP / Polling

## Priority
High

## Description
After bootstrap (TC-021), the polling worker fetches new messages via `UID FETCH previousUidNext:*` capped at `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL` (default 200). New mail is ingested within ~90 s (one 60s tick + worker drain).

## Prerequisites
- IMAP channel bootstrapped (TC-021 prerequisite).
- `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL` default (200) or lower for the test.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Send a single email to the IMAP address. | Within 60–90s the message appears on the unified inbox + Person timeline. |
| 2 | Send 250 emails in a burst (above HARD_CAP). | First tick ingests 200 messages, `hasMore: true` flag triggers immediate re-enqueue, second tick ingests the remaining 50. |
| 3 | Inspect the channel row's `channelState.uidNext`. | Advanced past every ingested UID. |

## Pass Criteria
- Step 1 latency under 90 s.
- Step 2: HARD_CAP respected; backlog drained within ~3 polls.

## Fail Criteria
- Step 1 misses the message or takes >2 minutes.
- Step 2 ingests >200 in a single poll (HARD_CAP violation) OR drops messages.
