# Test Scenario 001: Compose And Mark Read

## Test ID
TC-API-MSG-001

## Category
API - Messages

## Priority
High

## Type
API Test

## Description
Validates core send and read behavior: compose a new message, verify it appears in recipient inbox as unread, and confirm opening detail marks it as read.

## Prerequisites
- User is logged in as admin (sender)
- User is logged in as employee (recipient)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST `/api/messages` as admin with employee recipient, subject, body | Response `201` with new `id` |
| 2 | GET `/api/messages?folder=inbox&search=<subject>` as employee | Message appears with `status="unread"` |
| 3 | GET `/api/messages/:id` as employee | Response `200`, `isRead=true` |
| 4 | GET `/api/messages?folder=inbox&status=read&search=<subject>` as employee | Same message appears as read |

## Expected Results
- Message is created and visible to recipient
- Recipient status transitions from unread to read after detail retrieval

## Edge Cases / Error Scenarios
- Recipient without access gets `403`
- Unknown message ID returns `404`
