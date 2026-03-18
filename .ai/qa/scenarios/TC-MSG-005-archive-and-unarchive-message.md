# Test Scenario 005: Archive And Unarchive Message

## Test ID
TC-MSG-005

## Category
Messages

## Priority
Medium

## Type
UI Test

## Description
Validates archiving a message from detail view and restoring it from archived state.

## Prerequisites
- Recipient user has at least one non-archived message
- User is logged in as the message recipient

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open message detail page | `Archive` action is visible |
| 2 | Click `Archive` | Button state switches to `Unarchive` |
| 3 | Return to list and switch folder to `Archived` | Message appears in archived folder |
| 4 | Open archived message and click `Unarchive` | Message state toggles back from archived |
| 5 | Return to `Inbox` folder | Message no longer appears in archived-only list |

## Expected Results
- Archive/unarchive transitions are available in UI
- Folder segmentation reflects recipient archival state

## Edge Cases / Error Scenarios
- If archive endpoint fails, user sees `Failed to update message state.`
