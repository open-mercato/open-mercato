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
| 3 | Verify actions section header controls | `Mark unread` action is visible for currently read detail |
| 4 | Click `Mark unread` | App returns to the inbox list automatically (Gmail-style) so auto-mark-read cannot re-mark the message |
| 5 | Filter the inbox by `Status = Unread` | The same message appears in filtered results and is still unread |

## Expected Results
- Opening detail changes recipient state to read
- Marking unread from the detail page redirects back to the inbox (#3576)
- The message stays unread after returning to the inbox — the page-level auto-mark-read does not silently undo the action
- List filters reflect updated message state

## Edge Cases / Error Scenarios
- If state API fails, flash `Failed to update message state.` is shown
