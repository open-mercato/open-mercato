# Test Scenario 80: Vector Index Rebuild API

## Test ID
TC-API-SYS-007

## Category
System & Maintenance APIs

## Priority
Medium

## Type
API Test

## Description
Verify that the vector search index can be rebuilt for semantic search.

## Prerequisites
- Valid authentication token
- Vector search module is enabled
- Documents exist to be indexed

## API Endpoint
`POST /api/vector/reindex`

## Request Body
```json
{
  "entityType": "catalog.product",
  "regenerateEmbeddings": true
}
```

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send POST request | Reindex job started |
| 2 | Verify response | Job ID returned |
| 3 | Poll for status | Progress updates |
| 4 | Wait for completion | Job finishes |
| 5 | Test vector search | Results returned |

## Expected Response
```json
{
  "success": true,
  "jobId": "vector-job-456",
  "entityType": "catalog.product",
  "estimatedDocuments": 500,
  "status": "started"
}
```

## Expected Results
- Vector embeddings regenerated
- Search returns semantic matches
- Index is consistent with data
- Performance is acceptable
- No data corruption

## Edge Cases / Error Scenarios
- Embedding service unavailable (error)
- Large document set (timeout handling)
- Cancel mid-reindex (cleanup)
- Invalid entity type (validation)
- Concurrent reindex (queue management)
