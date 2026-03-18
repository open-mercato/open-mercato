# Test Scenario 004: Forward Message With Attachments

## Test ID
TC-MSG-004

## Category
Messages

## Priority
Medium

## Type
UI Test

## Description
Validates forwarding a message to another recipient while keeping original attachments when `Include attachments` is enabled.

## Prerequisites
- Existing message contains at least one attachment
- User is logged in as a recipient allowed to forward this message type
- A valid forward recipient exists

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open message detail with attachments | Attachment list is visible |
| 2 | Click `Forward` | Forward composer dialog opens |
| 3 | Ensure `Include attachments` is enabled and add recipient | Recipient selection is accepted |
| 4 | Enter optional forward note and click `Send` | Success flash `Message forwarded.` is shown |
| 5 | Open newly created forwarded message detail | Attachments section lists forwarded files |

## Expected Results
- Forwarded message is sent successfully
- Original attachments are carried into forwarded message when enabled
- New detail page reflects forwarded content and files

## Edge Cases / Error Scenarios
- Sending forward with no recipients shows `Please add at least one recipient.`
