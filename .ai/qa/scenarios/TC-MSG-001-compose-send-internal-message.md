# Test Scenario 001: Compose And Send Internal Message

## Test ID
TC-MSG-001

## Category
Messages

## Priority
High

## Type
UI Test

## Description
Validates that an internal user can compose a message to another internal user and is redirected to the message detail after successful send.

## Prerequisites
- User is logged in as `admin`
- At least one additional active user exists (recipient)
- Messages module is enabled for the organization

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `/backend/messages` and click `Compose message` | Compose form is visible |
| 2 | Fill `To`, `Subject`, and `Message` fields | Form values are accepted |
| 3 | Click `Send` (or use `Cmd/Ctrl+Enter`) | Success flash `Message sent.` is shown |
| 4 | Observe post-submit navigation | User is redirected to `/backend/messages/{id}` |
| 5 | Click `Back to messages` | New message is visible in `Sent` folder |

## Expected Results
- Message is created and sent from UI
- User sees a success state and lands on detail page
- Sent item appears in sender history

## Edge Cases / Error Scenarios
- Missing recipients shows `Please add at least one recipient.`
- Missing subject shows `Please enter a subject.`
- Missing body shows `Please enter a message.`
