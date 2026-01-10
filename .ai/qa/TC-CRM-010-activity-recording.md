# Test Scenario 53: Record Customer Activity

## Test ID
TC-CRM-010

## Category
Customer/CRM Management

## Priority
Medium

## Description
Verify that activities (calls, meetings, emails) can be recorded on customer or deal timeline.

## Prerequisites
- User is logged in with `customers.activities.create` feature
- Customer or deal exists
- Activity types are configured

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to customer or deal detail | Detail page displayed |
| 2 | Find timeline/activities section | Activity feed visible |
| 3 | Click "Add Activity" button | Activity form appears |
| 4 | Select activity type (call, meeting, email) | Type selected |
| 5 | Enter activity subject | Subject stored |
| 6 | Enter activity description/notes | Body content saved |
| 7 | Set activity date/time | Occurred date set |
| 8 | Set duration (if applicable) | Duration recorded |
| 9 | Save activity | Activity is recorded |

## Expected Results
- Activity record is created
- Activity linked to customer/deal
- Activity appears in timeline
- Activity type determines icon/styling
- Date/time is recorded
- Duration tracked for calls/meetings
- Notes capture conversation details
- Activity can have participants
- Next action can be scheduled

## Edge Cases / Error Scenarios
- Activity without subject (validation error)
- Future activity date (scheduled activity)
- Very long activity notes (max length)
- Activity linked to multiple entities (customer + deal)
- Edit completed activity (may have restrictions)
- Delete activity (soft delete for audit)
- Activity with attachments (file upload)
- Sync activity from email/calendar (if integrated)
