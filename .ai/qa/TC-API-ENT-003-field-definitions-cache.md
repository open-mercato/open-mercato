# Test Scenario 83: Custom Field Definition Cache Clear API

## Test ID
TC-API-ENT-003

## Category
Custom Fields & Entities APIs

## Priority
Low

## Type
API Test

## Description
Verify that custom field definition cache can be cleared.

## Prerequisites
- Valid authentication token
- User has `entities.manage` feature
- Cache service operational

## API Endpoint
`POST /api/entities/definitions.cache`

## Request Body
```json
{
  "action": "clear",
  "entityId": "customers.company"
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify definitions are cached | Cache hit on get |
| 2 | Send POST to clear cache | Cache cleared |
| 3 | Verify response | Success confirmation |
| 4 | Request definitions again | Cache miss, rebuilt |
| 5 | Subsequent requests hit cache | Cache repopulated |

## Expected Response
```json
{
  "success": true,
  "message": "Definition cache cleared",
  "scope": "customers.company"
}
```

## Expected Results
- Cache is cleared for entity
- Next request rebuilds cache
- No data loss
- Forms still work

## Edge Cases / Error Scenarios
- Clear all entities (broader scope)
- Cache service down (error handling)
- Concurrent clear and read
- Clear during form submission
- Non-existent entity (no-op)
