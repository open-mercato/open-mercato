# Test Scenario 81: Custom Field Definitions Manage API

## Test ID
TC-API-ENT-001

## Category
Custom Fields & Entities APIs

## Priority
High

## Type
API Test

## Description
Verify that custom field definitions can be retrieved with scoping and tombstone handling.

## Prerequisites
- Valid authentication token
- User has `entities.manage` feature
- Custom fields are defined

## API Endpoint
`GET /api/entities/definitions.manage`

## Query Parameters
- `entityId`: Target entity ID
- `includeTombstones`: Include deleted definitions

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Definitions returned |
| 2 | Verify response structure | Fields with metadata |
| 3 | Check scope filtering | Only current scope |
| 4 | Request with tombstones | Deleted fields included |
| 5 | Verify field types | All types represented |

## Expected Response
```json
{
  "definitions": [
    {
      "id": "field-123",
      "entityId": "customers.company",
      "code": "industry_code",
      "type": "text",
      "label": "Industry Code",
      "required": false,
      "deletedAt": null
    }
  ],
  "count": 15
}
```

## Expected Results
- All field definitions returned
- Proper scoping by tenant/org
- Tombstoned fields included when requested
- Field metadata complete
- Performance acceptable for large sets

## Edge Cases / Error Scenarios
- No fields defined (empty array)
- Invalid entity ID (validation error)
- Unauthorized scope access (filtered out)
- Corrupted field definition (handled)
- Very large field count (pagination)
