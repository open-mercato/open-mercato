# Test Scenario 94: Redo Action API

## Test ID
TC-API-AUD-002

## Category
Audit & Business Rules APIs

## Priority
Medium

## Type
API Test

## Description
Verify that undone actions can be redone using redo tokens.

## Prerequisites
- Valid authentication token
- Action has been undone
- Redo token available

## API Endpoint
`POST /api/audit-logs/actions/redo`

## Request Body
```json
{
  "token": "redo-token-xyz789"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Have undone action | Redo token available |
| 2 | Send POST with redo token | Redo processed |
| 3 | Verify response | Success message |
| 4 | Check data restored | Changes reapplied |
| 5 | Verify undo available again | Undo token returned |

## Expected Response
```json
{
  "success": true,
  "redoneAction": "customers.company.update",
  "entityId": "company-123",
  "undoToken": "undo-token-new456"
}
```

## Expected Results
- Undone action reapplied
- Data matches post-action state
- New undo token provided
- Audit log updated
- Cycle can continue

## Edge Cases / Error Scenarios
- Invalid/expired token (error)
- Already redone (error)
- Entity modified since undo (conflict)
- Entity deleted since undo
- Redo chain limit
