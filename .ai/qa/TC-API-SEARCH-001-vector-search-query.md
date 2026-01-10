# Test Scenario 99: Vector Search Query API

## Test ID
TC-API-SEARCH-001

## Category
Search & Lookup APIs

## Priority
High

## Type
API Test

## Description
Verify that semantic vector search returns relevant results.

## Prerequisites
- Valid authentication token
- Vector search module enabled
- Documents indexed with embeddings

## API Endpoint
`GET /api/vector/search`

## Query Parameters
- `q`: Search query text
- `entityTypes`: Comma-separated entity types
- `limit`: Maximum results
- `threshold`: Minimum similarity score

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send GET with query | Search executed |
| 2 | Verify semantic matching | Related results |
| 3 | Check similarity scores | Scores present |
| 4 | Filter by entity type | Filtered results |
| 5 | Adjust threshold | Fewer/more results |

## Expected Response
```json
{
  "results": [
    {
      "entityType": "catalog.product",
      "entityId": "prod-123",
      "title": "Industrial Widget",
      "score": 0.92,
      "snippet": "..."
    }
  ],
  "total": 15,
  "queryTime": 45
}
```

## Expected Results
- Semantically similar results
- Results sorted by relevance
- Scores indicate match quality
- Multi-entity type search
- Reasonable response time

## Edge Cases / Error Scenarios
- No matching results (empty)
- Very broad query (many results)
- Special characters in query
- Empty query string (error)
- Vector service unavailable
