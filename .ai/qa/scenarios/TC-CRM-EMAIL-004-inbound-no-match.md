# Test Scenario: Inbound email with no matching Person creates zero interactions

## Test ID
TC-CRM-EMAIL-004

## Category
CRM / Customers / Email / Inbound linking

## Priority
Medium

## Type
API Test (event-driven)

## Description
An inbound message whose From/To/Cc addresses match no CRM Person (and that
carries no `crmPersonId` hint and no threading references) must NOT create any
`CustomerInteraction`. The email is still persisted as a platform message (it
lands in the Messages inbox) — it simply is not anchored to any CRM timeline.

## Prerequisites
- Logged-in staff user with `customers.people.view`, `customers.people.manage`,
  `customers.interactions.view`, and `communication_channels.connect_user_channel`.
- `OM_ENABLE_TEST_CHANNEL_SEEDING=true` (env-gated inbound seeding fixture).
- One known Person whose address is deliberately NOT referenced by the inbound
  message, and a connected channel owned by the user. Fixtures created in setup,
  removed in teardown.

## API Endpoint
`POST /api/communication_channels/test-seed` (action `emit-inbound`)
→ subscriber → `GET /api/customers/interactions?entityId={personId}&interactionType=email`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create a known Person P and a connected channel. | Created. |
| 2 | Seed an inbound message with From/To addresses that match nobody (`@nowhere.invalid`) and emit `message.received`. | Seed returns a non-null `messageId` (the message row exists). |
| 3 | Drain the `events` queue (twice, with a small gap). | The link subscriber runs and finds no match. |
| 4 | GET email interactions for Person P. | Exactly 0 interactions. |

## Expected Results
- No `CustomerInteraction` is created for an unmatched inbound message.
- The underlying platform message still exists (inbox is unaffected).

## Edge Cases / Error Scenarios
- A late/duplicate delivery must still produce zero CRM interactions.
- When the gate is off, the suite skips.
