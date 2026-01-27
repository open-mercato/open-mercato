# Test Scenario 86: Entity Relations Options API

## Test ID
TC-API-ENT-006

## Category
Custom Fields & Entities APIs

## Priority
Low

## Type
API Test

## Description
Verify that available entity relation targets can be retrieved for linking.

## Prerequisites
- Valid authentication token
- User has `entities.view` feature
- Entity relations are configured

## API Endpoint
`GET /api/entities/relations/options`

## Query Parameters
- `sourceEntityId`: Source entity type
- `relationType`: Type of relation (one-to-one, one-to-many)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET request | Options returned |
| 2 | Verify available targets | Entity list returned |
| 3 | Check relation metadata | Type info included |
| 4 | Filter by relation type | Filtered results |

## Expected Response
```json
{
  "options": [
    {
      "entityId": "customers.company",
      "label": "Company",
      "relationType": "many-to-one"
    },
    {
      "entityId": "customers.person",
      "label": "Person",
      "relationType": "many-to-one"
    }
  ]
}
```

## Expected Results
- All linkable entities shown
- Relation types specified
- Filtered by compatibility
- Used for form dropdowns

## Edge Cases / Error Scenarios
- No relations configured (empty)
- Invalid source entity (error)
- Self-reference options (may be allowed)
- Cross-module relations
