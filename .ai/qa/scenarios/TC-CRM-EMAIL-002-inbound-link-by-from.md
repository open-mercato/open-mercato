# Test Scenario: Inbound email auto-links to a CRM Person by From address

## Test ID
TC-CRM-EMAIL-002

## Category
CRM / Customers / Email / Inbound linking

## Priority
High

## Type
API Test (event-driven)

## Description
When the communication-channels hub records an inbound message and emits
`communication_channels.message.received`, the persistent
`customers:link-channel-message-received` subscriber resolves the CRM Person by
the message's From address and creates exactly one `CustomerInteraction`
(`interactionType='email'`, `author_user_id` = the channel owner,
`visibility='private'` for a user-owned channel, `externalMessageId` → the
`MessageChannelLink.id`) on that Person's timeline.

## Prerequisites
- Logged-in staff user with `customers.people.view`, `customers.people.manage`,
  `customers.interactions.view`, and `communication_channels.connect_user_channel`.
- The env-gated test fixture is enabled (`OM_ENABLE_TEST_CHANNEL_SEEDING=true`)
  so a connected channel + an inbound `MessageChannelLink` can be provisioned and
  the hub event emitted without a live mailbox.
- A Person with a known `primaryEmail`, a connected channel owned by the user.
  All fixtures created in setup, removed in teardown (no demo-data reliance).

## API Endpoint
`POST /api/communication_channels/test-seed` (action `emit-inbound`, env-gated)
→ subscriber → `GET /api/customers/interactions?entityId={personId}&interactionType=email`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create Person P with `primaryEmail = p@example.com`; seed a connected channel owned by the user. | Person + channel created. |
| 2 | Seed an inbound message with `from = p@example.com` and emit `communication_channels.message.received`. | Seed returns `{ channelLinkId, messageId }` (201). |
| 3 | Drain the `events` queue, then GET P's email interactions. | Exactly 1 interaction is returned. |
| 4 | Inspect the interaction. | `interactionType='email'`, `externalMessageId` = the seeded `channelLinkId`, `authorUserId` = the channel owner, `visibility='private'`. |

## Expected Results
- Exactly one email interaction is anchored to Person P.
- Authorship and visibility match the user-owned channel contract (private).

## Edge Cases / Error Scenarios
- Idempotency: re-delivering the same link must NOT create a duplicate (covered
  by the `(entity_id, external_message_id)` partial unique index).
- When the gate is off, the suite skips (a connected channel cannot be provisioned).
