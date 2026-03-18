# Test Scenario 002: Inbox Open Mark Read And Mark Unread

## Test ID
TC-MSG-002

## Category
Messages

## Priority
High

## Type
UI Test

## Description
Validates recipient inbox behavior when opening an unread message and toggling its read state.

## Prerequisites
- One message exists addressed to `employee` with status `unread`
- User is logged in as `employee`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `/backend/messages` with `Inbox` selected | Unread message appears in list |
| 2 | Open the unread message from the table | Message detail page loads |
| 3 | Verify actions section header controls | `Mark unread` button is visible for currently read detail |
| 4 | Click `Mark unread` | Button changes to `Mark read` and state updates without full page reload |
| 5 | Click `Back to messages`, filter by `Status = Unread` | Same message appears in filtered results |

## Expected Results
- Opening detail changes recipient state to read
- Manual toggle to unread works from detail page
- List filters reflect updated message state

## Edge Cases / Error Scenarios
- If state API fails, flash `Failed to update message state.` is shown
