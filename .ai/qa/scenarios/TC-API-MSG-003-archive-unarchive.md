# Test Scenario 003: Archive And Unarchive

## Test ID
TC-API-MSG-003

## Category
API - Messages

## Priority
High

## Type
API Test

## Description
Validates recipient folder transitions by archiving a message, verifying it moves to archived results, and unarchiving to return it to inbox.

## Prerequisites
- User is logged in as admin (sender)
- User is logged in as employee (recipient)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST `/api/messages` as admin to employee | Response `201` with message `id` |
| 2 | PUT `/api/messages/:id/archive` as employee | Response `200` with `{ ok: true }` |
| 3 | GET `/api/messages?folder=archived&search=<subject>` as employee | Archived list contains message `id` |
| 4 | DELETE `/api/messages/:id/archive` as employee | Response `200` with `{ ok: true }` |
| 5 | GET archived and inbox folders as employee | Message absent from archived and present in inbox |

## Expected Results
- Archive and unarchive endpoints update recipient folder state correctly

## Edge Cases / Error Scenarios
- Sender who is not recipient cannot archive (`403`)
- Unknown message ID returns `404`
