# Test Scenario: Inbound email auto-links across From + To + Cc (3 People)

## Test ID
TC-CRM-EMAIL-003

## Category
CRM / Customers / Email / Inbound linking

## Priority
High

## Type
API Test (event-driven)

## Description
A single inbound message whose From/To/Cc addresses match three distinct CRM
People must create exactly one `CustomerInteraction` per matched Person (three
total), each anchored to its own Person timeline and all referencing the same
source `MessageChannelLink.id`. This proves the link subscriber resolves People
across all address fields (From, To, Cc) — not just the sender.

## Prerequisites
- Logged-in staff user with `customers.people.view`, `customers.people.manage`,
  `customers.interactions.view`, and `communication_channels.connect_user_channel`.
- `OM_ENABLE_TEST_CHANNEL_SEEDING=true` (env-gated inbound seeding fixture).
- Three People A/B/C with distinct `primaryEmail`s, a connected channel owned by
  the user. All fixtures created in setup, removed in teardown.

## API Endpoint
`POST /api/communication_channels/test-seed` (action `emit-inbound`)
→ subscriber → `GET /api/customers/interactions?entityId={personId}&interactionType=email`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create People A (`a@…`), B (`b@…`), C (`c@…`); seed a connected channel. | People + channel created. |
| 2 | Seed an inbound message with `from=a@…`, `to=[b@…]`, `cc=[c@…]` and emit `message.received`. | Seed returns `{ channelLinkId }` (201). |
| 3 | Drain the `events` queue. | The link subscriber runs. |
| 4 | GET email interactions for each of A, B, C. | Each Person has exactly 1 email interaction; all three reference the same `channelLinkId`. |

## Expected Results
- Three interactions created — one per matched Person.
- All three share the same source link id (one inbound message, three anchors).

## Edge Cases / Error Scenarios
- Duplicate addresses across fields must not create duplicate interactions for
  the same Person.
- When the gate is off, the suite skips.
