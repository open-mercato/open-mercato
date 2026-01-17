# Test Scenario 87: Query Engine Records API

## Test ID
TC-API-ENT-007

## Category
Custom Fields & Entities APIs

## Priority
High

## Type
API Test

## Description
Verify that the query engine API can retrieve, filter, and manipulate entity records.

## Prerequisites
- Valid authentication token
- User has appropriate entity permissions
- Records exist for querying

## API Endpoint
- `GET /api/entities/records` - Query records
- `POST /api/entities/records` - Create record
- `PATCH /api/entities/records/:id` - Update record
- `DELETE /api/entities/records/:id` - Delete record

## Request Body (POST)
```json
{
  "entityType": "customers.company",
  "filters": {
    "status": { "eq": "active" },
    "createdAt": { "gte": "2024-01-01" }
  },
  "fields": ["id", "name", "email", "cf_custom_field"],
  "sort": [{ "field": "name", "direction": "asc" }],
  "limit": 50,
  "offset": 0
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send query request | Records returned |
| 2 | Apply filters | Filtered results |
| 3 | Request specific fields | Only requested fields |
| 4 | Apply sorting | Sorted results |
| 5 | Use pagination | Paged results |
| 6 | Include custom fields | CF values present |

## Expected Response
```json
{
  "records": [...],
  "total": 150,
  "limit": 50,
  "offset": 0,
  "hasMore": true
}
```

## Expected Results
- Query returns matching records
- Filters applied correctly
- Sorting works as expected
- Pagination returns correct pages
- Custom fields included
- Performance is acceptable

## Edge Cases / Error Scenarios
- Invalid filter syntax (validation error)
- Non-existent field in filter (error)
- Very complex query (timeout)
- Cross-entity queries (joins)
- Encrypted field queries (decrypted)
