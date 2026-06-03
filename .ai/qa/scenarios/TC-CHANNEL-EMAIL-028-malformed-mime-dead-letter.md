# Test Scenario: Malformed MIME → Dead-Letter, Cursor Still Advances

## Test ID
TC-CHANNEL-EMAIL-028

## Category
Communications Hub / Ingest reliability / Spec B § Phase B4

## Priority
High — prevents one bad message from stalling all subsequent inbound on a channel.

## Description
`poll-channel.ts` classifies per-message ingest failures: transient (DB blip, network) aborts the loop without advancing the cursor; permanent (malformed MIME, schema violation) writes the raw payload to `ChannelIngestDeadLetter` (encrypted at rest via `defaultEncryptionMaps`) and advances the cursor anyway. Future polls skip past the bad message.

## Prerequisites
- A test IMAP fixture that lets you inject malformed MIME alongside well-formed messages.
- DB access to inspect `channel_ingest_dead_letters`.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Inject 3 messages into INBOX: well-formed, malformed (truncated headers), well-formed. UIDs 100, 101, 102. | Poll cycle ingests UIDs 100 + 102 normally. UID 101 writes a `channel_ingest_dead_letters` row with `error_class`, `error_message`, encrypted `raw_body`. |
| 2 | Check `channelState.uidNext`. | Advanced past 102 (NOT stuck at 101). |
| 3 | Trigger another poll. | UID 101 is NOT re-ingested (cursor moved past). |
| 4 | Query the dead-letter row via SQL + decrypt `raw_body`. | Truncated to ≤32 KB; encrypted at rest. |

## Pass Criteria
- Step 1: 2 messages ingested, 1 dead-lettered.
- Step 2: cursor advanced past all 3.
- Step 4: raw body encrypted (NOT visible to plain SELECT).

## Fail Criteria
- Cursor stuck at the malformed message (would stall the channel forever).
- Dead-letter row written in plaintext.
