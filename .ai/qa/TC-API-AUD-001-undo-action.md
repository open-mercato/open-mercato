# Test Scenario 93: Undo Action API

## Test ID
TC-API-AUD-001

## Category
Audit & Business Rules APIs

## Priority
Medium

## Type
API Test

## Description
Verify that recent actions can be undone using undo tokens.

## Prerequisites
- Valid authentication token
- Recent undoable action exists
- Undo token available

## API Endpoint
`POST /api/audit-logs/actions/undo`

## Request Body
```json
{
  "token": "undo-token-abc123"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Perform undoable action | Token returned |
| 2 | Send POST with undo token | Undo processed |
| 3 | Verify response | Success message |
| 4 | Check data reverted | Original state restored |
| 5 | Verify redo is available | Redo token returned |

## Expected Response
```json
{
  "success": true,
  "undoneAction": "customers.company.update",
  "entityId": "company-123",
  "redoToken": "redo-token-xyz789"
}
```

## Expected Results
- Action is reversed
- Data restored to previous state
- Redo token provided
- Audit log updated
- UI reflects change

## Edge Cases / Error Scenarios
- Invalid/expired token (error)
- Already undone (error)
- Non-undoable action (error)
- Conflicting changes since (warning)
- Undo on deleted entity
