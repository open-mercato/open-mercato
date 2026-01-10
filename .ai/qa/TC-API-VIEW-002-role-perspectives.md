# Test Scenario 107: Role-Based Perspectives API

## Test ID
TC-API-VIEW-002

## Category
Perspectives & Views APIs

## Priority
Low

## Type
API Test

## Description
Verify that perspectives can be assigned to roles for team standardization.

## Prerequisites
- Valid authentication token
- User has perspective management permission
- Roles exist in system

## API Endpoint
- `GET /api/perspectives/:tableId/roles/:roleId` - Get role perspective
- `POST /api/perspectives/:tableId/roles/:roleId` - Assign perspective

## Request Body (POST)
```json
{
  "perspectiveId": "perspective-123"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create perspective | Perspective exists |
| 2 | Assign to role | Assignment saved |
| 3 | Login as user with role | Perspective is default |
| 4 | Verify view matches | Configuration applied |
| 5 | Remove assignment | User sees default |

## Expected Response
```json
{
  "roleId": "role-456",
  "tableId": "customers-table",
  "perspectiveId": "perspective-123",
  "assignedAt": "2024-01-15T10:00:00Z"
}
```

## Expected Results
- Role members see assigned perspective
- User can override with personal
- Role perspective is default
- Changes affect all role members
- Unassignment reverts behavior

## Edge Cases / Error Scenarios
- Non-existent perspective (error)
- Non-existent role (error)
- Multiple roles with different perspectives (priority)
- Delete perspective that's role-assigned
- User in multiple roles
