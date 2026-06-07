# Test Scenario: Threading inheritance links a reply from an unknown address

## Test ID
TC-CRM-EMAIL-005

## Category
CRM / Customers / Email / Inbound linking / Threading

## Priority
High

## Type
API Test (event-driven)

## Description
A reply that arrives from an address matching no CRM Person is still anchored to
the original Person's timeline because it shares the hub message thread
(`messages.thread_id`) with the original email. The link subscriber's hub-thread
inheritance join (thread → existing email interaction in that thread) resolves
the Person even though direct address matching fails. This is the dependable
join when tenant data encryption defeats plaintext address matching and when
providers rewrite RFC Message-IDs.

## Prerequisites
- Logged-in staff user with `customers.people.view`, `customers.people.manage`,
  `customers.interactions.view`, and `communication_channels.connect_user_channel`.
- `OM_ENABLE_TEST_CHANNEL_SEEDING=true` (env-gated inbound seeding fixture; the
  fixture accepts a `messageThreadId` so two seeded messages can share a thread).
- A Person P with a known `primaryEmail` and a connected channel owned by the
  user. Fixtures created in setup, removed in teardown.

## API Endpoint
`POST /api/communication_channels/test-seed` (action `emit-inbound`, with
`messageThreadId`) → subscriber → `GET /api/customers/interactions?entityId={personId}&interactionType=email`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create Person P (`p@example.com`) and a connected channel; generate a thread id `T`. | Created. |
| 2 | Seed inbound #1 `from=p@example.com`, `messageThreadId=T`, emit `message.received`; drain `events`. | One interaction is linked to P (address match); it references link #1. |
| 3 | Seed inbound #2 `from=stranger@nowhere.invalid` (unknown), same `messageThreadId=T`, `inReplyTo` = #1's Message-ID; emit `message.received`; drain `events`. | The reply is linked to P **via thread inheritance** even though its sender is unknown. |
| 4 | GET P's email interactions. | Exactly 2 interactions; one references link #1, the other references link #2 (the reply). |

## Expected Results
- The unknown-sender reply inherits P from the shared hub thread.
- P's timeline shows both the original and the reply.

## Edge Cases / Error Scenarios
- A reply on a thread with no prior linked interaction must NOT create an
  interaction (no Person to inherit) — see the no-match case (TC-CRM-EMAIL-004).
- When the gate is off, the suite skips.
