# Test Scenario 78: Query Index Purge API

## Test ID
TC-API-SYS-005

## Category
System & Maintenance APIs

## Priority
Medium

## Type
API Test

## Description
Verify that the query index can be purged for specific entity types.

## Prerequisites
- Valid authentication token
- User has appropriate permissions
- Index has data to purge

## API Endpoint
`POST /api/query_index/purge`

## Request Body
```json
{
  "entityType": "catalog.product",
  "confirm": true
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Verify index has entries | Entries exist |
| 2 | Send POST request to purge | Purge initiated |
| 3 | Verify confirmation required | Safety check |
| 4 | Confirm purge action | Purge proceeds |
| 5 | Check index is empty | No entries for type |
| 6 | Verify other types unaffected | Isolation |

## Expected Response
```json
{
  "success": true,
  "entityType": "catalog.product",
  "purgedRecords": 500,
  "message": "Index purged successfully"
}
```

## Expected Results
- Index entries are removed
- Only specified type affected
- Search returns no results until reindex
- Operation is logged
- Can recover via reindex

## Edge Cases / Error Scenarios
- Purge without confirmation (rejected)
- Purge non-existent type (no-op or error)
- Purge all types (may require special permission)
- Purge during search (graceful handling)
- Recovery after accidental purge
