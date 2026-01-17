# Test Scenario 77: Query Index Reindex API

## Test ID
TC-API-SYS-004

## Category
System & Maintenance APIs

## Priority
High

## Type
API Test

## Description
Verify that the entity query index can be rebuilt via API.

## Prerequisites
- Valid authentication token
- User has appropriate permissions
- Entities exist to be indexed

## API Endpoint
`POST /api/query_index/reindex`

## Request Body
```json
{
  "entityType": "catalog.product",
  "fullReindex": true
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST request with entity type | Reindex job started |
| 2 | Verify response with job ID | Job ID returned |
| 3 | Poll for job status | Status updates |
| 4 | Wait for completion | Job completes |
| 5 | Verify index is updated | Search returns results |
| 6 | Check index coverage | All entities indexed |

## Expected Response
```json
{
  "success": true,
  "jobId": "job-123",
  "entityType": "catalog.product",
  "estimatedRecords": 500,
  "status": "started"
}
```

## Expected Results
- Reindex job starts successfully
- Progress is trackable
- Index is rebuilt with current data
- Search functionality works after
- No data loss during reindex

## Edge Cases / Error Scenarios
- Reindex non-existent entity type (error)
- Reindex during active writes (consistency)
- Large dataset reindex (performance/timeout)
- Cancel reindex mid-process
- Concurrent reindex requests (queue or reject)
