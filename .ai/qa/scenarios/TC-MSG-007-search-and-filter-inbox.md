# Test Scenario 007: Search And Filter Inbox

## Test ID
TC-MSG-007

## Category
Messages

## Priority
Medium

## Type
UI Test

## Description
Validates inbox search and filter controls (`status`, `type`, `attachments`, `actions`) on the messages listing page.

## Prerequisites
- User is logged in as `admin` or `employee`
- At least three messages exist with varying status/type/attachment/action attributes

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `/backend/messages` and type a unique subject fragment in `Search messages` | Table narrows to matching rows |
| 2 | Apply `Status` filter (for example `Unread`) | Only unread messages are listed |
| 3 | Apply `Type` filter | Only selected message type records remain |
| 4 | Apply `Attachments = Yes` and `Actions = Yes` filters | Rows without attachments/actions are excluded |
| 5 | Clear filters | Full inbox result set returns |

## Expected Results
- Search term and filters are combined correctly in list query
- Table results stay consistent with selected filter chips/inputs

## Edge Cases / Error Scenarios
- If list API fails, flash `Failed to load messages.` is shown
