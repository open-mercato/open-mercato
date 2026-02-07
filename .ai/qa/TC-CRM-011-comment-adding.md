# Test Scenario 54: Add Comment to Customer

## Test ID
TC-CRM-011

## Category
Customer/CRM Management

## Priority
Low

## Description
Verify that internal comments/notes can be added to customer or deal records.

## Prerequisites
- User is logged in with `customers.view` feature
- Customer or deal exists
- Commenting is enabled

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to customer or deal detail | Detail page displayed |
| 2 | Find comments section | Comments area visible |
| 3 | Enter comment text | Text input accepts content |
| 4 | Click "Add Comment" or submit | Comment is posted |
| 5 | Observe comment in list | Comment appears with timestamp |
| 6 | View commenter information | Author is shown |
| 7 | Add another comment | Multiple comments supported |

## Expected Results
- Comment record is created
- Comment linked to entity
- Comment shows author and timestamp
- Comments are in chronological order
- Comments support basic formatting (if enabled)
- Comments are visible to team members
- Comments are internal (not visible to customers)
- @mentions notify users (if supported)

## Edge Cases / Error Scenarios
- Empty comment (should be prevented)
- Very long comment (max length or scrollable)
- Comment with special characters (should be handled)
- Edit own comment (if allowed, time-limited)
- Delete comment (soft delete, may require permission)
- Comment on deleted entity (should be prevented)
- Emoji in comments (should be supported)
- HTML/XSS in comments (must be sanitized)
