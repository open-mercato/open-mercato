# Test Scenario 123: Role Widgets Assignment API

## Test ID
TC-API-DASH-002

## Category
Dashboard & Widget APIs

## Priority
Low

## Type
API Test

## Description
Verify that widgets can be assigned to roles for default dashboards.

## Prerequisites
- Valid authentication token
- User has widget management permission
- Roles and widgets exist

## API Endpoint
- `GET /api/dashboards/roles/widgets` - Get role widgets
- `POST /api/dashboards/roles/widgets` - Assign widgets

## Request Body (POST)
```json
{
  "roleId": "role-123",
  "widgets": [
    { "widgetId": "sales-summary", "position": { "x": 0, "y": 0, "w": 6, "h": 4 } },
    { "widgetId": "orders-list", "position": { "x": 6, "y": 0, "w": 6, "h": 4 } }
  ]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Get current role widgets | Current assignment |
| 2 | Assign widgets to role | Assignment saved |
| 3 | Login as role member | Default dashboard shows |
| 4 | Verify widget layout | Position matches |
| 5 | Update assignment | Changes reflected |

## Expected Response
```json
{
  "success": true,
  "roleId": "role-123",
  "widgetCount": 2,
  "message": "Widgets assigned to role"
}
```

## Expected Results
- Widgets assigned to role
- Members see default layout
- Position and size saved
- Updates affect all members
- User can override

## Edge Cases / Error Scenarios
- Invalid widget ID (error)
- Invalid role ID (error)
- Widget requires missing feature
- Overlapping widget positions
- Clear all role widgets
