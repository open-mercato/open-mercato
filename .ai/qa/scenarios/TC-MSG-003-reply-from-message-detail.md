# Test Scenario 003: Reply From Message Detail

## Test ID
TC-MSG-003

## Category
Messages

## Priority
High

## Type
UI Test

## Description
Validates replying to an existing message from detail view and preserving thread context.

## Prerequisites
- Existing message thread with at least one sent message
- User is logged in as a recipient with permission to reply

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `/backend/messages/{id}` for a reply-enabled message type | Detail page shows `Reply` action |
| 2 | Click `Reply` | Reply composer dialog opens |
| 3 | Enter reply text and submit via `Send` | Success flash `Reply sent.` is shown |
| 4 | Stay on or return to detail page | Thread section includes new reply item |
| 5 | Verify sender/date metadata in thread row | New row shows current user and timestamp |

## Expected Results
- Reply message is created from UI
- Reply is linked to the same thread and visible in thread timeline
- User feedback confirms successful send

## Edge Cases / Error Scenarios
- Empty reply body shows `Please enter a message.`
