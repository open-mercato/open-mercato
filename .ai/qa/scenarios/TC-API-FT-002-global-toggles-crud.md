# Test Scenario 104: Global Feature Toggles CRUD API

## Test ID
TC-API-FT-002

## Category
Feature Toggles APIs

## Priority
Medium

## Type
API Test

## Description
Verify CRUD operations on global feature toggles.

## Prerequisites
- Valid authentication token
- User has feature toggles management permission

## API Endpoint
- `GET /api/feature-toggles/global` - List
- `POST /api/feature-toggles/global` - Create
- `PATCH /api/feature-toggles/global/:id` - Update
- `DELETE /api/feature-toggles/global/:id` - Delete

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET to list toggles | Toggle list returned |
| 2 | Send POST to create toggle | Toggle created |
| 3 | Verify toggle in list | New toggle present |
| 4 | Send PATCH to update | Toggle updated |
| 5 | Send DELETE to remove | Toggle deleted |

## Expected Response (POST)
```json
{
  "id": "toggle-123",
  "key": "new_feature",
  "enabled": false,
  "description": "New feature flag",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

## Expected Results
- Full CRUD functionality
- Key uniqueness enforced
- Immediate effect on checks
- Audit trail for changes
- Validation on inputs

## Edge Cases / Error Scenarios
- Duplicate key (error)
- Invalid key format (error)
- Delete toggle with overrides (cascade)
- Update non-existent (404)
- Protected/system toggles
