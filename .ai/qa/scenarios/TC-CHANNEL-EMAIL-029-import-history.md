# Test Scenario: Import Channel History (Operator-Triggered Backlog)

## Test ID
TC-CHANNEL-EMAIL-029

## Category
Communications Hub / Channel-IMAP / Operator UX

## Priority
High — primary demo path for "We can't scan a new user's 1M-message inbox on connect."

## Description
Verify that the explicit `Import history` dialog on `/backend/profile/communication-channels` pulls older messages from a connected IMAP channel and reports progress via the existing `ProgressTopBar`, per Spec B § Phase B6 ([`.ai/specs/2026-05-27-email-integration-inbound-reliability-and-threading.md`](../../specs/2026-05-27-email-integration-inbound-reliability-and-threading.md)).

The route, command, worker, IMAP adapter `importHistory()`, and concurrency guard are covered by unit tests; this scenario exercises the live end-to-end flow against a real (or dockerised) IMAP server.

## Prerequisites
- A working IMAP account with at least 50 messages older than 30 days from a known sender.
- The IMAP channel is connected in `/backend/profile/communication-channels` and shows `status='connected'`.
- Logged-in user has features `communication_channels.view`, `communication_channels.manage`, and `communication_channels.channel.import_history`.
- One CRM Person exists whose `emails[]` includes the known sender's address (so the inline-linking path runs).
- `yarn dev` is running with `AUTO_SPAWN_WORKERS=true` so the `channel-import-history` queue worker is live.

## Test Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `/backend/profile/communication-channels`. | The IMAP channel row shows `Import history` button enabled. |
| 2 | Click `Import history`. | A dialog opens titled "Import channel history" with three fields: `Look back (days)` (default 30), `Filter by sender` (empty), `Maximum messages` (default 500). Footer shows `⌘ + Enter` shortcut hint. |
| 3 | Press `Escape`. | Dialog closes; no request is sent. |
| 4 | Re-open the dialog, set `Look back (days)` to `400`. | Inline validation message: "Choose a number between 1 and 365 days." Submit button proceeds only after correcting the value. |
| 5 | Enter `90` for look-back, `bob@example.com` (the known sender) for sender filter, leave max at 500, press `⌘ + Enter`. | Dialog closes; flash message: "History import queued — track progress in the top bar." `ProgressTopBar` shows a running job titled `Import history: <channel name>`. |
| 6 | Wait up to 60 seconds (typical), or longer for large mailboxes. | `ProgressTopBar` advances; counter reaches the discovered candidate count (≤500); job transitions to `completed`. |
| 7 | Open the Person page for the contact whose address matches `bob@example.com`. | Timeline shows the imported emails as `customer_interactions` entries with type `email`. |
| 8 | Click `Import history` again immediately. Enter the same params and submit. | Either the dialog returns a 429 "Another history import is already running" alert (if the job is still mid-flight) OR succeeds (if step 6 already finished). |
| 9 | Kill the queue worker process mid-import (deliberately, on a fresh run). Restart it. | The first job transitions to `failed` (stale-job sweep within 60 s). The operator can re-trigger; new run completes normally. No duplicates appear on the Person timeline (idempotent ingest via `(channel_id, external_message_id)` unique). |
| 10 | Open the worker logs. | No `Permanent ingest failure` lines for valid MIME; any present rows in `channel_ingest_dead_letter` were already malformed. Cursor never re-scans the same UID set after a successful page. |

## Pass Criteria
- Step 5 returns `{ ok: true, progressJobId: <uuid> }` from `POST /api/communication_channels/channels/<id>/import-history`.
- Step 6 ProgressJob `processedCount` reflects how many messages were actually ingested.
- Step 7 imported messages appear on the Person timeline within seconds of job completion.
- Step 8 returns HTTP 429 with `fieldErrors.channelId: "Another history import is already running"` when overlap exists.
- Step 9 demonstrates the worker is idempotent on retry.

## Fail Criteria
- The route returns 500 or a generic "queue error" before the worker starts.
- The ProgressTopBar never updates `processedCount` despite messages arriving in the timeline.
- Duplicate `customer_interactions` rows appear after a retry.
- The dialog accepts `sinceDays > 365` or `maxMessages > 5000` without validation.

## Notes
- Spec B's `importHistory` returns `totalCandidates` on the first page so the operator sees an accurate progress bar from the first update. Verify that the bar's denominator matches the IMAP SEARCH result count, not the static `maxMessages` cap.
- The dialog uses `router.refresh()` after queueing (no `window.location.reload()` per `.ai/lessons.md`).
- Gmail adapter does NOT yet implement `importHistory`; the dialog must show the `Import history` button disabled for those providers (Spec C will wire them).

## Related Tests
- TC-CHANNEL-EMAIL-021..028 (incremental polling, threading, auto-recovery — Phase B1..B5)
- TC-CHANNEL-EMAIL-030 (sent-folder dedup — Phase B3)
