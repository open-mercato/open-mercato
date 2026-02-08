# Test Scenario 105: Feature Toggle Overrides API

## Test ID
TC-API-FT-003

## Category
Feature Toggles APIs

## Priority
Medium

## Type
API Test

## Description
Verify that feature toggle overrides can be managed per tenant/org/user.

## Prerequisites
- Valid authentication token
- Global feature toggles exist
- Override management permission

## API Endpoint
- `GET /api/feature-toggles/overrides` - List overrides
- `POST /api/feature-toggles/overrides` - Create override
- `DELETE /api/feature-toggles/overrides/:id` - Remove override

## Request Body (POST)
```json
{
  "toggleId": "toggle-123",
  "scope": "tenant",
  "scopeId": "tenant-456",
  "enabled": true
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create tenant override | Override saved |
| 2 | Check feature for tenant | Override applied |
| 3 | Check feature for other tenant | Global applies |
| 4 | Create user override | User override saved |
| 5 | Verify priority order | User > Org > Tenant |

## Expected Response
```json
{
  "id": "override-789",
  "toggleId": "toggle-123",
  "scope": "tenant",
  "scopeId": "tenant-456",
  "enabled": true,
  "createdAt": "2024-01-15T10:00:00Z"
}
```

## Expected Results
- Override takes precedence
- Scope hierarchy respected
- Can enable or disable
- Delete reverts to parent
- Changes are immediate

## Edge Cases / Error Scenarios
- Override for non-existent toggle (error)
- Duplicate scope/toggle combo (update)
- Invalid scope type (error)
- Cascade delete with toggle
- Override on disabled global
