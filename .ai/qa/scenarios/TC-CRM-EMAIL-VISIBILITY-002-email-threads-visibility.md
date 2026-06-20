# Test Scenario: Per-email visibility on the Person Emails tab (/email-threads)

## Test ID
TC-CRM-EMAIL-VISIBILITY-002

## Category
CRM / Customers / Email / Visibility

## Priority
High

## Type
API Test

## Description
The CRM Person Emails tab calls `GET /api/customers/people/[id]/email-threads`
(thread builder: `lib/personEmailThreads.ts`). This guards the fix that wired
`buildEmailVisibilityMikroFilter` into the thread builder, so the Emails tab
applies the SAME per-email visibility rule as `GET /api/customers/interactions`:

- `visibility='shared'` email is visible to EVERY user with CRM access to the Person,
- `visibility='private'` email is visible ONLY to its author (the mailbox owner),
- there is NO admin bypass in v1 — `customers.email.view_private` is inert,
- legacy `visibility IS NULL` rows stay visible.

This is the exact read path that leaked private emails before the fix, so this
scenario is the regression guard.

## Prerequisites
- `OM_ENABLE_TEST_CHANNEL_SEEDING=true` (the threads only render when an
  interaction's `externalMessageId` resolves to a real `MessageChannelLink`, so
  the emails are produced by composing through the real outbound chain).
- Three users in the active org:
  - User A — author of both emails (owns a connected channel),
  - User B — teammate with `customers.people.view` + `customers.interactions.view`, NO `view_private`,
  - Admin user — same as B PLUS `customers.email.view_private`.
- A Person, a connected channel owned by A. All fixtures created in setup,
  removed in teardown.

## API Endpoint
`GET /api/customers/people/{personId}/email-threads`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | As User A, compose a SHARED email to the Person; drain outbound + events queues. | A `CustomerInteraction` with `visibility='shared'`, `author=A`, linked to a real `MessageChannelLink`. |
| 2 | As User A, compose a PRIVATE email to the Person; drain queues. | A `CustomerInteraction` with `visibility='private'`, `author=A`, linked to a real `MessageChannelLink`. |
| 3 | GET `/email-threads` as User A and collect the message (link) ids. | Both the shared and the private link ids are present. |
| 4 | GET `/email-threads` as User B (teammate, no view_private). | The shared link id IS present; the private link id is ABSENT. |
| 5 | GET `/email-threads` as the Admin user (holds view_private). | The shared link id IS present; the private link id is STILL ABSENT (v1 has no admin bypass). |

## Expected Results
- A shared email authored by A appears for A, B, and the admin.
- A private email authored by A appears ONLY for A.
- `customers.email.view_private` grants no read bypass in v1.

## Edge Cases / Error Scenarios
- An API-key caller (no user id) must never match the author arm — sees only
  shared/legacy rows.
- This mirrors the `/interactions`, `/people/[id]?include=interactions`, and
  `/interactions/counts` coverage in TC-CRM-EMAIL-VISIBILITY-001; this scenario
  adds the Emails-tab (`/email-threads`) read path specifically.
