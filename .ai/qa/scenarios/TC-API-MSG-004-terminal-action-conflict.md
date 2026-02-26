# Test Scenario 004: Terminal Action Conflict

## Test ID
TC-API-MSG-004

## Category
API - Messages

## Priority
High

## Type
API Test

## Description
Validates actionable-message safeguards: a terminal action can be executed once and repeated execution returns a conflict.

## Prerequisites
- User is logged in as admin (sender)
- User is logged in as employee (recipient)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST `/api/messages` with `actionData.actions=[{ id:"ack", href:"/backend/messages", isTerminal:true }]` | Response `201` with message `id` |
| 2 | POST `/api/messages/:id/actions/ack` as employee | Response `200` with `{ ok: true, actionId: "ack" }` |
| 3 | POST `/api/messages/:id/actions/ack` again | Response `409` with `error="Action already taken"` |
| 4 | GET `/api/messages/:id` | Detail includes `actionTaken="ack"` |

## Expected Results
- Terminal action state is persisted after first execution
- Duplicate terminal execution is blocked with conflict response

## Edge Cases / Error Scenarios
- Unknown action ID returns `404`
- Expired actions return `410`
