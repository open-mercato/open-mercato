# Test Scenario 002: Reply Thread History

## Test ID
TC-API-MSG-002

## Category
API - Messages

## Priority
High

## Type
API Test

## Description
Validates reply flow and thread continuity by replying to a received message and verifying thread references in both reply and original message detail payloads.

## Prerequisites
- User is logged in as admin (original sender)
- User is logged in as employee (recipient and replier)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST `/api/messages` as admin to employee | Response `201` with original message `id` |
| 2 | POST `/api/messages/:id/reply` as employee with body and `replyAll=true` | Response `201` with reply `id` |
| 3 | GET `/api/messages/:replyId` as admin | `parentMessageId` equals original `id` and `threadId` is present |
| 4 | GET `/api/messages/:originalId` as admin | `thread` includes both original and reply message IDs |

## Expected Results
- Reply message is created in same thread
- Thread payload exposes both messages for conversation view

## Edge Cases / Error Scenarios
- Reply to inaccessible message returns `403`
- Reply to unsupported message type returns `409`
