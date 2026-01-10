# Test Scenario 106: Table Perspective CRUD API

## Test ID
TC-API-VIEW-001

## Category
Perspectives & Views APIs

## Priority
Low

## Type
API Test

## Description
Verify that table view perspectives can be saved and restored.

## Prerequisites
- Valid authentication token
- Data table with perspective support

## API Endpoint
- `GET /api/perspectives/:tableId` - List perspectives
- `POST /api/perspectives/:tableId` - Create perspective
- `PATCH /api/perspectives/:tableId/:id` - Update
- `DELETE /api/perspectives/:tableId/:id` - Delete

## Request Body (POST)
```json
{
  "name": "My Custom View",
  "columns": ["name", "email", "status"],
  "filters": { "status": "active" },
  "sort": [{ "field": "name", "direction": "asc" }],
  "isDefault": false
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Configure table view | View customized |
| 2 | Send POST to save | Perspective created |
| 3 | Reload table | Perspective available |
| 4 | Apply perspective | View restored |
| 5 | Update perspective | Changes saved |

## Expected Response
```json
{
  "id": "perspective-123",
  "tableId": "customers-table",
  "name": "My Custom View",
  "userId": "user-456",
  "config": {...},
  "isDefault": false
}
```

## Expected Results
- Perspective saves view state
- User-specific perspectives
- Default perspective option
- Shared perspectives possible
- Fast load on apply

## Edge Cases / Error Scenarios
- Duplicate name (may allow)
- Very complex filters (size limit)
- Invalid column reference (validation)
- Table schema changed (migration)
- Delete default perspective
