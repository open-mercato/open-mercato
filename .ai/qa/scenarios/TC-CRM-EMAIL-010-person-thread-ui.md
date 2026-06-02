# Test Scenario: CRM Person Email Thread UI (Gmail-style)

## Test ID
TC-CRM-EMAIL-010

## Category
CRM / Customers / Person detail / Email threads

## Priority
High

## Description
The CRM Person detail page exposes an **Emails** tab that packages the person's
emails into conversations like Gmail: a thread list on the left and a
scrollable conversation on the right. The user can start a new thread or reply
to an existing thread (the reply joins the same conversation). The tab is driven
by `GET /api/customers/people/[id]/email-threads` and the reusable
`EmailThreadsPanel` (`@open-mercato/ui/backend/messages`).

## Prerequisites
- Logged-in staff user with `customers.people.view` and `customers.email.compose`.
- A Person record in the active organization.
- (Data-driven steps) At least one user-owned `CommunicationChannel` with
  `status='connected'`, plus seeded `Message` + `MessageChannelLink` rows in two
  threads and matching `CustomerInteraction` (`interactionType='email'`,
  `externalMessageId` → link id) anchored to the Person. Fixtures are created in
  test setup and removed in teardown (no reliance on demo data).

## Test Steps

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open `/backend/customers/people/{id}` and locate the tab bar. | An **Emails** tab is present alongside Notes/Activities/Deals/Addresses/Tasks. |
| 2 | With NO email interactions for the person, click **Emails**. | The panel renders the empty state ("No emails yet"). `GET …/email-threads` returns `200 { threads: [] }`. No console errors. |
| 3 | With NO connected channel, observe the toolbar. | A "Connect your mailbox" link to `/backend/profile/communication-channels` is shown; the **New email** / **Reply** buttons are hidden. |
| 4 | With a connected channel + seeded threads, click **Emails**. | Thread list shows one row per conversation (subject, participants, last time, message count). Newest conversation first. |
| 5 | Click a thread in the list. | The right pane shows every message in the thread, oldest→newest, with inbound vs outbound distinguished and From/To + timestamps. |
| 6 | Click **New email**, fill recipient/subject/body, pick a sending account, submit (Cmd/Ctrl+Enter). | Dialog posts to `POST /api/customers/people/{id}/emails`; flash "Email sent"; thread list refreshes after the worker settles. |
| 7 | Open a thread and click **Reply**. | Compose dialog opens pre-filled (To = thread counterpart, subject = "Re: …"); on send, the request includes `parentMessageId` so the reply joins the same `threadId` and appears in the same conversation (not a new one). |
| 8 | While the tab is open, simulate an inbound email linked to the person (fire `customers.email.linked` / `communication_channels.message.received`). | The thread list live-refreshes (via `useAppEvent`) without a manual reload. |

## Pass Criteria
- Emails tab present and renders without console/network errors (Steps 1–2).
- Empty + no-channel states render correctly (Steps 2–3).
- Threads are grouped by conversation and ordered most-recent-first (Step 4).
- Conversation view shows all messages chronologically with direction + headers (Step 5).
- New email and Reply both send successfully; Reply continues the existing thread (Steps 6–7).
- Live refresh updates the list on inbound arrival (Step 8).

## Fail Criteria
- No Emails tab, or the tab throws / shows a blank pane.
- Threads not grouped (each message shown as its own "thread"), or wrong ordering.
- Reply starts a new thread instead of continuing the existing one.
- Private emails authored by another user are visible to a non-admin viewer.

## Notes
- Backend threading (token embed + 5-layer matcher + push/poll delivery) is
  covered by `TC-CHANNEL-EMAIL-021..030` and `…-A0x/C0x`. This scenario covers
  only the CRM Person-page presentation + compose/reply wiring.
- HTML-body rendering is out of scope for v1 (bodies are shown as text); revisit
  when a sanitized HTML renderer ships.
