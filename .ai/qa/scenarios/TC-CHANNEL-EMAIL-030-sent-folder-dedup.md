# Test Scenario: Sent-Folder Dedup

## Test ID
TC-CHANNEL-EMAIL-030

## Category
Communications Hub / Ingest / Spec B § Phase B3

## Priority
Medium — prevents duplicate inbound rows when IMAP polls the Sent folder.

## Description
`ingest-inbound-message.ts` short-circuits when the inbound message's `messageId` matches an outbound `MessageChannelLink.channelMetadata.messageId` we already sent. Without this guard, IMAP polls of the Sent folder would create duplicate inbound rows for every outbound the user sent (some servers surface the Sent folder in INBOX-like listings).

## Prerequisites
- IMAP mailbox that surfaces sent items in pollable folders, OR a mock that surfaces an outbound's own message id back to the worker.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Send an outbound email via `/backend/customers/people/<id>` → "Send email". | One `MessageChannelLink` with `direction='outbound'` is created. |
| 2 | Force the IMAP poll to surface that message id back via the inbound path. | Ingest detects the existing outbound link by `messageId` and SKIPs it. No new inbound `MessageChannelLink` is created. |
| 3 | Inspect `message_channel_links` for the offending `messageId`. | Exactly ONE row (the original outbound). |

## Pass Criteria
- Step 3: no duplicates.

## Fail Criteria
- A second `MessageChannelLink` is created with `direction='inbound'` for the outbound's own message id.
