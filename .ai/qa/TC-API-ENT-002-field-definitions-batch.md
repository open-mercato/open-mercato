# Test Scenario 82: Custom Field Definitions Batch API

## Test ID
TC-API-ENT-002

## Category
Custom Fields & Entities APIs

## Priority
Medium

## Type
API Test

## Description
Verify that custom field definitions can be created or updated in batch.

## Prerequisites
- Valid authentication token
- User has `entities.manage` feature

## API Endpoint
`POST /api/entities/definitions.batch`

## Request Body
```json
{
  "entityId": "customers.company",
  "definitions": [
    {
      "code": "custom_score",
      "type": "number",
      "label": "Custom Score",
      "required": false
    },
    {
      "code": "notes",
      "type": "text",
      "label": "Internal Notes",
      "required": false
    }
  ]
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST with field array | Batch processed |
| 2 | Verify response | All fields created |
| 3 | Check individual fields exist | Each accessible |
| 4 | Update via same endpoint | Fields updated |
| 5 | Verify idempotency | No duplicates |

## Expected Response
```json
{
  "success": true,
  "created": 2,
  "updated": 0,
  "errors": [],
  "definitions": [...]
}
```

## Expected Results
- All fields created successfully
- Partial success on errors (with details)
- Existing fields updated
- Transaction consistency
- Validation per field

## Edge Cases / Error Scenarios
- Mixed valid/invalid fields (partial success)
- Duplicate codes in batch (error)
- Large batch (performance)
- Field type changes (may be restricted)
- Concurrent batch operations
