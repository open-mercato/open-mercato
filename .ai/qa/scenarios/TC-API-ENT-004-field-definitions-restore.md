# Test Scenario 84: Restore Deleted Custom Field Definition API

## Test ID
TC-API-ENT-004

## Category
Custom Fields & Entities APIs

## Priority
Low

## Type
API Test

## Description
Verify that soft-deleted custom field definitions can be restored.

## Prerequisites
- Valid authentication token
- User has `entities.manage` feature
- Deleted field definition exists

## API Endpoint
`POST /api/entities/definitions.restore`

## Request Body
```json
{
  "definitionId": "field-123"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify field is deleted | deletedAt is set |
| 2 | Send POST to restore | Restore processed |
| 3 | Verify response | Success message |
| 4 | Check field is active | deletedAt cleared |
| 5 | Field appears in forms | Usable again |

## Expected Response
```json
{
  "success": true,
  "definitionId": "field-123",
  "message": "Field definition restored"
}
```

## Expected Results
- Field is restored to active
- deletedAt is cleared
- Field values are accessible
- Field appears in UI
- Historical data preserved

## Edge Cases / Error Scenarios
- Restore non-existent field (404)
- Restore already active field (no-op)
- Field with same code created since (conflict)
- Restore field with incompatible data
- Permission check on restore
