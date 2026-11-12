# Test Scenario: Gmail Import History (Operator-Triggered Backlog)

## Test ID
TC-CHANNEL-EMAIL-032

## Category
Communications Hub / Channel-Gmail / Spec B § Phase B6

## Priority
High — Gmail is the most common connected mailbox, and a multi-year backfill is the main reason operators open the `Import history` dialog.

## Description
`GmailChannelAdapter.importHistory()` walks `users.messages.list?q=after:<epochSeconds>[ from:(… OR …)]` backwards with `labelIds: ['INBOX']`, routing every message through `ingest-inbound-message` and reporting progress on a `ProgressJob`. It is independent of incremental sync and MUST NOT read or advance `channelState.historyId`.

The route surface reachable without a live Google grant (auth, body validation, not-found) is automated in `packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-032.spec.ts`; query construction, sender chunking, cursor round-trip, pagination and the `maxMessages` cap are unit-tested in `lib/__tests__/adapter.test.ts`. This scenario covers the live end-to-end flow, which needs a real OAuth grant.

## Prerequisites
- A Gmail mailbox connected in `/backend/profile/communication-channels` with `status='connected'`.
- At least 20 INBOX messages older than 30 days from a known sender, plus at least one older message from the same sender that is archived (not in INBOX).
- One CRM Person whose `emails[]` includes the known sender's address.
- `yarn dev` running with `AUTO_SPAWN_WORKERS=true` so the `channel-import-history` worker is live.

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open `/backend/profile/communication-channels` and open the Gmail channel's row menu. | The menu offers `Import history` (shown only for an active, connected email channel). |
| 2 | Open `Import history`, set `Look back (days)` to `1825`, enter the known sender in `Filter by sender`, and submit with `⌘ + Enter`. | `POST /api/communication_channels/channels/<id>/import-history` returns `202 { ok: true, progressJobId, totalCountHint }`; the flash reads "History import queued — track progress in the top bar." |
| 3 | Watch the `ProgressTopBar`. | A job `Import history: <channel name>` advances and transitions to `completed`. |
| 4 | Open the Person page for the known sender. | The imported INBOX messages appear on the timeline as email interactions. |
| 5 | Look for the archived message from the prerequisites. | It is NOT imported — history import is scoped to `INBOX` only. |
| 6 | Send no new mail and trigger no poll while the import runs; compare `channelState.historyId` in the channel's `channel_state` column before step 2 and after step 3. | Unchanged — the backlog sweep never moves the incremental-sync cursor (incremental sync legitimately advances it when new mail arrives, so keep the mailbox quiet during this check). |
| 7 | Re-run steps 2–3 with the same parameters. | The job completes; no duplicate timeline entries appear (idempotent ingest on `(channel_id, external_message_id)`). |

## Pass Criteria
- Steps 2–4: messages in the window are imported and linked to the Person.
- Step 5: archived mail outside `INBOX` is not swept.
- Steps 6–7: the incremental cursor is untouched and a re-run creates no duplicates.

## Fail Criteria
- The route answers 400 "History import is not supported on this provider" for a `gmail` channel.
- `channelState.historyId` changes as a result of the import.
- A re-run creates duplicate `MessageChannelLink` or timeline rows.
